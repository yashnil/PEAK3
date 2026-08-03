/**
 * RUN THE TABLE plain-language layer.
 *
 * Owner: W3 (UX / Organization / Polish pass). Consumed by W3's start/choice
 * surfaces and by W4's cards, tray and map. Keep the surface small and stable.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS, AND WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 * It is a DISPLAY layer. Plan §3.4 and §5.2: canonical model field names
 * (`postseason_individual_value`, `team_achievement`, `system`, …) are never
 * renamed in APIs, payloads, receipts or methodology. Nothing here changes a
 * value, a key, or a rule — it only decides what a human reads next to one.
 *
 * Two consequences that are not negotiable:
 *
 * 1. **Every tooltip states the exact official name.** A player who reads
 *    "Front Office Perk" here and then sees "System" in a receipt, an API
 *    response or the methodology page must be able to connect the two without
 *    guessing. Same for the five components.
 * 2. **The five component labels are frozen.** `Playoff Rate Impact` and
 *    `Team Result` are pinned by `src/tests/unit/component-labels.test.ts:28-41`
 *    and by `nba_peak/run_the_table/config.py:LANE_LABELS`. The other three were
 *    never renamed. This module re-states them; it must never diverge from
 *    `componentLabel()` in `lib/utils.ts`, which is the app-wide source.
 *
 * Numbers: any threshold or price that the engine computes is NOT restated
 * here. Plain-language effect text is deliberately non-numeric, so it cannot
 * drift from `config.py`; the exact, engine-authored rule is always shown
 * alongside it (see `SystemSelect`).
 */

import type { LaneField, LaneToken, NodeType } from "@/types/run-the-table";

/* ------------------------------------------------------------------ */
/* Terms                                                               */
/* ------------------------------------------------------------------ */

export interface TermCopy {
  /** What the player reads. */
  display: string;
  /** Plural form, when the term is countable. */
  plural?: string;
  /** The canonical internal / API name. Always surfaced in the tooltip. */
  internal: string;
  /** One line, and it must contain `internal` verbatim. */
  tooltip: string;
  /** The question the info affordance is answering, for its accessible name. */
  tooltipLabel: string;
}

/** `system` → "Front Office Perk". The API field stays `systems`. */
export const PERK_TERM: TermCopy = {
  display: "Front Office Perk",
  plural: "Front Office Perks",
  internal: "System",
  tooltip:
    "A permanent run modifier, chosen once and kept for the rest of the run. Internally, and in the API and receipts, this is called a System.",
  tooltipLabel: "What is a Front Office Perk?",
};

/** lane profile → "How your roster wins". The API field stays `lane_profile`. */
export const LANE_PROFILE_TERM: TermCopy = {
  display: "How your roster wins",
  internal: "Lane profile",
  tooltip:
    "Your roster scored in each of the five official PEAK3 components. Internally, and in the API and receipts, this is called the lane profile.",
  tooltipLabel: "What is this profile?",
};

/* ------------------------------------------------------------------ */
/* The five components                                                 */
/* ------------------------------------------------------------------ */

export interface ComponentCopy {
  /** The canonical payload key. Never renamed. */
  field: LaneField;
  /** The official display label. FROZEN — see the header. */
  label: string;
  /** `--comp-{token}` design token key. */
  token: LaneToken;
  /** One line explaining what the component measures. */
  explainer: string;
  /** Accessible name for the info affordance next to the label. */
  tooltipLabel: string;
}

/**
 * The five lanes, in the engine's own order (`config.LANE_FIELDS`).
 *
 * The explainers describe what each component *measures*, not how good it is —
 * "PEAK3 rates…", never "the best players have…".
 */
export const COMPONENT_COPY: Record<LaneField, ComponentCopy> = {
  statistical_impact: {
    field: "statistical_impact",
    label: "Statistical Impact",
    token: "si",
    explainer:
      "Advanced impact metrics — how much the player moved their team's results per possession. The largest single component of a PEAK3 score.",
    tooltipLabel: "What is Statistical Impact?",
  },
  traditional_production: {
    field: "traditional_production",
    label: "Traditional Production",
    token: "tp",
    explainer:
      "Box-score production — the counting stats a contemporary fan would have quoted: points, rebounds, assists and the rest.",
    tooltipLabel: "What is Traditional Production?",
  },
  individual_recognition: {
    field: "individual_recognition",
    label: "Individual Recognition",
    token: "rec",
    explainer:
      "What voters gave the player at the time: MVP shares, All-NBA and All-Defensive selections, All-Star nods.",
    tooltipLabel: "What is Individual Recognition?",
  },
  postseason_individual_value: {
    field: "postseason_individual_value",
    label: "Playoff Rate Impact",
    token: "po",
    explainer:
      "Per-possession playoff performance — how the player played in the postseason, not how far their team went. The payload key is postseason_individual_value.",
    tooltipLabel: "What is Playoff Rate Impact?",
  },
  team_achievement: {
    field: "team_achievement",
    label: "Team Result",
    token: "team",
    explainer:
      "Team outcomes during the window, deliberately capped at a small share of the total — the model rates the player, not the trophy case. The payload key is team_achievement.",
    tooltipLabel: "What is Team Result?",
  },
};

