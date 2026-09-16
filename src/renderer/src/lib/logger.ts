/**
 * 渲染进程日志（electron-log）
 *
 * 渲染进程统一走这里：`electron-log/renderer` 会把日志通过 IPC 送到主进程，
 * 由主进程写进同一个日志文件（Windows: `%APPDATA%/<应用名>/logs/main.log`）。
 * IPC 桥由主进程的 `log.initialize()` 注入（见 src/main/logger.ts）。
 *
 * 用法：`rendererLog.scope("search").debug("...")`，
 * 输出里的作用域形如 `(search)`，与主进程日志格式一致。
 */
import log from "electron-log/renderer"

const dev = import.meta.env.DEV

// renderer 侧 ipc transport 的生产默认值是关闭的，
// 这里始终打开，否则打包后渲染进程的日志会全部丢失
log.transports.ipc.level = "debug"

// 控制台只在开发态输出调试信息，生产态保留 info 及以上给 DevTools
log.transports.console.level = dev ? "debug" : "info"
log.transports.console.format = "[{h}:{i}:{s}.{ms}] [{level}]{scope} {text}"

/** 渲染进程日志器；按模块派生作用域 `rendererLog.scope("模块名")` */
export const rendererLog = log
