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

import { openFeedback } from "@/lib/feedback.js";

import { ToastAction, ToastCard } from "./toast";

// Radix's default, which every caller that names no duration was written for.
const DURATION = 5000;

let seq = 0;

// Every destructive toast in the app is a failure, and with no error tracking
// a report from the person who saw it is how the owner hears of one. One place
// rather than fourteen; a toast with its own action keeps it.
function withReport(props) {
  if (props.variant !== "destructive" || props.action) return props;
  const full = [props.title, props.description].filter((s) => typeof s === "string" && s).join(". ");
  // Cut: an API error carries the response body, which can be a whole HTML
  // page, and a prefill past the 5,000-character limit could never be sent.
  const said = full.length > 300 ? `${full.slice(0, 299)}…` : full;
  return {
    ...props,
    action: createElement(
      ToastAction,
      {
        altText: "Report this problem",
        // Out of the toast first. Sonner hands focus back to wherever it came
        // from the moment it leaves a toast; done after the island had taken
        // it, that pulled focus out of the panel and the panel closed.
        onClick: (e) => {
          e.currentTarget.blur();
          openFeedback({ kind: "problem", message: `The app said: "${said}"` });
        },
      },
      "Report",
    ),
  };
}

function toast({ onClose, duration = DURATION, ...rest }) {
  const props = withReport(rest);
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
