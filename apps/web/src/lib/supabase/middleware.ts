/**
 * Session refresh on navigation.
 *
 * WHY MIDDLEWARE AT ALL. A Supabase access token lives about an hour. The
 * browser client refreshes it on a timer while a tab is open, but a cookie
 * session that is only refreshed in the browser is stale on the server the
 * moment a user returns to a backgrounded tab or opens a link cold — Server
 * Components and Route Handlers would then see a signed-in user as anonymous.
 * Calling `getUser()` here forces a refresh when the token is near expiry and
 * writes the rotated cookies onto the outgoing response, so every server runtime
 * on this navigation sees the same, current session.
 *
 * `getUser()`, NOT `getSession()`. `getSession()` reads and trusts the cookie;
 * `getUser()` revalidates it against the Supabase Auth server. On the server the
 * cookie is attacker-supplied input, so the revalidating call is the only one
 * whose answer means anything.
 *
 * THE RESPONSE DANCE. `NextResponse.next({ request })` must be re-created after
 * mutating `request.cookies`, and the rotated cookies must be copied onto it —
 * this is the exact sequence the `@supabase/ssr` App Router guide prescribes.
 * Deviating from it (returning a different response object, or forgetting the
 * copy) drops the refreshed token and logs users out at random intervals, which
 * is the failure mode this shape exists to avoid.
 *
 * Owner: Track B (auth surface).
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabaseConfigured } from "./config";

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request });

  // Anonymous-only deployments have no project to talk to. Passing through
  // untouched keeps guest play working with zero auth infrastructure.
  if (!supabaseConfigured) return supabaseResponse;

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        supabaseResponse = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
      },
    },
  });

  try {
    // Do not remove, and do not put code between the client construction and
    // this call: it is what triggers the refresh whose cookies `setAll` writes.
    await supabase.auth.getUser();
  } catch {
    // A Supabase outage must not 500 the whole site. The visitor is treated as
    // signed out for this navigation and the client retries on the next one.
  }

  return supabaseResponse;
}
