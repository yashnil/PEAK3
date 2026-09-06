// $20 Showdown manual QA: sign in with the e2e JWT, open a bot-practice
// auction from the lobby, play it with a rank-agnostic "reasonable human"
// policy driven from the DOM, and log every lot: who won it, at what price,
// what I was willing to pay. Screenshots at each of my turns and at the end.
//   node sd-play.mjs --out=DIR [--games=N] [--cap=7]
import { chromium } from "/Users/yashnilmohanty/Desktop/PEAK3/apps/web/node_modules/playwright/index.mjs";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), "1"]; }));
const OUT = args.out ?? "./sd-out";
const GAMES = Number(args.games ?? 1);
const BASE = "http://localhost:3000";
fs.mkdirSync(OUT, { recursive: true });
const SECRET = process.env.PEAK3_TEST_JWT_SECRET || "e2e-ranked-test-secret-do-not-use-in-prod";
const b64 = (s) => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function jwt(sub) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64(JSON.stringify({ sub, email: `${sub}@e2e.test`, is_anonymous: false, aud: "authenticated", role: "authenticated", iat: now, exp: now + 3600 }));
  const sig = createHmac("sha256", SECRET).update(`${h}.${p}`).digest();
  return `${h}.${p}.${b64(sig)}`;
}
const t0 = Date.now();
const note = (msg, extra = {}) => console.log(JSON.stringify({ t: Date.now() - t0, msg, ...extra }));

async function readTable(page) {
  return page.evaluate(() => {
    const q = (s) => document.querySelector(`[data-testid="${s}"]`)?.textContent?.trim() ?? null;
    const num = (s) => { const t = q(s); const m = t ? t.match(/-?\d+(\.\d+)?/) : null; return m ? Number(m[0]) : null; };
    return {
      phase: q("td-market-phase"),
      turn: q("td-turn-indicator"),
      candidate: q("td-candidate-name"),
      season: q("td-candidate-season"),
      standing: q("td-standing-bid"),
      standingNum: num("td-standing-bid"),
      budget0: num("td-budget-0"), budget1: num("td-budget-1"),
      spots0: q("td-spots-0"), spots1: q("td-spots-1"),
      skips0: q("td-skips-0"), skips1: q("td-skips-1"),
      bidAmount: num("td-bid-amount"),
      controls: !!document.querySelector('[data-testid="td-bid-controls"]'),
      submitEnabled: !!document.querySelector('[data-testid="td-submit-bid"]:not([disabled])'),
      passEnabled: !!document.querySelector('[data-testid="td-pass"]:not([disabled])'),
      ticker: q("td-lot-ticker"),
      reveal: q("td-lot-reveal"),
      revealScore: q("td-reveal-score"),
      done: !!document.querySelector('[data-testid="td-result"], [data-testid="sd-result"], [data-testid="td-final"]') || /result|final/i.test(document.querySelector('[data-testid="td-game"]')?.getAttribute("data-phase") ?? ""),
      bodyHint: document.body.innerText.slice(0, 0),
    };
  });
}

// A reasonable human: values by the era/name heuristics a fan would use
// (nothing hidden), spends steadily, keeps a reserve for open spots, never
// chases past a cap, and occasionally lets a lot go.
function decide(t, mySeat, lotIndex, memory) {
  const budget = mySeat === 0 ? t.budget0 : t.budget1;
  const spotsText = mySeat === 0 ? t.spots0 : t.spots1;
  const spots = Number((spotsText ?? "").match(/\d+/)?.[0] ?? 5);
  const standing = t.standingNum ?? 0;
  const reserve = Math.max(0, spots - 1); // $1 per remaining open spot
  const spendable = budget - reserve;
  if (spendable <= 0) return { action: "pass", reason: "reserve" };
  // Interest: a stable per-lot pseudo-random preference so it is not uniform.
  const seed = (memory.seed + lotIndex * 7919) % 97;
  const keen = seed % 3 === 0; // a third of lots I like
  const cap = Math.min(spendable, keen ? Math.max(3, Math.round(budget / Math.max(1, spots)) + 2) : Math.max(1, Math.round(budget / Math.max(1, spots)) - 1));
  const next = standing + 1;
  if (next > cap) return { action: "pass", reason: `cap ${cap} < ${next}` };
  return { action: "bid", amount: next, cap };
}

