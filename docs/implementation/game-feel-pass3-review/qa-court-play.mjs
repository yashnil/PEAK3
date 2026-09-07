// Plays 82-0 at 1440x900 and captures the five moments + timing measurements.
// Usage: node play_court.mjs <label>   (label = before | after)
import { chromium } from "/Users/yashnilmohanty/Desktop/PEAK3/apps/web/node_modules/playwright/index.mjs";
import fs from "node:fs";

const label = process.argv[2] ?? "before";
const outDir = `/private/tmp/claude-502/-Users-yashnilmohanty-Desktop-PEAK3/d8bd212f-9c81-4c1c-9ed9-56ebc45274ae/scratchpad/shots/${label}`;
fs.mkdirSync(outDir, { recursive: true });
const shot = (page, name, opts = {}) => page.screenshot({ path: `${outDir}/${name}.png`, ...opts });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const log = (...a) => console.log(`[${label}]`, ...a);

await page.goto("http://localhost:3000/arena/court/practice/apex_1y?seed=42", { waitUntil: "load" });
await page.locator('[data-testid="begin-run-btn"]').waitFor({ state: "visible", timeout: 30000 });
await page.waitForTimeout(400);
await shot(page, "01-start-gate", { fullPage: true });

// Begin, then measure the intro (if any) and the round reveal on screen.
const t0 = Date.now();
await page.locator('[data-testid="begin-run-btn"]').click();
const intro = page.locator('[data-testid="court-intro"]');
let introVisibleMs = null;
try {
  await intro.waitFor({ state: "attached", timeout: 4000 });
  const ti = Date.now();
  await page.waitForTimeout(700);
  await shot(page, "02a-intro");
  await intro.waitFor({ state: "detached", timeout: 10000 });
  introVisibleMs = Date.now() - ti + 0; // approx (attached observed a little late)
  log("intro on screen ~", introVisibleMs, "ms");
} catch {
  log("no intro element");
}

const reveal = page.locator('[data-testid="court-round-reveal"]');
let revealMs = null;
try {
  await reveal.waitFor({ state: "attached", timeout: 8000 });
  const tr = Date.now();
  await page.waitForTimeout(250);
  await shot(page, "02-round-reveal");
  await reveal.waitFor({ state: "detached", timeout: 8000 });
  revealMs = Date.now() - tr + 250 - 250; // measured from attach
  log("round reveal on screen ~", Date.now() - tr, "ms (from attach)");
  revealMs = Date.now() - tr;
} catch (e) {
  log("round reveal not observed:", e.message.split("\n")[0]);
}
// When did the reel start ticking (strip attached)?
const strip = page.locator('[data-testid="team-reel-strip"]');
await strip.waitFor({ state: "attached", timeout: 10000 }).catch(() => {});
const stripSpinning = page.locator('[data-testid="team-reel-strip"]');
// Wait until stage "spinning" attribute on parent
await page.waitForFunction(() => {
  const s = document.querySelector('[data-testid="team-reel-strip"]');
  return s && s.parentElement?.getAttribute("data-stage") === "spinning";
}, null, { timeout: 10000 }).catch(() => {});
log("reel spinning at +", Date.now() - t0, "ms after Begin click");
await page.waitForTimeout(500);
await shot(page, "03-spin");

// Absorb beat: time from locked to candidates.
await page.locator('[data-testid="spin-stage"][data-phase="locked"]').waitFor({ state: "attached", timeout: 10000 }).catch(() => {});
const tl = Date.now();
await page.locator('[data-testid="candidate-card"]').first().waitFor({ state: "visible", timeout: 10000 });
log("locked -> candidates visible ~", Date.now() - tl, "ms");
await shot(page, "03b-chooser-open");

async function playOneRound() {
  const scored = page.locator('[data-testid="candidate-card"][data-score-status="exact_season_scored"]');
  const any = page.locator('[data-testid="candidate-card"]').first();
  await any.waitFor({ state: "visible", timeout: 20000 });
  const c = (await scored.count()) > 0 ? scored.first() : any;
  await c.click();
  const openSlot = page.locator('button[data-testid="court-slot"][data-filled="false"]').first();
  await openSlot.waitFor({ state: "visible", timeout: 10000 });
  const before = await page.locator('[data-testid="court-slot"][data-filled="true"]').count();
  await openSlot.click();
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="court-slot"][data-filled="true"]').length === n, before + 1, { timeout: 10000 });
}

await playOneRound();
await page.waitForTimeout(350);
await shot(page, "04-slot-fill");

// Round 2's reveal: measure again + test the "Resume selection" replay.
try {
  await reveal.waitFor({ state: "attached", timeout: 8000 });
  const tr = Date.now();
  await reveal.waitFor({ state: "detached", timeout: 8000 });
  log("round 2 reveal on screen ~", Date.now() - tr, "ms");
} catch { log("round 2 reveal not observed"); }
await page.locator('[data-testid="candidate-card"]').first().waitFor({ state: "visible", timeout: 20000 });
await page.locator('[data-testid="minimize-overlay-btn"]').click();
await page.locator('[data-testid="resume-selection-btn"]').waitFor({ state: "visible", timeout: 5000 });
await page.waitForTimeout(300);
await page.locator('[data-testid="resume-selection-btn"]').click();
await page.waitForTimeout(120);
const replayed = await reveal.count();
log("round reveal replayed on Resume selection:", replayed > 0 ? "YES" : "no");
if (replayed > 0) await shot(page, "05-resume-replay-bug");
await page.waitForTimeout(800);

for (let i = 1; i < 8; i++) await playOneRound();
const complete = page.locator('[data-testid="complete-season-btn"]');
await complete.waitFor({ state: "visible", timeout: 10000 });
await complete.click();
await page.locator('[data-testid="season-result"]').waitFor({ state: "visible", timeout: 15000 });
await page.waitForTimeout(1600);
await shot(page, "06-result", { fullPage: true });
await shot(page, "06b-result-viewport");
const receiptTags = await page.getByText("Data receipt", { exact: true }).count();
log("visible 'Data receipt' labels on result:", receiptTags);
await browser.close();
