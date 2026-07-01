/**
 * Daily Peak + Challenge Loop end-to-end tests.
 * Requires FastAPI (port 8000) and Next.js (port 3000).
 * Tests are tagged @daily-challenge and run only in the chromium project.
 * Mobile overflow tests are tagged @mobile.
 */
import { test, expect, Page, BrowserContext } from "@playwright/test";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Play one full round using data-testid selectors. */
async function playOneRound(page: Page): Promise<void> {
  const eligibleCard = page.locator(
    '[data-testid="offer-card"][data-eligible="true"]:not([disabled])'
  );
  await eligibleCard.first().waitFor({ state: "visible", timeout: 15_000 });
  await eligibleCard.first().click();

  const roleBtn = page.locator('[data-testid="role-btn"]:not([disabled])');
  await roleBtn.first().waitFor({ state: "visible", timeout: 8_000 });
  await roleBtn.first().click();

  const lockIn = page.locator('[data-testid="lock-in"]');
  await lockIn.waitFor({ state: "visible" });
  await expect(lockIn).not.toBeDisabled({ timeout: 3_000 });

  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/actions") && r.status() === 200,
      { timeout: 15_000 }
    ),
    lockIn.click(),
  ]);
  expect(response.status()).toBe(200);
}

/** Complete all 5 rounds. */
async function completeDraft(page: Page): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await playOneRound(page);
  }
}

/** Clear localStorage before a test to simulate anonymous/fresh session.
 *  Must be on a same-origin page to access localStorage; navigates to "/" first
 *  if the page is still on about:blank. */
async function clearLocalStorage(page: Page): Promise<void> {
  if (!page.url().startsWith("http://localhost")) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
  }
  await page.evaluate(() => localStorage.clear());
}

// ── Daily board ─────────────────────────────────────────────────────────────

