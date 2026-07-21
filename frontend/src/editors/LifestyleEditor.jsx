import { useState } from "react";
import { Plus, X, Trash2, ChevronDown, Info } from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

// Lifestyle Editor
export default function LifestyleEditor({ data, onChange, onShowConfirmation }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterLevel, setFilterLevel] = useState("all");
  const [expandedHobbies, setExpandedHobbies] = useState({});
  const [expandedReferences, setExpandedReferences] = useState({});
  const [collapsedSections, setCollapsedSections] = useState({
    hobbies: true,
    passions: true,
    curiosities: true,
    traits: true,
    values: true,
    wellness: true,
  });
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newHobbyName, setNewHobbyName] = useState("");
  const [newHobbyLevel, setNewHobbyLevel] = useState("enthusiast");

  // Info modal state
  const [infoModal, setInfoModal] = useState({
    isOpen: false,
    title: "",
    overview: "",
    tips: [],
  });

  const sectionInfo = {
    hobbies: {
      title: "Hobbies & Activities",
      overview:
        "Track activities you enjoy outside of work. This helps AI understand your lifestyle and can suggest relevant recommendations.",
      tips: [
        "Name: The hobby or activity.",
        "Skill Level: Casual, Enthusiast, Serious, or Expert.",
        "Status: Active (currently doing) or Inactive (paused/stopped).",
        "Specifics: Sub-areas or variations you focus on.",
        "Notes: Your experience, goals, or what you enjoy most.",
        "References: Links to gear, communities, or learning resources.",
      ],
    },
    passions: {
      title: "Passions",
      overview:
        "Things you care deeply about that drive you. These aren't necessarily skills—they're what gets you excited.",
      tips: [
        "Add topics, causes, or areas you're genuinely passionate about.",
        "Examples: sustainability, design, storytelling, education, technology.",
        "AI uses this to understand your motivations and tailor suggestions.",
      ],
    },
    curiosities: {
      title: "Curiosities",
      overview:
        "Topics you want to explore or learn more about. These are your 'I should look into that someday' items.",
      tips: [
        "Add subjects you're curious about but haven't dived into yet.",
        "Examples: quantum computing, fermentation, urban planning, linguistics.",
        "No pressure—these can be fleeting interests or serious research areas.",
      ],
    },
    traits: {
      title: "Personality Traits",
      overview:
        "Characteristics that define how you think, work, and interact. Helps AI understand your style and adapt its responses.",
      tips: [
        "Add adjectives or short phrases that describe you.",
        "Examples: analytical, creative, detail-oriented, big-picture thinker, empathetic.",
        "Be honest—both strengths and areas you're working on.",
      ],
    },
    values: {
      title: "Values",
      overview:
        "Core principles that guide your decisions and priorities. What matters most to you in life and work.",
      tips: [
        "Add words or short phrases representing your values.",
        "Examples: integrity, growth, family, creativity, impact, balance.",
        "These help AI align suggestions with what truly matters to you.",
      ],
    },
    wellness: {
      title: "Wellness",
      overview:
        "Track your health patterns and energy rhythms. This helps AI understand when you're at your best and what affects your wellbeing.",
      tips: [
        "Sleep Schedule: When you typically go to bed and wake up (separate for weekdays vs weekends if different).",
        "Energy Peaks: Times of day when you feel most focused and productive.",
        "Stress Triggers: Situations, environments, or patterns that tend to increase your stress.",
        "This info helps AI suggest optimal times for tasks and avoid recommending things during low-energy periods.",
      ],
    },
  };

  const openInfo = (sectionKey) => {
    const info = sectionInfo[sectionKey];
    if (info) {
      setInfoModal({ isOpen: true, ...info });
    }
  };

  const toggleHobby = (index) => {
    setExpandedHobbies((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const toggleReference = (key) => {
    setExpandedReferences((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const toggleSection = (section) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const addHobby = () => {
    if (newHobbyName.trim()) {
      onChange({
        ...data,
        hobbies: [
          {
            name: newHobbyName.trim(),
            specifics: [],
            skill_level: newHobbyLevel,
            status: "active",
            notes: "",
            references: [],
          },
          ...(data.hobbies || []),
        ],
      });
      // Expand the newly added hobby
      setExpandedHobbies((prev) => ({
        ...prev,
        0: true,
      }));
      // Reset modal state
      setNewHobbyName("");
      setNewHobbyLevel("enthusiast");
      setIsAddModalOpen(false);
    }
  };

  const updateHobby = (index, field, value) => {
    const newHobbies = [...(data.hobbies || [])];
    newHobbies[index] = { ...newHobbies[index], [field]: value };
    onChange({ ...data, hobbies: newHobbies });
  };

  const removeHobby = (index) => {
    const hobby = (data.hobbies || [])[index];
    if (onShowConfirmation) {
      onShowConfirmation(
        "Remove Hobby",
        `Remove "${hobby?.name || "hobby"}"? This action cannot be undone.`,
        () => {
          onChange({
            ...data,
            hobbies: (data.hobbies || []).filter((_, i) => i !== index),
          });
        }
      );
    } else {
      onChange({
        ...data,
        hobbies: (data.hobbies || []).filter((_, i) => i !== index),
      });
    }
  };

  // Filter hobbies (already in newest-first order from addHobby)
  const filteredHobbies = [...(data.hobbies || [])].filter((hobby) => {
    const matchesSearch = hobby.name
      ?.toLowerCase()
      .includes(searchTerm.toLowerCase());
    const matchesLevel =
      filterLevel === "all" || hobby.skill_level === filterLevel;
    return matchesSearch && matchesLevel;
  });

  const hasActiveFilters = searchTerm || filterLevel !== "all";

  const clearFilters = () => {
    setSearchTerm("");
    setFilterLevel("all");
  };

  return (
    <div className="space-y-6">
      {/* Hobbies Section */}
      <Card>
        <CardHeader className="sticky top-[60px] z-10 rounded-t-lg border-b bg-card">
          <div
            className="flex items-center justify-between cursor-pointer hover:bg-muted/50 transition-colors rounded-t-lg -m-6 p-6"
            onClick={() => toggleSection("hobbies")}
          >
            <div className="flex items-center gap-2">
              <ChevronDown
                className={`h-5 w-5 transition-transform ${
                  collapsedSections.hobbies ? "-rotate-90" : ""
                }`}
              />
              <div>
                <CardTitle className="flex items-center gap-2">
                  Hobbies & Activities
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      openInfo("hobbies");
                    }}
                  >
                    <Info className="h-4 w-4" />
                  </Button>
                </CardTitle>
                <CardDescription>
                  Things you enjoy doing in your free time
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
              Add Hobby
            </Button>
          </div>
        </CardHeader>
        {!collapsedSections.hobbies && (
          <CardContent className="space-y-4">
            {/* Search and Filter Bar */}
            {(data.hobbies || []).length > 0 && (
              <div className="flex flex-wrap gap-2 items-end">
                <div className="flex-1 min-w-[200px] space-y-1.5">
                  <Label htmlFor="hobby-search" className="text-xs">
                    Search
                  </Label>
                  <Input
                    id="hobby-search"
                    placeholder="Search hobbies..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="h-8"
                  />
                </div>
                <div className="w-[160px] space-y-1.5">
                  <Label htmlFor="level-filter" className="text-xs">
                    Skill Level
                  </Label>
                  <Select value={filterLevel} onValueChange={setFilterLevel}>
                    <SelectTrigger id="level-filter" className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Levels</SelectItem>
                      <SelectItem value="casual">Casual</SelectItem>
                      <SelectItem value="enthusiast">Enthusiast</SelectItem>
                      <SelectItem value="serious">Serious</SelectItem>
                      <SelectItem value="expert">Expert</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {hasActiveFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearFilters}
                    className="h-8"
                  >
                    Clear Filters
                  </Button>
                )}
              </div>
            )}

            {/* Hobbies Table */}
            {filteredHobbies.length > 0 ? (
              <div>
                {filteredHobbies.map((hobby, idx) => {
                  const originalIndex = (data.hobbies || []).indexOf(hobby);
                  const isExpanded = expandedHobbies[originalIndex];
                  const hasReferences = (hobby.references || []).length > 0;
                  const hasSpecifics = (hobby.specifics || []).length > 0;
                  const hasNotes = !!hobby.notes;

                  return (
                    <div
                      key={idx}
                      className={`border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors ${
                        hobby.status === "inactive" ? "opacity-60" : ""
                      }`}
                    >
                      {/* Collapsed Header */}
                      <div
                        className="flex items-center gap-2 p-3 cursor-pointer"
                        onClick={() => toggleHobby(originalIndex)}
                      >
                        <ChevronDown
                          className={`h-4 w-4 transition-transform text-muted-foreground ${
                            isExpanded ? "" : "-rotate-90"
                          }`}
                        />
                        <div className="flex-1 flex items-center gap-2 min-w-0">
                          <span className="font-medium truncate">
                            {hobby.name || "Untitled hobby"}
                          </span>
                          <div className="hidden sm:flex gap-1.5 items-center flex-shrink-0">
                            {hasSpecifics && (
                              <Badge
                                variant="secondary"
                                className="h-5 text-xs"
                              >
                                {hobby.specifics.length} specifics
                              </Badge>
                            )}
                            {hasReferences && (
                              <Badge
                                variant="secondary"
                                className="h-5 text-xs"
                              >
                                {hobby.references.length} refs
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
                        <Badge variant="outline" className="flex-shrink-0">
                          {hobby.skill_level || "enthusiast"}
                        </Badge>
                        {hobby.status === "inactive" && (
                          <Badge
                            variant="secondary"
                            className="flex-shrink-0 opacity-60"
                          >
                            inactive
                          </Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeHobby(originalIndex);
                          }}
                          className="h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      {/* Expanded Content */}
                      {isExpanded && (
                        <div className="border-t bg-background/50 p-4 space-y-4">
                          <div className="grid gap-4 sm:grid-cols-3">
                            <div className="space-y-2">
                              <Label>Hobby Name</Label>
                              <Input
                                value={hobby.name || ""}
                                onChange={(e) =>
                                  updateHobby(
                                    originalIndex,
                                    "name",
                                    e.target.value
                                  )
                                }
                                placeholder="Hobby name"
                                className="h-8 bg-background"
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Skill Level</Label>
                              <Select
                                value={hobby.skill_level || "enthusiast"}
                                onValueChange={(value) =>
                                  updateHobby(
                                    originalIndex,
                                    "skill_level",
                                    value
                                  )
                                }
                              >
                                <SelectTrigger className="h-8 bg-background">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="casual">Casual</SelectItem>
                                  <SelectItem value="enthusiast">
                                    Enthusiast
                                  </SelectItem>
                                  <SelectItem value="serious">
                                    Serious
                                  </SelectItem>
                                  <SelectItem value="expert">Expert</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label>Status</Label>
                              <Select
                                value={hobby.status || "active"}
                                onValueChange={(value) =>
                                  updateHobby(originalIndex, "status", value)
                                }
                              >
                                <SelectTrigger className="h-8 bg-background">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="active">Active</SelectItem>
                                  <SelectItem value="inactive">
                                    Inactive
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          {/* Specifics */}
                          <div className="space-y-2">
                            <Label>Specifics</Label>
                            <ArrayInput
                              items={hobby.specifics || []}
                              onChange={(items) =>
                                updateHobby(originalIndex, "specifics", items)
                              }
                              placeholder="Add specifics..."
                            />
                          </div>

                          {/* References Section */}
                          <div className="space-y-2">
                            <Label className="flex items-center gap-2">
                              References & URLs
                              {hasReferences && (
                                <span className="text-xs text-muted-foreground font-normal">
                                  ({hobby.references.length})
                                </span>
                              )}
                            </Label>
                            <div className="space-y-2 pl-3 border-l-2 border-muted">
                              {(hobby.references || []).map((ref, refIdx) => (
                                <div
                                  key={refIdx}
                                  className="space-y-2 pb-3 border-b border-muted last:border-b-0 last:pb-0"
                                >
                                  {/* Reference header (compact) */}
                                  <div
                                    className="flex items-center gap-2 cursor-pointer"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleReference(
                                        `${originalIndex}-${refIdx}`
                                      );
                                    }}
                                  >
                                    <ChevronDown
                                      className={`h-3.5 w-3.5 transition-transform text-muted-foreground ${
                                        expandedReferences[
                                          `${originalIndex}-${refIdx}`
                                        ]
                                          ? ""
                                          : "-rotate-90"
                                      }`}
                                    />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium truncate">
                                        {ref.name || "Untitled reference"}
                                      </p>
                                      <div className="flex flex-wrap gap-1 mt-1 text-xs text-muted-foreground">
                                        {ref.url && (
                                          <Badge
                                            variant="secondary"
                                            className="h-5 text-[11px]"
                                          >
                                            URL
                                          </Badge>
                                        )}
                                        {ref.notes && (
                                          <Badge
                                            variant="secondary"
                                            className="h-5 text-[11px]"
                                          >
                                            notes
                                          </Badge>
                                        )}
                                      </div>
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const newRefs = (
                                          hobby.references || []
                                        ).filter((_, i) => i !== refIdx);
                                        updateHobby(
                                          originalIndex,
                                          "references",
                                          newRefs
                                        );
                                      }}
                                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                    >
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </div>

                                  {/* Expanded fields */}
                                  {expandedReferences[
                                    `${originalIndex}-${refIdx}`
                                  ] && (
                                    <div className="space-y-2 pt-2">
                                      <div className="flex gap-2 items-start">
                                        <div className="flex-1 grid gap-2 sm:grid-cols-2">
                                          <Input
                                            value={ref.name || ""}
                                            onChange={(e) => {
                                              const newRefs = [
                                                ...(hobby.references || []),
                                              ];
                                              newRefs[refIdx] = {
                                                ...newRefs[refIdx],
                                                name: e.target.value,
                                              };
                                              updateHobby(
                                                originalIndex,
                                                "references",
                                                newRefs
                                              );
                                            }}
                                            placeholder="Reference name"
                                            className="h-8 text-sm bg-background"
                                            onClick={(e) => e.stopPropagation()}
                                          />
                                          <Input
                                            value={ref.url || ""}
                                            onChange={(e) => {
                                              const newRefs = [
                                                ...(hobby.references || []),
                                              ];
                                              newRefs[refIdx] = {
                                                ...newRefs[refIdx],
                                                url: e.target.value,
                                              };
                                              updateHobby(
                                                originalIndex,
                                                "references",
                                                newRefs
                                              );
                                            }}
                                            placeholder="URL (optional)"
                                            className="h-8 text-sm bg-background"
                                            onClick={(e) => e.stopPropagation()}
                                          />
                                        </div>
                                      </div>
                                      <Textarea
                                        value={ref.notes || ""}
                                        onChange={(e) => {
                                          const newRefs = [
                                            ...(hobby.references || []),
                                          ];
                                          newRefs[refIdx] = {
                                            ...newRefs[refIdx],
                                            notes: e.target.value,
                                          };
                                          updateHobby(
                                            originalIndex,
                                            "references",
                                            newRefs
                                          );
                                        }}
                                        placeholder="Notes about this reference (optional)..."
                                        className="h-16 text-xs bg-background"
                                        onClick={(e) => e.stopPropagation()}
                                      />
                                    </div>
                                  )}
                                </div>
                              ))}
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const newRefs = [
                                    ...(hobby.references || []),
                                    { name: "", url: "", notes: "" },
                                  ];
                                  updateHobby(
                                    originalIndex,
                                    "references",
                                    newRefs
                                  );
                                  // Expand the newly added reference
                                  const newKey = `${originalIndex}-${
                                    (hobby.references || []).length
                                  }`;
                                  setExpandedReferences((prev) => ({
                                    ...prev,
                                    [newKey]: true,
                                  }));
                                }}
                                className="h-8 w-full border-dashed"
                              >
                                <Plus className="h-4 w-4 mr-2" />
                                Add reference
                              </Button>
                            </div>
                          </div>

                          {/* Notes */}
                          <div className="space-y-2">
                            <Label>Notes</Label>
                            <Textarea
                              value={hobby.notes || ""}
                              onChange={(e) =>
                                updateHobby(
                                  originalIndex,
                                  "notes",
                                  e.target.value
                                )
                              }
                              placeholder="Additional notes about this hobby..."
                              className="min-h-[80px] bg-background text-sm"
                              onClick={(e) => e.stopPropagation()}
                            />
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
                  ? "No hobbies match your filters"
                  : "No hobbies yet. Add one to get started."}
              </EmptyState>
            )}
          </CardContent>
        )}
      </Card>

      {/* Add Hobby Modal */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Hobby</DialogTitle>
            <DialogDescription>
              Create a new hobby to track your interests and activities
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="hobby-name">Hobby Name</Label>
              <Input
                id="hobby-name"
                value={newHobbyName}
                onChange={(e) => setNewHobbyName(e.target.value)}
                placeholder="e.g., Reading Substacks, Photography"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newHobbyName.trim()) {
                    addHobby();
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hobby-level">Skill Level</Label>
              <Select value={newHobbyLevel} onValueChange={setNewHobbyLevel}>
                <SelectTrigger id="hobby-level">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="casual">Casual</SelectItem>
                  <SelectItem value="enthusiast">Enthusiast</SelectItem>
                  <SelectItem value="serious">Serious</SelectItem>
                  <SelectItem value="expert">Expert</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={addHobby} disabled={!newHobbyName.trim()}>
              <Plus className="h-4 w-4 mr-2" />
              Add Hobby
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Passions */}
      <Card>
        <CardHeader
          className="sticky top-[60px] z-10 border-b bg-card cursor-pointer hover:bg-muted/50 transition-colors rounded-t-lg"
          onClick={() => toggleSection("passions")}
        >
          <div className="flex items-center gap-2">
            <ChevronDown
              className={`h-5 w-5 transition-transform ${
                collapsedSections.passions ? "-rotate-90" : ""
              }`}
            />
            <div>
              <CardTitle className="flex items-center gap-2">
                Passions
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    openInfo("passions");
                  }}
                >
                  <Info className="h-4 w-4" />
                </Button>
              </CardTitle>
              <CardDescription>
                Things you're deeply passionate about
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        {!collapsedSections.passions && (
          <CardContent>
            <ArrayInput
              items={data.passions || []}
              onChange={(items) => onChange({ ...data, passions: items })}
              placeholder="Add passion..."
            />
          </CardContent>
        )}
      </Card>

      {/* Curiosities */}
      <Card>
        <CardHeader
          className="sticky top-[60px] z-10 border-b bg-card cursor-pointer hover:bg-muted/50 transition-colors rounded-t-lg"
          onClick={() => toggleSection("curiosities")}
        >
          <div className="flex items-center gap-2">
            <ChevronDown
              className={`h-5 w-5 transition-transform ${
                collapsedSections.curiosities ? "-rotate-90" : ""
              }`}
            />
            <div>
              <CardTitle className="flex items-center gap-2">
                Curiosities
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    openInfo("curiosities");
                  }}
                >
                  <Info className="h-4 w-4" />
                </Button>
              </CardTitle>
              <CardDescription>
                Topics you're curious to learn more about
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        {!collapsedSections.curiosities && (
          <CardContent>
            <ArrayInput
              items={data.curiosities || []}
              onChange={(items) => onChange({ ...data, curiosities: items })}
              placeholder="Add curiosity..."
            />
          </CardContent>
        )}
      </Card>

      {/* Personality Traits */}
      <Card>
        <CardHeader
          className="sticky top-[60px] z-10 border-b bg-card cursor-pointer hover:bg-muted/50 transition-colors rounded-t-lg"
          onClick={() => toggleSection("traits")}
        >
          <div className="flex items-center gap-2">
            <ChevronDown
              className={`h-5 w-5 transition-transform ${
                collapsedSections.traits ? "-rotate-90" : ""
              }`}
            />
            <div>
              <CardTitle className="flex items-center gap-2">
                Personality Traits
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    openInfo("traits");
                  }}
                >
                  <Info className="h-4 w-4" />
                </Button>
              </CardTitle>
              <CardDescription>Characteristics that define you</CardDescription>
            </div>
          </div>
        </CardHeader>
        {!collapsedSections.traits && (
          <CardContent>
            <ArrayInput
              items={data.personality_traits || []}
              onChange={(items) =>
                onChange({ ...data, personality_traits: items })
              }
              placeholder="e.g. Creative, Analytical..."
            />
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader
          className="sticky top-[60px] z-10 border-b bg-card cursor-pointer hover:bg-muted/50 transition-colors rounded-t-lg"
          onClick={() => toggleSection("values")}
        >
          <div className="flex items-center gap-2">
            <ChevronDown
              className={`h-5 w-5 transition-transform ${
                collapsedSections.values ? "-rotate-90" : ""
              }`}
            />
            <div>
              <CardTitle className="flex items-center gap-2">
                Values
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    openInfo("values");
                  }}
                >
                  <Info className="h-4 w-4" />
                </Button>
              </CardTitle>
              <CardDescription>What's important to you</CardDescription>
            </div>
          </div>
        </CardHeader>
        {!collapsedSections.values && (
          <CardContent>
            <ArrayInput
              items={data.values || []}
              onChange={(items) => onChange({ ...data, values: items })}
              placeholder="e.g. Integrity, Growth..."
            />
          </CardContent>
        )}
      </Card>

      {/* Wellness Section */}
      <Card>
        <CardHeader
          className="sticky top-[60px] z-10 border-b bg-card cursor-pointer hover:bg-muted/50 transition-colors rounded-t-lg"
          onClick={() => toggleSection("wellness")}
        >
          <div className="flex items-center gap-2">
            <ChevronDown
              className={`h-5 w-5 transition-transform ${
                collapsedSections.wellness ? "-rotate-90" : ""
              }`}
            />
            <div>
              <CardTitle className="flex items-center gap-2">
                Wellness
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    openInfo("wellness");
                  }}
                >
                  <Info className="h-4 w-4" />
                </Button>
              </CardTitle>
              <CardDescription>
                Sleep patterns, energy levels, and stress factors
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        {!collapsedSections.wellness && (
          <CardContent className="space-y-6">
            {/* Sleep Schedule */}
            <div className="space-y-4">
              <Label className="text-sm font-medium">Sleep Schedule</Label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3 p-4 border rounded-lg">
                  <p className="text-sm font-medium">Weekdays</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Bedtime
                      </Label>
                      <Input
                        type="time"
                        value={data.wellness?.sleep?.weekday?.bedtime || ""}
                        onChange={(e) =>
                          onChange({
                            ...data,
                            wellness: {
                              ...data.wellness,
                              sleep: {
                                ...data.wellness?.sleep,
                                weekday: {
                                  ...data.wellness?.sleep?.weekday,
                                  bedtime: e.target.value,
                                },
                              },
                            },
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Wake up
                      </Label>
                      <Input
                        type="time"
                        value={data.wellness?.sleep?.weekday?.wakeup || ""}
                        onChange={(e) =>
                          onChange({
                            ...data,
                            wellness: {
                              ...data.wellness,
                              sleep: {
                                ...data.wellness?.sleep,
                                weekday: {
                                  ...data.wellness?.sleep?.weekday,
                                  wakeup: e.target.value,
                                },
                              },
                            },
                          })
                        }
                      />
                    </div>
                  </div>
                </div>
                <div className="space-y-3 p-4 border rounded-lg">
                  <p className="text-sm font-medium">Weekends</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Bedtime
                      </Label>
                      <Input
                        type="time"
                        value={data.wellness?.sleep?.weekend?.bedtime || ""}
                        onChange={(e) =>
                          onChange({
                            ...data,
                            wellness: {
                              ...data.wellness,
                              sleep: {
                                ...data.wellness?.sleep,
                                weekend: {
                                  ...data.wellness?.sleep?.weekend,
                                  bedtime: e.target.value,
                                },
                              },
                            },
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Wake up
                      </Label>
                      <Input
                        type="time"
                        value={data.wellness?.sleep?.weekend?.wakeup || ""}
                        onChange={(e) =>
                          onChange({
                            ...data,
                            wellness: {
                              ...data.wellness,
                              sleep: {
                                ...data.wellness?.sleep,
                                weekend: {
                                  ...data.wellness?.sleep?.weekend,
                                  wakeup: e.target.value,
                                },
                              },
                            },
                          })
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Energy Peaks */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Energy Peaks</Label>
              <p className="text-xs text-muted-foreground">
                When do you feel most focused and productive?
              </p>
              <ArrayInput
                items={data.wellness?.energy_peaks || []}
                onChange={(items) =>
                  onChange({
                    ...data,
                    wellness: { ...data.wellness, energy_peaks: items },
                  })
                }
                placeholder="e.g. Early morning (6-9am), Late night (10pm-1am)..."
              />
            </div>

            {/* Stress Triggers */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Stress Triggers</Label>
              <p className="text-xs text-muted-foreground">
                Situations or patterns that tend to increase your stress
              </p>
              <ArrayInput
                items={data.wellness?.stress_triggers || []}
                onChange={(items) =>
                  onChange({
                    ...data,
                    wellness: { ...data.wellness, stress_triggers: items },
                  })
                }
                placeholder="e.g. Tight deadlines, Back-to-back meetings..."
              />
            </div>
          </CardContent>
        )}
      </Card>

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
            onClick={() =>
              setInfoModal((prev) => ({ ...prev, isOpen: false }))
            }
          >
            Got it
          </Button>
        </DialogFooter>
      </InfoDialog>
    </div>
  );
}

