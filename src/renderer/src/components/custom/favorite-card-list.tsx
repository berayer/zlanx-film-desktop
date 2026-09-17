import { Link } from "@tanstack/react-router"
import type { FavoriteFilm } from "@shared/db-api"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { StarIcon, Trash2Icon } from "lucide-react"

export interface FavoriteCardListProps {
  items: FavoriteFilm[]
  /** 正在取消收藏的条目 ID（按钮进入 loading 且置灰） */
  busyId?: number
  onRemove: (item: FavoriteFilm) => void
  className?: string
}

/** 收藏海报墙：点卡片进播放页，右上角星标取消收藏 */
export function FavoriteCardList({ items, busyId, onRemove, className }: FavoriteCardListProps) {
  return (
    <div
      className={cn("grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7", className)}
    >
      {items.map((item) => (
        <FavoriteCard key={item.id} item={item} busy={busyId === item.id} onRemove={onRemove} />
      ))}
    </div>
  )
}

function FavoriteCard({
  item,
  busy,
  onRemove,
}: {
  item: FavoriteFilm
  busy: boolean
  onRemove: (item: FavoriteFilm) => void
}) {
  const meta = [item.filmYear, item.filmRegion].filter(Boolean).join(" · ")

  return (
    <div className="group relative">
      <Link
        to="/player"
        search={{ id: item.filmId, plugin: item.plugin }}
        title={`${item.filmTitle}（${item.pluginName}）`}
        className="block focus:outline-none"
      >
        <div className="relative aspect-2/3 w-full overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10">
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            暂无封面
          </div>
          {item.filmPoster && (
            <img
              src={item.filmPoster}
              alt={item.filmTitle}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={(event) => {
                event.currentTarget.style.visibility = "hidden"
              }}
              className="absolute inset-0 size-full object-cover transition duration-300 group-hover:scale-105"
            />
          )}
          {item.filmLatest && (
            <span className="absolute top-1 right-1 max-w-[70%] truncate rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
              {item.filmLatest}
            </span>
          )}
          <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
            {item.pluginName}
          </span>
          <div className="absolute inset-0 bg-black/0 transition group-hover:bg-black/10" />
        </div>
        <p
          className="mt-2 line-clamp-2 text-sm text-foreground/80 transition group-hover:text-foreground"
          title={item.filmTitle}
        >
          {item.filmTitle}
        </p>
        {meta.length > 0 && <p className="truncate text-xs text-muted-foreground">{meta}</p>}
      </Link>

      <Button
        variant="secondary"
        size="icon"
        disabled={busy}
        title="取消收藏"
        onClick={() => onRemove(item)}
        className="absolute top-1 left-1 size-7 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
      >
        {busy ? <StarIcon className="animate-pulse fill-current" /> : <Trash2Icon />}
      </Button>
    </div>
  )
}

/** 收藏页加载占位（列数与 FavoriteCardList 保持一致） */
export function FavoriteCardListSkeleton({ count = 14 }: { count?: number }) {
  return (
    <div className="grid animate-pulse grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
      {Array.from({ length: count }, (_, index) => (
        <div key={index}>
          <div className="aspect-2/3 w-full rounded-lg bg-muted" />
          <div className="mt-2 h-4 w-4/5 rounded bg-muted" />
          <div className="mt-1 h-3 w-2/5 rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}
