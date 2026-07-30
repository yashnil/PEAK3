/**
 * Phase 9B: planReel invariants.
 *
 * This is the entire correctness argument for the rebuilt spinner, and it needs
 * no browser. The spinner's promise is "the row that comes to rest under the
 * payline IS the backend-selected value" -- which is true iff
 * `strip[targetIndex] === target`. Asserting that here, over a table of pool
 * shapes, is far stronger than any timing-dependent e2e sample.
 *
 * Phase 8J bought the same guarantee via modular arithmetic on a tick counter;
 * Phase 9B expresses it geometrically. These tests pin the geometric version so
 * a future refactor of the animation cannot quietly break the landing.
 */
import { describe, it, expect } from "vitest";
import { planReel } from "@/components/court/SpinStage";

// Real-shaped pools: 1 (degenerate), 5 (the decade ERA_LABELS pool that used to
// never scroll at all), ~30 (franchises), 47 (supported seasons).
const POOLS: Record<string, string[]> = {
  single: ["Only Team"],
  decade: ["1980s", "1990s", "2000s", "2010s", "2020s"],
  franchises: Array.from({ length: 30 }, (_, i) => `Team ${i + 1}`),
  seasons: Array.from({ length: 47 }, (_, i) => `${1979 + i}-${String(80 + i).slice(-2)}`),
};

const TRAVELS = [62, 34];
const WINDOW_ROWS = 3;
const MAX_STRIP_ROWS = 160;

function targetsFor(pool: string[]): Array<[string, string]> {
  return [
    ["first", pool[0]],
    ["middle", pool[Math.floor(pool.length / 2)]],
    ["last", pool[pool.length - 1]],
  ];
}

describe("planReel", () => {
  for (const [poolName, pool] of Object.entries(POOLS)) {
    for (const [position, target] of targetsFor(pool)) {
      for (const travel of TRAVELS) {
        const label = `${poolName} pool / ${position} target / travel ${travel}`;

        it(`${label}: the target row is exactly where the reel comes to rest`, () => {
          const { strip, targetIndex } = planReel(pool, target, travel);
          // THE invariant. Everything else is a supporting detail.
          expect(strip[targetIndex]).toBe(target);
        });

        it(`${label}: travel distance is exact and constant`, () => {
          const { targetIndex, startIndex } = planReel(pool, target, travel);
          // A constant travel distance is what makes every spin the same
          // duration with the same deceleration curve -- no positional bias,
          // no "some rolls take longer" tell.
          expect(targetIndex - startIndex).toBe(travel);
        });

        it(`${label}: the window is full at t=0 and stays in bounds`, () => {
          const { strip, targetIndex, startIndex } = planReel(pool, target, travel);
          // startIndex must leave a full window of real rows above it, or the
          // reel visibly starts with blank space.
          expect(startIndex).toBeGreaterThanOrEqual(WINDOW_ROWS);
          expect(targetIndex).toBeLessThan(strip.length);
          expect(strip.length).toBeLessThanOrEqual(MAX_STRIP_ROWS);
        });

        it(`${label}: reports the backend value as finalLabel`, () => {
          expect(planReel(pool, target, travel).finalLabel).toBe(target);
        });
      }
    }
  }

  it("does not leak the answer under the payline before the spin starts", () => {
    // If the pre-spin row happened to already be the target, the reel would
    // show the result at t=0 and the whole reveal would be pointless.
    for (const pool of [POOLS.decade, POOLS.franchises, POOLS.seasons]) {
      for (const [, target] of targetsFor(pool)) {
        const { strip, startIndex } = planReel(pool, target, 62);
        expect(strip[startIndex]).not.toBe(target);
      }
    }
  });

  it("appends a target missing from the pool rather than landing on a wrong value", () => {
    // Preserves Phase 8J's defensive guarantee: if the readiness pool is stale
    // and lacks the real backend value, the reel must still come to rest on the
    // real value -- never on a nearby wrong one.
    const target = "Brand New Franchise";
    const { strip, targetIndex, finalLabel } = planReel(POOLS.franchises, target, 62);
    expect(POOLS.franchises).not.toContain(target);
    expect(strip[targetIndex]).toBe(target);
    expect(finalLabel).toBe(target);
  });

  it("scrolls a pool smaller than the window instead of shuffling it", () => {
    // Regression for the old model's broken case: the 5-entry decade pool had
    // exactly as many entries as the visible window, so nothing ever entered or
    // left -- it reordered in place. A strip must contain many real laps.
    const { strip } = planReel(POOLS.decade, POOLS.decade[2], 62);
    expect(strip.length).toBeGreaterThan(POOLS.decade.length * 3);
  });

  it("handles a degenerate single-entry pool without exploding the DOM", () => {
    const { strip, targetIndex } = planReel(POOLS.single, "Only Team", 62);
    expect(strip[targetIndex]).toBe("Only Team");
    expect(strip.length).toBeLessThanOrEqual(MAX_STRIP_ROWS);
  });

  it("never produces a zero-travel spin", () => {
    for (const [, pool] of Object.entries(POOLS)) {
      const { targetIndex, startIndex } = planReel(pool, pool[0], 62);
      expect(targetIndex).toBeGreaterThan(startIndex);
    }
  });
});
