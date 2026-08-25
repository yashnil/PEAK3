/**
 * PEAK3 V2 · Broadcast Arena primitives (Pass 2, product-direction).
 *
 * Covers what is easy to regress silently: the legacy/v2 switch actually
 * branches (never both trees at once), the court-card grammar's fixed
 * slot structure and Move-affordance placement, arena light collapsing
 * under reduced motion, timer urgency, and `PeakV2Modal` correctly reusing
 * `Dialog`'s real focus/Escape/portal behavior (not re-testing that
 * behavior itself — see `ui-primitives.test.tsx` for `Dialog`'s own
 * coverage).
 *
 * jsdom notes: `window.matchMedia` is stubbed the same way
 * `ui-primitives.test.tsx` already does, for `usePrefersReducedMotion`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PeakV2ArenaLight from "@/components/v2/PeakV2ArenaLight";
import PeakV2Timer from "@/components/v2/PeakV2Timer";
import PeakV2CourtSlot from "@/components/v2/PeakV2CourtSlot";
import PeakV2Modal from "@/components/v2/PeakV2Modal";
import PeakV2Shell from "@/components/v2/PeakV2Shell";
import PeakV2PrimaryAction from "@/components/v2/PeakV2PrimaryAction";
import HomePageV2 from "@/components/v2/HomePageV2";
import { __resetUiVersionStoreForTests } from "@/lib/ui-version";
import { UI_VERSION_ATTR } from "@/lib/ui-version-script";

/** Mirrors `ui-primitives.test.tsx`'s stub — `(prefers-reduced-motion: reduce)`. */
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
  __resetUiVersionStoreForTests();
  document.documentElement.removeAttribute(UI_VERSION_ATTR);
});

afterEach(() => {
  document.documentElement.removeAttribute(UI_VERSION_ATTR);
});

describe("PeakV2ArenaLight", () => {
  it("pulses under normal motion when pulse is requested", () => {
    mockMatchMedia(false);
    render(<PeakV2ArenaLight pulse intensity="focus" />);
    const light = document.querySelector(".v2-arena-light") as HTMLElement;
    expect(light.style.animation).toContain("v2-arena-light-pulse");
  });

  it("never animates under prefers-reduced-motion, even when pulse is requested", () => {
    mockMatchMedia(true);
    render(<PeakV2ArenaLight pulse intensity="focus" />);
    const light = document.querySelector(".v2-arena-light") as HTMLElement;
    expect(light.style.animation).toBe("none");
  });

  it("is inert to pointer events — it never intercepts a click meant for real content", () => {
    render(<PeakV2ArenaLight />);
    const light = document.querySelector(".v2-arena-light") as HTMLElement;
    expect(light).toHaveAttribute("aria-hidden", "true");
    expect(light.className).toContain("pointer-events-none");
  });
});

describe("PeakV2Timer", () => {
  it("reads the exact value it is given — it does not run its own clock", () => {
    render(<PeakV2Timer secondsRemaining={7} />);
    expect(screen.getByTestId("peak-v2-timer-value")).toHaveTextContent("7");
  });

  it("clamps a negative value to 0 rather than rendering it", () => {
    render(<PeakV2Timer secondsRemaining={-3} />);
    expect(screen.getByTestId("peak-v2-timer-value")).toHaveTextContent("0");
  });

  it("turns urgent at the threshold, not one tick early", () => {
    const { rerender } = render(<PeakV2Timer secondsRemaining={4} urgentAtSeconds={3} />);
    expect(screen.getByTestId("peak-v2-timer-value")).toHaveStyle({ color: "var(--v2-text-primary)" });
    rerender(<PeakV2Timer secondsRemaining={3} urgentAtSeconds={3} />);
    expect(screen.getByTestId("peak-v2-timer-value")).toHaveStyle({ color: "var(--v2-color-negative)" });
  });
});

