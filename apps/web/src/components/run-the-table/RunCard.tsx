"use client";
import PlayerAvatar from "@/components/court/PlayerAvatar";
import { LANE_FIELDS, RunCardPublic } from "@/types/run-the-table";
import { ordinalFixed } from "@/lib/ordinal";
import {
  LANE_LABELS,
  OVERALL_PERCENTILE_SHORT_BASIS,
  ROLE_COLOR_VARS,
  ROLE_LABELS,
  cardLaneSummary,
  describeCostModifiers,
  laneColorVar,
  percentileSentence,
} from "@/lib/run-the-table-state";
import { componentTextColor } from "@/lib/utils";

const LANE_TOKENS = ["si", "tp", "rec", "po", "team"] as const;

/**
 * Lane display names, in `LANE_FIELDS` order.
 *
 * `RunCardPublic.lane_percentiles` is a bare `Record<LaneField, number>` — the
 * only lane payload on the API that carries no `label`, unlike
 * `LaneProfileEntry`. The mirror now lives once, in `run-the-table-state.ts`,
 * because the Trade Desk's review panel needs the same names. The NUMBERS are
 * still entirely the server's.
 */
const LANE_SR_LABELS = LANE_FIELDS.map((lane) => LANE_LABELS[lane]);

/**
 * One exact 3-year peak card — DECISION-FIRST (PRODUCT_EXPERIENCE_CONTRACT.md
 * §5 / brief §E): the card leads with what the decision actually turns on —
 * upside, weakness, cost, what's foregone — and the DEEP receipt (the
 * five-lane fingerprint, every applied cost modifier) sits behind one
 * `<details>` disclosure rather than always occupying the card's height.
 *
 * FIRST-SCAN ORDER, and the DOM follows it exactly:
 *
 *   player · exact 3Y window · PEAK3 score · cost (+ what it forgoes) ·
 *   strongest lane (upside) · weakest lane (weakness) · profile label ·
 *   role fit / role replaced / boss relevance, when the caller has one ·
 *   —— behind disclosure —— eligible roles · full lane fingerprint ·
 *   every cost modifier
 *
 * Strongest/weakest/profile come from `cardLaneSummary`, pure comparison of
 * the `lane_percentiles` the engine already sent; nothing is scored, priced
 * or re-derived here. `creditsRemaining`/`roleReplaced`/`bossRelevance` are
 * likewise printed exactly as the caller computed them from server numbers
 * (`creditsForegoneSentence`, the slot being replaced, `ScoutReport`) —
 * this component never derives any of the three itself.
 *
 * No player photograph and no team logo: `PlayerAvatar` renders an initials
 * medallion, which is the licensed-safe treatment used everywhere else.
 */
interface Props {
  card: RunCardPublic;
  /** What this card costs right now, if it is purchasable in this context. */
  cost?: number | null;
  /** Shown struck through beside `cost` when a System discounted it. */
  strikeCost?: number | null;
  costLabel?: string;
  compact?: boolean;
  showFingerprint?: boolean;
  /** "Costs N — leaves M for the rest of this act" — the caller's own
   *  `creditsForegoneSentence(credits, cost)`. Shown right beside cost, not
   *  buried in the disclosure: WHAT IS FOREGONE is exactly the decision-
   *  first information this restructure exists to promote. */
  foregoneSentence?: string | null;
  /** Trade Desk only: the role the outgoing slot currently plays, so "role
   *  replaced" is legible at the point of choice, not only in the Review
   *  step further down the node. */
  roleReplaced?: string | null;
  /** Scout & Prepare payoff: when this boss has been scouted, one line
   *  saying whether this card's strongest lane counters the boss's weakest
   *  (or feeds a lane the boss is already strong in) — computed by the
   *  caller from `ScoutReport`, never re-derived here. */
  bossRelevance?: string | null;
  /** Extra content under the card (buttons, blocked reasons). */
  children?: React.ReactNode;
}

