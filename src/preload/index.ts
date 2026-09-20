import { contextBridge, ipcRenderer } from "electron"
import log from "electron-log/renderer"
import { ElectronAPI } from "@shared/index"
import type {
  ApiArgs,
  ApiMethodKey,
  ApiResult,
  IpcEnvelope,
  PluginConfigSnapshot,
  PluginsApi,
  PluginInfo,
  PluginInstallResult,
} from "@shared/ipc"
import { PLUGIN_IPC } from "@shared/ipc"
import { SourceApi } from "@shared/plugin-api"
import {
  DB_API_IPC,
  type DB_API,
  type FavoriteFilm,
  type FavoriteFilmInput,
  type WatchHistoryEntry,
  type WatchProgressInput,
} from "@shared/db-api"

/** 统一包装 IPC 返回结果*/
function unwrap<T>(envelope: IpcEnvelope<T>): T {
  if (envelope.ok) {
    return envelope.data
  }
  const error = new Error(envelope.message) as Error & { code?: string; pluginId?: string }
  error.name = "PluginError"
  error.code = envelope.code
  if (envelope.pluginId !== undefined) {
    error.pluginId = envelope.pluginId
  }
  throw error
}

/** 插件相关的 IPC 通信 */
const plugins: PluginsApi<SourceApi> = {
  list: () => ipcRenderer.invoke(PLUGIN_IPC.list).then((e) => unwrap<PluginInfo[]>(e)),
  get: (id) => ipcRenderer.invoke(PLUGIN_IPC.get, id).then((e) => unwrap<PluginInfo | undefined>(e)),
  call: <K extends ApiMethodKey<SourceApi>>(pluginId: string, method: K, ...args: ApiArgs<SourceApi, K>) =>
    ipcRenderer
      .invoke(PLUGIN_IPC.call, pluginId, method, args)
      .then((e) => unwrap<Awaited<ApiResult<SourceApi, K>>>(e)),
  enable: (id) => ipcRenderer.invoke(PLUGIN_IPC.enable, id).then((e) => unwrap<PluginInfo>(e)),
  disable: (id) => ipcRenderer.invoke(PLUGIN_IPC.disable, id).then((e) => unwrap<void>(e)),
  reload: (id) => ipcRenderer.invoke(PLUGIN_IPC.reload, id).then((e) => unwrap<PluginInfo>(e)),
  install: (source) => ipcRenderer.invoke(PLUGIN_IPC.install, source).then((e) => unwrap<PluginInfo>(e)),
  installFromUrl: (url) => ipcRenderer.invoke(PLUGIN_IPC.installFromUrl, url).then((e) => unwrap<PluginInfo>(e)),
  installFromDialog: () =>
    ipcRenderer.invoke(PLUGIN_IPC.installFromDialog).then((e) => unwrap<PluginInstallResult[]>(e)),
  uninstall: (id) => ipcRenderer.invoke(PLUGIN_IPC.uninstall, id).then((e) => unwrap<void>(e)),
  getConfig: (id) => ipcRenderer.invoke(PLUGIN_IPC.getConfig, id).then((e) => unwrap<PluginConfigSnapshot>(e)),
  updateConfig: (id, patch, options) =>
    ipcRenderer.invoke(PLUGIN_IPC.updateConfig, id, patch, options).then((e) => unwrap<PluginInfo>(e)),
  resetConfig: (id) => ipcRenderer.invoke(PLUGIN_IPC.resetConfig, id).then((e) => unwrap<PluginInfo>(e)),
}

/** 收藏 / 播放历史相关的 IPC 通信（返回值已是 DTO，直接透传即可） */
const api: DB_API = {
  getFavoritesFilms: () => ipcRenderer.invoke(DB_API_IPC.getFavoritesFilms).then((rows) => rows as FavoriteFilm[]),
  addFavoritesFilm: (film: FavoriteFilmInput) =>
    ipcRenderer.invoke(DB_API_IPC.addFavoritesFilm, film).then((row) => row as FavoriteFilm),
  removeFavoritesFilm: (plugin: string, filmId: string) =>
    ipcRenderer.invoke(DB_API_IPC.removeFavoritesFilm, plugin, filmId).then((removed) => removed as boolean),
  isFavoritesFilm: (plugin: string, filmId: string) =>
    ipcRenderer.invoke(DB_API_IPC.isFavoritesFilm, plugin, filmId).then((favorited) => favorited as boolean),
  getWatchHistory: (limit?: number) =>
    ipcRenderer.invoke(DB_API_IPC.getWatchHistory, limit).then((rows) => rows as WatchHistoryEntry[]),
  getFilmWatchHistory: (plugin: string, filmId: string) =>
    ipcRenderer.invoke(DB_API_IPC.getFilmWatchHistory, plugin, filmId).then((rows) => rows as WatchHistoryEntry[]),
  saveWatchProgress: (entry: WatchProgressInput) =>
    ipcRenderer.invoke(DB_API_IPC.saveWatchProgress, entry).then((row) => row as WatchHistoryEntry),
  removeWatchHistory: (plugin: string, filmId: string, entryId?: number) =>
    ipcRenderer.invoke(DB_API_IPC.removeWatchHistory, plugin, filmId, entryId).then((count) => count as number),
  clearWatchHistory: () => ipcRenderer.invoke(DB_API_IPC.clearWatchHistory).then((count) => count as number),
}

const electronAPI: ElectronAPI = {
  window: {
    show: () => ipcRenderer.send("win:invoke", "show"),
    showInactive: () => ipcRenderer.send("win:invoke", "showInactive"),
    min: () => ipcRenderer.send("win:invoke", "min"),
    max: () => ipcRenderer.send("win:invoke", "max"),
    close: () => ipcRenderer.send("win:invoke", "close"),
  },
  plugins,
  api,
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI)
  } catch (error) {
    // 日志经 IPC 汇总到主进程（electron-log 的桥由主进程 log.initialize() 注入）
    log.error("[preload] 暴露 electron API 失败：", error)
  }
} else {
  window.electron = electronAPI
}
