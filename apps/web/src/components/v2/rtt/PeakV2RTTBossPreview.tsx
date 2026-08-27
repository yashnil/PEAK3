"use client";

/**
 * PeakV2RTTBossPreview — the V2 presentation of the pre-battle briefing
 * (Pass 3). Comes AFTER the cinematic boss reveal (`PeakV2RTTBossIntro` →
 * `PeakV2RTTBossLineup`, both full-bleed CINEMATIC) and is itself a LIVE
 * decision screen: the player reads a briefing, then presses "Resolve the
 * matchup." Mounts as the `content` of `PeakV2RTTShell` with `layout="live"`
 * — no outer `PeakV2Shell`/width wrapper here, the shell already owns the
 * run-map/roster rails and the status strip.
 *
 * Ports legacy `BossPreview.tsx` EXACTLY: the same win-condition line, the
 * same `boss.rule` plain-effect/engine-summary/symmetric-note stack, the
 * same `bossBriefing()` ESTIMATE (ESTIMATE, not hedging — see that
 * function's own docstring for why the two profiles are not computed under
 * identical conditions), and the same four boss-roster states (revealed /
 * not-yet-built / not-scouted). Nothing here recomputes a briefing, a
 * margin, or a rule effect — all three come from the exact same
 * `bossBriefing`/`bossRulePlainEffect` legacy already calls.
 *
 * DIFFERENCES FROM LEGACY, both deliberate:
 *
 * 1. Four stacked bordered boxes (rule / briefing / your-lanes /
 *    boss-roster) flatten into one hairline-divided flow (`PeakV2Rule`)
 *    with mono section eyebrows — the brief's anti-card-nesting rule.
 *
 * 2. "Your five lanes" renders through `PeakV2DataLane` (paired, left=you
 *    right=boss) instead of legacy's `LaneProfile`, to match the lane-
 *    comparison language `PeakV2RTTBattleResult` already established for
 *    this game. When the boss is not yet revealed, `rightValue` is simply
 *    omitted — `PeakV2DataLane` already renders a single filled dot in that
 *    case, so no bespoke fallback UI is needed.
 *
 * CONTRAST NOTE (P3-G2, the V2 side): `--v2-color-comp-*` (`v2/tokens.css`)
 * are literal aliases of the frozen `--comp-*` hexes, so they inherit the
 * exact same failure legacy's `componentTextColor` docstring documents —
 * 1.6-2.6:1 as inline text, below the 3:1 floor even at large sizes. This
 * file therefore never puts a tone color on prose text (the briefing
 * sentences, the lane names inside them): prose stays in
 * `--v2-text-secondary`/`--v2-text-primary`, and a lane's tone is carried
 * only by a small `LaneToneDot` marker beside its name — the same role
 * `PeakV2RTTDraftRoom`'s `StrongestLaneDot` already plays. `PeakV2DataLane`
 * itself (an established, already-shipped primitive reused as-is for the
 * lane rows below) is a different case: its tone-colored label is a short,
 * bold, uppercase caption, not running prose, and is not something this
 * file is introducing or deciding.
 */

import PeakV2LiveHeader from "../PeakV2LiveHeader";
import PeakV2Rule from "../PeakV2Rule";
import PeakV2Score from "../PeakV2Score";
import PeakV2PlayerIdentity from "../PeakV2PlayerIdentity";
import PeakV2DataLane from "../PeakV2DataLane";
import PeakV2PrimaryAction from "../PeakV2PrimaryAction";
import { v2ToneVar, type V2ComponentTone } from "../v2-tone";
import { bossBriefing, type LaneProjection } from "@/lib/run-the-table-state";
import { bossRulePlainEffect } from "@/lib/run-the-table-copy";
import type { BossPublic, LaneProfileEntry } from "@/types/run-the-table";

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

const LANE_TOKEN_TO_TONE: Record<string, V2ComponentTone> = {
  si: "si",
  tp: "tp",
  rec: "rec",
  po: "po",
  team: "team",
};

const EYEBROW_STYLE: React.CSSProperties = {
  fontFamily: "var(--v2-font-mono)",
  fontSize: "0.6875rem",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--v2-text-muted)",
};

