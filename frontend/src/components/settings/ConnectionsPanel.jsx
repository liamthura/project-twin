/**
 * Everything connected to your persona, in one place.
 *
 * Tokens and connected apps used to be two tabs, but they answer one question
 * -- what can reach my persona, and how do I cut it off -- so they are one
 * list in two groups. OAuth apps first: they are what a client that can open
 * a browser should use, and a token is the fallback for one that cannot.
 */
import { AppsPanel } from "./AppsPanel";
import { TokenPanel } from "./TokenPanel";

export function ConnectionsPanel() {
  return (
    <div className="space-y-8">
      <section aria-labelledby="connections-apps" className="space-y-3">
        <h3 id="connections-apps" className="text-sm font-semibold">
          Connected apps
        </h3>
        <AppsPanel isOpen />
      </section>
      <section aria-labelledby="connections-tokens" className="space-y-3 border-t pt-6">
        <h3 id="connections-tokens" className="text-sm font-semibold">
          Tokens
        </h3>
        <TokenPanel isOpen />
      </section>
    </div>
  );
}
