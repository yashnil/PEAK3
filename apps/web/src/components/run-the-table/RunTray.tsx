"use client";
import { useEffect, useState } from "react";
import PlayerAvatar from "@/components/court/PlayerAvatar";
import { AnimatedNumber } from "@/components/ui";
import { RunPublicState } from "@/types/run-the-table";
import { ROLE_LABELS, filledCount, slotLabel } from "@/lib/run-the-table-state";
import {
  LANE_PROFILE_TERM,
  PERK_EXACT_RULE_LABEL,
  PERK_TERM,
  perkPlainEffect,
  perkStrategyHint,
} from "@/lib/run-the-table-copy";
import LaneProfile from "./LaneProfile";

/**
 * The persistent front-office rail: a compact scoreboard, then the 5+2 roster,
 * then the active Front Office Perks, then the five-lane profile.
 *
 * Every number here is straight off `public_state()` — credits, lives, the
 * lane profile and `roster_total` are all the engine's own values, so what the
 * rail shows is exactly what the next battle resolves against.
 *
 * Rendered ONCE by `RunTheTableGame` (it used to be two instances, a desktop
 * rail and a mobile copy, which duplicated every `data-testid`). Each
 * `data-tour-id` below is therefore unique in the document, which is what W3's
 * spotlight requires.
 */
interface Props {
  state: RunPublicState;
  /**
   * Is the lane profile the thing the player is currently deciding on?
   *
   * Open on the boss preview and the battle, where the five lanes ARE the
   * decision; summarised to one line everywhere else, so the rail does not
   * spend a third of its height on a chart nobody is reading. A player who
   * disagrees just opens it — the `<details>` keeps whatever they chose.
   */
  laneProfileRelevant?: boolean;
}

