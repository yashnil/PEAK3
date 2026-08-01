/**
 * The Play launcher and the mobile drawer, as interactive components.
 *
 * The behaviours pinned here are the ones a redesign silently loses: keyboard
 * opening, arrow roving, focus return on Escape, the 44px touch target, and the
 * rule that a "Resume run" affordance only exists when there is a run to
 * resume. Every one of them was absent from the navbar this pass replaced.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

/**
 * The auth state the chrome reads.
 *
 * This used to be a frozen `{ user: null, supabaseEnabled: false }`, which meant
 * the account control was never rendered in any test — the entire signed-in
 * header, and the drawer's Account section, were untested. It is mutable now,
 * and reset in `beforeEach` below, so both states are covered.
 */
const authState = {
  user: null as null | { id: string; email?: string; isAnonymous: boolean; name?: string },
  loading: false,
  supabaseEnabled: false,
  signOut: vi.fn(),
};

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => authState,
}));

function signedIn(email = "ada.lovelace@example.com") {
  authState.user = { id: "u-1", email, isAnonymous: false };
  authState.supabaseEnabled = true;
}

import { Nav } from "@/components/layout/nav";
import { PlayMenu } from "@/components/layout/PlayMenu";
import { MobileNavDrawer } from "@/components/layout/MobileNavDrawer";
import { MODE_COPY } from "@/lib/modes";
import { MIN_TAP_TARGET_PX, navGroups } from "@/lib/nav-model";
import { getFocusableElements } from "@/lib/a11y";
import { RUN_THE_TABLE_SCHEMA_VERSION, RUN_THE_TABLE_STORAGE_KEY } from "@/types/run-the-table";

beforeEach(() => {
  window.localStorage.clear();
  authState.user = null;
  authState.supabaseEnabled = false;
  authState.signOut = vi.fn().mockResolvedValue(undefined);
});

function trigger() {
  return screen.getByRole("button", { name: "Play" });
}

/** Every focusable row inside the open panel, in DOM order. */
function panelLinks(): HTMLElement[] {
  const panel = screen.getByTestId("nav-play-panel");
  return within(panel).getAllByRole("link");
}

/* ================================================================== */
/* Nav shell                                                           */
/* ================================================================== */

