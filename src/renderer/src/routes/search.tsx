import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { LoaderCircleIcon, PackageOpenIcon, RotateCwIcon, SearchIcon, SearchXIcon, StarIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FilmCardList } from "@/components/custom/film-card-list"
import { LoadingPlaceholder } from "@/components/custom/loading-placeholder"
import { readDefaultSourceId, writeDefaultSourceId } from "@/lib/search-preference"
import {
  cachedSearchCount,
  discardCachedSearch,
  getCachedSearch,
  setCachedSearch,
  touchCachedSearch,
} from "@/lib/search-cache"
import { rendererLog } from "@/lib/logger"
import { cn } from "@/lib/utils"
import type { PluginInfo } from "@shared/ipc"
import type { Film } from "@shared/plugin-api"

const log = rendererLog.scope("search")

type SearchParams = {
  q?: string
}

export const Route = createFileRoute("/search")({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): SearchParams => {
    const raw = typeof search.q === "string" ? search.q.trim() : undefined
    return { q: raw && raw.length > 0 ? raw : undefined }
  },
})

/** 单个影视源针对某个关键词的搜索结果 */
interface SourceResult {
  /** 来源插件 ID */
  pluginId: string
  /** 结果对应的关键词：与当前 q 不一致时视为过期数据，按「未搜索」处理 */
  keyword: string
  status: "loading" | "success" | "error"
  items: Film[]
  error?: string
}

/** 插件返回的数据结构不可信，这里收敛成合法的 Film 列表 */
function normalizeFilms(value: unknown): Film[] {
  if (!Array.isArray(value)) {
    return []
  }
  const films: Film[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue
    }
    const film = item as Partial<Film>
    if (film.id === undefined || film.id === null || !film.title) {
      continue
    }
    films.push({ ...(item as Film), id: String(film.id), title: String(film.title) })
  }
  return films
}

