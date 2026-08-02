"use client";
import { useState } from "react";
import { Copy, Check, Share2, Link as LinkIcon, Download } from "lucide-react";
import { SharedCourtResult, SimulationResultPublic } from "@/types/perfect-season";
import { resultTier } from "./SeasonResultStub";
import { downloadScorecardPng } from "@/lib/scorecard-export";

interface Props {
  state: SharedCourtResult;
  result: SimulationResultPublic;
}

function buildShareText(state: SharedCourtResult, result: SimulationResultPublic, url: string): string {
  const tier = resultTier(result.wins);
  const lines = [
    `PEAK3 Arena — 82-0 Peak Season`,
    `${result.wins}-${result.losses} · ${tier}`,
  ];
  if (result.lineup_score_status === "complete") {
    lines.push(`Lineup Score: ${result.lineup_peak_score.toFixed(1)}/100`);
  }
  if (result.best_pick) {
    lines.push(`Best pick: ${result.best_pick}`);
  }
  if (result.peak_picks_recap && result.peak_picks_recap.length > 0) {
    const matched = result.peak_picks_recap.filter((r) => r.matched).length;
    lines.push(`Matched PEAK3's own pick ${matched}/${result.peak_picks_recap.length} rounds`);
  }
  lines.push(url);
  return lines.join("\n");
}

/**
 * Phase 8H: the endgame share/replay payoff -- "copy a text summary" and
 * "shareable URL" from the product ask, both implemented with real,
 * already-existing infrastructure (no new backend surface): the share URL
 * is the same GET /perfect-season/games/{id} record CourtBuilder already
 * persists (see apps/web/src/app/(main)/arena/court/results/[id]/page.tsx),
 * and the copy/share actions use the standard Clipboard/Web Share browser
 * APIs -- zero new dependencies. Deliberately does NOT attempt image
 * export (canvas/html-to-image rendering) -- that would need a new
 * dependency or a real server-side rendering path neither of which exists
 * today, and the task explicitly said not to overpromise infrastructure
 * that isn't there.
 */
export default function ShareRunPanel({ state, result }: Props) {
  const [copied, setCopied] = useState<"text" | "link" | null>(null);
  const [shared, setShared] = useState(false);
  const [downloadState, setDownloadState] = useState<"idle" | "busy" | "done" | "failed">("idle");

  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/arena/court/results/${state.game_id}`
      : `/arena/court/results/${state.game_id}`;
  const shareText = buildShareText(state, result, shareUrl);

  async function handleCopyText() {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied("text");
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard permission denied or unavailable -- no crash, just no
      // confirmation shown.
    }
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied("link");
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // ignore
    }
  }

  async function handleShare() {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: "PEAK3 Arena — 82-0 Peak Season", text: shareText, url: shareUrl });
        setShared(true);
        window.setTimeout(() => setShared(false), 2000);
      } catch {
        // User cancelled the share sheet -- not an error.
      }
    } else {
      handleCopyText();
    }
  }

  async function handleDownload() {
    setDownloadState("busy");
    try {
      const ok = await downloadScorecardPng(state, result, shareUrl);
      setDownloadState(ok ? "done" : "failed");
    } catch {
      setDownloadState("failed");
    }
    window.setTimeout(() => setDownloadState("idle"), 2000);
  }

  return (
    <div
      data-testid="share-run-panel"
      className="rounded-xl p-3 flex flex-col gap-2.5 text-sm"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border-default)" }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
          Share this run
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="share-run-native-btn"
          onClick={handleShare}
          className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide rounded px-3 py-1.5"
          style={{ background: "var(--peak-accent, #f5c842)", color: "#000" }}
        >
          <Share2 size={13} aria-hidden="true" />
          {shared ? "Shared!" : "Share"}
        </button>
        <button
          type="button"
          data-testid="share-run-copy-text-btn"
          onClick={handleCopyText}
          className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide rounded px-3 py-1.5"
          style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border-default)" }}
        >
          {copied === "text" ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
          {copied === "text" ? "Copied!" : "Copy summary"}
        </button>
        <button
          type="button"
          data-testid="share-run-copy-link-btn"
          onClick={handleCopyLink}
          className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide rounded px-3 py-1.5"
          style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border-default)" }}
        >
          {copied === "link" ? <Check size={13} aria-hidden="true" /> : <LinkIcon size={13} aria-hidden="true" />}
          {copied === "link" ? "Copied!" : "Copy link"}
        </button>
        <button
          type="button"
          data-testid="share-run-download-btn"
          aria-label="Download scorecard image"
          onClick={handleDownload}
          disabled={downloadState === "busy"}
          className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide rounded px-3 py-1.5 disabled:opacity-60"
          style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border-default)" }}
        >
          {downloadState === "done" ? <Check size={13} aria-hidden="true" /> : <Download size={13} aria-hidden="true" />}
          {downloadState === "busy" && "Preparing…"}
          {downloadState === "done" && "Downloaded!"}
          {downloadState === "failed" && "Couldn't export"}
          {downloadState === "idle" && "Download Image"}
        </button>
      </div>
    </div>
  );
}
