/**
 * The Daily Grid's visual share card — a real rendered image, generated as
 * the PRIMARY sharing artifact (final polish pass, A1). The clipboard text
 * survives as a tertiary fallback; it is no longer the thing "Share" means.
 *
 * THE SAME ARCHITECTURE AS RUN THE TABLE'S CARD (`run-the-table-share-card.ts`),
 * on purpose: pure Canvas 2D drawing over fields already on screen — never a
 * serialization of application DOM, never a screenshot of the viewport, and
 * "print, never invent": every string and number drawn here is read off the
 * same board/progress/result/archive objects the completion panel itself
 * renders. No score is computed in this file.
 *
 * DETERMINISTIC AND LOCAL BY CONSTRUCTION. System fonts, solid fills and the
 * result's own grade colours — no remote font, no headshot, no network fetch
 * at capture time, so generation cannot be broken by the external-asset gate
 * being off and the canvas can never be CORS-tainted.
 *
 * PRIVACY: the card carries the DATE, THEME, SCORE, GRADE, GRID and STREAK —
 * facts about the board and the run. It has no name field at all, so no
 * email, auth id, token or handle can leak into a shared image.
 *
 * 1200×1200 — the square social-card target the brief names, drawn at full
 * resolution directly (the canvas backing store IS 1200px; no DPR scaling
 * needed because nothing here is rendered from layout).
 */
import {
  DailyGridBoard,
  DailyGridProgress,
  GridResultResponse,
} from "@/types/daily-grid";
import {
  CellGrade,
  TOTAL_CELLS,
  cellGrade,
  elapsedMs,
  formatElapsed,
  resultGrade,
  totalArenaPoints,
} from "@/lib/daily-grid-state";

export const DAILY_SHARE_CARD_SIZE = 1200;

/** Arena Night, always — a shared image travels outside whatever theme the
 *  sharer's browser is in, so the card is deliberately not theme-aware. The
 *  grade colours mirror `CompletionPanel.GRADE_COLOR`'s dark-theme values. */
const BG = "#0a0b0d";
const SURFACE = "#15171c";
const ACCENT = "#f5c842";
const PRIMARY = "#f0f0f0";
const SECONDARY = "#a8abbd";
const MUTED = "#8c8fa8";

const GRADE_FILL: Record<CellGrade, string> = {
  beat: "#f5c842",
  best: "#34d399",
  close: "#60a5fa",
  fair: "#fb923c",
  weak: "#3a3d47",
};

export interface DailyShareCardInput {
  board: DailyGridBoard;
  progress: DailyGridProgress;
  result?: GridResultResponse | null;
  /** Local streak; drawn only at >= 2, the same rule the share text follows —
   *  a "1 day streak" is just "I played". */
  currentStreak?: number | null;
}

/** File name for the downloaded PNG, e.g. `peak3-daily-grid-2026-08-11.png`. */
export function dailyShareFileName(board: DailyGridBoard): string {
  return `peak3-daily-grid-${board.date}.png`;
}

/**
 * Draw the card onto `canvas` and return it, for chaining into
 * `toBlob()`/`toDataURL()`. Exported separately from the button handlers so
 * it unit-tests against a real jsdom `<canvas>` with no DOM download or Web
 * Share machinery involved.
 */
