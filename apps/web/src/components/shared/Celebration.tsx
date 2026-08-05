"use client";
import { useMemo } from "react";
import { usePrefersReducedMotion } from "@/lib/a11y";

/**
 * Lightweight arena particles for a win. CSS only, no dependency, no canvas.
 *
 * THREE CONSTRAINTS SHAPE IT, and each rules out the obvious implementation:
 *
 *  * IT MUST NEVER BLOCK INTERACTION. A confetti layer over the result screen
 *    is a layer over "Play again". `pointer-events: none` on the container is
 *    the whole fix and is not optional; a canvas library that mounts its own
 *    positioned element is one more place that could be forgotten.
 *  * IT MUST NOT SHIP A LIBRARY. Twenty-four absolutely-positioned spans with
 *    a keyframe each is a few hundred bytes of CSS. A confetti package is tens
 *    of kilobytes on a page whose whole point is that it loads fast enough to
 *    play another match.
 *  * IT MUST DISAPPEAR ENTIRELY UNDER REDUCED MOTION. Not slowed, not faded --
 *    absent. Falling particles are the exact class of motion the preference
 *    exists to remove, and there is no information in them to preserve.
 *
 * The particle geometry is derived from the index rather than from
 * `Math.random()`, so a re-render never reshuffles mid-flight and a snapshot
 * test sees the same output twice.
 */

const PARTICLES = 24;

export default function Celebration({
  active,
  testId = "celebration",
}: {
  active: boolean;
  testId?: string;
}) {
  const reduced = usePrefersReducedMotion();

  const particles = useMemo(
    () =>
      Array.from({ length: PARTICLES }, (_, index) => ({
        left: `${(index * 97) % 100}%`,
        delay: `${((index * 137) % 900) / 1000}s`,
        duration: `${1.9 + ((index * 53) % 900) / 1000}s`,
        drift: `${((index * 71) % 60) - 30}px`,
        hue: index % 3,
      })),
    [],
  );

  if (!active || reduced) {
    // Rendered as an empty marker rather than nothing, so a test can assert
    // the reduced-motion path resolved rather than that the element is missing
    // for some other reason.
    return (
      <div
        data-testid={testId}
        data-active={active ? "true" : "false"}
        data-reduced={reduced ? "true" : "false"}
        hidden
      />
    );
  }

  return (
    <div
      className="celebration"
      data-testid={testId}
      data-active="true"
      data-reduced="false"
      aria-hidden="true"
    >
      {particles.map((particle, index) => (
        <span
          key={index}
          className="celebration-bit"
          data-hue={particle.hue}
          style={
            {
              left: particle.left,
              animationDelay: particle.delay,
              animationDuration: particle.duration,
              "--drift": particle.drift,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
