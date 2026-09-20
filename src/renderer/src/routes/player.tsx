import { createFileRoute, Link } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import ReactPlayer from "react-player"
import {
  MediaControlBar,
  MediaController,
  MediaFullscreenButton,
  MediaMuteButton,
  MediaPlayButton,
  MediaPlaybackRateButton,
  MediaSeekBackwardButton,
  MediaSeekForwardButton,
  MediaTimeDisplay,
  MediaTimeRange,
  MediaVolumeRange,
} from "media-chrome/react"
import { Button } from "@/components/ui/button"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EpisodeGrid, type EpisodeWatchedInfo } from "@/components/custom/episode-grid"
import { FilmTagList } from "@/components/custom/film-tag-list"
import { parseFilmTags } from "@/lib/film-tags"
import { formatDuration } from "@/lib/utils"
import { rendererLog } from "@/lib/logger"
import type { Film, FilmSourceEpisode } from "@shared/plugin-api"
import {
  ArrowLeftIcon,
  CircleAlertIcon,
  CopyIcon,
  HistoryIcon,
  MonitorPlayIcon,
  RefreshCwIcon,
  SkipBackIcon,
  SkipForwardIcon,
  StarIcon,
} from "lucide-react"

/** 播放页逻辑日志（走 electron-log，最终与主进程汇入同一份日志） */
const log = rendererLog.scope("player")

/** 两次落库之间至少需要推进这么多秒，避免 timeupdate 频繁写盘 */
const PROGRESS_SAVE_INTERVAL = 5
/** 小于这个秒数不写历史：只是点开了一下，不该被标记成「看过」 */
const PROGRESS_MIN_SECONDS = 1
/** 上次进度超过这个秒数才提示「跳回上次」，几秒钟的位置没有跳转价值 */
const RESUME_MIN_SECONDS = 10
/** 播放到 95% 视为看完：看完的集数不再提示续播 */
const FINISHED_RATIO = 0.95

type PlayerParams = {
  /** 影片在影视源内的 ID，用于回查详情 */
  id?: string
  /** 提供该影片的插件 ID */
  plugin?: string
}

/**
 * 详情请求结果，附带它对应的请求 key。
 *
 * 页面不靠 useEffect 清空状态（会触发 set-state-in-effect），
 * 而是「结果的 key 与当前请求的 key 不一致 → 视为过期、展示加载态」，
 * 这样切换影片时旧结果的回填会被自动忽略。
 */
interface DetailResult {
  key: string
  film?: Film
  error?: string
}

/** 播放地址请求结果，同样按 key 判定是否属于当前正在播放的剧集 */
interface PlaybackResult {
  key: string
  url?: string
  error?: string
}

/** 同一个 key 既能表示「影片请求」也能表示「剧集请求」，统一在这里拼 */
function requestKeyOf(plugin: string, id: string): string {
  return `${plugin}::${id}`
}

export const Route = createFileRoute("/player")({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): PlayerParams => ({
    id: typeof search.id === "string" ? search.id : undefined,
    plugin: typeof search.plugin === "string" ? search.plugin : undefined,
  }),
})

