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
 * Verified against `NODE_TYPE_LABELS` / `NODE_TYPE_BLURBS` in
 * `lib/run-the-table-state.ts` and against the engine:
 * `config.OFFERS_PER_DRAFT` = 3, `config.OFFERS_PER_TRADE` = 3,
 * `config.TRADE_REFUND_PCT` = 0.50, `state.FILM_CHOICES`, `state.REST_CHOICES`,
 * and `public._node_public`, which sets `can_pass` / `can_decline` to True.
 */
export const NODE_TYPE_COPY: Record<NodeType, NodeTypeCopy> = {
  draft_room: {
    type: "draft_room",
    label: "Draft Room",
    icon: "draft",
    accentVar: "var(--peak-accent)",
    purpose: "Buy one exact 3-year peak, or keep the credits.",
    consequence:
      "Three priced cards. Buy one into a slot its role allows, or pass and spend nothing.",
  },
  trade_desk: {
    type: "trade_desk",
    label: "Trade Desk",
    icon: "trade",
    accentVar: "var(--foundation-blue)",
    purpose: "Send one player out, bring one legal replacement in.",
    consequence:
      "Three players are available. Your outgoing player refunds part of their price against the incoming one. You can decline.",
  },
  film_room: {
    type: "film_room",
    label: "Film Room",
    icon: "film",
    accentVar: "var(--apex-coral)",
    purpose: "Trade the credits for information, or the information for credits.",
    consequence:
      "Scout to reveal the offers waiting in the stages ahead, or bank credits instead. No roster change either way.",
  },
  rest_bank: {
    type: "rest_bank",
    label: "Rest / Bank",
    icon: "rest",
    accentVar: "var(--correct)",
    purpose: "Recover, or take the money.",
    consequence:
      "Get a lost life back, or bank credits instead. No roster change either way.",
  },
};

export function nodeTypeCopy(type: NodeType): NodeTypeCopy {
  return NODE_TYPE_COPY[type];
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
    "You give up the credits. Nothing on your roster changes — you just stop guessing what is ahead.",
  "film_room:take_credits":
    "You give up the preview. You go into the next stages blind, with more to spend when you get there.",
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
 * One plain-language sentence per shipped System id.
 *
 * DELIBERATELY NON-NUMERIC. Every threshold, percentile and discount stays in
 * `config.SYSTEMS[i]["summary"]`, which the API sends verbatim and which
 * `SystemSelect` shows verbatim next to this line. That is the only arrangement
 * in which the friendly sentence cannot drift from the applied rule — the
 * failure `config.py`'s `SYSTEM_PUBLISHED_THRESHOLDS` table exists to prevent.
 *
 * An unknown id returns null and the caller falls back to the engine summary
 * alone, so shipping a new System never renders a blank card.
 */
export const PERK_PLAIN_EFFECT: Record<string, string> = {
  moneyball: "Unheralded cards cost you less.",
  deep_rotation: "Your bench pulls more weight in battles.",
  no_hardware: "Big producers who never won the awards cost you less.",
  two_way_value: "Well-rounded cards with no glaring hole cost you less.",
  trade_machine: "Players you trade away pay back more.",
  veteran_minimum: "One cheap Draft Room card per act is free.",
};

export function perkPlainEffect(systemId: string): string | null {
  return PERK_PLAIN_EFFECT[systemId] ?? null;
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
  /** One sentence: what the mode is. */
  promise:
    "Build and evolve a roster of exact NBA 3-year peaks across a branching run, manage scarce credits, and beat three escalating statistical lineups.",
  /** The branch rule. */
  branch: "You take one. The other closes for this run.",
  /** How a battle is decided. LANES_TO_WIN = 3 of 5. */
  lanesToWin: "Win three of the five lanes and you win the battle.",
  /** When a life is lost. battle.resolve_battle: only on an outright loss. */
  lifeLoss: "You lose a life only by losing a boss battle. A draw costs nothing.",
  /** What a perk can and cannot touch. */
  perkBoundary:
    "A perk changes what cards cost you, what a trade refunds, or how much your bench counts — never what a player is worth.",
} as const;
