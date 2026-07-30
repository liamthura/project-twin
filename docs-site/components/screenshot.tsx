import { ImageIcon } from 'lucide-react';

interface ScreenshotProps {
  /**
   * Path under `public/`, e.g. `/screenshots/editor-sections.png`. Omit it and
   * the component renders a labelled placeholder instead of a broken image.
   */
  src?: string;
  /** Alt text. Falls back to `caption` when not given. */
  alt?: string;
  /** What the image shows. Rendered as the figure caption, and as the
   * placeholder's title while the image is still missing. */
  caption: string;
  /** Extra direction for whoever takes the shot — which screen, which state. */
  hint?: string;
  /** Tailwind aspect-ratio value for the placeholder box. */
  ratio?: string;
}

/**
 * A screenshot, or a placeholder for one that has not been taken yet.
 *
 * The docs were written before the screenshots existed. Rather than leave the
 * gaps invisible, every intended image is declared here with its caption: the
 * placeholder renders in the page, so the remaining work is visible to readers
 * and to whoever fills it in. Adding the real image is one prop.
 */
/** Placeholder height cap. A full-width 16:10 box in a wide prose column comes
 *  out over 700px tall and swamps the page it is only marking a gap in. */
const MAX_PLACEHOLDER_HEIGHT = 340;

/** "16 / 10" -> 1.6. Falls back to landscape on anything unparseable. */
function parseRatio(ratio: string): number {
  const [w, h] = ratio.split('/').map((part) => Number(part.trim()));
  return Number.isFinite(w) && Number.isFinite(h) && h > 0 ? w / h : 1.6;
}

export function Screenshot({ src, alt, caption, hint, ratio = '16 / 10' }: ScreenshotProps) {
  if (!src) {
    // Portrait placeholders get an explicit width so a phone shot reads as a
    // phone rather than a full-width band. Landscape ones keep the column
    // width and are simply capped in height.
    const r = parseRatio(ratio);
    const style =
      r < 1
        ? { width: MAX_PLACEHOLDER_HEIGHT * r, height: MAX_PLACEHOLDER_HEIGHT }
        : { aspectRatio: ratio, maxHeight: MAX_PLACEHOLDER_HEIGHT };

    return (
      <figure className="my-6">
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-fd-border bg-fd-muted/40 px-6 py-8 text-center"
          style={style}
        >
          <ImageIcon className="size-6 text-fd-muted-foreground/60" aria-hidden />
          <p className="text-sm font-medium text-fd-muted-foreground">{caption}</p>
          {hint ? (
            <p className="max-w-prose text-xs text-fd-muted-foreground/70">{hint}</p>
          ) : null}
          <p className="text-[10px] uppercase tracking-wide text-fd-muted-foreground/50">
            Screenshot to come
          </p>
        </div>
      </figure>
    );
  }

  return (
    <figure className="my-6">
      {/* Plain <img>: the site is a static export with image optimisation off,
          so next/image would add sizing requirements and buy nothing. */}
      <img
        src={src}
        alt={alt ?? caption}
        className="rounded-lg border border-fd-border bg-fd-muted/40"
        loading="lazy"
      />
      <figcaption className="mt-2 text-center text-sm text-fd-muted-foreground">
        {caption}
      </figcaption>
    </figure>
  );
}
