/**
 * Shared UI primitives (W7).
 *
 * These cover the behaviours that are easy to regress silently and expensive to
 * get wrong: focus containment and restoration, tooltip operability by
 * keyboard AND pointer, a count-up that must never misreport the authoritative
 * value, and dimension reservation.
 *
 * jsdom notes:
 *   - `window.matchMedia` does not exist in jsdom, so it is installed here.
 *     `usePrefersReducedMotion` is written to tolerate its absence too, which
 *     is why every other unit suite in this repo keeps working untouched.
 *   - Layout APIs (`getBoundingClientRect`, `offsetParent`) return zeros/null,
 *     so nothing here asserts on computed geometry — only on wiring.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { useRef, useState } from "react";

import {
  AnimatedNumber,
  Dialog,
  EmptyState,
  ErrorState,
  Explainer,
  LiveRegion,
  Portal,
  ScorePill,
  SectionHeader,
  Skeleton,
  StatusChip,
  ThemeToggle,
  Tooltip,
} from "@/components/ui";
import { FOCUSABLE_SELECTOR, getFocusableElements } from "@/lib/a11y";
import { THEME_STORAGE_KEY, __resetThemeStoreForTests } from "@/lib/theme";

/** Installs a `matchMedia` stub whose `(prefers-reduced-motion: reduce)` answer is `reduced`. */
function mockMatchMedia(reduced: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const impl = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reduced : false,
    media: query,
    onchange: null,
    addEventListener: (_: string, cb: (event: MediaQueryListEvent) => void) => {
      listeners.add(cb);
    },
    removeEventListener: (_: string, cb: (event: MediaQueryListEvent) => void) => {
      listeners.delete(cb);
    },
    addListener: (cb: (event: MediaQueryListEvent) => void) => listeners.add(cb),
    removeListener: (cb: (event: MediaQueryListEvent) => void) => listeners.delete(cb),
    dispatchEvent: () => false,
  }));
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: impl,
  });
  return impl;
}

beforeEach(() => {
  mockMatchMedia(false);
});

