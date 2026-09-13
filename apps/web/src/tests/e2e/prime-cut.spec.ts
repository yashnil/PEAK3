/**
 * PRIME CUT in a real browser against the real API and the real bots.
 *
 * Nothing here fakes a response or a clock: a match is created through the
 * lobby, the server times every phase, and three tiered bots lock their own
 * calls. The assertions are about PLAYING -- the intro nobody can skip, forced
 * calls once a quota is spent, a reveal after heats one and two, the three
 * duration bands and the podium at the end, a rematch, and a reload that
 * restores the same heat.
 *
 * REQUIRES `PEAK3_ARENA_PRIME_CUT_ENABLED=true` (set by `scripts/ci/e2e-tests.sh`
 * and `npm run start:api`).
 */
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { mintTestAccessToken } from "./helpers/test-jwt";

const MATCH_URL = /\/arena\/prime-cut\/[0-9a-f-]{36}$/;

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
  await page.goto("/arena/lobby?game=prime_cut", { waitUntil: "domcontentloaded" });
  const practice = page.getByTestId("lobby-prime_cut-practice");
  await expect(practice).toBeVisible({ timeout: 30_000 });
  await practice.click();
  await page.waitForURL(MATCH_URL, { timeout: 30_000 });
  await expect(page.getByTestId("pcut-room").or(page.getByTestId("pcut-result"))).toBeVisible({ timeout: 30_000 });
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
  return page.getByTestId("pcut-room").getAttribute("data-phase", { timeout: 1_000 }).catch(() => null);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(scroll).toBeLessThanOrEqual(inner + 0.5);
}

