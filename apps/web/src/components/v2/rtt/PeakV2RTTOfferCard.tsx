"use client";

/**
 * PeakV2RTTOfferCard — one exact 3-year peak, dealt onto the table.
 *
 * The blueprint's card anatomy (exact window, name, PEAK3 score, role
 * eligibility, archetype) as a single large pressable object. Always
 * visible: window, name, prime score, primary role, the five-lane
 * fingerprint and the price. Revealed by the room around it, never here:
 * where it fits, what it replaces, what it costs you. Nothing is computed —
 * every number arrives on the card (`card_public()`); the fingerprint bars
 * are `lane_percentiles`, already 0-100.
 *
 * It ENTERS (a `CardArrival`, staggered by `index`) and it is never swapped
 * in place: a refreshed market deals new cards.
 */

import type { ReactNode } from "react";
import CardArrival from "@/components/game-feel/CardArrival";
import { LANE_FIELDS, type RunCardPublic } from "@/types/run-the-table";
import { LANE_LABELS, LANE_TOKEN_BY_FIELD, ROLE_LABELS, cardLaneSummary, describeCostModifiers } from "@/lib/run-the-table-state";
import { v2ToneVar, type V2ComponentTone } from "../v2-tone";

const LANE_TOKEN_TO_TONE: Record<string, V2ComponentTone> = { si: "si", tp: "tp", rec: "rec", po: "po", team: "team" };

export interface PeakV2RTTOfferCardProps {
  card: RunCardPublic;
  /** Deal order, for the entrance stagger. */
  index?: number;
  /** A key that changes when the BOARD changes (a refresh), so the deal replays. */
  dealKey?: string;
  selected?: boolean;
  /** Not currently selectable; `blockedReason` says why. */
  blocked?: boolean;
  blockedReason?: string | null;
  /** "25", "FREE", "Reserved · 19". */
  price: ReactNode;
  priceTone?: "accent" | "positive" | "muted";
  /** A short badge: "Reserved", "Bench", "Starter". */
  badge?: ReactNode;
  /** One optional line under the fingerprint (scout relevance). */
  note?: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  size?: "md" | "lg";
  testId?: string;
  className?: string;
  /** Renders as a non-interactive panel (boss lineups, receipts). */
  readonly?: boolean;
}

export default function PeakV2RTTOfferCard({
  card,
  index = 0,
  dealKey = "",
  selected = false,
  blocked = false,
  blockedReason = null,
  price,
  priceTone = "accent",
  badge,
  note,
  onSelect,
  disabled = false,
  size = "md",
  testId,
  className,
  readonly = false,
}: PeakV2RTTOfferCardProps) {
  const summary = cardLaneSummary(card.lane_percentiles);
  const modifiers = describeCostModifiers(card.cost_modifiers ?? []);
  const body = (
    <>
      <span className="rtt-card-top">
        <span className="rtt-card-window">{card.window_label}</span>
        <span className="rtt-card-price" data-tone={priceTone}>
          {price}
        </span>
      </span>
      <span className="rtt-card-name">{card.player_name}</span>
      <span className="rtt-card-meta">
        <span className="rtt-card-score" aria-label={`PEAK3 prime score ${card.prime_score.toFixed(1)}`}>
          {card.prime_score.toFixed(1)}
        </span>
        <span className="rtt-card-role">{ROLE_LABELS[card.primary_role] ?? card.primary_role}</span>
        <span className="rtt-card-profile">{summary.profile}</span>
      </span>
      <span className="rtt-card-lanes" aria-hidden="true">
        {LANE_FIELDS.map((lane) => {
          const tone = LANE_TOKEN_TO_TONE[LANE_TOKEN_BY_FIELD[lane]] ?? "si";
          const pct = Math.max(3, Math.min(100, card.lane_percentiles?.[lane] ?? 0));
          return (
            <span key={lane} className="rtt-card-lane" title={`${LANE_LABELS[lane]} ${pct.toFixed(0)}th pct`}>
              <span className="rtt-card-lane-fill" style={{ height: `${pct}%`, background: v2ToneVar(tone) }} />
            </span>
          );
        })}
      </span>
      <span className="sr-only">
        Strongest lane {summary.strongest.label}, weakest {summary.weakest.label}.
      </span>
      {badge ? <span className="rtt-card-badge">{badge}</span> : null}
      {modifiers.length > 0 ? <span className="rtt-card-modifiers">{modifiers.join(" · ")}</span> : null}
      {note ? <span className="rtt-card-note">{note}</span> : null}
      {blocked && blockedReason ? <span className="rtt-card-blocked">{blockedReason}</span> : null}
    </>
  );

  const shared = {
    className: `rtt-card ${className ?? ""}`,
    "data-testid": testId,
    "data-selected": selected ? "true" : "false",
    "data-blocked": blocked ? "true" : "false",
    "data-size": size,
    style: { ["--rtt-deal-index" as string]: index } as React.CSSProperties,
  };

  return (
    <CardArrival arrivalKey={`${dealKey}:${card.card_id}`} variant="slot" as="li" className="rtt-card-arrival" skipInitial={false}>
      {readonly ? (
        <div {...shared} role="group" aria-label={`${card.player_name}, ${card.window_label}`}>
          {body}
        </div>
      ) : (
        <button
          type="button"
          {...shared}
          aria-pressed={selected}
          aria-disabled={blocked || undefined}
          disabled={disabled}
          onClick={() => {
            if (blocked) return;
            onSelect?.();
          }}
        >
          {body}
        </button>
      )}
    </CardArrival>
  );
}
