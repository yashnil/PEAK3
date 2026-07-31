"use client";
import { useState } from "react";
import { ActiveNode, TradeIncoming, TradeOutgoingOption } from "@/types/run-the-table";
import {
  isTradeLegal,
  slotLabel,
  tradeIncoming,
  tradeNetCost,
  tradeOutgoing,
} from "@/lib/run-the-table-state";
import RunCard from "./RunCard";

/**
 * Trade Desk: send one roster card out, bring one incoming card in.
 *
 * Legality is `incoming.legal_slots.includes(outgoing.slot_id)` — the SERVER's
 * list, never a client-side re-derivation of role eligibility. The net cost is
 * `incoming.cost - outgoing.refund`, both of which are on the payload; nothing
 * here applies a refund percentage or a System discount.
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
  const [incomingId, setIncomingId] = useState<string | null>(null);
  const [outgoingId, setOutgoingId] = useState<string | null>(null);

  const pickedIn: TradeIncoming | null = incoming.find((c) => c.card_id === incomingId) ?? null;
  const pickedOut: TradeOutgoingOption | null =
    outgoing.find((s) => s.slot_id === outgoingId) ?? null;

  const legal = pickedIn && pickedOut ? isTradeLegal(pickedIn, pickedOut.slot_id) : false;
  const net = pickedIn && pickedOut ? tradeNetCost(pickedIn, pickedOut) : 0;
  const affordable = net <= credits;

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
      </header>

      {/* Container query, not `lg:` — see `.rtt-decision-surface`. At a
          1024px viewport `lg:grid-cols-2` split a 324px column into two
          ~150px card lists. */}
      <div className="grid gap-3 @[520px]:grid-cols-2">
        <div className="flex flex-col gap-2 min-w-0">
          <h3
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: "var(--text-muted)" }}
          >
            Incoming
          </h3>
          <ul className="flex flex-col gap-2">
            {incoming.map((card) => {
              const selected = card.card_id === incomingId;
              const compatible = !pickedOut || isTradeLegal(card, pickedOut.slot_id);
              return (
                <li key={card.card_id}>
                  <button
                    type="button"
                    data-testid={`rtt-trade-in-${card.card_id}`}
                    aria-pressed={selected}
                    onClick={() => setIncomingId(selected ? null : card.card_id)}
                    disabled={busy}
                    className="rtt-offer-btn w-full text-left disabled:opacity-60"
                    style={{
                      // No `opacity: 0.55` here. These buttons are NOT
                      // disabled — picking one is how you discover the trade
                      // is illegal — so the WCAG inactive-control exemption
                      // does not apply, and the wash put --text-secondary at
                      // 2.61:1. Ineligibility is carried by the border and
                      // the badge below instead.
                      borderColor: selected
                        ? "var(--peak-accent)"
                        : compatible
                          ? "var(--border-default)"
                          : "var(--incorrect-dim)",
                      background: selected ? "var(--peak-accent-bg)" : "var(--bg-elevated)",
                    }}
                  >
                    <RunCard card={card} cost={card.cost} strikeCost={card.base_cost} compact />
                    {!compatible && (
                      <span
                        className="mt-1 inline-block text-[10px] font-semibold rounded px-1.5 py-0.5"
                        style={{
                          background: "var(--incorrect-bg)",
                          // --incorrect neat is 4.52:1 on this wash — passing but
                          // tight. Same 85% mix toward --text-primary that
                          // RunMap's "Lost" uses, for 5.22:1.
                          color: "color-mix(in srgb, var(--incorrect) 85%, var(--text-primary))",
                        }}
                      >
                        Not eligible for {pickedOut ? slotLabel(pickedOut) : "that slot"}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex flex-col gap-2 min-w-0">
          <h3
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: "var(--text-muted)" }}
          >
            Outgoing
          </h3>
          <ul className="flex flex-col gap-2">
            {outgoing.map((slot) => {
              const selected = slot.slot_id === outgoingId;
              const compatible = !pickedIn || isTradeLegal(pickedIn, slot.slot_id);
              return (
                <li key={slot.slot_id}>
                  <button
                    type="button"
                    data-testid={`rtt-trade-out-${slot.slot_id}`}
                    aria-pressed={selected}
                    onClick={() => setOutgoingId(selected ? null : slot.slot_id)}
                    disabled={busy}
                    className="rtt-offer-btn w-full text-left disabled:opacity-60"
                    style={{
                      // Same reasoning as the incoming column: border + badge,
                      // not an opacity wash on live controls.
                      borderColor: selected
                        ? "var(--peak-accent)"
                        : compatible
                          ? "var(--border-default)"
                          : "var(--incorrect-dim)",
                      background: selected ? "var(--peak-accent-bg)" : "var(--bg-elevated)",
                    }}
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
                    {!compatible && (
                      <span
                        className="mt-1 inline-block text-[10px] font-semibold rounded px-1.5 py-0.5"
                        style={{
                          background: "var(--incorrect-bg)",
                          // --incorrect neat is 4.52:1 on this wash — passing but
                          // tight. Same 85% mix toward --text-primary that
                          // RunMap's "Lost" uses, for 5.22:1.
                          color: "color-mix(in srgb, var(--incorrect) 85%, var(--text-primary))",
                        }}
                      >
                        {pickedIn ? `${pickedIn.player_name} is not eligible here` : "Not eligible"}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div
        className="rounded-xl border p-3 flex flex-col gap-2"
        style={{ background: "var(--bg-elevated)", borderColor: "var(--border-default)" }}
        data-testid="rtt-trade-summary"
      >
        {pickedIn && pickedOut ? (
          <>
            <p className="text-sm" style={{ color: "var(--text-primary)" }}>
              {pickedOut.card.player_name} out, {pickedIn.player_name} in — net{" "}
              <span className="score-number font-bold" style={{ color: net > 0 ? "var(--text-primary)" : "var(--correct)" }}>
                {net}
              </span>{" "}
              credits.
            </p>
            {!legal && (
              <p className="text-xs font-semibold" style={{ color: "var(--incorrect)" }}>
                {pickedIn.player_name} is not eligible for {slotLabel(pickedOut)}.
              </p>
            )}
            {legal && !affordable && (
              <p className="text-xs font-semibold" style={{ color: "var(--incorrect)" }}>
                That leaves you short — you hold <span className="score-number">{credits}</span>.
              </p>
            )}
            <div>
              <button
                type="button"
                data-testid="rtt-trade-confirm"
                onClick={() => onTrade(pickedOut.slot_id, pickedIn.card_id, net)}
                disabled={busy || !legal || !affordable}
                className="rtt-tap rounded-lg px-4 text-xs font-bold uppercase tracking-wide disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "var(--peak-accent)", color: "#000" }}
              >
                Make the trade
              </button>
            </div>
          </>
        ) : (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Pick one incoming card and one roster card to see the net cost.
          </p>
        )}
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
    </section>
  );
}