describe("Nav shell", () => {
  it("keeps the frozen landmark name and the wordmark link", () => {
    render(<Nav />);
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "PEAK3 Arena home" })).toHaveAttribute("href", "/");
  });

  it("keeps every top-level destination a real link", () => {
    render(<Nav />);
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    for (const [name, href] of [
      ["Daily", "/daily"],
      ["Rankings", "/rankings"],
      ["Methodology", "/methodology"],
      ["About", "/about"],
    ] as const) {
      expect(within(nav).getByRole("link", { name })).toHaveAttribute("href", href);
    }
    // ...and "Play" is the one control that is deliberately NOT a link.
    expect(within(nav).queryByRole("link", { name: "Play" })).toBeNull();
    expect(within(nav).getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("hides the account control when Supabase is not configured", () => {
    render(<Nav />);
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(within(nav).queryByRole("link", { name: /Sign In|Profile/ })).toBeNull();
  });

  it("offers guests a sign-in link and nothing that blocks play", () => {
    authState.supabaseEnabled = true;
    render(<Nav />);
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(within(nav).getByTestId("nav-signin")).toHaveTextContent("Sign in");
    // Every game link is still a plain link — no interception, no gate.
    expect(within(nav).getByRole("button", { name: "Play" })).toBeEnabled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows an account menu — not a bare Profile link — once signed in", async () => {
    const user = userEvent.setup();
    signedIn();
    render(<Nav />);
    const nav = screen.getByRole("navigation", { name: "Main navigation" });

    // The old header rendered exactly this and nothing else.
    expect(within(nav).queryByRole("link", { name: "Profile" })).toBeNull();
    expect(within(nav).queryByTestId("nav-signin")).toBeNull();

    const trigger = within(nav).getByTestId("nav-account-trigger");
    expect(within(trigger).getByTestId("account-avatar")).toHaveAttribute(
      "data-initials",
      "AL",
    );

    await user.click(trigger);
    const panel = screen.getByTestId("nav-account-panel");
    expect(panel.querySelector('[data-nav-item="profile"]')).toHaveAttribute("href", "/profile");
    expect(panel.querySelector('[data-nav-item="progress"]')).toHaveAttribute("href", "/progress");
    expect(panel.querySelector('[data-nav-item="history"]')).toHaveAttribute("href", "/history");
  });

  it("puts sign-out in the header, where it has never been before", async () => {
    const user = userEvent.setup();
    signedIn();
    render(<Nav />);
    await user.click(screen.getByTestId("nav-account-trigger"));
    await user.click(screen.getByTestId("nav-signout"));
    expect(authState.signOut).toHaveBeenCalledTimes(1);
  });

  it("opens the mobile drawer from the hamburger", async () => {
    const user = userEvent.setup();
    render(<Nav />);
    const burger = screen.getByTestId("mobile-nav-trigger");
    expect(burger).toHaveAttribute("aria-expanded", "false");
    await user.click(burger);
    expect(screen.getByTestId("mobile-nav-drawer")).toBeInTheDocument();
    expect(burger).toHaveAttribute("aria-expanded", "true");
  });
});

/* ================================================================== */
/* PlayMenu                                                            */
/* ================================================================== */

describe("PlayMenu — trigger", () => {
  it("is a real button, collapsed, and announces only what it delivers", () => {
    render(<PlayMenu pathname="/" />);
    const button = trigger();
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("aria-expanded", "false");
    // NO `aria-haspopup`. ARIA defines `aria-haspopup="true"` as an alias for
    // `"menu"`, so the trigger announced "menu button" and a screen-reader user
    // pressing ArrowDown expected menuitems — while the panel is deliberately a
    // plain set of labelled link lists (the disclosure-navigation pattern), for
    // the reasons the component's own docstring gives. The promise and the
    // delivery now match.
    expect(button).not.toHaveAttribute("aria-haspopup");
    // And no `aria-controls` while the panel does not exist: an aria-controls
    // pointing at an absent id is worse than none, the same rule nav.tsx applies
    // to the mobile trigger.
    expect(button).not.toHaveAttribute("aria-controls");
    expect(screen.queryByTestId("nav-play-panel")).toBeNull();
  });

  it("points aria-controls at the panel it actually opens", async () => {
    const user = userEvent.setup();
    render(<PlayMenu pathname="/" />);
    await user.click(trigger());
    expect(trigger().getAttribute("aria-controls")).toBe(
      screen.getByTestId("nav-play-panel").id,
    );
  });

  it("reads as the current section on an arena route, with the frozen class", () => {
    render(<PlayMenu pathname="/arena/run-the-table" />);
    const button = trigger();
    expect(button).toHaveAttribute("aria-current", "page");
    // play-routing.spec.ts asserts this literal string in a browser.
    expect(button.className).toContain("bg-[var(--bg-surface)]");
  });

  it("does not read as current off the arena section", () => {
    render(<PlayMenu pathname="/rankings" />);
    expect(trigger()).not.toHaveAttribute("aria-current");
  });
});

describe("PlayMenu — opening", () => {
  it("opens by click", async () => {
    const user = userEvent.setup();
    render(<PlayMenu pathname="/" />);
    await user.click(trigger());
    expect(screen.getByTestId("nav-play-panel")).toBeInTheDocument();
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
  });

  it("closes on a second click", async () => {
    const user = userEvent.setup();
    render(<PlayMenu pathname="/" />);
    await user.click(trigger());
    await user.click(trigger());
    expect(screen.queryByTestId("nav-play-panel")).toBeNull();
  });

  it("opens on Enter and focuses the first item", async () => {
    const user = userEvent.setup();
    render(<PlayMenu pathname="/" />);
    trigger().focus();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("nav-play-panel")).toBeInTheDocument();
    expect(document.activeElement).toBe(panelLinks()[0]);
  });

  it("opens on Space and focuses the first item", async () => {
    const user = userEvent.setup();
    render(<PlayMenu pathname="/" />);
    trigger().focus();
    await user.keyboard(" ");
    expect(document.activeElement).toBe(panelLinks()[0]);
  });

  it("opens on ArrowDown and focuses the first item", async () => {
    const user = userEvent.setup();
    render(<PlayMenu pathname="/" />);
    trigger().focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(panelLinks()[0]);
  });

  it("opens on ArrowUp onto the last item, which is the /arena hub", async () => {
    // This is what keeps /arena one keyboard interaction away now that the
    // trigger is a button rather than a link to it.
    const user = userEvent.setup();
    render(<PlayMenu pathname="/" />);
    trigger().focus();
    await user.keyboard("{ArrowUp}");
    const links = panelLinks();
    const last = links[links.length - 1];
    expect(document.activeElement).toBe(last);
    expect(last).toHaveAttribute("href", "/arena");
    expect(last).toHaveTextContent("View all games");
  });
});