export default function PeakV2RTTBossPreview({
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
  const strongestPlayer = strongest(playerLanes);
  const strongestBoss = boss.lane_profile && boss.lane_profile.length > 0 ? strongest(boss.lane_profile) : null;

  return (
    <section data-testid="rtt-boss-preview" className="flex flex-col">
      <PeakV2LiveHeader
        title={boss.name}
        subtitle={boss.tagline}
        status={<span style={EYEBROW_STYLE}>Act {boss.act} · Boss</span>}
      />

      {/* The win condition, stated BEFORE anything is resolved. A comparison
          of five PEAK3 component totals, not a simulated game — say so, so
          nobody reads the reveal as possession-by-possession basketball.
          Both numbers come from the payload (`lanes_to_win`, the length of
          the profile the server sent) — neither is a literal. */}
      {lanesToWin != null && (
        <p
          data-testid="rtt-boss-win-condition"
          style={{ fontFamily: "var(--v2-font-ui)", fontWeight: 700, fontSize: "0.8125rem", color: "var(--v2-text-primary)" }}
        >
          First to <Num>{lanesToWin}</Num> of <Num>{playerLanes.length}</Num> lanes.{" "}
          <span style={{ fontWeight: 400, color: "var(--v2-text-muted)" }}>
            Each lane compares your roster&apos;s PEAK3 component total against theirs. No game is
            simulated.
          </span>
        </p>
      )}

      {boss.rule && (
        <>
          <PeakV2Rule spacing="md" />
          <div data-testid="rtt-boss-rule" className="flex flex-col gap-1">
            <span style={EYEBROW_STYLE}>Rule in force · {boss.rule.name}</span>
            {/* Plain language first, the engine's own threshold-bearing
                summary verbatim underneath — the displayed rule can never
                drift from the applied one because the applied one is still
                printed. */}
            {bossRulePlainEffect(boss.rule.id) && (
              <span
                data-testid="rtt-boss-rule-plain"
                style={{ fontFamily: "var(--v2-font-ui)", fontWeight: 700, fontSize: "0.8125rem", color: "var(--v2-text-primary)" }}
              >
                {bossRulePlainEffect(boss.rule.id)}
              </span>
            )}
            <span
              data-testid="rtt-boss-rule-summary"
              style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-secondary)" }}
            >
              {boss.rule.summary}
            </span>
            <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.6875rem", color: "var(--v2-text-muted)" }}>
              Boss rules are symmetric — they apply to both teams and never change a player&apos;s
              own component values.
            </span>
          </div>
        </>
      )}

      {/* THE BRIEFING. Presentation of two lane profiles the client already
          holds — see the file docstring for why it is an estimate and why
          that word stays on screen. */}
      {briefing && (
        <>
          <PeakV2Rule spacing="md" />
          <div data-testid="rtt-boss-briefing" className="flex flex-col gap-2">
            <span style={EYEBROW_STYLE}>The matchup, before it is scored</span>

            <p
              data-testid="rtt-boss-strengths"
              style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-secondary)" }}
            >
              <span style={{ color: "var(--v2-text-muted)" }}>Projected strengths: </span>
              you are strongest in <LaneToneDot token={strongestPlayer.token} />
              {strongestPlayer.label} <Num>{strongestPlayer.value.toFixed(1)}</Num>
              {strongestBoss && (
                <>
                  , they are strongest in <LaneToneDot token={strongestBoss.token} />
                  {strongestBoss.label} <Num>{strongestBoss.value.toFixed(1)}</Num>
                </>
              )}
              . Roster totals <Num>{playerTotal.toFixed(1)}</Num>
              {typeof boss.roster_total === "number" && (
                <>
                  {" "}
                  to <Num>{boss.roster_total.toFixed(1)}</Num>
                </>
              )}
              .
            </p>

            <BriefingRow
              label="Leaning your way"
              lanes={briefing.favouredYou}
              testid="rtt-boss-briefing-you"
              empty="No lane currently leans your way."
            />
            <BriefingRow
              label={`Leaning ${boss.name}`}
              lanes={briefing.favouredBoss}
              testid="rtt-boss-briefing-boss"
              empty="No lane currently leans theirs."
            />
            {briefing.level.length > 0 && (
              <BriefingRow
                label="Too close to call"
                lanes={briefing.level}
                testid="rtt-boss-briefing-level"
                empty=""
                showMargin={false}
              />
            )}

            {/* Stated, not implied. The two profiles are not computed under
                identical bench-weight conditions, and a boss rule's
                tie-break is not modelled here at all. */}
            <p style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.6875rem", color: "var(--v2-text-muted)" }}>
              An <strong>estimate</strong>, not a result: it compares the two lane profiles as they
              stand now, and a boss rule can change how the bench is weighted for both teams when
              the lanes are actually scored. Nothing is played out.
            </p>
          </div>
        </>
      )}

      <PeakV2Rule spacing="md" />

      <div>
        <span style={EYEBROW_STYLE}>Your five lanes{boss.revealed ? ` vs ${boss.name}` : ""}</span>
        <div className="mt-3 flex flex-col gap-4">
          {playerLanes.map((entry) => {
            const bossEntry =
              boss.revealed && boss.lane_profile ? boss.lane_profile.find((l) => l.lane === entry.lane) ?? null : null;
            return (
              <PeakV2DataLane
                key={entry.lane}
                label={entry.label}
                tone={LANE_TOKEN_TO_TONE[entry.token] ?? "accent"}
                leftLabel="You"
                leftValue={entry.value.toFixed(1)}
                rightLabel={boss.revealed ? boss.name : undefined}
                rightValue={bossEntry ? bossEntry.value.toFixed(1) : undefined}
                scaleMin={0}
                scaleMax={100}
              />
            );
          })}
        </div>
        <p className="mt-4" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.6875rem", color: "var(--v2-text-muted)" }}>
          Bench counts at <Num>{benchWeight.toFixed(2)}</Num>. You have <Num>{lives}</Num>{" "}
          {lives === 1 ? "life" : "lives"} left.
        </p>
      </div>

      <PeakV2Rule spacing="md" />

      <div>
        <span style={EYEBROW_STYLE}>{boss.name}&apos;s roster</span>
        {boss.revealed && boss.starters ? (
          <ul className="mt-2 flex flex-col">
            {boss.starters.map((card) => (
              <li
                key={card.card_id}
                className="flex items-center justify-between gap-3 py-2"
                style={{ borderBottom: "1px solid var(--v2-border-subtle)" }}
              >
                <PeakV2PlayerIdentity name={card.player_name} meta={card.window_label} size="sm" />
                <PeakV2Score value={card.prime_score.toFixed(1)} size="sm" />
              </li>
            ))}
            {(boss.bench ?? []).map((card) => (
              <li
                key={card.card_id}
                className="flex items-center justify-between gap-3 py-2 opacity-70"
                style={{ borderBottom: "1px solid var(--v2-border-subtle)" }}
              >
                <PeakV2PlayerIdentity name={card.player_name} meta={`${card.window_label} · bench`} size="sm" />
                <PeakV2Score value={card.prime_score.toFixed(1)} size="sm" />
              </li>
            ))}
          </ul>
        ) : boss.locked === false ? (
          /* v4: the lineup does not exist YET. A boss is built when its act
             begins, against the roster standing in front of it, so before
             that there is nothing to hide and nothing to scout. */
          <p
            data-testid="rtt-boss-unlocked-note"
            className="mt-2"
            style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-muted)" }}
          >
            Not picked yet. This opponent is matched to your roster when the act starts — you know
            the name and the rule now, and the five when you get there.
          </p>
        ) : (
          <p className="mt-2" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-muted)" }}>
            Not scouted. You know the act, the name and the rule — not the five. A Film Room scout
            would have shown you this.
          </p>
        )}
      </div>

      <div className="mt-6">
        <PeakV2PrimaryAction data-testid="rtt-resolve-boss" onClick={onResolve} busy={busy}>
          {busy ? "Resolving…" : "Resolve the matchup"}
        </PeakV2PrimaryAction>
      </div>
    </section>
  );
}

