import { createRootRoute, Link, Outlet } from "@tanstack/react-router"
import { lazy, Suspense } from "react"
import { Button } from "@/components/ui/button"
import { WindowController } from "@/components/custom/window-controller"
import { NavBackButton } from "@/components/custom/nav-back-button"
import { Separator } from "@/components/ui/separator"
import { RotateCcwClockIcon } from "lucide-react"
import { FilmSearchInput } from "@/components/custom/film-search-input"
import { ScrollArea } from "@/components/ui/scroll-area"
import icon from "@/assets/icon.png"

/**
 * 路由 devtools 是纯调试工具，只在开发态按需加载。
 *
 * 生产构建下 `import.meta.env.DEV` 是常量 `false`，三元直接折叠成 `() => null`，
 * 动态 import 随之消失 —— devtools（约 1MB）不再进产物，也不在首屏依赖图里。
 *
 * 必须写成三元：只写 `import.meta.env.DEV && <Devtools />` 只能去掉渲染，
 * 模块顶层的 `lazy(() => import(...))` 调用还在，devtools 照样被打进包。
 */
const RouterDevtools = import.meta.env.DEV
  ? lazy(async () => ({
      default: (await import("@tanstack/react-router-devtools")).TanStackRouterDevtools,
    }))
  : () => null

const RootLayout = () => (
  <>
    <div className="flex h-svh w-svw flex-col">
      <div className="flex h-12 items-center justify-between px-2 drag">
        <div className="flex items-center gap-1 px-1">
          <div className="">
            <img src={icon} alt="icon" className="size-8" />
          </div>
          <div className="flex items-center no-drag">
            <NavBackButton />
            <Link to="/">
              <Button variant="ghost">收藏</Button>
            </Link>
            <Link to="/plugin">
              <Button variant="ghost">插件</Button>
            </Link>
            <FilmSearchInput className="ml-2" />
          </div>
        </div>
        <div className="flex items-center no-drag">
          <Link to="/history" title="播放历史">
            <Button variant="ghost" size="icon">
              <RotateCcwClockIcon />
            </Button>
          </Link>
          <Separator orientation="vertical" className="m-auto mx-2 h-4" />
          <WindowController />
        </div>
      </div>
      <ScrollArea className="flex-1 overflow-auto contain-size">
        <Outlet />
      </ScrollArea>
    </div>

    {import.meta.env.DEV ? (
      <Suspense>
        <RouterDevtools />
      </Suspense>
    ) : null}
  </>
)

export const Route = createRootRoute({ component: RootLayout })
