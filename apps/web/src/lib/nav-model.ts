/**
 * The shape of the global navigation, as data.
 *
 * WHY THIS IS A MODULE AND NOT JSX. Before this pass the navbar held a literal
 * five-entry array and the Play "menu" was a single link, so the only way to
 * learn what games exist was to read three unrelated page components. The
 * launcher this file feeds lists every finished mode, which makes "is every
 * mode still reachable?" a question a unit test can answer — but only if the
 * answer lives somewhere without a DOM. Hence: no React, no `lucide-react`, no
 * `next/link`. Icons are string keys resolved by the renderer.
 *
 * MODE_COPY IS THE SOURCE OF TRUTH. Game titles, hrefs, blurbs and badges are
 * read from `lib/modes.ts` and never re-typed here. `assertNoDuplicateModeMetadata`
 * enforces the other half of that rule: a mode appears in exactly one place in
 * the menu, so it cannot acquire a second, drifting description.
 *
 * AVAILABILITY IS AN INPUT. Whether the 82-0 board is ready, or whether match
 * history has anything in it, is a runtime fact. Baking it in would make the
 * menu lie on the day it changes, so `navGroups()` takes it as a parameter with
 * a documented default.
 *
 * Owner: W1 (UX / Organization / Polish pass).
 */

import {
  MODE_COPY,
  ModeGroup,
  ModeIconKey,
  ModeId,
  RUN_THE_TABLE_DAILY_HREF,
} from "@/lib/modes";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** The hub every "Play" affordance ultimately leads to. */
export const ARENA_HUB_HREF = "/arena";

/**
 * Minimum touch-target edge, in CSS pixels (WCAG 2.2 AA "Target Size (Minimum)"
 * is 24px; the mobile drawer holds itself to the 44px iOS/Material figure).
 *
 * Exported as a number so the drawer can set it as an inline style and a test
 * can read it back. `--pk-tap-min` carries the same value for CSS-only
 * surfaces; the two are kept in step by this comment and by
 * `nav-components.test.tsx`.
 */
export const MIN_TAP_TARGET_PX = 44;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type NavGroupId = ModeGroup;

/**
 * `game` items are playable modes and are what `allGameHrefs()` returns.
 * `link` items are supporting destinations (rankings, methodology, the hub).
 */
export type NavItemKind = "game" | "link";

export interface NavItem {
  /** Stable id — used as a React key and as the roving-focus identity. */
  id: string;
  label: string;
  href: string;
  kind: NavItemKind;
  /** One line, <= 8 words. */
  blurb?: string;
  badge?: string;
  iconKey: ModeIconKey;
  /** Set when the item was derived from `MODE_COPY`. */
  modeId?: ModeId;
  /** The one item that gets the launcher's featured treatment. */
  featured?: boolean;
  /** Route prefix that marks this item active. Defaults to the href's path. */
  activePrefix?: string;
  /**
   * Require an exact pathname match instead of a prefix match.
   *
   * "View all games" points at `/arena`, which is the prefix of every other
   * item in the menu — without this it would read as the current page on the
   * flagship run, the leaderboard and run history simultaneously.
   */
  exact?: boolean;
  /** Extra prefixes that also mark it active (routes that moved, or never fit). */
  alsoActiveOn?: readonly string[];
  /** Query params that must be present with these values. Derived from `href`. */
  query?: Readonly<Record<string, string>>;
  /**
   * Query params that must be ABSENT.
   *
   * Two items can share a path — `/arena/run-the-table` and
   * `/arena/run-the-table?mode=daily` — and without this both would read as the
   * current page at once, which is worse than neither being highlighted.
   */
  absentQuery?: readonly string[];
}

export interface NavGroup {
  id: NavGroupId;
  label: string;
  /** Why this group exists, for the menu's section subhead. */
  hint: string;
  items: NavItem[];
}

export interface TopLevelNavLink {
  id: string;
  label: string;
  href: string;
  activePrefix?: string;
  alsoActiveOn?: readonly string[];
}

/**
 * Runtime facts the menu cannot know statically.
 *
 * Every flag defaults to `true` because every corresponding route is currently
 * live and tested; they exist so that a mode taken offline is removed from the
 * menu by a caller rather than by editing this file under time pressure.
 */
