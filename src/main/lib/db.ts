import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3"
import { PrismaClient } from "@generated/prisma/client"
import { connectionString } from "@main/lib/db-path"

/**
 * Prisma 客户端（单例）。
 *
 * 数据库文件位置统一由 `@main/lib/db-path` 决定（dev 走 .env 的 DATABASE_URL，
 * 打包后走 userData/data/dev.db）；表结构则由 `@main/lib/migrate` 在启动时
 * 执行 prisma/migrations 里的 SQL 补齐，所以这里拿到连接即可直接使用。
 */
const adapter = new PrismaBetterSqlite3({ url: connectionString })
const prisma = new PrismaClient({ adapter })

export { prisma, connectionString }
