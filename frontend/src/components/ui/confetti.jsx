import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";
import confetti from "canvas-confetti";

import { cn } from "@/lib/utils";

/**
 * Magic UI's `confetti`, adapted.
 *
 * Changes from the registry version: JSX, `ConfettiButton` dropped since
 * nothing here fires confetti from a button and it pulled an import of Button
 * for no reason, and the imperative handle dropped with it. What is left is a
 * canvas that fires once when it mounts.
 *
 * Reduced motion renders no canvas at all. Not a canvas that stays empty: the
 * component's entire output is motion, so there is nothing left to draw.
 *
 * `pointer-events-none` and a fixed full-viewport box, so it cannot intercept a
 * click on the button underneath it. That is the failure mode a celebration
 * layer has, and it is silent.
 */
export function Confetti({ className, options }) {
  const canvasRef = useRef(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced || !canvasRef.current) return undefined;

    const fire = confetti.create(canvasRef.current, { resize: true, useWorker: true });
    fire({
      particleCount: 70,
      spread: 68,
      startVelocity: 34,
      origin: { y: 0.6 },
      ...options,
    });

    return () => fire.reset();
    // Once per mount. `options` is deliberately not a dependency: a caller
    // passing an object literal would re-fire on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  if (reduced) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cn("pointer-events-none fixed inset-0 z-50 h-full w-full", className)}
    />
  );
}
