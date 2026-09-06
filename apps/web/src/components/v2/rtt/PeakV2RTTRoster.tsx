"use client";

/**
 * PeakV2RTTRoster — the team you are building, as pieces on a board.
 *
 * Seven `RosterSlotLock`s (five starters, two bench). A slot that just
 * received a card locks with the shared arrival beat and stays marked as
 * the newest piece until the next action; a slot the current selection could
 * land in reads `targeted`; the slot an in-flight signing is heading for
 * reads `pending`. Below it, Lineup DNA as five short bars — the one line of
 * fit information the brief allows during play — then perks and anything
 * armed, both compact.
 *
 * Every number is the server's (`state.lane_profile`, each card's
 * `prime_score`); this component only decides what is loud.
 */

import { useEffect, useRef, useState } from "react";
import RosterSlotLock from "@/components/game-feel/RosterSlotLock";
import { useArrivals } from "@/lib/game-feel/arrivals";
import { ROLE_LABELS, slotLabel } from "@/lib/run-the-table-state";
import { PERK_EXACT_RULE_LABEL, PERK_TERM, perkPlainEffect, perkStrategyHint } from "@/lib/run-the-table-copy";
import type { RunPublicState } from "@/types/run-the-table";
import { v2ToneVar, type V2ComponentTone } from "../v2-tone";

const LANE_TOKEN_TO_TONE: Record<string, V2ComponentTone> = { si: "si", tp: "tp", rec: "rec", po: "po", team: "team" };

export interface PeakV2RTTRosterProps {
  state: RunPublicState;
  /** Slots the current selection could legally fill. */
  targetedSlots?: readonly string[];
  /** The slot an in-flight signing is heading for. */
  pendingSlot?: string | null;
  /** `"rail"` (desktop column) or `"sheet"` (the phone's collapsible block). */
  variant?: "rail" | "sheet";
  /** The rail carries the testids; the phone sheet is the same data twice
   *  and must not duplicate them. */
  testIds?: boolean;
  className?: string;
}

