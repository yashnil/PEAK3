"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { getAccessToken } from "@/lib/auth";
import { fetchProfile, updateProfile, ProfileAPIError, handleLooksValid } from "@/lib/profile-api";
import { useFooterVisible } from "@/lib/use-footer-visible";

const DISMISS_KEY = "peak3_handle_prompt_dismissed";

// A short, neutral word list for the SUGGESTED handle -- launch-polish
// IMPLEMENTATION_CONTRACT.md §8: "prefill only a NON-PUBLIC suggestion".
// Nothing here is derived from the account's name, email, or any other
// identifying value; it is pure client-side randomness, and it is never
// saved anywhere unless the player explicitly submits it (or edits it
// first). "Non-public" describes the SUGGESTION's provenance, not a
// property of the string once chosen -- once submitted it becomes exactly
// as public as any other handle.
const SUGGESTION_WORDS = [
  "court", "arena", "peak", "clutch", "baseline", "rebound", "pivot",
  "fastbreak", "buzzer", "hustle", "rookie", "veteran", "scout", "roster",
];

function randomSuggestion(): string {
  const word = SUGGESTION_WORDS[Math.floor(Math.random() * SUGGESTION_WORDS.length)];
  const suffix = Math.floor(100 + Math.random() * 900); // 3 digits, always non-empty
  return `${word}_${suffix}`;
}

type Phase = "checking" | "hidden" | "prompting" | "saving" | "saved";

/**
 * Handle-onboarding prompt (launch-polish IMPLEMENTATION_CONTRACT.md §8).
 *
 * Mount once near the app root (a shared-layout concern, so the actual
 * mount point is the lead's call per §11's file-ownership table -- this
 * component is fully self-contained and only needs one line to render).
 *
 * Shown whenever a signed-in account has no handle set yet -- covers both
 * "prompt after first successful sign-in" and "existing handle-less
 * accounts prompted on next sign-in" with the same check, since both
 * reduce to the same condition. Dismissing ("Skip for now") suppresses it
 * for the rest of this browser SESSION only (sessionStorage, not
 * localStorage) -- closed the tab and signed in again later is a new
 * session, which is exactly when the contract wants it to ask again.
 * Private gameplay is never blocked by this -- it is a dismissible prompt,
 * not a gate. The gate lives server-side, on the one place a handle is
 * actually required: submitting to the public leaderboard
 * (apps/api/app/api/v1/perfect_season.py::submit_run's `handle_required`
 * rejection).
 *
 * IT DOES NOT APPEAR OVER A LIVE ARENA MATCH, and that is not a style
 * preference. The Arena rescue's review capture caught it sitting on top of the
 * player's OWN roster during a three-seat draft, with a decision clock running:
 * the one panel a drafter has to read to make their pick, covered by a prompt
 * about a leaderboard they are not currently submitting to. Both modes also run
 * their own `aria-modal` overlays, so two competing dialogs could be open at
 * once.
 *
 * Pass 7 (human acceptance testing, task §15): the same failure mode recurred
 * on 82-0 (the roll/chooser/placement decision), Peak Duel (the timed
 * question), and Daily Grid (the board/chooser) — none of those were in the
 * original denylist, so the prompt could still land in the lower-right corner
 * over a court placement, a duel pick, or a grid cell. Extended below rather
 * than given a second mechanism.
 *
 * Suppressed rather than delayed: a match is minutes long, the prompt is
 * session-scoped, and it asks again on the next sign-in anyway. Nothing is lost
 * by waiting until the player is not on a clock.
 */

