/**
 * Privacy-safe typed analytics for PEAK3.
 *
 * TWO SINKS, ONE CALL SITE. `analytics.track(event)` still does exactly what
 * it always did in development — `console.debug` — and now ALSO forwards a
 * narrow subset of events to the first-party ingest endpoint
 * (`POST /api/v1/telemetry/events`). Nothing else changes for callers.
 *
 * ONLY A SUBSET IS FORWARDED, and that is deliberate. The server enforces a
 * closed allowlist of 21 product events (`apps/api/app/models/telemetry.py`)
 * and rejects anything outside it with a 422. Every other event in the union
 * below stays local-only: it remains useful in the dev console and is simply
 * never collected. Adding an event to the collected set is a two-sided,
 * reviewed change — this file and the server allowlist — which is the point.
 *
 * THE FOUR RULES THIS MODULE MUST NEVER BREAK:
 *   1. It must never throw into the UI. Every path is wrapped; a failure to
 *      report is not a failure to play.
 *   2. It must never block. Events are queued and flushed on a timer, off the
 *      interaction path; no `await` is ever exposed to a caller.
 *   3. It must no-op cleanly when the endpoint is absent, disabled or
 *      failing — the common case, since telemetry is OFF by default on the
 *      server.
 *   4. It must honour a do-not-track signal without being asked twice.
 *
 * WHAT IS NEVER SENT, enforced here as well as on the server (belt and
 * braces — the client-side strip means a mistake never leaves the browser,
 * the server-side reject means a mistake is *visible*): email addresses,
 * OAuth / magic-link / access / refresh tokens, the Authorization header,
 * localStorage contents, IP addresses, user agents, player names, search
 * queries, board answers, or any free text the player typed.
 * See docs/implementation/TELEMETRY.md.
 */

export type AnalyticsEvent =
  | { type: "daily_board_opened"; mode: string; date: string; has_prior_completion: boolean }
  | { type: "daily_game_started"; mode: string; date: string }
  | { type: "daily_game_completed"; mode: string; date: string; lineup_peak_rating: number; draft_efficiency: number | null }
  | { type: "challenge_created"; mode: string; board_type: string }
  | { type: "challenge_opened"; mode: string; board_label: string }
  | { type: "challenge_started"; mode: string }
  | { type: "challenge_completed"; mode: string; outcome: string }
  | { type: "challenge_shared"; mode: string }
  // Phase 3.1 progression events
  | { type: "xp_awarded"; xp_amount: number; event_type: string }
  | { type: "level_reached"; new_level: number }
  | { type: "personal_record_set"; record_type: string; mode: string }
  | { type: "achievement_awarded"; achievement_key: string; category: string }
  | { type: "streak_advanced"; current_streak: number }
  | { type: "streak_reserve_earned" }
  | { type: "streak_reserve_consumed"; current_streak: number }
  | { type: "streak_reset" }
  | { type: "progression_viewed"; surface: string }
  // Phase 4.0 ranked events — never include opponent identity/picks, raw
  // integrity signals, or exact rating deltas beyond what the result screen
  // already shows the player themselves.
  | { type: "ranked_queue_viewed"; mode: string }
  | { type: "ranked_queue_joined"; mode: string }
  | { type: "ranked_queue_cancelled"; mode: string }
  | { type: "ranked_match_created"; mode: string }
  | { type: "ranked_match_started"; mode: string }
  | { type: "ranked_match_completed"; mode: string }
  | { type: "ranked_match_settled"; mode: string; outcome: string }
  | { type: "ranked_match_forfeited"; mode: string }
  | { type: "ranked_match_invalidated"; mode: string }
  | { type: "placement_advanced"; mode: string; valid_matches_completed: number }
  | { type: "placement_completed"; mode: string }
  | { type: "rating_changed"; mode: string }
  | { type: "division_changed"; mode: string }
  | { type: "ranked_leaderboard_viewed"; mode: string }
  // ---------------------------------------------------------------------
  // Collected product events (Track F). These, and only these, are forwarded
  // to the server. Mirrors EVENT_NAMES in apps/api/app/models/telemetry.py.
  // ---------------------------------------------------------------------
  | { type: "auth_started"; method?: string; surface?: string }
  | { type: "auth_completed"; method?: string }
  | { type: "guest_state_claimed"; mode?: string }
  | { type: "game_opened"; mode?: string; surface?: string }
  | { type: "run_started"; run_ref?: string; run_index?: number; mode?: string; ruleset?: string }
  | {
      type: "run_ended";
      run_ref?: string;
      outcome?: string;
      act?: number;
      duration_seconds?: number;
      lives_remaining?: number;
      credits_remaining?: number;
    }
  | { type: "second_run_started"; run_ref?: string }
  | { type: "run_replayed"; run_ref?: string; mode?: string }
  | { type: "tutorial_completed"; surface?: string; tutorial_step?: number }
  | { type: "tutorial_skipped"; surface?: string; tutorial_step?: number }
  | { type: "perk_selected"; perk: string; run_ref?: string; act?: number }
  | { type: "node_selected"; node_type: string; run_ref?: string; act?: number }
  | { type: "card_bought"; run_ref?: string; act?: number }
  | { type: "trade_completed"; run_ref?: string; act?: number }
  | { type: "boss_won"; boss: string | number; run_ref?: string; lanes_won?: number }
  | { type: "boss_lost"; boss: string | number; run_ref?: string; lanes_won?: number }
  | { type: "table_cleared"; run_ref?: string; duration_seconds?: number }
  | { type: "daily_opened"; mode?: string; daily_key?: string }
  | { type: "daily_completed"; mode?: string; daily_key?: string; outcome?: string; streak?: number };

