"use client";
import { useRef, useState } from "react";
import { Camera, Check, Copy, Link as LinkIcon, RotateCcw, Repeat } from "lucide-react";
import PlayerAvatar from "@/components/court/PlayerAvatar";
import { MapAct, RunReceipt, RunVersions } from "@/types/run-the-table";
import {
  DECIDED_BY_LABELS,
  buildRunShareText,
  challengeUrl,
  formatReceiptItem,
  formatSigned,
  ladderRows,
  outcomeColorVar,
  receiptItemColorVar,
  receiptItems,
  receiptLaneProfile,
  runOutcome,
  runVerdict,
  signedColorVar,
  slotLabel,
  trackRunTheTable,
} from "@/lib/run-the-table-state";
import {
  PERK_EXACT_RULE_LABEL,
  perkPlainEffect,
  perkStrategyHint,
} from "@/lib/run-the-table-copy";
import { drawShareCard } from "@/lib/run-the-table-share-card";
// Lives with the surface that needed a counting result number first; see its
// own docstring for why it is not `AnimatedNumber` directly.
import { ResultNumber } from "@/components/game/result-number";
import LaneProfile from "./LaneProfile";

/**
 * The run receipt — restructured to the twelve sections
 * PRODUCT_EXPERIENCE_CONTRACT.md §6 specifies, in order, each visually
 * distinct in weight. Every claim on this screen is still a field on
 * `build_receipt()` (or, for the decision timeline, `state.map`) — the
 * MVP's marginal contribution, the best acquisition's value per credit,
 * the closest battle's tightest lane margin, the explanation lines.
 * Nothing is re-derived, ranked or editorialised beyond picking WHICH
 * already-sent field to lead with (e.g. "largest mistake" is the most
 * negative value already present across `best_acquisition`/`best_trade`/
 * `marginal_contributions` — never a new comparison the engine did not
 * already make available).
 *
 * §2.2's verdict retirement and §2.3's kind-driven receipt-item colour both
 * still apply exactly as before; see the git history for that reasoning if
 * you are looking for it — it did not change in this pass, only its
 * position on the page did (§6 item 1: the verdict is now the single
 * largest, highest-contrast element, first in DOM order, not an
 * `text-[11px]` caption under the headline).
 *
 * The confirmation pattern is ShareRunPanel's: a button's own label swaps
 * for two seconds. No toast.
 */
interface Props {
  receipt: RunReceipt;
  versions: RunVersions;
  busy: boolean;
  /** `state.acts_total`. Optional: without it the outcome is derived from the
   *  battles on the receipt, which can only under-report "reached the final
   *  boss" and never claims a clear that did not happen. */
  actsTotal?: number | null;
  /** `state.map` — the completed run's ladder, for the decision timeline
   *  (§6 item 10). Optional so a caller that genuinely cannot supply it
   *  (an old saved receipt with no live run behind it) still renders every
   *  other section rather than crashing; the timeline section is simply
   *  omitted, never faked. */
  map?: MapAct[] | null;
  onRunItBack: () => void;
  onReplaySeed: () => void;
  onChallenge: () => Promise<string | null>;
}

type CopiedKind = "summary" | "challenge" | null;

