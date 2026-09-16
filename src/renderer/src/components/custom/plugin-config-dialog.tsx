import { useState } from "react"
import { Button } from "@/components/ui/button"
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
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { PluginConfigField, PluginConfigSnapshot, PluginConfigValue } from "@shared/ipc"
import { EyeIcon, EyeOffIcon, RotateCcwIcon } from "lucide-react"

/** 表单草稿：number / select 也先存成字符串，保存时再转回 schema 声明的类型 */
type DraftValues = Record<string, string | boolean>

const SELECT_CLASS =
  "h-8 w-full min-w-0 appearance-none rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

export interface PluginConfigDialogProps {
  pluginId: string
  /** 插件展示名称 */
  name: string
  /** 配置项 schema + 当前值；undefined 表示数据还在加载 */
  snapshot?: PluginConfigSnapshot
  /** 正在保存 / 重置 */
  saving?: boolean
  onOpenChange: (open: boolean) => void
  onSave: (patch: Record<string, PluginConfigValue | undefined>) => void
  onReset: () => void
}

/** 把快照转成表单草稿 */
function toDraft(snapshot: PluginConfigSnapshot | undefined): DraftValues {
  const draft: DraftValues = {}
  for (const field of snapshot?.schema ?? []) {
    const value = snapshot?.values[field.key]
    if (field.type === "boolean") {
      draft[field.key] = value === true
    } else if (value === undefined) {
      draft[field.key] = ""
    } else {
      draft[field.key] = String(value)
    }
  }
  return draft
}

/** 把草稿转成提交给宿主的 patch（整体提交，清空即传 undefined） */
function toPatch(
  schema: readonly PluginConfigField[],
  draft: DraftValues,
): Record<string, PluginConfigValue | undefined> {
  const patch: Record<string, PluginConfigValue | undefined> = {}
  for (const field of schema) {
    const raw = draft[field.key]
    if (field.type === "boolean") {
      patch[field.key] = raw === true
      continue
    }
    if (raw === undefined || raw === "") {
      patch[field.key] = undefined
      continue
    }
    patch[field.key] = field.type === "number" ? Number(raw) : String(raw)
  }
  return patch
}

export function PluginConfigDialog({
  pluginId,
  name,
  snapshot,
  saving,
  onOpenChange,
  onSave,
  onReset,
}: PluginConfigDialogProps) {
  const schema = snapshot?.schema ?? []
  const [draft, setDraft] = useState<DraftValues>(() => toDraft(snapshot))
  const [revealed, setRevealed] = useState<string[]>([])

  const set = (key: string, value: string | boolean) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }
  const toggleReveal = (key: string) => {
    setRevealed((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]))
  }

  const renderField = (field: PluginConfigField) => {
    if (field.type === "boolean") {
      return (
        <div className="flex h-8 items-center">
          <Switch checked={draft[field.key] === true} onCheckedChange={(next) => set(field.key, next)} />
          <span className="ml-2 text-xs text-muted-foreground">{draft[field.key] === true ? "开" : "关"}</span>
        </div>
      )
    }
    if (field.type === "select") {
      return (
        <select
          className={SELECT_CLASS}
          value={typeof draft[field.key] === "string" ? (draft[field.key] as string) : ""}
          onChange={(event) => set(field.key, event.target.value)}
        >
          <option value="">（未设置）</option>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )
    }
    if (field.type === "text") {
      return (
        <Textarea
          rows={3}
          value={(draft[field.key] as string | undefined) ?? ""}
          placeholder={field.placeholder}
          onChange={(event) => set(field.key, event.target.value)}
        />
      )
    }
    const secret = field.secret === true && !revealed.includes(field.key)
    return (
      <div className="flex items-center gap-1">
        <Input
          type={secret ? "password" : "text"}
          inputMode={field.type === "number" ? "numeric" : undefined}
          value={(draft[field.key] as string | undefined) ?? ""}
          placeholder={field.placeholder}
          onChange={(event) => set(field.key, event.target.value)}
          autoComplete="off"
        />
        {field.secret === true && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            title={secret ? "显示内容" : "隐藏内容"}
            onClick={() => toggleReveal(field.key)}
          >
            {secret ? <EyeIcon /> : <EyeOffIcon />}
          </Button>
        )}
      </div>
    )
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup className="max-h-[85vh] max-w-lg">
          <DialogHeader>
            <DialogTitle>配置：{name}</DialogTitle>
            <DialogDescription>
              配置保存在插件目录的 <span className="font-mono">config.json</span>，插件通过{" "}
              <span className="font-mono">ctx.config</span> 读取；保存后会自动重载插件生效。
            </DialogDescription>
          </DialogHeader>

          {!snapshot ? (
            <p className="py-6 text-center text-xs text-muted-foreground">正在读取配置…</p>
          ) : schema.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">该插件没有声明配置项</p>
          ) : (
            <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
              {schema.map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium">{field.label}</span>
                    {field.required && <span className="text-xs text-destructive">*</span>}
                    <span className="font-mono text-[11px] text-muted-foreground">{field.key}</span>
                  </div>
                  {renderField(field)}
                  {field.description && <p className="text-[11px] text-muted-foreground">{field.description}</p>}
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" size="sm" disabled={saving || schema.length === 0} onClick={onReset}>
              <RotateCcwIcon />
              重置默认值
            </Button>
            <span className="flex-1" />
            <DialogClose render={<Button variant="ghost">取消</Button>} />
            <Button
              disabled={saving || !snapshot || schema.length === 0}
              onClick={() => onSave(toPatch(schema, draft))}
            >
              保存
            </Button>
          </DialogFooter>
          <p className="text-center font-mono text-[11px] text-muted-foreground">{pluginId}</p>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  )
}
