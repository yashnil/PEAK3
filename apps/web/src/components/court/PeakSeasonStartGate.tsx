"use client";
import { useCallback, useEffect, useState } from "react";
import { createCourtGame, getCourtGame, PerfectSeasonAPIError } from "@/lib/perfect-season-api";
import { CourtLineupPublicState, COURT_MODE_LABELS, CourtMode } from "@/types/perfect-season";
import CourtBuilder from "./CourtBuilder";

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
  rollableTeamSeasonCount?: number;
  supportedStartSeason?: string | null;
  supportedEndSeason?: string | null;
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
  rollableTeamSeasonCount = 0,
  supportedStartSeason = null,
  supportedEndSeason = null,
  teamLogoUrls = {},
}: Props) {
  const [game, setGame] = useState<CourtLineupPublicState | null>(null);
  const [busy, setBusy] = useState(false);
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
    if (resumeGameId) void resume(resumeGameId);
  }, [resumeGameId, resume]);

  async function handleBegin() {
    setBusy(true);
    setError(null);
    try {
      setGame(
        await createCourtGame(mode, seed, {
          challengeKind,
          challengeDate,
        }),
      );
    } catch (e) {
      const code = e instanceof PerfectSeasonAPIError ? e.code : undefined;
      setError(
        code === "courtbuilder_not_enabled"
          ? "82-0 Peak Season is not enabled in this environment yet."
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
        rollableTeamSeasonCount={rollableTeamSeasonCount}
        supportedStartSeason={supportedStartSeason}
        supportedEndSeason={supportedEndSeason}
        teamLogoUrls={teamLogoUrls}
      />
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10" data-testid="peak-season-start-gate">
      <div
        className="rounded-2xl border p-6 flex flex-col gap-4"
        style={{ background: "var(--bg-elevated)", borderColor: "var(--peak-accent, #f5c842)" }}
      >
        <div
          className="flex items-center gap-2 flex-wrap"
          data-testid={isDaily ? "daily-challenge-header" : undefined}
        >
          <span
            className="text-[10px] font-black uppercase tracking-widest rounded-full px-2.5 py-1"
            style={
              isDaily
                ? { background: "rgba(96,165,250,0.15)", color: "#60a5fa" }
                : { background: "rgba(245,200,66,0.15)", color: "var(--peak-accent, #f5c842)" }
            }
          >
            {isDaily ? "Daily PEAK Season" : "82-0 Peak Season"}
          </span>
          <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            {COURT_MODE_LABELS[mode] ?? mode}
          </span>
        </div>

        <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
          {isDaily ? "Today's shared challenge" : "Build a perfect season"}
        </h1>

        <ol className="flex flex-col gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          <li className="flex gap-2.5">
            <Step n={1} />
            <span>
              The wheel rolls a <strong>real NBA team and an exact season</strong> — eight times, once per
              roster spot.
            </span>
          </li>
          <li className="flex gap-2.5">
            <Step n={2} />
            <span>
              Pick one player from that exact team-season and <strong>place them on the court</strong> — five
              starters by position, three on the bench.
            </span>
          </li>
          <li className="flex gap-2.5">
            <Step n={3} />
            <span>
              Ratings stay hidden until the end. Then PEAK3 simulates your lineup and you{" "}
              <strong>chase 82-0</strong>.
            </span>
          </li>
          <li className="flex gap-2.5">
            <Step n={4} />
            <span>
              Get a full receipt — including what PEAK3 itself would have picked — then{" "}
              <strong>save, share, or beat your personal best</strong>.
            </span>
          </li>
        </ol>

        {isDaily && (
          <p
            className="text-xs rounded-lg p-3"
            style={{ background: "var(--bg-surface)", color: "var(--text-muted)" }}
            data-testid="start-gate-daily-note"
          >
            Everyone gets this exact spin sequence today
            {challengeDate ? ` (${challengeDate}, UTC)` : ""} — same teams, same seasons, same candidates.
          </p>
        )}

        {error && (
          <p role="alert" className="text-sm" style={{ color: "#ef4444" }} data-testid="start-gate-error">
            {error}
          </p>
        )}

        <button
          data-testid="begin-run-btn"
          onClick={handleBegin}
          disabled={busy}
          className="self-start px-6 py-3 rounded-lg text-sm font-bold uppercase tracking-wide disabled:opacity-60"
          style={{ background: "var(--peak-accent, #f5c842)", color: "#000" }}
        >
          {busy ? "Starting…" : isDaily ? "Begin Daily Run" : "Begin 82-0 Run"}
        </button>

        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Nothing starts until you press begin. No account needed to play — signing in only adds saved
          runs and personal bests.
        </p>
      </div>
    </div>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span
      aria-hidden="true"
      className="shrink-0 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center mt-0.5"
      style={{ background: "var(--bg-surface)", color: "var(--peak-accent, #f5c842)" }}
    >
      {n}
    </span>
  );
}
