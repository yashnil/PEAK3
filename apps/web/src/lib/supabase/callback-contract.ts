/**
 * What `/auth/callback` should do, as a pure function of its query string.
 *
 * WHY THIS IS SEPARATE FROM THE ROUTE. The route handler's job is I/O:
 * construct a request-scoped Supabase client, call it, emit a 303. The
 * *decisions* — which grant is present, whether the provider reported an error,
 * where the user is allowed to land — are pure, and pure code can be tested
 * exhaustively without a Supabase project, a browser, or a live Google client.
 * Google is not even enabled on this project yet (`external: ["email"]`), so a
 * design where the contract is only observable through a live provider would be
 * a design with no tests at all.
 *
 * THE CONTRACT, in full:
 *
 *   GET /auth/callback?<params>
 *
 *   in   code=…                 PKCE authorization code. Google OAuth, and the
 *                               magic-link flow once Supabase's `/verify`
 *                               endpoint has bounced through to us.
 *        token_hash=… & type=…  The `{{ .TokenHash }}` email-template variant
 *                               (`verifyOtp`), which some projects still emit.
 *        error / error_code /   Provider or Supabase-side failure. Present
 *          error_description    INSTEAD of a grant, never alongside one.
 *        next=/some/path        Desired destination, attacker-controllable,
 *                               validated by `safeNext`.
 *
 *   out  303 → /auth/complete?next=<safe>     grant accepted
 *        303 → /auth/auth-code-error?…        anything else
 *
 * WHY 303 AND NOT 307. The response to a GET that just mutated session state
 * should be a "see other" so no client re-issues the exchange; a `code` is
 * single-use and a re-issued exchange is a guaranteed, confusing failure.
 *
 * WHY `/auth/complete` AND NOT THE DESTINATION DIRECTLY. The guest-claim call
 * (plan §2.5) is authenticated by the httponly `peak3_anon` cookie, which is
 * scoped to the *API* origin — a server-side fetch from this route handler does
 * not carry it. The claim must therefore be made by the browser with
 * `credentials: "include"`, and `/auth/complete` is the client surface that
 * makes it and reports what was imported.
 *
 * Owner: Track B (auth surface).
 */

import { safeNext } from "./safe-next";

/** Where a successful callback hands off to. */
export const AUTH_COMPLETE_PATH = "/auth/complete";

/** Where every failure lands. A real page, not a blank screen. */
export const AUTH_ERROR_PATH = "/auth/auth-code-error";

/**
 * The OTP types Supabase may send with `token_hash`.
 *
 * An allowlist rather than a passthrough: `type` is attacker-controllable and
 * feeds `verifyOtp`, and there is no reason to let an unrecognised string reach
 * the SDK.
 */
export const ALLOWED_OTP_TYPES = [
  "magiclink",
  "signup",
  "invite",
  "recovery",
  "email_change",
  "email",
] as const;

export type AllowedOtpType = (typeof ALLOWED_OTP_TYPES)[number];

export function isAllowedOtpType(value: string | null): value is AllowedOtpType {
  return value !== null && (ALLOWED_OTP_TYPES as readonly string[]).includes(value);
}

/** Machine-readable failure reasons. Rendered as human copy by the error page. */
export type CallbackErrorReason =
  | "provider_error"
  | "missing_grant"
  | "unsupported_otp_type"
  | "exchange_failed"
  | "not_configured";

export type CallbackPlan =
  | { kind: "exchange"; code: string; next: string }
  | { kind: "verify_otp"; tokenHash: string; otpType: AllowedOtpType; next: string }
  | {
      kind: "error";
      reason: CallbackErrorReason;
      /** Supabase's own `error` / `error_code`, when it sent one. */
      providerCode?: string;
      /** Supabase's `error_description`, when it sent one. */
      description?: string;
      next: string;
    };

/**
 * Decide what the callback should do.
 *
 * Order matters. An explicit provider error is honoured first even if a stale
 * `code` is also present, because "the user pressed Cancel on Google's consent
 * screen" must never be retried as if it were a grant.
 */
export function planCallback(params: URLSearchParams): CallbackPlan {
  const next = safeNext(params.get("next") ?? params.get("returnTo"));

  const providerError =
    params.get("error") ?? params.get("error_code") ?? null;
  if (providerError) {
    return {
      kind: "error",
      reason: "provider_error",
      providerCode: providerError,
      description: params.get("error_description") ?? undefined,
      next,
    };
  }

  const code = params.get("code");
  if (code) return { kind: "exchange", code, next };

  const tokenHash = params.get("token_hash");
  if (tokenHash) {
    const otpType = params.get("type");
    if (!isAllowedOtpType(otpType)) {
      return { kind: "error", reason: "unsupported_otp_type", providerCode: otpType ?? undefined, next };
    }
    return { kind: "verify_otp", tokenHash, otpType, next };
  }

  return { kind: "error", reason: "missing_grant", next };
}

/**
 * The relative destination for a plan, ready to be resolved against an origin.
 *
 * Returned as a string rather than a `URL` so the route handler owns the origin
 * decision (which has to account for `x-forwarded-host` behind a proxy) and this
 * module stays origin-free and trivially testable.
 */
export function callbackRedirectPath(
  plan: CallbackPlan,
  overrides: { reason?: CallbackErrorReason; description?: string } = {},
): string {
  if (plan.kind !== "error" && !overrides.reason) {
    const search = new URLSearchParams({ next: plan.next });
    return `${AUTH_COMPLETE_PATH}?${search.toString()}`;
  }

  const reason = overrides.reason ?? (plan.kind === "error" ? plan.reason : "exchange_failed");
  const search = new URLSearchParams({ reason, next: plan.next });
  const providerCode = plan.kind === "error" ? plan.providerCode : undefined;
  if (providerCode) search.set("code", providerCode);
  const description =
    overrides.description ?? (plan.kind === "error" ? plan.description : undefined);
  if (description) search.set("description", description);
  return `${AUTH_ERROR_PATH}?${search.toString()}`;
}
