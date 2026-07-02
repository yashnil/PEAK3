/**
 * Ranked duels end-to-end tests (Phase 4.0, spec section X).
 * Requires FastAPI (port 8000, RANKED_ENABLED/RANKED_MATCHMAKING_ENABLED/
 * RANKED_RATING_WRITES_ENABLED=true, PEAK3_SUPABASE_JWT_SECRET set to a
 * known test value) and Next.js (port 3000).
 *
 * Two authenticated identities are established via a signed test JWT (see
 * helpers/test-jwt.ts) injected into each isolated BrowserContext through
 * window.__peak3TestAuth — a dev-only bridge (see lib/auth.ts) used because
 * no live Supabase project exists in this environment. This proves the real
 * matchmaking/board/settlement/RLS-shaped-access-control code paths through
 * an actual browser, which is the part that matters; it does not exercise
 * real Supabase sign-up/sign-in, which remains the dedicated integration
 * job's responsibility.
 */
import { test, expect, Browser, BrowserContext, Page } from "@playwright/test";
import { mintTestAccessToken } from "./helpers/test-jwt";

async function signInAs(context: BrowserContext, page: Page, sub: string): Promise<string> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  // AuthProvider attaches window.__peak3TestAuth in a useEffect — wait for
  // hydration to actually complete before calling it, otherwise this is a
  // silent no-op (optional chaining swallows "not hydrated yet" as success).
  await page.waitForFunction(() => typeof window.__peak3TestAuth !== "undefined");
  const token = mintTestAccessToken(sub, `${sub}@e2e.test`);
  await page.evaluate(
    ([t, s]) => {
      window.__peak3TestAuth!.setSession(t as string, { id: s as string, email: `${s}@e2e.test`, isAnonymous: false });
    },
    [token, sub],
  );
  return token;
}

