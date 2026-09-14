// Browser action-lifecycle latency driver for Three-Man Weave and $20 Showdown.
//
// node latency-driver.mjs --web http://localhost:3101 --api http://localhost:8001 \
//   --mode tmw|td|td-forfeit --latency 0|250|750 --viewport desktop|mobile --label before
//
// Every click is dispatched INSIDE the page (pointerdown + click) so Playwright's
// actionability waits never pollute the numbers. Per interaction it records:
//   ackMs      first animation frame after the press where the UI shows the press
//   dispatchMs when the command request actually left (queued behind a lane?)
//   responseMs when the command response body was parsed
//   confirmMs  first frame where the authoritative state is on screen
// Resolved from the repository's web workspace, wherever this checkout lives.
import { createRequire } from "node:module";
const require = createRequire(new URL("../../../apps/web/package.json", import.meta.url));
const { chromium } = require("playwright");
import { createHmac } from "crypto";
import fs from "fs";
import path from "path";

const argv = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => (cur.startsWith("--") ? [...acc, [cur.slice(2), arr[i + 1]]] : acc), []),
);
const WEB = argv.web ?? "http://localhost:3101";
const API = argv.api ?? "http://localhost:8001";
const MODE = argv.mode ?? "tmw";
const LATENCY = Number(argv.latency ?? 0);
const VIEWPORT = argv.viewport ?? "desktop";
const LABEL = argv.label ?? "run";
// three_man_weave | three_man_weave_franchise | three_man_weave_decade
const TMW_MODE_ID = argv["tmw-mode"] ?? "three_man_weave";
const MAX_HUMAN_TURNS = Number(argv["max-turns"] ?? 99);
const SHOTS = argv.shots ?? null;
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), "timing");
fs.mkdirSync(OUT, { recursive: true });

function b64(s) {
  return Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function mint(sub) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64(JSON.stringify({ sub, email: `${sub}@e2e.test`, is_anonymous: false, aud: "authenticated", role: "authenticated", iat: now, exp: now + 3600 }));
  const sig = createHmac("sha256", "e2e-ranked-test-secret-do-not-use-in-prod").update(`${h}.${p}`).digest();
  return `${h}.${p}.${b64(sig)}`;
}

const INIT = () => {
  window.__lat = { fetches: [] };
  const orig = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (!url.includes("/api/v1/arena/")) return orig(input, init);
    const rec = { url, method: init?.method ?? "GET", t0: performance.now() };
    try {
      if (init?.body) rec.command = JSON.parse(init.body).command_type;
    } catch {}
    window.__lat.fetches.push(rec);
    const res = await orig(input, init);
    rec.t1 = performance.now();
    rec.status = res.status;
    res
      .clone()
      .json()
      .then((j) => {
        const m = j && j.match ? j.match : j;
        rec.t2 = performance.now();
        rec.accepted = j?.accepted;
        rec.version = m?.state_version;
        rec.phase = m?.turn_phase;
        rec.seat = m?.current_turn_seat_index;
        rec.you = m?.your_seat_index;
        rec.botReply = m?.bot_reply_in_seconds;
        rec.elapsed = m?.turn_elapsed_seconds;
        rec.total = m?.turn_total_seconds;
        rec.complete = m?.public_state?.is_complete ?? m?.public_state?.phase === "complete";
      })
      .catch(() => {});
    return res;
  };
};

