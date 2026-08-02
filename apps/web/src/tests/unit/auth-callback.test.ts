/**
 * The `/auth/callback` contract.
 *
 * WHY THIS IS TESTABLE AT ALL. Google is not enabled on the development
 * Supabase project (`external: ["email"]`) and magic-link mail is not reachable
 * from CI, so no automated run can complete a real provider round trip. The
 * decisions the callback makes are therefore split into a pure module
 * (`callback-contract.ts`) and tested exhaustively here; the route handler that
 * wraps them is tested below against a stubbed Supabase client.
 *
 * WHAT EACH GROUP PINS:
 *   - Google OAuth returns `?code=` → PKCE exchange.
 *   - A magic link returns `?code=` OR `?token_hash=&type=` → the second form
 *     must not fall through to "no grant", which is what a `code`-only handler
 *     did.
 *   - `?error=` must never be retried as if it were a grant, and must land on a
 *     real page rather than a spinner that never resolves.
 *   - `next` is attacker-controllable at every step and is `safeNext`-gated.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  callbackRedirectPath,
  isAllowedOtpType,
  planCallback,
  AUTH_COMPLETE_PATH,
  AUTH_ERROR_PATH,
} from "@/lib/supabase/callback-contract";

function plan(query: string) {
  return planCallback(new URLSearchParams(query));
}

/* ================================================================== */
/* planCallback                                                        */
/* ================================================================== */

describe("planCallback — Google OAuth", () => {
  it("plans a PKCE exchange for the code Google sends back", () => {
    expect(plan("code=abc123&next=%2Fprofile")).toEqual({
      kind: "exchange",
      code: "abc123",
      next: "/profile",
    });
  });

  it("defaults to the homepage when no destination was requested", () => {
    expect(plan("code=abc123")).toEqual({ kind: "exchange", code: "abc123", next: "/" });
  });

  it("accepts `returnTo` as an alias, matching the app's own convention", () => {
    expect(plan("code=abc&returnTo=%2Farena%2Franked")).toMatchObject({
      next: "/arena/ranked",
    });
  });

  it("treats a cancelled consent screen as an error, not a retryable grant", () => {
    // Supabase forwards Google's `access_denied` with no code. A handler that
    // checked for `code` first and `error` second would have shown a spinner.
    const result = plan(
      "error=access_denied&error_description=The+user+denied+access&next=%2Fprofile",
    );
    expect(result).toEqual({
      kind: "error",
      reason: "provider_error",
      providerCode: "access_denied",
      description: "The user denied access",
      next: "/profile",
    });
  });

  it("prefers a reported error over a stale code present in the same URL", () => {
    expect(plan("code=stale&error=server_error")).toMatchObject({
      kind: "error",
      reason: "provider_error",
    });
  });

  it("reads `error_code` when Supabase sends that spelling instead", () => {
    expect(plan("error_code=otp_expired")).toMatchObject({
      kind: "error",
      providerCode: "otp_expired",
    });
  });
});

