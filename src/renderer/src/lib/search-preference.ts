import { rendererLog } from "@/lib/logger"

const log = rendererLog.scope("search-preference")

/**
 * 搜索页的界面偏好（不是业务数据，所以直接存在渲染进程的 localStorage）。
 *
 * 目前只有「默认搜索源」一项：进入搜索页时默认选中它，
 * 用户手动切换分栏后以手动选择为准。
 */
const DEFAULT_SOURCE_KEY = "zlanx:search:default-source"

/** 读取默认搜索源（插件 ID）；没设置过或读取失败时返回 undefined */
export function readDefaultSourceId(): string | undefined {
  try {
    const value = window.localStorage.getItem(DEFAULT_SOURCE_KEY)
    return value && value.length > 0 ? value : undefined
  } catch (error) {
    log.warn(`读取默认搜索源失败：${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

/** 写入默认搜索源（插件 ID）；传 undefined 表示清除，回落到「第一个影视源」 */
export function writeDefaultSourceId(id: string | undefined): void {
  try {
    if (id) {
      window.localStorage.setItem(DEFAULT_SOURCE_KEY, id)
    } else {
      window.localStorage.removeItem(DEFAULT_SOURCE_KEY)
    }
  } catch (error) {
    log.warn(`保存默认搜索源失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
