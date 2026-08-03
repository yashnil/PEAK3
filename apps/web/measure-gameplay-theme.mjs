// Measures theme-switch settle time on gameplay screens that used to
// contain unconditional (non-hover-gated) CSS transitions on color-bearing
// properties: 82-0's candidate cards (.candidate-card-v2/.candidate-row-v3,
// globals.css) and RTT's choice/offer buttons (.rtt-choice-btn/
// .rtt-offer-btn, globals.css) — now gated behind :hover/:active/
// [data-state], per launch-polish IMPLEMENTATION_CONTRACT.md §1.
//
// METHODOLOGY, v3 — two earlier versions were tried and rejected while
// building this, both documented here because the failure modes are worth
// knowing about if this script is reused:
//
// v1 (used for the original audit's 96.5ms/108.5ms/67-71ms numbers):
// declared "settled" after 4 CONSECUTIVE STABLE ANIMATION FRAMES, which
// imposes an unavoidable ~64ms floor (4 frames @ 60fps) BY CONSTRUCTION —
// cannot report below that even for a value that changed on frame 1.
// Confirmed by direct computed-style inspection post-fix: a resting
// element's `transition-property` was `transform` only (border/background
// not listed at all), yet v1 still reported ~70-88ms. Still valid evidence
// of a real before/after problem (both measurements shared the same floor,
// so an element that averaged 65-110ms while an "instant" one should have
// converged toward the ~64ms floor rather than sitting well above it is
// itself informative) but not a precise instrument.
//
// v2: precompute the target theme's resolved colors by flipping
// `data-theme` synchronously, reading computed style, and flipping back —
// all within one JS task, no paint in between — then poll for the live
// value to exactly match that precomputed target. This works for
// .candidate-row-v3 but produced impossible results for .rtt-choice-btn
// (the SAME synchronous double-flip, isolated and traced element-by-
// element: the raw custom property `--border-default` correctly read the
// flipped value mid-probe, but the ELEMENT's resolved `border-color`
// stayed stale until the attribute was flipped back). That is a browser-
// level computed-style caching quirk for var()-derived shorthand
// properties under a rapid double-flip with no intervening paint, not a
// product bug — the very first, real-click measurement (v1, before this
// pass's fix) showed genuinely alternating border values across real
// clicks, and a real click updates the underlying custom property the
// same way a manual flip does. The precompute trick just isn't reliable
// for every element.
//
// v3 (this version): no precomputation. Record (timestamp, border, bg) on
// every animation frame for a bounded window (400ms — comfortably longer
// than any transition duration in this codebase, which top out at 200ms)
// after the click, using a REAL click and REAL paints throughout — nothing
// synchronous or double-flipped. Then walk the recording backward from the
// end to find the earliest timestamp after which the value never changed
// again; that is "settle," computed post-hoc against an observed ground
// truth rather than a predicted one.
//
// Two numbers per click:
//   1. "first change" — first frame body bg or data-theme differs (same
//      method as measure-theme-switch.mjs). Theme-agnostic, should stay
//      ~20-40ms regardless of what's on screen.
//   2. "settle" — computed by the backward walk described above.
import { chromium } from "playwright";

const BASE = "http://localhost:3001";

async function measureOnPage(page, targetSelector, label, samples = 12) {
  const results = [];
  for (let i = 0; i < samples; i++) {
    // PHASE 1 (awaited — must be confirmed armed before the click is sent,
    // or there is a real race: `page.evaluate`'s browser-side execution is
    // a CDP round-trip, not guaranteed to have captured "start" state
    // before a separately-dispatched `page.click()` is processed. Confirmed
    // by hitting this exact bug mid-measurement: without the await here,
    // "start" was sometimes captured AFTER the click had already landed.
    // Recording onto `window` rather than resolving a Promise from inside
    // the click-triggered callback sidesteps the same race in the other
    // direction.
    await page.evaluate((sel) => {
      const html = document.documentElement;
      const target = document.querySelector(sel);
      window.__pk3Result = null;
      if (!target) {
        window.__pk3Result = { error: `selector not found: ${sel}` };
        return;
      }
      const startTheme = html.getAttribute("data-theme");
      const startBodyBg = getComputedStyle(document.body).backgroundColor;
      const startBorder = getComputedStyle(target).borderColor;
      const startBg = getComputedStyle(target).backgroundColor;
      const t0 = performance.now();
      let firstChangeMs = null;
      const frames = []; // { t, border, bg } — real paints only, no precomputation
      const WINDOW_MS = 400; // every transition in this codebase tops out at 200ms
      function tick() {
        const now = performance.now() - t0;
        const nowTheme = html.getAttribute("data-theme");
        const nowBodyBg = getComputedStyle(document.body).backgroundColor;
        const nowBorder = getComputedStyle(target).borderColor;
        const nowBg = getComputedStyle(target).backgroundColor;
        if (firstChangeMs === null && (nowTheme !== startTheme || nowBodyBg !== startBodyBg)) {
          firstChangeMs = now;
        }
        frames.push({ t: now, border: nowBorder, bg: nowBg });
        if (now < WINDOW_MS) {
          requestAnimationFrame(tick);
          return;
        }
        // Walk backward from the end to find the earliest frame after which
        // the value never changed again — the true settle point, computed
        // against what was actually observed rather than predicted.
        const finalBorder = frames[frames.length - 1].border;
        const finalBg = frames[frames.length - 1].bg;
        const noChange = finalBorder === startBorder && finalBg === startBg;
        let settleMs = null;
        if (!noChange) {
          let idx = frames.length - 1;
          while (idx > 0 && frames[idx - 1].border === finalBorder && frames[idx - 1].bg === finalBg) {
            idx--;
          }
          settleMs = frames[idx].t;
        }
        window.__pk3Result = {
          firstChangeMs,
          settleMs,
          noChange, // this click landed on the toggle's "system, same as
                    // before" no-op cycle position — expected ~1-in-3 of
                    // the time, not a measurement failure.
          startBorder,
          finalBorder,
          frameCount: frames.length,
        };
      }
      requestAnimationFrame(tick);
    }, targetSelector);

    // PHASE 2: now that phase 1 is confirmed armed, dispatch the real
    // interaction. Move away from the target element FIRST, so the
    // realistic case (the user's cursor is on the theme toggle, nowhere
    // near a gameplay card, when the swap happens) is what gets measured —
    // not the narrow "still hovering the card while toggling" edge case,
    // which the fix's own design intentionally leaves animating (see
    // globals.css's comments on the six gated rules).
    await page.mouse.move(4, 4);
    await page.click('[data-testid="theme-toggle"]');

    // PHASE 3: wait out the recording window, then read the result back.
    await page.waitForFunction(() => window.__pk3Result !== null, { timeout: 3000 });
    const result = await page.evaluate(() => window.__pk3Result);
    results.push(result);
    await page.waitForTimeout(200);
  }
  const realChanges = results.filter((r) => !r.noChange && !r.error);
  const noOpCount = results.filter((r) => r.noChange).length;
  const settleOk = realChanges.filter((r) => r.settleMs !== null);
  const firstOk = realChanges.filter((r) => r.firstChangeMs !== null);
  const summarize = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    return {
      n: s.length,
      mean: s.length ? +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(1) : null,
      median: s.length ? s[Math.floor(s.length / 2)] : null,
      p95: s.length ? s[Math.floor(s.length * 0.95)] : null,
      min: s[0] ?? null,
      max: s[s.length - 1] ?? null,
    };
  };
  console.log(`\n=== ${label} (selector: ${targetSelector}) ===`);
  console.log(`no-op clicks (toggle cycle landed on the same resolved theme): ${noOpCount}/${samples}`);
  console.log("first-change:", JSON.stringify(summarize(firstOk.map((r) => r.firstChangeMs))));
  console.log("settle:", JSON.stringify(summarize(settleOk.map((r) => r.settleMs))));
  console.log("raw:", JSON.stringify(results, null, 1));
}

