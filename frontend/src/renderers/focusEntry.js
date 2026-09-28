// "Open this entry": { id, done } from App, set by search or the Stale tab.
// The list that holds the id opens that row, scrolls to it and calls done();
// every other list ignores it.
import { createContext } from "react";

export const FocusEntryContext = createContext(null);
