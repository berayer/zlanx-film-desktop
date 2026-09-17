import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { cn } from "cn"

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

function DialogBackdrop({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-backdrop"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0",
        className,
      )}
      {...props}
    />
  )
}

function DialogPopup({ className, ...props }: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Popup
      data-slot="dialog-popup"
      className={cn(
        "fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-5 text-popover-foreground ring-1 ring-foreground/10 transition-[opacity,transform] duration-150 outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
        className,
      )}
      {...props}
    />
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-header" className={cn("grid gap-1", className)} {...props} />
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-base leading-none font-medium", className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogBackdrop,
  DialogPopup,
  DialogClose,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