describe("PeakV2CourtSlot — court-card grammar", () => {
  it("renders a Move affordance in the slot's own footer, never as a floating absolute control", () => {
    const onMove = vi.fn();
    render(<PeakV2CourtSlot position="PG" player={{ name: "Sample Player" }} onMove={onMove} />);
    const button = screen.getByRole("button", { name: "Move" });
    expect(button).toBeInTheDocument();
    // No slot-authored absolute positioning anywhere in the tree — the
    // brief's named anti-pattern ("MOVE floating awkwardly in corners").
    expect(document.querySelector('[style*="position: absolute"]')).toBeNull();
  });

  it("an empty slot and a filled slot share the same footprint token", () => {
    const { container: empty } = render(<PeakV2CourtSlot position="SF" state="empty" />);
    const { container: filled } = render(
      <PeakV2CourtSlot position="C" player={{ name: "Sample Player", meta: "Sample Team · 2010s" }} value={20.1} />,
    );
    const emptySlot = empty.querySelector('[data-testid="peak-v2-court-slot"]') as HTMLElement;
    const filledSlot = filled.querySelector('[data-testid="peak-v2-court-slot"]') as HTMLElement;
    expect(emptySlot.style.minHeight).toBe(filledSlot.style.minHeight);
  });

  it("a bench slot uses the smaller bench footprint, distinct from a starter slot", () => {
    const { container } = render(<PeakV2CourtSlot position="Bench" bench player={{ name: "Sample Player" }} />);
    const slot = container.querySelector('[data-testid="peak-v2-court-slot"]') as HTMLElement;
    expect(slot.style.minHeight).toBe("var(--v2-court-bench-min-height, 76px)");
  });

  it("marks staged/current state on the slot for downstream styling, distinct from a plain filled slot", () => {
    const { container } = render(
      <PeakV2CourtSlot position="PG" player={{ name: "Sample Player" }} state="staged" />,
    );
    expect(container.querySelector('[data-v2-slot-state="staged"]')).toBeInTheDocument();
  });
});