// Runs in the page: press, then watch frames for ack and confirm.
async function pressAndWatch(page, { selector, ack, confirm, command, timeoutMs = 20000 }) {
  return page.evaluate(
    async ({ selector, ack, confirm, command, timeoutMs }) => {
      const ackFn = new Function(`return (${ack});`)();
      const confirmFn = new Function(`return (${confirm});`)();
      const el = document.querySelector(selector);
      if (!el) return { error: `missing ${selector}` };
      const n = window.__lat.fetches.length;
      const t0 = performance.now();
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));
      el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerType: "mouse" }));
      el.click();
      let ackMs = null;
      let confirmMs = null;
      return await new Promise((resolve) => {
        const tick = () => {
          const now = performance.now();
          if (ackMs === null && ackFn()) ackMs = now - t0;
          const cmd = window.__lat.fetches.slice(n).find((f) => !command || f.command === command);
          const responded = !command || (cmd && cmd.t2 != null);
          if (confirmMs === null && responded && confirmFn()) confirmMs = now - t0;
          if ((ackMs !== null && confirmMs !== null) || now - t0 > timeoutMs) {
            resolve({
              ackMs,
              confirmMs,
              dispatchMs: cmd ? cmd.t0 - t0 : null,
              responseMs: cmd && cmd.t2 != null ? cmd.t2 - t0 : null,
              accepted: cmd?.accepted ?? null,
              version: cmd?.version ?? null,
            });
          } else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    },
    { selector, ack: ack.toString(), confirm: confirm.toString(), command, timeoutMs },
  );
}

// Waits in the page for a predicate, returning ms since `sinceMark` (a performance.now()).
async function waitFrames(page, predicate, timeoutMs = 60000) {
  return page.evaluate(
    async ({ predicate, timeoutMs }) => {
      const fn = new Function(`return (${predicate});`)();
      const t0 = performance.now();
      return await new Promise((resolve) => {
        const tick = () => {
          if (fn()) return resolve(performance.now());
          if (performance.now() - t0 > timeoutMs) return resolve(null);
          requestAnimationFrame(tick);
        };
        tick();
      });
    },
    { predicate: predicate.toString(), timeoutMs },
  );
}

const results = { label: LABEL, mode: MODE, latency: LATENCY, viewport: VIEWPORT, samples: {}, notes: [] };
function sample(name, value) {
  (results.samples[name] ??= []).push(value);
}

async function setup() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT === "mobile" ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    reducedMotion: "no-preference",
  });
  await context.addInitScript(INIT);
  const page = await context.newPage();
  const token = null;
  // Production builds compile out the test-auth bridge; bot practice runs on
  // the API's signed anon cookie instead (ARENA_ANONYMOUS_PRACTICE_ENABLED).
  await page.goto(`${WEB}/arena`, { waitUntil: "domcontentloaded" });
  if (LATENCY > 0) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: LATENCY, downloadThroughput: -1, uploadThroughput: -1 });
  }
  PAGE = page;
  BROWSER = browser;
  return { browser, context, page, token };
}

