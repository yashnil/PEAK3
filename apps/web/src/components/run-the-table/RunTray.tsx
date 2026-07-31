"use client";
import PlayerAvatar from "@/components/court/PlayerAvatar";
import { RunPublicState } from "@/types/run-the-table";
import { slotLabel } from "@/lib/run-the-table-state";
import LaneProfile from "./LaneProfile";

/**
 * The persistent right-hand tray: resources, then the 5+2 roster, then active
 * Systems, then the five-lane profile.
 *
 * Every number here is straight off `public_state()` — credits, lives, the
 * lane profile and `roster_total` are all the engine's own values, so what the
 * tray shows is exactly what the next battle resolves against.
 */
interface Props {
  state: RunPublicState;
}

export default function RunTray({ state }: Props) {
  const roster = [...state.starters, ...state.bench];
  return (
    <aside data-testid="rtt-tray" className="flex flex-col gap-3">
      <h2
        className="text-[10px] font-bold uppercase tracking-widest"
        style={{ color: "var(--text-muted)" }}
      >
        Front office
      </h2>

      {/* Resources */}
      <div className="grid grid-cols-3 gap-2">
        <Tile
          label="Credits"
          value={String(state.credits)}
          accent="var(--peak-accent)"
          testid="rtt-credits"
        />
        <Tile
          label="Lives"
          value={`${state.lives}/${state.max_lives}`}
          accent={state.lives <= 1 ? "var(--incorrect)" : "var(--correct)"}
          testid="rtt-lives"
        />
        <Tile
          label="Act"
          value={`${Math.min(state.act, state.acts_total)}/${state.acts_total}`}
          accent="var(--text-primary)"
          testid="rtt-act"
        />
      </div>

      {/* Roster */}
      <section
        className="rounded-xl border p-2.5 flex flex-col gap-2"
        style={{ background: "var(--bg-elevated)", borderColor: "var(--border-default)" }}
      >
        <h3
          className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: "var(--text-muted)" }}
        >
          Roster · 5 + 2
        </h3>
        <ul className="flex flex-col gap-1">
          {roster.map((slot) => (
            <li
              key={slot.slot_id}
              data-testid={`rtt-slot-${slot.slot_id}`}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 min-w-0"
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
                    style={{ color: "var(--peak-accent)" }}
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

      {/* Systems */}
      <section
        className="rounded-xl border p-2.5 flex flex-col gap-1.5"
        style={{ background: "var(--bg-elevated)", borderColor: "var(--border-default)" }}
        data-testid="rtt-active-systems"
      >
        <h3
          className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: "var(--text-muted)" }}
        >
          Systems
        </h3>
        {state.systems.length === 0 ? (
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            None yet.
          </p>
        ) : (
          state.systems.map((sys) => (
            <div key={sys.id} className="flex flex-col">
              <span className="text-[11px] font-semibold" style={{ color: "var(--peak-accent)" }}>
                {sys.name}
              </span>
              <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
                {sys.summary}
              </span>
            </div>
          ))
        )}
        {state.veteran_minimum_used_this_act && (
          <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            Veteran Minimum already used this act.
          </p>
        )}
      </section>

      {/* Lane profile */}
      <section
        className="rounded-xl border p-2.5 flex flex-col gap-2"
        style={{ background: "var(--bg-elevated)", borderColor: "var(--border-default)" }}
      >
        <div className="flex items-baseline justify-between gap-2">
          <h3
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: "var(--text-muted)" }}
          >
            Lane profile
          </h3>
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            Total{" "}
            <span className="score-number" style={{ color: "var(--text-primary)" }}>
              {state.roster_total.toFixed(1)}
            </span>
          </span>
        </div>
        <LaneProfile lanes={state.lane_profile} dense showWeights />
        <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          Bench counts at{" "}
          <span className="score-number">{state.bench_weight.toFixed(2)}</span> of a starter.
        </p>
      </section>
    </aside>
  );
}

function Tile({
  label,
  value,
  accent,
  testid,
}: {
  label: string;
  value: string;
  accent: string;
  testid: string;
}) {
  return (
    <div
      data-testid={testid}
      className="rounded-xl border px-2 py-2 flex flex-col items-center gap-0.5"
      style={{ background: "var(--bg-elevated)", borderColor: "var(--border-default)" }}
    >
      <span className="text-[9px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
      <span className="score-number text-lg font-bold leading-none" style={{ color: accent }}>
        {value}
      </span>
    </div>
  );
}
