"use client";

/**
 * LifeMeter — lives as pieces on the table, not a fraction in a corner.
 *
 * One pip per life the rules allow. A pip that is still there is a solid
 * piece; one that has been lost is a hollow scar that stays visible for the
 * rest of the run. When a life is lost the pip that went dark plays a short
 * Level-2 break and the survivors pulse once, and at one life left the whole
 * meter carries `data-danger` so the room can raise its own tension without
 * this component inventing effects. Reduced motion shows the final state.
 *
 * State is in attributes and copy (`data-lives`, an sr-only sentence); the
 * pips are decoration over it.
 */

import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/a11y";

export interface LifeMeterProps {
  lives: number;
  max: number;
  label?: string;
  size?: "sm" | "md" | "lg";
  testId?: string;
  valueTestId?: string;
  className?: string;
}

const BEAT_MS = 1100;

export default function LifeMeter({ lives, max, label = "Lives", size = "md", testId = "life-meter", valueTestId, className }: LifeMeterProps) {
  const reduced = usePrefersReducedMotion();
  const previous = useRef<number | null>(null);
  const [beat, setBeat] = useState<"lost" | "gained" | null>(null);
  const [lostIndex, setLostIndex] = useState<number | null>(null);

  useEffect(() => {
    const prev = previous.current;
    previous.current = lives;
    if (prev === null || prev === lives) return;
    if (lives < prev) {
      setBeat("lost");
      setLostIndex(lives); // the first hollow pip is the one that just broke
    } else {
      setBeat("gained");
      setLostIndex(null);
    }
    const id = window.setTimeout(() => {
      setBeat(null);
      setLostIndex(null);
    }, BEAT_MS);
    return () => window.clearTimeout(id);
  }, [lives]);

  const safeMax = Math.max(1, max);
  const danger = lives <= 1;
  return (
    <div
      className={`gf-lives ${className ?? ""}`}
      data-testid={testId}
      data-lives={lives}
      data-max={safeMax}
      data-danger={danger ? "true" : "false"}
      data-beat={beat ?? undefined}
      data-size={size}
      data-reduced-motion={reduced ? "true" : "false"}
      role="img"
      aria-label={`${lives} of ${safeMax} lives`}
    >
      <span className="gf-lives-label" aria-hidden="true">
        {label}
      </span>
      <span className="gf-lives-pips" aria-hidden="true">
        {Array.from({ length: safeMax }, (_, i) => (
          <span
            key={i}
            className="gf-lives-pip"
            data-alive={i < lives ? "true" : "false"}
            data-just-lost={lostIndex === i ? "true" : "false"}
          />
        ))}
      </span>
      <span className="gf-lives-value" data-testid={valueTestId} aria-hidden="true">
        {lives}/{safeMax}
      </span>
    </div>
  );
}
