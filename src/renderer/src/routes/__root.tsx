import { createRootRoute, Link, Outlet } from "@tanstack/react-router"
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools"
import { Button } from "@/components/ui/button"
import { WindowController } from "@/components/custom/window-controller"
import { Separator } from "@/components/ui/separator"
import { RotateCcwClockIcon, MonitorPlayIcon } from "lucide-react"
import { FilmSearchInput } from "@/components/custom/film-search-input"
import { ScrollArea } from "@/components/ui/scroll-area"

const RootLayout = () => (
  <>
    <div className="flex h-svh w-svw flex-col">
      <div className="flex h-12 items-center justify-between px-2 drag">
        <div className="flex items-center gap-1 px-1">
          <div className="rounded-full bg-secondary p-1">
            <MonitorPlayIcon className="size-5 text-primary" />
          </div>
          <div className="flex no-drag">
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
          <Button variant="ghost" size="icon">
            <RotateCcwClockIcon />
          </Button>
          <Separator orientation="vertical" className="m-auto mx-2 h-4" />
          <WindowController />
        </div>
      </div>
      <ScrollArea className="flex-1 overflow-auto contain-size">
        <Outlet />
      </ScrollArea>
    </div>

    <TanStackRouterDevtools />
  </>
)

export const Route = createRootRoute({ component: RootLayout })