afterEach(() => {
  document.body.style.overflow = "";
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/* a11y selector                                                       */
/* ------------------------------------------------------------------ */

describe("FOCUSABLE_SELECTOR", () => {
  it("matches the selector ScoreExplainModal's own trap already used", () => {
    // Copied verbatim; if this literal ever drifts, the shared trap and the
    // pre-existing dialogs would disagree about what is reachable.
    expect(FOCUSABLE_SELECTOR).toBe(
      'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
  });

  it("excludes disabled and aria-hidden nodes", () => {
    const host = document.createElement("div");
    host.innerHTML = `
      <button id="a">a</button>
      <button id="b" disabled>b</button>
      <button id="c" aria-hidden="true">c</button>
      <a id="d" href="#x">d</a>
    `;
    document.body.appendChild(host);
    expect(getFocusableElements(host).map((el) => el.id)).toEqual(["a", "d"]);
    host.remove();
  });
});

/* ------------------------------------------------------------------ */
/* Portal                                                              */
/* ------------------------------------------------------------------ */

describe("Portal", () => {
  it("renders its children into document.body", async () => {
    render(
      <div data-testid="host">
        <Portal>
          <p data-testid="ported">ported</p>
        </Portal>
      </div>,
    );
    const ported = await screen.findByTestId("ported");
    expect(ported).toBeInTheDocument();
    // Not a descendant of the render host — it escaped to body.
    expect(screen.getByTestId("host").contains(ported)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Dialog                                                              */
/* ------------------------------------------------------------------ */

function DialogHarness({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        open dialog
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} label="Trade confirmation" data-testid="dlg">
        <button type="button" data-testid="first">
          first
        </button>
        <button type="button" data-testid="middle">
          middle
        </button>
        <button type="button" data-testid="last" onClick={() => setOpen(false)}>
          last
        </button>
      </Dialog>
    </div>
  );
}

describe("Dialog", () => {
  it("is a labelled modal dialog with a scroll lock", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    await user.click(screen.getByRole("button", { name: "open dialog" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Trade confirmation");
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("moves focus into the dialog and cycles Tab within it", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    await user.click(screen.getByRole("button", { name: "open dialog" }));

    await waitFor(() => expect(screen.getByTestId("first")).toHaveFocus());

    await user.tab();
    expect(screen.getByTestId("middle")).toHaveFocus();
    await user.tab();
    expect(screen.getByTestId("last")).toHaveFocus();

    // Forward from the last focusable wraps to the first, never to the page.
    await user.tab();
    expect(screen.getByTestId("first")).toHaveFocus();

    // And backwards from the first wraps to the last.
    await user.tab({ shift: true });
    expect(screen.getByTestId("last")).toHaveFocus();
  });

  it("restores focus to the opener when it closes", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    const opener = screen.getByRole("button", { name: "open dialog" });
    await user.click(opener);
    await waitFor(() => expect(screen.getByTestId("first")).toHaveFocus());

    await user.click(screen.getByTestId("last"));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
    expect(document.body.style.overflow).toBe("");
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    await user.click(screen.getByRole("button", { name: "open dialog" }));
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("closes on a backdrop click", async () => {
    const user = userEvent.setup();
    const { container } = render(<DialogHarness />);
    await user.click(screen.getByRole("button", { name: "open dialog" }));
    await screen.findByRole("dialog");

    const backdrop = document.querySelector("[data-pk-dialog-backdrop]");
    expect(backdrop).not.toBeNull();
    await user.click(backdrop as Element);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(container).toBeTruthy();
  });

  it("honours initialFocusRef", async () => {
    function Harness() {
      const ref = useRef<HTMLButtonElement>(null);
      return (
        <Dialog open onClose={() => {}} label="Focus target" initialFocusRef={ref}>
          <button type="button">first</button>
          <button type="button" ref={ref} data-testid="preferred">
            preferred
          </button>
        </Dialog>
      );
    }
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("preferred")).toHaveFocus());
  });

  it("places initial focus even if the animation frame beats the portal", async () => {
    /**
     * REGRESSION. Focus placement used to live inside the same
     * `requestAnimationFrame` as the entrance ramp. `Portal` returns `null`
     * until after its own first effect, so on the render where `open` flips
     * true there is no panel and no children yet -- both `initialFocusRef`
     * and the panel ref are null. The frame was racing the portal's
     * mount-commit, and when the frame won, every focus branch fell through
     * against nulls and focus stayed on `<body>`: a keyboard user opening a
     * modal and landing nowhere, with no retry, because `open` had not
     * changed and the effect never re-ran.
     *
     * jsdom won that race most of the time, so it surfaced as an intermittent
     * failure in an unrelated suite rather than as a bug report. Forcing the
     * interleaving is what makes it a test instead of a coin flip.
     */
    const spy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb) => {
        cb(performance.now());
        return 1 as unknown as number;
      });
    try {
      function Harness() {
        const [open, setOpen] = useState(false);
        const ref = useRef<HTMLButtonElement>(null);
        return (
          <>
            <button type="button" data-testid="opener" onClick={() => setOpen(true)}>
              open
            </button>
            <Dialog
              open={open}
              onClose={() => setOpen(false)}
              label="Raced"
              initialFocusRef={ref}
            >
              <button type="button" ref={ref} data-testid="raced-preferred">
                preferred
              </button>
            </Dialog>
          </>
        );
      }
      render(<Harness />);
      await userEvent.click(screen.getByTestId("opener"));
      await screen.findByRole("dialog");
      expect(screen.getByTestId("raced-preferred")).toHaveFocus();
    } finally {
      spy.mockRestore();
    }
  });

  it("places initial focus even if the animation frame never fires", async () => {
    /** A backgrounded tab never runs `requestAnimationFrame`. Focus is an
     *  accessibility guarantee and must not be contingent on one. */
    const spy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation(() => 1 as unknown as number);
    try {
      function Harness() {
        const ref = useRef<HTMLButtonElement>(null);
        return (
          <Dialog open onClose={() => {}} label="No frame" initialFocusRef={ref}>
            <button type="button" ref={ref} data-testid="no-frame-preferred">
              preferred
            </button>
          </Dialog>
        );
      }
      render(<Harness />);
      await screen.findByRole("dialog");
      await waitFor(() =>
        expect(screen.getByTestId("no-frame-preferred")).toHaveFocus(),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("only the innermost of two open dialogs handles Escape", async () => {
    const user = userEvent.setup();
    function Nested() {
      const [outer, setOuter] = useState(true);
      const [inner, setInner] = useState(true);
      return (
        <>
          <Dialog open={outer} onClose={() => setOuter(false)} label="Outer" data-testid="outer">
            <button type="button">outer body</button>
          </Dialog>
          <Dialog open={inner} onClose={() => setInner(false)} label="Inner" data-testid="inner">
            <button type="button">inner body</button>
          </Dialog>
        </>
      );
    }
    render(<Nested />);
    await screen.findByTestId("inner");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("inner")).not.toBeInTheDocument());
    // The outer dialog survived, and the page is still scroll-locked for it.
    expect(screen.getByTestId("outer")).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");
  });
});

/* ------------------------------------------------------------------ */
/* Tooltip                                                             */
/* ------------------------------------------------------------------ */

describe("Tooltip", () => {
  it("opens on keyboard focus and wires aria-describedby", async () => {
    const user = userEvent.setup();
    render(<Tooltip content="A permanent run modifier." label="What is a Front Office Perk?" />);

    const trigger = screen.getByRole("button", { name: "What is a Front Office Perk?" });
    expect(trigger).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    await user.tab();
    expect(trigger).toHaveFocus();

    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("A permanent run modifier.");
    expect(trigger).toHaveAttribute("aria-describedby", tip.id);
  });

  it("opens on pointer hover and closes when the pointer leaves", async () => {
    const user = userEvent.setup();
    render(<Tooltip content="Hover copy" label="More info" />);

    const trigger = screen.getByRole("button", { name: "More info" });
    await user.hover(trigger);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Hover copy");

    await user.unhover(trigger);
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  });

  it("toggles on tap/click, so it is never hover-only", async () => {
    const user = userEvent.setup();
    render(<Tooltip content="Tap copy" label="More info" />);
    const trigger = screen.getByRole("button", { name: "More info" });

    await user.click(trigger);
    expect(await screen.findByRole("tooltip")).toBeInTheDocument();

    await user.click(trigger);
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  });

  it("closes on Escape and drops aria-describedby", async () => {
    const user = userEvent.setup();
    render(<Tooltip content="Escape copy" label="More info" />);
    const trigger = screen.getByRole("button", { name: "More info" });

    await user.click(trigger);
    await screen.findByRole("tooltip");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
    expect(trigger).not.toHaveAttribute("aria-describedby");
  });

  it("Explainer renders an info affordance with an accessible name", async () => {
    const user = userEvent.setup();
    render(
      <Explainer
        label="What is Playoff Rate Impact?"
        term="Per-possession playoff play, not playoff games played."
      />,
    );
    const trigger = screen.getByRole("button", { name: "What is Playoff Rate Impact?" });
    await user.click(trigger);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Per-possession playoff play, not playoff games played.",
    );
  });
});

/* ------------------------------------------------------------------ */
/* AnimatedNumber                                                      */
/* ------------------------------------------------------------------ */

describe("AnimatedNumber", () => {
  it("exposes the exact final value to assistive tech immediately", () => {
    const { rerender } = render(
      <AnimatedNumber value={0} precision={1} durationMs={200} data-testid="n" />,
    );
    rerender(<AnimatedNumber value={97.5} precision={1} durationMs={200} data-testid="n" />);

    // No waiting: the accessible text is correct on the very first paint after
    // the value changes, even though the visible digits are still travelling.
    const srOnly = screen.getByTestId("n").querySelector(".sr-only");
    expect(srOnly?.textContent).toBe("97.5");
    expect(screen.getByTestId("n")).toHaveAttribute("data-value", "97.5");
  });

  it("settles on exactly the authoritative value", async () => {
    const { rerender } = render(
      <AnimatedNumber value={0} precision={2} durationMs={30} data-testid="n" />,
    );
    rerender(<AnimatedNumber value={12.34} precision={2} durationMs={30} data-testid="n" />);

    await waitFor(
      () => {
        expect(screen.getByTestId("n")).toHaveAttribute("data-settled", "true");
      },
      { timeout: 2000 },
    );

    const visual = screen
      .getByTestId("n")
      .querySelector("[data-pk-animated-number-visual]");
    expect(visual?.textContent).toBe("12.34");
  });

  it("jumps instantly under prefers-reduced-motion", () => {
    mockMatchMedia(true);
    const raf = vi.spyOn(window, "requestAnimationFrame");

    const { rerender } = render(
      <AnimatedNumber value={0} precision={1} durationMs={5000} data-testid="n" />,
    );
    act(() => {
      rerender(<AnimatedNumber value={88.8} precision={1} durationMs={5000} data-testid="n" />);
    });

    const visual = screen
      .getByTestId("n")
      .querySelector("[data-pk-animated-number-visual]");
    expect(visual?.textContent).toBe("88.8");
    expect(screen.getByTestId("n")).toHaveAttribute("data-settled", "true");
    // Nothing was ever scheduled — this is a jump, not a 1-frame tween.
    expect(raf).not.toHaveBeenCalled();
  });

  it("supports prefix, suffix and a custom formatter", () => {
    render(
      <AnimatedNumber
        value={5}
        prefix="+"
        suffix=" pts"
        format={(v) => String(Math.round(v))}
        data-testid="n"
      />,
    );
    expect(screen.getByTestId("n").querySelector(".sr-only")?.textContent).toBe("+5 pts");
  });
});

/* ------------------------------------------------------------------ */
/* Skeleton                                                            */
/* ------------------------------------------------------------------ */

describe("Skeleton", () => {
  it("reserves its dimensions so nothing shifts when content arrives", () => {
    render(<Skeleton width={220} height={44} radius={12} data-testid="sk" />);
    const el = screen.getByTestId("sk");
    expect(el.style.width).toBe("220px");
    expect(el.style.height).toBe("44px");
    expect(el.style.borderRadius).toBe("12px");
    expect(el).toHaveAttribute("aria-hidden", "true");
  });

  it("accepts string dimensions and defaults sensibly", () => {
    render(<Skeleton width="60%" data-testid="sk" />);
    const el = screen.getByTestId("sk");
    expect(el.style.width).toBe("60%");
    expect(el.style.height).toBe("12px");
    expect(el.className).toContain("pk-skeleton");
  });

  it("circle mode squares the box off the height", () => {
    render(<Skeleton circle height={36} width={999} data-testid="sk" />);
    const el = screen.getByTestId("sk");
    expect(el.style.width).toBe("36px");
    expect(el.style.height).toBe("36px");
  });
});

/* ------------------------------------------------------------------ */
/* LiveRegion                                                          */
/* ------------------------------------------------------------------ */

describe("LiveRegion", () => {
  it("defaults to a polite, atomic, visually hidden status region", () => {
    render(<LiveRegion message="Boston Celtics, 1985-86" data-testid="lr" />);
    const el = screen.getByTestId("lr");
    expect(el).toHaveAttribute("aria-live", "polite");
    expect(el).toHaveAttribute("aria-atomic", "true");
    expect(el).toHaveAttribute("role", "status");
    expect(el.className).toContain("sr-only");
    expect(el).toHaveTextContent("Boston Celtics, 1985-86");
  });

  it("assertive politeness uses role=alert", () => {
    render(<LiveRegion message="Run failed" politeness="assertive" data-testid="lr" />);
    const el = screen.getByTestId("lr");
    expect(el).toHaveAttribute("aria-live", "assertive");
    expect(el).toHaveAttribute("role", "alert");
  });

  it("politeness=off carries no implicit role", () => {
    render(<LiveRegion message="" politeness="off" data-testid="lr" />);
    const el = screen.getByTestId("lr");
    expect(el).toHaveAttribute("aria-live", "off");
    expect(el).not.toHaveAttribute("role");
  });

  it("can render visibly when asked", () => {
    render(<LiveRegion message="Saved" visible data-testid="lr" />);
    expect(screen.getByTestId("lr").className).not.toContain("sr-only");
  });
});

/* ------------------------------------------------------------------ */
/* Small presentational primitives                                     */
/* ------------------------------------------------------------------ */

describe("StatusChip / SectionHeader / ScorePill / EmptyState", () => {
  it("StatusChip is text-first and records its tone", () => {
    render(<StatusChip tone="negative" data-testid="chip">Not eligible</StatusChip>);
    const chip = screen.getByTestId("chip");
    expect(chip).toHaveTextContent("Not eligible");
    expect(chip).toHaveAttribute("data-tone", "negative");
  });

  it("SectionHeader renders the requested heading level and links by id", () => {
    render(
      <SectionHeader
        as="h3"
        id="sec-1"
        eyebrow="Front office"
        title="How your roster wins"
        description="Five official component names."
        actions={<button type="button">Filter</button>}
      />,
    );
    const heading = screen.getByRole("heading", { level: 3, name: "How your roster wins" });
    expect(heading).toHaveAttribute("id", "sec-1");
    expect(screen.getByText("Front office")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter" })).toBeInTheDocument();
  });

  it("ScorePill uses tabular numerals and the requested precision", () => {
    render(<ScorePill value={97.531} precision={2} label="Prime score" data-testid="pill" />);
    const pill = screen.getByTestId("pill");
    expect(pill.querySelector(".score-number")?.textContent).toBe("97.53");
    expect(pill).toHaveTextContent("Prime score");
  });

  it("ScorePill can animate, and still ends on the value", async () => {
    render(<ScorePill value={42} precision={0} animate data-testid="pill" />);
    await waitFor(() =>
      expect(screen.getByTestId("pill").querySelector(".score-number")).toHaveAttribute(
        "data-value",
        "42",
      ),
    );
  });

  it("EmptyState renders a title, a reason and a next step", () => {
    render(
      <EmptyState
        title="No saved runs yet"
        description="Finish a run and it will appear here."
        action={<button type="button">Start a run</button>}
        data-testid="empty"
      />,
    );
    expect(screen.getByTestId("empty")).toHaveTextContent("No saved runs yet");
    expect(screen.getByTestId("empty")).toHaveTextContent(
      "Finish a run and it will appear here.",
    );
    expect(screen.getByRole("button", { name: "Start a run" })).toBeInTheDocument();
  });

  it("ErrorState renders the server's own message and an alert role", () => {
    render(<ErrorState message="Could not reach the PEAK3 API." data-testid="err" />);
    const box = screen.getByTestId("err");
    expect(box).toHaveAttribute("role", "alert");
    expect(box).toHaveTextContent("Could not reach the PEAK3 API.");
  });

  it("ErrorState falls back to a neutral sentence with no message given", () => {
    render(<ErrorState data-testid="err" />);
    expect(screen.getByTestId("err")).toHaveTextContent(/something went wrong/i);
  });

  it("ErrorState's retry button calls onRetry and meets the tap-target floor", () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Failed." onRetry={onRetry} retryLabel="Retry" />);
    const button = screen.getByRole("button", { name: "Retry" });
    expect(button).toHaveStyle({ minHeight: "var(--pk-tap-min, 44px)" });
    button.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("ErrorState renders no button at all when there is nothing to retry", () => {
    render(<ErrorState message="Failed." data-testid="err" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/* ThemeToggle                                                         */
/* ------------------------------------------------------------------ */

describe("ThemeToggle", () => {
  beforeEach(() => {
    window.localStorage.removeItem(THEME_STORAGE_KEY);
    __resetThemeStoreForTests();
  });

  it("icon variant flips the document theme on EVERY click, in both directions", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const button = screen.getByTestId("theme-toggle");
    // ONE CLICK, BOTH DIRECTIONS. The toggle used to cycle through "System",
    // which on a light-mode OS resolves straight back to light -- so Light ->
    // Dark cost two clicks while Dark -> Light cost one. It now always names
    // the appearance you are not in, so the accessible name alternates between
    // exactly two sentences and `data-theme` changes on every single click.
    expect(button).toHaveAccessibleName(/Arena Night\.\s*Switch to Arena Day/);
    await user.click(button);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(button).toHaveAccessibleName(/Arena Day\.\s*Switch to Arena Night/);
    await user.click(button);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(button).toHaveAccessibleName(/Arena Night\.\s*Switch to Arena Day/);
    await user.click(button);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("icon variant reports the current appearance through aria-pressed", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const button = screen.getByTestId("theme-toggle");
    expect(button).toHaveAttribute("aria-pressed", "false");
    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("icon variant flips on Enter and on Space, not only on pointer", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const button = screen.getByTestId("theme-toggle");
    button.focus();
    await user.keyboard("{Enter}");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    await user.keyboard(" ");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("icon variant meets the 44px tap-target floor", () => {
    render(<ThemeToggle />);
    expect(screen.getByTestId("theme-toggle")).toHaveStyle({
      width: "var(--pk-tap-min, 44px)",
      height: "var(--pk-tap-min, 44px)",
    });
  });

  it("menu variant offers three explicit, independently selectable options", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle variant="menu" />);
    const system = screen.getByTestId("theme-option-system");
    const dark = screen.getByTestId("theme-option-dark");
    const light = screen.getByTestId("theme-option-light");
    // Dark is the default with nothing stored (launch-polish
    // IMPLEMENTATION_CONTRACT.md §2), not System.
    expect(dark).toHaveAttribute("aria-pressed", "true");
    expect(system).toHaveAttribute("aria-pressed", "false");

    await user.click(light);
    expect(light).toHaveAttribute("aria-pressed", "true");
    expect(dark).toHaveAttribute("aria-pressed", "false");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("an explicitly chosen System preference is pressed and distinguishable from the default", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle variant="menu" />);
    const system = screen.getByTestId("theme-option-system");
    const dark = screen.getByTestId("theme-option-dark");
    await user.click(system);
    expect(system).toHaveAttribute("aria-pressed", "true");
    expect(dark).toHaveAttribute("aria-pressed", "false");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
  });

  it("persists the choice so a second mount reads it back", async () => {
    // Chooses "light", not "dark" -- dark is now also the no-preference
    // default, so persisting dark would pass even if persistence were
    // broken (a fresh mount defaults there anyway). Light actually proves
    // the round trip.
    const user = userEvent.setup();
    const { unmount } = render(<ThemeToggle variant="menu" />);
    await user.click(screen.getByTestId("theme-option-light"));
    unmount();

    render(<ThemeToggle variant="menu" />);
    expect(screen.getByTestId("theme-option-light")).toHaveAttribute("aria-pressed", "true");
  });
});
