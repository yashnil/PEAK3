"use client";
import { DailyDescriptor, RulesetMeta, RunReadiness, RunType } from "@/types/run-the-table";
import type { ChallengeDescriptor } from "@/lib/run-the-table-api";
import { TourLauncher } from "@/components/ui/GuidedTour";
import {
  NODE_TYPE_COPY,
  PERK_TERM,
  RTT_COPY,
  creditSinkPlainEffect,
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
 *
 * LAUNCH-POLISH LP2-3. "Today's run" used to render unconditionally, co-equal
 * with "Start a run", on every visit to this gate — including a bare visit
 * with no `?mode=daily`, which made it a THIRD public entry point into daily
 * play with nothing distinguishing it from Standard for a visitor who had no
 * reason yet to care (see `docs/implementation/launch-polish/
 * RTT_DAILY_EVIDENCE.md`). It now renders only when `preferredMode==="daily"`
 * — i.e. only for someone who actually arrived via a preserved
 * `?mode=daily` link (an old bookmark, a forwarded URL). The route, the
 * button and the start flow underneath are otherwise untouched: an existing
 * link still works exactly as it always has, it is simply no longer offered
 * to a visitor who did not already ask for it.
 */
interface Props {
  readiness: RunReadiness | null;
  daily: DailyDescriptor | null;
  /**
   * `GET /run-the-table/meta` — the whole ruleset, static and cacheable.
   *
   * THIS IS WHAT REPLACED THE HARDCODED COUNTS. The gate used to print "three
   * acts, three lives" in prose; both were literals, both were already wrong by
   * v2, and nothing could catch it because a sentence is not a value. Every
   * count on this card now comes from `run_shape` / `economy` / `battle`, and a
   * missing meta simply drops the sentence rather than guessing.
   */
  meta?: RulesetMeta | null;
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
  meta,
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

  // Every count below is the server's or it is not printed. See `Props.meta`.
  const acts = meta?.run_shape?.acts ?? null;
  const battles = meta?.run_shape?.battles ?? null;
  const lives = meta?.economy?.starting_lives ?? null;
  const lanesToWin = meta?.battle?.lanes_to_win ?? null;
  const sinks = meta?.credit_sinks ?? [];

  return (
    <div className="mx-auto max-w-2xl" data-testid="rtt-start-gate">
      <div
        className="rounded-2xl border p-6 flex flex-col gap-4"
        style={{ background: "var(--bg-elevated)", borderColor: "var(--peak-accent)" }}
      >
        <span
          className="self-start text-[10px] font-black uppercase tracking-widest rounded-full px-2.5 py-1"
          style={{ background: "var(--peak-accent-bg)", color: "var(--peak-accent-text)" }}
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
              Take one of two nodes per stage
              {acts ? <> across <strong data-testid="rtt-gate-acts">{acts} acts</strong></> : null}.{" "}
              {RTT_COPY.branch}
            </span>
          </li>
          <li className="flex gap-2.5">
            <Step n={3} />
            <span>
              At the end of each act, your five starters and two bench play a boss lineup across the{" "}
              <strong>five PEAK3 component lanes</strong>. {lanesToWinSentence(lanesToWin)}
            </span>
          </li>
          <li className="flex gap-2.5">
            <Step n={4} />
            <span>
              {/* NO LITERAL COUNTS. This sentence used to read "you have three
                  lives" and was hardcoded; `lives` and `battles` now come from
                  `GET /meta`, and if that fetch failed the clause is simply
                  omitted rather than guessed. */}
              {battles ? (
                <span data-testid="rtt-gate-battles">
                  {battles} boss battles in a run
                  {lives ? <>, and you have <span data-testid="rtt-gate-lives">{lives} lives</span></> : null}.{" "}
                </span>
              ) : (
                <>Every act ends in a boss battle. </>
              )}
              {RTT_COPY.lifeLoss} Finish and you get a full receipt — MVP, best buy, closest
              battle — then run it back or challenge a friend on the same seed.
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
                  style={{ color: copy.accentTextVar }}
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

        {/* The four published credit sinks, with their prices, BEFORE the run.
            Prices come from `config.CREDIT_SINKS` through `GET /meta` — nothing
            here restates one, so a re-tune moves this list automatically. */}
        {sinks.length > 0 && (
          <div className="flex flex-col gap-1.5" data-testid="rtt-gate-credit-sinks">
            <span
              className="text-[10px] font-bold uppercase tracking-widest"
              style={{ color: "var(--text-muted)" }}
            >
              What credits buy besides players
            </span>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {sinks.map((sink) => (
                <li
                  key={sink.id}
                  className="flex flex-col gap-0.5 rounded-lg px-3 py-2"
                  style={{ background: "var(--bg-surface)" }}
                  data-testid={`rtt-gate-sink-${sink.id}`}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span
                      className="text-xs font-bold"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {sink.name}
                    </span>
                    <span
                      className="score-number shrink-0 text-[11px] font-bold"
                      style={{ color: "var(--peak-accent-text)" }}
                    >
                      {sink.cost} cr
                    </span>
                  </span>
                  <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                    {creditSinkPlainEffect(sink.id) ?? sink.summary}
                  </span>
                  <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {sink.limit}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

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
            <strong style={{ color: "var(--peak-accent-text)" }}>Local demo mode.</strong> The card pool
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
                <strong style={{ color: "var(--peak-accent-text)" }}>
                  You were challenged to a board.
                </strong>{" "}
                Seed <span className="score-number">{challenge.seed}</span>
                {challenge.date ? ` (${challenge.date})` : ""} — the same starting roster, the
                same offers and the same bosses the sender played.
              </>
            ) : (
              <>
                <strong style={{ color: "var(--peak-accent-text)" }}>
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
              style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
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
                : { background: "var(--peak-accent)", color: "var(--text-inverse)" }
            }
          >
            {busy ? "Starting…" : "Start a run"}
          </button>
          {/* LP2-3: only offered to a visitor who arrived asking for it —
              see the file docstring. `dailyFirst` already excludes the case
              where a challenge link outranks it. */}
          {dailyFirst && (
            <button
              type="button"
              data-testid="rtt-start-daily"
              onClick={() => onStart("daily")}
              disabled={busy || disabled || dailyDisabled}
              className="rtt-tap rounded-lg px-6 text-sm font-semibold uppercase tracking-wide disabled:opacity-60"
              style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
            >
              Today&apos;s run
            </button>
          )}
        </div>

        {dailyFirst && daily && (
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
      style={{ background: "var(--bg-surface)", color: "var(--peak-accent-text)" }}
    >
      {n}
    </span>
  );
}
