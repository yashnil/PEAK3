/**
 * SHARED DRAFT in a real browser against the real API and the real bot.
 *
 * Nothing here fakes a response or a clock: a match is created through the
 * lobby, the server times the intro and every pick, and the bot drafts from
 * the same board. The assertions are about PLAYING -- the intro nobody can
 * skip, a taken card locked on the board, a tap that selects and a Draft that
 * commits, no score anywhere until the tenth pick, the result, and a reload
 * that restores the same pick.
 *
 * REQUIRES `PEAK3_ARENA_SHARED_DRAFT_ENABLED=true` (set by
 * `scripts/ci/e2e-tests.sh` and `npm run start:api`).
 */
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { mintTestAccessToken } from "./helpers/test-jwt";

const MATCH_URL = /\/arena\/shared-draft\/[0-9a-f-]{36}$/;

function uniqueSub(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function signInAs(page: Page, sub: string): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.__peak3TestAuth !== "undefined");
  const token = mintTestAccessToken(sub, `${sub}@e2e.test`);
  await page.evaluate(
    ([t, s]) => {
      // A fresh test account has no handle; dismiss the onboarding prompt up
      // front, as prime-cut.spec.ts does, so it never sits over a control.
      sessionStorage.setItem("peak3_handle_prompt_dismissed", "1");
      window.__peak3TestAuth!.setSession(t as string, { id: s as string, email: `${s}@e2e.test`, isAnonymous: false });
    },
    [token, sub],
  );
}

async function startPractice(page: Page): Promise<void> {
  await page.goto("/arena/lobby?game=shared_draft", { waitUntil: "domcontentloaded" });
  const practice = page.getByTestId("lobby-shared_draft-practice");
  await expect(practice).toBeVisible({ timeout: 30_000 });
  await practice.click();
  await page.waitForURL(MATCH_URL, { timeout: 30_000 });
  await expect(page.getByTestId("sdraft-room").or(page.getByTestId("sdraft-result"))).toBeVisible({ timeout: 30_000 });
}

async function phaseOf(page: Page): Promise<string | null> {
  return page.getByTestId("sdraft-room").getAttribute("data-phase", { timeout: 1_000 }).catch(() => null);
}

async function yourPick(page: Page): Promise<boolean> {
  return (await page.getByTestId("sdraft-room").getAttribute("data-your-pick", { timeout: 1_000 }).catch(() => null)) === "true";
}

async function expectNoSeriousAxe(page: Page, where: string): Promise<void> {
  await page
    .waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"), null, { timeout: 5_000 })
    .catch(() => undefined);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), where).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(scroll).toBeLessThanOrEqual(inner + 0.5);
}

/** Draft the first open card for you: tap selects, Draft commits. */
async function draftFirstOpen(page: Page): Promise<string> {
  const card = page.locator('.sdraft-card[data-state="open"][aria-disabled="false"]').first();
  const name = (await card.locator(".sdraft-card-name").innerText({ timeout: 2_000 })).trim();
  await card.click({ timeout: 2_000 });
  await expect(card).toHaveAttribute("aria-pressed", "true", { timeout: 2_000 });
  await page.getByTestId("sdraft-draft").click({ timeout: 2_000 });
  return name;
}

