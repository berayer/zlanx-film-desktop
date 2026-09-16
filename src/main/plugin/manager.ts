import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises"
import path from "node:path"
import {
  PLUGIN_CONFIG_FILE,
  createConfigView,
  defaultConfigValues,
  mergeConfigValues,
  normalizeConfigValues,
  parseConfigSchema,
  readConfigValues,
  writeConfigValues,
} from "./config"
import { Emitter } from "./emitter"
import { PluginError, toPluginError } from "./errors"
import { exists, writeAtomic } from "./fs"
import { createPluginLogger, noopLogger } from "./logger"
import { isValidVersion, satisfiesRange } from "./semver"
import { runPluginModule, type SandboxHandle } from "./sandbox"
import { PluginStorageImpl } from "./storage"
import type {
  ApiArgs,
  ApiMethodKey,
  ApiResult,
  PluginApi,
  PluginConfigField,
  PluginConfigSnapshot,
  PluginConfigUpdateOptions,
  PluginConfigValue,
  PluginContext,
  PluginErrorCode,
  PluginEvents,
  PluginHttp,
  PluginHttpInit,
  PluginInfo,
  PluginInstallOptions,
  PluginLogger,
  PluginManagerOptions,
  PluginManifest,
  PluginModule,
  PluginState,
  PluginStatus,
  PluginStorage,
} from "./interface"

/** 宿主 API 版本，插件通过导出字段的 apiVersion 声明兼容范围 */
export const HOST_API_VERSION = "1.0.0"

/** 插件入口文件名：无论本地安装还是网络安装，最终都落成这一个文件 */
export const PLUGIN_ENTRY_FILE = "index.js"
/** 插件状态文件（宿主维护），位于插件目录内 */
export const PLUGIN_STATE_FILE = "state.json"
/** 插件 KV 数据文件（ctx.storage 落地），位于插件目录内 */
export const PLUGIN_STORAGE_FILE = "storage.json"
/** 插件配置文件（用户填写的 host / api_key / cookie 等），位于插件目录内 */
export { PLUGIN_CONFIG_FILE } from "./config"

const DEFAULT_HTTP_TIMEOUT = 15_000
const DEFAULT_LOAD_TIMEOUT = 5_000
const DEFAULT_PROBE_TIMEOUT = 5_000
const DEFAULT_HOOK_TIMEOUT = 30_000
const DEFAULT_DOWNLOAD_TIMEOUT = 30_000
/** 单个插件源码的体积上限（8MB） */
const MAX_SOURCE_BYTES = 8 * 1024 * 1024
/** 插件 ID 需可直接作为目录名 */
const PLUGIN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

interface PluginRecord<TApi extends object> {
  manifest: PluginManifest
  directory: string
  status: PluginStatus
  error?: string
  entry?: string
  sandbox?: SandboxHandle
  module?: PluginModule<TApi>
  /** 宿主可调用的方法集合（`module.exports.api` 或 `module.exports` 本身） */
  api?: TApi
  storage?: PluginStorageImpl
  /** 加载时读取的配置值（config.json 合并 schema 默认值的结果） */
  config?: Record<string, PluginConfigValue>
}

function withTimeout<T>(promise: Promise<T>, ms: number, code: PluginErrorCode, pluginId: string): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) {
    return promise
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new PluginError(code, `插件操作超过 ${ms}ms 未完成`, { pluginId })), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function isLoadedStatus(status: PluginStatus): boolean {
  return status === "active" || status === "inactive" || status === "loading"
}

const probeDenied = (): never => {
  throw new PluginError("PERMISSION_DENIED", "插件安装校验阶段不支持发起网络请求")
}

/** 探测阶段的能力占位：保证「顶层误用」立刻报错而不是静默通过 */
const probeHttp: PluginHttp = {
  request: (): Promise<Response> => probeDenied(),
  text: (): Promise<string> => probeDenied(),
  json: <T>(): Promise<T> => probeDenied(),
}

/**
 * 从插件导出对象里提取并校验清单字段。
 *
 * 支持两种写法（`module.exports.manifest` 优先）：
 * ```js
 * module.exports = { id: "demo", name: "演示", version: "1.0.0", ... }
 * module.exports.manifest = { id: "demo", name: "演示", version: "1.0.0" }
 * ```
 * 缺少 id / name / version 或格式不合法时直接抛 `INVALID_MANIFEST`。
 */
function parseManifest(exportsValue: Record<string, unknown>, fallbackId: string): PluginManifest {
  if (!exportsValue || typeof exportsValue !== "object" || Array.isArray(exportsValue)) {
    throw new PluginError("INVALID_MANIFEST", "插件必须导出一个对象（module.exports = { id, name, version, ... }）", {
      pluginId: fallbackId,
    })
  }
  const nested = exportsValue["manifest"]
  const provider =
    nested !== undefined && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : undefined
  const raw: Record<string, unknown> = provider ? { ...exportsValue, ...provider } : exportsValue

  const fail = (message: string): PluginError =>
    new PluginError("INVALID_MANIFEST", message, {
      pluginId: typeof raw["id"] === "string" ? raw["id"] : fallbackId,
    })

  const id = raw["id"]
  if (typeof id !== "string" || id.trim().length === 0) {
    throw fail("缺少导出字段 id（插件唯一标识）")
  }
  const trimmedId = id.trim()
  if (!PLUGIN_ID_PATTERN.test(trimmedId)) {
    throw fail(`导出字段 id "${trimmedId}" 不合法：仅允许字母、数字、点、下划线与连字符，且需以字母或数字开头`)
  }
  const name = raw["name"]
  if (typeof name !== "string" || name.trim().length === 0) {
    throw fail("缺少导出字段 name（插件名称）")
  }
  const version = raw["version"]
  if (typeof version !== "string" || !isValidVersion(version)) {
    throw fail(`导出字段 version 不是合法的语义化版本号（当前值：${String(version)}）`)
  }
  if (raw["apiVersion"] !== undefined && typeof raw["apiVersion"] !== "string") {
    throw fail("导出字段 apiVersion 必须是字符串")
  }
  if (raw["enabled"] !== undefined && typeof raw["enabled"] !== "boolean") {
    throw fail("导出字段 enabled 必须是布尔值")
  }
  if (raw["dependencies"] !== undefined) {
    const value = raw["dependencies"]
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw fail("导出字段 dependencies 必须是对象")
    }
  }
  for (const key of ["description", "author", "homepage", "icon"] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== "string") {
      throw fail(`导出字段 ${key} 必须是字符串`)
    }
  }

  const manifest: PluginManifest = { id: trimmedId, name: name.trim(), version: version.trim() }
  if (typeof raw["description"] === "string") {
    manifest.description = raw["description"]
  }
  if (typeof raw["author"] === "string") {
    manifest.author = raw["author"]
  }
  if (typeof raw["homepage"] === "string") {
    manifest.homepage = raw["homepage"]
  }
  if (typeof raw["icon"] === "string") {
    manifest.icon = raw["icon"]
  }
  if (typeof raw["apiVersion"] === "string") {
    manifest.apiVersion = raw["apiVersion"]
  }
  if (
    raw["dependencies"] !== undefined &&
    typeof raw["dependencies"] === "object" &&
    !Array.isArray(raw["dependencies"])
  ) {
    manifest.dependencies = raw["dependencies"] as Record<string, string>
  }
  if (typeof raw["enabled"] === "boolean") {
    manifest.enabled = raw["enabled"]
  }
  const config = parseConfigSchema(raw["config"], fail)
  if (config) {
    manifest.config = config
  }
  return manifest
}

