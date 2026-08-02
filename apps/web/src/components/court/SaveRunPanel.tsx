"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { getAccessToken } from "@/lib/auth";
import { getMyPersonalBests, saveRun, PerfectSeasonAPIError } from "@/lib/perfect-season-api";
import { PersonalBests, RunComparison, SaveRunResponse } from "@/types/perfect-season";

interface Props {
  gameId: string;
  wins: number;
  /** Server-computed. A provisional run is still savable -- only the
   * leaderboard requires a fully-scored roster. */
  savable: boolean;
  /** Phase 9A: hidden entirely on someone else's shared result -- saving is
   * an owner action (the backend 403s "not_your_game" for anyone else). */
  readOnly?: boolean;
}

type Phase = "idle" | "saving" | "saved" | "error";

/** Copy for each comparison outcome. "Tied" is deliberately its own,
 * positive-toned case -- matching your own best is worth acknowledging, and
 * calling it "below your best" would simply read as wrong. */
const COMPARISON_COPY: Record<RunComparison, { label: string; tone: "gold" | "green" | "muted" }> = {
  first_run: { label: "First saved run — this is your benchmark", tone: "gold" },
  new_personal_best: { label: "New personal best!", tone: "gold" },
  tied_personal_best: { label: "Tied your personal best", tone: "green" },
  below_personal_best: { label: "Below your personal best", tone: "muted" },
};

const TONE_COLORS: Record<"gold" | "green" | "muted", string> = {
  gold: "var(--peak-accent, #f5c842)",
  green: "#34d399",
  muted: "var(--text-secondary)",
};

/**
 * Phase 9A: "Save this run" + personal-best comparison on the result screen.
 *
 * Three states, by design:
 *   - Anonymous: a sign-in CTA that names the benefit ("save runs and track
 *     personal bests"), never a broken/disabled control and never an error.
 *     Play itself is fully anonymous-friendly; only durable history needs an
 *     account.
 *   - Signed in, not yet saved: a save button, plus the user's existing bests
 *     for context so "can I beat it?" is answerable before saving.
 *   - Saved: the comparison verdict + the updated bests.
 *
 * Never computes a comparison client-side -- `comparison` and
 * `personal_bests` both come from the server (see
 * app/repositories/saved_run_ranking.py for the tiebreaker rules), so the
 * UI can't drift from the stored definition of "your best".
 */
export default function SaveRunPanel({ gameId, wins, savable, readOnly = false }: Props) {
  const { user } = useAuth();
  // Carry the current page as ?returnTo= so signing in from a result screen
  // comes back here instead of dropping the player on the homepage. The
  // sign-in page re-validates it with safeNext(), so an attacker-supplied
  // value cannot turn this into an open redirect.
  const pathname = usePathname();
  const signInHref = `/signin?returnTo=${encodeURIComponent(pathname || "/")}`;
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<SaveRunResponse | null>(null);
  const [existingBests, setExistingBests] = useState<PersonalBests | null>(null);

  // Whether this panel renders at all -- computed before the effect so a
  // hidden panel (read-only shared result, or a run with nothing savable)
  // never issues a pointless personal-bests fetch.
  const hidden = readOnly || !savable;

  // Load existing bests once for a signed-in user, so the panel can show
  // "your best: 61-21" as context before they save.
  useEffect(() => {
    if (hidden || !user) {
      setExistingBests(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const bests = await getMyPersonalBests(token);
        if (!cancelled) setExistingBests(bests);
      } catch {
        // Context only -- a failure here must never block saving.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, hidden]);

  async function handleSave() {
    setPhase("saving");
    setErrorMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setPhase("error");
        setErrorMessage("Sign in to save your run.");
        return;
      }
      const saved = await saveRun(gameId, token);
      setResult(saved);
      setPhase("saved");
    } catch (e) {
      setPhase("error");
      setErrorMessage(
        e instanceof PerfectSeasonAPIError ? e.message : "Could not save this run — please try again.",
      );
    }
  }

  if (hidden) return null;

  const bests = result?.personal_bests ?? existingBests;
  const previousBestRun = existingBests?.best_run ?? null;

  return (
    <div
      data-testid="save-run-panel"
      className="rounded-xl p-3 flex flex-col gap-2 text-sm"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border-default)" }}
    >
      {!user ? (
        <div className="flex items-center justify-between gap-3" data-testid="save-run-signin-cta">
          <span style={{ color: "var(--text-secondary)" }}>
            Sign in to save this run, track personal bests, and see your history.
          </span>
          <Link
            href={signInHref}
            className="text-xs font-semibold uppercase tracking-wide rounded px-3 py-1.5 shrink-0"
            style={{ background: "var(--peak-accent, #f5c842)", color: "#000" }}
          >
            Sign in
          </Link>
        </div>
      ) : phase === "saved" && result ? (
        <div className="flex flex-col gap-1.5" data-testid="save-run-confirmation">
          <div className="flex items-center justify-between gap-3">
            <span
              className="font-semibold"
              style={{ color: TONE_COLORS[COMPARISON_COPY[result.comparison].tone] }}
              data-testid="personal-best-comparison"
            >
              {COMPARISON_COPY[result.comparison].label}
            </span>
            <Link
              href="/arena/court/history"
              className="text-xs font-semibold uppercase tracking-wide shrink-0"
              style={{ color: "var(--peak-accent, #f5c842)" }}
            >
              View history →
            </Link>
          </div>
          <span className="text-xs" style={{ color: "var(--text-muted)" }} data-testid="save-run-saved-status">
            {result.already_saved ? "Already in your history" : "Saved to your history"}
            {bests ? ` · ${bests.total_runs} run${bests.total_runs === 1 ? "" : "s"} saved` : ""}
            {bests?.best_wins != null ? ` · best ${bests.best_wins}-${82 - bests.best_wins}` : ""}
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <span style={{ color: "var(--text-secondary)" }}>
              {previousBestRun
                ? `Your best so far: ${previousBestRun.wins}-${previousBestRun.losses}. This run: ${wins}-${82 - wins}.`
                : "Save this run to start tracking your personal bests."}
            </span>
            <button
              data-testid="save-run-btn"
              onClick={handleSave}
              disabled={phase === "saving"}
              className="text-xs font-semibold uppercase tracking-wide rounded px-3 py-1.5 shrink-0 disabled:opacity-50"
              style={{ background: "var(--peak-accent, #f5c842)", color: "#000" }}
            >
              {phase === "saving" ? "Saving…" : "Save run"}
            </button>
          </div>
          {phase === "error" && errorMessage && (
            <span role="alert" className="text-xs" style={{ color: "#ef4444" }} data-testid="save-run-error">
              {errorMessage}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
