import type { FilmSourceEpisode } from "@shared/plugin-api"
import { cn } from "@/lib/utils"

export interface EpisodeGridProps {
  /** 当前线路下的全部剧集 */
  episodes: FilmSourceEpisode[]
  /** 正在播放的剧集 ID（高亮） */
  activeId?: string
  /** 拉取播放地址中：禁止重复点击，但当前剧集仍可点（等于重试） */
  pending?: boolean
  onSelect: (episode: FilmSourceEpisode) => void
  className?: string
}

/** 剧集宫格：一行三列，标题过长自动截断（完整标题在 title 里） */
export function EpisodeGrid({ episodes, activeId, pending, onSelect, className }: EpisodeGridProps) {
  return (
    <div className={cn("grid grid-cols-3 gap-2", className)}>
      {episodes.map((episode) => {
        const active = episode.id === activeId
        return (
          <button
            key={episode.id}
            type="button"
            title={episode.title}
            disabled={pending === true && !active}
            onClick={() => onSelect(episode)}
            className={cn(
              "truncate rounded-md border px-2 py-1.5 text-xs transition disabled:opacity-50",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-foreground/80 hover:border-primary/60 hover:text-foreground",
            )}
          >
            {episode.title}
          </button>
        )
      })}
    </div>
  )
}

/** 详情加载中的剧集占位 */
export function EpisodeGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid animate-pulse grid-cols-3 gap-2">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="h-8 rounded-md bg-muted" />
      ))}
    </div>
  )
}
