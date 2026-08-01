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
  bossRulePlainEffect,
  componentLabels,
  lanesToWinSentence,
  nodeChoiceTradeoff,
  nodeTypeCopy,
  perkPlainEffect,
  perkStrategyHint,
  shouldSuppressServerSummary,
} from "@/lib/run-the-table-copy";
import { SYSTEM_LABELS } from "@/lib/run-the-table-state";
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
    expect(NODE_TYPE_COPY.film_room.purpose).toBe(
      "Learn what is coming or take a preparation benefit.",
    );
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
   * WHAT SCOUTING ACTUALLY DOES (`state.action_film_room:499-508`): it unlocks
   * the remaining stages of THIS act plus stage 1 of the next. And
   * `public.py:338-341` reveals the boss's roster once this act's LAST stage is
   * scouted — the highest-value consequence, which no surface used to state.
   */
  it("states the real Film Room mechanic, boss reveal included", () => {
    const c = NODE_TYPE_COPY.film_room.consequence;
    expect(c).toMatch(/first stage of the next/i);
    expect(c).toMatch(/boss/i);
    // There is no prep-advantage mechanic anywhere in the engine.
    expect(c.toLowerCase()).not.toContain("prep advantage");
  });

  /** `generation.py:199-202` sets the Film Room's server summary to a mechanic
   *  the engine does not implement, so that one string is not printed. */
  it("suppresses the server summary for the Film Room and for nothing else", () => {
    expect(shouldSuppressServerSummary("film_room")).toBe(true);
    for (const type of NODE_TYPES.filter((t) => t !== "film_room")) {
      expect(shouldSuppressServerSummary(type)).toBe(false);
    }
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
    for (const id of ["the_wall", "strength_in_numbers", "top_heavy", "the_standard"]) {
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
