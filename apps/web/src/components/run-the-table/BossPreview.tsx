"use client";
import PlayerAvatar from "@/components/court/PlayerAvatar";
import { BossPublic, LaneProfileEntry } from "@/types/run-the-table";
import { Coachmark } from "@/components/ui/GuidedTour";
import { bossBriefing, type LaneProjection } from "@/lib/run-the-table-state";
import { bossRulePlainEffect } from "@/lib/run-the-table-copy";
import { componentTextColor } from "@/lib/utils";
import LaneProfile from "./LaneProfile";

/**
 * The pre-battle screen: who you are about to play, the rule in force, and
 * your lane profile against theirs.
 *
 * THE BRIEFING (plan §6). Both lane profiles and a fully deterministic rule are
 * already on the client at `boss_ready` (`public_state` reveals the boss once
 * the player reaches it), so the player was being asked to eyeball five
 * comparisons with no summary of any kind. This screen now states, in order:
 * the win condition; the boss rule in plain language; the projected strengths;
 * and the ESTIMATED favoured lanes.
 *
 * "ESTIMATE" IS NOT HEDGING. `public_state()` builds YOUR lane profile with
 * `bench_weight_for(systems, None)` — no boss rule — while `boss_public()`
 * builds THEIRS with `bench_weight_for(systems, boss.rule_id)`. A rule that
 * fixes the bench weight therefore applies to their displayed numbers and not
 * to yours, and the real battle applies it to both. Tie-breaks the rule may own
 * are not modelled here at all. So the lean is labelled an estimate every time
 * it is shown.
 *
 * NOTHING HERE IMPLIES A SIMULATION. A battle is a deterministic comparison of
 * five component totals (`battle.py`: no possessions, no randomness, no model
 * inference), and the "No game is simulated" framing stays.
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
  /** `state.lanes_to_win` — the engine's `LANES_TO_WIN`, never a literal. */
  lanesToWin?: number;
}

