import type { PluginError } from "./errors.ts"

/* -------------------------------------------------------------------------- */
/*                                   清单                                      */
/* -------------------------------------------------------------------------- */

/**
 * 插件清单。
 *
 * 单文件插件没有 `manifest.json`，全部元信息来自插件 `index.js` 的导出字段：
 * 既可以平铺在 `module.exports` 上，也可以集中写在 `module.exports.manifest` 里。
 * 缺少 `id` / `name` / `version` 中任意一项，安装会被直接拒绝。
 */
export interface PluginManifest {
  /** 全局唯一 ID（建议 kebab-case），同时作为插件目录名 / 状态记录的主键 */
  id: string
  /** 展示名称 */
  name: string
  /** 语义化版本号，如 `1.2.0` */
  version: string
  /** 简介 */
  description?: string
  /** 作者 */
  author?: string
  /** 主页 / 仓库地址 */
  homepage?: string
  /** 图标，插件目录内的相对路径或 http(s) 地址 */
  icon?: string
  /** 依赖的宿主 API 版本（支持 `^1.0.0`、`>=1.0.0`、`1.x` 等写法） */
  apiVersion?: string
  /** 依赖的其他插件：`{ [pluginId]: 版本范围 }` */
  dependencies?: Record<string, string>
  /** 默认启用状态，默认 `true`；运行时的启停状态会持久化到插件目录的 state.json */
  enabled?: boolean
  /**
   * 插件需要的配置项（host / api_key / cookie 等）。
   * 用户填写的值存在插件目录的 `config.json`，宿主通过 `ctx.config` 只读地交给插件。
   */
  config?: PluginConfigField[]
}

/* -------------------------------------------------------------------------- */
/*                                   配置                                      */
/* -------------------------------------------------------------------------- */

/** 配置值的可能类型 */
export type PluginConfigValue = string | number | boolean

/** 配置项的输入类型（`secret` 用于 UI 遮蔽，不是独立的 type） */
export type PluginConfigFieldType = "string" | "text" | "number" | "boolean" | "select"

/** `select` 类型的候选项 */
export interface PluginConfigOption {
  /** 展示文案 */
  label: string
  /** 实际存储的值 */
  value: string
}

/** 单个配置项声明 */
export interface PluginConfigField {
  /** 键名，同时作为 config.json 的字段名与 `ctx.config.get(key)` 的参数 */
  key: string
  /** 展示名称 */
  label: string
  /** 输入类型，默认 `string` */
  type: PluginConfigFieldType
  /** 说明文案（配置面板中显示在输入框下方） */
  description?: string
  /** 输入框占位符 */
  placeholder?: string
  /** 是否必填，默认 false */
  required?: boolean
  /** 敏感值（如 api_key / cookie）：UI 默认遮蔽输入 */
  secret?: boolean
  /** 默认值 */
  default?: PluginConfigValue
  /** `type: "select"` 时的候选项，必填且不可为空 */
  options?: PluginConfigOption[]
  /** `type: "number"` 时的下界 */
  min?: number
  /** `type: "number"` 时的上界 */
  max?: number
}

/** 插件侧读取配置的只读视图（`ctx.config`） */
export interface PluginConfig {
  /** 取值，未配置时返回 undefined（会先合并 schema 的默认值） */
  get<T extends PluginConfigValue = PluginConfigValue>(key: string): T | undefined
  /** 取必填值，缺失时抛 `INVALID_CONFIG` */
  require<T extends PluginConfigValue = PluginConfigValue>(key: string): T
  /** 是否已配置（含默认值） */
  has(key: string): boolean
  /** 全部配置值（冻结副本） */
  all(): Readonly<Record<string, PluginConfigValue>>
}

/** 配置项 schema 与当前值的组合快照（配置面板的完整数据源） */
export interface PluginConfigSnapshot {
  /** 插件声明的配置项 */
  schema: readonly PluginConfigField[]
  /** 当前值（已合并 schema 默认值） */
  values: Readonly<Record<string, PluginConfigValue>>
}

/** `updateConfig` 的可选项 */
export interface PluginConfigUpdateOptions {
  /**
   * 保存后是否自动重载插件让新配置生效，默认 true。
   * 重载失败不会回滚已保存的配置，插件会停在 error 状态并在列表里显示原因。
   */
  reload?: boolean
}

/** 插件状态，持久化在插件目录的 `state.json` */
export interface PluginState {
  /** 插件 ID */
  id: string
  /** 安装（或最近一次更新）时的版本 */
  version?: string
  /** 是否启用 */
  enabled: boolean
  /** 首次安装时间（ISO 字符串） */
  installedAt?: string
  /** 最近一次安装 / 更新时间（ISO 字符串） */
  updatedAt?: string
  /** 安装来源：本地文件路径或下载地址 */
  source?: string
}

