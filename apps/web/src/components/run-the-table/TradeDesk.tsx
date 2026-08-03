"use client";
import { useEffect, useState } from "react";
import { ArrowRight, Ban, Check } from "lucide-react";
import { Coachmark } from "@/components/ui/GuidedTour";
import { nodeTypeCopy } from "@/lib/run-the-table-copy";
import { ActiveNode } from "@/types/run-the-table";
import {
  EMPTY_TRADE_SELECTION,
  TradeSelection,
  buildTradeReview,
  chooseIncoming,
  chooseOutgoing,
  clearTradeSelection,
  formatSigned,
  incomingEligibility,
  laneColorVar,
  outgoingAdvisory,
  outgoingDeadEnd,
  signedColorVar,
  slotLabel,
  tradeIncoming,
  tradeOutgoing,
} from "@/lib/run-the-table-state";
import RunCard from "./RunCard";

/**
 * Trade Desk — an explicit four-step transaction builder.
 *
 *   1. Send out one roster player.
 *   2. Bring in one LEGAL incoming player.
 *   3. Review the whole transaction.
 *   4. Confirm, or cancel and start over.
 *
 * ---------------------------------------------------------------------------
 * What was wrong before, and what fixes it
 * ---------------------------------------------------------------------------
 *
 * The desk held two independent `useState`s and neither handler cleared the
 * other column, `<TradeDesk>` was rendered with no `key` so nothing reset when
 * the node changed, and in the border ternary `selected` OUTRANKED
 * `compatible` — so a card that had become illegal was painted accent-gold,
 * carried a red "Not eligible" badge, and still reported `aria-pressed="true"`,
 * all at once. Merely *unselected* incompatible cards were painted with a red
 * `--incorrect-dim` border, which is what a player reads as "that card is
 * highlighted".
 *
 * Now: one `TradeSelection` value (`lib/run-the-table-state.ts`), a single
 * `key`-free reset effect on `node.node_id`, and a rendering rule where
 * SELECTED and INELIGIBLE are mutually exclusive by construction — an
 * ineligible card cannot be selected, because `chooseOutgoing` drops an
 * incoming pick the new slot does not permit and `handleIncoming` refuses an
 * ineligible one.
 *
 * State is carried by colour AND border AND icon AND text, never colour alone.
 * Ineligible cards are `aria-disabled` with a click guard — the same pattern
 * `DraftRoom.tsx` already uses for a blocked offer, so they stay in the tab
 * order and a keyboard user can still reach the reason.
 *
 * ---------------------------------------------------------------------------
 * Server authority
 * ---------------------------------------------------------------------------
 *
 * Legality is `incoming.legal_slots.includes(outgoing.slot_id)` — the SERVER's
 * list, never a client-side re-derivation of role eligibility. The net is
 * `incoming.cost - outgoing.refund`, both straight off the payload; nothing
 * here applies a refund percentage or a System discount. The lane preview is a
 * difference of two `lane_index` values the server sent, and says so.
 */
interface Props {
  node: ActiveNode;
  credits: number;
  busy: boolean;
  onTrade: (outgoingSlotId: string, incomingCardId: string, netCost: number) => void;
  onDecline: () => void;
}

