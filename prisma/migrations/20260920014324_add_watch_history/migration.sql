-- CreateTable
CREATE TABLE "WatchHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "plugin" TEXT NOT NULL,
    "plugin_name" TEXT NOT NULL,
    "film_id" TEXT NOT NULL,
    "film_title" TEXT NOT NULL,
    "film_poster" TEXT,
    "episode_id" TEXT NOT NULL,
    "episode_title" TEXT NOT NULL,
    "position" REAL NOT NULL DEFAULT 0,
    "duration" REAL NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "WatchHistory_updated_at_idx" ON "WatchHistory"("updated_at");

-- CreateIndex
CREATE INDEX "WatchHistory_plugin_film_id_idx" ON "WatchHistory"("plugin", "film_id");

-- CreateIndex
CREATE UNIQUE INDEX "WatchHistory_plugin_film_id_episode_id_key" ON "WatchHistory"("plugin", "film_id", "episode_id");
