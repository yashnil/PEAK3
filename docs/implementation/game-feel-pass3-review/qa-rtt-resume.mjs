// Resume QA: start a run, play a few decisions, reload, measure how fast the
// run is back, screenshot it, and keep playing. Also exercises the throttled
// resume when --throttle is given.
import { chromium, devices } from "/Users/yashnilmohanty/Desktop/PEAK3/apps/web/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), "1"]; }));
const OUT = args.out ?? "./resume-out";
const VIEW = args.viewport ?? "desktop";
const THROTTLE = Number(args.throttle ?? 0);
const SEED = Number(args.seed ?? 21);
const BASE = "http://localhost:3000";
const ROUTE = `/arena/run-the-table?seed=${SEED}`;
fs.mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const note = (msg, extra = {}) => console.log(JSON.stringify({ t: Date.now() - t0, msg, ...extra }));

const browser = await chromium.launch();
const context = await browser.newContext(VIEW === "mobile" ? { ...devices["Pixel 5"] } : { viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
if (THROTTLE > 0) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: THROTTLE, downloadThroughput: -1, uploadThroughput: -1 });
}
page.on("pageerror", (e) => note("pageerror", { error: String(e) }));
await page.goto(BASE + ROUTE, { waitUntil: "commit" });
await page.evaluate(() => { window.localStorage.removeItem("peak3.run-the-table.active"); window.localStorage.setItem("peak3.run-the-table.coach", JSON.stringify({ schema_version: 1, seen: ["first_choice", "first_credit", "first_boss", "first_life_risk", "first_scout"] })); });
await page.goto(BASE + ROUTE, { waitUntil: "load" });
await page.locator('[data-testid="rtt-start-standard"]').click();
await page.locator('[data-testid="rtt-shell"]').waitFor();
// opening reveal → start → skip → continue
await page.locator('[data-testid="rtt-reveal-start-roster"]').click();
await page.locator('[data-testid="rtt-reveal-skip-roster"]').click();
await page.locator('[data-testid="rtt-reveal-continue-roster"]').click();
await page.locator('[data-testid="rtt-system-select"] button[data-testid^="rtt-system-"]').first().click();
await page.locator('[data-testid="rtt-node-choice"]').waitFor();
await page.locator('[data-testid="rtt-node-choice"] button[data-testid^="rtt-node-option-"]').first().click();
await page.waitForSelector('[data-testid="rtt-draft-room"], [data-testid="rtt-trade-desk"], [data-testid="rtt-scout-prepare"], [data-testid="rtt-choice-node"]');
const before = await page.evaluate(() => ({
  surface: ["rtt-draft-room", "rtt-trade-desk", "rtt-scout-prepare", "rtt-choice-node"].find((id) => document.querySelector(`[data-testid="${id}"]`)),
  credits: document.querySelector('[data-testid="rtt-credits"]')?.textContent,
  lives: document.querySelector('[data-testid="rtt-lives"]')?.textContent,
  done: document.querySelectorAll('[data-testid^="rtt-map-row-"][data-row-state="done"]').length,
  current: document.querySelector('[data-testid^="rtt-map-row-"][data-row-state="current"]')?.getAttribute("data-testid"),
  stored: window.localStorage.getItem("peak3.run-the-table.active"),
}));
note("before reload", before);
await page.screenshot({ path: path.join(OUT, "01-before-reload.png") });

const w0 = Date.now();
await page.reload({ waitUntil: "commit" });
await page.locator('[data-testid="rtt-shell"]').waitFor({ timeout: 30000 });
const shellMs = Date.now() - w0;
const moment = page.locator('[data-testid="rtt-moment"]');
const momentSeen = await moment.waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
const after = await page.evaluate(() => ({
  surface: ["rtt-draft-room", "rtt-trade-desk", "rtt-scout-prepare", "rtt-choice-node"].find((id) => document.querySelector(`[data-testid="${id}"]`)),
  credits: document.querySelector('[data-testid="rtt-credits"]')?.textContent,
  lives: document.querySelector('[data-testid="rtt-lives"]')?.textContent,
  done: document.querySelectorAll('[data-testid^="rtt-map-row-"][data-row-state="done"]').length,
  current: document.querySelector('[data-testid^="rtt-map-row-"][data-row-state="current"]')?.getAttribute("data-testid"),
  moment: document.querySelector('[data-testid="rtt-moment"]')?.textContent,
  tour: !!document.querySelector('[data-testid="guided-tour"]'),
  coach: document.querySelectorAll('[data-testid^="rtt-coach-"]').length,
  stored: window.localStorage.getItem("peak3.run-the-table.active"),
}));
note("after reload", { shell_visible_ms: shellMs, moment_seen: momentSeen, ...after });
await page.screenshot({ path: path.join(OUT, "02-resumed.png") });
// still playable
if (after.surface === "rtt-draft-room") await page.locator('[data-testid="rtt-draft-pass"]').click();
else if (after.surface === "rtt-trade-desk") await page.locator('[data-testid="rtt-trade-decline"]').click();
else if (after.surface === "rtt-scout-prepare") await page.locator('[data-testid^="rtt-scout-prepare-"]').first().click();
else await page.locator('[data-testid="rtt-choice-node"] button:not([disabled])').first().click();
await page.locator(`[data-testid="${after.surface}"]`).waitFor({ state: "detached", timeout: 30000 });
note("played on after resume", { same_run: JSON.parse(after.stored).run_id === JSON.parse(before.stored).run_id });
await page.screenshot({ path: path.join(OUT, "03-continued.png") });
await browser.close();
