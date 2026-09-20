/**
 * 收藏相关的 IPC 契约（main / preload / renderer 共用）。
 *
 * 这里刻意 **不直接暴露 Prisma 生成的类型**：
 * - `@generated/prisma` 只在主进程可见，渲染进程不该依赖它；
 * - IPC 是结构化克隆，日期统一转成 ISO 字符串更好预期。
 * 主进程在 `src/main/api.ts` 里负责把 Prisma 行映射成这里的 DTO。
 */
export const DB_API_IPC = {
  getFavoritesFilms: "api:getFavoritesFilms",
  addFavoritesFilm: "api:addFavoritesFilm",
  removeFavoritesFilm: "api:removeFavoritesFilm",
  isFavoritesFilm: "api:isFavoritesFilm",
  getWatchHistory: "api:getWatchHistory",
  getFilmWatchHistory: "api:getFilmWatchHistory",
  saveWatchProgress: "api:saveWatchProgress",
  removeWatchHistory: "api:removeWatchHistory",
  clearWatchHistory: "api:clearWatchHistory",
} as const

/** 收藏条目（DTO，`createdAt` 为 ISO 字符串） */
export interface FavoriteFilm {
  id: number
  /** 影视源插件 ID */
  plugin: string
  /** 影视源插件名（展示用，插件被卸载后仍保留当时的名字） */
  pluginName: string
  /** 影片在影视源内的 ID */
  filmId: string
  filmTitle: string
  /** 只存列表渲染需要的字段（封面 / 片名 / 来源），详情与标签每次进播放页重新向影视源取 */
  filmPoster?: string | null
  createdAt: string
  updatedAt: string
}

/** 新增收藏时由渲染进程提交的字段（`id` / 时间戳由数据库生成） */
export type FavoriteFilmInput = Pick<FavoriteFilm, "plugin" | "pluginName" | "filmId" | "filmTitle" | "filmPoster">

/** 一条播放历史（DTO）：影视源 + 影片 + 剧集 唯一，`position` / `duration` 单位为秒 */
export interface WatchHistoryEntry {
  id: number
  /** 影视源插件 ID */
  plugin: string
  /** 影视源名称快照 */
  pluginName: string
  /** 影片在影视源内的 ID */
  filmId: string
  filmTitle: string
  filmPoster?: string | null
  /** 剧集 ID（同一影视源内唯一） */
  episodeId: string
  episodeTitle: string
  /** 已播放到的秒数 */
  position: number
  /** 总时长（秒），还没拿到元数据时为 0 */
  duration: number
  createdAt: string
  updatedAt: string
}

/** 上报播放进度时由渲染进程提交的字段 */
export type WatchProgressInput = Pick<
  WatchHistoryEntry,
  | "plugin"
  | "pluginName"
  | "filmId"
  | "filmTitle"
  | "filmPoster"
  | "episodeId"
  | "episodeTitle"
  | "position"
  | "duration"
>

export interface DB_API {
  /** 全部收藏，按收藏时间倒序 */
  getFavoritesFilms: () => Promise<FavoriteFilm[]>
  /** 加入收藏；已收藏过同一部片时按最新信息覆盖（upsert） */
  addFavoritesFilm: (film: FavoriteFilmInput) => Promise<FavoriteFilm>
  /** 取消收藏，返回是否有记录被删除 */
  removeFavoritesFilm: (plugin: string, filmId: string) => Promise<boolean>
  /** 该影视源下的这部片是否已收藏 */
  isFavoritesFilm: (plugin: string, filmId: string) => Promise<boolean>

  /** 全部播放历史，按最近观看时间倒序 */
  getWatchHistory: (limit?: number) => Promise<WatchHistoryEntry[]>
  /** 某部片在该影视源下的观看记录（播放页用它标记已看过的集数） */
  getFilmWatchHistory: (plugin: string, filmId: string) => Promise<WatchHistoryEntry[]>
  /** 上报 / 续写播放进度，同集数已存在则覆盖 */
  saveWatchProgress: (entry: WatchProgressInput) => Promise<WatchHistoryEntry>
  /** 删除某条历史；`entryId` 为 undefined 时删除整部片的历史，返回删除条数 */
  removeWatchHistory: (plugin: string, filmId: string, entryId?: number) => Promise<number>
  /** 清空全部播放历史，返回删除条数 */
  clearWatchHistory: () => Promise<number>
}
