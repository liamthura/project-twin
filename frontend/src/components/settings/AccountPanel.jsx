/**
 * The account: who you are, how to reach you, your password, and two
 * preferences.
 *
 * The two preferences are slice 1's and slice 4's footholds. Both were put in
 * the old `connection` panel with a comment saying slice 5 would rebuild this
 * dialog with an Account tab and that inventing one early would prejudge it.
 * This is that tab.
 *
 * Neither preference is destructive. Auto-save changes when a write happens, not
 * whether one does, and restoring the getting-started card brings back a card
 * rather than data.
 */
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, LogOut, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { clearConfig, getInstance, setPassword } from "@/lib/api.js";
import { listAccounts, signOut } from "@/lib/session.js";
import { getOnboarding, saveOnboarding } from "@/lib/onboarding.js";
import { EmailSettings } from "@/components/EmailSettings";
import { LinkedAccounts } from "@/components/LinkedAccounts";

// Matches MIN_PASSWORD_LENGTH in backend/main.py and Better Auth's own minimum.
// Checked here so the failure arrives before a round trip, not instead of the
// server's check.
const MIN_PASSWORD_LENGTH = 8;

export function AccountPanel({
  isOpen,
  username,
  isAutosaveEnabled = true,
  onAutosaveChange = () => {},
  disabledSections = [],
  onSignedOut = () => {},
}) {
  const { toast } = useToast();

  // Whether the getting-started card has been dismissed. Only read to decide
  // whether to OFFER the restore -- there is nothing to say to someone whose
  // card is already on screen.
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

  // Fetched here rather than inside LinkedAccounts, because the password form
  // below needs the same two answers -- and two components asking the same
  // question is two answers free to disagree.
  const [sso, setSso] = useState(false);
  const [accounts, setAccounts] = useState([]);

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState(null);

  const loadAccounts = useCallback(async () => {
    const [instance, list] = await Promise.all([
      getInstance().catch(() => null),
      listAccounts().catch(() => []),
    ]);
    setSso(instance?.sso === true);
    setAccounts(list);
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    getOnboarding()
      .then((s) => {
        if (!cancelled) setOnboardingDismissed(!!s.dismissed);
      })
      .catch(() => {
        // Nothing to offer if we cannot tell. The card is either showing
        // already or genuinely unavailable, and a control that might do nothing
        // is worse than no control.
      });
    loadAccounts();
    return () => {
      cancelled = true;
    };
  }, [isOpen, loadAccounts]);

  const handleSignOut = async () => {
    // The session cookie is HttpOnly, so only the service can revoke it.
    // Clearing localStorage alone would look signed out and sign you back in on
    // the next reload.
    await signOut();
    clearConfig();
    onSignedOut();
  };

  const handleSetPassword = async (e) => {
    e.preventDefault();
    setPasswordError(null);

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }

    setPasswordSaving(true);
    try {
      await setPassword(newPassword, currentPassword || undefined);
      toast({ title: "Password updated", variant: "success" });
      setShowPasswordForm(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPasswordError(err.message);
    } finally {
      setPasswordSaving(false);
    }
  };

  const restoreGettingStarted = () => {
    setOnboardingDismissed(false);
    saveOnboarding({ dismissed: false, steps: {} }, disabledSections).catch(() => {
      // The offer is already gone from this panel; a lost write costs one more
      // click on the next visit.
    });
  };

  // An account with a linked provider and no password has nothing to change,
  // and this form cannot set a first one. Offering it would be offering a
  // control that cannot work.
  const hasPassword = accounts.some((a) => a.providerId === "credential");
  const offerPasswordChange = !sso || hasPassword;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/50 p-3 text-sm">
        <span className="flex items-center gap-2">
          <User className="h-4 w-4 text-muted-foreground" />
          Signed in as <strong>{username || "your account"}</strong>
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSignOut}
          className="text-muted-foreground hover:text-foreground"
        >
          <LogOut className="mr-1.5 h-3.5 w-3.5" />
          Sign out
        </Button>
      </div>

      <EmailSettings />

      <LinkedAccounts accounts={accounts} sso={sso} onChanged={loadAccounts} />

      {offerPasswordChange && (
        <div className="border-t pt-4">
          <button
            type="button"
            onClick={() => setShowPasswordForm((v) => !v)}
            className="flex w-full items-center justify-between text-sm font-medium"
          >
            Change password
            {showPasswordForm ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          {showPasswordForm && (
            <form onSubmit={handleSetPassword} className="mt-3 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="current-password">Current password</Label>
                <Input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty if you have not set a password before.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-new-password">Confirm new password</Label>
                <Input
                  id="confirm-new-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              {passwordError && (
                <p className="text-xs text-destructive">{passwordError}</p>
              )}
              <Button type="submit" size="sm" disabled={passwordSaving}>
                {passwordSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Update password"
                )}
              </Button>
            </form>
          )}
        </div>
      )}

      <div className="space-y-3 border-t pt-4">
        <p className="text-sm font-medium">Preferences</p>

        {/* Auto-save, evicted from the header in slice 1. It is a
            once-per-lifetime preference and it was competing with content for
            the most valuable strip on the page. The copy says what happens
            rather than naming a mechanism -- "auto-save" alone does not tell you
            the alternative is a button in the header. */}
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div className="min-w-0 space-y-1">
            <Label htmlFor="autosave-preference" className="text-sm font-medium">
              Save as you type
            </Label>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Changes are saved automatically. Turn this off and the header keeps
              a Save now button instead.
            </p>
          </div>
          <Switch
            id="autosave-preference"
            checked={isAutosaveEnabled}
            onCheckedChange={onAutosaveChange}
            aria-label="Auto-save"
          />
        </div>

        {/* Dismissing the getting-started card is not destructive -- nothing is
            deleted, and #/onboarding/welcome still works if typed -- so this
            brings back a card, not data. */}
        {onboardingDismissed && (
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium">Getting started</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                You dismissed the setup card. Bring it back to pick up where you
                left off.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={restoreGettingStarted}
            >
              Show getting started
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
