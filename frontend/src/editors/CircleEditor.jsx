import { useState } from "react";
import { Plus, Trash2, ChevronDown, Info } from "lucide-react";

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoDialog } from "@/components/ui/info-dialog";
import { ArrayInput } from "@/components/ArrayInput";

// Circle Editor
export default function CircleEditor({ data, onChange, onShowConfirmation }) {
  const [collapsed, setCollapsed] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedConnections, setExpandedConnections] = useState({});
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newConnectionName, setNewConnectionName] = useState("");
  const [newConnectionRelationship, setNewConnectionRelationship] =
    useState("");

  // Info modal state
  const [infoModal, setInfoModal] = useState({
    isOpen: false,
    title: "",
    overview: "",
    tips: [],
  });

  const sectionInfo = {
    connections: {
      title: "Connections",
      overview:
        "Track the important people in your life and your relationships with them. This helps AI understand your social context and tailor suggestions accordingly.",
      tips: [
        "Name: The person's full name or preferred name.",
        "Relationship: How you know them - e.g., 'Friend from university', 'Colleague at Google', 'Mentor', 'Family member'.",
        "Traits: Key characteristics or tags that describe them - personality, interests, expertise, etc.",
        "Notes: Context about your relationship, shared experiences, important details to remember.",
        "Use this to remember details about people that matter in your life.",
      ],
    },
  };

  const openInfo = (sectionKey) => {
    const info = sectionInfo[sectionKey];
    if (info) {
      setInfoModal({ isOpen: true, ...info });
    }
  };

  const toggleConnection = (index) => {
    setExpandedConnections((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const addConnection = () => {
    if (newConnectionName.trim()) {
      onChange({
        ...data,
        connections: [
          {
            name: newConnectionName.trim(),
            relationship: newConnectionRelationship.trim(),
            traits: [],
            notes: "",
          },
          ...(data.connections || []),
        ],
      });
      // Expand the newly added connection
      setExpandedConnections((prev) => ({
        ...prev,
        0: true,
      }));
      // Reset modal state
      setNewConnectionName("");
      setNewConnectionRelationship("");
      setIsAddModalOpen(false);
    }
  };

  const updateConnection = (index, field, value) => {
    const newConnections = [...(data.connections || [])];
    newConnections[index] = { ...newConnections[index], [field]: value };
    onChange({ ...data, connections: newConnections });
  };

  const removeConnection = (index) => {
    const connection = (data.connections || [])[index];
    if (onShowConfirmation) {
      onShowConfirmation(
        "Remove Connection",
        `Remove "${
          connection?.name || "connection"
        }"? This action cannot be undone.`,
        () => {
          onChange({
            ...data,
            connections: (data.connections || []).filter((_, i) => i !== index),
          });
        },
      );
    } else {
      onChange({
        ...data,
        connections: (data.connections || []).filter((_, i) => i !== index),
      });
    }
  };

  // Filter connections
  const filteredConnections = [...(data.connections || [])].filter(
    (connection) => {
      const searchLower = searchTerm.toLowerCase();
      const matchesName = connection.name?.toLowerCase().includes(searchLower);
      const matchesRelationship = connection.relationship
        ?.toLowerCase()
        .includes(searchLower);
      const matchesTrait = (connection.traits || []).some((trait) =>
        trait.toLowerCase().includes(searchLower),
      );
      return matchesName || matchesRelationship || matchesTrait;
    },
  );

  const hasActiveFilters = searchTerm;

  const clearFilters = () => {
    setSearchTerm("");
  };

  return (
    <div className="space-y-6">
      {/* Connections Section */}
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
                <CardTitle className="flex items-center gap-2">
                  Connections
                  <Button
                    variant="ghost"
                    size="icon"
                    className="tap-target h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      openInfo("connections");
                    }}
                  >
                    <Info className="h-4 w-4" />
                  </Button>
                </CardTitle>
                <CardDescription>
                  People who matter in your life and your relationships with
                  them
                </CardDescription>
              </div>
            </div>
            <Button
              onClick={(e) => {
                e.stopPropagation();
                setIsAddModalOpen(true);
              }}
              size="sm"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add connection
            </Button>
          </div>
        </CardHeader>
        {!collapsed && (
          <CardContent className="space-y-4">
            {/* Search Bar */}
            {(data.connections || []).length > 0 && (
              <div className="flex flex-wrap gap-2 items-end">
                <div className="flex-1 min-w-[200px] space-y-1.5">
                  <Label htmlFor="connection-search" className="text-xs">
                    Search
                  </Label>
                  <Input
                    id="connection-search"
                    placeholder="Search connections..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="h-9"
                  />
                </div>
                {hasActiveFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearFilters}
                    className="h-9"
                  >
                    Clear filters
                  </Button>
                )}
              </div>
            )}

            {/* Connections List */}
            {filteredConnections.length > 0 ? (
              <div>
                {filteredConnections.map((connection, idx) => {
                  const originalIndex = (data.connections || []).indexOf(
                    connection,
                  );
                  const isExpanded = expandedConnections[originalIndex];
                  const hasTraits = (connection.traits || []).length > 0;
                  const hasNotes = !!connection.notes;

                  return (
                    <div
                      key={idx}
                      className="border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors"
                    >
                      {/* Collapsed Header */}
                      <div
                        className="flex items-center gap-2 p-3 cursor-pointer"
                        onClick={() => toggleConnection(originalIndex)}
                      >
                        <ChevronDown
                          className={`h-4 w-4 transition-transform text-muted-foreground ${
                            isExpanded ? "" : "-rotate-90"
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">
                              {connection.name || "Untitled connection"}
                            </span>
                            <div className="hidden sm:flex gap-1.5 items-center flex-shrink-0">
                              {hasTraits && (
                                <Badge
                                  variant="secondary"
                                  className="h-5 text-xs"
                                >
                                  {connection.traits.length} traits
                                </Badge>
                              )}
                              {hasNotes && (
                                <Badge
                                  variant="secondary"
                                  className="h-5 text-xs"
                                >
                                  notes
                                </Badge>
                              )}
                            </div>
                          </div>
                          {connection.relationship && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                              {connection.relationship}
                            </p>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeConnection(originalIndex);
                          }}
                          className="tap-target h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      {/* Expanded Content */}
                      {isExpanded && (
                        <div className="border-t bg-background/50 p-4">
                          <div className="grid gap-4 lg:grid-cols-[1fr_1.5fr]">
                            {/* Left Column: Name, Relationship, Traits */}
                            <div className="space-y-4">
                              <div className="space-y-2">
                                <Label>Name</Label>
                                <Input
                                  value={connection.name || ""}
                                  onChange={(e) =>
                                    updateConnection(
                                      originalIndex,
                                      "name",
                                      e.target.value,
                                    )
                                  }
                                  placeholder="Person's name"
                                  className="h-9 bg-background"
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>Relationship</Label>
                                <Input
                                  value={connection.relationship || ""}
                                  onChange={(e) =>
                                    updateConnection(
                                      originalIndex,
                                      "relationship",
                                      e.target.value,
                                    )
                                  }
                                  placeholder="e.g. Friend from university"
                                  className="h-9 bg-background"
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>Traits</Label>
                                <ArrayInput
                                  items={connection.traits || []}
                                  onChange={(items) =>
                                    updateConnection(
                                      originalIndex,
                                      "traits",
                                      items,
                                    )
                                  }
                                  placeholder="Add trait..."
                                />
                              </div>
                            </div>

                            {/* Right Column: Notes */}
                            <div className="space-y-2">
                              <Label>Notes</Label>
                              <Textarea
                                value={connection.notes || ""}
                                onChange={(e) =>
                                  updateConnection(
                                    originalIndex,
                                    "notes",
                                    e.target.value,
                                  )
                                }
                                placeholder="Context about your relationship, shared experiences, important details..."
                                className="min-h-[200px] bg-background text-sm resize-none"
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState>
                {hasActiveFilters
                  ? "No connections match your search"
                  : "No connections yet. Add one to get started."}
              </EmptyState>
            )}
          </CardContent>
        )}
      </Card>

      {/* Add Connection Modal */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Connection</DialogTitle>
            <DialogDescription>
              Add someone important in your life
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="connection-name">Name</Label>
              <Input
                id="connection-name"
                value={newConnectionName}
                onChange={(e) => setNewConnectionName(e.target.value)}
                placeholder="e.g., John Smith"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newConnectionName.trim()) {
                    addConnection();
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="connection-relationship">Relationship</Label>
              <Input
                id="connection-relationship"
                value={newConnectionRelationship}
                onChange={(e) => setNewConnectionRelationship(e.target.value)}
                placeholder="e.g., College friend, Mentor"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newConnectionName.trim()) {
                    addConnection();
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={addConnection}
              disabled={!newConnectionName.trim()}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add connection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Info Modal */}
      <InfoDialog
        open={infoModal.isOpen}
        onOpenChange={(open) =>
          setInfoModal((prev) => ({ ...prev, isOpen: open }))
        }
        title={infoModal.title}
        description={infoModal.overview}
      >
        <p className="font-medium text-foreground">
          Tips for filling this section:
        </p>
        <ul className="space-y-2 text-muted-foreground">
          {(infoModal.tips || []).map((tip, idx) => (
            <li key={idx} className="flex gap-2">
              <span className="text-primary">•</span>
              <span>{tip}</span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button
            onClick={() => setInfoModal((prev) => ({ ...prev, isOpen: false }))}
          >
            Got it
          </Button>
        </DialogFooter>
      </InfoDialog>
    </div>
  );
}
