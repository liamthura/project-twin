/**
 * Previous versions of a section, and a way back to one.
 *
 * Every write to the persona now keeps the version it displaced, which is what
 * makes an agent's mistake survivable -- before this, a tool call that
 * overwrote a project's notes with something wrong destroyed the old value
 * outright.
 *
 * Deliberately read-and-revert only, with no diff view. The revision list gives
 * the date, the client that caused the write and how many entries the old
 * version held, and a revert is itself reversible -- so the cost of trying one
 * is a click, which is cheaper than a diff viewer is to build and read.
 */
import { useEffect, useState } from "react";
import { History, Loader2, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { api, listHistory, revertHistory } from "@/lib/api.js";

function whenText(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function HistoryPanel() {
  const { toast } = useToast();

  const [packs, setPacks] = useState([]);
  const [section, setSection] = useState("");
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [reverting, setReverting] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api("/settings")
      .then((s) => {
        if (cancelled) return;
        const enabled = (s.packs || []).filter((p) => p.enabled);
        setPacks(enabled);
        // Pick one so the panel opens on something rather than on a prompt to
        // choose. Projects if it is there, since it is the section that changes
        // most and the one most worth being able to undo.
        const preferred = enabled.find((p) => p.key === "projects") || enabled[0];
        if (preferred) setSection(preferred.key);
      })
      .catch(() => {
        /* non-fatal: the picker stays empty and says so */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = async (key) => {
    if (!key) return;
    setLoading(true);
    try {
      setVersions(await listHistory(key));
    } catch (error) {
      toast({
        title: "Could not load history",
        description: error.message,
        variant: "destructive",
      });
      setVersions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(section);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  const handleRevert = async (version) => {
    setReverting(version.id);
    try {
      await revertHistory(section, version.id);
      toast({
        title: "Section restored",
        description: `${section} is back to how it was on ${whenText(
          version.replaced_at
        )}. This is itself undoable.`,
        variant: "success",
      });
      await load(section);
    } catch (error) {
      toast({
        title: "Restore failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setReverting(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="history-section">Section</Label>
        <Select value={section} onValueChange={setSection}>
          <SelectTrigger id="history-section">
            <SelectValue placeholder="Choose a section" />
          </SelectTrigger>
          <SelectContent>
            {packs.map((pack) => (
              <SelectItem key={pack.key} value={pack.key}>
                {pack.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          The last {versions.length === 1 ? "version" : "versions"} of this
          section, kept automatically whenever anything writes to it. Restoring
          one can itself be undone.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading history
        </div>
      ) : versions.length === 0 ? (
        <EmptyState>
          <History className="mx-auto mb-2 h-5 w-5 opacity-60" />
          Nothing to restore yet. A version appears here the next time something
          changes this section.
        </EmptyState>
      ) : (
        <div className="divide-y rounded-lg border">
          {versions.map((version) => (
            <div
              key={version.id}
              className="flex items-center justify-between gap-3 p-3"
            >
              <div className="space-y-0.5">
                <p className="text-sm font-medium">
                  {whenText(version.replaced_at)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {version.entity_count}{" "}
                  {version.entity_count === 1 ? "entry" : "entries"}
                  {version.written_by
                    ? ` · replaced by ${version.written_by}`
                    : " · replaced from the web app"}
                </p>
              </div>
              {/* Destructive and labelled: it overwrites what is there now. */}
              <Button
                variant="destructive"
                size="sm"
                disabled={reverting !== null}
                onClick={() => handleRevert(version)}
              >
                {reverting === version.id ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                )}
                Restore this
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