describe("PlayMenu — roving focus", () => {
  it("moves down, wraps at the end, and honours Home/End", async () => {
    const user = userEvent.setup();
    render(<PlayMenu pathname="/" />);
    trigger().focus();
    await user.keyboard("{ArrowDown}");
    const links = panelLinks();
    expect(links.length).toBeGreaterThan(4);

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(links[1]);

    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(links[0]);

    // Wraps backwards off the first item.
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(links[links.length - 1]);

    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(links[0]);

    await user.keyboard("{End}");
    expect(document.activeElement).toBe(links[links.length - 1]);

    // ...and wraps forwards off the last.
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(links[0]);
  });
});

describe("PlayMenu — dismissal", () => {
  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<PlayMenu pathname="/" />);
    trigger().focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByTestId("nav-play-panel")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("nav-play-panel")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("closes on an outside pointer press", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <PlayMenu pathname="/" />
        <button type="button">elsewhere</button>
      </div>,
    );
    await user.click(trigger());
    await user.click(screen.getByRole("button", { name: "elsewhere" }));
    expect(screen.queryByTestId("nav-play-panel")).toBeNull();
  });
});

describe("PlayMenu — content", () => {
  it("lists every group with a heading and a one-line explanation", async () => {
    const user = userEvent.setup();
    render(<PlayMenu pathname="/" />);
    await user.click(trigger());
    const panel = screen.getByTestId("nav-play-panel");
    for (const group of navGroups()) {
      expect(within(panel).getByRole("heading", { name: new RegExp(group.label) })).toBeInTheDocument();
    }
    // Located by id, not by name: "RUN THE TABLE" and "Daily Run the Table"
    // are both in this menu on purpose, and a name regex would match both.
    for (const item of navGroups().flatMap((g) => g.items)) {
      const link = panel.querySelector(`[data-nav-item="${item.id}"]`);
      expect(link, item.id).not.toBeNull();
      expect(link).toHaveAttribute("href", item.href);
      expect(link).toHaveTextContent(item.label);
      expect(link).toHaveTextContent(item.blurb!);
    }
  });

  it("features RUN THE TABLE without using the page-level featured attribute", async () => {
    const user = userEvent.setup();
    render(<PlayMenu pathname="/" />);
    await user.click(trigger());
    const panel = screen.getByTestId("nav-play-panel");
    const featured = panel.querySelectorAll('[data-nav-featured="true"]');
    expect(featured).toHaveLength(1);
    expect(featured[0]).toHaveAttribute("href", MODE_COPY["run-the-table"].href);
    // `[data-featured="true"]` is a per-PAGE invariant (exactly one). The menu
    // must never contribute to that count.
    expect(panel.querySelectorAll('[data-featured="true"]')).toHaveLength(0);
  });

  it("marks the current game, and only one of the two RUN THE TABLE rows", async () => {
    const user = userEvent.setup();
    render(<PlayMenu pathname="/arena/run-the-table" search="mode=daily" />);
    await user.click(trigger());
    const panel = screen.getByTestId("nav-play-panel");
    const current = panel.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("data-nav-item", "run-the-table-daily");
  });

  it("respects availability", async () => {
    const user = userEvent.setup();
    render(<PlayMenu pathname="/" availability={{ peakSeason: false }} />);
    await user.click(trigger());
    const panel = screen.getByTestId("nav-play-panel");
    expect(
      within(panel).queryByRole("link", { name: new RegExp(MODE_COPY["peak-season"].title, "i") }),
    ).toBeNull();
  });
});

/* ================================================================== */
/* MobileNavDrawer                                                     */
/* ================================================================== */

function renderDrawer(props: Partial<React.ComponentProps<typeof MobileNavDrawer>> = {}) {
  const onClose = vi.fn();
  const utils = render(
    <MobileNavDrawer
      open
      onClose={onClose}
      pathname={props.pathname ?? "/"}
      supabaseEnabled={props.supabaseEnabled ?? false}
      signedIn={props.signedIn ?? false}
      {...props}
    />,
  );
  return { ...utils, onClose };
}

