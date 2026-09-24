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
import { SETTINGS_TABS, defaultTab, resolveTab } from "./settingsTabs.js";
import { AccountPanel } from "./AccountPanel";
import { ServerPanel } from "./ServerPanel";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { DataPanel } from "./DataPanel";

const VERSION =
  typeof __APP_VERSION__ === "undefined" ? null : `v${__APP_VERSION__} (${__APP_COMMIT__})`;

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
  // Where to land once signed in. Older ids ("tokens", "apps", "server") are
  // mapped to where those panels live now -- see settingsTabs.js.
  initialTab = null,
}) {
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [checked, setChecked] = useState(false);
  const [username, setUsername] = useState(null);
  const [activeTab, setActiveTab] = useState(defaultTab());
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    const { tab, advanced } = resolveTab(initialTab);
    setIsSignedIn(false);
    setChecked(false);
    setUsername(null);
    setActiveTab(tab);
    setAdvancedOpen(advanced);
    whoami()
      .then((me) => {
        if (cancelled) return;
        setIsSignedIn(true);
        setUsername(me.username || "your account");
      })
      .catch(() => {
        // Signed out is a state, not an error: the Server panel is what shows.
      })
      .finally(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, initialTab]);

  const serverPanel = (
    <ServerPanel
      isSignedIn={isSignedIn}
      onConnectionChange={onConnectionChange}
      onClose={onClose}
    />
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            {isSignedIn
              ? "Your account, what is connected to it, and your data."
              : "Which MyGist server this app talks to."}
          </DialogDescription>
        </DialogHeader>

        {/* A fixed floor, so switching tabs does not make the dialog jump.
            Panels render below the tab row rather than through TabsContent:
            Radix mounts every TabsContent it is given, which would fire every
            panel's fetches the moment the dialog opened. */}
        <div className="min-h-[420px]">
          {checked && !isSignedIn && serverPanel}

          {isSignedIn && (
            <div className="space-y-4">
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                  {SETTINGS_TABS.map((tab) => (
                    <TabsTrigger key={tab.id} value={tab.id}>
                      {tab.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>

              {activeTab === "account" && (
                <AccountPanel
                  isOpen
                  username={username}
                  isAutosaveEnabled={isAutosaveEnabled}
                  onAutosaveChange={onAutosaveChange}
                  disabledSections={disabledSections}
                  version={VERSION}
                  onSignedOut={() => {
                    onConnectionChange?.();
                    onClose();
                  }}
                />
              )}
              {activeTab === "connections" && <ConnectionsPanel />}
              {activeTab === "data" && (
                <DataPanel
                  advanced={serverPanel}
                  advancedOpen={advancedOpen}
                  onAdvancedOpenChange={setAdvancedOpen}
                />
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
