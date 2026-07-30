/**
 * The MyGist mark, from frontend/public/logo.svg.
 *
 * The app's copy hard-codes #3B5BDB, which is its light-mode --primary. Here it
 * draws in `currentColor` instead, so the caller can hand it text-fd-primary
 * and get the app's indigo in light mode and its brighter dark-mode indigo in
 * dark -- the same behaviour the rest of this site's chrome has.
 */
export function Logo({ className }: { className?: string }) {
  return (
    // The app's 96x96 viewBox has the mark occupying only x 25.5-64.5,
    // y 20.5-80.5 -- fine for a favicon, but at nav size it renders small and
    // sitting left of centre. This box is the mark's own bounds plus a little
    // air, so it fills the space it is given.
    <svg
      viewBox="14 19.5 62 62"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={9}
      aria-hidden
    >
      <circle cx="45" cy="40" r="15" />
      <path d="M60 40 v22 a14 14 0 0 1 -14 14 h-9" strokeLinecap="round" />
    </svg>
  );
}
