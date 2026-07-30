import { describe, it, expect } from "vitest";
import { resultTier } from "@/components/court/SeasonResultStub";

// Phase 8J: 53-29 was labeled "Mid Pack" -- dismissive for a genuine
// playoff-caliber NBA record. These lock in the recalibrated bands so a
// specific win total can be asserted directly and fast, rather than trying
// to force a precise win total out of the real (seeded-noise) simulator
// through a full e2e draft.
describe("resultTier", () => {
  it("53 wins reads as a playoff team, never Mid Pack", () => {
    expect(resultTier(53)).toBe("Playoff Team");
    expect(resultTier(53)).not.toBe("Mid Pack");
  });

  it("45-53 wins is Playoff Team", () => {
    expect(resultTier(45)).toBe("Playoff Team");
    expect(resultTier(53)).toBe("Playoff Team");
  });

  it("54-60 wins is Strong Playoff Team", () => {
    expect(resultTier(54)).toBe("Strong Playoff Team");
    expect(resultTier(60)).toBe("Strong Playoff Team");
  });

  it("61+ wins is never merely 'Playoff Team'", () => {
    for (const wins of [61, 65, 67, 68, 74, 75, 79, 80, 81, 82]) {
      expect(resultTier(wins)).not.toBe("Playoff Team");
    }
  });

  it("61-67 wins is Title Contender", () => {
    expect(resultTier(61)).toBe("Title Contender");
    expect(resultTier(67)).toBe("Title Contender");
  });

  it("68-74 wins is Title Favorite", () => {
    expect(resultTier(68)).toBe("Title Favorite");
    expect(resultTier(74)).toBe("Title Favorite");
  });

  it("75-79 wins is Historic Juggernaut", () => {
    expect(resultTier(75)).toBe("Historic Juggernaut");
    expect(resultTier(79)).toBe("Historic Juggernaut");
  });

  it("80-81 wins is 82-0 Caliber, 82 wins is 82-0 Immortal", () => {
    expect(resultTier(80)).toBe("82-0 Caliber");
    expect(resultTier(81)).toBe("82-0 Caliber");
    expect(resultTier(82)).toBe("82-0 Immortal");
  });

  it("below 45 degrades through fringe/lottery/rebuild bands", () => {
    expect(resultTier(44)).toBe("Fringe Playoff Team");
    expect(resultTier(35)).toBe("Fringe Playoff Team");
    expect(resultTier(34)).toBe("Lottery Team");
    expect(resultTier(20)).toBe("Lottery Team");
    expect(resultTier(19)).toBe("Rebuild");
    expect(resultTier(0)).toBe("Rebuild");
  });
});
