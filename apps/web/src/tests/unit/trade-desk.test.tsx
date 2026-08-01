/**
 * Trade Desk — the P0 defect suite.
 *
 * Two bugs are pinned here, both reported from the same screenshot:
 *
 *  1. `[object Object]` — `cost_modifiers` is `list[dict]` on the server
 *     (`nba_peak/run_the_table/pricing.py:74-86`), was declared `string[]` on
 *     the client, and was rendered with `.join(" · ")`. Every fixture in the
 *     existing suite hardcoded `cost_modifiers: []`, which is exactly why it
 *     shipped. Every card in this file carries a NON-EMPTY modifier list.
 *
 *  2. Stale / incorrect selection — the desk held two independent `useState`s,
 *     neither handler cleared the other column, nothing reset on a node change,
 *     and `selected` outranked `compatible` in the border ternary so a card
 *     that had become illegal stayed painted accent-gold with `aria-pressed`
 *     still true. Merely incompatible-and-unselected cards were painted with a
 *     red `--incorrect-dim` border, which is what reads as "highlighted".
 *
 * The scenario is the reported one, named: Domantas Sabonis out, Dirk Nowitzki
 * in, Steve Francis present and untouched.
 *
 * Nothing in this file computes a price, a refund or a legality. Legality is
 * `incoming.legal_slots.includes(outgoing.slot_id)` from the fixture (i.e. the
 * server), and the net is `incoming.cost - outgoing.refund` from the same.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

import TradeDesk from "@/components/run-the-table/TradeDesk";
import {
  EMPTY_TRADE_SELECTION,
  buildTradeReview,
  chooseIncoming,
  chooseOutgoing,
  formatCostModifier,
  incomingEligibility,
  legalIncomingCountFor,
  outgoingDeadEnd,
} from "@/lib/run-the-table-state";
import {
  ActiveNode,
  LaneField,
  RunCardPublic,
  TradeIncoming,
  TradeOutgoingOption,
} from "@/types/run-the-table";

// ---------------------------------------------------------------------------
// Fixtures — the reported screenshot, shaped field-for-field like public.py
// ---------------------------------------------------------------------------

const LANES: LaneField[] = [
  "statistical_impact",
  "traditional_production",
  "individual_recognition",
  "postseason_individual_value",
  "team_achievement",
];

function laneMap(v: number): Record<LaneField, number> {
  return Object.fromEntries(LANES.map((l) => [l, v])) as Record<LaneField, number>;
}

function baseCard(over: Partial<RunCardPublic>): RunCardPublic {
  return {
    card_id: "x",
    player_name: "X",
    player_slug: "x",
    start_season: "2004-05",
    end_season: "2006-07",
    anchor_season: "2005-06",
    window_label: "2004-05 – 2006-07",
    prime_score: 70,
    overall_percentile: 75.1,
    eligible_roles: ["forward_big"],
    primary_role: "forward_big",
    lane_index: laneMap(60),
    lane_percentiles: laneMap(70),
    base_cost: 20,
    cost: 20,
    // NON-EMPTY on purpose — see the module docstring.
    cost_modifiers: [{ system_id: "moneyball", discount_pct: 20, before: 20, after: 16 }],
    refund_value: 10,
    ...over,
  };
}

/** Sabonis holds the `forward_big` starter slot. */
const SABONIS: TradeOutgoingOption = {
  slot_id: "forward_big",
  role: "forward_big",
  is_starter: true,
  refund: 11,
  card: baseCard({
    card_id: "domantas-sabonis-3yr-202223",
    player_name: "Domantas Sabonis",
    player_slug: "domantas-sabonis",
    start_season: "2021-22",
    end_season: "2023-24",
    anchor_season: "2022-23",
    window_label: "2021-22 – 2023-24",
    prime_score: 74.8,
    lane_index: laneMap(58),
    base_cost: 22,
    cost: 18,
    cost_modifiers: [{ system_id: "moneyball", discount_pct: 20, before: 22, after: 18 }],
  }),
};

