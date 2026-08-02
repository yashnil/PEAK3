/**
 * Versioned local persistence for the guided tour and the one-time coachmarks.
 *
 * Owner: W3 (UX / Organization / Polish pass).
 *
 * Three rules this module exists to guarantee:
 *
 * 1. **It never throws.** A blocked, full or corrupt `localStorage` may cost a
 *    player their "you have already seen this" flag; it may never cost them the
 *    ability to play. Every read is wrapped, every parse is validated, and every
 *    failure degrades to "not seen yet".
 * 2. **It is SSR-safe.** The module is imported from client components that are
 *    still rendered on the server, so nothing here touches `window` outside a
 *    `typeof window === "undefined"` guard, and nothing runs at import time.
 * 3. **It is versioned.** A tour is marked seen *at a version*. Bumping
 *    `RUN_THE_TABLE_TOUR_VERSION` (in `components/ui/tour-steps.ts`) replays the
 *    tour for everyone, including people who completed the old one — a stored
 *    version that is not the current version is treated as NOT seen, never as an
 *    error.
 *
 * Storage shape (one key, all tours + all coachmarks):
 *
 * ```json
 * {
 *   "schema_version": 1,
 *   "tours": { "run-the-table": { "version": 1, "status": "completed", "at": "…" } },
 *   "coachmarks": { "draft_room": 1 }
 * }
 * ```
 */

export const TOUR_STORAGE_KEY = "peak3.tour.state";

/** Bumped only when the *shape* above changes. Not the tour's own version. */
export const TOUR_STORAGE_SCHEMA_VERSION = 1;

/** How a tour stopped. Both suppress the auto-start; they differ for analytics. */
export type TourSeenStatus = "completed" | "skipped";

export interface TourSeenRecord {
  /** The tour version that was seen. */
  version: number;
  status: TourSeenStatus;
  /** ISO timestamp, or "" when the clock was unavailable. */
  at: string;
}

export interface TourPrefs {
  schema_version: number;
  tours: Record<string, TourSeenRecord>;
  /** Coachmark id → the tour version it was dismissed at. */
  coachmarks: Record<string, number>;
}

function emptyPrefs(): TourPrefs {
  return { schema_version: TOUR_STORAGE_SCHEMA_VERSION, tours: {}, coachmarks: {} };
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    // Accessing `localStorage` itself throws in some privacy modes.
    return null;
  }
}

/**
 * The stored preferences, or an empty set.
 *
 * Every branch that cannot prove the payload is the shape above returns empty
 * rather than a partially-trusted object: a half-parsed record is how a player
 * ends up with a tour that neither replays nor completes.
 */
export function readTourPrefs(): TourPrefs {
  const store = storage();
  if (!store) return emptyPrefs();

  let raw: string | null = null;
  try {
    raw = store.getItem(TOUR_STORAGE_KEY);
  } catch {
    return emptyPrefs();
  }
  if (!raw) return emptyPrefs();

  try {
    const parsed = JSON.parse(raw) as Partial<TourPrefs> | null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyPrefs();
    if (parsed.schema_version !== TOUR_STORAGE_SCHEMA_VERSION) return emptyPrefs();

    const tours: Record<string, TourSeenRecord> = {};
    const rawTours = parsed.tours;
    if (rawTours && typeof rawTours === "object" && !Array.isArray(rawTours)) {
      for (const [id, value] of Object.entries(rawTours)) {
        if (!value || typeof value !== "object") continue;
        const record = value as Partial<TourSeenRecord>;
        if (typeof record.version !== "number" || !Number.isFinite(record.version)) continue;
        const status: TourSeenStatus = record.status === "skipped" ? "skipped" : "completed";
        tours[id] = {
          version: record.version,
          status,
          at: typeof record.at === "string" ? record.at : "",
        };
      }
    }

    const coachmarks: Record<string, number> = {};
    const rawMarks = parsed.coachmarks;
    if (rawMarks && typeof rawMarks === "object" && !Array.isArray(rawMarks)) {
      for (const [id, value] of Object.entries(rawMarks)) {
        if (typeof value === "number" && Number.isFinite(value)) coachmarks[id] = value;
      }
    }

    return { schema_version: TOUR_STORAGE_SCHEMA_VERSION, tours, coachmarks };
  } catch {
    return emptyPrefs();
  }
}

function writeTourPrefs(prefs: TourPrefs): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(TOUR_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Quota or private mode. The tour still runs for this session; it just will
    // not remember. Never break the surface over a preference.
  }
}

function nowIso(): string {
  try {
    return new Date().toISOString();
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------ */
/* Tour                                                                */
/* ------------------------------------------------------------------ */

/** The stored record for `tourId`, or null. Exposed for tests and debugging. */
export function readTourSeen(tourId: string): TourSeenRecord | null {
  return readTourPrefs().tours[tourId] ?? null;
}

/**
 * Should the tour open by itself?
 *
 * True when nothing is stored, when the stored payload was unreadable, or when
 * the stored version is not `version` — including a *newer* stored version,
 * which can only mean the player used a newer build and then rolled back. In
 * every one of those cases replaying is the safe, non-destructive answer.
 *
 * False during SSR: a tour cannot open on a server, and returning true there
 * would make the first client render disagree with the markup.
 */
export function shouldAutoStartTour(tourId: string, version: number): boolean {
  if (typeof window === "undefined") return false;
  const record = readTourPrefs().tours[tourId];
  if (!record) return true;
  return record.version !== version;
}

/** Record that the player finished or skipped the tour at `version`. */
export function markTourSeen(
  tourId: string,
  version: number,
  status: TourSeenStatus = "completed",
): void {
  const prefs = readTourPrefs();
  prefs.tours[tourId] = { version, status, at: nowIso() };
  writeTourPrefs(prefs);
}

/**
 * Forget that the tour was seen, so it auto-starts again.
 *
 * Coachmarks are deliberately cleared too: "show me the introduction again" and
 * "but keep suppressing the per-node hints" is not a distinction a player has
 * asked for, and leaving them set makes the reset look broken.
 */
export function resetTour(tourId: string): void {
  const prefs = readTourPrefs();
  delete prefs.tours[tourId];
  prefs.coachmarks = {};
  writeTourPrefs(prefs);
}

/* ------------------------------------------------------------------ */
/* Coachmarks                                                          */
/* ------------------------------------------------------------------ */

/**
 * Should the one-time hint for `id` be shown?
 *
 * Coachmarks are versioned with the same number as the tour, so a tour version
 * bump — which means the rules being explained changed — also replays the
 * per-node hints exactly once each.
 */
export function shouldShowCoachmark(id: string, version: number): boolean {
  if (typeof window === "undefined") return false;
  const seen = readTourPrefs().coachmarks[id];
  if (seen === undefined) return true;
  return seen !== version;
}

export function markCoachmarkSeen(id: string, version: number): void {
  const prefs = readTourPrefs();
  prefs.coachmarks[id] = version;
  writeTourPrefs(prefs);
}

/** Clears every coachmark flag without touching the tour record. */
export function resetCoachmarks(): void {
  const prefs = readTourPrefs();
  prefs.coachmarks = {};
  writeTourPrefs(prefs);
}