export default function TradeDesk({ node, credits, busy, onTrade, onDecline }: Props) {
  const incoming = tradeIncoming(node);
  const outgoing = tradeOutgoing(node);
  const [selection, setSelection] = useState<TradeSelection>(EMPTY_TRADE_SELECTION);

  /**
   * Reset on a node change.
   *
   * An EFFECT rather than a `key` on the caller: `RunTheTableGame` renders this
   * component in one branch of a long if/else chain, and a `key` there is
   * invisible from inside the component and therefore untestable from
   * `trade-desk.test.tsx`. One of the two mechanisms had to be chosen and
   * tested; this is the one, and `trade-desk.test.tsx` re-renders with a new
   * `node_id` to prove it.
   */
  useEffect(() => {
    setSelection(EMPTY_TRADE_SELECTION);
  }, [node.node_id]);

  const pickedOut = outgoing.find((s) => s.slot_id === selection.outgoingSlotId) ?? null;
  const pickedIn = incoming.find((c) => c.card_id === selection.incomingCardId) ?? null;
  const review = buildTradeReview(node, selection, credits);
  const canConfirm = review !== null && review.blockedReason === null;

  function handleOutgoing(slotId: string): void {
    setSelection((current) => chooseOutgoing(current, slotId, incoming));
  }

  function handleIncoming(cardId: string): void {
    setSelection((current) => chooseIncoming(current, cardId));
  }

  return (
    <section data-testid="rtt-trade-desk" className="rtt-decision-surface flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <span
          className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: "var(--peak-accent)" }}
        >
          Trade Desk
        </span>
        <h2 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
          {node.title}
        </h2>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {node.summary}
        </p>
        {/* Plain-language layer from W3's `run-the-table-copy`, not invented
            here, so the Trade Desk's description cannot drift from the one the
            node picker and the tour show. */}
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {nodeTypeCopy("trade_desk").consequence}
        </p>
      </header>

      {/* Container query, not `lg:` — see `.rtt-decision-surface`. At a
          1024px viewport `lg:grid-cols-2` split a 324px column into two
          ~150px card lists. This must stay the FIRST `.grid` in the subtree:
          `run-the-table-components.test.tsx` asserts on it by position. */}
      <div className="grid gap-3 @[520px]:grid-cols-2">
        {/* ---- Step 1 — who leaves --------------------------------------- */}
        <div className="flex flex-col gap-2 min-w-0">
          <StepHeading
            step={1}
            title="Send out"
            done={pickedOut !== null}
            hint="Choose one player already on your roster."
          />
          <ul className="flex flex-col gap-2">
            {outgoing.map((slot) => {
              const selected = slot.slot_id === selection.outgoingSlotId;
              // The outgoing column is NEVER gated. It is Step 1, and going
              // back to it resets Step 2 by design — gating it on the incoming
              // pick made the "changing the outgoing pick clears an
              // incompatible incoming pick" rule unreachable, because the very
              // click meant to trigger the clear was blocked. Instead the
              // player is TOLD what the click will cost them, in a neutral
              // tone: nothing here is an error.
              //
              // A slot no offer on this board can legally fill is shown as a
              // dead end BEFORE it is clicked. It stays selectable — the player
              // may still want to see the refund, and disabling Step 1 on a
              // Step 2 fact is the gating mistake described above — but it no
              // longer has to be discovered by clicking and backing out.
              const deadEnd = outgoingDeadEnd(slot, incoming);
              const advisory = selected ? null : (outgoingAdvisory(slot, pickedIn) ?? deadEnd);
              return (
                <li key={slot.slot_id}>
                  <OfferButton
                    testId={`rtt-trade-out-${slot.slot_id}`}
                    selected={selected}
                    eligible
                    reason={null}
                    advisory={advisory}
                    busy={busy}
                    onPick={() => handleOutgoing(slot.slot_id)}
                    selectedLabel="Sending out"
                  >
                    <span
                      className="mb-1 block text-[9px] font-semibold uppercase tracking-widest"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {slotLabel(slot)}
                      {slot.is_starter ? " · starter" : " · bench"}
                    </span>
                    <RunCard
                      card={slot.card}
                      cost={slot.refund}
                      costLabel="Refund"
                      compact
                      showFingerprint={false}
                    />
                  </OfferButton>
                </li>
              );
            })}
          </ul>
        </div>

        {/* ---- Step 2 — who arrives -------------------------------------- */}
        <div className="flex flex-col gap-2 min-w-0">
          <StepHeading
            step={2}
            title="Bring in"
            done={pickedIn !== null}
            hint={
              pickedOut
                ? outgoingDeadEnd(pickedOut, incoming)
                  ? `None of these players may play ${slotLabel(pickedOut)}. Pick a different player to send out, or decline.`
                  : `Only players the model lists as legal for ${slotLabel(pickedOut)} can be picked.`
                : "Pick who leaves first — legality depends on the slot."
            }
          />
          <ul className="flex flex-col gap-2">
            {incoming.map((card) => {
              const selected = card.card_id === selection.incomingCardId;
              const { eligible, reason } = selected
                ? { eligible: true, reason: null }
                : incomingEligibility(card, pickedOut);
              return (
                <li key={card.card_id}>
                  <OfferButton
                    testId={`rtt-trade-in-${card.card_id}`}
                    selected={selected}
                    eligible={eligible}
                    reason={reason}
                    busy={busy}
                    onPick={() => handleIncoming(card.card_id)}
                    selectedLabel="Bringing in"
                  >
                    <RunCard card={card} cost={card.cost} strikeCost={card.base_cost} compact />
                  </OfferButton>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* ---- Step 3 — review, Step 4 — confirm ---------------------------- */}
      <div
        className="rounded-xl border p-3 flex flex-col gap-2.5"
        style={{
          background: "var(--bg-elevated)",
          borderColor: canConfirm ? "var(--peak-accent-dim)" : "var(--border-default)",
        }}
        data-testid="rtt-trade-summary"
      >
        <StepHeading step={3} title="Review the trade" done={canConfirm} />

        {review === null ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {pickedOut
              ? "Now pick one incoming player to see the full deal."
              : pickedIn
                ? "Now pick the roster player who leaves to see the full deal."
                : "Pick one roster player and one incoming player to see the full deal."}
          </p>
        ) : (
          <>
            {/* The one-line headline. `net N credits` is the phrasing the unit
                suite reads, and it is also the number the player is agreeing
                to — keep them the same sentence. */}
            <p className="text-sm" style={{ color: "var(--text-primary)" }}>
              {review.outgoing.card.player_name} out, {review.incoming.player_name} in — net{" "}
              <span
                className="score-number font-bold"
                style={{ color: review.net > 0 ? "var(--text-primary)" : "var(--correct)" }}
              >
                {review.net}
              </span>{" "}
              credits.
            </p>

            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              <Row
                label={`Refund · ${review.outgoing.card.player_name}`}
                value={`+${review.refund}`}
                color="var(--correct)"
              />
              <Row
                label={`Cost · ${review.incoming.player_name}`}
                value={`−${review.cost}`}
                color="var(--text-primary)"
              />
              <Row
                label="Net credit change"
                value={review.net === 0 ? "0" : formatSigned(-review.net, 0)}
                color={signedColorVar(-review.net)}
                testId="rtt-trade-net"
              />
              <Row
                label="Credits after the trade"
                value={String(review.creditsAfter)}
                color={review.affordable ? "var(--text-primary)" : "var(--incorrect)"}
                testId="rtt-trade-credits-after"
              />
              <Row label={`Role in ${review.slotLabel}, before`} value={review.roleBefore} />
              <Row label={`Role in ${review.slotLabel}, after`} value={review.roleAfter} />
            </dl>

            {/* Projected five-lane change. Explicitly the CARDS' change, not
                the roster's — the roster total also depends on starter/bench
                weighting, and only the server recomputes that. */}
            <div className="flex flex-col gap-1" data-testid="rtt-trade-lane-preview">
              <span
                className="text-[9px] font-bold uppercase tracking-widest"
                style={{ color: "var(--text-muted)" }}
              >
                Five-lane change in this slot
              </span>
              <ul className="flex flex-col gap-0.5">
                {review.laneDeltas.map((lane) => (
                  <li
                    key={lane.lane}
                    className="flex items-center gap-2 text-[10px]"
                    data-testid={`rtt-trade-lane-${lane.lane}`}
                  >
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: laneColorVar(lane.token) }}
                    />
                    <span className="min-w-0 flex-1 truncate" style={{ color: "var(--text-muted)" }}>
                      {lane.label}
                    </span>
                    <span className="score-number shrink-0" style={{ color: "var(--text-muted)" }}>
                      {lane.outgoing.toFixed(0)}
                    </span>
                    <ArrowRight size={9} aria-hidden="true" style={{ color: "var(--text-muted)" }} />
                    <span
                      className="score-number shrink-0"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {lane.incoming.toFixed(0)}
                    </span>
                    <span
                      className="score-number w-11 shrink-0 text-right font-semibold"
                      style={{ color: signedColorVar(lane.delta) }}
                    >
                      {formatSigned(lane.delta, 1)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-[9px]" style={{ color: "var(--text-muted)" }}>
                These are the two cards&apos; own lane values on the 0-100 scale the battle uses.
                Your roster total also depends on starter/bench weighting, which the server
                recomputes when the trade lands.
              </p>
            </div>

            <p
              className="text-[11px] font-semibold"
              data-testid="rtt-trade-legality"
              style={{ color: review.legal ? "var(--correct)" : "var(--incorrect)" }}
            >
              {review.legal
                ? `Roster stays legal — the model lists ${review.slotLabel} among ${review.incoming.player_name}'s eligible slots.`
                : review.blockedReason}
            </p>
            {review.legal && review.blockedReason && (
              <p
                className="text-[11px] font-semibold"
                style={{ color: "var(--incorrect)" }}
                data-testid="rtt-trade-affordability"
              >
                {review.blockedReason}
              </p>
            )}
          </>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="rtt-trade-confirm"
            onClick={() => {
              if (!review || !canConfirm) return;
              onTrade(review.outgoing.slot_id, review.incoming.card_id, review.net);
            }}
            disabled={busy || !canConfirm}
            className="rtt-tap rounded-lg px-4 text-xs font-bold uppercase tracking-wide disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
          >
            Confirm trade
          </button>
          <button
            type="button"
            data-testid="rtt-trade-cancel"
            onClick={() => setSelection(clearTradeSelection())}
            disabled={busy || (pickedIn === null && pickedOut === null)}
            className="rtt-tap rounded-lg px-4 text-xs font-semibold uppercase tracking-wide disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: "var(--bg-surface)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-default)",
            }}
          >
            Cancel
          </button>
        </div>
      </div>

      {node.can_decline && (
        <div>
          <button
            type="button"
            data-testid="rtt-trade-decline"
            onClick={onDecline}
            disabled={busy}
            className="rtt-tap rounded-lg px-4 text-xs font-semibold uppercase tracking-wide disabled:opacity-60"
            style={{
              background: "var(--bg-surface)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-default)",
            }}
          >
            Decline · stand pat
          </button>
        </div>
      )}

      {/* LAST in DOM order — see the note in DraftRoom.tsx. The e2e driver
          clicks `rtt-trade-decline` here, but the rule is the same everywhere:
          a coachmark's "Got it" never precedes a surface's action controls. */}
      <Coachmark id="trade_desk" />
    </section>
  );
}

/** A numbered step header. The number and the tick are the non-colour half of
 *  "state is never carried by colour alone". */
function StepHeading({
  step,
  title,
  done,
  hint,
}: {
  step: number;
  title: string;
  done: boolean;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <h3 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest">
        <span
          aria-hidden="true"
          className="rtt-step-chip"
          data-done={done ? "true" : "false"}
          style={{
            background: done ? "var(--peak-accent)" : "var(--bg-surface)",
            color: done ? "var(--text-inverse)" : "var(--text-muted)",
            borderColor: done ? "var(--peak-accent)" : "var(--border-default)",
          }}
        >
          {done ? <Check size={9} strokeWidth={3.5} /> : step}
        </span>
        <span style={{ color: done ? "var(--text-primary)" : "var(--text-muted)" }}>
          Step {step} · {title}
        </span>
        <span className="sr-only">{done ? " — done" : " — not yet chosen"}</span>
      </h3>
      {hint && (
        <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * One selectable card button.
 *
 * `selected` and `eligible` are mutually exclusive by construction upstream, so
 * this is a flat three-way switch rather than the nested ternary whose priority
 * order was the original bug. An ineligible button is `aria-disabled` with a
 * click guard rather than `disabled`: `disabled` strips it from the tab order,
 * and the reason it is inert is exactly what a keyboard user needs to reach.
 * `busy` is transient and still uses real `disabled`.
 */
function OfferButton({
  testId,
  selected,
  eligible,
  reason,
  advisory = null,
  busy,
  onPick,
  selectedLabel,
  children,
}: {
  testId: string;
  selected: boolean;
  eligible: boolean;
  reason: string | null;
  /** A consequence of pressing this, in a NEUTRAL tone. Not an error. */
  advisory?: string | null;
  busy: boolean;
  onPick: () => void;
  selectedLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-selected={selected ? "true" : "false"}
      data-eligible={eligible ? "true" : "false"}
      aria-pressed={selected}
      aria-disabled={!eligible || undefined}
      onClick={() => {
        if (!eligible) return;
        onPick();
      }}
      disabled={busy}
      className="rtt-offer-btn w-full text-left disabled:opacity-60"
      style={{
        // Recessed by FILL and BORDER, never by an opacity wash: a 0.55 wash
        // put --text-secondary at 2.61:1, and the reason text is the one thing
        // on an inert card that must stay readable. Same treatment DraftRoom
        // already gives a blocked offer.
        borderColor: selected
          ? "var(--peak-accent)"
          : eligible
            ? "var(--border-default)"
            : "var(--border-subtle)",
        background: selected
          ? "var(--peak-accent-bg)"
          : eligible
            ? "var(--bg-elevated)"
            : "var(--bg-page)",
      }}
    >
      {selected && (
        <span
          className="mb-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
          style={{ background: "var(--peak-accent-bg)", color: "var(--peak-accent)" }}
        >
          <Check size={9} strokeWidth={3.5} aria-hidden="true" />
          {selectedLabel}
        </span>
      )}
      {children}
      {!eligible && reason && (
        <span
          className="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold"
          style={{
            background: "var(--bg-surface)",
            // --incorrect neat is 4.52:1 on this fill — passing but tight. The
            // same 85% mix toward --text-primary that RunMap's "Lost" uses,
            // for 5.22:1.
            color: "color-mix(in srgb, var(--incorrect) 85%, var(--text-primary))",
          }}
        >
          <Ban size={9} aria-hidden="true" />
          {reason}
        </span>
      )}
      {eligible && advisory && (
        <span
          className="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]"
          style={{ background: "var(--bg-surface)", color: "var(--text-secondary)" }}
          data-testid={`${testId}-advisory`}
        >
          <ArrowRight size={9} aria-hidden="true" />
          {advisory}
        </span>
      )}
    </button>
  );
}

/** One `<dt>/<dd>` pair in the review grid. */
function Row({
  label,
  value,
  color = "var(--text-secondary)",
  testId,
}: {
  label: string;
  value: string;
  color?: string;
  testId?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 min-w-0">
      <dt className="truncate" style={{ color: "var(--text-muted)" }}>
        {label}
      </dt>
      <dd
        className="score-number shrink-0 font-semibold"
        style={{ color }}
        data-testid={testId}
      >
        {value}
      </dd>
    </div>
  );
}
