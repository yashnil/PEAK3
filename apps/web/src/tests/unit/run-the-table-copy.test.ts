/**
 * RUN THE TABLE plain-language layer.
 *
 * `lib/run-the-table-copy.ts` had NO test at all, which is how two real
 * mis-descriptions shipped: "Unheralded cards cost you less" pointed at
 * Individual Recognition when `pricing.qualifies_moneyball` reads the OVERALL
 * percentile, and "Big producers who never won the awards" pointed at
 * Traditional Production when `pricing.qualifies_no_hardware` reads STATISTICAL
 * IMPACT. Both are asserted below, by the words that would have caught them.
 *
 * Nothing here talks to a server or renders a component: this file is a table
 * of strings, and these are the invariants that table has to hold.
 */
import { describe, expect, it } from "vitest";

import {
  BOSS_RULE_PLAIN_EFFECT,
  COMPONENT_COPY,
  COMPONENT_ORDER,
  NODE_CHOICE_TRADEOFF,
  NODE_TYPE_COPY,
  PERK_EXACT_RULE_LABEL,
  PERK_PLAIN_EFFECT,
  PERK_STRATEGY_HINT,
  PERK_TERM,
  RTT_COPY,
  CREDIT_SINK_PLAIN_EFFECT,
  bossRulePlainEffect,
  componentLabels,
  creditSinkPlainEffect,
  lanesToWinSentence,
  nodeChoiceTradeoff,
  nodeConsequence,
  nodeTypeCopy,
  sinkUnavailableReason,
  perkPlainEffect,
  perkStrategyHint,
  shouldSuppressServerSummary,
} from "@/lib/run-the-table-copy";
import { NODE_TYPE_LABELS, SYSTEM_LABELS } from "@/lib/run-the-table-state";
import type { NodeType } from "@/types/run-the-table";

/** `config.SYSTEMS` ids, mirrored. `SYSTEM_LABELS` is the app's own mirror of
 *  the same tuple, so the two lists cannot drift apart unnoticed. */
const SHIPPED_PERK_IDS = Object.keys(SYSTEM_LABELS);

const NODE_TYPES: NodeType[] = ["draft_room", "trade_desk", "film_room", "rest_bank"];

describe("perk copy — layer 1, the plain effect", () => {
  it("covers EVERY shipped perk id", () => {
    for (const id of SHIPPED_PERK_IDS) {
      expect(perkPlainEffect(id), `no plain effect for ${id}`).toBeTruthy();
    }
    expect(Object.keys(PERK_PLAIN_EFFECT).sort()).toEqual([...SHIPPED_PERK_IDS].sort());
  });

  it("uses the spec's exact strings for the four it fixes", () => {
    expect(PERK_PLAIN_EFFECT.two_way_value).toBe("Balanced players cost 30% less.");
    expect(PERK_PLAIN_EFFECT.deep_rotation).toBe(
      "Your bench matters almost twice as much in most battles.",
    );
    expect(PERK_PLAIN_EFFECT.trade_machine).toBe(
      "Trading away a player refunds more of the original price.",
    );
    expect(PERK_PLAIN_EFFECT.moneyball).toBe("Lower-rated cards are much cheaper.");
  });

  /**
   * `pricing.qualifies_moneyball` reads the card's OVERALL prime-score
   * percentile and nothing else. The old line ("Unheralded cards cost you
   * less") named the wrong lane by implication.
   */
  it("does not imply Moneyball reads recognition", () => {
    expect(PERK_PLAIN_EFFECT.moneyball.toLowerCase()).not.toMatch(
      /unheralded|award|recognition|voter/,
    );
  });

  /**
   * `pricing.qualifies_no_hardware` reads STATISTICAL IMPACT above the 60th
   * percentile against Individual Recognition below the 40th — not Traditional
   * Production, which "big producers" implied.
   */
  it("names Statistical Impact, not production, for No Hardware", () => {
    expect(PERK_PLAIN_EFFECT.no_hardware).toContain("Statistical Impact");
    expect(PERK_PLAIN_EFFECT.no_hardware.toLowerCase()).not.toContain("producer");
  });

  /**
   * `battle.bench_weight_for` lets a boss rule fix the bench weight for BOTH
   * teams, which makes Deep Rotation redundant against Strength in Numbers and
   * cancels it against Top Heavy. "in most battles" is the clause that says so.
   */
  it("keeps Deep Rotation's boss caveat", () => {
    expect(PERK_PLAIN_EFFECT.deep_rotation).toContain("in most battles");
  });

  /** `pricing.refund_for` refunds a share of `base_cost`, not of the
   *  discounted price — the ambiguity config.py:150-156 records. */
  it("keeps Trade Machine's 'original price'", () => {
    expect(PERK_PLAIN_EFFECT.trade_machine).toContain("original price");
  });

  it("ends every line as a sentence, and never leaks a raw id", () => {
    for (const [id, line] of Object.entries(PERK_PLAIN_EFFECT)) {
      expect(line.endsWith("."), `${id} is not a sentence`).toBe(true);
      expect(line).not.toContain("_");
    }
  });

  it("returns null for an id this build has never heard of", () => {
    expect(perkPlainEffect("brand_new_perk")).toBeNull();
  });
});

