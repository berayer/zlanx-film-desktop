import type { Film } from "@shared/plugin-api"

/**
 * 搜索结果的内存缓存。
 *
 * - **只活在渲染进程内存里**：模块级 Map，应用重启（或页面重新加载）即失效，
 *   不落盘、不进 localStorage，避免把插件的返回数据长期留在磁盘上；
 * - **按「影视源 + 关键词」缓存**：同一个关键词在不同源上的结果互不干扰；
 * - **上限 {@link MAX_CACHED_SEARCHES} 条**，超出后淘汰最久未使用的一条，
 *   防止用户长时间浏览（不断换关键词）把内存撑大；
 * - **只缓存成功的结果**：失败（网络 / 插件报错）不缓存，重试时仍会真的重新请求。
 */
const MAX_CACHED_SEARCHES = 20

/** key → 该次搜索的影片列表；Map 的迭代顺序就是插入顺序，用来实现 LRU */
const cache = new Map<string, Film[]>()

function cacheKey(pluginId: string, keyword: string): string {
  return `${pluginId}::${keyword}`
}

/**
 * 读取缓存（纯读，不改动顺序）。
 *
 * 刻意不在读的时候做 LRU 续期：读它的地方包括渲染期的 `resultOf`，
 * 渲染期间改共享可变状态容易在并发渲染下出意外。续期走 {@link touchCachedSearch}，
 * 由 effect 在「确认这次搜索不需要请求」时调用。
 */
export function getCachedSearch(pluginId: string, keyword: string): Film[] | undefined {
  return cache.get(cacheKey(pluginId, keyword))
}

/**
 * 把某条缓存标记为「刚用过」（挪到队尾）。
 *
 * 这样淘汰掉的始终是最久没有被用到的那次搜索，而不是最早搜的那次。
 */
export function touchCachedSearch(pluginId: string, keyword: string): void {
  const key = cacheKey(pluginId, keyword)
  const hit = cache.get(key)
  if (hit === undefined) {
    return
  }
  cache.delete(key)
  cache.set(key, hit)
}

/** 写入缓存，并按 LRU 裁剪到上限 */
export function setCachedSearch(pluginId: string, keyword: string, films: Film[]): void {
  const key = cacheKey(pluginId, keyword)
  cache.delete(key)
  cache.set(key, films)

  while (cache.size > MAX_CACHED_SEARCHES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) {
      break
    }
    cache.delete(oldest)
  }
}

/** 丢弃某一次搜索的缓存（「重新搜索」时用，保证会真的重新请求一次） */
export function discardCachedSearch(pluginId: string, keyword: string): void {
  cache.delete(cacheKey(pluginId, keyword))
}

/** 当前缓存条数（调试用） */
export function cachedSearchCount(): number {
  return cache.size
}
