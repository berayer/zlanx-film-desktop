import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { MinusIcon, XIcon } from "lucide-react"

const { min, close } = window.electron.window

export function WindowController({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div className={cn("flex gap-1", className)} {...props}>
      <Button variant="ghost" size="icon" onClick={() => min()}>
        <MinusIcon />
      </Button>
      <Button variant="ghost" size="icon" onClick={() => close()}>
        <XIcon />
      </Button>
    </div>
  )
}
