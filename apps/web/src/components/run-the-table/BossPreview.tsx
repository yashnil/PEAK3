"use client";
import PlayerAvatar from "@/components/court/PlayerAvatar";
import { BossPublic, LaneProfileEntry } from "@/types/run-the-table";
import LaneProfile from "./LaneProfile";

/**
 * The pre-battle screen: who you are about to play, the rule in force, and
 * your lane profile against theirs.
 *
 * A boss's roster only renders when `revealed` is true. Until then the payload
 * genuinely does not contain it (see `boss_public`), and this screen shows the
 * act, name and rule only — enough to plan against, never the exact five.
 */
interface Props {
  boss: BossPublic;
  playerLanes: LaneProfileEntry[];
  playerTotal: number;
  benchWeight: number;
  lives: number;
  busy: boolean;
  onResolve: () => void;
}

export default function BossPreview({
  boss,
  playerLanes,
  playerTotal,
  benchWeight,
  lives,
  busy,
  onResolve,
}: Props) {
  return (
    <section data-testid="rtt-boss-preview" className="rtt-decision-surface flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <span
          className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: "var(--peak-accent)" }}
        >
          Act {boss.act} · Boss
        </span>
        <h2 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
          {boss.name}
        </h2>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {boss.tagline}
        </p>
      </header>

      {boss.rule && (
        <div
          data-testid="rtt-boss-rule"
          className="rounded-xl border p-3 flex flex-col gap-0.5"
          style={{ background: "var(--peak-accent-bg)", borderColor: "var(--peak-accent-dim)" }}
        >
          <span
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: "var(--peak-accent)" }}
          >
            Rule in force · {boss.rule.name}
          </span>
          <span className="text-xs" style={{ color: "var(--text-primary)" }}>
            {boss.rule.summary}
          </span>
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            Boss rules are symmetric — they apply to both teams and never change a player&apos;s
            own component values.
          </span>
        </div>
      )}

      {/* Container query, not `lg:` — see `.rtt-decision-surface`. */}
      <div className="grid gap-3 @[560px]:grid-cols-2">
        <div
          className="rounded-xl border p-3 flex flex-col gap-2"
          style={{ background: "var(--bg-elevated)", borderColor: "var(--border-default)" }}
        >
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-primary)" }}>
              Your five lanes
            </h3>
            <span className="score-number text-xs" style={{ color: "var(--text-secondary)" }}>
              {playerTotal.toFixed(1)}
            </span>
          </div>
          <LaneProfile
            lanes={playerLanes}
            compare={boss.revealed ? (boss.lane_profile ?? null) : null}
            compareLabel={boss.name}
            dense
          />
          <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            Bench counts at <span className="score-number">{benchWeight.toFixed(2)}</span>. You have{" "}
            <span className="score-number">{lives}</span> {lives === 1 ? "life" : "lives"} left.
          </p>
        </div>

        <div
          className="rounded-xl border p-3 flex flex-col gap-2"
          style={{ background: "var(--bg-elevated)", borderColor: "var(--border-default)" }}
        >
          <h3 className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-primary)" }}>
            {boss.name}&apos;s roster
          </h3>
          {boss.revealed && boss.starters ? (
            <ul className="flex flex-col gap-1">
              {boss.starters.map((card) => (
                <li key={card.card_id} className="flex items-center gap-2 min-w-0">
                  <PlayerAvatar name={card.player_name} size={22} />
                  <span className="truncate text-[11px]" style={{ color: "var(--text-primary)" }}>
                    {card.player_name}
                  </span>
                  <span className="truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {card.window_label}
                  </span>
                  <span
                    className="score-number ml-auto text-[11px]"
                    style={{ color: "var(--peak-accent)" }}
                  >
                    {card.prime_score.toFixed(1)}
                  </span>
                </li>
              ))}
              {(boss.bench ?? []).map((card) => (
                <li key={card.card_id} className="flex items-center gap-2 min-w-0 opacity-70">
                  <PlayerAvatar name={card.player_name} size={18} />
                  <span className="truncate text-[10px]" style={{ color: "var(--text-secondary)" }}>
                    {card.player_name} · bench
                  </span>
                  <span
                    className="score-number ml-auto text-[10px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {card.prime_score.toFixed(1)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Not scouted. You know the act, the name and the rule — not the five. A Film Room
              scout would have shown you this.
            </p>
          )}
        </div>
      </div>

      <div>
        <button
          type="button"
          data-testid="rtt-resolve-boss"
          onClick={onResolve}
          disabled={busy}
          className="rtt-tap rounded-lg px-6 text-sm font-bold uppercase tracking-wide disabled:opacity-60"
          style={{ background: "var(--peak-accent)", color: "#000" }}
        >
          {busy ? "Playing…" : "Play the game"}
        </button>
      </div>
    </section>
  );
}