/**
 * IS A LIVE BOARD MOUNTED RIGHT NOW?
 *
 * The route denylist below is necessary but not sufficient, and the gap was
 * found by screenshotting a real Three-Man Weave draft: the prompt sat over
 * seat three's roster with a 43-second clock running, on `/arena/three-man-
 * weave` — the very route this file's own test asserts "has no match on it".
 *
 * That premise was true when written and is not true now. TMW's start gate
 * calls `createPracticeMatch` and sets the match into state IN PLACE; it
 * never navigates, so the URL stays at the landing route for the whole
 * draft. Broadening the regex to the bare route would suppress the prompt on
 * the start gate too, where it is perfectly welcome, and would trade one
 * wrong answer for another.
 *
 * So the second signal is the board itself. `data-arena="live"` is already on
 * every live game surface — the RTT shell, the Showdown room, the TMW room,
 * CourtBuilder, the duel stage, the Daily Grid board — because
 * `styles/v2/arena-room.css` reads it to decide how present the arena
 * backdrop should be. It means exactly "a live board is on screen", which is
 * exactly the question being asked here, so this reuses it rather than
 * maintaining a second list of the same surfaces.
 *
 * A `MutationObserver` rather than a one-shot check: a board can mount after
 * this component has already decided to show (which is precisely the TMW
 * case — the prompt is up on the start gate, then the player presses Play
 * bots and the draft appears underneath it).
 */
function useLiveBoardMounted(): boolean {
  const [live, setLive] = useState(false);
  useEffect(() => {
    const read = () => setLive(document.querySelector('[data-arena="live"]') !== null);
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-arena"] });
    return () => observer.disconnect();
  }, []);
  return live;
}

/** Routes where a modal prompt would land on top of a live game board. */
function isLiveMatchRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    /^\/arena\/three-man-weave\/[^/]+/.test(pathname) ||
    /^\/arena\/twenty-dollar\/[^/]+/.test(pathname) ||
    // Run the Table: the run lives on its landing route (there is no match
    // id in the URL), so the whole route is a live board once a run exists;
    // the prompt would otherwise sit over the roster rail mid-draft.
    /^\/arena\/run-the-table\b/.test(pathname) ||
    // 82-0 Peak Season: the roll/chooser and court-placement decision. NOT
    // `/arena/court/leaderboard|results|history` — those are review pages,
    // not a live board.
    /^\/arena\/court\/(daily|practice)\b/.test(pathname) ||
    // Peak Duel: the timed question and reveal (not the bare `/play` hub).
    /^\/play\/(daily|endless)\b/.test(pathname) ||
    // Daily Grid: the board and cell chooser (not the bare `/daily` hub).
    /^\/daily\/grid\b/.test(pathname)
  );
}