/** A second, occupied slot Nowitzki is NOT legal for. */
const ROBERTSON: TradeOutgoingOption = {
  slot_id: "lead_creator",
  role: "lead_creator",
  is_starter: true,
  refund: 9,
  card: baseCard({
    card_id: "oscar-robertson-3yr-196364",
    player_name: "Oscar Robertson",
    player_slug: "oscar-robertson",
    primary_role: "lead_creator",
    eligible_roles: ["lead_creator"],
    lane_index: laneMap(66),
  }),
};

const NOWITZKI: TradeIncoming = {
  ...baseCard({
    card_id: "dirk-nowitzki-3yr-200506",
    player_name: "Dirk Nowitzki",
    player_slug: "dirk-nowitzki",
    prime_score: 84.1,
    lane_index: laneMap(71),
    base_cost: 30,
    cost: 24,
    cost_modifiers: [{ system_id: "moneyball", discount_pct: 20, before: 30, after: 24 }],
  }),
  // The SERVER's list. Nowitzki can play forward_big, and cannot play
  // lead_creator — that asymmetry is what the "changing the outgoing pick
  // clears an incompatible incoming pick" rule is tested against.
  legal_slots: ["forward_big"],
};

const FRANCIS: TradeIncoming = {
  ...baseCard({
    card_id: "steve-francis-3yr-200102",
    player_name: "Steve Francis",
    player_slug: "steve-francis",
    primary_role: "lead_creator",
    eligible_roles: ["lead_creator"],
    prime_score: 68.3,
    lane_index: laneMap(54),
    base_cost: 16,
    cost: 13,
    cost_modifiers: [{ system_id: "moneyball", discount_pct: 20, before: 16, after: 13 }],
  }),
  legal_slots: ["lead_creator"],
};

/** `incoming.cost - outgoing.refund` — the published net, from the payload. */
const NET_NOWITZKI_FOR_SABONIS = NOWITZKI.cost - SABONIS.refund; // 24 - 11 = 13

function tradeNode(over: Partial<ActiveNode> = {}): ActiveNode {
  return {
    node_id: "a1s2-trade",
    node_type: "trade_desk",
    title: "Phones are ringing",
    summary: "Three names available.",
    can_decline: true,
    incoming: [NOWITZKI, FRANCIS],
    outgoing_options: [SABONIS, ROBERTSON],
    ...over,
  };
}

function renderDesk(
  props: Partial<React.ComponentProps<typeof TradeDesk>> = {},
): { onTrade: ReturnType<typeof vi.fn>; rerender: (node: ActiveNode) => void; container: HTMLElement } {
  const onTrade = vi.fn();
  const node = props.node ?? tradeNode();
  const view = render(
    <TradeDesk
      node={node}
      credits={props.credits ?? 40}
      busy={props.busy ?? false}
      onTrade={props.onTrade ?? onTrade}
      onDecline={props.onDecline ?? vi.fn()}
    />,
  );
  return {
    onTrade: (props.onTrade as ReturnType<typeof vi.fn>) ?? onTrade,
    container: view.container,
    rerender: (next: ActiveNode) =>
      view.rerender(
        <TradeDesk
          node={next}
          credits={props.credits ?? 40}
          busy={false}
          onTrade={props.onTrade ?? onTrade}
          onDecline={vi.fn()}
        />,
      ),
  };
}

const IN = (id: string) => screen.getByTestId(`rtt-trade-in-${id}`);
const OUT = (id: string) => screen.getByTestId(`rtt-trade-out-${id}`);

// ---------------------------------------------------------------------------
// The exact reported scenario
// ---------------------------------------------------------------------------

