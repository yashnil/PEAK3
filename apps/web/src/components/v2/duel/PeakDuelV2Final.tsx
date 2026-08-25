"use client";

/**
 * PeakDuelV2Final — the CINEMATIC 10/10 result (Pass 3, product-direction).
 *
 * Verified against the reference (E2 page 23): a large serif "X / 10"
 * headline, the ten-duel session strip as compact colored dashes, real
 * session instrumentation (arena points, best streak), then — ONLY when
 * there is one to show — the per-day result-history grid
 * (`PeakDuelV2History`, mission §4: merges the local archive with
 * `GET /game/daily/history`, keyed by Pacific daily key) and the lifetime
 * 0/10..10/10 distribution this pass added (`GET /game/daily/distribution`,
 * `getDailyDistribution()` in `lib/api.ts`; server-side aggregation, tested
 * for idempotency and Pacific daily identity in
 * `test_peak_duel_daily_result.py`). A fetch failure or a `total` of zero
 * attempts on record renders NOTHING for the distribution section — never a
 * placeholder or fabricated histogram, per brief; the history grid applies
 * the identical rule on its own merged data.
 *
 * Real actions only: Share (the exact `buildShareText` legacy already
 * uses — no second copy-generation path), Play Endless Mode, See all
 * rankings. No "review all ten" — that surface does not exist in this
 * repository, so it is not offered.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Share2, Check } from "lucide-react";
import PeakV2CinematicStage from "../PeakV2CinematicStage";
import PeakV2ResultHeadline from "../PeakV2ResultHeadline";
import PeakV2Score from "../PeakV2Score";
import PeakV2Rule from "../PeakV2Rule";
import PeakV2PrimaryAction from "../PeakV2PrimaryAction";
import PeakV2SecondaryAction from "../PeakV2SecondaryAction";
import PeakDuelV2History from "./PeakDuelV2History";
import { getDailyDistribution } from "@/lib/api";
import { buildShareText } from "@/lib/progress";
import type { GameState } from "@/types";

export interface PeakDuelV2FinalProps {
  state: GameState;
  date?: string;
}

function DistributionRow({ score, count, max, isToday }: { score: number; count: number; max: number; isToday: boolean }) {
  const pct = max > 0 ? Math.max(count > 0 ? 4 : 0, (count / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span
        style={{
          fontFamily: "var(--v2-font-mono)",
          fontSize: "0.6875rem",
          fontWeight: 700,
          color: isToday ? "var(--v2-color-accent)" : "var(--v2-text-muted)",
          width: "2.75rem",
          flexShrink: 0,
        }}
      >
        {score}/10
      </span>
      <div className="relative h-2.5 flex-1 overflow-hidden rounded-sm" style={{ background: "var(--v2-border-subtle)" }}>
        <div
          className="h-full rounded-sm"
          style={{ width: `${pct}%`, background: isToday ? "var(--v2-color-accent)" : "var(--v2-text-muted)" }}
        />
      </div>
      <span
        style={{
          fontFamily: "var(--v2-font-mono)",
          fontSize: "0.75rem",
          color: "var(--v2-text-secondary)",
          width: "1.5rem",
          textAlign: "right",
          flexShrink: 0,
        }}
      >
        {count}
      </span>
    </div>
  );
}

export default function PeakDuelV2Final({ state, date }: PeakDuelV2FinalProps) {
  const [shared, setShared] = useState(false);
  const [distribution, setDistribution] = useState<{ total: number; counts: number[] } | null>(null);

  const correct = state.results.filter((r) => r.correct).length;

  useEffect(() => {
    let cancelled = false;
    // `GameEngine`'s own completion effect fires `postDailyResult` on this
    // exact same phase transition, in a sibling component. A short delay
    // here — not a second write, not a guess at the record — gives that
    // real POST its normal round trip so this GET reads a histogram that
    // already includes today's just-finished attempt, rather than racing
    // it and reporting a truthful-but-stale count for one refresh.
    const id = window.setTimeout(() => {
      getDailyDistribution()
        .then((d) => {
          if (!cancelled) setDistribution(d);
        })
        .catch(() => {
          // Fail closed — no histogram is the honest state, never a fake one.
        });
    }, 600);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, []);

  const handleShare = async () => {
    const text = buildShareText(date ?? new Date().toISOString().split("T")[0], state.results);
    if (navigator.share) {
      try {
        await navigator.share({ text });
        setShared(true);
      } catch {
        /* user cancelled the share sheet — not an error */
      }
    } else {
      await navigator.clipboard.writeText(text);
      setShared(true);
    }
    setTimeout(() => setShared(false), 2000);
  };

  const maxCount = distribution ? Math.max(...distribution.counts, 1) : 1;

  return (
    <PeakV2CinematicStage light={{ y: "-8%" }}>
      <p
        style={{
          fontFamily: "var(--v2-font-ui)",
          fontSize: "0.75rem",
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--v2-color-accent)",
          margin: 0,
        }}
      >
        Today&apos;s duel · complete
      </p>
      <div className="mt-4 flex items-baseline gap-2">
        <PeakV2ResultHeadline as="h1" scale="hero" tone="accent">
          {correct}
        </PeakV2ResultHeadline>
        <span
          style={{
            fontFamily: "var(--v2-font-display)",
            fontSize: "var(--v2-display-size-moment)",
            color: "var(--v2-text-primary)",
            opacity: 0.5,
          }}
        >
          /10
        </span>
      </div>

      <div className="mt-4 flex items-center gap-1" aria-hidden="true">
        {state.results.map((r, i) => (
          <span
            key={i}
            style={{
              width: 16,
              height: 4,
              borderRadius: 1,
              background: r.correct ? "var(--v2-color-positive)" : "var(--v2-color-negative)",
            }}
          />
        ))}
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-8">
        <PeakV2Score value={state.total_arena_points.toLocaleString()} label="Arena points" size="lg" />
        <PeakV2Score value={state.best_streak} label="Best streak" size="lg" />
      </div>

      <PeakDuelV2History />

      {distribution && distribution.total > 0 ? (
        <div className="mt-12 w-full max-w-md text-left">
          <PeakV2Rule spacing="sm" />
          <p
            style={{
              fontFamily: "var(--v2-font-ui)",
              fontSize: "0.75rem",
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--v2-text-muted)",
            }}
          >
            Where today sits · {distribution.total} finished {distribution.total === 1 ? "daily" : "dailies"}
          </p>
          <div className="mt-4 flex flex-col gap-2">
            {distribution.counts.map((count, score) => (
              <DistributionRow key={score} score={score} count={count} max={maxCount} isToday={score === correct} />
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
        <PeakV2PrimaryAction onClick={handleShare}>
          {shared ? (
            <>
              <Check size={14} /> Copied
            </>
          ) : (
            <>
              <Share2 size={14} /> Share today
            </>
          )}
        </PeakV2PrimaryAction>
        <PeakV2SecondaryAction href="/play/endless">Play Endless Mode</PeakV2SecondaryAction>
        <Link
          href="/rankings"
          className="text-xs underline underline-offset-2"
          style={{ fontFamily: "var(--v2-font-ui)", color: "var(--v2-text-secondary)" }}
        >
          See all rankings
        </Link>
      </div>
    </PeakV2CinematicStage>
  );
}