/** The five lanes in engine order. Mirrors `config.LANE_FIELDS`. */
export const COMPONENT_ORDER: readonly LaneField[] = [
  "statistical_impact",
  "traditional_production",
  "individual_recognition",
  "postseason_individual_value",
  "team_achievement",
];

export function componentCopy(field: LaneField): ComponentCopy {
  return COMPONENT_COPY[field];
}

/** The five official labels, in engine order. For a legend or a tour step. */
export function componentLabels(): readonly string[] {
  return COMPONENT_ORDER.map((f) => COMPONENT_COPY[f].label);
}

/* ------------------------------------------------------------------ */
/* Node types                                                          */
/* ------------------------------------------------------------------ */

/**
 * Icon identity, as a key plus a 24×24 stroke path.
 *
 * A path string rather than a component so this stays a `.ts` module with no
 * JSX and no icon-library import, and so W3 and W4 draw the identical glyph
 * without importing each other's components. Render as:
 *
 * ```tsx
 * <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
 *      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
 *   <path d={NODE_ICON_PATHS[copy.icon]} />
 * </svg>
 * ```
 */
export type NodeIconKey = "draft" | "trade" | "film" | "rest";

export const NODE_ICON_PATHS: Record<NodeIconKey, string> = {
  /** A plus over a base line — acquire. */
  draft: "M12 4v9M7.5 8.5h9M4 20h16",
  /** Two opposed arrows — swap. */
  trade: "M4 8h13l-3.5-3.5M20 16H7l3.5 3.5",
  /** A film strip. */
  film: "M4 5h16v14H4zM8 5v14M16 5v14M4 12h16",
  /** A crescent — rest. */
  rest: "M20 14.2A8.4 8.4 0 0 1 9.6 3.8a8.4 8.4 0 1 0 10.4 10.4z",
};

export interface NodeTypeCopy {
  type: NodeType;
  /** Display label. Matches `NODE_TYPE_LABELS` in `lib/run-the-table-state.ts`. */
  label: string;
  icon: NodeIconKey;
  /**
   * Is the SERVER's per-node `summary` unsafe to print for this node type?
   *
   * FALSE FOR EVERY NODE TYPE UNDER rtt_ruleset_v3, and the flag is kept only
   * as the mechanism that made that provable.
   *
   * It existed for `film_room` alone: the v2 generator's summary promised
   * "then take one prep advantage" and the v2 engine had no such mechanic, so
   * printing the server line advertised something that did not exist. v3's
   * Scout & Prepare *does* have the preparation, and `generation._NODE_COPY`
   * now describes exactly the three branches `action_film_room` implements, so
   * the suppression would hide the correct sentence.
   */
  suppressServerSummary?: boolean;
  /**
   * CSS custom property for this node's accent, as a `var(...)` string.
   *
   * Every one is an EXISTING frozen token (plan §3.1 — no writer but W7 adds
   * tokens). The `--comp-*` and `--role-*` families are deliberately avoided:
   * they already mean "component lane" and "roster role" everywhere else, and
   * reusing them for node types would break that correspondence.
   */
  accentVar: string;
  /** What the node is for, in one clause. */
  purpose: string;
  /** What actually happens when you take it. Concrete, never a tease. */
  consequence: string;
}

/**
 * The four node types.
 *
 * `purpose` is the plain first-scan line and is FIXED BY THE SPEC — one
 * sentence, no engine numbers, no jargon, stating both branches. `consequence`
 * is the second layer: what literally happens, which is where the mechanic is
 * spelled out.
 *
 * Verified against `NODE_TYPE_LABELS` in `lib/run-the-table-state.ts` and
 * against the engine: `config.OFFERS_PER_DRAFT` = 3, `config.OFFERS_PER_TRADE`
 * = 3, `config.TRADE_REFUND_PCT` = 0.50 of the card's BASE cost
 * (`pricing.refund_for`), `state.FILM_CHOICES`, `state.REST_CHOICES`,
 * `state.action_film_room`, and `public._node_public`, which sets `can_pass` /
 * `can_decline` to True.
 */