describe("Trade Desk — the reported screenshot scenario", () => {
  it("trades Nowitzki for Sabonis at the published net, with Francis untouched", async () => {
    const { onTrade, container } = renderDesk();

    // 1. Send out Sabonis.
    await userEvent.click(OUT("forward_big"));
    // 2. Bring in Nowitzki.
    await userEvent.click(IN("dirk-nowitzki-3yr-200506"));

    // Exactly ONE outgoing and ONE incoming card carry the selected state.
    const selectedOut = container.querySelectorAll(
      '[data-testid^="rtt-trade-out-"][data-selected="true"]',
    );
    const selectedIn = container.querySelectorAll(
      '[data-testid^="rtt-trade-in-"][data-selected="true"]',
    );
    expect(selectedOut).toHaveLength(1);
    expect(selectedIn).toHaveLength(1);
    expect(selectedOut[0]).toBe(OUT("forward_big"));
    expect(selectedIn[0]).toBe(IN("dirk-nowitzki-3yr-200506"));

    // Steve Francis is present, NOT selected and NOT highlighted. He is also
    // not painted with an error colour: an ineligible card is recessed, and
    // accent-gold in this surface means "selected" and nothing else.
    const francis = IN("steve-francis-3yr-200102");
    expect(within(francis).getByText("Steve Francis")).toBeInTheDocument();
    expect(francis).toHaveAttribute("data-selected", "false");
    expect(francis).toHaveAttribute("aria-pressed", "false");
    expect(francis.style.borderColor).not.toContain("peak-accent");
    expect(francis.style.background).not.toContain("peak-accent");
    expect(francis.style.borderColor).not.toContain("incorrect");

    // 3. Review shows the whole transaction before anything is committed.
    const summary = screen.getByTestId("rtt-trade-summary");
    expect(summary).toHaveTextContent(
      `Domantas Sabonis out, Dirk Nowitzki in — net ${NET_NOWITZKI_FOR_SABONIS} credits.`,
    );
    expect(screen.getByTestId("rtt-trade-credits-after")).toHaveTextContent(
      String(40 - NET_NOWITZKI_FOR_SABONIS),
    );
    expect(screen.getByTestId("rtt-trade-legality")).toHaveTextContent(/Roster stays legal/i);

    // No raw object serialisation anywhere in the rendered output — the whole
    // point of the first P0.
    expect(container.textContent).not.toContain("[object Object]");

    // 4. Confirm.
    await userEvent.click(screen.getByTestId("rtt-trade-confirm"));
    expect(onTrade).toHaveBeenCalledTimes(1);
    expect(onTrade).toHaveBeenCalledWith(
      "forward_big",
      "dirk-nowitzki-3yr-200506",
      NET_NOWITZKI_FOR_SABONIS,
    );
  });

  it("shows every card's discount as words, on both columns", () => {
    const { container } = renderDesk();
    expect(container.textContent).not.toContain("[object Object]");
    // Incoming (cost) and outgoing (refund) columns both render RunCard.
    expect(
      within(IN("dirk-nowitzki-3yr-200506")).getByTestId("rtt-card-modifier-moneyball"),
    ).toHaveTextContent("Moneyball · −20% (30 → 24)");
    expect(
      within(OUT("forward_big")).getByTestId("rtt-card-modifier-moneyball"),
    ).toHaveTextContent("Moneyball · −20% (22 → 18)");
  });
});

// ---------------------------------------------------------------------------
// Selection rules
// ---------------------------------------------------------------------------

