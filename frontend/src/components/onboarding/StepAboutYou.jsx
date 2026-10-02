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

// "Saves as you type" was a promise with nothing on screen to keep it. A
// failed save used to be swallowed; now it says so and offers to try again.
function SaveMark({ state, onRetry }) {
  return (
    <p role="status" className="h-5 text-sm text-muted-foreground">
      {state === "saving" && "Saving…"}
      {state === "saved" && <span className="animate-in fade-in duration-200 motion-reduce:animate-none">Saved</span>}
      {state === "error" && (
        <>
          Couldn&apos;t save.{" "}
          <button type="button" className="underline underline-offset-4 hover:text-foreground" onClick={onRetry}>
            Retry
          </button>
        </>
      )}
    </p>
  );
}

// Nationality is sensitive, and of little use to an assistant on day one.
// Profile still has the field.
const LEFT_FOR_PROFILE = new Set(["nationality"]);

export function StepAboutYou({
  packs, data, onChange, saveState, onRetry, onOfferAssistant, onBack, onLater, onContinue, children,
}) {
  const found = nodeAt(packs, "profile", PROFILE_ROOT);
  const node = found && {
    ...found,
    element: { ...found.element, fields: (found.element?.fields || []).filter((f) => !LEFT_FOR_PROFILE.has(f.name)) },
  };

  if (!node) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">About you</h1>
        <p className="text-muted-foreground">
          This step is not available on this server. Carry on. You can fill this
          in from Profile whenever it is.
        </p>
        {children}
        {/* Someone who starts typing and would rather not should not have
            to walk back to find the other way. A quiet link, not a button:
            Continue is the expected move here. */}
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
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">About you</h1>
        <p className="max-w-prose text-muted-foreground">
          Type what&apos;s useful and leave the rest. It saves as you go, and you can change all of it later.
        </p>
        <SaveMark state={saveState} onRetry={onRetry} />
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
      {/* Someone who starts typing and would rather not should not have
          to walk back to find the other way. A quiet link, not a button:
          Continue is the expected move here. */}
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
