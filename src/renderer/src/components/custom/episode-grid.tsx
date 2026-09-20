import type { FilmSourceEpisode } from "@shared/plugin-api"
import { cn, formatDuration } from "@/lib/utils"

/** 一集曾经观看到的位置（用于标记已观看与「跳回上次进度」） */
export interface EpisodeWatchedInfo {
  /** 已播放到的秒数 */
  position: number
  /** 总时长（秒），还没拿到元数据时为 0 */
  duration: number
}

export interface EpisodeGridProps {
  /** 当前线路下的全部剧集 */
  episodes: FilmSourceEpisode[]
  /** 正在播放的剧集 ID（高亮） */
  activeId?: string
  /** 已观看过的集数：key 是剧集 ID */
  watched?: Map<string, EpisodeWatchedInfo>
  /** 拉取播放地址中：禁止重复点击，但当前剧集仍可点（等于重试） */
  pending?: boolean
  onSelect: (episode: FilmSourceEpisode) => void
  className?: string
}

/** 已看完的判定阈值：看到 95% 以上就算看完 */
const FINISHED_RATIO = 0.95

function ratioOf(info: EpisodeWatchedInfo): number {
  if (!Number.isFinite(info.duration) || info.duration <= 0) {
    return 0
  }
  if (!Number.isFinite(info.position) || info.position <= 0) {
    return 0
  }
  return Math.min(1, info.position / info.duration)
}

/** 剧集宫格：一行三列，看过 / 看完的集数用不同颜色标记 */
export function EpisodeGrid({ episodes, activeId, watched, pending, onSelect, className }: EpisodeGridProps) {
  return (
    <div className={cn("grid grid-cols-3 gap-2", className)}>
      {episodes.map((episode) => {
        const active = episode.id === activeId
        const info = watched?.get(episode.id)
        const finished = info !== undefined && ratioOf(info) >= FINISHED_RATIO
        const title =
          info === undefined
            ? episode.title
            : `${episode.title}（${finished ? "已看完" : `看到 ${formatDuration(info.position)}`}）`

        return (
          <button
            key={episode.id}
            type="button"
            title={title}
            disabled={pending === true && !active}
            onClick={() => onSelect(episode)}
            className={cn(
              "relative truncate overflow-hidden rounded-md border px-2 py-1.5 text-xs transition disabled:opacity-50",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : info !== undefined
                  ? // 看过的集数：绿色系区分；看完用实心绿底，没看完用浅绿底 + 底部进度条
                    finished
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 hover:border-emerald-500 dark:text-emerald-300"
                    : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700/80 hover:border-emerald-500 hover:text-emerald-700 dark:text-emerald-300/80 dark:hover:text-emerald-300"
                  : "border-border text-foreground/80 hover:border-primary/60 hover:text-foreground",
            )}
          >
            {episode.title}
            {!active && info !== undefined && ratioOf(info) < FINISHED_RATIO && (
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-0.5 bg-emerald-500/60"
                style={{ width: `${Math.round(ratioOf(info) * 100)}%` }}
              />
            )}
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
