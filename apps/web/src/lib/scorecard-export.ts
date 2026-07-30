/**
 * Phase 8I: downloadable scorecard image -- "Download Image" / "Save
 * Scorecard" in the share panel. Dependency-free: draws a focused,
 * purpose-built card directly on an offscreen <canvas> (no html2canvas/
 * dom-to-image/etc, no new npm dependency) rather than screenshotting the
 * whole long result page, so the exported image looks intentional instead
 * of like a raw page capture. `canvas.toBlob()` + an object URL + a
 * synthetic <a download> click is the whole download mechanism -- standard
 * browser APIs only, works identically on the owner's own result page and
 * on a read-only shared result page (both call this with the same public
 * state/result shape).
 */
import { CourtLineupPublicState, CourtSlotPublic, SimulationResultPublic, SlotType, STARTER_SLOT_TYPES, BENCH_SLOT_TYPES } from "@/types/perfect-season";
import { resultTier } from "@/components/court/SeasonResultStub";
import { getTeamColors } from "@/lib/team-colors";

// Short pill labels for the compact card -- the app's own SLOT_LABELS
// ("Shooting Guard", "Power Forward"...) are meant for prose UI copy and
// don't fit a fixed-width canvas pill at a readable font size.
const PILL_LABELS: Record<SlotType, string> = {
  PG: "PG",
  SG: "SG",
  SF: "SF",
  PF: "PF",
  C: "C",
  bench_1: "B1",
  bench_2: "B2",
  bench_3: "B3",
};

const WIDTH = 1080;
const HEIGHT = 1250;
const MARGIN = 64;

const COLOR_BG_TOP = "#14110a";
const COLOR_BG_BOTTOM = "#0b0902";
const COLOR_ACCENT = "#f5c842";
const COLOR_TEXT_PRIMARY = "#f5f3ee";
const COLOR_TEXT_SECONDARY = "#b7b2a6";
const COLOR_TEXT_MUTED = "#7d7869";
const COLOR_SURFACE = "rgba(255,255,255,0.04)";
const COLOR_BORDER = "rgba(245,200,66,0.35)";
const COLOR_GREEN = "#34d399";

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + "…";
}

/** Builds the scorecard on an offscreen canvas. Exported separately from
 * the download trigger so tests can assert on the canvas/blob without
 * touching the DOM download flow. */
