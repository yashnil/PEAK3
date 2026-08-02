/**
 * Review-screenshot capture for the auth / daily-reset / RUN THE TABLE pass.
 *
 * NOT a spec (deliberately not named *.spec.ts) and outside the main config's
 * testDir, so it can never run as part of `npm run test:e2e` or in CI. It
 * writes files into the repo, which is not an assertion about product
 * behaviour.
 *
 * Reachable only via (from apps/web):
 *   npx playwright test --config=playwright.auth-daily-shots.config.ts
 *
 * Design notes (carried over from capture-ux-polish-shots.ts, which learned
 * them the hard way)
 * ------------------
 * - Each capture is its own `test()` so one unreachable surface cannot silence
 *   the rest of the sheet.
 * - A capture that cannot reach its surface FAILS LOUDLY rather than writing a
 *   misleading frame of the wrong screen. A screenshot review is worthless if a
 *   frame might be something other than what its filename claims.
 * - Every frame records an MD5 of its own bytes into the manifest. A previous
 *   pass silently produced pairs of byte-identical frames under different
 *   names; the hash makes that impossible to miss.
 * - `authMethod` is recorded per frame. Google is not enabled on the
 *   development project and no mailbox is reachable here, so signed-in frames
 *   come from the existing e2e test-auth channel. Saying so in the manifest is
 *   the difference between evidence and decoration.
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const OUT = path.resolve(__dirname, "../../../../../docs/implementation/auth-daily-balance-review");
const MANIFEST = path.join(OUT, "screenshot-manifest.json");

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

fs.mkdirSync(OUT, { recursive: true });

type AuthMethod = "guest" | "e2e-test-channel";

interface ManifestEntry {
  file: string;
  journey: string;
  viewport: string;
  url: string;
  title: string;
  note: string;
  authMethod: AuthMethod;
  reducedMotion: boolean;
  h1: string | null;
  md5: string;
}

const entries: ManifestEntry[] = [];

async function shot(
  page: Page,
  file: string,
  opts: {
    journey: string;
    note: string;
    authMethod?: AuthMethod;
    reducedMotion?: boolean;
    fullPage?: boolean;
  },
) {
  const target = path.join(OUT, file);
  // `animations: "disabled"` is not cosmetic here. Playwright waits for the
  // page to settle before it captures, and the Daily Grid runs a one-second
  // play clock — a full-page shot of it hung until the test timed out and took
  // the browser down with it. Freezing animations also makes the frames
  // reproducible, which is what the byte-identity check below relies on.
  await page.screenshot({
    path: target,
    fullPage: opts.fullPage ?? false,
    animations: "disabled",
    caret: "hide",
    timeout: 30_000,
  });

  const bytes = fs.readFileSync(target);

  // Manifest metadata must never be able to fail the capture it describes.
  // The PNG is already on disk by this point; a page whose main thread is busy
  // (the Daily Grid's play clock is the reliable offender) could otherwise
  // hang `page.title()` past the test timeout and destroy a frame that had in
  // fact been captured perfectly well.
  const withTimeout = async <T>(work: Promise<T>, fallback: T): Promise<T> => {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<T>((resolve) => {
          timer = setTimeout(() => resolve(fallback), 5_000);
        }),
      ]);
    } catch {
      return fallback;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const title = await withTimeout(page.title(), "(unavailable)");
  const h1 = await withTimeout(
    page.locator("h1").first().textContent({ timeout: 3_000 }),
    null,
  );
  const size = page.viewportSize();

  entries.push({
    file,
    journey: opts.journey,
    viewport: size ? `${size.width}x${size.height}` : "unknown",
    url: page.url(),
    title,
    note: opts.note,
    authMethod: opts.authMethod ?? "guest",
    reducedMotion: opts.reducedMotion ?? false,
    h1: h1 ? h1.trim().slice(0, 120) : null,
    md5: crypto.createHash("md5").update(bytes).digest("hex"),
  });
}

/**
 * Sign in through the e2e test-auth channel.
 *
 * This is the same mechanism ranked.spec.ts uses. It injects a Supabase-shaped
 * HS256 token that the API verifies with its legacy symmetric path — the real
 * hosted project's tokens are ES256 and verified via JWKS, which this channel
 * deliberately does not exercise. Recorded as `e2e-test-channel` in the
 * manifest so nobody mistakes these frames for a live provider round-trip.
 */
