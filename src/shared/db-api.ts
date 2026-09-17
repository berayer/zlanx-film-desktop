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
  filmPoster?: string | null
  filmYear?: string | null
  filmRegion?: string | null
  filmLatest?: string | null
  filmDesc?: string | null
  createdAt: string
  updatedAt: string
}

/** 新增收藏时由渲染进程提交的字段（`id` / 时间戳由数据库生成） */
export type FavoriteFilmInput = Pick<
  FavoriteFilm,
  | "plugin"
  | "pluginName"
  | "filmId"
  | "filmTitle"
  | "filmPoster"
  | "filmYear"
  | "filmRegion"
  | "filmLatest"
  | "filmDesc"
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
}