export default function RunResult({
  receipt,
  versions,
  busy,
  actsTotal,
  map,
  onRunItBack,
  onReplaySeed,
  onChallenge,
}: Props) {
  const [copied, setCopied] = useState<CopiedKind>(null);
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const [shareImageReady, setShareImageReady] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const roster = [...receipt.starters, ...receipt.bench];
  const outcome = runOutcome(receipt, actsTotal);
  const verdict = runVerdict(receipt, actsTotal);
  const stampColor = outcomeColorVar(outcome);
  const items = receiptItems(receipt);

  function flash(kind: Exclude<CopiedKind, null>) {
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 2000);
  }

  async function handleCopySummary() {
    try {
      await navigator.clipboard.writeText(buildRunShareText(receipt));
      trackRunTheTable({ type: "rtt_shared", surface: "summary" });
      flash("summary");
    } catch {
      // Clipboard blocked — no crash, just no confirmation.
    }
  }

  async function handleChallenge() {
    setChallengeError(null);
    try {
      const token = await onChallenge();
      if (!token) {
        setChallengeError("Could not create a challenge link. Try again.");
        return;
      }
      await navigator.clipboard.writeText(challengeUrl(token));
      flash("challenge");
    } catch {
      setChallengeError("Could not create a challenge link. Try again.");
    }
  }

  /** §6 item 11 — a REAL rendered image, not a re-label of the clipboard
   *  action above (which stays, unchanged, as its own button). Draws once
   *  into an offscreen canvas and offers it as a PNG download. */
  function handleShareCard() {
    const canvas = canvasRef.current ?? document.createElement("canvas");
    canvasRef.current = canvas;
    drawShareCard(canvas, receipt, actsTotal);
    setShareImageReady(true);
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `run-the-table-${receipt.seed}.png`;
    a.click();
    trackRunTheTable({ type: "rtt_shared", surface: "card" });
  }

  // ---- §6 item 4: most valuable transaction (promoted, not duplicated) ----
  const bestAcq = receipt.best_acquisition;
  const bestTrade = receipt.best_trade;
  const mostValuable: { kind: "acquisition"; data: NonNullable<typeof bestAcq> } | { kind: "trade"; data: NonNullable<typeof bestTrade> } | null =
    bestAcq && bestTrade
      ? bestAcq.score_delta >= bestTrade.score_delta
        ? { kind: "acquisition", data: bestAcq }
        : { kind: "trade", data: bestTrade }
      : bestAcq
        ? { kind: "acquisition", data: bestAcq }
        : bestTrade
          ? { kind: "trade", data: bestTrade }
          : null;
  const runnerUp = mostValuable?.kind === "acquisition" ? bestTrade : mostValuable?.kind === "trade" ? bestAcq : null;

  // ---- §6 item 5: largest mistake — the most negative value ALREADY on the
  // receipt, never a new comparison. Priority: a "best" transaction that was
  // still a net loss outranks a merely-underperforming roster player, since
  // it is the more legible story ("your best move still cost you"). ----
  const worstContribution =
    receipt.marginal_contributions.length > 0
      ? receipt.marginal_contributions.reduce((min, c) =>
          c.marginal_contribution < min.marginal_contribution ? c : min,
        )
      : null;
  type Mistake = { label: string; detail: React.ReactNode; delta: number };
  const mistakeCandidates: Mistake[] = [];
  if (bestAcq && bestAcq.score_delta < 0) {
    mistakeCandidates.push({
      label: "Worst acquisition",
      delta: bestAcq.score_delta,
      detail: (
        <>
          <strong style={{ color: "var(--text-primary)" }}>{bestAcq.player_name}</strong> for{" "}
          <span className="score-number">{bestAcq.cost}</span> credits in Act{" "}
          <span className="score-number">{bestAcq.act}</span> —{" "}
          <span className="score-number" style={{ color: "var(--incorrect)" }}>
            {formatSigned(bestAcq.score_delta, 2)}
          </span>{" "}
          PEAK3 over {bestAcq.replaced?.player_name ?? "an empty slot"}.
        </>
      ),
    });
  }
  if (bestTrade && bestTrade.score_delta < 0) {
    mistakeCandidates.push({
      label: "Worst trade",
      delta: bestTrade.score_delta,
      detail: (
        <>
          <strong style={{ color: "var(--text-primary)" }}>{bestTrade.incoming.player_name}</strong> for{" "}
          {bestTrade.outgoing.player_name} — net{" "}
          <span className="score-number">{bestTrade.net_cost}</span> credits,{" "}
          <span className="score-number" style={{ color: "var(--incorrect)" }}>
            {formatSigned(bestTrade.score_delta, 2)}
          </span>{" "}
          PEAK3.
        </>
      ),
    });
  }
  if (worstContribution && worstContribution.marginal_contribution < 0) {
    mistakeCandidates.push({
      label: "Weakest roster spot",
      delta: worstContribution.marginal_contribution,
      detail: (
        <>
          <strong style={{ color: "var(--text-primary)" }}>{worstContribution.player_name}</strong>{" "}
          {worstContribution.anchor_season} — the roster would have scored{" "}
          <span className="score-number" style={{ color: "var(--correct)" }}>
            {formatSigned(-worstContribution.marginal_contribution, 2)}
          </span>{" "}
          higher without them.
        </>
      ),
    });
  }
  const largestMistake =
    mistakeCandidates.length > 0
      ? mistakeCandidates.reduce((worst, m) => (m.delta < worst.delta ? m : worst))
      : null;

  // ---- §6 item 6: closest LOST lane only — a closest WON lane is a
  // different, less interesting fact. ----
  const closestLostBattle =
    receipt.closest_battle && receipt.closest_battle.outcome !== "win" ? receipt.closest_battle : null;

  // ---- §6 item 10: decision timeline, from `map` (optional — omitted, not
  // faked, when the caller has none to give). ----
  const timelineRows = map ? ladderRows(map).filter((r) => r.state !== "locked") : [];

  return (
    <div className="share-card-shell flex flex-col gap-4" data-testid="rtt-result">
      {/* §6 item 1 — THE VERDICT. The single largest, highest-contrast
          element on the screen, first in DOM order, above every highlight
          card. Used to be `text-[11px]` — smaller than the flavour line
          beneath it, which is backwards: whether the table was cleared is
          the one fact this whole screen exists to state.

          The visual-identity pass adds the frame the word was missing: a
          decision-tier surface with an accent crown and the spotlight ring,
          so the verdict reads as a STAMP pressed onto the receipt rather than
          as very large text sitting on the page. `.pk-reveal` at index 0 makes
          it the first thing that lands, and the display face gives it the
          tracking the rest of the game's headlines already use. */}
      <header
        className="pk-reveal pk-depth-decision pk-crown pk-crown-accent pk-spotlight flex flex-col gap-1.5 rounded-xl border p-3.5"
        style={{ "--pk-reveal-index": 0 } as React.CSSProperties}
      >
        <span
          className="font-display text-4xl font-black uppercase leading-none sm:text-5xl"
          style={{ color: stampColor }}
          data-testid="rtt-result-verdict"
          data-outcome={outcome}
        >
          {verdict}
        </span>
        <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
          {receipt.headline}
        </h2>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {receipt.story}
        </p>
        {/* WAS `--text-muted`. Record, lives and roster total are the three
            numbers the run actually produced — they are the result, not a
            provenance footnote, and the roster total counts to itself for the
            same reason. */}
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Record <span className="score-number">{receipt.record}</span> ·{" "}
          <span className="score-number">{receipt.lives_remaining}</span> lives left · roster total{" "}
          <ResultNumber value={receipt.roster_total} precision={1} />
        </p>
      </header>

      {/* §6 item 2 — act reached / boss record, one row per act. */}
      {receipt.battles.length > 0 && (
        <section
          className="pk-reveal flex flex-col gap-1.5"
          style={{ "--pk-reveal-index": 1 } as React.CSSProperties}
        >
          <h3 className="rtt-result-heading">Boss record</h3>
          <ul className="flex flex-col gap-1" data-testid="rtt-result-battles">
            {receipt.battles.map((b) => (
              <li
                key={`${b.act}-${b.boss_id}`}
                data-testid={`rtt-result-battle-${b.act}`}
                data-outcome={b.outcome}
                className="pk-depth pk-crown flex flex-wrap items-baseline gap-2 rounded-lg px-2 py-1.5 text-xs"
              >
                <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                  Act <span className="score-number">{b.act}</span>
                </span>
                <span
                  className="font-bold uppercase tracking-wide"
                  style={{
                    color:
                      b.outcome === "win"
                        ? "var(--correct)"
                        : b.outcome === "loss"
                          ? "color-mix(in srgb, var(--incorrect) 85%, var(--text-primary))"
                          : "var(--text-secondary)",
                  }}
                >
                  {b.outcome === "win" ? "Won" : b.outcome === "loss" ? "Lost" : "Drew"}
                </span>
                <span className="score-number" style={{ color: "var(--text-secondary)" }}>
                  {b.player_lanes_won}–{b.opponent_lanes_won} on lanes
                </span>
                {/* WAS `--text-muted`. "Decided on the summed lane margin" is
                    the sentence that explains an outcome a player may not
                    otherwise understand — the least skippable half of the row. */}
                <span style={{ color: "var(--text-secondary)" }}>
                  {DECIDED_BY_LABELS[b.decided_by] ?? "Decided on lanes won"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* §6 items 3-5 + 7 — MVP, most-valuable transaction, largest mistake,
          credits — the "stat tile" row. Positive framing (MVP, best move)
          alongside the negative framing this screen used to have none of. */}
      <section
        className="pk-reveal grid gap-2 sm:grid-cols-2"
        style={{ "--pk-reveal-index": 2 } as React.CSSProperties}
      >
        <Highlight title="Run MVP">
          {receipt.run_mvp ? (
            <>
              <strong style={{ color: "var(--text-primary)" }}>{receipt.run_mvp.player_name}</strong>{" "}
              {receipt.run_mvp.anchor_season} — removing them costs the roster{" "}
              <span className="score-number" style={{ color: "var(--peak-accent-text)" }}>
                {receipt.run_mvp.marginal_contribution.toFixed(2)}
              </span>{" "}
              of overall total.
            </>
          ) : (
            "No cards on the roster."
          )}
        </Highlight>

        <Highlight title="Best move" testId="rtt-result-best-move">
          {mostValuable ? (
            <>
              {/* WAS 9px `--text-muted`. It is the word that says whether the
                  run's best move was a purchase or a trade — the subject of
                  the sentence under it. */}
              <span
                className="mb-0.5 block text-[10px] font-bold uppercase tracking-widest"
                style={{ color: "var(--text-secondary)" }}
              >
                {mostValuable.kind === "acquisition" ? "Acquisition" : "Trade"}
              </span>
              {mostValuable.kind === "acquisition" ? (
                <>
                  <strong style={{ color: "var(--text-primary)" }}>{mostValuable.data.player_name}</strong> for{" "}
                  <span className="score-number">{mostValuable.data.cost}</span> credits in Act{" "}
                  <span className="score-number">{mostValuable.data.act}</span> —{" "}
                  <span className="score-number" style={{ color: signedColorVar(mostValuable.data.score_delta) }}>
                    {formatSigned(mostValuable.data.score_delta, 2)}
                  </span>{" "}
                  PEAK3 over {mostValuable.data.replaced?.player_name ?? "an empty slot"}.
                </>
              ) : (
                <>
                  <strong style={{ color: "var(--text-primary)" }}>{mostValuable.data.incoming.player_name}</strong> for{" "}
                  {mostValuable.data.outgoing.player_name} — net{" "}
                  <span className="score-number">{mostValuable.data.net_cost}</span> credits,{" "}
                  <span className="score-number" style={{ color: signedColorVar(mostValuable.data.score_delta) }}>
                    {formatSigned(mostValuable.data.score_delta, 2)}
                  </span>{" "}
                  PEAK3.
                </>
              )}
              {/* The runner-up: a secondary line, not a full duplicate card. */}
              {runnerUp && (
                <span className="mt-1 block text-[11px]" style={{ color: "var(--text-secondary)" }}>
                  {"incoming" in runnerUp
                    ? `Also traded for ${runnerUp.incoming.player_name} (${formatSigned(runnerUp.score_delta, 2)} PEAK3).`
                    : `Also bought ${runnerUp.player_name} (${formatSigned(runnerUp.score_delta, 2)} PEAK3).`}
                </span>
              )}
            </>
          ) : (
            "No acquisition or trade this run."
          )}
        </Highlight>

        {/* NEW — the negative framing this screen used to have none of.
            Omitted entirely when the data supports nothing negative, per
            §6 item 5 / VERIFICATION_PLAN item 12: absence is only correct
            when nothing negative exists, never a placeholder. */}
        {largestMistake && (
          <Highlight title={largestMistake.label} testId="rtt-result-largest-mistake" tone="incorrect">
            {largestMistake.detail}
          </Highlight>
        )}

        {/* §6 item 6 — closest LOST lane only. A closest WON lane is a
            different, less interesting fact and is not shown here. */}
        {closestLostBattle && (
          <Highlight title="Closest lost lane" testId="rtt-result-closest-lost">
            Act <span className="score-number">{closestLostBattle.act}</span> —{" "}
            {closestLostBattle.outcome}, lanes{" "}
            <span className="score-number">{closestLostBattle.lanes}</span>. Tightest lane was{" "}
            <span className="score-number">{closestLostBattle.tightest_lane_margin.toFixed(2)}</span> apart.
          </Highlight>
        )}

        {/* §6 item 7 — credits, promoted out of paragraph form into its own
            tile: a resource-management payoff the player made decisions
            toward all run, not a footnote. */}
        <Highlight title="Credits" testId="rtt-result-credits">
          Started with <span className="score-number">{receipt.starting_credits}</span> · spent{" "}
          <span className="score-number">{receipt.credits_spent}</span> · refunded{" "}
          <span className="score-number">{receipt.credits_refunded}</span> · finished holding{" "}
          <span className="score-number">{receipt.credits_remaining}</span>
        </Highlight>
      </section>

      {/* §6 item 8 — final roster. */}
      <section className="flex flex-col gap-2">
        <h3 className="rtt-result-heading">Final roster</h3>
        <ul className="grid gap-1 sm:grid-cols-2">
          {roster.map((entry) => (
            <li
              key={entry.slot_id}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 min-w-0"
              style={{ background: "var(--bg-surface)" }}
            >
              <PlayerAvatar name={entry.player_name} size={24} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                  {entry.player_name}
                </span>
                {/* WAS `--text-muted`. The seat and the peak window are what
                    distinguish one roster line from another. */}
                <span className="truncate text-[10px]" style={{ color: "var(--text-secondary)" }}>
                  {slotLabel({ slot_id: entry.slot_id, role: entry.role, is_starter: true })} · {entry.window}
                </span>
              </span>
              <span className="score-number ml-auto text-xs shrink-0" style={{ color: "var(--peak-accent-text)" }}>
                {entry.prime_score.toFixed(1)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* §6 item 9 — five-lane profile. */}
      <section className="flex flex-col gap-2">
        <h3 className="rtt-result-heading">Five-lane profile</h3>
        <LaneProfile lanes={receiptLaneProfile(receipt.lane_profile)} dense />
        <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
          Strongest: {receipt.strongest_lane.label}{" "}
          <span className="score-number">{receipt.strongest_lane.value.toFixed(1)}</span> · weakest:{" "}
          {receipt.weakest_lane.label}{" "}
          <span className="score-number">{receipt.weakest_lane.value.toFixed(1)}</span>
        </p>
      </section>

      {/* Front office perks (internally: Systems — plan §5.2). Not one of
          §6's twelve numbered sections, but real decision-relevant data
          this screen already explained well; kept. */}
      <section className="flex flex-col gap-1.5">
        <h3 className="rtt-result-heading">Front office perks</h3>
        {receipt.systems.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            No perk was ever selected.
          </p>
        ) : (
          receipt.systems.map((sys) => {
            const plain = perkPlainEffect(sys.id);
            const hint = perkStrategyHint(sys.id);
            return (
              <div key={sys.id} className="flex flex-col" data-testid={`rtt-result-system-${sys.id}`}>
                <p className="text-xs" style={{ color: "var(--text-primary)" }}>
                  <span className="font-semibold" style={{ color: "var(--peak-accent-text)" }}>
                    {sys.name}
                  </span>{" "}
                  — {plain ?? sys.summary}
                </p>
                {hint && (
                  <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                    {hint}
                  </p>
                )}
                {plain && (
                  <details data-testid={`rtt-result-system-rule-${sys.id}`}>
                    <summary
                      className="cursor-pointer select-none text-[11px]"
                      style={{ color: "var(--text-secondary)", textDecoration: "underline", textUnderlineOffset: "2px" }}
                    >
                      {PERK_EXACT_RULE_LABEL}
                      <span className="sr-only"> for {sys.name}</span>
                    </summary>
                    <p className="pt-0.5 text-[11px]" style={{ color: "var(--text-secondary)" }}>
                      {sys.summary}
                    </p>
                  </details>
                )}
              </div>
            );
          })
        )}
      </section>

      {/* §6 item 10 — decision timeline: the map the player just played,
          presented once more as a story. Omitted (not faked) when the
          caller has no `map` to give — see the prop docstring. */}
      {timelineRows.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="rtt-result-heading">Decision timeline</h3>
          <ol
            className="flex flex-wrap gap-1.5"
            data-testid="rtt-result-timeline"
            aria-label="The run's stages, in order"
          >
            {timelineRows.map((row) => (
              <li
                key={row.key}
                data-testid={`rtt-result-timeline-${row.key}`}
                className="flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-center"
                style={{
                  background: "var(--bg-surface)",
                  border: `1px solid ${
                    row.kind === "boss"
                      ? row.state === "won"
                        ? "var(--correct-dim)"
                        : row.state === "lost"
                          ? "var(--incorrect-dim)"
                          : "var(--border-default)"
                      : "var(--border-subtle)"
                  }`,
                  minWidth: "76px",
                }}
              >
                {/* WAS 9px `--text-muted`. It names the stage the outcome
                    beneath it belongs to; without it the timeline is a row of
                    unattributed verdicts. */}
                <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
                  {row.kind === "boss" ? `Act ${row.act} boss` : `Act ${row.act}·${row.stage}`}
                </span>
                <span className="text-[10px] font-semibold" style={{ color: "var(--text-primary)" }}>
                  {row.kind === "boss"
                    ? row.state === "won"
                      ? "Won"
                      : row.state === "lost"
                        ? "Lost"
                        : row.state === "drawn"
                          ? "Drew"
                          : row.sublabel
                    : row.sublabel}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* The semantic receipt (plan §2.3). COLOUR COMES FROM `kind` AND FROM
          NOTHING ELSE — never from the sign of the number beside it. */}
      <section className="flex flex-col gap-1.5">
        <h3 className="rtt-result-heading">Why this run ended this way</h3>
        {items.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Not enough happened to explain.
          </p>
        ) : (
          <ul className="flex flex-col gap-1" data-testid="rtt-result-reasons">
            {items.map((item, i) => (
              <li
                key={`${item.kind}-${i}`}
                data-testid={`rtt-result-item-${i}`}
                data-kind={item.kind}
                className="flex items-baseline gap-2 rounded-lg px-2 py-1.5"
                style={{ background: "var(--bg-surface)" }}
              >
                <span
                  className="score-number min-w-12 shrink-0 whitespace-nowrap text-right text-xs font-bold"
                  style={{ color: receiptItemColorVar(item.kind) }}
                >
                  {formatReceiptItem(item)}
                </span>
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {item.label}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* §6 item 12 — leaderboard placement, or an EXPLICIT "not ranked
          yet" — never a silent omission. RTT has no leaderboard contract
          yet (SCORE_RECONCILIATION.md "Mode separation": RTT gets a
          leaderboard only after its own score contract is defined,
          separately, not in this pass) — so "not ranked yet" is the
          correct, honest state right now, not a placeholder for a feature
          that doesn't exist. */}
      <section className="flex flex-col gap-1" data-testid="rtt-result-leaderboard">
        <h3 className="rtt-result-heading">Leaderboard</h3>
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Not ranked yet — RUN THE TABLE doesn&apos;t have a global leaderboard in this build.
        </p>
      </section>

      {/* Actions — five, per §6: run it back · replay this seed · challenge
          a friend · copy summary · share card (image). */}
      {challengeError && (
        <p role="alert" className="text-xs" style={{ color: "var(--incorrect)" }}>
          {challengeError}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="rtt-run-it-back"
          onClick={onRunItBack}
          disabled={busy}
          className="rtt-tap pk-lift pk-press inline-flex items-center gap-1.5 rounded-lg px-4 text-xs font-bold uppercase tracking-wide disabled:opacity-60"
          style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
        >
          <RotateCcw size={13} aria-hidden="true" />
          Run it back
        </button>
        <button
          type="button"
          data-testid="rtt-replay-seed"
          onClick={onReplaySeed}
          disabled={busy}
          className="rtt-tap pk-lift pk-press inline-flex items-center gap-1.5 rounded-lg px-4 text-xs font-semibold uppercase tracking-wide disabled:opacity-60"
          style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border-default)" }}
        >
          <Repeat size={13} aria-hidden="true" />
          Replay this seed
        </button>
        <button
          type="button"
          data-testid="rtt-challenge"
          onClick={handleChallenge}
          disabled={busy}
          className="rtt-tap pk-lift pk-press inline-flex items-center gap-1.5 rounded-lg px-4 text-xs font-semibold uppercase tracking-wide disabled:opacity-60"
          style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border-default)" }}
        >
          {copied === "challenge" ? <Check size={13} aria-hidden="true" /> : <LinkIcon size={13} aria-hidden="true" />}
          {copied === "challenge" ? "Link copied!" : "Challenge a friend"}
        </button>
        <button
          type="button"
          data-testid="rtt-copy-summary"
          onClick={handleCopySummary}
          className="rtt-tap pk-lift pk-press inline-flex items-center gap-1.5 rounded-lg px-4 text-xs font-semibold uppercase tracking-wide"
          style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border-default)" }}
        >
          {copied === "summary" ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
          {copied === "summary" ? "Copied!" : "Copy summary"}
        </button>
        <button
          type="button"
          data-testid="rtt-share-card"
          onClick={handleShareCard}
          className="rtt-tap pk-lift pk-press inline-flex items-center gap-1.5 rounded-lg px-4 text-xs font-semibold uppercase tracking-wide"
          style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border-default)" }}
        >
          <Camera size={13} aria-hidden="true" />
          Share card (image)
        </button>
      </div>
      {/* Offscreen — `handleShareCard` draws into this element and reads it
          back via `toDataURL()`; it is never meant to be seen inline. */}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        data-testid="rtt-share-canvas"
        data-ready={shareImageReady ? "true" : "false"}
        style={{ display: "none" }}
      />

      <details className="text-[10px]" style={{ color: "var(--text-muted)" }} data-testid="rtt-data-receipt">
        <summary className="cursor-pointer select-none" style={{ color: "var(--text-secondary)" }}>
          Data receipt
        </summary>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 pt-1">
          <span>
            Seed <span className="score-number">{receipt.seed}</span>
          </span>
          <span>{receipt.run_type}</span>
          {receipt.date && <span>{receipt.date}</span>}
          <span>{versions.engine_version}</span>
          <span>{versions.ruleset_version}</span>
          <span>{versions.card_pool_version}</span>
          <span>{versions.peak3_model_version}</span>
        </div>
      </details>
    </div>
  );
}

function Highlight({
  title,
  children,
  testId,
  tone,
}: {
  title: string;
  children: React.ReactNode;
  testId?: string;
  /** "incorrect" gets a red-tinted border so the negative-framed section
   *  reads as cautionary at a glance, not just by its words. */
  tone?: "incorrect";
}) {
  return (
    /* A raised object with a lit top edge rather than a flat rectangle: these
       four tiles are the run's highlights, and they were rendering at exactly
       the same visual weight as the explanatory paragraphs around them. */
    <div
      data-testid={testId}
      className="pk-depth pk-crown rounded-xl border p-2.5 flex flex-col gap-1"
      style={{
        borderColor: tone === "incorrect" ? "var(--incorrect-dim)" : "var(--border-default)",
      }}
    >
      <h4 className="rtt-result-heading">{title}</h4>
      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
        {children}
      </p>
    </div>
  );
}
