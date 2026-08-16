/**
 * How answers should be written.
 *
 * Two nodes rather than one, because the manifest declares two: a `fields` node
 * at `communication.default` (tone, locale, detail level) and a `strings` node
 * at `response_format`. Both are rendered by the editor's renderers, and both
 * are reached with `nodeAt` rather than described a second time here.
 *
 * `learning_style.preferred` and `.avoid` resolve too -- they are `strings`
 * nodes one level down inside the Learning Style group. They are deliberately
 * NOT here: this step already carries four controls, and six would make it a
 * form rather than a step.
 */
import { FieldsRenderer } from "@/renderers/FieldsRenderer";
import { StringsRenderer } from "@/renderers/StringsRenderer";
import { getAt, setAt } from "@/renderers/paths";
import { BlurFade } from "@/components/ui/blur-fade";

import { nodeAt } from "./manifestNode";

const COMMUNICATION_DEFAULT = ["communication", "default"];
const RESPONSE_FORMAT = ["response_format"];

export function StepHowYouLike({ packs, data, onChange, onOfferAssistant }) {
  const communication = nodeAt(packs, "preferences", COMMUNICATION_DEFAULT);
  const responseFormat = nodeAt(packs, "preferences", RESPONSE_FORMAT);

  if (!communication && !responseFormat) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          How you like answers
        </h1>
        <p className="text-muted-foreground">
          This step is not available on this server. Carry on. You can fill this
          in from Preferences whenever it is.
        </p>
        {/* Welcome promised this and Connect delivered it, two screens ago. Someone
            who starts typing and regrets it should not have to walk backwards to
            find the offer again. A quiet link, not a button: it competes with
            Continue, and Continue is the expected move here. */}
        {onOfferAssistant && (
          <button
            type="button"
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            onClick={onOfferAssistant}
          >
            Let my assistant fill this in instead
          </button>
        )}
      </div>
    );
  }

  // Both nodes live at a path inside preferences, so every write goes through
  // the same immutable `setAt` the section root uses: keys outside the path
  // survive by reference rather than being rebuilt.
  const writeAt = (path) => (next) => onChange(setAt(data || {}, path, next));

  return (
    <BlurFade duration={0.24}>
      <div className="space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            How you like answers
          </h1>
          <p className="text-muted-foreground">
            Nothing here is required, and everything saves as you type. These apply
            to every assistant you connect.
          </p>
        </div>

        {communication && (
          <FieldsRenderer
            node={communication}
            entity={communication.element?.entity}
            value={getAt(data || {}, COMMUNICATION_DEFAULT)}
            onValue={writeAt(COMMUNICATION_DEFAULT)}
            packKey="onboarding-preferences"
          />
        )}

        {responseFormat && (
          <div className="space-y-2">
            <h2 className="headline-3">{responseFormat.title}</h2>
            <p className="text-sm text-muted-foreground">
              {responseFormat.description}
            </p>
            <StringsRenderer
              node={responseFormat}
              items={getAt(data || {}, RESPONSE_FORMAT)}
              onItems={writeAt(RESPONSE_FORMAT)}
            />
          </div>
        )}

        {/* Welcome promised this and Connect delivered it, two screens ago. Someone
            who starts typing and regrets it should not have to walk backwards to
            find the offer again. A quiet link, not a button: it competes with
            Continue, and Continue is the expected move here. */}
        {onOfferAssistant && (
          <button
            type="button"
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            onClick={onOfferAssistant}
          >
            Let my assistant fill this in instead
          </button>
        )}
      </div>
    </BlurFade>
  );
}
