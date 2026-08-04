/**
 * Locks in the fix for the launch-polish e2e failure on
 * "accessibility: Draft screen (initial offer)": `--accent-violet-text`'s
 * DARK value (`#a78bfa`, identical to the frozen-in-spirit `--accent-violet`)
 * measured 4.42-4.43:1 against DraftCard.tsx's own role-chip wash
 * (`color-mix(in srgb, var(--accent-violet) 20%, transparent)` over
 * `--bg-surface`) -- just under the 4.5:1 AA floor for normal text, caught
 * by the committed axe suite, not by eye.
 *
 * The root cause: the `--accent-*-text` siblings were introduced (P6-b) to
 * fix this exact class of bug in LIGHT mode, and their DARK values were
 * assumed fine "because the raw --accent-* already clears 4.5:1+ on a plain
 * card" -- a claim that was true against a plain card and never re-checked
 * against the wash. Light mode's siblings WERE measured against the wash
 * (see globals.css's own comment); dark mode's were not. Violet's dark hue
 * happens to be close enough to its own washed composite that it fails;
 * the other four (blue/pink/orange/emerald) do not, by margin, in every
 * combination this test checks -- but they are covered here too so no
 * config drift can silently reintroduce the same bug on a different hue
 * the way it reappeared on violet.
 *
 * Reads the actual token values out of globals.css (rather than hardcoding
 * a second copy that could drift from the source of truth) and computes
 * the SAME wash-compositing math DraftCard.tsx's role chip performs:
 * `color-mix(in srgb, accent P%, transparent)` over each of the two card
 * backgrounds the component can render on, for every wash percentage
 * actually used anywhere in the codebase for an `--accent-*` hue
 * (10/12/15/20%) -- not just the 20% DraftCard happens to use, since any of
 * these values could end up reused at a different alpha later.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS_PATH = path.resolve(__dirname, "../../styles/globals.css");
const css = readFileSync(CSS_PATH, "utf8");

/** Splits globals.css into the unscoped `:root { ... }` (dark) block(s) and
 *  the `:root[data-theme="light"] { ... }` block, then pulls one
 *  `--token: #hex;` declaration's value out of whichever block is asked
 *  for. Dark falls back to the FIRST declaration found anywhere before the
 *  light block starts (there are several unscoped `:root` blocks in this
 *  file); light only looks inside the light-scoped block. */
function extractToken(name: string, theme: "dark" | "light"): string {
  const lightBlockStart = css.indexOf(':root[data-theme="light"]');
  const scope = theme === "light" ? css.slice(lightBlockStart) : css.slice(0, lightBlockStart);
  const re = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`);
  const match = scope.match(re);
  if (!match) {
    throw new Error(`Could not find --${name} in the ${theme} scope of globals.css`);
  }
  return match[1];
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** `color-mix(in srgb, fg P%, transparent)` composited over an opaque `bg`,
 *  matching how DraftCard.tsx's role chip is actually built. */
function compositeWash(fgHex: string, alpha: number, bgHex: string): [number, number, number] {
  const fg = hexToRgb(fgHex);
  const bg = hexToRgb(bgHex);
  return [0, 1, 2].map((i) => Math.round(fg[i] * alpha + bg[i] * (1 - alpha))) as [number, number, number];
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

const HUES = ["blue", "violet", "pink", "orange", "emerald"] as const;
// Every wash percentage actually used with an --accent-* hue anywhere in
// the codebase (DraftCard.tsx's role chip is 20%; other call sites use
// 7/10/12/15% for one-off status washes) -- checking the full set, not
// just DraftCard's own 20%, so a value reused at a different alpha later
// is already covered.
const ALPHAS = [0.07, 0.1, 0.12, 0.15, 0.2];
const AA_NORMAL_TEXT = 4.5;

describe("--accent-*-text tokens against their own colour-mix wash", () => {
  for (const theme of ["dark", "light"] as const) {
    describe(`${theme === "dark" ? "Arena Night" : "Arena Day"}`, () => {
      for (const hue of HUES) {
        it(`--accent-${hue}-text clears ${AA_NORMAL_TEXT}:1 against every wash % over --bg-surface and --bg-elevated`, () => {
          const accent = extractToken(`accent-${hue}`, theme);
          const text = extractToken(`accent-${hue}-text`, theme);
          const bgSurface = extractToken("bg-surface", theme);
          const bgElevated = extractToken("bg-elevated", theme);
          const textRgb = hexToRgb(text);

          const failures: string[] = [];
          for (const bgName of ["bg-surface", "bg-elevated"] as const) {
            const bg = bgName === "bg-surface" ? bgSurface : bgElevated;
            for (const alpha of ALPHAS) {
              const wash = compositeWash(accent, alpha, bg);
              const ratio = contrastRatio(textRgb, wash);
              if (ratio < AA_NORMAL_TEXT) {
                failures.push(`${Math.round(alpha * 100)}% over ${bgName}: ${ratio.toFixed(2)}:1`);
              }
            }
          }
          expect(failures, `--accent-${hue}-text (${text}) failed against its own wash: ${failures.join(", ")}`).toEqual([]);
        });
      }
    });
  }

  it("regression: the specific case axe caught (violet, 20% wash, dark, --bg-surface)", () => {
    const accent = extractToken("accent-violet", "dark");
    const text = extractToken("accent-violet-text", "dark");
    const bgSurface = extractToken("bg-surface", "dark");
    const wash = compositeWash(accent, 0.2, bgSurface);
    const ratio = contrastRatio(hexToRgb(text), wash);
    // axe measured 4.42:1 on the un-fixed token; this asserts the fixed
    // token clears AA with real margin, not just barely over the line.
    expect(ratio).toBeGreaterThanOrEqual(5.0);
  });
});
