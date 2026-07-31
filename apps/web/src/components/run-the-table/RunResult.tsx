"use client";
import { useState } from "react";
import { Check, Copy, Link as LinkIcon, RotateCcw, Repeat } from "lucide-react";
import PlayerAvatar from "@/components/court/PlayerAvatar";
import { RunReceipt, RunVersions } from "@/types/run-the-table";
import {
  buildRunShareText,
  challengeUrl,
  formatSigned,
  receiptLaneProfile,
  signedColorVar,
  slotLabel,
  trackRunTheTable,
} from "@/lib/run-the-table-state";
import LaneProfile from "./LaneProfile";

/**
 * The run receipt.
 *
 * Every claim on this screen is a field on `build_receipt()` — the verdict,
 * the MVP's marginal contribution, the best acquisition's value per credit,
 * the closest battle's tightest lane margin, and the `reasons[]` list, which
 * the engine emits already carrying a `signed_value`. Nothing is re-derived,
 * ranked or editorialised here; the component's job is to lay it out.
 *
 * The confirmation pattern is ShareRunPanel's: the button's own label swaps
 * for two seconds. No toast.
 */
interface Props {
  receipt: RunReceipt;
  versions: RunVersions;
  busy: boolean;
  onRunItBack: () => void;
  onReplaySeed: () => void;
  onChallenge: () => Promise<string | null>;
}

type CopiedKind = "summary" | "challenge" | null;

export default function RunResult({
  receipt,
  versions,
  busy,
  onRunItBack,
  onReplaySeed,
  onChallenge,
}: Props) {
  const [copied, setCopied] = useState<CopiedKind>(null);
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const roster = [...receipt.starters, ...receipt.bench];
  const stampColor = receipt.ran_the_table
    ? "var(--correct)"
    : receipt.verdict === "RUN ENDED"
      ? "var(--incorrect)"
      : "var(--peak-accent)";

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
        >
          {receipt.verdict}
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

      {/* Systems */}
      <section className="flex flex-col gap-1.5">
        <h3 className="rtt-result-heading">Systems</h3>
        {receipt.systems.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            No System was ever selected.
          </p>
        ) : (
          receipt.systems.map((sys) => (
            <p key={sys.id} className="text-xs" style={{ color: "var(--text-secondary)" }}>
              <span className="font-semibold" style={{ color: "var(--peak-accent)" }}>
                {sys.name}
              </span>{" "}
              — {sys.summary}
            </p>
          ))
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

      {/* Reasons — the signed-delta receipt */}
      <section className="flex flex-col gap-1.5">
        <h3 className="rtt-result-heading">Why the run went this way</h3>
        {receipt.reasons.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Not enough happened to explain.
          </p>
        ) : (
          <ul className="flex flex-col gap-1" data-testid="rtt-result-reasons">
            {receipt.reasons.map((reason, i) => (
              <li
                key={`${reason.kind}-${i}`}
                className="flex items-baseline gap-2 rounded-lg px-2 py-1.5"
                style={{ background: "var(--bg-surface)" }}
              >
                <span
                  className="score-number w-12 shrink-0 text-right text-xs font-bold"
                  style={{ color: signedColorVar(reason.signed_value) }}
                >
                  {formatSigned(reason.signed_value, 1)}
                </span>
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {reason.text}
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
