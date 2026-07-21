import { useState } from "react";
import { Plus, Trash2, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ArrayInput } from "@/components/ArrayInput";

// Learning Log Editor
export default function LearningLogEditor({
  data,
  onChange,
  onShowConfirmation,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedEntries, setExpandedEntries] = useState({});

  const entries = data.entries || [];

  const toggleEntry = (key) =>
    setExpandedEntries((prev) => ({ ...prev, [key]: !prev[key] }));

  const updateEntry = (index, field, value) => {
    const next = [...entries];
    next[index] = { ...next[index], [field]: value };
    onChange({ ...data, entries: next });
  };

  const addEntry = () => {
    setSearchTerm("");
    const newIndex = entries.length;
    onChange({
      ...data,
      entries: [
        ...entries,
        {
          topic: "",
          details: "",
          source: "manual",
          tags: [],
          timestamp: new Date().toISOString(),
        },
      ],
    });
    setExpandedEntries((prev) => ({ ...prev, [newIndex]: true }));
  };

  const removeEntry = (index) => {
    const entry = entries[index];
    const doRemove = () => {
      onChange({ ...data, entries: entries.filter((_, i) => i !== index) });
      setExpandedEntries((prev) => {
        const next = {};
        for (const [k, v] of Object.entries(prev)) {
          const i = Number(k);
          if (i < index) next[i] = v;
          else if (i > index) next[i - 1] = v;
        }
        return next;
      });
    };
    if (onShowConfirmation) {
      onShowConfirmation(
        "Remove Learning Entry",
        `Remove "${entry?.topic || "entry"}"? This action cannot be undone.`,
        doRemove,
      );
    } else {
      doRemove();
    }
  };

  const matchesSearch = (entry) => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return true;
    return [entry.topic, entry.details, ...(entry.tags || [])]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q);
  };

  // Newest first; editing still targets the original array index.
  const sortedIndexes = entries
    .map((_, i) => i)
    .sort((a, b) =>
      (entries[b].timestamp || "").localeCompare(entries[a].timestamp || ""),
    );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="border-b">
          <div
            className="-m-6 flex cursor-pointer items-center justify-between rounded-t-lg p-6 transition-colors hover:bg-muted/50"
            onClick={() => setCollapsed(!collapsed)}
          >
            <div className="flex items-center gap-2">
              <ChevronDown
                className={`h-5 w-5 transition-transform ${
                  collapsed ? "-rotate-90" : ""
                }`}
              />
              <div>
                <CardTitle>Learning Log</CardTitle>
                <CardDescription>
                  Things you've learned, decisions you've made, and follow-ups —
                  captured from conversations or added here.
                </CardDescription>
              </div>
            </div>
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                addEntry();
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add entry
            </Button>
          </div>
        </CardHeader>
        {!collapsed && (
          <CardContent className="space-y-4">
            {entries.length > 0 && (
              <div className="flex flex-wrap gap-2 items-end">
                <div className="flex-1 min-w-[200px] space-y-1.5">
                  <Label htmlFor="entry-search" className="text-xs">
                    Search
                  </Label>
                  <Input
                    id="entry-search"
                    placeholder="Search topic, details, or tags..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="h-9"
                  />
                </div>
              </div>
            )}

            {entries.length === 0 ? (
              <EmptyState>No entries yet. Add one to get started.</EmptyState>
            ) : (
              <div>
                {sortedIndexes
                  .filter((idx) => matchesSearch(entries[idx]))
                  .map((idx) => {
                    const entry = entries[idx];
                    const isExpanded = expandedEntries[idx];
                    const tagCount = (entry.tags || []).length;
                    const followupCount = (entry.followup_items || []).length;
                    const date = (entry.timestamp || "").slice(0, 10);
                    return (
                      <div
                        key={entry.id || idx}
                        className="border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors"
                      >
                        {/* Collapsed Header */}
                        <div
                          className="flex items-center gap-2 p-3 cursor-pointer"
                          onClick={() => toggleEntry(idx)}
                        >
                          <ChevronDown
                            className={`h-4 w-4 transition-transform text-muted-foreground ${
                              isExpanded ? "" : "-rotate-90"
                            }`}
                          />
                          <div className="flex-1 flex items-center gap-2 min-w-0">
                            <span className="font-medium truncate">
                              {entry.topic || "Untitled entry"}
                            </span>
                            <div className="hidden sm:flex gap-1.5 items-center flex-shrink-0">
                              {date && (
                                <Badge
                                  variant="secondary"
                                  className="h-5 text-xs font-mono"
                                >
                                  {date}
                                </Badge>
                              )}
                              {entry.source && (
                                <Badge
                                  variant="outline"
                                  className="h-5 text-xs"
                                >
                                  {entry.source}
                                </Badge>
                              )}
                              {tagCount > 0 && (
                                <Badge
                                  variant="secondary"
                                  className="h-5 text-xs"
                                >
                                  {tagCount} tags
                                </Badge>
                              )}
                              {followupCount > 0 && (
                                <Badge
                                  variant="secondary"
                                  className="h-5 text-xs"
                                >
                                  {followupCount} follow-ups
                                </Badge>
                              )}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeEntry(idx);
                            }}
                            className="tap-target h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>

                        {/* Expanded Form */}
                        {isExpanded && (
                          <div className="border-t bg-background/50 p-4 space-y-4">
                            <div className="space-y-2">
                              <Label>Topic</Label>
                              <Input
                                value={entry.topic || ""}
                                onChange={(e) =>
                                  updateEntry(idx, "topic", e.target.value)
                                }
                                placeholder="e.g. React Server Components"
                                className="h-9 bg-background"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Details</Label>
                              <Textarea
                                value={entry.details || ""}
                                onChange={(e) =>
                                  updateEntry(idx, "details", e.target.value)
                                }
                                placeholder="What you learned or discussed..."
                                rows={4}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Source</Label>
                              <Input
                                value={entry.source || ""}
                                onChange={(e) =>
                                  updateEntry(idx, "source", e.target.value)
                                }
                                placeholder="e.g. conversation, article, course"
                                className="h-9 bg-background"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Tags</Label>
                              <ArrayInput
                                items={entry.tags || []}
                                onChange={(items) =>
                                  updateEntry(idx, "tags", items)
                                }
                                placeholder="e.g. react, architecture"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Key Decisions</Label>
                              <ArrayInput
                                items={entry.key_decisions || []}
                                onChange={(items) =>
                                  updateEntry(idx, "key_decisions", items)
                                }
                                placeholder="e.g. Chose Postgres over SQLite"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Follow-up Items</Label>
                              <ArrayInput
                                items={entry.followup_items || []}
                                onChange={(items) =>
                                  updateEntry(idx, "followup_items", items)
                                }
                                placeholder="e.g. Read the migration guide"
                              />
                            </div>
                            {(entry.related_entries || []).length > 0 && (
                              <div className="space-y-2">
                                <Label>Related</Label>
                                <div className="flex flex-wrap gap-1.5">
                                  {entry.related_entries.map((link, i) => (
                                    <Badge
                                      key={i}
                                      variant="outline"
                                      className="h-5 text-xs"
                                    >
                                      {link.type}: {link.id}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                            <p className="text-xs text-muted-foreground font-mono">
                              {entry.id ? `${entry.id} · ` : ""}
                              {entry.timestamp || ""}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
