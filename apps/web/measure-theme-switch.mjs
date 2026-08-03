// Measures click-to-first-theme-paint latency for the ThemeToggle control.
// Method: attach a rAF-polling loop right before dispatching the click that
// watches `document.documentElement.getAttribute('data-theme')` and
// `getComputedStyle(document.body).backgroundColor`; records the first
// animation frame at which EITHER changes from its pre-click value, then
// reads `performance.now()` deltas captured inside the page. This measures
// wall-clock click -> visual-property-changed, not just click -> JS handler
// returning, so it would surface a real rendering delay (e.g. a CSS
// transition, a blocking fetch before the DOM write) if one existed.
import { chromium } from "playwright";

const URL = process.argv[2] || "http://localhost:3100/";
const SAMPLES = Number(process.argv[3] || 15);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// Fresh, clean localStorage each run (matches the "brand-new user" case for
// the FIRST click; subsequent clicks in the same session are the toggle's
// steady-state behavior).
await page.goto(URL, { waitUntil: "networkidle" });

const results = [];

for (let i = 0; i < SAMPLES; i++) {
  // Install the observer and get a handle we can await after the click.
  const measurementPromise = page.evaluate(() => {
    return new Promise((resolve) => {
      const html = document.documentElement;
      const bodyStyle = getComputedStyle(document.body);
      const startTheme = html.getAttribute("data-theme");
      const startBg = bodyStyle.backgroundColor;
      const t0 = performance.now();
      let settled = false;
      function tick() {
        if (settled) return;
        const nowTheme = html.getAttribute("data-theme");
        const nowBg = getComputedStyle(document.body).backgroundColor;
        if (nowTheme !== startTheme || nowBg !== startBg) {
          settled = true;
          resolve({ ms: performance.now() - t0, from: startTheme, to: nowTheme });
          return;
        }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
      // Safety timeout so a hung page doesn't hang the script.
      setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve({ ms: -1, from: startTheme, to: html.getAttribute("data-theme"), timedOut: true });
        }
      }, 5000);
    });
  });

  // performance.now() click dispatch — use Playwright's own click (real
  // trusted event through the compositor) rather than page.evaluate-click.
  await page.click('[data-testid="theme-toggle"]');
  const result = await measurementPromise;
  results.push(result);
  // Let things settle between samples.
  await page.waitForTimeout(150);
}

await browser.close();

const ok = results.filter((r) => r.ms >= 0);
const timedOut = results.length - ok.length;
const ms = ok.map((r) => r.ms).sort((a, b) => a - b);
const sum = ms.reduce((a, b) => a + b, 0);
const mean = sum / ms.length;
const median = ms[Math.floor(ms.length / 2)];
const p95 = ms[Math.floor(ms.length * 0.95)];

console.log(JSON.stringify({ url: URL, samples: SAMPLES, timedOut, all: results, mean, median, p95, min: ms[0], max: ms[ms.length - 1] }, null, 2));
