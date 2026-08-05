/**
 * Shared client for GET/PUT /api/v1/profiles/me.
 *
 * Extracted out of app/(main)/profile/page.tsx so the handle-onboarding
 * prompt (components/profile/HandleOnboardingPrompt.tsx) doesn't duplicate
 * the same fetch/update logic against a second copy of the Profile shape —
 * one drifting out of sync with the API's actual fields (see
 * apps/api/app/models/profile.py::ProfileResponse) is exactly the kind of
 * bug that is invisible until a field is added or renamed on one side only.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface Profile {
  id: string;
  handle: string | null;
  display_name: string | null;
  bio: string | null;
  region: string | null;
  avatar_key: string | null;
  is_public: boolean;
  history_public: boolean;
  joined_at: string;
}

export interface ProfileUpdateInput {
  handle?: string;
  display_name?: string;
  bio?: string;
  region?: string;
  avatar_key?: string;
  is_public?: boolean;
  history_public?: boolean;
}

/** Thrown on a non-2xx response, carrying the API's own detail/message so a
 * caller can render the server's actual validation reason (e.g. "Handle
 * 'admin' is reserved.") instead of a generic failure string. */
export class ProfileAPIError extends Error {
  status: number;
  code: string | null;

  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = "ProfileAPIError";
    this.status = status;
    this.code = code;
  }
}

function messageFromDetail(detail: unknown): { message: string; code: string | null } {
  if (typeof detail === "string") return { message: detail, code: detail };
  if (Array.isArray(detail)) {
    // FastAPI's default 422 shape: a list of {loc, msg, type}. `msg` is the
    // pydantic ValueError text (e.g. "Value error, Handle must be 3-20
    // characters..."), which is the one place the actual validation reason
    // for a handle rejection lives.
    const messages = detail
      .map((e) => (e && typeof e === "object" && "msg" in e ? String((e as { msg: unknown }).msg) : null))
      .filter((m): m is string => !!m);
    if (messages.length > 0) return { message: messages.join(" "), code: null };
  }
  if (detail && typeof detail === "object") {
    const d = detail as { message?: string; error_code?: string };
    if (d.message) return { message: d.message, code: d.error_code ?? null };
  }
  return { message: "Request failed.", code: null };
}

export async function fetchProfile(token: string): Promise<Profile> {
  const res = await fetch(`${API_BASE}/api/v1/profiles/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const { message, code } = messageFromDetail(body.detail);
    throw new ProfileAPIError(res.status, message || "Failed to load profile.", code);
  }
  return res.json();
}

export async function updateProfile(token: string, data: ProfileUpdateInput): Promise<Profile> {
  const res = await fetch(`${API_BASE}/api/v1/profiles/me`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const { message, code } = messageFromDetail(body.detail);
    throw new ProfileAPIError(res.status, message || "Failed to update profile.", code);
  }
  return res.json();
}

/** Mirrors apps/api/app/models/profile.py's HANDLE_RE (3-20 chars,
 * start/end alnum, interior letters/digits/underscores) for an immediate
 * client-side hint. The server remains the source of truth — this never
 * replaces the real validation (reserved words, impersonation and
 * profanity guards, uniqueness are checked only server-side), it just
 * avoids a round trip for the most common typo (too short, bad character,
 * leading/trailing underscore). */
export const HANDLE_PATTERN = /^[a-z0-9][a-z0-9_]{1,18}[a-z0-9]$/;

export function handleLooksValid(handle: string): boolean {
  return HANDLE_PATTERN.test(handle.trim().toLowerCase());
}
