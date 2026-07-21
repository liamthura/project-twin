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

// Knowledge Editor
export default function KnowledgeEditor({ data, onChange, onShowConfirmation }) {
  const levels = ["beginner", "learning", "intermediate", "advanced", "expert"];
  const [searchTerm, setSearchTerm] = useState("");
  const [filterLevel, setFilterLevel] = useState("all");
  const [expandedDomains, setExpandedDomains] = useState({});
  const [expandedDomainReferences, setExpandedDomainReferences] = useState({});
  const [expandedTabs, setExpandedTabs] = useState({});
  const [expandedTabReferences, setExpandedTabReferences] = useState({});
  const [collapsedSections, setCollapsedSections] = useState({
    skills: true,
    mentalTabs: true,
  });
  const [isSkillModalOpen, setIsSkillModalOpen] = useState(false);
  const [isTabModalOpen, setIsTabModalOpen] = useState(false);
  const [newDomainName, setNewDomainName] = useState("");
  const [newDomainLevel, setNewDomainLevel] = useState("learning");
  const [newDomainNotes, setNewDomainNotes] = useState("");
  const [newTabTitle, setNewTabTitle] = useState("");
  const [newTabContent, setNewTabContent] = useState("");
  const [newTabTags, setNewTabTags] = useState([]);
  const [tabSearchTerm, setTabSearchTerm] = useState("");

  // Info modal state
  const [infoModal, setInfoModal] = useState({
    isOpen: false,
    title: "",
    overview: "",
    tips: [],
  });

  const sectionInfo = {
    skills: {
      title: "Skills & Domains",
      overview:
        "This section tracks your technical and professional skills. It helps AI understand what you know, how well you know it, and in what context you've applied it.",
      tips: [
        "Skill Name: Be specific—use 'Python' not 'Programming', or 'React' not just 'Frontend'.",
        "Proficiency Levels explained:",
        "  • Beginner: Just started learning, basic understanding.",
        "  • Learning: Actively studying, can do simple tasks.",
        "  • Intermediate: Comfortable with common use cases, some hands-on experience.",
        "  • Advanced: Deep knowledge, can solve complex problems independently.",
        "  • Expert: Mastery level, can teach others and handle edge cases.",
        "Notes: Add context about where and how you've used the skill—projects, tools, or specific experience.",
        "References: Optional links to tutorials, documentation, or learning resources you've found helpful.",
      ],
    },
    mentalTabs: {
      title: "Mental Tabs",
      overview:
        "Mental Tabs are your personal knowledge snippets—random facts, lists, recommendations, or notes that don't fit into skills but you want to remember and share with AI.",
      tips: [
        "Title: A short, memorable name for the tab.",
        "Notes: A brief description or context explaining what this tab is about.",
        "Tags: Keywords to help you (and AI) find this tab later.",
        "References: Add items with a name, optional URL, and notes.",
        "Use Mental Tabs for: favourite restaurants, book recommendations, gift ideas, recipes, travel tips, etc.",
        "Think of it as your personal wiki that AI can reference when helping you.",
      ],
    },
  };

  const openInfo = (sectionKey) => {
    const info = sectionInfo[sectionKey];
    if (info) {
      setInfoModal({ isOpen: true, ...info });
    }
  };

  const addDomain = () => {
    onChange({
      ...data,
      domains: [
        ...(data.domains || []),
        { name: "", level: "learning", notes: "" },
      ],
    });
  };

  const updateDomain = (index, field, value) => {
    const newDomains = [...(data.domains || [])];
    newDomains[index] = { ...newDomains[index], [field]: value };
    onChange({ ...data, domains: newDomains });
  };

  const removeDomain = (index) => {
    const domain = (data.domains || [])[index];
    if (onShowConfirmation) {
      onShowConfirmation(
        "Remove Knowledge Domain",
        `Remove "${domain?.name || "domain"}"? This action cannot be undone.`,
        () => {
          onChange({
            ...data,
            domains: (data.domains || []).filter((_, i) => i !== index),
          });
        }
      );
    } else {
      onChange({
        ...data,
        domains: (data.domains || []).filter((_, i) => i !== index),
      });
    }
  };

  const handleAddSkillFromModal = () => {
    if (newDomainName.trim()) {
      onChange({
        ...data,
        domains: [
          ...(data.domains || []),
          {
            name: newDomainName.trim(),
            level: newDomainLevel,
            notes: newDomainNotes,
            references: [],
          },
        ],
      });
      setNewDomainName("");
      setNewDomainLevel("learning");
      setNewDomainNotes("");
      setIsSkillModalOpen(false);
    }
  };

  const handleAddTabFromModal = () => {
    if (newTabTitle.trim()) {
      onChange({
        ...data,
        mental_tabs: [
          {
            title: newTabTitle.trim(),
            notes: newTabContent,
            tags: newTabTags,
            references: [],
            created_at: new Date().toISOString(),
          },
          ...(data.mental_tabs || []),
        ],
      });
      setNewTabTitle("");
      setNewTabContent("");
      setNewTabTags([]);
      setIsTabModalOpen(false);
    }
  };

  const updateTab = (index, field, value) => {
    const newTabs = [...(data.mental_tabs || [])];
    newTabs[index] = { ...newTabs[index], [field]: value };
    onChange({ ...data, mental_tabs: newTabs });
  };

  const removeTab = (index) => {
    const tab = (data.mental_tabs || [])[index];
    if (onShowConfirmation) {
      onShowConfirmation(
        "Remove Mental Tab",
        `Remove "${tab?.title || "tab"}"? This action cannot be undone.`,
        () => {
          onChange({
            ...data,
            mental_tabs: (data.mental_tabs || []).filter((_, i) => i !== index),
          });
        }
      );
    } else {
      onChange({
        ...data,
        mental_tabs: (data.mental_tabs || []).filter((_, i) => i !== index),
      });
    }
  };

  const toggleTab = (index) => {
    setExpandedTabs((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const filteredDomains = (data.domains || []).filter((domain) => {
    const matchesSearch = domain.name
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
    const matchesLevel = filterLevel === "all" || domain.level === filterLevel;
    return matchesSearch && matchesLevel;
  });

  const filteredTabs = (data.mental_tabs || []).filter((tab) => {
    const searchLower = tabSearchTerm.toLowerCase();
    const matchesTitle = tab.title?.toLowerCase().includes(searchLower);
    const matchesTags = tab.tags?.some((tag) =>
      tag.toLowerCase().includes(searchLower)
    );
    return matchesTitle || matchesTags;
  });

  const toggleDomain = (index) => {
    setExpandedDomains((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const toggleSection = (section) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  return (
    <div className="space-y-6">
      {/* Skills Section */}
      <Card>
        <CardHeader className="border-b">
          <div
            className="flex items-center justify-between cursor-pointer hover:bg-muted/50 transition-colors rounded-t-lg -m-6 p-6"
            onClick={() => toggleSection("skills")}
          >
            <div className="flex items-center gap-2">
              <ChevronDown
                className={`h-5 w-5 transition-transform ${
                  collapsedSections.skills ? "-rotate-90" : ""
                }`}
              />
              <div>
                <CardTitle className="flex items-center gap-2">
                  Skills & Domains
                  <Button
                    variant="ghost"
                    size="icon"
                    className="tap-target h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      openInfo("skills");
                    }}
                  >
                    <Info className="h-4 w-4" />
                  </Button>
                </CardTitle>
                <CardDescription>
                  Track your technical skills and proficiency levels
                </CardDescription>
              </div>
            </div>
            <Button
              onClick={(e) => {
                e.stopPropagation();
                setIsSkillModalOpen(true);
              }}
              size="sm"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add skill
            </Button>
          </div>
        </CardHeader>
        {!collapsedSections.skills && (
          <CardContent className="space-y-4">
            {/* Search and filter */}
            {(data.domains || []).length > 0 && (
              <div className="flex gap-3 flex-wrap items-end">
                <div className="flex-1 min-w-[200px]">
                  <Label
                    htmlFor="search"
                    className="text-xs text-muted-foreground mb-2 block"
                  >
                    Search
                  </Label>
                  <Input
                    id="search"
                    placeholder="Search skills..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="min-w-[150px]">
                  <Label
                    htmlFor="filter"
                    className="text-xs text-muted-foreground mb-2 block"
                  >
                    Filter by Level
                  </Label>
                  <Select value={filterLevel} onValueChange={setFilterLevel}>
                    <SelectTrigger id="filter" className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Levels</SelectItem>
                      {levels.map((level) => (
                        <SelectItem key={level} value={level}>
                          {level.charAt(0).toUpperCase() + level.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {(searchTerm || filterLevel !== "all") && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearchTerm("");
                      setFilterLevel("all");
                    }}
                    className="h-9"
                  >
                    Clear Filters
                  </Button>
                )}
              </div>
            )}

            {/* Domains list */}
            {filteredDomains.length > 0 ? (
              <div>
                {filteredDomains.map((domain, index) => {
                  const originalIndex = (data.domains || []).indexOf(domain);
                  const isExpanded = expandedDomains[originalIndex];
                  const hasNotes = !!domain.notes;

                  return (
                    <div
                      key={originalIndex}
                      className="border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors"
                    >
                      {/* Collapsed header */}
                      <div
                        className="flex items-center gap-2 p-3 cursor-pointer"
                        onClick={() => toggleDomain(originalIndex)}
                      >
                        <ChevronDown
                          className={`h-4 w-4 transition-transform text-muted-foreground ${
                            isExpanded ? "" : "-rotate-90"
                          }`}
                        />
                        <div className="flex-1 min-w-0 flex items-center gap-2">
                          <span className="font-medium truncate">
                            {domain.name || "Untitled domain"}
                          </span>
                          <div className="flex gap-1 items-center flex-shrink-0">
                            <Badge variant="secondary" className="h-5 text-xs">
                              {domain.level || "learning"}
                            </Badge>
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
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeDomain(originalIndex);
                          }}
                          className="tap-target h-8 w-8 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      {/* Expanded content */}
                      {isExpanded && (
                        <div className="border-t bg-background/50 p-4 space-y-4">
                          <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
                            <div className="space-y-2">
                              <Label>Domain / Skill</Label>
                              <Input
                                value={domain.name || ""}
                                onChange={(e) =>
                                  updateDomain(
                                    originalIndex,
                                    "name",
                                    e.target.value
                                  )
                                }
                                placeholder="e.g. Python, Docker"
                                className="h-9"
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Proficiency</Label>
                              <Select
                                value={domain.level || "learning"}
                                onValueChange={(value) =>
                                  updateDomain(originalIndex, "level", value)
                                }
                              >
                                <SelectTrigger className="h-9">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {levels.map((level) => (
                                    <SelectItem key={level} value={level}>
                                      {level.charAt(0).toUpperCase() +
                                        level.slice(1)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label>Notes</Label>
                            <Textarea
                              value={domain.notes || ""}
                              onChange={(e) =>
                                updateDomain(
                                  originalIndex,
                                  "notes",
                                  e.target.value
                                )
                              }
                              placeholder="Notes..."
                              className="min-h-[80px] text-sm bg-background"
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>

                          {/* References Section */}
                          <div className="space-y-2">
                            <Label>References & Resources</Label>
                            <div className="space-y-2">
                              {(domain.references || []).map((ref, refIdx) => {
                                const refKey = `${originalIndex}-${refIdx}`;
                                const isRefExpanded =
                                  expandedDomainReferences[refKey];
                                return (
                                  <div
                                    key={refIdx}
                                    className="rounded border bg-background"
                                  >
                                    <div
                                      className="flex items-center gap-2 p-2 cursor-pointer hover:bg-muted/50"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setExpandedDomainReferences((prev) => ({
                                          ...prev,
                                          [refKey]: !prev[refKey],
                                        }));
                                      }}
                                    >
                                      <ChevronDown
                                        className={`h-3 w-3 transition-transform ${
                                          isRefExpanded ? "" : "-rotate-90"
                                        }`}
                                      />
                                      <span className="text-xs flex-1 truncate">
                                        {ref.name || "Untitled reference"}
                                      </span>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const newRefs = (
                                            domain.references || []
                                          ).filter((_, i) => i !== refIdx);
                                          updateDomain(
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
                                      <div className="border-t p-2 space-y-2">
                                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                          <Input
                                            value={ref.name || ""}
                                            onChange={(e) => {
                                              const newRefs = [
                                                ...(domain.references || []),
                                              ];
                                              newRefs[refIdx] = {
                                                ...newRefs[refIdx],
                                                name: e.target.value,
                                              };
                                              updateDomain(
                                                originalIndex,
                                                "references",
                                                newRefs
                                              );
                                            }}
                                            placeholder="Reference name"
                                            className="h-9"
                                            onClick={(e) => e.stopPropagation()}
                                          />
                                          <Input
                                            value={ref.url || ""}
                                            onChange={(e) => {
                                              const newRefs = [
                                                ...(domain.references || []),
                                              ];
                                              newRefs[refIdx] = {
                                                ...newRefs[refIdx],
                                                url: e.target.value,
                                              };
                                              updateDomain(
                                                originalIndex,
                                                "references",
                                                newRefs
                                              );
                                            }}
                                            placeholder="URL"
                                            className="h-9"
                                            onClick={(e) => e.stopPropagation()}
                                          />
                                        </div>
                                        <Textarea
                                          value={ref.notes || ""}
                                          onChange={(e) => {
                                            const newRefs = [
                                              ...(domain.references || []),
                                            ];
                                            newRefs[refIdx] = {
                                              ...newRefs[refIdx],
                                              notes: e.target.value,
                                            };
                                            updateDomain(
                                              originalIndex,
                                              "references",
                                              newRefs
                                            );
                                          }}
                                          placeholder="Notes"
                                          className="min-h-[50px] text-xs"
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
                                    ...(domain.references || []),
                                    { name: "", url: "", notes: "" },
                                  ];
                                  updateDomain(
                                    originalIndex,
                                    "references",
                                    newRefs
                                  );
                                  const newRefIdx = newRefs.length - 1;
                                  setExpandedDomainReferences((prev) => ({
                                    ...prev,
                                    [`${originalIndex}-${newRefIdx}`]: true,
                                  }));
                                }}
                                className="h-8 w-full border-dashed"
                              >
                                <Plus className="h-3.5 w-3.5 mr-1.5" />
                                Add reference
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {filteredDomains.length === 0 && (
              <EmptyState>
                {searchTerm || filterLevel !== "all"
                  ? "No skills match your filters."
                  : "No skills yet. Add one to get started."}
              </EmptyState>
            )}
          </CardContent>
        )}
      </Card>

      {/* Skills Add Modal */}
      <Dialog open={isSkillModalOpen} onOpenChange={setIsSkillModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Skill</DialogTitle>
            <DialogDescription>
              Enter the skill name and proficiency level
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="skill-name">Skill Name</Label>
              <Input
                id="skill-name"
                placeholder="e.g. Python, Docker, Machine Learning"
                value={newDomainName}
                onChange={(e) => setNewDomainName(e.target.value)}
                onKeyPress={(e) =>
                  e.key === "Enter" && handleAddSkillFromModal()
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="skill-level">Proficiency Level</Label>
              <Select value={newDomainLevel} onValueChange={setNewDomainLevel}>
                <SelectTrigger id="skill-level">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {levels.map((level) => (
                    <SelectItem key={level} value={level}>
                      {level.charAt(0).toUpperCase() + level.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="skill-notes">Notes (Optional)</Label>
              <Textarea
                id="skill-notes"
                placeholder="Add context, projects, or experience..."
                value={newDomainNotes}
                onChange={(e) => setNewDomainNotes(e.target.value)}
                className="min-h-[80px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsSkillModalOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleAddSkillFromModal}>Add Skill</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mental Tabs Section */}
      <Card>
        <CardHeader className="border-b">
          <div
            className="flex items-center justify-between cursor-pointer hover:bg-muted/50 transition-colors rounded-t-lg -m-6 p-6"
            onClick={() => toggleSection("mentalTabs")}
          >
            <div className="flex items-center gap-2">
              <ChevronDown
                className={`h-5 w-5 transition-transform ${
                  collapsedSections.mentalTabs ? "-rotate-90" : ""
                }`}
              />
              <div>
                <CardTitle className="flex items-center gap-2">
                  Mental Tabs
                  <Button
                    variant="ghost"
                    size="icon"
                    className="tap-target h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      openInfo("mentalTabs");
                    }}
                  >
                    <Info className="h-4 w-4" />
                  </Button>
                </CardTitle>
                <CardDescription>
                  Store random knowledge, notes, and insights that don't fit
                  into skills
                </CardDescription>
              </div>
            </div>
            <Button
              onClick={(e) => {
                e.stopPropagation();
                setIsTabModalOpen(true);
              }}
              size="sm"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add tab
            </Button>
          </div>
        </CardHeader>
        {!collapsedSections.mentalTabs && (
          <CardContent className="space-y-4">
            {/* Search */}
            {(data.mental_tabs || []).length > 0 && (
              <div className="flex gap-3 items-end">
                <div className="flex-1 min-w-[200px]">
                  <Label
                    htmlFor="tab-search"
                    className="text-xs text-muted-foreground mb-2 block"
                  >
                    Search
                  </Label>
                  <Input
                    id="tab-search"
                    placeholder="Search tabs..."
                    value={tabSearchTerm}
                    onChange={(e) => setTabSearchTerm(e.target.value)}
                    className="h-9"
                  />
                </div>
                {tabSearchTerm && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setTabSearchTerm("")}
                    className="h-9"
                  >
                    Clear
                  </Button>
                )}
              </div>
            )}

            {/* Tabs list */}
            {filteredTabs.length > 0 ? (
              <div>
                {filteredTabs.map((tab, index) => {
                  const originalIndex = (data.mental_tabs || []).indexOf(tab);
                  const isExpanded = expandedTabs[originalIndex];
                  const hasTags = tab.tags && tab.tags.length > 0;

                  return (
                    <div
                      key={originalIndex}
                      className="border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors"
                    >
                      {/* Collapsed header */}
                      <div
                        className="flex items-center gap-2 p-3 cursor-pointer"
                        onClick={() => toggleTab(originalIndex)}
                      >
                        <ChevronDown
                          className={`h-4 w-4 transition-transform text-muted-foreground ${
                            isExpanded ? "" : "-rotate-90"
                          }`}
                        />
                        <div className="flex-1 min-w-0 flex items-center gap-2">
                          <span className="font-medium truncate">
                            {tab.title || "Untitled tab"}
                          </span>
                          {hasTags && (
                            <div className="flex gap-1 flex-wrap flex-shrink-0">
                              {tab.tags.slice(0, 3).map((tag, i) => (
                                <Badge
                                  key={i}
                                  variant="secondary"
                                  className="h-5 text-xs"
                                >
                                  {tag}
                                </Badge>
                              ))}
                              {tab.tags.length > 3 && (
                                <Badge
                                  variant="secondary"
                                  className="h-5 text-xs"
                                >
                                  +{tab.tags.length - 3}
                                </Badge>
                              )}
                            </div>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeTab(originalIndex);
                          }}
                          className="tap-target h-8 w-8 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      {/* Expanded content */}
                      {isExpanded && (
                        <div className="border-t bg-background/50 p-4 space-y-4">
                          <div className="space-y-2">
                            <Label>Title</Label>
                            <Input
                              value={tab.title || ""}
                              onChange={(e) =>
                                updateTab(
                                  originalIndex,
                                  "title",
                                  e.target.value
                                )
                              }
                              placeholder="Tab title"
                              className="h-9"
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>Notes</Label>
                            <Textarea
                              value={tab.notes || ""}
                              onChange={(e) =>
                                updateTab(
                                  originalIndex,
                                  "notes",
                                  e.target.value
                                )
                              }
                              placeholder="Your notes, insights, reminders..."
                              className="min-h-[120px] text-sm bg-background"
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>Tags</Label>
                            <ArrayInput
                              items={tab.tags || []}
                              onChange={(newTags) =>
                                updateTab(originalIndex, "tags", newTags)
                              }
                              placeholder="Add tag..."
                            />
                          </div>

                          {/* References Section */}
                          <div className="space-y-2">
                            <Label>References & Resources</Label>
                            <div className="space-y-2">
                              {(tab.references || []).map((ref, refIdx) => {
                                const refKey = `${originalIndex}-${refIdx}`;
                                const isRefExpanded =
                                  expandedTabReferences[refKey];
                                return (
                                  <div
                                    key={refIdx}
                                    className="rounded border bg-background"
                                  >
                                    <div
                                      className="flex items-center gap-2 p-2 cursor-pointer hover:bg-muted/50"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setExpandedTabReferences((prev) => ({
                                          ...prev,
                                          [refKey]: !prev[refKey],
                                        }));
                                      }}
                                    >
                                      <ChevronDown
                                        className={`h-3 w-3 transition-transform ${
                                          isRefExpanded ? "" : "-rotate-90"
                                        }`}
                                      />
                                      <span className="text-xs flex-1 truncate">
                                        {ref.name || "Untitled reference"}
                                      </span>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const newRefs = (
                                            tab.references || []
                                          ).filter((_, i) => i !== refIdx);
                                          updateTab(
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
                                      <div className="border-t p-2 space-y-2">
                                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                          <Input
                                            value={ref.name || ""}
                                            onChange={(e) => {
                                              const newRefs = [
                                                ...(tab.references || []),
                                              ];
                                              newRefs[refIdx] = {
                                                ...newRefs[refIdx],
                                                name: e.target.value,
                                              };
                                              updateTab(
                                                originalIndex,
                                                "references",
                                                newRefs
                                              );
                                            }}
                                            placeholder="Reference name"
                                            className="h-9"
                                            onClick={(e) => e.stopPropagation()}
                                          />
                                          <Input
                                            value={ref.url || ""}
                                            onChange={(e) => {
                                              const newRefs = [
                                                ...(tab.references || []),
                                              ];
                                              newRefs[refIdx] = {
                                                ...newRefs[refIdx],
                                                url: e.target.value,
                                              };
                                              updateTab(
                                                originalIndex,
                                                "references",
                                                newRefs
                                              );
                                            }}
                                            placeholder="URL"
                                            className="h-9"
                                            onClick={(e) => e.stopPropagation()}
                                          />
                                        </div>
                                        <Textarea
                                          value={ref.notes || ""}
                                          onChange={(e) => {
                                            const newRefs = [
                                              ...(tab.references || []),
                                            ];
                                            newRefs[refIdx] = {
                                              ...newRefs[refIdx],
                                              notes: e.target.value,
                                            };
                                            updateTab(
                                              originalIndex,
                                              "references",
                                              newRefs
                                            );
                                          }}
                                          placeholder="Notes"
                                          className="min-h-[50px] text-xs"
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
                                    ...(tab.references || []),
                                    { name: "", url: "", notes: "" },
                                  ];
                                  updateTab(
                                    originalIndex,
                                    "references",
                                    newRefs
                                  );
                                  const newRefIdx = newRefs.length - 1;
                                  setExpandedTabReferences((prev) => ({
                                    ...prev,
                                    [`${originalIndex}-${newRefIdx}`]: true,
                                  }));
                                }}
                                className="h-8 w-full border-dashed"
                              >
                                <Plus className="h-3.5 w-3.5 mr-1.5" />
                                Add reference
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
                {tabSearchTerm
                  ? "No tabs match your search."
                  : "No mental tabs yet. Add one to get started."}
              </EmptyState>
            )}
          </CardContent>
        )}
      </Card>

      {/* Mental Tabs Add Modal */}
      <Dialog open={isTabModalOpen} onOpenChange={setIsTabModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Mental Tab</DialogTitle>
            <DialogDescription>
              Save random knowledge, notes, or insights
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tab-title">Title</Label>
              <Input
                id="tab-title"
                placeholder="e.g. AWS CLI Commands, Git Workflows"
                value={newTabTitle}
                onChange={(e) => setNewTabTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tab-notes">Notes</Label>
              <Textarea
                id="tab-notes"
                placeholder="Your notes, code snippets, reminders..."
                value={newTabContent}
                onChange={(e) => setNewTabContent(e.target.value)}
                className="min-h-[120px]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tab-tags">Tags (Optional)</Label>
              <ArrayInput
                items={newTabTags}
                onChange={setNewTabTags}
                placeholder="Add tag..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsTabModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddTabFromModal}>Add Tab</Button>
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
