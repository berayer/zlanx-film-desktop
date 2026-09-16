import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import type { PluginStorage } from "./interface"

const FLUSH_DELAY_MS = 200

/**
 * 插件私有 KV 存储：内存读写 + 防抖落盘（约 200ms 合并写入一次），
 * 每个插件对应 `<数据目录>/<插件ID>/storage.json` 一个文件。
 */
export class PluginStorageImpl implements PluginStorage {
  readonly #file: string
  readonly #data = new Map<string, unknown>()
  #disposed = false
  #timer: ReturnType<typeof setTimeout> | undefined
  #queue: Promise<void> = Promise.resolve()

  private constructor(file: string, initial: Record<string, unknown>) {
    this.#file = file
    for (const [key, value] of Object.entries(initial)) {
      this.#data.set(key, value)
    }
  }

  /** 从磁盘读取已有数据并创建实例（文件不存在或损坏时按空存储处理） */
  static async load(file: string): Promise<PluginStorageImpl> {
    let initial: Record<string, unknown> = {}
    try {
      const parsed: unknown = JSON.parse(await readFile(file, "utf8"))
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        initial = parsed as Record<string, unknown>
      }
    } catch {
      // 文件不存在或损坏时按空存储处理
    }
    return new PluginStorageImpl(file, initial)
  }

  get<T = unknown>(key: string): T | undefined {
    return this.#data.get(key) as T | undefined
  }

  set(key: string, value: unknown): void {
    this.#data.set(key, value)
    this.#schedulePersist()
  }

  delete(key: string): boolean {
    const removed = this.#data.delete(key)
    if (removed) {
      this.#schedulePersist()
    }
    return removed
  }

  clear(): void {
    this.#data.clear()
    this.#schedulePersist()
  }

  keys(): string[] {
    return [...this.#data.keys()]
  }

  /** 立刻写盘，返回写入完成的 Promise */
  flush(): Promise<void> {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer)
      this.#timer = undefined
    }
    return this.#writeNow()
  }

  /** 停止接受新的写入并落盘（unload / dispose 时调用） */
  async dispose(): Promise<void> {
    this.#disposed = true
    await this.flush()
  }

  #schedulePersist(): void {
    if (this.#disposed) {
      return
    }
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer)
    }
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      void this.#writeNow().catch(() => {})
    }, FLUSH_DELAY_MS)
  }

  #writeNow(): Promise<void> {
    // 先取快照，避免异步写入过程中读到中间状态
    const snapshot = JSON.stringify(Object.fromEntries(this.#data))
    const file = this.#file
    const task = this.#queue.then(async () => {
      await mkdir(path.dirname(file), { recursive: true })
      // 先写临时文件再原子重命名，避免写一半被进程退出截断
      const tmp = `${file}.${Date.now()}.tmp`
      await writeFile(tmp, snapshot, "utf8")
      await rename(tmp, file)
    })
    // 写入失败不阻塞后续写入；调用方通过 flush() 感知本次结果
    this.#queue = task.catch(() => {})
    return task
  }
}