export default function BossPreview({
  boss,
  playerLanes,
  playerTotal,
  benchWeight,
  lives,
  busy,
  onResolve,
  lanesToWin,
}: Props) {
  const briefing = boss.revealed ? bossBriefing(playerLanes, boss.lane_profile) : null;
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

      {/* The win condition, stated BEFORE anything is resolved. This is a
          comparison of five PEAK3 component totals, not a simulated game — say
          so, so nobody reads the reveal as possession-by-possession basketball. */}
      {lanesToWin != null && (
        <p
          className="text-xs font-semibold"
          style={{ color: "var(--text-primary)" }}
          data-testid="rtt-boss-win-condition"
        >
          {/* Both numbers come from the payload: `lanes_to_win` is the
              engine's `LANES_TO_WIN`, and the lane count is the length of the
              profile the server sent. Neither is a literal. */}
          First to <span className="score-number">{lanesToWin}</span> of{" "}
          <span className="score-number">{playerLanes.length}</span> lanes.{" "}
          <span className="font-normal" style={{ color: "var(--text-muted)" }}>
            Each lane compares your roster&apos;s PEAK3 component total against theirs. No game is
            simulated.
          </span>
        </p>
      )}

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
          {/* Plain language first, the engine's own threshold-bearing summary
              verbatim underneath — the same arrangement as a perk card, and
              for the same reason: the displayed rule can never drift from the
              applied one because the applied one is still printed. */}
          {bossRulePlainEffect(boss.rule.id) && (
            <span
              className="text-xs font-semibold"
              style={{ color: "var(--text-primary)" }}
              data-testid="rtt-boss-rule-plain"
            >
              {bossRulePlainEffect(boss.rule.id)}
            </span>
          )}
          <span
            className="text-xs"
            style={{ color: "var(--text-secondary)" }}
            data-testid="rtt-boss-rule-summary"
          >
            {boss.rule.summary}
          </span>
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            Boss rules are symmetric — they apply to both teams and never change a player&apos;s
            own component values.
          </span>
        </div>
      )}

      {/* THE BRIEFING. Presentation of two lane profiles the client already
          holds — see the component docstring for why it is an estimate and why
          that word is on the screen rather than in a comment. */}
      {briefing && (
        <div
          data-testid="rtt-boss-briefing"
          className="rounded-xl border p-3 flex flex-col gap-1.5"
          style={{ background: "var(--bg-elevated)", borderColor: "var(--border-default)" }}
        >
          <h3
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: "var(--text-muted)" }}
          >
            The matchup, before it is scored
          </h3>
          {/* Projected strengths — each side's best lane and its roster total,
              side by side. Both numbers are `roster_lane_profile` outputs the
              server already sent. */}
          {/* Lane names in this sentence use `componentTextColor`
              (lib/utils.ts, P3-G2) — never the frozen `--comp-*` hex
              directly, which measures 1.6-2.6:1 as inline TEXT on Arena
              Day, failing even the 3:1 large-text floor. `componentColor`
              stays reserved for fills/borders elsewhere (the lane bars,
              the fingerprint), never prose. */}
          <p className="text-[11px]" style={{ color: "var(--text-secondary)" }} data-testid="rtt-boss-strengths">
            <span style={{ color: "var(--text-muted)" }}>Projected strengths: </span>
            you are strongest in{" "}
            <span style={{ color: componentTextColor(strongest(playerLanes).lane) }}>
              {strongest(playerLanes).label}
            </span>{" "}
            <span className="score-number">{strongest(playerLanes).value.toFixed(1)}</span>
            {boss.lane_profile && boss.lane_profile.length > 0 && (
              <>
                , they are strongest in{" "}
                <span style={{ color: componentTextColor(strongest(boss.lane_profile).lane) }}>
                  {strongest(boss.lane_profile).label}
                </span>{" "}
                <span className="score-number">
                  {strongest(boss.lane_profile).value.toFixed(1)}
                </span>
              </>
            )}
            . Roster totals <span className="score-number">{playerTotal.toFixed(1)}</span>
            {typeof boss.roster_total === "number" && (
              <>
                {" "}
                to <span className="score-number">{boss.roster_total.toFixed(1)}</span>
              </>
            )}
            .
          </p>
          <BriefingLine
            label="Leaning your way"
            lanes={briefing.favouredYou}
            testid="rtt-boss-briefing-you"
            empty="No lane currently leans your way."
          />
          <BriefingLine
            label={`Leaning ${boss.name}`}
            lanes={briefing.favouredBoss}
            testid="rtt-boss-briefing-boss"
            empty="No lane currently leans theirs."
          />
          {briefing.level.length > 0 && (
            <BriefingLine
              label="Too close to call"
              lanes={briefing.level}
              testid="rtt-boss-briefing-level"
              empty=""
              showMargin={false}
            />
          )}
          {/* Stated, not implied. The two profiles are not computed under
              identical bench-weight conditions, and a boss rule's tie-break is
              not modelled here at all. */}
          <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            An <strong>estimate</strong>, not a result: it compares the two lane profiles as they
            stand now, and a boss rule can change how the bench is weighted for both teams when the
            lanes are actually scored. Nothing is played out.
          </p>
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
          style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
        >
          {busy ? "Resolving…" : "Resolve the matchup"}
        </button>
      </div>

      {/* LAST in DOM order — see the note in DraftRoom.tsx. */}
      <Coachmark id="boss_battle" />
    </section>
  );
}

/** The highest-valued entry of a lane profile. Pure `max` over numbers the
 *  server sent; ties resolve to the engine's own lane order. */
function strongest(lanes: readonly LaneProfileEntry[]): LaneProfileEntry {
  return lanes.reduce((best, l) => (l.value > best.value ? l : best), lanes[0]);
}

/** One row of the briefing: a label, then the lanes and their gaps. Lane
 *  names render via `componentTextColor` (lib/utils.ts, P3-G2) — the frozen
 *  `--comp-*` hex is reserved for fills/borders, never prose text (it
 *  measures 1.6-2.6:1 as text on Arena Day, failing even the 3:1 large-text
 *  floor); the text-safe sibling keeps each lane's identity colour. */
function BriefingLine({
  label,
  lanes,
  testid,
  empty,
  showMargin = true,
}: {
  label: string;
  lanes: LaneProjection[];
  testid: string;
  empty: string;
  showMargin?: boolean;
}) {
  return (
    <p className="text-[11px]" style={{ color: "var(--text-secondary)" }} data-testid={testid}>
      <span style={{ color: "var(--text-muted)" }}>{label}: </span>
      {lanes.length === 0 ? (
        <span style={{ color: "var(--text-muted)" }}>{empty}</span>
      ) : (
        lanes.map((l, i) => (
          <span key={l.lane}>
            {i > 0 && ", "}
            <span style={{ color: componentTextColor(l.lane) }}>{l.label}</span>
            {showMargin && (
              <>
                {" "}
                <span className="score-number">
                  {Math.abs(l.margin) >= 10
                    ? Math.abs(l.margin).toFixed(0)
                    : Math.abs(l.margin).toFixed(1)}
                </span>
                <span style={{ color: "var(--text-muted)" }}> apart</span>
              </>
            )}
          </span>
        ))
      )}
    </p>
  );
}
