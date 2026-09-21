import { Link } from "@tanstack/react-router"
import type { Film } from "@shared/plugin-api"
import { cn } from "@/lib/utils"

export interface FilmCardListProps {
  /** 插件 search 返回的影片列表 */
  items: Film[]
  /** 提供这些结果的插件 ID，播放页据此回查详情 / 播放地址 */
  pluginId: string
  /** 来源插件名，展示在卡片角标 */
  sourceName: string
  className?: string
}

/** 影片海报墙：点击卡片带着「站内 ID + 来源插件」跳转播放页 */
export function FilmCardList({ items, pluginId, sourceName, className }: FilmCardListProps) {
  return (
    <div
      className={cn("grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7", className)}
    >
      {items.map((film) => (
        <FilmCard key={`${pluginId}:${film.id}`} film={film} pluginId={pluginId} sourceName={sourceName} />
      ))}
    </div>
  )
}

function FilmCard({ film, pluginId, sourceName }: { film: Film; pluginId: string; sourceName: string }) {
  const meta = [film.year, film.region, film.genres?.slice(0, 2).join("/")].filter(Boolean).join(" · ")

  return (
    <Link
      to="/player"
      search={{ id: film.id, plugin: pluginId }}
      title={film.title}
      className="group block focus:outline-none"
    >
      <div className="relative aspect-2/3 w-full overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10">
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">暂无封面</div>
        {film.poster && (
          <img
            src={film.poster}
            alt={film.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(event) => {
              event.currentTarget.style.visibility = "hidden"
            }}
            className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
        )}
        {typeof film.rating === "number" && film.rating > 0 && (
          <span className="absolute top-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
            {film.rating.toFixed(1)}
          </span>
        )}
        {film.latest && (
          <span className="absolute top-1 right-1 max-w-[70%] truncate rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
            {film.latest}
          </span>
        )}
        <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
          {sourceName}
        </span>
        <div className="absolute inset-0 bg-black/0 transition group-hover:bg-black/10" />
      </div>
      <p
        className="mt-2 line-clamp-2 text-sm text-foreground/80 transition group-hover:text-foreground"
        title={film.title}
      >
        {film.title}
      </p>
      {meta.length > 0 && <p className="truncate text-xs text-muted-foreground">{meta}</p>}
    </Link>
  )
}
