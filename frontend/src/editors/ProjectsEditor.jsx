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

// Projects Editor
export default function ProjectsEditor({ data, onChange, onShowConfirmation }) {
  const [expandedProjectReferences, setExpandedProjectReferences] = useState(
    {}
  );
  const [expandedProjects, setExpandedProjects] = useState({});
  const [collapsedSections, setCollapsedSections] = useState({
    ideas: true,
    projects: true,
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [newIdea, setNewIdea] = useState("");
  const [newIdeaNote, setNewIdeaNote] = useState("");
  const [isIdeaModalOpen, setIsIdeaModalOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectStatus, setNewProjectStatus] = useState("active");
  const [editingIdeaIndex, setEditingIdeaIndex] = useState(null);

  // Info modal state
  const [infoModal, setInfoModal] = useState({
    isOpen: false,
    title: "",
    overview: "",
    tips: [],
  });

  const sectionInfo = {
    topOfMind: {
      title: "Top of Mind",
      overview:
        "Capture quick ideas, thoughts, or things you want to explore. Think of it as a scratchpad for inspiration before it becomes a full project.",
      tips: [
        "Idea: A short phrase or sentence describing what you're thinking about.",
        "Note: Optional context—why this idea excites you, potential next steps, or related thoughts.",
        "Use this for: half-baked concepts, 'what if' questions, problems you want to solve, things to research later.",
        "When an idea matures, you can promote it to a full project with more details.",
      ],
    },
    projects: {
      title: "Projects",
      overview:
        "Track your active work, side projects, and completed endeavors. This helps AI understand what you're building and can reference past experience.",
      tips: [
        "Name: Clear, descriptive title for the project.",
        "Status options:",
        "  • Planning: Still in ideation/research phase.",
        "  • Active: Currently working on it.",
        "  • Paused: Temporarily on hold.",
        "  • Completed: Finished and shipped.",
        "  • Archived: No longer relevant but kept for reference.",
        "Description: What the project is about and your goals.",
        "Tags: Keywords for easy filtering and AI context.",
        "References: Links to repos, docs, designs, or related resources.",
        "Notes: Progress updates, blockers, or lessons learned.",
      ],
    },
  };

  const openInfo = (sectionKey) => {
    const info = sectionInfo[sectionKey];
    if (info) {
      setInfoModal({ isOpen: true, ...info });
    }
  };

  const addProject = () => {
    if (newProjectName.trim()) {
      onChange({
        ...data,
        projects: [
          {
            name: newProjectName.trim(),
            description: "",
            status: newProjectStatus,
            tags: [],
            references: [],
            notes: "",
          },
          ...(data.projects || []),
        ],
      });
      // Expand the newly added project
      setExpandedProjects((prev) => ({
        ...prev,
        0: true,
      }));
      // Reset modal state
      setNewProjectName("");
      setNewProjectStatus("active");
      setIsAddModalOpen(false);
    }
  };

  const toggleProjectReference = (key) => {
    setExpandedProjectReferences((prev) => ({
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

  const toggleProject = (index) => {
    setExpandedProjects((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const updateProject = (index, field, value) => {
    const newProjects = [...(data.projects || [])];
    newProjects[index] = { ...newProjects[index], [field]: value };
    onChange({ ...data, projects: newProjects });
  };

  const removeProject = (index) => {
    const project = (data.projects || [])[index];
    if (onShowConfirmation) {
      onShowConfirmation(
        "Remove Project",
        `Remove "${project?.name || "project"}"? This action cannot be undone.`,
        () => {
          onChange({
            ...data,
            projects: (data.projects || []).filter((_, i) => i !== index),
          });
        }
      );
    } else {
      onChange({
        ...data,
        projects: (data.projects || []).filter((_, i) => i !== index),
      });
    }
  };

  // Filter projects (newest first)
  const filteredProjects = [...(data.projects || [])]
    .filter((project) => {
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch =
        project.name?.toLowerCase().includes(searchLower) ||
        (project.tags || []).some((tag) =>
          tag.toLowerCase().includes(searchLower)
        );
      const matchesStatus =
        filterStatus === "all" || project.status === filterStatus;
      return matchesSearch && matchesStatus;
    })
    .reverse();

  const hasActiveFilters = searchTerm || filterStatus !== "all";

  const clearFilters = () => {
    setSearchTerm("");
    setFilterStatus("all");
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="border-b">
          <div
            className="flex items-center justify-between cursor-pointer hover:bg-muted/50 transition-colors rounded-t-lg -m-6 p-6"
            onClick={() => toggleSection("ideas")}
          >
            <div className="flex items-center gap-2">
              <ChevronDown
                className={`h-5 w-5 transition-transform ${
                  collapsedSections.ideas ? "-rotate-90" : ""
                }`}
              />
              <div>
                <CardTitle className="flex items-center gap-2">
                  Top of Mind
                  <Button
                    variant="ghost"
                    size="icon"
                    className="tap-target h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      openInfo("topOfMind");
                    }}
                  >
                    <Info className="h-4 w-4" />
                  </Button>
                </CardTitle>
                <CardDescription>
                  What you're currently focused on or thinking about
                </CardDescription>
              </div>
            </div>
            <Button
              onClick={(e) => {
                e.stopPropagation();
                setIsIdeaModalOpen(true);
              }}
              size="sm"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add idea
            </Button>
          </div>
        </CardHeader>
        {!collapsedSections.ideas && (
          <CardContent>
            {/* List of ideas */}
            {(data.top_of_mind || []).length > 0 ? (
              <div className="space-y-2">
                {(data.top_of_mind || []).map((item, index) => {
                  const ideaObj =
                    typeof item === "string" ? { idea: item, note: "" } : item;
                  const isEditing = editingIdeaIndex === index;

                  const updateIdea = (field, value) => {
                    const updated = [...(data.top_of_mind || [])];
                    const current =
                      typeof updated[index] === "string"
                        ? { idea: updated[index], note: "" }
                        : { ...updated[index] };
                    current[field] = value;
                    updated[index] = current;
                    onChange({ ...data, top_of_mind: updated });
                  };

                  return (
                    <div
                      key={index}
                      className={`p-3 rounded-lg border transition-colors ${
                        isEditing
                          ? "ring-1 ring-primary/30 bg-muted/30"
                          : "cursor-pointer"
                      }`}
                      onClick={() => !isEditing && setEditingIdeaIndex(index)}
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-1 space-y-2">
                          {isEditing ? (
                            <>
                              <Input
                                value={ideaObj.idea}
                                onChange={(e) =>
                                  updateIdea("idea", e.target.value)
                                }
                                placeholder="What's the idea?"
                                className="h-9 text-sm font-medium"
                                autoFocus
                                onClick={(e) => e.stopPropagation()}
                              />
                              <Textarea
                                value={ideaObj.note || ""}
                                onChange={(e) =>
                                  updateIdea("note", e.target.value)
                                }
                                placeholder="Add a note (optional)..."
                                className="text-xs min-h-[60px] resize-none"
                                onClick={(e) => e.stopPropagation()}
                              />
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingIdeaIndex(null);
                                }}
                                className="h-7 text-xs"
                              >
                                Done
                              </Button>
                            </>
                          ) : (
                            <>
                              <div className="font-medium text-sm">
                                {ideaObj.idea || "Untitled idea"}
                              </div>
                              {ideaObj.note && (
                                <div className="text-xs text-muted-foreground">
                                  {ideaObj.note}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            const updated = (data.top_of_mind || []).filter(
                              (_, i) => i !== index
                            );
                            onChange({ ...data, top_of_mind: updated });
                            if (isEditing) setEditingIdeaIndex(null);
                          }}
                          className="tap-target h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState>No ideas yet. Add one to get started.</EmptyState>
            )}
          </CardContent>
        )}
      </Card>

      {/* Add Idea Modal */}
      <Dialog open={isIdeaModalOpen} onOpenChange={setIsIdeaModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Idea</DialogTitle>
            <DialogDescription>
              Capture a project idea or something you want to build
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="modal-idea">Idea</Label>
              <Input
                id="modal-idea"
                value={newIdea}
                onChange={(e) => setNewIdea(e.target.value)}
                placeholder="Project idea or thing you want to build..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="modal-idea-note">Notes (Optional)</Label>
              <Textarea
                id="modal-idea-note"
                value={newIdeaNote}
                onChange={(e) => setNewIdeaNote(e.target.value)}
                placeholder="Quick notes, thoughts, or details..."
                className="min-h-[80px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsIdeaModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (newIdea.trim()) {
                  const normalizedIdeas = (data.top_of_mind || []).map((item) =>
                    typeof item === "string" ? { idea: item, note: "" } : item
                  );
                  onChange({
                    ...data,
                    top_of_mind: [
                      ...normalizedIdeas,
                      { idea: newIdea.trim(), note: newIdeaNote.trim() },
                    ],
                  });
                  setNewIdea("");
                  setNewIdeaNote("");
                  setIsIdeaModalOpen(false);
                }
              }}
            >
              Add idea
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader className="border-b">
          <div
            className="flex items-center justify-between cursor-pointer hover:bg-muted/50 transition-colors rounded-t-lg -m-6 p-6"
            onClick={() => toggleSection("projects")}
          >
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <ChevronDown
                  className={`h-5 w-5 transition-transform ${
                    collapsedSections.projects ? "-rotate-90" : ""
                  }`}
                />
                <div>
                  <CardTitle className="flex items-center gap-2">
                    Projects
                    <Button
                      variant="ghost"
                      size="icon"
                      className="tap-target h-7 w-7 text-muted-foreground hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        openInfo("projects");
                      }}
                    >
                      <Info className="h-4 w-4" />
                    </Button>
                  </CardTitle>
                  <CardDescription>
                    Track your active, paused, and completed projects
                  </CardDescription>
                </div>
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
              Add project
            </Button>
          </div>
        </CardHeader>
        {!collapsedSections.projects && (
          <CardContent className="space-y-4">
            {/* Search Bar */}
            {(data.projects || []).length > 0 && (
              <div className="flex flex-wrap gap-2 items-end">
                <div className="flex-1 min-w-[200px] space-y-1.5">
                  <Label htmlFor="project-search" className="text-xs">
                    Search
                  </Label>
                  <Input
                    id="project-search"
                    placeholder="Search projects..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="min-w-[150px] space-y-1.5">
                  <Label htmlFor="project-status" className="text-xs">
                    Status
                  </Label>
                  <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger id="project-status" className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="planning">Planning</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="paused">Paused</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
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

            {/* Projects List */}
            {filteredProjects.length > 0 ? (
              <div>
                {filteredProjects.map((project) => {
                  const originalIndex = (data.projects || []).indexOf(project);
                  const tags = project.tags || project.tech_stack || [];
                  const refCount = (project.references || []).length;
                  const tagCount = tags.length;
                  const hasNotes = (project.notes || "").trim().length > 0;
                  const highlightsCount = (project.highlights || []).length;
                  const isExpanded = expandedProjects[originalIndex];

                  return (
                    <div
                      key={originalIndex}
                      className="border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors"
                    >
                      {/* Collapsed Header */}
                      <div
                        className="flex items-center gap-2 p-3 cursor-pointer"
                        onClick={() => toggleProject(originalIndex)}
                      >
                        <ChevronDown
                          className={`h-4 w-4 transition-transform text-muted-foreground ${
                            isExpanded ? "" : "-rotate-90"
                          }`}
                        />
                        <div className="flex-1 flex items-center gap-2 min-w-0">
                          <span className="font-medium truncate">
                            {project.name || "Untitled project"}
                          </span>
                          <div className="hidden sm:flex gap-1.5 items-center flex-shrink-0">
                            {refCount > 0 && (
                              <Badge
                                variant="secondary"
                                className="h-5 text-xs"
                              >
                                {refCount} refs
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
                            {hasNotes && (
                              <Badge
                                variant="secondary"
                                className="h-5 text-xs"
                              >
                                notes
                              </Badge>
                            )}
                            {highlightsCount > 0 && (
                              <Badge
                                variant="secondary"
                                className="h-5 text-xs"
                              >
                                {highlightsCount} highlights
                              </Badge>
                            )}
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className="flex-shrink-0 capitalize"
                        >
                          {project.status || "active"}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeProject(originalIndex);
                          }}
                          className="tap-target h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      {/* Expanded Content */}

                      {isExpanded && (
                        <div className="border-t bg-background/50 p-4 space-y-4">
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                              <Label>Project Name</Label>
                              <Input
                                value={project.name || ""}
                                onChange={(e) =>
                                  updateProject(
                                    originalIndex,
                                    "name",
                                    e.target.value
                                  )
                                }
                                placeholder="Project name"
                                className="h-9 bg-background"
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Status</Label>
                              <Select
                                value={project.status || "active"}
                                onValueChange={(value) =>
                                  updateProject(originalIndex, "status", value)
                                }
                              >
                                <SelectTrigger className="h-9 bg-background">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="planning">
                                    Planning
                                  </SelectItem>
                                  <SelectItem value="active">Active</SelectItem>
                                  <SelectItem value="paused">Paused</SelectItem>
                                  <SelectItem value="completed">
                                    Completed
                                  </SelectItem>
                                  <SelectItem value="archived">
                                    Archived
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label>Description</Label>
                            <Textarea
                              value={project.description || ""}
                              onChange={(e) =>
                                updateProject(
                                  originalIndex,
                                  "description",
                                  e.target.value
                                )
                              }
                              placeholder="Brief description..."
                              className="bg-background text-sm"
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Tags</Label>
                            <ArrayInput
                              items={tags}
                              onChange={(items) =>
                                updateProject(originalIndex, "tags", items)
                              }
                              placeholder="Add tag..."
                            />
                          </div>

                          {/* References & Resources */}
                          <div className="space-y-2">
                            <Label className="flex items-center gap-2">
                              References & Resources
                              {(project.references || []).length > 0 && (
                                <span className="text-xs text-muted-foreground font-normal">
                                  ({(project.references || []).length})
                                </span>
                              )}
                            </Label>
                            <div className="space-y-2 pl-3 border-l-2 border-muted">
                              {(project.references || []).map((ref, refIdx) => {
                                const refKey = `${originalIndex}-${refIdx}`;
                                const isRefExpanded =
                                  expandedProjectReferences[refKey];

                                return (
                                  <div
                                    key={refIdx}
                                    className="space-y-2 pb-3 border-b border-muted last:border-b-0 last:pb-0"
                                  >
                                    <div
                                      className="flex items-center gap-2 cursor-pointer"
                                      onClick={() =>
                                        toggleProjectReference(refKey)
                                      }
                                    >
                                      <ChevronDown
                                        className={`h-3.5 w-3.5 transition-transform text-muted-foreground ${
                                          isRefExpanded ? "" : "-rotate-90"
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
                                              className="h-5 text-xs"
                                            >
                                              URL
                                            </Badge>
                                          )}
                                          {ref.notes && (
                                            <Badge
                                              variant="secondary"
                                              className="h-5 text-xs"
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
                                            project.references || []
                                          ).filter((_, i) => i !== refIdx);
                                          updateProject(
                                            originalIndex,
                                            "references",
                                            newRefs
                                          );
                                        }}
                                        className="tap-target h-8 w-8 text-muted-foreground hover:text-destructive"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>

                                    {isRefExpanded && (
                                      <div className="space-y-2 pt-2">
                                        <div className="grid gap-2 sm:grid-cols-2">
                                          <Input
                                            value={ref.name || ""}
                                            onChange={(e) => {
                                              const newRefs = [
                                                ...(project.references || []),
                                              ];
                                              newRefs[refIdx] = {
                                                ...newRefs[refIdx],
                                                name: e.target.value,
                                              };
                                              updateProject(
                                                originalIndex,
                                                "references",
                                                newRefs
                                              );
                                            }}
                                            placeholder="Reference name"
                                            className="h-9 text-sm bg-background"
                                            onClick={(e) => e.stopPropagation()}
                                          />
                                          <Input
                                            value={ref.url || ""}
                                            onChange={(e) => {
                                              const newRefs = [
                                                ...(project.references || []),
                                              ];
                                              newRefs[refIdx] = {
                                                ...newRefs[refIdx],
                                                url: e.target.value,
                                              };
                                              updateProject(
                                                originalIndex,
                                                "references",
                                                newRefs
                                              );
                                            }}
                                            placeholder="URL (optional)"
                                            className="h-9 text-sm bg-background"
                                            onClick={(e) => e.stopPropagation()}
                                          />
                                        </div>
                                        <Textarea
                                          value={ref.notes || ""}
                                          onChange={(e) => {
                                            const newRefs = [
                                              ...(project.references || []),
                                            ];
                                            newRefs[refIdx] = {
                                              ...newRefs[refIdx],
                                              notes: e.target.value,
                                            };
                                            updateProject(
                                              originalIndex,
                                              "references",
                                              newRefs
                                            );
                                          }}
                                          placeholder="Notes about this resource (optional)..."
                                          className="h-16 text-xs bg-background"
                                          onClick={(e) => e.stopPropagation()}
                                        />
                                      </div>
                                    )}
                                  </div>
                                );
                              })}

                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const newRefs = [
                                    ...(project.references || []),
                                    { name: "", url: "", notes: "" },
                                  ];
                                  updateProject(
                                    originalIndex,
                                    "references",
                                    newRefs
                                  );
                                  const newKey = `${originalIndex}-${
                                    (project.references || []).length
                                  }`;
                                  setExpandedProjectReferences((prev) => ({
                                    ...prev,
                                    [newKey]: true,
                                  }));
                                }}
                                className="h-8 w-full border-dashed"
                              >
                                <Plus className="h-3.5 w-3.5 mr-1.5" />
                                Add reference
                              </Button>
                            </div>
                          </div>

                          {/* Project Notes */}
                          <div className="space-y-2 sm:col-span-2">
                            <Label>Notes</Label>
                            <Textarea
                              value={project.notes || ""}
                              onChange={(e) =>
                                updateProject(
                                  originalIndex,
                                  "notes",
                                  e.target.value
                                )
                              }
                              placeholder="Additional notes, blockers, or context..."
                              className="min-h-[80px] bg-background text-sm"
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>

                          {/* Highlights Section */}
                          <div className="space-y-2">
                            <Label>Highlights & Achievements</Label>
                            <div className="space-y-3">
                              {(project.highlights || []).map(
                                (highlight, hIdx) => (
                                  <div
                                    key={hIdx}
                                    className="flex gap-2 items-start p-2 rounded-lg border"
                                  >
                                    <Input
                                      value={highlight || ""}
                                      onChange={(e) => {
                                        const updated = [
                                          ...(data.projects || []),
                                        ];
                                        updated[originalIndex].highlights[
                                          hIdx
                                        ] = e.target.value;
                                        onChange({
                                          ...data,
                                          projects: updated,
                                        });
                                      }}
                                      placeholder="e.g. Increased performance by 40%, Implemented CI/CD pipeline"
                                      className="bg-background"
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const updated = [
                                          ...(data.projects || []),
                                        ];
                                        updated[originalIndex].highlights = (
                                          project.highlights || []
                                        ).filter((_, i) => i !== hIdx);
                                        onChange({
                                          ...data,
                                          projects: updated,
                                        });
                                      }}
                                      className="tap-target h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                )
                              )}
                              <Button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const updated = [...(data.projects || [])];
                                  updated[originalIndex].highlights = [
                                    ...(project.highlights || []),
                                    "",
                                  ];
                                  onChange({ ...data, projects: updated });
                                }}
                                variant="outline"
                                size="sm"
                                className="h-8 w-full border-dashed"
                              >
                                <Plus className="h-3.5 w-3.5 mr-1.5" />
                                Add highlight
                              </Button>
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
                  ? "No projects match your search"
                  : "No projects yet. Add one to get started."}
              </EmptyState>
            )}
          </CardContent>
        )}
      </Card>

      {/* Add Project Modal */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Project</DialogTitle>
            <DialogDescription>
              Create a new project to track progress and resources
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="project-name">Project Name</Label>
              <Input
                id="project-name"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="e.g., Personal Website, Mobile App"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newProjectName.trim()) {
                    addProject();
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-status">Status</Label>
              <Select
                value={newProjectStatus}
                onValueChange={setNewProjectStatus}
              >
                <SelectTrigger id="project-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="planning">Planning</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={addProject} disabled={!newProjectName.trim()}>
              <Plus className="h-4 w-4 mr-2" />
              Add project
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

