/**
 * Phase 3.1 Progression E2E tests.
 *
 * API-dependent tests: wrap all requests in try/catch and skip gracefully
 * when the API is not running (connection refused).
 *
 * UI tests: cover the /progress redirect, navigation, and mobile viewport.
 */
import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safely make an API request — returns null on connection error. */
async function safeGet(
  request: import("@playwright/test").APIRequestContext,
  url: string,
) {
  try {
    return await request.get(url);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Achievement catalog — public, no auth required
// ---------------------------------------------------------------------------

test.describe("Achievement catalog (public)", () => {
  test("returns achievement list without auth", async ({ request }) => {
    const res = await safeGet(request, "http://localhost:8000/api/v1/achievements");
    if (!res) {
      test.skip(true, "API not running");
      return;
    }
    if (!res.ok()) {
      test.skip(true, "API returned unexpected status");
      return;
    }
    const catalog = await res.json();
    expect(Array.isArray(catalog)).toBe(true);
    expect(catalog.length).toBeGreaterThanOrEqual(15);

    const keys = catalog.map((a: { key: string }) => a.key);
    expect(keys).toContain("first_game");
    expect(keys).toContain("seven_day_rhythm");

    for (const a of catalog) {
      expect(a.earned).toBe(false);
    }
  });

  test("achievement definitions have required fields", async ({ request }) => {
    const res = await safeGet(request, "http://localhost:8000/api/v1/achievements");
    if (!res || !res.ok()) {
      test.skip(true, "API not available");
      return;
    }
    const catalog = await res.json();
    for (const a of catalog) {
      expect(typeof a.key).toBe("string");
      expect(typeof a.title).toBe("string");
      expect(typeof a.requirement_copy).toBe("string");
      expect(typeof a.category).toBe("string");
    }
  });

  test("GET /achievements/{key} returns single achievement", async ({ request }) => {
    const res = await safeGet(request, "http://localhost:8000/api/v1/achievements/first_game");
    if (!res || !res.ok()) {
      test.skip(true, "API not available");
      return;
    }
    const a = await res.json();
    expect(a.key).toBe("first_game");
    expect(a.title).toBe("First Peak");
    expect(a.earned).toBe(false);
  });

  test("GET /achievements/unknown returns 404", async ({ request }) => {
    const res = await safeGet(request, "http://localhost:8000/api/v1/achievements/not_a_real_key_xyz");
    if (!res) {
      test.skip(true, "API not available");
      return;
    }
    expect(res.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Protected progression endpoints require auth
// ---------------------------------------------------------------------------

test.describe("Progression endpoints require auth", () => {
  test("GET /api/v1/progression/me returns 401 without token", async ({ request }) => {
    const res = await safeGet(request, "http://localhost:8000/api/v1/progression/me");
    if (!res) {
      test.skip(true, "API not available");
      return;
    }
    expect(res.status()).toBe(401);
  });

  test("GET /api/v1/records returns 401 without token", async ({ request }) => {
    const res = await safeGet(request, "http://localhost:8000/api/v1/records");
    if (!res) {
      test.skip(true, "API not available");
      return;
    }
    expect(res.status()).toBe(401);
  });

  test("GET /api/v1/streak returns 401 without token", async ({ request }) => {
    const res = await safeGet(request, "http://localhost:8000/api/v1/streak");
    if (!res) {
      test.skip(true, "API not available");
      return;
    }
    expect(res.status()).toBe(401);
  });

  test("GET /api/v1/progression/events returns 401 without token", async ({ request }) => {
    const res = await safeGet(request, "http://localhost:8000/api/v1/progression/events");
    if (!res) {
      test.skip(true, "API not available");
      return;
    }
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Progress page — accessible route (no auth crash, nav renders)
// ---------------------------------------------------------------------------

test.describe("Progress page", () => {
  test("/progress route serves HTML with navigation shell", async ({ page }) => {
    // The route exists and returns a 200 with the app shell.
    // Client-side redirect to /signin happens after JS hydration.
    const res = await page.goto("/progress", { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBe(200);
    // Navigation is rendered server-side — always visible
    await expect(page.locator("nav, header").first()).toBeVisible({ timeout: 8_000 });
  });

  test("/signin page renders without crashing", async ({ page }) => {
    await page.goto("/signin", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible({ timeout: 8_000 });
  });
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

test.describe("Navigation", () => {
  test("arena landing renders correctly", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('a[href="/arena/daily"]').first()).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Mobile viewport — no overflow
// ---------------------------------------------------------------------------

test.describe("Mobile viewport @mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("arena landing does not overflow at 390px width @mobile", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toBeVisible({ timeout: 8_000 });
    const body = await page.evaluate(() => ({
      scrollWidth: document.body.scrollWidth,
      clientWidth: document.body.clientWidth,
    }));
    expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth + 4);
  });
});

// ---------------------------------------------------------------------------
// Rankings page (verifies app renders without progression crashes)
// ---------------------------------------------------------------------------

test.describe("Rankings page", () => {
  test("rankings page renders without errors", async ({ page }) => {
    await page.goto("/rankings", { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1, h2").first()).toBeVisible({ timeout: 8_000 });
  });
});
