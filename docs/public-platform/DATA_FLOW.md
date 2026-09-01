# Data flow — auth / handle / profile / public data

Status: Batch P1 (auth + profile/handle) + Batch P3 (public read flow, added
below) + Batch P4 (matchmaking/settlement/H2H transaction flow — see the
dedicated `COMPETITIVE_STATE_MACHINE.md` rather than duplicated here; this
file stays scoped to auth/profile/public-read).

## Sign-in → session → authenticated request

```
Browser                          Next.js (cookies)            FastAPI               Supabase
--------                          ------------------            -------               --------
signInWithGoogle() /
sendMagicLink() /
signInWithEmail()
  → client.auth.signIn*()  ───────────────────────────────────────────────────────►  Auth
                                                                                        │
  ◄──────────────────────── redirect to authCallbackUrl(next) ◄──────────────────────┘
  (PKCE code in URL, verifier
   already in a cookie from
   the signIn call)

GET /auth/callback?code=…&next=…
                              exchangeCodeForSession(code)  ─────────────────────────►  Auth
                                    session written to
                                    httpOnly cookies (createServerClient)
                              redirect → safeNext(next)

Every subsequent navigation
                              middleware.ts → updateSession()
                              refreshes the cookie session
                              before the route renders

Client component needs the      client.auth.getSession()
JWT for an API call:            (reads the cookie-backed
  getAccessToken()                session; memoized ~30s
                                 before exp)
  fetch(`${API_BASE}/api/v1/…`,
        {Authorization: `Bearer <jwt>`})  ───────────────────────────────────────►  FastAPI
                                                                                        │
                                                                       verify_access_token()
                                                                       (JWKS/ES256 or
                                                                        HS256 — app/core/auth.py)
                                                                                        │
                                                                       AuthSubject.sub
                                                                       (= auth.uid())
```

The FastAPI backend is a **separate origin** from the Next.js app. Cookies
authenticate the Next.js side (Server Components, middleware); the bearer JWT
independently authenticates every FastAPI request. Neither trusts a
client-submitted user id — the JWT `sub` claim, verified against Supabase's own
signing keys, is the only identity FastAPI ever acts on.

## Handle read (page load / onboarding check)

```
ProfilePage / HandleOnboardingPrompt
  → getAccessToken()
  → fetchProfile(token)
      GET /api/v1/profiles/me  (Authorization: Bearer <jwt>)
        RequiredAuth  → AuthSubject.sub
        ProfileRepoDep.get_or_create_profile(auth.sub)
          db_pool present?  → PostgresProfileRepository
              INSERT … ON CONFLICT (auth_sub) DO UPDATE … RETURNING *
              (idempotent upsert-by-auth_sub; never creates a second row
               for the same identity)
          db_pool absent?   → MemoryProfileRepository (process-local dict,
              keyed by auth_sub — correct within one process, empty after
              a restart)
      ← ProfileResponse { handle, display_name, … }
  handle present  → prompt hidden
  handle absent   → onboarding prompt shown (dismissible, session-scoped)
```

## Handle write (onboarding save / profile page save)

```
HandleOnboardingPrompt / ProfilePage
  → updateProfile(token, {handle})
      PUT /api/v1/profiles/me
        UpdateProfileRequest.validate_handle()
          — lowercases, checks HANDLE_RE (3–20 chars, alnum start/end),
            RESERVED_HANDLES (exact match), IMPERSONATION_SUBSTRINGS /
            PROFANITY_SUBSTRINGS (leet-folded substring match)
        ProfileRepoDep.update_profile(auth.sub, {handle: …})
          Postgres: UPDATE profiles SET handle=…, updated_at=NOW()
                    WHERE auth_sub = $auth.sub
                    → UniqueViolationError on the generated
                      normalized_handle column (case-insensitive)
                      → HandleTakenError → 409 {"detail":"handle_taken"}
          Memory:   linear scan for a case-insensitive collision among
                    all in-process profiles → same HandleTakenError
      ← ProfileResponse (durable only if db_pool is set — see AUDIT.md §2)
```

## What actually persists the handle across sessions

The handle is durable **if and only if** `app.state.db_pool is not None` at
the moment the request is served, i.e. `PEAK3_DATABASE_URL` was set at process
startup. This is the single fork point for durability — not RLS, not the
frontend, not the onboarding component. See `AUDIT.md` §2 for the
confirmed root cause and fix, and `PRODUCTION_CHECKLIST.md` for what must be
true of a real deployment.

## Public read flow (Batch P3) — no cookies, no bearer token

```
Anonymous browser                              FastAPI                           Postgres
------------------                              -------                           --------
GET /u/handle  (Next.js Server Component,
  no Authorization header at all)
  → fetch(`${API}/api/v1/profiles/{handle}`)
                                            → get_public_profile(handle, auth=None)
                                                → profile_repo.get_profile_by_handle(handle)
                                                                                → SELECT * FROM profiles
                                                                                  WHERE normalized_handle = $1
                                                                                  (service-role connection —
                                                                                   bypasses RLS; ownership is
                                                                                   enforced in this function,
                                                                                   not by the database role)
                                                → 404 if none / 403 if private
                                                → PublicProfileResponse(...)
                                                  (handle, display_name, bio,
                                                   avatar_key, joined_at ONLY —
                                                   never id/region/is_public/
                                                   history_public/auth_sub)
  ← JSON, minimal projection

GET /arena/ranked/{mode}/leaderboard
  → fetch(`${API}/api/v1/ranked/queues/{mode}/leaderboard`)
                                            → get_leaderboard(mode, ...)
                                                → rating_repo.get_leaderboard(...)
                                                                                → SELECT ... FROM queue_ratings
                                                → for each established rating:
                                                    profile_repo.get_profile_by_auth_sub(owner_sub)
                                                                                → SELECT ... FROM profiles
                                                                                  WHERE auth_sub = $1
                                                    skip if no handle
                                                → LeaderboardEntry(handle=..., rating, rd, division)
                                                  (owner_sub is never constructed into the response —
                                                   Batch P3 fix, see PUBLIC_DATA_CONTRACT.md §7)
  ← JSON, handle-identified entries only
```

Every public route in scope this batch follows the same two-step shape:
resolve the row via the API's own service-role Postgres connection (which,
per Batch P2's `AUDIT.md`, bypasses RLS by construction), then hand-narrow
the result through an explicit response model before it ever reaches the
wire. RLS is real defense-in-depth against a *direct* PostgREST/client
connection (proven in `test_rls_policies.py`), but for traffic that goes
through this API — which is 100% of what a browser actually does — the
response model, not RLS, is the last line of the trust boundary. See
`PUBLIC_DATA_CONTRACT.md` for the full audit of that boundary across every
public surface.

## Batch P5 review — no data-flow change

P5 (production deployment readiness) touched deployment configuration and
its own test coverage only — no route, response model, or data-flow path
changed. The trust-boundary shape described above (API's service-role
connection → explicit response model → wire) is unchanged and re-confirmed
accurate by this batch's public-URL/share-link audit
(`PRODUCTION_CHECKLIST.md` §Public URL / share-link audit), which traced
every share-URL-constructing code path and found the same
relative-path-from-API + browser-`window.location.origin` pattern
throughout — no code path bakes in or trusts a server-provided absolute
host.
