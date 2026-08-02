/**
 * Review-screenshot capture for the UX / organization / polish pass.
 *
 * NOT a spec (deliberately not named *.spec.ts) and outside the main config's
 * testDir, so it can never run as part of `npm run test:e2e` or in CI. It
 * writes files into the repo, which is not an assertion about product
 * behaviour.
 *
 * Reachable only via (from apps/web):
 *   npx playwright test --config=playwright.ux-polish-shots.config.ts
 *
 * Every frame is the real product against a real API on ports 8011/3001.
 *
 * Design notes
 * ------------
 * - Each capture is its own `test()` so one missing surface cannot silence the
 *   rest of the sheet. A capture that cannot reach its surface FAILS loudly
 *   rather than writing a misleading frame of the wrong screen — a screenshot
 *   review is worthless if a frame might be something other than what its
 *   filename claims.
 * - `shot()` records what it captured into a manifest so the reviewer (and the
 *   final report's screenshot index) reads generated truth rather than an
 *   assumption about what was on screen.
 */
import { test, expect, type Page, type Locator } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const OUT = path.resolve(__dirname, "../../../../../docs/implementation/ux-polish-review");
const MANIFEST = path.join(OUT, "screenshot-manifest.json");

/** The six viewports the brief requires. */
export const VIEWPORTS = {
  "1440x900": { width: 1440, height: 900 },
  "1728x1117": { width: 1728, height: 1117 },
  "1024x768": { width: 1024, height: 768 },
  "768x1024": { width: 768, height: 1024 },
  "430x932": { width: 430, height: 932 },
  "390x844": { width: 390, height: 844 },
} as const;

type ViewportName = keyof typeof VIEWPORTS;

fs.mkdirSync(OUT, { recursive: true });

interface ManifestEntry {
  file: string;
  viewport: string;
  url: string;
  title: string;
  note: string;
  reducedMotion: boolean;
  h1: string | null;
  /**
   * MD5 of the PNG bytes.
   *
   * Recorded because the first capture run silently produced two pairs of
   * byte-identical frames under different names -- a "guided tour step 1" that
   * was really the perk-select screen with no tour on it, and a "reduced
   * motion" homepage that was really the ordinary full-page shot. Both were
   * listed in the manifest as distinct evidence. A hash makes that detectable
   * by anyone reading the manifest, not only by someone who happens to md5 the
   * directory.
   */
  md5: string;
}

function appendManifest(entry: ManifestEntry) {
  let rows: ManifestEntry[] = [];
  if (fs.existsSync(MANIFEST)) {
    try {
      rows = JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as ManifestEntry[];
    } catch {
      rows = [];
    }
  }
  rows = rows.filter((r) => r.file !== entry.file);
  rows.push(entry);
  rows.sort((a, b) => a.file.localeCompare(b.file));
  fs.writeFileSync(MANIFEST, JSON.stringify(rows, null, 2) + "\n");
}

/**
 * Capture a frame and record what it actually was.
 *
 * `fullPage` defaults to false: the brief asks about first viewports and
 * hierarchy, and a full-page shot of a long page hides exactly the "what does
 * the first screen look like" question. Pass `fullPage: true` where the whole
 * document is the subject (catalog, completion receipt).
 */
async function shot(
  page: Page,
  name: string,
  opts: { note: string; fullPage?: boolean; reducedMotion?: boolean } = { note: "" },
) {
  const file = `${name}.png`;
  await page.waitForTimeout(220);
  const target = path.join(OUT, file);
  await page.screenshot({ path: target, fullPage: opts.fullPage ?? false });
  const md5 = crypto.createHash("md5").update(fs.readFileSync(target)).digest("hex");
  const size = page.viewportSize();
  const h1 = await page
    .locator("h1")
    .first()
    .textContent()
    .catch(() => null);
  appendManifest({
    file,
    viewport: size ? `${size.width}x${size.height}` : "unknown",
    url: page.url(),
    title: await page.title(),
    note: opts.note,
    reducedMotion: opts.reducedMotion ?? false,
    h1: h1 ? h1.replace(/\s+/g, " ").trim() : null,
    md5,
  });
}

async function setViewport(page: Page, name: ViewportName) {
  await page.setViewportSize(VIEWPORTS[name]);
}

