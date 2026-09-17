import { createFileRoute, Link } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import ReactPlayer from "react-player"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EpisodeGrid, EpisodeGridSkeleton } from "@/components/custom/episode-grid"
import { rendererLog } from "@/lib/logger"
import type { Film, FilmSourceEpisode } from "@shared/plugin-api"
import {
  ArrowLeftIcon,
  CircleAlertIcon,
  CopyIcon,
  LoaderCircleIcon,
  MonitorPlayIcon,
  RefreshCwIcon,
  SkipBackIcon,
  SkipForwardIcon,
  StarIcon,
} from "lucide-react"

/** 播放页逻辑日志（走 electron-log，最终与主进程汇入同一份日志） */
const log = rendererLog.scope("player")

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
  const [pickedEpisodeId, setPickedEpisodeId] = useState<string>()
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
  // 切换影片 / 线路后 pickedEpisodeId 可能越界，这里统一收敛到第一条
  const activeSourceIndex = sources.length > 0 ? Math.min(sourceIndex, sources.length - 1) : 0
  const episodes = useMemo(() => sources[activeSourceIndex] ?? [], [sources, activeSourceIndex])

  const activeEpisode = useMemo(() => {
    if (episodes.length === 0) {
      return undefined
    }
    return episodes.find((item) => item.id === pickedEpisodeId) ?? episodes[0]
  }, [episodes, pickedEpisodeId])

  /* ---------------------------- 播放地址 ---------------------------- */

  const episodeKey = activeEpisode && plugin ? requestKeyOf(plugin, activeEpisode.id) : undefined
  const playLoading = episodeKey !== undefined && playback?.key !== episodeKey
  const loadedPlayback = playback?.key === episodeKey ? playback : undefined
  const playUrl = loadedPlayback?.url
  const playError = loadedPlayback?.error

  useEffect(() => {
    if (!plugin || !activeEpisode) {
      return
    }
    const key = requestKeyOf(plugin, activeEpisode.id)
    let cancelled = false
    void (async () => {
      try {
        const url = await window.electron.plugins.call(plugin, "getPlayUrl", activeEpisode.id)
        if (cancelled) {
          return
        }
        if (url) {
          setPlayback({ key, url })
          return
        }
        // getPlayUrl 没给地址时，退回到剧集自带的播放页 / 直链
        if (activeEpisode.url) {
          log.info(`getPlayUrl(${plugin}/${activeEpisode.id}) 未返回地址，回退到剧集自带 url`)
          setPlayback({ key, url: activeEpisode.url })
          return
        }
        setPlayback({ key, error: "该影视源没有返回可播放的地址" })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.error(`getPlayUrl 失败（${plugin}/${activeEpisode.id}）：${message}`)
        if (!cancelled) {
          setPlayback({ key, error: message })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [plugin, activeEpisode, retryNonce])

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
          filmYear: film.year,
          filmRegion: film.region,
          filmLatest: film.latest,
          filmDesc: film.description,
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

  const selectSource = (index: number) => {
    setSourceIndex(index)
    setPickedEpisodeId(undefined)
  }

  const selectEpisode = (episode: FilmSourceEpisode) => {
    setPickedEpisodeId(episode.id)
    setCopied(false)
  }

  /** 上一集 / 下一集：越界不动，播放结束时自动跳下一集 */
  const jump = (offset: number) => {
    if (!activeEpisode) {
      return
    }
    const current = episodes.findIndex((item) => item.id === activeEpisode.id)
    const next = current >= 0 ? episodes[current + offset] : undefined
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

  const episodePosition = activeEpisode
    ? `${episodes.findIndex((item) => item.id === activeEpisode.id) + 1}/${episodes.length}`
    : undefined

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
      <div className="flex h-full min-h-0 flex-col gap-3 p-3 lg:flex-row">
        <div className="aspect-video w-full flex-1 animate-pulse rounded-lg bg-muted" />
        <div className="flex w-full shrink-0 flex-col gap-2 lg:w-80">
          <div className="h-40 w-full animate-pulse rounded-lg bg-muted" />
          <EpisodeGridSkeleton />
        </div>
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

  const meta = [film.year, film.region, film.genres?.slice(0, 3).join("/")].filter(Boolean).join(" · ")

  /* ---------------------------- 渲染：正常播放 ---------------------------- */

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 lg:flex-row">
      {/* 左侧：播放器 + 当前剧集信息 */}
      <section className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black ring-1 ring-foreground/10">
          {playUrl ? (
            <ReactPlayer
              key={playUrl}
              src={playUrl}
              controls
              playing
              width="100%"
              height="100%"
              poster={film.poster}
              onEnded={() => jump(1)}
              onError={handlePlayerError}
            />
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-white/70">
              {playLoading ? (
                <>
                  <LoaderCircleIcon className="size-6 animate-spin" />
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
                  <span>{sources.length > 0 ? "请选择要播放的剧集" : "该影视源没有提供可播放的剧集"}</span>
                </>
              )}
            </div>
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
            <Button
              variant="outline"
              size="sm"
              disabled={!activeEpisode || episodes[0]?.id === activeEpisode.id}
              onClick={() => jump(-1)}
            >
              <SkipBackIcon />
              上一集
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!activeEpisode || episodes[episodes.length - 1]?.id === activeEpisode.id}
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
      <aside className="flex min-h-0 w-full shrink-0 flex-col gap-3 lg:w-80">
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
            <div className="mt-1 flex flex-wrap gap-1">
              {typeof film.rating === "number" && film.rating > 0 && (
                <Badge variant="secondary">{film.rating.toFixed(1)} 分</Badge>
              )}
              {film.latest && <Badge variant="outline">{film.latest}</Badge>}
            </div>
            {meta.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{meta}</p>}
            {film.latestDate && <p className="mt-0.5 text-xs text-muted-foreground">更新：{film.latestDate}</p>}
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
          <Tabs value={String(activeSourceIndex)} onValueChange={(value) => selectSource(Number(value))}>
            <TabsList>
              {sources.map((group, index) => (
                <TabsTrigger key={index} value={String(index)}>
                  线路 {index + 1}（{group.length}）
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : (
          <p className="text-xs text-muted-foreground">该影视源没有返回剧集列表</p>
        )}

        <ScrollArea className="min-h-0 flex-1 pr-1">
          <EpisodeGrid
            episodes={episodes}
            activeId={activeEpisode?.id}
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