export const NODE_TYPE_COPY: Record<NodeType, NodeTypeCopy> = {
  draft_room: {
    type: "draft_room",
    label: "Draft Room",
    icon: "draft",
    accentVar: "var(--peak-accent)",
    purpose: "Buy one player or keep your credits.",
    // NO OFFER COUNT. This used to read "Three priced cards", which is a run
    // shape number this file's own header forbids restating — and v3 can put a
    // fourth card on the board when a reservation is live, so the literal was
    // already capable of being wrong. `nodeConsequence()` below splices in the
    // count for the callers that actually have the board in front of them.
    consequence:
      "Buy one card into a slot its role allows, or pass and spend nothing.",
  },
  trade_desk: {
    type: "trade_desk",
    label: "Trade Desk",
    icon: "trade",
    accentVar: "var(--foundation-blue)",
    purpose: "Replace one roster player. You receive a refund toward the incoming card.",
    // The refund is a share of the outgoing card's ORIGINAL price, not of what
    // you paid after a discount (`pricing.refund_for` reads `base_cost`).
    // config.py:150-156 records that this exact ambiguity already shipped
    // wrong once, in the guided tour, so it is stated explicitly here.
    consequence:
      "Your outgoing player refunds part of their ORIGINAL price — before any perk discount — against the incoming one. You can decline.",
  },
  film_room: {
    type: "film_room",
    // "Scout & Prepare" under rtt_ruleset_v3. The node_type id stays
    // `film_room` — it is the engine's stable identifier and renaming it would
    // break every switch on it — but nothing player-facing says "Film Room"
    // any more, because the node no longer does what that name described.
    label: "Scout & Prepare",
    icon: "film",
    accentVar: "var(--apex-coral)",
    purpose: "Scout the boss, shape the next market, or reserve a future card.",
    // Exactly the three branches `state.action_film_room` implements. There is
    // no "take the credits" option at all in v3 — it was deleted, not zeroed —
    // so this line must not imply one.
    consequence:
      "Scouting is free: you see the boss's rule, its strongest and weakest lanes and a projected matchup, then prepare ONE lane for that battle only. The other two branches cost credits — shape the next market toward a role, or reserve a revealed future card at today's price. Your roster does not change here.",
    suppressServerSummary: false,
  },
  rest_bank: {
    type: "rest_bank",
    label: "Rest / Bank",
    icon: "rest",
    accentVar: "var(--correct)",
    purpose: "Recover one life or take credits. Your roster does not change.",
    consequence:
      "Get a lost life back, or bank credits instead. At full lives there is nothing to recover.",
  },
};

export function nodeTypeCopy(type: NodeType): NodeTypeCopy {
  return NODE_TYPE_COPY[type];
}

/**
 * The node-type consequence, with the board's own counts spliced in.
 *
 * The static `consequence` strings above carry no counts on purpose: how many
 * cards a market shows is the engine's number and it is not even constant —
 * a live reservation adds a fourth card to a Draft Room. Callers that can SEE
 * the board pass what they can see; callers that cannot (the start gate, which
 * runs before any run exists) pass nothing and get the count-free wording
 * rather than a guess.
 */
export function nodeConsequence(type: NodeType, offerCount?: number | null): string {
  const base = NODE_TYPE_COPY[type].consequence;
  if (typeof offerCount !== "number" || !Number.isFinite(offerCount) || offerCount < 1) {
    return base;
  }
  if (type === "draft_room") {
    return `${offerCount} priced ${offerCount === 1 ? "card" : "cards"} on the board. ${base}`;
  }
  if (type === "trade_desk") {
    return `${offerCount} ${offerCount === 1 ? "player is" : "players are"} available. ${base}`;
  }
  return base;
}

/** See `NodeTypeCopy.suppressServerSummary`. */
export function shouldSuppressServerSummary(type: NodeType): boolean {
  return NODE_TYPE_COPY[type].suppressServerSummary === true;
}