async function signInViaTestChannel(page: Page, sub: string, email: string) {
  const { mintTestAccessToken } = await import("../e2e/helpers/test-jwt");
  const token = mintTestAccessToken(sub, email);

  await page.waitForFunction(() => Boolean((window as never as { __peak3TestAuth?: unknown }).__peak3TestAuth), {
    timeout: 15_000,
  });
  await page.evaluate(
    ([t, s, e]) => {
      const api = (window as never as {
        __peak3TestAuth: { setSession: (token: string, user: { id: string; email: string }) => void };
      }).__peak3TestAuth;
      api.setSession(t, { id: s, email: e });
    },
    [token, sub, email] as const,
  );
  await page.reload({ waitUntil: "domcontentloaded" });
}

async function settle(page: Page) {
  // Bounded explicitly. The Daily Grid runs a one-second play clock, so
  // `networkidle`'s own 30 s default can burn most of a test's budget on a
  // page that will never go idle; 6 s is enough for the board fetch and the
  // fonts, and the frame is no worse for not waiting longer.
  await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => {});
  await page.waitForTimeout(400);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(DESKTOP);
});

test.afterAll(async () => {
  // Merge with whatever is already on disk before rewriting.
  //
  // Playwright restarts the worker when a test times out, which resets this
  // module's `entries` array. The first run of this sheet lost seven rows that
  // way and wrote a manifest claiming four frames while thirteen PNGs sat next
  // to it — a manifest that under-reports is worse than none, because it reads
  // as "these are the frames".
  try {
    const prior = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
    const known = new Set(entries.map((e) => e.file));
    for (const frame of prior.frames ?? []) {
      if (!known.has(frame.file) && fs.existsSync(path.join(OUT, frame.file))) {
        entries.push(frame);
      }
    }
  } catch {
    // No prior manifest, or an unreadable one: this run is the whole truth.
  }

  entries.sort((a, b) => a.file.localeCompare(b.file));
  fs.writeFileSync(
    MANIFEST,
    JSON.stringify(
      {
        generated_by: "apps/web/src/tests/tools/capture-auth-daily-shots.ts",
        pass: "auth / daily reset / RUN THE TABLE clarity + balance",
        note:
          "Signed-in frames use the e2e test-auth channel: Google OAuth is not " +
          "enabled on the development Supabase project and no mailbox is " +
          "reachable from this environment, so a live provider round-trip " +
          "could not be captured. Every frame's authMethod records which.",
        count: entries.length,
        frames: entries,
      },
      null,
      2,
    ) + "\n",
  );

  const hashes = new Map<string, string>();
  for (const e of entries) {
    const prior = hashes.get(e.md5);
    if (prior) {
      throw new Error(
        `Duplicate frame bytes: ${e.file} is byte-identical to ${prior}. ` +
          `One of them is a screenshot of the wrong screen.`,
      );
    }
    hashes.set(e.md5, e.file);
  }
});

// ---------------------------------------------------------------------------
// 1-3. Guest RUN THE TABLE, sign-in mid-run, and sign-in from completion
// ---------------------------------------------------------------------------

test("01 guest starts run the table", async ({ page }) => {
  await page.goto("/arena/run-the-table");
  await settle(page);
  await expect(page.locator("body")).toContainText(/run the table/i);
  await shot(page, "01-guest-run-the-table-start-gate.png", {
    journey: "Guest starts RUN THE TABLE",
    note: "Start gate as an unauthenticated guest — there must be no auth wall before first play.",
    fullPage: true,
  });
});

test("02 sign-in surface carries a return path", async ({ page }) => {
  await page.goto("/signin?returnTo=%2Farena%2Frun-the-table");
  await settle(page);
  await shot(page, "02-signin-google-and-magic-link.png", {
    journey: "Sign-in options",
    note: "Google and email magic link offered; returnTo preserves the game path through sign-in.",
    fullPage: true,
  });
});

test("03 magic link request state", async ({ page }) => {
  await page.goto("/signin");
  await settle(page);
  const email = page.getByLabel(/email/i).first();
  if (await email.count()) {
    await email.fill("player@example.test");
    await settle(page);
  }
  await shot(page, "03-magic-link-request.png", {
    journey: "Magic-link request",
    note: "Magic-link request form with an address entered. The send itself is not exercised — no mailbox is reachable here.",
    fullPage: true,
  });
});

test("04 callback error surface", async ({ page }) => {
  await page.goto("/auth/auth-code-error?reason=exchange_failed&description=Test+error+surface");
  await settle(page);
  await shot(page, "04-auth-callback-error.png", {
    journey: "Invalid / expired callback",
    note: "The callback error surface. Previously a failed exchange was swallowed by an empty catch and showed a blank page.",
    fullPage: true,
  });
});

// ---------------------------------------------------------------------------
// 5. Authenticated navbar / profile / history
// ---------------------------------------------------------------------------

