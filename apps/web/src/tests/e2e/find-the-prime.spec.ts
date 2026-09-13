/**
 * FIND THE PRIME in a real browser against the real API and the real bots.
 *
 * A match is created through the lobby; the server times every phase; three
 * tiered bots lock their own windows. The journeys: place, move and lock a
 * window; see the ridge and the receipt every round; meet all three lengths;
 * finish out of 900 with a podium; rematch; reload mid-round and find the
 * staged window still there; let a round run out and score nothing.
 *
 * REQUIRES `PEAK3_ARENA_FIND_THE_PRIME_ENABLED=true`.
 */
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { mintTestAccessToken } from "./helpers/test-jwt";

const MATCH_URL = /\/arena\/find-the-prime\/[0-9a-f-]{36}$/;

function uniqueSub(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function signInAs(page: Page, sub: string): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.__peak3TestAuth !== "undefined");
  const token = mintTestAccessToken(sub, `${sub}@e2e.test`);
  await page.evaluate(
    ([t, s]) => {
      window.__peak3TestAuth!.setSession(t as string, { id: s as string, email: `${s}@e2e.test`, isAnonymous: false });
    },
    [token, sub],
  );
}

async function startPractice(page: Page): Promise<string> {
  await page.goto("/arena/lobby?game=find_the_prime", { waitUntil: "domcontentloaded" });
  const practice = page.getByTestId("lobby-find_the_prime-practice");
  await expect(practice).toBeVisible({ timeout: 30_000 });
  await practice.click();
  await page.waitForURL(MATCH_URL, { timeout: 30_000 });
  await expect(page.getByTestId("fprime-room")).toBeVisible({ timeout: 30_000 });
  return page.url().split("/").pop() as string;
}

async function settled(page: Page): Promise<void> {
  await page
    .waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"), null, { timeout: 5_000 })
    .catch(() => undefined);
}

async function expectNoSeriousAxe(page: Page, where: string): Promise<void> {
  await settled(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), where).toEqual([]);
}

async function phaseOf(page: Page): Promise<string | null> {
  return page.getByTestId("fprime-room").getAttribute("data-phase", { timeout: 1_000 }).catch(() => null);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(scroll).toBeLessThanOrEqual(inner + 0.5);
}

async function placeWindow(page: Page): Promise<string> {
  const firstEnabled = page.locator('[data-testid^="fprime-season-"]:not([disabled])').first();
  await firstEnabled.click();
  await expect(page.getByTestId("fprime-selection")).toContainText(" to ");
  return page.getByTestId("fprime-selection").innerText();
}

