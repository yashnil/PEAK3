# Data flow — auth / handle / profile

Status: Batch P1 scope only (auth + profile/handle). Other domains (saved
runs, matchmaking, H2H, leaderboards) pending later batches.

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
