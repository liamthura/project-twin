import { cn } from "@/lib/utils";

/**
 * Magic UI's `safari`, adapted.
 *
 * Three changes from the registry version.
 *
 * It takes **children** rather than only `imageSrc`/`videoSrc`. The hero mockup
 * is live markup, not a screenshot, so the screen area has to hold a React
 * subtree. The punch-out mask and the screen geometry are unchanged.
 *
 * It is **recoloured to the warm neutrals**. The original renders macOS chrome
 * in its own cool grey (`#E5E5E5` / `#404040`), which fights the warm stone
 * palette and the 24-32px warm containers around it. The chrome now reads from
 * `border`, `card` and `muted`, so it follows the theme in both modes.
 *
 * It defaults to **simple mode**. The registry's default paints the full Safari
 * toolbar -- share, reload, tabs, sidebar, back and forward, eight glyphs of
 * path data. None of them says anything about MyGist, and the design's frame is
 * a quiet container rather than a screenshot of a browser.
 */
const W = 1203;
const H = 753;
const SCREEN = { x: 1, y: 52, w: 1200, h: 700 };

const LEFT_PCT = (SCREEN.x / W) * 100;
const TOP_PCT = (SCREEN.y / H) * 100;
const WIDTH_PCT = (SCREEN.w / W) * 100;
const HEIGHT_PCT = (SCREEN.h / H) * 100;

export function Safari({ url, children, className, style, ...props }) {
  return (
    <div
      className={cn("relative inline-block w-full align-middle leading-none", className)}
      style={{ aspectRatio: `${W}/${H}`, ...style }}
      {...props}
    >
      <div
        className="absolute z-0 overflow-hidden"
        style={{
          left: `${LEFT_PCT}%`,
          top: `${TOP_PCT}%`,
          width: `${WIDTH_PCT}%`,
          height: `${HEIGHT_PCT}%`,
          borderRadius: "0 0 11px 11px",
        }}
      >
        {children}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="absolute inset-0 z-10 size-full"
        style={{ transform: "translateZ(0)" }}
        aria-hidden="true"
      >
        <defs>
          {/* Punches the screen out of the chrome, so the children below show
              through rather than being painted over. */}
          <mask id="safariPunch" maskUnits="userSpaceOnUse">
            <rect x="0" y="0" width={W} height={H} fill="white" />
            <path
              d="M1 52H1201V741C1201 747.075 1196.08 752 1190 752H12C5.92486 752 1 747.075 1 741V52Z"
              fill="black"
            />
          </mask>
          <clipPath id="safariClip">
            <rect width={W} height={H} fill="white" />
          </clipPath>
        </defs>

        <g clipPath="url(#safariClip)" mask="url(#safariPunch)">
          <path
            d="M0 52H1202V741C1202 747.627 1196.63 753 1190 753H12C5.37258 753 0 747.627 0 741V52Z"
            className="fill-border"
          />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M0 12C0 5.37258 5.37258 0 12 0H1190C1196.63 0 1202 5.37258 1202 12V52H0L0 12Z"
            className="fill-border"
          />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M1.06738 12C1.06738 5.92487 5.99225 1 12.0674 1H1189.93C1196.01 1 1200.93 5.92487 1200.93 12V51H1.06738V12Z"
            className="fill-card"
          />
          <circle cx="27" cy="25" r="6" className="fill-muted-foreground/30" />
          <circle cx="47" cy="25" r="6" className="fill-muted-foreground/30" />
          <circle cx="67" cy="25" r="6" className="fill-muted-foreground/30" />
          <path
            d="M286 17C286 13.6863 288.686 11 292 11H946C949.314 11 952 13.6863 952 17V35C952 38.3137 949.314 41 946 41H292C288.686 41 286 38.3137 286 35V17Z"
            className="fill-muted"
          />
          {url ? (
            <text
              x="619"
              y="30"
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize="13"
              fontFamily="inherit"
            >
              {url}
            </text>
          ) : null}
        </g>
      </svg>
    </div>
  );
}