test.describe("PRIME CUT", () => {
  test("a full match: intro, three heats, forced calls, reveals, podium and rematch", async ({ page }) => {
    test.setTimeout(480_000);
    await signInAs(page, uniqueSub("pc-full"));
    const firstMatch = await startPractice(page);

    await expect(page.getByTestId("pcut-intro")).toBeVisible();
    await expect(page.getByRole("button", { name: /skip/i })).toHaveCount(0);
    await expect(page.getByTestId("pcut-strip").getByText(/^Bot/)).toHaveCount(3);

    const slates = new Set<string>();
    const reveals = new Set<string>();
    let sawForced = false;
    let sawCardAxe = false;
    const deadline = Date.now() + 440_000;
    while (Date.now() < deadline) {
      if ((await page.getByTestId("pcut-result").count()) > 0) break;
      const phase = await phaseOf(page);
      try {
        if (phase === "heat_open") {
          slates.add((await page.getByTestId("pcut-heat-open").innerText()).toLowerCase());
        } else if (phase === "heat_reveal") {
          const reveal = page.getByTestId("pcut-heat-reveal");
          await expect(reveal.getByTestId("pcut-reveal-cutline-line")).toBeVisible();
          reveals.add(await reveal.locator(".parena-eyebrow").innerText());
        } else if (phase === "card" || phase === "card_forced") {
          if (!sawCardAxe) {
            await expectNoSeriousAxe(page, "live card");
            sawCardAxe = true;
          }
          const stamp = page.getByTestId("pcut-stamp");
          if ((await stamp.count()) > 0 && /forced/i.test(await stamp.innerText())) sawForced = true;
          const keep = page.getByTestId("pcut-keep");
          const cut = page.getByTestId("pcut-cut");
          // Always KEEP while a keep is left: the rest of the heat is forced.
          if ((await keep.count()) > 0 && (await keep.isEnabled())) await keep.click({ timeout: 2_000 });
          else if ((await cut.count()) > 0 && (await cut.isEnabled())) await cut.click({ timeout: 2_000 });
        }
      } catch {
        // The board moved between reading the phase and acting on it; the next
        // pass reads it again.
      }
      await page.waitForTimeout(350);
    }

    const result = page.getByTestId("pcut-result");
    await expect(result).toBeVisible();
    expect([...slates].some((s) => s.includes("2-year"))).toBe(true);
    expect([...slates].some((s) => s.includes("3-year"))).toBe(true);
    expect([...slates].some((s) => s.includes("5-year"))).toBe(true);
    expect(reveals.size).toBe(2);
    expect(sawForced).toBe(true);

    await expect(page.getByTestId("pcut-result-reveal")).toHaveAttribute("data-complete", "true", { timeout: 10_000 });
    for (const duration of ["2y", "3y", "5y"]) {
      await expect(page.getByTestId(`pcut-band-${duration}`)).toContainText(/\d+\.\d/);
    }
    await expect(page.getByTestId("pcut-podium").getByRole("listitem")).toHaveCount(4);
    await expect(page.getByTestId("parena-personal-rating")).toContainText("Unrated match");
    await expectNoSeriousAxe(page, "final result");

    await page.getByTestId("pcut-play-again").click();
    await page.waitForURL((url) => MATCH_URL.test(url.pathname) && !url.pathname.endsWith(firstMatch), { timeout: 30_000 });
    await expect(page.getByTestId("pcut-room")).toBeVisible();
  });

  test("a reload mid-heat restores the same heat and your calls", async ({ page }) => {
    test.setTimeout(120_000);
    await signInAs(page, uniqueSub("pc-reload"));
    await startPractice(page);
    await expect.poll(() => phaseOf(page), { timeout: 30_000 }).toBe("card");
    await page.getByTestId("pcut-cut").click();
    await expect(page.getByTestId("pcut-cuts-left")).toHaveText("3");
    const heading = await page.locator(".pcut-heading").innerText();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("pcut-room")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".pcut-heading")).toHaveText(heading);
    await expect(page.getByTestId("pcut-cuts-left")).toHaveText("3");
    await expect(page.getByTestId("pcut-ledger")).toContainText("1/4");
  });

  test("two players in a private room are dealt the same card and never see each other's calls", async ({ browser }) => {
    test.setTimeout(180_000);
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    try {
      await signInAs(host, uniqueSub("pc-host"));
      await signInAs(guest, uniqueSub("pc-guest"));

      await host.goto("/arena/lobby?game=prime_cut", { waitUntil: "domcontentloaded" });
      await host.getByTestId("lobby-prime_cut-private_room").click();
      await host.getByTestId("lobby-prime_cut-create-room").click();
      const code = (await host.getByTestId("lobby-room-code").innerText({ timeout: 20_000 })).trim().replace(/\s+/g, "");
      expect(code).toMatch(/^[A-Z0-9]{6}$/);

      await guest.goto("/arena/lobby?game=prime_cut", { waitUntil: "domcontentloaded" });
      await guest.getByTestId("lobby-prime_cut-private_room").click();
      await guest.getByTestId("lobby-prime_cut-join-code").fill(code);
      await guest.getByTestId("lobby-prime_cut-join-submit").click();
      await expect(guest.getByTestId("lobby-room")).toBeVisible({ timeout: 20_000 });

      // Two humans in a four-seat room: the host decides to fill the rest.
      await expect(host.getByTestId("lobby-room")).toContainText("2 of 4", { timeout: 20_000 });
      await host.getByTestId("lobby-room-fill-bots").click();
      await Promise.all([host.waitForURL(MATCH_URL, { timeout: 30_000 }), guest.waitForURL(MATCH_URL, { timeout: 30_000 })]);
      expect(new URL(host.url()).pathname).toBe(new URL(guest.url()).pathname);

      await expect.poll(() => phaseOf(host), { timeout: 40_000 }).toBe("card");
      await expect.poll(() => phaseOf(guest), { timeout: 10_000 }).toBe("card");
      const dealt = await host.getByTestId("pcut-card-name").innerText();
      await expect(guest.getByTestId("pcut-card-name")).toHaveText(dealt);
      await expect(host.getByTestId("pcut-strip").getByText(/^Bot/)).toHaveCount(2);

      await host.getByTestId("pcut-keep").click();
      await expect(host.getByTestId("pcut-stamp")).toContainText("Kept", { timeout: 10_000 });

      // The guest learns that the host LOCKED -- never what the host locked.
      const hostRowOnGuest = guest.locator('li[data-testid^="parena-seat-"][data-you="false"]').filter({ hasNotText: /Bot/ });
      await expect(hostRowOnGuest).toContainText("Locked", { timeout: 10_000 });
      await expect(guest.getByTestId("pcut-stamp")).toHaveCount(0);
      await expect(guest.getByTestId("pcut-keeps-left")).toHaveText("4");
      await expect(guest.getByTestId("pcut-strip")).not.toContainText(/Kept|Keep|Cut/);
    } finally {
      await hostContext.close();
      await guestContext.close();
    }
  });

  test("phone: the card, keep slots and thumb controls fit with no horizontal overflow @mobile", async ({ page }) => {
    test.setTimeout(120_000);
    await signInAs(page, uniqueSub("pc-mobile"));
    await startPractice(page);
    await expectNoHorizontalOverflow(page);
    await expect.poll(() => phaseOf(page), { timeout: 30_000 }).toBe("card");
    await expectNoHorizontalOverflow(page);

    const viewport = page.viewportSize()!;
    const keep = page.getByTestId("pcut-keep");
    const box = (await keep.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    const nameSize = await page.getByTestId("pcut-card-name").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(nameSize).toBeGreaterThanOrEqual(24);
    await expect(page.getByTestId("pcut-slots")).toBeVisible();

    await keep.tap();
    await expect(page.getByTestId("pcut-keeps-left")).toHaveText("3", { timeout: 10_000 });
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousAxe(page, "phone card");
  });
});
