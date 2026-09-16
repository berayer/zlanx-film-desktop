import { cn } from "@/lib/utils"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { SearchIcon } from "lucide-react"
import { useRouter } from "@tanstack/react-router"
import { useRef, useCallback } from "react"

export function FilmSearchInput({ className }: React.ComponentPropsWithoutRef<"div">) {
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const handleSearch = useCallback(() => {
    const value = inputRef.current?.value
    if (!value) return
    router.navigate({ to: "/search", search: { q: value } })
  }, [inputRef, router])

  return (
    <div className={cn("flex items-center", className)}>
      <InputGroup className="h-7! rounded-full bg-secondary text-secondary-foreground has-[[data-slot=input-group-control]:focus-visible]:ring-1">
        <InputGroupInput
          ref={inputRef}
          placeholder="在此处输入搜索内容"
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-xs" onClick={handleSearch}>
            <SearchIcon />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}
