import type { PluginCallOptions } from "@main/plugin/interface"

/**
 * 宿主声明的「影视源插件 API」。
 *
 * 这一份接口就是 `PluginManager<SourceApi>` 的泛型实参：
 * 插件在 `index.js` 里实现其中的任意方法，宿主通过 `manager.call(id, "search", kw)` 调用。
 * 要新增 / 修改可调用的方法，只需改这里——插件管理器本身不含任何业务概念。
 */

/**
 * 影片标签：`[属性, 取值]`，例如 `["年份：", "2026"]`。
 *
 * 影视源给的字段各不相同，用这种二元组可以在不改 schema 的前提下渲染任意信息；
 * 宿主会把它渲染在详情区，并随收藏一起入库。
 */
export type FilmTag = [label: string, value: string]

/** 搜索结果条目 */
export interface Film {
  /** 站内唯一 ID，用于后续取详情 / 播放地址 */
  id: string
  /** 影片名称 */
  title: string
  /** 影片海报 */
  poster?: string
  /** 影片年份 */
  year?: string
  /** 影片地区 */
  region?: string
  /** 影片类型 */
  genres?: string[]
  /** 影片描述 */
  description?: string
  /** 影片评分 */
  rating?: number
  /** 最新状态 */
  latest?: string
  /** 最新更新日期 */
  latestDate?: string
  /** 影片源， 可以有多个，每个有多集 */
  sources?: Array<FilmSourceEpisode[]>
  /** 影片标签，宿主原样按数组顺序渲染（顺序与内容都由影视源决定） */
  tags?: FilmTag[]
  /** 允许源自行扩展字段 */
  [key: string]: unknown
}

/** 详情 / 剧集 */
export interface FilmSourceEpisode {
  /** 剧集 ID，用于取播放地址 */
  id: string
  title: string
  /** 部分源会直接给出播放页地址 */
  url?: string
}

/** 影视源插件可以实现的方法 */
export interface SourceApi {
  /** 按关键字搜索 */
  search(keyword: string, options?: PluginCallOptions): Promise<Film[]>
  /** 取影片详情（含剧集列表） */
  getDetail(id: string, options?: PluginCallOptions): Promise<Film | undefined>
  /** 取播放地址 */
  getPlayUrl(id: string, options?: PluginCallOptions): Promise<string | undefined>
}
