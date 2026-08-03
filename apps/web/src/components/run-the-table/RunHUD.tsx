"use client";
import { AnimatedNumber } from "@/components/ui";
import { RunPublicState } from "@/types/run-the-table";
import { ladderProgress } from "@/lib/run-the-table-state";

/**
 * The top HUD (PRODUCT_EXPERIENCE_CONTRACT.md §4): credits, lives, act/stage
 * progress, and the current objective — always visible, always the same
 * three numbers in the same order, minimal chrome. This is the promotion of
 * `RunTray`'s old scoreboard tiles to the top of the shell the contract asks
 * for ("promote that pattern to the top of the shell rather than burying it
 * inside the rail") — `RunTray` no longer renders them; see its docstring.
 *
 * Every number here is `public_state()`'s own value; nothing is derived or
 * recomputed. `objective` is the one thing this component does not own —
 * the caller already knows which screen is showing and what it is called,
 * so this stays a presentation of a string rather than a second switch
 * statement duplicating `RunTheTableGame`'s screen logic.
 */
interface Props {
  state: RunPublicState;
  /** A short label for the thing the player is currently looking at —
   *  "Draft Room", "Boss battle", "Choose a Front Office Perk", etc. */
  objective: string;
}

export default function RunHUD({ state, objective }: Props) {
  const progress = ladderProgress(state.map);
  return (
    <div className="rtt-hud" data-testid="rtt-hud">
      <div className="rtt-scoreboard rtt-hud-tiles" data-testid="rtt-scoreboard">
        <Tile
          label="Credits"
          accent="var(--peak-accent)"
          testid="rtt-credits"
          tourId="rtt-credits"
          value={<AnimatedNumber value={state.credits} className="text-lg font-bold leading-none" />}
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

      <div className="rtt-hud-objective min-w-0">
        <span
          className="truncate text-sm font-bold"
          style={{ color: "var(--text-primary)" }}
          data-testid="rtt-hud-objective"
        >
          {objective}
        </span>
        <span
          className="score-number text-[10px]"
          style={{ color: "var(--text-muted)" }}
          data-testid="rtt-hud-progress"
        >
          {progress.done} of {progress.total} stages complete
        </span>
      </div>
    </div>
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
      <span className="score-number text-lg font-bold leading-none" style={{ color: accent }}>
        {value}
      </span>
    </div>
  );
}