// DO NOT include: raw tokens, email, IP, future offers, secrets, player selections,
// opponent identity/picks, raw integrity signals, service-role details, exact
// private IP/location data

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const INGEST_URL = `${API_BASE}/api/v1/telemetry/events`;

/**
 * Whether this deployment collects telemetry at all. OFF unless set.
 *
 * WHY THIS EXISTS: THE CLIENT WAS SENDING REQUESTS IT KNEW WOULD BE REFUSED.
 *
 * The server is off by default and answers 403 `telemetry_disabled`
 * (apps/api/app/api/v1/telemetry.py). The client below handles that
 * correctly — one 403 and it stops for the rest of the page session — but
 * "page session" is the operative word: module state dies with the document,
 * so every navigation started a fresh session and posted a fresh batch. Across
 * the browser suite that is one unauthorized POST per page load, hundreds of
 * them, each one a request the caller could have known in advance would be
 * refused. The API log fills with 403s that mean nothing, which is the real
 * cost: a genuine authorization failure has nowhere to stand out.
 *
 * The honest fix is not to make the endpoint accept them. It is to stop
 * sending them. The client now mirrors the server's own switch, so a
 * deployment that does not collect telemetry does not generate the traffic —
 * and rule 3 in the module docstring ("no-op cleanly when the endpoint is
 * absent, disabled or failing") is satisfied without a round trip.
 *
 * `NEXT_PUBLIC_*` is compiled in, so this is a build-time constant, and the
 * queueing/flushing code below is unreachable in a build without it. Turning
 * collection on is therefore a two-sided, deliberate act: this variable AND
 * `PEAK3_TELEMETRY_ENABLED` on the API. Neither alone does anything, which is
 * the right shape for a privacy-affecting path.
 */
const COLLECTION_ENABLED = process.env.NEXT_PUBLIC_TELEMETRY_ENABLED === "true";

/** Where a server refusal is remembered ACROSS page loads within one tab.
 *
 *  The second line of defence behind `COLLECTION_ENABLED`, for the case that
 *  flag cannot cover: a build with collection on, pointed at an API that has
 *  it off (or too old to have the route). Without this, each navigation asks
 *  again and is refused again. `sessionStorage` is the right lifetime — per
 *  tab, cleared when it closes — because "this API is not collecting" is true
 *  for as long as the visit lasts but must not be cached forever across
 *  visits, or enabling the server would need every user to clear storage. */
const REFUSED_KEY = "peak3:telemetry:refused";

/**
 * The event names forwarded to the server. Must stay identical to
 * `EVENT_NAMES` in `apps/api/app/models/telemetry.py`; anything not here is
 * console-only and is never transmitted.
 */
const COLLECTED_EVENTS: ReadonlySet<string> = new Set([
  "auth_started",
  "auth_completed",
  "guest_state_claimed",
  "game_opened",
  "run_started",
  "run_ended",
  "tutorial_completed",
  "tutorial_skipped",
  "perk_selected",
  "node_selected",
  "card_bought",
  "trade_completed",
  "boss_won",
  "boss_lost",
  "table_cleared",
  "run_replayed",
  "challenge_created",
  "challenge_completed",
  "daily_opened",
  "daily_completed",
  "second_run_started",
]);

/**
 * The property keys the server accepts. Mirrors `PROPERTY_KEYS` in
 * `apps/api/app/models/telemetry.py`. Anything not listed is dropped here
 * rather than sent and rejected — so a caller that attaches an extra field to
 * an existing event gets a working (if less detailed) event instead of a
 * silently failing batch.
 */
