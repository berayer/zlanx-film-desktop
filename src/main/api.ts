import { ipcMain } from "electron"
import { hostLog } from "./logger"
import { prisma } from "./lib/db"
import {
  DB_API_IPC,
  type FavoriteFilm,
  type FavoriteFilmInput,
  type WatchHistoryEntry,
  type WatchProgressInput,
} from "@shared/db-api"

/** 收藏相关日志（作用域 `db`，底层 electron-log） */
const log = hostLog.scope("db")

/** Prisma 行 → IPC DTO：日期转成 ISO 字符串 */
function toFavoriteFilm(row: {
  id: number
  plugin: string
  pluginName: string
  filmId: string
  filmTitle: string
  filmPoster: string | null
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
  }
}

/** Prisma 行 → 播放历史 DTO */
function toWatchHistoryEntry(row: {
  id: number
  plugin: string
  pluginName: string
  filmId: string
  filmTitle: string
  filmPoster: string | null
  episodeId: string
  episodeTitle: string
  position: number
  duration: number
  createdAt: Date
  updatedAt: Date
}): WatchHistoryEntry {
  return {
    id: row.id,
    plugin: row.plugin,
    pluginName: row.pluginName,
    filmId: row.filmId,
    filmTitle: row.filmTitle,
    filmPoster: row.filmPoster,
    episodeId: row.episodeId,
    episodeTitle: row.episodeTitle,
    position: row.position,
    duration: row.duration,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** 秒数合法性兜底：NaN / 负数 / Infinity 一律归零，避免脏数据写进库 */
function normalizeSeconds(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0
  }
  return Math.round(value * 1000) / 1000
}

/**
 * 注册收藏 / 播放历史相关的 IPC handler。
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

  /* ---------------------------- 播放历史 ---------------------------- */

  // 历史列表（最近看的排前面）
  ipcMain.handle(DB_API_IPC.getWatchHistory, async (_event, limit?: number): Promise<WatchHistoryEntry[]> => {
    const rows = await prisma.watchHistory.findMany({
      orderBy: { updatedAt: "desc" },
      take: typeof limit === "number" && limit > 0 ? Math.floor(limit) : undefined,
    })
    return rows.map(toWatchHistoryEntry)
  })

  // 单部片的观看记录（播放页标记已看过的集数）
  ipcMain.handle(
    DB_API_IPC.getFilmWatchHistory,
    async (_event, plugin: string, filmId: string): Promise<WatchHistoryEntry[]> => {
      const rows = await prisma.watchHistory.findMany({ where: { plugin, filmId }, orderBy: { updatedAt: "desc" } })
      return rows.map(toWatchHistoryEntry)
    },
  )

  // 上报进度：影视源 + 影片 + 剧集 唯一，重复观看会覆盖同一条记录
  ipcMain.handle(
    DB_API_IPC.saveWatchProgress,
    async (_event, entry: WatchProgressInput): Promise<WatchHistoryEntry> => {
      const data = {
        plugin: entry.plugin,
        pluginName: entry.pluginName,
        filmId: entry.filmId,
        filmTitle: entry.filmTitle,
        filmPoster: entry.filmPoster?.trim() || null,
        episodeId: entry.episodeId,
        episodeTitle: entry.episodeTitle,
        position: normalizeSeconds(entry.position),
        duration: normalizeSeconds(entry.duration),
      }
      const row = await prisma.watchHistory.upsert({
        where: { plugin_filmId_episodeId: { plugin: data.plugin, filmId: data.filmId, episodeId: data.episodeId } },
        create: data,
        update: data,
      })
      return toWatchHistoryEntry(row)
    },
  )

  // 删除历史：给了 entryId 只删这一集，否则整部片一起删
  ipcMain.handle(
    DB_API_IPC.removeWatchHistory,
    async (_event, plugin: string, filmId: string, entryId?: number): Promise<number> => {
      const result = await prisma.watchHistory.deleteMany({
        where: { plugin, filmId, id: entryId },
      })
      if (result.count > 0) {
        log.info(`已删除播放历史：${plugin} / ${filmId}${entryId === undefined ? "" : ` / ${entryId}`}`)
      }
      return result.count
    },
  )

  // 清空历史
  ipcMain.handle(DB_API_IPC.clearWatchHistory, async (): Promise<number> => {
    const result = await prisma.watchHistory.deleteMany()
    if (result.count > 0) {
      log.info(`已清空播放历史（${result.count} 条）`)
    }
    return result.count
  })
}
