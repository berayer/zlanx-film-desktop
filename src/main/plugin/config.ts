import { mkdir, readFile } from "node:fs/promises"
import path from "node:path"
import { PluginError } from "./errors"
import { writeAtomic } from "./fs"
import type {
  PluginConfig,
  PluginConfigField,
  PluginConfigFieldType,
  PluginConfigOption,
  PluginConfigValue,
} from "./interface"

/** 插件配置文件（用户填写的值），位于插件目录内 */
export const PLUGIN_CONFIG_FILE = "config.json"

/** 配置项数量上限，防止畸形插件撑爆配置面板 */
const MAX_CONFIG_FIELDS = 50
/** 配置键需可直接作为 JSON 字段名 */
const CONFIG_KEY_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/
const FIELD_TYPES: readonly PluginConfigFieldType[] = ["string", "text", "number", "boolean", "select"]

/**
 * 校验并规整插件导出的 `config` 字段（配置项 schema）。
 *
 * 任一项不合法都通过 `fail` 抛错（宿主侧统一包装成安装失败），
 * 避免脏数据落盘后再在运行时才发现。
 */
export function parseConfigSchema(
  raw: unknown,
  fail: (message: string) => PluginError,
): PluginConfigField[] | undefined {
  if (raw === undefined) {
    return undefined
  }
  if (!Array.isArray(raw)) {
    throw fail("导出字段 config 必须是数组")
  }
  if (raw.length === 0) {
    return undefined
  }
  if (raw.length > MAX_CONFIG_FIELDS) {
    throw fail(`导出字段 config 最多允许 ${MAX_CONFIG_FIELDS} 个配置项`)
  }

  const seen = new Set<string>()
  const fields: PluginConfigField[] = []
  raw.forEach((item, index) => {
    const at = `配置项 #${index + 1}`
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw fail(`${at} 必须是对象`)
    }
    const source = item as Record<string, unknown>
    const key = source["key"]
    if (typeof key !== "string" || !CONFIG_KEY_PATTERN.test(key)) {
      throw fail(`${at} 的 key "${String(key)}" 不合法：仅允许字母、数字、下划线、点、连字符，且需以字母或下划线开头`)
    }
    if (seen.has(key)) {
      throw fail(`${at} 的 key "${key}" 重复`)
    }
    seen.add(key)

    const label = source["label"]
    if (typeof label !== "string" || label.trim().length === 0) {
      throw fail(`配置项 "${key}" 缺少 label（展示名称）`)
    }
    const rawType = source["type"] ?? "string"
    if (typeof rawType !== "string" || !(FIELD_TYPES as readonly string[]).includes(rawType)) {
      throw fail(`配置项 "${key}" 的 type 必须是 ${FIELD_TYPES.join(" / ")} 之一`)
    }
    const type = rawType as PluginConfigFieldType

    for (const name of ["description", "placeholder"] as const) {
      if (source[name] !== undefined && typeof source[name] !== "string") {
        throw fail(`配置项 "${key}" 的 ${name} 必须是字符串`)
      }
    }
    for (const name of ["required", "secret"] as const) {
      if (source[name] !== undefined && typeof source[name] !== "boolean") {
        throw fail(`配置项 "${key}" 的 ${name} 必须是布尔值`)
      }
    }
    for (const name of ["min", "max"] as const) {
      if (source[name] !== undefined && (typeof source[name] !== "number" || !Number.isFinite(source[name]))) {
        throw fail(`配置项 "${key}" 的 ${name} 必须是数字`)
      }
    }

    const field: PluginConfigField = { key, label: label.trim(), type }
    if (typeof source["description"] === "string") {
      field.description = source["description"]
    }
    if (typeof source["placeholder"] === "string") {
      field.placeholder = source["placeholder"]
    }
    if (typeof source["required"] === "boolean") {
      field.required = source["required"]
    }
    if (typeof source["secret"] === "boolean") {
      field.secret = source["secret"]
    }
    if (typeof source["min"] === "number") {
      field.min = source["min"]
    }
    if (typeof source["max"] === "number") {
      field.max = source["max"]
    }
    if (type === "select") {
      field.options = parseOptions(source["options"], key, fail)
    }
    if (source["default"] !== undefined) {
      field.default = validateValue(field, source["default"], key)
    }
    if (field.default !== undefined && field.type === "select") {
      if (!field.options?.some((option) => option.value === field.default)) {
        throw fail(`配置项 "${key}" 的 default 不在 options 取值范围内`)
      }
    }
    fields.push(field)
  })
  return fields
}

function parseOptions(raw: unknown, key: string, fail: (message: string) => PluginError): PluginConfigOption[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw fail(`配置项 "${key}" 为 select 类型，必须提供非空的 options`)
  }
  const seen = new Set<string>()
  const options: PluginConfigOption[] = raw.map((item, index) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw fail(`配置项 "${key}" 的 options[${index}] 必须是 { label, value } 对象`)
    }
    const source = item as Record<string, unknown>
    const value = source["value"]
    const label = source["label"]
    if (typeof value !== "string" || value.length === 0) {
      throw fail(`配置项 "${key}" 的 options[${index}].value 必须是非空字符串`)
    }
    if (seen.has(value)) {
      throw fail(`配置项 "${key}" 的 options 存在重复的 value "${value}"`)
    }
    seen.add(value)
    return { value, label: typeof label === "string" && label.length > 0 ? label : value }
  })
  return options
}

