// Companion to verify-theme-contract.mjs: confirms none of the
// default-theme cases (clean storage, either OS preference; explicit
// "system" following the OS) produce a React hydration warning -- the
// blocking pre-paint script and the client resolver must already agree by
// the time React mounts, or this would fire.
//
// Lives in scripts/verify/ -- Playwright resolved from apps/web/node_modules
// via the same createRequire shim as its sibling script.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, "../../apps/web/package.json"));
const { chromium } = require("playwright");

const BASE = "http://localhost:3001";
const browser = await chromium.launch();

async function checkConsole(label, { storedPreference, osColorScheme }) {
  const context = await browser.newContext({ colorScheme: osColorScheme });
  if (storedPreference) {
    await context.addInitScript((pref) => window.localStorage.setItem("peak3-theme", pref), storedPreference);
  }
  const page = await context.newPage();
  const messages = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") messages.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => messages.push(`[pageerror] ${err.message}`));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(500); // let React finish hydrating and any late warnings surface
  const hydrationRelated = messages.filter((m) => /hydrat/i.test(m));
  console.log(`${label}: ${messages.length} console error/warning message(s) total, ${hydrationRelated.length} hydration-related`);
  if (messages.length) messages.forEach((m) => console.log("  " + m));
  await context.close();
  return hydrationRelated.length === 0;
}

const a = await checkConsole("Clean storage, OS=light -> dark default", { storedPreference: null, osColorScheme: "light" });
const b = await checkConsole("Clean storage, OS=dark -> dark default", { storedPreference: null, osColorScheme: "dark" });
const c = await checkConsole("Explicit system, OS=dark -> dark (the regression-prone case)", { storedPreference: "system", osColorScheme: "dark" });
await browser.close();
console.log(a && b && c ? "\nNO HYDRATION WARNINGS in any case" : "\nHYDRATION WARNING DETECTED");
process.exit(a && b && c ? 0 : 1);
