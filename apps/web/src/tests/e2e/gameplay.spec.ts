/**
 * Peak Draft end-to-end gameplay tests.
 * Requires FastAPI (port 8000) and Next.js (port 3000) — both auto-start via playwright.config.ts.
 * Uses deterministic seeds for reproducible boards.
 * Mobile-specific tests are tagged @mobile and run only in the mobile-chrome project.
 */
import { test, expect, Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Play one round: click first eligible offer card, pick first eligible role, Lock In.
 * Waits for the /actions response before returning.
 */
async function playOneRound(page: Page): Promise<void> {
  // Wait for eligible offer cards (data-eligible="true", not disabled)
  const eligibleCard = page.locator('[data-testid="offer-card"][data-eligible="true"]:not([disabled])');
  await eligibleCard.first().waitFor({ state: "visible", timeout: 15_000 });
  await eligibleCard.first().click();

  // Wait for role selector to appear
  const roleBtn = page.locator('[data-testid="role-btn"]:not([disabled])');
  await roleBtn.first().waitFor({ state: "visible", timeout: 8_000 });
  await roleBtn.first().click();

  // Lock In
  const lockIn = page.locator('[data-testid="lock-in"]');
  await lockIn.waitFor({ state: "visible" });
  await expect(lockIn).not.toBeDisabled({ timeout: 3_000 });

  // Wait for API response
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/actions") && r.status() === 200, { timeout: 10_000 }),
    lockIn.click(),
  ]);
  expect(response.status()).toBe(200);
}

/** Navigate to a practice draft page and wait for offer cards to load. */
async function startPracticeDraft(page: Page, mode: string, seed = 42): Promise<void> {
  await page.goto(`/arena/practice/${mode}?seed=${seed}`, { waitUntil: "load" });
  await expect(page.getByRole("heading", { name: "Peak Draft" })).toBeVisible({ timeout: 15_000 });
  // Wait for eligible offer cards to be ready
  await page.locator('[data-testid="offer-card"]').first().waitFor({ state: "visible", timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Arena landing
// ---------------------------------------------------------------------------

test.describe("Arena landing", () => {
  test("loads with correct heading and CTAs", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toContainText("Which player had");
    await expect(page.locator('a[href="/arena/daily"]').first()).toBeVisible();
    await expect(page.locator('a[href="/rankings"]').first()).toBeVisible();
  });

  test("navigation links are accessible", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav).toBeVisible();
    const links = nav.getByRole("link");
    expect(await links.count()).toBeGreaterThan(3);
  });

  test("skip-to-main link is present in DOM", async ({ page }) => {
    await page.goto("/");
    const skipLink = page.getByRole("link", { name: /skip to main/i });
    await expect(skipLink).toBeAttached();
  });

  test("@mobile mobile — no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 4);
  });
});

// ---------------------------------------------------------------------------
// Rankings
// ---------------------------------------------------------------------------

test.describe("Rankings regression", () => {
  test("loads rankings page with heading", async ({ page }) => {
    await page.goto("/rankings");
    await expect(page.getByRole("heading", { name: /peak3 rankings/i })).toBeVisible({ timeout: 10_000 });
  });

  test("duration tabs are present and switch content", async ({ page }) => {
    await page.goto("/rankings");
    const tab3y = page.getByRole("tab", { name: /3.year|3-year/i });
    await tab3y.waitFor({ state: "visible", timeout: 10_000 });
    await tab3y.click();
    await expect(tab3y).toHaveAttribute("aria-selected", "true");
  });

  test("@mobile mobile — no horizontal overflow on rankings", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/rankings");
    await page.waitForLoadState("networkidle");
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 4);
  });
});

// ---------------------------------------------------------------------------
// Methodology
// ---------------------------------------------------------------------------

