/**
 * The RUN THE TABLE guided tour: its steps, its target contract, and the
 * one-time contextual coachmarks.
 *
 * Owner: W3 (UX / Organization / Polish pass).
 *
 * ---------------------------------------------------------------------------
 * THE TARGET CONTRACT
 * ---------------------------------------------------------------------------
 * `GuidedTour` spotlights a region by querying `[data-tour-id="<id>"]`. The
 * ids live here as a closed union (`TourTargetId`) so a step can never point at
 * an id nobody renders, and so W4 — who owns every component the attributes go
 * on — has one list to satisfy. Adding a step means adding an id here first;
 * `tsc` then fails until the step's `targets` are real members of the union.
 *
 * A step may name SEVERAL targets. They are tried in order and the first one
 * that is actually laid out wins, which is how one step covers both layouts:
 * the desktop rails and the mobile tray render the same information in
 * different elements, and the hidden one has a zero-size rect.
 *
 * A step whose targets are all absent is NOT an error. `GuidedTour` shows the
 * step centred, with no spotlight — that is exactly what happens on the start
 * gate, where the run does not exist yet and none of these elements do either.
 *
 * ---------------------------------------------------------------------------
 * THE COPY RULE
 * ---------------------------------------------------------------------------
 * Every number and every rule below was read out of the engine before it was
 * written down, and the source is cited in a comment. Nothing here may state a
 * rule the engine does not implement:
 *
 *   nba_peak/run_the_table/config.py   — STARTING_CREDITS, STARTING_LIVES,
 *                                        MAX_LIVES, COMEBACK_CREDITS, ROLES,
 *                                        STARTER_SLOTS, BENCH_SLOTS,
 *                                        BENCH_WEIGHT_DEFAULT, LANES_TO_WIN,
 *                                        ACTS, STAGES_PER_ACT, MAX_SYSTEMS,
 *                                        REST_CREDITS, FILM_CREDITS,
 *                                        OFFERS_PER_DRAFT, TRADE_REFUND_PCT
 *   nba_peak/run_the_table/battle.py   — lane comparison and the tie-break ladder
 *   nba_peak/run_the_table/state.py    — when a life is lost, when the second
 *                                        System is offered, what a scout unlocks
 *   apps/api/.../run_the_table/public.py — the choice payloads
 */

/* ------------------------------------------------------------------ */
/* Target contract                                                     */
/* ------------------------------------------------------------------ */

/**
 * Every `data-tour-id` the tour may look for.
 *
 * W4 must place these attributes on the elements described in the table in the
 * W3 report. Duplicates are fine and expected (the tray renders twice, once per
 * layout) — the resolver picks the laid-out one.
 */
export const TOUR_TARGET_IDS = [
  /** The vertical act/stage ladder (desktop rail). */
  "rtt-run-map",
  /** The compact act/stage progress strip (mobile). Fallback for `rtt-run-map`. */
  "rtt-progress-strip",
  /** The wrapper around whatever decision surface is currently on screen. */
  "rtt-decision",
  /** The credits readout in the tray. */
  "rtt-credits",
  /** The lives readout in the tray. */
  "rtt-lives",
  /** The roster block in the tray (5 starters + 2 bench). */
  "rtt-roster",
  /** The sticky mobile tray. Fallback for the tray-hosted steps on phones. */
  "rtt-mobile-tray",
  /** The active Front Office Perks block in the tray. */
  "rtt-systems",
  /** The perk chooser surface. Fallback for `rtt-systems` before act 1 resolves. */
  "rtt-system-select",
  /** The five-lane roster profile in the tray. */
  "rtt-lane-profile",
] as const;

export type TourTargetId = (typeof TOUR_TARGET_IDS)[number];

export interface TourStep {
  /** Stable id — used as the React key and in analytics. Never re-used. */
  id: string;
  /** Short heading. Sentence case, no trailing period. */
  title: string;
  /** One or two sentences. The rule, stated exactly. */
  body: string;
  /** Optional second line for a consequence or an edge case. */
  detail?: string;
  /** Candidate spotlight targets, most specific first. */
  targets: readonly TourTargetId[];
}

/* ------------------------------------------------------------------ */
/* The tour                                                            */
/* ------------------------------------------------------------------ */

export const RUN_THE_TABLE_TOUR_ID = "run-the-table";

