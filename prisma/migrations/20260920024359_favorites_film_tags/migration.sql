/*
  Warnings:

  - You are about to drop the column `film_latest` on the `FavoritesFilm` table. All the data in the column will be lost.
  - You are about to drop the column `film_region` on the `FavoritesFilm` table. All the data in the column will be lost.
  - You are about to drop the column `film_year` on the `FavoritesFilm` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FavoritesFilm" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "plugin" TEXT NOT NULL,
    "plugin_name" TEXT NOT NULL,
    "film_id" TEXT NOT NULL,
    "film_title" TEXT NOT NULL,
    "film_poster" TEXT,
    "film_tags" JSONB NOT NULL DEFAULT [],
    "film_desc" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_FavoritesFilm" ("created_at", "film_desc", "film_id", "film_poster", "film_title", "id", "plugin", "plugin_name", "updated_at") SELECT "created_at", "film_desc", "film_id", "film_poster", "film_title", "id", "plugin", "plugin_name", "updated_at" FROM "FavoritesFilm";
DROP TABLE "FavoritesFilm";
ALTER TABLE "new_FavoritesFilm" RENAME TO "FavoritesFilm";
CREATE INDEX "FavoritesFilm_created_at_idx" ON "FavoritesFilm"("created_at");
CREATE UNIQUE INDEX "FavoritesFilm_plugin_film_id_key" ON "FavoritesFilm"("plugin", "film_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