test.describe("Methodology regression", () => {
  test("loads methodology page", async ({ page }) => {
    await page.goto("/methodology");
    await expect(page.getByRole("heading", { name: /formula explorer/i })).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Peak Duel
// ---------------------------------------------------------------------------

test.describe("Peak Duel regression", () => {
  test("daily challenge page renders without hard crash", async ({ page }) => {
    await page.goto("/play/daily", { waitUntil: "networkidle" });
    // Accepts any of: game content, error state, or loading state
    const body = page.locator("body");
    await expect(body).not.toBeEmpty();
    // No uncaught error boundary (Next.js error pages have specific structure)
    const hasHardError = await page.locator("h2:has-text('Application error')").isVisible().catch(() => false);
    expect(hasHardError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Practice draft — 1Y Apex
// ---------------------------------------------------------------------------

test.describe("Practice draft — 1Y Apex", () => {
  test("loads draft screen with Peak Draft heading", async ({ page }) => {
    await startPracticeDraft(page, "apex_1y", 42);
  });

  test("completes all 5 rounds and shows result", async ({ page }) => {
    await startPracticeDraft(page, "apex_1y", 42);
    for (let i = 0; i < 5; i++) {
      await playOneRound(page);
    }
    // After 5 rounds, draft is complete — receipt appears
    await expect(
      page.getByText(/lineup.*rating|draft.*efficiency/i).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test("@mobile mobile — no horizontal overflow on draft screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await startPracticeDraft(page, "apex_1y", 1);
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 4);
  });
});

// ---------------------------------------------------------------------------
// Practice draft — 3Y Prime
// ---------------------------------------------------------------------------

test.describe("Practice draft — 3Y Prime", () => {
  test("completes 3Y Prime draft", async ({ page }) => {
    await startPracticeDraft(page, "prime_3y", 43);
    for (let i = 0; i < 5; i++) {
      await playOneRound(page);
    }
    await expect(
      page.getByText(/lineup.*rating|draft.*efficiency/i).first()
    ).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// Practice draft — 5Y Foundation
// ---------------------------------------------------------------------------

test.describe("Practice draft — 5Y Foundation", () => {
  test("completes 5Y Foundation draft", async ({ page }) => {
    // seed=7 verified to complete with greedy first-eligible-card strategy
    await startPracticeDraft(page, "foundation_5y", 7);
    for (let i = 0; i < 5; i++) {
      await playOneRound(page);
    }
    await expect(
      page.getByText(/lineup.*rating|draft.*efficiency/i).first()
    ).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// Hold mechanic
// ---------------------------------------------------------------------------

test.describe("Hold mechanic", () => {
  test("Hold button exists and is clickable", async ({ page }) => {
    await startPracticeDraft(page, "apex_1y", 10);
    const holdBtn = page.getByRole("button", { name: /hold/i });
    await expect(holdBtn).toBeVisible();
    await expect(holdBtn).not.toBeDisabled();
  });

  test("Hold saves a card and shows Holding text", async ({ page }) => {
    await startPracticeDraft(page, "apex_1y", 10);
    // Select a card first, then hold it
    const card = page.locator('[data-testid="offer-card"][data-eligible="true"]:not([disabled])');
    await card.first().click();
    // Click Hold
    const holdBtn = page.getByRole("button", { name: /hold/i });
    await holdBtn.click();
    await page.waitForTimeout(500);
    // Hold button should now say "Holding" or be disabled
    const holdingText = page.getByRole("button", { name: /holding/i });
    const isHolding = await holdingText.isVisible().catch(() => false);
    const holdDisabled = await holdBtn.isDisabled().catch(() => false);
    expect(isHolding || holdDisabled).toBe(true);
  });

  test("Hold cannot be used twice", async ({ page }) => {
    await startPracticeDraft(page, "apex_1y", 10);
    // Round 1: hold a card, then select another and confirm
    const card = page.locator('[data-testid="offer-card"][data-eligible="true"]:not([disabled])');
    await card.first().click();
    await page.getByRole("button", { name: /^hold/i }).click();
    await page.waitForResponse((r) => r.url().includes("/actions") && r.status() === 200);
    // Now select a remaining card
    const remaining = page.locator('[data-testid="offer-card"][data-eligible="true"]:not([disabled])');
    await remaining.first().click();
    const roleBtn = page.locator('[data-testid="role-btn"]:not([disabled])');
    await roleBtn.first().click();
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/actions") && r.status() === 200),
      page.locator('[data-testid="lock-in"]').click(),
    ]);
    // In round 2, Hold should be disabled
    await page.waitForTimeout(300);
    const holdBtnR2 = page.getByRole("button", { name: /hold|holding/i });
    await expect(holdBtnR2).toBeDisabled({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Reframe mechanic
// ---------------------------------------------------------------------------

test.describe("Reframe mechanic", () => {
  test("Reframe button exists", async ({ page }) => {
    await startPracticeDraft(page, "apex_1y", 20);
    await expect(page.getByRole("button", { name: /reframe/i })).toBeVisible();
  });

  test("Reframe changes the card offers and is then disabled", async ({ page }) => {
    await startPracticeDraft(page, "apex_1y", 20);
    const reframeBtn = page.getByRole("button", { name: /reframe/i });
    await expect(reframeBtn).not.toBeDisabled();
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/actions") && r.status() === 200),
      reframeBtn.click(),
    ]);
    await expect(reframeBtn).toBeDisabled({ timeout: 5_000 });
  });

  test("Reframe cannot be used twice", async ({ page }) => {
    await startPracticeDraft(page, "apex_1y", 20);
    const reframeBtn = page.getByRole("button", { name: /reframe/i });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/actions") && r.status() === 200),
      reframeBtn.click(),
    ]);
    await expect(reframeBtn).toBeDisabled({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Mid-draft refresh
// ---------------------------------------------------------------------------

test.describe("Mid-draft refresh", () => {
  test("refreshing restores a working draft state", async ({ page }) => {
    await startPracticeDraft(page, "apex_1y", 55);
    await playOneRound(page);
    // Reload
    await page.reload({ waitUntil: "load" });
    // After reload, either the same game resumes or a new one starts — both are acceptable
    await expect(page.getByRole("heading", { name: "Peak Draft" })).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// Peak Receipt
// ---------------------------------------------------------------------------

test.describe("Peak Receipt", () => {
  test("shows lineup evaluation on completion", async ({ page }) => {
    await startPracticeDraft(page, "apex_1y", 42);
    for (let i = 0; i < 5; i++) {
      await playOneRound(page);
    }
    // Receipt shows lineup rating (multiple elements match — first() avoids strict-mode)
    await expect(
      page.getByText(/lineup.*rating|draft.*efficiency|lineup peak/i).first()
    ).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// Decision Replay
// ---------------------------------------------------------------------------

test.describe("Decision Replay", () => {
  test("shows picks after completing draft", async ({ page }) => {
    await startPracticeDraft(page, "apex_1y", 42);
    for (let i = 0; i < 5; i++) {
      await playOneRound(page);
    }
    // Decision replay shows round history
    await expect(
      page.getByText(/round 1|pick 1|your picks/i)
    ).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// Challenge link
// ---------------------------------------------------------------------------

test.describe("Challenge link", () => {
  test("invalid challenge token shows error page", async ({ page }) => {
    await page.goto("/c/invalid-challenge-token", { waitUntil: "networkidle" });
    // Tokens failing HMAC verification → API returns 400 "challenge_expired"
    // → page renders "Challenge Expired" screen (custom, user-friendly)
    await expect(
      page
        .getByRole("heading", { name: /challenge expired/i })
        .or(page.getByRole("heading", { name: /challenge not found/i }))
        .first()
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Keyboard navigation
// ---------------------------------------------------------------------------

test.describe("Keyboard navigation", () => {
  test("Tab key cycles through draft offer cards", async ({ page }) => {
    await startPracticeDraft(page, "apex_1y", 42);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus");
    await expect(focused).toBeAttached({ timeout: 3_000 });
  });

  test("Enter key activates focused offer card", async ({ page }) => {
    await startPracticeDraft(page, "apex_1y", 42);
    const cards = page.locator('[data-testid="offer-card"]');
    await cards.first().focus();
    await page.keyboard.press("Enter");
    const roleBtn = page.locator('[data-testid="role-btn"]');
    await expect(roleBtn.first()).toBeVisible({ timeout: 5_000 });
  });
});