/**
 * 通用单文件 JS 插件管理器。
 *
 * 插件形态固定为「一个 js 文件」：本地安装读取该文件、网络安装下载该文件，
 * 校验导出字段通过后统一落成 `<插件目录>/<插件ID>/index.js`，同目录下还有：
 * - `state.json`：宿主维护的安装 / 启停状态
 * - `storage.json`：`ctx.storage` 持久化的插件私有数据
 *
 * 宿主通过泛型 `TApi` 声明「可以调用插件的哪些函数」，管理器不内置任何业务能力：
 * ```ts
 * interface SourceApi {
 *   search(keyword: string): Promise<Film[]>
 *   getDetail(id: string): Promise<Film>
 * }
 * const manager = new PluginManager<SourceApi>({
 *   directory: join(userData, "plugins"),
 *   methods: ["search", "getDetail"], // 可选：运行时白名单
 * })
 * await manager.init()
 * const films = await manager.call("fengchedongman", "search", "关键词")
 * ```
 */
export class PluginManager<TApi extends object = PluginApi> {
  /** 插件根目录 */
  readonly directory: string
  /** 宿主 API 版本 */
  readonly apiVersion = HOST_API_VERSION

  readonly #logger: PluginLogger
  readonly #methods?: ReadonlySet<string>
  readonly #allowRequire: readonly string[]
  readonly #modules: Readonly<Record<string, unknown>>
  readonly #allowCodeGeneration: boolean
  readonly #httpTimeout: number
  readonly #loadTimeout: number
  readonly #probeTimeout: number
  readonly #hookTimeout: number
  readonly #downloadTimeout: number
  readonly #events = new Emitter()
  readonly #records = new Map<string, PluginRecord<TApi>>()
  /** 各插件 state.json 的内存缓存（键为插件 ID） */
  readonly #states = new Map<string, PluginState>()
  /** 旧版「根目录统一 state.json」的一次性迁移数据 */
  #legacyState?: Record<string, boolean>
  #disposed = false

  constructor(options: PluginManagerOptions<TApi>) {
    if (!options || typeof options.directory !== "string" || options.directory.trim().length === 0) {
      throw new PluginError("INVALID_OPTION", "必须提供非空的 options.directory（插件根目录）")
    }
    this.directory = path.resolve(options.directory)
    this.#methods = options.methods ? new Set<string>(options.methods) : undefined
    this.#logger = options.logger ?? createPluginLogger("plugin-manager")
    this.#allowRequire = [...(options.allowRequire ?? [])]
    this.#modules = options.modules ?? {}
    this.#allowCodeGeneration = options.allowCodeGeneration === true
    this.#httpTimeout = options.httpTimeout ?? DEFAULT_HTTP_TIMEOUT
    this.#loadTimeout = options.loadTimeout ?? DEFAULT_LOAD_TIMEOUT
    this.#probeTimeout = options.probeTimeout ?? DEFAULT_PROBE_TIMEOUT
    this.#hookTimeout = options.hookTimeout ?? DEFAULT_HOOK_TIMEOUT
    this.#downloadTimeout = DEFAULT_DOWNLOAD_TIMEOUT
  }

  /* ------------------------------------------------------------------------ */
  /*                              生命周期                                      */
  /* ------------------------------------------------------------------------ */

  /** 确保目录存在并加载全部已启用的插件 */
  async init(): Promise<PluginInfo[]> {
    this.#assertNotDisposed()
    await mkdir(this.directory, { recursive: true })
    await this.discover()
    await this.loadAll()
    this.#events.emit("ready", this.list())
    return this.list()
  }

