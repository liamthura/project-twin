/**
 * The basics, rendered by the editor's own `fields` renderer.
 *
 * Not bespoke inputs. The flow teaches the interface by BEING the interface,
 * and it cannot drift from the editor's design because it is that design: the
 * node it renders is the same one Profile renders, read out of the same
 * manifest.
 */
import { FieldsRenderer } from "@/renderers/FieldsRenderer";

import { nodeAt } from "./manifestNode";

// profile's basic_info node addresses the section ROOT -- its seven keys are
// stored as top-level scalars, which is why the path is empty rather than
// missing.
const PROFILE_ROOT = [];

export function StepAboutYou({ packs, data, onChange }) {
  const node = nodeAt(packs, "profile", PROFILE_ROOT);

  if (!node) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">About you</h1>
        <p className="text-muted-foreground">
          This step is not available on this server. Carry on — you can fill this
          in from Profile whenever it is.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">About you</h1>
        <p className="text-muted-foreground">
          Nothing here is required, and everything saves as you type. Fill in
          what is useful and move on.
        </p>
      </div>
      {/* `value` is the whole section object and `onValue` gets the whole
          replacement: FieldsRenderer spreads what is stored on every write, so
          the lists this step never shows -- work experience, education --
          survive an edit rather than being replaced by seven scalars. */}
      <FieldsRenderer
        node={node}
        entity={node.element?.entity}
        value={data}
        onValue={onChange}
        packKey="onboarding-profile"
      />
    </div>
  );
}
