import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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
import { PluginCard } from "@/components/custom/plugin-card"
import { PluginConfigDialog } from "@/components/custom/plugin-config-dialog"
import type { PluginConfigSnapshot, PluginConfigValue, PluginInfo } from "@shared/ipc"
import { FolderOpenIcon, LinkIcon, LoaderCircleIcon, PackageOpenIcon, RefreshCwIcon } from "lucide-react"

interface Toast {
  id: number
  type: "success" | "error"
  message: string
}

export const Route = createFileRoute("/plugin")({
  component: RouteComponent,
})

function RouteComponent() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | undefined>()
  const [working, setWorking] = useState(false)
  const [url, setUrl] = useState("")
  const [keyword, setKeyword] = useState("")
  const [pendingUninstall, setPendingUninstall] = useState<PluginInfo | undefined>()
  const [configTarget, setConfigTarget] = useState<PluginInfo | undefined>()
  const [configSnapshot, setConfigSnapshot] = useState<PluginConfigSnapshot | undefined>()
  /** 每次重新拉取配置都自增，用来重置配置弹窗内的表单草稿 */
  const [configNonce, setConfigNonce] = useState(0)
  const [configBusy, setConfigBusy] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)

  const pushToast = useCallback((type: Toast["type"], message: string) => {
    const id = ++toastId.current
    setToasts((prev) => [...prev, { id, type, message }])
    setTimeout(() => setToasts((prev) => prev.filter((item) => item.id !== id)), 3200)
  }, [])

  /** 拉取插件列表，失败时弹 toast 并返回 undefined */
  const fetchPlugins = useCallback(async (): Promise<PluginInfo[] | undefined> => {
    try {
      return await window.electron.plugins.list()
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : String(error))
      return undefined
    }
  }, [pushToast])

  /** 事件驱动的刷新（手动刷新 / 操作完成后），会切换整页 loading 态 */
  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const list = await fetchPlugins()
      if (list) {
        setPlugins(list)
      }
    } finally {
      setLoading(false)
    }
  }, [fetchPlugins])

  // 首屏加载：首帧已由 loading 的初始值呈现加载态，
  // 这里 await 之后再更新状态，避免在 effect 中同步 setState 触发瀑布渲染
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const list = await fetchPlugins()
      if (cancelled) {
        return
      }
      if (list) {
        setPlugins(list)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [fetchPlugins])

  /** 统一包装插件操作：处理 loading、刷新列表与错误提示 */
  const run = useCallback(
    async (id: string | undefined, task: () => Promise<unknown>, success?: string) => {
      const setBusy = (value: boolean) => {
        setBusyId(value ? id : undefined)
        setWorking(value)
      }
      setBusy(true)
      try {
        await task()
        if (success) {
          pushToast("success", success)
        }
      } catch (error) {
        pushToast("error", error instanceof Error ? error.message : String(error))
      } finally {
        await refresh()
        setBusy(false)
      }
    },
    [pushToast, refresh],
  )

  const installFromUrl = async () => {
    const target = url.trim()
    if (target.length === 0) {
      pushToast("error", "请先填写插件 js 文件的下载地址")
      return
    }
    await run(undefined, () => window.electron.plugins.installFromUrl(target), `已安装：${target}`)
    setUrl("")
  }

  const installFromDialog = async () => {
    let installed: PluginInfo | undefined
    try {
      installed = await window.electron.plugins.installFromDialog()
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : String(error))
    }
    await refresh()
    if (installed) {
      pushToast("success", `已安装：${installed.manifest.name}`)
    }
  }

  const toggle = (info: PluginInfo, next: boolean) => {
    const operate = next ? window.electron.plugins.enable : window.electron.plugins.disable
    void run(info.manifest.id, () => operate(info.manifest.id), `${next ? "已启用" : "已禁用"}：${info.manifest.name}`)
  }

  const reload = (info: PluginInfo) => {
    void run(info.manifest.id, () => window.electron.plugins.reload(info.manifest.id), `已重载：${info.manifest.name}`)
  }

  const openConfig = async (info: PluginInfo) => {
    setConfigTarget(info)
    setConfigSnapshot(undefined)
    setConfigBusy(true)
    try {
      setConfigSnapshot(await window.electron.plugins.getConfig(info.manifest.id))
      setConfigNonce((value) => value + 1)
    } catch (error) {
      setConfigTarget(undefined)
      pushToast("error", error instanceof Error ? error.message : String(error))
    } finally {
      setConfigBusy(false)
    }
  }

  const closeConfig = () => {
    setConfigTarget(undefined)
    setConfigSnapshot(undefined)
  }

  const saveConfig = async (patch: Record<string, PluginConfigValue | undefined>) => {
    const target = configTarget
    if (!target) {
      return
    }
    setConfigBusy(true)
    try {
      const updated = await window.electron.plugins.updateConfig(target.manifest.id, patch)
      pushToast("success", `配置已保存：${updated.manifest.name}`)
      if (updated.error) {
        pushToast("error", `插件重载失败：${updated.error}`)
      }
      closeConfig()
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : String(error))
    } finally {
      setConfigBusy(false)
      await refresh()
    }
  }

  const resetConfig = async () => {
    const target = configTarget
    if (!target) {
      return
    }
    setConfigBusy(true)
    try {
      await window.electron.plugins.resetConfig(target.manifest.id)
      setConfigSnapshot(await window.electron.plugins.getConfig(target.manifest.id))
      setConfigNonce((value) => value + 1)
      pushToast("success", "已重置为默认配置")
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : String(error))
    } finally {
      setConfigBusy(false)
      await refresh()
    }
  }

  const uninstall = async () => {
    const target = pendingUninstall
    if (!target) {
      return
    }
    setPendingUninstall(undefined)
    await run(
      target.manifest.id,
      () => window.electron.plugins.uninstall(target.manifest.id),
      `已卸载：${target.manifest.name}`,
    )
  }

  const visible = useMemo(() => {
    const kwd = keyword.trim().toLowerCase()
    if (kwd.length === 0) {
      return plugins
    }
    return plugins.filter((item) =>
      [item.manifest.name, item.manifest.id, item.manifest.author ?? ""].some((field) =>
        field.toLowerCase().includes(kwd),
      ),
    )
  }, [plugins, keyword])

  const enabledCount = plugins.filter((item) => item.status === "active").length

  return (
    <div className="mx-auto w-full max-w-5xl p-6 pt-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-medium">插件管理</h1>
          <p className="text-xs text-muted-foreground">
            共 {plugins.length} 个插件，{enabledCount} 个已启用
          </p>
        </div>
        <Button variant="ghost" size="icon" disabled={loading} onClick={() => void refresh()} title="刷新列表">
          {loading ? <LoaderCircleIcon className="animate-spin" /> : <RefreshCwIcon />}
        </Button>
      </div>

      <Card className="mt-3" size="sm">
        <CardContent className="flex flex-wrap items-center gap-2">
          <Input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void installFromUrl()
              }
            }}
            placeholder="插件 index.js 的 https 下载地址"
            className="min-w-56 flex-1"
            disabled={working}
          />
          <Button disabled={working} onClick={() => void installFromUrl()}>
            <LinkIcon />
            网络安装
          </Button>
          <Button variant="outline" disabled={working} onClick={() => void installFromDialog()}>
            <FolderOpenIcon />
            本地安装
          </Button>
          <Input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="按名称 / ID 搜索"
            className="w-40"
          />
        </CardContent>
      </Card>

      {!loading && visible.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-2 py-16 text-sm text-muted-foreground">
          <PackageOpenIcon className="size-8" />
          <p>{plugins.length === 0 ? "还没有安装任何插件" : "没有匹配的插件"}</p>
        </div>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {visible.map((item) => (
            <PluginCard
              key={item.manifest.id}
              info={item}
              busy={busyId === item.manifest.id || working}
              onToggle={toggle}
              onReload={reload}
              onUninstall={(info) => setPendingUninstall(info)}
              onConfigure={(info) => void openConfig(info)}
            />
          ))}
        </div>
      )}

      <Dialog open={pendingUninstall !== undefined} onOpenChange={(open) => !open && setPendingUninstall(undefined)}>
        <DialogPortal>
          <DialogBackdrop />
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>卸载插件</DialogTitle>
              <DialogDescription>
                确定要卸载「{pendingUninstall?.manifest.name}」吗？插件目录及其数据会一并删除。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="ghost">取消</Button>} />
              <Button variant="destructive" onClick={() => void uninstall()}>
                卸载
              </Button>
            </DialogFooter>
          </DialogPopup>
        </DialogPortal>
      </Dialog>

      {configTarget && (
        <PluginConfigDialog
          key={`${configTarget.manifest.id}:${configNonce}`}
          pluginId={configTarget.manifest.id}
          name={configTarget.manifest.name}
          snapshot={configSnapshot}
          saving={configBusy}
          onOpenChange={(open) => !open && closeConfig()}
          onSave={(patch) => void saveConfig(patch)}
          onReset={() => void resetConfig()}
        />
      )}

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
