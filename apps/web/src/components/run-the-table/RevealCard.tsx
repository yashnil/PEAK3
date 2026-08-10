"use client";
import { motion } from "motion/react";
import PlayerAvatar from "@/components/court/PlayerAvatar";
// Deep import, not the `@/components/ui` barrel: the barrel re-exports
// `ThemeToggle`, which reaches `lucide-react`, and paying for that whole
// dependency to render one number costs a route ~15 kB of First Load JS.
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { LANE_FIELDS, LaneField, RevealSlot, Role, RunCardPublic } from "@/types/run-the-table";
import { LANE_LABELS, ROLE_LABELS, laneColorVar } from "@/lib/run-the-table-state";
import {
  REVEAL_BEAT_DURATION_MS,
  REVEAL_BEATS,
  REVEAL_SIGNATURE_BAR_STAGGER_MS,
  RevealBeat,
} from "./reveal-timing";

const LANE_TOKENS = ["si", "tp", "rec", "po", "team"] as const;

function beatIndex(beat: RevealBeat): number {
  return REVEAL_BEATS.indexOf(beat);
}

/** True once `current` has reached or passed `target` in the 9-step order. */
function atLeast(current: RevealBeat | null, target: RevealBeat): boolean {
  if (!current) return false;
  return beatIndex(current) >= beatIndex(target);
}

export type RevealCardStatus =
  /** Nothing shown at all — the whole point of a reveal (spec §2: "Nothing
   *  before that press shows any slot content anywhere on screen"). */
  | "concealed"
  /** This card is the one currently animating; `beat` says how far. */
  | { beat: RevealBeat }
  /** Fully settled — final state, no animation, this is what the roster
   *  dock shows once `presentationCursor` has passed this slot. */
  | "settled";

interface Props {
  /** `Starter — Lead Creator` / `Bench 1`, always safe pre-reveal — the
   *  server's own `RevealSlotOrder.label`. */
  orderLabel: string;
  role?: Role | null;
  /** The server's authoritative card for this slot, once revealed. Null while
   *  `status` is `"concealed"`. */
  slot: RevealSlot | null;
  /** Lane percentiles for the "component signature" beat, looked up from
   *  `state.starters`/`state.bench` by `slot_id` once this slot is revealed
   *  — `RevealSlot` itself carries no lane data (see `RevealCard`'s module
   *  docstring in the accompanying code review notes). Null is a legitimate,
   *  silently-degraded state: the beat still holds its place in the rhythm,
   *  it just has no bars to sweep in. */
  lanePercentiles: Record<LaneField, number> | null;
  status: RevealCardStatus;
  reducedMotion: boolean;
  /** Boss reveal only — the PLAYER's already-known card in this same slot
   *  position (matched by `slot_id`; `boss_reveal_order()` and
   *  `opening_reveal()` both use the same role-keyed scheme, so a slot_id
   *  match is always the same seat, never a guess). Fully known already, so
   *  it renders statically — no beats, no concealment — beside the boss
   *  card as it resolves, satisfying PRODUCT_EXPERIENCE_CONTRACT.md §3's
   *  "paired sequential lineup reveal". Omit for the roster reveal. */
  pairedWith?: RunCardPublic | null;
}

/**
 * One slot of the shared 9-step reveal grammar (PRODUCT_EXPERIENCE_CONTRACT.md
 * §2), driven entirely by `status`/`beat` from `useRevealSequence` — this
 * component owns no timer and no state of its own. Used identically by the
 * opening roster reveal and the boss lineup reveal so the two are
 * "the same reveal system", not two components that merely look alike.
 *
 * DATA GAP, FLAGGED HONESTLY: beat 7 ("component signature") wants the lane
 * fingerprint sweep `RunCard.tsx` already draws. `RevealSlot` (the reveal
 * track's own payload, `reveal_public()`) carries only
 * `card_id/player_name/anchor_season/window/prime_score` — no lane data — so
 * this component looks up `lanePercentiles` from the ALREADY-REVEALED
 * `state.starters`/`state.bench` entry for the same `slot_id` instead of
 * inventing one. That lookup is legitimate (not a leak) only because the
 * caller passes it exclusively for slots the presentation cursor has already
 * authorized; see `RunTheTableGame`'s wiring.
 */