describe("planCallback — magic link", () => {
  it("plans a PKCE exchange for the code form", () => {
    expect(plan("code=magic-code&next=%2Fdaily")).toMatchObject({
      kind: "exchange",
      code: "magic-code",
    });
  });

  it("plans an OTP verification for the token_hash form", () => {
    expect(plan("token_hash=pkce_hash&type=magiclink&next=%2Fdaily")).toEqual({
      kind: "verify_otp",
      tokenHash: "pkce_hash",
      otpType: "magiclink",
      next: "/daily",
    });
  });

  it("handles the signup-confirmation and recovery variants of the same link", () => {
    expect(plan("token_hash=h&type=signup")).toMatchObject({ otpType: "signup" });
    expect(plan("token_hash=h&type=recovery")).toMatchObject({ otpType: "recovery" });
    expect(plan("token_hash=h&type=email_change")).toMatchObject({ otpType: "email_change" });
  });

  it("refuses an OTP type it does not recognise instead of forwarding it to the SDK", () => {
    expect(plan("token_hash=h&type=phone_change")).toMatchObject({
      kind: "error",
      reason: "unsupported_otp_type",
      providerCode: "phone_change",
    });
    expect(plan("token_hash=h")).toMatchObject({ reason: "unsupported_otp_type" });
  });

  it("reports an expired link as a provider error, with the reason intact", () => {
    const result = plan(
      "error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    );
    expect(result).toMatchObject({
      kind: "error",
      reason: "provider_error",
      providerCode: "access_denied",
      description: "Email link is invalid or has expired",
    });
  });
});

describe("planCallback — nothing usable", () => {
  it("reports a bare visit as a missing grant", () => {
    expect(plan("")).toEqual({ kind: "error", reason: "missing_grant", next: "/" });
  });

  it("ignores an empty code, which is not a grant", () => {
    expect(plan("code=")).toMatchObject({ reason: "missing_grant" });
  });
});

describe("planCallback — return-URL safety", () => {
  const hostile = [
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "https://evil.example",
    "javascript:alert(1)",
    "/%2f%2fevil.example",
  ];

  for (const value of hostile) {
    it(`refuses to carry ${JSON.stringify(value)} through the exchange`, () => {
      const params = new URLSearchParams({ code: "abc", next: value });
      expect(planCallback(params).next).toBe("/");
    });

    it(`refuses to carry ${JSON.stringify(value)} through an error`, () => {
      const params = new URLSearchParams({ error: "access_denied", next: value });
      expect(planCallback(params).next).toBe("/");
    });
  }
});

/* ================================================================== */
/* callbackRedirectPath                                                */
/* ================================================================== */

describe("callbackRedirectPath", () => {
  it("sends a successful exchange to the claim interstitial, carrying the destination", () => {
    const path = callbackRedirectPath(plan("code=abc&next=%2Fprofile"));
    expect(path).toBe(`${AUTH_COMPLETE_PATH}?next=%2Fprofile`);
  });

  it("sends a successful OTP verification to the same place", () => {
    const path = callbackRedirectPath(plan("token_hash=h&type=magiclink"));
    expect(path).toBe(`${AUTH_COMPLETE_PATH}?next=%2F`);
  });

  it("sends a provider error to the error page with the provider's own words", () => {
    const path = callbackRedirectPath(
      plan("error=access_denied&error_description=denied&next=%2Fprofile"),
    );
    const url = new URL(path, "http://localhost");
    expect(url.pathname).toBe(AUTH_ERROR_PATH);
    expect(url.searchParams.get("reason")).toBe("provider_error");
    expect(url.searchParams.get("code")).toBe("access_denied");
    expect(url.searchParams.get("description")).toBe("denied");
    expect(url.searchParams.get("next")).toBe("/profile");
  });

  it("lets the route override a successful plan when the SDK call fails", () => {
    // This is the "the code was well-formed but Supabase rejected it" path —
    // an expired or already-redeemed code.
    const path = callbackRedirectPath(plan("code=abc&next=%2Fprofile"), {
      reason: "exchange_failed",
      description: "invalid flow state, no valid flow state found",
    });
    const url = new URL(path, "http://localhost");
    expect(url.pathname).toBe(AUTH_ERROR_PATH);
    expect(url.searchParams.get("reason")).toBe("exchange_failed");
    expect(url.searchParams.get("description")).toBe(
      "invalid flow state, no valid flow state found",
    );
    expect(url.searchParams.get("next")).toBe("/profile");
  });

  it("never emits a `next` it did not validate", () => {
    const path = callbackRedirectPath(plan("code=abc&next=https%3A%2F%2Fevil.example"));
    expect(new URL(path, "http://localhost").searchParams.get("next")).toBe("/");
  });
});

describe("isAllowedOtpType", () => {
  it("allows exactly the Supabase email types PEAK3 can receive", () => {
    for (const type of ["magiclink", "signup", "invite", "recovery", "email_change", "email"]) {
      expect(isAllowedOtpType(type)).toBe(true);
    }
  });

  it("rejects anything else, including null", () => {
    for (const type of ["sms", "phone_change", "", "MAGICLINK", null]) {
      expect(isAllowedOtpType(type)).toBe(false);
    }
  });
});

/* ================================================================== */
/* The route handler                                                   */
/* ================================================================== */

const exchangeCodeForSession = vi.fn();
const verifyOtp = vi.fn();
const createSupabaseServerClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: (...args: unknown[]) => createSupabaseServerClient(...args),
}));

