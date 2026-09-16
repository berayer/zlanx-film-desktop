import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { Button } from "@/components/ui/button"

export const Route = createFileRoute("/about")({
  component: About,
})

function About() {
  const [state, setState] = useState(0)

  return (
    <div className="flex gap-8 p-2">
      <Button variant="outline" onClick={() => setState((prev) => prev - 1)}>
        -
      </Button>
      <div>{state}</div>
      <Button variant="outline" onClick={() => setState((prev) => prev + 1)}>
        +
      </Button>
    </div>
  )
}
