// `toast()` for the whole app, over Sonner's stack.
//
// The call shape is the one every caller already used with the Radix toasts:
// { title, description, variant, duration, action, onClose }, returning
// { id, dismiss }. Sonner holds the toasts; this only draws each as our card.
//
// Toasts stack rather than replace one another. `onClose` runs once, however
// the toast goes: its time, its close button, a swipe, or a dismiss. Review
// sends a decision then, so Undo is good for exactly as long as the toast is
// there to offer it.
import { createElement } from "react";
import { toast as sonner } from "sonner";

import { ToastCard } from "./toast";

// Radix's default, which every caller that names no duration was written for.
const DURATION = 5000;

let seq = 0;

function toast({ onClose, duration = DURATION, ...props }) {
  const id = `toast-${++seq}`;
  let told = false;
  const closed = () => {
    if (told) return;
    told = true;
    onClose?.();
  };
  sonner.custom(
    (tid) => createElement(ToastCard, { ...props, id: tid, duration, timed: Boolean(props.action) }),
    { id, duration, onDismiss: closed, onAutoClose: closed },
  );
  return { id, dismiss: () => sonner.dismiss(id) };
}

function useToast() {
  return { toast };
}

export { useToast, toast };
