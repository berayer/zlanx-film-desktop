import { rename, stat, writeFile } from "node:fs/promises"

/** 判断路径是否存在（不存在或不可访问都返回 false） */
export async function exists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

/** 原子写文件：先写临时文件再重命名，避免写一半被中断 */
export async function writeAtomic(file: string, content: string): Promise<void> {
  const tmp = `${file}.${Date.now()}.tmp`
  await writeFile(tmp, content, "utf8")
  await rename(tmp, file)
}