/**
 * What each written choice COSTS you, keyed `${node_type}:${choice_id}`.
 *
 * Film Room and Rest / Bank both present two labelled choices whose payload
 * says what you gain and never what you give up — and since taking one closes
 * the other, the thing given up is the actual decision. These lines say it.
 *
 * Choice ids are the engine's: `config.SCOUT_CHOICES` = ("scout_boss",
 * "shape_market", "reserve_card") and `state.REST_CHOICES` = ("recover_life",
 * "take_credits"). An unknown pairing returns null and the caller renders
 * nothing extra — which is what keeps a stale entry from ever being printed
 * against a choice the engine no longer has.
 *
 * v2's `film_room:scout_offers` and `film_room:take_credits` are GONE, not
 * repointed: `take_credits` does not exist at a Scout & Prepare any more, and
 * leaving a line for it would keep advertising an ATM the engine deleted.
 */
export const NODE_CHOICE_TRADEOFF: Record<string, string> = {
  "film_room:scout_boss":
    "You give up the other two branches. Free, and it never leaves you unable to act — but it buys information and one prepared lane, not a player.",
  "film_room:shape_market":
    "You spend credits on the shape of the next market rather than on a card in this one, and the guarantee covers one role only.",
  "film_room:reserve_card":
    "You spend credits to lock ONE named card at today's price. It appears in the next Draft Room and expires after it, so you still have to be able to afford it there.",
  "rest_bank:recover_life":
    "You give up the credits. Only worth taking if you have actually lost a life.",
  "rest_bank:take_credits":
    "You give up the recovery. Your lives stay exactly where they are.",
};

export function nodeChoiceTradeoff(nodeType: NodeType, choiceId: string): string | null {
  return NODE_CHOICE_TRADEOFF[`${nodeType}:${choiceId}`] ?? null;
}

/* ------------------------------------------------------------------ */
/* Perks (Systems)                                                     */
/* ------------------------------------------------------------------ */

/** What a perk's `affects` field means, in one word the player understands. */
export const PERK_AFFECTS_COPY: Record<string, string> = {
  price: "Cheaper cards",
  battle: "Stronger in battles",
  economy: "Better cash flow",
};

export function perkAffectsCopy(affects: string): string {
  return PERK_AFFECTS_COPY[affects] ?? affects;
}

/**
 * LAYER 1 — one plain-language sentence per shipped System id.
 *
 * Progressive disclosure, three layers per perk card (plan §6):
 *   1. `PERK_PLAIN_EFFECT` — what it does, in the player's words.
 *   2. `PERK_STRATEGY_HINT` — ONE line on when it is worth taking.
 *   3. `See exact rule` — the engine's own `summary`, verbatim, one tap away.
 * Transparency is MOVED, never removed.
 *
 * Two of these lines fix real mis-descriptions the audit found:
 *
 *   * "Unheralded cards cost you less" implied Individual Recognition.
 *     `pricing.qualifies_moneyball` reads the card's OVERALL prime-score
 *     percentile and nothing else.
 *   * "Big producers who never won the awards" implied Traditional Production.
 *     `pricing.qualifies_no_hardware` reads STATISTICAL IMPACT (above the 60th
 *     percentile) against Individual Recognition (below the 40th).
 *
 * "in most battles" in the Deep Rotation line is load-bearing rather than
 * hedging: `battle.bench_weight_for` lets a boss rule fix the bench weight for
 * BOTH sides, which makes the perk redundant against `strength_in_numbers` and
 * cancels it outright against `top_heavy`.
 *
 * "of the original price" in the Trade Machine line is load-bearing for the
 * same reason: `pricing.refund_for` refunds a share of `base_cost`, not of the
 * discounted price. `config.py:150-156` records that this exact ambiguity
 * already shipped wrong once.
 *
 * Numbers appear here only where the spec fixes them word-for-word; everything
 * threshold-shaped stays in `config.SYSTEMS[i]["summary"]`, which is what
 * layer 3 prints verbatim — the only arrangement in which the friendly
 * sentence cannot drift from the applied rule (the failure `config.py`'s
 * `SYSTEM_PUBLISHED_THRESHOLDS` table exists to prevent).
 *
 * An unknown id returns null and the caller falls back to the engine summary
 * alone, so shipping a new System never renders a blank card.
 */
export const PERK_PLAIN_EFFECT: Record<string, string> = {
  moneyball: "Lower-rated cards are much cheaper.",
  deep_rotation: "Your bench matters almost twice as much in most battles.",
  no_hardware: "Players with big Statistical Impact but few awards cost you less.",
  two_way_value: "Balanced players cost 30% less.",
  trade_machine: "Trading away a player refunds more of the original price.",
  veteran_minimum: "One cheap Draft Room card per act is free.",
};

export function perkPlainEffect(systemId: string): string | null {
  return PERK_PLAIN_EFFECT[systemId] ?? null;
}