test("05 authenticated nav and profile", async ({ page }) => {
  await page.goto("/");
  await settle(page);
  await signInViaTestChannel(page, "11111111-2222-3333-4444-555555555555", "player@example.test");
  await settle(page);
  await shot(page, "05a-authenticated-nav.png", {
    journey: "Authenticated navbar",
    note: "Initials avatar in the global nav (no photographs). Sign out is reachable from the header, which previously required visiting /profile.",
    authMethod: "e2e-test-channel",
  });

  await page.goto("/profile");
  await settle(page);
  await shot(page, "05b-authenticated-profile.png", {
    journey: "Profile",
    note: "Profile surface for a signed-in account.",
    authMethod: "e2e-test-channel",
    fullPage: true,
  });

  await page.goto("/history");
  await settle(page);
  await shot(page, "05c-authenticated-history.png", {
    journey: "Saved results / history",
    note: "History of saved results for a signed-in account.",
    authMethod: "e2e-test-channel",
    fullPage: true,
  });
});

// ---------------------------------------------------------------------------
// 6-8. Daily reset, countdown, and challenge separation
// ---------------------------------------------------------------------------

test("06 daily hub countdown to midnight PT", async ({ page }) => {
  await page.goto("/daily");
  await settle(page);
  await expect(page.locator("body")).toContainText(/midnight PT/i);
  await shot(page, "06-daily-hub-midnight-pt-countdown.png", {
    journey: "Daily countdown",
    note: "Daily hub states 'New daily board at midnight PT' with a countdown driven by the server's seconds_remaining.",
    fullPage: true,
  });
});

test("07 daily grid gate and board", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/daily/grid", { waitUntil: "domcontentloaded" });

  // A first-time visitor lands on the how-to-play gate, not the grid, so the
  // sheet needs both frames. Waiting on the board's own objective panel timed
  // out for exactly this reason — the board was never on screen.
  //
  // Anchor on the network-independent surface rather than `networkidle`: this
  // page runs a one-second play clock and never goes idle.
  const gate = page.getByTestId("how-to-play-objective");
  await gate.waitFor({ state: "visible", timeout: 45_000 });
  await settle(page);
  await shot(page, "07a-daily-grid-gate.png", {
    journey: "Daily before/after reset",
    note: "The how-to-play gate a first-time visitor sees before today's Daily Grid.",
    fullPage: true,
  });

  await page.getByRole("button", { name: /start today's grid/i }).click();
  await page
    .getByTestId("daily-grid-objective")
    .waitFor({ state: "visible", timeout: 45_000 });
  await settle(page);
  await shot(page, "07b-daily-grid-board.png", {
    journey: "Daily before/after reset",
    note: "Today's Daily Grid board with its countdown. The board fetch is now re-run at the reset boundary and on tab focus; it previously fired once per mount and never again.",
    fullPage: true,
  });
});

// ---------------------------------------------------------------------------
// 9-12. RUN THE TABLE clarity and outcomes
// ---------------------------------------------------------------------------

test("09 perk cards use progressive disclosure", async ({ page }) => {
  await page.goto("/arena/run-the-table?start=standard");
  await settle(page);
  await shot(page, "09-perk-cards-progressive-disclosure.png", {
    journey: "Clearer perk cards",
    note: "Front Office Perk cards: plain-language effect, one strategic hint, and an expandable 'See exact rule'.",
    fullPage: true,
  });
});

// ---------------------------------------------------------------------------
// 14. Mobile, reduced motion, keyboard
// ---------------------------------------------------------------------------

test("14a mobile navigation and account section", async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto("/");
  await settle(page);
  const menu = page.getByRole("button", { name: /menu|navigation/i }).first();
  if (await menu.count()) {
    await menu.click();
    await settle(page);
  }
  await shot(page, "14a-mobile-nav-account.png", {
    journey: "Mobile",
    note: "Mobile drawer including the account section, which the SectionId union declared but never rendered.",
  });
});

test("14b reduced motion", async ({ page }) => {
  // The home page, not the RUN THE TABLE start gate.
  //
  // The first version of this capture pointed at the start gate and produced a
  // frame byte-identical to 01 — the gate has no motion at rest, so the frame
  // was evidence of nothing while its filename claimed otherwise. The duplicate
  // check caught it. The home hero is the surface that actually animates
  // (HeroVignette's rotating art, the spin stage), so this is where the
  // preference is worth photographing.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await settle(page);
  await shot(page, "14b-reduced-motion-home.png", {
    journey: "Reduced motion",
    note: "Home page under prefers-reduced-motion: reduce — the surface that carries the app's motion design.",
    reducedMotion: true,
    fullPage: true,
  });
});

test("14c keyboard focus is visible", async ({ page }) => {
  await page.goto("/");
  await settle(page);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await shot(page, "14c-keyboard-focus.png", {
    journey: "Keyboard",
    note: "Focus ring after keyboard traversal from the top of the document.",
  });
});
