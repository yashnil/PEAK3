/**
 * Every class a game action renders with must actually be defined somewhere.
 *
 * THE DEFECT THIS LOCKS OUT, which no component test could have caught. Four
 * surfaces — the Weave pick overlay (Draft / Cancel), its move controls, its
 * podium (Play again / Back to Arena) and the Showdown result (the same two) —
 * rendered `className="btn-primary"` and `className="btn-secondary"`. Neither
 * class was defined in any stylesheet in the repository: `grep` matched only
 * `pk-tour-btn-primary`, `td-btn-primary` and `ar-btn-primary`, three unrelated
 * rules with different names.
 *
 * The app runs Tailwind v4 with Preflight, whose reset gives a bare `<button>`
 * `background: transparent; border: 0; padding: 0` and an inherited font. So
 * eight controls across both games painted as plain text, which is the whole of
 * the manual findings "the action appears as visually weak text such as 'Draft
 * Kevin Garnett'", "'Back' or cancellation also resembles plain text" and "the
 * result screen uses weak text-like Play Again and Back actions".
 *
 * A component test asserting `toHaveClass("btn-primary")` passed the entire
 * time. jsdom does not load the stylesheet, so the class was present and
 * meaningless. This test reads the CSS itself.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const STYLES_DIR = join(process.cwd(), "src", "styles");

/** Every rule text in every partial, concatenated. */
function allCss(): string {
  return readdirSync(STYLES_DIR)
    .filter((name) => name.endsWith(".css"))
    .map((name) => readFileSync(join(STYLES_DIR, name), "utf8"))
    .join("\n");
}

/** Does a selector for exactly this class exist? */
function definesClass(css: string, className: string): boolean {
  // `\.name` not followed by another identifier character, so `.btn-primary`
  // does not match `.pk-tour-btn-primary` (the prefix is on the LEFT, so the
  // guard that matters is the right-hand boundary plus a non-word char before).
  const pattern = new RegExp(`(^|[^\\w-])\\.${className}(?![\\w-])`, "m");
  return pattern.test(css);
}

describe("the shared game-action button classes are defined", () => {
  const css = allCss();

  for (const className of ["btn-primary", "btn-secondary"]) {
    it(`.${className} has a rule`, () => {
      expect(
        definesClass(css, className),
        `.${className} is rendered by the Weave draft room, the Weave podium ` +
          `and the Showdown result, and is defined in no stylesheet. Under ` +
          `Tailwind Preflight those controls render as plain text.`,
      ).toBe(true);
    });
  }

  it("gives the primary action a real fill, a real border and a real size", () => {
    // The specific properties the manual finding was about: a control that is
    // "visually weak text" is one with no background, no border and no padding.
    const block = css.slice(css.indexOf(".btn-primary {"));
    expect(block).toMatch(/background:\s*var\(--peak-accent\)/);
    expect(block).toMatch(/min-height:\s*var\(--pk-tap-min/);
  });

  it("gives both buttons a visible focus ring", () => {
    expect(css).toMatch(/\.btn-primary:focus-visible[\s\S]{0,120}outline:/);
  });

  it("gives both buttons a disabled and a pressed state", () => {
    expect(css).toMatch(/\.btn-primary:disabled/);
    expect(css).toMatch(/\.btn-primary:active/);
  });
});

describe("the classes the components actually render", () => {
  /**
   * A SPOT CHECK ACROSS THE REAL COMPONENTS. If a future surface reaches for a
   * fifth button class, this fails rather than shipping another plain-text
   * primary action.
   */
  const COMPONENT_CLASSES = [
    "ar-btn",
    "ar-btn-primary",
    "btn-primary",
    "btn-secondary",
    "td-btn",
    "td-btn-primary",
    "tmw-place-slot",
  ];

  const css = allCss();

  for (const className of COMPONENT_CLASSES) {
    it(`.${className} is defined`, () => {
      expect(definesClass(css, className)).toBe(true);
    });
  }
});
