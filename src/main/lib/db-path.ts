import { mkdirSync } from "node:fs"
import path from "node:path"
import { app } from "electron"
import "dotenv/config"

/**
 * SQLite 文件位置。
 *
 * 这里是主进程里唯一的数据库路径来源：**系统迁移**（`lib/migrate.ts`）与
 * 业务连接（`lib/db.ts`）都从这里取，避免两边各算一遍出现偏差。
 *
 * - dev：用 `.env` 里的 `DATABASE_URL`（`file:./data/dev.db`，相对项目根目录）
 * - 打包后：没有 `.env`，退回到用户数据目录，否则连接串会变成 "undefined"
 *
 * 打包后必须落在 userData：asar 只读、安装目录可能没有写权限，
 * 而且放在 app.asar 里会随覆盖安装被冲掉。
 */
function resolveDatabaseFile(): string {
  const fromEnv = process.env["DATABASE_URL"]?.trim()
  const raw = fromEnv
    ? fromEnv.replace(/^file:/, "")
    : path.join(app.getPath("userData"), "data", "dev.db")
  return path.isAbsolute(raw) ? raw : path.resolve(raw)
}

export const databaseFile = resolveDatabaseFile()

// better-sqlite3 不会自动建目录，dev 首次启动 / 打包后首次运行时要补上
mkdirSync(path.dirname(databaseFile), { recursive: true })

/** 给 Prisma 的连接串（带 `file:` 前缀） */
export const connectionString = `file:${databaseFile}`
