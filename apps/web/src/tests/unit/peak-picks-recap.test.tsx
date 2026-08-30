/**
 * PeakPicksRecap had zero component-level coverage before Batch 8 (only
 * courtbuilder.spec.ts's e2e row-count assertion touched it).
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PeakPicksRecap from "@/components/court/PeakPicksRecap";
import type { PeakPickRecapEntry } from "@/types/perfect-season";

function entry(overrides: Partial<PeakPickRecapEntry> = {}): PeakPickRecapEntry {
  return {
    round_number: 1,
    slot_type: "PG",
    matched: true,
    picked_player_name: "Chris Paul",
    picked_score: 82.4,
    peak_pick_player_name: "Chris Paul",
    peak_pick_score: 82.4,
    ...overrides,
  } as PeakPickRecapEntry;
}

describe("PeakPicksRecap", () => {
  it("renders nothing when the server sends no recap", () => {
    const { container } = render(<PeakPicksRecap recap={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("reports the matched count and one row per round", () => {
    render(
      <PeakPicksRecap
        recap={[
          entry({ round_number: 1, matched: true }),
          entry({ round_number: 2, matched: false, picked_player_name: "Kyrie Irving", picked_score: 70, peak_pick_player_name: "Chris Paul", peak_pick_score: 82.4 }),
        ]}
      />,
    );

    expect(screen.getByTestId("peak-picks-match-count")).toHaveTextContent("1/2 matched");
    expect(screen.getAllByTestId("peak-picks-recap-row")).toHaveLength(2);
  });

  it("shows PEAK3's own pick alongside the player's actual pick on a miss", () => {
    render(
      <PeakPicksRecap
        recap={[
          entry({ round_number: 1, matched: false, picked_player_name: "Kyrie Irving", picked_score: 70, peak_pick_player_name: "Chris Paul", peak_pick_score: 82.4 }),
        ]}
      />,
    );

    const row = screen.getByTestId("peak-picks-recap-row");
    expect(row).toHaveAttribute("data-matched", "false");
    expect(row).toHaveTextContent("Kyrie Irving");
    expect(row).toHaveTextContent("Chris Paul");
  });

  it("marks a matched round distinctly rather than repeating the miss layout", () => {
    render(<PeakPicksRecap recap={[entry({ round_number: 1, matched: true, picked_player_name: "Chris Paul" })]} />);

    const row = screen.getByTestId("peak-picks-recap-row");
    expect(row).toHaveAttribute("data-matched", "true");
    expect(row).toHaveTextContent(/you matched peak3.s pick/i);
  });
});
