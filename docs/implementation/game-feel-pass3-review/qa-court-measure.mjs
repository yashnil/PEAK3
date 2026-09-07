// Precise in-page timing of the 82-0 opening: intro, round reveal, reel start,
// lock, candidates. Uses a MutationObserver installed before navigation.
import { chromium } from "/Users/yashnilmohanty/Desktop/PEAK3/apps/web/node_modules/playwright/index.mjs";

const label = process.argv[2] ?? "measure";
const reduced = process.argv.includes("--reduced");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: reduced ? "reduce" : "no-preference" });
const page = await ctx.newPage();
await page.addInitScript(() => {
  const ev = [];
  window.__ev = ev;
  const seen = new Map();
  const mark = (name, present) => {
    const was = seen.get(name) ?? false;
    if (was !== present) {
      seen.set(name, present);
      ev.push({ name, present, t: performance.now() });
    }
  };
  const check = () => {
    mark("intro", !!document.querySelector('[data-testid="court-intro"]'));
    mark("reveal", !!document.querySelector('[data-testid="court-round-reveal"]'));
    const strip = document.querySelector('[data-testid="team-reel-strip"]');
    mark("strip", !!strip);
    mark("strip-spinning", !!strip && strip.parentElement?.getAttribute("data-stage") === "spinning");
    const stage = document.querySelector('[data-testid="spin-stage"]');
    mark("stage", !!stage);
    mark("locked", !!stage && stage.getAttribute("data-phase") === "locked");
    mark("revealed", !!stage && stage.getAttribute("data-phase") === "revealed");
    mark("candidates", !!document.querySelector('[data-testid="candidate-card"]'));
    mark("resume-btn", !!document.querySelector('[data-testid="resume-selection-btn"]'));
  };
  new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true });
});
await page.goto("http://localhost:3000/arena/court/practice/apex_1y?seed=42", { waitUntil: "load" });
await page.locator('[data-testid="begin-run-btn"]').waitFor({ state: "visible", timeout: 30000 });
await page.evaluate(() => { window.__ev.length = 0; window.__t0 = performance.now(); });
await page.locator('[data-testid="begin-run-btn"]').click();
await page.locator('[data-testid="candidate-card"]').first().waitFor({ state: "visible", timeout: 40000 });
await page.waitForTimeout(300);
// Resume-selection replay check
await page.locator('[data-testid="minimize-overlay-btn"]').click();
await page.locator('[data-testid="resume-selection-btn"]').waitFor({ state: "visible" });
await page.locator('[data-testid="resume-selection-btn"]').click();
await page.waitForTimeout(900);
const ev = await page.evaluate(() => window.__ev.map((e) => ({ ...e, t: Math.round(e.t - window.__t0) })));
const rel = (name, present) => ev.find((e) => e.name === name && e.present === present)?.t;
const on = (name) => { const a = rel(name, true), b = rel(name, false); return a == null ? null : b == null ? `${a}→?` : `${a}→${b} (${b - a} ms)`; };
console.log(`[${label}${reduced ? " reduced" : ""}] t=0 at Begin click`);
for (const n of ["intro", "reveal", "stage", "strip", "strip-spinning", "locked", "revealed", "candidates"]) console.log(`  ${n.padEnd(15)} ${on(n)}`);
const revealEvents = ev.filter((e) => e.name === "reveal");
console.log("  reveal attach count:", revealEvents.filter((e) => e.present).length, "(2 = replayed on Resume selection)");
const lockT = rel("locked", true), revT = rel("revealed", true), candT = rel("candidates", true), spinT = rel("strip-spinning", true), revealOff = rel("reveal", false);
if (spinT != null && revealOff != null) console.log("  reveal off -> reel spinning:", spinT - revealOff, "ms");
if (lockT != null && candT != null) console.log("  locked -> candidates:", candT - lockT, "ms; revealed -> candidates:", candT - revT, "ms");
await browser.close();
