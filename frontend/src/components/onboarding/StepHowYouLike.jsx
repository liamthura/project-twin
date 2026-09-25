/**
 * How answers should be written: the second half of the About you step.
 *
 * It was a step of its own until wave 4 cut onboarding to three. Only the
 * `fields` node at `communication.default` (tone, locale, detail level) came
 * along: response formats and learning style are in Preferences, and three
 * controls under a heading is a section, where six would be another form.
 */
import { FieldsRenderer } from "@/renderers/FieldsRenderer";
import { getAt, setAt } from "@/renderers/paths";

import { nodeAt } from "./manifestNode";

const COMMUNICATION_DEFAULT = ["communication", "default"];

export function StepHowYouLike({ packs, data, onChange }) {
  const communication = nodeAt(packs, "preferences", COMMUNICATION_DEFAULT);
  // A server without the node leaves About you as it was; the fields are in
  // Preferences whenever they exist.
  if (!communication) return null;

  return (
    <section className="space-y-4 border-t pt-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">How you like answers</h2>
        <p className="text-sm text-muted-foreground">
          These apply to every assistant you connect.
        </p>
      </div>
      {/* The path is inside preferences, so the write goes through `setAt`:
          keys outside it survive by reference. */}
      <FieldsRenderer
        node={communication}
        entity={communication.element?.entity}
        value={getAt(data || {}, COMMUNICATION_DEFAULT)}
        onValue={(next) => onChange(setAt(data || {}, COMMUNICATION_DEFAULT, next))}
        packKey="onboarding-preferences"
      />
    </section>
  );
}
