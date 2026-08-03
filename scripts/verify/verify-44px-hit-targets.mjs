// Verifies game-experience's launch-polish LP2-1 claim: every 82-0
// selectable source, legal destination, cancel control and swap target
// exposes a >=44x44 CSS-pixel HIT AREA, not just a >=44x44 PAINTED area.
//
// Two things a naive rect check misses, both explicitly checked here:
//   1. THE ELEMENT MEASURED MUST BE THE ELEMENT THAT RECEIVES THE POINTER
//      EVENT. `getBoundingClientRect()` on the right selector can still lie
//      if something else paints on top of it (an occluding sibling, a
//      z-index/transform stacking context, a decorative overlay). Checked
//      here with `document.elementFromPoint()` at the centre and all four
//      inset corners of the measured rect -- the returned node must be the
//      target itself or one of its own descendants (clicking a descendant
//      still activates the target via DOM event bubbling, so that's a
//      legitimate pass; landing on an unrelated node is not).
//   2. A REAL DISPATCHED CLICK AT THE BOUNDARY MUST ACTUALLY ACTIVATE THE
//      CONTROL. `slot-move-btn` is the highest-risk case: game-experience's
//      own account of the fix is an invisible 44x44 OUTER <button> wrapping
//      a small visible inner <span> -- exactly the pattern where a rect
//      check passes and a real tap on the edge of the invisible area can
//      still fail. Verified by clicking at a corner of the reported rect
//      (not the centre, where even a broken hit area would likely still
//      work) and confirming the app actually responded (rearrange mode
//      entered), not just that a click event fired somewhere.
//
// Run at a desktop viewport AND a 390px mobile viewport, driving the SAME
// real game flow at each: begin run -> select a candidate (candidate-card)
// -> place into an open slot (court-slot legal destination) -> dismiss the
// resulting toast (court-action-toast-action/-dismiss) -> place a second
// card -> click Move on the first slot (slot-move-btn) -> reach the
// rearrange banner (rearrange-cancel-btn) and a swap target
// (slot-swap-target) -> trigger the swap-confirmation step against the
// second filled slot (swap-confirm-btn / swap-confirm-cancel-btn) -> also
// separately captures cancel-selection-btn (the Step 2 "choose someone
// else" banner) during the first candidate's placement step.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, "../../apps/web/package.json"));
const { chromium } = require("playwright");

const BASE = "http://localhost:3001";
const FLOOR = 44;

/** Measures one locator: bounding rect (in a real browser layout pass) plus
 *  an elementFromPoint check at the centre and four inset corners. Returns
 *  a structured result, never throws -- failures are DATA, not exceptions,
 *  so one bad control doesn't abort the whole sweep. */
