import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { badgeVariants } from "@/components/ui/badge"
import type { VariantProps } from "class-variance-authority"
import type { PluginInfo } from "@shared/ipc"
import { RotateCwIcon, Settings2Icon, Trash2Icon } from "lucide-react"

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>

const STATUS_META: Record<PluginInfo["status"], { label: string; variant: BadgeVariant }> = {
  active: { label: "已启用", variant: "default" },
  inactive: { label: "已禁用", variant: "secondary" },
  discovered: { label: "未加载", variant: "outline" },
  loading: { label: "加载中", variant: "outline" },
  error: { label: "异常", variant: "destructive" },
}

export interface PluginCardProps {
  info: PluginInfo
  /** 该插件正在执行操作，禁用按钮避免重复点击 */
  busy?: boolean
  onToggle: (info: PluginInfo, next: boolean) => void
  onReload: (info: PluginInfo) => void
  onUninstall: (info: PluginInfo) => void
  /** 打开配置面板（插件声明了配置项时才会显示入口） */
  onConfigure?: (info: PluginInfo) => void
}

export function PluginCard({ info, busy, onToggle, onReload, onUninstall, onConfigure }: PluginCardProps) {
  const { manifest, status } = info
  const meta = STATUS_META[status]
  const enabled = status === "active" || status === "inactive" ? status === "active" : undefined
  const configCount = manifest.config?.length ?? 0

  return (
    <Card size="sm" className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="truncate">{manifest.name}</span>
          <span className="text-xs font-normal text-muted-foreground">v{manifest.version}</span>
        </CardTitle>
        <CardDescription className="truncate">{manifest.description ?? manifest.id}</CardDescription>
        <div className="flex items-center gap-2">
          <Badge variant={meta.variant}>{meta.label}</Badge>
          <Switch
            checked={enabled ?? false}
            disabled={busy || enabled === undefined}
            aria-label={enabled ? "禁用插件" : "启用插件"}
            onCheckedChange={(next) => onToggle(info, next)}
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-2 h-full">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <dt>ID</dt>
          <dd className="truncate font-mono text-foreground/80">{manifest.id}</dd>
          {manifest.author && (
            <>
              <dt>作者</dt>
              <dd className="truncate">{manifest.author}</dd>
            </>
          )}
          {info.state?.installedAt && (
            <>
              <dt>安装时间</dt>
              <dd className="truncate">{new Date(info.state.installedAt).toLocaleString()}</dd>
            </>
          )}
          {configCount > 0 && (
            <>
              <dt>配置项</dt>
              <dd className="truncate">{configCount} 项可在配置面板填写</dd>
            </>
          )}
        </dl>
        {info.error && (
          <p className="rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{info.error}</p>
        )}
      </CardContent>

      <CardFooter className="justify-end gap-1">
        {onConfigure && configCount > 0 && (
          <>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => onConfigure(info)}>
              <Settings2Icon />
              配置
            </Button>
            <Separator orientation="vertical" className="h-4" />
          </>
        )}
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => onReload(info)}>
          <RotateCwIcon />
          重载
        </Button>
        <Separator orientation="vertical" className="h-4" />
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => onUninstall(info)}>
          <Trash2Icon />
          卸载
        </Button>
      </CardFooter>
    </Card>
  )
}
