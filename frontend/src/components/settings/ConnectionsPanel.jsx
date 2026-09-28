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
