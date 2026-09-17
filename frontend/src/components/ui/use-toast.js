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

// A new toast replaces the standing one rather than queueing behind it: this
// app raises them for the result of an action the user just took, and the
// latest result is the one worth reading.
function toast(props) {
  const id = String(++seq);
  publish([
    {
      ...props,
      id,
      open: true,
      onOpenChange: (open) => {
        if (!open) dismiss(id);
      },
    },
  ]);
}

function useToast() {
  return { toasts: useSyncExternalStore(subscribe, getToasts, getToasts), toast };
}

export { useToast, toast };