function RouteComponent() {
  const { id, plugin } = Route.useSearch()

  const [detail, setDetail] = useState<DetailResult>()
  const [playback, setPlayback] = useState<PlaybackResult>()
  const [sourceIndex, setSourceIndex] = useState(0)
  /**
   * 用户点选的剧集（带 key：key 与当前影片不一致就视为过期）。
   *
   * 只有「点击集数」才会写入它 —— 进入页面、切换线路都不改动，
   * 因此取播放地址的 effect 不会自动发起请求，正在播放的视频也不会被打断。
   */
  const [picked, setPicked] = useState<{ key: string; episode: FilmSourceEpisode }>()
  /** 是否允许起播：进入页面为 false，用户点过一次集数后才置为 true */
  const [autoPlay, setAutoPlay] = useState(false)
  /** 自增以重跑「取详情」/「取播放地址」的 effect */
  const [retryNonce, setRetryNonce] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  /** 收藏状态也带 key：`undefined` 表示还没查到，按钮先禁用 */
  const [favorite, setFavorite] = useState<{ key: string; value: boolean }>()
  const [pluginName, setPluginName] = useState<string>()
  const [favoriteBusy, setFavoriteBusy] = useState(false)
  /** 收藏操作的一次性提示（几秒后自动消失） */
  const [hint, setHint] = useState<string>()

  /* ---------------------------- 播放历史 ---------------------------- */

  /**
   * 当前影片各集的历史进度，同样带 key。
   * key 与当前影片不一致时视为过期（切影片后旧的「已看」标记不会串到新片）。
   */
  const [watchedState, setWatchedState] = useState<{ key: string; map: Map<string, EpisodeWatchedInfo> }>()
  /** 底层 media 元素句柄：跳回上次进度要靠它设置 currentTime */
  const mediaRef = useRef<HTMLVideoElement | null>(null)
  /** 上一次落库的进度，用来做节流 */
  const lastSavedRef = useRef<{ episodeId: string; position: number } | undefined>(undefined)
  /** 已经用过「跳回上次进度」的剧集；再换集会重新出现 */
  const [resumeUsedKey, setResumeUsedKey] = useState<string>()
  /** 已经自然播放过上次进度位置的剧集（不必再提示） */
  const [resumePastKey, setResumePastKey] = useState<string>()

  /* ---------------------------- 影片详情 ---------------------------- */

  const detailKey = id && plugin ? requestKeyOf(plugin, id) : undefined
  const detailLoading = detailKey !== undefined && detail?.key !== detailKey
  // key 一致才算「属于当前请求」，过期结果一律忽略（影片切换后旧结果不会串台）
  const loadedDetail = detail?.key === detailKey ? detail : undefined
  const film = loadedDetail?.film
  const detailError = loadedDetail?.error

  useEffect(() => {
    if (!id || !plugin) {
      return
    }
    const key = requestKeyOf(plugin, id)
    let cancelled = false
    void (async () => {
      try {
        const result = await window.electron.plugins.call(plugin, "getDetail", id)
        log.debug(`getDetail(${plugin}/${id}) => ${result ? result.title : "undefined"}`)
        if (cancelled) {
          return
        }
        setDetail({ key, film: result ?? undefined })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.error(`getDetail 失败（${plugin}/${id}）：${message}`)
        if (cancelled) {
          return
        }
        setDetail({ key, error: message })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id, plugin, retryNonce])

  /** 线路（剧集分组），过滤掉空分组 */
  const sources = useMemo(() => film?.sources?.filter((group) => group.length > 0) ?? [], [film])
  // 切换影片后线路下标可能越界，这里统一收敛到第一条
  const activeSourceIndex = sources.length > 0 ? Math.min(sourceIndex, sources.length - 1) : 0
  const episodes = useMemo(() => sources[activeSourceIndex] ?? [], [sources, activeSourceIndex])

  /** 过期（换了影片）的选中项直接忽略，等价于「新影片还没选集」 */
  const pickedEpisode = picked && picked.key === detailKey ? picked.episode : undefined

  /**
   * 正在播放的剧集 = 用户点选的那一条。
   *
   * 刻意不要求它必须存在于当前线路里：切换线路只换右侧的集数列表，
   * 当前播放照旧（切线路本身不应该打断播放），只有点击集数才会换片源。
   * 同理也不做 `?? episodes[0]` 兜底 —— 兜底会凭空产生一条已选剧集并触发起播。
   */
  const activeEpisode = pickedEpisode

  /** 当前剧集在当前线路里的下标；切线路后它可能不在这个列表里（-1） */
  const activeEpisodeIndex = activeEpisode ? episodes.findIndex((item) => item.id === activeEpisode.id) : -1

  /* ---------------------------- 播放地址 ---------------------------- */

  const episodeKey = activeEpisode && plugin ? requestKeyOf(plugin, activeEpisode.id) : undefined
  const playLoading = episodeKey !== undefined && playback?.key !== episodeKey
  const loadedPlayback = playback?.key === episodeKey ? playback : undefined
  const playUrl = loadedPlayback?.url
  const playError = loadedPlayback?.error

  /**
   * 只在「用户点选了剧集」时才解析播放地址。
   *
   * 依赖只认 pickedEpisode（点击产生）与 retryNonce（手动重试）：
   * 切线路不会改动 pickedEpisode，也就不会重新取地址、不会打断当前播放。
   */
  useEffect(() => {
    if (!plugin || !pickedEpisode) {
      return
    }
    const key = requestKeyOf(plugin, pickedEpisode.id)
    let cancelled = false
    void (async () => {
      try {
        const url = await window.electron.plugins.call(plugin, "getPlayUrl", pickedEpisode.id)
        if (cancelled) {
          return
        }
        if (url) {
          setPlayback({ key, url })
          return
        }
        // getPlayUrl 没给地址时，退回到剧集自带的播放页 / 直链
        if (pickedEpisode.url) {
          log.info(`getPlayUrl(${plugin}/${pickedEpisode.id}) 未返回地址，回退到剧集自带 url`)
          setPlayback({ key, url: pickedEpisode.url })
          return
        }
        setPlayback({ key, error: "该影视源没有返回可播放的地址" })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.error(`getPlayUrl 失败（${plugin}/${pickedEpisode.id}）：${message}`)
        if (!cancelled) {
          setPlayback({ key, error: message })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [plugin, pickedEpisode, retryNonce])

  /* ---------------------------- 播放历史 ---------------------------- */

  // key 一致才算「属于当前影片」，切影片后旧标记自动失效
  const watchedMap = watchedState !== undefined && watchedState.key === detailKey ? watchedState.map : undefined

  /** 进入 / 切换影片时拉取该片的观看记录（用于标记看过的集数 + 续播提示） */
  useEffect(() => {
    if (!id || !plugin) {
      return
    }
    const key = requestKeyOf(plugin, id)
    let cancelled = false
    void (async () => {
      try {
        const rows = await window.electron.api.getFilmWatchHistory(plugin, id)
        log.debug(`播放历史：${plugin}/${id} 共 ${rows.length} 条`)
        if (cancelled) {
          return
        }
        setWatchedState({
          key,
          map: new Map(rows.map((row) => [row.episodeId, { position: row.position, duration: row.duration }])),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.error(`读取播放历史失败（${plugin}/${id}）：${message}`)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id, plugin])

  /** 上报观看进度：同一集每推进 5 秒才落一次库，`force` 用于暂停 / 切集时补写 */
  const reportProgress = useCallback(
    (episode: FilmSourceEpisode, position: number, duration: number, force = false) => {
      if (!id || !plugin || !film || !Number.isFinite(position) || position < PROGRESS_MIN_SECONDS) {
        return
      }
      const last = lastSavedRef.current
      if (!force && last?.episodeId === episode.id && Math.abs(last.position - position) < PROGRESS_SAVE_INTERVAL) {
        return
      }
      lastSavedRef.current = { episodeId: episode.id, position }
      const total = Number.isFinite(duration) && duration > 0 ? duration : 0
      void window.electron.api
        .saveWatchProgress({
          plugin,
          pluginName: pluginName ?? plugin,
          filmId: id,
          filmTitle: film.title,
          filmPoster: film.poster,
          episodeId: episode.id,
          episodeTitle: episode.title,
          position,
          duration: total,
        })
        .then((saved) => {
          setWatchedState((prev) => {
            if (!prev || prev.key !== detailKey) {
              return prev
            }
            const next = new Map(prev.map)
            next.set(saved.episodeId, { position: saved.position, duration: saved.duration })
            return { key: prev.key, map: next }
          })
        })
        .catch((cause: unknown) => {
          const message = cause instanceof Error ? cause.message : String(cause)
          log.warn(`保存播放进度失败（${plugin}/${episode.id}）：${message}`)
        })
    },
    [detailKey, film, id, plugin, pluginName],
  )

  /** 当前剧集上次看到的位置；看完了、位置太短都不值得提示 */
  const resumePosition = useMemo(() => {
    if (!activeEpisode) {
      return undefined
    }
    const info = watchedMap?.get(activeEpisode.id)
    if (!info || info.position < RESUME_MIN_SECONDS) {
      return undefined
    }
    if (info.duration > 0 && info.position / info.duration >= FINISHED_RATIO) {
      return undefined
    }
    return info.position
  }, [activeEpisode, watchedMap])

  const showResume =
    resumePosition !== undefined &&
    episodeKey !== undefined &&
    resumeUsedKey !== episodeKey &&
    resumePastKey !== episodeKey

  /** 跳回上次观看的位置（用户主动点击才触发，进入页面不会自动 seek） */
  const seekToResume = () => {
    const element = mediaRef.current
    if (!element || resumePosition === undefined) {
      return
    }
    element.currentTime = resumePosition
    setResumeUsedKey(episodeKey)
    if (element.paused) {
      void element.play().catch((error: unknown) => {
        log.warn(`续播失败：${error instanceof Error ? error.message : String(error)}`)
      })
    }
  }

  /** 播放过程中的时间更新：被动记录进度 + 判断是否需要收起续播提示 */
  const handleTimeUpdate = (time: number, duration: number) => {
    if (resumePosition !== undefined && episodeKey !== undefined && time > resumePosition + 3) {
      setResumePastKey(episodeKey)
    }
    if (activeEpisode) {
      reportProgress(activeEpisode, time, duration)
    }
  }

  /* ---------------------------- 收藏 ---------------------------- */

  /** 一次性提示（收藏 / 取消收藏的反馈），几秒后自动消失 */
  const showHint = (message: string) => {
    setHint(message)
    setTimeout(() => setHint(undefined), 2400)
  }

  // key 一致才算「属于当前影片」，undefined 表示还没查到
  const isFavorite = (favorite?.key === detailKey ? favorite : undefined)?.value

  // 进入播放页时查一次「是否已收藏」，顺带取影视源名称（写入收藏时要用）
  useEffect(() => {
    if (!id || !plugin) {
      return
    }
    const key = requestKeyOf(plugin, id)
    let cancelled = false
    void (async () => {
      try {
        const [exists, info] = await Promise.all([
          window.electron.api.isFavoritesFilm(plugin, id),
          window.electron.plugins.get(plugin),
        ])
        log.debug(`isFavoritesFilm(${plugin}/${id}) => ${exists}`)
        if (cancelled) {
          return
        }
        setFavorite({ key, value: exists })
        setPluginName(info?.manifest.name ?? plugin)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.error(`读取收藏状态失败（${plugin}/${id}）：${message}`)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id, plugin])

  const toggleFavorite = async () => {
    if (!id || !plugin || !film || isFavorite === undefined) {
      return
    }
    setFavoriteBusy(true)
    try {
      if (isFavorite) {
        await window.electron.api.removeFavoritesFilm(plugin, id)
        setFavorite({ key: requestKeyOf(plugin, id), value: false })
        showHint("已取消收藏")
      } else {
        await window.electron.api.addFavoritesFilm({
          plugin,
          pluginName: pluginName ?? plugin,
          filmId: id,
          filmTitle: film.title,
          filmPoster: film.poster,
        })
        setFavorite({ key: requestKeyOf(plugin, id), value: true })
        showHint("已加入收藏")
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error(`更新收藏失败（${plugin}/${id}）：${message}`)
      showHint(`收藏失败：${message}`)
    } finally {
      setFavoriteBusy(false)
    }
  }

  /* ---------------------------- 交互 ---------------------------- */

  /** 切线路只换右侧的集数列表：不动已选剧集，因此既不发请求也不打断播放 */
  const selectSource = (index: number) => {
    setSourceIndex(index)
  }

  /** 只有点集数才会走到这里：写入已选剧集并允许起播 */
  const selectEpisode = (episode: FilmSourceEpisode) => {
    if (!detailKey) {
      return
    }
    setPicked({ key: detailKey, episode })
    setAutoPlay(true)
    setCopied(false)
  }

  /** 上一集 / 下一集：越界不动，播放结束时自动跳下一集 */
  const jump = (offset: number) => {
    if (activeEpisodeIndex < 0) {
      return
    }
    const next = episodes[activeEpisodeIndex + offset]
    if (next) {
      selectEpisode(next)
    }
  }

  const copyPlayUrl = () => {
    if (!playUrl) {
      return
    }
    void navigator.clipboard
      .writeText(playUrl)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
      })
      .catch((error: unknown) => {
        log.warn(`复制播放地址失败：${error instanceof Error ? error.message : String(error)}`)
      })
  }

  const handlePlayerError = () => {
    setPlayback({ key: episodeKey ?? "", error: "播放失败：地址可能已失效，或被防盗链 / 跨域策略拦截" })
  }

  const retry = () => setRetryNonce((value) => value + 1)

  /** 只有当前剧集就在当前线路里时才显示「第几集 / 共几集」 */
  const episodePosition = activeEpisodeIndex >= 0 ? `${activeEpisodeIndex + 1}/${episodes.length}` : undefined

  /* ---------------------------- 渲染：无参数 ---------------------------- */

  if (!detailKey) {
    return (
      <StatePanel
        icon={<MonitorPlayIcon className="size-8" />}
        title="还没有选择影片"
        description="请先在搜索页挑选一部影片，再进入播放页"
        action={
          <Link to="/search" search={{ q: "" }}>
            <Button variant="outline" size="sm">
              <ArrowLeftIcon />
              去搜索
            </Button>
          </Link>
        }
      />
    )
  }

  /* ---------------------------- 渲染：加载 / 失败 ---------------------------- */

  if (detailError) {
    return (
      <StatePanel
        icon={<CircleAlertIcon className="size-8 text-destructive" />}
        title="获取影片详情失败"
        description={detailError}
        action={
          <Button variant="outline" size="sm" onClick={retry}>
            <RefreshCwIcon />
            重试
          </Button>
        }
      />
    )
  }

  if (detailLoading) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-6" />
        <span>正在加载影片详情…</span>
      </div>
    )
  }

  if (!film) {
    return (
      <StatePanel
        icon={<MonitorPlayIcon className="size-8" />}
        title="没有找到该影片"
        description="影视源未返回详情，可能已被下架或 ID 已变更"
        action={
          <Link to="/search" search={{ q: "" }}>
            <Button variant="outline" size="sm">
              <ArrowLeftIcon />
              返回搜索
            </Button>
          </Link>
        }
      />
    )
  }

  /** 标签信息：直接渲染影视源返回的原始 tags，顺序与内容都由影视源决定 */
  const tags = parseFilmTags(film.tags)

  /* ---------------------------- 渲染：正常播放 ---------------------------- */

  return (
    <div className="flex h-full min-h-0 gap-3 p-3">
      {/* 左侧：播放器 + 当前剧集信息 */}
      <section className="flex flex-1 flex-col gap-2">
        <div className="relative aspect-video w-full flex-1 overflow-hidden rounded-lg bg-black ring-1 ring-foreground/10">
          {playUrl ? (
            /* 控制条用 Media Chrome（react-player 官方推荐的自定义 UI 方案），
               不再使用原生 controls；
               注意：不能给 ReactPlayer 传 playing —— 它内部 effect 没有依赖数组，
               每次渲染都会把暂停中的播放器重新拉起来 */
            <MediaController className="size-full bg-black">
              <ReactPlayer
                key={playUrl}
                ref={mediaRef}
                slot="media"
                src={playUrl}
                autoPlay={autoPlay}
                width="100%"
                height="100%"
                style={{ width: "100%", height: "100%" }}
                poster={film.poster}
                onTimeUpdate={(event) =>
                  handleTimeUpdate(event.currentTarget.currentTime, event.currentTarget.duration)
                }
                onPause={(event) => {
                  if (activeEpisode) {
                    reportProgress(activeEpisode, event.currentTarget.currentTime, event.currentTarget.duration, true)
                  }
                }}
                onEnded={(event) => {
                  // 看完把进度补写成总时长，这一集就不会再提示续播
                  if (activeEpisode) {
                    reportProgress(activeEpisode, event.currentTarget.duration, event.currentTarget.duration, true)
                  }
                  jump(1)
                }}
                onError={handlePlayerError}
              />
              <MediaControlBar>
                <MediaPlayButton />
                <MediaSeekBackwardButton seekOffset={10} />
                <MediaSeekForwardButton seekOffset={10} />
                <MediaTimeRange />
                <MediaTimeDisplay showDuration />
                <MediaMuteButton />
                <MediaVolumeRange />
                <MediaPlaybackRateButton />
                <MediaFullscreenButton />
              </MediaControlBar>
            </MediaController>
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-white/70">
              {playLoading ? (
                <>
                  <Spinner className="size-6" />
                  <span>正在解析播放地址…</span>
                </>
              ) : playError ? (
                <>
                  <CircleAlertIcon className="size-6 text-red-400" />
                  <span>{playError}</span>
                  <Button variant="outline" size="sm" className="text-foreground" onClick={retry}>
                    <RefreshCwIcon />
                    重试
                  </Button>
                </>
              ) : (
                <>
                  <MonitorPlayIcon className="size-6" />
                  <span>
                    {sources.length > 0
                      ? "点击右侧集数开始播放（切换线路不会自动播放）"
                      : "该影视源没有提供可播放的剧集"}
                  </span>
                </>
              )}
            </div>
          )}

          {/* 看过这集且没看完时，右下角给一个「回到上次进度」入口；
              位置抬到控制条上方，避免压住 Media Chrome 的进度条 */}
          {showResume && (
            <Button
              size="sm"
              onClick={seekToResume}
              title={`跳转到上次观看的位置 ${formatDuration(resumePosition ?? 0)}`}
              className="absolute right-3 bottom-14 z-10 bg-primary/90 text-primary-foreground shadow-lg hover:bg-primary"
            >
              <HistoryIcon />
              回到 {formatDuration(resumePosition ?? 0)}
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="truncate text-base font-medium">{film.title}</h1>
            <p className="truncate text-xs text-muted-foreground">
              {activeEpisode ? `正在播放：${activeEpisode.title}` : "未选择剧集"}
              {episodePosition ? `（${episodePosition}）` : ""}
              {` · 来源：${pluginName ?? plugin}`}
              {hint ? <span className="ml-2 text-primary">{hint}</span> : null}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant={isFavorite ? "default" : "outline"}
              size="sm"
              disabled={isFavorite === undefined || favoriteBusy}
              onClick={() => void toggleFavorite()}
              title={isFavorite ? "取消收藏" : "加入收藏"}
            >
              <StarIcon className={isFavorite ? "fill-current" : undefined} />
              {isFavorite ? "已收藏" : "收藏"}
            </Button>
            <Button variant="outline" size="sm" disabled={activeEpisodeIndex <= 0} onClick={() => jump(-1)}>
              <SkipBackIcon />
              上一集
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={activeEpisodeIndex < 0 || activeEpisodeIndex === episodes.length - 1}
              onClick={() => jump(1)}
            >
              下一集
              <SkipForwardIcon />
            </Button>
            <Button variant="outline" size="sm" disabled={!playUrl} onClick={copyPlayUrl} title="复制当前播放地址">
              <CopyIcon />
              {copied ? "已复制" : "复制地址"}
            </Button>
          </div>
        </div>
      </section>

      {/* 右侧：影片信息 + 线路 + 选集 */}
      <aside className="flex min-h-0 w-80 shrink-0 flex-col gap-3">
        <div className="flex gap-3">
          <div className="aspect-2/3 w-24 shrink-0 overflow-hidden rounded-md bg-muted">
            {film.poster ? (
              <img
                src={film.poster}
                alt={film.title}
                referrerPolicy="no-referrer"
                className="size-full object-cover"
                onError={(event) => {
                  event.currentTarget.style.visibility = "hidden"
                }}
              />
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm font-medium">{film.title}</p>
            <FilmTagList tags={tags} className="mt-1.5" />
          </div>
        </div>

        {film.description ? (
          <div className="text-xs text-muted-foreground">
            <p className={expanded ? "" : "line-clamp-3"}>{film.description}</p>
            <button
              type="button"
              className="mt-1 text-xs text-primary hover:underline"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "收起" : "展开简介"}
            </button>
          </div>
        ) : null}

        {sources.length > 0 ? (
          <ScrollArea className="">
            <Tabs
              className="h-12"
              value={String(activeSourceIndex)}
              onValueChange={(value) => selectSource(Number(value))}
            >
              {/* 线路可能有很多条：超宽时横向滚动，而不是把按钮挤变形（或撑破右栏） */}
              <TabsList>
                {sources.map((group, index) => (
                  <TabsTrigger key={index} value={String(index)}>
                    线路 {index + 1}（{group.length}）
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        ) : (
          <p className="text-xs text-muted-foreground">该影视源没有返回剧集列表</p>
        )}

        <ScrollArea className="min-h-0 flex-1 pr-1">
          <EpisodeGrid
            episodes={episodes}
            activeId={activeEpisode?.id}
            watched={watchedMap}
            pending={playLoading}
            onSelect={selectEpisode}
          />
        </ScrollArea>
      </aside>
    </div>
  )
}

/** 占位状态：无参数 / 详情失败 / 影片不存在时复用 */
function StatePanel({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
      {icon}
      <p className="text-foreground">{title}</p>
      {description && <p className="max-w-md text-center text-xs">{description}</p>}
      {action}
    </div>
  )
}
