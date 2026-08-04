// Re-confirmation of the theme default/preference contract on the current
// shipping tree, per the lead's request for raw command output rather than
// a citation of a prior run. Tests the BLOCKING PRE-PAINT SCRIPT's actual
// effect (document.documentElement's data-theme attribute at the moment of
// first paint, before React mounts) -- that is what a real user sees, and
// it is theme-script.ts's job, not just theme.ts's resolver.
//
// Playwright's `colorScheme` context option emulates the OS-level
// `prefers-color-scheme` media feature, independent of anything this app
// controls -- this is the real mechanism a browser uses to report the OS
// preference, not a stand-in for it.
//
// Lives in scripts/verify/ (not apps/web/, where it was first run from) --
// Playwright is only installed under apps/web/node_modules, so it's
// resolved from there explicitly; this repo has no root node_modules.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, "../../apps/web/package.json"));
const { chromium } = require("playwright");

const BASE = "http://localhost:3001";
const browser = await chromium.launch();

async function check(label, { storedPreference, osColorScheme }) {
  const context = await browser.newContext({ colorScheme: osColorScheme });
  if (storedPreference) {
    await context.addInitScript((pref) => {
      window.localStorage.setItem("peak3-theme", pref);
    }, storedPreference);
  }
  // Otherwise: genuinely empty storage. No addInitScript touching
  // localStorage at all -- a brand-new browser profile.
  const page = await context.newPage();
  // "domcontentloaded" -- the blocking inline script in <head> (the one
  // that sets data-theme before React ever mounts) has already run by this
  // point, since it is a synchronous <script> parsed before <body>. This is
  // the earliest point at which reading data-theme reflects what the
  // pre-paint script actually did, not what React's hydration did later.
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  const dataTheme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  const colorScheme = await page.evaluate(() => document.documentElement.style.colorScheme);
  const storedAfter = await page.evaluate(() => window.localStorage.getItem("peak3-theme"));
  await context.close();
  console.log(`${label}`);
  console.log(`  input: storedPreference=${storedPreference ?? "(none — empty storage)"}, OS prefers-color-scheme=${osColorScheme}`);
  console.log(`  output: data-theme="${dataTheme}", html.style.colorScheme="${colorScheme}", localStorage after load="${storedAfter}"`);
  console.log("");
  return dataTheme;
}

console.log("=== Theme contract evidence, run against the current integrated tree ===\n");

const r1 = await check("1. CLEAN USER (genuinely empty storage), OS prefers LIGHT", {
  storedPreference: null,
  osColorScheme: "light",
});

const r2 = await check("2. CLEAN USER (genuinely empty storage), OS prefers DARK", {
  storedPreference: null,
  osColorScheme: "dark",
});

const r3 = await check("3. EXPLICIT LIGHT preference stored, OS prefers DARK (must still win)", {
  storedPreference: "light",
  osColorScheme: "dark",
});

const r4 = await check("4. EXPLICIT LIGHT preference stored, OS prefers LIGHT (control)", {
  storedPreference: "light",
  osColorScheme: "light",
});

const r5 = await check("5. EXPLICIT SYSTEM preference stored, OS prefers LIGHT (must follow OS -> light)", {
  storedPreference: "system",
  osColorScheme: "light",
});

const r6 = await check("6. EXPLICIT SYSTEM preference stored, OS prefers DARK (must follow OS -> dark) -- THE REGRESSION-PRONE CASE", {
  storedPreference: "system",
  osColorScheme: "dark",
});

const r7 = await check("7. EXPLICIT DARK preference stored, OS prefers LIGHT (must still win)", {
  storedPreference: "dark",
  osColorScheme: "light",
});

await browser.close();

console.log("=== Summary ===");
const rows = [
  ["Clean, OS=light", r1, "dark"],
  ["Clean, OS=dark", r2, "dark"],
  ["Explicit light, OS=dark", r3, "light"],
  ["Explicit light, OS=light", r4, "light"],
  ["Explicit system, OS=light", r5, "light"],
  ["Explicit system, OS=dark", r6, "dark"],
  ["Explicit dark, OS=light", r7, "dark"],
];
let allPass = true;
for (const [label, actual, expected] of rows) {
  const pass = actual === expected;
  if (!pass) allPass = false;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}: expected "${expected}", got "${actual}"`);
}
console.log(allPass ? "\nALL CASES PASS" : "\nSOME CASES FAILED");
process.exit(allPass ? 0 : 1);