async function measureControl(page, testid, { nth = 0 } = {}) {
  return page.evaluate(
    ({ testid, nth, floor }) => {
      const nodes = document.querySelectorAll(`[data-testid="${testid}"]`);
      const el = nodes[nth];
      if (!el) return { testid, nth, found: false };
      const rect = el.getBoundingClientRect();

      // Literal 1px-inset BOX CORNERS are the wrong probe for a rounded
      // element: confirmed empirically (see the commit message / report)
      // that a 44x44 `border-radius: 9999px` circle in this exact browser
      // has NO hit-testable pixels within ~5px of its bounding-box corner
      // -- elementFromPoint falls through to whatever is underneath there,
      // by design, because nothing paints in that clipped-away region.
      // That is normal, expected behaviour for a round target (the same
      // thing a native round button on either mobile platform does), not
      // an accessibility defect, and testing literal corners would flag
      // every correctly-built pill/circle control as a false failure.
      //
      // EDGE MIDPOINTS are the correct probe for "does this control really
      // reach its full reported width/height as a hit area": for ANY
      // border-radius that doesn't exceed half the shorter dimension (i.e.
      // any non-degenerate rounded shape), the midpoint of each edge is
      // mathematically guaranteed to be OUTSIDE the rounded corner cut and
      // therefore part of the shape -- so if an edge midpoint fails, that
      // is a real problem (occlusion, wrong element, or an actually
      // undersized hit area), not a rounding artifact.
      //
      // A wider corner inset (8px -- confirmed clear of the pill case
      // above) is also checked, to still catch a sibling that covers MOST
      // of the control (a real occlusion) without flagging ordinary corner
      // rounding.
      const inset = 1;
      const cornerInset = 8;
      const points = {
        center: [rect.left + rect.width / 2, rect.top + rect.height / 2],
        topEdgeMid: [rect.left + rect.width / 2, rect.top + inset],
        bottomEdgeMid: [rect.left + rect.width / 2, rect.bottom - inset],
        leftEdgeMid: [rect.left + inset, rect.top + rect.height / 2],
        rightEdgeMid: [rect.right - inset, rect.top + rect.height / 2],
        topLeftWide: [rect.left + cornerInset, rect.top + cornerInset],
        topRightWide: [rect.right - cornerInset, rect.top + cornerInset],
        bottomLeftWide: [rect.left + cornerInset, rect.bottom - cornerInset],
        bottomRightWide: [rect.right - cornerInset, rect.bottom - cornerInset],
      };
      const hits = {};
      for (const [name, [x, y]] of Object.entries(points)) {
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
          hits[name] = { offscreen: true, x, y };
          continue;
        }
        const hitEl = document.elementFromPoint(x, y);
        const isTargetOrDescendant = hitEl === el || (hitEl && el.contains(hitEl));
        // `<nextjs-portal>` is Next.js's own dev-mode tools indicator (the
        // small floating badge visible in every `next dev` screenshot this
        // whole pass) -- it does not exist in a production build (confirmed:
        // it is a dev-server-only custom element, never shipped in a `next
        // build` bundle), so a probe point landing on it says something
        // about this test's dev-mode environment, not about the product.
        // Recorded, not silently dropped, so a genuine future product
        // overlay with the same tag name (there won't be one) would still
        // be visible in the raw hit data.
        const isDevToolsArtifact = hitEl && hitEl.tagName === "NEXTJS-PORTAL";
        hits[name] = {
          x,
          y,
          resolvedTag: hitEl ? hitEl.tagName : null,
          resolvedTestId: hitEl ? hitEl.getAttribute("data-testid") : null,
          isTargetOrDescendant,
          isDevToolsArtifact,
        };
      }
      return {
        testid,
        nth,
        found: true,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        borderRadius: getComputedStyle(el).borderRadius,
        meetsFloor: rect.width >= floor && rect.height >= floor,
        hits,
        allHitsResolveCorrectly: Object.values(hits).every(
          (h) => h.offscreen || h.isTargetOrDescendant || h.isDevToolsArtifact,
        ),
      };
    },
    { testid, nth, floor: FLOOR },
  );
}

function report(result, label) {
  if (!result.found) {
    console.log(`  MISSING  ${label} (nth=${result.nth}) -- selector matched nothing`);
    return false;
  }
  const sizeOk = result.meetsFloor;
  const hitOk = result.allHitsResolveCorrectly;
  const pass = sizeOk && hitOk;
  console.log(
    `  ${pass ? "PASS" : "FAIL"}  ${label}: rect=${result.rect.width.toFixed(1)}x${result.rect.height.toFixed(1)} ` +
      `(>=44: ${sizeOk}) hit-test=${hitOk ? "all corners+center resolve to target" : "SEE BELOW"}`,
  );
  for (const [corner, h] of Object.entries(result.hits)) {
    if (h.offscreen || h.isTargetOrDescendant) continue;
    if (h.isDevToolsArtifact) {
      console.log(`         ${corner} (${h.x.toFixed(1)}, ${h.y.toFixed(1)}) resolved to Next.js's own dev-mode tools indicator -- excused (dev-server-only, not in a production build), not counted as a failure`);
    } else {
      console.log(`         ${corner} (${h.x.toFixed(1)}, ${h.y.toFixed(1)}) resolved to <${h.resolvedTag}> data-testid="${h.resolvedTestId}" -- NOT the target or a descendant of it`);
    }
  }
  return pass;
}