let PAGE = null;
let BROWSER = null;
async function startPractice(_token, mode) {
  const out = await PAGE.evaluate(async ([api, mode]) => {
    const res = await fetch(`${api}/api/v1/arena/matches/practice`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    return { ok: res.ok, status: res.status, body: await res.json() };
  }, [API, mode]);
  if (!out.ok) throw new Error(`practice ${out.status} ${JSON.stringify(out.body)}`);
  return out.body;
}

// ---------------------------------------------------------------- TMW
async function runTmw() {
  const { browser, page, token } = await setup();
  const created = await startPractice(token, TMW_MODE_ID);
  const createdAt = Date.now();
  await page.goto(`${WEB}/arena/three-man-weave/${created.match_id}`, { waitUntil: "domcontentloaded" });
  const introRendered = await waitFrames(page, () => !!document.querySelector('[data-testid="tmw-intro"], [data-testid="tmw-room"]'), 60000);
  const arrival = await page.evaluate(() => {
    const first = window.__lat.fetches.find((f) => f.url.includes("/matches/") && f.method === "GET" && f.t2 != null);
    const room = document.querySelector('[data-testid="tmw-room"]');
    return { phase: room?.getAttribute("data-turn-phase"), firstRead: first ? { phase: first.phase, elapsed: first.elapsed, total: first.total } : null };
  });
  results.notes.push({ arrival, msFromCreateToRender: Date.now() - createdAt });
  sample("tmw.intro_elapsed_at_first_read_s", arrival.firstRead?.phase === "intro" ? arrival.firstRead.elapsed : 0);
  const tmwIntroSeen = await page.evaluate(async () => {
    const t0 = performance.now();
    while (performance.now() - t0 < 8000) {
      const hit = window.__lat.fetches.find((f) => f.t2 != null && f.phase === "intro");
      if (hit) return hit.elapsed;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  });
  sample("tmw.intro_elapsed_when_intro_first_seen_s", tmwIntroSeen);
  results.notes.push({ firstReadPhase: arrival.firstRead?.phase ?? null });

  let humanTurns = 0;
  let lastBotSeen = null;
  let revealShot = false;
  for (let guard = 0; guard < 4000; guard++) {
    const state = await page.evaluate(() => {
      const room = document.querySelector('[data-testid="tmw-room"]');
      return {
        phase: room?.getAttribute("data-turn-phase"),
        seq: room?.getAttribute("data-turn-seq"),
        overlay: !!document.querySelector('[data-testid="tmw-pick-overlay"]'),
        result: !!document.querySelector('[data-testid="tmw-play-again"]'),
        beat: room?.getAttribute("data-beat"),
      };
    });
    if (state.result) break;
    // One settled capture of a later round's reveal (after its reels resolve).
    if (SHOTS && state.phase === "reveal" && humanTurns >= 1 && !revealShot) {
      revealShot = true;
      await page.waitForTimeout(1100);
      await page.screenshot({ path: path.join(SHOTS, `tmw-${LABEL}-reveal-settled.png`) });
    }
    if (state.overlay && humanTurns < MAX_HUMAN_TURNS) {
      humanTurns += 1;
      // The overlay just opened: how long after the authoritative handoff?
      const handoff = await page.evaluate(() => {
        const reads = window.__lat.fetches.filter((f) => f.t2 != null && f.you != null && f.seat === f.you && f.phase === "pick");
        const first = reads.length ? reads[reads.length - 1] : null;
        return first ? performance.now() - first.t2 : null;
      });
      sample("tmw.handoff_read_to_actionable_ms_upper", handoff);

      // 1. Move a card first when the roster has two or more (rearrange).
      const move = await page.evaluate(() => {
        const slots = [...document.querySelectorAll('[data-testid^="tmw-place-"]')].filter((el) => /tmw-place-(PG|SG|SF|PF|C|bench_1)$/.test(el.getAttribute("data-testid")));
        const filled = slots.filter((el) => el.textContent && !/Empty|Open/i.test(el.textContent) && !el.disabled);
        return { filled: filled.map((el) => el.getAttribute("data-testid")) };
      });
      if (move.filled.length >= 1) {
        const from = move.filled[0];
        await page.evaluate((sel) => document.querySelector(`[data-testid="${sel}"]`)?.click(), from);
        await page.waitForTimeout(80);
        const target = await page.evaluate(() => {
          const t = [...document.querySelectorAll('[data-testid^="tmw-place-"]')].find(
            (el) => /tmw-place-(PG|SG|SF|PF|C|bench_1)$/.test(el.getAttribute("data-testid")) && !el.disabled && el.getAttribute("data-legal") !== "false" && el.getAttribute("aria-disabled") !== "true" && el.getAttribute("data-moving") !== "true",
          );
          const confirm = document.querySelector('[data-testid="tmw-move-confirm"]');
          return { target: t?.getAttribute("data-testid") ?? null, confirmPresent: !!confirm };
        });
        let moved = false;
        if (target.target) {
          await page.evaluate((sel) => document.querySelector(`[data-testid="${sel}"]`)?.click(), target.target);
          await page.waitForTimeout(60);
          const enabled = await page.evaluate(() => {
            const b = document.querySelector('[data-testid="tmw-move-confirm"]');
            return !!b && !b.disabled;
          });
          if (enabled) {
            const r = await pressAndWatch(page, {
              selector: '[data-testid="tmw-move-confirm"]',
              command: "tmw_rearrange",
              ack: () => !!document.querySelector('[data-pending="true"]') || document.querySelector('[data-testid="tmw-move-confirm"]')?.getAttribute("data-state") === "pending",
              confirm: () => !document.querySelector('[data-pending="true"]'),
            });
            sample("tmw.rearrange", r);
            moved = true;
          }
        }
        if (!moved) {
          await page.evaluate(() => document.querySelector('[data-testid="tmw-move-cancel"]')?.click());
        }
        await page.waitForTimeout(150);
      }

      // 2. Select a candidate (stage command).
      const cand = await page.evaluate(() => {
        const b = [...document.querySelectorAll('[data-testid^="tmw-candidate-"]')].find((el) => el.tagName === "BUTTON" && !el.disabled);
        return b?.getAttribute("data-testid") ?? null;
      });
      if (!cand) {
        results.notes.push({ deadEnd: true, turn: humanTurns });
        await page.waitForTimeout(1000);
        continue;
      }
      const sel = await pressAndWatch(page, {
        selector: `[data-testid="${cand}"]`,
        command: "tmw_stage_pick",
        ack: () => !!document.querySelector('[data-testid^="tmw-candidate-"][data-selected="true"]'),
        confirm: () => true,
        timeoutMs: 8000,
      });
      sample("tmw.select_stage", sel);
      // Multi-slot candidate: choose a slot.
      const needSlot = await page.evaluate(() => {
        const b = document.querySelector('[data-testid="tmw-confirm-pick"]');
        return !b || b.disabled;
      });
      if (needSlot) {
        await page.evaluate(() => {
          const s = document.querySelector('[data-testid="tmw-place-select"]');
          if (s && s.options.length > 1) {
            s.value = s.options[1].value;
            s.dispatchEvent(new Event("change", { bubbles: true }));
          }
        });
        await page.waitForTimeout(60);
      }
      // 3. Draft.
      const draft = await pressAndWatch(page, {
        selector: '[data-testid="tmw-confirm-pick"]',
        command: "tmw_pick",
        ack: () =>
          document.querySelector('[data-testid="tmw-confirm-pick"]')?.getAttribute("data-state") === "pending" ||
          !!document.querySelector('[data-pending="true"]') ||
          !document.querySelector('[data-testid="tmw-pick-overlay"]'),
        confirm: () => !document.querySelector('[data-testid="tmw-pick-overlay"]') && !document.querySelector('[data-pending="true"]'),
      });
      sample("tmw.draft", draft);
      // 4. Completed pick -> the room shows the next turn (seq moved, not overlay).
      const nextVisible = await page.evaluate(async (prevSeq) => {
        const t0 = performance.now();
        return await new Promise((resolve) => {
          const tick = () => {
            const room = document.querySelector('[data-testid="tmw-room"]');
            if (room && room.getAttribute("data-turn-seq") !== prevSeq) return resolve(performance.now() - t0);
            if (performance.now() - t0 > 15000) return resolve(null);
            requestAnimationFrame(tick);
          };
          tick();
        });
      }, state.seq);
      sample("tmw.after_confirm_next_turn_visible_ms", nextVisible);
      if (SHOTS && humanTurns <= 2) await page.screenshot({ path: path.join(SHOTS, `tmw-${LABEL}-turn${humanTurns}.png`) });
      continue;
    }
    await page.waitForTimeout(100);
  }
  // Bot move visibility lag: for every read that landed a new version on a bot seat
  // turn, how long after the bot was due did the client see it?
  const lag = await page.evaluate(() => {
    const f = window.__lat.fetches.filter((x) => x.t2 != null && x.version != null);
    const out = [];
    for (let i = 1; i < f.length; i++) {
      const prev = f[i - 1];
      if (prev.botReply != null && f[i].version > prev.version) {
        out.push(f[i].t2 - (prev.t2 + prev.botReply * 1000));
      }
    }
    const gets = f.filter((x) => x.method === "GET").length;
    return { lags: out, gets, commands: f.filter((x) => x.method === "POST").length, reqMs: f.filter((x) => x.method === "GET").map((x) => x.t2 - x.t0) };
  });
  lag.lags.forEach((v) => sample("tmw.bot_due_to_client_seen_ms", v));
  lag.reqMs.forEach((v) => sample("tmw.poll_request_ms", v));
  results.notes.push({ gets: lag.gets, commands: lag.commands, humanTurns });
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `tmw-${LABEL}-end.png`), fullPage: true });
  // The result screen stages its reveal; capture it again once it has settled.
  if (SHOTS) {
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(SHOTS, `tmw-${LABEL}-end-settled.png`), fullPage: true });
  }
  await browser.close();
}