function storeActiveRun(runType: "standard" | "daily" | "challenge" = "standard") {
  window.localStorage.setItem(
    RUN_THE_TABLE_STORAGE_KEY,
    JSON.stringify({
      schema_version: RUN_THE_TABLE_SCHEMA_VERSION,
      run_id: "run-abc",
      seed: 12345,
      run_type: runType,
      updated_at: new Date().toISOString(),
    }),
  );
}

describe("MobileNavDrawer", () => {
  it("is a modal dialog with an accessible name", () => {
    renderDrawer();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Navigation menu");
  });

  it("renders nothing when closed", () => {
    render(
      <MobileNavDrawer
        open={false}
        onClose={vi.fn()}
        pathname="/"
        supabaseEnabled={false}
        signedIn={false}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps every interactive row at least 44 CSS px tall", () => {
    renderDrawer();
    const dialog = screen.getByRole("dialog");
    const rows = dialog.querySelectorAll<HTMLElement>(
      ".pk-nav-drawer-row, .pk-nav-drawer-toprow, .pk-nav-drawer-section-link, .pk-nav-drawer-section-toggle, .pk-nav-drawer-close, .pk-nav-drawer-resume",
    );
    expect(rows.length).toBeGreaterThan(4);
    for (const row of rows) {
      // Inline, not stylesheet-dependent: the guarantee must survive a CSS
      // load-order change and must be observable without a real layout engine.
      expect(row.style.minHeight, row.className).toBe(`${MIN_TAP_TARGET_PX}px`);
    }
  });

  it("puts Rankings at the top level, not inside the Play accordion", () => {
    renderDrawer();
    const rankings = screen.getByTestId("mobile-nav-rankings");
    expect(rankings).toHaveAttribute("href", "/rankings");
    // Not nested inside a collapsed section body.
    expect(rankings.closest(".pk-nav-drawer-section-body")).toBeNull();
  });

  // Revised during integration. The original assertion was that Play collapses
  // whenever the user is outside the arena section — which was true, and looked
  // wrong: a 390x844 capture of the drawer on the homepage showed four collapsed
  // rows above roughly 550px of dead space, reading as an empty menu.
  //
  // The invariant that actually mattered was never "Play starts closed", it was
  // "exactly one section is open, so Rankings stays above the fold". That is what
  // is asserted now, and it is asserted directly.
  it("opens Play by default, so the sheet leads with the games", () => {
    renderDrawer({ pathname: "/rankings" });
    expect(screen.getByTestId("mobile-nav-toggle-play")).toHaveAttribute("aria-expanded", "true");
  });

  it("expands the section the user is already in, in preference to Play", () => {
    renderDrawer({ pathname: "/daily/grid" });
    expect(screen.getByTestId("mobile-nav-toggle-daily")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("mobile-nav-toggle-play")).toHaveAttribute("aria-expanded", "false");
  });

  it("expands Play when the user is in the arena section", () => {
    renderDrawer({ pathname: "/arena/run-the-table" });
    expect(screen.getByTestId("mobile-nav-toggle-play")).toHaveAttribute("aria-expanded", "true");
  });

  it("never has two sections open at once, which is what keeps Rankings in reach", async () => {
    const user = userEvent.setup();
    renderDrawer({ pathname: "/rankings" });
    const play = screen.getByTestId("mobile-nav-toggle-play");
    const daily = screen.getByTestId("mobile-nav-toggle-daily");

    expect(play).toHaveAttribute("aria-expanded", "true");
    await user.click(daily);
    expect(daily).toHaveAttribute("aria-expanded", "true");
    expect(play, "opening Daily must close Play").toHaveAttribute("aria-expanded", "false");
  });

  it("toggles a section and its region together", async () => {
    const user = userEvent.setup();
    renderDrawer({ pathname: "/rankings" });
    const toggle = screen.getByTestId("mobile-nav-toggle-play");
    const regionId = toggle.getAttribute("aria-controls")!;
    const region = document.getElementById(regionId)!;
    // Play now starts open, so the round trip runs closed-first.
    expect(region.hidden).toBe(false);

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(region.hidden).toBe(true);

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(region.hidden).toBe(false);
  });

  it("marks the current route with aria-current and a non-colour cue", () => {
    renderDrawer({ pathname: "/rankings" });
    const rankings = screen.getByTestId("mobile-nav-rankings");
    expect(rankings).toHaveAttribute("aria-current", "page");
    expect(rankings.textContent).toMatch(/Current/);
  });

  it("traps Tab inside the sheet", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">outside</button>
        <MobileNavDrawer
          open
          onClose={vi.fn()}
          pathname="/"
          supabaseEnabled={false}
          signedIn={false}
        />
      </div>,
    );
    const dialog = screen.getByRole("dialog");
    // The same reader the trap itself uses, so "last" means the same thing to
    // the test and to the implementation — links inside a collapsed (`hidden`)
    // accordion section are focusable to a naive querySelectorAll and are not
    // reachable in reality.
    const focusables = getFocusableElements(dialog);
    expect(focusables.length).toBeGreaterThan(3);
    focusables[focusables.length - 1].focus();

    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "outside" }));
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDrawer();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});