export default function RevealCard({
  orderLabel,
  role,
  slot,
  lanePercentiles,
  status,
  reducedMotion,
  pairedWith,
}: Props) {
  const concealed = status === "concealed";
  const settled = status === "settled";
  const beat: RevealBeat | null = typeof status === "object" ? status.beat : settled ? "settle" : null;

  const showRole = settled || atLeast(beat, "role");
  const showSilhouette = settled || atLeast(beat, "silhouette");
  const showIdentity = settled || atLeast(beat, "identity");
  const showWindow = settled || atLeast(beat, "window");
  const scoreTarget = settled || atLeast(beat, "score") ? (slot?.prime_score ?? 0) : 0;
  const showSignature = settled || atLeast(beat, "signature");

  const roleLabel = role && role in ROLE_LABELS ? ROLE_LABELS[role] : null;

  return (
    <li
      data-testid="rtt-reveal-card"
      data-reveal-status={concealed ? "concealed" : settled ? "settled" : (beat ?? "active")}
      /* THREE STATES, THREE SURFACES. A settled card is a finished object and
         gets `.pk-depth`'s lit top edge and volume gradient; the card
         currently resolving gets the ACCENT crown instead, which is the "this
         is the live one" treatment the accent border alone was doing on its
         own; a concealed card stays deliberately flat, because a slot with
         nothing in it should not read as an object.
         `.pk-spotlight` is deliberately NOT used on the active card:
         `.pk-depth` is declared after it in globals.css and would win the
         `box-shadow` on any row that had both, so the accent crown is the
         treatment that stays honest in every state. */
      className={`flex min-h-[64px] items-center gap-3 rounded-lg border px-3 py-2 ${
        concealed ? "" : settled ? "pk-depth pk-crown" : "pk-crown pk-crown-accent"
      }`}
      style={{
        // Only set where a class is not already supplying it: `.pk-depth`
        // paints the settled row, and an inline value would beat it.
        background: settled ? undefined : concealed ? "var(--bg-elevated)" : "var(--bg-surface)",
        borderColor:
          typeof status === "object" ? "var(--peak-accent)" : "var(--border-subtle)",
      }}
    >
      {/* Beat 2: role label — metadata only, carries no identity. Always the
          first thing to appear, and always present in the a11y tree even
          while concealed (it is not the secret). */}
      {/* WAS `--text-muted` when shown. "Starter — Lead Creator" is the seat
          this card fills; it is the whole content of beat 2 and the only thing
          on the row until identity resolves. Not metadata. */}
      <span
        className="w-24 shrink-0 text-[10px] font-bold uppercase tracking-widest @[420px]:w-28"
        style={{ color: showRole ? "var(--text-secondary)" : "transparent" }}
        aria-hidden={!showRole}
      >
        {orderLabel}
      </span>

      {/* The paired half — your already-known card in this same seat. Static:
          nothing about it is concealed or animated, it is simply what you
          already knew, placed beside the boss card so the comparison reads
          the instant the boss card lands rather than three screens later. */}
      {pairedWith && (
        <>
          <span
            // P6-c: `@[420px]:max-w-[40%]` alone left this block UNCONSTRAINED
            // below a 420px container — `shrink-0` means it never yields
            // width on its own, so at 390px it claimed however much its
            // content wanted, squeezing the boss-side identity/score column
            // (the row's only `flex-1` element) until its own score number
            // bled past the card and sometimes past the page's right edge.
            // `max-w-[32%]` gives it a real cap below 420px too — tighter
            // than the ≥420px steady state on purpose, since the fixed-width
            // role label, "vs" and avatar already consume a larger share of
            // a narrow row's total width. Confirmed by DOM measurement (not
            // a screenshot impression): no child's right edge exceeds
            // `window.innerWidth` at 390px across all 7 rows after this.
            className="flex min-w-0 shrink-0 max-w-[32%] items-center gap-1.5 @[420px]:max-w-[40%]"
            data-testid="rtt-reveal-paired-card"
          >
            <PlayerAvatar name={pairedWith.player_name} size={26} />
            <span className="flex min-w-0 flex-col">
              <span
                className="truncate text-xs font-bold"
                style={{ color: "var(--text-primary)" }}
              >
                {pairedWith.player_name}
              </span>
              <span
                className="score-number truncate text-[10px]"
                style={{ color: "var(--peak-accent-text)" }}
              >
                {pairedWith.prime_score.toFixed(1)}
              </span>
            </span>
          </span>
          <span
            aria-hidden="true"
            className="shrink-0 text-[9px] font-black uppercase tracking-wider"
            style={{ color: "var(--text-muted)" }}
          >
            vs
          </span>
        </>
      )}

      {concealed ? (
        <span
          className="text-sm font-semibold"
          style={{ color: "var(--text-muted)" }}
          aria-label="Not revealed yet"
        >
          —
        </span>
      ) : (
        <>
          {/* Beat 3: silhouette — a neutral placeholder shape, never a blank
              card, establishing WHERE before WHAT. Swaps for the real avatar
              the instant identity resolves. */}
          <motion.span
            initial={reducedMotion ? false : { opacity: 0, scale: 0.85 }}
            animate={{ opacity: showSilhouette ? 1 : 0, scale: showSilhouette ? 1 : 0.85 }}
            transition={{ duration: reducedMotion ? 0 : 0.15 }}
            className="shrink-0"
          >
            {showIdentity && slot ? (
              <PlayerAvatar name={slot.player_name} size={32} />
            ) : (
              <span
                aria-hidden="true"
                className="block h-8 w-8 rounded-full"
                style={{ background: "var(--pk-surface-inset)", border: "1px solid var(--border-subtle)" }}
              />
            )}
          </motion.span>

          <span className="flex min-w-0 flex-1 flex-col">
            {/* Beat 4: identity resolves — the single most information-dense
                beat, held longest of the per-card beats. */}
            <motion.span
              initial={reducedMotion ? false : { opacity: 0, transform: "translateY(4px)" }}
              animate={{
                opacity: showIdentity ? 1 : 0,
                transform: showIdentity ? "translateY(0px)" : "translateY(4px)",
              }}
              transition={{ duration: reducedMotion ? 0 : 0.2 }}
              className="truncate text-sm font-bold"
              style={{ color: "var(--text-primary)" }}
            >
              {showIdentity && slot ? slot.player_name : " "}
            </motion.span>

            <span className="flex items-baseline gap-1.5">
              {/* Beat 5: 3-year window. */}
              {/* WAS `--text-muted`. The window is half of what a PEAK3 card
                  IS — "Michael Jordan" without "1990-91 to 1992-93" is not the
                  same claim. It is beat 5 of the reveal for that reason. */}
              <span
                className="truncate text-[10px]"
                style={{ color: showWindow ? "var(--text-secondary)" : "transparent" }}
                aria-hidden={!showWindow}
              >
                {slot?.window ?? slot?.anchor_season ?? " "}
              </span>
              {/* Beat 6: score counts up. `AnimatedNumber` carries the
                  authoritative final value in its sr-only sibling from first
                  paint regardless of the tween — see its own docstring. */}
              {showWindow && slot && (
                <AnimatedNumber
                  value={scoreTarget}
                  precision={1}
                  durationMs={reducedMotion ? 0 : REVEAL_BEAT_DURATION_MS.score}
                  /* `.pk-counting` keys off this component's own
                     `data-settled`, so the digits carry accent ink for exactly
                     as long as beat 6 is running and settle back on landing —
                     no second timer to fall out of step with the sequence. */
                  className="pk-counting text-[10px] font-semibold"
                  data-testid={`rtt-reveal-score-${slot.slot_id}`}
                />
              )}
            </span>

            {/* Beat 7: component signature sweep. Degrades silently (no
                fabricated bars) when `lanePercentiles` is unavailable — see
                the module docstring's data-gap note. */}
            {showSignature && lanePercentiles && (
              <span
                className="mt-1 flex items-end gap-1"
                aria-hidden="true"
                data-testid={slot ? `rtt-reveal-signature-${slot.slot_id}` : undefined}
              >
                {LANE_FIELDS.map((lane, i) => {
                  const pct = lanePercentiles[lane] ?? 0;
                  return (
                    <motion.span
                      key={lane}
                      initial={reducedMotion ? false : { scaleY: 0 }}
                      animate={{ scaleY: 1 }}
                      transition={{
                        duration: reducedMotion ? 0 : 0.18,
                        delay: reducedMotion ? 0 : (i * REVEAL_SIGNATURE_BAR_STAGGER_MS) / 1000,
                      }}
                      style={{
                        transformOrigin: "bottom",
                        height: `${Math.max(2, Math.min(100, pct) * 0.1)}px`,
                        width: "6px",
                        background: laneColorVar(LANE_TOKENS[i]),
                        opacity: 0.85,
                        display: "inline-block",
                        borderRadius: "1px",
                      }}
                    />
                  );
                })}
                <span className="sr-only">
                  {`Lane percentiles — ${LANE_FIELDS.map(
                    (lane) => `${LANE_LABELS[lane]} ${(lanePercentiles[lane] ?? 0).toFixed(0)}`,
                  ).join(", ")}.`}
                </span>
              </span>
            )}
          </span>

          {roleLabel && (
            <span className="sr-only">{roleLabel}</span>
          )}
        </>
      )}
    </li>
  );
}