function RouteComponent() {
  const { q } = Route.useSearch()

  /** 可调用的影视源（只有 active 状态的插件能被宿主调用） */
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [pluginsLoading, setPluginsLoading] = useState(true)
  const [pluginsError, setPluginsError] = useState<string>()
  /** 用户手动选中的影视源；undefined 时回落到默认搜索源 / 第一个 */
  const [pickedPluginId, setPickedPluginId] = useState<string>()
  /** 默认搜索源（持久化在 localStorage），进入页面且没有手动选择时生效 */
  const [defaultPluginId, setDefaultPluginId] = useState<string | undefined>(() => readDefaultSourceId())
  const [results, setResults] = useState<Record<string, SourceResult>>({})
  /**
   * 已请求过的「源::关键词」→ 当时是自第几轮请求（searchNonce）。
   * 切回已搜索过的分栏直接复用缓存结果；手动重跑时 nonce 变化会让它重新请求。
   */
  const requestedRef = useRef(new Map<string, number>())
  /** 自增即可重跑：插件列表 / 搜索各用一个，避免互相触发 */
  const [pluginNonce, setPluginNonce] = useState(0)
  const [searchNonce, setSearchNonce] = useState(0)

  // 加载影视源列表（首帧由 pluginsLoading 的初始值呈现加载态，await 之后再更新状态）
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const list = await window.electron.plugins.list()
        if (cancelled) {
          return
        }
        setPlugins(list.filter((item) => item.status === "active"))
        setPluginsError(undefined)
      } catch (error) {
        if (cancelled) {
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        log.error(`加载影视源失败：${message}`)
        setPluginsError(message)
      } finally {
        if (!cancelled) {
          setPluginsLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pluginNonce])

  /** 调用单个影视源的 search，失败也返回状态而不是抛出 */
  const searchOne = useCallback(async (pluginId: string, keyword: string): Promise<SourceResult> => {
    try {
      const data = await window.electron.plugins.call(pluginId, "search", keyword)
      const items = normalizeFilms(data)
      log.debug(`[${pluginId}] 搜索「${keyword}」→ ${items.length} 条`)
      return { pluginId, keyword, status: "success", items }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error(`[${pluginId}] 搜索「${keyword}」失败：${message}`)
      return { pluginId, keyword, status: "error", items: [], error: message }
    }
  }, [])

  /** 当前生效的影视源：用户选择 > 默认搜索源 > 第一个 */
  const activePlugin = useMemo(() => {
    if (plugins.length === 0) {
      return undefined
    }
    const picked = plugins.find((item) => item.manifest.id === pickedPluginId)
    if (picked) {
      return picked
    }
    const fallback = plugins.find((item) => item.manifest.id === defaultPluginId)
    return fallback ?? plugins[0]
  }, [plugins, pickedPluginId, defaultPluginId])

  const activeId = activePlugin?.manifest.id ?? ""
  const activeName = activePlugin?.manifest.name ?? ""

  // 只搜索当前选中的影视源：切换分栏 / 换关键词 / 手动重跑时才发请求
  useEffect(() => {
    if (!q || !activeId) {
      return
    }
    const key = `${activeId}::${q}`
    if (requestedRef.current.get(key) === searchNonce) {
      return
    }
    requestedRef.current.set(key, searchNonce)

    // 内存缓存命中：连请求都不用发 —— 渲染层由 resultOf 直接读同一份缓存，
    // 所以这里不需要 setState（切回搜过的分栏、甚至重进搜索页都是立刻出结果）
    if (getCachedSearch(activeId, q)) {
      touchCachedSearch(activeId, q)
      log.debug(`[${activeId}] 搜索「${q}」命中内存缓存（当前缓存 ${cachedSearchCount()} 条）`)
      return
    }

    let cancelled = false
    void (async () => {
      const state = await searchOne(activeId, q)
      // 只有成功的结果进缓存：失败要留给用户重试。
      // 这里不等 cancelled 判断 —— 用户中途切走（比如点进播放页）时结果同样有效，
      // 留着缓存，回来就不用再搜一次。
      if (state.status === "success") {
        setCachedSearch(activeId, q, state.items)
      }
      if (cancelled) {
        return
      }
      setResults((prev) => ({ ...prev, [activeId]: state }))
    })()
    return () => {
      cancelled = true
    }
  }, [activeId, q, searchNonce, searchOne])

  /** 取某个影视源对当前关键词的结果；没有记录或关键词已变都算「未搜索」 */
  const resultOf = useCallback(
    (pluginId: string | undefined): SourceResult | undefined => {
      if (!pluginId || !q) {
        return undefined
      }
      const state = results[pluginId]
      if (state && state.keyword === q) {
        return state
      }
      // 组件内的 results 会随卸载丢失，内存缓存不会：搜过的「源 + 关键词」直接复用
      const cached = getCachedSearch(pluginId, q)
      if (cached) {
        return { pluginId, keyword: q, status: "success", items: cached }
      }
      return undefined
    },
    [results, q],
  )

  const current = resultOf(activeId)

  /** 重新搜索当前源：丢掉这次搜索的缓存 + 自增轮次，去重标记按轮次判断，命中不了就会重新发请求 */
  const rerun = useCallback(() => {
    if (activeId && q) {
      discardCachedSearch(activeId, q)
    }
    setSearchNonce((value) => value + 1)
  }, [activeId, q])

  const isDefaultSource = defaultPluginId !== undefined && defaultPluginId === activeId

  /** 把当前源设为默认 / 取消默认（取消后回落到列表里的第一个源） */
  const toggleDefaultSource = useCallback(() => {
    const next = isDefaultSource ? undefined : activeId || undefined
    setDefaultPluginId(next)
    writeDefaultSourceId(next)
    log.debug(next ? `默认搜索源已设为 ${next}` : "已清除默认搜索源")
  }, [isDefaultSource, activeId])

  const summary = (() => {
    if (pluginsLoading) {
      return "正在加载影视源…"
    }
    if (pluginsError) {
      return "影视源加载失败"
    }
    if (plugins.length === 0) {
      return "还没有可用的影视源"
    }
    if (!q) {
      return "输入影片名称开始搜索"
    }
    const status = !current ? "搜索中…" : current.status === "error" ? "搜索失败" : `${current.items.length} 条结果`
    return `${activeName} · ${status}（共 ${plugins.length} 个影视源，只搜索当前源）`
  })()

  return (
    <div className="mx-auto w-full max-w-6xl p-6 pt-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-medium">
            {q ? (
              <>
                「<span className="text-primary">{q}</span>」的搜索结果
              </>
            ) : (
              "搜索"
            )}
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">{summary}</p>
        </div>
        <div className="flex items-center gap-2">
          <SearchBox key={q ?? ""} defaultValue={q ?? ""} />
          <Button
            variant={isDefaultSource ? "secondary" : "ghost"}
            size="sm"
            className="gap-1.5"
            disabled={pluginsLoading || plugins.length === 0 || !activeId}
            onClick={toggleDefaultSource}
            title={
              isDefaultSource ? "取消默认搜索源（之后回到列表里的第一个源）" : `进入搜索页时默认选中「${activeName}」`
            }
          >
            <StarIcon className={cn("size-3.5", isDefaultSource && "fill-amber-400 text-amber-500")} />
            {isDefaultSource ? "默认搜索源" : "设为默认"}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="重新搜索当前源"
            disabled={!q || pluginsLoading || plugins.length === 0}
            onClick={rerun}
          >
            <RotateCwIcon />
          </Button>
        </div>
      </div>

      <div className="mt-3">
        {pluginsLoading ? (
          <LoadingPlaceholder label="正在加载影视源…" />
        ) : pluginsError ? (
          <Card size="sm">
            <CardContent>
              <Placeholder
                icon={<SearchXIcon className="size-8" />}
                title="影视源加载失败"
                description={pluginsError}
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setPluginsLoading(true)
                      setPluginNonce((value) => value + 1)
                    }}
                  >
                    <RotateCwIcon />
                    重试
                  </Button>
                }
              />
            </CardContent>
          </Card>
        ) : plugins.length === 0 ? (
          <Card size="sm">
            <CardContent>
              <Placeholder
                icon={<PackageOpenIcon className="size-8" />}
                title="还没有可用的影视源"
                description="安装并启用影视源插件后即可在这里搜索"
                action={
                  <Link to="/plugin" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                    去插件管理
                  </Link>
                }
              />
            </CardContent>
          </Card>
        ) : !q ? (
          <Card size="sm">
            <CardContent>
              <Placeholder
                icon={<SearchIcon className="size-8" />}
                title="输入影片名称开始搜索"
                description="只搜索当前选中的影视源，切换分栏才会去搜索对应的源"
              />
            </CardContent>
          </Card>
        ) : (
          <Tabs value={activeId} onValueChange={(value) => setPickedPluginId(String(value))}>
            <TabsList>
              {plugins.map((plugin) => {
                const pluginId = plugin.manifest.id
                const state = resultOf(pluginId)
                return (
                  <TabsTrigger
                    key={pluginId}
                    value={pluginId}
                    className="gap-1.5"
                    title={
                      pluginId === defaultPluginId ? `${plugin.manifest.name}（默认搜索源）` : plugin.manifest.name
                    }
                  >
                    <span>{plugin.manifest.name}</span>
                    {pluginId === defaultPluginId && <StarIcon className="size-3 fill-amber-400 text-amber-500" />}
                    {/* 只有当前源会真的发请求，没搜过的分栏不做标记 */}
                    {pluginId === activeId && !state && <LoaderCircleIcon className="animate-spin opacity-60" />}
                    {state?.status === "success" && (
                      <Badge variant="secondary" className="h-4 px-1.5">
                        {state.items.length}
                      </Badge>
                    )}
                    {state?.status === "error" && (
                      <Badge variant="destructive" className="h-4 px-1.5">
                        失败
                      </Badge>
                    )}
                  </TabsTrigger>
                )
              })}
            </TabsList>

            <div className="mt-3">
              {current?.status === "error" ? (
                <Card size="sm">
                  <CardContent>
                    <Placeholder
                      icon={<SearchXIcon className="size-8" />}
                      title={`${activeName} 搜索失败`}
                      description={current.error}
                      action={
                        <Button variant="outline" size="sm" onClick={rerun}>
                          <RotateCwIcon />
                          重试
                        </Button>
                      }
                    />
                  </CardContent>
                </Card>
              ) : current?.status === "success" && current.items.length > 0 ? (
                <FilmCardList items={current.items} pluginId={activeId} sourceName={activeName} />
              ) : current?.status === "success" ? (
                <Card size="sm">
                  <CardContent>
                    <Placeholder
                      icon={<PackageOpenIcon className="size-8" />}
                      title={`没有找到与「${q}」相关的影片`}
                      description={`${activeName} 没有返回结果，可以切换其他影视源试试`}
                    />
                  </CardContent>
                </Card>
              ) : (
                <LoadingPlaceholder label="正在搜索…" />
              )}
            </div>
          </Tabs>
        )}
      </div>
    </div>
  )
}

/** 结果区右侧的搜索框：q 变化时通过 key 重挂载，避免用 effect 同步受控值 */
function SearchBox({ defaultValue }: { defaultValue: string }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = useCallback(() => {
    const value = inputRef.current?.value.trim() ?? ""
    if (value.length === 0) {
      return
    }
    void router.navigate({ to: "/search", search: { q: value } })
  }, [router])

  return (
    <InputGroup className="h-8 w-56 rounded-full bg-secondary has-[[data-slot=input-group-control]:focus-visible]:ring-1">
      <InputGroupInput
        ref={inputRef}
        defaultValue={defaultValue}
        placeholder="搜索影片"
        aria-label="搜索影片"
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            submit()
          }
        }}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" onClick={submit} aria-label="搜索">
          <SearchIcon />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}

/** 空态 / 错误态的统一占位 */
function Placeholder({
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
    <div className="flex flex-col items-center gap-2 py-16 text-sm text-muted-foreground">
      {icon}
      <p>{title}</p>
      {description && <p className="max-w-md text-center text-xs">{description}</p>}
      {action}
    </div>
  )
}