/** First locator in the list that exists and is visible, else null. */
async function firstVisible(page: Page, selectors: string[]): Promise<Locator | null> {
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if ((await el.count()) > 0 && (await el.isVisible().catch(() => false))) return el;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 1-4. Homepage, nav, catalog
// ---------------------------------------------------------------------------

test("01 homepage first viewport (all six sizes)", async ({ page }) => {
  for (const name of Object.keys(VIEWPORTS) as ViewportName[]) {
    await setViewport(page, name);
    await page.goto("/");
    await expect(page.locator("h1")).toHaveCount(1);
    await shot(page, `01-home-${name}`, { note: `Homepage first viewport at ${name}` });
  }
  // Full-page desktop, to judge overall hierarchy and section rhythm.
  await setViewport(page, "1440x900");
  await page.goto("/");
  await shot(page, "01f-home-fullpage-1440x900", {
    note: "Homepage, entire document",
    fullPage: true,
  });
});

test("02 desktop Play menu open", async ({ page }) => {
  await setViewport(page, "1440x900");
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Play", exact: true });
  await expect(trigger, "the Play menu trigger must be a button").toBeVisible();
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await shot(page, "02-play-menu-open-1440x900", { note: "Desktop Play menu, opened by click" });

  // Keyboard-opened state, to prove the menu is not pointer-only.
  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await shot(page, "02b-play-menu-keyboard-1440x900", {
    note: "Play menu opened with ArrowDown; focus is on the first item",
  });

  // 200% zoom: the brief requires the nav to stay usable.
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 720, height: 450 }); // ~1440x900 at 200%
  await page.goto("/");
  const zoomTrigger = page.getByRole("button", { name: "Play", exact: true });
  if (await zoomTrigger.isVisible().catch(() => false)) {
    await zoomTrigger.click();
    await shot(page, "02c-play-menu-200pct-zoom", {
      note: "Play menu at a 720x450 viewport, standing in for 1440x900 at 200% zoom",
    });
  }
});

test("03 mobile nav drawer open", async ({ page }) => {
  for (const name of ["390x844", "430x932"] as ViewportName[]) {
    await setViewport(page, name);
    await page.goto("/");
    const burger = page.getByRole("button", { name: /navigation menu/i });
    await expect(burger).toBeVisible();
    await burger.click();
    await shot(page, `03-mobile-nav-${name}`, { note: `Mobile navigation drawer open at ${name}` });
  }
});

test("04 ways to play catalog", async ({ page }) => {
  await setViewport(page, "1440x900");
  await page.goto("/arena");
  await expect(page.locator('[data-testid="arena-flagship-card"]')).toBeVisible();
  await shot(page, "04-arena-catalog-1440x900", {
    note: "/arena — the full catalog",
    fullPage: true,
  });
  await setViewport(page, "768x1024");
  await page.goto("/arena");
  await shot(page, "04b-arena-catalog-768x1024", { note: "/arena at tablet width", fullPage: true });
});

// ---------------------------------------------------------------------------
// 5-14. RUN THE TABLE
// ---------------------------------------------------------------------------

test("05 run the table start / mode choice", async ({ page }) => {
  await setViewport(page, "1440x900");
  await page.goto("/arena/run-the-table");
  await expect(page.locator('[data-testid="rtt-start-gate"]')).toBeVisible();
  await shot(page, "05-rtt-start-gate-1440x900", {
    note: "Direct visit to /arena/run-the-table still shows the start gate (no run created)",
    fullPage: true,
  });
  await setViewport(page, "390x844");
  await page.goto("/arena/run-the-table");
  await shot(page, "05b-rtt-start-gate-390x844", { note: "Start gate on mobile", fullPage: true });
});

/**
 * Drives one real run and captures each surface as it is reached.
 *
 * Written as a single test because a run is a stateful sequence — restarting
 * per frame would produce frames from different runs, which is exactly the kind
 * of quiet inconsistency a screenshot review is supposed to catch.
 */
