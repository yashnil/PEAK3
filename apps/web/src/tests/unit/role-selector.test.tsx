/**
 * After a keyboard-driven offer-card selection, the selected card becomes
 * `disabled` (its `onClick` only exists during the "selecting" phase) and
 * drops out of the tab order from wherever it sat. `RoleSelector` renders
 * BEFORE the offer-card list in `DraftScreen`'s DOM, so forward-Tab from
 * the now-disabled card used to skip past this panel entirely into
 * whatever came after the offers — confirmed live during the release-
 * candidate audit. Fixed by moving focus onto the panel itself on mount
 * (the same `tabIndex={-1}` pattern `ChallengeComparison` already uses).
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import RoleSelector from "@/components/draft/RoleSelector";
import type { DraftCard } from "@/types/draft";

function card(overrides: Partial<DraftCard> = {}): DraftCard {
  return {
    peak_window_id: "player-a-1yr-199091",
    player_id: "player-a",
    player_slug: "player-a",
    player_name: "Player A",
    duration_years: 1,
    start_season: "1990-91",
    end_season: "1990-91",
    anchor_season: "1990-91",
    individual_peak_score: 95,
    individual_peak_rank: 3,
    eligible_roles: ["lead_creator", "guard_wing"],
    primary_role: "lead_creator",
    lineup_dna: {
      primary_creation: 80,
      scoring_pressure: 70,
      individual_validation: 60,
      postseason_translation: 50,
      team_context: 40,
      context_completeness: 90,
    },
    data_completeness: "complete",
    profile_status: "ok",
    ...overrides,
  };
}

describe("RoleSelector", () => {
  it("moves keyboard focus onto itself as soon as it mounts", () => {
    render(
      <RoleSelector
        card={card()}
        openRoles={["lead_creator", "guard_wing", "wing_forward", "forward_big", "anchor"]}
        selectedRole={null}
        onSelect={() => {}}
        onCancel={() => {}}
        onConfirm={() => {}}
        submitting={false}
      />,
    );

    // A forward-Tab from wherever the (now-disabled) offer card was will
    // land on whatever comes immediately after this element in DOM order —
    // which is only correct if the panel itself, not some element inside
    // or after it, is what receives focus on mount.
    expect(screen.getByTestId("role-panel")).toBe(document.activeElement);
  });
});
