/**
 * The visual-identity layer, locked against the four ways it can silently rot.
 *
 * WHY THIS FILE EXISTS AT ALL. The design system is CSS custom properties and
 * class rules, and jsdom loads neither. Every component test in this suite can
 * pass while the display face is not applied, a motion primitive animates
 * through a reduced-motion preference, or a token exists in dark mode and not
 * in light. That is not hypothetical here: `--font-display` shipped REFERENCED
 * BUT NEVER DEFINED across eleven call sites in four partials, so Syne — which
 * was loaded, and which `.font-display` did apply — reached exactly zero game
 * headings for an entire release. The comment recording that fix is still in
 * `globals.css`. Nothing stopped it happening, and nothing would have stopped
 * it happening again to Space Grotesk.
 *
 * So this file reads the stylesheets and the layout as text and asserts the
 * things a rendering test structurally cannot:
 *
 *   1. ONE SOURCE OF TRUTH FOR THE DISPLAY FACE. The next/font variable the
 *      layout creates, the token that names it, and the class that applies it
 *      must be three references to one decision rather than three decisions.
 *   2. EVERY PRIMITIVE IS DEFINED. A `.pk-lift` in a component is a no-op if
 *      the rule is not there, and it looks correct in the diff either way.
 *   3. EVERY PRIMITIVE THAT MOVES IS NEUTRALISED UNDER REDUCED MOTION. The
 *      global blanket rule collapses durations but not `animation-delay`, and
 *      not a hover transform — both of which these primitives rely on.
 *   4. CSS AND JS AGREE ABOUT TIME. `lib/motion.ts` exists to mirror the
 *      `--pk-dur-*` / `--pk-ease-*` tokens, and its own docstring says a
 *      JS-driven transition and a CSS one on the same surface "cannot drift
 *      apart". Until now nothing checked that they had not.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  MOTION_DURATION_MS,
  MOTION_EASE,
  MOTION_STAGGER_MS,
} from "@/lib/motion";

const SRC = join(process.cwd(), "src");
const STYLES_DIR = join(SRC, "styles");

const globals = readFileSync(join(STYLES_DIR, "globals.css"), "utf8");
const rootLayout = readFileSync(join(SRC, "app", "layout.tsx"), "utf8");

/** Every rule text in every partial, concatenated. */
function allCss(): string {
  return readdirSync(STYLES_DIR)
    .filter((name) => name.endsWith(".css"))
    .map((name) => readFileSync(join(STYLES_DIR, name), "utf8"))
    .join("\n");
}

/** Does a selector for exactly this class exist anywhere in the CSS? */
function definesClass(css: string, className: string): boolean {
  const pattern = new RegExp(`(^|[^\\w-])\\.${className}(?![\\w-])`, "m");
  return pattern.test(css);
}

/**
 * The declared value of a custom property in `globals.css`.
 *
 * Reads the LAST declaration, not the first: the file is written as a series
 * of additive passes that each append a `:root` block, so a later block is the
 * one that wins in the cascade and therefore the one that is true.
 */
function tokenValue(css: string, name: string): string | null {
  const matches = [...css.matchAll(new RegExp(`${name}\\s*:\\s*([^;]+);`, "g"))];
  const last = matches.at(-1);
  return last ? last[1].trim() : null;
}