describe("Trade Desk — selection rules", () => {
  it("changing the outgoing pick clears an incoming pick that slot cannot take", async () => {
    renderDesk();
    await userEvent.click(OUT("forward_big"));
    await userEvent.click(IN("dirk-nowitzki-3yr-200506"));
    expect(IN("dirk-nowitzki-3yr-200506")).toHaveAttribute("data-selected", "true");

    // lead_creator is NOT in Nowitzki's server-supplied `legal_slots`.
    await userEvent.click(OUT("lead_creator"));
    expect(IN("dirk-nowitzki-3yr-200506")).toHaveAttribute("data-selected", "false");
    expect(IN("dirk-nowitzki-3yr-200506")).toHaveAttribute("aria-pressed", "false");
    expect(OUT("lead_creator")).toHaveAttribute("data-selected", "true");
    expect(OUT("forward_big")).toHaveAttribute("data-selected", "false");
    // Nothing to confirm any more, and no summary claiming a trade.
    expect(screen.getByTestId("rtt-trade-confirm")).toBeDisabled();
    expect(screen.getByTestId("rtt-trade-summary")).not.toHaveTextContent(/net \d+ credits/);
  });

  it("keeps a compatible incoming pick when the outgoing pick changes to a legal slot", async () => {
    const node = tradeNode({
      // Nowitzki legal for both occupied slots this time.
      incoming: [{ ...NOWITZKI, legal_slots: ["forward_big", "lead_creator"] }, FRANCIS],
    });
    renderDesk({ node });
    await userEvent.click(OUT("forward_big"));
    await userEvent.click(IN("dirk-nowitzki-3yr-200506"));
    await userEvent.click(OUT("lead_creator"));
    expect(IN("dirk-nowitzki-3yr-200506")).toHaveAttribute("data-selected", "true");
  });

  it("never highlights an unrelated offer when the incoming pick changes", async () => {
    const node = tradeNode({ incoming: [{ ...FRANCIS, legal_slots: ["forward_big"] }, NOWITZKI] });
    const { container } = renderDesk({ node });
    await userEvent.click(OUT("forward_big"));
    await userEvent.click(IN("dirk-nowitzki-3yr-200506"));
    await userEvent.click(IN("steve-francis-3yr-200102"));
    const selected = container.querySelectorAll(
      '[data-testid^="rtt-trade-in-"][data-selected="true"]',
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]).toBe(IN("steve-francis-3yr-200102"));
    // And the outgoing column is untouched.
    expect(OUT("forward_big")).toHaveAttribute("data-selected", "true");
    expect(OUT("lead_creator")).toHaveAttribute("data-selected", "false");
  });

  it("disables an ineligible card with ONE concise reason and a click guard", async () => {
    renderDesk();
    await userEvent.click(OUT("forward_big"));
    const francis = IN("steve-francis-3yr-200102");
    expect(francis).toHaveAttribute("aria-disabled", "true");
    // Still focusable: `disabled` would take it out of the tab order and the
    // reason it is inert is exactly what a keyboard user needs to reach.
    expect(francis).toBeEnabled();
    francis.focus();
    expect(francis).toHaveFocus();
    // Exactly one reason, not a paragraph.
    expect(within(francis).getByText("Cannot play Forward / Big")).toBeInTheDocument();
    await userEvent.click(francis);
    expect(francis).toHaveAttribute("data-selected", "false");
  });

  it("communicates selection through icon and text, not colour alone", async () => {
    renderDesk();
    await userEvent.click(OUT("forward_big"));
    expect(within(OUT("forward_big")).getByText("Sending out")).toBeInTheDocument();
    await userEvent.click(IN("dirk-nowitzki-3yr-200506"));
    expect(
      within(IN("dirk-nowitzki-3yr-200506")).getByText("Bringing in"),
    ).toBeInTheDocument();
  });

  it("Cancel clears every piece of ephemeral transaction state", async () => {
    const { container } = renderDesk();
    await userEvent.click(OUT("forward_big"));
    await userEvent.click(IN("dirk-nowitzki-3yr-200506"));
    await userEvent.click(screen.getByTestId("rtt-trade-cancel"));

    expect(
      container.querySelectorAll('[data-selected="true"]'),
    ).toHaveLength(0);
    expect(screen.getByTestId("rtt-trade-confirm")).toBeDisabled();
    expect(screen.getByTestId("rtt-trade-cancel")).toBeDisabled();
    expect(screen.getByTestId("rtt-trade-summary")).toHaveTextContent(
      /Pick one roster player and one incoming player/i,
    );
  });

  it("resets the whole selection when the node changes", async () => {
    // The old desk had no `key` and no reset, so a selection survived into the
    // NEXT trade node and pointed at ids that were no longer on the board.
    const { rerender, container } = renderDesk();
    await userEvent.click(OUT("forward_big"));
    await userEvent.click(IN("dirk-nowitzki-3yr-200506"));
    expect(container.querySelectorAll('[data-selected="true"]')).toHaveLength(2);

    rerender(tradeNode({ node_id: "a2s1-trade" }));
    expect(container.querySelectorAll('[data-selected="true"]')).toHaveLength(0);
    expect(screen.getByTestId("rtt-trade-confirm")).toBeDisabled();
  });

  it("refuses to confirm a trade the player cannot afford, and says the number", async () => {
    renderDesk({ credits: 5 });
    await userEvent.click(OUT("forward_big"));
    await userEvent.click(IN("dirk-nowitzki-3yr-200506"));
    expect(screen.getByTestId("rtt-trade-confirm")).toBeDisabled();
    expect(screen.getByTestId("rtt-trade-affordability")).toHaveTextContent(
      `this trade needs ${NET_NOWITZKI_FOR_SABONIS} and you hold 5`,
    );
  });

  it("shows role before and after, and the five-lane change for the slot", async () => {
    renderDesk();
    await userEvent.click(OUT("forward_big"));
    await userEvent.click(IN("dirk-nowitzki-3yr-200506"));
    const summary = screen.getByTestId("rtt-trade-summary");
    expect(summary).toHaveTextContent("Role in Forward / Big, before");
    expect(summary).toHaveTextContent("Role in Forward / Big, after");
    // Sabonis 58 -> Nowitzki 71 on every lane in this fixture.
    const lane = screen.getByTestId("rtt-trade-lane-statistical_impact");
    expect(lane).toHaveTextContent("58");
    expect(lane).toHaveTextContent("71");
    expect(lane).toHaveTextContent("+13.0");
    // And it never claims to be the roster total, which only the server owns.
    expect(summary).toHaveTextContent(/starter\/bench weighting, which the server recomputes/i);
  });
});

