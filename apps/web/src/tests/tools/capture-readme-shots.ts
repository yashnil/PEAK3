/**
 * TEMPORARY, NOT PART OF THE SUITE.
 *
 * Captures the README screenshots into docs/assets/readme/. Deleted after the
 * files are generated -- it is a build tool wearing a spec file's clothes
 * (that shape is deliberate: it inherits playwright.config's webServer, so the
 * API comes up with the same flags CI uses, most importantly
 * ENABLE_EXTERNAL_ASSET_URLS=false -> no ESPN/NBA headshots or team logos in
 * the frames).
 *
 * Run from apps/web with:
 *   npx playwright test --config=playwright.screenshots.config.ts
 *
 * Deliberately NOT named *.spec.ts: it lives outside the e2e testDir so CI
 * cannot run it, and the plain .ts name also keeps vitest's default
 * *.{test,spec}.ts glob from collecting it as a unit test. The screenshots
 * config matches it explicitly.
 *
 * reducedMotion is set at CONTEXT level in that config rather than via
 * emulateMedia() mid-test: the first attempt at the modal shot emulated it
 * after the dialog had already opened and captured it mid-entrance, with the
 * table showing straight through the panel.
 */
import { test, expect, Page } from "@playwright/test";
import path from "node:path";

const OUT = path.resolve(__dirname, "../../../../../docs/assets/readme");

test.use({ viewport: { width: 1280, height: 900 } });

/** Hard safety gate: if the API is serving external asset URLs, abort rather
 *  than write a frame that could contain an unlicensed logo or headshot. */
async function assertExternalAssetsOff(page: Page): Promise<void> {
  const res = await page.request.get(
    "http://localhost:8000/api/v1/perfect-season/readiness?mode=apex_1y",
  );
  expect(res.ok(), "readiness endpoint must respond").toBeTruthy();
  const body = await res.json();
  expect(
    Object.keys(body.team_logo_urls ?? {}),
    "team logo URLs must be empty — refusing to capture unlicensed logos",
  ).toHaveLength(0);

  // Headshots ride the same flag but a different endpoint (peaks.py), so check
  // both rather than inferring one from the other.
  const peaks = await page.request.get("http://localhost:8000/api/v1/peaks?window=1y&limit=5");
  expect(peaks.ok(), "peaks endpoint must respond").toBeTruthy();
  const peaksBody = await peaks.json();
  for (const row of peaksBody.rows ?? []) {
    expect(
      row.headshot_url ?? null,
      "player headshot URLs must be absent — refusing to capture unlicensed photos",
    ).toBeNull();
  }
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  // The Next.js dev-tools indicator floats over the bottom-left corner of every
  // page. It is a local-dev artifact, not product UI, so it must not ship in a
  // README image. Hidden here rather than by touching next.config.
  await page.addStyleTag({
    content: "nextjs-portal, [data-nextjs-dev-tools-button] { display: none !important; }",
  });
  // Small fixed pause so any remaining transition lands before the shutter.
  await page.waitForTimeout(600);
}

test("capture homepage", async ({ page }) => {
  await page.goto("/", { waitUntil: "load" });
  await assertExternalAssetsOff(page);
  await settle(page);
  await page.screenshot({ path: `${OUT}/homepage.png` });
});

test("capture 82-0 start gate", async ({ page }) => {
  await page.goto("/arena/court/practice/apex_1y", { waitUntil: "load" });
  await assertExternalAssetsOff(page);
  await expect(page.locator('[data-testid="peak-season-start-gate"]')).toBeVisible({
    timeout: 15_000,
  });
  await settle(page);
  await page.screenshot({ path: `${OUT}/peak-season-start.png` });
});

test("capture 82-0 result", async ({ page }) => {
  test.setTimeout(180_000);
  await assertExternalAssetsOff(page);
  // Fixed seed so the screenshot is reproducible.
  await page.goto("/arena/court/practice/apex_1y?seed=42", { waitUntil: "load" });
  const begin = page.locator('[data-testid="begin-run-btn"]');
  await begin.waitFor({ state: "visible", timeout: 15_000 });
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/perfect-season/games") && r.request().method() === "POST",
    ),
    begin.click(),
  ]);
  await expect(page.locator('[data-testid="court-builder"]')).toBeVisible({ timeout: 15_000 });

  for (let i = 0; i < 8; i++) {
    const scored = page.locator(
      '[data-testid="candidate-card"]:not(:has([data-testid="candidate-unscored-badge"]))',
    );
    const any = page.locator('[data-testid="candidate-card"]').first();
    await any.waitFor({ state: "visible", timeout: 20_000 });
    const candidate = (await scored.count()) > 0 ? scored.first() : any;
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/select") && r.status() === 200),
      candidate.click(),
    ]);
    const slot = page.locator('button[data-testid="court-slot"][data-filled="false"]').first();
    await slot.waitFor({ state: "visible", timeout: 20_000 });
    const before = await page.locator('[data-testid="court-slot"][data-filled="true"]').count();
    await slot.click();
    await expect(page.locator('[data-testid="court-slot"][data-filled="true"]')).toHaveCount(
      before + 1,
      { timeout: 20_000 },
    );
  }

  // Ratings stay hidden until the user commits to the lineup — the result only
  // exists after this explicit step.
  const completeBtn = page.locator('[data-testid="complete-season-btn"]');
  await completeBtn.waitFor({ state: "visible", timeout: 20_000 });
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/complete") && r.status() === 200),
    completeBtn.click(),
  ]);

  const result = page.locator('[data-testid="season-result"]');
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result.locator('[data-testid="half-court"]')).toBeVisible({ timeout: 15_000 });
  await settle(page);

  // A single element.screenshot() of this (very tall) card came out with a
  // black band where the half-court and AI recap should be: sections animated
  // in on scroll had never entered the viewport, so they were captured at
  // their initial opacity. Walk the page top-to-bottom to trigger them, then
  // return to the top before framing the shot.
  await page.evaluate(async () => {
    const step = window.innerHeight / 2;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(500);
  await result.screenshot({ path: `${OUT}/peak-season-result.png` });
});

test("capture rankings", async ({ page }) => {
  await page.goto("/rankings", { waitUntil: "load" });
  await assertExternalAssetsOff(page);
  await expect(page.locator('[data-testid="pool-tab-peak-windows"]')).toBeVisible({
    timeout: 20_000,
  });
  await settle(page);
  await page.screenshot({ path: `${OUT}/rankings.png` });
});

test("capture the unified player analysis", async ({ page }) => {
  // Taller than the other shots: the analysis is long, and at 900px the first
  // capture cut off the "what raises or lowers it" section mid-sentence.
  await page.setViewportSize({ width: 1280, height: 1150 });
  await page.goto("/rankings", { waitUntil: "load" });
  await assertExternalAssetsOff(page);
  await expect(page.locator('[data-testid="pool-tab-peak-windows"]')).toBeVisible({
    timeout: 20_000,
  });
  await page.locator('[data-testid="rankings-row"]').first().click();
  const panel = page.getByRole("dialog");
  await expect(panel).toBeVisible({ timeout: 15_000 });
  // The score breakdown expanded, so the README frame shows both halves of the
  // unified analysis rather than only the chart.
  await page.getByTestId("rk-fold-breakdown").locator("summary").click();
  await expect(page.getByTestId("component-breakdown")).toBeVisible();
  await settle(page);
  await page.screenshot({ path: `${OUT}/rankings-explain.png` });
});