/**
 * Bump to replay the tour for everyone, including players who completed the
 * previous version. Bump it whenever a step's *rule* changes — not for a typo.
 * `lib/tour-state.ts` treats any other stored version as "not seen".
 */
export const RUN_THE_TABLE_TOUR_VERSION = 2;

export const RUN_THE_TABLE_TOUR: readonly TourStep[] = [
  {
    id: "run-map",
    title: "The run map",
    // NODE_CHOICES_PER_STAGE = 2 (config.py).
    body: "Choose one path at each stage. The other closes.",
    // NO ACT/STAGE/BATTLE COUNTS. This step used to read "Three acts. Two
    // stages in each act… six stages and three battles in all", which was
    // three engine constants retyped into prose — and Standard v2 changes all
    // three (ACTS 3 → 4, DECISION_NODES 6 → 8, BATTLES 3 → 4). The ladder the
    // step is spotlighting draws the real shape from `state.map`, so the copy
    // describes the pattern and lets the map supply the numbers.
    detail:
      "Every act is a run of stages and then that act's boss. The ladder beside this step shows exactly how many of each your run has.",
    targets: ["rtt-run-map", "rtt-progress-strip"],
  },
  {
    id: "current-decision",
    title: "The decision on the clock",
    body:
      "This panel is whatever the run is asking you right now — a fork between two nodes, an open node, or a boss.",
    detail: "Nothing here is undoable. Once you act, the run moves on.",
    targets: ["rtt-decision"],
  },
  {
    id: "credits",
    title: "Credits",
    // Draft buys and the net cost of a trade are the only spends
    // (state.action_draft_buy / action_trade). The STARTING_CREDITS figure is
    // deliberately NOT retyped here — it is a balance constant (40 under v1,
    // 50 under Standard v2), and the Credits tile this step spotlights shows
    // the live value from `public_state()`.
    body:
      "Your whole budget, shown in the tile beside this step. Credits buy cards in the Draft Room and pay the net cost of a trade — the incoming price minus what your outgoing player refunds.",
    // receipt.py: "Finished holding {credits} unspent credits." There is no
    // end-of-run credit bonus, so this deliberately does not promise one.
    detail:
      "Whatever you never spend is printed on your final receipt. It buys nothing after the last battle, so an unspent pile is a decision you did not make.",
    targets: ["rtt-credits", "rtt-mobile-tray"],
  },
  {
    id: "lives",
    title: "Lives",
    // STARTING_LIVES = MAX_LIVES = 3. battle.py: a life is deducted only when
    // outcome == "loss"; a draw costs nothing. COMEBACK_CREDITS = 8, awarded
    // only when lives_after > 0. state._advance_after_boss: lives <= 0 → failed.
    body:
      "Three, and never more than three. You lose one only by losing a boss battle — a draw costs nothing.",
    // COMEBACK_CREDITS is a balance constant Track D is retuning, so the amount
    // is not retyped; the battle screen prints the awarded figure itself.
    detail:
      "Lose your last life and the run ends there, immediately. A loss you survive pays comeback credits.",
    targets: ["rtt-lives", "rtt-mobile-tray"],
  },
  {
    id: "roster",
    title: "Your roster",
    // STARTER_SLOTS = 5, BENCH_SLOTS = 2, ROLES = the five below.
    // state.legal_slots_for: a card fits a starting slot only if the slot's role
    // is in the card's eligible roles, and the same player can never be held twice.
    body:
      "Five starters — Lead Creator, Guard / Wing, Wing / Forward, Forward / Big, Anchor — plus two bench. A card can only go where its role is legal, and you can never hold the same player twice.",
    // BENCH_WEIGHT_DEFAULT is a balance constant; boss rules and the Deep
    // Rotation perk are the only things that change it
    // (battle.bench_weight_for). The tray prints the live `bench_weight`.
    detail:
      "A bench player counts for a fraction of a starter in every lane — the exact fraction is in the lane-profile panel, and a perk or a boss rule can change it.",
    targets: ["rtt-roster", "rtt-mobile-tray"],
  },
  {
    id: "front-office-perks",
    title: "Front Office Perks",
    // MAX_SYSTEMS = 2; state._advance_after_boss offers the second after act 1.
    // SYSTEMS affect "price", "battle" or "economy" — never a card's value.
    body:
      "A permanent run modifier — internally the model calls it a System. You pick one before the first act and one more after the first boss.",
    detail:
      "A perk changes what cards cost you, what a trade refunds, or how much your bench counts. It never changes what a player is worth.",
    targets: ["rtt-systems", "rtt-system-select"],
  },
  {
    id: "lane-profile",
    title: "How your roster wins",
    // battle.resolve_battle: one lane per LANE_FIELD, LANES_TO_WIN = 3.
    body:
      "Every battle is scored in five lanes — the five official PEAK3 components: Statistical Impact, Traditional Production, Individual Recognition, Playoff Rate Impact and Team Result. Take three of the five and you win.",
    // The published tie-break ladder, in order (battle.resolve_battle).
    detail:
      "If ties stop either side reaching three, the summed lane margin decides it, and then the overall roster total.",
    targets: ["rtt-lane-profile", "rtt-mobile-tray"],
  },
];

