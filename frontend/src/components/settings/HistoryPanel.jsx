/**
 * Previous versions of a section, and a way back to one.
 *
 * Every write to the persona now keeps the version it displaced, which is what
 * makes an agent's mistake survivable -- before this, a tool call that
 * overwrote a project's notes with something wrong destroyed the old value
 * outright.
 *
 * Restore this opens a preview first: what restoring would bring back, remove
 * and change, compared with now (historyDiff.js). The restore itself happens
 * from the preview. It used to be one click with only the date, the writer and
 * an entry count to go on -- reversible, but picking the right version meant
 * restoring until one looked right.
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
import { api, getHistoryVersion, listHistory, revertHistory } from "@/lib/api.js";
import { formatInstant } from "@/renderers/isoDate";
import { restoreChanges } from "./historyDiff";

// Date and time: a section can change several times in a day, and the
// versions are told apart by when. The same words as every other date.
const whenText = (iso) => formatInstant(iso, { time: true });

/**
 * `fixedSection` scopes the panel to one section and drops the picker: opened
 * from a section's own header, the section is the one you are looking at.
 * `onRestored(section)` lets the page refetch it -- without that, the editor
 * keeps showing the pre-restore data, and the next autosave writes it back
 * over the version that was just restored.
 */
export function HistoryPanel({ fixedSection = null, sectionTitle = null, pack = null, onRestored } = {}) {
  const { toast } = useToast();

  const [packs, setPacks] = useState([]);
  const [section, setSection] = useState(fixedSection || "");
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [reverting, setReverting] = useState(null);
  // { id, groups } once loaded; groups null when it could not be worked out.
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (fixedSection) return undefined;
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
  }, [fixedSection]);

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

  const openPreview = async (version) => {
    setPreview({ id: version.id, loading: true });
    try {
      const { version: then, current } = await getHistoryVersion(section, version.id);
      setPreview({ id: version.id, groups: pack ? restoreChanges(pack, current, then) : null });
    } catch {
      setPreview({ id: version.id, groups: null });
    }
  };

  const handleRevert = async (version) => {
    setReverting(version.id);
    try {
      await revertHistory(section, version.id);
      toast({
        title: "Section restored",
        description: `${sectionTitle || section} is back to how it was on ${whenText(
          version.replaced_at
        )}. This is itself undoable.`,
        variant: "success",
      });
      onRestored?.(section);
      setPreview(null);
      await load(section);
    } catch (error) {
      toast({
        title: "Restore failed",
        description: "Nothing was changed. Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setReverting(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {!fixedSection && (
          <>
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
          </>
        )}
        {/* Scoped, the dialog around it already says this. */}
        {!fixedSection && (
          <p className="text-xs text-muted-foreground">
            The last {versions.length === 1 ? "version" : "versions"} of this
            section, kept automatically whenever anything writes to it. Restoring
            one can itself be undone.
          </p>
        )}
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
            <div key={version.id}>
            <div className="flex items-center justify-between gap-3 p-3">
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
              {/* Red, because it overwrites what is there now; outlined, like
                  Revoke and Unlink, because it is the trigger and not a final
                  confirm -- and it can itself be undone from this list. */}
              {preview?.id !== version.id && (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={reverting !== null}
                  onClick={() => openPreview(version)}
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  Restore this
                </Button>
              )}
            </div>
            {preview?.id === version.id && (
              <RestorePreview
                preview={preview}
                reverting={reverting === version.id}
                onCancel={() => setPreview(null)}
                onRestore={() => handleRevert(version)}
              />
            )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// What restoring one version would do, and the button that does it.
function RestorePreview({ preview, reverting, onCancel, onRestore }) {
  const { loading, groups } = preview;
  const matches = Array.isArray(groups) && groups.length === 0;
  return (
    <div data-restore-preview className="space-y-3 border-t bg-muted/30 p-3 text-sm">
      {loading ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Working out what would change
        </p>
      ) : groups === null ? (
        <p className="text-muted-foreground">
          Couldn&apos;t show what would change. You can still restore it, and undo that
          from this list.
        </p>
      ) : matches ? (
        <p className="text-muted-foreground">This version matches what you have now.</p>
      ) : (
        <>
          <p className="font-medium">Restoring this would:</p>
          {groups.map((g) => (
            <div key={g.title} className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">{g.title}</p>
              <ul className="space-y-1">
                {g.back.map((name) => (
                  <li key={`b:${name}`}>
                    <span className="font-medium text-emerald-700 dark:text-emerald-300">Bring back</span> {name}
                  </li>
                ))}
                {g.removed.map((name) => (
                  <li key={`r:${name}`}>
                    <span className="font-medium text-destructive">Remove</span> {name}{" "}
                    <span className="text-muted-foreground">(added since)</span>
                  </li>
                ))}
                {g.changed.map((c) => (
                  <li key={`c:${c.name}`}>
                    {c.name && (
                      <>
                        <span className="font-medium">Change</span> {c.name}
                      </>
                    )}
                    <ul className={c.name ? "mt-0.5 pl-4" : ""}>
                      {c.fields.map((f) => (
                        <li key={f.field} className="break-words text-xs text-muted-foreground">
                          {f.field}: {f.from} → {f.to}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={loading || matches || reverting}
          onClick={onRestore}
        >
          {reverting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Undo2 className="h-3.5 w-3.5" />
          )}
          Restore this
        </Button>
      </div>
    </div>
  );
}
