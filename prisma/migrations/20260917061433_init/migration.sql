-- CreateTable
CREATE TABLE "FavoritesFilm" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "plugin" TEXT NOT NULL,
    "film_id" TEXT NOT NULL,
    "film_poster" TEXT,
    "film_title" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "FavoritesFilm_plugin_film_id_key" ON "FavoritesFilm"("plugin", "film_id");
