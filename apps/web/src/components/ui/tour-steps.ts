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
 *                                        REST_CREDITS, CREDIT_SINKS,
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

  /* ---- Daily Grid (W3, hardening pass) ---------------------------------- *
   * Added to the SAME union rather than a parallel one so `TourStep.targets`
   * keeps its single closed type and the RUN THE TABLE tour compiles
   * unchanged. The `dg-` prefix is what keeps the two vocabularies apart; a
   * step from one tour naming an id from the other is a review question, not a
   * type error, because both surfaces are legitimately allowed to be on screen
   * at once only in tests.                                                   */

  /** The 3x3 board and its row/column headers. */
  "dg-board",
  /** The right-hand column: the selected-square panel, or the idle hint. */
  "dg-workbench",
  /** The elapsed-time tile in the stat row. */
  "dg-timer",
  /** The whole stat-tile row (score, locked, misses, time, difficulty). */
  "dg-score",
  /** The one-player-per-board / picks-are-final paragraph. */
  "dg-rule",
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
export const RUN_THE_TABLE_TOUR_VERSION = 3;

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
/* The Daily Grid tour                                                 */
/* ------------------------------------------------------------------ */

export const DAILY_GRID_TOUR_ID = "daily-grid";

/**
 * Bump to replay the walkthrough — and, because the same record backs the
 * start gate, to show the gate again — for everyone, including players who
 * completed the previous version. Bump it whenever a step's *rule* changes,
 * not for a typo.
 *
 * 1 is the first versioned value. The flag it replaces
 * (`peak3.daily-grid.rules-seen`) was an unversioned `"1"` that could never be
 * replayed at all; see `DAILY_GRID_RULES_SEEN_KEY` in `types/daily-grid.ts`
 * for the one-way migration.
 */
export const DAILY_GRID_TOUR_VERSION = 1;

/**
 * The seven briefed steps, in order.
 *
 * SAME COPY RULE AS ABOVE: every rule stated here is one the Daily Grid
 * actually enforces, and the source is cited.
 *
 *   nba_peak/daily_grid/generator.py  — the board, its axes, its rarity buckets
 *   apps/api/.../daily_grid.py        — /answer validation, /result gating
 *   apps/web/src/lib/daily-grid-state.ts — withFilledCell (a lock is final)
 *   apps/web/src/types/daily-grid.ts  — CellScore, GridResultResponse
 *
 * No number that belongs to the board is retyped: the grid is 3x3 by
 * `GRID_SIZE`, and the step spotlighting it says "nine" only because the same
 * constant makes `TOTAL_CELLS` nine and the unique-identity rule is stated in
 * those terms on the page itself.
 */
export const DAILY_GRID_TOUR: readonly TourStep[] = [
  {
    id: "objective",
    title: "The objective",
    // The mode is an OPTIMISATION puzzle, not a fill-in puzzle: every square
    // pays, so a full board is the floor rather than the goal.
    body:
      "Fill all nine squares and maximize your total PEAK3 score. Any valid answer beats an empty square — but the best valid answer is what you are actually playing for.",
    detail:
      "Your running total is in the Score tile beside this step. It only moves when a square locks.",
    targets: ["dg-score", "dg-board"],
  },
  {
    id: "rows-and-columns",
    title: "Rows and columns",
    // generator.py builds each cell from one row axis and one column axis, and
    // /answer rejects with `constraint_failed` unless BOTH hold.
    body:
      "Every square sits where a row condition meets a column condition. An answer has to satisfy both of them, not just the one that looks easier.",
    detail:
      "The conditions are basketball facts — teams, awards, eras, playoff runs. PEAK3 only decides what a pick was worth, never whether it qualifies.",
    targets: ["dg-board"],
  },
  {
    id: "exact-seasons",
    title: "Exact seasons",
    // The answer id is a player-season id; a bare player is not a valid answer.
    body:
      "Answers are exact player-seasons — “1999-00 Shaquille O’Neal”, not just “Shaquille O’Neal”. The same player’s other seasons may not qualify at all.",
    detail:
      "Search from the panel below the board. It confirms whether a season fits the square, and it never shows you what that season is worth.",
    targets: ["dg-workbench", "dg-board"],
  },
  {
    id: "one-player-per-board",
    title: "One player per board",
    // rules.unique_player_identity; /answer rejects `player_already_used`.
    body:
      "Nine squares, nine different players. Once a player is on the board, every one of their seasons is out for the rest of it.",
    detail:
      "That is the real tension: spending your best season on an easy square is what costs you the hard one later.",
    targets: ["dg-rule"],
  },
  {
    id: "picks-lock",
    title: "Picks lock",
    // withFilledCell returns the progress UNCHANGED for an occupied square,
    // and there is deliberately no reset control anywhere in the mode.
    body:
      "A valid pick is final. There is no swapping, no undo and no reset — clicking a locked square only reviews it.",
    detail:
      "A wrong answer is rejected and counted as a miss, and costs you nothing else. Only a valid pick commits.",
    targets: ["dg-rule", "dg-board"],
  },
  {
    id: "scoring",
    title: "Scoring",
    // CellScore: arena_points = quality_points (the season's own prime_score)
    // scaled by rarity_multiplier. The multiplier itself is not retyped — the
    // locked square prints its own figures.
    body:
      "A square pays the season’s own PEAK3 score, scaled up for how small that square’s pool of qualifying seasons is. Higher-rated seasons score more; rarer squares pay more for the same season.",
    // /result is gated on all nine squares being locked and re-validated
    // server-side, and `exact_optimal` decides which of the two names it earns.
    detail:
      "Nothing is revealed until a square locks. The best grid available today is released only once all nine are done, and it is named as a proven maximum only when it is one.",
    targets: ["dg-score"],
  },
  {
    id: "timer",
    title: "The timer",
    // The clock is started by the explicit start action (POST
    // /daily-grid/{daily_key}/start), never by loading the page or opening
    // this walkthrough.
    body:
      "The clock starts only when you press Start. Reading this walkthrough, loading the page and reopening these steps later all cost you nothing.",
    detail:
      "Time is shown for you and for your own history. It is not scored, not ranked and not compared against anyone else.",
    targets: ["dg-timer", "dg-score"],
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
  // SCOUT_CHOICES = ("scout_boss", "shape_market", "reserve_card") in
  // nba_peak/run_the_table/config.py. v3 replaced the old Film Room outright:
  // there is no `take_credits` branch any more (FILM_CREDITS was DELETED, not
  // zeroed), so the previous "bank the credits instead" line described a
  // button that no longer exists. Prices are not retyped here — each branch
  // carries its live cost from `config.CREDIT_SINKS` via the payload.
  film_room: {
    id: "film_room",
    title: "First Scout & Prepare",
    body:
      "Three choices, and none of them pay you: scout the boss for free to see its rule, its strongest and weakest lanes, and whether a preparation would actually flip a lane — then arm one; shape the next market to guarantee an offer in a role you need; or reserve a future card at today's price.",
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
