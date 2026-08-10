// The seam that lets a list node's `+ Add` trigger render in the header row
// that NAMES the list, while the code that actually adds an item stays in
// ListRenderer.
//
// WHY THIS EXISTS, in one paragraph, because the obvious "simplification" is to
// delete it and build the trigger where the header is:
//
//   Adding an item is `useListItems.addItem`, and that function needs
//   ListRenderer's own `setExpanded` and `setQuery` state to hold three
//   invariants (`expanded` is keyed by array index and must shift on a
//   prepend; a `field_defaults` "@now" token must be resolved AFTER the draft
//   is merged; a stale `query` must be cleared on the path that writes, or the
//   new row is filtered out of view and Add looks like it failed -- see
//   useListItems.js). SectionRenderer holds the header but none of that state.
//   Rebuilding `addItem` up there would duplicate the three invariants that
//   useListItems exists to centralise, and a second entry point that drifts
//   from the first is exactly the failure the Add dialog was extracted to
//   prevent.
//
// So ownership does not move: SectionRenderer publishes an empty DOM element
// sitting in the right header row, and ListRenderer renders its trigger into
// that element with createPortal. React state and context flow down the
// component tree as before -- only the DOM position changes.
//
// The value is a DOM element or null. Null (the default, and what a
// ListRenderer used outside a SectionRenderer sees) means "no slot": render
// the trigger inline, which is also the shape every ListRenderer.test.jsx case
// renders in.
import { createContext, useContext } from "react";

export const HeaderActionSlotContext = createContext(null);

export function useHeaderActionSlot() {
  return useContext(HeaderActionSlotContext);
}
