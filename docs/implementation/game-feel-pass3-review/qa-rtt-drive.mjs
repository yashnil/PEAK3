// Run the Table manual-QA driver. Plays a real run against the live dev
// servers, screenshots every beat, and measures click -> first DOM mutation
// (acknowledgement) and click -> next surface (authoritative) per action.
//
//   node rtt-drive.mjs --out=DIR [--viewport=desktop|mobile] [--strategy=buy|pass]
//                      [--throttle=MS] [--tour=1] [--seed=N] [--resume=1] [--max=90]
import { chromium, devices } from "/Users/yashnilmohanty/Desktop/PEAK3/apps/web/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), "1"];
}));
const OUT = args.out ?? "./rtt-out";
const VIEW = args.viewport ?? "desktop";
const STRATEGY = args.strategy ?? "buy";
const THROTTLE = Number(args.throttle ?? 0);
const TOUR = args.tour === "1";
const SEED = args.seed ? Number(args.seed) : null;
const RESUME = args.resume === "1";
const MAX = Number(args.max ?? 90);
const BASE = "http://localhost:3000";
const ROUTE = "/arena/run-the-table" + (SEED !== null ? `?seed=${SEED}` : "");
fs.mkdirSync(OUT, { recursive: true });

const SURFACES = [
  "rtt-result", "rtt-opening-reveal", "rtt-boss-intro", "rtt-boss-reveal", "rtt-system-select",
  "rtt-node-choice", "rtt-draft-room", "rtt-trade-desk", "rtt-scout-prepare", "rtt-choice-node",
  "rtt-boss-preview", "rtt-battle-reveal", "rtt-act-transition", "rtt-run-ended", "rtt-run-cleared",
];
const SEL = SURFACES.map((s) => `[data-testid="${s}"]`).join(", ");
const log = [];
let shot = 0;
const t0 = Date.now();

function note(msg, extra = {}) {
  const row = { t: Date.now() - t0, msg, ...extra };
  log.push(row);
  console.log(JSON.stringify(row));
}

