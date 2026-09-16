import { createFileRoute } from "@tanstack/react-router"
import { useEffect } from "react"
import { MediaCardList } from "@/components/custom/media-card-list"
import { rendererLog } from "@/lib/logger"

const log = rendererLog.scope("search")

type SearchParams = {
  q?: string
}

export const Route = createFileRoute("/search")({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    q: typeof search.q === "string" ? search.q : undefined,
  }),
})

function RouteComponent() {
  const { q } = Route.useSearch()

  useEffect(() => {
    log.debug(`搜索关键词：${q ?? ""}`)
  }, [q])

  return (
    <div className="p-4 pt-1">
      <div className="mb-3 text-lg font-bold">
        <span className="text-red-500">「{q}」</span>
        <span className="ml-2">的搜索结果</span>
      </div>
      <MediaCardList items={[]} blankMsg={`没有找到与「${q}」相关的影片`} />
    </div>
  )
}