export default function HandleOnboardingPrompt() {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const [phase, setPhase] = useState<Phase>("checking");
  const [suggestion] = useState<string>(() => randomSuggestion());
  const [handle, setHandle] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const checkedForUser = useRef<string | null>(null);
  // FIX (final RC audit): `fixed bottom-4 right-4` overlapped whatever
  // in-flow content sat at that screen position on a narrow/short page --
  // the footer nav column on Progress/History/Ranked, the Handle field
  // itself on a short Profile page. `useFooterVisible` (shared with
  // `CompletionTrigger.tsx`, which had the identical defect) hides the
  // prompt whenever the true end of the page is already on screen, since
  // a page short enough for its own content to reach this prompt's corner
  // is also short enough for its footer to be nearby.
  const footerVisible = useFooterVisible();
  const liveBoardMounted = useLiveBoardMounted();

  useEffect(() => {
    if (loading) return;
    if (!user || user.isAnonymous) {
      // Handles are a real-account concept -- an anonymous session has
      // nowhere durable to attach one and is not what "first successful
      // sign-in" refers to (CourtBuilder's own anonymous-friendly-by-design
      // play is unaffected either way, per ADR-005 Decision 1).
      setPhase("hidden");
      return;
    }
    if (typeof window !== "undefined" && sessionStorage.getItem(DISMISS_KEY) === "1") {
      setPhase("hidden");
      return;
    }
    // One check per signed-in user per mount -- avoids re-fetching on every
    // unrelated re-render of whatever ancestor renders this.
    if (checkedForUser.current === user.id) return;
    checkedForUser.current = user.id;

    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const profile = await fetchProfile(token);
        if (cancelled) return;
        if (profile.handle) {
          setPhase("hidden");
        } else {
          setHandle(suggestion);
          setPhase("prompting");
        }
      } catch {
        // Profile fetch failing is not this component's problem to surface
        // -- fail closed to hidden rather than blocking on an error banner
        // for a dismissible, non-critical prompt.
        if (!cancelled) setPhase("hidden");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading, suggestion]);

  function dismiss() {
    if (typeof window !== "undefined") sessionStorage.setItem(DISMISS_KEY, "1");
    setPhase("hidden");
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!handleLooksValid(handle)) {
      setError("3-20 characters, letters/digits/underscores, starting and ending with a letter or digit.");
      return;
    }
    setPhase("saving");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");
      await updateProfile(token, { handle });
      setPhase("saved");
      if (typeof window !== "undefined") sessionStorage.setItem(DISMISS_KEY, "1");
    } catch (err) {
      setPhase("prompting");
      setError(err instanceof ProfileAPIError ? err.message : "Could not save. Try again.");
    }
  }

  // A LIVE MATCH OWNS THE SCREEN. See the docstring: the capture caught this
  // covering a player's own roster mid-draft, under a running clock. Two
  // signals, because the route alone is not enough — a mode whose board
  // mounts in place keeps the landing route's URL for the whole match.
  if (isLiveMatchRoute(pathname) || liveBoardMounted) return null;
  if (phase !== "prompting" && phase !== "saving" && phase !== "saved") return null;
  // THE PAGE'S OWN CONTENT OWNS THE SCREEN TOO, once it's reached. See the
  // fix note above this component's state block.
  if (footerVisible) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="handle-onboarding-title"
      data-testid="handle-onboarding-prompt"
      className="pk-handle-prompt fixed bottom-4 right-4 z-40 w-[min(22rem,calc(100vw-2rem))] rounded-xl p-4 shadow-lg flex flex-col gap-3"
      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-default)" }}
    >
      {phase === "saved" ? (
        <p role="status" className="text-sm" style={{ color: "var(--correct)" }}>
          Handle set — you can change it any time from Account settings.
        </p>
      ) : (
        <form onSubmit={handleSave} className="flex flex-col gap-2">
          <div>
            <h2 id="handle-onboarding-title" className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Choose a public handle
            </h2>
            <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
              This is what other players see — on the leaderboard, and anywhere else your
              activity is public. Never your name or email.
            </p>
          </div>
          <input
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            maxLength={20}
            aria-label="Public handle"
            data-testid="handle-onboarding-input"
            className="w-full rounded-lg px-3 py-2 text-sm border"
            style={{
              background: "var(--bg-surface)",
              borderColor: "var(--border-default)",
              color: "var(--text-primary)",
            }}
          />
          {error && (
            <p role="alert" className="text-xs" style={{ color: "var(--incorrect)" }}>
              {error}
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={dismiss}
              data-testid="handle-onboarding-skip"
              className="text-xs px-3 py-1.5 rounded-lg"
              style={{ background: "var(--bg-surface)", color: "var(--text-secondary)" }}
            >
              Skip for now
            </button>
            <button
              type="submit"
              disabled={phase === "saving"}
              data-testid="handle-onboarding-save"
              className="text-xs font-semibold uppercase tracking-wide rounded-lg px-3 py-1.5 disabled:opacity-60"
              style={{ background: "var(--peak-accent, #f5c842)", color: "var(--text-inverse)" }}
            >
              {phase === "saving" ? "Saving…" : "Set handle"}
            </button>
          </div>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            You can skip this and play privately — a handle is only required to submit to a
            public leaderboard. Edit it any time from{" "}
            <Link href="/profile" className="underline" style={{ color: "var(--peak-accent-text)" }}>
              Account settings
            </Link>
            .
          </p>
        </form>
      )}
    </div>
  );
}
