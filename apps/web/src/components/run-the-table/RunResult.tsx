"use client";
import { useState } from "react";
import { Check, Copy, Link as LinkIcon, RotateCcw, Repeat } from "lucide-react";
import PlayerAvatar from "@/components/court/PlayerAvatar";
import { RunReceipt, RunVersions } from "@/types/run-the-table";
import {
  DECIDED_BY_LABELS,
  buildRunShareText,
  challengeUrl,
  formatReceiptItem,
  formatSigned,
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
import LaneProfile from "./LaneProfile";

/**
 * The run receipt.
 *
 * Every claim on this screen is a field on `build_receipt()` — the MVP's
 * marginal contribution, the best acquisition's value per credit, the closest
 * battle's tightest lane margin, and the explanation lines. Nothing is
 * re-derived, ranked or editorialised here; the component's job is to lay it
 * out.
 *
 * TWO CONTRACT CHANGES LAND HERE.
 *
 * 1. THE VERDICT (plan §2.2). `"RUN COMPLETE"` is retired — it was printed for
 *    a 0-for-3 losing run, which is victory framing on a defeat. The three
 *    strings are `TABLE CLEARED`, `RUN ENDED AT THE FINAL BOSS` and
 *    `RUN ENDED IN ACT {n}`, and `runVerdict()` derives them for a v1 receipt
 *    saved before the engine emitted an `outcome`.
 *
 * 2. THE RECEIPT LINES (plan §2.3). Colour now comes from `item.kind` and from
 *    NOTHING ELSE. It used to come from the sign of `reason.signed_value`, and
 *    the engine negated a credit HOLDING to force that colour — so this screen
 *    printed "Finished holding 68 unspent credits" beside a red −68.0, two
 *    sections below a Credits block that said `finished holding 68`. Old
 *    receipts still render: `receiptItems()` falls back to `reasons[]`.
 *    `signedColorVar` survives only where a signed delta genuinely IS the
 *    semantic — a PEAK3 score delta on an acquisition or a trade.
 *
 * The confirmation pattern is ShareRunPanel's: the button's own label swaps
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
  onRunItBack,
  onReplaySeed,
  onChallenge,
}: Props) {
  const [copied, setCopied] = useState<CopiedKind>(null);
  const [challengeError, setChallengeError] = useState<string | null>(null);
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

  return (
    <div className="share-card-shell flex flex-col gap-4" data-testid="rtt-result">
      <header className="flex flex-col gap-1">
        <span
          className="text-[11px] font-black uppercase tracking-[0.22em]"
          style={{ color: stampColor }}
          data-testid="rtt-result-verdict"
          data-outcome={outcome}
        >
          {verdict}
        </span>
        <h2 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
          {receipt.headline}
        </h2>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {receipt.story}
        </p>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Record <span className="score-number">{receipt.record}</span> ·{" "}
          <span className="score-number">{receipt.lives_remaining}</span> lives left · roster total{" "}
          <span className="score-number">{receipt.roster_total.toFixed(1)}</span>
        </p>
      </header>

      {/* Roster */}
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
                <span className="truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {slotLabel({ slot_id: entry.slot_id, role: entry.role, is_starter: true })} ·{" "}
                  {entry.window}
                </span>
              </span>
              <span
                className="score-number ml-auto text-xs shrink-0"
                style={{ color: "var(--peak-accent)" }}
              >
                {entry.prime_score.toFixed(1)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Boss record — one row per act, so "3-0" is auditable rather than
          asserted. Every field is `receipt.battles[]`; nothing is recounted. */}
      {receipt.battles.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="rtt-result-heading">Boss record</h3>
          <ul className="flex flex-col gap-1" data-testid="rtt-result-battles">
            {receipt.battles.map((b) => (
              <li
                key={`${b.act}-${b.boss_id}`}
                data-testid={`rtt-result-battle-${b.act}`}
                data-outcome={b.outcome}
                className="flex flex-wrap items-baseline gap-2 rounded-lg px-2 py-1.5 text-xs"
                style={{ background: "var(--bg-surface)" }}
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
                <span style={{ color: "var(--text-muted)" }}>
                  {DECIDED_BY_LABELS[b.decided_by] ?? "Decided on lanes won"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Front office perks (internally: Systems — plan §5.2) */}
      <section className="flex flex-col gap-1.5">
        <h3 className="rtt-result-heading">Front office perks</h3>
        {receipt.systems.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            No perk was ever selected.
          </p>
        ) : (
          // Three layers, same as `SystemSelect` and the tray (plan §6). This
          // surface used to show NO plain line at all — just the name and the
          // dense threshold summary — so the one screen a player reads after
          // the run was the one that never said what their perk did.
          receipt.systems.map((sys) => {
            const plain = perkPlainEffect(sys.id);
            const hint = perkStrategyHint(sys.id);
            return (
              <div key={sys.id} className="flex flex-col" data-testid={`rtt-result-system-${sys.id}`}>
                <p className="text-xs" style={{ color: "var(--text-primary)" }}>
                  <span className="font-semibold" style={{ color: "var(--peak-accent)" }}>
                    {sys.name}
                  </span>{" "}
                  — {plain ?? sys.summary}
                </p>
                {hint && (
                  <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    {hint}
                  </p>
                )}
                {plain && (
                  <details data-testid={`rtt-result-system-rule-${sys.id}`}>
                    <summary
                      className="cursor-pointer select-none text-[11px]"
                      style={{
                        color: "var(--text-muted)",
                        textDecoration: "underline",
                        textUnderlineOffset: "2px",
                      }}
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

      {/* Lane profile */}
      <section className="flex flex-col gap-2">
        <h3 className="rtt-result-heading">Five-lane profile</h3>
        <LaneProfile lanes={receiptLaneProfile(receipt.lane_profile)} dense />
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          Strongest: {receipt.strongest_lane.label}{" "}
          <span className="score-number">{receipt.strongest_lane.value.toFixed(1)}</span> · weakest:{" "}
          {receipt.weakest_lane.label}{" "}
          <span className="score-number">{receipt.weakest_lane.value.toFixed(1)}</span>
        </p>
      </section>

      {/* Highlights */}
      <section className="grid gap-2 sm:grid-cols-2">
        <Highlight title="Run MVP">
          {receipt.run_mvp ? (
            <>
              <strong style={{ color: "var(--text-primary)" }}>
                {receipt.run_mvp.player_name}
              </strong>{" "}
              {receipt.run_mvp.anchor_season} — removing them costs the roster{" "}
              <span className="score-number" style={{ color: "var(--peak-accent)" }}>
                {receipt.run_mvp.marginal_contribution.toFixed(2)}
              </span>{" "}
              of overall total.
            </>
          ) : (
            "No cards on the roster."
          )}
        </Highlight>

        <Highlight title="Best acquisition">
          {receipt.best_acquisition ? (
            <>
              <strong style={{ color: "var(--text-primary)" }}>
                {receipt.best_acquisition.player_name}
              </strong>{" "}
              for <span className="score-number">{receipt.best_acquisition.cost}</span> credits in
              Act <span className="score-number">{receipt.best_acquisition.act}</span> —{" "}
              <span
                className="score-number"
                style={{ color: signedColorVar(receipt.best_acquisition.score_delta) }}
              >
                {formatSigned(receipt.best_acquisition.score_delta, 2)}
              </span>{" "}
              PEAK3 over{" "}
              {receipt.best_acquisition.replaced?.player_name ?? "an empty slot"}.
            </>
          ) : (
            "You never bought a card."
          )}
        </Highlight>

        <Highlight title="Best trade">
          {receipt.best_trade ? (
            <>
              <strong style={{ color: "var(--text-primary)" }}>
                {receipt.best_trade.incoming.player_name}
              </strong>{" "}
              for {receipt.best_trade.outgoing.player_name} — net{" "}
              <span className="score-number">{receipt.best_trade.net_cost}</span> credits,{" "}
              <span
                className="score-number"
                style={{ color: signedColorVar(receipt.best_trade.score_delta) }}
              >
                {formatSigned(receipt.best_trade.score_delta, 2)}
              </span>{" "}
              PEAK3.
            </>
          ) : (
            "You never made a trade."
          )}
        </Highlight>

        <Highlight title="Closest battle">
          {receipt.closest_battle ? (
            <>
              Act <span className="score-number">{receipt.closest_battle.act}</span> —{" "}
              {receipt.closest_battle.outcome}, lanes{" "}
              <span className="score-number">{receipt.closest_battle.lanes}</span>. Tightest lane
              was{" "}
              <span className="score-number">
                {receipt.closest_battle.tightest_lane_margin.toFixed(2)}
              </span>{" "}
              apart.
            </>
          ) : (
            "No battle was played."
          )}
        </Highlight>
      </section>

      {/* Economy */}
      <section className="flex flex-col gap-1">
        <h3 className="rtt-result-heading">Credits</h3>
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Started with <span className="score-number">{receipt.starting_credits}</span> · spent{" "}
          <span className="score-number">{receipt.credits_spent}</span> · refunded{" "}
          <span className="score-number">{receipt.credits_refunded}</span> · finished holding{" "}
          <span className="score-number">{receipt.credits_remaining}</span>
        </p>
      </section>

      {/* The semantic receipt (plan §2.3).
          COLOUR COMES FROM `kind` AND FROM NOTHING ELSE — never from the sign
          of the number beside it. `value` is printed as the true magnitude the
          engine sent, so a credit HOLDING reads as 68 in the muted tone and
          not as a red −68. `receiptItems()` adapts a v1 `reasons[]` receipt
          into the same shape, so an old saved run still renders. */}
      <section className="flex flex-col gap-1.5">
        <h3 className="rtt-result-heading">Why this run ended this way</h3>
        {items.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
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
                {/* `min-w`, not a fixed `w-12`: a `display` string is real
                    copy ("3 of 5 battles"), not a number, and a fixed column
                    would clip it. */}
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

      {/* Actions */}
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
          className="rtt-tap inline-flex items-center gap-1.5 rounded-lg px-4 text-xs font-bold uppercase tracking-wide disabled:opacity-60"
          style={{ background: "var(--peak-accent)", color: "#000" }}
        >
          <RotateCcw size={13} aria-hidden="true" />
          Run it back
        </button>
        <button
          type="button"
          data-testid="rtt-replay-seed"
          onClick={onReplaySeed}
          disabled={busy}
          className="rtt-tap inline-flex items-center gap-1.5 rounded-lg px-4 text-xs font-semibold uppercase tracking-wide disabled:opacity-60"
          style={{
            background: "var(--bg-elevated)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-default)",
          }}
        >
          <Repeat size={13} aria-hidden="true" />
          Replay this seed
        </button>
        <button
          type="button"
          data-testid="rtt-challenge"
          onClick={handleChallenge}
          disabled={busy}
          className="rtt-tap inline-flex items-center gap-1.5 rounded-lg px-4 text-xs font-semibold uppercase tracking-wide disabled:opacity-60"
          style={{
            background: "var(--bg-elevated)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-default)",
          }}
        >
          {copied === "challenge" ? <Check size={13} aria-hidden="true" /> : <LinkIcon size={13} aria-hidden="true" />}
          {copied === "challenge" ? "Link copied!" : "Challenge a friend"}
        </button>
        <button
          type="button"
          data-testid="rtt-copy-summary"
          onClick={handleCopySummary}
          className="rtt-tap inline-flex items-center gap-1.5 rounded-lg px-4 text-xs font-semibold uppercase tracking-wide"
          style={{
            background: "var(--bg-elevated)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-default)",
          }}
        >
          {copied === "summary" ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
          {copied === "summary" ? "Copied!" : "Copy summary"}
        </button>
      </div>

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

function Highlight({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl border p-2.5 flex flex-col gap-1"
      style={{ background: "var(--bg-elevated)", borderColor: "var(--border-default)" }}
    >
      <h4 className="rtt-result-heading">{title}</h4>
      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
        {children}
      </p>
    </div>
  );
}
