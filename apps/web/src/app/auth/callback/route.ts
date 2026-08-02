/**
 * `GET /auth/callback` — the OAuth / magic-link landing point.
 *
 * WHAT THIS REPLACES. A client component that ran
 * `exchangeCodeForSession(window.location.href)` in a `useEffect`. Three things
 * were wrong with that, in increasing order of severity:
 *
 *   1. It rendered a spinner and a full React tree for a redirect that should be
 *      one HTTP response, so the authorization code sat in the address bar (and
 *      the browser history, and any referrer) for the length of a page load.
 *   2. It handled `?code=` and nothing else. Supabase sends `?error=` and
 *      `?error_description=` when a user cancels a consent screen or a magic
 *      link has expired, and those users got a spinner that never stopped.
 *   3. Its claim call was a *relative* `fetch("/api/v1/auth/claim")` wrapped in
 *      `catch {}`. Every other call in the app uses `NEXT_PUBLIC_API_URL`, so on
 *      any split deployment this 404'd and the failure was swallowed — a guest
 *      who signed in lost their history and was told nothing.
 *
 * WHAT IT DOES NOW. Reads the grant, exchanges it server-side (the PKCE verifier
 * is a cookie on this origin, so the server can complete the exchange), and
 * emits a single 303 to a validated destination. The decision logic is pure and
 * lives in `lib/supabase/callback-contract.ts`; this file is the I/O around it.
 *
 * THE CLAIM IS DELIBERATELY NOT HERE. See `lib/supabase/claim.ts`: the guest
 * credential is an httponly cookie scoped to the API origin, which a server-side
 * fetch from this handler does not carry. `/auth/complete` makes that call from
 * the browser and reports what it imported.
 *
 * `force-dynamic`: this route reads cookies and must never be prerendered or
 * cached — a cached redirect here would send the second visitor to the first
 * visitor's destination.
 *
 * Owner: Track B (auth surface).
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  callbackRedirectPath,
  planCallback,
} from "@/lib/supabase/callback-contract";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Hosts `x-forwarded-host` is allowed to name.
 *
 * Derived from configuration, never from the request. `NEXT_PUBLIC_SITE_URL`
 * is the canonical public origin when set; the request's own origin is always
 * acceptable because it is not attacker-controlled.
 */
function allowedForwardedHosts(request: NextRequest): Set<string> {
  const allowed = new Set<string>([request.nextUrl.host]);
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) {
    try {
      allowed.add(new URL(configured).host);
    } catch {
      // A malformed NEXT_PUBLIC_SITE_URL must not widen the allowlist.
    }
  }
  return allowed;
}

/**
 * The origin to redirect against.
 *
 * Behind a proxy (Vercel, a load balancer) `request.nextUrl.origin` is the
 * internal origin, and redirecting to it would send the user to an unroutable
 * host. `x-forwarded-host` is the public one.
 *
 * It is checked against an allowlist, not merely against `NODE_ENV`. Gating on
 * the environment alone assumes every production request traverses the proxy;
 * if the app is ever reachable directly — a misconfigured ingress, a preview
 * host, an internal route — a spoofed header would make this 303's `Location`
 * point at an attacker's origin, i.e. an open redirect issued by the product's
 * own domain. Session cookies are `Set-Cookie` for the real domain and would
 * not leak, but the redirect itself is the phishing primitive.
 *
 * An unrecognised forwarded host falls back to the request's own origin rather
 * than failing the sign-in: the user still lands somewhere real and same-origin.
 */
function publicOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (process.env.NODE_ENV === "production" && forwardedHost) {
    if (allowedForwardedHosts(request).has(forwardedHost)) {
      const proto = request.headers.get("x-forwarded-proto") === "http" ? "http" : "https";
      return `${proto}://${forwardedHost}`;
    }
  }
  return request.nextUrl.origin;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = publicOrigin(request);
  const plan = planCallback(request.nextUrl.searchParams);

  // 303 "See Other": the grant is single-use, and no client should ever be
  // tempted to re-issue this GET.
  const see = (path: string) => NextResponse.redirect(new URL(path, origin), 303);

  if (plan.kind === "error") {
    return see(callbackRedirectPath(plan));
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return see(callbackRedirectPath(plan, { reason: "not_configured" }));
  }

  const { error } =
    plan.kind === "exchange"
      ? await supabase.auth.exchangeCodeForSession(plan.code)
      : await supabase.auth.verifyOtp({
          type: plan.otpType,
          token_hash: plan.tokenHash,
        });

  if (error) {
    return see(
      callbackRedirectPath(plan, {
        reason: "exchange_failed",
        // Supabase's own message ("invalid flow state", "Email link is invalid
        // or has expired") is far more actionable than anything we could
        // invent, and it contains no secret.
        description: error.message,
      }),
    );
  }

  return see(callbackRedirectPath(plan));
}
