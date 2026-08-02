/**
 * The three environment values every Supabase surface reads, in one place.
 *
 * WHY A SEPARATE MODULE. Before this pass the URL/key pair was read inline in
 * `lib/auth.ts`, which is a `"use client"`-adjacent module that also carries the
 * E2E session backdoor. Middleware and route handlers need the same pair on the
 * server, and importing `auth.ts` from an Edge middleware would drag the whole
 * browser client (and the test backdoor) into the Edge bundle. This module has
 * no imports at all, so every runtime — browser, Node route handler, Edge
 * middleware — can read the config without pulling in anything else.
 *
 * NAMES ARE FROZEN. `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
 * and `NEXT_PUBLIC_API_URL` are the only names used anywhere in the app; do not
 * introduce a competing spelling. `process.env.X` is written out literally
 * rather than indexed, because Next.js inlines these at build time only when
 * the property access is statically analysable.
 *
 * Owner: Track B (auth surface).
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * The PEAK3 API origin.
 *
 * Every authenticated call in the app already goes through this value; the auth
 * callback used to be the one exception (it POSTed a relative
 * `/api/v1/auth/claim`, which 404s the moment the API is not co-hosted with the
 * web app — and the surrounding `catch {}` swallowed it silently).
 */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/**
 * True when both Supabase values are present, i.e. there is a real project to
 * talk to. This — and only this — may gate the construction of a Supabase
 * client (browser, server or Edge middleware): `createServerClient("", "")`
 * throws `Invalid supabaseUrl`, so a surface that renders without credentials
 * must never reach one.
 */
export const supabaseCredentialsPresent =
  SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;

/**
 * E2E AUTH MODE — the one sanctioned way to render the auth surface with no
 * hosted project behind it.
 *
 * WHY IT EXISTS. `supabaseCredentialsPresent` was doing two unrelated jobs: it
 * decided whether a client could be constructed (correct) *and* whether the
 * sign-in page, the header account control and the mobile account section
 * existed at all (a bug in disguise). A developer with `.env.local` therefore
 * ran a materially different application from CI, which checks out clean: ten
 * browser assertions about sign-in copy, `returnTo` propagation, initials
 * avatars and sign-out passed locally and failed in CI against a UI that had
 * been compiled out. Those tests never touch a provider — they assert markup
 * and hrefs — so the credentials were never the thing under test.
 *
 * WHAT IT CHANGES. Exactly one thing: the auth *surface* renders. No Supabase
 * client is created (`supabaseCredentialsPresent` is still false), so no
 * request reaches Google, a hosted project, or a mailbox; every real flow —
 * `signInWithGoogle`, `sendMagicLink`, `signInWithEmail` — still short-circuits
 * on the null client and returns "Auth not configured". PKCE, the JWKS-verified
 * bearer path, the callback route handler, `safeNext`/`returnTo` validation and
 * sign-out are untouched, because none of them read this flag.
 *
 * IT CANNOT ACTIVATE IN PRODUCTION. `process.env.NODE_ENV` is a build-time
 * constant Next.js inlines, so in a production build this whole expression
 * folds to `false` and the flag is dead code — the same gate that already
 * eliminates the `__peak3TestAuth` bridge in `lib/auth.ts`. Setting the
 * variable on a production deployment does nothing.
 *
 * IT IS SET IN ONE PLACE. `npm run dev:e2e`, which is the command
 * `playwright.config.ts` uses to start the web server. Nothing else sets it,
 * and `playwright.setup.ts` refuses to start the suite if the running server
 * does not report the surface as enabled.
 */
export const e2eAuthMode =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_PEAK3_E2E_AUTH === "1";

/**
 * True when the account surface (sign-in/sign-up pages, header account control,
 * mobile account section) should render.
 *
 * This is a *UI* predicate. It must never be used to decide whether a Supabase
 * client can be constructed — use `supabaseCredentialsPresent` for that.
 */
export const authSurfaceEnabled = supabaseCredentialsPresent || e2eAuthMode;