describe("MobileNavDrawer — account", () => {
  it("offers nothing at all when Supabase is not configured", () => {
    renderDrawer();
    expect(screen.queryByTestId("mobile-nav-account")).toBeNull();
    expect(screen.queryByTestId("mobile-nav-toggle-account")).toBeNull();
  });

  it("offers a guest one sign-in row that returns them to where they were", () => {
    renderDrawer({ supabaseEnabled: true, pathname: "/arena/run-the-table" });
    const row = screen.getByTestId("mobile-nav-account");
    expect(row).toHaveTextContent("Sign in");
    expect(row).toHaveAttribute("href", "/signin?returnTo=%2Farena%2Frun-the-table");
    // Not buried in an accordion: signing in must stay one tap away.
    expect(row.closest(".pk-nav-drawer-section-body")).toBeNull();
  });

  it("renders the Account section its SectionId has always declared", () => {
    // `SectionId` carried an "account" member from the day this drawer was
    // written, and no `Section id="account"` was ever rendered — so a phone user
    // could not reach /progress or /history and could not sign out at all.
    renderDrawer({ supabaseEnabled: true, signedIn: true });
    const toggle = screen.getByTestId("mobile-nav-toggle-account");
    expect(toggle).toBeInTheDocument();
    for (const [id, href] of [
      ["profile", "/profile"],
      ["progress", "/progress"],
      ["history", "/history"],
    ] as const) {
      expect(screen.getByTestId(`mobile-nav-${id}`)).toHaveAttribute("href", href);
    }
    expect(screen.getByTestId("mobile-nav-signout")).toBeInTheDocument();
    expect(screen.queryByTestId("mobile-nav-account")).toBeNull();
  });

  it("expands Account when the user is already inside it, in preference to Play", () => {
    renderDrawer({ supabaseEnabled: true, signedIn: true, pathname: "/progress" });
    expect(screen.getByTestId("mobile-nav-toggle-account")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByTestId("mobile-nav-toggle-play")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("keeps the 44px touch target on the account rows too", () => {
    renderDrawer({ supabaseEnabled: true, signedIn: true, pathname: "/progress" });
    for (const testId of ["mobile-nav-profile", "mobile-nav-signout"]) {
      expect(screen.getByTestId(testId).style.minHeight).toBe(`${MIN_TAP_TARGET_PX}px`);
    }
  });

  it("signs out and closes the sheet in one action", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDrawer({
      supabaseEnabled: true,
      signedIn: true,
      pathname: "/progress",
    });
    await user.click(screen.getByTestId("mobile-nav-signout"));
    expect(authState.signOut).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });
});

describe("MobileNavDrawer — resume", () => {
  it("offers no resume action when nothing is stored", () => {
    renderDrawer();
    expect(screen.queryByTestId("mobile-nav-resume")).toBeNull();
  });

  it("offers a resume action when a run is stored, named for the run type", () => {
    storeActiveRun("daily");
    renderDrawer();
    const resume = screen.getByTestId("mobile-nav-resume");
    expect(resume).toHaveAttribute("href", "/arena/run-the-table");
    expect(resume).toHaveTextContent("Resume today's run");
  });

  it("ignores a corrupt stored run rather than breaking the navigation", () => {
    window.localStorage.setItem(RUN_THE_TABLE_STORAGE_KEY, "{not json");
    renderDrawer();
    expect(screen.queryByTestId("mobile-nav-resume")).toBeNull();
    expect(screen.getByTestId("mobile-nav-rankings")).toBeInTheDocument();
  });

  it("ignores a stored run from an older schema version", () => {
    window.localStorage.setItem(
      RUN_THE_TABLE_STORAGE_KEY,
      JSON.stringify({ schema_version: -1, run_id: "x", seed: 1, run_type: "standard" }),
    );
    renderDrawer();
    expect(screen.queryByTestId("mobile-nav-resume")).toBeNull();
  });
});
