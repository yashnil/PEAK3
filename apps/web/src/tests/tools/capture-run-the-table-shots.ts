/**
 * Review-screenshot capture for RUN THE TABLE.
 *
 * NOT a spec (deliberately not named *.spec.ts) and outside the main config's
 * testDir, so it can never run as part of `npm run test:e2e` or in CI. It
 * writes files into the repo, which is not an assertion about product
 * behaviour.
 *
 * Reachable only via:
 *   npx playwright test --config=playwright.rtt-screenshots.config.ts
 *
 * It drives a real anonymous run against a real API on ports 8010/3010, so
 * every frame is the actual product rather than a mock.
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(__dirname, "../../../../../docs/implementation/run-the-table-review");
const DESKTOP = { width: 1440, height: 1000 };
const MOBILE = { width: 390, height: 844 };

fs.mkdirSync(OUT, { recursive: true });

async function shot(page: Page, name: string) {
  await page.waitForTimeout(250); // let the reduced-motion transition settle
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}

/** Advance one step from whatever screen we are on. Returns false at the end. */
async function step(page: Page): Promise<boolean> {
  const tryClick = async (sel: string) => {
    const el = page.locator(sel).first();
    if ((await el.count()) && (await el.isVisible()) && (await el.isEnabled())) {
      await el.click();
      await page.waitForTimeout(400);
      return true;
    }
    return false;
  };

  if (await page.locator('[data-testid="rtt-result"]').count()) return false;

  // System select → first System
  if (await page.locator('[data-testid="rtt-system-select"]').count()) {
    if (await tryClick('[data-testid="rtt-system-select"] button:not([disabled])')) return true;
  }
  // Node choice → prefer a Draft Room so the roster decision gets captured.
  if (await page.locator('[data-testid="rtt-node-choice"]').count()) {
    const draft = page
      .locator('[data-testid="rtt-node-choice"] button')
      .filter({ hasText: /Draft Room/i });
    if ((await draft.count()) && (await draft.first().isEnabled())) {
      await draft.first().click();
      await page.waitForTimeout(400);
      return true;
    }
    if (await tryClick('[data-testid="rtt-node-choice"] button:not([disabled])')) return true;
  }
  // Draft room → pass (keeps the walkthrough deterministic and short)
  if (await tryClick('[data-testid="rtt-draft-pass"]')) return true;
  if (await tryClick('[data-testid="rtt-trade-decline"]')) return true;
  // Film / Rest choice node → first ENABLED choice. "Recover a life" is
  // correctly disabled at full lives (with a reason), so `.first()` alone
  // would stall here.
  if (await page.locator('[data-testid="rtt-choice-node"]').count()) {
    if (await tryClick('[data-testid="rtt-choice-node"] button:not([disabled])')) return true;
  }
  if (await tryClick('[data-testid="rtt-resolve-boss"]')) return true;
  // `advance` before `skip`: "Reveal instantly" stays rendered after the reveal
  // completes, so probing it first spins on an already-revealed battle.
  if (await tryClick('[data-testid="rtt-battle-advance"]')) return true;
  if (await tryClick('[data-testid="rtt-battle-skip"]')) return true;
  return false;
}

test("capture RUN THE TABLE review screenshots", async ({ page }) => {
  test.setTimeout(180_000);

  // --- desktop -------------------------------------------------------------
  await page.setViewportSize(DESKTOP);

  await page.goto("/");
  await expect(page.locator("h1")).toContainText("Run the table.");
  await shot(page, "01-home-desktop");

  await page.goto("/arena");
  await expect(page.getByTestId("arena-flagship-card")).toBeVisible();
  await shot(page, "02-arena-hub-desktop");

  await page.goto("/arena/run-the-table?seed=12345");
  await expect(page.getByTestId("rtt-start-gate")).toBeVisible({ timeout: 30_000 });
  await shot(page, "03-start-gate-desktop");

  await page.getByTestId("rtt-start-standard").click();
  await expect(page.getByTestId("rtt-shell")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("rtt-system-select")).toBeVisible();
  await shot(page, "04-system-select-desktop");

  await page.locator('[data-testid="rtt-system-select"] button').first().click();
  await expect(page.getByTestId("rtt-node-choice")).toBeVisible({ timeout: 15_000 });
  await shot(page, "05-node-choice-desktop");

  // Walk until a Draft Room appears so the roster decision is captured.
  for (let i = 0; i < 12; i++) {
    if (await page.locator('[data-testid="rtt-draft-room"]').count()) break;
    if (!(await step(page))) break;
  }
  if (await page.locator('[data-testid="rtt-draft-room"]').count()) {
    await shot(page, "06-draft-room-desktop");
  }

  // Walk to the first battle.
  for (let i = 0; i < 20; i++) {
    if (await page.locator('[data-testid="rtt-battle-reveal"]').count()) break;
    if (!(await step(page))) break;
  }
  if (await page.locator('[data-testid="rtt-battle-reveal"]').count()) {
    await shot(page, "07-battle-reveal-desktop");
  }

  // Walk to the end of the run.
  for (let i = 0; i < 90; i++) {
    if (await page.locator('[data-testid="rtt-result"]').count()) break;
    if (!(await step(page))) break;
  }
  await expect(page.getByTestId("rtt-result")).toBeVisible({ timeout: 30_000 });
  await shot(page, "08-result-desktop");

  // --- mobile --------------------------------------------------------------
  // Clear the stored run pointer first: the desktop run above is finished but
  // still resumable, so without this the mobile leg correctly resumes it
  // instead of showing the start gate.
  await page.evaluate(() => window.localStorage.clear());
  await page.setViewportSize(MOBILE);
  await page.goto("/arena/run-the-table?seed=777");
  await expect(page.getByTestId("rtt-start-gate")).toBeVisible({ timeout: 30_000 });
  await shot(page, "09-start-gate-mobile");

  await page.getByTestId("rtt-start-standard").click();
  await expect(page.getByTestId("rtt-shell")).toBeVisible({ timeout: 30_000 });
  await shot(page, "10-system-select-mobile");

  await page.locator('[data-testid="rtt-system-select"] button').first().click();
  await expect(page.getByTestId("rtt-node-choice")).toBeVisible({ timeout: 15_000 });
  await shot(page, "11-node-choice-mobile");

  for (let i = 0; i < 12; i++) {
    if (await page.locator('[data-testid="rtt-draft-room"]').count()) break;
    if (!(await step(page))) break;
  }
  if (await page.locator('[data-testid="rtt-draft-room"]').count()) {
    await shot(page, "12-draft-room-mobile");
  }

  for (let i = 0; i < 20; i++) {
    if (await page.locator('[data-testid="rtt-battle-reveal"]').count()) break;
    if (!(await step(page))) break;
  }
  if (await page.locator('[data-testid="rtt-battle-reveal"]').count()) {
    await shot(page, "13-battle-reveal-mobile");
  }

  for (let i = 0; i < 90; i++) {
    if (await page.locator('[data-testid="rtt-result"]').count()) break;
    if (!(await step(page))) break;
  }
  await expect(page.getByTestId("rtt-result")).toBeVisible({ timeout: 30_000 });
  await shot(page, "14-result-mobile");

  // Horizontal overflow is the repo's standing mobile contract.
  const overflow = await page.evaluate(
    () => document.body.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(4);

  // eslint-disable-next-line no-console
  console.log(`\nScreenshots written to ${OUT}\n${fs.readdirSync(OUT).sort().join("\n")}`);
});
