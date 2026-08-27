"use client";
import { useCallback, useEffect, useState } from "react";
import { createCourtGame, getCourtGame, PerfectSeasonAPIError } from "@/lib/perfect-season-api";
import { useAuth } from "@/lib/auth-context";
import { CourtDifficulty, CourtLineupPublicState, CourtMode } from "@/types/perfect-season";
import CourtBuilder from "./CourtBuilder";
import PeakV2Shell from "@/components/v2/PeakV2Shell";
import PeakV2PrimaryAction from "@/components/v2/PeakV2PrimaryAction";

interface Props {
  mode: CourtMode;
  /** "free_play" gates the practice route; "daily" gates today's shared
   * challenge (different copy + a date-derived server-side seed). */
  challengeKind: "free_play" | "daily";
  /** Free-play only: an explicit replayable seed from `?seed=`. Ignored for a
   * daily board, where the server always derives the seed from the date. */
  seed?: number;
  /** Daily only: `?date=` for replaying an earlier day. */
  challengeDate?: string;
  /** `?game=<id>` — resume an already-created attempt. When present the gate
   * is skipped entirely (there is nothing to "begin"; the run already
   * exists), which is what keeps direct/shared links working. */
  resumeGameId?: string;
  franchiseNames: string[];
  seasonLabels?: string[];
  teamLogoUrls?: Record<string, string>;
}

/**
 * Phase 9B: the explicit Start gate.
 *
 * ROOT CAUSE this fixes: game creation used to happen in the ROUTE's server
 * component, so merely following the "Try 82-0" CTA created a game and
 * started the spin ceremony before the user had agreed to anything. A run is
 * a committed thing -- it burns the day's daily attempt, it's what gets
 * saved/shared, and its board is fixed the instant it's created -- so it
 * should begin on a deliberate click, not on a navigation.
 *
 * The fix is structural, not a confirm dialog: the route now only fetches
 * the READINESS catalog (needed to render the reels) and hands it here. No
 * game exists until `handleBegin` runs. That also means a user who lands on
 * the page and leaves has consumed nothing.
 *
 * Deliberately NOT gated: resuming via `?game=<id>`, which skips straight to
 * the board -- there's no "begin" decision left to make for a run that
 * already exists, and gating it would break shared/direct links.
 */
