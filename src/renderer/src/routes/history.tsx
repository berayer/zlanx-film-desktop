import { createFileRoute, Link } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog"
import { HistoryCardList, HistoryCardListSkeleton, type HistoryGroup } from "@/components/custom/history-card-list"
import type { WatchHistoryEntry } from "@shared/db-api"
import { rendererLog } from "@/lib/logger"
import {
  ClapperboardIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  RotateCcwClockIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react"

/** 播放历史页日志（作用域 `history`，与主进程汇入同一份 electron-log） */
const log = rendererLog.scope("history")

interface Toast {
  id: number
  type: "success" | "error"
  message: string
}

/** 把同一部片的多集记录合并成一张卡片 */
function groupByFilm(entries: WatchHistoryEntry[]): HistoryGroup[] {
  const map = new Map<string, HistoryGroup>()
  for (const entry of entries) {
    const key = `${entry.plugin}::${entry.filmId}`
    const existing = map.get(key)
    if (existing) {
      existing.count += 1
      // 列表已按更新时间倒序，第一条就是最近看的；这里再兜一层比较
      if (Date.parse(entry.updatedAt) > Date.parse(existing.latest.updatedAt)) {
        existing.latest = entry
      }
      continue
    }
    map.set(key, {
      key,
      plugin: entry.plugin,
      pluginName: entry.pluginName,
      filmId: entry.filmId,
      filmTitle: entry.filmTitle,
      filmPoster: entry.filmPoster,
      latest: entry,
      count: 1,
    })
  }
  return [...map.values()]
}

export const Route = createFileRoute("/history")({
  component: History,
})

function History() {
  const [items, setItems] = useState<HistoryGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [busyKey, setBusyKey] = useState<string>()
  const [clearing, setClearing] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [keyword, setKeyword] = useState("")
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)

  const pushToast = useCallback((type: Toast["type"], message: string) => {
    const id = ++toastId.current
    setToasts((prev) => [...prev, { id, type, message }])
    setTimeout(() => setToasts((prev) => prev.filter((item) => item.id !== id)), 3200)
  }, [])

  const fetchHistory = useCallback(async (): Promise<HistoryGroup[]> => {
    const rows = await window.electron.api.getWatchHistory()
    return groupByFilm(rows)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const list = await fetchHistory()
        log.debug(`播放历史：${list.length} 部影片`)
        if (cancelled) {
          return
        }
        setItems(list)
        setError(undefined)
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        log.error(`读取播放历史失败：${message}`)
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
  }, [fetchHistory])

  const refresh = async () => {
    setLoading(true)
    try {
      const list = await fetchHistory()
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

  const remove = async (group: HistoryGroup) => {
    setBusyKey(group.key)
    try {
      const removed = await window.electron.api.removeWatchHistory(group.plugin, group.filmId)
      setItems((prev) => prev.filter((row) => row.key !== group.key))
      if (removed > 0) {
        pushToast("success", `已删除 ${removed} 条记录`)
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      log.error(`删除播放历史失败：${message}`)
      pushToast("error", message)
    } finally {
      setBusyKey(undefined)
    }
  }

  const clearAll = async () => {
    setClearing(true)
    try {
      const removed = await window.electron.api.clearWatchHistory()
      setItems([])
      setConfirmClear(false)
      pushToast("success", `已清空播放历史（${removed} 条）`)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      log.error(`清空播放历史失败：${message}`)
      pushToast("error", message)
    } finally {
      setClearing(false)
    }
  }

  const visible = useMemo(() => {
    const kwd = keyword.trim().toLowerCase()
    if (kwd.length === 0) {
      return items
    }
    return items.filter((item) =>
      [item.filmTitle, item.pluginName, item.latest.episodeTitle].some((field) => field.toLowerCase().includes(kwd)),
    )
  }, [items, keyword])

  return (
    <div className="mx-auto w-full p-6 pt-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-medium">播放历史</h1>
          <p className="text-xs text-muted-foreground">
            {loading ? "加载中…" : `共 ${items.length} 部影片`}
            {!loading && items.length > 0 && <span className="ml-1">· 点击封面继续播放</span>}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" disabled={loading} onClick={() => void refresh()} title="刷新历史">
            {loading ? <LoaderCircleIcon className="animate-spin" /> : <RefreshCwIcon />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={items.length === 0}
            title="清空全部历史"
            onClick={() => setConfirmClear(true)}
          >
            <Trash2Icon />
          </Button>
          <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
            <DialogPortal>
              <DialogBackdrop />
              <DialogPopup className="w-80">
                <DialogHeader>
                  <DialogTitle>清空播放历史</DialogTitle>
                  <DialogDescription>将删除全部 {items.length} 部影片的观看记录，此操作不可撤销。</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose
                    render={
                      <Button variant="ghost" size="sm">
                        取消
                      </Button>
                    }
                  />
                  <Button variant="destructive" size="sm" disabled={clearing} onClick={() => void clearAll()}>
                    {clearing ? <LoaderCircleIcon className="animate-spin" /> : null}
                    清空
                  </Button>
                </DialogFooter>
              </DialogPopup>
            </DialogPortal>
          </Dialog>
        </div>
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
          <HistoryCardListSkeleton />
        ) : error ? (
          <div className="flex flex-col items-center gap-2 py-16 text-sm text-muted-foreground">
            <ClapperboardIcon className="size-8" />
            <p className="text-foreground">读取播放历史失败</p>
            <p className="max-w-md text-center text-xs">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void refresh()}>
              <RefreshCwIcon />
              重试
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-sm text-muted-foreground">
            <RotateCcwClockIcon className="size-8" />
            <p>还没有观看记录</p>
            <Link to="/search" search={{ q: "" }}>
              <Button variant="outline" size="sm">
                去搜索
              </Button>
            </Link>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-sm text-muted-foreground">
            <SearchIcon className="size-8" />
            <p>没有匹配的记录</p>
          </div>
        ) : (
          <HistoryCardList items={visible} busyKey={busyKey} onRemove={(group) => void remove(group)} />
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
