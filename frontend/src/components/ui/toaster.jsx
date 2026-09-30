import { useCallback, useEffect, useRef, useState } from "react"

import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"
import { useToast } from "@/components/ui/use-toast"

// Radix's own default.
const DURATION = 5000

/**
 * Each toast keeps its own clock, held only while that toast is hovered or
 * has focus.
 *
 * Radix pauses every toast while the pointer or focus is in its viewport, but
 * once the last toast goes it stops listening (and turns the viewport's
 * pointer events off), so a toast that vanishes from under the pointer, as
 * one does when its Undo is clicked, leaves the pause on. Every later toast
 * then stood until the pointer happened to pass over it again, and Review
 * sends a decision only when its toast goes.
 */
function useOwnClock(duration, open, close) {
  const left = useRef(duration)
  const since = useRef(0)
  const timer = useRef(null)

  const run = useCallback(() => {
    if (!open || timer.current || !Number.isFinite(left.current)) return
    since.current = Date.now()
    timer.current = setTimeout(() => {
      timer.current = null
      close()
    }, Math.max(0, left.current))
  }, [open, close])

  const hold = useCallback(() => {
    if (!timer.current) return
    clearTimeout(timer.current)
    timer.current = null
    left.current -= Date.now() - since.current
  }, [])

  useEffect(() => {
    run()
    return () => {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [run])

  // Held while either is true: the pointer leaving a toast whose Undo has
  // focus must not start it closing. The state copy is only for the time
  // bar, which pauses with the clock.
  const held = useRef({ pointer: false, focus: false })
  const [paused, setPaused] = useState(false)
  const settle = () => {
    const on = held.current.pointer || held.current.focus
    setPaused(on)
    return on ? hold() : run()
  }
  return {
    paused,
    handlers: {
      onPointerEnter: () => { held.current.pointer = true; settle() },
      onPointerLeave: () => { held.current.pointer = false; settle() },
      onFocus: () => { held.current.focus = true; settle() },
      onBlur: (e) => {
        if (e.currentTarget.contains(e.relatedTarget)) return
        held.current.focus = false
        settle()
      },
    },
  }
}

// `timed` draws what is left of the duration along the foot: an Undo that
// ends without warning is one people learn not to trust.
function TimedToast({ duration = DURATION, open, onOpenChange, timed, children, ...props }) {
  const close = useCallback(() => onOpenChange?.(false), [onOpenChange])
  const { paused, handlers } = useOwnClock(duration, open, close)
  return (
    <Toast {...props} {...handlers} open={open} onOpenChange={onOpenChange} duration={Infinity}>
      {children}
      {timed && Number.isFinite(duration) && (
        <span
          aria-hidden="true"
          data-toast-time=""
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left animate-toast-time bg-primary/50"
          style={{ animationDuration: `${duration}ms`, animationPlayState: paused ? "paused" : "running" }}
        />
      )}
    </Toast>
  )
}

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <TimedToast key={id} timed={Boolean(action)} {...props}>
            {/* The words take the line and the buttons go under them when
                both will not fit, rather than squeezing a title to two words
                a line beside them. */}
            <div className="grid min-w-0 flex-1 basis-44 gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
            <ToastClose />
          </TimedToast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
