import { createFileRoute } from "@tanstack/react-router"
import { MediaCardList } from "@/components/custom/media-card-list"
import { ScrollArea } from "@/components/ui/scroll-area"

export const Route = createFileRoute("/")({
  component: Index,
})

const mock = {
  id: 0,
  name: "重零开始的异世界生活 第六季",
  url: "test.url",
  pluginId: "fen-che",
  sourceName: "风车动漫",
  img: "https://img.picbf.com/upload/vod/20260621-1/615fc0c5347632f9677630a009d04e7b.webp",
}

const data = Array.from({ length: 22 }, (_, i) => ({ ...mock, name: `${mock.name} ${i + 1}`, id: i.toString() }))

function Index() {
  return (
    <ScrollArea className="h-full p-6 pt-2">
      <h1 className="mb-3 text-lg">我的收藏（{data.length}）</h1>
      <MediaCardList items={data} blankMsg="暂无收藏" />
    </ScrollArea>
  )
}