export default function PeakV2RTTRoster({ state, targetedSlots = [], pendingSlot = null, variant = "rail", testIds = true, className }: PeakV2RTTRosterProps) {
  const tid = (id: string) => (testIds ? id : undefined);
  const slots = [...state.starters, ...state.bench];
  const occupants: Record<string, string | null> = {};
  for (const s of slots) occupants[s.slot_id] = s.card?.card_id ?? null;
  const beat = useArrivals(occupants, 900);

  // The newest piece stays marked until the roster changes again.
  const [newest, setNewest] = useState<string | null>(null);
  const runRef = useRef(state.run_id);
  useEffect(() => {
    if (runRef.current !== state.run_id) {
      runRef.current = state.run_id;
      setNewest(null);
      return;
    }
    const changed = [...beat.arrived, ...beat.swapped];
    if (changed.length > 0) setNewest(changed[0]);
  }, [beat, state.run_id]);

  const filled = slots.filter((s) => s.card).length;
  const reservation =
    state.armed?.reserved_card && (state.armed.reserved_card.status === "live" || state.armed.reserved_card.status === "offered")
      ? state.armed.reserved_card
      : null;
  const armed = state.armed && (state.armed.prep || state.armed.role_focus || reservation) ? state.armed : null;

  return (
    <div className={`rtt-lineup ${className ?? ""}`} data-variant={variant} data-testid={tid("rtt-roster")} data-tour-id={tid("rtt-roster")}>
      <div className="rtt-lineup-head">
        <span className="rtt-eyebrow">Your roster</span>
        <span className="rtt-lineup-count" data-testid={tid("rtt-roster-count")}>
          {filled}/{slots.length}
        </span>
      </div>
      <ul className="rtt-lineup-slots">
        {slots.map((slot) => {
          const filledSlot = slot.card !== null;
          const beatFor = beat.arrived.includes(slot.slot_id) ? "arrived" : beat.swapped.includes(slot.slot_id) ? "swapped" : null;
          const stateFor = pendingSlot === slot.slot_id ? "pending" : targetedSlots.includes(slot.slot_id) ? "targeted" : filledSlot ? "filled" : "empty";
          return (
            <RosterSlotLock
              key={slot.slot_id}
              slot={slotLabel(slot)}
              state={stateFor}
              beat={beatFor}
              size="sm"
              testId={tid(`rtt-roster-slot-${slot.slot_id}`)}
              className={`rtt-lineup-slot${newest === slot.slot_id ? " rtt-lineup-slot-newest" : ""}${slot.is_starter ? "" : " rtt-lineup-slot-bench"}`}
              placeholder={slot.is_starter ? "Open starter" : "Open"}
              figure={slot.card ? slot.card.prime_score.toFixed(1) : undefined}
            >
              {slot.card ? (
                <span className="rtt-lineup-name" data-newest={newest === slot.slot_id ? "true" : "false"}>
                  {slot.card.player_name}
                  <span className="rtt-lineup-window">{slot.card.anchor_season}</span>
                </span>
              ) : null}
            </RosterSlotLock>
          );
        })}
      </ul>

      <div className="rtt-dna" data-testid={tid("rtt-lane-profile")} data-tour-id={tid("rtt-lane-profile")}>
        <div className="rtt-lineup-head">
          <span className="rtt-eyebrow">Lineup DNA</span>
          <span className="rtt-lineup-count" data-testid={tid("rtt-roster-total")}>
            {state.roster_total.toFixed(1)}
          </span>
        </div>
        <ul className="rtt-dna-bars">
          {state.lane_profile.map((lane) => {
            const tone = LANE_TOKEN_TO_TONE[lane.token] ?? "si";
            return (
              <li key={lane.lane} className="rtt-dna-row" title={`${lane.label} ${lane.value.toFixed(1)}`}>
                <span className="rtt-dna-label">{shortLane(lane.label)}</span>
                <span className="rtt-dna-track" aria-hidden="true">
                  <span className="rtt-dna-fill" style={{ width: `${Math.max(2, Math.min(100, lane.value))}%`, background: v2ToneVar(tone) }} />
                </span>
                <span className="rtt-dna-value">{lane.value.toFixed(1)}</span>
                <span className="sr-only">
                  {lane.label} {lane.value.toFixed(1)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {armed ? (
        <div className="rtt-armed" data-testid={tid("rtt-armed")}>
          <span className="rtt-eyebrow">Armed</span>
          {armed.prep ? (
            <p data-testid={tid("rtt-armed-prep")}>
              <strong>{armed.prep.label}</strong> +{armed.prep.bonus} for the act {armed.prep.act} boss.
            </p>
          ) : null}
          {armed.role_focus ? (
            <p data-testid={tid("rtt-armed-role-focus")}>
              Role Focus: <strong>{ROLE_LABELS[armed.role_focus.role]}</strong> guaranteed in the next market.
            </p>
          ) : null}
          {reservation ? (
            <p data-testid={tid("rtt-armed-reservation")}>
              One card reserved at <strong>{reservation.locked_cost}</strong> credits
              {reservation.status === "offered" ? " — on this board." : " — next Draft Room."}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="rtt-perks" data-testid={tid("rtt-active-systems")} data-tour-id={tid("rtt-systems")}>
        <span className="rtt-eyebrow">{PERK_TERM.plural ?? PERK_TERM.display}</span>
        {state.systems.length === 0 ? (
          <p className="rtt-perks-none">None yet.</p>
        ) : (
          <ul className="rtt-perks-list">
            {state.systems.map((sys) => {
              const plain = perkPlainEffect(sys.id);
              const hint = perkStrategyHint(sys.id);
              return (
                <li key={sys.id} data-testid={tid(`rtt-tray-system-${sys.id}`)}>
                  <span className="rtt-perk-name">{sys.name}</span>
                  <span className="rtt-perk-effect">{plain ?? sys.summary}</span>
                  {hint ? <span className="rtt-perk-hint">{hint}</span> : null}
                  {plain ? (
                    <details data-testid={tid(`rtt-tray-system-rule-${sys.id}`)} className="rtt-perk-rule">
                      <summary>
                        {PERK_EXACT_RULE_LABEL}
                        <span className="sr-only"> for {sys.name}</span>
                      </summary>
                      <span>{sys.summary}</span>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Two-word lane labels for a 240px rail: the full label is in the title
 *  attribute and the sr-only sentence. */
function shortLane(label: string): string {
  switch (label) {
    case "Statistical Impact":
      return "Impact";
    case "Traditional Production":
      return "Production";
    case "Individual Recognition":
      return "Recognition";
    case "Playoff Rate Impact":
      return "Playoffs";
    case "Team Result":
      return "Team";
    default:
      return label;
  }
}
