"use client";

/**
 * ResultReveal — the ending resolves in steps, not as a dashboard.
 *
 * A finished game has one moment that pays off everything before it, and a
 * result screen that paints every number at once throws that moment away.
 * This owns the SCHEDULE: given an ordered list of step names and a delay
 * per step, it exposes which steps are revealed so far. Each child section
 * reads `revealed(name)` and renders with `data-revealed`, and the
 * stylesheet does the entrance. It is a Level-3 major event: the whole
 * sequence runs about three seconds.
 *
 * Nothing blocks. Any click or key on the sequence's surface completes it
 * at once (`onSkip`), reduced motion completes it immediately, and every
 * section's content is in the DOM from the first frame (revealed state is
 * presentation over state that is already there).
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePrefersReducedMotion } from "@/lib/a11y";

export interface ResultRevealStep {
  name: string;
  /** Milliseconds after the sequence starts. */
  at: number;
}

export interface ResultRevealRender {
  revealed: (name: string) => boolean;
  /** Index of the latest step revealed, -1 before the first. */
  stage: number;
  /** True once every step has been revealed. */
  complete: boolean;
  skip: () => void;
}

export interface ResultRevealProps {
  steps: readonly ResultRevealStep[];
  children: (state: ResultRevealRender) => ReactNode;
  /** Restart the sequence when this changes (a new result). */
  sequenceKey?: string | number;
  testId?: string;
  className?: string;
}

export default function ResultReveal({ steps, children, sequenceKey = "", testId = "result-reveal", className }: ResultRevealProps) {
  const reduced = usePrefersReducedMotion();
  const [stage, setStage] = useState<number>(reduced ? steps.length - 1 : -1);

  useEffect(() => {
    if (reduced) {
      setStage(steps.length - 1);
      return;
    }
    setStage(-1);
    const timers = steps.map((step, index) => window.setTimeout(() => setStage((current) => Math.max(current, index)), step.at));
    return () => timers.forEach((id) => window.clearTimeout(id));
    // `steps` is expected to be a module constant; `sequenceKey` restarts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequenceKey, reduced]);

  const skip = useCallback(() => setStage(steps.length - 1), [steps.length]);
  const complete = stage >= steps.length - 1;
  const revealed = useCallback(
    (name: string) => {
      const index = steps.findIndex((step) => step.name === name);
      return index >= 0 && index <= stage;
    },
    [stage, steps],
  );
  const render = useMemo(() => ({ revealed, stage, complete, skip }), [revealed, stage, complete, skip]);

  return (
    <div
      className={`gf-result ${className ?? ""}`}
      data-testid={testId}
      data-stage={stage}
      data-complete={complete ? "true" : "false"}
      data-reduced-motion={reduced ? "true" : "false"}
      onClick={complete ? undefined : skip}
      onKeyDown={complete ? undefined : (event) => { if (event.key === "Enter" || event.key === " ") skip(); }}
    >
      {children(render)}
    </div>
  );
}

/** A section that enters when its step is reached. */
export function RevealStep({ name, revealed, children, className, testId, as = "div" }: {
  name: string;
  revealed: (name: string) => boolean;
  children: ReactNode;
  className?: string;
  testId?: string;
  as?: "div" | "section" | "li";
}) {
  const Tag = as;
  const on = revealed(name);
  return (
    <Tag className={`gf-result-step ${className ?? ""}`} data-step={name} data-revealed={on ? "true" : "false"} data-testid={testId} aria-hidden={on ? undefined : true}>
      {children}
    </Tag>
  );
}
