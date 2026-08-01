/**
 * Next.js middleware — refreshes the Supabase session cookie on navigation.
 *
 * FILE LOCATION. Next resolves middleware relative to the directory holding
 * `app/`, so an app at `src/app` requires `src/middleware.ts`. A file at the
 * package root is silently ignored, which for auth means "sessions quietly
 * expire on the server and nobody notices in development" — the worst possible
 * failure mode. Verified against the build output, which lists `ƒ Middleware`.
 *
 * WHAT IT DOES is entirely in `lib/supabase/middleware.ts`; this file is the
 * Next entry point and the matcher, nothing else.
 *
 * Owner: Track B (auth surface).
 */

import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Every path except the ones that can never carry a session worth
     * refreshing. Excluded, and why:
     *   _next/static, _next/image  — build output and the image optimiser
     *   favicon.ico, *.svg/png/…   — static assets requested in bulk per page
     *   api/                       — the Next API surface is unused; the real
     *                                API is a separate FastAPI origin
     * Refreshing on an asset request costs a round trip to Supabase Auth for
     * nothing, and on an image-heavy page that is dozens of them.
     */
    "/((?!_next/static|_next/image|api/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff|woff2|ttf|otf|css|js|map|txt|xml|json)$).*)",
  ],
};