test.describe("FIND THE PRIME", () => {
  test("a full match: place, move and lock windows, nine reveals, a total out of 900 and a rematch", async ({ page }) => {
    test.setTimeout(480_000);
    await signInAs(page, uniqueSub("ftp-full"));
    const firstMatch = await startPractice(page);
    await expect(page.getByTestId("fprime-intro")).toBeVisible();
    await expect(page.getByRole("button", { name: /skip/i })).toHaveCount(0);

    const lengths = new Set<string>();
    const revealed = new Set<string>();
    let movedOnce = false;
    let axedDecide = false;
    let axedReveal = false;
    const deadline = Date.now() + 440_000;
    while (Date.now() < deadline) {
      if ((await page.getByTestId("fprime-result").count()) > 0) break;
      const phase = await phaseOf(page);
      try {
        if (phase === "decide" && (await page.getByTestId("fprime-lock").count()) > 0) {
          lengths.add(await page.getByTestId("fprime-length").innerText());
          const before = await placeWindow(page);
          if (!movedOnce) {
            const later = page.getByTestId("fprime-later");
            const earlier = page.getByTestId("fprime-earlier");
            if (await later.isEnabled()) await later.click();
            else if (await earlier.isEnabled()) await earlier.click();
            await expect(page.getByTestId("fprime-selection")).not.toHaveText(before);
            movedOnce = true;
          }
          if (!axedDecide) {
            await expectNoSeriousAxe(page, "decide");
            axedDecide = true;
          }
          await page.getByTestId("fprime-lock").click({ timeout: 2_000 });
          await expect(page.getByTestId("fprime-waiting").or(page.getByTestId("fprime-reveal"))).toBeVisible({ timeout: 10_000 });
        } else if (phase === "reveal") {
          const reveal = page.getByTestId("fprime-reveal");
          await expect(reveal.getByTestId("fprime-ridge")).toBeVisible();
          await expect(reveal.getByTestId("fprime-round-receipt")).toContainText("highest-rated window");
          revealed.add(await reveal.locator(".parena-eyebrow").innerText());
          if (!axedReveal) {
            await expectNoSeriousAxe(page, "reveal");
            axedReveal = true;
          }
        }
      } catch {
        // The phase moved under us; read it again.
      }
      await page.waitForTimeout(400);
    }

    await expect(page.getByTestId("fprime-result")).toBeVisible();
    expect(revealed.size).toBe(9);
    expect([...lengths].map((l) => l.toLowerCase()).sort()).toEqual(["2-year window", "3-year window", "5-year window"]);
    await expect(page.getByTestId("fprime-result-reveal")).toHaveAttribute("data-complete", "true", { timeout: 10_000 });
    await expect(page.getByTestId("fprime-result")).toContainText("points of a possible 900");
    await expect(page.getByTestId("fprime-podium").getByRole("listitem")).toHaveCount(4);
    await expectNoSeriousAxe(page, "final result");

    await page.getByTestId("fprime-play-again").click();
    await page.waitForURL((url) => MATCH_URL.test(url.pathname) && !url.pathname.endsWith(firstMatch), { timeout: 30_000 });
    await expect(page.getByTestId("fprime-room")).toBeVisible();
  });

  test("a reload mid-round restores the staged window", async ({ page }) => {
    test.setTimeout(120_000);
    await signInAs(page, uniqueSub("ftp-reload"));
    await startPractice(page);
    await expect.poll(() => phaseOf(page), { timeout: 30_000 }).toBe("decide");
    const placed = await placeWindow(page);
    // Staging is debounced, then sent; give it the debounce plus a round trip.
    await page.waitForTimeout(1_500);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("fprime-room")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("fprime-selection")).toHaveText(placed, { timeout: 10_000 });
    await expect(page.getByTestId("fprime-lock")).toBeEnabled();
  });

  test("a round that runs out with nothing placed scores zero", async ({ page }) => {
    test.setTimeout(120_000);
    await signInAs(page, uniqueSub("ftp-silent"));
    await startPractice(page);
    await expect.poll(() => phaseOf(page), { timeout: 30_000 }).toBe("decide");
    await expect.poll(() => phaseOf(page), { timeout: 45_000 }).toBe("reveal");
    await expect(page.getByTestId("fprime-your-answer")).toContainText("No window placed — 0 points");
  });

  test("phone: the rail, the lock and the ridge fit with no horizontal overflow @mobile", async ({ page }) => {
    test.setTimeout(150_000);
    await signInAs(page, uniqueSub("ftp-mobile"));
    await startPractice(page);
    await expect.poll(() => phaseOf(page), { timeout: 30_000 }).toBe("decide");
    await expectNoHorizontalOverflow(page);

    const cell = page.locator('[data-testid^="fprime-season-"]:not([disabled])').first();
    const cellBox = (await cell.boundingBox())!;
    expect(cellBox.width).toBeGreaterThanOrEqual(44);
    expect(cellBox.height).toBeGreaterThanOrEqual(44);
    await cell.tap();
    await expect(page.getByTestId("fprime-selection")).toContainText(" to ");

    const lock = page.getByTestId("fprime-lock");
    const viewport = page.viewportSize()!;
    const lockBox = (await lock.boundingBox())!;
    expect(lockBox.y + lockBox.height).toBeLessThanOrEqual(viewport.height + 1);
    await expectNoSeriousAxe(page, "phone decide");
    await lock.tap();

    await expect.poll(() => phaseOf(page), { timeout: 45_000 }).toBe("reveal");
    await expectNoHorizontalOverflow(page);
    const ridge = (await page.getByTestId("fprime-ridge").boundingBox())!;
    expect(ridge.width).toBeLessThanOrEqual(viewport.width);
  });
});