/**
 * LAYER 2 — ONE strategic hint per perk. When is it worth taking?
 *
 * Deliberately one sentence each: this layer exists to make the choice
 * decidable on the first scan, and a second sentence would put it back into
 * the "read four paragraphs before act 1" state the pass is fixing. Nothing
 * here states a threshold — the exact rule is always one tap away in layer 3.
 */
export const PERK_STRATEGY_HINT: Record<string, string> = {
  moneyball: "Best if you plan to fill several empty slots rather than chase one star.",
  deep_rotation: "Only pays if you actually spend on the bench — and a boss that fixes the bench weight cancels it.",
  no_hardware: "Hunt for cards with a tall Statistical Impact bar and a short Individual Recognition bar.",
  two_way_value: "Look for cards whose five bars are close to level; the very best cards are excluded.",
  trade_machine: "Worth more the more Trade Desks your path still has ahead of it.",
  veteran_minimum: "Use it every act — a free card you never claimed is credits you never get back.",
};

export function perkStrategyHint(systemId: string): string | null {
  return PERK_STRATEGY_HINT[systemId] ?? null;
}

/** LAYER 3's affordance label. One string, so every surface names it the same. */
export const PERK_EXACT_RULE_LABEL = "See exact rule";

/* ------------------------------------------------------------------ */
/* Boss rules                                                          */
/* ------------------------------------------------------------------ */

/**
 * The boss rule in plain language, shown ABOVE the engine's own summary.
 *
 * Same arrangement as the perks and for the same reason: `BOSS_RULES[...]
 * ["summary"]` in `config.py` carries the exact margins and bench weights,
 * guarded by that file's `BOSS_RULE_PUBLISHED_THRESHOLDS` table, and it is
 * still printed verbatim. This layer only says what the rule MEANS before the
 * player is asked to parse "0.75 points" under a battle they are about to
 * commit to.
 *
 * `the_wall` and `the_standard` are the same mechanic at different margins, so
 * they share a sentence; the margin itself is in the published summary
 * directly below it. An unknown id returns null and the caller shows the
 * engine summary alone, so a rule this build has never heard of still renders.
 */
export const BOSS_RULE_PLAIN_EFFECT: Record<string, string> = {
  the_wall: "A lane has to be won clearly. Anything closer is drawn and neither side takes it.",
  the_standard:
    "A lane has to be won clearly. Anything closer is drawn and neither side takes it.",
  strength_in_numbers: "Both benches count for much more than usual.",
  top_heavy: "Both benches barely count — the starters decide it.",
  // v3's Final Boss rule. Symmetric like every other one: `battle.resolve_battle`
  // reads a single threshold and compares BOTH sides' lane counts against it,
  // so all the rule can do is push more battles down into the published
  // summed-margin tie-break.
  the_long_series:
    "Three lanes is no longer enough for either side. Anything short of the raised bar is settled by the total margin across all five lanes.",
};

export function bossRulePlainEffect(ruleId: string): string | null {
  return BOSS_RULE_PLAIN_EFFECT[ruleId] ?? null;
}

/* ------------------------------------------------------------------ */
/* Credit sinks (v3, spec §4)                                          */
/* ------------------------------------------------------------------ */

/**
 * One plain-language line per published sink — what it BUYS you, in the
 * player's words.
 *
 * NOT A PRICE. Every price, limit and exact rule arrives on the payload from
 * `config.CREDIT_SINKS` and is printed verbatim beside these lines, exactly the
 * arrangement the perks use. Nothing here can drift from `config.py`, because
 * nothing here restates a number.
 *
 * An unknown id returns null and the caller shows the engine's own summary
 * alone, so a sink this build has never heard of still renders.
 */
export const CREDIT_SINK_PLAIN_EFFECT: Record<string, string> = {
  market_refresh:
    "Replace this board with a different one. The replacement is fixed by the seed, so it is a decision, not a re-roll.",
  reserve_card:
    "Lock one revealed future card at today's price. It turns up in the next Draft Room.",
  role_focus:
    "Point the next market at one role. At least one offer there will be able to play it.",
  emergency_recovery:
    "Buy a life back, on top of whatever you take from this node.",
};

export function creditSinkPlainEffect(sinkId: string): string | null {
  return CREDIT_SINK_PLAIN_EFFECT[sinkId] ?? null;
}