export function drawDailyShareCard(
  canvas: HTMLCanvasElement,
  input: DailyShareCardInput,
): HTMLCanvasElement {
  const { board, progress, result } = input;
  const S = DAILY_SHARE_CARD_SIZE;
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  // ---- ground -------------------------------------------------------------
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, S, S);
  // Court-line geometry, the arena's signature: a faint centre-circle arc.
  ctx.strokeStyle = "rgba(245, 200, 66, 0.08)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(S / 2, S + 260, 640, Math.PI, 2 * Math.PI);
  ctx.stroke();
  // Gold crown hairline along the top.
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, 0, S, 8);

  // ---- masthead -----------------------------------------------------------
  ctx.fillStyle = ACCENT;
  ctx.font = "bold 44px system-ui, sans-serif";
  ctx.fillText("PEAK3", 80, 128);
  const peakWidth = ctx.measureText("PEAK3").width;
  ctx.fillStyle = MUTED;
  ctx.font = "600 34px system-ui, sans-serif";
  ctx.fillText("DAILY GRID", 80 + peakWidth + 24, 128);

  ctx.fillStyle = SECONDARY;
  ctx.font = "32px system-ui, sans-serif";
  ctx.fillText(board.date + (board.theme ? `  ·  ${board.theme}` : ""), 80, 186);

  // ---- the number ---------------------------------------------------------
  const total = result ? result.user_total : totalArenaPoints(progress);
  ctx.fillStyle = PRIMARY;
  ctx.font = "bold 150px system-ui, sans-serif";
  ctx.fillText(String(total), 80, 370);
  const totalWidth = ctx.measureText(String(total)).width;
  if (result) {
    ctx.fillStyle = MUTED;
    ctx.font = "600 44px system-ui, sans-serif";
    ctx.fillText(
      `/ ${result.optimal_total} ${result.exact_optimal ? "today's max" : "best known"}`,
      80 + totalWidth + 28,
      370,
    );
    const grade = resultGrade(result.percent_of_best);
    ctx.fillStyle = ACCENT;
    ctx.font = "bold 52px system-ui, sans-serif";
    ctx.fillText(`${result.percent_of_best}% — ${grade.headline}`, 80, 452);
  } else {
    ctx.fillStyle = MUTED;
    ctx.font = "600 44px system-ui, sans-serif";
    ctx.fillText("arena points", 80 + totalWidth + 28, 370);
  }

  // ---- the grid, as the share's centrepiece -------------------------------
  // 3×3 grade squares in board order, same sort the recap grid applies
  // (result.cells arrive in FILL order, not board order).
  const cells = result
    ? [...result.cells].sort((a, b) => a.row - b.row || a.col - b.col)
    : [];
  const gridTop = 520;
  const cellSize = 150;
  const gap = 14;
  const gridLeft = (S - (3 * cellSize + 2 * gap)) / 2;
  if (cells.length === TOTAL_CELLS) {
    for (let index = 0; index < cells.length; index += 1) {
      const grade = cellGrade(cells[index]);
      const x = gridLeft + (index % 3) * (cellSize + gap);
      const y = gridTop + Math.floor(index / 3) * (cellSize + gap);
      ctx.fillStyle = GRADE_FILL[grade];
      ctx.beginPath();
      ctx.roundRect(x, y, cellSize, cellSize, 18);
      ctx.fill();
    }
    // The legend, so the image explains itself off-platform.
    ctx.fillStyle = MUTED;
    ctx.font = "28px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("gold beat · green matched · blue close · orange fair", S / 2, gridTop + 3 * cellSize + 2 * gap + 56);
    ctx.textAlign = "left";
  } else {
    // No released result (offline finish): an honest solved-count block
    // rather than a fabricated grade grid.
    ctx.fillStyle = SURFACE;
    ctx.beginPath();
    ctx.roundRect(gridLeft, gridTop, 3 * cellSize + 2 * gap, 3 * cellSize + 2 * gap, 18);
    ctx.fill();
    ctx.fillStyle = PRIMARY;
    ctx.font = "bold 64px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      `${progress.filled.length}/${TOTAL_CELLS} solved`,
      S / 2,
      gridTop + (3 * cellSize + 2 * gap) / 2 + 20,
    );
    ctx.textAlign = "left";
  }

  // ---- footer stats -------------------------------------------------------
  const statsY = 1108;
  const stats: string[] = [];
  const elapsed = elapsedMs(progress);
  if (elapsed !== null) stats.push(`Time ${formatElapsed(elapsed)}`);
  stats.push(`Misses ${progress.incorrect_attempts}`);
  if ((input.currentStreak ?? 0) >= 2) stats.push(`Streak ${input.currentStreak} days`);
  ctx.fillStyle = SECONDARY;
  ctx.font = "600 36px system-ui, sans-serif";
  ctx.fillText(stats.join("   ·   "), 80, statsY);

  ctx.fillStyle = MUTED;
  ctx.font = "32px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("peak3.app/daily", S - 80, statsY);
  ctx.textAlign = "left";

  return canvas;
}

/** The generated PNG as a File, for `navigator.share({ files })` and for the
 *  download path alike. Null when the canvas cannot produce a blob. */
export async function dailyShareFile(
  canvas: HTMLCanvasElement,
  input: DailyShareCardInput,
): Promise<File | null> {
  drawDailyShareCard(canvas, input);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) return null;
  return new File([blob], dailyShareFileName(input.board), { type: "image/png" });
}