export default function PeakSeasonStartGate({
  mode,
  challengeKind,
  seed,
  challengeDate,
  resumeGameId,
  franchiseNames,
  seasonLabels = [],
  teamLogoUrls = {},
}: Props) {
  const [game, setGame] = useState<CourtLineupPublicState | null>(null);
  const [busy, setBusy] = useState(false);
  // Gameplay-polish: chosen here, before a run exists, and passed straight
  // into `createCourtGame` -- the server freezes it onto the run for good
  // (CourtLineupState.difficulty), so there is no later "change difficulty"
  // control anywhere in the game itself. Easy by default: it is a strict
  // superset of Hard's affordances (the same 3+3 respins, plus a hint Hard
  // never gets), so it is the safer thing to land on without having read
  // the tradeoff yet.
  const [difficulty, setDifficulty] = useState<CourtDifficulty>("easy");
  /**
   * Wait for the Supabase session before touching the API.
   *
   * `AuthProvider` resolves the session in an effect, so for the first moments
   * after hydration `getAccessToken()` returns null even for a signed-in
   * player. A create issued in that window carries no bearer, and the API
   * quite correctly files the run under a guest subject -- the run is then
   * owned by somebody who is not the person looking at it, permanently.
   *
   * Nothing retries and nothing is hidden: the request is simply not made
   * until the identity that will own it is known. `loading` is false almost
   * immediately (and is false from the start when auth is not configured), so
   * anonymous play is not delayed in any perceptible way.
   */
  const { loading: authLoading } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const isDaily = challengeKind === "daily";

  const resume = useCallback(async (gameId: string) => {
    setBusy(true);
    setError(null);
    try {
      setGame(await getCourtGame(gameId));
    } catch (e) {
      setError(
        e instanceof PerfectSeasonAPIError && e.status === 404
          ? "That run has expired or doesn't exist. Start a new one below."
          : "Could not load that run. Start a new one below.",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    // Also gated on auth: a resume fired pre-hydration reads the run as a
    // guest and 403s against the player's own run.
    if (authLoading) return;
    if (resumeGameId) void resume(resumeGameId);
  }, [resumeGameId, resume, authLoading]);

  async function handleBegin() {
    // Belt and braces: the button is disabled while `authLoading`, but a
    // keyboard activation racing the state update must not slip through.
    if (authLoading) return;
    setBusy(true);
    setError(null);
    try {
      setGame(
        await createCourtGame(mode, seed, {
          challengeKind,
          challengeDate,
          difficulty,
        }),
      );
    } catch (e) {
      const code = e instanceof PerfectSeasonAPIError ? e.code : undefined;
      setError(
        code === "courtbuilder_not_enabled"
          ? "82-0 PEAK Season is not enabled in this environment yet."
          : code === "invalid_challenge_date"
            ? "That isn't a valid challenge date. Try today's Daily PEAK Season instead."
            : "Could not start a run. Is the API running?",
      );
    } finally {
      setBusy(false);
    }
  }

  if (game) {
    return (
      <CourtBuilder
        initialGameState={game}
        franchiseNames={franchiseNames}
        seasonLabels={seasonLabels}
        teamLogoUrls={teamLogoUrls}
      />
    );
  }

  return (
      <PeakV2Shell width="cinematic">
        <div className="v2-rtt-gate" data-testid="peak-season-start-gate">
          <p className="v2-page-kicker" data-testid={isDaily ? "daily-challenge-header" : undefined}>
            {isDaily ? "Daily PEAK Season" : "82-0 PEAK Season"}
          </p>
          <h1 className="v2-page-title" style={{ fontSize: "var(--v2-display-size-line)" }}>
            {isDaily ? "Today's shared challenge" : "Build a perfect season."}
          </h1>
          <p className="v2-page-lede">
            Spin a real NBA team-season, draft exact player-season cards, place them on the
            court, and chase 82-0 with receipts.
          </p>

          {/* The four things a first-time player needs to know before
              committing to a run -- ported from the pre-V2 gate's own
              numbered steps (the V2-only rewrite condensed this to just the
              lede above and dropped it entirely, not a deliberate product
              simplification: nothing documents removing it, and it's the
              same real detail the lede's own sentence already promises). */}
          <ol className="flex flex-col gap-2" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem", color: "var(--v2-text-secondary)" }}>
            <li className="flex gap-2.5">
              <StepMarker n={1} />
              <span>
                The wheel rolls a <strong>real NBA team and an exact season</strong> — eight times, once per
                roster spot.
              </span>
            </li>
            <li className="flex gap-2.5">
              <StepMarker n={2} />
              <span>
                Pick one player from that exact team-season and <strong>place them on the court</strong> — five
                starters by position, three on the bench.
              </span>
            </li>
            <li className="flex gap-2.5">
              <StepMarker n={3} />
              <span>
                Ratings stay hidden until the end. Then PEAK3 simulates your lineup and you{" "}
                <strong>chase 82-0</strong>.
              </span>
            </li>
            <li className="flex gap-2.5">
              <StepMarker n={4} />
              <span>
                Get a full receipt — including what PEAK3 itself would have picked — then{" "}
                <strong>save, share, or beat your personal best</strong>.
              </span>
            </li>
          </ol>

          {isDaily && (
            <p className="v2-rtt-gate-notice" data-testid="start-gate-daily-note">
              Everyone gets this exact spin sequence today
              {challengeDate ? ` (${challengeDate}, UTC)` : ""} — same teams, same seasons, same
              candidates.
            </p>
          )}

          <div data-testid="difficulty-selector">
            <span className="v2-slate-heading" style={{ display: "block", marginBottom: "var(--v2-space-2)" }}>
              Difficulty
            </span>
            <div className="v2-rtt-gate-nodes" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
              <button
                type="button"
                data-testid="difficulty-easy-btn"
                onClick={() => setDifficulty("easy")}
                aria-pressed={difficulty === "easy"}
                className="v2-rtt-gate-node v2-difficulty-node"
                data-selected={difficulty === "easy" ? "true" : undefined}
                style={{ borderTopColor: "var(--v2-color-accent)", textAlign: "left" }}
              >
                <span className="v2-rtt-gate-node-label" style={{ color: "var(--v2-color-accent)" }}>
                  Easy
                </span>
                <span className="v2-rtt-gate-node-purpose">
                  3 team + 3 season respins for the run, plus a one-time hint.
                </span>
              </button>
              <button
                type="button"
                data-testid="difficulty-hard-btn"
                onClick={() => setDifficulty("hard")}
                aria-pressed={difficulty === "hard"}
                className="v2-rtt-gate-node v2-difficulty-node"
                data-selected={difficulty === "hard" ? "true" : undefined}
                style={{ borderTopColor: "var(--v2-color-negative)", textAlign: "left" }}
              >
                <span className="v2-rtt-gate-node-label" style={{ color: "var(--v2-color-negative)" }}>
                  Hard
                </span>
                <span className="v2-rtt-gate-node-purpose">
                  Only 1 team + 1 season respin for the run, no hint.
                </span>
              </button>
            </div>
          </div>

          {error && (
            <p role="alert" className="v2-rtt-gate-error" data-testid="start-gate-error">
              {error}
            </p>
          )}

          <PeakV2PrimaryAction
            type="button"
            data-testid="begin-run-btn"
            onClick={handleBegin}
            disabled={busy || authLoading}
            busy={busy}
            className="self-start mt-1"
          >
            {authLoading ? "Checking your session…" : busy ? "Starting…" : isDaily ? "Begin Daily Run" : "Begin 82-0 Run"}
          </PeakV2PrimaryAction>

          <p className="v2-rtt-gate-footnote">
            Nothing starts until you press begin. No account needed to play — signing in only adds
            saved runs and personal bests.
          </p>
        </div>
      </PeakV2Shell>
  );
}

function StepMarker({ n }: { n: number }) {
  return (
    <span
      aria-hidden="true"
      className="shrink-0 flex items-center justify-center mt-0.5"
      style={{
        width: 20,
        height: 20,
        borderRadius: "50%",
        fontFamily: "var(--v2-font-mono)",
        fontSize: "0.625rem",
        fontWeight: 700,
        background: "var(--v2-bg-plane)",
        color: "var(--v2-color-accent)",
      }}
    >
      {n}
    </span>
  );
}
