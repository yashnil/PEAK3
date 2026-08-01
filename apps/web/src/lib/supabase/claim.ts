/**
 * The guest-claim call, and how its result is described to a human.
 *
 * THE CREDENTIAL IS A COOKIE, NOT A LOCALSTORAGE ID (plan §2.5). `peak3_anon`
 * is a high-entropy, HMAC-signed, httponly cookie the API issued; it is the only
 * thing that proves ownership of guest activity. A run id read out of
 * `localStorage` proves nothing — anyone who saw a shared result could send it —
 * so no run id is ever transmitted here. That is why this call needs both
 * `credentials: "include"` (to attach the anon cookie on the API origin) and an
 * `Authorization` header (to name the account receiving the transfer).
 *
 * WHY IT MUST RUN IN THE BROWSER. The anon cookie is scoped to the API origin.
 * A server-side fetch from a Next route handler carries the *web* origin's
 * cookies and would silently claim nothing — which is precisely the class of bug
 * the previous relative-URL `fetch("/api/v1/auth/claim")` was: it 404'd on any
 * split deployment and a bare `catch {}` hid it.
 *
 * THE RESPONSE SHAPE IS NOT OURS. Track C owns `POST /auth/claim` and is adding
 * four more domains to it (RUN THE TABLE, Daily Grid, 82-0 runs, 82-0 saved
 * runs). Rather than hardcode a field list that goes stale the day that lands,
 * `summarizeClaim` reads every `*_count` / `*_claimed` number it finds, labels
 * the ones it recognises, and humanises the rest. A field that disappears simply
 * stops being mentioned; a field that appears is described without a frontend
 * deploy. Nothing here throws on an unexpected body.
 *
 * Owner: Track B (auth surface).
 */

import { API_BASE_URL } from "./config";

/** One "we imported N of these" line. */
export interface ClaimLine {
  /** The response key it came from — stable identity for a React key. */
  key: string;
  /** Plural noun phrase, lowercase, e.g. `"saved 82-0 runs"`. */
  label: string;
  count: number;
}

export interface ClaimSummary {
  /** Did the server transfer anything, or say it already had? */
  claimed: boolean;
  /** The server's machine-readable explanation, when it gave one. */
  reason: string | null;
  /** Only non-zero domains, in a stable order. Empty when nothing moved. */
  lines: ClaimLine[];
  /** Sum of `lines`. Zero is a normal, common outcome. */
  total: number;
}

/**
 * Response keys we can name properly, in the order they should be read.
 *
 * The trailing entries are Track C's four new domains, spelled as the plan names
 * them. If the real keys differ the generic humaniser still produces something
 * readable, so a mismatch degrades rather than breaks.
 */
const KNOWN_LABELS: ReadonlyArray<readonly [string, string]> = [
  ["game_count", "duels"],
  ["completion_count", "daily completions"],
  ["challenge_count", "challenges"],
  ["run_the_table_run_count", "RUN THE TABLE runs"],
  ["run_the_table_runs_claimed", "RUN THE TABLE runs"],
  ["daily_grid_result_count", "Daily Grid results"],
  ["daily_grid_results_claimed", "Daily Grid results"],
  ["perfect_season_run_count", "82-0 runs"],
  ["perfect_season_runs_claimed", "82-0 runs"],
  ["perfect_season_saved_run_count", "saved 82-0 lineups"],
  ["perfect_season_saved_runs_claimed", "saved 82-0 lineups"],
  ["records_claimed", "personal records"],
  ["achievements_claimed", "achievements"],
  ["progression_events_claimed", "progression events"],
];

const COUNT_KEY = /_(count|claimed)$/;

/** `perfect_season_saved_run_count` → `perfect season saved run`. */
function humanise(key: string): string {
  return key.replace(COUNT_KEY, "").replace(/_/g, " ").trim() || key;
}

function readCount(source: Record<string, unknown>, key: string): number | null {
  const raw = source[key];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return Math.max(0, Math.trunc(raw));
}

/**
 * Turn whatever `POST /auth/claim` returned into displayable lines.
 *
 * Never throws. `null`, a string, an array, a body with no counts at all — all
 * produce an empty, honest summary rather than an exception in a redirect path.
 */
export function summarizeClaim(payload: unknown): ClaimSummary {
  const empty: ClaimSummary = { claimed: false, reason: null, lines: [], total: 0 };
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return empty;
  }
  const body = payload as Record<string, unknown>;

  const claimed = body.claimed === true;
  const reason = typeof body.reason === "string" ? body.reason : null;

  const lines: ClaimLine[] = [];
  const seen = new Set<string>();
  const push = (key: string, label: string) => {
    if (seen.has(label)) return;
    const count = readCount(body, key);
    if (count === null || count === 0) return;
    seen.add(label);
    lines.push({ key, label, count });
  };

  for (const [key, label] of KNOWN_LABELS) push(key, label);
  // Anything Track C adds that we do not have copy for yet.
  for (const key of Object.keys(body)) {
    if (!COUNT_KEY.test(key)) continue;
    if (KNOWN_LABELS.some(([known]) => known === key)) continue;
    push(key, humanise(key));
  }

  return {
    claimed,
    reason,
    lines,
    total: lines.reduce((sum, line) => sum + line.count, 0),
  };
}

/** `3 duels, 2 challenges and 1 achievement` — an Oxford-free serial list. */
export function describeClaim(summary: ClaimSummary): string {
  const parts = summary.lines.map((line) => `${line.count} ${line.label}`);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * POST the claim.
 *
 * Resolves to `null` — never rejects — when the API is unreachable or replies
 * with an error status. A failed claim is genuinely non-fatal: the user is
 * signed in either way, and the API's claim is idempotent, so a later attempt
 * still works. What is NOT acceptable, and what this replaces, is failing
 * invisibly: the caller gets `null` and says so.
 */
export async function claimGuestActivity(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ClaimSummary | null> {
  try {
    const response = await fetchImpl(`${API_BASE_URL}/api/v1/auth/claim`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      // The whole point: attach the httponly `peak3_anon` cookie cross-origin.
      credentials: "include",
    });
    if (!response.ok) return null;
    return summarizeClaim(await response.json());
  } catch {
    return null;
  }
}
