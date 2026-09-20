/**
 * zlanx-film-desktop 插件开发类型声明（自包含，零依赖）
 *
 * 用法（类型全局可用，无需 import）：
 *  1. 把本文件放进插件工程，并确保它处于 tsconfig 的 include 范围内（例如 `"include": ["**\/*.ts"]`）；
 *  2. 插件源码里直接标注类型：
 *
 *   let ctxRef: PluginContext | undefined
 *   const plugin: ZlanxPlugin = { id: "demo", name: "示例", version: "1.0.0", api: { ... } }
 *   module.exports = plugin
 *
 * 约束（宿主侧真实行为）：
 *   - 插件是 **单个 CommonJS 文件**，不能 require 相对路径 / 本地文件；
 *   - 顶层不要写副作用：安装校验与每次加载都会执行一遍顶层代码；
 *   - 必须导出 id / name / version，缺一项安装直接失败且不落盘；
 *   - 所有插件拿到的能力完全一致，不需要声明权限；
 *   - 只有宿主声明的方法会被调用（当前为 search / getDetail / getPlayUrl）。
 *
 * 本文件由宿主实现反向生成，宿主改动后请同步重新生成：
 *   - src/main/plugin/interface.ts   清单 / 上下文 / 配置 / 错误码
 *   - src/shared/plugin-api.ts       宿主可调用的方法（SourceApi）与数据结构（Film / FilmTag）
 *   - src/main/plugin/sandbox.ts     沙箱注入的全局（console / fetch / require）
 *   - src/main/plugin/modules.ts     宿主预置、可 require 的第三方模块
 */

declare namespace Zlanx {
  /* ------------------------------------------------------------------ */
  /*                              数据结构                                */
  /* ------------------------------------------------------------------ */

  /**
   * 影片标签：`[属性, 取值]`，例如 `["年份：", "2026"]`。
   *
   * 影视源字段各不相同，用这种二元组可以在不改宿主 schema 的前提下展示任意信息。
   */
  type FilmTag = [label: string, value: string]

  /** 搜索结果 / 详情条目 */
  interface Film {
    /** 站内唯一 ID，用于后续取详情 / 播放地址 */
    id: string
    /** 影片名称 */
    title: string
    /** 影片海报 */
    poster?: string
    /** 影片年份 */
    year?: string
    /** 影片地区 */
    region?: string
    /** 影片类型 */
    genres?: string[]
    /** 影片描述 */
    description?: string
    /** 影片评分 */
    rating?: number
    /** 最新状态，如「更新至 12 集」 */
    latest?: string
    /** 最新更新日期 */
    latestDate?: string
    /** 影片源，可以有多个，每个有多集 */
    sources?: FilmSourceEpisode[][]
    /** 影片标签，宿主原样按数组顺序渲染（顺序与内容都由影视源决定） */
    tags?: FilmTag[]
    /** 允许源自行扩展字段 */
    [key: string]: unknown
  }

  /** 详情 / 剧集 */
  interface FilmSourceEpisode {
    /** 剧集 ID，用于取播放地址 */
    id: string
    title: string
    /** 部分源会直接给出播放页地址 */
    url?: string
  }

  /* ------------------------------------------------------------------ */
  /*                          宿主可调用的方法                             */
  /* ------------------------------------------------------------------ */

  /** 调用插件方法时的可选项 */
  interface PluginCallOptions {
    /** 覆盖默认超时（毫秒，宿主默认 30000） */
    timeout?: number
    /** 外部取消信号 */
    signal?: AbortSignal
  }

  /** 影视源插件可以实现的方法（实现其中任意几个即可，不必全部实现） */
  interface SourceApi {
    /** 按关键字搜索 */
    search(keyword: string, options?: PluginCallOptions): Promise<Film[]>
    /** 取影片详情（含剧集列表） */
    getDetail(id: string, options?: PluginCallOptions): Promise<Film | undefined>
    /** 取播放地址 */
    getPlayUrl(id: string, options?: PluginCallOptions): Promise<string | undefined>
  }

  /* ------------------------------------------------------------------ */
  /*                                清单                                  */
  /* ------------------------------------------------------------------ */

  /** 配置值的可能类型 */
  type PluginConfigValue = string | number | boolean

  /** 配置项的输入类型（`secret` 只影响 UI 遮蔽，不是独立的 type） */
  type PluginConfigFieldType = "string" | "text" | "number" | "boolean" | "select"

  /** `select` 类型的候选项 */
  interface PluginConfigOption {
    /** 展示文案 */
    label: string
    /** 实际存储的值 */
    value: string
  }

  /** 单个配置项声明（对应插件面板生成的 form 项） */
  interface PluginConfigField {
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
    /** 是否必填，默认 false；必填项没填时插件会停在 error 状态 */
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

