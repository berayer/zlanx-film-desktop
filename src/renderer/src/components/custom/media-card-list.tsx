import { MediaInfo } from "@/types"
import { Link } from "@tanstack/react-router"

export function MediaCardList({ items, blankMsg }: { items: MediaInfo[]; blankMsg: string }) {
  if (items.length > 0) {
    return (
      <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
        {items.map((item) => (
          <MediaCard key={item.id} item={item} />
        ))}
      </div>
    )
  }
  return <EmptyState msg={blankMsg} />
}

function MediaCard({ item }: { item: MediaInfo }) {
  return (
    <Link
      to="/player"
      search={{ url: item.url, plugin: item.pluginId }}
      title={item.name}
      className="group block focus:outline-none"
    >
      <div className="relative aspect-2/3 w-full overflow-hidden rounded-lg bg-gray-100 ring-1 ring-black/5">
        <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">暂无封面</div>
        {item.img && (
          <img
            src={item.img}
            alt={item.name}
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.visibility = "hidden"
            }}
            className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
        )}
        <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
          {item.sourceName}
        </span>
        <div className="absolute inset-0 bg-black/0 transition group-hover:bg-black/10" />
      </div>
      <p className="mt-2 line-clamp-2 text-sm text-gray-800 transition group-hover:text-gray-950" title={item.name}>
        {item.name}
      </p>
    </Link>
  )
}

function EmptyState({ msg }: { msg: string }) {
  return (
    <div className="flex h-60 flex-col items-center justify-center gap-1 text-sm text-gray-400">
      <p>{msg}</p>
    </div>
  )
}
