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

// Preferences Editor
export default function PreferencesEditor({ data, onChange }) {
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
        <CardHeader className="border-b">
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
        <CardHeader className="border-b">
          <CardTitle>Communication</CardTitle>
          <CardDescription>
            How you prefer AI responses to be formatted
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Default Communication Style */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">Default Style</p>
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
                    className="h-9"
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
                    className="h-9"
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
                  className="min-h-[80px] resize-none text-sm"
                />
              </div>
            </div>
          </div>

          {/* Mood Overrides */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">
                  When I'm feeling...
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Override defaults based on your mood or context
                </p>
              </div>
              <Button size="sm" onClick={addMoodOverride}>
                <Plus className="h-4 w-4 mr-2" />
                Add mood
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
                        <Badge variant="secondary" className="h-5 text-xs">
                          {mood.tone}
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="tap-target h-8 w-8 text-muted-foreground hover:text-destructive"
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
                            className="h-9"
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
                                className="h-9"
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
                                className="h-9"
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
                              className="min-h-[80px] resize-none text-sm"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState>No mood overrides yet. Add one to get started.</EmptyState>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
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
        <CardHeader className="border-b">
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