/**
 * Why a priced control is locked, in a sentence, keyed by the ENGINE's own
 * stable reason code.
 *
 * A disabled button with no reason is the thing this exists to prevent: the
 * player cannot tell "I cannot afford it" from "I already used it" from "there
 * is nothing to fix", and all three have different answers.
 */
export const SINK_UNAVAILABLE_REASON: Record<string, string> = {
  insufficient_credits: "Not enough credits.",
  refresh_limit: "This market has already been refreshed.",
  recovery_limit: "Already used this run.",
  lives_full: "Nothing to recover — you are already at full lives.",
  role_focus_active: "A Role Focus is already waiting on a market.",
  reservation_active: "You already have a card reserved.",
};

export function sinkUnavailableReason(code: string | null | undefined): string | null {
  if (!code) return null;
  return SINK_UNAVAILABLE_REASON[code] ?? "Not available right now.";
}

/* ------------------------------------------------------------------ */
/* Shared one-liners                                                   */
/* ------------------------------------------------------------------ */

/**
 * Copy used in more than one place, kept here so the two places cannot drift.
 * Verified against `config.py` and `battle.py`; see `tour-steps.ts` for the
 * per-constant citations.
 */
export const RTT_COPY = {
  /**
   * One sentence: what the mode is.
   *
   * Deliberately says "every boss" rather than a count. It used to say "three
   * escalating statistical lineups", which is a run-shape number this file's
   * own header forbids restating — and which Standard v2 changes.
   */
  promise:
    "Build and evolve a roster of exact NBA 3-year peaks across a branching run, manage scarce credits, and beat every boss lineup in your path.",
  /** The branch rule. */
  branch: "You take one. The other closes for this run.",
  /** When a life is lost. battle.resolve_battle: only on an outright loss. */
  lifeLoss: "You lose a life only by losing a boss battle. A draw costs nothing.",
  /** What a perk can and cannot touch. */
  perkBoundary:
    "A perk changes what cards cost you, what a trade refunds, or how much your bench counts — never what a player is worth.",
  /**
   * What a reveal is, and what it is NOT.
   *
   * Said explicitly on both reveal surfaces because a card-by-card reel reads
   * like something being decided as you watch. It is not: the opening roster
   * and every boss lineup are fixed by the seed and the ruleset before the run
   * starts, the server preselects each card, and the client only animates to
   * it. Same seed, same roster, every time — which is the whole basis of a
   * daily board and a challenge link.
   */
  revealSource:
    "Seed and rule generated. This roster was fixed before the run started — the same seed always deals the same cards in the same order.",
  bossRevealSource:
    "Seed and rule generated. This lineup is part of the ruleset, not a team being built live — the same rules always field the same opponent.",
} as const;

/**
 * SCORE_RECONCILIATION.md §2 (binding, lead arbitration): the per-lane number
 * in a battle is a bench-weighted MEAN across the whole roster, not any one
 * player's value and not a sum — `roster_total` already names the sum, so
 * reusing "total" here would collide with a live, distinct engine field.
 *
 * These three strings are the ONLY place this wording lives; `BattleReveal`
 * and `BossPreview`'s lane rows both render from here so the label and the
 * disclosure text can never drift between the two surfaces that show a lane
 * rating.
 */
export const LANE_RATING_LABELS = {
  player: "YOUR LINEUP RATING",
  boss: "BOSS LINEUP RATING",
  /** Verbatim string from SCORE_RECONCILIATION.md §2 — do not paraphrase. */
  definition:
    "The bench-weighted average strength of the lineup in that PEAK3 component, normalized to a 0–100 scale.",
  /** The second, separately-attributed number on a lane row: one player's OWN
   *  value in that lane, from `card.lane_index` — never the lineup rating. */
  topContributor: "Top contributor",
} as const;

/**
 * How a battle is decided.
 *
 * A FUNCTION, not a constant, because `LANES_TO_WIN` belongs to the engine and
 * this file's header forbids restating an engine number. It used to read "Win
 * three of the five lanes" — a literal that would silently become a lie the
 * moment Track D retunes the ruleset.
 *
 * Callers that have `state.lanes_to_win` pass it. Callers that genuinely do not
 * have it (the start gate runs before any run exists, and `readiness` does not
 * carry it) pass nothing and get the count-free wording rather than a guess.
 */
export function lanesToWinSentence(lanesToWin?: number | null): string {
  if (typeof lanesToWin === "number" && Number.isFinite(lanesToWin) && lanesToWin > 0) {
    return `Win ${lanesToWin} of the five lanes and you win the battle.`;
  }
  return "Win a majority of the five lanes and you win the battle.";
}