// ---------------------------------------------------------------------------
// The pure model
// ---------------------------------------------------------------------------

describe("trade selection model", () => {
  it("formats a cost modifier from the engine's own four fields", () => {
    expect(
      formatCostModifier({ system_id: "no_hardware", discount_pct: 30, before: 24, after: 17 }),
    ).toBe("No Hardware · −30% (24 → 17)");
    // An id this build has never heard of still reads as words, never a raw enum.
    expect(
      formatCostModifier({ system_id: "future_perk", discount_pct: 5, before: 10, after: 9 }),
    ).toBe("Future Perk · −5% (10 → 9)");
  });

  it("drops an incompatible incoming pick when the outgoing slot changes", () => {
    const withBoth = chooseIncoming(
      chooseOutgoing(EMPTY_TRADE_SELECTION, "forward_big", [NOWITZKI, FRANCIS]),
      "dirk-nowitzki-3yr-200506",
    );
    expect(withBoth).toEqual({
      outgoingSlotId: "forward_big",
      incomingCardId: "dirk-nowitzki-3yr-200506",
    });
    expect(chooseOutgoing(withBoth, "lead_creator", [NOWITZKI, FRANCIS])).toEqual({
      outgoingSlotId: "lead_creator",
      incomingCardId: null,
    });
  });

  it("toggling the outgoing slot off clears the whole transaction", () => {
    const sel = { outgoingSlotId: "forward_big", incomingCardId: "dirk-nowitzki-3yr-200506" };
    expect(chooseOutgoing(sel, "forward_big", [NOWITZKI])).toEqual(EMPTY_TRADE_SELECTION);
  });

  it("calls nothing ineligible before an outgoing slot exists", () => {
    expect(incomingEligibility(FRANCIS, null)).toEqual({ eligible: true, reason: null });
    expect(incomingEligibility(FRANCIS, SABONIS).eligible).toBe(false);
  });

  it("nets the server's cost against the server's refund and nothing else", () => {
    const review = buildTradeReview(
      tradeNode(),
      { outgoingSlotId: "forward_big", incomingCardId: "dirk-nowitzki-3yr-200506" },
      40,
    );
    expect(review).not.toBeNull();
    expect(review!.cost).toBe(NOWITZKI.cost);
    expect(review!.refund).toBe(SABONIS.refund);
    expect(review!.net).toBe(NET_NOWITZKI_FOR_SABONIS);
    expect(review!.creditsAfter).toBe(40 - NET_NOWITZKI_FOR_SABONIS);
    expect(review!.legal).toBe(true);
    expect(review!.blockedReason).toBeNull();
  });

  it("returns no review at all while either half of the pair is missing", () => {
    expect(buildTradeReview(tradeNode(), EMPTY_TRADE_SELECTION, 40)).toBeNull();
    expect(
      buildTradeReview(tradeNode(), { outgoingSlotId: "forward_big", incomingCardId: null }, 40),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Dead-end slots
// ---------------------------------------------------------------------------

/**
 * A real board can offer three players and still have a roster slot none of
 * them may legally take. This was found by inspecting a live 1440x900 capture
 * of an actual run: the Lead Creator slot was selected and all three incoming
 * offers went disabled with "Cannot play Lead Creator", leaving no forward path
 * and no explanation of what to do instead.
 *
 * That is the "trial-and-error to discover role legality" the brief bans, so
 * the warning is computed for EVERY outgoing card up front rather than only
 * being revealed after the click.
 */
describe("Trade Desk — a slot no offer can fill", () => {
  /** Both incoming players are forward_big only; Robertson holds lead_creator. */
  function deadEndNode(): ActiveNode {
    return tradeNode({
      incoming: [NOWITZKI, { ...FRANCIS, legal_slots: ["forward_big"] }],
    });
  }

  it("counts the legal replacements the server allows for a slot", () => {
    const node = deadEndNode();
    const incoming = node.incoming!;
    expect(legalIncomingCountFor(SABONIS, incoming)).toBe(2);
    expect(legalIncomingCountFor(ROBERTSON, incoming)).toBe(0);
  });

  it("stays silent when at least one legal replacement exists", () => {
    expect(outgoingDeadEnd(SABONIS, deadEndNode().incoming!)).toBeNull();
    // An empty board is not a dead end; it is a different, already-handled state.
    expect(outgoingDeadEnd(ROBERTSON, [])).toBeNull();
  });

  it("names the unfillable slot rather than leaving it to be discovered", () => {
    expect(outgoingDeadEnd(ROBERTSON, deadEndNode().incoming!)).toBe(
      "No one on this board can play Lead Creator",
    );
  });

  it("warns on the outgoing card BEFORE it is clicked", () => {
    renderDesk({ node: deadEndNode() });
    expect(OUT("lead_creator")).toHaveTextContent(/No one on this board can play Lead Creator/i);
    // ...and does not cry wolf on the slot that does have replacements.
    expect(OUT("forward_big")).not.toHaveTextContent(/No one on this board/i);
  });

  it("tells the player what to do instead once the dead end is selected", async () => {
    const user = userEvent.setup();
    renderDesk({ node: deadEndNode() });
    await user.click(OUT("lead_creator"));

    const desk = screen.getByTestId("rtt-trade-desk");
    expect(desk).toHaveTextContent(/None of these players may play Lead Creator/i);
    // The two ways out are both named, so the player is never stranded.
    expect(desk).toHaveTextContent(/Pick a different player to send out, or decline/i);
    // And the escape hatch really is there.
    expect(screen.getByTestId("rtt-trade-decline")).toBeEnabled();
  });

  it("lets the player leave the dead end by choosing another outgoing slot", async () => {
    const user = userEvent.setup();
    const { onTrade } = renderDesk({ node: deadEndNode() });
    await user.click(OUT("lead_creator"));
    await user.click(OUT("forward_big"));
    await user.click(IN("dirk-nowitzki-3yr-200506"));
    await user.click(screen.getByTestId("rtt-trade-confirm"));

    expect(onTrade).toHaveBeenCalledWith(
      "forward_big",
      "dirk-nowitzki-3yr-200506",
      NET_NOWITZKI_FOR_SABONIS,
    );
  });
});