const ALLOWED_PROPERTIES: ReadonlySet<string> = new Set([
  "run_ref",
  "session_ref",
  "mode",
  "surface",
  "source",
  "method",
  "board_type",
  "challenge_kind",
  "node_type",
  "ruleset",
  "outcome",
  "result",
  "boss",
  "boss_id",
  "perk",
  "perk_id",
  "act",
  "stage",
  "run_index",
  "duration_seconds",
  "lanes_won",
  "lives_remaining",
  "credits_remaining",
  "cards_bought",
  "trades_made",
  "replay",
  "tutorial_step",
  "daily_key",
  "streak",
  "is_first_run",
  "is_second_run",
]);

const MAX_STRING_VALUE_LENGTH = 64;
const MAX_PROPERTIES = 12;
const MAX_BATCH = 20;
/** Queue ceiling. Beyond this the OLDEST events are dropped — a backed-up
 *  queue means the endpoint is unavailable, and holding megabytes of stale
 *  events for a server that is not listening helps nobody. */
const MAX_QUEUE = 200;
const FLUSH_INTERVAL_MS = 5000;

/** Values are constrained to the server's slug charset. Same rule, same
 *  reason: it makes free text and token-shaped strings unrepresentable. */
const SAFE_VALUE = /^[A-Za-z0-9_.:-]{1,64}$/;
const TOKEN_SHAPED = /eyJ[A-Za-z0-9_-]|^[A-Za-z0-9_-]{32,}$/;

type TelemetryProps = Record<string, string | number | boolean>;
type QueuedEvent = { name: string; props: TelemetryProps };

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
/** Set once the server has told us not to bother (403/404/422), or once a
 *  privacy signal has been detected. Never un-set within a page session. */
let disabled = false;
let listenersBound = false;

/**
 * Do-not-track / reduced-telemetry detection.
 *
 * Three signals, any of which is sufficient:
 *   - `navigator.globalPrivacyControl` (GPC) — the current standard, and the
 *     one with legal weight in several jurisdictions;
 *   - `navigator.doNotTrack` / `window.doNotTrack` — legacy DNT, still set by
 *     a meaningful number of users and trivially cheap to honour;
 *   - `localStorage["peak3:telemetry"] === "off"` — our own opt-out, so a
 *     player can decline without changing a browser setting.
 *
 * Note what is NOT here: no fingerprint-based "is this a bot" check and no
 * attempt to detect a blocked request and route around it. Honouring the
 * signal means honouring it.
 */
function privacySignalPresent(): boolean {
  try {
    if (typeof navigator !== "undefined") {
      const nav = navigator as Navigator & {
        globalPrivacyControl?: boolean;
        msDoNotTrack?: string;
      };
      if (nav.globalPrivacyControl === true) return true;
      if (nav.doNotTrack === "1" || nav.doNotTrack === "yes") return true;
      if (nav.msDoNotTrack === "1") return true;
    }
    if (typeof window !== "undefined") {
      const win = window as Window & { doNotTrack?: string };
      if (win.doNotTrack === "1" || win.doNotTrack === "yes") return true;
      if (window.localStorage?.getItem("peak3:telemetry") === "off") return true;
      // The API already told this tab it is not collecting — see REFUSED_KEY.
      if (window.sessionStorage?.getItem(REFUSED_KEY) === "1") return true;
    }
  } catch {
    // A browser that throws on any of the above (private mode, blocked
    // storage) gets the conservative answer.
    return true;
  }
  return false;
}

/** Strip an event down to allowlisted, safely-shaped scalar properties. */
function sanitizeProps(event: AnalyticsEvent): TelemetryProps {
  const out: TelemetryProps = {};
  const source = event as unknown as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (key === "type") continue;
    if (!ALLOWED_PROPERTIES.has(key)) continue;
    if (Object.keys(out).length >= MAX_PROPERTIES) break;

    const value = source[key];
    if (typeof value === "boolean") {
      out[key] = value;
    } else if (typeof value === "number") {
      if (Number.isFinite(value)) out[key] = value;
    } else if (typeof value === "string") {
      if (value.length > MAX_STRING_VALUE_LENGTH) continue;
      if (!SAFE_VALUE.test(value)) continue;
      if (TOKEN_SHAPED.test(value)) continue;
      out[key] = value;
    }
    // undefined / null / objects / arrays are dropped without comment: an
    // object is exactly the shape an accidental "send the whole state" bug
    // takes, and there is no product dimension that needs one.
  }
  return out;
}

function bindLifecycleListeners(): void {
  if (listenersBound || typeof document === "undefined") return;
  listenersBound = true;
  try {
    // Flush when the tab goes away, which is when a run most often ends.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void flush();
    });
    window.addEventListener("pagehide", () => void flush());
  } catch {
    // Listener registration is best-effort like everything else here.
  }
}

function scheduleFlush(): void {
  if (timer !== null) return;
  try {
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, FLUSH_INTERVAL_MS);
  } catch {
    timer = null;
  }
}

