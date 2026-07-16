import { useState, useEffect, useCallback, useRef } from "react";
import {
  User,
  Brain,
  BookOpen,
  Settings,
  FolderKanban,
  Heart,
  Plus,
  X,
  RefreshCw,
  WifiOff,
  Loader2,
  Trash2,
  ChevronDown,
  Info,
  Users,
  SlidersHorizontal,
  Sun,
  Moon,
  Monitor,
  Globe,
  Server,
} from "lucide-react";

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/components/ui/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ConnectionSettings } from "@/components/ConnectionSettings";
import {
  api,
  getAuthToken,
  saveConfig,
  loginAccount,
  registerAccount,
  CLOUD_API_URL,
} from "@/lib/api.js";

// Debounce hook
function useDebounce(callback, delay) {
  const timeoutRef = useRef(null);

  const debouncedCallback = useCallback(
    (...args) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        callback(...args);
      }, delay);
    },
    [callback, delay]
  );

  return debouncedCallback;
}

// Array Input Component
function ArrayInput({ items = [], onChange, placeholder }) {
  const [newItem, setNewItem] = useState("");

  const addItem = () => {
    if (newItem.trim()) {
      onChange([...items, newItem.trim()]);
      setNewItem("");
    }
  };

  const removeItem = (index) => {
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {items.map((item, index) => (
            <Badge key={index} variant="secondary" className="gap-1 pr-1">
              {item}
              <button
                onClick={() => removeItem(index)}
                className="ml-1 hover:text-destructive transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyPress={(e) =>
            e.key === "Enter" && (e.preventDefault(), addItem())
          }
          placeholder={placeholder}
          className="flex-1"
        />
        <Button onClick={addItem} size="sm" variant="secondary">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// Profile Editor
function ProfileEditor({ data, onChange, onShowConfirmation }) {
  const update = (field, value) => onChange({ ...data, [field]: value });
  const updateContact = (field, value) =>
    onChange({ ...data, contact: { ...(data.contact || {}), [field]: value } });
  const addEmail = () =>
    updateContact("emails", [
      ...(data.contact?.emails || []),
      { address: "", purpose: "primary" },
    ]);
  const updateEmail = (index, field, value) => {
    const next = [...(data.contact?.emails || [])];
    next[index] = { ...(next[index] || {}), [field]: value };
    updateContact("emails", next);
  };
  const removeEmail = (index) => {
    const email = (data.contact?.emails || [])[index];
    if (onShowConfirmation) {
      onShowConfirmation(
        "Remove Email",
        `Remove "${email?.address || "email"}"? This action cannot be undone.`,
        () => {
          updateContact(
            "emails",
            (data.contact?.emails || []).filter((_, i) => i !== index)
          );
        }
      );
    } else {
      updateContact(
        "emails",
        (data.contact?.emails || []).filter((_, i) => i !== index)
      );
    }
  };
  const addLink = () =>
    updateContact("links", [
      ...(data.contact?.links || []),
      { label: "", url: "" },
    ]);
  const updateLink = (index, field, value) => {
    const next = [...(data.contact?.links || [])];
    next[index] = { ...(next[index] || {}), [field]: value };
    updateContact("links", next);
  };
  const removeLink = (index) => {
    const link = (data.contact?.links || [])[index];
    if (onShowConfirmation) {
      onShowConfirmation(
        "Remove Link",
        `Remove "${link?.label || "link"}"? This action cannot be undone.`,
        () => {
          updateContact(
            "links",
            (data.contact?.links || []).filter((_, i) => i !== index)
          );
        }
      );
    } else {
      updateContact(
        "links",
        (data.contact?.links || []).filter((_, i) => i !== index)
      );
    }
  };
  const addLanguage = () =>
    update("languages_spoken", [
      ...(data.languages_spoken || []),
      { name: "", fluency: "conversational" },
    ]);
  const updateLanguage = (index, field, value) => {
    const next = [...(data.languages_spoken || [])];
    next[index] = { ...(next[index] || {}), [field]: value };
    update("languages_spoken", next);
  };
  const removeLanguage = (index) => {
    const language = (data.languages_spoken || [])[index];
    if (onShowConfirmation) {
      onShowConfirmation(
        "Remove Language",
        `Remove "${
          language?.name || "language"
        }"? This action cannot be undone.`,
        () => {
          update(
            "languages_spoken",
            (data.languages_spoken || []).filter((_, i) => i !== index)
          );
        }
      );
    } else {
      update(
        "languages_spoken",
        (data.languages_spoken || []).filter((_, i) => i !== index)
      );
    }
  };
  const addEducation = () => {
    const newIndex = (data.education || []).length;
    onChange({
      ...data,
      education: [
        ...(data.education || []),
        {
          institution: "",
          degree_level: "",
          field_of_study: "",
          start_year: "",
          end_year: "",
          status: "completed",
          coursework: [],
          clubs: [],
          highlights: [],
        },
      ],
    });
    setExpandedEducation((prev) => ({ ...prev, [newIndex]: true }));
  };

  const updateEducation = (index, field, value) => {
    const next = [...(data.education || [])];
    next[index] = { ...(next[index] || {}), [field]: value };
    onChange({ ...data, education: next });
  };

  const removeEducation = (index) => {
    const edu = (data.education || [])[index];
    if (onShowConfirmation) {
      onShowConfirmation(
        "Remove Education",
        `Remove "${
          edu?.institution || "education entry"
        }"? This action cannot be undone.`,
        () => {
          onChange({
            ...data,
            education: (data.education || []).filter((_, i) => i !== index),
          });
        }
      );
    } else {
      onChange({
        ...data,
        education: (data.education || []).filter((_, i) => i !== index),
      });
    }
  };
  const addCoursework = (eduIndex) => {
    const edu = (data.education || [])[eduIndex];
    updateEducation(eduIndex, "coursework", [
      ...(edu?.coursework || []),
      { name: "", topics: [] },
    ]);
  };

  const updateCoursework = (eduIndex, courseIndex, field, value) => {
    const edu = (data.education || [])[eduIndex];
    const next = [...(edu?.coursework || [])];
    next[courseIndex] = { ...(next[courseIndex] || {}), [field]: value };
    updateEducation(eduIndex, "coursework", next);
  };

  const removeCoursework = (eduIndex, courseIndex) => {
    const edu = (data.education || [])[eduIndex];
    const course = (edu?.coursework || [])[courseIndex];
    if (onShowConfirmation) {
      onShowConfirmation(
        "Remove Coursework",
        `Remove "${
          course?.name || "coursework"
        }"? This action cannot be undone.`,
        () => {
          updateEducation(
            eduIndex,
            "coursework",
            (edu?.coursework || []).filter((_, i) => i !== courseIndex)
          );
        }
      );
    } else {
      updateEducation(
        eduIndex,
        "coursework",
        (edu?.coursework || []).filter((_, i) => i !== courseIndex)
      );
    }
  };
  const addClub = (eduIndex) => {
    const edu = (data.education || [])[eduIndex];
    updateEducation(eduIndex, "clubs", [
      ...(edu?.clubs || []),
      { name: "", activities_involved: [] },
    ]);
  };

  const updateClub = (eduIndex, clubIndex, field, value) => {
    const edu = (data.education || [])[eduIndex];
    const next = [...(edu?.clubs || [])];
    next[clubIndex] = { ...(next[clubIndex] || {}), [field]: value };
    updateEducation(eduIndex, "clubs", next);
  };

  const removeClub = (eduIndex, clubIndex) => {
    const edu = (data.education || [])[eduIndex];
    const club = (edu?.clubs || [])[clubIndex];
    if (onShowConfirmation) {
      onShowConfirmation(
        "Remove Club",
        `Remove "${club?.name || "club"}"? This action cannot be undone.`,
        () => {
          updateEducation(
            eduIndex,
            "clubs",
            (edu?.clubs || []).filter((_, i) => i !== clubIndex)
          );
        }
      );
    } else {
      updateEducation(
        eduIndex,
        "clubs",
        (edu?.clubs || []).filter((_, i) => i !== clubIndex)
      );
    }
  };
  const addGoal = () =>
    onChange({
      ...data,
      goals_and_careers: [
        ...(data.goals_and_careers || []),
        { goal: "", target: "" },
      ],
    });

  const updateGoal = (index, field, value) => {
    const next = [...(data.goals_and_careers || [])];
    next[index] = { ...(next[index] || {}), [field]: value };
    onChange({ ...data, goals_and_careers: next });
  };

  const removeGoal = (index) => {
    const goal = (data.goals_and_careers || [])[index];
    if (onShowConfirmation) {
      onShowConfirmation(
        "Remove Goal",
        `Remove "${goal?.goal || "goal"}"? This action cannot be undone.`,
        () => {
          onChange({
            ...data,
            goals_and_careers: (data.goals_and_careers || []).filter(
              (_, i) => i !== index
            ),
          });
        }
      );
    } else {
      onChange({
        ...data,
        goals_and_careers: (data.goals_and_careers || []).filter(
          (_, i) => i !== index
        ),
      });
    }
  };

  const [collapsedSections, setCollapsedSections] = useState({
    academic: true,
    contact: true,
    languages: true,
    workExp: true,
  });

  const [expandedWorkExp, setExpandedWorkExp] = useState({});
  const [expandedEducation, setExpandedEducation] = useState({});

  const toggleWorkExp = (index) =>
    setExpandedWorkExp((prev) => ({ ...prev, [index]: !prev[index] }));
  const toggleEducation = (index) =>
    setExpandedEducation((prev) => ({ ...prev, [index]: !prev[index] }));

  // Info modal state
  const [infoModal, setInfoModal] = useState({
    isOpen: false,
    title: "",
    overview: "",
    tips: [],
  });

  const sectionInfo = {
    personal: {
      title: "Personal Information",
      overview:
        "This section captures who you are at a glance. It helps AI assistants address you correctly and understand your current context (student, professional, location, etc.).",
      tips: [
        "Name: Your full legal name as it appears on official documents.",
        "Preferred Name: The name you'd like AI to call you (nickname, first name, etc.).",
        "Current Role: Your primary occupation or status, e.g. 'Final Year Student', 'Software Engineer', 'Freelance Designer'.",
        "Organisation: Your school, university, or employer.",
        "Location: City and country—helps with locale-specific suggestions (holidays, time zones, spelling conventions).",
        "Nationality: Useful for cultural context and language defaults.",
        "Bio: A 2–3 sentence summary of who you are, your interests, and what you're working on. Think of it as your elevator pitch.",
      ],
    },
    academic: {
      title: "Education",
      overview:
        "Document your educational journey—schools, degrees, and achievements. This helps AI understand your academic background and tailor advice accordingly.",
      tips: [
        "Add one entry per institution or degree (e.g., separate entries for high school and university).",
        "Institution Name: Full official name of the school or university.",
        "Degree Level: e.g., 'High School Diploma', 'BSc', 'MSc', 'PhD'.",
        "Field of Study: Your major, concentration, or programme name.",
        "Status: Whether you're currently enrolled, have completed, or left incomplete.",
        "Years: Start and end (or expected end) years.",
        "Coursework: Key modules or classes you've taken. Add topics/skills learned in each.",
        "Clubs & Societies: Extracurricular involvement—name the club and list your activities or roles.",
        "Highlights: Notable achievements like awards, high grades, leadership roles, or recognitions. Use short, action-oriented bullet points.",
        "Goals: Academic or career goals you're working toward, with specific targets.",
      ],
    },
    work: {
      title: "Work Experience",
      overview:
        "List your professional experiences—jobs, internships, placements, and volunteer work. This helps AI understand your skills and career trajectory.",
      tips: [
        "Add one entry per role. If you held multiple roles at the same company, consider separate entries.",
        "Role: Your job title or position.",
        "Company: The organisation you worked for.",
        "Type: e.g., 'Full-time', 'Part-time', 'Internship', 'Placement', 'Volunteer', 'Freelance'.",
        "Period: Date range in a readable format, e.g., 'Jan 2023 – Jun 2024' or 'Summer 2022'.",
        "Highlights: 3–6 bullet points describing what you did and achieved. Focus on outcomes and impact. Use action verbs and include metrics where possible (e.g., 'Reduced processing time by 40%').",
      ],
    },
    contact: {
      title: "Contact & Links",
      overview:
        "Provide ways to reach you and links to your online profiles. AI can use this to reference your portfolio or suggest networking opportunities.",
      tips: [
        "Emails: Add all relevant email addresses and tag their purpose (Primary, Work, School, etc.). Primary is what AI will default to.",
        "Links: Add your professional profiles—LinkedIn, GitHub, portfolio website, personal blog, etc.",
        "Use descriptive labels like 'Portfolio', 'LinkedIn', 'GitHub' so it's clear what each link is.",
        "Keep URLs up to date; broken links aren't helpful!",
      ],
    },
    languages: {
      title: "Languages",
      overview:
        "List the languages you speak and your proficiency level. This helps AI communicate with you appropriately and understand your linguistic capabilities.",
      tips: [
        "Add each language you can communicate in.",
        "Fluency levels explained:",
        "  • Beginner: Basic phrases and simple sentences.",
        "  • Conversational: Can hold everyday conversations.",
        "  • Fluent: Comfortable in most situations, may have occasional gaps.",
        "  • Professional: Business-level proficiency, can write and present formally.",
        "  • Native: Mother tongue or equivalent.",
        "Order by strongest first—AI will prioritise top entries.",
      ],
    },
  };

  const openInfo = (sectionKey) => {
    const info = sectionInfo[sectionKey];
    if (info) {
      setInfoModal({ isOpen: true, ...info });
    }
  };

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    title: "",
    description: "",
    action: null,
  });

  const showConfirmation = (title, description, action) => {
    setConfirmDialog({
      isOpen: true,
      title,
      description,
      action,
    });
  };

  const handleConfirm = () => {
    if (confirmDialog.action) {
      confirmDialog.action();
    }
    setConfirmDialog({ ...confirmDialog, isOpen: false });
  };

  const handleCancel = () => {
    setConfirmDialog({ ...confirmDialog, isOpen: false });
  };

  const toggleSection = (section) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  return (
    <div className="space-y-6">
      {/* Personal Information */}
      <Card>
        <CardHeader className="sticky top-[60px] z-10 rounded-t-lg border-b bg-card">
          <CardTitle className="flex items-center gap-2">
            Personal Information
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-primary"
              onClick={() => openInfo("personal")}
            >
              <Info className="h-4 w-4" />
            </Button>
          </CardTitle>
          <CardDescription>
            Your basic identity and current status
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={data.name || ""}
              onChange={(e) => update("name", e.target.value)}
              placeholder="Your name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="preferred_name">Preferred Name</Label>
            <Input
              id="preferred_name"
              value={data.preferred_name || ""}
              onChange={(e) => update("preferred_name", e.target.value)}
              placeholder="e.g. Liam"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="role">Current Role</Label>
            <Input
              id="role"
              value={data.current_role || ""}
              onChange={(e) => update("current_role", e.target.value)}
              placeholder="e.g. Software Engineer"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nationality">Nationality</Label>
            <Input
              id="nationality"
              value={data.nationality || ""}
              onChange={(e) => update("nationality", e.target.value)}
              placeholder="e.g. Myanmar"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="location">Location</Label>
            <Input
              id="location"
              value={data.location || ""}
              onChange={(e) => update("location", e.target.value)}
              placeholder="City, Country"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="org">Organisation</Label>
            <Input
              id="org"
              value={data.organisation || ""}
              onChange={(e) => update("organisation", e.target.value)}
              placeholder="Company or university"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="bio">Bio</Label>
            <Textarea
              id="bio"
              value={data.bio || ""}
              onChange={(e) => update("bio", e.target.value)}
              placeholder="A brief description of who you are..."
              className="min-h-[100px]"
            />
          </div>
        </CardContent>
      </Card>

      {/* Academic Information */}
      <Card>
        <CardHeader className="sticky top-[60px] z-10 rounded-t-lg border-b bg-card">
          <div
            className="flex items-center justify-between cursor-pointer hover:bg-muted/50 transition-colors rounded-t-lg -m-6 p-6"
            onClick={() => toggleSection("academic")}
          >
            <div className="flex items-center gap-2">
              <ChevronDown
                className={`h-5 w-5 transition-transform ${
                  collapsedSections.academic ? "-rotate-90" : ""
                }`}
              />
              <div>
                <CardTitle className="flex items-center gap-2">
                  Education
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      openInfo("academic");
                    }}
                  >
                    <Info className="h-4 w-4" />
                  </Button>
                </CardTitle>
                <CardDescription>
                  Your educational background and qualifications
                </CardDescription>
              </div>
            </div>
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setCollapsedSections((prev) => ({ ...prev, academic: false }));
                addEducation();
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Education
            </Button>
          </div>
        </CardHeader>
        {!collapsedSections.academic && (
          <CardContent className="space-y-6">
            {/* Education Entries */}
            {Array.isArray(data.education) &&
            (data.education || []).length > 0 ? (
              <div>
                {(data.education || []).map((edu, eduIndex) => {
                  const isExpanded = expandedEducation[eduIndex];
                  const highlightsCount = (edu.highlights || []).length;
                  const courseCount = (edu.coursework || []).length;
                  const years = [edu.start_year, edu.end_year]
                    .filter(Boolean)
                    .join("–");
                  return (
                    <div
                      key={eduIndex}
                      className="border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors"
                    >
                      {/* Collapsed Header */}
                      <div
                        className="flex items-center gap-2 p-3 cursor-pointer"
                        onClick={() => toggleEducation(eduIndex)}
                      >
                        <ChevronDown
                          className={`h-4 w-4 transition-transform text-muted-foreground ${
                            isExpanded ? "" : "-rotate-90"
                          }`}
                        />
                        <div className="flex-1 flex items-center gap-2 min-w-0">
                          <span className="font-medium truncate">
                            {edu.institution || "Untitled Institution"}
                          </span>
                          <span className="text-sm text-muted-foreground truncate hidden sm:inline">
                            {edu.field_of_study && edu.degree_level
                              ? `${edu.degree_level} in ${edu.field_of_study}`
                              : edu.field_of_study || edu.degree_level || ""}
                          </span>
                          <div className="hidden sm:flex gap-1.5 items-center flex-shrink-0">
                            {years && (
                              <Badge variant="secondary" className="h-5 text-xs">
                                {years}
                              </Badge>
                            )}
                            {courseCount > 0 && (
                              <Badge variant="secondary" className="h-5 text-xs">
                                {courseCount} courses
                              </Badge>
                            )}
                            {highlightsCount > 0 && (
                              <Badge variant="secondary" className="h-5 text-xs">
                                {highlightsCount} highlights
                              </Badge>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeEducation(eduIndex);
                          }}
                          className="h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      {/* Expanded Form */}
                      {isExpanded && (
                        <div className="p-4 pt-1 space-y-4">
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                              <Label htmlFor={`institution-${eduIndex}`}>
                                Institution Name
                              </Label>
                              <Input
                                id={`institution-${eduIndex}`}
                                value={edu.institution || ""}
                                onChange={(e) =>
                                  updateEducation(
                                    eduIndex,
                                    "institution",
                                    e.target.value
                                  )
                                }
                                placeholder="e.g. University of Cambridge, Harvard, etc."
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`degree-${eduIndex}`}>
                                Degree Level
                              </Label>
                              <Input
                                id={`degree-${eduIndex}`}
                                value={edu.degree_level || ""}
                                onChange={(e) =>
                                  updateEducation(
                                    eduIndex,
                                    "degree_level",
                                    e.target.value
                                  )
                                }
                                placeholder="e.g. Bachelor's, Master's, PhD, High School"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`field-${eduIndex}`}>
                                Field of Study / Major
                              </Label>
                              <Input
                                id={`field-${eduIndex}`}
                                value={edu.field_of_study || ""}
                                onChange={(e) =>
                                  updateEducation(
                                    eduIndex,
                                    "field_of_study",
                                    e.target.value
                                  )
                                }
                                placeholder="e.g. Computer Science, Business, etc."
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`status-${eduIndex}`}>Status</Label>
                              <Select
                                value={edu.status || "completed"}
                                onValueChange={(value) =>
                                  updateEducation(eduIndex, "status", value)
                                }
                              >
                                <SelectTrigger id={`status-${eduIndex}`}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="current">Current</SelectItem>
                                  <SelectItem value="completed">Completed</SelectItem>
                                  <SelectItem value="incomplete">
                                    Incomplete
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`start-${eduIndex}`}>Start Year</Label>
                              <Input
                                id={`start-${eduIndex}`}
                                value={edu.start_year || ""}
                                onChange={(e) =>
                                  updateEducation(
                                    eduIndex,
                                    "start_year",
                                    e.target.value
                                  )
                                }
                                placeholder="e.g. 2020"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`end-${eduIndex}`}>End Year</Label>
                              <Input
                                id={`end-${eduIndex}`}
                                value={edu.end_year || ""}
                                onChange={(e) =>
                                  updateEducation(
                                    eduIndex,
                                    "end_year",
                                    e.target.value
                                  )
                                }
                                placeholder="e.g. 2024 or Expected 2026"
                              />
                            </div>
                          </div>

                          {/* Coursework Section */}
                          <div className="space-y-2">
                            <Label>Coursework / Modules</Label>
                            <div className="space-y-3">
                              {(edu.coursework || []).map((course, courseIdx) => (
                                <div
                                  key={courseIdx}
                                  className="space-y-2 p-3 rounded-lg border"
                                >
                                  <div className="flex justify-between items-center mb-2">
                                    <Label className="text-sm font-medium">
                                      {course.name || "Untitled Course"}
                                    </Label>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() =>
                                        removeCoursework(eduIndex, courseIdx)
                                      }
                                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                    >
                                      <X className="h-3 w-3" />
                                    </Button>
                                  </div>
                                  <div className="space-y-2">
                                    <Label className="text-xs">Course Name</Label>
                                    <Input
                                      value={course.name || ""}
                                      onChange={(e) =>
                                        updateCoursework(
                                          eduIndex,
                                          courseIdx,
                                          "name",
                                          e.target.value
                                        )
                                      }
                                      placeholder="e.g. Data Structures"
                                      size="sm"
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <Label className="text-xs">Topics Covered</Label>
                                    <ArrayInput
                                      items={course.topics || []}
                                      onChange={(items) =>
                                        updateCoursework(
                                          eduIndex,
                                          courseIdx,
                                          "topics",
                                          items
                                        )
                                      }
                                      placeholder="e.g. Algorithms, Hash tables"
                                    />
                                  </div>
                                </div>
                              ))}
                              <Button
                                onClick={() => addCoursework(eduIndex)}
                                variant="outline"
                                size="sm"
                                className="w-full border-dashed"
                              >
                                <Plus className="h-4 w-4 mr-2" />
                                Add Coursework
                              </Button>
                            </div>
                          </div>

                          {/* Clubs Section */}
                          <div className="space-y-2">
                            <Label>Clubs & Societies</Label>
                            <div className="space-y-3">
                              {(edu.clubs || []).map((club, clubIdx) => (
                                <div
                                  key={clubIdx}
                                  className="space-y-2 p-3 rounded-lg border"
                                >
                                  <div className="flex justify-between items-center mb-2">
                                    <Label className="text-sm font-medium">
                                      {club.name || "Untitled Club"}
                                    </Label>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => removeClub(eduIndex, clubIdx)}
                                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  </div>
                                  <div className="space-y-2">
                                    <Label className="text-xs">Club Name</Label>
                                    <Input
                                      value={club.name || ""}
                                      onChange={(e) =>
                                        updateClub(
                                          eduIndex,
                                          clubIdx,
                                          "name",
                                          e.target.value
                                        )
                                      }
                                      placeholder="e.g. Robotics Club"
                                      size="sm"
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <Label className="text-xs">
                                      Activities Involved
                                    </Label>
                                    <ArrayInput
                                      items={club.activities_involved || []}
                                      onChange={(items) =>
                                        updateClub(
                                          eduIndex,
                                          clubIdx,
                                          "activities_involved",
                                          items
                                        )
                                      }
                                      placeholder="e.g. Project lead, Event organizer"
                                    />
                                  </div>
                                </div>
                              ))}
                              <Button
                                onClick={() => addClub(eduIndex)}
                                variant="outline"
                                size="sm"
                                className="w-full border-dashed"
                              >
                                <Plus className="h-4 w-4 mr-2" />
                                Add Club
                              </Button>
                            </div>
                          </div>

                          {/* Highlights Section */}
                          <div className="space-y-2">
                            <Label>Highlights</Label>
                            <div className="space-y-3">
                              {(edu.highlights || []).map((highlight, hIdx) => (
                                <div
                                  key={hIdx}
                                  className="flex gap-2 items-start p-2 rounded-lg border"
                                >
                                  <Input
                                    value={highlight || ""}
                                    onChange={(e) => {
                                      const updated = [...(data.education || [])];
                                      updated[eduIndex].highlights[hIdx] =
                                        e.target.value;
                                      onChange({ ...data, education: updated });
                                    }}
                                    placeholder="e.g. Dean's List, Best Project Award"
                                  />
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => {
                                      const updated = [...(data.education || [])];
                                      updated[eduIndex].highlights = (
                                        edu.highlights || []
                                      ).filter((_, i) => i !== hIdx);
                                      onChange({ ...data, education: updated });
                                    }}
                                    className="h-10 w-10 text-destructive flex-shrink-0"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              ))}
                              <Button
                                onClick={() => {
                                  const updated = [...(data.education || [])];
                                  updated[eduIndex].highlights = [
                                    ...(edu.highlights || []),
                                    "",
                                  ];
                                  onChange({ ...data, education: updated });
                                }}
                                variant="outline"
                                size="sm"
                                className="w-full border-dashed"
                              >
                                <Plus className="h-4 w-4 mr-2" />
                                Add Highlight
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
              <p className="text-sm text-muted-foreground text-center py-8">
                No education added yet. Click "Add Education" to get started.
              </p>
            )}

            {/* Goals Section - Moved outside education entries */}
            <div className="space-y-2 pt-4 border-t">
              <Label>Academic & Career Goals</Label>
              <div className="space-y-3">
                {(data.goals_and_careers || []).map((goalItem, idx) => (
                  <div
                    key={idx}
                    className="space-y-2 p-3 rounded-lg border"
                  >
                    <div className="flex justify-between items-center mb-2">
                      <Label className="text-sm font-medium">
                        {goalItem.goal || "Untitled Goal"}
                      </Label>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeGoal(idx)}
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label className="text-xs">Goal</Label>
                        <Input
                          value={goalItem.goal || ""}
                          onChange={(e) =>
                            updateGoal(idx, "goal", e.target.value)
                          }
                          placeholder="e.g. Land ML internship"
                          size="sm"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Target</Label>
                        <Input
                          value={goalItem.target || ""}
                          onChange={(e) =>
                            updateGoal(idx, "target", e.target.value)
                          }
                          placeholder="e.g. Build a portfolio project"
                          size="sm"
                        />
                      </div>
                    </div>
                  </div>
                ))}
                <Button
                  onClick={addGoal}
                  variant="outline"
                  size="sm"
                  className="w-full border-dashed"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Goal
                </Button>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Work Experience */}
      <Card>
        <CardHeader className="sticky top-[60px] z-10 rounded-t-lg border-b bg-card">
          <div
            className="flex items-center justify-between cursor-pointer hover:bg-muted/50 transition-colors rounded-t-lg -m-6 p-6"
            onClick={() => toggleSection("workExp")}
          >
            <div className="flex items-center gap-2">
              <ChevronDown
                className={`h-5 w-5 transition-transform ${
                  collapsedSections.workExp ? "-rotate-90" : ""
                }`}
              />
              <div>
                <CardTitle className="flex items-center gap-2">
                  Work Experience
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      openInfo("work");
                    }}
                  >
                    <Info className="h-4 w-4" />
                  </Button>
                </CardTitle>
                <CardDescription>Your professional experience</CardDescription>
              </div>
            </div>
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setCollapsedSections((prev) => ({ ...prev, workExp: false }));
                const newIndex = (data.work_experience || []).length;
                update("work_experience", [
                  ...(data.work_experience || []),
                  {
                    role: "",
                    company: "",
                    type: "",
                    period: "",
                    highlights: [],
                  },
                ]);
                setExpandedWorkExp((prev) => ({ ...prev, [newIndex]: true }));
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Experience
            </Button>
          </div>
        </CardHeader>
        {!collapsedSections.workExp && (
          <CardContent className="space-y-4">
            {data.work_experience && data.work_experience.length > 0 && (
              <div>
                {data.work_experience.map((exp, idx) => {
                  const isExpanded = expandedWorkExp[idx];
                  const highlightsCount = (exp.highlights || []).length;
                  return (
                    <div
                      key={idx}
                      className="border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors"
                    >
                      {/* Collapsed Header */}
                      <div
                        className="flex items-center gap-2 p-3 cursor-pointer"
                        onClick={() => toggleWorkExp(idx)}
                      >
                        <ChevronDown
                          className={`h-4 w-4 transition-transform text-muted-foreground ${
                            isExpanded ? "" : "-rotate-90"
                          }`}
                        />
                        <div className="flex-1 flex items-center gap-2 min-w-0">
                          <span className="font-medium truncate">
                            {[exp.role, exp.company].filter(Boolean).join(" — ") ||
                              "Untitled experience"}
                          </span>
                          <div className="hidden sm:flex gap-1.5 items-center flex-shrink-0">
                            {exp.period && (
                              <Badge variant="secondary" className="h-5 text-xs">
                                {exp.period}
                              </Badge>
                            )}
                            {highlightsCount > 0 && (
                              <Badge variant="secondary" className="h-5 text-xs">
                                {highlightsCount} highlights
                              </Badge>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            update(
                              "work_experience",
                              data.work_experience.filter((_, i) => i !== idx)
                            );
                          }}
                          className="h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      {/* Expanded Form */}
                      {isExpanded && (
                        <div className="space-y-3 p-3 pt-0">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-2">
                              <Label>Role</Label>
                              <Input
                                value={exp.role || ""}
                                onChange={(e) => {
                                  const updated = [...data.work_experience];
                                  updated[idx].role = e.target.value;
                                  update("work_experience", updated);
                                }}
                                placeholder="e.g. Software Engineer"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Company</Label>
                              <Input
                                value={exp.company || ""}
                                onChange={(e) => {
                                  const updated = [...data.work_experience];
                                  updated[idx].company = e.target.value;
                                  update("work_experience", updated);
                                }}
                                placeholder="e.g. TechCorp"
                              />
                            </div>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-2">
                              <Label>Type</Label>
                              <Input
                                value={exp.type || ""}
                                onChange={(e) => {
                                  const updated = [...data.work_experience];
                                  updated[idx].type = e.target.value;
                                  update("work_experience", updated);
                                }}
                                placeholder="e.g. Full-time"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Period</Label>
                              <Input
                                value={exp.period || ""}
                                onChange={(e) => {
                                  const updated = [...data.work_experience];
                                  updated[idx].period = e.target.value;
                                  update("work_experience", updated);
                                }}
                                placeholder="e.g. Jan 2022 - Jun 2023"
                              />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label>Highlights</Label>
                            <div className="space-y-3">
                              {(exp.highlights || []).map((highlight, hIdx) => (
                                <div
                                  key={hIdx}
                                  className="flex gap-2 items-start p-2 rounded-lg border"
                                >
                                  <Input
                                    value={highlight || ""}
                                    onChange={(e) => {
                                      const updated = [...data.work_experience];
                                      updated[idx].highlights[hIdx] =
                                        e.target.value;
                                      update("work_experience", updated);
                                    }}
                                    placeholder="e.g. Led team of 5 engineers"
                                  />
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => {
                                      const updated = [...data.work_experience];
                                      updated[idx].highlights = (
                                        exp.highlights || []
                                      ).filter((_, i) => i !== hIdx);
                                      update("work_experience", updated);
                                    }}
                                    className="h-10 w-10 text-destructive flex-shrink-0"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              ))}
                              <Button
                                onClick={() => {
                                  const updated = [...data.work_experience];
                                  updated[idx].highlights = [
                                    ...(exp.highlights || []),
                                    "",
                                  ];
                                  update("work_experience", updated);
                                }}
                                variant="outline"
                                size="sm"
                                className="w-full border-dashed"
                              >
                                <Plus className="h-4 w-4 mr-2" />
                                Add Highlight
                              </Button>
                            </div>
                          </div>
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

      {/* Contact Information */}
      <Card>
        <CardHeader className="sticky top-[60px] z-10 rounded-t-lg border-b bg-card">
          <div
            className="flex items-center justify-between cursor-pointer hover:bg-muted/50 transition-colors rounded-t-lg -m-6 p-6"
            onClick={() => toggleSection("contact")}
          >
            <div className="flex items-center gap-2">
              <ChevronDown
                className={`h-5 w-5 transition-transform ${
                  collapsedSections.contact ? "-rotate-90" : ""
                }`}
              />
              <div>
                <CardTitle className="flex items-center gap-2">
                  Contact & Links
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      openInfo("contact");
                    }}
                  >
                    <Info className="h-4 w-4" />
                  </Button>
                </CardTitle>
                <CardDescription>
                  How to reach you and your online presence
                </CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>
        {!collapsedSections.contact && (
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Emails</Label>
              <div className="space-y-3">
                {(data.contact?.emails || []).map((email, index) => (
                  <div
                    key={index}
                    className="p-3 rounded-lg border"
                  >
                    <div className="flex gap-3">
                      <div className="grid gap-3 sm:grid-cols-2 flex-1">
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">
                            Address
                          </Label>
                          <Input
                            type="email"
                            value={email?.address || ""}
                            onChange={(e) =>
                              updateEmail(index, "address", e.target.value)
                            }
                            placeholder="you@school.edu"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">
                            Purpose
                          </Label>
                          <Select
                            value={email?.purpose || "primary"}
                            onValueChange={(value) =>
                              updateEmail(index, "purpose", value)
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="primary">Primary</SelectItem>
                              <SelectItem value="general">General</SelectItem>
                              <SelectItem value="school">School</SelectItem>
                              <SelectItem value="personal">Personal</SelectItem>
                              <SelectItem value="work">Work</SelectItem>
                              <SelectItem value="recruiting">
                                Recruiting
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeEmail(index)}
                        className="h-7 w-7 text-muted-foreground hover:text-destructive mt-1"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                <Button
                  onClick={addEmail}
                  variant="outline"
                  size="sm"
                  className="w-full border-dashed"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Email
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Profile Links</Label>
              <div className="space-y-3">
                {(data.contact?.links || []).map((link, index) => (
                  <div
                    key={index}
                    className="p-3 rounded-lg border"
                  >
                    <div className="flex gap-3">
                      <div className="grid gap-3 sm:grid-cols-2 flex-1">
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">
                            Label
                          </Label>
                          <Input
                            value={link?.label || ""}
                            onChange={(e) =>
                              updateLink(index, "label", e.target.value)
                            }
                            placeholder="e.g. Portfolio"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">
                            URL
                          </Label>
                          <Input
                            value={link?.url || ""}
                            onChange={(e) =>
                              updateLink(index, "url", e.target.value)
                            }
                            placeholder="https://example.com"
                          />
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeLink(index)}
                        className="h-7 w-7 text-muted-foreground hover:text-destructive mt-1"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                <Button
                  onClick={addLink}
                  variant="outline"
                  size="sm"
                  className="w-full border-dashed"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Link
                </Button>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Languages */}
      <Card>
        <CardHeader className="sticky top-[60px] z-10 rounded-t-lg border-b bg-card">
          <div
            className="flex items-center justify-between cursor-pointer hover:bg-muted/50 transition-colors rounded-t-lg -m-6 p-6"
            onClick={() => toggleSection("languages")}
          >
            <div className="flex items-center gap-2">
              <ChevronDown
                className={`h-5 w-5 transition-transform ${
                  collapsedSections.languages ? "-rotate-90" : ""
                }`}
              />
              <div>
                <CardTitle className="flex items-center gap-2">
                  Languages
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      openInfo("languages");
                    }}
                  >
                    <Info className="h-4 w-4" />
                  </Button>
                </CardTitle>
                <CardDescription>
                  Languages you speak and your fluency level
                </CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>
        {!collapsedSections.languages && (
          <CardContent>
            <div className="space-y-2">
              <Label>Languages & Fluency</Label>
              <div className="space-y-3">
                {(data.languages_spoken || []).map((lang, index) => (
                  <div
                    key={index}
                    className="p-3 rounded-lg border space-y-3"
                  >
                    <div className="flex gap-3">
                      <div className="grid gap-3 sm:grid-cols-2 flex-1">
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">
                            Language
                          </Label>
                          <Input
                            value={lang?.name || ""}
                            onChange={(e) =>
                              updateLanguage(index, "name", e.target.value)
                            }
                            placeholder="e.g. English"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">
                            Fluency
                          </Label>
                          <Select
                            value={lang?.fluency || "conversational"}
                            onValueChange={(value) =>
                              updateLanguage(index, "fluency", value)
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="beginner">Beginner</SelectItem>
                              <SelectItem value="conversational">
                                Conversational
                              </SelectItem>
                              <SelectItem value="fluent">Fluent</SelectItem>
                              <SelectItem value="native">Native</SelectItem>
                              <SelectItem value="professional">
                                Professional
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeLanguage(index)}
                        className="h-7 w-7 text-muted-foreground hover:text-destructive mt-1"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                <Button
                  onClick={addLanguage}
                  variant="outline"
                  size="sm"
                  className="w-full border-dashed"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Language
                </Button>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Info Modal */}
      <Dialog
        open={infoModal.isOpen}
        onOpenChange={(open) =>
          setInfoModal((prev) => ({ ...prev, isOpen: open }))
        }
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="h-5 w-5 text-primary" />
              {infoModal.title}
            </DialogTitle>
            <DialogDescription>{infoModal.overview}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm max-h-[60vh] overflow-y-auto">
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
          </div>
          <DialogFooter>
            <Button
              onClick={() =>
                setInfoModal((prev) => ({ ...prev, isOpen: false }))
              }
            >
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Knowledge Editor
function KnowledgeEditor({ data, onChange, onShowConfirmation }) {
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
        <CardHeader className="sticky top-[60px] z-10 rounded-t-lg border-b bg-card">
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
                    className="h-6 w-6 text-muted-foreground hover:text-primary"
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
              Add Skill
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
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
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
                                className="h-8"
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
                                <SelectTrigger className="h-8">
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
                                        className="h-6 w-6"
                                      >
                                        <X className="h-3 w-3" />
                                      </Button>
                                    </div>
                                    {isRefExpanded && (
                                      <div className="border-t p-2 space-y-2">
                                        <div className="grid grid-cols-2 gap-2">
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
                                            className="h-7 text-xs"
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
                                            className="h-7 text-xs"
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
                                className="w-full border-dashed text-xs h-7"
                              >
                                <Plus className="h-3 w-3 mr-1" />
                                Add Reference
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
              <div className="px-4 py-8 text-center text-muted-foreground text-sm border rounded-lg">
                {searchTerm || filterLevel !== "all"
                  ? "No skills match your filters."
                  : "No skills yet. Add one to get started."}
              </div>
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
        <CardHeader className="sticky top-[60px] z-10 rounded-t-lg border-b bg-card">
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
                    className="h-6 w-6 text-muted-foreground hover:text-primary"
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
              Add Tab
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
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
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
                              className="h-8"
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
                                        className="h-6 w-6"
                                      >
                                        <X className="h-3 w-3" />
                                      </Button>
                                    </div>
                                    {isRefExpanded && (
                                      <div className="border-t p-2 space-y-2">
                                        <div className="grid grid-cols-2 gap-2">
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
                                            className="h-7 text-xs"
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
                                            className="h-7 text-xs"
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
                                className="w-full border-dashed text-xs h-7"
                              >
                                <Plus className="h-3 w-3 mr-1" />
                                Add Reference
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
              <div className="px-4 py-8 text-center text-muted-foreground text-sm border rounded-lg">
                {tabSearchTerm
                  ? "No tabs match your search."
                  : "No mental tabs yet. Add one to save random knowledge."}
              </div>
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
      <Dialog
        open={infoModal.isOpen}
        onOpenChange={(open) =>
          setInfoModal((prev) => ({ ...prev, isOpen: open }))
        }
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="h-5 w-5 text-primary" />
              {infoModal.title}
            </DialogTitle>
            <DialogDescription>{infoModal.overview}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm max-h-[60vh] overflow-y-auto">
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
          </div>
          <DialogFooter>
            <Button
              onClick={() =>
                setInfoModal((prev) => ({ ...prev, isOpen: false }))
              }
            >
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Preferences Editor
function PreferencesEditor({ data, onChange }) {
  const [expandedMoods, setExpandedMoods] = useState({});

  const updateCodeStyle = (field, value) =>
    onChange({
      ...data,
      code_style: { ...(data.code_style || {}), [field]: value },
    });

  // Helper to get communication with migration from old format
  const getComm = () => {
    const comm = data.communication || {};
    // Migrate old flat format to new nested format
    if (comm.tone !== undefined && !comm.default) {
      return {
        default: {
          tone: comm.tone || "",
          detail_level: comm.detail_level || "",
          locale: comm.locale || "British English",
        },
        mood_overrides: [],
      };
    }
    return {
      default: comm.default || {
        tone: "",
        detail_level: "",
        locale: "British English",
      },
      mood_overrides: comm.mood_overrides || [],
    };
  };

  const updateDefaultComm = (field, value) => {
    const comm = getComm();
    onChange({
      ...data,
      communication: {
        ...comm,
        default: { ...comm.default, [field]: value },
      },
    });
  };

  const addMoodOverride = () => {
    const comm = getComm();
    const newOverrides = [
      ...comm.mood_overrides,
      { when_feeling: "", tone: "", detail_level: "", locale: "" },
    ];
    onChange({
      ...data,
      communication: { ...comm, mood_overrides: newOverrides },
    });
    // Auto-expand the new one
    setExpandedMoods((prev) => ({ ...prev, [newOverrides.length - 1]: true }));
  };

  const updateMoodOverride = (index, field, value) => {
    const comm = getComm();
    const newOverrides = [...comm.mood_overrides];
    newOverrides[index] = { ...newOverrides[index], [field]: value };
    onChange({
      ...data,
      communication: { ...comm, mood_overrides: newOverrides },
    });
  };

  const removeMoodOverride = (index) => {
    const comm = getComm();
    onChange({
      ...data,
      communication: {
        ...comm,
        mood_overrides: comm.mood_overrides.filter((_, i) => i !== index),
      },
    });
  };

  const toggleMood = (index) => {
    setExpandedMoods((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const updateLearning = (field, value) =>
    onChange({
      ...data,
      learning_style: { ...(data.learning_style || {}), [field]: value },
    });

  const comm = getComm();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="sticky top-[60px] z-10 rounded-t-lg border-b bg-card">
          <CardTitle>Code Style</CardTitle>
          <CardDescription>
            Your preferred programming languages, frameworks, and tools
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Preferred Languages</Label>
            <ArrayInput
              items={data.code_style?.preferred_languages || []}
              onChange={(items) =>
                updateCodeStyle("preferred_languages", items)
              }
              placeholder="e.g. Python, TypeScript..."
            />
          </div>
          <div className="space-y-2">
            <Label>Frameworks</Label>
            <ArrayInput
              items={data.code_style?.frameworks || []}
              onChange={(items) => updateCodeStyle("frameworks", items)}
              placeholder="e.g. FastAPI, Next.js..."
            />
          </div>
          <div className="space-y-2">
            <Label>Tools</Label>
            <ArrayInput
              items={data.code_style?.tools || []}
              onChange={(items) => updateCodeStyle("tools", items)}
              placeholder="e.g. VS Code, Docker..."
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="sticky top-[60px] z-10 rounded-t-lg border-b bg-card">
          <CardTitle>Communication</CardTitle>
          <CardDescription>
            How you prefer AI responses to be formatted
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Default Communication Style */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Label className="text-sm font-medium">Default Style</Label>
              <Badge variant="secondary" className="text-xs">
                Always active
              </Badge>
            </div>
            <div className="p-4 border rounded-lg space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Tone</Label>
                  <Input
                    value={comm.default.tone || ""}
                    onChange={(e) => updateDefaultComm("tone", e.target.value)}
                    placeholder="e.g. friendly but professional"
                    className="h-8"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Locale
                  </Label>
                  <Input
                    value={comm.default.locale || ""}
                    onChange={(e) =>
                      updateDefaultComm("locale", e.target.value)
                    }
                    placeholder="e.g. British English"
                    className="h-8"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Detail Level
                </Label>
                <Textarea
                  value={comm.default.detail_level || ""}
                  onChange={(e) =>
                    updateDefaultComm("detail_level", e.target.value)
                  }
                  placeholder="e.g. comprehensive with examples, step-by-step breakdowns when explaining code..."
                  className="min-h-[60px] resize-none text-sm"
                />
              </div>
            </div>
          </div>

          {/* Mood Overrides */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">
                  When I'm feeling...
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Override defaults based on your mood or context
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={addMoodOverride}>
                <Plus className="h-4 w-4 mr-1" />
                Add Mood
              </Button>
            </div>

            {comm.mood_overrides.length > 0 ? (
              <div className="space-y-2">
                {comm.mood_overrides.map((mood, idx) => (
                  <div
                    key={idx}
                    className={`border rounded-lg overflow-hidden transition-colors ${
                      expandedMoods[idx] ? "ring-1 ring-primary/30" : ""
                    }`}
                  >
                    <div
                      className="flex items-center gap-2 p-3 hover:bg-muted/40 cursor-pointer"
                      onClick={() => toggleMood(idx)}
                    >
                      <ChevronDown
                        className={`h-4 w-4 transition-transform text-muted-foreground ${
                          expandedMoods[idx] ? "" : "-rotate-90"
                        }`}
                      />
                      <span className="flex-1 font-medium text-sm">
                        {mood.when_feeling || "Untitled mood"}
                      </span>
                      {mood.tone && (
                        <Badge variant="secondary" className="text-xs h-5">
                          {mood.tone}
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeMoodOverride(idx);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    {expandedMoods[idx] && (
                      <div className="p-4 border-t bg-background/50 space-y-4">
                        <div className="space-y-2">
                          <Label className="text-xs">When I'm feeling...</Label>
                          <Input
                            value={mood.when_feeling || ""}
                            onChange={(e) =>
                              updateMoodOverride(
                                idx,
                                "when_feeling",
                                e.target.value
                              )
                            }
                            placeholder="e.g. stressed, tired, excited, creative"
                            className="h-8"
                          />
                        </div>
                        <div className="space-y-4">
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground">
                                Tone
                              </Label>
                              <Input
                                value={mood.tone || ""}
                                onChange={(e) =>
                                  updateMoodOverride(
                                    idx,
                                    "tone",
                                    e.target.value
                                  )
                                }
                                placeholder="e.g. gentle, encouraging"
                                className="h-8"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground">
                                Locale
                              </Label>
                              <Input
                                value={mood.locale || ""}
                                onChange={(e) =>
                                  updateMoodOverride(
                                    idx,
                                    "locale",
                                    e.target.value
                                  )
                                }
                                placeholder="Leave blank to use default"
                                className="h-8"
                              />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground">
                              Detail Level
                            </Label>
                            <Textarea
                              value={mood.detail_level || ""}
                              onChange={(e) =>
                                updateMoodOverride(
                                  idx,
                                  "detail_level",
                                  e.target.value
                                )
                              }
                              placeholder="e.g. brief and to the point, skip the explanations..."
                              className="min-h-[60px] resize-none text-sm"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 border rounded-lg text-muted-foreground text-sm">
                No mood overrides yet. Add one to customize how AI responds
                based on how you're feeling.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="sticky top-[60px] z-10 rounded-t-lg border-b bg-card">
          <CardTitle>Learning Style</CardTitle>
          <CardDescription>How you learn best</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Preferred Methods</Label>
            <ArrayInput
              items={data.learning_style?.preferred || []}
              onChange={(items) => updateLearning("preferred", items)}
              placeholder="e.g. hands-on examples..."
            />
          </div>
          <div className="space-y-2">
            <Label>Things to Avoid</Label>
            <ArrayInput
              items={data.learning_style?.avoid || []}
              onChange={(items) => updateLearning("avoid", items)}
              placeholder="e.g. walls of text..."
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="sticky top-[60px] z-10 rounded-t-lg border-b bg-card">
          <CardTitle>Dislikes & Deal-breakers</CardTitle>
          <CardDescription>
            Things you do not want in responses or suggestions
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label>List your dislikes or hard nos</Label>
          <ArrayInput
            items={data.dislikes || []}
            onChange={(items) => onChange({ ...data, dislikes: items })}
            placeholder="e.g. unsolicited sales tone, lorem ipsum, jargon..."
          />
        </CardContent>
      </Card>
    </div>
  );
}

// Projects Editor
function ProjectsEditor({ data, onChange, onShowConfirmation }) {
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
        <CardHeader className="sticky top-[60px] z-10 rounded-t-lg border-b bg-card">
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
                    className="h-6 w-6 text-muted-foreground hover:text-primary"
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
              Add Idea
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
                                className="h-8 text-sm font-medium"
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
                          className="h-7 w-7 text-muted-foreground hover:text-destructive flex-shrink-0"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="px-4 py-8 text-center text-muted-foreground text-sm border rounded-lg">
                No ideas yet. Click &quot;Add Idea&quot; to get started.
              </div>
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
              Add Idea
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader className="sticky top-[60px] z-10 rounded-t-lg border-b bg-card">
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
                      className="h-6 w-6 text-muted-foreground hover:text-primary"
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
              Add Project
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
                    className="h-8"
                  />
                </div>
                <div className="min-w-[150px] space-y-1.5">
                  <Label htmlFor="project-status" className="text-xs">
                    Status
                  </Label>
                  <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger id="project-status" className="h-8">
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
                    className="h-8"
                  >
                    Clear Filters
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
                          className="h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
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
                                className="h-8 bg-background"
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
                                <SelectTrigger className="h-8 bg-background">
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
                                            project.references || []
                                          ).filter((_, i) => i !== refIdx);
                                          updateProject(
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
                                            className="h-8 text-sm bg-background"
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
                                            className="h-8 text-sm bg-background"
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
                                <Plus className="h-4 w-4 mr-2" />
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
                                      className="h-10 w-10 text-destructive flex-shrink-0"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                )
                              )}
                              <Button
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
                                className="w-full border-dashed"
                              >
                                <Plus className="h-4 w-4 mr-2" />
                                Add Highlight
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
              <p className="text-sm text-muted-foreground text-center py-8">
                {hasActiveFilters
                  ? "No projects match your search"
                  : "No projects added yet"}
              </p>
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
              Add Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Info Modal */}
      <Dialog
        open={infoModal.isOpen}
        onOpenChange={(open) =>
          setInfoModal((prev) => ({ ...prev, isOpen: open }))
        }
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="h-5 w-5 text-primary" />
              {infoModal.title}
            </DialogTitle>
            <DialogDescription>{infoModal.overview}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm max-h-[60vh] overflow-y-auto">
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
          </div>
          <DialogFooter>
            <Button
              onClick={() =>
                setInfoModal((prev) => ({ ...prev, isOpen: false }))
              }
            >
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Lifestyle Editor
function LifestyleEditor({ data, onChange, onShowConfirmation }) {
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
              <p className="text-sm text-muted-foreground text-center py-8">
                {hasActiveFilters
                  ? "No hobbies match your filters"
                  : "No hobbies added yet"}
              </p>
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
      <Dialog
        open={infoModal.isOpen}
        onOpenChange={(open) =>
          setInfoModal((prev) => ({ ...prev, isOpen: open }))
        }
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="h-5 w-5 text-primary" />
              {infoModal.title}
            </DialogTitle>
            <DialogDescription>{infoModal.overview}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm max-h-[60vh] overflow-y-auto">
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
          </div>
          <DialogFooter>
            <Button
              onClick={() =>
                setInfoModal((prev) => ({ ...prev, isOpen: false }))
              }
            >
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Circle Editor
function CircleEditor({ data, onChange, onShowConfirmation }) {
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
        }
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
        trait.toLowerCase().includes(searchLower)
      );
      return matchesName || matchesRelationship || matchesTrait;
    }
  );

  const hasActiveFilters = searchTerm;

  const clearFilters = () => {
    setSearchTerm("");
  };

  return (
    <div className="space-y-6">
      {/* Connections Section */}
      <Card>
        <CardHeader className="sticky top-[60px] z-10 rounded-t-lg border-b bg-card">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                Connections
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-primary"
                  onClick={() => openInfo("connections")}
                >
                  <Info className="h-4 w-4" />
                </Button>
              </CardTitle>
              <CardDescription>
                People who matter in your life and your relationships with them
              </CardDescription>
            </div>
            <Button onClick={() => setIsAddModalOpen(true)} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Connection
            </Button>
          </div>
        </CardHeader>
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
                  className="h-8"
                />
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

          {/* Connections List */}
          {filteredConnections.length > 0 ? (
            <div>
              {filteredConnections.map((connection, idx) => {
                const originalIndex = (data.connections || []).indexOf(
                  connection
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
                        className="h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
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
                                    e.target.value
                                  )
                                }
                                placeholder="Person's name"
                                className="h-8 bg-background"
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
                                    e.target.value
                                  )
                                }
                                placeholder="e.g. Friend from university"
                                className="h-8 bg-background"
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
                                    items
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
                                  e.target.value
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
            <p className="text-sm text-muted-foreground text-center py-8">
              {hasActiveFilters
                ? "No connections match your search"
                : "No connections added yet"}
            </p>
          )}
        </CardContent>
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
              Add Connection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Info Modal */}
      <Dialog
        open={infoModal.isOpen}
        onOpenChange={(open) =>
          setInfoModal((prev) => ({ ...prev, isOpen: open }))
        }
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="h-5 w-5 text-primary" />
              {infoModal.title}
            </DialogTitle>
            <DialogDescription>{infoModal.overview}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm max-h-[60vh] overflow-y-auto">
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
          </div>
          <DialogFooter>
            <Button
              onClick={() =>
                setInfoModal((prev) => ({ ...prev, isOpen: false }))
              }
            >
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Learning Log Editor
function LearningLogEditor({ data, onChange, onShowConfirmation }) {
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
        doRemove
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
      (entries[b].timestamp || "").localeCompare(entries[a].timestamp || "")
    );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="sticky top-[60px] z-10 rounded-t-lg border-b bg-card">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Learning Log</CardTitle>
              <CardDescription>
                Things you've learned, decisions you've made, and follow-ups —
                captured from conversations or added here.
              </CardDescription>
            </div>
            <Button size="sm" onClick={addEntry}>
              Add entry
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            placeholder="Search topic, details, or tags..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />

          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No learning entries yet. Click "Add Entry" to get started.
            </p>
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
                              <Badge variant="outline" className="h-5 text-xs">
                                {entry.source}
                              </Badge>
                            )}
                            {tagCount > 0 && (
                              <Badge variant="secondary" className="h-5 text-xs">
                                {tagCount} tags
                              </Badge>
                            )}
                            {followupCount > 0 && (
                              <Badge variant="secondary" className="h-5 text-xs">
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
                          className="h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      {/* Expanded Form */}
                      {isExpanded && (
                        <div className="space-y-3 p-3 pt-0">
                          <div className="space-y-2">
                            <Label>Topic</Label>
                            <Input
                              value={entry.topic || ""}
                              onChange={(e) =>
                                updateEntry(idx, "topic", e.target.value)
                              }
                              placeholder="e.g. React Server Components"
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

          <Button
            onClick={addEntry}
            variant="outline"
            className="w-full border-dashed"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Entry
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

const SECTION_LABELS = {
  knowledge: "Knowledge",
  projects: "Projects",
  lifestyle: "Lifestyle",
  circle: "Circle",
};

const SECTION_DESCRIPTIONS = {
  knowledge: "Domains you know and topics you track",
  projects: "Active work and current learning",
  lifestyle: "Hobbies, values, and routines",
  circle: "People and relationships",
};

// Welcome / sign-in form: username + password, with a "Create account"
// toggle. Lives on the first-run welcome screen (see the `error &&
// !getAuthToken()` branch below). On success it saves the config and hands
// control back to the caller (which reloads app data).
function WelcomeAuth({ onUseToken, onSuccess }) {
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState(null);
  const [showServer, setShowServer] = useState(false);
  const [connectionType, setConnectionType] = useState("cloud"); // "cloud" | "self-hosted"
  const [selfHostedUrl, setSelfHostedUrl] = useState("");

  const serverUrl =
    connectionType === "cloud" ? CLOUD_API_URL : selfHostedUrl.trim();

  const switchMode = (next) => {
    setMode(next);
    setFormError(null);
    setPassword("");
    setConfirmPassword("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);

    if (!username.trim() || !password) {
      setFormError("Enter a username and password.");
      return;
    }
    if (connectionType === "self-hosted" && !selfHostedUrl.trim()) {
      setFormError("Server URL is required.");
      return;
    }
    if (mode === "signup") {
      if (password.length < 8) {
        setFormError("Password must be at least 8 characters.");
        return;
      }
      if (password !== confirmPassword) {
        setFormError("Passwords do not match.");
        return;
      }
    }

    setPending(true);
    try {
      const result =
        mode === "signup"
          ? await registerAccount(serverUrl, username.trim(), password)
          : await loginAccount(serverUrl, username.trim(), password);
      saveConfig({ serverUrl, token: result.token });
      onSuccess();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="w-full space-y-4 text-left">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="welcome-username" className="text-xs font-medium">
            Username
          </Label>
          <Input
            id="welcome-username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="yourname"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="welcome-password" className="text-xs font-medium">
            Password
          </Label>
          <Input
            id="welcome-password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
          />
        </div>
        {mode === "signup" && (
          <div className="space-y-1.5">
            <Label htmlFor="welcome-confirm-password" className="text-xs font-medium">
              Confirm password
            </Label>
            <Input
              id="welcome-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
            />
          </div>
        )}

        {showServer && (
          <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-left">
            <Label className="text-xs font-medium">Server</Label>
            <div className="flex rounded-lg bg-muted p-0.5">
              <button
                type="button"
                onClick={() => setConnectionType("cloud")}
                className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  connectionType === "cloud"
                    ? "border bg-card text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Globe className="h-4 w-4" />
                Cloud
              </button>
              <button
                type="button"
                onClick={() => setConnectionType("self-hosted")}
                className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  connectionType === "self-hosted"
                    ? "border bg-card text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Server className="h-4 w-4" />
                Self-hosted
              </button>
            </div>
            {connectionType === "self-hosted" && (
              <Input
                placeholder="https://your-mygist-server.com/api"
                value={selfHostedUrl}
                onChange={(e) => setSelfHostedUrl(e.target.value)}
              />
            )}
          </div>
        )}

        {formError && <p className="text-xs text-destructive">{formError}</p>}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : mode === "signup" ? (
            "Create account"
          ) : (
            "Sign in"
          )}
        </Button>
      </form>

      <p className="text-center text-xs text-muted-foreground">
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className="underline hover:text-foreground"
            >
              Sign in
            </button>
          </>
        ) : (
          <>
            New to MyGist?{" "}
            <button
              type="button"
              onClick={() => switchMode("signup")}
              className="underline hover:text-foreground"
            >
              Create an account
            </button>
          </>
        )}
      </p>

      <div className="flex items-center justify-center gap-3 border-t pt-3 text-xs text-muted-foreground">
        <button
          type="button"
          onClick={onUseToken}
          className="underline hover:text-foreground"
        >
          Use an access token instead
        </button>
        <span aria-hidden="true">&middot;</span>
        <button
          type="button"
          onClick={() => setShowServer((v) => !v)}
          className="underline hover:text-foreground"
        >
          Server: {connectionType === "cloud" ? "Cloud" : "Self-hosted"}
        </button>
      </div>
    </div>
  );
}

// Main App
export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const [lastSaved, setLastSaved] = useState(null);
  const [isAutosaveEnabled, setIsAutosaveEnabled] = useState(true);
  const [showConnectionSettings, setShowConnectionSettings] = useState(false);

  // Theme: "light" | "dark" | "system" (system follows the OS live)
  const [theme, setTheme] = useState(
    () => localStorage.getItem("mygist_theme") || "system"
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && mq.matches);
      document.documentElement.classList.toggle("dark", dark);
    };
    apply();
    localStorage.setItem("mygist_theme", theme);
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
  const cycleTheme = () =>
    setTheme((t) => (t === "light" ? "dark" : t === "dark" ? "system" : "light"));
  const { toast } = useToast();

  const [profile, setProfile] = useState({});
  const [knowledge, setKnowledge] = useState({});
  const [preferences, setPreferences] = useState({});
  const [projects, setProjects] = useState({});
  const [lifestyle, setLifestyle] = useState({});
  const [circle, setCircle] = useState({});
  const [learningLog, setLearningLog] = useState({});

  const [disabledSections, setDisabledSections] = useState([]);
  const [toggleable, setToggleable] = useState([]);

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    title: "",
    description: "",
    action: null,
  });

  const showConfirmation = (title, description, action) => {
    setConfirmDialog({
      isOpen: true,
      title,
      description,
      action,
    });
  };

  const handleConfirm = () => {
    if (confirmDialog.action) {
      confirmDialog.action();
    }
    setConfirmDialog({ ...confirmDialog, isOpen: false });
  };

  const handleCancel = () => {
    setConfirmDialog({ ...confirmDialog, isOpen: false });
  };

  useEffect(() => {
    loadAllData();
    loadSettings();
  }, []);

  const loadAllData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api("/all");
      setProfile(response.data.profile || {});
      setKnowledge(response.data.knowledge || {});
      setPreferences(response.data.preferences || {});
      setProjects(response.data.projects || {});
      setLifestyle(response.data.lifestyle || {});
      setCircle(response.data.circle || {});
      setLearningLog(response.data.learning_log || {});
      setIsConnected(true);
    } catch (err) {
      setError(err.message);
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  };

  const loadSettings = async () => {
    try {
      const s = await api("/settings");
      setDisabledSections(s.disabled_sections || []);
      setToggleable(s.toggleable || []);
    } catch (_) {
      // non-fatal: default to all sections enabled
    }
  };

  const saveFile = async (fileType, data) => {
    setIsSaving(true);
    try {
      await api(`/files/${fileType}`, {
        method: "PUT",
        body: JSON.stringify({ data }),
      });
      setLastSaved(new Date());
      toast({ title: "Saved", variant: "success" });
    } catch (err) {
      toast({
        title: "Failed to save",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const debouncedSave = useDebounce(saveFile, 1500);

  const handleProfileChange = (newData) => {
    setProfile(newData);
    if (isAutosaveEnabled) debouncedSave("profile", newData);
  };
  const handleKnowledgeChange = (newData) => {
    setKnowledge(newData);
    if (isAutosaveEnabled) debouncedSave("knowledge", newData);
  };
  const handlePreferencesChange = (newData) => {
    setPreferences(newData);
    if (isAutosaveEnabled) debouncedSave("preferences", newData);
  };
  const handleProjectsChange = (newData) => {
    setProjects(newData);
    if (isAutosaveEnabled) debouncedSave("projects", newData);
  };
  const handleLifestyleChange = (newData) => {
    setLifestyle(newData);
    if (isAutosaveEnabled) debouncedSave("lifestyle", newData);
  };
  const handleCircleChange = (newData) => {
    setCircle(newData);
    if (isAutosaveEnabled) debouncedSave("circle", newData);
  };
  const handleLearningLogChange = (newData) => {
    setLearningLog(newData);
    if (isAutosaveEnabled) debouncedSave("learning_log", newData);
  };

  const saveAll = async () => {
    setIsSaving(true);
    try {
      await api("/all", {
        method: "PUT",
        body: JSON.stringify({
          profile,
          knowledge,
          preferences,
          projects,
          lifestyle,
          circle,
          learning_log: learningLog,
        }),
      });
      setLastSaved(new Date());
      toast({ title: "All files saved", variant: "success" });
    } catch (err) {
      toast({
        title: "Failed to save",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const toggleSection = async (key) => {
    const previous = disabledSections;
    const next = disabledSections.includes(key)
      ? disabledSections.filter((k) => k !== key)
      : [...disabledSections, key];
    setDisabledSections(next); // optimistic
    try {
      await api("/settings", {
        method: "PUT",
        body: JSON.stringify({ disabled_sections: next }),
      });
    } catch (err) {
      setDisabledSections(previous); // rollback
      toast({
        title: "Failed to update section settings",
        description: err.message,
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Connecting to backend...</p>
        </div>
      </div>
    );
  }

  // First run: no token configured yet. Welcome instead of an error.
  if (error && !getAuthToken()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <div className="flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary">
              <svg
                width="40"
                height="40"
                viewBox="0 0 96 96"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <circle
                  cx="45"
                  cy="40"
                  r="15"
                  fill="none"
                  stroke="#FFFFFF"
                  strokeWidth="9"
                />
                <path
                  d="M60 40 v22 a14 14 0 0 1 -14 14 h-9"
                  fill="none"
                  stroke="#FFFFFF"
                  strokeWidth="9"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">Welcome to MyGist</h1>
            <p className="text-sm text-muted-foreground">
              Your portable personal context for AI. Sign in or create an
              account to get started.
            </p>
          </div>
          <WelcomeAuth
            onUseToken={() => setShowConnectionSettings(true)}
            onSuccess={loadAllData}
          />
        </div>
        <ConnectionSettings
          isOpen={showConnectionSettings}
          onClose={() => setShowConnectionSettings(false)}
          onConnectionChange={loadAllData}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="text-destructive">
              Connection Failed
            </CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={loadAllData} className="w-full">
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry Connection
            </Button>
            <Button
              onClick={() => setShowConnectionSettings(true)}
              variant="outline"
              className="w-full"
            >
              <Settings className="h-4 w-4 mr-2" />
              Configure Server
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Connect to a remote server or run locally
            </p>
          </CardContent>
        </Card>
        <ConnectionSettings
          isOpen={showConnectionSettings}
          onClose={() => setShowConnectionSettings(false)}
          onConnectionChange={loadAllData}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b bg-card">
        <div className="mx-auto flex h-[60px] max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <svg
              width="22"
              height="22"
              viewBox="0 0 96 96"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <circle
                cx="45"
                cy="40"
                r="15"
                fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth="9"
              />
              <path
                d="M60 40 v22 a14 14 0 0 1 -14 14 h-9"
                fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth="9"
                strokeLinecap="round"
              />
            </svg>
            <h1 className="text-lg font-semibold">MyGist</h1>
          </div>
          <div className="flex items-center gap-4">
            {/* Auto-save toggle */}
            <button
              type="button"
              role="switch"
              aria-checked={isAutosaveEnabled}
              onClick={() => {
                const next = !isAutosaveEnabled;
                setIsAutosaveEnabled(next);
                if (next) saveAll();
              }}
              className="flex items-center gap-2"
            >
              <span
                className={`relative h-[18px] w-8 rounded-full transition-colors ${
                  isAutosaveEnabled ? "bg-primary" : "border bg-muted"
                }`}
              >
                <span
                  className={`absolute left-0 top-[2px] h-[14px] w-[14px] rounded-full border bg-card transition-transform ${
                    isAutosaveEnabled ? "translate-x-[16px]" : "translate-x-[2px]"
                  }`}
                />
              </span>
              <span className="text-xs font-medium text-muted-foreground">
                Auto-save
              </span>
            </button>
            {/* Save status */}
            <span className="hidden sm:inline text-xs text-muted-foreground">
              {isSaving
                ? "Saving..."
                : isAutosaveEnabled
                  ? lastSaved
                    ? "Saved just now"
                    : "Saved"
                  : "Unsaved changes"}
            </span>
            {!isAutosaveEnabled && (
              <Button size="sm" onClick={saveAll} disabled={isSaving}>
                Save changes
              </Button>
            )}
            {!isConnected && (
              <Badge variant="destructive" className="gap-1.5">
                <WifiOff className="h-3 w-3" />
                Disconnected
              </Badge>
            )}
            {/* Theme toggle: light -> dark -> system */}
            <button
              type="button"
              onClick={cycleTheme}
              aria-label={`Theme: ${theme}. Click to change.`}
              title={`Theme: ${theme}`}
              className="flex h-8 w-8 items-center justify-center rounded-lg border bg-card text-muted-foreground hover:text-foreground"
            >
              {theme === "light" ? (
                <Sun className="h-4 w-4" />
              ) : theme === "dark" ? (
                <Moon className="h-4 w-4" />
              ) : (
                <Monitor className="h-4 w-4" />
              )}
            </button>
            {/* Account chip */}
            <button
              type="button"
              onClick={() => setShowConnectionSettings(true)}
              className="flex items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-[13px] font-medium hover:bg-muted/50"
            >
              <User className="h-3.5 w-3.5 text-muted-foreground" />
              {profile?.preferred_name || profile?.name || "Account"}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8">
        <Tabs
          defaultValue="profile"
          orientation="vertical"
          className="flex flex-col gap-6 md:flex-row"
        >
          <div className="md:sticky md:top-[84px] md:w-48 md:self-start">
          <TabsList className="scrollbar-none w-full flex-nowrap overflow-x-auto md:flex-wrap md:overflow-visible md:h-fit md:flex-col md:items-stretch md:justify-start">
            <TabsTrigger value="profile" className="gap-2 rounded-full border md:w-full md:justify-start md:rounded-lg md:border-0 data-[state=active]:border-transparent">
              <User className="h-4 w-4" />
              <span>Profile</span>
            </TabsTrigger>
            {!disabledSections.includes("knowledge") && (
              <TabsTrigger value="knowledge" className="gap-2 rounded-full border md:w-full md:justify-start md:rounded-lg md:border-0 data-[state=active]:border-transparent">
                <Brain className="h-4 w-4" />
                <span>Knowledge</span>
              </TabsTrigger>
            )}
            {!disabledSections.includes("projects") && (
              <TabsTrigger value="projects" className="gap-2 rounded-full border md:w-full md:justify-start md:rounded-lg md:border-0 data-[state=active]:border-transparent">
                <FolderKanban className="h-4 w-4" />
                <span>Projects</span>
              </TabsTrigger>
            )}
            {!disabledSections.includes("lifestyle") && (
              <TabsTrigger value="lifestyle" className="gap-2 rounded-full border md:w-full md:justify-start md:rounded-lg md:border-0 data-[state=active]:border-transparent">
                <Heart className="h-4 w-4" />
                <span>Lifestyle</span>
              </TabsTrigger>
            )}
            {!disabledSections.includes("circle") && (
              <TabsTrigger value="circle" className="gap-2 rounded-full border md:w-full md:justify-start md:rounded-lg md:border-0 data-[state=active]:border-transparent">
                <Users className="h-4 w-4" />
                <span>Circle</span>
              </TabsTrigger>
            )}
            <TabsTrigger value="learning" className="gap-2 rounded-full border md:w-full md:justify-start md:rounded-lg md:border-0 data-[state=active]:border-transparent">
              <BookOpen className="h-4 w-4" />
              <span>Learning Log</span>
            </TabsTrigger>
            <TabsTrigger value="preferences" className="gap-2 rounded-full border md:w-full md:justify-start md:rounded-lg md:border-0 data-[state=active]:border-transparent">
              <Settings className="h-4 w-4" />
              <span>Preferences</span>
            </TabsTrigger>
            <TabsTrigger value="sections" className="gap-2 rounded-full border md:w-full md:justify-start md:rounded-lg md:border-0 data-[state=active]:border-transparent">
              <SlidersHorizontal className="h-4 w-4" />
              <span>Sections</span>
            </TabsTrigger>
          </TabsList>
          <p className="mt-4 hidden px-3 font-mono text-[11px] text-muted-foreground md:block">
            {`v${__APP_VERSION__} (${__APP_COMMIT__})`}
          </p>
          </div>

          <div className="min-w-0 flex-1">

          <TabsContent value="profile">
            <ProfileEditor
              data={profile}
              onChange={handleProfileChange}
              onShowConfirmation={showConfirmation}
            />
          </TabsContent>
          {!disabledSections.includes("knowledge") && (
            <TabsContent value="knowledge">
              <KnowledgeEditor
                data={knowledge}
                onChange={handleKnowledgeChange}
                onShowConfirmation={showConfirmation}
              />
            </TabsContent>
          )}
          {!disabledSections.includes("projects") && (
            <TabsContent value="projects">
              <ProjectsEditor
                data={projects}
                onChange={handleProjectsChange}
                onShowConfirmation={showConfirmation}
              />
            </TabsContent>
          )}
          {!disabledSections.includes("lifestyle") && (
            <TabsContent value="lifestyle">
              <LifestyleEditor
                data={lifestyle}
                onChange={handleLifestyleChange}
                onShowConfirmation={showConfirmation}
              />
            </TabsContent>
          )}
          {!disabledSections.includes("circle") && (
            <TabsContent value="circle">
              <CircleEditor
                data={circle}
                onChange={handleCircleChange}
                onShowConfirmation={showConfirmation}
              />
            </TabsContent>
          )}
          <TabsContent value="learning">
            <LearningLogEditor
              data={learningLog}
              onChange={handleLearningLogChange}
              onShowConfirmation={showConfirmation}
            />
          </TabsContent>
          <TabsContent value="preferences">
            <PreferencesEditor
              data={preferences}
              onChange={handlePreferencesChange}
            />
          </TabsContent>
          <TabsContent value="sections">
            <Card>
              <CardHeader className="sticky top-[60px] z-10 rounded-t-lg border-b bg-card">
                <CardTitle>Manage Sections</CardTitle>
                <CardDescription>
                  Turn optional sections on or off. Disabled sections are
                  hidden from the tab bar, but their data is preserved and
                  restored when re-enabled.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {toggleable.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No toggleable sections available.
                  </p>
                )}
                {toggleable.map((key) => {
                  const enabled = !disabledSections.includes(key);
                  return (
                    <div
                      key={key}
                      className="flex items-center justify-between border-b border-border py-4 last:border-b-0"
                    >
                      <div className="space-y-0.5">
                        <p className="text-sm font-medium">
                          {SECTION_LABELS[key] || key}
                        </p>
                        {SECTION_DESCRIPTIONS[key] && (
                          <p className="text-xs text-muted-foreground">
                            {SECTION_DESCRIPTIONS[key]}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        aria-label={`Toggle ${SECTION_LABELS[key] || key}`}
                        onClick={() => toggleSection(key)}
                        className={`relative h-5 w-9 rounded-full transition-colors ${
                          enabled ? "bg-primary" : "border bg-muted"
                        }`}
                      >
                        <span
                          className={`absolute left-0 top-[2px] h-4 w-4 rounded-full border bg-card transition-transform ${
                            enabled ? "translate-x-[18px]" : "translate-x-[2px]"
                          }`}
                        />
                      </button>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
            <p className="mt-4 px-1 font-mono text-[11px] text-muted-foreground md:hidden">
              {`v${__APP_VERSION__} (${__APP_COMMIT__})`}
            </p>
          </TabsContent>
        </div>
        </Tabs>
      </div>

      {/* Confirmation Dialog */}
      <Dialog open={confirmDialog.isOpen} onOpenChange={handleCancel}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmDialog.title}</DialogTitle>
            <DialogDescription>{confirmDialog.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirm}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Connection Settings Dialog */}
      <ConnectionSettings
        isOpen={showConnectionSettings}
        onClose={() => setShowConnectionSettings(false)}
        onConnectionChange={loadAllData}
      />

      <Toaster />
    </div>
  );
}
