import {
  BookOpen,
  Brain,
  Film,
  FolderKanban,
  Heart,
  Inbox,
  Package,
  Palette,
  Settings,
  SlidersHorizontal,
  Target,
  User,
  Users,
} from "lucide-react";

// One icon per pack, and one for each of the two destinations that are not
// packs. Lifted out of App.jsx so the desktop rail and the mobile sheet read the
// same map rather than each keeping its own copy -- two copies is how one of
// them ends up missing a pack.
const PACK_ICONS = {
  goals: Target,
  media: Film,
  aesthetics: Palette,
  circle: Users,
  learning_log: BookOpen,
  knowledge: Brain,
  projects: FolderKanban,
  lifestyle: Heart,
  preferences: Settings,
  profile: User,
};

export const REVIEW_ICON = Inbox;
export const SECTIONS_ICON = SlidersHorizontal;

/** A pack's icon, falling back to a generic one so a new pack still renders. */
export function packIcon(key) {
  return PACK_ICONS[key] || Package;
}
