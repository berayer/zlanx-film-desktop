import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

export interface LoadingPlaceholderProps {
  /** 说明文字；不传就只显示转圈 */
  label?: string
  className?: string
}

/**
 * 页面 / 列表的加载占位：居中旋转的 Spinner。
 *
 * 之前各列表各有一份骨架屏（Skeleton），但骨架屏要把真实布局（海报墙列数、
 * 卡片结构）再抄一遍，实际布局一改就会脱节；统一用 Spinner 省掉这份重复，
 * 也不会因为布局漂移而显示错结构。
 */
export function LoadingPlaceholder({ label, className }: LoadingPlaceholderProps) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground", className)}
    >
      <Spinner className="size-6" />
      {label ? <p>{label}</p> : null}
    </div>
  )
}
