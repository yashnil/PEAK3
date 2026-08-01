"use client";
import { DailyDescriptor, RunReadiness, RunType } from "@/types/run-the-table";
import type { ChallengeDescriptor } from "@/lib/run-the-table-api";
import { TourLauncher } from "@/components/ui/GuidedTour";
import {
  NODE_TYPE_COPY,
  PERK_TERM,
  RTT_COPY,
  lanesToWinSentence,
} from "@/lib/run-the-table-copy";

/**
 * The explicit Start gate.
 *
 * Copied from `PeakSeasonStartGate.tsx`, where it is a tested invariant: a run
 * is a committed thing — it fixes a seed, it is what gets shared and
 * challenged — so it begins on a deliberate click, never on a navigation. No
 * run exists until one of these buttons is pressed.
 *
 * THAT INVARIANT IS WHY THE CHALLENGE BUTTON HAS TO EXIST. A visitor arriving
 * on `?c={token}` still has to press something, and until this button existed
 * the only things to press were "Start a run" and "Today's run" — neither of
 * which passes the token, so a recipient who followed a shared link silently
 * got a fresh random seed and had no way to tell. A challenge link that does
 * not reproduce its board is worse than no link at all.
 *
 * WHAT CHANGED IN THIS PASS. W2's homepage launcher now names the choice it is
 * about to make and links straight to `?start=…`, which W4 consumes, so this
 * gate is no longer the second identical confirmation on the main funnel. It is
 * the DIRECT-VISIT surface: someone who typed the URL, followed a challenge
 * link, or arrived from search. It therefore has to answer "what is this?"
 * before it asks "which mode?" — one sentence, four steps, four node types, and
 * a tour they can take without starting anything.
 */
interface Props {
  readiness: RunReadiness | null;
  daily: DailyDescriptor | null;
  busy: boolean;
  error: string | null;
  /** Set when a stored run pointer could not be resumed — explains why the
   *  player is looking at a gate instead of their run. */
  resumeNotice: string | null;
  onStart: (runType: RunType) => void;
  onRetry: () => void;
  /** Which start button reads as primary. Arriving from "Today's run" should
   *  land on an emphasised daily button, not silently consume the attempt. */
  preferredMode?: "daily";
  /** Present when the URL carried `?c=` — enables the challenge start path. */
  challengeToken?: string;
  /** The token's spoiler-safe descriptor, once resolved. Null while loading or
   *  when the link could not be resolved at all. */
  challenge?: ChallengeDescriptor | null;
  /** Why the token could not be resolved (expired, forged, wrong ruleset). */
  challengeError?: string | null;
}

const NODE_ORDER = ["draft_room", "trade_desk", "film_room", "rest_bank"] as const;