export interface NavAvailability {
  /** 82-0 PEAK Season is playable. */
  peakSeason?: boolean;
  /** RUN THE TABLE's once-a-day shared board is generated. */
  dailyRunTheTable?: boolean;
  /** Ranked queues are open. */
  ranked?: boolean;
  /** The 82-0 global leaderboard is serving. */
  leaderboard?: boolean;
  /** Per-user run history exists to link to. */
  matchHistory?: boolean;
}

const DEFAULT_AVAILABILITY: Required<NavAvailability> = {
  peakSeason: true,
  dailyRunTheTable: true,
  ranked: true,
  leaderboard: true,
  matchHistory: true,
};

/* ------------------------------------------------------------------ */
/* Href helpers                                                        */
/* ------------------------------------------------------------------ */

/** Splits `/a/b?x=1` into `["/a/b", "x=1"]`. Hash fragments are dropped. */
export function splitHref(href: string): [string, string] {
  const withoutHash = href.split("#")[0];
  const index = withoutHash.indexOf("?");
  if (index === -1) return [withoutHash, ""];
  return [withoutHash.slice(0, index), withoutHash.slice(index + 1)];
}

function queryFromHref(href: string): Record<string, string> | undefined {
  const [, search] = splitHref(href);
  if (!search) return undefined;
  const params = new URLSearchParams(search);
  const out: Record<string, string> = {};
  for (const [key, value] of params.entries()) out[key] = value;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** `/arena` matches `/arena` and `/arena/anything`, but never `/arenafoo`. */
export function matchesPrefix(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(base + "/");
}

/* ------------------------------------------------------------------ */
/* Item construction                                                   */
/* ------------------------------------------------------------------ */

interface ItemOverrides {
  id?: string;
  label?: string;
  href?: string;
  blurb?: string;
  badge?: string | null;
  iconKey?: ModeIconKey;
  featured?: boolean;
  activePrefix?: string;
  alsoActiveOn?: readonly string[];
  absentQuery?: readonly string[];
}

/**
 * Builds a nav item from `MODE_COPY`.
 *
 * `label` deliberately falls back to the mode's own `title`: "RUN THE TABLE" is
 * how the product names it everywhere else, and a menu that quietly title-cases
 * it would be the fifth spelling of the same game.
 */
function fromMode(modeId: ModeId, overrides: ItemOverrides = {}): NavItem {
  const mode = MODE_COPY[modeId];
  const href = overrides.href ?? mode.href;
  const badge = overrides.badge === null ? undefined : (overrides.badge ?? mode.badge);
  return {
    id: overrides.id ?? modeId,
    label: overrides.label ?? mode.title,
    href,
    kind: "game",
    blurb: overrides.blurb ?? mode.blurb,
    badge,
    iconKey: overrides.iconKey ?? mode.iconKey ?? "layout",
    modeId,
    featured: overrides.featured,
    activePrefix: overrides.activePrefix,
    alsoActiveOn: overrides.alsoActiveOn,
    query: queryFromHref(href),
    absentQuery: overrides.absentQuery,
  };
}

function link(item: Omit<NavItem, "kind" | "query"> & { kind?: NavItemKind }): NavItem {
  return { ...item, kind: item.kind ?? "link", query: queryFromHref(item.href) };
}

/* ------------------------------------------------------------------ */
/* The menu                                                            */
/* ------------------------------------------------------------------ */

/**
 * The Play launcher's sections, in render order.
 *
 * Order is a product statement: flagship first, then the once-a-day games most
 * players return for, then the competitive surfaces, then everything else. The
 * hub link is deliberately LAST — see `navGroups`' note on ArrowUp.
 */
export function navGroups(availability: NavAvailability = {}): NavGroup[] {
  const flags = { ...DEFAULT_AVAILABILITY, ...availability };

  const flagship: NavItem[] = [
    // Featured, but still one row in a list of five games rather than a
    // full-bleed takeover: promoting the flagship must not hide what it outranks.
    fromMode("run-the-table", {
      featured: true,
      activePrefix: "/arena/run-the-table",
      absentQuery: ["mode"],
    }),
  ];
  if (flags.peakSeason) {
    flagship.push(
      fromMode("peak-season", {
        // 82-0 spreads across /arena/court/*, but NOT all of it: the
        // leaderboard and run history are their own entries in Competitive, and
        // a prefix of "/arena/court" would light up three rows at once.
        activePrefix: "/arena/court/practice",
        alsoActiveOn: ["/arena/court/daily", "/arena/court/results"],
      }),
    );
  }

  const daily: NavItem[] = [
    fromMode("daily-grid"),
    fromMode("peak-duel", { activePrefix: "/play/daily" }),
  ];
  if (flags.dailyRunTheTable) {
    daily.push(
      fromMode("run-the-table", {
        id: "run-the-table-daily",
        label: "Daily Run the Table",
        href: RUN_THE_TABLE_DAILY_HREF,
        blurb: "Today's shared run, one seed for everyone",
        badge: null,
        iconKey: "calendar",
        activePrefix: "/arena/run-the-table",
      }),
    );
  }

  const competitive: NavItem[] = [];
  if (flags.ranked) {
    competitive.push(
      link({
        id: "ranked",
        label: "Ranked",
        href: "/arena/ranked",
        kind: "game",
        blurb: "Seeded ladder play against the field",
        iconKey: "medal",
      }),
    );
  }
  if (flags.leaderboard) {
    competitive.push(
      link({
        id: "peak-season-leaderboard",
        label: "82-0 Leaderboard",
        href: "/arena/court/leaderboard",
        blurb: "Best perfect-season rosters submitted",
        iconKey: "chart",
      }),
    );
  }
  if (flags.matchHistory) {
    competitive.push(
      link({
        id: "match-history",
        label: "Match history",
        href: "/arena/court/history",
        blurb: "Every run you have finished",
        iconKey: "history",
      }),
    );
  }

  const explore: NavItem[] = [
    // /play/endless was reachable only by typing the URL: no card, no nav
    // entry, no hub row. It is a finished mode, so it gets a door.
    link({
      id: "peak-duel-endless",
      label: "Peak Duel Endless",
      href: "/play/endless",
      kind: "game",
      blurb: "Unlimited comparisons, no daily limit",
      iconKey: "infinity",
    }),
    link({
      id: "rankings",
      label: "PEAK3 Rankings",
      href: "/rankings",
      blurb: "Every peak window the model rates",
      iconKey: "chart",
    }),
    link({
      id: "methodology",
      label: "Methodology",
      href: "/methodology",
      blurb: "How the five components are weighted",
      iconKey: "book",
    }),
    // LAST on purpose. ArrowUp on the trigger opens the menu with focus on the
    // final item, so the hub stays exactly one keyboard interaction away even
    // though the trigger itself is now a button rather than a link.
    link({
      id: "view-all-games",
      label: "View all games",
      href: ARENA_HUB_HREF,
      blurb: "The full hub, with every mode explained",
      iconKey: "layout",
      exact: true,
    }),
  ];

  const groups: NavGroup[] = [
    { id: "flagship", label: "Flagship", hint: "The long-form modes", items: flagship },
    { id: "daily", label: "Daily", hint: "New board every day", items: daily },
    { id: "competitive", label: "Competitive", hint: "Play against the field", items: competitive },
    { id: "explore", label: "Explore", hint: "Everything else", items: explore },
  ];

  return groups.filter((group) => group.items.length > 0);
}

/** The item that gets the launcher's featured treatment, if any. */
export function featuredItem(availability: NavAvailability = {}): NavItem | null {
  for (const group of navGroups(availability)) {
    const found = group.items.find((item) => item.featured);
    if (found) return found;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Top level                                                           */
/* ------------------------------------------------------------------ */

/**
 * The bar itself.
 *
 * "Play" is not here: it is a menu trigger, not a destination, and rendering it
 * as a link would mean two controls with the same name. `/arena` keeps its own
 * entry inside the menu ("View all games").
 *
 * `activePrefix` on Play's trigger is applied by `nav.tsx` from
 * `PLAY_TRIGGER_ACTIVE`, below.
 */
export const topLevelLinks: readonly TopLevelNavLink[] = [
  {
    id: "daily",
    label: "Daily",
    href: "/daily",
    // Peak Duel Daily lives under /play for historical reasons while belonging
    // to Daily in the product's own IA. Highlighting "Daily" there is the
    // honest answer: it is where the user navigated from. Moving the route
    // would break existing links for no user-visible gain.
    alsoActiveOn: ["/play/daily"],
  },
  { id: "rankings", label: "Rankings", href: "/rankings" },
  { id: "methodology", label: "Methodology", href: "/methodology" },
  { id: "about", label: "About", href: "/about" },
] as const;

/* ------------------------------------------------------------------ */
/* Account                                                             */
/* ------------------------------------------------------------------ */

/**
 * The signed-in destinations.
 *
 * WHY THEY ARE HERE NOW. Before this pass `/profile`, `/signin`, `/signup`,
 * `/progress` and `/history` were string literals inside `nav.tsx` and
 * `MobileNavDrawer.tsx` and appeared in this module nowhere at all — so the
 * reachability invariant in `nav-model.test.ts` ("every nav href resolves to a
 * real route") could not see them, and `/progress` had no nav entry of any kind:
 * a finished, tested page reachable only by typing its URL. Listing them as data
 * puts them under the same test as every other destination.
 *
 * WHY THEY ARE NOT IN `navGroups()`. `navModelIssues` enforces that every entry
 * in the launcher has a blurb, is a game or a supporting link, and maps to
 * `MODE_COPY` where applicable. These are none of those things — they are the
 * account menu, they are gated on a live session, and they must not appear in a
 * "which games exist" listing. They join `allNavHrefs()` for reachability and
 * stop there.
 */
export const accountLinks: readonly TopLevelNavLink[] = [
  { id: "profile", label: "Profile", href: "/profile" },
  { id: "progress", label: "Progress", href: "/progress" },
  { id: "history", label: "Match history", href: "/history" },
] as const;

/** Where an unauthenticated visitor is sent. */
export const SIGN_IN_HREF = "/signin";

/** Where a visitor without an account is sent to make one. */
export const SIGN_UP_HREF = "/signup";

/**
 * Every account href, signed-in and signed-out alike.
 *
 * Exported for the reachability test, which must cover the signed-out routes
 * too — `/signin` and `/signup` are the two most linked-to pages in the product.
 */
export function accountNavHrefs(): string[] {
  return [...accountLinks.map((item) => item.href), SIGN_IN_HREF, SIGN_UP_HREF];
}

/**
 * What makes the Play trigger read as the current section.
 *
 * `/arena` covers the hub, the flagship run, 82-0 and run history. `/play/endless`
 * is added because the endless duel is listed in this menu and nowhere else —
 * a user on that page should be able to see where they came from.
 */
export const PLAY_TRIGGER_ACTIVE: TopLevelNavLink = {
  id: "play",
  label: "Play",
  href: ARENA_HUB_HREF,
  activePrefix: ARENA_HUB_HREF,
  alsoActiveOn: ["/play/endless"],
};

/* ------------------------------------------------------------------ */
/* Active-route detection                                              */
/* ------------------------------------------------------------------ */

export interface ActiveMatchable {
  href: string;
  activePrefix?: string;
  exact?: boolean;
  alsoActiveOn?: readonly string[];
  query?: Readonly<Record<string, string>>;
  absentQuery?: readonly string[];
}

/**
 * Does `item` describe the page at `pathname` (+ `search`)?
 *
 * `search` is optional and defaults to none, so callers that only have
 * `usePathname()` still get correct results for every item without a query.
 */
export function isActive(
  pathname: string,
  item: ActiveMatchable,
  search: string | URLSearchParams = "",
): boolean {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const [itemPath] = splitHref(item.href);
  const base = item.activePrefix ?? itemPath;

  const pathMatches = item.exact ? pathname === base : matchesPrefix(pathname, base);
  if (pathMatches) {
    for (const [key, value] of Object.entries(item.query ?? {})) {
      if (params.get(key) !== value) return false;
    }
    for (const key of item.absentQuery ?? []) {
      if (params.has(key)) return false;
    }
    return true;
  }

  return (item.alsoActiveOn ?? []).some((extra) => matchesPrefix(pathname, extra));
}

/* ------------------------------------------------------------------ */
/* Invariants                                                          */
/* ------------------------------------------------------------------ */

/** Every playable href the launcher exposes, in menu order, deduplicated. */
export function allGameHrefs(availability: NavAvailability = {}): string[] {
  const seen = new Set<string>();
  for (const group of navGroups(availability)) {
    for (const item of group.items) {
      if (item.kind === "game") seen.add(item.href);
    }
  }
  return [...seen];
}

/**
 * Every href the chrome exposes: launcher, top level, and the account menu.
 *
 * The account hrefs are included so the reachability test covers them. They were
 * invisible to it until this pass, which is how `/auth/reset-password` — linked
 * from `sendPasswordReset` — went a whole phase without ever existing.
 */
export function allNavHrefs(availability: NavAvailability = {}): string[] {
  const seen = new Set<string>();
  for (const group of navGroups(availability)) {
    for (const item of group.items) seen.add(item.href);
  }
  for (const item of topLevelLinks) seen.add(item.href);
  for (const href of accountNavHrefs()) seen.add(href);
  return [...seen];
}

/**
 * Structural problems with the model, as human-readable strings.
 *
 * Returned rather than thrown so a test can assert on the whole list at once
 * instead of discovering one violation per run.
 *
 * What is checked, and why each one has bitten this codebase before:
 *   - duplicate item ids → React key collisions and a broken roving focus index
 *   - duplicate hrefs → the same destination offered twice under two names
 *   - a mode appearing twice as its *canonical* entry → two descriptions of one
 *     game, which is exactly what `lib/modes.ts` was created to end. A second
 *     entry pointing at a DIFFERENT href (the daily board) is legitimate.
 *   - more than one featured item → "featured" stops meaning anything
 *   - a mode in `MODE_COPY` with no entry at all → an unreachable game
 */
export function navModelIssues(availability: NavAvailability = {}): string[] {
  const issues: string[] = [];
  const groups = navGroups(availability);
  const items = groups.flatMap((group) => group.items);

  const ids = new Map<string, number>();
  const hrefs = new Map<string, number>();
  const canonicalModes = new Map<ModeId, number>();

  for (const item of items) {
    ids.set(item.id, (ids.get(item.id) ?? 0) + 1);
    hrefs.set(item.href, (hrefs.get(item.href) ?? 0) + 1);
    if (item.modeId && item.href === MODE_COPY[item.modeId].href) {
      canonicalModes.set(item.modeId, (canonicalModes.get(item.modeId) ?? 0) + 1);
    }
  }

  for (const [id, count] of ids) {
    if (count > 1) issues.push(`duplicate nav item id "${id}" (${count} occurrences)`);
  }
  for (const [href, count] of hrefs) {
    if (count > 1) issues.push(`duplicate nav href "${href}" (${count} occurrences)`);
  }
  for (const [modeId, count] of canonicalModes) {
    if (count > 1) issues.push(`mode "${modeId}" has ${count} canonical nav entries`);
  }

  const flags = { ...DEFAULT_AVAILABILITY, ...availability };
  const availableModes: ModeId[] = (Object.keys(MODE_COPY) as ModeId[]).filter(
    (id) => !(id === "peak-season" && !flags.peakSeason),
  );
  for (const modeId of availableModes) {
    if (!canonicalModes.has(modeId)) issues.push(`mode "${modeId}" is not reachable from the nav`);
  }

  const featured = items.filter((item) => item.featured);
  if (featured.length > 1) {
    issues.push(`${featured.length} featured items: ${featured.map((i) => i.id).join(", ")}`);
  }

  for (const item of items) {
    if (!item.blurb) issues.push(`nav item "${item.id}" has no blurb`);
    if (item.blurb && item.blurb.split(/\s+/).length > 8) {
      issues.push(`nav item "${item.id}" blurb is longer than 8 words`);
    }
  }

  return issues;
}

/** Throws if `navModelIssues` finds anything. Call sites: tests, and dev builds. */
export function assertNoDuplicateModeMetadata(availability: NavAvailability = {}): void {
  const issues = navModelIssues(availability);
  if (issues.length > 0) {
    throw new Error(`Invalid nav model:\n  - ${issues.join("\n  - ")}`);
  }
}
