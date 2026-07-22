"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import type { DraftMode } from "@/types/draft";
import { analytics } from "@/lib/analytics";

interface Props {
  challengeUrl: string;
  mode: DraftMode;
  lineupPeakRating: number;
  onClose: () => void;
}

export default function ShareChallenge({
  challengeUrl,
  mode,
  lineupPeakRating,
  onClose,
}: Props) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const triggerRef = useRef<Element | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Save trigger element; focus first focusable element on mount; restore focus on unmount
  useEffect(() => {
    triggerRef.current = document.activeElement;
    closeButtonRef.current?.focus();
    return () => {
      const trigger = triggerRef.current;
      if (trigger instanceof HTMLElement) {
        trigger.focus();
      }
    };
  }, []);

  // ESC closes the modal
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(challengeUrl);
      setCopyState("copied");
      analytics.track({ type: "challenge_shared", mode });
      setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("error");
    }
  }, [challengeUrl, mode]);

  const handleShare = useCallback(async () => {
    if (typeof navigator.share !== "function") return;
    try {
      await navigator.share({
        title: "PEAK3 Challenge",
        text: "Can you beat my lineup?",
        url: challengeUrl,
      });
    } catch {
      // User cancelled or share failed — silently ignore
    }
  }, [challengeUrl]);

  const hasNativeShare =
    typeof window !== "undefined" && typeof navigator.share === "function";

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: "rgba(0,0,0,0.72)" }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Share challenge"
      >
        <div
          className="w-full max-w-sm rounded-2xl p-6 flex flex-col gap-4"
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-default)",
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between">
            <h2
              className="text-base font-bold"
              style={{ color: "var(--text-primary)" }}
            >
              Challenge a friend
            </h2>
            <button
              ref={closeButtonRef}
              onClick={onClose}
              aria-label="Close share modal"
              className="w-8 h-8 flex items-center justify-center rounded-lg text-lg leading-none transition-colors hover:opacity-70"
              style={{
                color: "var(--text-muted)",
                background: "var(--bg-surface)",
              }}
            >
              ×
            </button>
          </div>

          {/* Rating context */}
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Your lineup peak rating:{" "}
            <span
              className="font-bold tabular-nums"
              style={{ color: "var(--peak-accent)" }}
            >
              {(Math.round(lineupPeakRating * 10) / 10).toFixed(1)}
            </span>
          </p>

          {/* URL display */}
          <input
            type="text"
            readOnly
            value={challengeUrl}
            aria-label="Challenge link"
            className="w-full rounded-lg px-3 py-2.5 text-xs font-mono select-all outline-none"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-default)",
              color: "var(--text-secondary)",
            }}
            onFocus={(e) => e.target.select()}
          />

          {/* Actions */}
          <div className="flex flex-col gap-2">
            <button
              onClick={handleCopy}
              className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-90 active:scale-[.98]"
              style={
                copyState === "error"
                  ? {
                      background: "rgba(239,68,68,0.12)",
                      color: "#ef4444",
                      border: "1px solid rgba(239,68,68,0.35)",
                    }
                  : {
                      background: "var(--peak-accent)",
                      color: "var(--text-inverse)",
                    }
              }
            >
              {copyState === "copied"
                ? "Copied!"
                : copyState === "error"
                ? "Copy failed — use the link above"
                : "Copy Link"}
            </button>

            {hasNativeShare && (
              <button
                onClick={handleShare}
                className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-80"
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-default)",
                  color: "var(--text-primary)",
                }}
              >
                Share
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