/** 按 schema 产出默认值集合（未声明 default 的项不出现） */
export function defaultConfigValues(schema: readonly PluginConfigField[]): Record<string, PluginConfigValue> {
  const values: Record<string, PluginConfigValue> = {}
  for (const field of schema) {
    if (field.default !== undefined) {
      values[field.key] = field.default
    }
  }
  return values
}

/** 校验单个值并返回规整后的结果 */
export function validateValue(field: PluginConfigField, value: unknown, pluginId: string): PluginConfigValue {
  const invalid = (message: string): never => {
    throw new PluginError("INVALID_CONFIG", `配置项「${field.label}」${message}`, { pluginId })
  }
  switch (field.type) {
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return invalid("必须是数字")
      }
      if (field.min !== undefined && value < field.min) {
        return invalid(`不能小于 ${field.min}`)
      }
      if (field.max !== undefined && value > field.max) {
        return invalid(`不能大于 ${field.max}`)
      }
      return value
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        return invalid("必须是布尔值")
      }
      return value
    }
    case "select": {
      if (typeof value !== "string") {
        return invalid("必须是字符串")
      }
      if (!field.options?.some((option) => option.value === value)) {
        return invalid(`只能取以下值之一：${field.options?.map((option) => option.value).join(", ")}`)
      }
      return value
    }
    default: {
      if (typeof value !== "string") {
        return invalid("必须是字符串")
      }
      return value
    }
  }
}

/**
 * 宽松合并：把磁盘里的值覆盖到默认值之上，用于「读取」场景（打开配置面板 / 注入 ctx.config）。
 *
 * 与 `normalizeConfigValues` 的区别：这里不做必填校验（用户还没配属正常情况），
 * 类型不匹配也只是回落到默认值，不会因为一个坏值就让整个插件读不到配置。
 */
export function mergeConfigValues(
  schema: readonly PluginConfigField[],
  stored: Record<string, unknown>,
  pluginId: string,
): Record<string, PluginConfigValue> {
  const values = defaultConfigValues(schema)
  for (const field of schema) {
    const raw = stored[field.key]
    if (raw === undefined || raw === null || raw === "") {
      continue
    }
    try {
      values[field.key] = validateValue(field, raw, pluginId)
    } catch {
      // 手改坏了或插件改了类型：回落到默认值
      if (field.default !== undefined) {
        values[field.key] = field.default
      }
    }
  }
  return values
}

/**
 * 校验并归一化用户填写的配置值。
 *
 * - schema 未声明的 key 直接报错，避免往 config.json 里塞垃圾；
 * - `undefined` / `null` / 空串表示「清空」：有默认值就回落到默认值，没有则删除该键；
 * - 因此必填项清空后：有默认值 → 回到默认值；无默认值 → 报错（必填项不允许留空）；
 * - number / boolean / select 会做类型与范围校验。
 */
export function normalizeConfigValues(
  schema: readonly PluginConfigField[],
  input: Record<string, unknown>,
  pluginId: string,
): Record<string, PluginConfigValue> {
  const fields = new Map(schema.map((field) => [field.key, field]))
  const values: Record<string, PluginConfigValue> = defaultConfigValues(schema)

  for (const [key, value] of Object.entries(input)) {
    const field = fields.get(key)
    if (!field) {
      throw new PluginError("INVALID_CONFIG", `插件未声明配置项 "${key}"`, { pluginId })
    }
    const empty = value === undefined || value === null || value === ""
    if (empty) {
      if (field.default !== undefined) {
        values[key] = field.default
        continue
      }
      delete values[key]
      if (field.required) {
        throw new PluginError("INVALID_CONFIG", `配置项「${field.label}」（${key}）为必填项，不能留空`, {
          pluginId,
        })
      }
      continue
    }
    values[key] = validateValue(field, value, pluginId)
  }

  for (const field of schema) {
    if (field.required && values[field.key] === undefined) {
      throw new PluginError("INVALID_CONFIG", `配置项「${field.label}」（${field.key}）为必填项，请先填写`, {
        pluginId,
      })
    }
  }
  return values
}

/** 读取插件目录下的 config.json（不存在或损坏时视为空对象） */
export async function readConfigValues(file: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"))
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // 文件不存在或内容损坏：按「未配置」处理，让插件走默认值
  }
  return {}
}

/** 原子写入 config.json */
export async function writeConfigValues(
  file: string,
  values: Readonly<Record<string, PluginConfigValue>>,
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  await writeAtomic(file, JSON.stringify(values, null, 2))
}

/**
 * 构造注入给插件的 `ctx.config`：只读视图，值来自 config.json 合并 schema 默认值的结果。
 * 插件不能改自己的配置（运行时数据请写 `ctx.storage`），修改统一走宿主的 `updateConfig`。
 */
export function createConfigView(values: Readonly<Record<string, PluginConfigValue>>, pluginId: string): PluginConfig {
  const data: Record<string, PluginConfigValue> = Object.freeze({ ...values })
  const view: PluginConfig = {
    get: <T extends PluginConfigValue = PluginConfigValue>(key: string): T | undefined => data[key] as T | undefined,
    require: <T extends PluginConfigValue = PluginConfigValue>(key: string): T => {
      const value = data[key]
      if (value === undefined || value === "") {
        throw new PluginError("INVALID_CONFIG", `配置项 "${key}" 尚未填写，请先在插件面板中配置`, { pluginId })
      }
      return value as T
    },
    has: (key: string): boolean => data[key] !== undefined,
    all: (): Readonly<Record<string, PluginConfigValue>> => data,
  }
  return view
}