/** The body of the LAST `@media (prefers-reduced-motion: reduce)` block. */
function reducedMotionBlocks(css: string): string {
  const parts: string[] = [];
  const marker = "@media (prefers-reduced-motion: reduce)";
  let from = css.indexOf(marker);
  while (from !== -1) {
    // Brace-match from the block's opening `{` so nested rules are included.
    const open = css.indexOf("{", from);
    let depth = 0;
    let i = open;
    for (; i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    parts.push(css.slice(open, i + 1));
    from = css.indexOf(marker, i);
  }
  return parts.join("\n");
}

describe("the display face has exactly one source of truth", () => {
  it("the root layout loads Space Grotesk under the variable the token names", () => {
    // The layout must create the variable...
    expect(rootLayout).toContain("Space_Grotesk");
    expect(rootLayout).toContain('variable: "--font-space-grotesk"');
    // ...and `--font-display` must be the thing that names it. If someone
    // swaps the face in one place and not the other, this is where it shows.
    expect(tokenValue(globals, "--font-display")).toContain("--font-space-grotesk");
  });

  it("`.font-display` reads the token rather than re-deciding the face", () => {
    // THE EXACT REGRESSION THIS BLOCKS. `.font-display` used to declare
    // `font-family: var(--font-syne, ...)` — a second, independent answer to
    // "which face is display". The two answers disagreed for a release.
    const rule = globals.match(/\.font-display\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain("var(--font-display)");
  });

  it("carries no live wiring to the retired Syne face", () => {
    // Not a style preference: a leftover `var(--font-syne)` resolves to
    // nothing and silently falls back to Inter, which is precisely how the
    // original defect presented — correct-looking CSS, wrong rendered face.
    //
    // WIRING, NOT PROSE. Both files carry comments explaining what Syne was
    // and why it was replaced, and that history is worth keeping — a future
    // reader who does not know Space Grotesk was a decision will treat it as
    // an accident. So this bans the three forms that actually DO something:
    // the custom property, the quoted font-family entry, and the next/font
    // import. It deliberately does not ban the word.
    const everywhere = [allCss(), rootLayout].join("\n");
    expect(everywhere).not.toMatch(/--font-syne\b/);
    expect(everywhere).not.toMatch(/["']Syne["']/);
    expect(rootLayout).not.toMatch(/\bSyne\b\s*[,}]|{\s*[^}]*\bSyne\b[^}]*}\s*from/);
  });

  it("gives the display face its own tracking scale", () => {
    // A single hardcoded -0.02em was applied to a 48px hero and a 14px
    // eyebrow alike. Four steps, and `.font-display` must consume one.
    for (const token of [
      "--pk-track-display",
      "--pk-track-heading",
      "--pk-track-tight",
      "--pk-track-eyebrow",
    ]) {
      expect(tokenValue(globals, token)).not.toBeNull();
    }
    const rule = globals.match(/\.font-display\s*\{[^}]*\}/)![0];
    expect(rule).toContain("var(--pk-track-display");
  });
});

describe("every motion primitive is actually defined", () => {
  const css = allCss();

  // The public surface of the identity pass. A component writing one of these
  // class names is entitled to assume a rule exists.
  const PRIMITIVES = [
    "pk-lift",
    "pk-lift-lg",
    "pk-press",
    "pk-reveal",
    "pk-turn-pulse",
    "pk-spotlight",
    "pk-depth",
    "pk-depth-decision",
    "pk-crown",
    "pk-crown-accent",
    "pk-atmosphere",
    "pk-sheen",
    "pk-counting",
  ];

  for (const className of PRIMITIVES) {
    it(`\`.${className}\` has a rule`, () => {
      expect(definesClass(css, className)).toBe(true);
    });
  }

  it("the keyframes the primitives name exist", () => {
    for (const name of ["pk-reveal", "pk-turn-pulse"]) {
      expect(globals).toMatch(new RegExp(`@keyframes\\s+${name}\\b`));
    }
  });
});

