import { createContext, useContext } from "react"
import { toast as sonner } from "sonner"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

// Which toast a button sits in, so ToastAction can close its own.
const ToastIdContext = createContext(null)

/**
 * Sonner pauses every toast while the stack is hovered, but not while one has
 * keyboard focus, so an Undo reached by Tab could run out under the reader.
 * Focus inside a toast is told to the stack as a hover; losing it, or the
 * toast going, as the end of one, unless the pointer really is over it.
 *
 * ponytail: rides on Sonner hovering by React's mouseover/mouseout; if an
 * upgrade stops pausing on these, give the Toaster `expand` while focused.
 */
function hover(el, on) {
  const list = el?.closest?.("[data-sonner-toaster]")
  if (!list || (!on && pointerOnToasts)) return
  el.dispatchEvent(
    new MouseEvent(on ? "mouseover" : "mouseout", {
      bubbles: true,
      relatedTarget: on ? null : document.body,
    })
  )
}

// Whether the real pointer is over the stack. From pointer events, which the
// mouse events `hover` sends never raise, so it cannot fool itself (`:hover`
// can, in jsdom).
let pointerOnToasts = false
if (typeof document !== "undefined") {
  document.addEventListener("pointerover", (e) => {
    pointerOnToasts = Boolean(e.target?.closest?.("[data-sonner-toaster]"))
  }, true)
  document.documentElement.addEventListener("pointerleave", () => {
    pointerOnToasts = false
  })
}

const buttonClass =
  "inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 coarse:h-11 coarse:px-4"

/** A button in a toast. Closes the toast it sits in once its own work is done. */
function ToastAction({ className, onClick, altText, children, ...props }) {
  const id = useContext(ToastIdContext)
  return (
    <button
      type="button"
      aria-label={altText && altText !== children ? altText : undefined}
      className={cn(buttonClass, className)}
      onClick={(e) => {
        onClick?.(e)
        if (e.defaultPrevented || id == null) return
        hover(e.currentTarget, false)
        sonner.dismiss(id)
      }}
      {...props}
    >
      {children}
    </button>
  )
}

/**
 * One toast, drawn by us inside Sonner's stack. Sonner owns the stacking, the
 * timing and the swipe; the card owns how it looks, which is the look the
 * Radix toasts had: title, description, buttons, a close in the corner that
 * is always there, and, for a toast with something to act on, a bar showing
 * its time running out. The bar pauses while the stack is open, which is when
 * Sonner's clock pauses (globals.css).
 */
function ToastCard({ id, title, description, action, variant, duration, timed }) {
  const destructive = variant === "destructive"
  return (
    <div
      data-toast-card=""
      onFocus={(e) => hover(e.currentTarget, true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) hover(e.currentTarget, false)
      }}
      className={cn(
        "relative flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-3 overflow-hidden rounded-lg border p-4 pr-10 shadow-lg coarse:pr-14",
        destructive
          ? "border-destructive bg-destructive text-destructive-foreground"
          : "bg-card text-foreground"
      )}
    >
      <div className="grid min-w-0 flex-1 basis-44 gap-1">
        {title && <p className="text-sm font-medium">{title}</p>}
        {description && <p className="text-sm opacity-90">{description}</p>}
      </div>
      {action && (
        <ToastIdContext.Provider value={id}>
          <div className="flex shrink-0 flex-wrap gap-2">{action}</div>
        </ToastIdContext.Provider>
      )}
      <button
        type="button"
        aria-label="Close"
        onClick={(e) => {
          hover(e.currentTarget, false)
          sonner.dismiss(id)
        }}
        className={cn(
          "absolute right-2 top-2 inline-flex items-center justify-center rounded-md p-1 transition-colors focus:outline-none focus:ring-2 coarse:right-1 coarse:top-1 coarse:h-11 coarse:w-11",
          destructive
            ? "text-red-100 hover:text-white focus:ring-red-300"
            : "text-foreground/60 hover:text-foreground"
        )}
      >
        <X className="h-4 w-4" />
      </button>
      {timed && Number.isFinite(duration) && (
        <span
          aria-hidden="true"
          data-toast-time=""
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left animate-toast-time bg-primary/50"
          style={{ animationDuration: `${duration}ms` }}
        />
      )}
    </div>
  )
}

export { ToastAction, ToastCard }