async function snap(page, name) {
  const file = path.join(OUT, `${String(shot++).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function surface(page) {
  await page.waitForSelector(SEL, { state: "visible", timeout: 30000 });
  for (const s of SURFACES) if ((await page.locator(`[data-testid="${s}"]`).count()) > 0) return s;
  throw new Error("no surface");
}

async function hud(page) {
  return page.evaluate(() => {
    const q = (s) => document.querySelector(`[data-testid="${s}"]`)?.textContent?.trim() ?? null;
    return { credits: q("rtt-credits"), lives: q("rtt-lives"), act: q("rtt-act"), objective: q("rtt-hud-objective") };
  });
}

// Click via the DOM (no Playwright actionability wait) and measure the first
// mutation after the click, then wait for the given surface to leave.
async function clickMeasured(page, selector, leaving, label) {
  await page.waitForSelector(selector, { state: "visible", timeout: 30000 });
  const okStart = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    window.__m = { t0: performance.now(), first: null, attr: null };
    const mo = new MutationObserver((muts) => {
      if (window.__m.first === null) {
        window.__m.first = performance.now();
        const m = muts[0];
        window.__m.attr = m.type + ":" + (m.target.nodeName || "") + ":" + (m.attributeName || "");
      }
    });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    window.__mo = mo;
    el.click();
    return true;
  }, selector);
  if (!okStart) throw new Error("no element " + selector);
  const wall0 = Date.now();
  if (leaving) {
    await page.locator(`[data-testid="${leaving}"]`).waitFor({ state: "detached", timeout: 30000 }).catch(() => {});
  }
  const m = await page.evaluate(() => { window.__mo?.disconnect(); return { ack: window.__m.first === null ? null : window.__m.first - window.__m.t0, attr: window.__m.attr }; });
  const total = Date.now() - wall0;
  note(`click ${label}`, { ack_ms: m.ack === null ? null : Math.round(m.ack * 10) / 10, first_mutation: m.attr, to_next_surface_ms: leaving ? total : null });
  return m;
}

async function step(page, s, ctx) {
  const h = await hud(page);
  switch (s) {
    case "rtt-opening-reveal": {
      await snap(page, `${s}-cover`);
      await clickMeasured(page, '[data-testid="rtt-reveal-start-roster"]', null, "reveal roster");
      await page.waitForTimeout(1200);
      await snap(page, `${s}-dealing`);
      await page.locator('[data-testid="rtt-reveal-continue-roster"]').waitFor({ timeout: 40000 });
      await snap(page, `${s}-settled`);
      await clickMeasured(page, '[data-testid="rtt-reveal-continue-roster"]', s, "continue roster");
      break;
    }
    case "rtt-boss-intro": {
      await snap(page, `${s}-act${ctx.act}`);
      await clickMeasured(page, '[data-testid="rtt-boss-intro-skip"]', s, "skip boss intro");
      break;
    }
    case "rtt-boss-reveal": {
      await page.waitForTimeout(900);
      await snap(page, `${s}-act${ctx.act}-dealing`);
      await page.locator('[data-testid="rtt-reveal-continue-boss"]').waitFor({ timeout: 40000 });
      await snap(page, `${s}-act${ctx.act}-settled`);
      await clickMeasured(page, '[data-testid="rtt-reveal-continue-boss"]', s, "continue boss reveal");
      break;
    }
    case "rtt-system-select": {
      await snap(page, `${s}-act${ctx.act}`);
      const first = await page.locator('[data-testid="rtt-system-select"] button[data-testid^="rtt-system-"]').first().getAttribute("data-testid");
      await clickMeasured(page, `[data-testid="${first}"]`, s, `perk ${first}`);
      break;
    }
    case "rtt-node-choice": {
      await snap(page, `${s}-act${ctx.act}-s${ctx.stage}`);
      const opts = page.locator('[data-testid="rtt-node-choice"] button[data-testid^="rtt-node-option-"]');
      const n = await opts.count();
      // Prefer a draft room (to exercise buying) when strategy=buy, else the first.
      let pick = 0;
      for (let i = 0; i < n; i++) {
        const type = await opts.nth(i).getAttribute("data-node-type");
        if ((STRATEGY === "buy" || STRATEGY === "best") && type === "draft_room") { pick = i; break; }
        if (STRATEGY === "pass" && type === "rest_bank") { pick = i; break; }
      }
      const id = await opts.nth(pick).getAttribute("data-testid");
      const type = await opts.nth(pick).getAttribute("data-node-type");
      await clickMeasured(page, `[data-testid="${id}"]`, s, `node ${type}`);
      break;
    }
    case "rtt-draft-room": {
      await snap(page, `${s}-act${ctx.act}-s${ctx.stage}`);
      if (STRATEGY === "best") {
        const picked = await page.evaluate(() => {
          const cards = Array.from(document.querySelectorAll('[data-testid="rtt-draft-offers"] button[aria-pressed]'));
          const scored = cards.filter((c) => c.getAttribute("aria-disabled") !== "true").map((c) => ({ el: c, score: parseFloat(c.querySelector(".rtt-card-score")?.textContent || "0"), price: parseFloat((c.querySelector(".rtt-card-price")?.textContent || "0").replace(/[^0-9.]/g, "")) || 0 }));
          const credits = parseFloat(document.querySelector('[data-testid="rtt-credits"]')?.textContent || "0");
          const affordable = scored.filter((s) => s.price <= credits).sort((a, b) => b.score - a.score);
          if (!affordable.length) return null;
          affordable[0].el.click();
          return { score: affordable[0].score, price: affordable[0].price };
        });
        if (picked) {
          await page.waitForTimeout(150);
          await snap(page, `${s}-act${ctx.act}-selected`);
          const slot = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('[data-testid="rtt-draft-commit"] button[data-testid^="rtt-draft-slot-"]')).filter((b) => !b.disabled);
            if (!btns.length) return null;
            // prefer an open slot, else the replaced player with the lowest roster score
            const roster = Array.from(document.querySelectorAll('[data-testid^="rtt-roster-slot-"]')).map((li) => ({ id: li.getAttribute("data-testid").replace("rtt-roster-slot-", ""), score: parseFloat(li.querySelector(".gf-slot-figure")?.textContent || "0") }));
            let best = null;
            for (const b of btns) {
              const id = b.getAttribute("data-testid").replace("rtt-draft-slot-", "");
              const r = roster.find((x) => x.id === id);
              const score = r ? r.score : -1;
              if (best === null || score < best.score) best = { b, score, id };
            }
            best.b.click();
            return best.id;
          });
          if (slot) {
            await page.locator(`[data-testid="${s}"]`).waitFor({ state: "detached", timeout: 30000 }).catch(() => {});
            note("best buy", { ...picked, slot, credits_after: (await hud(page)).credits });
            break;
          }
        }
        await clickMeasured(page, '[data-testid="rtt-draft-pass"]', s, "draft pass");
        break;
      }
      if (STRATEGY === "buy") {
        // pick the first selectable offer, then its first legal slot
        const offers = page.locator('[data-testid="rtt-draft-room"] ul li button[aria-pressed]');
        const n = await offers.count();
        let bought = false;
        for (let i = 0; i < n && !bought; i++) {
          const o = offers.nth(i);
          if ((await o.getAttribute("aria-disabled")) === "true") continue;
          await o.evaluate((el) => el.click());
          await page.waitForTimeout(150);
          await snap(page, `${s}-act${ctx.act}-selected`);
          const slots = page.locator('[data-testid="rtt-draft-room"] button:not([disabled])').filter({ hasText: /open|replaces/i });
          const sc = await slots.count();
          if (sc > 0) {
            const before = await hud(page);
            // measured click on the slot button
            await page.evaluate(() => { window.__m = { t0: performance.now(), first: null, attr: null }; const mo = new MutationObserver((muts) => { if (window.__m.first === null) { window.__m.first = performance.now(); window.__m.attr = muts[0].type + ":" + (muts[0].attributeName || ""); } }); mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }); window.__mo = mo; });
            const wall0 = Date.now();
            await slots.first().evaluate((el) => el.click());
            await page.locator(`[data-testid="${s}"]`).waitFor({ state: "detached", timeout: 30000 }).catch(() => {});
            const m = await page.evaluate(() => { window.__mo?.disconnect(); return { ack: window.__m.first === null ? null : window.__m.first - window.__m.t0, attr: window.__m.attr }; });
            note("click buy into slot", { ack_ms: m.ack, first_mutation: m.attr, to_next_surface_ms: Date.now() - wall0, credits_before: before.credits });
            const after = await hud(page);
            note("after buy", { credits_after: after.credits });
            bought = true;
          } else {
            await o.evaluate((el) => el.click());
          }
        }
        if (bought) break;
      }
      await clickMeasured(page, '[data-testid="rtt-draft-pass"]', s, "draft pass");
      break;
    }
    case "rtt-trade-desk": {
      await snap(page, `${s}-act${ctx.act}-s${ctx.stage}`);
      await clickMeasured(page, '[data-testid="rtt-trade-decline"]', s, "trade decline");
      break;
    }
    case "rtt-scout-prepare": {
      await snap(page, `${s}-act${ctx.act}-s${ctx.stage}`);
      const btn = page.locator('[data-testid="rtt-scout-prepare"] [data-testid^="rtt-scout-prepare-"]').first();
      const id = await btn.getAttribute("data-testid");
      await clickMeasured(page, `[data-testid="${id}"]`, s, "scout prepare lane");
      break;
    }
    case "rtt-choice-node": {
      await snap(page, `${s}-act${ctx.act}-s${ctx.stage}`);
      const id = await page.locator('[data-testid="rtt-choice-node"] button:not([disabled])').first().getAttribute("data-testid");
      await clickMeasured(page, `[data-testid="${id}"]`, s, `choice ${id}`);
      break;
    }
    case "rtt-boss-preview": {
      await snap(page, `${s}-act${ctx.act}`);
      await clickMeasured(page, '[data-testid="rtt-resolve-boss"]', s, "resolve boss");
      break;
    }
    case "rtt-battle-reveal": {
      await page.waitForTimeout(600);
      await snap(page, `${s}-act${ctx.act}`);
      await page.locator('[data-testid="rtt-battle-reveal"][data-complete="true"]').waitFor({ timeout: 5000 }).catch(() => {});
      await snap(page, `${s}-act${ctx.act}-complete`);
      const after = await hud(page);
      const outcome = await page.locator('[data-testid="rtt-battle-reveal"]').innerText().then((t) => (/Victory/i.test(t) ? "win" : /Defeat/i.test(t) ? "loss" : "draw"));
      note("battle", { outcome, lives_before: h.lives, lives_after: after.lives, credits: after.credits });
      await clickMeasured(page, '[data-testid="rtt-battle-advance"]', s, "advance");
      const post = await hud(page);
      note("post-advance", post);
      break;
    }
    case "rtt-act-transition": {
      await snap(page, `${s}-act${ctx.act}`);
      const c = page.locator('[data-testid="rtt-act-transition-continue"]');
      if (await c.count()) await clickMeasured(page, '[data-testid="rtt-act-transition-continue"]', s, "act continue");
      else await page.locator(`[data-testid="${s}"]`).waitFor({ state: "detached", timeout: 30000 });
      break;
    }
    case "rtt-run-ended":
    case "rtt-run-cleared": {
      await page.waitForTimeout(800);
      await snap(page, `${s}`);
      const c = page.locator(`[data-testid="${s}-continue"]`);
      if (await c.count()) await clickMeasured(page, `[data-testid="${s}-continue"]`, s, "ending continue");
      else await page.locator(`[data-testid="${s}"]`).waitFor({ state: "detached", timeout: 30000 });
      break;
    }
    case "rtt-result": {
      await page.waitForTimeout(1500);
      await snap(page, `${s}-top`);
      await page.evaluate(() => window.scrollTo(0, 900));
      await snap(page, `${s}-mid`);
      await page.evaluate(() => window.scrollTo(0, 99999));
      await snap(page, `${s}-bottom`);
      return "done";
    }
  }
  return null;
}

const browser = await chromium.launch();
const context = await browser.newContext(VIEW === "mobile" ? { ...devices["Pixel 5"] } : { viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
if (THROTTLE > 0) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: THROTTLE, downloadThroughput: -1, uploadThroughput: -1 });
}
page.on("pageerror", (e) => note("pageerror", { error: String(e) }));
page.on("console", (m) => { if (m.type() === "error") note("console.error", { text: m.text().slice(0, 300) }); });

await page.goto(BASE + ROUTE, { waitUntil: "commit" });
if (!RESUME) {
  await page.evaluate(() => { window.localStorage.removeItem("peak3.run-the-table.active"); });
  if (!TOUR) {
    await page.evaluate(() => { window.localStorage.removeItem("peak3.tour.state"); window.localStorage.setItem("peak3.rtt.briefed", "1"); });
  } else {
    await page.evaluate(() => { window.localStorage.removeItem("peak3.tour.state"); window.localStorage.removeItem("peak3.rtt.briefed"); });
  }
}
await page.goto(BASE + ROUTE, { waitUntil: "load" });
if (!RESUME) {
  await page.locator('[data-testid="rtt-start-gate"]').waitFor({ timeout: 30000 });
  await snap(page, "gate");
  const wall0 = Date.now();
  await clickMeasured(page, '[data-testid="rtt-start-standard"]', null, "start run");
  await page.locator('[data-testid="rtt-shell"]').waitFor({ timeout: 30000 });
  note("shell visible", { ms_after_start_click: Date.now() - wall0 });
  await page.waitForTimeout(400);
  await snap(page, "initial-run");
  const tour = page.locator('[data-testid="guided-tour"]');
  if (await tour.count()) {
    note("tour auto-started", { steps: await tour.innerText().then((t) => t.match(/of\s+(\d+)/)?.[1]) });
    await snap(page, "tour-step-1");
    await page.getByTestId("guided-tour-next").click();
    await snap(page, "tour-step-2");
    await page.keyboard.press("Escape");
  }
} else {
  const wall0 = Date.now();
  await page.locator('[data-testid="rtt-shell"]').waitFor({ timeout: 30000 });
  note("resumed shell visible", { ms: Date.now() - wall0, ...(await hud(page)) });
  await page.waitForTimeout(500);
  await snap(page, "resumed");
}

let steps = 0;
let lastAct = null;
while (steps++ < MAX) {
  const s = await surface(page);
  const h = await hud(page);
  const act = h.act?.split("/")[0] ?? "?";
  const objective = h.objective;
  const stage = objective?.match(/Stage (\d)/)?.[1] ?? "x";
  if (act !== lastAct) { note("act", { act, ...h }); lastAct = act; }
  note("surface", { s, ...h });
  const r = await step(page, s, { act, stage });
  if (r === "done") break;
}
const stored = await page.evaluate(() => window.localStorage.getItem("peak3.run-the-table.active"));
note("stored", { stored });
fs.writeFileSync(path.join(OUT, "log.json"), JSON.stringify(log, null, 1));
await browser.close();
