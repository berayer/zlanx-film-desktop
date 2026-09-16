import type { PluginCallOptions } from "@main/plugin/interface"

/**
 * 宿主声明的「影视源插件 API」。
 *
 * 这一份接口就是 `PluginManager<SourceApi>` 的泛型实参：
 * 插件在 `index.js` 里实现其中的任意方法，宿主通过 `manager.call(id, "search", kw)` 调用。
 * 要新增 / 修改可调用的方法，只需改这里——插件管理器本身不含任何业务概念。
 */

/** 搜索结果条目 */
export interface SourceSearchItem {
  /** 站内唯一 ID，用于后续取详情 / 播放地址 */
  id: string
  /** 标题 */
  title: string
  /** 封面图地址 */
  cover?: string
  /** 备注（更新状态、评分等） */
  remark?: string
  /** 允许源自行扩展字段 */
  [key: string]: unknown
}

/** 详情 / 剧集 */
export interface SourceEpisode {
  /** 剧集 ID，用于取播放地址 */
  id: string
  title: string
  /** 部分源会直接给出播放页地址 */
  url?: string
}

/** 影片详情 */
export interface SourceDetail extends SourceSearchItem {
  description?: string
  episodes?: SourceEpisode[]
}

/** 影视源插件可以实现的方法 */
export interface SourceApi {
  /** 按关键字搜索 */
  search(keyword: string, options?: PluginCallOptions): Promise<SourceSearchItem[]>
  /** 取影片详情（含剧集列表） */
  getDetail(id: string, options?: PluginCallOptions): Promise<SourceDetail | undefined>
  /** 取播放地址 */
  getPlayUrl(id: string, options?: PluginCallOptions): Promise<string | undefined>
}