const browser = await chromium.launch();

// --- 82-0: candidate cards ---
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  await context.addInitScript(() => window.localStorage.setItem("peak3-theme", "light"));
  const page = await context.newPage();
  await page.goto(BASE + "/arena/court/practice/apex_1y", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /begin 82-0 run/i }).click();
  await page.waitForTimeout(200); // reduced-motion reveal completes in ~80ms
  await page.waitForSelector(".candidate-card-v2, .candidate-row-v3", { timeout: 10000 }).catch(() => null);
  const has1 = await page.locator(".candidate-card-v2").count();
  const has2 = await page.locator(".candidate-row-v3").count();
  console.log(`candidate-card-v2 count: ${has1}, candidate-row-v3 count: ${has2}`);
  const sel = has1 > 0 ? ".candidate-card-v2" : ".candidate-row-v3";
  if (has1 > 0 || has2 > 0) {
    await measureOnPage(page, sel, "82-0 candidate list");
  } else {
    await page.screenshot({ path: "/tmp/court-debug.png", fullPage: true });
    console.log("No candidate cards found — see /tmp/court-debug.png");
  }
  await context.close();
}

// --- RTT: choice/offer buttons ---
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  await context.addInitScript(() => window.localStorage.setItem("peak3-theme", "light"));
  const page = await context.newPage();
  await page.goto(BASE + "/arena/run-the-table", { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /start a run/i }).click();
  await page.waitForTimeout(500);
  // First-run guided tour intercepts the shell — skip it if present.
  const skipBtn = page.getByRole("button", { name: /^skip$/i });
  if (await skipBtn.count()) {
    await skipBtn.click();
    await page.waitForTimeout(200);
  }
  await page.screenshot({ path: "/tmp/rtt-startgate.png", fullPage: true });
  const revealBtn = page.getByRole("button", { name: /reveal your roster/i });
  if (await revealBtn.count()) {
    await revealBtn.click();
    await page.waitForTimeout(1500); // reduced-motion collapses the 7-card reveal to near-instant
  }
  await page.screenshot({ path: "/tmp/rtt-afterreveal.png", fullPage: true });
  // Advance past the roster-reveal screen to the first node choice, if a
  // "continue"-shaped control exists.
  for (const name of [/continue/i, /next/i, /choose.*stage/i, /view.*map/i]) {
    const btn = page.getByRole("button", { name });
    if (await btn.count()) {
      await btn.first().click();
      await page.waitForTimeout(500);
      break;
    }
  }
  await page.screenshot({ path: "/tmp/rtt-afterstart.png", fullPage: true });
  const choiceCount = await page.locator(".rtt-choice-btn").count();
  const offerCount = await page.locator(".rtt-offer-btn").count();
  console.log(`rtt-choice-btn count: ${choiceCount}, rtt-offer-btn count: ${offerCount}`);
  const sel = offerCount > 0 ? ".rtt-offer-btn" : ".rtt-choice-btn";
  if (choiceCount > 0 || offerCount > 0) {
    await measureOnPage(page, sel, "RTT choice/offer buttons");
  } else {
    console.log("No RTT choice/offer buttons found — see /tmp/rtt-afterstart.png");
  }
  await context.close();
}

await browser.close();
