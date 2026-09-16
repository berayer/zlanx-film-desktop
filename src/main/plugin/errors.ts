import type { PluginErrorCode } from "./interface"

/** 插件系统统一抛出的错误 */
export class PluginError extends Error {
  readonly code: PluginErrorCode
  readonly pluginId?: string

  constructor(code: PluginErrorCode, message: string, options?: { pluginId?: string; cause?: unknown }) {
    super(message)
    this.name = "PluginError"
    this.code = code
    this.pluginId = options?.pluginId
    if (options?.cause !== undefined) {
      this.cause = options.cause
    }
  }
}

/** 把任意抛出的值包装为 PluginError（本身已是 PluginError 时原样返回） */
export function toPluginError(error: unknown, fallbackCode: PluginErrorCode, pluginId?: string): PluginError {
  if (error instanceof PluginError) {
    return error
  }
  const message = error instanceof Error ? error.message : String(error)
  return new PluginError(fallbackCode, message, { pluginId, cause: error })
}
