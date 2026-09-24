import { Check, LogOut, Monitor, Moon, Settings, Sun, User, WifiOff } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const THEMES = [
  { id: "light", label: "Light", Icon: Sun },
  { id: "dark", label: "Dark", Icon: Moon },
  { id: "system", label: "System", Icon: Monitor },
];

/** The three states, and the word each shows. `unsaved` is the only one that
 *  offers an action, because it is the only one where the user can do anything. */
const SAVE_LABEL = { saved: "Saved", saving: "Saving…", unsaved: "Unsaved" };

/**
 * The 60px sticky header: what this is on the left, what state it is in on the
 * right.
 *
 * Two things left this bar, both deliberately:
 *
 * The auto-save switch. It is a once-per-lifetime preference and it was
 * competing with content for the most valuable strip on the page; it now lives
 * in Connection Settings. There is a test asserting no such control appears
 * here, because "the switch came back" is the regression this invites.
 *
 * The three-state prose ("Saving…" / "Saved just now" / "Unsaved changes") plus
 * a separate Save button. One chip now carries the state, and the action appears
 * inside it only in the state that has one.
 */
export function Header({
  saveState = "saved",
  isConnected = true,
  theme = "system",
  onSetTheme,
  onSignOut,
  accountName,
  onOpenSettings,
  onSaveNow,
}) {

  return (
    <header className="sticky top-0 z-20 border-b bg-card pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex h-[60px] max-w-6xl items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <svg
            width="22"
            height="22"
            viewBox="0 0 96 96"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <circle
              cx="45"
              cy="40"
              r="15"
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth="9"
            />
            <path
              d="M60 40 v22 a14 14 0 0 1 -14 14 h-9"
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth="9"
              strokeLinecap="round"
            />
          </svg>
          <h1 className="text-lg font-semibold">MyGist</h1>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* One chip, three states. The status is a live region so a save that
              completes without the user looking still reaches a screen reader. */}
          <div
            data-save-state={saveState}
            className="flex items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5 text-xs"
          >
            <span
              role="status"
              className={
                saveState === "unsaved" ? "font-medium text-foreground" : "text-muted-foreground"
              }
            >
              {SAVE_LABEL[saveState] ?? SAVE_LABEL.saved}
            </span>
            {saveState === "unsaved" && (
              <Button
                size="sm"
                variant="link"
                onClick={onSaveNow}
                className="h-auto p-0 text-xs font-medium"
              >
                Save now
              </Button>
            )}
          </div>

          {!isConnected && (
            <Badge variant="destructive" className="gap-1.5">
              <WifiOff className="h-3 w-3" />
              Disconnected
            </Badge>
          )}

          {/* One menu for everything about you rather than the app: Settings,
              theme and sign-out. The theme used to be a lone icon that cycled
              on click, which said neither what it was nor what it would do. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-fast ease-standard hover:bg-muted/50 coarse:min-h-11"
              >
                <User className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                <span className="max-w-[128px] truncate">{accountName || "Account"}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={() => onOpenSettings?.()}>
                <Settings className="h-4 w-4" aria-hidden="true" />
                Settings
              </DropdownMenuItem>
              <div className="my-1 h-px bg-border" role="separator" />
              <p className="px-2 pb-1 pt-1.5 text-xs text-muted-foreground">Theme</p>
              {THEMES.map(({ id, label, Icon }) => (
                <DropdownMenuItem
                  key={id}
                  onSelect={() => onSetTheme?.(id)}
                  aria-label={theme === id ? `${label} theme, current` : `${label} theme`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {label}
                  {theme === id && <Check className="ml-auto h-4 w-4" aria-hidden="true" />}
                </DropdownMenuItem>
              ))}
              <div className="my-1 h-px bg-border" role="separator" />
              <DropdownMenuItem onSelect={() => onSignOut?.()}>
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