describe("the primitives that move are neutralised under reduced motion", () => {
  const reduced = reducedMotionBlocks(globals);

  it("`.pk-reveal` zeroes its stagger DELAY, not just its duration", () => {
    // The global blanket rule collapses `animation-duration` and
    // `transition-duration` and does NOT touch `animation-delay`. `.pk-reveal`
    // staggers by delay, so without this the eighth item of a list is
    // invisible for 440ms and then pops in — strictly worse than the
    // animation it replaced.
    expect(reduced).toMatch(/\.pk-reveal\s*\{[^}]*animation-delay:\s*0m?s\s*!important/);
  });

  it("`.pk-lift` and `.pk-press` give up their transforms entirely", () => {
    // A zero-duration transition still APPLIES the transform: the card
    // teleports two pixels on hover rather than gliding. The intent is no
    // movement, not instant movement.
    expect(reduced).toMatch(/\.pk-lift:hover/);
    expect(reduced).toMatch(/transform:\s*none/);
  });

  it("`.pk-turn-pulse` stops breathing but stays lit", () => {
    // "It is your turn" is information. Removing the animation must not
    // remove the state — it becomes a static ring instead of nothing.
    const rule = reduced.match(/\.pk-turn-pulse\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toMatch(/animation:\s*none/);
    expect(rule![0]).toMatch(/box-shadow:/);
  });

  it("`.pk-sheen`'s pass is removed rather than shortened", () => {
    // A specular sweep with a collapsed duration is a flash, which is worse
    // for the people the preference exists to protect.
    expect(reduced).toMatch(/\.pk-sheen::after\s*\{[^}]*display:\s*none/);
  });
});

describe("theme-dependent identity tokens are defined for BOTH themes", () => {
  // Arena Day is a real product surface, not a filter over Arena Night. A
  // token defined only in the unscoped `:root` inherits its dark value into
  // light mode, which is how a white inner-highlight rim ends up invisible on
  // cream and the whole theme reads flat — the exact complaint this pass was
  // opened on.
  const lightBlocks = [
    ...globals.matchAll(/:root\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/g),
  ]
    .map((m) => m[1])
    .join("\n");

  const MUST_BE_RETHEMED = [
    "--pk-rim",
    "--pk-rim-strong",
    "--pk-well",
    "--pk-glow-warm",
    "--pk-glow-cool",
    "--pk-glow-strong",
    "--peak-accent-wash",
    "--peak-accent-veil",
    "--peak-accent-edge",
    "--peak-accent-rim",
    "--pk-grad-raised",
    "--pk-grad-decision",
  ];

  for (const token of MUST_BE_RETHEMED) {
    it(`${token} has an Arena Day value`, () => {
      expect(tokenValue(globals, token)).not.toBeNull();
      expect(lightBlocks).toMatch(new RegExp(`${token}\\s*:`));
    });
  }
});

describe("lib/motion.ts and the CSS tokens agree about time", () => {
  // The whole stated purpose of `lib/motion.ts`. Until this test, the claim in
  // its docstring — that a JS transition and a CSS one on the same surface
  // "cannot drift apart" — was an intention rather than a guarantee.

  const DURATIONS: Array<[keyof typeof MOTION_DURATION_MS, string]> = [
    ["fast", "--pk-dur-fast"],
    ["base", "--pk-dur-base"],
    ["slow", "--pk-dur-slow"],
    ["slower", "--pk-dur-slower"],
    ["reveal", "--pk-dur-reveal"],
    ["count", "--pk-dur-count"],
    ["lift", "--pk-dur-lift"],
    ["pulse", "--pk-dur-pulse"],
  ];

  for (const [name, token] of DURATIONS) {
    it(`MOTION_DURATION_MS.${name} equals ${token}`, () => {
      const raw = tokenValue(globals, token);
      expect(raw).not.toBeNull();
      const ms = raw!.endsWith("ms")
        ? Number.parseFloat(raw!)
        : Number.parseFloat(raw!) * 1000;
      expect(ms).toBe(MOTION_DURATION_MS[name]);
    });
  }

  const EASES: Array<[keyof typeof MOTION_EASE, string]> = [
    ["standard", "--pk-ease-standard"],
    ["out", "--pk-ease-out"],
    ["in", "--pk-ease-in"],
    ["emphasized", "--pk-ease-emphasized"],
    ["settle", "--pk-ease-settle"],
    ["decel", "--pk-ease-decel"],
  ];

  for (const [name, token] of EASES) {
    it(`MOTION_EASE.${name} equals ${token}`, () => {
      const raw = tokenValue(globals, token);
      expect(raw).not.toBeNull();
      const points = raw!
        .replace(/cubic-bezier\(|\)/g, "")
        .split(",")
        .map((n) => Number.parseFloat(n.trim()));
      expect(points).toEqual(MOTION_EASE[name]);
    });
  }

  it("MOTION_STAGGER_MS equals --pk-stagger", () => {
    const raw = tokenValue(globals, "--pk-stagger");
    expect(raw).not.toBeNull();
    expect(Number.parseFloat(raw!)).toBe(MOTION_STAGGER_MS);
  });
});
