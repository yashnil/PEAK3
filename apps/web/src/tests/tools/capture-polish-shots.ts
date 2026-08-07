/**
 * Manual-acceptance screenshot capture for the gameplay + visual polish pass.
 *
 * NOT a spec (deliberately not named `*.spec.ts`) and outside the main config's
 * `testDir`, so it can never run as part of `npm run test:e2e` or in CI. It
 * writes PNGs into a gitignored review directory: evidence for a human to
 * judge, not an assertion about behaviour.
 *
 * Reachable only via (from apps/web):
 *   npx playwright test --config=playwright.polish-shots.config.ts
 *
 * WHY EACH CAPTURE ASSERTS BEFORE IT SHOOTS. A review sheet is worthless if a
 * frame might be something other than what its filename claims, so every
 * capture proves the surface is present first and FAILS rather than writing a
 * misleading frame. The manifest records what was seen plus a content hash,
 * because an earlier capture pass in this repository silently produced pairs of
 * byte-identical frames under different names -- two filenames, one screen.
 *
 * THE MATRIX THIS FILLS is section 15 of the specification. Viewports and
 * themes are driven from `MATRIX` below so the sheet and the spec cannot drift.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { mintTestAccessToken } from "../e2e/helpers/test-jwt";
import { API_PORT } from "../../../playwright.polish-shots.config";

const API_BASE = `http://127.0.0.1:${API_PORT}`;
void API_BASE;

const OUT = path.resolve(
  __dirname,
  "../../../../../docs/implementation/gameplay-polish-review",
);
const MANIFEST = path.join(OUT, "screenshot-manifest.json");

const DESKTOP = { width: 1440, height: 900 };
const SHORT = { width: 1440, height: 700 };
const MOBILE = { width: 390, height: 844 };

fs.mkdirSync(OUT, { recursive: true });

interface ManifestEntry {
  file: string;
  viewport: string;
  theme: string;
  url: string;
  note: string;
  md5: string;
}

function appendManifest(entry: ManifestEntry): void {
  const existing: ManifestEntry[] = fs.existsSync(MANIFEST)
    ? JSON.parse(fs.readFileSync(MANIFEST, "utf8"))
    : [];
  fs.writeFileSync(
    MANIFEST,
    `${JSON.stringify(
      [...existing.filter((e) => e.file !== entry.file), entry],
      null,
      2,
    )}\n`,
  );
}

/**
 * A STICKY HEADER IS STITCHED INTO THE MIDDLE OF A FULL-PAGE SHOT.
 *
 * Chromium composes `fullPage: true` by scrolling and joining, so anything
 * sticky or fixed is painted wherever it happened to be sitting. Pinning them
 * to `static` for the duration of the shot is the standard fix; it is injected
 * and removed immediately, so nothing after the frame sees a different page.
 */
const UNSTICK_ID = "peak3-capture-unstick";

async function shot(
  page: Page,
  name: string,
  note: string,
  opts: { fullPage?: boolean; theme?: string } = {},
): Promise<void> {
  const file = `${name}.png`;
  const target = path.join(OUT, file);
  if (!opts.fullPage) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(120);
  } else {
    await page.evaluate((id) => {
      const style = document.createElement("style");
      style.id = id;
      style.textContent =
        ".pk-nav-header, .arena-shell-rail, .td-column-centre, " +
        ".tmw-place-actions, .td-bid { position: static !important; }";
      document.head.appendChild(style);
    }, UNSTICK_ID);
  }
  await page.screenshot({ path: target, fullPage: !!opts.fullPage });
  if (opts.fullPage) {
    await page.evaluate((id) => document.getElementById(id)?.remove(), UNSTICK_ID);
  }
  const size = page.viewportSize();
  appendManifest({
    file,
    viewport: size ? `${size.width}x${size.height}` : "unknown",
    theme: opts.theme ?? "dark",
    url: page.url(),
    note,
    md5: crypto.createHash("md5").update(fs.readFileSync(target)).digest("hex"),
  });
}

