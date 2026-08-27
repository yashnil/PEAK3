/**
 * 82-0 — repositioning a placed player, by every route.
 *
 * The rule this suite exists to pin: dragging is ADDITIVE. A pointer user
 * may drag a placed player onto a legal slot, and click, tap and keyboard
 * must remain fully sufficient on their own — nothing in this court is
 * reachable only by dragging.
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import PeakV2CourtSlotCard from "@/components/v2/court/PeakV2CourtSlotCard";
import type { CourtSlotPublic } from "@/types/perfect-season";

function slot(overrides: Partial<CourtSlotPublic> = {}): CourtSlotPublic {
  return {
    slot_type: "PG",
    filled: true,
    player_slug: "chris-paul",
    player_name: "Chris Paul",
    team_name: "New Orleans Hornets",
    season: "2009-10",
    ...overrides,
  } as CourtSlotPublic;
}

/** A DataTransfer stub — jsdom does not implement one. */
function dataTransfer() {
  const store: Record<string, string> = {};
  return {
    effectAllowed: "",
    dropEffect: "",
    setData: (k: string, v: string) => {
      store[k] = v;
    },
    getData: (k: string) => store[k] ?? "",
    setDragImage: vi.fn(),
  };
}

describe("82-0 placed player — drag is one route of several", () => {
  it("a placed tile is draggable and picking it up starts the same move a click does", () => {
    const onMove = vi.fn();
    render(<PeakV2CourtSlotCard slot={slot()} onMove={onMove} />);
    const tile = screen.getByTestId("court-slot");
    expect(tile).toHaveAttribute("draggable", "true");

    const dt = dataTransfer();
    fireEvent.dragStart(tile, { dataTransfer: dt });
    expect(onMove, "dragging a placed player picks it up").toHaveBeenCalledTimes(1);
    // The drag carries a payload (some browsers refuse a drag without one)
    // and the drag image is the tile itself, so the thing under the cursor
    // is the piece being moved rather than a slice of the page.
    expect(dt.getData("text/plain")).toBe("PG");
    expect(dt.setDragImage).toHaveBeenCalled();
  });

  it("CLICK still picks the same player up — drag is never the only way", () => {
    const onMove = vi.fn();
    render(<PeakV2CourtSlotCard slot={slot()} onMove={onMove} />);
    fireEvent.click(screen.getByTestId("court-slot"));
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it("KEYBOARD still picks the same player up — the tile is a real button", () => {
    const onMove = vi.fn();
    render(<PeakV2CourtSlotCard slot={slot()} onMove={onMove} />);
    const tile = screen.getByTestId("court-slot");
    // A <button> is what makes Enter/Space work without any key handling of
    // our own, and what puts the tile in the tab order.
    expect(tile.tagName).toBe("BUTTON");
    expect(tile).toHaveAccessibleName(/pick up to move/i);
  });

  it("a legal destination accepts a drop, and completes the same move a click does", () => {
    const onSwapTarget = vi.fn();
    render(
      <PeakV2CourtSlotCard
        slot={slot({ slot_type: "SG", filled: false, player_name: null })}
        onSwapTarget={onSwapTarget}
        movingFromSlotLabel="Point Guard"
      />,
    );
    const target = screen.getByTestId("slot-swap-target");

    const dt = dataTransfer();
    // `dragOver` must be defaultPrevented: that is precisely what marks an
    // element as droppable, and it is how an ILLEGAL destination declines.
    const over = fireEvent.dragOver(target, { dataTransfer: dt });
    expect(over, "dragover was prevented, marking this a legal drop target").toBe(false);

    fireEvent.drop(target, { dataTransfer: dt });
    expect(onSwapTarget).toHaveBeenCalledTimes(1);
  });

  it("clicking a legal destination completes the move without any dragging", () => {
    const onSwapTarget = vi.fn();
    render(
      <PeakV2CourtSlotCard
        slot={slot({ slot_type: "SG", filled: false, player_name: null })}
        onSwapTarget={onSwapTarget}
        movingFromSlotLabel="Point Guard"
      />,
    );
    fireEvent.click(screen.getByTestId("slot-swap-target"));
    expect(onSwapTarget).toHaveBeenCalledTimes(1);
  });

  it("an INVALID destination is not a drop target at all, so a drop cannot move anything", () => {
    // A slot that is not a legal destination is rendered without
    // `onSwapTarget`, so it registers no dragover/drop handlers: the browser
    // shows the no-drop cursor and the drop event never reaches the app.
    const onMove = vi.fn();
    render(<PeakV2CourtSlotCard slot={slot()} onMove={onMove} />);
    const tile = screen.getByTestId("court-slot");
    const dt = dataTransfer();
    const over = fireEvent.dragOver(tile, { dataTransfer: dt });
    expect(over, "an ordinary tile does not declare itself droppable").toBe(true);
    fireEvent.drop(tile, { dataTransfer: dt });
    // Only the earlier pick-up could have called this; a drop did not.
    expect(onMove).not.toHaveBeenCalled();
  });

  it("a slot with nothing in it is not draggable", () => {
    render(<PeakV2CourtSlotCard slot={slot({ filled: false, player_name: null })} />);
    expect(screen.getByTestId("court-slot")).not.toHaveAttribute("draggable", "true");
  });
});
