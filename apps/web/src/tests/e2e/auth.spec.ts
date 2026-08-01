/**
 * Authentication, end to end, WITHOUT a live identity provider.
 *
 * WHY NO LIVE PROVIDER. The linked development Supabase project reports
 * `external: ["email"]` — Google OAuth is not enabled — and `mailer_autoconfirm`
 * is false with no mailbox reachable from this environment, so neither a real
 * Google consent screen nor a real magic-link click can be automated from here.
 * The manual dashboard steps are in `docs/implementation/AUTH_CONFIGURATION.md`.
 *
 * WHAT IS THEREFORE TESTED, and why it is still worth a browser:
 *   - The callback ROUTE HANDLER, driven directly. Every branch a provider can
 *     produce (`?error=`, a rejected `?code=`, a `token_hash` link, nothing at
 *     all) is a plain GET, so a real HTTP round trip through real Next.js
 *     middleware, real redirects and real rendering exercises the whole path
 *     except the one hop Supabase owns.
 *   - Open-redirect safety at the HTTP layer. A unit test can prove `safeNext`
 *     returns "/"; only a browser can prove the `Location` header the user's
 *     browser actually follows is same-origin.
 *   - Guest play with no wall — an integration property by definition.
 *   - The signed-in header, via the documented `window.__peak3TestAuth` bridge
 *     (see `lib/auth.ts`), which is how `ranked.spec.ts` already establishes
 *     identities here.
 */
import { test, expect, type Page } from "@playwright/test";

const ERROR_PATH = "/auth/auth-code-error";
const COMPLETE_PATH = "/auth/complete";

/**
 * Wait for React to hydrate.
 *
 * `domcontentloaded` is not enough for any control whose behaviour is an
 * `onClick` — the burger menu in particular. `__peak3TestAuth` is attached in an
 * `AuthProvider` effect, so its presence is a precise hydration marker and one
 * this suite already depends on.
 */
async function waitForHydration(page: Page) {
  await page.waitForFunction(() => typeof window.__peak3TestAuth !== "undefined");
}

/** Open the small-screen navigation sheet, once it can actually respond. */
async function openDrawer(page: Page) {
  await waitForHydration(page);
  await page.getByTestId("mobile-nav-trigger").click();
  await expect(page.getByTestId("mobile-nav-drawer")).toBeVisible();
}

/** Establish a signed-in identity without a provider. Dev-only bridge. */
async function signInAsTestUser(page: Page, email = "ada.lovelace@example.com") {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await page.evaluate((address) => {
    window.__peak3TestAuth!.setSession("e2e-token", {
      id: "e2e-auth-user",
      email: address,
      isAnonymous: false,
    });
  }, email);
}

/* ================================================================== */
/* The callback route                                                  */
/* ================================================================== */

