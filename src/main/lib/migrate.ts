import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { app } from "electron"
import Database from "better-sqlite3"
import { is } from "@electron-toolkit/utils"
import { hostLog } from "@main/logger"
import { databaseFile } from "@main/lib/db-path"

/**
 * 启动时的数据库迁移。
 *
 * 打包产物里不能跑 `prisma migrate deploy`（那需要 prisma CLI + schema-engine），
 * 所以这里直接执行 `prisma/migrations/*\/migration.sql` —— Prisma 为 SQLite 生成的
 * 迁移本来就是纯 SQL，自己按顺序跑一遍等价于 `migrate deploy`：
 *   - extraResources 把 prisma/migrations 拷到安装包的 resources/migrations；
 *   - 用一张 `_migrations` 表记录已执行过的迁移名（等价于 _prisma_migrations）；
 *   - 每个迁移单独一个事务，失败即回滚，下次启动会重试。
 *
 * 开发态直接读仓库里的 prisma/migrations，所以 `pnpm exec prisma migrate dev`
 * 生成的迁移文件仍然是唯一真源。
 */

/** 记录已执行迁移的表 */
const MIGRATIONS_TABLE = "_migrations"

const log = hostLog.scope("db")

interface Migration {
  /** 迁移目录名，形如 `20260920030752_slim_favorites_film` */
  name: string
  sql: string
}

/** 迁移脚本目录：dev 读仓库，打包后读 extraResources 拷过去的 resources/migrations */
function migrationsDirectory(): string {
  return is.dev
    ? path.join(app.getAppPath(), "prisma", "migrations")
    : path.join(process.resourcesPath, "migrations")
}

/** 按目录名字典序读出全部迁移（字典序即时间序，与 Prisma 的约定一致） */
function readMigrations(directory: string): Migration[] {
  if (!existsSync(directory)) {
    return []
  }

  const migrations: Migration[] = []
  for (const name of readdirSync(directory).sort()) {
    const sqlPath = path.join(directory, name, "migration.sql")
    if (!existsSync(sqlPath)) {
      continue
    }
    const sql = readFileSync(sqlPath, "utf8").trim()
    if (sql.length > 0) {
      migrations.push({ name, sql })
    }
  }
  return migrations
}

/**
 * 执行所有未执行过的迁移，返回本次新增执行的条数。
 *
 * 语句交给 better-sqlite3 的 `exec`（而不是 Prisma 的 `$executeRawUnsafe`）：
 * 后者一次只能跑一条语句，而 Prisma 的迁移文件是多语句的（含 PRAGMA）。
 */
export function runMigrations(): number {
  const directory = migrationsDirectory()
  const migrations = readMigrations(directory)
  if (migrations.length === 0) {
    log.warn(`未找到任何迁移脚本：${directory}`)
    return 0
  }

  mkdirSync(path.dirname(databaseFile), { recursive: true })
  const db = new Database(databaseFile)

  try {
    db.exec(
      `CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    )

    const record = db.prepare(`INSERT INTO "${MIGRATIONS_TABLE}" (name) VALUES (?)`)
    const appliedRows = db.prepare(`SELECT name FROM "${MIGRATIONS_TABLE}"`).all() as { name: string }[]
    const applied = new Set(appliedRows.map((row) => row.name))

    let count = 0
    for (const migration of migrations) {
      if (applied.has(migration.name)) {
        continue
      }
      // 单个迁移一个事务：中途失败不会留下半张表
      db.transaction(() => {
        db.exec(migration.sql)
        record.run(migration.name)
      })()
      count += 1
      log.info(`已应用迁移：${migration.name}`)
    }

    if (count === 0) {
      log.debug(`数据库已是最新（共 ${migrations.length} 个迁移）`)
    }
    return count
  } finally {
    db.close()
  }
}
