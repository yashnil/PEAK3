/**
 * The RUN THE TABLE result screen's visual share card — a real rendered
 * image, not a re-label of the clipboard-text "Copy summary" action
 * (PRODUCT_EXPERIENCE_CONTRACT.md §6 item 11 / VERIFICATION_PLAN.md §2
 * item 14: "an image/canvas element or exported asset is produced...
 * distinct from the existing clipboard-text action, which must also still
 * work").
 *
 * Pure Canvas 2D drawing over fields already on `RunReceipt` — the same
 * "print, never invent" rule as the rest of this screen. No new server
 * field, no score computed here: every string/number drawn is read
 * straight off the receipt `buildRunShareText` already reads.
 */
import { RunReceipt } from "@/types/run-the-table";
import { runVerdict } from "./run-the-table-state";

export const SHARE_CARD_WIDTH = 1200;
export const SHARE_CARD_HEIGHT = 630;

/** Draws the share card onto `canvas` and returns it, for chaining into a
 *  `toDataURL()`/`toBlob()` call. Exported separately from the button
 *  handler so it can be unit-tested against a real `<canvas>` in jsdom
 *  without touching the DOM download machinery. */
export function drawShareCard(
  canvas: HTMLCanvasElement,
  receipt: RunReceipt,
  actsTotal?: number | null,
): HTMLCanvasElement {
  canvas.width = SHARE_CARD_WIDTH;
  canvas.height = SHARE_CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  // Arena Night, always — a shared image travels outside whatever theme the
  // sharer's own browser is in, so it is not theme-aware by design.
  const bg = "#0a0b0d";
  const accent = "#f5c842";
  const primary = "#f0f0f0";
  const muted = "#8c8fa8";
  const correct = "#22c55e";
  const incorrect = "#ef4444";

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);

  ctx.fillStyle = accent;
  ctx.font = "bold 28px sans-serif";
  ctx.fillText("PEAK3 — RUN THE TABLE", 64, 90);

  const verdict = runVerdict(receipt, actsTotal);
  const outcomeColor =
    receipt.ran_the_table || receipt.table_cleared ? correct : verdict.includes("FINAL BOSS") ? accent : incorrect;
  ctx.fillStyle = outcomeColor;
  ctx.font = "bold 64px sans-serif";
  ctx.fillText(verdict, 64, 200);

  ctx.fillStyle = primary;
  ctx.font = "32px sans-serif";
  wrapText(ctx, receipt.headline, 64, 260, SHARE_CARD_WIDTH - 128, 40);

  ctx.fillStyle = muted;
  ctx.font = "26px sans-serif";
  ctx.fillText(
    `Record ${receipt.record} · ${receipt.lives_remaining} lives left · roster total ${receipt.roster_total.toFixed(1)}`,
    64,
    360,
  );

  if (receipt.run_mvp) {
    ctx.fillStyle = accent;
    ctx.font = "bold 26px sans-serif";
    ctx.fillText("Run MVP", 64, 430);
    ctx.fillStyle = primary;
    ctx.font = "26px sans-serif";
    ctx.fillText(
      `${receipt.run_mvp.player_name} · ${receipt.run_mvp.anchor_season}`,
      64,
      466,
    );
  }

  ctx.fillStyle = muted;
  ctx.font = "22px sans-serif";
  ctx.fillText(`Seed ${receipt.seed} · peak3.app/arena/run-the-table`, 64, SHARE_CARD_HEIGHT - 48);

  return canvas;
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): void {
  const words = text.split(" ");
  let line = "";
  let lineY = y;
  let lines = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, lineY);
      line = word;
      lineY += lineHeight;
      lines += 1;
      if (lines >= 2) return; // two lines is enough for a share card
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, lineY);
}
