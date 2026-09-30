import { useCallback, useEffect, useRef } from "react"

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
  // focus must not start it closing.
  const held = useRef({ pointer: false, focus: false })
  const settle = () => (held.current.pointer || held.current.focus ? hold() : run())
  return {
    onPointerEnter: () => { held.current.pointer = true; settle() },
    onPointerLeave: () => { held.current.pointer = false; settle() },
    onFocus: () => { held.current.focus = true; settle() },
    onBlur: (e) => {
      if (e.currentTarget.contains(e.relatedTarget)) return
      held.current.focus = false
      settle()
    },
  }
}

function TimedToast({ duration = DURATION, open, onOpenChange, children, ...props }) {
  const close = useCallback(() => onOpenChange?.(false), [onOpenChange])
  const clock = useOwnClock(duration, open, close)
  return (
    <Toast {...props} {...clock} open={open} onOpenChange={onOpenChange} duration={Infinity}>
      {children}
    </Toast>
  )
}

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <TimedToast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </TimedToast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