  /**
   * 插件清单。
   * 单文件插件没有 manifest.json，元信息来自 `module.exports` 的导出字段：
   * 既可以平铺写，也可以集中写在 `module.exports.manifest` 里（后者优先）。
   */
  interface PluginManifest {
    /** 全局唯一 ID（建议 kebab-case），同时作为插件目录名 */
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
    /** 默认启用状态，默认 `true`；运行时的启停状态持久化到 state.json */
    enabled?: boolean
    /** 插件需要的配置项（host / api_key / cookie …），用户在插件面板填写 */
    config?: PluginConfigField[]
  }

  /** 生命周期钩子 */
  interface PluginLifecycle {
    /** 加载完成、插件启用时调用 */
    activate?(context: PluginContext): void | Promise<void>
    /** 插件禁用 / 卸载时调用，用于释放资源 */
    deactivate?(): void | Promise<void>
  }

  /**
   * 插件入口 `module.exports` 的类型。
   *
   * 宿主声明的方法（SourceApi）可以平铺在导出对象上，也可以集中写在 `api` 字段里（api 优先）：
   * ```js
   * module.exports = { id, name, version, api: { async search(kw) { return [] } } }
   * ```
   */
  interface PluginDefinition extends PluginManifest, PluginLifecycle {
    /** 可选：把可调用方法集中到 api 字段（与平铺写法二选一，api 优先） */
    api?: Partial<SourceApi>
    /** 元信息也可集中写在 manifest 字段里（优先于平铺字段） */
    manifest?: Partial<PluginManifest>
    /** 允许插件导出其它任意字段（含清单字段） */
    [key: string]: unknown
  }

  /* ------------------------------------------------------------------ */
  /*                            注入的能力                                */
  /* ------------------------------------------------------------------ */

  /**
   * 日志器，底层是宿主的 electron-log：
   * 输出会随宿主日志一起落盘，插件里直接 `console.log(...)` 也能生效。
   */
  interface PluginLogger {
    debug(message: string, ...args: unknown[]): void
    info(message: string, ...args: unknown[]): void
    warn(message: string, ...args: unknown[]): void
    error(message: string, ...args: unknown[]): void
    /** 等价于 `info`，对齐 `console.log` */
    log(message: string, ...args: unknown[]): void
  }

  /** 插件私有的键值存储，按插件 ID 落地为独立 JSON 文件 */
  interface PluginStorage {
    get<T = unknown>(key: string): T | undefined
    set(key: string, value: unknown): void
    /** 返回是否真的删除了键 */
    delete(key: string): boolean
    clear(): void
    keys(): string[]
    /** 立刻写盘（平时写入会自动合并，约 200ms 落盘一次） */
    flush(): Promise<void>
  }

  /** 插件侧读取配置的只读视图（`ctx.config`） */
  interface PluginConfig {
    /** 取值，未配置时返回 undefined（会先合并 schema 的默认值） */
    get<T extends PluginConfigValue = PluginConfigValue>(key: string): T | undefined
    /** 取必填值，缺失时抛 INVALID_CONFIG */
    require<T extends PluginConfigValue = PluginConfigValue>(key: string): T
    /** 是否已配置（含默认值） */
    has(key: string): boolean
    /** 全部配置值（冻结副本） */
    all(): Readonly<Record<string, PluginConfigValue>>
  }

  interface PluginHttpInit extends PluginCallOptions {
    method?: string
    headers?: Record<string, string>
    body?: string | Uint8Array
  }

  /** 网络请求能力（默认超时 15000ms，可被 init.timeout 覆盖） */
  interface PluginHttp {
    request(url: string, init?: PluginHttpInit): Promise<Response>
    text(url: string, init?: PluginHttpInit): Promise<string>
    json<T = unknown>(url: string, init?: PluginHttpInit): Promise<T>
  }

  /** 插件侧的事件总线（插件内自洽，不跨插件） */
  interface PluginEvents {
    on(event: string, handler: (...args: any[]) => void): () => void
    once(event: string, handler: (...args: any[]) => void): () => void
    off(event: string, handler: (...args: any[]) => void): void
    emit(event: string, ...args: unknown[]): void
  }

  /* ------------------------------------------------------------------ */
  /*                            快照 / 上下文                              */
  /* ------------------------------------------------------------------ */

  /** 持久化状态（插件目录下的 state.json，宿主维护，插件不要手改） */
  interface PluginState {
    id: string
    version?: string
    enabled: boolean
    installedAt?: string
    updatedAt?: string
    /** 安装来源：本地文件路径或下载地址 */
    source?: string
  }

  type PluginStatus =
    /** 已扫描到入口，但尚未加载代码 */
    | "discovered"
    /** 正在加载代码 */
    | "loading"
    /** 已加载并启用 */
    | "active"
    /** 已加载但被禁用 */
    | "inactive"
    /** 加载失败 */
    | "error"

  /** 插件的只读快照（`ctx.getPlugin()` 的返回值） */
  interface PluginInfo {
    manifest: Readonly<PluginManifest>
    status: PluginStatus
    /** 插件目录（绝对路径），其下含 index.js / state.json / config.json / storage.json */
    directory: string
    entry?: string
    state?: Readonly<PluginState>
    /** 出错原因 */
    error?: string
  }