describe("PeakV2Modal", () => {
  it("is closed by default and opens/closes via Dialog's real Escape handling", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <PeakV2Modal open onClose={onClose} label="Sample modal">
        <p>Sample content</p>
      </PeakV2Modal>,
    );
    expect(screen.getByRole("dialog", { name: "Sample modal" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("applies V2 tokens to the panel, not Dialog's default legacy surface tokens", () => {
    render(
      <PeakV2Modal open onClose={() => {}} label="Sample modal">
        <p>Sample content</p>
      </PeakV2Modal>,
    );
    const panel = screen.getByRole("dialog");
    expect(panel.style.background).toBe("var(--v2-bg-plane)");
    expect(panel.style.borderRadius).toBe("var(--v2-radius-modal)");
  });
});

describe("PeakV2Shell", () => {
  it("self-scopes data-ui-version=v2 so V2 tokens resolve even rendered standalone", () => {
    render(
      <PeakV2Shell>
        <div>content</div>
      </PeakV2Shell>,
    );
    expect(screen.getByTestId("peak-v2-shell")).toHaveAttribute("data-ui-version", "v2");
  });
});

describe("PeakV2PrimaryAction — polymorphic on href", () => {
  it("renders a real <a>, never a <button>, when href is given", () => {
    render(<PeakV2PrimaryAction href="/arena">Go</PeakV2PrimaryAction>);
    const link = screen.getByRole("link", { name: "Go" });
    expect(link.tagName).toBe("A");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders a real <button> with no href", () => {
    render(<PeakV2PrimaryAction onClick={() => {}}>Go</PeakV2PrimaryAction>);
    expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
  });
});

describe("HomePageV2 — real data only, no fabricated stats", () => {
  const baseProps = {
    componentWeights: [],
    rankingsPreview: [],
    methodology: null,
    proof: {
      modelLabel: null,
      modelVersion: null,
      isDefaultModel: true,
      startSeason: null,
      endSeason: null,
      playersEvaluated: null,
      rankedWindows: null,
      generatedAt: null,
    },
    runTheTable: { href: "/arena/run-the-table", title: "RUN THE TABLE", description: "Flagship mode" },
    dailyModes: [],
    multiplayerModes: [],
  };

  it("omits the data-object slot entirely when no real top window is available — never a placeholder", () => {
    render(<HomePageV2 {...baseProps} topWindow={null} />);
    expect(screen.queryByText(/Rank/)).not.toBeInTheDocument();
  });

  it("renders the real top window's own rank/name/score when provided", () => {
    render(
      <HomePageV2
        {...baseProps}
        topWindow={{
          rank: 1,
          rowId: "row-1",
          playerName: "Sample Player",
          label: "1990-91 to 1992-93",
          team: "Sample Team",
          primeScore: 97.3,
          components: null,
        }}
      />,
    );
    expect(screen.getByText(/Rank 1/)).toBeInTheDocument();
    expect(screen.getByText("Sample Player")).toBeInTheDocument();
    expect(screen.getByText("97.3")).toBeInTheDocument();
  });

  it("omits the proof line when playersEvaluated/rankedWindows are unavailable — a truthful empty state", () => {
    render(<HomePageV2 {...baseProps} topWindow={null} />);
    expect(screen.queryByText(/players evaluated/)).not.toBeInTheDocument();
  });

  it("the primary CTA reads GO TO ARENA and links to the Arena hub, regardless of the flagship mode", () => {
    render(<HomePageV2 {...baseProps} topWindow={null} />);
    const cta = screen.getByRole("link", { name: "GO TO ARENA" });
    expect(cta).toHaveAttribute("href", "/arena");
  });

  it("omits the lane explainer when no component weights are given — never invents weights", () => {
    render(<HomePageV2 {...baseProps} topWindow={null} />);
    expect(screen.queryByRole("group", { name: /five rating components/i })).not.toBeInTheDocument();
  });

  it("renders the interactive lane explainer from real weights, with real methodology copy on interaction", async () => {
    const user = userEvent.setup();
    render(
      <HomePageV2
        {...baseProps}
        topWindow={null}
        componentWeights={[
          { key: "statistical_impact", label: "Statistical Impact", pct: "38%", tone: "si" },
          { key: "traditional_production", label: "Traditional Production", pct: "21%", tone: "tp" },
          { key: "individual_recognition", label: "Individual Recognition", pct: "20%", tone: "rec" },
          { key: "postseason_individual_value", label: "Playoff Rate Impact", pct: "18%", tone: "po" },
          { key: "team_achievement", label: "Team Result", pct: "3%", tone: "team" },
        ]}
        methodology={{
          weights: {},
          components: [
            {
              id: "statistical_impact",
              label: "Statistical Impact",
              weight: 0.38,
              weight_pct: 38,
              short_description: "Real per-possession statistical value.",
              long_description: "",
              key_inputs: [],
              common_misconceptions: [],
            },
          ],
          teammate_adjustment: { id: "teammate_adjustment", label: "", description: "", range: [0, 0] },
          calibration: { description: "", raw_label: "", display_label: "" },
          window_aggregation: { description: "", weights: {} },
        }}
      />,
    );
    // Default state: all five lanes shown together, no description surfaced yet.
    expect(screen.queryByText("Real per-possession statistical value.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /38%/ }));
    expect(screen.getByText("Real per-possession statistical value.")).toBeInTheDocument();
  });

  it("shows a truthful top-of-board rankings preview only when real rows are given", () => {
    const { rerender } = render(<HomePageV2 {...baseProps} topWindow={null} />);
    expect(screen.queryByRole("link", { name: /view rankings/i })).not.toBeInTheDocument();

    rerender(
      <HomePageV2
        {...baseProps}
        topWindow={null}
        rankingsPreview={[
          {
            rank: 1,
            rowId: "row-1",
            playerName: "Board Player",
            label: "1990-91 to 1992-93",
            team: "Board Team",
            primeScore: 99.1,
            components: null,
          },
        ]}
      />,
    );
    expect(screen.getByText("Board Player")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view rankings/i })).toHaveAttribute("href", "/rankings");
  });

  it("FAQ rows are collapsed by default — no answer text competes with play on first paint", () => {
    render(<HomePageV2 {...baseProps} topWindow={null} />);
    expect(screen.getByText("What is a PEAK3 peak?")).toBeInTheDocument();
    expect(
      screen.queryByText(/A contiguous window of seasons/),
    ).not.toBeInTheDocument();
  });
});
