// Plays one full Three-Man Weave bot practice match, screenshots the key
// moments and records a timestamped DOM log for pacing measurements.
// usage: node play.mjs <label>
import { chromium } from "/Users/yashnilmohanty/Desktop/PEAK3/apps/web/node_modules/playwright/index.mjs";
import { createHmac } from "crypto";
import fs from "fs";
import path from "path";

const label = process.argv[2] || "before";
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), label);
fs.mkdirSync(OUT, { recursive: true });
const SECRET = process.env.PEAK3_TEST_JWT_SECRET || "e2e-ranked-test-secret-do-not-use-in-prod";
const b64 = (s) => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function mint(sub, email) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64(JSON.stringify({ sub, email, is_anonymous: false, aud: "authenticated", role: "authenticated", iat: now, exp: now + 3600 }));
  const sig = createHmac("sha256", SECRET).update(`${h}.${p}`).digest();
  return `${h}.${p}.${b64(sig)}`;
}

const RECORDER = `
(() => {
  const log = []; window.__tmwLog = log;
  const t = () => Math.round(performance.now());
  const seen = new Map();
  const snap = () => {
    const room = document.querySelector('[data-testid="tmw-room"]');
    const roll = document.querySelector('[data-testid="tmw-roll"]');
    const cards = [0,1,2].map((s) => {
      const court = document.querySelector('[data-testid="tmw-seat-court-' + s + '"]');
      return court ? court.querySelectorAll('[data-testid^="tmw-slot-"] [data-player], .tmw-card, [data-filled="true"]').length : -1;
    });
    return {
      phase: room ? room.getAttribute('data-turn-phase') : null,
      seq: room ? room.getAttribute('data-turn-seq') : null,
      roundCard: !!document.querySelector('[data-testid="tmw-round-reveal"]'),
      rollStage: roll ? roll.getAttribute('data-stage') : null,
      overlay: !!document.querySelector('[data-testid="tmw-pick-overlay"]'),
      overlayBeat: (() => { const o = document.querySelector('[data-testid="tmw-pick-overlay"]'); return o ? o.getAttribute('data-beat') : null; })(),
      beat: (() => { const b = document.querySelector('[data-testid="tmw-previous-pick-beat"]'); return b ? b.getAttribute('data-beat') : null; })(),
      moment: (() => { const m = document.querySelector('[data-testid="tmw-moment"]'); return m ? m.textContent : null; })(),
      lock: (() => { const l = document.querySelector('[data-testid="tmw-identity-lock"]'); return l ? l.textContent.length : null; })(),
      podium: !!document.querySelector('[data-testid="tmw-podium"]'),
    };
  };
  const tick = () => {
    const s = snap();
    for (const k of Object.keys(s)) {
      const v = JSON.stringify(s[k]);
      if (seen.get(k) !== v) { seen.set(k, v); log.push({ t: t(), k, v: s[k] }); }
    }
  };
  const mo = new MutationObserver(tick);
  const start = () => { mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }); tick(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  setInterval(tick, 50);
})();
`;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(RECORDER);
const page = await context.newPage();
const shot = async (name) => { try { await page.screenshot({ path: path.join(OUT, name + ".png") }); console.log("shot", name, Math.round(performance.now())); } catch (e) { console.log("shot failed", name, e.message); } };

await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => typeof window.__peak3TestAuth !== "undefined");
const sub = `tmw-polish-${Date.now()}`;
const token = mint(sub, `${sub}@e2e.test`);
await page.evaluate(([t, s]) => window.__peak3TestAuth.setSession(t, { id: s, email: `${s}@e2e.test`, isAnonymous: false }), [token, sub]);
await page.goto("http://localhost:3000/arena/lobby", { waitUntil: "domcontentloaded" });
await page.getByTestId("lobby-three_man_weave-practice").click();
await page.waitForURL(/\/arena\/three-man-weave\/[0-9a-f-]{36}/, { timeout: 20000 });
await page.getByTestId("tmw-room").waitFor({ timeout: 20000 });
await shot("01-intro");

