/**
 * A1 — the Daily Grid's visual share image.
 *
 * Two layers under test, separately:
 *
 *   1. `drawDailyShareCard` / `dailyShareFile` — the pure canvas layer, run
 *      against a recording 2D-context stub (jsdom has no real canvas), so
 *      every assertion is about what the card actually DRAWS: the date, the
 *      theme, the score, the grade grid — and what it never draws: an email,
 *      an auth id, a token, a handle.
 *
 *   2. The CompletionPanel actions — Share image (primary), Download image,
 *      and the tertiary Copy text — including the `navigator.canShare` gate,
 *      the AbortError-is-not-a-failure rule, and the fall-through to a
 *      download when native sharing is absent or broken.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

// CompletionPanel mounts DailyLeaderboard (A2), whose read is secondary by
// design: a rejected fetch renders nothing, keeping these share tests about
// sharing. The API module is mocked so no test here ever needs a server.
const mockFetchLeaderboard = vi.fn().mockRejectedValue(new Error("not stubbed"));
vi.mock("@/lib/daily-grid-api", () => ({
  fetchDailyLeaderboard: (...a: unknown[]) => mockFetchLeaderboard(...a),
}));
vi.mock("@/lib/auth", () => ({ getAccessToken: async () => null }));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: null, supabaseEnabled: false }),
}));

import {
  DAILY_SHARE_CARD_SIZE,
  dailyShareFile,
  dailyShareFileName,
  drawDailyShareCard,
} from "@/lib/daily-grid-share-card";
import { resultGrade } from "@/lib/daily-grid-state";
import CompletionPanel from "@/components/daily-grid/CompletionPanel";
import { BOARD, completedProgress, gridResult } from "./daily-grid-fixtures";

/** A recording stand-in for the 2D context: jsdom implements no canvas, so
 *  the draw call path runs against this and the tests assert on what was
 *  drawn. Plain mutable properties (not setters) so `ctx.fillStyle = ...`
 *  records the style each shape was filled with. */
function recordingContext() {
  const texts: string[] = [];
  const shapes: Array<{ op: string; style: string }> = [];
  const ctx: Record<string, unknown> = {
    fillStyle: "",
    strokeStyle: "",
    font: "",
    lineWidth: 0,
    textAlign: "left",
    fillRect: vi.fn(function (this: void) {
      shapes.push({ op: "fillRect", style: String(ctx.fillStyle) });
    }),
    fillText: vi.fn((text: string) => {
      texts.push(String(text));
    }),
    measureText: vi.fn(() => ({ width: 100 })),
    beginPath: vi.fn(),
    arc: vi.fn(),
    stroke: vi.fn(),
    roundRect: vi.fn(() => {
      shapes.push({ op: "roundRect", style: String(ctx.fillStyle) });
    }),
    fill: vi.fn(),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts, shapes };
}

function stubCanvasContext() {
  const recorder = recordingContext();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    recorder.ctx as unknown as ReturnType<HTMLCanvasElement["getContext"]>,
  );
  return recorder;
}

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  // `restoreAllMocks` above wipes implementations, including the module-level
  // leaderboard reject — re-armed here so DailyLeaderboard stays quiet.
  mockFetchLeaderboard.mockRejectedValue(new Error("not stubbed"));
});