/** 插件运行时状态 */
export type PluginStatus =
  /** 已扫描到入口，但尚未加载代码 */
  | "discovered"
  /** 正在加载代码 */
  | "loading"
  /** 已加载并启用 */
  | "active"
  /** 已加载但被禁用 */
  | "inactive"
  /** 加载失败，`PluginInfo.error` 为原因 */
  | "error"

/** 插件的只读快照 */
export interface PluginInfo {
  manifest: Readonly<PluginManifest>
  status: PluginStatus
  /** 插件目录（绝对路径），其下包含 index.js / state.json / storage.json */
  directory: string
  /** 入口文件（仅在加载后存在） */
  entry?: string
  /** 持久化状态（插件目录下的 state.json） */
  state?: Readonly<PluginState>
  /** 出错原因 */
  error?: string
}

/* -------------------------------------------------------------------------- */
/*                              可调用方法（泛型）                              */
/* -------------------------------------------------------------------------- */

/** 任意函数签名 */
export type AnyMethod = (...args: any[]) => unknown

/**
 * 宿主声明的「插件 API」默认形态：任意方法名。
 * 主进程 / 渲染进程应按自己的业务接口替换它，例如 `PluginManager<SourceApi>`。
 */
export type PluginApi = Record<string, AnyMethod>

/** 取出 `TApi` 中所有函数类型的键，即宿主可以调用的插件方法名 */
export type ApiMethodKey<TApi> = {
  [K in keyof TApi]-?: TApi[K] extends AnyMethod ? K : never
}[keyof TApi] &
  string

/** 取某个方法的参数元组 */
export type ApiArgs<TApi, K> = K extends keyof TApi ? Parameters<Extract<TApi[K], AnyMethod>> : unknown[]

/** 取某个方法的返回值 */
export type ApiResult<TApi, K> = K extends keyof TApi ? ReturnType<Extract<TApi[K], AnyMethod>> : unknown

/* -------------------------------------------------------------------------- */
/*                              宿主注入的能力                                  */
/* -------------------------------------------------------------------------- */

/**
 * 日志器，宿主默认实现基于 electron-log（见 src/main/logger.ts）。
 * 该对象会被注入为插件的 `console`，所以四个基础级别之外还提供 `log`（等价 `info`），
 * 插件里直接写 `console.log(...)` 也能正常输出。
 */
export interface PluginLogger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
  /** 等价于 `info`，对齐 `console.log` */
  log(message: string, ...args: unknown[]): void
}

/** 插件私有的键值存储，按插件 ID 落地为独立 JSON 文件 */
export interface PluginStorage {
  get<T = unknown>(key: string): T | undefined
  set(key: string, value: unknown): void
  /** 返回是否真的删除了键 */
  delete(key: string): boolean
  clear(): void
  keys(): string[]
  /** 立刻写盘（平时写入会自动合并，约 200ms 落盘一次） */
  flush(): Promise<void>
}

/** 调用插件方法时的可选项 */
export interface PluginCallOptions {
  /** 覆盖默认超时（毫秒） */
  timeout?: number
  /** 外部取消信号 */
  signal?: AbortSignal
}

export interface PluginHttpInit extends PluginCallOptions {
  method?: string
  headers?: Record<string, string>
  body?: string | Uint8Array
}

/** 网络请求能力 */
export interface PluginHttp {
  request(url: string, init?: PluginHttpInit): Promise<Response>
  text(url: string, init?: PluginHttpInit): Promise<string>
  json<T = unknown>(url: string, init?: PluginHttpInit): Promise<T>
}

/** 插件侧的事件总线（插件内自洽，不跨插件） */
export interface PluginEvents {
  on(event: string, handler: (...args: any[]) => void): () => void
  once(event: string, handler: (...args: any[]) => void): () => void
  off(event: string, handler: (...args: any[]) => void): void
  emit(event: string, ...args: unknown[]): void
}

/** 注入到插件中的上下文对象（所有插件拿到的能力完全一致） */
export interface PluginContext {
  /** 当前插件清单（冻结副本） */
  readonly manifest: Readonly<PluginManifest>
  /** 宿主 API 版本 */
  readonly apiVersion: string
  readonly logger: PluginLogger
  readonly storage: PluginStorage
  /** 用户在插件面板填写的配置（只读；改配置请走宿主的 updateConfig） */
  readonly config: PluginConfig
  readonly http: PluginHttp
  readonly events: PluginEvents
  /** 读取其他插件的快照 */
  getPlugin(id: string): PluginInfo | undefined
  /** 宿主重新加载当前插件 */
  reload(): Promise<void>
}

