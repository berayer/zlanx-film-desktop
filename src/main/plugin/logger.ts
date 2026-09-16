import { hostLog } from "../logger"
import type { PluginLogger } from "./interface"

/**
 * 创建日志器：底层是宿主的 electron-log，`scope` 即日志里的作用域。
 *
 * 宿主自身用固定的作用域名（如 `plugin-manager` / `plugins`），
 * 插件相关的作用域直接用插件 ID，输出形如：
 * `[2026-09-16 16:20:00.123] [info  ] (fengchedongman) 插件已启用：…`
 */
export function createPluginLogger(scope: string): PluginLogger {
  return hostLog.scope(scope)
}

/** 无任何输出的静默日志器 */
export const noopLogger: PluginLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  log: () => {},
}