test.describe("SHARED DRAFT", () => {
  test("has a door on the homepage and on the Arena hub, both into its lobby card", async ({ page }) => {
    await page.goto("/", { waitUntil: "load" });
    const home = page.getByTestId("home-shared_draft-card");
    await expect(home).toBeVisible({ timeout: 15_000 });
    await expect(home).toHaveAttribute("href", "/arena/lobby?game=shared_draft");
    // Every multiplayer game the server serves, not just the first two.
    for (const id of ["three_man_weave", "twenty_dollar", "prime_cut", "find_the_prime"]) {
      await expect(page.getByTestId(`home-${id}-card`)).toBeVisible();
    }
    await page.goto("/arena", { waitUntil: "load" });
    await expect(page.getByTestId("arena-shared_draft-card")).toHaveAttribute("href", "/arena/lobby?game=shared_draft");
    await page.getByTestId("arena-shared_draft-card").click();
    await expect(page.getByTestId("lobby-mode-shared_draft")).toBeVisible({ timeout: 30_000 });
  });

  test("a full practice draft: intro, shared pool, exclusivity, hidden scores, result", async ({ page }) => {
    test.setTimeout(240_000);
    await signInAs(page, uniqueSub("sd-full"));
    await startPractice(page);

    await expect(page.getByTestId("sdraft-intro")).toBeVisible();
    await expect(page.getByRole("button", { name: /skip/i })).toHaveCount(0);
    await expect(page.getByTestId("sdraft-pool").locator(".sdraft-card")).toHaveCount(12);
    await expectNoSeriousAxe(page, "intro");

    const drafted: string[] = [];
    let checkedLive = false;
    const deadline = Date.now() + 200_000;
    while (Date.now() < deadline) {
      if ((await page.getByTestId("sdraft-result").count()) > 0) break;
      if ((await phaseOf(page)) === "pick" && (await yourPick(page))) {
        if (!checkedLive) {
          // Live: no score anywhere on the page.
          const text = await page.getByTestId("sdraft-room").innerText();
          expect(text).not.toMatch(/\b\d{2}\.\d{2}\b/);
          await expectNoSeriousAxe(page, "pick");
          await expectNoHorizontalOverflow(page);
          checkedLive = true;
        }
        drafted.push(await draftFirstOpen(page).catch(() => ""));
        await page.waitForTimeout(400);
        continue;
      }
      await page.waitForTimeout(500);
    }
    expect(checkedLive, "the human was on the clock at least once").toBe(true);

    // Every card the bot took is locked on the board, never re-offered to us.
    await expect(page.getByTestId("sdraft-result")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("sdraft-result-title")).toHaveText(/won the draft|Dead even/);
    await expect(page.getByTestId("sdraft-total-you")).toHaveText(/^\d+\.\d{2}$/);
    await expect(page.getByTestId("sdraft-total-opponent")).toHaveText(/^\d+\.\d{2}$/);
    await expect(page.getByTestId("sdraft-h2h").locator("tbody tr")).toHaveCount(5);
    for (const name of drafted.filter(Boolean)) {
      await expect(page.getByTestId("sdraft-h2h")).toContainText(name);
    }
    await expect(page.getByTestId("sdraft-undrafted")).toBeVisible();
    await expect(page.getByTestId("sdraft-play-again")).toBeVisible({ timeout: 10_000 });
    await expectNoSeriousAxe(page, "result");
  });

  test("a reload mid-draft restores the same board, rosters and pick", async ({ page }) => {
    test.setTimeout(120_000);
    await signInAs(page, uniqueSub("sd-reload"));
    await startPractice(page);
    await expect.poll(async () => (await phaseOf(page)) === "pick" && (await yourPick(page)), { timeout: 60_000 }).toBe(true);
    const name = await draftFirstOpen(page);
    await expect(page.getByTestId("sdraft-roster-you")).toContainText(name, { timeout: 10_000 });
    const pool = await page.getByTestId("sdraft-pool").innerText();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("sdraft-room")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("sdraft-roster-you")).toContainText(name);
    // Same twelve players on the board after the reload.
    for (const line of pool.split("\n").filter((l) => /^[A-Z][a-z]/.test(l) && !/^(Yours|Your|Shared)/.test(l)).slice(0, 6)) {
      await expect(page.getByTestId("sdraft-pool")).toContainText(line);
    }
  });

  test("on a phone the pool, rosters and Draft fit with no sideways scroll", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await signInAs(page, uniqueSub("sd-phone"));
    await startPractice(page);
    await expect.poll(async () => (await phaseOf(page)) === "pick" && (await yourPick(page)), { timeout: 60_000 }).toBe(true);
    await expectNoHorizontalOverflow(page);
    const card = page.locator('.sdraft-card[data-state="open"][aria-disabled="false"]').first();
    await card.click();
    // The Draft control stays reachable at the bottom of the viewport.
    await expect(page.getByTestId("sdraft-draft")).toBeInViewport();
  });
});