test("06-14 one real run: tour, nodes, trade, battle, completion", async ({ page }) => {
  test.setTimeout(300_000);
  await setViewport(page, "1440x900");
  await page.goto("/arena/run-the-table?seed=424242");

  const start = page.locator('[data-testid="rtt-start-standard"]');
  await expect(start).toBeVisible();
  await start.click();
  await expect(page.locator('[data-testid="rtt-start-gate"]')).toHaveCount(0, { timeout: 30_000 });

  // --- guided tour -------------------------------------------------------
  //
  // Captured as a REQUIRED surface, not a best-effort one.
  //
  // The first run of this tool wrote `06-tour-step-1.png` from whatever screen
  // happened to be showing when no tour appeared, and the file came out
  // byte-identical to the perk-select frame while the manifest described it as
  // "Guided tour step 1". A screenshot review is worthless if a frame might be
  // something other than what its filename claims, so this now asserts the
  // overlay is really up and fails the capture if it is not.
  //
  // localStorage is cleared FIRST so the auto-start path is the one exercised —
  // the tour is once per browser profile, and a stale "seen" record was the
  // reason it never appeared.
  await page.evaluate(() => window.localStorage.removeItem("peak3.tour.state"));
  await page.reload({ waitUntil: "load" });
  await expect(page.locator('[data-testid="rtt-shell"]')).toBeVisible({ timeout: 30_000 });

  const tour = page.getByTestId("guided-tour");
  await expect(tour, "the guided tour must auto-start on a first run").toBeVisible({
    timeout: 20_000,
  });

  for (let i = 1; i <= 8; i += 1) {
    // The step name comes from the component, so the manifest records which
    // region was actually spotlit rather than a guess.
    const step = (await tour.getAttribute("data-step")) ?? `step-${i}`;
    await shot(page, `06-tour-${String(i).padStart(2, "0")}-${step}`, {
      note: `Guided tour step ${i} — spotlighting "${step}"`,
    });
    const next = page.getByTestId("guided-tour-next");
    if ((await next.count()) === 0 || !(await next.isEnabled())) break;
    const before = step;
    await next.click();
    // Stop when the tour closes on its own at the last step.
    if ((await tour.count()) === 0) break;
    await expect(tour).not.toHaveAttribute("data-step", before);
  }

  if ((await tour.count()) > 0) {
    await page.keyboard.press("Escape");
    await expect(tour).toHaveCount(0);
  }

  // --- walk the run ------------------------------------------------------
  const seen = new Set<string>();
  const captureSurface = async () => {
    const surfaces: [string, string, string][] = [
      ["rtt-system-select", "07-system-select", "Front Office Perk selection"],
      ["rtt-node-choice", "08-node-choice", "Path choice between two node types"],
      ["rtt-draft-room", "09-draft-room", "Draft Room"],
      ["rtt-trade-desk", "10-trade-desk", "Trade Desk"],
      ["rtt-choice-node", "11-choice-node", "Film Room / Rest-Bank"],
      ["rtt-boss-preview", "12-boss-preview", "Boss pre-battle"],
      ["rtt-battle-reveal", "13-battle-reveal", "Boss reveal"],
      ["rtt-result", "14-completion", "Completion receipt"],
    ];
    for (const [testid, name, note] of surfaces) {
      if (seen.has(testid)) continue;
      const el = page.locator(`[data-testid="${testid}"]`);
      if ((await el.count()) > 0 && (await el.isVisible().catch(() => false))) {
        seen.add(testid);
        await shot(page, `${name}-1440x900`, { note, fullPage: testid === "rtt-result" });
        // Trade Desk gets a second frame: an outgoing selection, then review.
        if (testid === "rtt-trade-desk") {
          const out = page.locator('[data-testid^="rtt-trade-out-"]').first();
          if ((await out.count()) > 0 && (await out.isEnabled().catch(() => false))) {
            await out.click();
            await page.waitForTimeout(250);
            await shot(page, "10b-trade-desk-outgoing-selected-1440x900", {
              note: "Trade Desk with one outgoing player selected — only that card is highlighted",
            });
            const inc = page
              .locator('[data-testid^="rtt-trade-in-"]:not([aria-disabled="true"])')
              .first();
            if ((await inc.count()) > 0) {
              await inc.click();
              await page.waitForTimeout(250);
              await shot(page, "11b-trade-desk-review-1440x900", {
                note: "Trade Desk review: net credits, roles before/after, lane deltas",
              });
            }
          }
        }
        return true;
      }
    }
    return false;
  };

  for (let guard = 0; guard < 120; guard += 1) {
    await captureSurface();
    if (seen.has("rtt-result")) break;

    const advance = await firstVisible(page, [
      '[data-testid="rtt-battle-advance"]',
      '[data-testid="rtt-battle-skip"]',
      '[data-testid="rtt-resolve-boss"]',
      '[data-testid="rtt-draft-pass"]',
      '[data-testid="rtt-trade-decline"]',
      '[data-testid="rtt-system-select"] button:not([disabled])',
      '[data-testid="rtt-node-choice"] button:not([disabled])',
      '[data-testid="rtt-choice-node"] button:not([disabled])',
    ]);
    if (!advance) break;
    await advance.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  // Mobile frames of whatever the run ended on.
  await setViewport(page, "390x844");
  await page.waitForTimeout(300);
  await shot(page, "14b-rtt-final-390x844", {
    note: "RUN THE TABLE final surface on mobile",
    fullPage: true,
  });
});

// ---------------------------------------------------------------------------
// 15-16. 82-0 spinner
// ---------------------------------------------------------------------------

test("15-16 82-0 team spin and season reel", async ({ page }) => {
  test.setTimeout(180_000);
  await setViewport(page, "1440x900");
  await page.goto("/arena/court/practice/apex_1y?seed=777");
  const begin = page.locator('[data-testid="begin-run-btn"]');
  await expect(begin).toBeVisible();
  await shot(page, "15a-82-0-start-gate-1440x900", { note: "82-0 start gate", fullPage: true });
  await begin.click();

  const stage = page.locator('[data-testid="spin-stage"]');
  await expect(stage).toBeVisible({ timeout: 30_000 });
  // Mid-flight frame: sampled while the reels are still moving.
  await page.waitForTimeout(600);
  await shot(page, "15-82-0-team-spin-in-motion-1440x900", {
    note: "82-0 spinner mid-flight (sampled ~600ms into the ceremony)",
  });
  await expect(stage).toHaveAttribute("data-phase", "revealed", { timeout: 30_000 });
  await shot(page, "16-82-0-season-reel-revealed-1440x900", {
    note: "82-0 franchise x season lockup after the snap",
  });
  await setViewport(page, "390x844");
  await shot(page, "16b-82-0-revealed-390x844", { note: "82-0 reveal on mobile" });
});

// ---------------------------------------------------------------------------
// 17-19. Rankings, focus, reduced motion
// ---------------------------------------------------------------------------

test("17 rankings with version and provenance", async ({ page }) => {
  await setViewport(page, "1440x900");
  await page.goto("/rankings");
  await expect(page.getByRole("heading", { name: /peak3 rankings/i })).toBeVisible();
  await expect(page.locator('[data-testid="rankings-model-version"]')).toBeVisible();
  await shot(page, "17-rankings-1440x900", {
    note: "Rankings with model version and provenance",
  });
  await page.locator('[data-testid="rankings-provenance"]').first().scrollIntoViewIfNeeded();
  await shot(page, "17b-rankings-provenance-1440x900", { note: "Provenance strip in view" });
  await setViewport(page, "390x844");
  await page.goto("/rankings");
  await shot(page, "17c-rankings-390x844", { note: "Rankings on mobile" });
});

test("18 keyboard focus states", async ({ page }) => {
  await setViewport(page, "1440x900");
  await page.goto("/");
  // Walk the first several tab stops so the frame shows a real focus ring on a
  // real control rather than a synthesised :focus class.
  for (let i = 0; i < 3; i += 1) await page.keyboard.press("Tab");
  await shot(page, "18-focus-home-nav-1440x900", {
    note: "Focus ring after three Tab presses from the top of the homepage",
  });
  await page.goto("/arena/run-the-table");
  for (let i = 0; i < 6; i += 1) await page.keyboard.press("Tab");
  await shot(page, "18b-focus-rtt-start-gate-1440x900", {
    note: "Focus ring inside the RUN THE TABLE start gate",
  });
});

test("19 reduced-motion state", async ({ page }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setViewport(page, "1440x900");
  await page.goto("/");
  await shot(page, "19-reduced-motion-home-1440x900", {
    note:
      "Homepage under prefers-reduced-motion: reduce. At rest this is expected to " +
      "look identical to the ordinary homepage — reduced motion removes movement, " +
      "not content — so compare the md5 in the manifest before treating a match as " +
      "a capture bug. 19b is the frame where the difference is actually visible.",
    reducedMotion: true,
    fullPage: true,
  });
  await page.goto("/arena/court/practice/apex_1y?seed=777");
  const begin = page.locator('[data-testid="begin-run-btn"]');
  if (await begin.isVisible().catch(() => false)) {
    await begin.click();
    const stage = page.locator('[data-testid="spin-stage"]');
    // 500ms is the ceiling courtbuilder.spec.ts asserts for the reduced-motion
    // path: no ceremony timers may run. Captured here as visual evidence of the
    // same guarantee the suite enforces numerically.
    await expect(stage).toHaveAttribute("data-phase", "revealed", { timeout: 500 });
    await expect(page.locator(".spin-ceremony-spinning")).toHaveCount(0);
    await shot(page, "19b-reduced-motion-82-0-1440x900", {
      note:
        "82-0 reveal under reduced motion — revealed within 500ms with zero " +
        "spin-ceremony-spinning elements, i.e. stepped straight to the result",
      reducedMotion: true,
    });
  }
});
