// Segmented-control button classes, shared by ConnectionSettings (tab row,
// connection-type toggle, import-mode toggle) and WelcomeAuth.
export function segmentClass(active, disabled) {
  if (disabled) {
    return "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground/50 cursor-not-allowed";
  }
  return `flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
    active
      ? "border bg-card text-foreground"
      : "text-muted-foreground hover:text-foreground"
  }`;
}
