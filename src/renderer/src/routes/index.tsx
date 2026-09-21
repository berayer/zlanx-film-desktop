import { createFileRoute, Link } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FavoriteCardList } from "@/components/custom/favorite-card-list"
import { LoadingPlaceholder } from "@/components/custom/loading-placeholder"
import type { FavoriteFilm } from "@shared/db-api"
import { rendererLog } from "@/lib/logger"
import { ClapperboardIcon, LoaderCircleIcon, RefreshCwIcon, SearchIcon, StarIcon } from "lucide-react"

/** 收藏页日志（作用域 `favorites`，与主进程汇入同一份 electron-log） */
const log = rendererLog.scope("favorites")

interface Toast {
  id: number
  type: "success" | "error"
  message: string
}

export const Route = createFileRoute("/")({
  component: Index,
})

function Index() {
  const [items, setItems] = useState<FavoriteFilm[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [busyId, setBusyId] = useState<number>()
  const [keyword, setKeyword] = useState("")
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)

  const pushToast = useCallback((type: Toast["type"], message: string) => {
    const id = ++toastId.current
    setToasts((prev) => [...prev, { id, type, message }])
    setTimeout(() => setToasts((prev) => prev.filter((item) => item.id !== id)), 3200)
  }, [])

  /** 拉取收藏列表；失败时把错误抛给调用方决定如何呈现 */
  const fetchFavorites = useCallback(async (): Promise<FavoriteFilm[]> => {
    const list = await window.electron.api.getFavoritesFilms()
    return list
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const list = await fetchFavorites()
        log.debug(`收藏列表：${list.length} 条`)
        if (cancelled) {
          return
        }
        setItems(list)
        setError(undefined)
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        log.error(`读取收藏失败：${message}`)
        if (!cancelled) {
          setError(message)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [fetchFavorites])

  const refresh = async () => {
    setLoading(true)
    try {
      const list = await fetchFavorites()
      setItems(list)
      setError(undefined)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      pushToast("error", message)
    } finally {
      setLoading(false)
    }
  }

  const remove = async (item: FavoriteFilm) => {
    setBusyId(item.id)
    try {
      const removed = await window.electron.api.removeFavoritesFilm(item.plugin, item.filmId)
      if (removed) {
        setItems((prev) => prev.filter((row) => row.id !== item.id))
        pushToast("success", `已取消收藏：${item.filmTitle}`)
      } else {
        // 库里已经没有了，直接以当前列表为准
        setItems((prev) => prev.filter((row) => row.id !== item.id))
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      log.error(`取消收藏失败：${message}`)
      pushToast("error", message)
    } finally {
      setBusyId(undefined)
    }
  }

  const visible = useMemo(() => {
    const kwd = keyword.trim().toLowerCase()
    if (kwd.length === 0) {
      return items
    }
    return items.filter((item) => [item.filmTitle, item.pluginName].some((field) => field.toLowerCase().includes(kwd)))
  }, [items, keyword])

  return (
    <div className="mx-auto w-full p-6 pt-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-medium">我的收藏</h1>
          <p className="text-xs text-muted-foreground">
            {loading ? "加载中…" : `共 ${items.length} 部影片`}
            {!loading && items.length > 0 && <span className="ml-1">· 点击封面继续播放</span>}
          </p>
        </div>
        <Button variant="ghost" size="icon" disabled={loading} onClick={() => void refresh()} title="刷新收藏">
          {loading ? <LoaderCircleIcon className="animate-spin" /> : <RefreshCwIcon />}
        </Button>
      </div>

      {items.length > 0 && (
        <div className="mt-3 flex items-center gap-2">
          <div className="relative w-56">
            <SearchIcon className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="按片名 / 来源筛选"
              className="pl-8"
            />
          </div>
          {keyword.trim().length > 0 && <span className="text-xs text-muted-foreground">匹配 {visible.length} 部</span>}
        </div>
      )}

      <div className="mt-4">
        {loading ? (
          <LoadingPlaceholder label="正在读取收藏…" />
        ) : error ? (
          <div className="flex flex-col items-center gap-2 py-16 text-sm text-muted-foreground">
            <ClapperboardIcon className="size-8" />
            <p className="text-foreground">读取收藏失败</p>
            <p className="max-w-md text-center text-xs">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void refresh()}>
              <RefreshCwIcon />
              重试
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-sm text-muted-foreground">
            <StarIcon className="size-8" />
            <p>还没有收藏任何影片</p>
            <Link to="/search" search={{ q: "" }}>
              <Button variant="outline" size="sm">
                去搜索
              </Button>
            </Link>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-sm text-muted-foreground">
            <SearchIcon className="size-8" />
            <p>没有匹配的收藏</p>
          </div>
        ) : (
          <FavoriteCardList items={visible} busyId={busyId} onRemove={(item) => void remove(item)} />
        )}
      </div>

      <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex w-max max-w-[90vw] -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={
              toast.type === "success"
                ? "rounded-md bg-foreground px-3 py-1.5 text-xs text-background"
                : "rounded-md bg-destructive px-3 py-1.5 text-xs text-destructive-foreground"
            }
          >
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  )
}