/* ------------------------------------------------------------------ */
/* Coachmarks                                                          */
/* ------------------------------------------------------------------ */

/**
 * One-time contextual hints, shown the first time a player reaches a surface.
 *
 * A deliberately lighter mechanism than the tour: no portal, no spotlight, no
 * focus trap, no step sequence. A coachmark is an inline callout with a single
 * "Got it" that marks itself seen. The tour is never replayed per node.
 */
export const COACHMARK_IDS = [
  "draft_room",
  "trade_desk",
  "film_room",
  "rest_bank",
  "boss_battle",
] as const;

export type CoachmarkId = (typeof COACHMARK_IDS)[number];

export interface Coachmark {
  id: CoachmarkId;
  title: string;
  body: string;
}

export const COACHMARKS: Record<CoachmarkId, Coachmark> = {
  // OFFERS_PER_DRAFT = 3; public.py sets can_pass = True unconditionally.
  draft_room: {
    id: "draft_room",
    title: "First Draft Room",
    body:
      "Three priced cards. Buy one into a slot its role allows, or pass and keep the credits — passing is always legal.",
  },
  // pricing.refund_for reads `base_cost`, so the refund is a share of the
  // ORIGINAL price — the exact ambiguity config.py:150-156 records as having
  // shipped wrong once, in this very coachmark. The PERCENTAGE is not retyped:
  // it is a balance constant, and the desk prints the credit figure itself.
  // public.py sets can_decline = True; isTradeLegal reads the server's legal_slots.
  trade_desk: {
    id: "trade_desk",
    title: "First Trade Desk",
    body:
      "Send one player out and bring one of three incoming players in. The outgoing player refunds part of their ORIGINAL price — before any perk discount, and more with the Trade Machine perk — and the pairing has to be legal for that slot. You can always decline.",
  },
  // FILM_CHOICES = ("scout_offers", "take_credits").
  // state.action_film_room:499-508 unlocks the remaining stages of THIS act
  // plus stage 1 of the next — nothing further. public.py:338-341 then reveals
  // the boss's roster once `a{act}s{STAGES_PER_ACT}` is scouted, which is the
  // highest-value consequence and the one no surface used to mention.
  // FILM_CREDITS is not retyped: the choice button carries the live figure.
  film_room: {
    id: "film_room",
    title: "First Film Room",
    body:
      "Two choices, and no wrong one: scout, which reveals the stages left in this act and the first stage of the next — and, if it reaches this act's last stage, uncovers the boss's roster before you play them — or bank the credits instead.",
  },
  // REST_CHOICES = ("recover_life", "take_credits"); REST_LIFE_RECOVERY = 1,
  // capped at MAX_LIVES = 3. REST_CREDITS is not retyped: the choice button
  // carries the live figure.
  rest_bank: {
    id: "rest_bank",
    title: "First Rest / Bank",
    body:
      "Recover one life, up to the maximum of three, or bank the credits instead. At full lives there is nothing to recover, so that choice is closed.",
  },
  // battle.resolve_battle; BOSS_RULES are symmetric by contract.
  boss_battle: {
    id: "boss_battle",
    title: "First boss",
    body:
      "Your five starters and two bench are compared to the boss's, lane by lane, with no randomness. Take three of the five lanes and you win. A boss rule, if there is one, applies to both teams equally.",
  },
};

/** All coachmark ids, typed. Handy for a reset control or a test sweep. */
export function coachmarkIds(): readonly CoachmarkId[] {
  return COACHMARK_IDS;
}
