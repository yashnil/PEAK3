/**
 * API client for RUN THE TABLE.
 *
 * Server-authoritative, exactly like `perfect-season-api.ts` and
 * `draft-api.ts`: every action POSTs and the caller replaces its whole state
 * object with the response. This module NEVER computes a PEAK3 score, a price,
 * a discount, a lane value or a battle outcome — it moves payloads.
 */
import {
  ChallengeResponse,
  DailyDescriptor,
  RunActionBody,
  RunPublicState,
  RunReadiness,
  RulesetMeta,
  RunType,
} from "@/types/run-the-table";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export class RunTheTableAPIError extends Error {
  constructor(
    public status: number,
    public detail: string,
    public code?: string,
  ) {
    super(detail);
    this.name = "RunTheTableAPIError";
  }
}

/** FastAPI sends `detail` as either a plain string or `{error_code, message}`. */
function parseErrorDetail(detail: unknown, status: number): { message: string; code?: string } {
  if (typeof detail === "string") return { message: detail };
  if (detail && typeof detail === "object") {
    const d = detail as { error_code?: string; message?: string };
    return { message: d.message || `HTTP ${status}`, code: d.error_code };
  }
  return { message: `HTTP ${status}` };
}

async function rttFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/v1${path}`, {
      headers: { "Content-Type": "application/json", ...options.headers },
      credentials: "include",
      ...options,
    });
  } catch {
    // A network-level failure (API not running, DNS, CORS preflight) is not an
    // HTTP status — give it status 0 so callers can tell it apart from a 404.
    throw new RunTheTableAPIError(0, "Could not reach the PEAK3 API.", "network_unavailable");
  }
  const json = await res.json().catch(() => ({ detail: "Unknown error" }));
  if (!res.ok) {
    const { message, code } = parseErrorDetail((json as { detail?: unknown }).detail, res.status);
    throw new RunTheTableAPIError(res.status, message, code);
  }
  return json as T;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getRunReadiness(): Promise<RunReadiness> {
  return rttFetch<RunReadiness>("/run-the-table/readiness", { cache: "no-store" } as RequestInit);
}

/** The static, cacheable ruleset description (`ruleset_meta()`). */
export async function getRulesetMeta(): Promise<RulesetMeta> {
  return rttFetch<RulesetMeta>("/run-the-table/meta");
}

/** Today's (or a given date's) shared daily descriptor. Spoiler-free. */
export async function getDailyRun(date?: string): Promise<DailyDescriptor> {
  const qs = date ? `?date=${encodeURIComponent(date)}` : "";
  return rttFetch<DailyDescriptor>(`/run-the-table/daily${qs}`, { cache: "no-store" } as RequestInit);
}

export async function getRun(runId: string): Promise<RunPublicState> {
  return rttFetch<RunPublicState>(`/run-the-table/runs/${encodeURIComponent(runId)}`, {
    cache: "no-store",
  } as RequestInit);
}

/**
 * `GET /run-the-table/challenges/{token}` — what a challenge link resolves to.
 *
 * Spoiler-safe by omission on the server (seed, run type, date, versions and
 * nothing else), which is what makes it safe to show on the start gate before
 * the recipient has committed to playing. Declared here rather than in
 * `types/run-the-table.ts` because it is the only consumer.
 */
export interface ChallengeDescriptor {
  seed: number;
  run_type: RunType;
  date?: string | null;
  versions?: Record<string, string>;
}

export async function getChallenge(token: string): Promise<ChallengeDescriptor> {
  return rttFetch<ChallengeDescriptor>(
    `/run-the-table/challenges/${encodeURIComponent(token)}`,
    { cache: "no-store" } as RequestInit,
  );
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CreateRunOptions {
  /** Free-play only. A daily run's seed is always re-derived server-side. */
  seed?: number;
  /** Daily only. */
  date?: string;
  /** Challenge only — the opaque token from a `/c/{token}` link. */
  challengeToken?: string;
}

export async function createRun(
  runType: RunType,
  options: CreateRunOptions = {},
): Promise<RunPublicState> {
  return rttFetch<RunPublicState>("/run-the-table/runs", {
    method: "POST",
    body: JSON.stringify({
      run_type: runType,
      seed: options.seed,
      date: options.date,
      challenge_token: options.challengeToken,
    }),
  });
}

/**
 * Applies one action and returns the ENTIRE new run state.
 *
 * `idempotencyKey` is generated per user gesture (not per retry) so a
 * double-submit — a double click, a flaky connection retried by the browser —
 * can never buy the same card twice. The engine's `_already_applied` check
 * keys off exactly this value.
 */
export async function postRunAction(
  runId: string,
  action: RunActionBody,
  idempotencyKey?: string,
): Promise<RunPublicState> {
  return rttFetch<RunPublicState>(`/run-the-table/runs/${encodeURIComponent(runId)}/actions`, {
    method: "POST",
    body: JSON.stringify(
      idempotencyKey ? { ...action, idempotency_key: idempotencyKey } : action,
    ),
  });
}

export async function createChallenge(runId: string): Promise<ChallengeResponse> {
  return rttFetch<ChallengeResponse>(
    `/run-the-table/runs/${encodeURIComponent(runId)}/challenge`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

// ---------------------------------------------------------------------------
// Typed action helpers — one per action_type in the engine's action table.
// ---------------------------------------------------------------------------

export const runActions = {
  selectSystem: (systemId: string): RunActionBody => ({
    action_type: "select_system",
    system_id: systemId,
  }),
  chooseNode: (nodeId: string): RunActionBody => ({
    action_type: "choose_node",
    node_id: nodeId,
  }),
  draftBuy: (cardId: string, slotId: string, useVeteranMinimum = false): RunActionBody => ({
    action_type: "draft_buy",
    card_id: cardId,
    slot_id: slotId,
    use_veteran_minimum: useVeteranMinimum,
  }),
  draftPass: (): RunActionBody => ({ action_type: "draft_pass" }),
  trade: (outgoingSlotId: string, incomingCardId: string): RunActionBody => ({
    action_type: "trade",
    outgoing_slot_id: outgoingSlotId,
    incoming_card_id: incomingCardId,
  }),
  declineTrade: (): RunActionBody => ({ action_type: "decline_trade" }),
  filmRoom: (choice: string): RunActionBody => ({ action_type: "film_room", choice }),
  restBank: (choice: string): RunActionBody => ({ action_type: "rest_bank", choice }),
  resolveBoss: (): RunActionBody => ({ action_type: "resolve_boss" }),
  advance: (): RunActionBody => ({ action_type: "advance" }),
};
