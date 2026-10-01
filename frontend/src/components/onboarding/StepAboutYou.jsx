/**
 * The basics, rendered by the editor's own `fields` renderer.
 *
 * Not bespoke inputs. The flow teaches the interface by BEING the interface,
 * and it cannot drift from the editor's design because it is that design: the
 * node it renders is the same one Profile renders, read out of the same
 * manifest.
 */
import { Button } from "@/components/ui/button";
import { FieldsRenderer } from "@/renderers/FieldsRenderer";
import { BlurFade } from "@/components/ui/blur-fade";

import { nodeAt } from "./manifestNode";

// profile's basic_info node addresses the section ROOT -- its seven keys are
// stored as top-level scalars, which is why the path is empty rather than
// missing.
const PROFILE_ROOT = [];

// Back, then Finish later beside Continue. "Finish later", not "Skip": what
// you typed is already saved, so skipping read as throwing it away.
function Footer({ onBack, onLater, onContinue }) {
  return (
    <div className="mt-10 flex items-center justify-between gap-3">
      <Button variant="ghost" className="-ml-3" onClick={onBack}>
        Back
      </Button>
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={onLater}>
          Finish later
        </Button>
        <Button onClick={onContinue}>Continue</Button>
      </div>
    </div>
  );
}

export function StepAboutYou({ packs, data, onChange, onOfferAssistant, onBack, onLater, onContinue, children }) {
  const node = nodeAt(packs, "profile", PROFILE_ROOT);

  if (!node) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">About you</h1>
        <p className="text-muted-foreground">
          This step is not available on this server. Carry on. You can fill this
          in from Profile whenever it is.
        </p>
        {children}
        {/* Connect offered this one screen ago. Someone who starts typing and
            regrets it should not have to walk back to find it. A quiet link,
            not a button: Continue is the expected move here. */}
        {onOfferAssistant && (
          <button
            type="button"
            className="tap-target text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            onClick={onOfferAssistant}
          >
            Let my assistant fill this in instead
          </button>
        )}
        <Footer onBack={onBack} onLater={onLater} onContinue={onContinue} />
      </div>
    );
  }

  return (
    <BlurFade duration={0.24}>
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">About you</h1>
          <p className="text-muted-foreground">
            Nothing here is required, and everything saves as you type. Fill in
            what is useful and move on; the rest is in the editor.
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
        {children}
        {/* Connect offered this one screen ago. Someone who starts typing and
            regrets it should not have to walk back to find it. A quiet link,
            not a button: Continue is the expected move here. */}
        {onOfferAssistant && (
          <button
            type="button"
            className="tap-target text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            onClick={onOfferAssistant}
          >
            Let my assistant fill this in instead
          </button>
        )}
        <Footer onBack={onBack} onLater={onLater} onContinue={onContinue} />
      </div>
    </BlurFade>
  );
}
