// One toast at a time, held in module scope so `toast()` can be called from
// anywhere -- an event handler, a promise callback, a module with no hook
// context -- and read back by the single <Toaster />.
//
// Module scope is the part that matters and the part that surprises: a toast
// raised in one test is still standing in the next, because it never belonged
// to a component and RTL's cleanup cannot reach it. App.test.jsx asserts
// against that deliberately.
//
// Radix owns the timing. Each toast's `duration` prop closes it and calls
// `onOpenChange(false)`; REMOVE_DELAY is only the grace period that lets the
// exit animation finish before the element unmounts.
import { useSyncExternalStore } from "react";

const REMOVE_DELAY = 3000;

let toasts = [];
let seq = 0;
const listeners = new Set();

function publish(next) {
  toasts = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Identity is the subscription: useSyncExternalStore re-renders when this
// returns a new reference, so it returns the stored array itself.
function getToasts() {
  return toasts;
}

function dismiss(id) {
  publish(toasts.map((t) => (t.id === id ? { ...t, open: false } : t)));
  // Filtering by id makes a stale timer harmless: it can only ever match the
  // toast it was scheduled for, never the one that replaced it.
  setTimeout(() => publish(toasts.filter((t) => t.id !== id)), REMOVE_DELAY);
}

// `onClose` for each standing toast, kept out of the toast objects because the
// Toaster spreads those onto Radix's Root.
const closers = new Map();

function closed(id) {
  const onClose = closers.get(id);
  closers.delete(id);
  onClose?.();
}

// A new toast replaces the standing one rather than queueing behind it: this
// app raises them for the result of an action the user just took, and the
// latest result is the one worth reading.
//
// `onClose` runs once, however the toast goes: its duration, its close
// button, a dismiss, or a newer toast replacing it. Review sends a decision
// then rather than on a timer of its own, because Radix pauses a toast's
// duration while the pointer is on it: a separate 8s timer sent the decision
// while the toast still stood there offering an Undo that no longer worked.
function toast({ onClose, ...props }) {
  const id = String(++seq);
  for (const standing of [...closers.keys()]) closed(standing);
  if (onClose) closers.set(id, onClose);
  publish([
    {
      ...props,
      id,
      open: true,
      onOpenChange: (open) => {
        if (!open) {
          closed(id);
          dismiss(id);
        }
      },
    },
  ]);
  // A handle, as shadcn's toast() returns: Review closes its own Undo toast
  // when the reader leaves before it has gone.
  return {
    id,
    dismiss: () => {
      closed(id);
      dismiss(id);
    },
  };
}

function useToast() {
  return { toasts: useSyncExternalStore(subscribe, getToasts, getToasts), toast };
}

export { useToast, toast };
