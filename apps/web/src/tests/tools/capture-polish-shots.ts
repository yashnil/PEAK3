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
        await page.waitForTimeout(1600); // let the lot reveal beat settle
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
