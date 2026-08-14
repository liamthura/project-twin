/**
 * The settings dialog: which tab is up, and who is signed in.
 *
 * Everything else lives in one panel per tab. The component this replaces held
 * all five in 1172 lines with 10 tests.
 *
 * `whoami()` decides signed-in rather than localStorage. A Better Auth session
 * is an HttpOnly cookie JavaScript cannot see, so `!!config?.token` reported
 * signed out for everyone who signed in through it -- which hid the account
 * details, disabled most of the dialog, and left no way to sign out at all. It
 * also catches a token the server has stopped accepting, which the old check
 * called signed in.
 *
 * Panels render below the tab row rather than through `TabsContent`, matching
 * ProposalsPanel. Radix mounts every `TabsContent` it is given, which would fire
 * all five panels' fetches the moment the dialog opened.
 */
import { useEffect, useState } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { whoami } from "@/lib/api.js";
import { SETTINGS_TABS, isTabAvailable, defaultTab } from "./settingsTabs.js";
import { AccountPanel } from "./AccountPanel";
import { ServerPanel } from "./ServerPanel";
import { TokenPanel } from "./TokenPanel";
import { AppsPanel } from "./AppsPanel";
import { DataPanel } from "./DataPanel";

export function SettingsDialog({
  isOpen,
  onClose,
  onConnectionChange,
  // Owned by App -- the same state the header's switch used to drive. Passed in
  // rather than held here so a dialog that is closed most of the time is not the
  // source of truth for how the app saves.
  isAutosaveEnabled = true,
  onAutosaveChange = () => {},
  // Also App's. Needed only to write onboarding state back without clearing it:
  // SettingsUpdate requires disabled_sections and writes what it is sent.
  disabledSections = [],
}) {
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [username, setUsername] = useState(null);
  const [activeTab, setActiveTab] = useState(defaultTab(false));

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    setIsSignedIn(false);
    setUsername(null);
    setActiveTab(defaultTab(false));
    whoami()
      .then((me) => {
        if (cancelled) return;
        setIsSignedIn(true);
        setUsername(me.username || "your account");
        setActiveTab(defaultTab(true));
      })
      .catch(() => {
        // Signed out is a state, not an error. Server is the tab that still
        // works without a credential, and it is already selected.
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Your account, this server, and the clients connected to it.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            {SETTINGS_TABS.map((tab) => {
              const available = isTabAvailable(tab.id, isSignedIn);
              return (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  disabled={!available}
                  title={available ? undefined : "Sign in to reach this"}
                >
                  {tab.label}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>

        {activeTab === "account" && isSignedIn && (
          <AccountPanel
            isOpen
            username={username}
            isAutosaveEnabled={isAutosaveEnabled}
            onAutosaveChange={onAutosaveChange}
            disabledSections={disabledSections}
            onSignedOut={() => {
              onConnectionChange?.();
              onClose();
            }}
          />
        )}
        {activeTab === "server" && (
          <ServerPanel
            isSignedIn={isSignedIn}
            onConnectionChange={onConnectionChange}
            onClose={onClose}
          />
        )}
        {activeTab === "tokens" && isSignedIn && <TokenPanel isOpen />}
        {activeTab === "apps" && isSignedIn && <AppsPanel isOpen />}
        {activeTab === "data" && isSignedIn && <DataPanel />}
      </DialogContent>
    </Dialog>
  );
}
