/**
 * Settings, as a page at #/settings/<tab>.
 *
 * It was a dialog, and four tabs of forms, lists and switches had outgrown one:
 * the tab row wrapped, the body scrolled inside the modal, and none of it could
 * be linked to. As a route it has an address ("Review access" can send you to
 * #/settings/connections), survives a refresh, and uses the page's own scroll.
 *
 * Panels render below the tab row rather than through TabsContent, matching
 * ProposalsPanel: Radix mounts every TabsContent it is given, which would fire
 * every panel's fetches at once.
 */
import { useEffect, useState } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { whoami } from "@/lib/api.js";
import { SETTINGS_TABS, resolveTab } from "./settingsTabs.js";
import { AccountPanel } from "./AccountPanel";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { DataPanel } from "./DataPanel";
import { SectionsPanel } from "./SectionsPanel";
import { ServerPanel } from "./ServerPanel";

const VERSION =
  typeof __APP_VERSION__ === "undefined" ? null : `v${__APP_VERSION__} (${__APP_COMMIT__})`;

export function SettingsPage({
  tab,
  onTabChange,
  // App's, passed in: a page that is not on screen most of the time must not be
  // the source of truth for how the app saves or which sections are on.
  isAutosaveEnabled = true,
  onAutosaveChange = () => {},
  disabledSections = [],
  packs = [],
  onTogglePack,
  onConnectionChange,
}) {
  const active = resolveTab(tab);
  const [username, setUsername] = useState(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    whoami()
      .then((me) => { if (!cancelled) setUsername(me.username || "your account"); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h2>
        <p className="text-sm text-muted-foreground">
          Your account, what is connected to it, which sections are on, and your data.
        </p>
      </div>

      <Tabs value={active} onValueChange={onTabChange}>
        {/* One row at 390px: four tabs at the default padding overflow by a
            few pixels and strand Data on a line of its own. */}
        <TabsList className="flex-nowrap">
          {SETTINGS_TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="px-3 sm:px-4">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="max-w-2xl">
        {active === "account" && (
          <AccountPanel
            isOpen
            username={username}
            isAutosaveEnabled={isAutosaveEnabled}
            onAutosaveChange={onAutosaveChange}
            disabledSections={disabledSections}
            version={VERSION}
            onSignedOut={() => onConnectionChange?.()}
          />
        )}
        {active === "connections" && <ConnectionsPanel />}
        {active === "sections" && <SectionsPanel packs={packs} onTogglePack={onTogglePack} />}
        {active === "data" && (
          <DataPanel
            advanced={
              <ServerPanel isSignedIn onConnectionChange={onConnectionChange} onClose={() => {}} />
            }
            advancedOpen={advancedOpen}
            onAdvancedOpenChange={setAdvancedOpen}
          />
        )}
      </div>
    </div>
  );
}
