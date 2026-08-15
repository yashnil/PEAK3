/**
 * `HeroLauncher` — the homepage primary CTA.
 *
 * WHAT THESE PIN, and why each one matters:
 *
 *  - The trigger is a real `<Link>`, not a menu button. Launch-polish §6
 *    retired the dropdown: the homepage's primary action is a direct action,
 *    not a decision to make first.
 *  - ARENA-FIRST PASS: the trigger always reads "Visit Arena" and always
 *    points at `/arena` — the hub every mode is comparable from — regardless
 *    of whether a Run the Table run is in progress. It no longer swaps its
 *    own href/label to "Continue Run"; that used to make the homepage's one
 *    button silently mean two different things depending on localStorage.
 *  - Resume is preserved, not dropped: with a run in progress, a second
 *    "Continue Run" control renders BESIDE the trigger, at the bare route —
 *    following it must never create a run, which `play-routing.spec.ts` pins
 *    end to end.
 *  - "Start New Run" only appears once there IS a run to prefer instead of
 *    (otherwise "Visit Arena" already reaches Run the Table one hop further).
 *  - Every affordance is a real link with a real `href`, so keyboard support
 *    (Tab order, Enter-to-activate) needs no custom handling to verify.
 *
 * LP2-3 removed the third affordance this file used to pin: a "Today's
 * shared run" secondary link, offered unconditionally beside the trigger.
 * `docs/implementation/launch-polish/RTT_DAILY_EVIDENCE.md` found nothing a
 * player could point to that daily delivers over Standard, so it is gone
 * from this component; the route itself (`/arena/run-the-table?mode=daily`)
 * is untouched and still resolves for an existing bookmark. What this file
 * now pins instead, alongside the tests below, is that the link stays gone.
 *
 * `next/link` renders a plain anchor under jsdom, so hrefs are asserted on the
 * real DOM attribute rather than on a mock.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

import HeroLauncher, {
  LAUNCHER_RESUME_HREF,
  LAUNCHER_STANDARD_HREF,
} from "@/components/home/HeroLauncher";
import { ARENA_HUB_HREF } from "@/lib/nav-model";
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

describe("HeroLauncher — the homepage primary CTA", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("with no run in progress, is a direct link into the Arena hub", () => {
    render(<HeroLauncher />);
    const cta = trigger();
    expect(cta.tagName).toBe("A");
    expect(cta).toHaveAttribute("href", ARENA_HUB_HREF);
    expect(cta).toHaveAttribute("href", "/arena");
    expect(cta).toHaveTextContent(/Visit Arena/i);
  });

  it("renders no menu, no popup semantics and no dropdown at all", () => {
    render(<HeroLauncher />);
    expect(trigger()).not.toHaveAttribute("aria-haspopup");
    expect(trigger()).not.toHaveAttribute("aria-expanded");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("LP2-3: no longer offers a daily shared-run link at all", () => {
    render(<HeroLauncher />);
    expect(screen.queryByTestId("home-launcher-daily")).toBeNull();
    expect(screen.queryByText(/Today.s shared run/i)).toBeNull();
  });

  it("does not offer 'Start New Run' when there is nothing to prefer it over", () => {
    render(<HeroLauncher />);
    expect(screen.queryByTestId("home-launcher-standard")).toBeNull();
  });

  it("with no stored run, does not offer a Continue Run control", () => {
    render(<HeroLauncher />);
    expect(trigger()).toHaveTextContent(/Visit Arena/i);
    expect(screen.queryByTestId("home-launcher-resume")).toBeNull();
  });

  it("ignores a corrupt stored run rather than offering a dead continue", () => {
    window.localStorage.setItem(RUN_THE_TABLE_STORAGE_KEY, "{not json");
    render(<HeroLauncher />);
    expect(trigger()).toHaveTextContent(/Visit Arena/i);
    expect(trigger()).toHaveAttribute("href", ARENA_HUB_HREF);
    expect(screen.queryByTestId("home-launcher-resume")).toBeNull();
  });

  it("with a run in progress, the primary control still reads Visit Arena and still points at /arena", () => {
    seedActiveRun();
    render(<HeroLauncher />);
    const cta = trigger();
    expect(cta).toHaveTextContent(/Visit Arena/i);
    expect(cta).toHaveAttribute("href", ARENA_HUB_HREF);
  });

  it("with a run in progress, offers a prominent Continue Run control at the BARE route", () => {
    seedActiveRun();
    render(<HeroLauncher />);
    const resume = screen.getByTestId("home-launcher-resume");
    // The bare route, with no `start` param: continuing must never create a
    // second run.
    expect(resume).toHaveAttribute("href", LAUNCHER_RESUME_HREF);
    expect(resume).toHaveAttribute("href", "/arena/run-the-table");
    expect(resume).toHaveTextContent(/Continue Run/i);
  });

  it("with a run in progress, offers Start New Run as a secondary link", () => {
    seedActiveRun();
    render(<HeroLauncher />);
    const startNew = screen.getByTestId("home-launcher-standard");
    expect(startNew).toHaveAttribute("href", LAUNCHER_STANDARD_HREF);
    expect(startNew).toHaveTextContent(/Start New Run/i);
  });

  it("with a run in progress, still does not offer a daily shared-run link", () => {
    seedActiveRun();
    render(<HeroLauncher />);
    expect(screen.queryByTestId("home-launcher-daily")).toBeNull();
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
