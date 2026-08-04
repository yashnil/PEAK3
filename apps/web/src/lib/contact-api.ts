/**
 * API client for POST /api/v1/contact (launch-polish IMPLEMENTATION_CONTRACT.md
 * §9). Deliberately a thin transport layer, mirroring daily-grid-api.ts /
 * perfect-season-api.ts: the server owns validation (the category
 * vocabulary, length caps, the rate limit); nothing here decides whether a
 * submission is acceptable.
 *
 * `credentials: "include"` matters here specifically: an anonymous sender's
 * identity is the signed anon cookie the server mints/reads, the same
 * mechanism every other anonymous-friendly route in this app uses. Without
 * it, a signed-out visitor's submission would look like a fresh identity on
 * every request.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type ContactCategory =
  | "new_mode"
  | "improve_mode"
  | "bug"
  | "question_ranking_or_data"
  | "accessibility"
  | "account_or_privacy"
  | "partnership_or_press"
  | "other";

export type ContactRelevantArea =
  | "daily_grid"
  | "peak_season_82_0"
  | "run_the_table"
  | "ranked"
  | "rankings_model"
  | "account"
  | "other";

/** Mirrors app/models/contact.py's CONTACT_CATEGORIES exactly -- keep both
 * lists in sync by hand; there is no shared source of truth across the
 * Python/TypeScript boundary. */
export const CONTACT_CATEGORY_LABELS: Record<ContactCategory, string> = {
  new_mode: "Suggest a new mode",
  improve_mode: "Improve an existing mode",
  bug: "Report a bug",
  question_ranking_or_data: "Question a ranking or data point",
  accessibility: "Accessibility problem",
  account_or_privacy: "Account or privacy",
  partnership_or_press: "Partnership or press",
  other: "Something else",
};

export const CONTACT_RELEVANT_AREA_LABELS: Record<ContactRelevantArea, string> = {
  daily_grid: "Daily Grid",
  peak_season_82_0: "82-0",
  run_the_table: "Run the Table",
  ranked: "Ranked",
  rankings_model: "Rankings / the model",
  account: "Account",
  other: "Something else",
};

export interface ContactSubmissionInput {
  category: ContactCategory;
  relevantArea?: ContactRelevantArea;
  subject: string;
  message: string;
  replyEmail?: string;
  /** Honeypot -- the form renders this hidden; a real sender never sets it.
   * Present in the type so the form component cannot forget to wire it. */
  website?: string;
}

export interface ContactSubmissionResult {
  request_id: string;
  accepted: boolean;
}

export class ContactAPIError extends Error {
  constructor(
    public status: number,
    public detail: string,
    public code?: string,
  ) {
    super(detail);
    this.name = "ContactAPIError";
  }
}

function parseErrorDetail(detail: unknown, status: number): { message: string; code?: string } {
  if (typeof detail === "string") return { message: detail };
  if (Array.isArray(detail)) {
    // FastAPI's default 422 validation-error shape: a list of {loc, msg, type}.
    const messages = detail
      .map((e) => (e && typeof e === "object" && "msg" in e ? String((e as { msg: unknown }).msg) : null))
      .filter((m): m is string => !!m);
    if (messages.length > 0) return { message: messages.join(" ") };
  }
  if (detail && typeof detail === "object") {
    const d = detail as { error_code?: string; message?: string };
    return { message: d.message || `HTTP ${status}`, code: d.error_code };
  }
  return { message: `HTTP ${status}` };
}

/** What the UI says when the server rate-limits a submission. Vague on
 * purpose (mirrors daily-grid-api.ts's RATE_LIMITED_MESSAGE) -- a
 * remaining-budget countdown is the calibration signal an abuser wants,
 * and the server's own 429 body deliberately withholds it. */
export const CONTACT_RATE_LIMITED_MESSAGE =
  "You've sent a few messages already. Please wait a while before sending another.";

export async function submitContact(
  input: ContactSubmissionInput,
  accessToken?: string,
): Promise<ContactSubmissionResult> {
  const res = await fetch(`${API_BASE}/api/v1/contact`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({
      category: input.category,
      relevant_area: input.relevantArea,
      subject: input.subject,
      message: input.message,
      reply_email: input.replyEmail || undefined,
      website: input.website ?? "",
    }),
  });
  const json = await res.json().catch(() => ({ detail: "Unknown error" }));
  if (!res.ok) {
    const { message, code } = parseErrorDetail((json as { detail?: unknown }).detail, res.status);
    if (res.status === 429) {
      throw new ContactAPIError(429, CONTACT_RATE_LIMITED_MESSAGE, code ?? "rate_limited");
    }
    throw new ContactAPIError(res.status, message, code);
  }
  return json as ContactSubmissionResult;
}