/**
 * Send whatever is queued. Never rejects, never throws.
 *
 * Exported so a caller that knows a session is ending (sign-out, run receipt)
 * can nudge it, and so tests can drive it deterministically instead of waiting
 * on a timer.
 */
async function flush(): Promise<void> {
  if (disabled || queue.length === 0) return;
  // Belt and braces with `enqueue`: with collection off the queue is always
  // empty, so this is unreachable — but `flush` is exported and a caller
  // nudging it must never be the thing that makes an unauthorized request.
  if (!COLLECTION_ENABLED) return;
  if (typeof fetch !== "function") return;

  const batch = queue.slice(0, MAX_BATCH);
  queue = queue.slice(batch.length);

  try {
    const response = await fetch(INGEST_URL, {
      method: "POST",
      // The anon identity cookie is httponly and set by the API's own origin,
      // so it only travels with credentials included.
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      // Lets the request survive the page unloading, which is exactly when
      // the most interesting event (the run ending) is emitted.
      keepalive: true,
      body: JSON.stringify({ events: batch }),
    });

    if (!response.ok) {
      // 403 = the feature is off on this deployment. 404 = this build of the
      // API predates the endpoint. 422 = we sent something the allowlist
      // refuses, which is a bug on this side and will keep refusing. All
      // three are permanent for this page session, so stop asking.
      if (response.status === 403 || response.status === 404 || response.status === 422) {
        disabled = true;
        queue = [];
        // Remember it for the whole TAB, not just this document. Module state
        // dies on navigation, and re-asking an endpoint that has already said
        // no is the behaviour that filled the API log with 403s. See
        // REFUSED_KEY.
        try {
          window.sessionStorage?.setItem(REFUSED_KEY, "1");
        } catch {
          // Storage unavailable (private mode, blocked): the in-memory flag
          // above still holds for this document, which is the old behaviour
          // and no worse than it.
        }
      }
      // Everything else (429, 5xx) simply drops this batch. No retry queue:
      // telemetry is not worth a backoff state machine, and re-sending into a
      // rate limit is how a client turns a limit into an outage.
      return;
    }
  } catch {
    // Network failure, CORS refusal, ad-blocker, offline. Silently drop.
    // Never surfaced, never retried, never logged to the user's console in
    // production.
    return;
  }

  if (queue.length > 0) scheduleFlush();
}

function enqueue(event: AnalyticsEvent): void {
  if (disabled) return;
  // This deployment does not collect. Nothing is queued, so nothing is ever
  // sent — see COLLECTION_ENABLED. `console.debug` in `emit` is unaffected:
  // the dev-console sink was never the thing making requests.
  if (!COLLECTION_ENABLED) return;
  if (typeof window === "undefined") return; // SSR: nothing to report
  if (!COLLECTED_EVENTS.has(event.type)) return;
  if (privacySignalPresent()) {
    disabled = true;
    return;
  }

  queue.push({ name: event.type, props: sanitizeProps(event) });
  if (queue.length > MAX_QUEUE) queue = queue.slice(queue.length - MAX_QUEUE);
  bindLifecycleListeners();
  scheduleFlush();
}

function emit(event: AnalyticsEvent): void {
  if (process.env.NODE_ENV !== "production") {
    console.debug("[peak3:analytics]", event.type, event);
  }
  try {
    enqueue(event);
  } catch {
    // Rule 1: analytics never breaks the UI. If anything above throws — a
    // hostile Proxy on the event object, a browser that errors on
    // `localStorage`, a patched `fetch` — the player's action proceeds.
  }
}

/** Stop collecting for this page session and drop anything queued. */
function optOut(): void {
  disabled = true;
  queue = [];
  try {
    window.localStorage?.setItem("peak3:telemetry", "off");
  } catch {
    // Storage unavailable: the in-memory flag above is still authoritative
    // for this session.
  }
}

export const analytics = {
  track: emit,
  flush,
  optOut,
  /** True when nothing will be collected — because this deployment does not
   *  collect at all (`COLLECTION_ENABLED`), or because a privacy signal, an
   *  explicit opt-out or a server refusal switched it off. */
  get isDisabled(): boolean {
    return disabled || !COLLECTION_ENABLED;
  },
  /** Test seam: reset module state between cases. */
  __resetForTests(): void {
    queue = [];
    disabled = false;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    try {
      // The refusal outlives the module, so resetting the module without
      // clearing it would leak one case's server response into the next.
      window.sessionStorage?.removeItem(REFUSED_KEY);
    } catch {
      // No storage in this environment; nothing to clear.
    }
  },
};

export const COLLECTED_EVENT_NAMES = COLLECTED_EVENTS;
export const TELEMETRY_PROPERTY_KEYS = ALLOWED_PROPERTIES;
