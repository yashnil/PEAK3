/**
 * PeakDuelV2AlreadyCompleted — the V2 presentation for a returning player
 * who already finished today's duel (Pass 3 polish pass).
 *
 * Before this component existed, `/play/daily` rendered ONE hardcoded
 * (legacy-styled: `card-elevated`, rounded corners, no display typography)
 * "Already completed!" card regardless of `?ui=` — the one place in the
 * Peak Duel flow where a V2 visitor fell straight back into the legacy
 * shell. This mirrors `PeakDuelV2Final`'s own grammar (same eyebrow,
 * hero-scale serif score, dash strip, `PeakV2Score` instrument pair) since
 * it is the same conceptual moment — "today's duel, done" — just reached by
 * a reload instead of a fresh finish.
 *
 * `DailyCompletion` (see `types/index.ts`) only persists AGGREGATES
 * (correct/total/arena_points/best_streak) plus a `{correct, difficulty}`
 * pair per duel — not full `DuelResult`s. That is why this screen has no
 * Share action: `buildShareText` needs `arena_points_awarded` /
 * `score_gap` / `answer_response` per duel, which were never stored for a
 * completed-and-reloaded session, and inventing those numbers would be
 * fabricated data. "Play Endless Mode" is the one real action offered here,
 * same as legacy.
 */

import PeakV2CinematicStage from "../PeakV2CinematicStage";
import PeakV2ResultHeadline from "../PeakV2ResultHeadline";
import PeakV2Score from "../PeakV2Score";
import PeakV2PrimaryAction from "../PeakV2PrimaryAction";
import PeakDuelV2History from "./PeakDuelV2History";
import type { DailyCompletion } from "@/types";

export interface PeakDuelV2AlreadyCompletedProps {
  completion: DailyCompletion | null;
  countdownLabel: string;
}

export default function PeakDuelV2AlreadyCompleted({ completion, countdownLabel }: PeakDuelV2AlreadyCompletedProps) {
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
        Daily duel · complete
      </p>

      <div className="mt-4 flex items-baseline gap-2">
        <PeakV2ResultHeadline as="h1" scale="hero" tone="accent">
          {completion?.correct ?? 0}
        </PeakV2ResultHeadline>
        <span
          style={{
            fontFamily: "var(--v2-font-display)",
            fontSize: "var(--v2-display-size-moment)",
            color: "var(--v2-text-primary)",
            opacity: 0.5,
          }}
        >
          /{completion?.total ?? 10}
        </span>
      </div>

      {completion ? (
        <div className="mt-4 flex items-center gap-1" aria-hidden="true">
          {completion.results.map((r, i) => (
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
      ) : null}

      <div className="mt-8 flex flex-wrap items-center justify-center gap-8">
        <PeakV2Score value={(completion?.arena_points ?? 0).toLocaleString()} label="Arena points" size="lg" />
        <PeakV2Score value={completion?.best_streak ?? 0} label="Best streak" size="lg" />
      </div>

      {/* Re-derived purely from storage/API on this cold load — no
          `GameState` exists here at all (this screen is reached by a
          reload, not a fresh finish), which is exactly the case that
          proves the grid survives a browser restart rather than only
          looking that way right after finishing. */}
      <PeakDuelV2History />

      <p
        className="mt-8"
        data-testid="daily-duel-countdown"
        style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem", color: "var(--v2-text-secondary)" }}
      >
        {countdownLabel}
      </p>

      <div className="mt-6">
        <PeakV2PrimaryAction href="/play/endless">Play Endless Mode</PeakV2PrimaryAction>
      </div>
    </PeakV2CinematicStage>
  );
}
