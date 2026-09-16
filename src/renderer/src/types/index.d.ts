export type MediaInfo = {
  id: string
  url: string
  name: string
  img: string
  /** 提供该结果的插件 ID，播放页据此调用对应影视源 */
  pluginId: string
  /** 来源插件名，用于卡片角标 */
  sourceName: string
}
