import { ipcMain } from "electron"
import { hostLog } from "./logger"
import { prisma } from "./lib/db"
import { DB_API_IPC, type FavoriteFilm, type FavoriteFilmInput } from "@shared/db-api"

/** 收藏相关日志（作用域 `db`，底层 electron-log） */
const log = hostLog.scope("db")

/** Prisma 行 → IPC DTO：日期转成 ISO 字符串，字段顺序与 DTO 对齐 */
function toFavoriteFilm(row: {
  id: number
  plugin: string
  pluginName: string
  filmId: string
  filmTitle: string
  filmPoster: string | null
  filmYear: string | null
  filmRegion: string | null
  filmLatest: string | null
  filmDesc: string | null
  createdAt: Date
  updatedAt: Date
}): FavoriteFilm {
  return {
    id: row.id,
    plugin: row.plugin,
    pluginName: row.pluginName,
    filmId: row.filmId,
    filmTitle: row.filmTitle,
    filmPoster: row.filmPoster,
    filmYear: row.filmYear,
    filmRegion: row.filmRegion,
    filmLatest: row.filmLatest,
    filmDesc: row.filmDesc,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** 渲染进程提交的输入 → Prisma 写入数据：空串一律归一成 null */
function toCreateData(film: FavoriteFilmInput) {
  return {
    plugin: film.plugin,
    pluginName: film.pluginName,
    filmId: film.filmId,
    filmTitle: film.filmTitle,
    filmPoster: film.filmPoster?.trim() || null,
    filmYear: film.filmYear?.trim() || null,
    filmRegion: film.filmRegion?.trim() || null,
    filmLatest: film.filmLatest?.trim() || null,
    filmDesc: film.filmDesc?.trim() || null,
  }
}

/**
 * 注册收藏相关的 IPC handler。
 *
 * 通道名见 `@shared/db-api` 的 `DB_API_IPC`；
 * 由 `src/main/index.ts` 在 `app.whenReady` 里调用一次。
 */
export const registerApi = (): void => {
  // 获取收藏列表（最新收藏的排前面）
  ipcMain.handle(DB_API_IPC.getFavoritesFilms, async (): Promise<FavoriteFilm[]> => {
    const rows = await prisma.favoritesFilm.findMany({ orderBy: { createdAt: "desc" } })
    return rows.map(toFavoriteFilm)
  })

  // 加入收藏：同一影视源 + 同一影片已存在时更新信息，避免唯一键冲突
  ipcMain.handle(DB_API_IPC.addFavoritesFilm, async (_event, film: FavoriteFilmInput): Promise<FavoriteFilm> => {
    const data = toCreateData(film)
    const row = await prisma.favoritesFilm.upsert({
      where: { plugin_filmId: { plugin: data.plugin, filmId: data.filmId } },
      create: data,
      update: data,
    })
    log.info(`已收藏：${row.pluginName} / ${row.filmTitle}`)
    return toFavoriteFilm(row)
  })

  // 取消收藏
  ipcMain.handle(DB_API_IPC.removeFavoritesFilm, async (_event, plugin: string, filmId: string): Promise<boolean> => {
    const result = await prisma.favoritesFilm.deleteMany({ where: { plugin, filmId } })
    if (result.count > 0) {
      log.info(`已取消收藏：${plugin} / ${filmId}`)
    }
    return result.count > 0
  })

  // 当前是否已收藏
  ipcMain.handle(DB_API_IPC.isFavoritesFilm, async (_event, plugin: string, filmId: string): Promise<boolean> => {
    const count = await prisma.favoritesFilm.count({ where: { plugin, filmId } })
    return count > 0
  })
}