describe("drawDailyShareCard — what the image says", () => {
  it("draws the branding, date, theme, score and grade headline from the result", () => {
    const { texts } = stubCanvasContext();
    const canvas = document.createElement("canvas");
    const result = gridResult();
    drawDailyShareCard(canvas, { board: BOARD, progress: completedProgress(), result });

    expect(canvas.width).toBe(DAILY_SHARE_CARD_SIZE);
    expect(canvas.height).toBe(DAILY_SHARE_CARD_SIZE);
    const drawn = texts.join("\n");
    expect(drawn).toContain("PEAK3");
    expect(drawn).toContain("DAILY GRID");
    expect(drawn).toContain("2026-07-30");
    expect(drawn).toContain("Two-Way Night");
    // The score is the result's own total — printed, never recomputed.
    expect(texts).toContain(String(result.user_total));
    expect(drawn).toContain(`/ ${result.optimal_total} today's max`);
    expect(drawn).toContain(
      `${result.percent_of_best}% — ${resultGrade(result.percent_of_best).headline}`,
    );
  });

  it("says 'best known', not 'today's max', when the optimum was not proven exact", () => {
    const { texts } = stubCanvasContext();
    const result = gridResult({ exact_optimal: false });
    drawDailyShareCard(document.createElement("canvas"), {
      board: BOARD,
      progress: completedProgress(),
      result,
    });
    const drawn = texts.join("\n");
    expect(drawn).toContain("best known");
    expect(drawn).not.toContain("today's max");
  });

  it("draws nine grade squares plus a legend when the result is in", () => {
    const { texts, shapes } = stubCanvasContext();
    drawDailyShareCard(document.createElement("canvas"), {
      board: BOARD,
      progress: completedProgress(),
      result: gridResult(),
    });
    const squares = shapes.filter((s) => s.op === "roundRect");
    expect(squares).toHaveLength(9);
    // The fixture matches the optimum on 8 squares (green) and misses one.
    expect(squares.filter((s) => s.style === "#34d399")).toHaveLength(8);
    expect(texts.join("\n")).toMatch(/gold beat .* green matched .* blue close/);
  });

  it("falls back to an honest solved-count block — no invented grades — when there is no result", () => {
    const { texts, shapes } = stubCanvasContext();
    drawDailyShareCard(document.createElement("canvas"), {
      board: BOARD,
      progress: completedProgress(),
      result: null,
    });
    // One surface block, not nine fabricated grade squares.
    expect(shapes.filter((s) => s.op === "roundRect")).toHaveLength(1);
    expect(texts.join("\n")).toContain("9/9 solved");
    expect(texts.join("\n")).not.toMatch(/% —/);
  });

  it("includes the streak only when it is worth claiming (>= 2 days)", () => {
    const first = stubCanvasContext();
    drawDailyShareCard(document.createElement("canvas"), {
      board: BOARD,
      progress: completedProgress(),
      result: gridResult(),
      currentStreak: 5,
    });
    expect(first.texts.join("\n")).toContain("Streak 5 days");
    vi.restoreAllMocks();

    const second = stubCanvasContext();
    drawDailyShareCard(document.createElement("canvas"), {
      board: BOARD,
      progress: completedProgress(),
      result: gridResult(),
      currentStreak: 1,
    });
    expect(second.texts.join("\n")).not.toContain("Streak");
  });

  it("never draws private identity — no email, auth id, token or handle", () => {
    const { texts } = stubCanvasContext();
    drawDailyShareCard(document.createElement("canvas"), {
      board: BOARD,
      progress: completedProgress(),
      result: gridResult(),
      currentStreak: 4,
    });
    const drawn = texts.join("\n");
    // An email shape, a bearer token, a UUID, or any auth-ish field name.
    expect(drawn).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(drawn).not.toMatch(/bearer|token|auth|sub[:=]|uuid/i);
    expect(drawn).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("captures locally: no image draw, no network — safe with external assets disabled", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { ctx } = stubCanvasContext();
    // The stub context implements no drawImage at all; a card that tried to
    // paint a headshot or remote asset would throw right here.
    expect(() =>
      drawDailyShareCard(document.createElement("canvas"), {
        board: BOARD,
        progress: completedProgress(),
        result: gridResult(),
      }),
    ).not.toThrow();
    expect("drawImage" in (ctx as unknown as Record<string, unknown>)).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("dailyShareFile — the PNG artifact", () => {
  it("names the file after the board date", () => {
    expect(dailyShareFileName(BOARD)).toBe("peak3-daily-grid-2026-07-30.png");
  });

  it("produces a PNG File from the drawn canvas", async () => {
    stubCanvasContext();
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
      cb: BlobCallback,
    ) {
      cb(new Blob(["png-bytes"], { type: "image/png" }));
    });
    const file = await dailyShareFile(document.createElement("canvas"), {
      board: BOARD,
      progress: completedProgress(),
      result: gridResult(),
    });
    expect(file).not.toBeNull();
    expect(file!.name).toBe("peak3-daily-grid-2026-07-30.png");
    expect(file!.type).toBe("image/png");
  });

  it("returns null when the canvas cannot encode, instead of a broken file", async () => {
    stubCanvasContext();
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (cb: BlobCallback) => cb(null),
    );
    const file = await dailyShareFile(document.createElement("canvas"), {
      board: BOARD,
      progress: completedProgress(),
      result: gridResult(),
    });
    expect(file).toBeNull();
  });
});

describe("CompletionPanel — share actions", () => {
  /** navigator.share / navigator.canShare, installed per-test and removed
   *  after — jsdom's navigator has neither. */
  function installWebShare(
    share: ((data: { files: File[] }) => Promise<void>) | undefined,
    canShare: boolean,
  ) {
    Object.defineProperty(navigator, "share", {
      value: share,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, "canShare", {
      value: share ? () => canShare : undefined,
      configurable: true,
      writable: true,
    });
  }

  let anchorClicks: number;

  beforeEach(() => {
    vi.clearAllMocks();
    anchorClicks = 0;
    stubCanvasContext();
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (cb: BlobCallback) => cb(new Blob(["png-bytes"], { type: "image/png" })),
    );
    // jsdom implements neither object URLs nor `<a>` navigation.
    URL.createObjectURL = vi.fn(() => "blob:stub");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      anchorClicks += 1;
      expect(this.download).toBe("peak3-daily-grid-2026-07-30.png");
    });
  });

  afterEach(() => {
    installWebShare(undefined, false);
  });

  function renderPanel() {
    return render(
      <CompletionPanel
        board={BOARD}
        progress={completedProgress()}
        result={gridResult()}
        archive={null}
      />,
    );
  }

  it("leads with the image actions; text copy is tertiary and still works", async () => {
    installWebShare(undefined, false);
    renderPanel();
    const shareImage = screen.getByTestId("daily-grid-share-image");
    const download = screen.getByTestId("daily-grid-download-image");
    const copyText = screen.getByTestId("daily-grid-share");
    expect(shareImage).toHaveTextContent(/share image/i);
    expect(download).toHaveTextContent(/download image/i);
    expect(copyText).toHaveTextContent(/copy text/i);
    // DOM order IS the priority order: image actions first.
    expect(
      shareImage.compareDocumentPosition(copyText) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Let the (deliberately failing) leaderboard read settle inside the test.
    await waitFor(() =>
      expect(screen.queryByTestId("daily-leaderboard")).not.toBeInTheDocument(),
    );
  });

  it("shares the PNG through navigator.share when canShare accepts the file", async () => {
    const share = vi.fn<(data: { files: File[] }) => Promise<void>>(async () => {});
    installWebShare(share, true);
    renderPanel();
    await userEvent.click(screen.getByTestId("daily-grid-share-image"));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const files = share.mock.calls[0][0].files;
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("peak3-daily-grid-2026-07-30.png");
    expect(files[0].type).toBe("image/png");
    expect(screen.getByTestId("daily-grid-share-outcome")).toHaveTextContent(/shared/i);
    expect(anchorClicks).toBe(0);
  });

  it("falls back to downloading the same image when canShare rejects the file", async () => {
    const share = vi.fn(async () => {});
    installWebShare(share, false);
    renderPanel();
    await userEvent.click(screen.getByTestId("daily-grid-share-image"));
    await waitFor(() => expect(anchorClicks).toBe(1));
    expect(share).not.toHaveBeenCalled();
    expect(screen.getByTestId("daily-grid-share-outcome")).toHaveTextContent(/image saved/i);
  });

  it("treats a cancelled share sheet as a non-event: no download, no failure message", async () => {
    const abort = new DOMException("cancelled", "AbortError");
    installWebShare(
      vi.fn(async () => {
        throw abort;
      }),
      true,
    );
    renderPanel();
    await userEvent.click(screen.getByTestId("daily-grid-share-image"));
    await waitFor(() =>
      expect(screen.getByTestId("daily-grid-share-image")).not.toBeDisabled(),
    );
    expect(anchorClicks).toBe(0);
    expect(screen.queryByTestId("daily-grid-share-outcome")).not.toBeInTheDocument();
  });

  it("falls through to a download when native sharing genuinely fails", async () => {
    installWebShare(
      vi.fn(async () => {
        throw new Error("share broke");
      }),
      true,
    );
    renderPanel();
    await userEvent.click(screen.getByTestId("daily-grid-share-image"));
    await waitFor(() => expect(anchorClicks).toBe(1));
    expect(screen.getByTestId("daily-grid-share-outcome")).toHaveTextContent(/image saved/i);
  });

  it("Download image always downloads, even where Web Share exists", async () => {
    const share = vi.fn(async () => {});
    installWebShare(share, true);
    renderPanel();
    await userEvent.click(screen.getByTestId("daily-grid-download-image"));
    await waitFor(() => expect(anchorClicks).toBe(1));
    expect(share).not.toHaveBeenCalled();
    expect(screen.getByTestId("daily-grid-share-outcome")).toHaveTextContent(/image saved/i);
  });

  it("reports an honest failure when the image cannot be generated at all", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (cb: BlobCallback) => cb(null),
    );
    installWebShare(undefined, false);
    renderPanel();
    await userEvent.click(screen.getByTestId("daily-grid-share-image"));
    await waitFor(() =>
      expect(screen.getByTestId("daily-grid-share-outcome")).toHaveTextContent(/could not/i),
    );
    expect(anchorClicks).toBe(0);
  });
});