// Round card + lock of round 1
const shotWhen = async (selector, name, timeout = 15000) => {
  try { await page.waitForSelector(selector, { timeout, state: "attached" }); await shot(name); return true; } catch { console.log("missed", name); return false; }
};
await shotWhen('[data-testid="tmw-round-reveal"]', "02-round-card");
const shotOnStage = async (stage, name) => {
  try {
    await page.waitForFunction((st) => document.querySelector('[data-testid="tmw-roll"]')?.getAttribute('data-stage') === st, stage, { polling: "raf", timeout: 15000 });
    await shot(name);
  } catch { console.log("missed", name); }
};
await shotOnStage("armed", "03-armed");
await shotOnStage("locked", "04-lock");
await shotOnStage("resolved", "05-resolved");

let handoffShot = false, overlayShot = false, beatShot = false, takenShot = false;
const deadline = Date.now() + 8 * 60 * 1000;
let picks = 0;
while (Date.now() < deadline) {
  if (await page.getByTestId("tmw-podium").count()) break;
  // wait for either the overlay, the previous-pick beat, or the podium
  const which = await Promise.race([
    page.waitForSelector('[data-testid="tmw-pick-overlay"]', { timeout: 120000, state: "attached" }).then(() => "overlay"),
    page.waitForSelector('[data-testid="tmw-previous-pick-beat"]', { timeout: 120000, state: "attached" }).then(() => "beat"),
    page.waitForSelector('[data-testid="tmw-podium"]', { timeout: 120000, state: "attached" }).then(() => "podium"),
  ]).catch(() => "timeout");
  if (which === "podium") break;
  if (which === "timeout") { console.log("timed out waiting"); break; }
  if (which === "beat" && !beatShot) { await shot("06-previous-pick-beat"); beatShot = true; }
  await page.waitForSelector('[data-testid="tmw-pick-overlay"]', { timeout: 120000, state: "attached" });
  // handoff: was the previous change a bot pick (moment visible)?
  const log = await page.evaluate(() => window.__tmwLog);
  const lastPhase = [...log].reverse().find((e) => e.k === "phase");
  if (!handoffShot && lastPhase && lastPhase.v === "pick" && picks > 0) { await shot("07-your-turn-opens"); handoffShot = true; }
  if (!overlayShot) { await page.waitForTimeout(400); await shot("08-pick-overlay"); overlayShot = true; }
  // taken-names state: when someone picked before us this roll
  const taken = await page.locator('[data-testid="tmw-overlay-taken"]').count();
  if (taken && !takenShot) { await shot("09-taken-this-roll"); takenShot = true; }
  const list = page.getByTestId("tmw-candidate-list");
  const cand = list.locator("button:not([disabled])").first();
  await cand.click();
  const legal = page.locator('[data-testid^="tmw-place-"][data-legal="true"]').first();
  if ((await legal.count()) > 0 && !(await legal.isDisabled())) await legal.click();
  const confirm = page.getByTestId("tmw-confirm-pick");
  if ((await confirm.count()) > 0) { await confirm.click({ timeout: 5000 }).catch(() => {}); }
  picks++;
  await page.waitForSelector('[data-testid="tmw-pick-overlay"]', { state: "detached", timeout: 30000 }).catch(() => {});
  if (picks === 1) {
    await shotWhen('[data-testid="tmw-round-reveal"]', "10-round-card-r2", 120000);
  }
}
await page.waitForSelector('[data-testid="tmw-podium"]', { timeout: 120000 });
await page.waitForTimeout(1600);
await shot("11-end-screen");
await page.evaluate(() => window.scrollTo(0, 700));
await page.waitForTimeout(300);
await shot("12-end-screen-rosters");
const log = await page.evaluate(() => window.__tmwLog);
fs.writeFileSync(path.join(OUT, "log.json"), JSON.stringify(log, null, 1));
console.log("picks", picks, "log entries", log.length);
await browser.close();
