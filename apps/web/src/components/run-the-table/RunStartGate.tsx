"use client";
import { DailyDescriptor, RulesetMeta, RunReadiness, RunType } from "@/types/run-the-table";
import type { ChallengeDescriptor } from "@/lib/run-the-table-api";
import { TourLauncher } from "@/components/ui/GuidedTour";
import {
  NODE_TYPE_COPY,
  RTT_COPY,
  creditSinkPlainEffect,
  lanesToWinSentence,
} from "@/lib/run-the-table-copy";
import PeakV2Shell from "@/components/v2/PeakV2Shell";
import PeakV2PrimaryAction from "@/components/v2/PeakV2PrimaryAction";
import PeakV2SecondaryAction from "@/components/v2/PeakV2SecondaryAction";

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
      <PeakV2Shell width="cinematic">
        <div className="v2-rtt-gate" data-testid="rtt-start-gate">
          <p className="v2-page-kicker">Run the Table</p>
          <h1 className="v2-page-title" style={{ fontSize: "var(--v2-display-size-line)" }}>
            Take over a front office.
          </h1>
          <p className="v2-page-lede">{RTT_COPY.promise}</p>

          <div className="v2-rtt-gate-nodes">
            {NODE_ORDER.map((type) => {
              const copy = NODE_TYPE_COPY[type];
              return (
                <div key={type} className="v2-rtt-gate-node" style={{ borderTopColor: copy.accentVar }}>
                  <span className="v2-rtt-gate-node-label" style={{ color: copy.accentTextVar }}>
                    {copy.label}
                  </span>
                  <span className="v2-rtt-gate-node-purpose">{copy.purpose}</span>
                </div>
              );
            })}
          </div>

          <div className="v2-rtt-gate-stats">
            {acts ? (
              <div className="v2-rtt-gate-stat" data-testid="rtt-gate-acts">
                <span className="v2-rtt-gate-stat-value">{acts} acts</span>
                <span className="v2-rtt-gate-stat-label">one of two nodes per stage</span>
              </div>
            ) : null}
            {battles ? (
              <div className="v2-rtt-gate-stat" data-testid="rtt-gate-battles">
                <span className="v2-rtt-gate-stat-value">{battles} boss battles</span>
                <span className="v2-rtt-gate-stat-label">decide the run</span>
              </div>
            ) : (
              <div className="v2-rtt-gate-stat">
                <span className="v2-rtt-gate-stat-label">Every act ends in a boss battle.</span>
              </div>
            )}
            {lives ? (
              <div className="v2-rtt-gate-stat" data-testid="rtt-gate-lives">
                <span className="v2-rtt-gate-stat-value">{lives} lives</span>
                <span className="v2-rtt-gate-stat-label">starting</span>
              </div>
            ) : null}
          </div>
          <p className="v2-rtt-gate-rule">{lanesToWinSentence(lanesToWin)}</p>

          {sinks.length > 0 && (
            <details className="v2-rtt-gate-disclosure" data-testid="rtt-gate-credit-sinks">
              <summary>What credits buy besides players</summary>
              <ul>
                {sinks.map((sink) => (
                  <li key={sink.id} data-testid={`rtt-gate-sink-${sink.id}`}>
                    <span className="v2-rtt-gate-sink-row">
                      <strong>{sink.name}</strong>
                      <span className="v2-rtt-gate-sink-cost">{sink.cost} cr</span>
                    </span>
                    <span className="v2-rtt-gate-sink-desc">{creditSinkPlainEffect(sink.id) ?? sink.summary}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {resumeNotice && (
            <p className="v2-rtt-gate-notice" data-testid="rtt-resume-notice">
              {resumeNotice}
            </p>
          )}

          {persistenceDown && (
            <p className="v2-rtt-gate-notice" data-testid="rtt-local-demo-notice">
              <strong style={{ color: "var(--v2-color-accent)" }}>Local demo mode.</strong> The card pool
              has not been built in this environment
              {readiness?.card_pool?.error ? ` (${readiness.card_pool.error})` : ""}, so starting a run
              will fail until it is.
            </p>
          )}

          {disabled && (
            <p className="v2-rtt-gate-notice" data-testid="rtt-disabled-notice">
              Run the Table is not enabled in this environment yet.
            </p>
          )}

          {error && (
            <div className="flex flex-wrap items-center gap-3" data-testid="rtt-start-error">
              <p role="alert" className="v2-rtt-gate-error">
                {error}
              </p>
              <PeakV2SecondaryAction type="button" data-testid="rtt-start-retry" onClick={onRetry} size="sm">
                Try again
              </PeakV2SecondaryAction>
            </div>
          )}

          {hasChallenge && (
            <p className="v2-rtt-gate-notice" data-testid="rtt-challenge-note">
              {challengeError ? (
                <>
                  <strong style={{ color: "var(--v2-color-negative)" }}>This challenge link could not be opened.</strong>{" "}
                  {challengeError} You can still start a run of your own below.
                </>
              ) : challenge ? (
                <>
                  <strong style={{ color: "var(--v2-color-accent)" }}>You were challenged to a board.</strong> Seed{" "}
                  {challenge.seed}
                  {challenge.date ? ` (${challenge.date})` : ""} — the same starting roster, offers and bosses the sender played.
                </>
              ) : (
                <>
                  <strong style={{ color: "var(--v2-color-accent)" }}>You were challenged to a board.</strong> Checking the
                  link…
                </>
              )}
            </p>
          )}

          <div className="flex flex-wrap gap-3 mt-2">
            {hasChallenge && (
              <PeakV2PrimaryAction
                type="button"
                data-testid="rtt-start-challenge"
                onClick={() => onStart("challenge")}
                disabled={busy || disabled || Boolean(challengeError)}
                busy={busy}
              >
                {busy ? "Starting…" : "Play this challenge"}
              </PeakV2PrimaryAction>
            )}
            {dailyFirst || hasChallenge ? (
              <PeakV2SecondaryAction
                type="button"
                data-testid="rtt-start-standard"
                onClick={() => onStart("standard")}
                disabled={busy || disabled}
              >
                {busy ? "Starting…" : "Start a run"}
              </PeakV2SecondaryAction>
            ) : (
              <PeakV2PrimaryAction
                type="button"
                data-testid="rtt-start-standard"
                onClick={() => onStart("standard")}
                disabled={busy || disabled}
                busy={busy}
              >
                {busy ? "Starting…" : "Start a run"}
              </PeakV2PrimaryAction>
            )}
            {dailyFirst && (
              <PeakV2PrimaryAction
                type="button"
                data-testid="rtt-start-daily"
                onClick={() => onStart("daily")}
                disabled={busy || disabled || dailyDisabled}
              >
                Today&apos;s run
              </PeakV2PrimaryAction>
            )}
          </div>

          {dailyFirst && daily && (
            <p className="v2-rtt-gate-footnote" data-testid="rtt-daily-note">
              Today&apos;s run is {daily.date} (UTC), seed{" "}
              <span className="score-number">{daily.seed}</span> — everyone gets the same acts,
              offers and bosses.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 mt-1">
            <TourLauncher label="Take the tour" autoStart={false} data-testid="rtt-start-tour" />
          </div>
        </div>
      </PeakV2Shell>
  );
}