async function callRoute(url: string) {
  const { GET } = await import("@/app/auth/callback/route");
  const { NextRequest } = await import("next/server");
  return GET(new NextRequest(new Request(url)));
}

describe("GET /auth/callback", () => {
  beforeEach(() => {
    exchangeCodeForSession.mockReset().mockResolvedValue({ error: null });
    verifyOtp.mockReset().mockResolvedValue({ error: null });
    createSupabaseServerClient
      .mockReset()
      .mockResolvedValue({ auth: { exchangeCodeForSession, verifyOtp } });
  });

  it("exchanges a Google OAuth code and redirects to the claim interstitial", async () => {
    const response = await callRoute(
      "http://localhost:3000/auth/callback?code=oauth-code&next=%2Fprofile",
    );

    expect(exchangeCodeForSession).toHaveBeenCalledWith("oauth-code");
    expect(verifyOtp).not.toHaveBeenCalled();
    // 303, not 307: the code is single-use and must never be re-issued.
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("http://localhost:3000");
    expect(location.pathname).toBe(AUTH_COMPLETE_PATH);
    expect(location.searchParams.get("next")).toBe("/profile");
  });

  it("verifies a token_hash magic link instead of exchanging it", async () => {
    const response = await callRoute(
      "http://localhost:3000/auth/callback?token_hash=hash-1&type=magiclink",
    );

    expect(verifyOtp).toHaveBeenCalledWith({ type: "magiclink", token_hash: "hash-1" });
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(new URL(response.headers.get("location")!).pathname).toBe(AUTH_COMPLETE_PATH);
  });

  it("routes an expired or already-used code to the error page, not a blank screen", async () => {
    exchangeCodeForSession.mockResolvedValue({
      error: { message: "invalid flow state, no valid flow state found" },
    });

    const response = await callRoute(
      "http://localhost:3000/auth/callback?code=stale&next=%2Fprofile",
    );

    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe(AUTH_ERROR_PATH);
    expect(location.searchParams.get("reason")).toBe("exchange_failed");
    // The provider's message survives, because "that link has expired" is
    // actionable and "something went wrong" is not.
    expect(location.searchParams.get("description")).toContain("invalid flow state");
    expect(location.searchParams.get("next")).toBe("/profile");
  });

  it("never touches Supabase when the provider reported an error", async () => {
    const response = await callRoute(
      "http://localhost:3000/auth/callback?error=access_denied&error_description=nope",
    );

    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(new URL(response.headers.get("location")!).pathname).toBe(AUTH_ERROR_PATH);
  });

  it("degrades to the error page when Supabase is not configured", async () => {
    createSupabaseServerClient.mockResolvedValue(null);
    const response = await callRoute("http://localhost:3000/auth/callback?code=abc");
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe(AUTH_ERROR_PATH);
    expect(location.searchParams.get("reason")).toBe("not_configured");
  });

  it("redirects same-origin even when handed a hostile destination", async () => {
    const response = await callRoute(
      "http://localhost:3000/auth/callback?code=abc&next=" +
        encodeURIComponent("//evil.example"),
    );
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("http://localhost:3000");
    expect(location.searchParams.get("next")).toBe("/");
  });
});

/* ================================================================== */
/* The redirect URL handed to the provider                             */
/* ================================================================== */

describe("authCallbackUrl — what Supabase must allow-list", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-for-tests");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("is absolute, and points at the route handler rather than a page", async () => {
    const { authCallbackUrl } = await import("@/lib/auth");
    expect(authCallbackUrl("/profile")).toBe(
      "http://localhost:3000/auth/callback?next=%2Fprofile",
    );
  });

  it("omits the parameter when the destination is the homepage", async () => {
    const { authCallbackUrl } = await import("@/lib/auth");
    expect(authCallbackUrl(null)).toBe("http://localhost:3000/auth/callback");
    expect(authCallbackUrl("/")).toBe("http://localhost:3000/auth/callback");
  });

  it("strips a hostile destination before it ever reaches the provider", async () => {
    // Otherwise it comes back looking like something Supabase vouched for.
    const { authCallbackUrl } = await import("@/lib/auth");
    for (const hostile of ["//evil.example", "https://evil.example", "/\\evil.example"]) {
      expect(authCallbackUrl(hostile)).toBe("http://localhost:3000/auth/callback");
    }
  });
});
