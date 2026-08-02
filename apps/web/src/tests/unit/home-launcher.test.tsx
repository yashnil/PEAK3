/**
 * `HeroLauncher` — the homepage primary CTA (W2, plan §5.1).
 *
 * WHAT THESE PIN, and why each one matters:
 *
 *  - The trigger is a MENU BUTTON, not a link. The whole point of the change is
 *    that the homepage control names the choice it is about to make instead of
 *    routing to a second identical "Start a run" button. If this ever regresses
 *    to an anchor, the double funnel is back.
 *  - The three hrefs, verbatim. `?start=standard` and `?start=daily` are the
 *    contract with `RunTheTableGame` (W4), which consumes the param exactly
 *    once and strips it. "Resume" is the BARE route on purpose — following it
 *    must never create a run, which `play-routing.spec.ts` pins end to end.
 *  - "Resume your run" appears only when `loadActiveRun()` finds a stored run.
 *    Offering resume to someone with nothing to resume is a dead end, and
 *    rendering it during SSR would hydrate-mismatch every first-time visitor.
 *  - Escape closes and returns focus to the trigger; arrows move between
 *    options. A menu that strands focus on `<body>` is unusable by keyboard.
 *
 * `next/link` renders a plain anchor under jsdom, so hrefs are asserted on the
 * real DOM attribute rather than on a mock.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import React from "react";

import HeroLauncher, {
  LAUNCHER_DAILY_HREF,
  LAUNCHER_RESUME_HREF,
  LAUNCHER_STANDARD_HREF,
} from "@/components/home/HeroLauncher";
import {
  RUN_THE_TABLE_SCHEMA_VERSION,
  RUN_THE_TABLE_STORAGE_KEY,
} from "@/types/run-the-table";

function seedActiveRun(): void {
  window.localStorage.setItem(
    RUN_THE_TABLE_STORAGE_KEY,
    JSON.stringify({
      schema_version: RUN_THE_TABLE_SCHEMA_VERSION,
      run_id: "run-abc123",
      seed: 4242,
      run_type: "standard",
      updated_at: "2026-07-31T10:00:00.000Z",
    }),
  );
}

function trigger(): HTMLElement {
  return screen.getByTestId("home-primary-cta");
}

function openMenu(): HTMLElement {
  fireEvent.click(trigger());
  return screen.getByTestId("home-launcher-menu");
}

describe("HeroLauncher — the homepage primary CTA", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("renders a menu button, not a link", () => {
    render(<HeroLauncher />);
    const cta = trigger();
    expect(cta.tagName).toBe("BUTTON");
    expect(cta).toHaveAttribute("aria-haspopup", "menu");
    expect(cta).toHaveAttribute("aria-expanded", "false");
    expect(cta).toHaveTextContent(/Play Run the Table/i);
    // The old funnel: a bare anchor straight into the mode.
    expect(cta).not.toHaveAttribute("href");
  });

  it("keeps the menu closed until it is asked for", () => {
    render(<HeroLauncher />);
    expect(screen.queryByTestId("home-launcher-menu")).toBeNull();
    expect(screen.queryByTestId("home-launcher-standard")).toBeNull();
  });

  it("opens on click and exposes aria-expanded", () => {
    render(<HeroLauncher />);
    const menu = openMenu();
    expect(menu).toHaveAttribute("role", "menu");
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(trigger()).toHaveAttribute("aria-controls", menu.id);
  });

  it("offers a standard run and today's shared run at their exact hrefs", () => {
    render(<HeroLauncher />);
    const menu = openMenu();

    const standard = within(menu).getByTestId("home-launcher-standard");
    expect(standard).toHaveAttribute("href", LAUNCHER_STANDARD_HREF);
    expect(standard).toHaveAttribute("href", "/arena/run-the-table?start=standard");
    expect(standard).toHaveTextContent(/Standard run/i);

    const daily = within(menu).getByTestId("home-launcher-daily");
    expect(daily).toHaveAttribute("href", LAUNCHER_DAILY_HREF);
    // NOT `?start=daily`. The daily is one shared board and one attempt per UTC
    // day, so making the URL itself the trigger would spend that attempt for
    // anyone the link is forwarded to. Standard runs are free to create and do
    // auto-start; the daily lands on the gate with its button emphasised.
    expect(daily).toHaveAttribute("href", "/arena/run-the-table?mode=daily");
    expect(daily.getAttribute("href")).not.toContain("start=");
    expect(daily).toHaveTextContent(/Today's shared run/i);
    expect(daily).toHaveTextContent(/One attempt per day/i);

    expect(within(menu).getAllByRole("menuitem")).toHaveLength(2);
  });

  it("hides the resume option when storage holds no run", () => {
    render(<HeroLauncher />);
    openMenu();
    expect(screen.queryByTestId("home-launcher-resume")).toBeNull();
    expect(screen.queryByTestId("home-resume-notice")).toBeNull();
  });

  it("ignores a corrupt stored run rather than offering a dead resume", () => {
    window.localStorage.setItem(RUN_THE_TABLE_STORAGE_KEY, "{not json");
    render(<HeroLauncher />);
    openMenu();
    expect(screen.queryByTestId("home-launcher-resume")).toBeNull();
  });

  it("offers resume at the BARE route when a run is stored", () => {
    seedActiveRun();
    render(<HeroLauncher />);
    const menu = openMenu();

    const resume = within(menu).getByTestId("home-launcher-resume");
    // The bare route, with no `start` param: resuming must never create a run.
    expect(resume).toHaveAttribute("href", LAUNCHER_RESUME_HREF);
    expect(resume).toHaveAttribute("href", "/arena/run-the-table");
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(3);
    expect(screen.getByTestId("home-resume-notice")).toBeInTheDocument();
  });

  it("focuses the first option when opened", () => {
    render(<HeroLauncher />);
    openMenu();
    expect(screen.getByTestId("home-launcher-standard")).toHaveFocus();
  });

  it("opens onto the last option with ArrowUp", () => {
    seedActiveRun();
    render(<HeroLauncher />);
    fireEvent.keyDown(trigger(), { key: "ArrowUp" });
    expect(screen.getByTestId("home-launcher-resume")).toHaveFocus();
  });

  it("moves between options with the arrow keys, wrapping at the ends", () => {
    render(<HeroLauncher />);
    openMenu();

    const standard = screen.getByTestId("home-launcher-standard");
    const daily = screen.getByTestId("home-launcher-daily");

    fireEvent.keyDown(standard, { key: "ArrowDown" });
    expect(daily).toHaveFocus();

    fireEvent.keyDown(daily, { key: "ArrowDown" });
    expect(standard).toHaveFocus();

    fireEvent.keyDown(standard, { key: "ArrowUp" });
    expect(daily).toHaveFocus();

    fireEvent.keyDown(daily, { key: "Home" });
    expect(standard).toHaveFocus();

    fireEvent.keyDown(standard, { key: "End" });
    expect(daily).toHaveFocus();
  });

  it("closes on Escape and returns focus to the trigger", () => {
    render(<HeroLauncher />);
    openMenu();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("home-launcher-menu")).toBeNull();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(trigger()).toHaveFocus();
  });

  it("closes on an outside click without stealing focus back", () => {
    render(
      <div>
        <HeroLauncher />
        <button type="button">elsewhere</button>
      </div>,
    );
    openMenu();
    fireEvent.mouseDown(screen.getByText("elsewhere"));
    expect(screen.queryByTestId("home-launcher-menu")).toBeNull();
    expect(trigger()).not.toHaveFocus();
  });

  it("closes when the trigger is pressed a second time", () => {
    render(<HeroLauncher />);
    openMenu();
    fireEvent.click(trigger());
    expect(screen.queryByTestId("home-launcher-menu")).toBeNull();
  });

  it("renders the secondary action passed as children beside the trigger", () => {
    render(
      <HeroLauncher>
        <a href="/rankings">Explore Rankings</a>
      </HeroLauncher>,
    );
    expect(screen.getByRole("link", { name: "Explore Rankings" })).toHaveAttribute(
      "href",
      "/rankings",
    );
  });
});