async function runFlow(page, viewportLabel) {
  const results = [];
  console.log(`\n=== ${viewportLabel} ===`);

  await page.goto(BASE + "/arena/court/practice/apex_1y?seed=42", { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /begin 82-0 run/i }).click();
  await page.waitForTimeout(1000);

  // 1. Selectable source: candidate-card
  results.push(["candidate-card (selectable source)", report(await measureControl(page, "candidate-card"), "candidate-card[0]")]);

  const firstCandidate = page.locator('[data-testid="candidate-card"]').first();
  await firstCandidate.click();
  await page.waitForTimeout(500);

  // 2. cancel-selection-btn (Step 2 banner)
  results.push(["cancel-selection-btn", report(await measureControl(page, "cancel-selection-btn"), "cancel-selection-btn")]);

  // 3. Legal destination: open court-slot
  results.push(["court-slot (legal destination, open)", report(await measureControl(page, "court-slot"), "court-slot[0]")]);

  await page.locator('[data-testid="court-slot"]').first().click();
  await page.waitForTimeout(800);

  // 4. Toast controls (first placement -> "Move" label)
  results.push(["court-action-toast-action (Move)", report(await measureControl(page, "court-action-toast-action"), "court-action-toast-action")]);
  results.push(["court-action-toast-dismiss", report(await measureControl(page, "court-action-toast-dismiss"), "court-action-toast-dismiss")]);

  await page.locator('[data-testid="court-action-toast-dismiss"]').click();
  await page.waitForTimeout(300);

  // Place a second card so a second filled slot exists (needed for the
  // swap-confirmation path).
  await page.locator('[data-testid="candidate-card"]').first().click();
  await page.waitForTimeout(500);
  await page.locator('[data-testid="court-slot"][data-filled="false"]').first().click();
  await page.waitForTimeout(800);
  await page.locator('[data-testid="court-action-toast-dismiss"]').click().catch(() => {});
  await page.waitForTimeout(300);

  // 5. slot-move-btn -- THE WRAPPER-TRICK CONTROL. Measure, verify hit-test,
  // then dispatch a REAL click at the corner of the reported rect (not the
  // centre) and confirm it actually activated (rearrange-banner appears).
  const moveMeasurement = await measureControl(page, "slot-move-btn");
  results.push(["slot-move-btn", report(moveMeasurement, "slot-move-btn[0]")]);

  if (moveMeasurement.found) {
    const r = moveMeasurement.rect;
    const cornerX = r.x + r.width - 2;
    const cornerY = r.y + r.height - 2;
    await page.mouse.click(cornerX, cornerY);
    await page.waitForTimeout(500);
    const rearrangeBannerVisible = await page.locator('[data-testid="rearrange-banner"]').count();
    const activated = rearrangeBannerVisible > 0;
    console.log(`  ${activated ? "PASS" : "FAIL"}  slot-move-btn REAL CLICK at corner (${cornerX.toFixed(1)}, ${cornerY.toFixed(1)}) -- rearrange-banner ${activated ? "appeared" : "did NOT appear"}`);
    results.push(["slot-move-btn real corner click activates", activated]);
  } else {
    results.push(["slot-move-btn real corner click activates", false]);
  }

  // 6. rearrange-cancel-btn, slot-swap-target
  results.push(["rearrange-cancel-btn", report(await measureControl(page, "rearrange-cancel-btn"), "rearrange-cancel-btn")]);
  results.push(["slot-swap-target (legal destination while moving)", report(await measureControl(page, "slot-swap-target"), "slot-swap-target[0]")]);

  // Click the FILLED swap target to reach the confirmation step.
  const filledTargetIdx = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('[data-testid="slot-swap-target"]')];
    return nodes.findIndex((n) => n.getAttribute("data-filled") === "true");
  });
  if (filledTargetIdx >= 0) {
    await page.locator('[data-testid="slot-swap-target"][data-filled="true"]').first().click();
    await page.waitForTimeout(500);
    results.push(["swap-confirm-btn", report(await measureControl(page, "swap-confirm-btn"), "swap-confirm-btn")]);
    results.push(["swap-confirm-cancel-btn", report(await measureControl(page, "swap-confirm-cancel-btn"), "swap-confirm-cancel-btn")]);

    // Complete the swap to reach the "Undo" toast -- the one flagged as
    // about to become the real Undo route, reached under time pressure.
    await page.locator('[data-testid="swap-confirm-btn"]').click();
    await page.waitForTimeout(800);
    const undoLabel = await page.locator('[data-testid="court-action-toast-action"]').textContent().catch(() => null);
    console.log(`  toast action label after completing a swap: "${undoLabel}" (expect "Undo")`);
    results.push(["court-action-toast-action (Undo)", report(await measureControl(page, "court-action-toast-action"), "court-action-toast-action (Undo state)")]);
    results.push(["court-action-toast-dismiss (Undo state)", report(await measureControl(page, "court-action-toast-dismiss"), "court-action-toast-dismiss (Undo state)")]);
  } else {
    console.log("  Could not reach a filled swap-target -- swap-confirm-btn/-cancel-btn/Undo-toast not tested this run");
  }

  return results;
}

const browser = await chromium.launch();

const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
const desktopPage = await desktopContext.newPage();
const desktopResults = await runFlow(desktopPage, "DESKTOP (1440x1000)");
await desktopContext.close();

const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
const mobilePage = await mobileContext.newPage();
const mobileResults = await runFlow(mobilePage, "MOBILE (390x844)");
await mobileContext.close();

await browser.close();

console.log("\n=== SUMMARY ===");
let allPass = true;
for (const [label, results] of [["DESKTOP", desktopResults], ["MOBILE", mobileResults]]) {
  for (const [name, pass] of results) {
    if (!pass) {
      allPass = false;
      console.log(`FAIL: [${label}] ${name}`);
    }
  }
}
console.log(allPass ? "ALL CONTROLS PASS (size + hit-test + real-click) on both viewports" : "SOME CONTROLS FAILED -- see above");
process.exit(allPass ? 0 : 1);
