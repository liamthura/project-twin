import { FOOTER } from "./content";
import { Lockup } from "./Brand";
import { Column } from "./primitives";

/**
 * The footer, on ground-inverse.
 *
 * Its ground is a token that does not invert, not `foreground` -- an earlier
 * version bound this to ink, which inverts, so in dark mode the footer came out
 * lighter than the page above it.
 *
 * Links with a null href render as plain text rather than as dead anchors.
 * GitHub, Privacy and Terms have no destination yet: the repository is private
 * ("License: TBD -- currently private"), and the two legal pages do not exist.
 * A link that goes nowhere is worse than a label that admits it.
 */
export function Footer() {
  return (
    <footer className="bg-ground-inverse pb-12 pt-4">
      <Column>
        <div className="flex flex-col gap-12 lg:flex-row lg:justify-between">
          <div className="max-w-[340px]">
            <Lockup tone="inverse" />
            <p className="mt-4 text-sm text-on-inverse/60">{FOOTER.blurb}</p>
          </div>

          <div className="flex flex-wrap gap-x-16 gap-y-8">
            {FOOTER.groups.map((group) => (
              <div key={group.label}>
                <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-on-inverse/50">
                  {group.label}
                </h2>
                <ul className="mt-3 space-y-3">
                  {group.links.map((link) => (
                    <li key={link.label}>
                      {link.href ? (
                        <a
                          href={link.href}
                          className="text-sm text-on-inverse/80 hover:text-on-inverse"
                        >
                          {link.label}
                        </a>
                      ) : (
                        <span className="text-sm text-on-inverse/40">
                          {link.label}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-on-inverse/10 pt-6 text-[13px] text-on-inverse/50 sm:flex-row sm:justify-between">
          <p>© {new Date().getFullYear()} MyGist</p>
          <p>{FOOTER.status}</p>
        </div>
      </Column>
    </footer>
  );
}