/** Tabular-figure inline number, the V2-native sibling of legacy's
 *  `.score-number` utility class (kept local — every other RTT V2 file
 *  reaches for its own inline instrumentation style rather than sharing
 *  one across files). */
function Num({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: "var(--v2-font-mono)",
        fontVariantNumeric: "tabular-nums",
        fontFeatureSettings: "var(--v2-mono-feature)",
        fontWeight: 700,
      }}
    >
      {children}
    </span>
  );
}

/** A small filled tone dot beside a lane name in prose — never the tone
 *  color itself as text (see the file docstring's contrast note). Same
 *  role `PeakV2RTTDraftRoom`'s `StrongestLaneDot` plays. */
function LaneToneDot({ token }: { token: string }) {
  const tone = LANE_TOKEN_TO_TONE[token];
  if (!tone) return null;
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: v2ToneVar(tone),
        marginRight: 5,
      }}
    />
  );
}

/** The highest-valued entry of a lane profile. Pure `max` over numbers the
 *  server sent; ties resolve to the engine's own lane order. */
function strongest(lanes: readonly LaneProfileEntry[]): LaneProfileEntry {
  return lanes.reduce((best, l) => (l.value > best.value ? l : best), lanes[0]);
}

/** One row of the briefing: a label, then the lanes and their gaps. Lane
 *  names render as plain secondary-color prose with a `LaneToneDot` marker
 *  carrying the tone instead — never the tone color as text (contrast note
 *  above). */
function BriefingRow({
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
    <p data-testid={testid} style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-secondary)" }}>
      <span style={{ color: "var(--v2-text-muted)" }}>{label}: </span>
      {lanes.length === 0 ? (
        <span style={{ color: "var(--v2-text-muted)" }}>{empty}</span>
      ) : (
        lanes.map((l, i) => (
          <span key={l.lane}>
            {i > 0 && ", "}
            <LaneToneDot token={l.token} />
            {l.label}
            {showMargin && (
              <>
                {" "}
                <Num>{Math.abs(l.margin) >= 10 ? Math.abs(l.margin).toFixed(0) : Math.abs(l.margin).toFixed(1)}</Num>
                <span style={{ color: "var(--v2-text-muted)" }}> apart</span>
              </>
            )}
          </span>
        ))
      )}
    </p>
  );
}