export function drawScorecard(
  canvas: HTMLCanvasElement,
  state: CourtLineupPublicState,
  result: SimulationResultPublic,
  shareUrl: string,
): void {
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Background wash, matching the app's own dark court gradient.
  const bg = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  bg.addColorStop(0, COLOR_BG_TOP);
  bg.addColorStop(1, COLOR_BG_BOTTOM);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Outer card border/frame.
  ctx.strokeStyle = COLOR_BORDER;
  ctx.lineWidth = 3;
  roundRect(ctx, MARGIN / 2, MARGIN / 2, WIDTH - MARGIN, HEIGHT - MARGIN, 28);
  ctx.stroke();

  let y = MARGIN + 20;

  // Header label.
  ctx.fillStyle = COLOR_ACCENT;
  ctx.font = "800 26px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("PEAK3 · 82-0 PEAK SEASON", MARGIN, y);
  y += 70;

  // Tier headline.
  ctx.fillStyle = COLOR_ACCENT;
  ctx.font = "700 24px system-ui, -apple-system, sans-serif";
  ctx.fillText(resultTier(result.wins).toUpperCase(), MARGIN, y);
  y += 60;

  // Big record. Canvas fillText's y is the text BASELINE, and a 128px font's
  // glyphs extend well above it -- the gap before this line has to clear
  // the full cap-height, not just a normal line-height increment, or it
  // collides with the tier headline above it.
  y += 128;
  ctx.fillStyle = result.wins >= 82 ? COLOR_ACCENT : COLOR_TEXT_PRIMARY;
  ctx.font = "900 128px system-ui, -apple-system, sans-serif";
  ctx.fillText(`${result.wins}-${result.losses}`, MARGIN, y);
  y += 56;

  // Lineup score.
  ctx.fillStyle = COLOR_TEXT_SECONDARY;
  ctx.font = "600 30px system-ui, -apple-system, sans-serif";
  const scoreText =
    result.lineup_score_status === "complete"
      ? `PEAK3 Lineup Score: ${result.lineup_peak_score.toFixed(1)} / 100`
      : "PEAK3 Lineup Score: incomplete";
  ctx.fillText(scoreText, MARGIN, y);
  y += 56;

  // Divider.
  ctx.strokeStyle = COLOR_BORDER;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(MARGIN, y);
  ctx.lineTo(WIDTH - MARGIN, y);
  ctx.stroke();
  y += 44;

  // Roster.
  ctx.fillStyle = COLOR_TEXT_PRIMARY;
  ctx.font = "800 26px system-ui, -apple-system, sans-serif";
  ctx.fillText("ROSTER", MARGIN, y);
  y += 44;

  const orderedSlots: CourtSlotPublic[] = [...STARTER_SLOT_TYPES, ...BENCH_SLOT_TYPES]
    .map((slotType) => state.slots.find((s) => s.slot_type === slotType))
    .filter((s): s is CourtSlotPublic => !!s);

  const rowHeight = 46;
  const pillWidth = 56;
  for (const slot of orderedSlots) {
    const label = PILL_LABELS[slot.slot_type as SlotType] ?? slot.slot_type;
    const colors = slot.team_name ? getTeamColors(slot.team_name) : null;

    // Position pill.
    ctx.fillStyle = colors?.primary ?? "rgba(255,255,255,0.08)";
    roundRect(ctx, MARGIN, y - 28, pillWidth, 34, 8);
    ctx.fill();
    ctx.fillStyle = colors?.secondary ?? COLOR_TEXT_MUTED;
    ctx.font = "800 16px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, MARGIN + pillWidth / 2, y - 5);

    // Player name + team/season.
    ctx.textAlign = "left";
    ctx.fillStyle = COLOR_TEXT_PRIMARY;
    ctx.font = "700 24px system-ui, -apple-system, sans-serif";
    const nameX = MARGIN + pillWidth + 20;
    const name = slot.player_name ?? "—";
    ctx.fillText(truncate(ctx, name, 480), nameX, y - 5);

    if (slot.team_name || slot.season) {
      const meta = [slot.team_name, slot.season].filter(Boolean).join(" · ");
      ctx.font = "700 24px system-ui, -apple-system, sans-serif";
      const measuredNameWidth = Math.min(ctx.measureText(truncate(ctx, name, 480)).width, 480);
      ctx.font = "500 18px system-ui, -apple-system, sans-serif";
      ctx.fillStyle = COLOR_TEXT_MUTED;
      const metaX = nameX + measuredNameWidth + 14;
      if (metaX < WIDTH - MARGIN - 40) {
        ctx.fillText(truncate(ctx, meta, WIDTH - MARGIN - metaX), metaX, y - 5);
      }
    }

    y += rowHeight;
  }

  y += 20;

  // Best pick / AI match count panel.
  const panelH = 132;
  ctx.fillStyle = COLOR_SURFACE;
  roundRect(ctx, MARGIN, y, WIDTH - MARGIN * 2, panelH, 16);
  ctx.fill();
  let py = y + 42;
  ctx.font = "700 24px system-ui, -apple-system, sans-serif";
  if (result.best_pick) {
    ctx.fillStyle = COLOR_GREEN;
    ctx.fillText(`Best pick: ${truncate(ctx, result.best_pick, WIDTH - MARGIN * 2 - 40)}`, MARGIN + 24, py);
    py += 44;
  }
  if (result.peak_picks_recap && result.peak_picks_recap.length > 0) {
    const matched = result.peak_picks_recap.filter((r) => r.matched).length;
    ctx.fillStyle = COLOR_ACCENT;
    ctx.fillText(`Matched PEAK3's own pick ${matched}/${result.peak_picks_recap.length} rounds`, MARGIN + 24, py);
  }
  y += panelH + 40;

  // Footer.
  ctx.strokeStyle = COLOR_BORDER;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(MARGIN, y);
  ctx.lineTo(WIDTH - MARGIN, y);
  ctx.stroke();
  y += 40;

  ctx.fillStyle = COLOR_TEXT_SECONDARY;
  ctx.font = "700 22px system-ui, -apple-system, sans-serif";
  ctx.fillText("Play at PEAK3 Arena", MARGIN, y);
  y += 32;
  ctx.fillStyle = COLOR_TEXT_MUTED;
  ctx.font = "500 18px system-ui, -apple-system, sans-serif";
  ctx.fillText(truncate(ctx, shareUrl, WIDTH - MARGIN * 2), MARGIN, y);
}

export function scorecardFilename(result: SimulationResultPublic): string {
  return `peak3-82-0-run-${result.wins}-${result.losses}.png`;
}

/** Draws the scorecard and triggers a real browser file download. Returns
 * true if a download was actually triggered (canvas export succeeded),
 * false if this browser/environment can't produce a blob -- callers should
 * not claim success without checking this. */
export async function downloadScorecardPng(
  state: CourtLineupPublicState,
  result: SimulationResultPublic,
  shareUrl: string,
): Promise<boolean> {
  const canvas = document.createElement("canvas");
  drawScorecard(canvas, state, result, shareUrl);

  const blob: Blob | null = await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/png");
  });
  if (!blob) return false;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = scorecardFilename(result);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}
