/**
 * Head-to-Head — smoke coverage for states reachable without a second
 * account (previously zero e2e coverage for this family at all). The
 * real two-account create -> invite -> accept -> settle flow needs two
 * independent identities sharing server-side match state; see the
 * dedicated screenshot/QA tooling in `tests/tools/capture-daily-rtt-pvp-
 * shots.ts` for that heavier flow, which is deliberately not part of the
 * default suite.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { mintTestAccessToken } from "./helpers/test-jwt";

const HUB = "/arena/run-the-table/h2h";

async function signInAs(context: BrowserContext, page: Page, sub: string): Promise<string> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
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

test.describe("Head-to-Head hub", () => {
  test("anonymous visitor with no active run is told to play RTT first, not shown a create button", async ({
    page,
  }) => {
    // ChallengeCreator checks for an active run before it checks auth — a
    // fresh anonymous context has neither, and the "no run" message wins.
    await page.goto(HUB, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Head-to-Head", exact: true })).toBeVisible();
    await expect(page.getByTestId("h2h-create-no-run")).toContainText(/start a run the table run first/i);
    await expect(page.getByRole("button", { name: /create a head-to-head/i })).toHaveCount(0);
  });

  test("signed-in visitor with no active run is told to play RTT first", async ({ page, context }) => {
    await signInAs(context, page, `e2e-h2h-${Date.now()}`);
    await page.goto(HUB, { waitUntil: "networkidle" });
    await expect(page.getByTestId("h2h-create-no-run")).toContainText(/start a run the table run first/i);
  });

  test("history shows the empty state for a fresh account", async ({ page, context }) => {
    await signInAs(context, page, `e2e-h2h-${Date.now()}`);
    await page.goto(HUB, { waitUntil: "networkidle" });
    await expect(page.getByTestId("h2h-history-empty")).toBeVisible();
  });
});

test.describe("Head-to-Head match page", () => {
  test("an unauthenticated visitor sees a sign-in message, not a crash", async ({ page }) => {
    await page.goto(`/arena/run-the-table/h2h/00000000-0000-0000-0000-000000000000`, {
      waitUntil: "networkidle",
    });
    await expect(page.getByTestId("peak-v2-shell").getByRole("alert")).toContainText(
      /sign in to see this head-to-head/i,
    );
  });
});

test.describe("Head-to-Head invite landing", () => {
  test("an invalid token explains the broken link instead of rendering an empty page", async ({ page }) => {
    await page.goto(`/arena/run-the-table/h2h/invite/not-a-real-token`, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: /did not work/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /play run the table/i })).toHaveAttribute(
      "href",
      "/arena/run-the-table",
    );
  });
});
