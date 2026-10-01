/**
 * Everything connected to your persona, in one place.
 *
 * Tokens and connected apps used to be two tabs, but they answer one question
 * -- what can reach my persona, and how do I cut it off -- so they are one
 * list in two groups. OAuth apps first: they are what a client that can open
 * a browser should use, and a token is the fallback for one that cannot.
 */
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";

import { AppsPanel } from "./AppsPanel";
import { TokenPanel } from "./TokenPanel";

export function ConnectionsPanel({ onConnect }) {
  return (
    <div className="space-y-8">
      {/* The same first screen onboarding opens on. Settings used to have no
          way to connect an assistant at all, only to list what already was. */}
      {onConnect && (
        <Button variant="outline" size="sm" onClick={onConnect}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Connect an assistant
        </Button>
      )}
      <section aria-labelledby="connections-apps" className="space-y-3">
        <h2 id="connections-apps" className="text-base font-semibold">
          Connected apps
        </h2>
        <AppsPanel isOpen />
      </section>
      <section aria-labelledby="connections-tokens" className="space-y-3 border-t pt-6">
        <h2 id="connections-tokens" className="text-base font-semibold">
          Tokens
        </h2>
        <TokenPanel isOpen />
      </section>
    </div>
  );
}
