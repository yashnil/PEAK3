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
   * True for `film_room` only, and it is a fact about the engine rather than a
   * style preference: `generation.py:199-202` sets the Film Room's summary to
   * "Scout the next boss's lane profile and rule, then take one prep
   * advantage", and there is no prep-advantage mechanic anywhere in the engine.
   * `state.action_film_room` does exactly two things — unlock stages, or add
   * credits. Printing the server line would promise a mechanic that does not
   * exist, so the node-type `consequence` below is shown instead.
   *
   * `_NODE_COPY` is a static per-type table, not per-seed text, so nothing
   * seed-specific is lost by suppressing it. Track D owns `generation.py`; when
   * that string is corrected this flag should be dropped.
   */
  suppressServerSummary?: true;
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
    consequence:
      "Three priced cards. Buy one into a slot its role allows, or pass and spend nothing.",
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
      "Three players are available. Your outgoing player refunds part of their ORIGINAL price — before any perk discount — against the incoming one. You can decline.",
  },
  film_room: {
    type: "film_room",
    label: "Film Room",
    icon: "film",
    accentVar: "var(--apex-coral)",
    purpose: "Learn what is coming or take a preparation benefit.",
    // What scouting ACTUALLY does, from `state.action_film_room`: it unlocks
    // the remaining stages of THIS act plus stage 1 of the next — not "the
    // rest of this act and the next". And `public.py:338-341` reveals the
    // boss's roster once `a{act}s{STAGES_PER_ACT}` is scouted, which is the
    // highest-value consequence and the one nothing in the UI used to mention.
    consequence:
      "Scouting shows the stages left in this act and the first stage of the next — and if it reaches this act's last stage, it uncovers the boss's roster before you have to face it. Banking takes credits instead. No roster change either way.",
    suppressServerSummary: true,
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
 * This is the whole of the Film Room work in this pass: plan §5.3 DEFERS a
 * third Film Room choice, because `nba_peak/run_the_table/generation.py`
 * derives the entire node blueprint from the seed, so a third branch would make
 * every existing daily seed and challenge token generate a different run. The
 * remedy is to make the two real choices unmistakable, not to invent a third.
 *
 * Choice ids are the engine's: `state.FILM_CHOICES` = ("scout_offers",
 * "take_credits"), `state.REST_CHOICES` = ("recover_life", "take_credits").
 * An unknown pairing returns null and the caller renders nothing extra.
 */
export const NODE_CHOICE_TRADEOFF: Record<string, string> = {
  "film_room:scout_offers":
    "You give up the credits. Nothing on your roster changes — you stop guessing what is ahead, and late in an act you see the boss you are about to play.",
  "film_room:take_credits":
    "You give up the preview. You go into the next stages blind, and into the boss blind, with more to spend when you get there.",
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
};

export function bossRulePlainEffect(ruleId: string): string | null {
  return BOSS_RULE_PLAIN_EFFECT[ruleId] ?? null;
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