const browser = await chromium.launch();
for (let g = 0; g < GAMES; g++) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => note("pageerror", { error: String(e) }));
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.__peak3TestAuth !== "undefined");
  const sub = `qa-sd-${Date.now()}-${g}`;
  await page.evaluate(([t, s]) => window.__peak3TestAuth.setSession(t, { id: s, email: `${s}@e2e.test`, isAnonymous: false }), [jwt(sub), sub]);
  await page.goto(BASE + "/arena/lobby", { waitUntil: "domcontentloaded" });
  await page.getByTestId("lobby-twenty_dollar-practice").click();
  await page.waitForURL(/\/arena\/twenty-dollar\/[0-9a-f-]{36}/, { timeout: 20000 });
  await page.getByTestId("td-game").waitFor({ timeout: 20000 });
  note("auction open", { game: g, url: page.url() });
  const memory = { seed: Math.floor(Math.random() * 97), lots: [] };
  let lastLot = null;
  let myTurns = 0;
  let shots = 0;
  let mySeat = null;
  const start = Date.now();
  while (Date.now() - start < 8 * 60 * 1000) {
    const t = await readTable(page);
    const url = page.url();
    if (/result|\/final/.test(url)) break;
    const resultVisible = await page.locator('[data-testid="td-result"], [data-testid="sd-result"], [data-testid="td-final"], [data-testid="sd-final"]').count();
    if (resultVisible > 0) break;
    if (t.candidate && t.candidate !== lastLot) {
      lastLot = t.candidate;
      memory.lots.push({ candidate: t.candidate, season: t.season, opened: Date.now() - start, myBids: [] });
      note("lot", { candidate: t.candidate, season: t.season, ticker: t.ticker, budget0: t.budget0, budget1: t.budget1 });
    }
    if (t.controls && t.submitEnabled) {
      if (mySeat === null) {
        // the seat whose budget the controls belong to is ours; the API view puts you first in the lobby practice — infer from the turn indicator text
        mySeat = /you/i.test(t.turn ?? "") ? 0 : 0;
      }
      myTurns++;
      const d = decide(t, mySeat, memory.lots.length, memory);
      if (shots < 8 && myTurns % 3 === 1) { await page.screenshot({ path: path.join(OUT, `g${g}-turn-${String(shots++).padStart(2, "0")}.png`) }); }
      if (d.action === "bid") {
        // step the proposal to the amount
        for (let i = 0; i < 6; i++) {
          const cur = (await readTable(page)).bidAmount ?? 0;
          if (cur >= d.amount) break;
          await page.getByTestId("td-bid-plus").click();
        }
        await page.getByTestId("td-submit-bid").click();
        memory.lots[memory.lots.length - 1]?.myBids.push(d.amount);
        note("me: bid", { candidate: t.candidate, amount: d.amount, cap: d.cap, standing: t.standingNum });
      } else {
        await page.getByTestId("td-pass").click();
        note("me: pass", { candidate: t.candidate, standing: t.standingNum, reason: d.reason });
      }
      await page.waitForTimeout(350);
      continue;
    }
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, `g${g}-end-top.png`) });
  const finalText = await page.evaluate(() => document.body.innerText);
  const m = finalText.match(/(You win|You won|Victory|Defeat|You lose|Bot wins|Draw|Tie)[^\n]*/i);
  note("game over", { game: g, headline: m ? m[0] : finalText.slice(0, 200).replace(/\n/g, " | ") });
  fs.writeFileSync(path.join(OUT, `g${g}-final.txt`), finalText);
  await page.evaluate(() => window.scrollTo(0, 800));
  await page.screenshot({ path: path.join(OUT, `g${g}-end-mid.png`) });
  await context.close();
}
await browser.close();
