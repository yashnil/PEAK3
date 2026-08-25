/**
 * PEAK3 V2 · Broadcast Arena — Pass 2.5 foundation corrections
 * (product-direction), verified against the real Claude Design reference
 * (`.claude-private/design/PEAK3-Directions-E.pdf`).
 *
 * One block per correction: (1) dot-on-a-line `PeakV2DataLane`, (2) inline
 * display emphasis, (3) arena-light extensions (sequenced target, dimmed
 * sibling, paired ambient wash), (4) the wide-LIVE width variant, (5) the
 * docked interaction panel, (6) the cinematic-numeral role.
 *
 * jsdom notes: `window.matchMedia` is stubbed the same way
 * `v2-primitives.test.tsx` already does, for `usePrefersReducedMotion`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PeakV2DataLane from "@/components/v2/PeakV2DataLane";
import PeakV2DisplayEmphasis from "@/components/v2/PeakV2DisplayEmphasis";
import PeakV2ResultHeadline from "@/components/v2/PeakV2ResultHeadline";
import PeakV2ArenaLight from "@/components/v2/PeakV2ArenaLight";
import PeakV2CourtPanel from "@/components/v2/PeakV2CourtPanel";
import PeakV2Shell from "@/components/v2/PeakV2Shell";
import PeakV2Score from "@/components/v2/PeakV2Score";
import PeakV2DockedPanel from "@/components/v2/PeakV2DockedPanel";
import PeakV2Modal from "@/components/v2/PeakV2Modal";

function mockMatchMedia(reduced: boolean) {
  const impl = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reduced : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
  Object.defineProperty(window, "matchMedia", { writable: true, configurable: true, value: impl });
}

beforeEach(() => {
  mockMatchMedia(false);
});

describe("Correction 1: PeakV2DataLane dot-on-a-line", () => {
  it("defaults to the line variant, not paired", () => {
    const { container } = render(
      <PeakV2DataLane label="Statistical Impact" tone="si" leftLabel="You" leftValue={40} rightLabel="Boss" rightValue={20} />,
    );
    // The line variant renders a rule element; the paired variant never does.
    expect(container.querySelector('[aria-hidden="true"].relative.h-4')).toBeInTheDocument();
  });

  it("positions the filled (primary) dot proportional to its value on the shared scale", () => {
    const { container } = render(
      <PeakV2DataLane label="Statistical Impact" tone="si" leftLabel="You" leftValue={50} rightLabel="Boss" rightValue={0} scaleMin={0} scaleMax={100} />,
    );
    const desktop = container.querySelector(".hidden.sm\\:grid") as HTMLElement;
    // The filled dot is always rendered last within the rule (hollow first,
    // when present, then filled) — see LineRule's own render order.
    const filledDot = desktop.querySelector(".relative.h-4 span:last-child") as HTMLElement;
    expect(filledDot.style.left).toBe("50%");
  });

  it("clamps a dot short of the true 0%/100% edges so it never renders half-clipped", () => {
    const { container } = render(
      <PeakV2DataLane label="Team Result" tone="team" leftLabel="You" leftValue={100} scaleMin={0} scaleMax={100} />,
    );
    const desktop = container.querySelector(".hidden.sm\\:grid") as HTMLElement;
    const filledDot = desktop.querySelector(".relative.h-4 span:last-child") as HTMLElement;
    expect(filledDot.style.left).toBe("96%");
  });

  it("single-value mode (no rightValue) renders only the filled dot, no hollow dot, no right column", () => {
    const { container } = render(
      <PeakV2DataLane label="Lineup rating" tone="accent" leftLabel="You" leftValue={68} />,
    );
    const desktop = container.querySelector(".hidden.sm\\:grid") as HTMLElement;
    // Hollow dot has a visible border + page-colored fill; filled has none of that.
    expect(desktop.querySelector('span[style*="border: 1.5px"]')).not.toBeInTheDocument();
  });

  it("the filled dot marks the PRIMARY side by role, not by who is winning", () => {
    // Boss (right) has the higher value here — the filled dot must still be
    // on the left (you), matching the reference's fixed fill-by-role rule.
    const { container } = render(
      <PeakV2DataLane label="Traditional Production" tone="tp" leftLabel="You" leftValue={41.5} rightLabel="Boss" rightValue={45.9} />,
    );
    const desktop = container.querySelector(".hidden.sm\\:grid") as HTMLElement;
    const filled = desktop.querySelector('span[style*="background: var(--v2-color-comp-tp)"]');
    expect(filled).toBeInTheDocument();
  });

  it("the paired variant is kept, unchanged, as an explicit alternate", () => {
    render(
      <PeakV2DataLane
        variant="paired"
        label="Team Result"
        tone="team"
        leftLabel="You"
        leftValue="4.1"
        rightLabel="Boss"
        rightValue="6.7"
        winner="right"
      />,
    );
    expect(screen.getByText("6.7")).toHaveStyle({ color: "var(--v2-color-comp-team)" });
    expect(screen.getByText("4.1")).toHaveStyle({ color: "var(--v2-text-primary)" });
  });

  it("renders both a mobile (values-above-line) and a desktop (values-flank-line) structure", () => {
    const { container } = render(
      <PeakV2DataLane label="Statistical Impact" tone="si" leftLabel="You" leftValue={40} rightLabel="Boss" rightValue={20} />,
    );
    expect(container.querySelector(".flex.flex-col.gap-1\\.5.sm\\:hidden")).toBeInTheDocument();
    expect(container.querySelector(".hidden.sm\\:grid")).toBeInTheDocument();
  });

  // Peak Duel mission fix: the filled dot must follow `pickedSide` (the
  // side the PLAYER actually clicked), never a fixed side and never the
  // winner. These three cover both directions plus the pre-choice neutral
  // state, independent of which side holds the higher value.
  describe("pickedSide — the filled dot follows the caller's designated side, not a fixed one", () => {
    it('pickedSide="right" fills the right dot and leaves left hollow, even though left has the higher value', () => {
      const { container } = render(
        <PeakV2DataLane
          label="Statistical Impact"
          tone="si"
          leftLabel="Left"
          leftValue={90}
          rightLabel="Right"
          rightValue={10}
          pickedSide="right"
        />,
      );
      const desktop = container.querySelector(".hidden.sm\\:grid") as HTMLElement;
      const filled = desktop.querySelector('span[style*="background: var(--v2-color-comp-si)"]') as HTMLElement;
      expect(filled).toBeInTheDocument();
      // The filled dot sits at the RIGHT value's position (10%), not left's.
      expect(filled.style.left).toBe("10%");
      // Exactly one hollow dot remains, at the left value's position.
      const hollow = desktop.querySelector('span[style*="border: 1.5px"]') as HTMLElement;
      expect(hollow).toBeInTheDocument();
      expect(hollow.style.left).toBe("90%");
    });

    it('pickedSide="none" renders both dots hollow — the neutral pre-choice/no-pick treatment', () => {
      const { container } = render(
        <PeakV2DataLane
          label="Statistical Impact"
          tone="si"
          leftLabel="Left"
          leftValue={90}
          rightLabel="Right"
          rightValue={10}
          pickedSide="none"
        />,
      );
      const desktop = container.querySelector(".hidden.sm\\:grid") as HTMLElement;
      expect(desktop.querySelector('span[style*="background: var(--v2-color-comp-si)"]')).not.toBeInTheDocument();
      expect(desktop.querySelectorAll('span[style*="border: 1.5px"]')).toHaveLength(2);
    });

    it("omitting pickedSide keeps every pre-existing caller (RTT, Showdown, homepage) filling left, unaffected", () => {
      const { container } = render(
        <PeakV2DataLane label="Statistical Impact" tone="si" leftLabel="You" leftValue={40} rightLabel="Boss" rightValue={20} />,
      );
      const desktop = container.querySelector(".hidden.sm\\:grid") as HTMLElement;
      const filled = desktop.querySelector('span[style*="background: var(--v2-color-comp-si)"]') as HTMLElement;
      expect(filled.style.left).toBe("40%");
    });
  });
});

describe("Correction 2: PeakV2DisplayEmphasis — inline, composable", () => {
  it("composes inline within a single heading — one accessible name, not two elements", () => {
    render(
      <PeakV2ResultHeadline as="h1" scale="line">
        Five lanes. <PeakV2DisplayEmphasis>One point each.</PeakV2DisplayEmphasis>
      </PeakV2ResultHeadline>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Five lanes. One point each." })).toBeInTheDocument();
  });

  it("is italic and gold by default", () => {
    render(<PeakV2DisplayEmphasis>One point each.</PeakV2DisplayEmphasis>);
    const span = screen.getByText("One point each.");
    expect(span.style.fontStyle).toBe("italic");
    expect(span.style.color).toBe("var(--v2-color-accent)");
  });

  it("tone=\"inherit\" stays italic but does not force gold — for a non-accent emphasis word", () => {
    render(<PeakV2DisplayEmphasis tone="inherit">The Wall</PeakV2DisplayEmphasis>);
    const span = screen.getByText("The Wall");
    expect(span.style.fontStyle).toBe("italic");
    expect(span.style.color).toBe("inherit");
  });

  it("is a plain span, not <em> — no implied semantic stress emphasis", () => {
    render(<PeakV2DisplayEmphasis>One point each.</PeakV2DisplayEmphasis>);
    expect(screen.getByText("One point each.").tagName).toBe("SPAN");
  });

  it("is composable with arbitrary real copy, not a fixed set of hardcoded strings", () => {
    render(
      <PeakV2ResultHeadline as="h2" scale="moment">
        Sample Franchise <PeakV2DisplayEmphasis tone="inherit">Sample Decade</PeakV2DisplayEmphasis>
      </PeakV2ResultHeadline>,
    );
    expect(screen.getByRole("heading", { name: "Sample Franchise Sample Decade" })).toBeInTheDocument();
  });
});

describe("Correction 3A: PeakV2ArenaLight — sequenced target", () => {
  it("animates a background transition when animatePosition is set and motion is not reduced", () => {
    mockMatchMedia(false);
    const { container } = render(<PeakV2ArenaLight x="20%" animatePosition />);
    const light = container.querySelector(".v2-arena-light") as HTMLElement;
    expect(light.style.transition).toContain("background");
  });

  it("never animates the position under prefers-reduced-motion, even when animatePosition is set", () => {
    mockMatchMedia(true);
    const { container } = render(<PeakV2ArenaLight x="20%" animatePosition />);
    const light = container.querySelector(".v2-arena-light") as HTMLElement;
    expect(light.style.transition).toBe("none");
  });

  it("does not animate by default (animatePosition=false) — most single-target uses want no slide-in", () => {
    mockMatchMedia(false);
    const { container } = render(<PeakV2ArenaLight x="20%" />);
    const light = container.querySelector(".v2-arena-light") as HTMLElement;
    expect(light.style.transition).toBe("none");
  });

  it("holds no reveal/sequence state itself — moving the target is purely a re-render with new x/y", () => {
    mockMatchMedia(false);
    const { container, rerender } = render(<PeakV2ArenaLight x="20%" animatePosition />);
    const before = (container.querySelector(".v2-arena-light") as HTMLElement).style.background;
    rerender(<PeakV2ArenaLight x="80%" animatePosition />);
    const after = (container.querySelector(".v2-arena-light") as HTMLElement).style.background;
    expect(after).not.toBe(before);
  });
});

describe("Correction 3C: PeakV2ArenaLight — paired ambient wash", () => {
  it("pair=\"cool\" is a neutral tone, never a real component color", () => {
    const { container } = render(<PeakV2ArenaLight pair="cool" />);
    const light = container.querySelector(".v2-arena-light") as HTMLElement;
    expect(light.style.background).toContain("--v2-light-neutral");
    expect(light.style.background).not.toContain("--v2-color-comp-si");
  });

  it("pair=\"warm\" reuses the gold accent, not a new hue", () => {
    const { container } = render(<PeakV2ArenaLight pair="warm" />);
    const light = container.querySelector(".v2-arena-light") as HTMLElement;
    expect(light.style.background).toContain("--v2-color-accent");
  });

  it("a paired wash renders at the lower paired opacity token, not the normal single-light opacity", () => {
    const { container } = render(<PeakV2ArenaLight pair="cool" />);
    const light = container.querySelector(".v2-arena-light") as HTMLElement;
    expect(light.style.background).toContain("--v2-light-opacity-paired");
    expect(light.style.background).not.toContain("calc(var(--v2-light-opacity) *");
  });

  it("cool sits left, warm sits right — opposing sides, per the reference", () => {
    const cool = render(<PeakV2ArenaLight pair="cool" />);
    const warm = render(<PeakV2ArenaLight pair="warm" />);
    const coolLight = cool.container.querySelector(".v2-arena-light") as HTMLElement;
    const warmLight = warm.container.querySelector(".v2-arena-light") as HTMLElement;
    expect(coolLight.style.background).toContain("18%");
    expect(warmLight.style.background).toContain("82%");
  });
});

describe("Correction 3B: PeakV2CourtPanel — dimmed sibling", () => {
  it("dimmed is distinctly marked and never removes or blurs the content", () => {
    render(
      <PeakV2CourtPanel label="Rim Runner" presentation="dimmed">
        <button type="button">Sample Player F</button>
      </PeakV2CourtPanel>,
    );
    const panel = screen.getByTestId("peak-v2-court-panel");
    // jsdom's CSSOM rejects `opacity: var(...)` on the numeric `opacity`
    // property (a known jsdom/cssstyle limitation — real browsers apply it
    // correctly), so the dimmed signal asserted here is the data attribute,
    // not the computed opacity value; `tokens.css`'s own
    // `--v2-court-dim-opacity: 0.62` is the source of truth for the number.
    expect(panel).toHaveAttribute("data-v2-court-presentation", "dimmed");
    expect(panel.style.filter).toBe("");
    expect(screen.getByRole("button", { name: "Sample Player F" })).toBeInTheDocument();
  });

  it("dimming never disables interaction", () => {
    render(
      <PeakV2CourtPanel label="Rim Runner" presentation="dimmed">
        <button type="button">Sample Player F</button>
      </PeakV2CourtPanel>,
    );
    expect(screen.getByRole("button", { name: "Sample Player F" })).not.toBeDisabled();
  });

  it("lit renders its own arena light; dimmed does not", () => {
    const lit = render(
      <PeakV2CourtPanel label="You" presentation="lit">
        <span>content</span>
      </PeakV2CourtPanel>,
    );
    expect(lit.container.querySelector(".v2-arena-light")).toBeInTheDocument();

    const dimmed = render(
      <PeakV2CourtPanel label="Rim Runner" presentation="dimmed">
        <span>content</span>
      </PeakV2CourtPanel>,
    );
    expect(dimmed.container.querySelector(".v2-arena-light")).not.toBeInTheDocument();
  });

  it("defaults to lit, at full opacity", () => {
    render(
      <PeakV2CourtPanel label="You">
        <span>content</span>
      </PeakV2CourtPanel>,
    );
    expect(screen.getByTestId("peak-v2-court-panel").style.opacity).toBe("1");
  });
});

describe("Correction 4: PeakV2Shell live-wide width", () => {
  it("live-wide resolves to the dedicated wider token, distinct from live", () => {
    const live = render(
      <PeakV2Shell width="live">
        <div>content</div>
      </PeakV2Shell>,
    );
    const liveWide = render(
      <PeakV2Shell width="live-wide">
        <div>content</div>
      </PeakV2Shell>,
    );
    const liveInner = live.container.querySelector(".mx-auto") as HTMLElement;
    const wideInner = liveWide.container.querySelector(".mx-auto") as HTMLElement;
    expect(liveInner.style.maxWidth).toBe("var(--v2-width-live)");
    expect(wideInner.style.maxWidth).toBe("var(--v2-width-live-wide)");
    expect(wideInner.style.maxWidth).not.toBe(liveInner.style.maxWidth);
  });
});

describe("Correction 5: PeakV2DockedPanel", () => {
  it("docks to the bottom (align=bottom on the shared Dialog), not centered", () => {
    render(
      <PeakV2DockedPanel open onClose={() => {}} label="Sample docked panel">
        <p>content</p>
      </PeakV2DockedPanel>,
    );
    const root = document.querySelector("[data-pk-dialog-root]") as HTMLElement;
    expect(root.className).toContain("items-end");
    expect(root.className).not.toContain("items-center");
  });

  it("uses a LIGHT scrim by default, nowhere near Dialog's own heavy backdrop", () => {
    render(
      <PeakV2DockedPanel open onClose={() => {}} label="Sample docked panel">
        <p>content</p>
      </PeakV2DockedPanel>,
    );
    const backdrop = document.querySelector("[data-pk-dialog-backdrop]") as HTMLElement;
    // 0.32 — enough contrast for the panel to read as present (a real
    // screenshot caught 0 looking indistinguishable from page content, see
    // the component's own docstring), still far short of "heavy."
    expect(backdrop.style.background).toBe("rgba(6, 7, 9, 0.32)");
  });

  it("is explicitly overridable to fully transparent for a screen that wants zero scrim", () => {
    render(
      <PeakV2DockedPanel open onClose={() => {}} label="Sample docked panel" backdropOpacity={0}>
        <p>content</p>
      </PeakV2DockedPanel>,
    );
    const backdrop = document.querySelector("[data-pk-dialog-backdrop]") as HTMLElement;
    expect(backdrop.style.background).toBe("rgba(6, 7, 9, 0)");
  });

  it("reserves a FIXED height (not a cap) so background stays visible above it and the sheet never resizes with content", () => {
    // Pass 7 (human acceptance testing): this used to be `maxHeight`, which
    // let the panel intrinsically size to whatever content happened to be
    // mounted -- visibly resizing/repositioning as the candidate section
    // appeared or search narrowed the list. `height` (bounded by the
    // viewport via `min()`) is a real reserved footprint instead.
    render(
      <PeakV2DockedPanel open onClose={() => {}} label="Sample docked panel" maxHeightVh={70}>
        <p>content</p>
      </PeakV2DockedPanel>,
    );
    const dialog = screen.getByRole("dialog");
    // jsdom's CSSOM serializes `min()` with its own internal spacing --
    // assert on the values present rather than a brittle exact string.
    // (`maxHeight` is left at `Dialog`'s own default viewport bound — a
    // harmless redundant constraint underneath the real fixed `height`.)
    expect(dialog.style.height).toContain("70vh");
    expect(dialog.style.height).toContain("calc(100dvh - 32px)");
  });

  it("background content OUTSIDE the panel is never hidden or made inert", () => {
    render(
      <div>
        <button type="button">Background court action</button>
        <PeakV2DockedPanel open onClose={() => {}} label="Sample docked panel">
          <p>content</p>
        </PeakV2DockedPanel>
      </div>,
    );
    const bg = screen.getByRole("button", { name: "Background court action" });
    expect(bg).toBeVisible();
    expect(bg).not.toBeDisabled();
  });

  it("closes on Escape, reusing Dialog's real handling — not a second implementation", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <PeakV2DockedPanel open onClose={onClose} label="Sample docked panel">
        <p>content</p>
      </PeakV2DockedPanel>,
    );
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a real PeakV2Modal (centered) still blocks the background, unlike the docked panel", () => {
    render(
      <PeakV2Modal open onClose={() => {}} label="Sample modal">
        <p>content</p>
      </PeakV2Modal>,
    );
    const root = document.querySelector("[data-pk-dialog-root]") as HTMLElement;
    expect(root.className).toContain("items-center");
    const backdrop = document.querySelector("[data-pk-dialog-backdrop]") as HTMLElement;
    expect(backdrop.style.background).not.toBe("rgba(6, 7, 9, 0)");
  });
});

describe("Correction 6: PeakV2Score cinematic numeral role", () => {
  it("defaults to the instrument (mono) role, unchanged from Pass 2", () => {
    render(<PeakV2Score value="18.4" />);
    expect(screen.getByText("18.4")).toHaveStyle({ fontFamily: "var(--v2-font-mono)" });
  });

  it("role=\"moment\" switches to the display (serif) role", () => {
    render(<PeakV2Score value="7 / 10" role="moment" />);
    expect(screen.getByText("7 / 10")).toHaveStyle({ fontFamily: "var(--v2-font-display)" });
  });

  it("moment role drops tabular-nums — a display serif line, not a scoreboard", () => {
    render(<PeakV2Score value="61-21" role="moment" />);
    const el = screen.getByText("61-21");
    expect(el.style.fontVariantNumeric).toBe("");
  });

  it("a routine instrumentation value (credits, bid, lane rating) never opts into moment by accident — the role must be stated explicitly", () => {
    render(<PeakV2Score value="$7" label="Current bid" />);
    expect(screen.getByText("$7")).toHaveStyle({ fontFamily: "var(--v2-font-mono)" });
  });
});
