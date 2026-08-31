/**
 * `DNARadar.tsx` had zero test coverage before the final RC audit — added
 * alongside the audit's fix for a real, confirmed accessibility gap: the
 * chart's accessible name was the static string "Lineup DNA radar," which
 * told a screen-reader user a chart existed but conveyed none of the six
 * dimension values a sighted user reads directly off the shape/fill. The
 * six per-point `<title>` elements never closed this gap either — a
 * `role="img"` element's accessible name/description comes from
 * `aria-label`/`aria-labelledby`, not from child `<title>` elements, so
 * those never reached assistive tech (they remain valid as native mouse
 * hover tooltips, which this file does not need to re-test).
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import DNARadar from "@/components/draft/DNARadar";
import type { LineupDNA } from "@/types/draft";

function dna(overrides: Partial<LineupDNA> = {}): LineupDNA {
  return {
    primary_creation: 72,
    scoring_pressure: 58,
    individual_validation: 41,
    postseason_translation: 65,
    team_context: 30,
    context_completeness: 100,
    ...overrides,
  };
}

describe("DNARadar", () => {
  it("carries every dimension's actual value in its accessible name", () => {
    render(<DNARadar dna={dna()} />);
    const chart = screen.getByRole("img", { name: /Lineup DNA/i });
    expect(chart).toHaveAccessibleName(
      "Lineup DNA: Creation 72, Scoring 58, Validation 41, Playoffs 65, Team 30, Data 100",
    );
  });

  it("rounds a fractional value rather than announcing it raw", () => {
    render(<DNARadar dna={dna({ primary_creation: 71.6 })} />);
    expect(screen.getByRole("img")).toHaveAccessibleName(/Creation 72/);
  });

  it("announces a missing dimension as zero rather than dropping it from the name", () => {
    render(<DNARadar dna={dna({ team_context: undefined as unknown as number })} />);
    expect(screen.getByRole("img")).toHaveAccessibleName(/Team 0/);
  });
});