export default function RunTray({ state, laneProfileRelevant = false }: Props) {
  const roster = [...state.starters, ...state.bench];
  const filled = filledCount(roster);
  /**
   * The v3 "armed" block, or null when nothing is armed.
   *
   * A reservation only counts while it can still be BOUGHT (`live` or
   * `offered`): once it is used or has expired it is history, and printing it
   * would tell the player they still hold something they do not.
   */
  const reservation =
    state.armed?.reserved_card &&
    (state.armed.reserved_card.status === "live" ||
      state.armed.reserved_card.status === "offered")
      ? state.armed.reserved_card
      : null;
  const armed =
    state.armed && (state.armed.prep || state.armed.role_focus || reservation)
      ? state.armed
      : null;
  const [laneOpen, setLaneOpen] = useState(laneProfileRelevant);

  // Follows relevance when the screen changes, but a manual toggle survives
  // re-renders of the same screen.
  useEffect(() => {
    setLaneOpen(laneProfileRelevant);
  }, [laneProfileRelevant]);

  return (
    <aside data-testid="rtt-tray" className="flex flex-col gap-3">
      <h2
        className="text-[10px] font-bold uppercase tracking-widest"
        style={{ color: "var(--text-muted)" }}
      >
        Front office
      </h2>

      {/* Scoreboard — three numbers, one line, no chrome competing with the
          decision column. */}
      <div className="rtt-scoreboard" data-testid="rtt-scoreboard">
        <Tile
          label="Credits"
          accent="var(--peak-accent)"
          testid="rtt-credits"
          tourId="rtt-credits"
          /* Counts, but `AnimatedNumber` assigns the authoritative value on the
             terminal frame and carries it in an sr-only sibling from the first
             paint — the displayed credits are never a rounded tween. */
          value={
            <AnimatedNumber
              value={state.credits}
              className="text-lg font-bold leading-none"
            />
          }
        />
        <Tile
          label="Lives"
          accent={state.lives <= 1 ? "var(--incorrect)" : "var(--correct)"}
          testid="rtt-lives"
          tourId="rtt-lives"
          value={`${state.lives}/${state.max_lives}`}
        />
        <Tile
          label="Act"
          accent="var(--text-primary)"
          testid="rtt-act"
          value={`${Math.min(state.act, state.acts_total)}/${state.acts_total}`}
        />
      </div>

      {/* Roster */}
      <section
        className="rounded-xl border p-2.5 flex flex-col gap-2"
        style={{ background: "var(--bg-elevated)", borderColor: "var(--border-default)" }}
        data-tour-id="rtt-roster"
      >
        <div className="flex items-baseline justify-between gap-2">
          <h3
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: "var(--text-muted)" }}
          >
            Roster · 5 + 2
          </h3>
          <span className="score-number text-[10px]" style={{ color: "var(--text-secondary)" }}>
            {filled}/{roster.length} filled
          </span>
        </div>
        <ul className="flex flex-col gap-1">
          {roster.map((slot) => (
            <li
              key={slot.slot_id}
              data-testid={`rtt-slot-${slot.slot_id}`}
              data-filled={slot.card ? "true" : "false"}
              /* `rtt-roster-row` gives a filled slot a short settle-in when it
                 first appears, so a card bought in the Draft Room visibly
                 lands here rather than materialising between frames. Reduced
                 motion drops it in globals-adjacent CSS. */
              className="rtt-roster-row min-w-0"
              style={{
                background: slot.is_starter ? "var(--bg-surface)" : "transparent",
                border: `1px solid ${slot.is_starter ? "var(--border-subtle)" : "transparent"}`,
              }}
            >
              <span
                className="w-[70px] shrink-0 text-[10px] uppercase tracking-wide"
                style={{ color: "var(--text-muted)" }}
              >
                {slotLabel(slot)}
              </span>
              {slot.card ? (
                <>
                  <PlayerAvatar name={slot.card.player_name} size={22} />
                  <span className="flex flex-col min-w-0">
                    <span
                      className="truncate text-[11px] font-semibold"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {slot.card.player_name}
                    </span>
                    <span className="truncate text-[9px]" style={{ color: "var(--text-muted)" }}>
                      {slot.card.window_label}
                    </span>
                  </span>
                  <span
                    className="score-number ml-auto shrink-0 text-[11px]"
                    style={{ color: "var(--peak-accent-text)" }}
                  >
                    {slot.card.prime_score.toFixed(1)}
                  </span>
                </>
              ) : (
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  Empty
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Front Office Perks (internally: Systems) */}
      <section
        className="rounded-xl border p-2.5 flex flex-col gap-1.5"
        style={{ background: "var(--bg-elevated)", borderColor: "var(--border-default)" }}
        data-testid="rtt-active-systems"
        data-tour-id="rtt-systems"
      >
        {/* Plan §5.2's terminology layer, via W3's `run-the-table-copy`: the
            user-facing label is "Front Office Perk" and the official internal
            name ("System") is always shown alongside rather than replacing it.
            The API field is still `systems` — no canonical name is renamed. */}
        <h3
          className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: "var(--text-muted)" }}
        >
          {PERK_TERM.plural ?? PERK_TERM.display}
        </h3>
        {state.systems.length === 0 ? (
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            None yet.
          </p>
        ) : (
          state.systems.map((sys) => {
            const plain = perkPlainEffect(sys.id);
            const hint = perkStrategyHint(sys.id);
            return (
              <div key={sys.id} className="flex flex-col" data-testid={`rtt-tray-system-${sys.id}`}>
                <span className="text-[11px] font-semibold" style={{ color: "var(--peak-accent-text)" }}>
                  {sys.name}
                </span>
                {/* The same three layers as `SystemSelect` (plan §6): plain
                    effect, one hint, then the engine's own summary verbatim
                    behind `See exact rule`. The rail used to print the plain
                    line AND the dense threshold line unconditionally, so the
                    thing a player glances at mid-run was two sentences of
                    percentiles. It is still one tap away, never removed. */}
                <span className="text-[10px]" style={{ color: "var(--text-primary)" }}>
                  {plain ?? sys.summary}
                </span>
                {hint && (
                  <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {hint}
                  </span>
                )}
                {plain && (
                  <details data-testid={`rtt-tray-system-rule-${sys.id}`}>
                    <summary
                      className="cursor-pointer select-none text-[10px]"
                      style={{
                        color: "var(--text-muted)",
                        textDecoration: "underline",
                        textUnderlineOffset: "2px",
                      }}
                    >
                      {PERK_EXACT_RULE_LABEL}
                      <span className="sr-only"> for {sys.name}</span>
                    </summary>
                    <span
                      className="block pt-0.5 text-[10px]"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {sys.summary}
                    </span>
                  </details>
                )}
              </div>
            );
          })
        )}
        <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          {PERK_TERM.tooltip}
        </p>
        {state.veteran_minimum_used_this_act && (
          <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            Veteran Minimum already used this act.
          </p>
        )}
      </section>

      {/*
        WHAT IS ARMED RIGHT NOW (v3, spec §4/§5).

        A preparation, a Role Focus and a reservation are all things the player
        has already spent on and will not see again until the moment they fire —
        a lane bonus lands inside a battle two nodes later, a Role Focus shapes a
        market the player has not opened yet, a reservation turns up in a Draft
        Room that does not exist on screen. Without this block the credits are
        simply gone from the counter with nothing to show for them.

        Rendered only when something IS armed, so the rail costs nothing on the
        many nodes where none of it applies. Every value is `state.armed`'s.
      */}
      {armed && (
        <section
          className="flex flex-col gap-1 rounded-xl border p-2.5"
          style={{ background: "var(--bg-elevated)", borderColor: "var(--peak-accent)" }}
          data-testid="rtt-armed"
        >
          <h3
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: "var(--text-muted)" }}
          >
            Armed
          </h3>
          {armed.prep && (
            <p className="text-[11px]" data-testid="rtt-armed-prep" style={{ color: "var(--text-primary)" }}>
              <span style={{ color: "var(--peak-accent-text)" }}>{armed.prep.label}</span> prepared{" "}
              <span className="score-number">+{armed.prep.bonus}</span> for the act{" "}
              {armed.prep.act} boss. Spent in that battle either way.
            </p>
          )}
          {armed.role_focus && (
            <p className="text-[11px]" data-testid="rtt-armed-role-focus" style={{ color: "var(--text-primary)" }}>
              Role Focus on{" "}
              <span style={{ color: "var(--peak-accent-text)" }}>
                {ROLE_LABELS[armed.role_focus.role]}
              </span>{" "}
              — the next market will carry a legal offer for it.
            </p>
          )}
          {reservation && (
            <p className="text-[11px]" data-testid="rtt-armed-reservation" style={{ color: "var(--text-primary)" }}>
              One card reserved at{" "}
              <span className="score-number">{reservation.locked_cost}</span> credits
              {reservation.status === "offered"
                ? " — it is on this board now."
                : " — it appears in the next Draft Room."}
            </p>
          )}
        </section>
      )}

      {/* Lane profile — collapsible, because it is the decision only at a boss */}
      <details
        className="rtt-lane-details rounded-xl border p-2.5"
        style={{ background: "var(--bg-elevated)", borderColor: "var(--border-default)" }}
        data-tour-id="rtt-lane-profile"
        data-testid="rtt-lane-profile-panel"
        open={laneOpen}
        onToggle={(e) => setLaneOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="flex cursor-pointer select-none items-baseline justify-between gap-2">
          <h3
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: "var(--text-muted)" }}
            title={LANE_PROFILE_TERM.tooltip}
          >
            {LANE_PROFILE_TERM.display}
          </h3>
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            Total{" "}
            <span className="score-number" style={{ color: "var(--text-primary)" }}>
              {state.roster_total.toFixed(1)}
            </span>
          </span>
        </summary>
        <div className="flex flex-col gap-2 pt-2">
          <LaneProfile lanes={state.lane_profile} dense showWeights animate />
          <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            Bench counts at{" "}
            <span className="score-number">{state.bench_weight.toFixed(2)}</span> of a starter.{" "}
            {LANE_PROFILE_TERM.tooltip}
          </p>
        </div>
      </details>
    </aside>
  );
}

function Tile({
  label,
  value,
  accent,
  testid,
  tourId,
}: {
  label: string;
  value: React.ReactNode;
  accent: string;
  testid: string;
  tourId?: string;
}) {
  return (
    <div
      data-testid={testid}
      data-tour-id={tourId}
      className="rtt-scoreboard-tile"
      style={{ background: "var(--bg-elevated)", borderColor: "var(--border-default)" }}
    >
      <span className="text-[9px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
      <span
        className="score-number text-lg font-bold leading-none"
        style={{ color: accent }}
      >
        {value}
      </span>
    </div>
  );
}
