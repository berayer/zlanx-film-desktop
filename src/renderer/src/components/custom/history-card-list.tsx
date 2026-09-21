import { Link } from "@tanstack/react-router"
import type { WatchHistoryEntry } from "@shared/db-api"
import { Button } from "@/components/ui/button"
import { cn, formatDuration, formatRelativeTime } from "@/lib/utils"
import { MonitorPlayIcon, Trash2Icon } from "lucide-react"

/**
 * 历史列表里的「一部片」：同一影视源 + 同一影片的多集记录合并成一张卡片，
 * 卡片展示最近观看的那一集（合并逻辑在 `routes/history.tsx` 里做）。
 */
export interface HistoryGroup {
  key: string
  plugin: string
  pluginName: string
  filmId: string
  filmTitle: string
  filmPoster?: string | null
  /** 最近一次观看的记录（也是进度条的来源） */
  latest: WatchHistoryEntry
  /** 这部片累计看过多少集 */
  count: number
}

/** 已看完的判定阈值：看到 95% 以上就算看完 */
const FINISHED_RATIO = 0.95

/** 进度比例：拿不到总时长时返回 0（UI 不画进度条） */
function ratioOf(position: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) {
    return 0
  }
  if (!Number.isFinite(position) || position <= 0) {
    return 0
  }
  return Math.min(1, position / duration)
}

export interface HistoryCardListProps {
  items: HistoryGroup[]
  /** 正在删除的分组（按钮进入 loading 且置灰） */
  busyKey?: string
  onRemove: (group: HistoryGroup) => void
  className?: string
}

/** 播放历史海报墙：点卡片进播放页，左上角垃圾桶删除整部片的历史 */
export function HistoryCardList({ items, busyKey, onRemove, className }: HistoryCardListProps) {
  return (
    <div
      className={cn("grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7", className)}
    >
      {items.map((group) => (
        <HistoryCard key={group.key} group={group} busy={busyKey === group.key} onRemove={onRemove} />
      ))}
    </div>
  )
}

function HistoryCard({
  group,
  busy,
  onRemove,
}: {
  group: HistoryGroup
  busy: boolean
  onRemove: (group: HistoryGroup) => void
}) {
  const { latest } = group
  const ratio = ratioOf(latest.position, latest.duration)
  const finished = ratio >= FINISHED_RATIO

  return (
    <div className="group relative">
      <Link
        to="/player"
        search={{ id: group.filmId, plugin: group.plugin }}
        title={`${group.filmTitle}（${group.pluginName}）`}
        className="block focus:outline-none"
      >
        <div className="relative aspect-2/3 w-full overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10">
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            暂无封面
          </div>
          {group.filmPoster && (
            <img
              src={group.filmPoster}
              alt={group.filmTitle}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={(event) => {
                event.currentTarget.style.visibility = "hidden"
              }}
              className="absolute inset-0 size-full object-cover transition duration-300 group-hover:scale-105"
            />
          )}
          {/* 封面上的播放按钮提示 */}
          <span className="absolute inset-0 flex items-center justify-center text-white/0 transition group-hover:bg-black/25 group-hover:text-white/90">
            <MonitorPlayIcon className="size-7 drop-shadow" />
          </span>
          <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
            {group.pluginName}
          </span>
          {group.count > 1 && (
            <span className="absolute top-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
              {group.count} 集
            </span>
          )}
          {/* 底部进度条：看完是主色，没看完是琥珀色 */}
          <span className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
            <span
              className={cn("block h-full transition-all", finished ? "bg-primary" : "bg-amber-400")}
              style={{ width: `${Math.round(ratio * 100)}%` }}
            />
          </span>
        </div>

        <p
          className="mt-2 line-clamp-2 text-sm text-foreground/80 transition group-hover:text-foreground"
          title={group.filmTitle}
        >
          {group.filmTitle}
        </p>
        <p className="truncate text-xs text-muted-foreground" title={latest.episodeTitle}>
          {finished ? "已看完" : `看到 ${formatDuration(latest.position)}`} · {latest.episodeTitle}
        </p>
        <p className="truncate text-[11px] text-muted-foreground/70">{formatRelativeTime(latest.updatedAt)}</p>
      </Link>

      <Button
        variant="secondary"
        size="icon"
        disabled={busy}
        title="删除这部片的历史记录"
        onClick={() => onRemove(group)}
        className="absolute top-1 left-1 size-7 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Trash2Icon />
      </Button>
    </div>
  )
}
