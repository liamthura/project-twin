// The heading over a group's subsections.
//
// It was a mono, uppercase, tracked label with a hairline running out to the
// row's end: an eyebrow standing in for a heading, and at 13px smaller than the
// subsection titles beneath it, so the hierarchy read upside down. It is now
// the heading it always was in the outline, sized one step above them.
import { InfoButton } from "@/components/ui/info-button";

export function EyebrowBand({ title, info, description }) {
  return (
    <div data-eyebrow className="space-y-1">
      <div className="flex items-center gap-1.5">
        {/* h2: page title h1, group h2, its subsections h3. */}
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
        <InfoButton info={info} title={title} />
      </div>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}