describe("perk copy — layer 2, the strategic hint", () => {
  it("covers every shipped perk id, with exactly ONE sentence each", () => {
    for (const id of SHIPPED_PERK_IDS) {
      const hint = perkStrategyHint(id);
      expect(hint, `no hint for ${id}`).toBeTruthy();
      // One sentence: a second would put the card back into the wall of prose
      // this pass exists to remove.
      expect((hint as string).split(". ").length, `${id} has more than one sentence`).toBe(1);
    }
    expect(Object.keys(PERK_STRATEGY_HINT).sort()).toEqual([...SHIPPED_PERK_IDS].sort());
  });

  it("says something different from the plain effect", () => {
    for (const id of SHIPPED_PERK_IDS) {
      expect(perkStrategyHint(id)).not.toBe(perkPlainEffect(id));
    }
  });

  it("returns null for an unknown id", () => {
    expect(perkStrategyHint("brand_new_perk")).toBeNull();
  });
});

describe("perk copy — layer 3, the exact rule", () => {
  it("names the affordance identically everywhere", () => {
    expect(PERK_EXACT_RULE_LABEL).toBe("See exact rule");
  });
});

describe("node copy", () => {
  it("uses the spec's exact first-scan line for each node type", () => {
    expect(NODE_TYPE_COPY.rest_bank.purpose).toBe(
      "Recover one life or take credits. Your roster does not change.",
    );
    expect(NODE_TYPE_COPY.draft_room.purpose).toBe("Buy one player or keep your credits.");
    expect(NODE_TYPE_COPY.trade_desk.purpose).toBe(
      "Replace one roster player. You receive a refund toward the incoming card.",
    );
    // rtt_ruleset_v3: the node is Scout & Prepare and its three branches ARE
    // the first-scan line. "Learn what is coming or take a preparation benefit"
    // described a two-choice node that no longer exists.
    expect(NODE_TYPE_COPY.film_room.purpose).toBe(
      "Scout the boss, shape the next market, or reserve a future card.",
    );
  });

  /** The node's player-facing identity changed with the ruleset; its engine
   *  node_type id deliberately did not. Both facts are pinned, because getting
   *  either backwards breaks something: renaming the id breaks every switch,
   *  and leaving the label breaks the promise the node now makes. */
  it("calls the film_room node Scout & Prepare, and keeps the engine id", () => {
    expect(NODE_TYPE_COPY.film_room.label).toBe("Scout & Prepare");
    expect(NODE_TYPE_COPY.film_room.type).toBe("film_room");
    expect(NODE_TYPE_LABELS.film_room).toBe(NODE_TYPE_COPY.film_room.label);
  });

  it("gives every node type a label, an icon, an accent and a consequence", () => {
    for (const type of NODE_TYPES) {
      const copy = nodeTypeCopy(type);
      expect(copy.label).toBeTruthy();
      expect(copy.purpose.endsWith(".")).toBe(true);
      expect(copy.consequence).toBeTruthy();
      // Existing frozen tokens only — this layer adds none.
      expect(copy.accentVar).toMatch(/^var\(--/);
    }
  });

  /**
   * WHAT SCOUT & PREPARE ACTUALLY DOES (`state.action_film_room`): three
   * branches — scout the boss and prepare one lane (free), shape the next
   * market toward a role, or reserve a revealed future card at today's price.
   * There is NO "take the credits" branch: `FILM_CREDITS` was deleted in v3,
   * not set to zero, so any copy implying one is advertising an ATM that does
   * not exist.
   */
  it("states all three v3 branches and promises no credits", () => {
    const c = NODE_TYPE_COPY.film_room.consequence;
    expect(c).toMatch(/scout/i);
    expect(c).toMatch(/market/i);
    expect(c).toMatch(/reserve/i);
    expect(c).toMatch(/one lane/i);
    // The two mechanics the engine has never had.
    expect(c.toLowerCase()).not.toContain("prep advantage");
    expect(c.toLowerCase()).not.toContain("bank");
  });

  /**
   * The suppression flag existed for ONE string: the v2 generator's Film Room
   * summary promised "then take one prep advantage" and the v2 engine had no
   * such mechanic. v3's `_NODE_COPY["film_room"]` describes exactly the three
   * branches `action_film_room` implements, so suppressing it would now hide
   * the correct sentence. Nothing is suppressed, and that is asserted for every
   * node type rather than assumed.
   */
  it("suppresses no server summary under v3", () => {
    for (const type of NODE_TYPES) {
      expect(shouldSuppressServerSummary(type), type).toBe(false);
    }
  });

  /**
   * The count-free consequence lines, and where a count is allowed back in.
   *
   * "Three priced cards" was hardcoded and was already capable of being wrong:
   * a live reservation adds a FOURTH card to a Draft Room. `nodeConsequence`
   * takes the count from a caller that can see the board, and returns the
   * count-free line to a caller that cannot.
   */
  it("keeps run-shape counts out of the static consequence lines", () => {
    for (const type of NODE_TYPES) {
      expect(nodeTypeCopy(type).consequence.toLowerCase()).not.toMatch(
        /\b(three|four|five|two)\s+(priced|players|cards)\b/,
      );
    }
    expect(nodeConsequence("draft_room")).toBe(NODE_TYPE_COPY.draft_room.consequence);
    expect(nodeConsequence("draft_room", 4)).toContain("4 priced cards");
    expect(nodeConsequence("draft_room", 1)).toContain("1 priced card");
    expect(nodeConsequence("trade_desk", 3)).toContain("3 players are available");
    // A node with no market gets no invented count.
    expect(nodeConsequence("rest_bank", 3)).toBe(NODE_TYPE_COPY.rest_bank.consequence);
  });

  it("says what each written choice COSTS, for both two-choice nodes", () => {
    for (const key of Object.keys(NODE_CHOICE_TRADEOFF)) {
      const [type, choice] = key.split(":");
      expect(nodeChoiceTradeoff(type as NodeType, choice)).toBe(NODE_CHOICE_TRADEOFF[key]);
    }
    expect(nodeChoiceTradeoff("film_room", "not_a_choice")).toBeNull();
  });
});

describe("boss rule copy", () => {
  it("has a plain line for every rule the engine ships", () => {
    // Every id in `config.BOSS_RULES`, `the_long_series` (v3's Final Boss rule)
    // included — a rule with no plain line renders the raw published summary
    // under a heading that promised an explanation.
    for (const id of [
      "the_wall", "strength_in_numbers", "top_heavy", "the_standard", "the_long_series",
    ]) {
      expect(bossRulePlainEffect(id), `no plain line for ${id}`).toBeTruthy();
    }
  });

  it("stays non-numeric, so it cannot drift from the published summary", () => {
    for (const line of Object.values(BOSS_RULE_PLAIN_EFFECT)) {
      expect(line).not.toMatch(/\d/);
    }
  });

  it("degrades to null for a rule this build has never heard of", () => {
    expect(bossRulePlainEffect("brand_new_rule")).toBeNull();
  });
});

describe("shared one-liners", () => {
  /**
   * `RTT_COPY.lanesToWin` was the string "Win three of the five lanes…", in a
   * file whose own header forbids restating an engine number — and Track D may
   * retune `LANES_TO_WIN`. It is a function now.
   */
  it("threads the lane threshold instead of hardcoding it", () => {
    expect(lanesToWinSentence(3)).toBe("Win 3 of the five lanes and you win the battle.");
    expect(lanesToWinSentence(4)).toBe("Win 4 of the five lanes and you win the battle.");
    expect(RTT_COPY).not.toHaveProperty("lanesToWin");
  });

  it("falls back to count-free wording where the caller genuinely has no value", () => {
    // The start gate runs before any run exists, so there is no
    // `state.lanes_to_win` to thread — and a guess would be the drift this
    // function was introduced to stop.
    expect(lanesToWinSentence()).not.toMatch(/\d/);
    expect(lanesToWinSentence(null)).not.toMatch(/\d/);
    expect(lanesToWinSentence(0)).not.toMatch(/\d/);
  });

  /** ACTS moves 3 → 4 under Standard v2, so the promise may not name a count. */
  it("does not retype the run shape into the promise", () => {
    expect(RTT_COPY.promise).toMatch(/Build and evolve a roster of exact NBA 3-year peaks/);
    expect(RTT_COPY.promise.toLowerCase()).not.toMatch(/\bthree\b|\bfour\b/);
  });
});

describe("terminology", () => {
  it("keeps the internal name visible next to the display term", () => {
    expect(PERK_TERM.display).toBe("Front Office Perk");
    expect(PERK_TERM.internal).toBe("System");
    // The rule from this module's header: every tooltip states the exact
    // official name, so a receipt saying "System" is connectable.
    expect(PERK_TERM.tooltip).toContain(PERK_TERM.internal);
  });

  /** Pinned app-wide by `component-labels.test.ts`; restated here because this
   *  module mirrors them and must never diverge. */
  it("keeps the five frozen component labels", () => {
    expect(componentLabels()).toEqual([
      "Statistical Impact",
      "Traditional Production",
      "Individual Recognition",
      "Playoff Rate Impact",
      "Team Result",
    ]);
    expect(COMPONENT_COPY.postseason_individual_value.label).toBe("Playoff Rate Impact");
    expect(COMPONENT_COPY.team_achievement.label).toBe("Team Result");
    expect(COMPONENT_ORDER).toHaveLength(5);
  });

  it("names the canonical payload key for the two renamed components", () => {
    expect(COMPONENT_COPY.postseason_individual_value.explainer).toContain(
      "postseason_individual_value",
    );
    expect(COMPONENT_COPY.team_achievement.explainer).toContain("team_achievement");
  });
});

/* ---------------------------------------------------------------------------
 * Credit sinks (v3, spec §4)
 * ------------------------------------------------------------------------- */

describe("credit sink copy", () => {
  /** `config.CREDIT_SINKS` ids, mirrored. */
  const SINK_IDS = ["market_refresh", "reserve_card", "role_focus", "emergency_recovery"];

  it("has a plain line for every sink the engine publishes", () => {
    for (const id of SINK_IDS) {
      expect(creditSinkPlainEffect(id), `no plain line for ${id}`).toBeTruthy();
    }
    expect(Object.keys(CREDIT_SINK_PLAIN_EFFECT).sort()).toEqual([...SINK_IDS].sort());
  });

  /**
   * THE WHOLE POINT OF THIS LAYER. Every price, limit and exact rule arrives on
   * the payload from `config.CREDIT_SINKS`; if a friendly line restated one it
   * could drift from the number the engine actually charges, and the player
   * would be told two different prices on the same screen.
   */
  it("states no price, so it cannot drift from config.py", () => {
    for (const line of Object.values(CREDIT_SINK_PLAIN_EFFECT)) {
      expect(line).not.toMatch(/\d/);
    }
  });

  it("degrades to null for a sink this build has never heard of", () => {
    expect(creditSinkPlainEffect("free_money")).toBeNull();
  });

  /**
   * A disabled priced control with no reason is the thing this exists to
   * prevent: "I cannot afford it", "I already used it" and "there is nothing to
   * fix" are three different problems with three different answers, and a
   * greyed-out button says none of them.
   */
  it("turns every engine reason code into a distinct sentence", () => {
    const codes = [
      "insufficient_credits",
      "refresh_limit",
      "recovery_limit",
      "lives_full",
      "role_focus_active",
      "reservation_active",
    ];
    const sentences = codes.map((c) => sinkUnavailableReason(c));
    expect(sentences.every(Boolean)).toBe(true);
    expect(new Set(sentences).size).toBe(codes.length);
  });

  it("never renders a bare code, and says nothing when there is nothing to say", () => {
    expect(sinkUnavailableReason(null)).toBeNull();
    expect(sinkUnavailableReason(undefined)).toBeNull();
    // An unknown code still produces a sentence rather than leaking the code.
    expect(sinkUnavailableReason("some_new_rule")).toBe("Not available right now.");
  });
});

describe("Scout & Prepare tradeoffs", () => {
  /**
   * v2's `scout_offers` / `take_credits` are GONE from the tradeoff table, not
   * repointed. `take_credits` does not exist at a Scout & Prepare any more, and
   * a leftover line for it would keep advertising an ATM the engine deleted.
   */
  it("covers exactly the three v3 branches and neither v2 choice", () => {
    const filmKeys = Object.keys(NODE_CHOICE_TRADEOFF).filter((k) =>
      k.startsWith("film_room:"),
    );
    expect(filmKeys.sort()).toEqual([
      "film_room:reserve_card",
      "film_room:scout_boss",
      "film_room:shape_market",
    ]);
    expect(nodeChoiceTradeoff("film_room", "take_credits")).toBeNull();
    expect(nodeChoiceTradeoff("film_room", "scout_offers")).toBeNull();
  });
});

describe("reveal copy", () => {
  /**
   * A card-by-card reel reads like something being decided as you watch. It is
   * not: the opening roster and every boss lineup are fixed by the seed and the
   * ruleset before the run starts. Both lines have to say so, because "an LLM
   * building a team live" is exactly the wrong impression to leave.
   */
  it("labels both reveals as seed and rule generated", () => {
    expect(RTT_COPY.revealSource).toMatch(/seed and rule generated/i);
    expect(RTT_COPY.bossRevealSource).toMatch(/seed and rule generated/i);
    expect(RTT_COPY.revealSource).toMatch(/before the run started/i);
    expect(RTT_COPY.bossRevealSource).toMatch(/not a team being built live/i);
  });
});