export default function RunCard({
  card,
  cost = null,
  strikeCost = null,
  costLabel = "Cost",
  compact = false,
  showFingerprint = true,
  foregoneSentence = null,
  roleReplaced = null,
  bossRelevance = null,
  children,
}: Props) {
  const roleColor = ROLE_COLOR_VARS[card.primary_role] ?? "var(--peak-accent)";
  const shape = cardLaneSummary(card.lane_percentiles);
  return (
    <div className="flex flex-col gap-2 min-w-0" data-testid="rtt-run-card">
      <div className="flex items-start gap-2.5 min-w-0">
        <PlayerAvatar name={card.player_name} size={compact ? 32 : 38} />
        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-baseline gap-2 min-w-0">
            <span
              className={`font-semibold truncate ${compact ? "text-[13px]" : "text-sm"}`}
              style={{ color: "var(--text-primary)" }}
            >
              {card.player_name}
            </span>
            <span
              className="score-number text-[11px] shrink-0"
              style={{ color: "var(--peak-accent-text)" }}
              title="PEAK3 3-year prime score"
              data-testid="rtt-card-prime-score"
            >
              {card.prime_score.toFixed(1)}
              {/* `title` alone is reachable by no keyboard and no screen
                  reader, so the headline number on the card was unlabelled in
                  the accessible tree. */}
              <span className="sr-only"> PEAK3 3-year prime score</span>
            </span>
          </div>
          {/* The exact 3-year window, always in full — this is the thing being
              priced, so it is never abbreviated or truncated away. */}
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            <span className="score-number">{card.window_label}</span>
            <span className="sr-only"> — exact 3-year peak window.</span>
          </span>
          {/* TWO defects lived on this one line.
              (1) "75.1th pct" of WHAT — a bare percentile a player cannot act
              on. The denominator is the RUN THE TABLE eligible card pool
              (cards.build_pool ranks `prime_score` over the selected profiles),
              NOT every PEAK3 3-year window — see OVERALL_PERCENTILE_BASIS.
              (2) The `th` was a hard-coded JSX text node, so EVERY card in the
              game rendered "75.1th", "21.0th", "1.0th". Both the visible short
              form and the sr-only full form now come from `lib/ordinal.ts`. */}
          <span
            className="text-[10px]"
            style={{ color: "var(--text-muted)" }}
            data-testid="rtt-card-percentile"
          >
            <span className="score-number">{ordinalFixed(card.overall_percentile, 1)}</span>{" "}
            percentile {OVERALL_PERCENTILE_SHORT_BASIS}
            <span className="sr-only"> — {percentileSentence(card.overall_percentile)}.</span>
          </span>
        </div>
        {cost !== null && (
          <div className="flex flex-col items-end shrink-0">
            <span className="text-[9px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              {costLabel}
            </span>
            <span className="flex items-baseline gap-1">
              {strikeCost !== null && strikeCost !== cost && (
                <span
                  className="score-number text-[10px] line-through"
                  style={{ color: "var(--text-muted)" }}
                >
                  {strikeCost}
                </span>
              )}
              <span
                className="score-number text-sm font-bold"
                style={{ color: cost === 0 ? "var(--correct)" : "var(--text-primary)" }}
              >
                {cost}
              </span>
            </span>
          </div>
        )}
      </div>

      {/* DECISION-FIRST (brief §E): upside and weakness, promoted ABOVE the
          role chips and every other receipt-shaped detail — this is the
          card's shape, named, and it is what the decision actually turns
          on. Before this the five bars below were the only statement of
          it, and reading a bar chart is not something a player can do
          three times in a row under a decision. Every value is the
          server's `lane_percentiles`; `cardLaneSummary` only sorts them.
          The lane names are the five FROZEN component labels — `Playoff
          Rate Impact` and `Team Result` included — and the profile word is
          a separate display term that never replaces them. */}
      {showFingerprint && (
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]"
          data-testid="rtt-card-shape"
        >
          {/* The lane color is a fill/border accent, never text — the frozen
              --comp-* hexes measure 1.6-2.6:1 as text on Arena Day, failing
              even the 3:1 large-text floor. A small dot carries the accent;
              the label word uses `componentTextColor` (lib/utils.ts,
              P3-G2) — the named text-safe sibling that keeps the lane's
              identity colour rather than dropping to neutral text. */}
          <span style={{ color: "var(--text-muted)" }} data-testid="rtt-card-strongest">
            Strongest{" "}
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: laneColorVar(shape.strongest.token) }}
            />{" "}
            <span style={{ color: componentTextColor(shape.strongest.lane) }}>
              {shape.strongest.label}
            </span>{" "}
            <span className="score-number">{shape.strongest.percentile.toFixed(0)}</span>
          </span>
          <span style={{ color: "var(--text-muted)" }} data-testid="rtt-card-weakest">
            Weakest{" "}
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: laneColorVar(shape.weakest.token) }}
            />{" "}
            <span style={{ color: componentTextColor(shape.weakest.lane) }}>
              {shape.weakest.label}
            </span>{" "}
            <span className="score-number">{shape.weakest.percentile.toFixed(0)}</span>
          </span>
          <span
            className="rounded px-1.5 py-0.5 font-semibold uppercase tracking-wider"
            style={{
              color: "var(--text-primary)",
              background: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
            }}
            data-testid="rtt-card-profile"
            data-profile={shape.profile}
          >
            {shape.profile}
          </span>
        </div>
      )}

      {/* WHAT IS FOREGONE / WHAT CHANGES — the caller's own already-computed
          sentences, never re-derived here. Rendered together, at the point
          of choice, rather than scattered across the surface or omitted
          until a later review step. */}
      {(foregoneSentence || roleReplaced || bossRelevance) && (
        <div className="flex flex-col gap-0.5" data-testid="rtt-card-decision">
          {foregoneSentence && (
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }} data-testid="rtt-card-foregone">
              {foregoneSentence}
            </span>
          )}
          {roleReplaced && (
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }} data-testid="rtt-card-role-replaced">
              Replaces {roleReplaced}
            </span>
          )}
          {bossRelevance && (
            <span
              className="text-[10px] font-semibold"
              style={{ color: "var(--peak-accent-text)" }}
              data-testid="rtt-card-boss-relevance"
            >
              {bossRelevance}
            </span>
          )}
        </div>
      )}

      {/* THE FULL RECEIPT, behind disclosure — eligible roles beyond the
          primary, the five-lane fingerprint, and every applied cost
          modifier. All still fully present in the DOM/a11y tree (this is a
          native `<details>`, not a conditional render), just not occupying
          the card's height by default — the "detailed receipts behind
          progressive disclosure" half of the decision-first restructure.
          Rendered regardless of `showFingerprint`: that prop turns off the
          at-a-glance fingerprint BARS for a compact card (`TradeDesk`'s
          outgoing column passes `showFingerprint={false}`), it never meant
          "this card has no receipt" — the roles chips and, especially, any
          applied cost modifier still belong behind this disclosure on a
          compact card. Only the bars and their sr-only sentence stay tied
          to `showFingerprint` below. */}
      <details className="text-[10px]" data-testid="rtt-card-breakdown">
        <summary
          className="cursor-pointer select-none"
          style={{ color: "var(--text-muted)", textDecoration: "underline", textUnderlineOffset: "2px" }}
        >
          Full breakdown
        </summary>
        <div className="mt-1.5 flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-1" data-testid="rtt-card-roles">
            <span className="sr-only">Eligible roles: </span>
            <span
              className="text-[9px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5"
              style={{
                color: roleColor,
                background: "var(--bg-surface)",
                border: `1px solid color-mix(in srgb, ${roleColor} 40%, transparent)`,
              }}
            >
              {ROLE_LABELS[card.primary_role] ?? card.primary_role}
            </span>
            {card.eligible_roles
              .filter((r) => r !== card.primary_role)
              .map((role) => (
                <span
                  key={role}
                  className="text-[9px] uppercase tracking-wider rounded px-1.5 py-0.5"
                  style={{ color: "var(--text-muted)", background: "var(--bg-surface)" }}
                >
                  {ROLE_LABELS[role] ?? role}
                </span>
              ))}
          </div>

          {showFingerprint && (
            <>
              <div className="flex items-end gap-1" aria-hidden="true" data-testid="rtt-card-fingerprint">
                {LANE_FIELDS.map((lane, i) => {
                  const pct = card.lane_percentiles[lane] ?? 0;
                  return (
                    <span
                      key={lane}
                      className="flex-1 rounded-sm"
                      style={{
                        height: `${Math.max(2, Math.min(100, pct) * 0.16)}px`,
                        background: laneColorVar(LANE_TOKENS[i]),
                        opacity: 0.85,
                      }}
                    />
                  );
                })}
              </div>
              {/* The bars stay `aria-hidden` — bar height is not information
                  a screen reader can use. This sentence IS the fingerprint:
                  without it `lane_percentiles` appeared nowhere in the
                  accessible tree and a non-sighted player drafted on the
                  overall score alone. */}
              <span className="sr-only" data-testid="rtt-card-fingerprint-sr">
                {`Lane percentiles — ${LANE_FIELDS.map(
                  (lane, i) =>
                    `${LANE_SR_LABELS[i]} ${(card.lane_percentiles[lane] ?? 0).toFixed(0)}`,
                ).join(", ")}.`}
              </span>
            </>
          )}

          {/* THE `[object Object]` FIX.
              `cost_modifiers` is `list[dict]` on the server and was typed
              `string[]` here, so `.join(" · ")` stringified each dict as
              "[object Object]" — on every discounted card, for 3 of the 6
              selectable Systems (moneyball, no_hardware, two_way_value), in
              the Draft Room and both Trade Desk columns. Each modifier is
              now rendered as its own row of real copy built from the
              engine's own four fields; nothing is recomputed. */}
          {card.cost_modifiers.length > 0 && (
            <ul className="flex flex-col gap-0.5" data-testid="rtt-card-modifiers">
              {card.cost_modifiers.map((mod, i) => (
                <li
                  key={`${mod.system_id}-${i}`}
                  data-testid={`rtt-card-modifier-${mod.system_id}`}
                  className="text-[10px]"
                  style={{ color: "var(--correct)" }}
                >
                  {describeCostModifiers([mod])[0]}
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>

      {children}
    </div>
  );
}
