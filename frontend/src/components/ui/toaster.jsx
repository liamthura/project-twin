import { Toaster as Sonner } from "sonner"

/**
 * Sonner's stack, as project-lazybee uses it: toasts wait as a deck and
 * spread when you hover, each with its own clock. Every clock stops while the
 * deck is open, and while the tab is hidden.
 *
 * It replaced Radix Toast, which showed one toast at a time: a second
 * decision in Review took the first one's place and sent it with no way back.
 * Stacked, each keeps its Undo until its own toast goes.
 *
 * Bottom left, where the Radix toasts were: centred or on the right, the deck
 * would sit over Review's bulk bar, which is sticky at the foot of the column.
 * The cards are ours (ToastCard), so Sonner's own look never shows.
 */
export function Toaster() {
  return <Sonner position="bottom-left" visibleToasts={3} gap={8} />
}
