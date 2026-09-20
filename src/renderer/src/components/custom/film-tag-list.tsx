import type { FilmTag } from "@shared/plugin-api"
import { cn } from "@/lib/utils"

export interface FilmTagListProps {
  /** 标签二元组：`[标签, 取值]`，例如 `["年份：", "2026"]`；标签可为空字符串，此时只渲染取值 */
  tags: FilmTag[]
  /** 最多渲染几条，超出忽略 */
  max?: number
  /** `pill` 为带底色的胶囊（信息区用），`text` 为纯文本一行（卡片里用） */
  variant?: "pill" | "text"
  className?: string
}

/** 渲染影片的全部标签信息；没有标签时不占位 */
export function FilmTagList({ tags, max, variant = "pill", className }: FilmTagListProps) {
  const visible = typeof max === "number" && max > 0 ? tags.slice(0, max) : tags
  if (visible.length === 0) {
    return null
  }

  return (
    <div className={cn("flex flex-wrap gap-x-2 gap-y-1 text-xs", variant === "pill" ? "" : "gap-x-1.5", className)}>
      {visible.map(([label, value], index) => (
        <span
          key={`${label}-${index}`}
          title={label.length > 0 ? `${label}${value}` : value}
          className={cn(
            "max-w-full truncate",
            variant === "pill" ? "rounded bg-muted px-1.5 py-0.5 text-muted-foreground" : "text-muted-foreground",
          )}
        >
          {label.length > 0 ? <span className="opacity-70">{label}</span> : null}
          <span className="text-foreground/80">{value}</span>
        </span>
      ))}
    </div>
  )
}
