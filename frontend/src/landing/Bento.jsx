import { BENTO } from "./content";
import { Column, Section, SectionHeader } from "./primitives";
import { Screenshot } from "./Screenshot";
import { cn } from "@/lib/utils";

/**
 * The bento: three columns, three rows, every row summing to three.
 *
 *   row 1   [ Scoped reads  2col ] [ Search         1col ]
 *   row 2   [ Your sections 1col ] [ Proposals      2col ]
 *   row 3   [ Consent 1col ] [ Skills 1col ] [ Run it yourself 1col ]
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

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {BENTO.tiles.map((tile) => (
            <Tile key={tile.id} tile={tile} />
          ))}
        </div>
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
 * The fade runs top-left opaque to bottom-right transparent. Its stops are
 * 0 / 0.42 / 0.68 rather than 0 / 1 because the media overhangs the tile:
 * only ~71% of the ramp horizontally and ~66% vertically is ever on screen, so
 * a transition placed in the back half of the ramp is invisible.
 */
function TileMedia({ tile }) {
  return (
    <div className="relative mt-10 min-h-[192px] flex-1 overflow-hidden" aria-hidden="true">
      <Screenshot
        src={`/landing/bento/${tile.id}.png`}
        className="absolute left-8 top-0 max-w-none origin-top-left"
        style={{
          WebkitMaskImage:
            "linear-gradient(135deg, #000 0%, #000 42%, transparent 68%)",
          maskImage: "linear-gradient(135deg, #000 0%, #000 42%, transparent 68%)",
        }}
      />
    </div>
  );
}