// ---------------------------------------------------------------- Showdown
async function runTd(forfeit) {
  const { browser, page, token } = await setup();
  const created = await startPractice(token, "twenty_dollar");
  await page.goto(`${WEB}/arena/twenty-dollar/${created.match_id}`, { waitUntil: "domcontentloaded" });
  await waitFrames(page, () => !!document.querySelector('[data-testid="td-game"], [data-testid="td-bid-controls"], [data-testid="td-intro-countdown"]'), 60000);
  const first = await page.evaluate(() => window.__lat.fetches.find((f) => f.method === "GET" && f.t2 != null && f.url.includes("/matches/")));
  sample("td.intro_elapsed_at_first_read_s", first?.phase === "intro" ? first.elapsed : 0);
  results.notes.push({ firstReadPhase: first?.phase ?? null });
  // When the INTRO itself was first seen by this client: how much had elapsed.
  const introSeen = await page.evaluate(async () => {
    const t0 = performance.now();
    while (performance.now() - t0 < 8000) {
      const hit = window.__lat.fetches.find((f) => f.t2 != null && f.phase === "intro");
      if (hit) return hit.elapsed;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  });
  sample("td.intro_elapsed_when_intro_first_seen_s", introSeen);
  let actions = 0;
  let lastLot = null;
  let lotChangedAt = null;
  for (let guard = 0; guard < 6000; guard++) {
    const st = await page.evaluate(() => ({
      result: !!document.querySelector('[data-testid="td-result"]'),
      live: document.querySelector('[data-testid="td-bid-controls"]')?.getAttribute("data-live") === "true",
      lot: document.querySelector('[data-testid="td-lot-number"]')?.textContent ?? null,
      bidEnabled: !document.querySelector('[data-testid="td-submit-bid"]')?.disabled,
      passEnabled: !document.querySelector('[data-testid="td-pass"]')?.disabled,
      now: performance.now(),
    }));
    if (st.result) break;
    if (st.lot !== lastLot) {
      lastLot = st.lot;
      lotChangedAt = st.now;
    }
    if (st.live) {
      // How long after the authoritative "your turn" read did the controls go live?
      const handoff = await page.evaluate(() => {
        const reads = window.__lat.fetches.filter((f) => f.t2 != null && f.you != null && f.seat === f.you);
        const r = reads[reads.length - 1];
        return r ? performance.now() - r.t2 : null;
      });
      sample("td.read_to_controls_live_ms_upper", handoff);
      if (forfeit && actions >= 2) {
        await page.evaluate(() => document.querySelector('[data-testid="td-forfeit"]')?.click());
        await page.waitForTimeout(120);
        const r = await pressAndWatch(page, {
          selector: '[data-testid="td-forfeit-confirm-button"]',
          command: "showdown_forfeit",
          ack: () => {
            const b = document.querySelector('[data-testid="td-forfeit-confirm-button"]');
            return !b || b.disabled || /Conceding/.test(b.textContent ?? "") || !!document.querySelector('[data-testid="td-result"]');
          },
          confirm: () => !!document.querySelector('[data-testid="td-result"]'),
        });
        sample("td.forfeit", r);
        break;
      }
      actions += 1;
      const useBid = st.bidEnabled && actions % 2 === 1;
      const sel = useBid ? '[data-testid="td-submit-bid"]' : '[data-testid="td-pass"]';
      if (!useBid && !st.passEnabled) {
        await page.waitForTimeout(50);
        continue;
      }
      const opp = await page.evaluate(() => {
        const rails = [...document.querySelectorAll('[data-testid^="td-turn-rail-"]')];
        return rails.map((r) => r.getAttribute("data-testid"));
      });
      const r = await pressAndWatch(page, {
        selector: sel,
        command: useBid ? "bid" : "pass",
        ack: () => {
          const b = document.querySelector('[data-testid="td-submit-bid"]');
          const p = document.querySelector('[data-testid="td-pass"]');
          return [b, p].some((x) => x && (x.getAttribute("data-state") === "pending" || x.getAttribute("data-state") === "confirmed" || x.getAttribute("data-state") === "pressed")) || !!document.querySelector('[data-testid="td-pending"]');
        },
        confirm: () => {
          const c = document.querySelector('[data-testid="td-bid-controls"]');
          const b = document.querySelector('[data-testid="td-submit-bid"]');
          return !(b && b.getAttribute("data-state") === "pending") && !(c && c.getAttribute("data-live") === "true" && document.querySelector('[data-testid="td-pending"]'));
        },
      });
      sample(useBid ? "td.bid" : "td.pass", r);
      // Handoff: the opponent's rail becomes the active one.
      const h = await page.evaluate(async () => {
        const t0 = performance.now();
        return await new Promise((resolve) => {
          const tick = () => {
            const live = document.querySelector('[data-testid="td-bid-controls"]')?.getAttribute("data-live") === "true";
            const active = [...document.querySelectorAll('[data-testid^="td-turn-rail-"]')].some((r) => r.getAttribute("data-state") === "active" && r.getAttribute("data-owner") !== "you");
            if (active || live || document.querySelector('[data-testid="td-result"]')) return resolve(performance.now() - t0);
            if (performance.now() - t0 > 10000) return resolve(null);
            requestAnimationFrame(tick);
          };
          tick();
        });
      });
      sample("td.after_confirm_handoff_visible_ms", h);
      if (SHOTS && actions <= 2) await page.screenshot({ path: path.join(SHOTS, `td-${LABEL}-action${actions}.png`) });
      continue;
    }
    await page.waitForTimeout(60);
  }
  const lag = await page.evaluate(() => {
    const f = window.__lat.fetches.filter((x) => x.t2 != null && x.version != null);
    const out = [];
    for (let i = 1; i < f.length; i++) {
      const prev = f[i - 1];
      if (prev.botReply != null && f[i].version > prev.version) out.push(f[i].t2 - (prev.t2 + prev.botReply * 1000));
    }
    return { lags: out, reqMs: f.map((x) => ({ m: x.method, ms: x.t2 - x.t0 })) };
  });
  lag.lags.forEach((v) => sample("td.bot_due_to_client_seen_ms", v));
  lag.reqMs.filter((x) => x.m === "GET").forEach((x) => sample("td.poll_request_ms", x.ms));
  lag.reqMs.filter((x) => x.m === "POST").forEach((x) => sample("td.command_request_ms", x.ms));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `td-${LABEL}-end.png`), fullPage: true });
  // The result screen stages its reveal; capture it again once it has settled.
  if (SHOTS) {
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(SHOTS, `td-${LABEL}-end-settled.png`), fullPage: true });
  }
  await browser.close();
}

