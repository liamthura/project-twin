/**
 * Deleting the account, at the foot of Account.
 *
 * Typed rather than clicked through: the username has to be entered exactly
 * before the button unlocks, because nothing brings this back. The download
 * sits in the same dialog, since this is the one moment someone most wants a
 * copy. The server accepts a browser sign-in only, so no assistant holding a
 * token can do this, whatever it may write.
 */
import { useState } from "react";
import { Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { clearConfig, deleteAccount, exportData } from "@/lib/api.js";
import { APP_PATH } from "@/lib/paths.js";
import { signOut } from "@/lib/session.js";

const sentence = (text) => `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;

export function DeleteAccount({ username }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);
  const matches = Boolean(username) && typed === username;

  const onOpenChange = (next) => {
    if (busy) return;
    setOpen(next);
    if (!next) {
      setTyped("");
      setError(null);
    }
  };

  const download = async () => {
    setExporting(true);
    setError(null);
    try {
      await exportData();
    } catch (e) {
      setError(`The download did not start. ${e.message}`);
    } finally {
      setExporting(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(typed);
    } catch (e) {
      // The server does it in one transaction, so a failure left everything.
      setError(e.status === 403 ? sentence(e.message) : "That did not go through. Nothing was deleted.");
      setBusy(false);
      return;
    }
    await signOut();
    clearConfig();
    // A full load, so nothing of the account stays in memory, and the page
    // it lands on says what happened.
    window.location.assign(`${APP_PATH}/?deleted=1`);
  };

  return (
    <div className="space-y-3 border-t pt-4">
      <h2 className="text-base font-semibold">Delete account</h2>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">
          Removes your persona and everything connected to it from this server.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => setOpen(true)}
        >
          Delete account
        </Button>
      </div>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This removes your persona and its history, every suggestion waiting in
              Review, every token and every connected app, and signs you out
              everywhere. It cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted p-3">
              <p className="text-sm">Want a copy first?</p>
              <Button variant="outline" size="sm" onClick={download} disabled={exporting || busy}>
                {exporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Download a copy
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="delete-confirm">
                Type <span className="font-mono">{username}</span> to confirm
              </Label>
              <Input
                id="delete-confirm"
                value={typed}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                onChange={(e) => setTyped(e.target.value)}
              />
            </div>

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirm} disabled={!matches || busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
