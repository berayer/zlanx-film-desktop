import { mkdirSync } from "node:fs"
import path from "node:path"
import { app } from "electron"
import "dotenv/config"
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3"
import { PrismaClient } from "@generated/prisma/client"

/**
 * SQLite 文件位置。
 *
 * dev 用 `.env` 里的 `DATABASE_URL`（`file:./data/dev.db`，相对项目根目录）；
 * 打包后没有 `.env`，退回到用户数据目录，否则连接串会变成 "undefined"。
 */
function databaseUrl(): string {
  const fromEnv = process.env["DATABASE_URL"]?.trim()
  if (fromEnv) {
    return fromEnv
  }
  return `file:${path.join(app.getPath("userData"), "data", "dev.db")}`
}

const connectionString = databaseUrl()

// better-sqlite3 不会自动建目录，dev 首次启动 / 打包后首次运行时要补上
mkdirSync(path.dirname(path.resolve(connectionString.replace(/^file:/, ""))), { recursive: true })

const adapter = new PrismaBetterSqlite3({ url: connectionString })
const prisma = new PrismaClient({ adapter })

export { prisma, connectionString }