export default function RunStartGate({
  readiness,
  daily,
  busy,
  error,
  resumeNotice,
  onStart,
  onRetry,
  preferredMode,
  challengeToken,
  challenge,
  challengeError,
}: Props) {
  const disabled = readiness?.enabled === false;
  // A challenge link outranks `?mode=daily` for emphasis: the visitor followed
  // a specific board, so that is the button they came to press.
  const hasChallenge = Boolean(challengeToken);
  const dailyFirst = preferredMode === "daily" && !hasChallenge;
  // The card pool is built from generated artifacts, so "not built yet" is a
  // real state on a fresh clone rather than a failure — say so instead of
  // showing a dead button.
  const persistenceDown = readiness?.card_pool?.available === false;
  // A separate flag from `enabled`: the mode can be on while today's shared
  // run is off, and a dead "Today's run" button would be a lie either way.
  const dailyDisabled = readiness?.daily_enabled === false;

  return (
    <div className="mx-auto max-w-2xl" data-testid="rtt-start-gate">
      <div
        className="rounded-2xl border p-6 flex flex-col gap-4"
        style={{ background: "var(--bg-elevated)", borderColor: "var(--peak-accent)" }}
      >
        <span
          className="self-start text-[10px] font-black uppercase tracking-widest rounded-full px-2.5 py-1"
          style={{ background: "var(--peak-accent-bg)", color: "var(--peak-accent)" }}
        >
          Run the Table
        </span>

        <h2 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
          Take over a front office.
        </h2>

        {/* The one sentence. Pinned by
            `run-the-table-components.test.tsx:327` — it is the promise of the
            mode, and every other line on this card is subordinate to it. */}
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {RTT_COPY.promise}
        </p>

        <ol className="flex flex-col gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          <li className="flex gap-2.5">
            <Step n={1} />
            <span>
              Pick a <strong>{PERK_TERM.display}</strong> — receipts call it a{" "}
              {PERK_TERM.internal}. {RTT_COPY.perkBoundary}
            </span>
          </li>
          <li className="flex gap-2.5">
            <Step n={2} />
            <span>
              Take one of two nodes per stage. {RTT_COPY.branch}
            </span>
          </li>
          <li className="flex gap-2.5">
            <Step n={3} />
            <span>
              At the end of each act, your five starters and two bench play a boss lineup across the{" "}
              <strong>five PEAK3 component lanes</strong>. {lanesToWinSentence()}
            </span>
          </li>
          <li className="flex gap-2.5">
            <Step n={4} />
            <span>
              {/* No act count: the gate runs before any run exists, so there is
                  no `acts_total` to thread, and a literal here is exactly the
                  drift `lanesToWinSentence()` was introduced to stop. */}
              Every act ends in a boss battle, and you have three lives. {RTT_COPY.lifeLoss} Finish
              and you get a full receipt — MVP,
              best buy, closest battle — then run it back or challenge a friend on the same seed.
            </span>
          </li>
        </ol>

        {/* The four kinds of node, before the run rather than during it. Each
            one is the same icon, accent and one-clause purpose the map and the
            stage fork use, so nothing here has to be learned twice. */}
        {/* Viewport breakpoint, not a container query: this card is a top-level
            page element with no `@container` ancestor, unlike the in-run
            decision surfaces. */}
        <ul className="grid gap-2 sm:grid-cols-2" data-testid="rtt-node-legend">
          {NODE_ORDER.map((type) => {
            const copy = NODE_TYPE_COPY[type];
            return (
              <li
                key={type}
                className="rounded-lg px-3 py-2 flex flex-col gap-0.5"
                style={{
                  background: "var(--bg-surface)",
                  borderLeft: `3px solid ${copy.accentVar}`,
                }}
              >
                <span
                  className="text-[10px] font-bold uppercase tracking-widest"
                  style={{ color: copy.accentVar }}
                >
                  {copy.label}
                </span>
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {copy.purpose}
                </span>
              </li>
            );
          })}
        </ul>

        {resumeNotice && (
          <p
            className="rounded-lg p-3 text-xs"
            style={{ background: "var(--bg-surface)", color: "var(--text-muted)" }}
            data-testid="rtt-resume-notice"
          >
            {resumeNotice}
          </p>
        )}

        {persistenceDown && (
          <p
            className="rounded-lg p-3 text-xs"
            style={{ background: "var(--bg-surface)", color: "var(--text-secondary)" }}
            data-testid="rtt-local-demo-notice"
          >
            <strong style={{ color: "var(--peak-accent)" }}>Local demo mode.</strong> The card pool
            has not been built in this environment
            {readiness?.card_pool?.error ? ` (${readiness.card_pool.error})` : ""}, so starting a run
            will fail until it is. Run <code>make build-game-data</code> and reload.
          </p>
        )}

        {disabled && (
          <p
            className="rounded-lg p-3 text-xs"
            style={{ background: "var(--bg-surface)", color: "var(--text-secondary)" }}
            data-testid="rtt-disabled-notice"
          >
            RUN THE TABLE is not enabled in this environment yet.
          </p>
        )}

        {error && (
          <div className="flex flex-wrap items-center gap-2" data-testid="rtt-start-error">
            <p role="alert" className="text-sm" style={{ color: "var(--incorrect)" }}>
              {error}
            </p>
            <button
              type="button"
              data-testid="rtt-start-retry"
              onClick={onRetry}
              className="rtt-tap rounded-lg px-3 text-xs font-semibold uppercase tracking-wide"
              style={{
                background: "var(--bg-surface)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-default)",
              }}
            >
              Try again
            </button>
          </div>
        )}

        {hasChallenge && (
          <p
            className="rounded-lg p-3 text-xs"
            style={{ background: "var(--bg-surface)", color: "var(--text-secondary)" }}
            data-testid="rtt-challenge-note"
          >
            {challengeError ? (
              <>
                <strong style={{ color: "var(--incorrect)" }}>
                  This challenge link could not be opened.
                </strong>{" "}
                {challengeError} You can still start a run of your own below.
              </>
            ) : challenge ? (
              <>
                <strong style={{ color: "var(--peak-accent)" }}>
                  You were challenged to a board.
                </strong>{" "}
                Seed <span className="score-number">{challenge.seed}</span>
                {challenge.date ? ` (${challenge.date})` : ""} — the same starting roster, the
                same offers and the same bosses the sender played.
              </>
            ) : (
              <>
                <strong style={{ color: "var(--peak-accent)" }}>
                  You were challenged to a board.
                </strong>{" "}
                Checking the link…
              </>
            )}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {hasChallenge && (
            <button
              type="button"
              data-testid="rtt-start-challenge"
              onClick={() => onStart("challenge")}
              disabled={busy || disabled || Boolean(challengeError)}
              className="rtt-tap rounded-lg px-6 text-sm font-bold uppercase tracking-wide disabled:opacity-60"
              style={{ background: "var(--peak-accent)", color: "#000" }}
            >
              {busy ? "Starting…" : "Play this challenge"}
            </button>
          )}
          <button
            type="button"
            data-testid="rtt-start-standard"
            onClick={() => onStart("standard")}
            disabled={busy || disabled}
            className="rtt-tap rounded-lg px-6 text-sm font-bold uppercase tracking-wide disabled:opacity-60"
            style={
              dailyFirst || hasChallenge
                ? {
                    background: "var(--bg-surface)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border-emphasis)",
                  }
                : { background: "var(--peak-accent)", color: "#000" }
            }
          >
            {busy ? "Starting…" : "Start a run"}
          </button>
          <button
            type="button"
            data-testid="rtt-start-daily"
            onClick={() => onStart("daily")}
            disabled={busy || disabled || dailyDisabled}
            className="rtt-tap rounded-lg px-6 text-sm font-semibold uppercase tracking-wide disabled:opacity-60"
            style={
              dailyFirst
                ? { background: "var(--peak-accent)", color: "#000" }
                : {
                    background: "var(--bg-surface)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border-emphasis)",
                  }
            }
          >
            Today&apos;s run
          </button>
        </div>

        {daily && (
          <p className="text-xs" style={{ color: "var(--text-muted)" }} data-testid="rtt-daily-note">
            Today&apos;s run is {daily.date} (UTC), seed{" "}
            <span className="score-number">{daily.seed}</span> — everyone gets the same acts, the
            same offers and the same bosses.
          </p>
        )}

        {/* The tour, available BEFORE anything is committed.
            `autoStart={false}` on purpose: a walkthrough that opens by itself
            on a page whose only job is "press a button to begin" is a modal in
            front of a call to action. The auto-start belongs to the run shell,
            where the things it spotlights actually exist. With no run on
            screen, every step simply renders centred with no spotlight — the
            documented missing-target degradation. */}
        <div className="flex flex-wrap items-center gap-3">
          <TourLauncher label="Take the tour" autoStart={false} data-testid="rtt-start-tour" />
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Nothing starts until you press a button above.
          </p>
        </div>
      </div>
    </div>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span
      aria-hidden="true"
      className="shrink-0 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center mt-0.5"
      style={{ background: "var(--bg-surface)", color: "var(--peak-accent)" }}
    >
      {n}
    </span>
  );
}