function pct(values, p) {
  const v = values.filter((x) => typeof x === "number" && isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return Math.round(v[Math.min(v.length - 1, Math.round(p * (v.length - 1)))]);
}

try {
  if (MODE === "tmw") await runTmw();
  else await runTd(MODE === "td-forfeit");
} catch (error) {
  results.notes.push({ error: String(error?.stack ?? error) });
  try {
    await BROWSER?.close();
  } catch {}
}

const summary = {};
for (const [name, list] of Object.entries(results.samples)) {
  if (typeof list[0] === "object" && list[0] !== null) {
    const keys = ["ackMs", "dispatchMs", "responseMs", "confirmMs"];
    summary[name] = Object.fromEntries(keys.map((k) => [k, { n: list.length, p50: pct(list.map((x) => x[k]), 0.5), p95: pct(list.map((x) => x[k]), 0.95), max: pct(list.map((x) => x[k]), 1) }]));
  } else {
    summary[name] = { n: list.length, p50: pct(list, 0.5), p95: pct(list, 0.95), max: pct(list, 1) };
  }
}
results.summary = summary;
const file = path.join(OUT, `browser_${LABEL}_${MODE}_${VIEWPORT}_lat${LATENCY}.json`);
fs.writeFileSync(file, JSON.stringify(results, null, 2));
console.log(JSON.stringify({ file, summary, notes: results.notes.slice(0, 6) }, null, 1));
