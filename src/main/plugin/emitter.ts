import { hostLog } from "../logger"

/** 派发事件时监听器抛错的记录方式（作用域 `emitter`，底层 electron-log） */
const log = hostLog.scope("emitter")

/**
 * 轻量事件发射器：监听器异常被吞掉（记录到日志），
 * 保证单个监听器出错不影响其它监听器与宿主流程。
 */
export class Emitter {
  readonly #handlers = new Map<string, Set<(...args: any[]) => void>>()

  /** 注册监听器，返回取消监听函数 */
  on(event: string, handler: (...args: any[]) => void): () => void {
    let set = this.#handlers.get(event)
    if (!set) {
      set = new Set()
      this.#handlers.set(event, set)
    }
    set.add(handler)
    return () => this.off(event, handler)
  }

  /** 注册一次性监听器，首次触发后自动移除，返回取消监听函数 */
  once(event: string, handler: (...args: any[]) => void): () => void {
    const off = this.on(event, (...args) => {
      off()
      handler(...args)
    })
    return off
  }

  /** 移除监听器 */
  off(event: string, handler: (...args: any[]) => void): void {
    this.#handlers.get(event)?.delete(handler)
  }

  /** 派发事件（监听器按注册顺序同步调用） */
  emit(event: string, ...args: unknown[]): void {
    const handlers = [...(this.#handlers.get(event) ?? [])]
    for (const handler of handlers) {
      try {
        handler(...args)
      } catch (error) {
        log.error(`事件 "${event}" 的监听器执行失败:`, error)
      }
    }
  }

  /** 清空全部监听器 */
  clear(): void {
    this.#handlers.clear()
  }
}
