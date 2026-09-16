/**
 * 宿主统一日志（electron-log）
 *
 * - 主进程 / preload / 渲染进程的日志都汇总到这里：`log.initialize()` 会注册
 *   `__ELECTRON_LOG__` IPC 通道并注入 electron-log 的 preload，
 *   让 `electron-log/renderer` 的日志经由 IPC 落到同一个文件；
 * - 日志文件位置由 electron-log 决定，即 `app.getPath("logs")/main.log`
 *   （Windows: `%APPDATA%/<应用名>/logs/main.log`）；
 * - 按模块派生带作用域的子日志器：`hostLog.scope("plugin-manager").info(...)`，
 *   输出形如 `[2026-09-16 16:20:00.123] [info  ] (plugin-manager) ...`。
 */
import log from "electron-log/main"
import { app } from "electron"

/** 单个日志文件体积上限（5MB），超出后自动轮转为 `main.old.log` */
const MAX_FILE_SIZE = 5 * 1024 * 1024

/** 文件日志格式：`[时间] [级别] (作用域) 内容` */
const FILE_FORMAT = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}]{scope} {text}"

/** 控制台格式：开发态看得清即可，省掉日期 */
const CONSOLE_FORMAT = "[{h}:{i}:{s}.{ms}] [{level}]{scope} {text}"

/**
 * 是否开发态，等价于 `!app.isPackaged`。
 *
 * 这里没有直接用 `@electron-toolkit/utils` 的 `is.dev`：那个包在**导入时**
 * 就会读 `app.isPackaged`，纯 Node 环境（脚本 / 测试导入插件管理器）会直接抛错；
 * 本模块被 `plugin/*` 依赖，需要在那里保持可导入。
 */
function isDevMode(): boolean {
  try {
    return !app.isPackaged
  } catch {
    return true
  }
}

const dev = isDevMode()

// 文件日志：开发态连 debug 一起记，生产态只记 info 及以上
log.transports.file.level = dev ? "debug" : "info"
log.transports.file.maxSize = MAX_FILE_SIZE
log.transports.file.format = FILE_FORMAT

// 控制台日志：开发态输出便于调试，生产态静默（文件照旧）
log.transports.console.level = dev ? "debug" : false
log.transports.console.format = CONSOLE_FORMAT

// 必须在创建窗口之前调用：electron-log 会在 app ready 时把它的 preload
// 注册进 session，渲染进程 / preload 才拿得到 `__electronLog` 桥
log.initialize()

/** 宿主日志器；按模块派生作用域，避免各处自己拼 `[前缀]` */
export const hostLog = log