async function signIn(context: BrowserContext, page: Page, sub: string): Promise<void> {
  void context;
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.__peak3TestAuth !== "undefined");
  const token = mintTestAccessToken(sub, `${sub}@shots.test`);
  await page.evaluate(
    ([t, s]) => {
      window.__peak3TestAuth!.setSession(t as string, {
        id: s as string,
        email: `${s}@shots.test`,
        isAnonymous: false,
      });
    },
    [token, sub],
  );
}

async function setTheme(page: Page, theme: "dark" | "light"): Promise<void> {
  await page.evaluate((t) => {
    localStorage.setItem("peak3-theme", t as string);
    document.documentElement.setAttribute("data-theme", t as string);
  }, theme);
  await page.waitForTimeout(160);
}

async function dismissHandlePrompt(page: Page): Promise<void> {
  const skip = page.getByTestId("handle-onboarding-skip");
  if (await skip.count()) {
    await skip.first().click().catch(() => {});
  }
}

function uniqueSub(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

// ---------------------------------------------------------------------------
// Driving a match to its RESULT
// ---------------------------------------------------------------------------
/**
 * A match is driven to completion through the API rather than the UI, then the
 * finished room is loaded in the browser once per matrix cell.
 *
 * WHY. Reaching a Three-Man Weave result through the interface means eighteen
 * picks, six ceremonies and up to twelve bot think windows -- minutes per
 * frame, times five cells. The API path takes seconds and lands the browser on
 * exactly the state the frames are ABOUT, which is the result screen, not the
 * route to it. Nothing is faked: these are real commands against the real
 * reducer, so the completed match is a real completed match.
 */
async function api(
  token: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${API_BASE}/api/v1/arena${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await response.json()) as Record<string, unknown>;
  } catch {
    /* an empty body is a real answer for some routes */
  }
  return { status: response.status, json };
}

/** Only the fields the driver reads. The capture is a driver, not a client. */
interface MatchView {
  state_version?: number;
  status?: string;
  turn_phase?: string;
  your_seat_index?: number;
  current_turn_seat_index?: number | null;
  public_state?: { phase?: string; current_bid?: number };
  private_state?: {
    legal_picks?: Record<string, string[]>;
    is_your_turn?: boolean;
    minimum_bid?: number;
    max_bid?: number;
    bid_blocked_reason?: string | null;
  };
}

interface DrivenMatch {
  matchId: string;
  /** The seat the driver played, so a caller can say which result it is. */
  seat: number;
}

