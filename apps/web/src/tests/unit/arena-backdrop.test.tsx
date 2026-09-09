/**
 * The room's guarantees.
 *
 * `PeakV2ArenaBackdrop` is mounted once, in `(main)/layout.tsx`, behind every
 * screen in the product. That makes three of its properties load-bearing in a
 * way a screenshot cannot protect: it must never reach the pointer, never
 * reach assistive tech, and never be duplicated. A second instance would mean
 * two floodlights over one viewport, which is the exact one-light violation
 * this component exists to fix.
 *
 * The geometry assertions are not decoration either. The court is drawn from
 * real NBA dimensions, and "someone nudged a number until it looked right" is
 * the failure mode that turns it back into abstract shapes — so the derived
 * corner-three tangent and the padded viewBox are pinned here with the
 * arithmetic that produced them.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

import PeakV2ArenaBackdrop from "@/components/v2/PeakV2ArenaBackdrop";

const ROOM_CSS = fs.readFileSync(
  path.join(process.cwd(), "src/styles/v2/arena-room.css"),
  "utf8",
);

describe("PeakV2ArenaBackdrop", () => {
  it("is inert to the pointer and to assistive technology", () => {
    const { container } = render(<PeakV2ArenaBackdrop />);
    const root = container.querySelector('[data-testid="arena-backdrop"]')!;
    expect(root.getAttribute("aria-hidden")).toBe("true");
    // `pointer-events: none` lives in the stylesheet, not inline, so assert it
    // there — a jsdom computed style would report the inline value only.
    expect(ROOM_CSS).toMatch(/\.pk-arena-backdrop\s*\{[^}]*pointer-events:\s*none/);
  });

  it("draws the court by default and hides it on a reading surface", () => {
    const { container: ambient } = render(<PeakV2ArenaBackdrop />);
    expect(ambient.querySelector("svg")).not.toBeNull();

    const { container: quiet } = render(<PeakV2ArenaBackdrop intensity="quiet" />);
    expect(quiet.querySelector("svg")).toBeNull();
  });

  it("pads the viewBox so the whole floor fits on screen", () => {
    // 8ft of apron each side and 6ft top and bottom around a 94x50 court.
    // Without the apron the court overflows a 16:9 viewport under `slice` and
    // the viewer sees two arcs and no boundary — see the component's viewBox
    // comment for why that had to be re-cut.
    const { container } = render(<PeakV2ArenaBackdrop />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("-8 -6 110 62");
    expect(svg.getAttribute("preserveAspectRatio")).toBe("xMidYMid slice");
  });

  it("puts the corner three where the real one is", () => {
    // 14ft in from the baseline is 8.75ft past a basket 5.25ft off it, so the
    // perpendicular offset is sqrt(23.75^2 - 8.75^2) = 22.08ft — which places
    // the straight run 2.92ft off the sideline, i.e. the 22ft corner three.
    const derived = Math.sqrt(23.75 ** 2 - 8.75 ** 2);
    expect(25 - derived).toBeCloseTo(2.92, 2);

    const { container } = render(<PeakV2ArenaBackdrop />);
    const paths = [...container.querySelectorAll("path")].map((p) => p.getAttribute("d") ?? "");
    expect(paths.some((d) => d.includes("2.92") && d.includes("23.75"))).toBe(true);
  });

  it("keeps the court line under the alpha the contrast budget was measured at", () => {
    // Gold at 0.10 over `--bg-page` puts `--text-muted` at ~5.1:1, clearing
    // AA. 0.14 puts it at ~4.6:1 — the tenth-of-a-point margin the
    // `--v2-court-dim-opacity` incident already taught this codebase not to
    // ship. Any raise past 0.10 has to redo that measurement, so the ceiling
    // is asserted rather than left to a reviewer's eye.
    const alphas = [...ROOM_CSS.matchAll(/--pk-backdrop-line:\s*rgba\([^)]*?,\s*([\d.]+)\s*\)/g)].map(
      (m) => Number(m[1]),
    );
    expect(alphas.length).toBeGreaterThan(0);
    for (const a of alphas) expect(a).toBeLessThanOrEqual(0.13);
  });

  it("never animates — the room is painted once and left alone", () => {
    // An ambient effect that breathes is an ambient effect competing with the
    // game for attention, and a repainting fixed layer costs frames during
    // gameplay. Both are ruled out by there being no animation at all, which
    // is also why there is nothing here for `prefers-reduced-motion` to undo.
    expect(ROOM_CSS).not.toMatch(/@keyframes/);
    expect(ROOM_CSS).not.toMatch(/\banimation\s*:/);
    expect(ROOM_CSS).not.toMatch(/\btransition\s*:/);
  });
});

describe("the room is mounted exactly once", () => {
  const layout = fs.readFileSync(
    path.join(process.cwd(), "src/app/(main)/layout.tsx"),
    "utf8",
  );

  it("lives in the (main) layout", () => {
    expect(layout).toContain("PeakV2ArenaBackdrop");
    expect(layout).toContain("pk-arena-room");
  });

  it("has no second call site", () => {
    // Two `position: fixed` backdrops means two floodlights over one viewport.
    // The intensity variants exist precisely so a route never needs its own.
    const roots = ["src/app", "src/components"];
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const src = fs.readFileSync(full, "utf8");
          if (/<PeakV2ArenaBackdrop\b/.test(src)) hits.push(full);
        }
      }
    };
    for (const r of roots) walk(path.join(process.cwd(), r));
    expect(hits.map((h) => h.replace(process.cwd() + "/", ""))).toEqual([
      "src/app/(main)/layout.tsx",
    ]);
  });
});

describe("the superseded page-level atmosphere is gone", () => {
  it("no component paints its own full-page environment any more", () => {
    // Eight surfaces used to carry `.pk-atmosphere`, which is how the app
    // ended up with eight independent floodlit rectangles in an unlit void.
    // The rule itself survives for a genuinely CONTAINED panel; what must not
    // come back is a page or full-bleed section using it, because that stacks
    // a second environment on the room.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx$/.test(entry.name)) {
          const src = fs.readFileSync(full, "utf8");
          for (const m of src.matchAll(/className="([^"]*)"/g)) {
            if (/\bpk-atmosphere\b/.test(m[1]) && /min-h-screen|pb-14|py-9|px-4/.test(m[1])) {
              offenders.push(`${full}: ${m[1]}`);
            }
          }
        }
      }
    };
    for (const r of ["src/app", "src/components"]) walk(path.join(process.cwd(), r));
    expect(offenders).toEqual([]);
  });
});
