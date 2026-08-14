/**
 * Connected apps: the fetch, the loading and error states, and the revoke.
 *
 * ConnectedApps.jsx is presentational and takes `grants` and `onRevoke` as
 * props. This is the half that talks to the network.
 *
 * The revoke handler rethrows. ConnectedApps keeps a row in confirm mode by not
 * clearing its own state when `onRevoke` rejects, so swallowing the error here
 * would collapse the row as though the revoke had gone through.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { useToast } from "@/components/ui/use-toast";
import { listConnectedApps, revokeConnectedApp } from "@/lib/api.js";
import ConnectedApps from "@/components/ConnectedApps";

export function AppsPanel({ isOpen }) {
  const { toast } = useToast();

  const [grants, setGrants] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setGrants(await listConnectedApps());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) load();
    // load is stable for this purpose: it closes over nothing that changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleRevoke = async (id) => {
    try {
      await revokeConnectedApp(id);
      toast({
        title: "Connection revoked",
        description:
          "It can no longer get new access. A request already in flight may continue for up to 10 minutes.",
        variant: "success",
      });
      load();
    } catch (err) {
      toast({
        title: "Failed to revoke connection",
        description: err.message,
        variant: "destructive",
      });
      // Rethrown so ConnectedApps knows the revoke didn't go through -- it keeps
      // the confirm row open on a rejection rather than collapsing it as if
      // this had succeeded. See its handleRevoke for the catch.
      throw err;
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Applications you&apos;ve connected through &quot;Allow&quot; on a consent
        screen -- Claude Desktop, an MCP client, or anything else that signed in
        with your account.
      </p>
      {loading ? (
        <div className="flex items-center justify-center py-6 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <ConnectedApps grants={grants} onRevoke={handleRevoke} />
      )}
    </div>
  );
}