/** Play a whole practice match of `mode` through the API. Returns its id. */
async function driveToCompletion(
  token: string,
  mode: "three_man_weave" | "twenty_dollar",
  pick: (view: MatchView) => { command_type: string; payload: unknown } | null,
): Promise<DrivenMatch> {
  const created = await api(token, "/matches/practice", {
    method: "POST",
    body: { mode },
  });
  const matchId = String(created.json.match_id ?? "");
  expect(matchId, `practice ${mode} match was created`).toBeTruthy();
  const seat = Number(created.json.your_seat_index ?? 0);

  // Bounded: eighteen picks / thirty-six lots plus the ceremonies and bot
  // turns between them. A mode that stopped advancing would hit this rather
  // than spin, and the assertion afterwards says so.
  for (let step = 0; step < 400; step += 1) {
    const view = (await api(token, `/matches/${matchId}`)).json as MatchView;
    if (view?.public_state?.phase === "complete" || view?.status === "completed") {
      return { matchId, seat };
    }
    const move = pick(view);
    if (move) {
      await api(token, `/matches/${matchId}/commands`, {
        method: "POST",
        body: {
          command_type: move.command_type,
          payload: move.payload,
          idempotency_key: `cap-${matchId}-${view.state_version}-${step}`,
          expected_state_version: view.state_version,
        },
      });
    } else {
      // Not our turn, or a ceremony is holding. Polling is what advances the
      // server's own clock -- the sweep runs on read.
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  throw new Error(`${mode} match ${matchId} did not complete within the step budget`);
}

/** The Weave: take the first legal pick whenever this seat is on the clock. */
function weaveMove(view: MatchView) {
  if (view?.turn_phase === "reveal") return null;
  if (view?.current_turn_seat_index !== view?.your_seat_index) return null;
  const legal = view?.private_state?.legal_picks ?? {};
  const slug = Object.keys(legal)[0];
  if (!slug) return null;
  return {
    command_type: "tmw_pick",
    payload: { player_slug: slug, slot_type: legal[slug][0] },
  };
}

/** The Showdown: bid the minimum when affordable, otherwise decline. */
function showdownMove(view: MatchView) {
  const priv = view?.private_state ?? {};
  const pub = view?.public_state ?? {};
  if (!priv.is_your_turn) return null;
  const minimum = Number(priv.minimum_bid ?? (Number(pub.current_bid ?? 0) + 1));
  const max = Number(priv.max_bid ?? 0);
  if (!priv.bid_blocked_reason && minimum <= max) {
    return { command_type: "bid", payload: { amount: minimum } };
  }
  return { command_type: "pass", payload: {} };
}

/** The spec's §15 matrix, as data. */
const MATRIX = [
  { key: "d900", viewport: DESKTOP, theme: "dark" as const },
  { key: "l900", viewport: DESKTOP, theme: "light" as const },
  { key: "d700", viewport: SHORT, theme: "dark" as const },
  { key: "m844", viewport: MOBILE, theme: "dark" as const },
  { key: "m844l", viewport: MOBILE, theme: "light" as const },
];

// ---------------------------------------------------------------------------
// Homepage fact + Rankings regression — no match needed
// ---------------------------------------------------------------------------
test.describe("Static surfaces", () => {
  for (const cell of MATRIX) {
    test(`homepage fact ${cell.key}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: cell.viewport });
      const page = await context.newPage();
      try {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await setTheme(page, cell.theme);
        await page.reload({ waitUntil: "networkidle" });
        const card = page.getByTestId("nba-fact-of-the-day");
        await expect(card).toBeVisible({ timeout: 20_000 });
        await card.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        await shot(page, `home-fact-${cell.key}`, "Fact of the Day card", {
          theme: cell.theme,
        });
      } finally {
        await context.close();
      }
    });
  }

  test("rankings regression d900 + l900", async ({ browser }) => {
    for (const theme of ["dark", "light"] as const) {
      const context = await browser.newContext({ viewport: DESKTOP });
      const page = await context.newPage();
      try {
        await page.goto("/rankings", { waitUntil: "domcontentloaded" });
        await setTheme(page, theme);
        await page.reload({ waitUntil: "networkidle" });
        await expect(page.locator(".rankings-board")).toBeVisible({ timeout: 20_000 });
        await shot(page, `rankings-${theme}`, "PROTECTED: component bars must be unchanged", {
          theme,
        });
      } finally {
        await context.close();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Three-Man Weave
// ---------------------------------------------------------------------------
async function startWeave(page: Page): Promise<void> {
  await page.goto("/arena/three-man-weave", { waitUntil: "domcontentloaded" });
  await dismissHandlePrompt(page);
  const start = page.getByTestId("tmw-start");
  await expect(start).toBeVisible({ timeout: 30_000 });
  await start.click();
  await expect(page.getByTestId("tmw-room")).toBeVisible({ timeout: 40_000 });
}

test.describe("Three-Man Weave", () => {
  for (const cell of MATRIX) {
    test(`weave intro + room ${cell.key}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: cell.viewport });
      const page = await context.newPage();
      try {
        await signIn(context, page, uniqueSub("shot-tmw"));
        await setTheme(page, cell.theme);
        await startWeave(page);

        // The opening ceremony, if this seeded draw gives it to us. It mounts
        // only while no human decision window is open -- which is the fix, so
        // its absence is a legitimate state rather than a failed capture.
        const ceremony = page.getByTestId("tmw-ceremony-scrim");
        if (await ceremony.count()) {
          await shot(page, `tmw-intro-${cell.key}`, "opening ceremony / franchise reveal", {
            theme: cell.theme,
          });
        }

        await expect(page.getByTestId("tmw-turnbar")).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId("tmw-courts")).toBeVisible();
        await shot(page, `tmw-room-${cell.key}`, "three rosters + single turn status", {
          theme: cell.theme,
        });

        // The pick surface, when the seeded draw puts the human first.
        const overlay = page.getByTestId("tmw-pick-overlay");
        if (await overlay.count()) {
          await shot(page, `tmw-pick-${cell.key}`, "user selection panel", {
            theme: cell.theme,
          });
        }

        await shot(page, `tmw-room-full-${cell.key}`, "whole room, stitched", {
          fullPage: true,
          theme: cell.theme,
        });
      } finally {
        await context.close();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// The $20 Showdown
// ---------------------------------------------------------------------------
async function startShowdown(page: Page): Promise<void> {
  await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
  await dismissHandlePrompt(page);
  const practice = page.getByTestId("lobby-twenty_dollar-practice");
  await expect(practice).toBeVisible({ timeout: 30_000 });
  await practice.click();
  await expect(page.getByTestId("td-game")).toBeVisible({ timeout: 40_000 });
}

test.describe("The $20 Showdown", () => {
  for (const cell of MATRIX) {
    test(`showdown intro + auction ${cell.key}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: cell.viewport });
      const page = await context.newPage();
      try {
        await signIn(context, page, uniqueSub("shot-td"));
        await setTheme(page, cell.theme);
        await startShowdown(page);

        const intro = page.getByTestId("td-intro");
        if (await intro.count()) {
          await shot(page, `s20-intro-${cell.key}`, "pre-match matchup intro", {
            theme: cell.theme,
          });
          await page.getByTestId("td-intro-start").click();
        }

        await expect(page.getByTestId("td-table")).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(4200); // past the reveal beat and the handoff hold
        await shot(page, `s20-auction-${cell.key}`, "auction stage: current bid hierarchy", {
          theme: cell.theme,
        });
        await shot(page, `s20-auction-full-${cell.key}`, "whole auction room, stitched", {
          fullPage: true,
          theme: cell.theme,
        });

        // A pending submit, which is the frame S20-08 is about: the clock must
        // be frozen and the submitted action shown.
        const bid = page.getByTestId("td-submit-bid");
        if ((await bid.count()) && (await bid.isEnabled())) {
          await bid.click();
          const pending = page.getByTestId("td-pending");
          if (await pending.count()) {
            await shot(page, `s20-pending-${cell.key}`, "bid pending: local clock frozen", {
              theme: cell.theme,
            });
          }
        }
      } finally {
        await context.close();
      }
    });
  }
});


// ---------------------------------------------------------------------------
// Result screens — the cells the first capture pass could not reach
// ---------------------------------------------------------------------------
test.describe("Result screens", () => {
  test("weave + showdown results at every matrix cell", async ({ browser }) => {
    test.setTimeout(900_000);
    const sub = uniqueSub("shot-result");
    const token = mintTestAccessToken(sub, `${sub}@shots.test`);

    const weave = await driveToCompletion(token, "three_man_weave", weaveMove);
    const showdown = await driveToCompletion(token, "twenty_dollar", showdownMove);

    for (const cell of MATRIX) {
      const context = await browser.newContext({ viewport: cell.viewport });
      const page = await context.newPage();
      try {
        await signIn(context, page, sub);
        await setTheme(page, cell.theme);

        await page.goto(`/arena/three-man-weave/${weave.matchId}`, {
          waitUntil: "domcontentloaded",
        });
        await expect(page.getByTestId("tmw-podium")).toBeVisible({ timeout: 40_000 });
        await shot(page, `tmw-result-${cell.key}`, "Weave result: placement + three rosters", {
          theme: cell.theme,
        });
        await shot(page, `tmw-result-full-${cell.key}`, "Weave result, stitched", {
          fullPage: true,
          theme: cell.theme,
        });

        await page.goto(`/arena/twenty-dollar/${showdown.matchId}`, {
          waitUntil: "domcontentloaded",
        });
        await expect(page.getByTestId("td-result")).toBeVisible({ timeout: 40_000 });
        await shot(page, `s20-result-${cell.key}`, "Showdown result: hero + two team cards", {
          theme: cell.theme,
        });
        await shot(page, `s20-result-full-${cell.key}`, "Showdown result, stitched", {
          fullPage: true,
          theme: cell.theme,
        });
      } finally {
        await context.close();
      }
    }
  });
});
