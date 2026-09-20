import { useRouter, useRouterState } from "@tanstack/react-router"
import { useCallback, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { ArrowLeftIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * 顶栏的「后退」按钮：走 router 自带的 history，行为与浏览器后退一致。
 *
 * - 能否后退由 `router.history.canGoBack()` 判断（history 内部用 `__TSR_index` 记栈，
 *   初始为 0，所以第一条记录时按钮是禁用的，不会出现「退出了应用页面」的情况）；
 * - 用 `useRouterState` 订阅路由状态，每次导航后重新求值（根布局本身不会随路由重渲染）；
 * - 另外支持 Alt + ← 快捷键（不占用 Backspace，避免和输入框冲突）。
 */
export function NavBackButton({ className }: { className?: string }) {
  const router = useRouter()
  const canGoBack = useRouterState({ select: () => router.history.canGoBack() })

  const goBack = useCallback(() => {
    if (!router.history.canGoBack()) {
      return
    }
    router.history.back()
  }, [router])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && event.key === "ArrowLeft") {
        goBack()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [goBack])

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(className)}
      title="后退（Alt + ←）"
      aria-label="后退"
      disabled={!canGoBack}
      onClick={goBack}
    >
      <ArrowLeftIcon />
    </Button>
  )
}
