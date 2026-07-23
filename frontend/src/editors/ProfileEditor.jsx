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
import { DialogFooter } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoDialog } from "@/components/ui/info-dialog";
import { ArrayInput } from "@/components/ArrayInput";

// Profile Editor
export default function ProfileEditor({ data, onChange, onShowConfirmation }) {
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
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            Personal Information
            <Button
              variant="ghost"
              size="icon"
              className="tap-target h-7 w-7 text-muted-foreground hover:text-foreground"
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
        <CardHeader className="border-b">
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
                    className="tap-target h-7 w-7 text-muted-foreground hover:text-foreground"
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
              Add education
            </Button>
          </div>
        </CardHeader>
        {!collapsedSections.academic && (
          <CardContent className="space-y-4">
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
                          className="tap-target h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      {/* Expanded Form */}
                      {isExpanded && (
                        <div className="border-t bg-background/50 p-4 space-y-4">
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
                                className="h-9"
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
                                className="h-9"
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
                                className="h-9"
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
                                <SelectTrigger id={`status-${eduIndex}`} className="h-9">
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
                                className="h-9"
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
                                className="h-9"
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
                                      className="tap-target h-8 w-8 text-muted-foreground hover:text-destructive"
                                    >
                                      <Trash2 className="h-4 w-4" />
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
                                      className="h-9"
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
                                type="button"
                                onClick={() => addCoursework(eduIndex)}
                                variant="outline"
                                size="sm"
                                className="h-8 w-full border-dashed"
                              >
                                <Plus className="h-3.5 w-3.5 mr-1.5" />
                                Add coursework
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
                                      className="tap-target h-8 w-8 text-muted-foreground hover:text-destructive"
                                    >
                                      <Trash2 className="h-4 w-4" />
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
                                      className="h-9"
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
                                type="button"
                                onClick={() => addClub(eduIndex)}
                                variant="outline"
                                size="sm"
                                className="h-8 w-full border-dashed"
                              >
                                <Plus className="h-3.5 w-3.5 mr-1.5" />
                                Add club
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
                                    className="h-9"
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
                                    className="tap-target h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
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
                                type="button"
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
              <EmptyState>No education entries yet. Add one to get started.</EmptyState>
            )}

            {/* Goals moved to their own section (see Manage sections) */}
            <div className="pt-4 border-t">
              <EmptyState>
                Goals moved to their own section — ask your AI to manage
                them, or toggle the Goals section in Manage sections.
              </EmptyState>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Work Experience */}
      <Card>
        <CardHeader className="border-b">
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
                    className="tap-target h-7 w-7 text-muted-foreground hover:text-foreground"
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
              Add experience
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
                          className="tap-target h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      {/* Expanded Form */}
                      {isExpanded && (
                        <div className="border-t bg-background/50 p-4 space-y-4">
                          <div className="grid gap-4 sm:grid-cols-2">
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
                                className="h-9"
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
                                className="h-9"
                              />
                            </div>
                          </div>
                          <div className="grid gap-4 sm:grid-cols-2">
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
                                className="h-9"
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
                                className="h-9"
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
                                    className="h-9"
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
                                    className="tap-target h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              ))}
                              <Button
                                type="button"
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
            )}
          </CardContent>
        )}
      </Card>

      {/* Contact Information */}
      <Card>
        <CardHeader className="border-b">
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
                    className="tap-target h-7 w-7 text-muted-foreground hover:text-foreground"
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
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Emails</Label>
              <div className="space-y-3">
                {(data.contact?.emails || []).map((email, index) => (
                  <div
                    key={index}
                    className="p-3 rounded-lg border"
                  >
                    <div className="flex gap-3">
                      <div className="grid gap-4 sm:grid-cols-2 flex-1">
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
                            className="h-9"
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
                            <SelectTrigger className="h-9">
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
                        className="tap-target h-8 w-8 text-muted-foreground hover:text-destructive mt-1"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                <Button
                  type="button"
                  onClick={addEmail}
                  variant="outline"
                  size="sm"
                  className="h-8 w-full border-dashed"
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add email
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
                      <div className="grid gap-4 sm:grid-cols-2 flex-1">
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
                            className="h-9"
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
                            className="h-9"
                          />
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeLink(index)}
                        className="tap-target h-8 w-8 text-muted-foreground hover:text-destructive mt-1"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                <Button
                  type="button"
                  onClick={addLink}
                  variant="outline"
                  size="sm"
                  className="h-8 w-full border-dashed"
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add link
                </Button>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Languages */}
      <Card>
        <CardHeader className="border-b">
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
                    className="tap-target h-7 w-7 text-muted-foreground hover:text-foreground"
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
                      <div className="grid gap-4 sm:grid-cols-2 flex-1">
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
                            className="h-9"
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
                            <SelectTrigger className="h-9">
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
                        className="tap-target h-8 w-8 text-muted-foreground hover:text-destructive mt-1"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                <Button
                  type="button"
                  onClick={addLanguage}
                  variant="outline"
                  size="sm"
                  className="h-8 w-full border-dashed"
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add language
                </Button>
              </div>
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
