import { app, dialog, ipcMain } from "electron"
import { join } from "node:path"
import { is } from "@electron-toolkit/utils"
import { hostLog } from "../logger"
import { PluginError } from "./errors"
import { PluginManager } from "./manager"
import { HOST_MODULE_NAMES, HOST_MODULES } from "./modules"
import type { PluginConfigSnapshot, PluginConfigUpdateOptions, PluginConfigValue, PluginInfo } from "./interface"
import { PLUGIN_IPC, type IpcEnvelope } from "@shared/ipc"
import type { SourceApi } from "@shared/plugin-api"

let manager: PluginManager<SourceApi> | undefined

/** 插件装载 / IPC 层的日志器（作用域 `plugins`，底层 electron-log） */
const log = hostLog.scope("plugins")

/**
 * 宿主声明的插件 API：`initPluginManager` 用它实例化 `PluginManager<SourceApi>`，
 * 同时在运行时只放行这里列出的三个方法（IPC 调用也受此白名单约束）。
 */
const SOURCE_METHODS = ["search", "getDetail", "getPlayUrl"] as const

/** 插件根目录：dev 用应用内 plugins/（随仓库提供内置插件），生产用 userData/plugins；环境变量可覆盖 */
function pluginDirectory(): string {
  return (
    process.env["ZLANX_PLUGINS_DIR"] ??
    (is.dev ? join(app.getAppPath(), "plugins") : join(app.getPath("userData"), "plugins"))
  )
}

/** 创建并初始化插件管理器（扫描目录、加载已启用插件） */
export async function initPluginManager(): Promise<PluginManager<SourceApi>> {
  manager = new PluginManager<SourceApi>({
    directory: pluginDirectory(),
    methods: SOURCE_METHODS,
    // 插件可 require 的模块全部由宿主显式声明（见 ./modules.ts）：
    // allowRequire 是白名单，modules 是预置实例，两者配套使用
    allowRequire: HOST_MODULE_NAMES,
    modules: HOST_MODULES,
  })
  await manager.init()
  log.info(`插件根目录：${manager.directory}`)
  for (const info of manager.list()) {
    const error = info.error ? `（${info.error}）` : ""
    log.info(`- ${info.manifest.id}@${info.manifest.version} [${info.status}]${error}`)
  }
  return manager
}

/** 卸载全部插件并落盘数据（app 退出前调用） */
export async function disposePluginManager(): Promise<void> {
  await manager?.dispose()
  manager = undefined
}

/** 统一把 handler 结果包装为信封，避免 IPC 异常丢失 PluginError 的错误码 */
function envelope<T>(task: () => Promise<T>): Promise<IpcEnvelope<T>> {
  return task().then(
    (data): IpcEnvelope<T> => ({ ok: true, data }),
    (error: unknown): IpcEnvelope<T> => {
      if (error instanceof PluginError) {
        return {
          ok: false,
          code: error.code,
          message: error.message,
          pluginId: error.pluginId,
        }
      }
      return {
        ok: false,
        code: "UNKNOWN",
        message: error instanceof Error ? error.message : String(error),
      }
    },
  )
}

function assertId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new PluginError("INVALID_OPTION", "插件 ID 不能为空")
  }
}

function assertPatch(patch: unknown): asserts patch is Record<string, PluginConfigValue | undefined> {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    throw new PluginError("INVALID_OPTION", "配置更新内容必须是对象")
  }
}

/**
 * 注册插件相关 IPC handler（通道名见 @shared/ipc 的 PLUGIN_IPC）。
 * 所有 handler 都返回 IpcEnvelope，渲染进程在 preload 里解包。
 */
export function registerPluginIpc(pluginManager: PluginManager<SourceApi>): void {
  ipcMain.handle(PLUGIN_IPC.list, () => envelope(async (): Promise<PluginInfo[]> => pluginManager.list()))

  ipcMain.handle(PLUGIN_IPC.get, (_event, id: string) =>
    envelope(async () => {
      assertId(id)
      return pluginManager.get(id)
    }),
  )

  ipcMain.handle(PLUGIN_IPC.call, (_event, pluginId: string, method: string, args?: unknown[]) =>
    envelope(async () => {
      assertId(pluginId)
      if (typeof method !== "string" || method.trim().length === 0) {
        throw new PluginError("INVALID_OPTION", "需要提供要调用的插件方法名")
      }
      return pluginManager.invoke(pluginId, method, Array.isArray(args) ? args : [])
    }),
  )

  ipcMain.handle(PLUGIN_IPC.enable, (_event, id: string) =>
    envelope(async () => {
      assertId(id)
      return pluginManager.enable(id)
    }),
  )

  ipcMain.handle(PLUGIN_IPC.disable, (_event, id: string) =>
    envelope(async () => {
      assertId(id)
      await pluginManager.disable(id)
    }),
  )

  ipcMain.handle(PLUGIN_IPC.reload, (_event, id: string) =>
    envelope(async () => {
      assertId(id)
      return pluginManager.reload(id)
    }),
  )

  ipcMain.handle(PLUGIN_IPC.install, (_event, source: string) =>
    envelope(async (): Promise<PluginInfo> => {
      if (typeof source !== "string" || source.trim().length === 0) {
        throw new PluginError("INVALID_OPTION", "install 需要提供插件 js 文件路径或下载地址")
      }
      return pluginManager.install(source)
    }),
  )

  ipcMain.handle(PLUGIN_IPC.installFromUrl, (_event, url: string) =>
    envelope(async (): Promise<PluginInfo> => {
      if (typeof url !== "string" || url.trim().length === 0) {
        throw new PluginError("INVALID_OPTION", "需要提供插件 js 文件的下载地址")
      }
      return pluginManager.installUrl(url)
    }),
  )

  ipcMain.handle(PLUGIN_IPC.installFromDialog, (_event) =>
    envelope(async (): Promise<PluginInfo | undefined> => {
      const result = await dialog.showOpenDialog({
        title: "选择插件文件（.js）",
        properties: ["openFile", "openDirectory"],
        filters: [
          { name: "插件脚本", extensions: ["js"] },
          { name: "全部文件", extensions: ["*"] },
        ],
      })
      if (result.canceled || result.filePaths.length === 0) {
        return undefined
      }
      const selected = result.filePaths[0]
      // 目录会被解析为其下的 index.js，等价于安装一个已解压的插件
      return pluginManager.install(selected)
    }),
  )

  ipcMain.handle(PLUGIN_IPC.uninstall, (_event, id: string) =>
    envelope(async () => {
      assertId(id)
      await pluginManager.uninstall(id)
    }),
  )

  ipcMain.handle(PLUGIN_IPC.getConfig, (_event, id: string) =>
    envelope(async (): Promise<PluginConfigSnapshot> => {
      assertId(id)
      return pluginManager.getConfig(id)
    }),
  )

  ipcMain.handle(
    PLUGIN_IPC.updateConfig,
    (_event, id: string, patch: Record<string, PluginConfigValue | undefined>, options?: PluginConfigUpdateOptions) =>
      envelope(async (): Promise<PluginInfo> => {
        assertId(id)
        assertPatch(patch)
        return pluginManager.updateConfig(id, patch, options)
      }),
  )

  ipcMain.handle(PLUGIN_IPC.resetConfig, (_event, id: string) =>
    envelope(async (): Promise<PluginInfo> => {
      assertId(id)
      return pluginManager.resetConfig(id)
    }),
  )
}
