/**
 * MANUAL QA DRIVER — gameplay responsiveness + visual juice pass.
 *
 * NOT a spec (deliberately not named `*.spec.ts`) and outside the main
 * config's `testDir`, so it can never run as part of `npm run test:e2e` or in
 * CI. See `playwright.qa-juice.config.ts`.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import { mintTestAccessToken } from "../e2e/helpers/test-jwt";

const OUT = path.resolve(__dirname, "../../../../../design-review/qa-juice");
fs.mkdirSync(OUT, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };

function uniqueSub(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function signIn(context: BrowserContext, page: Page, sub: string): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.__peak3TestAuth !== "undefined");
  const token = mintTestAccessToken(sub, `${sub}@qa.test`);
  await page.evaluate(
    ([t, s]) => {
      window.__peak3TestAuth!.setSession(t as string, {
        id: s as string,
        email: `${s}@qa.test`,
        isAnonymous: false,
      });
    },
    [token, sub],
  );
}

/** ~`ms` of extra one-way latency on every API call, the deployed shape. */
async function addLatency(page: Page, ms: number): Promise<void> {
  await page.route("**/api/v1/**", async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

interface Recorder {
  errors: string[];
  exceptions: string[];
}

function record(page: Page): Recorder {
  const rec: Recorder = { errors: [], exceptions: [] };
  page.on("console", (msg) => {
    if (msg.type() === "error") rec.errors.push(msg.text());
  });
  page.on("pageerror", (error) => {
    rec.exceptions.push(`${error.name}: ${error.message}\n${error.stack ?? ""}`);
  });
  return rec;
}

test.describe("TMW under latency", () => {
  test("stress rearrangement", async ({ browser }) => {
    test.setTimeout(900_000);
    const context = await browser.newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    const rec = record(page);
    await addLatency(page, 400);
    const log: unknown[] = [];
    try {
      await signIn(context, page, uniqueSub("qa-tmw-lat"));
      await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
      await page.getByTestId("lobby-three_man_weave-practice").click();
      await page.waitForURL(/\/arena\/three-man-weave\/[0-9a-f-]{36}/, { timeout: 120_000 });
      await expect(page.getByTestId("tmw-room")).toBeVisible({ timeout: 120_000 });

      const overlay = page.getByTestId("tmw-pick-overlay");
      const alive = async () => (await page.getByTestId("tmw-room").count()) > 0;

      for (let turn = 0; turn < 6 && rec.exceptions.length === 0; turn += 1) {
        await overlay.waitFor({ state: "visible", timeout: 240_000 }).catch(() => {});
        if (!(await overlay.isVisible().catch(() => false))) break;

        const occupied = page.locator('[data-testid^="tmw-place-"][data-occupied="true"]');
        const n = await occupied.count();
        for (let attempt = 0; attempt < Math.min(n, 3) && rec.exceptions.length === 0; attempt += 1) {
          const source = occupied.nth(attempt);
          if (!(await source.isVisible().catch(() => false))) continue;
          const sourceId = await source.getAttribute("data-testid");
          await source.click();
          if ((await overlay.getAttribute("data-mode")) !== "moving") continue;
          const legalAll = page.locator('[data-testid^="tmw-place-"][data-legal="true"]');
          if ((await legalAll.count()) === 0) {
            await page.getByTestId("tmw-move-cancel").click();
            continue;
          }
          const preferOccupied = attempt % 2 === 0;
          const preferred = page.locator(
            `[data-testid^="tmw-place-"][data-legal="true"][data-occupied="${preferOccupied}"]`,
          );
          const destination = (await preferred.count()) > 0 ? preferred.first() : legalAll.first();
          const destId = await destination.getAttribute("data-testid");
          await destination.click();
          const confirmMove = page.getByTestId("tmw-move-confirm");
          const label = await confirmMove.textContent();

          const pressedAt = Date.now();
          // DOUBLE PRESS, then a slot click while the command is still in
          // flight -- exactly what an impatient player does over 400ms RTT.
          await confirmMove.click({ force: true });
          const ackMs = Date.now() - pressedAt;
          await confirmMove.click({ force: true }).catch(() => {});
          const other = legalAll.first();
          await other.click({ force: true }).catch(() => {});
          await page.waitForTimeout(1500);
          const settledMs = Date.now() - pressedAt;
          log.push({
            turn, attempt, sourceId, destId, label, ackMs, settledMs,
            alive: await alive(), exceptions: rec.exceptions.length,
            mode: await overlay.getAttribute("data-mode").catch(() => "gone"),
          });
          if (rec.exceptions.length > 0 || !(await alive())) {
            await page.screenshot({ path: path.join(OUT, `tmw-crash-${turn}-${attempt}.png`) });
            break;
          }
        }
        if (rec.exceptions.length > 0) break;

        if (!(await overlay.isVisible().catch(() => false))) continue;
        const candidate = page
          .locator('[data-testid="tmw-candidate-list"] button:not([disabled])')
          .first();
        if ((await candidate.count()) === 0) continue;
        await candidate.click();
        const legal = page.locator('[data-testid^="tmw-place-"][data-legal="true"]').first();
        if ((await legal.count()) === 0) continue;
        await legal.click();
        const confirm = page.getByTestId("tmw-confirm-pick");
        await expect(confirm).toBeEnabled({ timeout: 20_000 });
        await confirm.click();
        await overlay.waitFor({ state: "hidden", timeout: 120_000 }).catch(() => {});
      }

      const report = { moves: log, consoleErrors: rec.errors, pageExceptions: rec.exceptions };
      fs.writeFileSync(path.join(OUT, "tmw-latency-report.json"), JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report, null, 2));
    } finally {
      await context.close();
    }
  });
});
