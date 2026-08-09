import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A product screenshot that removes itself if the file is not there.
 *
 * THE ASSETS ARE NOT CAPTURED YET. The Figma build bakes each bento visual and
 * the hero mockup as a PNG; none of them has been exported into this repo, so
 * every one of these currently resolves to nothing.
 *
 * Hiding on error rather than leaving a broken image is the lesser of two
 * visible failures, but it is still a failure -- and a silent one, which is the
 * mode this project has already been bitten by. The intended fix is not to
 * export the PNGs: it is to rebuild each mini-UI in markup. Two reasons.
 *
 *   1. The baked images are light-mode pixels. The design spec records the
 *      consequence: "A dark landing frame would show light UI inside every
 *      bento tile." Markup inherits the theme; a PNG cannot.
 *   2. Every one of these visuals was invented from imagination on the first
 *      pass and every one was wrong. Markup built from the cited source file
 *      can be reviewed against that file; a screenshot cannot.
 */
export function Screenshot({ src, alt = "", className, ...props }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  return (
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      className={cn(className)}
      {...props}
    />
  );
}