  /** 扫描插件目录下所有含 index.js 的子目录：读取其导出字段（含校验），但暂不加载 */
  async discover(): Promise<PluginInfo[]> {
    this.#assertNotDisposed()
    await mkdir(this.directory, { recursive: true })
    await this.#loadLegacyState()
    const entries = await readdir(this.directory, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }
      const dirPath = path.join(this.directory, entry.name)
      const entryPath = path.join(dirPath, PLUGIN_ENTRY_FILE)
      let code: string
      try {
        code = await readFile(entryPath, "utf8")
      } catch {
        this.#markInvalid(`invalid:${entry.name}`, dirPath, `插件目录缺少入口文件 ${PLUGIN_ENTRY_FILE}`)
        continue
      }
      try {
        const { manifest } = this.#probe(code, entryPath, dirPath)
        const existing = this.#records.get(manifest.id)
        if (existing) {
          if (existing.directory !== dirPath) {
            this.#logger.warn(`插件 ID "${manifest.id}" 重复（${existing.directory} 与 ${dirPath}），已忽略后者`)
          }
          continue
        }
        if (manifest.apiVersion && !satisfiesRange(HOST_API_VERSION, manifest.apiVersion)) {
          this.#records.set(manifest.id, {
            manifest,
            directory: dirPath,
            status: "error",
            error: `插件要求宿主 API ${manifest.apiVersion}，当前宿主为 ${HOST_API_VERSION}`,
          })
          continue
        }
        this.#records.set(manifest.id, { manifest, directory: dirPath, status: "discovered" })
        const state = await this.#readPluginState(dirPath)
        if (state) {
          this.#states.set(manifest.id, state)
        } else {
          await this.#applyLegacyState(dirPath, manifest)
        }
      } catch (error) {
        this.#markInvalid(`invalid:${entry.name}`, dirPath, error)
      }
    }
    await this.#retireLegacyState()
    return this.list()
  }

  /** 加载并激活全部「已启用」的插件，单个失败不影响其它插件 */
  async loadAll(): Promise<PluginInfo[]> {
    this.#assertNotDisposed()
    for (const record of this.#records.values()) {
      if (record.status !== "discovered" || !this.#isEnabled(record)) {
        continue
      }
      try {
        await this.#loadRecord(record, new Set())
      } catch {
        // 单个插件失败不影响其它插件，错误已记录到 record.error 并发出 error 事件
      }
    }
    return this.list()
  }

  /** 加载并激活指定插件（接受插件 ID 或插件目录路径），不改变持久化状态 */
  async load(idOrDirectory: string): Promise<PluginInfo> {
    this.#assertNotDisposed()
    const record = await this.#resolveRecord(idOrDirectory)
    return this.#loadRecord(record, new Set())
  }

  /** 调用 `deactivate` 并销毁沙箱（保留清单快照） */
  async unload(id: string): Promise<void> {
    const record = this.#requireRecord(id)
    if (!isLoadedStatus(record.status)) {
      throw new PluginError("PLUGIN_NOT_LOADED", `插件 "${id}" 尚未加载`, {
        pluginId: id,
      })
    }
    await this.#teardown(record)
    this.#events.emit("unloaded", this.#snapshot(record)!)
  }

  /** 加载并激活，同时把启停状态持久化为「启用」 */
  async enable(id: string): Promise<PluginInfo> {
    const record = this.#requireRecord(id)
    await this.#setEnabled(record, true)
    if (record.status !== "active") {
      await this.#loadRecord(record, new Set())
    }
    this.#events.emit("enabled", this.#snapshot(record)!)
    return this.#snapshot(record)!
  }

  /** 销毁沙箱，把启停状态持久化为「禁用」 */
  async disable(id: string): Promise<void> {
    const record = this.#requireRecord(id)
    await this.#setEnabled(record, false)
    if (isLoadedStatus(record.status)) {
      await this.#teardown(record)
      record.status = "inactive"
    }
    this.#events.emit("disabled", this.#snapshot(record)!)
  }

  /** 重新加载指定插件（会重新读取 index.js 的导出字段） */
  async reload(id: string): Promise<PluginInfo> {
    const record = this.#requireRecord(id)
    const wasLoaded = isLoadedStatus(record.status)
    try {
      const entryPath = path.join(record.directory, PLUGIN_ENTRY_FILE)
      const code = await readFile(entryPath, "utf8")
      const { manifest } = this.#probe(code, entryPath, record.directory)
      if (manifest.id !== id) {
        throw new PluginError(
          "INVALID_MANIFEST",
          `重新加载后插件 ID 由 "${id}" 变为 "${manifest.id}"，请改用 uninstall + install`,
          { pluginId: id },
        )
      }
      record.manifest = manifest
      record.error = undefined
    } catch (error) {
      const pluginError = toPluginError(error, "INVALID_MANIFEST", id)
      record.status = "error"
      record.error = pluginError.message
      this.#events.emit("error", pluginError)
      throw pluginError
    }
    if (wasLoaded) {
      await this.#teardown(record)
    }
    await this.#loadRecord(record, new Set())
    this.#events.emit("reloaded", this.#snapshot(record)!)
    return this.#snapshot(record)!
  }

  /* ------------------------------------------------------------------------ */
  /*                                 安装                                       */
  /* ------------------------------------------------------------------------ */

  /**
   * 安装插件：本地 js 文件路径或 http(s) 下载地址都会被归一成同一份源码，
   * 校验导出字段（id / name / version / apiVersion …）通过后才写入
   * `<插件目录>/<插件ID>/index.js`；任一项不满足都直接抛 `INSTALL_FAILED`。
   */
  async install(source: string, options?: PluginInstallOptions): Promise<PluginInfo> {
    this.#assertNotDisposed()
    if (typeof source !== "string" || source.trim().length === 0) {
      throw new PluginError("INVALID_OPTION", "需要提供插件 js 文件路径或下载地址")
    }
    const trimmed = source.trim()
    if (/^https?:\/\//i.test(trimmed)) {
      return this.installUrl(trimmed, options)
    }
    return this.installFile(trimmed, options)
  }

  /** 从本地 js 文件安装（传入目录时读取该目录下的 index.js） */
  async installFile(filePath: string, options?: PluginInstallOptions): Promise<PluginInfo> {
    this.#assertNotDisposed()
    const resolved = path.resolve(filePath)
    let target = resolved
    try {
      if ((await stat(resolved)).isDirectory()) {
        target = path.join(resolved, PLUGIN_ENTRY_FILE)
      }
    } catch {
      throw new PluginError("PLUGIN_NOT_FOUND", `找不到插件文件：${filePath}`)
    }
    let code: string
    try {
      code = await readFile(target, "utf8")
    } catch (error) {
      throw new PluginError("ENTRY_NOT_FOUND", `无法读取插件文件：${target}`, { cause: error })
    }
    return this.#installCode(code, options, target)
  }

  /** 下载单个 js 文件并安装 */
  async installUrl(url: string, options?: PluginInstallOptions): Promise<PluginInfo> {
    this.#assertNotDisposed()
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new PluginError("INVALID_OPTION", `下载地址无效：${url}`)
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new PluginError("INVALID_OPTION", "仅允许 http(s) 协议的下载地址")
    }

    const timeout = this.#downloadTimeout
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    let code: string
    try {
      const response = await fetch(parsed, { signal: controller.signal })
      if (!response.ok) {
        throw new PluginError("INSTALL_FAILED", `下载失败：HTTP ${response.status} ${String(parsed)}`)
      }
      const declared = Number(response.headers.get("content-length"))
      if (Number.isFinite(declared) && declared > MAX_SOURCE_BYTES) {
        throw new PluginError("INVALID_OPTION", `插件文件超过 ${MAX_SOURCE_BYTES / 1024 / 1024}MB 限制`)
      }
      code = await response.text()
    } catch (error) {
      if (error instanceof PluginError) {
        throw error
      }
      if (controller.signal.aborted) {
        throw new PluginError("INSTALL_FAILED", `下载插件超过 ${timeout}ms 未完成：${String(parsed)}`)
      }
      throw new PluginError("INSTALL_FAILED", `下载插件失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      clearTimeout(timer)
    }
    return this.#installCode(code, options, String(parsed))
  }

  /** 直接以源码字符串安装（本地文件与网络下载最终都汇入这里） */
  async installCode(code: string, options?: PluginInstallOptions, origin?: string): Promise<PluginInfo> {
    this.#assertNotDisposed()
    if (typeof code !== "string") {
      throw new PluginError("INVALID_OPTION", "插件源码必须是字符串")
    }
    return this.#installCode(code, options, origin)
  }

  /** 从插件目录移除插件，连同其 state.json 与 storage.json */
  async uninstall(id: string): Promise<void> {
    const record = this.#requireRecord(id)
    const snapshot = this.#snapshot(record)!
    if (isLoadedStatus(record.status)) {
      await this.#teardown(record)
    }
    await rm(record.directory, { recursive: true, force: true })
    this.#records.delete(id)
    this.#states.delete(id)
    this.#events.emit("unloaded", snapshot)
  }

  /** 卸载全部插件并落盘数据 */
  async dispose(): Promise<void> {
    if (this.#disposed) {
      return
    }
    this.#disposed = true
    for (const record of this.#records.values()) {
      if (isLoadedStatus(record.status)) {
        await this.#teardown(record)
      }
    }
    this.#events.clear()
  }

  /* ------------------------------------------------------------------------ */
  /*                              查询与调用                                    */
  /* ------------------------------------------------------------------------ */

  /** 读取插件快照 */
  get(id: string): PluginInfo | undefined {
    return this.#snapshot(this.#records.get(id))
  }

  /** 全部插件快照（含未加载 / 出错的插件） */
  list(): PluginInfo[] {
    return [...this.#records.values()]
      .sort((a, b) => a.manifest.id.localeCompare(b.manifest.id))
      .map((record) => this.#snapshot(record)!)
  }

  /** `list()` 的别名 */
  getPlugins(): PluginInfo[] {
    return this.list()
  }

  /**
   * 取已激活插件的可调用方法集合（宿主泛型 `TApi` 声明的形状）。
   * 插件未激活时返回 undefined。
   */
  getApi(id: string): Readonly<TApi> | undefined {
    const record = this.#records.get(id)
    return record?.status === "active" ? record.api : undefined
  }

  /** 判断某个插件是否实现了指定方法 */
  hasMethod(id: string, method: string): boolean {
    const api = this.getApi(id) as Record<string, unknown> | undefined
    return typeof api?.[method] === "function"
  }

  /**
   * 调用插件实现的方法（类型由宿主泛型 `TApi` 提供）。
   * 插件未激活、方法未实现，或方法名不在 `options.methods` 白名单内都会抛错。
   */
  async call<K extends ApiMethodKey<TApi>>(
    pluginId: string,
    method: K,
    ...args: ApiArgs<TApi, K>
  ): Promise<Awaited<ApiResult<TApi, K>>> {
    return (await this.invoke(pluginId, method, args as unknown[])) as Awaited<ApiResult<TApi, K>>
  }

  /**
   * `call` 的无类型版本：方法名与参数都在运行时传入，供 IPC / 动态调用使用。
   * 仍然受 `options.methods` 白名单与调用超时约束。
   */
  async invoke(pluginId: string, method: string, args: readonly unknown[] = []): Promise<unknown> {
    this.#assertNotDisposed()
    if (typeof method !== "string" || method.length === 0) {
      throw new PluginError("INVALID_OPTION", "需要提供要调用的方法名")
    }
    const record = this.#requireRecord(pluginId)
    if (record.status !== "active" || !record.api) {
      throw new PluginError("PLUGIN_NOT_LOADED", `插件 "${pluginId}" 未激活，无法调用 ${method}`, {
        pluginId,
      })
    }
    if (this.#methods && !this.#methods.has(method)) {
      throw new PluginError("METHOD_NOT_FOUND", `宿主未声明可调用的方法 "${method}"`, { pluginId })
    }
    const fn = (record.api as Record<string, unknown>)[method]
    if (typeof fn !== "function") {
      throw new PluginError("METHOD_NOT_FOUND", `插件 "${pluginId}" 未实现 ${method} 方法`, { pluginId })
    }
    const target = fn as (...callArgs: unknown[]) => unknown
    return withTimeout(
      Promise.resolve(target.apply(record.api, [...args])),
      this.#hookTimeout,
      "HOOK_TIMEOUT",
      pluginId,
    )
  }

  /* ------------------------------------------------------------------------ */
  /*                                 配置                                      */
  /* ------------------------------------------------------------------------ */

  /** 插件声明的配置项 schema（`manifest.config`），未声明时返回空数组 */
  getConfigSchema(id: string): PluginConfigField[] {
    const record = this.#requireRecord(id)
    return (record.manifest.config ?? []).map((field) => ({ ...field }))
  }

  /** 读取插件配置：配置项 schema + 当前值（config.json 与 schema 默认值合并的结果） */
  async getConfig(id: string): Promise<PluginConfigSnapshot> {
    const record = this.#requireRecord(id)
    return {
      schema: record.manifest.config ?? [],
      values: await this.#loadConfigValues(record),
    }
  }

  /**
   * 局部更新插件配置。
   *
   * - 值会被校验（类型 / 范围 / select 取值 / 必填），不合法直接抛 `INVALID_CONFIG`；
   * - 报错时不会写盘，config.json 保持原样；
   * - 传 `undefined` / `null` / 空串表示清空该配置项（必填项不允许清空）；
   * - 默认会重载插件让新值生效；重载失败不回滚配置，错误体现在插件状态上。
   */
  async updateConfig(
    id: string,
    patch: Record<string, PluginConfigValue | undefined>,
    options?: PluginConfigUpdateOptions,
  ): Promise<PluginInfo> {
    this.#assertNotDisposed()
    const record = this.#requireRecord(id)
    if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
      throw new PluginError("INVALID_OPTION", "配置更新内容必须是对象", { pluginId: id })
    }
    const schema = record.manifest.config ?? []
    const stored = await readConfigValues(this.#configFile(record))
    const merged: Record<string, unknown> = { ...stored }
    for (const [key, value] of Object.entries(patch)) {
      merged[key] = value ?? ""
    }
    const next = normalizeConfigValues(schema, merged, id)
    await writeConfigValues(this.#configFile(record), next)

    if (options?.reload !== false && isLoadedStatus(record.status)) {
      const wasActive = record.status === "active"
      try {
        if (wasActive) {
          await this.reload(id)
        }
      } catch (error) {
        // 配置已保存，重载失败只记录原因（record.status 已置为 error）
        this.#logger.warn(`[${id}] 保存配置后重载失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return this.#snapshot(record)!
  }

  /**
   * 把配置恢复为 schema 声明的默认值（清空用户填写的值）。
   * 与 `updateConfig` 不同：这里跳过必填校验——重置本身就是「回到未配置状态」的明确意图。
   */
  async resetConfig(id: string, options?: PluginConfigUpdateOptions): Promise<PluginInfo> {
    const record = this.#requireRecord(id)
    await writeConfigValues(this.#configFile(record), defaultConfigValues(record.manifest.config ?? []))
    if (options?.reload !== false && record.status === "active") {
      try {
        await this.reload(id)
      } catch (error) {
        this.#logger.warn(`[${id}] 重置配置后重载失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return this.#snapshot(record)!
  }

  /* ------------------------------------------------------------------------ */
  /*                                 事件                                      */
  /* ------------------------------------------------------------------------ */

  /** 监听管理器事件，返回取消监听函数 */
  on(event: "ready", handler: (plugins: PluginInfo[]) => void): () => void
  on(
    event: "loaded" | "unloaded" | "enabled" | "disabled" | "reloaded",
    handler: (info: PluginInfo) => void,
  ): () => void
  on(event: "error", handler: (error: PluginError) => void): () => void
  on(event: string, handler: (...args: any[]) => void): () => void
  on(event: string, handler: (...args: any[]) => void): () => void {
    return this.#events.on(event, handler)
  }

  /** 移除事件监听 */
  off(event: string, handler: (...args: any[]) => void): void {
    this.#events.off(event, handler)
  }

  /* ------------------------------------------------------------------------ */
  /*                               内部实现                                     */
  /* ------------------------------------------------------------------------ */

  #assertNotDisposed(): void {
    if (this.#disposed) {
      throw new PluginError("INVALID_OPTION", "PluginManager 已 dispose，不能再使用")
    }
  }

  #requireRecord(id: string): PluginRecord<TApi> {
    const record = this.#records.get(id)
    if (!record) {
      throw new PluginError("PLUGIN_NOT_FOUND", `插件 "${id}" 不存在`, {
        pluginId: id,
      })
    }
    return record
  }

  #snapshot(record: PluginRecord<TApi> | undefined): PluginInfo | undefined {
    if (!record) {
      return undefined
    }
    const info: PluginInfo = {
      manifest: Object.freeze({ ...record.manifest }),
      status: record.status,
      directory: record.directory,
    }
    if (record.entry !== undefined) {
      info.entry = record.entry
    }
    const state = this.#states.get(record.manifest.id)
    if (state) {
      info.state = Object.freeze({ ...state })
    }
    if (record.error !== undefined) {
      info.error = record.error
    }
    return info
  }

  /** 把一个无效的插件目录登记为 error 状态 */
  #markInvalid(key: string, directory: string, error: unknown): void {
    const pluginError = toPluginError(error, "INVALID_MANIFEST")
    this.#records.set(key, {
      manifest: { id: key, name: path.basename(directory), version: "0.0.0" },
      directory,
      status: "error",
      error: pluginError.message,
    })
    this.#events.emit("error", pluginError)
  }

  /** 插件配置文件路径（<插件目录>/config.json） */
  #configFile(record: PluginRecord<TApi>): string {
    return path.join(record.directory, PLUGIN_CONFIG_FILE)
  }

  /** 读取 config.json 并与 schema 默认值合并（宽松：不做必填校验，脏值回落默认值） */
  async #loadConfigValues(record: PluginRecord<TApi>): Promise<Record<string, PluginConfigValue>> {
    const schema = record.manifest.config ?? []
    if (schema.length === 0) {
      return {}
    }
    return mergeConfigValues(schema, await readConfigValues(this.#configFile(record)), record.manifest.id)
  }

  /**
   * 安装 / 升级后补齐 config.json：保留用户已填写的值，
   * 仅把新版本新增的配置项写为默认值（降低直接编辑文件的成本）。
   */
  async #ensureConfigFile(record: PluginRecord<TApi>): Promise<void> {
    const schema = record.manifest.config ?? []
    if (schema.length === 0) {
      return
    }
    const file = this.#configFile(record)
    const stored = await readConfigValues(file)
    const next = mergeConfigValues(schema, stored, record.manifest.id)
    if (JSON.stringify(stored) === JSON.stringify(next) && (await exists(file))) {
      return
    }
    await writeConfigValues(file, next)
  }

  /* ---------------------------- 安装流程 ---------------------------------- */

  async #installCode(code: string, options?: PluginInstallOptions, origin?: string): Promise<PluginInfo> {
    const { overwrite = true, activate = true } = options ?? {}
    const bytes = Buffer.byteLength(code, "utf8")
    if (bytes > MAX_SOURCE_BYTES) {
      throw new PluginError("INVALID_OPTION", `插件文件超过 ${MAX_SOURCE_BYTES / 1024 / 1024}MB 限制`)
    }
    if (code.trim().length === 0) {
      throw new PluginError("INVALID_MANIFEST", "插件文件内容为空")
    }

    // 1) 在受限沙箱里跑一遍：读取导出字段并校验，不满足即安装失败
    let manifest: PluginManifest
    try {
      manifest = this.#probe(code, origin ?? "<memory>", this.directory).manifest
    } catch (error) {
      throw this.#installFailure(error)
    }
    if (manifest.apiVersion && !satisfiesRange(HOST_API_VERSION, manifest.apiVersion)) {
      throw this.#installFailure(
        new PluginError("INCOMPATIBLE_API", `插件要求宿主 API ${manifest.apiVersion}，当前宿主为 ${HOST_API_VERSION}`, {
          pluginId: manifest.id,
        }),
      )
    }

    // 2) 校验通过：目标目录固定为 <插件根目录>/<插件ID>
    const targetDir = path.join(this.directory, manifest.id)
    const existed = await exists(targetDir)
    if (existed && !overwrite) {
      throw this.#installFailure(
        new PluginError("INVALID_OPTION", `插件 "${manifest.id}" 已安装且未允许覆盖`, { pluginId: manifest.id }),
      )
    }

    const existing = this.#records.get(manifest.id)
    if (existing && isLoadedStatus(existing.status)) {
      await this.#teardown(existing)
    }

    const entryPath = path.join(targetDir, PLUGIN_ENTRY_FILE)
    const previous = existed ? await readFile(entryPath, "utf8").catch(() => undefined) : undefined
    let written = false
    try {
      await mkdir(targetDir, { recursive: true })
      await writeAtomic(entryPath, code)
      written = true
      await this.#touchPluginState(targetDir, manifest, origin)
      let record = this.#records.get(manifest.id)
      if (!record) {
        record = { manifest, directory: targetDir, status: "discovered" }
        this.#records.set(manifest.id, record)
      } else {
        record.manifest = manifest
        record.directory = targetDir
        record.status = "discovered"
        record.error = undefined
        record.entry = undefined
        record.api = undefined
      }

      // 补齐 config.json：保留已填的值，新增配置项写入默认值
      await this.#ensureConfigFile(record)

      if (activate) {
        await this.#setEnabled(record, true)
        await this.#loadRecord(record, new Set())
      }
      this.#logger.info(`[${manifest.id}] 插件已安装：v${manifest.version} → ${targetDir}`)
      return this.#snapshot(record)!
    } catch (error) {
      // 安装失败不留半成品：新建目录直接删除，覆盖安装则回滚旧代码（数据文件保留）
      if (written) {
        if (previous !== undefined) {
          await writeAtomic(entryPath, previous).catch(() => {})
        } else {
          await rm(targetDir, { recursive: true, force: true }).catch(() => {})
        }
      }
      const pluginError = this.#installFailure(error, manifest.id)
      this.#logger.error(pluginError.message)
      this.#events.emit("error", pluginError)
      throw pluginError
    }
  }

  /** 统一把安装过程中的错误包装为带「插件安装失败」前缀的 INSTALL_FAILED */
  #installFailure(error: unknown, pluginId?: string): PluginError {
    const pluginError = toPluginError(error, "INSTALL_FAILED", pluginId)
    return new PluginError("INSTALL_FAILED", `插件安装失败：${pluginError.message}`, {
      pluginId: pluginError.pluginId ?? pluginId,
      cause: error,
    })
  }

  /* ---------------------------- 状态文件 ---------------------------------- */

  async #readPluginState(directory: string): Promise<PluginState | undefined> {
    try {
      const parsed: unknown = JSON.parse(await readFile(path.join(directory, PLUGIN_STATE_FILE), "utf8"))
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        const draft = parsed as Partial<PluginState>
        if (typeof draft.id === "string" && draft.id.length > 0) {
          return { ...draft, id: draft.id, enabled: draft.enabled !== false } as PluginState
        }
      }
    } catch {
      // 无状态文件（或损坏）时按默认状态处理
    }
    return undefined
  }

  async #writePluginState(directory: string, state: PluginState): Promise<void> {
    await mkdir(directory, { recursive: true })
    await writeAtomic(path.join(directory, PLUGIN_STATE_FILE), JSON.stringify(state, null, 2))
  }

  /** 写入 / 更新安装状态（首次安装记录 installedAt，覆盖安装保留数据与启停偏好） */
  async #touchPluginState(directory: string, manifest: PluginManifest, origin?: string): Promise<void> {
    const now = new Date().toISOString()
    const existing = await this.#readPluginState(directory)
    const state: PluginState = {
      id: manifest.id,
      version: manifest.version,
      enabled: existing?.enabled ?? manifest.enabled !== false,
      installedAt: existing?.installedAt ?? now,
      updatedAt: now,
    }
    if (origin !== undefined) {
      state.source = origin
    }
    this.#states.set(manifest.id, state)
    await this.#writePluginState(directory, state)
  }

  #isEnabled(record: PluginRecord<TApi>): boolean {
    const state = this.#states.get(record.manifest.id)
    if (state && typeof state.enabled === "boolean") {
      return state.enabled
    }
    return record.manifest.enabled !== false
  }

  async #setEnabled(record: PluginRecord<TApi>, enabled: boolean): Promise<void> {
    const id = record.manifest.id
    const current = this.#states.get(id) ?? (await this.#readPluginState(record.directory))
    if (current?.enabled === enabled) {
      if (current) {
        this.#states.set(id, current)
      }
      return
    }
    const now = new Date().toISOString()
    const next: PluginState = {
      id,
      version: record.manifest.version,
      enabled,
      installedAt: current?.installedAt ?? now,
      updatedAt: now,
    }
    if (current?.source !== undefined) {
      next.source = current.source
    }
    this.#states.set(id, next)
    await this.#writePluginState(record.directory, next).catch((error) => {
      this.#logger.error(`[${id}] 持久化启停状态失败：${error instanceof Error ? error.message : String(error)}`)
    })
  }

  /** 读取旧版「根目录统一 state.json」，供 discover 阶段迁移到各插件目录 */
  async #loadLegacyState(): Promise<void> {
    if (this.#legacyState !== undefined || (await exists(path.join(this.directory, PLUGIN_STATE_FILE))) === false) {
      return
    }
    try {
      const parsed: unknown = JSON.parse(await readFile(path.join(this.directory, PLUGIN_STATE_FILE), "utf8"))
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        const state: Record<string, boolean> = {}
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof value === "boolean") {
            state[key] = value
          }
        }
        this.#legacyState = state
      }
    } catch {
      // 根目录没有旧状态文件（正常情况）
    }
  }

  /** 旧状态迁移：为缺失 state.json 的插件补写一份 */
  async #applyLegacyState(directory: string, manifest: PluginManifest): Promise<void> {
    const enabled = this.#legacyState?.[manifest.id]
    if (enabled === undefined) {
      return
    }
    const now = new Date().toISOString()
    const state: PluginState = {
      id: manifest.id,
      version: manifest.version,
      enabled,
      installedAt: now,
      updatedAt: now,
    }
    this.#states.set(manifest.id, state)
    await this.#writePluginState(directory, state).catch(() => {})
  }

  /** 迁移完成后删除根目录的旧状态文件 */
  async #retireLegacyState(): Promise<void> {
    if (this.#legacyState === undefined) {
      return
    }
    this.#legacyState = undefined
    await rm(path.join(this.directory, PLUGIN_STATE_FILE), { force: true }).catch(() => {})
  }

  /* ------------------------------ 加载 ------------------------------------ */

  /**
   * 在受限沙箱中执行插件代码，只用于读取导出字段：不授予网络能力，
   * 也不触发任何钩子。正式加载时会再执行一次 index.js，因此插件顶层不要写副作用。
   */
  #probe(
    code: string,
    filename: string,
    directory: string,
  ): { manifest: PluginManifest; exports: Record<string, unknown> } {
    const hint = path.basename(directory)
    const handle = runPluginModule({
      pluginId: hint,
      code,
      filename,
      directory,
      allowRequire: this.#allowRequire,
      modules: this.#modules,
      allowCodeGeneration: this.#allowCodeGeneration,
      timeout: this.#probeTimeout,
      logger: noopLogger,
      http: probeHttp,
    })
    try {
      const exportsValue = handle.exports
      return { manifest: parseManifest(exportsValue, hint), exports: exportsValue }
    } finally {
      handle.dispose()
    }
  }

  /** 解析插件 ID 或插件目录路径为插件记录 */
  async #resolveRecord(idOrDirectory: string): Promise<PluginRecord<TApi>> {
    const existing = this.#records.get(idOrDirectory)
    if (existing) {
      return existing
    }
    const candidate = path.isAbsolute(idOrDirectory) ? idOrDirectory : path.resolve(this.directory, idOrDirectory)
    try {
      if (!(await stat(candidate)).isDirectory()) {
        throw new Error("不是目录")
      }
    } catch {
      throw new PluginError("PLUGIN_NOT_FOUND", `找不到插件 "${idOrDirectory}"`, {
        pluginId: idOrDirectory,
      })
    }
    const entryPath = path.join(candidate, PLUGIN_ENTRY_FILE)
    let manifest: PluginManifest
    try {
      manifest = this.#probe(await readFile(entryPath, "utf8"), entryPath, candidate).manifest
    } catch (error) {
      throw toPluginError(error, "INVALID_MANIFEST")
    }
    const clash = this.#records.get(manifest.id)
    if (clash) {
      if (clash.directory === candidate) {
        return clash
      }
      throw new PluginError("INVALID_MANIFEST", `插件 ID "${manifest.id}" 已被 ${clash.directory} 占用`, {
        pluginId: manifest.id,
      })
    }
    const record: PluginRecord<TApi> = { manifest, directory: candidate, status: "discovered" }
    this.#records.set(manifest.id, record)
    return record
  }

  /** 加载单个插件（含依赖拓扑排序、沙箱执行与 activate 钩子） */
  async #loadRecord(record: PluginRecord<TApi>, visiting: Set<string>): Promise<PluginInfo> {
    const id = record.manifest.id
    if (record.status === "active" || record.status === "loading") {
      return this.#snapshot(record)!
    }
    if (visiting.has(id)) {
      throw new PluginError("DEPENDENCY_MISSING", `检测到循环依赖：${[...visiting, id].join(" -> ")}`, { pluginId: id })
    }
    visiting.add(id)

    // 先加载依赖（依赖插件即使被禁用也需要加载，否则依赖方无法工作）
    for (const [depId, range] of Object.entries(record.manifest.dependencies ?? {})) {
      const dep = this.#records.get(depId)
      if (!dep) {
        throw new PluginError("DEPENDENCY_MISSING", `缺少依赖插件 "${depId}"`, {
          pluginId: id,
        })
      }
      if (!satisfiesRange(dep.manifest.version, range)) {
        throw new PluginError(
          "DEPENDENCY_MISSING",
          `依赖插件 "${depId}" 版本 ${dep.manifest.version} 不满足要求 ${range}`,
          { pluginId: id },
        )
      }
      if (dep.status !== "active") {
        try {
          await this.#loadRecord(dep, visiting)
        } catch (error) {
          throw toPluginError(error, "DEPENDENCY_MISSING", id)
        }
      }
    }

    record.status = "loading"
    record.error = undefined
    try {
      // 单文件插件的入口固定为 <插件目录>/index.js
      const entryPath = path.join(record.directory, PLUGIN_ENTRY_FILE)
      let code: string
      try {
        code = await readFile(entryPath, "utf8")
      } catch (error) {
        throw new PluginError("ENTRY_NOT_FOUND", `入口文件不存在：${entryPath}`, { pluginId: id, cause: error })
      }
      record.entry = entryPath

      // 初始化存储、配置与沙箱：数据 json 与 state.json 同处插件目录内
      record.storage = await PluginStorageImpl.load(path.join(record.directory, PLUGIN_STORAGE_FILE))
      await this.#ensureConfigFile(record)
      record.config = await this.#loadConfigValues(record)
      const bus = new Emitter()
      const http = this.#createHttp(id)
      const context = this.#createContext(record, record.storage, record.config ?? {}, http, bus)
      record.sandbox = runPluginModule({
        pluginId: id,
        code,
        filename: entryPath,
        directory: record.directory,
        allowRequire: this.#allowRequire,
        modules: this.#modules,
        allowCodeGeneration: this.#allowCodeGeneration,
        timeout: this.#loadTimeout,
        logger: createPluginLogger(id),
        http,
      })
      const exportsValue = record.sandbox.exports
      record.module = normalizeModule<TApi>(exportsValue, id)

      // 复核导出字段，避免磁盘上的 index.js 被改动后出现 ID 漂移
      const fresh = parseManifest(exportsValue, id)
      if (fresh.id !== id) {
        throw new PluginError("INVALID_MANIFEST", `插件 ID 由 "${id}" 变为 "${fresh.id}"，请重新安装`, {
          pluginId: id,
        })
      }
      record.manifest = fresh

      // 解析可调用方法：优先 module.exports.api，其次 module.exports 本身
      record.api = resolveApi<TApi>(record.module)
      this.#warnIfNoDeclaredMethod(record)

      // 调用 activate 钩子
      if (typeof record.module.activate === "function") {
        await withTimeout(Promise.resolve(record.module.activate(context)), this.#hookTimeout, "HOOK_TIMEOUT", id)
      }

      record.status = "active"
      this.#logger.info(`[${id}] 插件已加载（v${record.manifest.version}）`)
      this.#events.emit("loaded", this.#snapshot(record)!)
    } catch (error) {
      record.status = "error"
      record.error = error instanceof Error ? error.message : String(error)
      record.api = undefined
      record.module = undefined
      record.config = undefined
      record.sandbox?.dispose()
      record.sandbox = undefined
      record.entry = undefined
      await record.storage?.dispose().catch(() => {})
      record.storage = undefined
      const pluginError = toPluginError(error, "LOAD_FAILED", id)
      this.#logger.error(`[${id}] 加载失败：${pluginError.message}`)
      this.#events.emit("error", pluginError)
      throw pluginError
    }
    return this.#snapshot(record)!
  }

  /** 插件实现的方法一个都不在宿主声明范围内时给出提示 */
  #warnIfNoDeclaredMethod(record: PluginRecord<TApi>): void {
    if (!this.#methods) {
      return
    }
    const api = record.api as Record<string, unknown> | undefined
    const implemented = [...this.#methods].filter((name) => typeof api?.[name] === "function")
    if (implemented.length === 0) {
      this.#logger.warn(`[${record.manifest.id}] 插件未实现任何宿主声明的方法（${[...this.#methods].join(", ")}）`)
    }
  }

  /** 调用 deactivate 并销毁沙箱（清单快照保留） */
  async #teardown(record: PluginRecord<TApi>): Promise<void> {
    const id = record.manifest.id
    record.api = undefined
    if (typeof record.module?.deactivate === "function") {
      try {
        await withTimeout(Promise.resolve(record.module.deactivate()), this.#hookTimeout, "HOOK_TIMEOUT", id)
      } catch (error) {
        const pluginError = toPluginError(error, "HOOK_FAILED", id)
        this.#logger.warn(`[${id}] deactivate 失败：${pluginError.message}`)
        this.#events.emit("error", pluginError)
      }
    }
    record.module = undefined
    record.config = undefined
    record.sandbox?.dispose()
    record.sandbox = undefined
    record.entry = undefined
    await record.storage?.dispose().catch(() => {})
    record.storage = undefined
    record.status = "discovered"
  }

  /** 组装注入给插件的上下文（所有插件能力一致，无需声明权限） */
  #createContext(
    record: PluginRecord<TApi>,
    storage: PluginStorage,
    config: Record<string, PluginConfigValue>,
    http: PluginHttp,
    events: PluginEvents,
  ): PluginContext {
    const id = record.manifest.id
    return {
      manifest: Object.freeze({ ...record.manifest }),
      apiVersion: HOST_API_VERSION,
      logger: createPluginLogger(id),
      storage,
      config: createConfigView(config, id),
      http,
      events,
      getPlugin: (pluginId: string) => this.get(pluginId),
      reload: async () => {
        await this.reload(id)
      },
    }
  }

  /** 创建带超时与外部取消信号的请求能力 */
  #createHttp(pluginId: string): PluginHttp {
    const request = async (url: string, init?: PluginHttpInit): Promise<Response> => {
      const timeout = init?.timeout ?? this.#httpTimeout
      const externalSignal = init?.signal
      const controller = new AbortController()
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeout)
      const onExternalAbort = () => controller.abort(externalSignal?.reason)
      externalSignal?.addEventListener("abort", onExternalAbort, {
        once: true,
      })
      try {
        return await fetch(url, {
          method: init?.method,
          headers: init?.headers,
          // lib.dom 的 BufferSource 要求非共享的 ArrayBufferView<ArrayBuffer>，
          // 而 Uint8Array 默认参数化为 ArrayBufferLike，此处需要收窄断言
          body: init?.body as BodyInit | undefined,
          signal: controller.signal,
        })
      } catch (error) {
        if (timedOut) {
          throw new PluginError("HOOK_TIMEOUT", `请求超过 ${timeout}ms 未完成`, {
            pluginId,
            cause: error,
          })
        }
        throw error
      } finally {
        clearTimeout(timer)
        externalSignal?.removeEventListener("abort", onExternalAbort)
      }
    }
    return {
      request,
      text: async (url, init) => {
        const response = await request(url, init)
        return response.text()
      },
      json: async <T>(url: string, init?: PluginHttpInit) => {
        const response = await request(url, init)
        return (await response.json()) as T
      },
    }
  }
}

/** 校验并规整插件入口导出对象 */
function normalizeModule<TApi extends object>(
  exportsValue: Record<string, unknown>,
  pluginId: string,
): PluginModule<TApi> {
  if (!exportsValue || typeof exportsValue !== "object") {
    return {} as PluginModule<TApi>
  }
  const api = exportsValue["api"]
  if (api !== undefined && (typeof api !== "object" || api === null || Array.isArray(api))) {
    throw new PluginError("INVALID_MANIFEST", "module.exports.api 必须是对象", { pluginId })
  }
  return exportsValue as PluginModule<TApi>
}

/**
 * 解析插件可调用的方法集合：
 * 优先 `module.exports.api`，否则直接用 `module.exports` 本身（方法平铺写法）。
 */
function resolveApi<TApi extends object>(moduleValue: PluginModule<TApi>): TApi {
  const grouped = moduleValue["api"]
  if (grouped && typeof grouped === "object" && !Array.isArray(grouped)) {
    return grouped as TApi
  }
  return moduleValue as unknown as TApi
}