test.describe("Daily Peak board", () => {
  test("daily hub page loads with three mode cards", async ({ page }) => {
    await page.goto("/arena/daily", { waitUntil: "domcontentloaded" });
    // Should show the hub heading
    await expect(
      page.getByRole("heading", { name: /today.*peak draft/i })
    ).toBeVisible({ timeout: 10_000 });
    // Should show 3 mode cards by their label text
    await expect(page.getByText("1Y Apex")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("3Y Prime")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("5Y Foundation")).toBeVisible({ timeout: 5_000 });
    // At least one "Play Now" link when nothing is completed
    const playLinks = page.getByRole("link", { name: /play now/i });
    expect(await playLinks.count()).toBeGreaterThanOrEqual(1);
  });

  test("anonymous user can complete today's 1Y Apex daily board", async ({
    page,
  }) => {
    await clearLocalStorage(page);
    await page.goto("/arena/daily/apex_1y", { waitUntil: "load" });
    // Wait for draft to load
    await expect(
      page.getByRole("heading", { name: "Peak Draft" })
    ).toBeVisible({ timeout: 20_000 });
    await completeDraft(page);
    // Should see lineup evaluation (receipt)
    await expect(
      page.getByText(/lineup.*rating|lineup peak/i).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test("refresh during daily play resumes the same game", async ({ page }) => {
    await clearLocalStorage(page);
    await page.goto("/arena/daily/apex_1y", { waitUntil: "load" });
    await expect(
      page.getByRole("heading", { name: "Peak Draft" })
    ).toBeVisible({ timeout: 20_000 });

    // Play one round and capture the game_id from the API response
    const roundPromise = page.waitForResponse(
      (r) => r.url().includes("/actions") && r.status() === 200
    );
    await playOneRound(page);
    const roundResp = await roundPromise;
    const state = await roundResp.json();
    const gameId = state.game_id;

    // Reload the page
    await page.reload({ waitUntil: "load" });
    await expect(
      page.getByRole("heading", { name: "Peak Draft" })
    ).toBeVisible({ timeout: 20_000 });

    // Verify we resume the same game by checking the next action's game_id
    const nextRoundPromise = page.waitForResponse(
      (r) => r.url().includes("/actions") && r.status() === 200
    );
    await playOneRound(page);
    const nextResp = await nextRoundPromise;
    const nextState = await nextResp.json();
    expect(nextState.game_id).toBe(gameId);
  });

  test("already-completed daily board shows completed state on revisit", async ({
    page,
  }) => {
    await clearLocalStorage(page);
    // Complete the daily board
    await page.goto("/arena/daily/apex_1y", { waitUntil: "load" });
    await expect(
      page.getByRole("heading", { name: "Peak Draft" })
    ).toBeVisible({ timeout: 20_000 });
    await completeDraft(page);
    await expect(
      page.getByText(/lineup.*rating|lineup peak/i).first()
    ).toBeVisible({ timeout: 15_000 });

    // Navigate away and come back
    await page.goto("/arena", { waitUntil: "domcontentloaded" });
    await page.goto("/arena/daily/apex_1y", { waitUntil: "load" });

    // Should show completed state: heading with "Complete" or a "View Result" button.
    // Both may be visible simultaneously — check the heading first (more specific).
    await expect(
      page.getByRole("heading", { name: /today.*complete|✓/i }).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("@mobile daily hub has no horizontal overflow on mobile", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/arena/daily", { waitUntil: "domcontentloaded" });
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 4);
  });
});

// ── Challenge creation ───────────────────────────────────────────────────────

test.describe("Challenge creation and sharing", () => {
  test("completed result shows a Create Challenge Link button", async ({
    page,
  }) => {
    await clearLocalStorage(page);
    await page.goto("/arena/practice/apex_1y?seed=42", { waitUntil: "load" });
    await expect(
      page.getByRole("heading", { name: "Peak Draft" })
    ).toBeVisible({ timeout: 20_000 });
    await completeDraft(page);
    // Wait for receipt
    await expect(
      page.getByText(/lineup.*rating|lineup peak/i).first()
    ).toBeVisible({ timeout: 15_000 });
    // Challenge creation button should be visible in the receipt
    await expect(
      page.getByRole("button", { name: /create challenge link/i })
    ).toBeVisible({ timeout: 5_000 });
  });

  test("creating a challenge generates a /c/ link", async ({ page }) => {
    await clearLocalStorage(page);
    await page.goto("/arena/practice/apex_1y?seed=42", { waitUntil: "load" });
    await expect(
      page.getByRole("heading", { name: "Peak Draft" })
    ).toBeVisible({ timeout: 20_000 });
    await completeDraft(page);
    await expect(
      page.getByText(/lineup.*rating|lineup peak/i).first()
    ).toBeVisible({ timeout: 15_000 });

    // Click "Create Challenge Link" button
    const challengeBtn = page.getByRole("button", {
      name: /create challenge link/i,
    });
    await challengeBtn.waitFor({ state: "visible", timeout: 5_000 });
    await challengeBtn.click();

    // Share modal should appear with a /c/ URL in the challenge link input
    const linkInput = page.locator("input[aria-label='Challenge link']");
    await linkInput.waitFor({ state: "visible", timeout: 8_000 });

    const url = await linkInput.inputValue();
    expect(url).toContain("/c/");
    expect(url.length).toBeGreaterThan(20);
  });
});

// ── Challenge flow ────────────────────────────────────────────────────────────

test.describe("Challenge spoiler safety and completion", () => {
  /** Create a challenge from a fresh practice game and return the share URL. */
  async function createChallengeLink(context: BrowserContext): Promise<string> {
    const page = await context.newPage();
    // Navigate to app origin before accessing localStorage (about:blank has none)
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.clear());
    await page.goto("/arena/practice/apex_1y?seed=99", { waitUntil: "load" });
    await expect(
      page.getByRole("heading", { name: "Peak Draft" })
    ).toBeVisible({ timeout: 20_000 });
    await completeDraft(page);
    await expect(
      page.getByText(/lineup.*rating|lineup peak/i).first()
    ).toBeVisible({ timeout: 15_000 });

    const challengeBtn = page.getByRole("button", {
      name: /create challenge link/i,
    });
    await challengeBtn.waitFor({ state: "visible", timeout: 5_000 });
    await challengeBtn.click();

    const linkInput = page.locator("input[aria-label='Challenge link']");
    await linkInput.waitFor({ state: "visible", timeout: 8_000 });
    const url = await linkInput.inputValue();
    await page.close();
    return url;
  }

  test("challenge landing does not reveal challenger score before completion", async ({
    context,
    page,
  }) => {
    const url = await createChallengeLink(context);
    const token = url.split("/c/")[1];

    // Open challenge as a fresh session
    await clearLocalStorage(page);
    await page.goto(`/c/${token}`, { waitUntil: "domcontentloaded" });

    // Landing page heading should be visible
    await expect(
      page.getByRole("heading", { name: /you.*been challenged/i })
    ).toBeVisible({ timeout: 15_000 });

    // Must NOT show the challenger's Lineup Peak Rating score
    // (that would be a spoiler before the recipient has played)
    const spoilerText = page.getByText(/lineup peak rating/i);
    await expect(spoilerText).not.toBeVisible();
  });

  test("recipient can start and complete the challenge", async ({
    context,
    page,
  }) => {
    const url = await createChallengeLink(context);
    const token = url.split("/c/")[1];

    await clearLocalStorage(page);
    await page.goto(`/c/${token}`, { waitUntil: "domcontentloaded" });

    // Click "Start Challenge"
    const startBtn = page.getByRole("button", { name: /start challenge/i });
    await startBtn.waitFor({ state: "visible", timeout: 15_000 });
    await startBtn.click();

    // Draft loads
    await expect(
      page.getByRole("heading", { name: "Peak Draft" })
    ).toBeVisible({ timeout: 20_000 });
    await completeDraft(page);

    // After completion — comparison outcome should appear
    await expect(
      page.getByText(/you win|you lose|draw/i)
    ).toBeVisible({ timeout: 20_000 });
  });

  test("refresh during challenge play resumes correctly", async ({
    context,
    page,
  }) => {
    const url = await createChallengeLink(context);
    const token = url.split("/c/")[1];

    await clearLocalStorage(page);
    await page.goto(`/c/${token}`, { waitUntil: "domcontentloaded" });

    const startBtn = page.getByRole("button", { name: /start challenge/i });
    await startBtn.waitFor({ state: "visible", timeout: 15_000 });
    await startBtn.click();

    await expect(
      page.getByRole("heading", { name: "Peak Draft" })
    ).toBeVisible({ timeout: 20_000 });
    await playOneRound(page);

    // Reload — should resume the in-progress draft, not show the landing
    await page.reload({ waitUntil: "load" });
    await expect(
      page.getByRole("heading", { name: "Peak Draft" })
    ).toBeVisible({ timeout: 20_000 });
  });

  test("completed challenge comparison persists after refresh", async ({
    context,
    page,
  }) => {
    const url = await createChallengeLink(context);
    const token = url.split("/c/")[1];

    await clearLocalStorage(page);
    await page.goto(`/c/${token}`, { waitUntil: "domcontentloaded" });

    const startBtn = page.getByRole("button", { name: /start challenge/i });
    await startBtn.waitFor({ state: "visible", timeout: 15_000 });
    await startBtn.click();

    await expect(
      page.getByRole("heading", { name: "Peak Draft" })
    ).toBeVisible({ timeout: 20_000 });
    await completeDraft(page);
    await expect(
      page.getByText(/you win|you lose|draw/i)
    ).toBeVisible({ timeout: 20_000 });

    // Reload — should still show comparison, not the landing page
    await page.reload({ waitUntil: "load" });
    await expect(
      page.getByText(/you win|you lose|draw/i)
    ).toBeVisible({ timeout: 15_000 });
  });

  test("both lineups are shown in comparison after completion", async ({
    context,
    page,
  }) => {
    const url = await createChallengeLink(context);
    const token = url.split("/c/")[1];

    await clearLocalStorage(page);
    await page.goto(`/c/${token}`, { waitUntil: "domcontentloaded" });

    const startBtn = page.getByRole("button", { name: /start challenge/i });
    await startBtn.waitFor({ state: "visible", timeout: 15_000 });
    await startBtn.click();

    await expect(
      page.getByRole("heading", { name: "Peak Draft" })
    ).toBeVisible({ timeout: 20_000 });
    await completeDraft(page);
    await expect(
      page.getByText(/you win|you lose|draw/i)
    ).toBeVisible({ timeout: 20_000 });

    // Both score columns ("Challenger" and "You") should be visible.
    // Multiple elements carry these labels — first() avoids strict-mode violation.
    await expect(page.getByText("Challenger").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("You").first()).toBeVisible({ timeout: 5_000 });
  });

  test("invalid challenge token shows a custom error screen", async ({ page }) => {
    await page.goto("/c/invalid-challenge-token-xyz-123", {
      waitUntil: "networkidle",
    });
    // Tokens that fail HMAC verification → API returns 400 "challenge_expired"
    // → page renders the "Challenge Expired" screen (same helpful UI as actual expiry)
    await expect(
      page
        .getByRole("heading", { name: /challenge expired/i })
        .or(page.getByRole("heading", { name: /challenge not found/i }))
    ).toBeVisible({ timeout: 10_000 });
  });

  test("@mobile challenge landing has no horizontal overflow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    // Use the not-found path as a proxy (no API call needed for this UI state)
    await page.goto("/c/test-overflow-check", { waitUntil: "networkidle" });
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 4);
  });
});
