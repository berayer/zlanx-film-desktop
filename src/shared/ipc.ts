import type {
  ApiArgs,
  ApiMethodKey,
  ApiResult,
  PluginCallOptions,
  PluginConfigField,
  PluginConfigSnapshot,
  PluginConfigUpdateOptions,
  PluginConfigValue,
  PluginInfo,
} from "@main/plugin/interface"
import type { SourceApi, SourceDetail, SourceEpisode, SourceSearchItem } from "./plugin-api"

export type { PluginCallOptions, PluginInfo }
export type { ApiArgs, ApiMethodKey, ApiResult }
export type { PluginConfigField, PluginConfigSnapshot, PluginConfigUpdateOptions, PluginConfigValue }
export type { SourceApi, SourceSearchItem, SourceDetail, SourceEpisode }

/**
 * 插件相关的 IPC 通道名，main 与 preload 共用，避免两端手写字符串不一致。
 */
export const PLUGIN_IPC = {
  list: "plugins:list",
  get: "plugins:get",
  call: "plugins:call",
  enable: "plugins:enable",
  disable: "plugins:disable",
  reload: "plugins:reload",
  install: "plugins:install",
  installFromUrl: "plugins:installFromUrl",
  installFromDialog: "plugins:installFromDialog",
  uninstall: "plugins:uninstall",
  getConfig: "plugins:getConfig",
  updateConfig: "plugins:updateConfig",
  resetConfig: "plugins:resetConfig",
} as const

/**
 * IPC 统一返回信封：handler 内部错误（含 PluginError 的错误码 / 插件 ID）
 * 以结构化形式回传，而不是让 Electron 把异常序列化成只剩 message。
 */
export type IpcEnvelope<T> = { ok: true; data: T } | { ok: false; code: string; message: string; pluginId?: string }

/**
 * 暴露给渲染进程的插件 API（由 preload 封装为 window.electron.plugins）。
 *
 * `TApi` 与 `PluginManager<TApi>` 使用同一份声明，
 * 因此 `call` 的方法名与参数 / 返回值都能被 TypeScript 检查。
 */
export interface PluginsApi<TApi extends object = SourceApi> {
  /** 全部插件信息（含未加载 / 出错的插件） */
  list(): Promise<PluginInfo[]>
  /** 按 ID 读取插件信息 */
  get(id: string): Promise<PluginInfo | undefined>
  /** 调用插件实现的方法（方法名与参数由 TApi 约束） */
  call<K extends ApiMethodKey<TApi>>(
    pluginId: string,
    method: K,
    ...args: ApiArgs<TApi, K>
  ): Promise<Awaited<ApiResult<TApi, K>>>
  /** 启用插件（加载并激活，同时把状态持久化为启用） */
  enable(id: string): Promise<PluginInfo>
  /** 禁用插件（销毁沙箱，状态持久化为禁用） */
  disable(id: string): Promise<void>
  /** 重新加载插件（重新读取清单与入口代码） */
  reload(id: string): Promise<PluginInfo>
  /**
   * 安装单文件插件：`source` 可以是本地 js 文件路径，也可以是 http(s) 下载地址，
   * 两条路径都会归一成一份 js 源码，校验通过后落到 `<插件目录>/<插件ID>/index.js`。
   */
  install(source: string): Promise<PluginInfo>
  /**
   * 从网络地址安装插件：下载单个 js 文件，校验其导出字段（id / name / version …）
   * 通过后落盘并立即启用；任一项不满足则返回安装失败。仅支持 http(s)。
   */
  installFromUrl(url: string): Promise<PluginInfo>
  /** 弹出系统选择框，从本地 js 文件（或含 index.js 的目录）安装插件；用户取消时返回 undefined */
  installFromDialog(): Promise<PluginInfo | undefined>
  /** 卸载并删除插件（默认连数据一起删除） */
  uninstall(id: string): Promise<void>
  /** 读取插件配置：声明的配置项 schema + 当前值（后者已合并 schema 默认值） */
  getConfig(id: string): Promise<PluginConfigSnapshot>
  /**
   * 局部更新插件配置（host / api_key / cookie …）。
   * 值会按 schema 校验，非法值不写盘；传 undefined / 空串表示清空该配置项（必填项不允许）。
   * 保存成功后默认重载插件让新值生效。
   */
  updateConfig(
    id: string,
    patch: Record<string, PluginConfigValue | undefined>,
    options?: PluginConfigUpdateOptions,
  ): Promise<PluginInfo>
  /** 把配置重置为 schema 声明的默认值 */
  resetConfig(id: string): Promise<PluginInfo>
}

export interface WindowController {
  /** 窗口最小化 */
  min: () => void
  /** 窗口最大化 */
  max: () => void
  /** 关闭窗口 */
  close: () => void
  /** 显示窗口 */
  show: () => void
  /** 显示窗口，但不激活 */
  showInactive: () => void
}