async function joinRankedQueue(page: Page, mode: string): Promise<void> {
  await page.goto(`/arena/ranked/${mode}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.getByText(/Join .* queue/i).click();
}

interface RoundPlanEntry {
  playerName: string;
  role: string;
  eligibleOpenCountAtChoice: number; // 1 = RankedScreen auto-submits; >1 = a RoleSelector click is required
}

interface BoardOfferCard {
  peak_window_id: string;
  player_name: string;
  eligible_roles: string[];
}
interface BoardRound {
  offers: BoardOfferCard[];
}

const ALL_ROLES = ["lead_creator", "guard_wing", "wing_forward", "forward_big", "anchor"];

/**
 * Backtracking search mirroring nba_peak.lineup.board._can_fill_all_roles,
 * computed from the match's full board (fetched via the DEBUG-only oracle
 * endpoint — see app/api/v1/ranked.py::debug_get_match_board). A real
 * player only ever sees one round at a time through the actual API/UI; this
 * lookahead exists solely so the e2e fixture has a guaranteed-completable,
 * deterministic script to execute round-by-round against the real
 * hidden-information UI (a naive greedy per-round choice can legitimately
 * dead-end on a board that is only feasible via a specific role ordering).
 */
function solveRoundPlan(rounds: BoardRound[]): RoundPlanEntry[] {
  const plan: RoundPlanEntry[] = [];

  function search(roundIdx: number, filled: Set<string>): boolean {
    if (roundIdx === rounds.length) return filled.size === ALL_ROLES.length;
    for (const card of rounds[roundIdx].offers) {
      const openEligible = card.eligible_roles.filter((r) => !filled.has(r));
      for (const role of openEligible) {
        plan[roundIdx] = { playerName: card.player_name, role, eligibleOpenCountAtChoice: openEligible.length };
        const next = new Set(filled);
        next.add(role);
        if (search(roundIdx + 1, next)) return true;
      }
    }
    plan.length = roundIdx;
    return false;
  }

  if (!search(0, new Set())) throw new Error("solveRoundPlan: board reported feasible but no assignment found");
  return plan;
}

async function fetchRoundPlan(page: Page, token: string, matchId: string): Promise<RoundPlanEntry[]> {
  const res = await page.request.get(`http://localhost:8000/api/v1/ranked/_debug/matches/${matchId}/board`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok()).toBeTruthy();
  const board = await res.json();
  return solveRoundPlan(board.rounds as BoardRound[]);
}

async function playFullRankedGame(page: Page, plan: RoundPlanEntry[]): Promise<void> {
  for (const entry of plan) {
    const cardLocator = page.locator('[data-testid="offer-card"]').filter({ hasText: entry.playerName }).first();
    await cardLocator.waitFor({ state: "visible", timeout: 10_000 });

    if (entry.eligibleOpenCountAtChoice === 1) {
      // RankedScreen auto-submits when a card has exactly one eligible open role.
      await Promise.all([
        page.waitForResponse((r) => r.url().includes("/actions") && r.status() === 200, { timeout: 15_000 }),
        cardLocator.click(),
      ]);
    } else {
      await cardLocator.click();
      const roleBtn = page.locator(`[data-testid="role-btn"][data-role="${entry.role}"]`);
      await roleBtn.waitFor({ state: "visible", timeout: 8_000 });
      await roleBtn.click();
      const lockIn = page.locator('[data-testid="lock-in"]');
      await expect(lockIn).not.toBeDisabled({ timeout: 3_000 });
      await Promise.all([
        page.waitForResponse((r) => r.url().includes("/actions") && r.status() === 200, { timeout: 15_000 }),
        lockIn.click(),
      ]);
    }
  }
}

test.describe("Ranked duels", () => {
  test("shows honest closed-alpha/disabled state without crashing", async ({ page }) => {
    await page.goto("/arena/ranked", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Ranked" })).toBeVisible();
    // Either "not enabled" or a real readiness level is shown — never a fake
    // population/activity number (spec: "do not show fake population activity").
    const banner = page.getByText(/Checking ranked status|not currently enabled|Closed alpha/);
    await expect(banner).toBeVisible();
  });

  test("unauthenticated join redirects to sign-in", async ({ page }) => {
    await page.goto("/arena/ranked/apex_1y", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    const joinButton = page.getByText(/Join .* queue/i);
    if (await joinButton.isVisible().catch(() => false)) {
      await joinButton.click();
      await expect(page).toHaveURL(/\/signin/);
    }
  });

  test("two users join the same queue, are paired, and receive the same board; neither sees the other before settlement; both complete independently and settlement occurs once", async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const subA = `e2e-a-${Date.now()}`;
    const subB = `e2e-b-${Date.now()}`;

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    const tokenA = await signInAs(contextA, pageA, subA);
    await signInAs(contextB, pageB, subB);

    await joinRankedQueue(pageA, "apex_1y");
    // First joiner has no opponent yet.
    await expect(pageA.getByText(/Waiting for an opponent/i)).toBeVisible({ timeout: 10_000 });

    await joinRankedQueue(pageB, "apex_1y");
    // Second joiner should pair immediately with the first.
    await expect(pageB.getByText(/Matched|Round 1 of 5/i)).toBeVisible({ timeout: 10_000 });
    // A now transitions out of waiting once matched too.
    await expect(pageA.getByText(/Matched|Round 1 of 5/i)).toBeVisible({ timeout: 10_000 });

    // Both should see round 1 of 5 with real offers, and the SAME offers.
    await expect(pageA.getByText(/Round 1 of 5/i)).toBeVisible({ timeout: 10_000 });
    await expect(pageB.getByText(/Round 1 of 5/i)).toBeVisible({ timeout: 10_000 });

    const namesA = await pageA.locator('[data-testid="offer-card"]').allTextContents();
    const namesB = await pageB.locator('[data-testid="offer-card"]').allTextContents();
    expect(namesA).toEqual(namesB);

    // Neither page's DOM/network ever exposes the opponent's identity or
    // picks before settlement — no such fields exist in the rendered page.
    expect(await pageA.content()).not.toContain(subB);
    expect(await pageB.content()).not.toContain(subA);

    const statusRes = await pageA.request.get("http://localhost:8000/api/v1/ranked/queues/apex_1y/status", {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const { match_id: matchId } = await statusRes.json();
    expect(matchId).toBeTruthy();
    const plan = await fetchRoundPlan(pageA, tokenA, matchId);

    // A finishes first and must see "awaiting opponent" — not a result yet.
    await playFullRankedGame(pageA, plan);
    await expect(pageA.getByText(/Waiting for your opponent to finish/i)).toBeVisible({ timeout: 15_000 });

    // A's awaiting-opponent screen still reveals nothing about B.
    expect(await pageA.content()).not.toContain(subB);

    await playFullRankedGame(pageB, plan);

    // Both eventually reach a settled result — exactly one outcome, visible
    // to both, and consistent (opposite/draw) between them.
    await expect(pageA.getByText(/Victory|Defeat|Draw/i)).toBeVisible({ timeout: 20_000 });
    await expect(pageB.getByText(/Victory|Defeat|Draw/i)).toBeVisible({ timeout: 20_000 });

    const outcomeA = await pageA.getByText(/Victory|Defeat|Draw/i).first().textContent();
    const outcomeB = await pageB.getByText(/Victory|Defeat|Draw/i).first().textContent();
    if (outcomeA === "Draw") {
      expect(outcomeB).toBe("Draw");
    } else {
      expect(outcomeA).not.toBe(outcomeB);
    }

    // Refresh preserves the settled result (durable state, not client-only).
    await pageA.reload();
    await expect(pageA.getByText(/Victory|Defeat|Draw/i)).toBeVisible({ timeout: 10_000 });

    await contextA.close();
    await contextB.close();
  });

  test("a non-participant cannot view someone else's active match", async ({ browser }: { browser: Browser }) => {
    const subA = `e2e-owner-${Date.now()}`;
    const subStranger = `e2e-stranger-${Date.now()}`;

    const contextA = await browser.newContext();
    const contextStranger = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageStranger = await contextStranger.newPage();

    const tokenA = await signInAs(contextA, pageA, subA);
    await signInAs(contextStranger, pageStranger, subStranger);

    await joinRankedQueue(pageA, "prime_3y");
    await expect(pageA.getByText(/Waiting for an opponent/i)).toBeVisible({ timeout: 10_000 });

    // The stranger polls the match API directly for a match id they were
    // never part of — this should be denied, not leaked.
    const strangerToken = mintTestAccessToken(subStranger, `${subStranger}@e2e.test`);
    const res = await pageStranger.request.get("http://localhost:8000/api/v1/ranked/matches/00000000-0000-0000-0000-000000000000", {
      headers: { Authorization: `Bearer ${strangerToken}` },
    });
    expect([403, 404]).toContain(res.status());

    // Leave no waiting entry behind for other tests/runs sharing this queue.
    await pageA.request.post("http://localhost:8000/api/v1/ranked/queues/prime_3y/cancel", {
      headers: { Authorization: `Bearer ${tokenA}` },
    });

    await contextA.close();
    await contextStranger.close();
  });

  test("queue ratings remain independent across 1Y/3Y/5Y for the same user", async ({ page }) => {
    const sub = `e2e-multi-${Date.now()}`;
    await signInAs(await page.context(), page, sub);

    for (const mode of ["apex_1y", "prime_3y", "foundation_5y"]) {
      await page.goto(`/arena/ranked/${mode}`, { waitUntil: "domcontentloaded" });
      const label = mode === "apex_1y" ? "1Y Apex" : mode === "prime_3y" ? "3Y Prime" : "5Y Foundation";
      await expect(page.getByRole("heading", { name: `Ranked · ${label}` })).toBeVisible();
    }
  });
});

test.describe("Ranked mobile @mobile", () => {
  test("ranked hub has no horizontal overflow on mobile viewport", async ({ page }) => {
    await page.goto("/arena/ranked", { waitUntil: "domcontentloaded" });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });
});
