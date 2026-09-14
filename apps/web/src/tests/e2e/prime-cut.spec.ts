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
/** The room's authoritative read of one match (not its commands). */
const MATCH_READ = /\/api\/v1\/arena\/matches\/[0-9a-f-]{36}(\?.*)?$/;

function uniqueSub(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function signInAs(page: Page, sub: string): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.__peak3TestAuth !== "undefined");
  const token = mintTestAccessToken(sub, `${sub}@e2e.test`);
  await page.evaluate(
    ([t, s]) => {
      // A FRESH TEST ACCOUNT HAS NO HANDLE, so the handle-onboarding prompt
      // (fixed, bottom-right, deliberately still shown on the lobby) comes up
      // on every lobby visit. Record the same session dismissal "Skip for now"
      // records (`DISMISS_KEY` in HandleOnboardingPrompt.tsx), before any lobby
      // page loads: once the lobby put Prime Cut's card in the right-hand
      // column, the prompt sat over the private room's Join button and the
      // click was intercepted until the test timed out. Set up front rather
      // than clicked away, because the prompt appears only after an async
      // profile read and a click-if-present check races it.
      sessionStorage.setItem("peak3_handle_prompt_dismissed", "1");
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
    // A heat's opening slate is a 3.5 s server beat, shorter than one pass of
    // the loop below (an axe check alone can settle for 5 s), so the loop cannot
    // be the thing that sees it -- nor a reveal, when a read in the loop waits on
    // a control the phase change just removed. The page records every slate and
    // every cut-line reveal it renders, and the room's own reads record every
    // heat the server completed.
    await page.addInitScript(() => {
      const seen = { slates: [] as string[], reveals: [] as string[] };
      (window as unknown as { __pcutSeen: typeof seen }).__pcutSeen = seen;
      const note = (list: string[], text: string) => {
        if (text && !list.includes(text)) list.push(text);
      };
      new MutationObserver(() => {
        document.querySelectorAll('[data-testid="pcut-heat-open"]').forEach((slate) => {
          note(seen.slates, (slate.textContent ?? "").toLowerCase());
        });
        document.querySelectorAll('[data-testid="pcut-heat-reveal"]').forEach((reveal) => {
          if (!reveal.querySelector('[data-testid="pcut-reveal-cutline-line"]')) return;
          note(seen.reveals, (reveal.querySelector(".parena-eyebrow")?.textContent ?? "").replace(/\s+/g, " ").trim());
        });
      }).observe(document, { childList: true, subtree: true, characterData: true });
    });
    let heatsCompleted: Array<[number, number]> = [];
    page.on("response", (response) => {
      if (response.request().method() !== "GET" || !MATCH_READ.test(response.url())) return;
      response
        .json()
        .then((view: { public_state?: { heat_results?: Array<{ heat_index: number; duration: number }> } }) => {
          const results = view.public_state?.heat_results ?? [];
          if (results.length > heatsCompleted.length) heatsCompleted = results.map((h) => [h.heat_index, h.duration]);
        })
        .catch(() => undefined);
    });
    await signInAs(page, uniqueSub("pc-full"));
    const firstMatch = await startPractice(page);

    await expect(page.getByTestId("pcut-intro")).toBeVisible();
    await expect(page.getByRole("button", { name: /skip/i })).toHaveCount(0);
    await expect(page.getByTestId("pcut-strip").getByText(/^Bot/)).toHaveCount(3);

    let sawForced = false;
    let sawCardAxe = false;
    let sawRevealAxe = false;
    const deadline = Date.now() + 440_000;
    while (Date.now() < deadline) {
      if ((await page.getByTestId("pcut-result").count()) > 0) break;
      const phase = await phaseOf(page);
      try {
        if (phase === "heat_reveal") {
          await expect(page.getByTestId("pcut-heat-reveal").getByTestId("pcut-reveal-cutline-line")).toBeVisible();
          if (!sawRevealAxe) {
            await expectNoSeriousAxe(page, "heat reveal");
            sawRevealAxe = true;
          }
        } else if (phase === "card" || phase === "card_forced") {
          if (!sawCardAxe) {
            await expectNoSeriousAxe(page, "live card");
            sawCardAxe = true;
          }
          const stamp = page.getByTestId("pcut-stamp");
          // Every read is bounded like `phaseOf`: with no action timeout, a read
          // of a control the next phase removed would wait for the next heat.
          if ((await stamp.count()) > 0 && /forced/i.test(await stamp.innerText({ timeout: 1_000 }))) sawForced = true;
          const keep = page.getByTestId("pcut-keep");
          const cut = page.getByTestId("pcut-cut");
          // Always KEEP while a keep is left: the rest of the heat is forced.
          if ((await keep.count()) > 0 && (await keep.isEnabled({ timeout: 1_000 }))) await keep.click({ timeout: 2_000 });
          else if ((await cut.count()) > 0 && (await cut.isEnabled({ timeout: 1_000 }))) await cut.click({ timeout: 2_000 });
        }
      } catch {
        // The board moved between reading the phase and acting on it; the next
        // pass reads it again.
      }
      await page.waitForTimeout(350);
    }

    const result = page.getByTestId("pcut-result");
    await expect(result).toBeVisible();
    // The server completed three heats, in order, at 2, 3 and 5 years...
    await expect.poll(() => heatsCompleted).toEqual([[0, 2], [1, 3], [2, 5]]);
    // ...and this player was shown each one's opening slate, and a cut-line
    // reveal after heats one and two.
    const { slates, reveals } = await page.evaluate(
      () => (window as unknown as { __pcutSeen: { slates: string[]; reveals: string[] } }).__pcutSeen,
    );
    expect(slates.some((s) => s.includes("2-year"))).toBe(true);
    expect(slates.some((s) => s.includes("3-year"))).toBe(true);
    expect(slates.some((s) => s.includes("5-year"))).toBe(true);
    expect(reveals).toEqual(["Heat 1 results · 2-year peaks", "Heat 2 results · 3-year peaks"]);
    expect(sawForced).toBe(true);
    // The axe checks run inside the retrying loop, so a check that never
    // passed must fail here rather than vanish into the catch.
    expect(sawCardAxe).toBe(true);
    expect(sawRevealAxe).toBe(true);

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
      // Joining takes the guest straight to the match page, which says plainly
      // that the table is still filling -- no intro, no clock, nothing dealt.
      await guest.waitForURL(MATCH_URL, { timeout: 20_000 });
      await expect(guest.getByTestId("pcut-forming")).toContainText("2 of 4 seats taken", { timeout: 20_000 });
      await expect(guest.getByTestId("pcut-room")).toHaveCount(0);

      // Two humans in a four-seat room: the host decides to fill the rest.
      await expect(host.getByTestId("lobby-room")).toContainText("2 of 4", { timeout: 20_000 });
      await host.getByTestId("lobby-room-fill-bots").click();
      await host.waitForURL(MATCH_URL, { timeout: 30_000 });
      await expect(guest.getByTestId("pcut-room")).toBeVisible({ timeout: 20_000 });
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

  test("a client slower than the whole intro still sees all of it, because its clock waits for the table", async ({ page }) => {
    test.setTimeout(120_000);
    await signInAs(page, uniqueSub("pc-slow"));
    // SIMULATED SLOW ARRIVAL: no read of the match reaches the server until
    // longer than the intro (6 s) plus the server's action grace (2 s) after the
    // room first asked -- what a cold compile of this route did in CI run
    // 34772830703. With the intro timed from match creation, that read found the
    // match already past it. EVERY read is held, not just the first: the dev
    // server mounts the room twice (StrictMode), so it issues two at once.
    const arrivalDelayMs = 9_000;
    let releaseAt: number | null = null;
    await page.route(MATCH_READ, async (route) => {
      if (route.request().method() === "GET") {
        releaseAt ??= Date.now() + arrivalDelayMs;
        const wait = releaseAt - Date.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      }
      await route.continue();
    });
    await startPractice(page);
    await expect(page.getByTestId("pcut-intro")).toBeVisible();
    expect(releaseAt).not.toBeNull();
    const introOnScreen = Date.now();
    await expect.poll(() => phaseOf(page), { timeout: 30_000 }).toBe("heat_open");
    // The intro's whole length ran from the moment it was on screen.
    expect(Date.now() - introOnScreen).toBeGreaterThanOrEqual(4_500);
    await expect(page.getByTestId("pcut-heat-open")).toBeVisible();
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