test.describe("auth callback — failure paths reach a real page", () => {
  test("a cancelled provider consent screen lands on the error page, not a spinner", async ({
    page,
  }) => {
    // This is what Supabase forwards when a user presses Cancel on Google.
    // The client component this replaced showed "Completing sign-in…" forever.
    await page.goto(
      "/auth/callback?error=access_denied&error_description=The+user+denied+access",
    );

    await expect(page).toHaveURL(new RegExp(`${ERROR_PATH}\\?`));
    await expect(page.getByTestId("auth-error")).toBeVisible();
    await expect(page.getByTestId("auth-error-detail")).toContainText("The user denied access");
    await expect(page.getByTestId("auth-error-retry")).toBeVisible();
  });

  test("an expired magic link explains itself and offers a fresh one", async ({ page }) => {
    await page.goto(
      "/auth/callback?error=access_denied&error_code=otp_expired" +
        "&error_description=Email+link+is+invalid+or+has+expired",
    );

    await expect(page.getByTestId("auth-error")).toBeVisible();
    await expect(page.getByTestId("auth-error-detail")).toContainText(/invalid or has expired/i);
    await expect(page.getByTestId("auth-error-retry")).toHaveAttribute("href", /^\/signin/);
  });

  test("a bare visit with no grant is an error, not a hang", async ({ page }) => {
    await page.goto("/auth/callback");
    await expect(page).toHaveURL(new RegExp(`${ERROR_PATH}\\?reason=missing_grant`));
    await expect(page.getByTestId("auth-error")).toBeVisible();
  });

  test("a code Supabase rejects lands on the error page with its reason", async ({ page }) => {
    // A syntactically valid but unredeemable code: no PKCE verifier cookie
    // exists in this context, so the real exchange really fails.
    await page.goto("/auth/callback?code=not-a-real-authorization-code&next=%2Fprofile");

    await expect(page).toHaveURL(new RegExp(ERROR_PATH));
    await expect(page.getByTestId("auth-error")).toBeVisible();
    // And the destination survives the failure, so retrying returns there.
    await expect(page.getByTestId("auth-error-retry")).toHaveAttribute(
      "href",
      "/signin?returnTo=%2Fprofile",
    );
  });

  test("an unrecognised OTP type is refused before it reaches the SDK", async ({ page }) => {
    await page.goto("/auth/callback?token_hash=abc&type=phone_change");
    await expect(page).toHaveURL(new RegExp(`reason=unsupported_otp_type`));
    await expect(page.getByTestId("auth-error")).toBeVisible();
  });

  test("the callback issues a 303, so a single-use grant is never re-issued", async ({
    request,
  }) => {
    const response = await request.get("/auth/callback?error=access_denied", {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);
    expect(response.headers()["location"]).toContain(ERROR_PATH);
  });
});

test.describe("auth callback — open redirect", () => {
  const hostile = [
    ["protocol-relative", "//evil.example"],
    ["backslash", "/\\evil.example"],
    ["absolute", "https://evil.example"],
    ["encoded protocol-relative", "/%2f%2fevil.example"],
    ["javascript scheme", "javascript:alert(1)"],
  ] as const;

  for (const [name, value] of hostile) {
    test(`refuses to redirect off-origin via ${name}`, async ({ request, baseURL }) => {
      const response = await request.get(
        `/auth/callback?error=access_denied&next=${encodeURIComponent(value)}`,
        { maxRedirects: 0 },
      );
      const location = new URL(response.headers()["location"], baseURL);
      // The Location header a browser will actually follow.
      expect(location.origin).toBe(new URL(baseURL!).origin);
      expect(location.searchParams.get("next")).toBe("/");
    });
  }

  test("keeps a legitimate in-app destination intact", async ({ request, baseURL }) => {
    const response = await request.get(
      "/auth/callback?error=access_denied&next=%2Farena%2Frun-the-table%3Fmode%3Ddaily",
      { maxRedirects: 0 },
    );
    const location = new URL(response.headers()["location"], baseURL);
    expect(location.searchParams.get("next")).toBe("/arena/run-the-table?mode=daily");
  });
});

test.describe("auth callback — the success hop exists", () => {
  test("the completion interstitial is a real route", async ({ page }) => {
    // The route handler redirects here on a successful grant; proving it renders
    // is what stops a successful sign-in landing on a 404.
    await page.goto(`${COMPLETE_PATH}?next=%2Frankings`);
    // With no session it continues straight through rather than trapping anyone.
    await expect(page).toHaveURL(/\/rankings/, { timeout: 15_000 });
  });

  test("it refuses a hostile destination even when reached directly", async ({
    page,
    baseURL,
  }) => {
    await page.goto(`${COMPLETE_PATH}?next=${encodeURIComponent("//evil.example")}`);
    await expect(page).toHaveURL(new URL("/", baseURL).toString(), { timeout: 15_000 });
  });
});

/* ================================================================== */
/* Sign-in page                                                        */
/* ================================================================== */

test.describe("sign-in page", () => {
  test("offers Google and a magic link, with password behind a disclosure", async ({ page }) => {
    await page.goto("/signin");
    await expect(page.getByTestId("google-signin")).toBeVisible();
    await expect(page.getByTestId("magic-link-form")).toBeVisible();
    await expect(page.getByTestId("password-form")).toHaveCount(0);

    await page.getByTestId("password-toggle").click();
    await expect(page.getByTestId("password-form")).toBeVisible();
  });

  test("says an account is optional", async ({ page }) => {
    await page.goto("/signin");
    await expect(page.getByText(/play every mode without an account/i)).toBeVisible();
  });

  test("carries a legitimate returnTo across to sign-up", async ({ page }) => {
    await page.goto("/signin?returnTo=%2Farena%2Franked");
    await expect(page.getByRole("link", { name: /create one/i })).toHaveAttribute(
      "href",
      "/signup?returnTo=%2Farena%2Franked",
    );
  });

  test("drops a hostile returnTo rather than carrying it", async ({ page }) => {
    await page.goto(`/signin?returnTo=${encodeURIComponent("https://evil.example")}`);
    await expect(page.getByRole("link", { name: /create one/i })).toHaveAttribute(
      "href",
      "/signup",
    );
  });
});

/* ================================================================== */
/* No auth wall                                                        */
/* ================================================================== */

test.describe("guest play is never gated", () => {
  for (const path of ["/", "/arena", "/rankings", "/daily/grid", "/play/endless"]) {
    test(`${path} is reachable signed out`, async ({ page }) => {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      // Not bounced to a sign-in screen, and no modal in the way.
      await expect(page).not.toHaveURL(/\/signin/);
      await expect(page.getByTestId("signin-page")).toHaveCount(0);
    });
  }

  test("the header offers sign-in as a link, not an interception", async ({ page }) => {
    await page.goto("/rankings", { waitUntil: "domcontentloaded" });
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    const signIn = nav.getByTestId("nav-signin");
    await expect(signIn).toBeVisible();
    // And it brings you back to where you were.
    await expect(signIn).toHaveAttribute("href", "/signin?returnTo=%2Frankings");
  });
});

/* ================================================================== */
/* Signed-in chrome                                                    */
/* ================================================================== */

test.describe("signed-in header", () => {
  test("shows initials, the account destinations, and a sign-out", async ({ page }) => {
    await signInAsTestUser(page);

    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByTestId("nav-signin")).toHaveCount(0);

    const trigger = nav.getByTestId("nav-account-trigger");
    await expect(trigger).toBeVisible();
    await expect(trigger.getByTestId("account-avatar")).toHaveAttribute("data-initials", "AL");

    await trigger.click();
    const panel = page.getByTestId("nav-account-panel");
    await expect(panel.locator('[data-nav-item="profile"]')).toHaveAttribute("href", "/profile");
    await expect(panel.locator('[data-nav-item="progress"]')).toHaveAttribute("href", "/progress");
    await expect(panel.locator('[data-nav-item="history"]')).toHaveAttribute("href", "/history");
    await expect(page.getByTestId("nav-signout")).toBeVisible();
  });

  test("signing out from the header returns the guest affordance", async ({ page }) => {
    await signInAsTestUser(page);
    await page.getByTestId("nav-account-trigger").click();
    await page.getByTestId("nav-signout").click();

    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByTestId("nav-signin")).toBeVisible();
    await expect(nav.getByTestId("nav-account-trigger")).toHaveCount(0);
  });

  test("no photograph is ever loaded for a person", async ({ page }) => {
    await signInAsTestUser(page);
    const avatar = page.getByTestId("account-avatar");
    await expect(avatar).toBeVisible();
    await expect(avatar.locator("img")).toHaveCount(0);
  });
});

/* ================================================================== */
/* Mobile drawer                                                       */
/* ================================================================== */

test.describe("mobile account section @mobile", () => {
  test("a guest gets one sign-in row", async ({ page }) => {
    await page.goto("/rankings", { waitUntil: "domcontentloaded" });
    await openDrawer(page);
    await expect(page.getByTestId("mobile-nav-account")).toHaveAttribute(
      "href",
      "/signin?returnTo=%2Frankings",
    );
  });

  test("a signed-in player reaches profile, progress, history and sign-out", async ({ page }) => {
    await signInAsTestUser(page);
    await openDrawer(page);
    await page.getByTestId("mobile-nav-toggle-account").click();

    await expect(page.getByTestId("mobile-nav-profile")).toHaveAttribute("href", "/profile");
    await expect(page.getByTestId("mobile-nav-progress")).toHaveAttribute("href", "/progress");
    await expect(page.getByTestId("mobile-nav-history")).toHaveAttribute("href", "/history");
    await expect(page.getByTestId("mobile-nav-signout")).toBeVisible();
  });
});