  /** 注入到插件中的上下文对象（所有插件拿到的能力完全一样） */
  interface PluginContext {
    /** 当前插件清单（冻结副本） */
    readonly manifest: Readonly<PluginManifest>
    /** 宿主 API 版本 */
    readonly apiVersion: string
    readonly logger: PluginLogger
    readonly storage: PluginStorage
    /** 用户在插件面板填写的配置（只读；改配置请让用户在面板里改） */
    readonly config: PluginConfig
    readonly http: PluginHttp
    readonly events: PluginEvents
    /** 读取其他插件的快照 */
    getPlugin(id: string): PluginInfo | undefined
    /** 宿主重新加载当前插件 */
    reload(): Promise<void>
  }

  /* ------------------------------------------------------------------ */
  /*                              其它                                    */
  /* ------------------------------------------------------------------ */

  /** 宿主抛出的错误码（`error.code`，错误名为 PluginError） */
  type PluginErrorCode =
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

  /** 宿主预置、插件可 require 的模块白名单（见 src/main/plugin/modules.ts） */
  type HostModuleName = "cheerio" | "he" | "es-toolkit" | "node:crypto" | "crypto"
}

/** 插件入口对象的类型（= Zlanx.PluginDefinition，见上面的完整定义） */
type ZlanxPlugin = Zlanx.PluginDefinition

/** 常用类型的顶层别名，插件里可以直接写短名 */
type Film = Zlanx.Film
type FilmTag = Zlanx.FilmTag
type FilmSourceEpisode = Zlanx.FilmSourceEpisode
type SourceApi = Zlanx.SourceApi
type PluginContext = Zlanx.PluginContext
type PluginLogger = Zlanx.PluginLogger
type PluginStorage = Zlanx.PluginStorage
type PluginHttp = Zlanx.PluginHttp
type PluginHttpInit = Zlanx.PluginHttpInit
type PluginEvents = Zlanx.PluginEvents
type PluginConfig = Zlanx.PluginConfig
type PluginConfigField = Zlanx.PluginConfigField
type PluginConfigFieldType = Zlanx.PluginConfigFieldType
type PluginConfigOption = Zlanx.PluginConfigOption
type PluginConfigValue = Zlanx.PluginConfigValue
type PluginManifest = Zlanx.PluginManifest
type PluginDefinition = Zlanx.PluginDefinition
type PluginLifecycle = Zlanx.PluginLifecycle
type PluginCallOptions = Zlanx.PluginCallOptions
type PluginInfo = Zlanx.PluginInfo
type PluginState = Zlanx.PluginState
type PluginStatus = Zlanx.PluginStatus
type PluginErrorCode = Zlanx.PluginErrorCode
type HostModuleName = Zlanx.HostModuleName

/* ---------------------------------------------------------------------- */
/*                        沙箱注入的全局（宿主提供）                          */
/* ---------------------------------------------------------------------- */

/**
 * 以下全局由宿主沙箱注入（见 src/main/plugin/sandbox.ts）。
 * 这里 **刻意不做 declare**：`module` / `require` / `console` / `fetch` 等
 * 在 @types/node 与 DOM lib 里已有声明，重复声明会造成类型冲突；
 * 插件工程只要装了 @types/node（Electron 项目默认有）就能正常使用。
 *
 * - `module.exports`：插件本体，宿主读取它上面的清单字段与方法，
 *   赋值时标注 `ZlanxPlugin` 即可获得完整检查；TS 里也可以写 `export = plugin`。
 * - `require(id)`：只能 require 宿主预置的模块（见 HostModuleName），
 *   相对路径 / 绝对路径会抛 MODULE_NOT_ALLOWED。宿主已把命名导出与 `default`
 *   归一化到同一份实现，所以 `require("x")` 与 `require("x").default` 都成立；
 *   需要精确类型时自行断言：`const cheerio = require("cheerio") as typeof import("cheerio")`、
 *   `const crypto = require("node:crypto") as typeof import("node:crypto")`（也可写 `require("crypto")`）。
 * - `console`：宿主注入的 electron-log，输出随宿主日志落盘，
 *   支持 debug / info / warn / error / log（比浏览器 Console 多了 debug 与 log 的对齐）。
 * - `fetch` / `ctx.http`：默认 15000ms 超时；安装校验阶段禁止发起请求。
 *   需要自定义 header、超时或取消信号时用 `ctx.http`（PluginHttp）。
 * - 其它可用全局：setTimeout / setInterval / clearTimeout / clearInterval /
 *   queueMicrotask / URL / URLSearchParams / TextEncoder / TextDecoder /
 *   AbortController / AbortSignal / __filename / __dirname。
 * - 默认禁用 `eval` 与 `new Function`（宿主未开启 allowCodeGeneration）。
 */
