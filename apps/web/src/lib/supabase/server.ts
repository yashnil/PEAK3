/**
 * The server Supabase client, for Route Handlers and Server Components.
 *
 * NEXT 15 `cookies()` IS ASYNC, so this factory is async too. Awaiting it once
 * per request is the documented App Router shape; there is no module-level
 * singleton, because a client built around one request's cookie jar must never
 * be reused for another request.
 *
 * THE `setAll` TRY/CATCH IS NOT LAZINESS. A Server Component cannot write
 * cookies — Next throws if it tries. The refresh that would have written them is
 * performed by `middleware.ts` on the same navigation, so swallowing the throw
 * here loses nothing: the cookie is already being set on the response by the
 * middleware. Route Handlers *can* write, and there the branch never fires.
 *
 * SERVER-ONLY. This module imports `next/headers` and must never reach a client
 * bundle. It is imported by `app/auth/callback/route.ts` and by nothing else.
 *
 * Owner: Track B (auth surface).
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabaseConfigured } from "./config";

export type ServerSupabaseClient = ReturnType<typeof createServerClient>;

/**
 * A request-scoped server client, or `null` when Supabase is not configured.
 *
 * The null branch keeps the anonymous-only deployment mode working: a route
 * handler that finds `null` reports "auth is not configured" rather than
 * crashing with an unhelpful `Invalid supabaseUrl`.
 */
export async function createSupabaseServerClient(): Promise<ServerSupabaseClient | null> {
  if (!supabaseConfigured) return null;
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component — see the module docstring.
        }
      },
    },
  });
}
