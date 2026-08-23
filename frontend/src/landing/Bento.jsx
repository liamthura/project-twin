import { BENTO } from "./content";
import { Column, Section, SectionHeader } from "./primitives";
import { TILE_MEDIA } from "./mini";
import { cn } from "@/lib/utils";

/**
 * The bento: three columns, every row summing to three, now in two labelled
 * groups rather than one flat scan of seven.
 *
 *   What assistants can do with it
 *     row 1   [ Scoped reads 2col ] [ Search   1col ]
 *     row 2   [ Proposals    2col ] [ Consent  1col ]
 *
 *   What you can do with it
 *     row 3   [ Your sections 1col ] [ Skills 1col ] [ Run it yourself 1col ]
 *
 * The two groups answer opposite questions -- "is this safe" and "is this
 * powerful" -- and seven peers at one weight made the reader sort them.
 *
 * All seven tiles carry product UI. An earlier cut gave the five 1-col tiles
 * copy and an icon only, for a rhythm of heavy and light; built out, that read
 * as five unfinished cards with 200-300px of dead white under three lines of
 * text.
 */
export function Bento() {
  return (
    <Section id="what-it-does" ground="paper">
      <Column>
        <SectionHeader eyebrow={BENTO.eyebrow} headline={BENTO.headline} />

        {BENTO.groups.map((group, i) => (
          <section key={group.key} className={i === 0 ? "mt-14" : "mt-16"}>
            {/* A label, not a heading -- same call SectionHeader makes for its
                eyebrow. The section already has its h2; these two would sit
                between it and the tiles' h3s and break the outline. */}
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground md:text-[13px]">
              {group.label}
            </p>
            <div className="mt-6 grid gap-6 md:grid-cols-3">
              {BENTO.tiles
                .filter((tile) => tile.group === group.key)
                .map((tile) => (
                  <Tile key={tile.id} tile={tile} />
                ))}
            </div>
          </section>
        ))}

        <p className="mt-10 font-mono text-[12px] text-muted-foreground">
          {BENTO.sourcing}
        </p>
      </Column>
    </Section>
  );
}

function Tile({ tile }) {
  return (
    <article
      className={cn(
        "relative flex min-h-[352px] flex-col overflow-hidden rounded-xl border border-border bg-card pt-8 shadow-sm",
        tile.span === 2 && "md:col-span-2",
      )}
    >
      <div className="px-8">
        <h3 className="text-xl font-semibold text-primary">{tile.title}</h3>
        {/* Hugs its height. The Figma component truncated this at a fixed two
            lines, which meant over-long copy silently vanished rather than
            visibly overflowing -- the worse of the two failures. */}
        <p className="mt-3 text-base text-muted-foreground">{tile.body}</p>
      </div>

      <TileMedia tile={tile} />
    </article>
  );
}

/**
 * The product shot at the foot of a tile.
 *
 * Oversized and anchored top-left, so it bleeds off the bottom and right and
 * gets clipped by the tile. Top-left anchoring is the load-bearing part: a
 * centre crop (CSS `object-fit: cover`, Figma's `FILL`) puts a different part
 * of the image on screen at every tile width, which on mobile cut every heading
 * off and left only sentence tails.
 *
 * **The fade is on the clipping box, not on the media.** That is the whole
 * trick, and getting it wrong is what shipped text sliced mid-word. Masking
 * the media means the ramp's percentages are measured across 520px while only
 * part of that is ever on screen -- 65% of it in a 1-col tile, about 95% in a
 * 2-col one -- so a stop at 66% fades past the visible edge in the narrow
 * tiles and nowhere near it in the wide ones. No single percentage can serve
 * both. Measured across the box that does the clipping, every stop lands
 * where it looks like it lands, at any tile width.
 *
 * Three ramps, intersected. The diagonal carries the character; the two axis
 * ramps take the bottom and right edges it never reaches. Before them,
 * "Scoped reads" severed the Projects row and "Search" truncated a query at
 * `...how does Maya like replies wr`.
 *
 * **Scaled, not clipped, on a phone.** The surface is a fixed 520px, so a
 * ~310px tile showed its left 60% and nothing else, and "Your sections" lost
 * the `+ Recipes` chip -- the one element that proves that tile's claim.
 * Scaling from the top-left brings the whole panel to ~322px, so a phone sees
 * a small complete panel instead of a cropped one.
 */
function TileMedia({ tile }) {
  const Media = TILE_MEDIA[tile.id];
  if (!Media) return null;

  const fade = [
    "linear-gradient(135deg, #000 0%, #000 45%, transparent 92%)",
    "linear-gradient(to bottom, #000 0%, #000 55%, transparent 100%)",
    "linear-gradient(to right, #000 0%, #000 58%, transparent 100%)",
  ].join(", ");

  return (
    <div
      className="relative mt-10 min-h-[192px] flex-1 overflow-hidden"
      aria-hidden="true"
      style={{
        WebkitMaskImage: fade,
        maskImage: fade,
        WebkitMaskComposite: "source-in",
        maskComposite: "intersect",
      }}
    >
      <div className="absolute left-8 top-0 origin-top-left scale-[0.62] md:scale-100">
        <Media />
      </div>
    </div>
  );
}

