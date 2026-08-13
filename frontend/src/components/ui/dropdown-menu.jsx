import * as React from "react"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"

import { cn } from "@/lib/utils"

// Adapted from the shadcn registry, trimmed to the four exports this app uses.
// The registry ships a dozen more (CheckboxItem, RadioGroup, Sub, Shortcut...);
// none has a caller here, and an unused export is a thing to maintain and a
// thing to get wrong. Add one when something needs it.
//
// Adapted rather than copied: the registry's current output targets React 19,
// Tailwind 4 and TypeScript, and this project is React 18.2, Tailwind 3 and
// plain JSX. So no `data-slot` attributes and no type annotations. The
// animation utilities come from `tailwindcss-animate`, which tailwind.config.js
// already loads.

const DropdownMenu = DropdownMenuPrimitive.Root

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

const DropdownMenuContent = React.forwardRef(
  ({ className, sideOffset = 4, ...props }, ref) => (
    // Portalled, so the content is NOT a DOM descendant of the trigger. That is
    // what stops a click inside the menu from bubbling into a row's own
    // onClick -- see ListRenderer, where the row header toggles `expanded`.
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
          "data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2",
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
)
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

const DropdownMenuItem = React.forwardRef(
  ({ className, variant = "default", ...props }, ref) => (
    <DropdownMenuPrimitive.Item
      ref={ref}
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors",
        "focus:bg-accent focus:text-accent-foreground",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        // A destructive item is named by colour AND by its label. Colour alone
        // is not an accessible signal.
        variant === "destructive" &&
          "text-destructive focus:bg-destructive/10 focus:text-destructive",
        className
      )}
      {...props}
    />
  )
)
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
}