/* -------------------------------------------------------------------------- */
/*                                 插件契约                                     */
/* -------------------------------------------------------------------------- */

/** 生命周期钩子 */
export interface PluginLifecycle {
  /** 加载完成、插件启用时调用 */
  activate?(context: PluginContext): void | Promise<void>
  /** 插件禁用 / 卸载时调用，用于释放资源 */
  deactivate?(): void | Promise<void>
}

/**
 * 插件入口 `module.exports` 的形状。
 *
 * 宿主声明的方法（`TApi`）可以直接平铺在导出对象上，也可以集中写在 `api` 字段里：
 * ```js
 * module.exports = { id, name, version, api: { async search(kw) { return [] } } }
 * ```
 */
export interface PluginModule<TApi extends object = PluginApi> extends PluginLifecycle {
  /** 可选：把可调用方法集中到 api 字段（与平铺写法二选一，api 优先） */
  api?: Partial<TApi>
  /** 允许插件导出其它任意字段（含清单字段） */
  [key: string]: unknown
}

/** 单文件插件的导出契约：清单字段 + 生命周期 + 宿主声明的方法 */
export type PluginDefinition<TApi extends object = PluginApi> = PluginManifest &
  PluginModule<TApi> & {
    /** 元信息也可集中写在 manifest 字段里（优先于平铺字段） */
    manifest?: Partial<PluginManifest>
  }

/* -------------------------------------------------------------------------- */
/*                                   错误                                       */
/* -------------------------------------------------------------------------- */

export type PluginErrorCode =
  | "INVALID_MANIFEST"
  | "PLUGIN_NOT_FOUND"
  | "PLUGIN_NOT_LOADED"
  | "ENTRY_NOT_FOUND"
  | "INSTALL_FAILED"
  | "INVALID_CONFIG"
  | "LOAD_FAILED"
  | "HOOK_FAILED"
  | "HOOK_TIMEOUT"
  | "METHOD_NOT_FOUND"
  | "PERMISSION_DENIED"
  | "MODULE_NOT_ALLOWED"
  | "DEPENDENCY_MISSING"
  | "INCOMPATIBLE_API"
  | "INVALID_OPTION"

/* -------------------------------------------------------------------------- */
/*                                 管理器                                       */
/* -------------------------------------------------------------------------- */

export interface PluginManagerOptions<TApi extends object = PluginApi> {
  /** 插件根目录，其下每个子目录视为一个插件 */
  directory: string
  /**
   * 运行时白名单：只允许调用这些方法名（同时提供类型提示）。
   * 不传表示不限制（常见于测试）；生产环境建议显式声明，避免渲染进程调到意外的方法。
   */
  methods?: readonly ApiMethodKey<TApi>[]
  /**
   * 允许插件 `require` 的模块白名单，命中规则为「相同或以 `name/` 开头」。
   * 不传表示插件不能 require 任何模块（宿主需要在实例化时显式声明）。
   */
  allowRequire?: readonly string[]
  /**
   * 宿主预先 `import` 好的模块表，键为插件里写的模块名。
   *
   * 这是推荐做法：静态 import 会被打包进主进程包体，插件 require 时直接命中，
   * 不依赖运行时 node_modules（asar 里通常解析不到）。
   * 未在表中但命中白名单的模块，会退回到宿主自身的 `require` 解析。
   */
  modules?: Readonly<Record<string, unknown>>
  /** `ctx.http` / `fetch` 的默认超时（毫秒），默认 15000 */
  httpTimeout?: number
  /** 插件顶层代码执行超时（毫秒），默认 5000 */
  loadTimeout?: number
  /** 安装前读取插件导出字段的探测超时（毫秒），默认 5000 */
  probeTimeout?: number
  /** 插件方法 / 钩子调用超时（毫秒），默认 30000 */
  hookTimeout?: number
  /** 是否允许插件使用 `eval` / `new Function`，默认 false */
  allowCodeGeneration?: boolean
  /** 宿主日志器，默认输出到 electron-log（作用域 `plugin-manager`） */
  logger?: PluginLogger
}

export interface PluginInstallOptions {
  /** 目标插件已存在时是否覆盖，默认 true（更新时保留 state.json 与 storage.json） */
  overwrite?: boolean
  /** 安装后是否立即启用，默认 true */
  activate?: boolean
}

/** 管理器对外事件 */
export interface PluginManagerEvents {
  /** `init()` 完成，参数为全部插件的快照 */
  ready: [plugins: PluginInfo[]]
  loaded: [info: PluginInfo]
  unloaded: [info: PluginInfo]
  enabled: [info: PluginInfo]
  disabled: [info: PluginInfo]
  reloaded: [info: PluginInfo]
  error: [error: PluginError]
}
