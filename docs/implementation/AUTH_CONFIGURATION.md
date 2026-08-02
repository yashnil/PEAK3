# PEAK3 Arena — Supabase Auth configuration

Exact manual steps to configure Google sign-in and email magic link for a
PEAK3 Arena environment.

**This document contains no secret values and never will.** Where a secret is
required it names the field and where it comes from. Do not paste keys,
passwords, or tokens into this file, into a commit, or into a chat transcript.

---

## 0. Read this first: your project probably has no "JWT secret"

Supabase projects created after the asymmetric signing-key rollout sign user
access tokens with a **private key held by the project** and publish the
matching **public** key set at:

```
{SUPABASE_URL}/auth/v1/.well-known/jwks.json
```

Such a project has **no symmetric JWT secret**, and none is needed. The API
verifies these tokens from the public key set with nothing secret configured.

Check which regime you are on — this is public information, safe to run:

```bash
curl -s https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json \
  | python3 -c 'import sys,json; print([{k:v for k,v in d.items() if k in ("kty","alg","kid","use")} for d in json.load(sys.stdin)["keys"]])'
```

* Returns one or more keys with `"alg": "ES256"` (or `RS256`/`EdDSA`)
  → **asymmetric**. Set `PEAK3_SUPABASE_URL`. Leave `PEAK3_SUPABASE_JWT_SECRET`
  unset.
* Returns nothing usable and your project predates the rollout
  → **legacy HS256**. Set `PEAK3_SUPABASE_JWT_SECRET` from
  *Dashboard → Project Settings → API → JWT Secret*.

The repo's hosted development project (`zwgzxlqzhpwwgbjmrpow`) publishes a
single **ES256 / EC P-256** key, so it is asymmetric and needs no secret.

Confirm what the running API can actually do:

```bash
curl -s localhost:8000/health/readiness | python3 -m json.tool
# -> "auth_verification_mode": "jwks" | "hs256" | "jwks+hs256" | "unconfigured"
```

`unconfigured` is a **hard startup error** when `PEAK3_DEBUG=False`. Previously
it was one WARNING line and every authenticated request 401'd for everyone.

---

## 1. Environment variables

Use these exact names. Do not introduce competing ones.

### API — `apps/api/.env`

| Variable | Required | Value |
|---|---|---|
| `PEAK3_SUPABASE_URL` | **yes** (asymmetric) | `https://<project-ref>.supabase.co` |
| `PEAK3_SUPABASE_JWT_SECRET` | legacy only | Dashboard → Settings → API → JWT Secret |
| `PEAK3_SUPABASE_JWKS_URL` | no | Override; derived from `PEAK3_SUPABASE_URL` |
| `PEAK3_SUPABASE_JWT_ISSUER` | no | Override; derived from `PEAK3_SUPABASE_URL` |
| `PEAK3_SUPABASE_JWT_AUDIENCE` | no | Defaults to `authenticated` |
| `PEAK3_SUPABASE_ANON_KEY` | yes | Anon / publishable key (public by design) |
| `PEAK3_DATABASE_URL` | yes in prod | Dashboard → Settings → Database → Connection string |
| `PEAK3_SIGNING_SECRET` | **yes in prod** | Your own high-entropy secret. Signs the `peak3_anon` guest-ownership cookie. Startup now **fails** if this is still the public default and `PEAK3_DEBUG=False`. |
| `PEAK3_CORS_ORIGINS` | yes | JSON list, e.g. `["https://peak3.example"]` |

### Web — `apps/web/.env.local`

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon / publishable key |
| `NEXT_PUBLIC_API_URL` | Where the FastAPI app is reachable |

**Never** put a service-role or secret key in any `NEXT_PUBLIC_*` variable —
those are compiled into the browser bundle. `apps/api/tests/test_service_role_not_bundled.py`
scans the built `.next/` output and fails if a `service_role` JWT appears; note
it **skips when `.next/` has not been built**, so run `npm run build` before
relying on it.

---

## 2. Supabase Dashboard — URL configuration

*Authentication → URL Configuration*

**Site URL** — one value, the canonical origin:

| Environment | Site URL |
|---|---|
| Local | `http://localhost:3000` |
| Production | `https://your-production-domain` |

**Redirect URLs (allowlist)** — add every origin that may complete a sign-in.
Supabase rejects any `redirectTo`/`emailRedirectTo` not matched here, which is
the primary defence against an open redirect at the provider boundary:

```
http://localhost:3000/auth/callback
https://your-production-domain/auth/callback
https://*-your-team.vercel.app/auth/callback     # preview deploys, if used
```

Keep the list minimal. Wildcards match a single path segment; do not add a bare
`http://localhost:3000/**` in production projects.

The app applies a **second, independent** check: every `next`/`returnTo`
parameter is passed through a `safeNext()` helper that accepts only same-origin
paths beginning with exactly one `/`, and rejects `//host`, `/\host`, `\\host`,
any `scheme:` prefix, and anything that URL-parses to an absolute URL after
decoding. Provider allowlisting and application validation are both required;
neither alone is sufficient.

---

## 3. Google sign-in

### 3a. Google Cloud Console

1. *APIs & Services → OAuth consent screen*. Choose **External**, publish when
   ready. Add the app name, support email, and the authorised domain
   (`supabase.co` plus your production domain).
2. Scopes: `openid`, `email`, `profile`. Nothing more — PEAK3 needs no Google
   API access beyond identity.
3. *Credentials → Create credentials → OAuth client ID → Web application*.
4. **Authorised JavaScript origins**:
   ```
   http://localhost:3000
   https://your-production-domain
   ```
5. **Authorised redirect URI** — this is Supabase's callback, *not* your app's:
   ```
   https://<project-ref>.supabase.co/auth/v1/callback
   ```
   A mismatch here is the single most common cause of `redirect_uri_mismatch`.
6. Copy the **Client ID** and **Client Secret**. Do not commit them, do not
   paste them into a terminal that logs, and do not put them in `.env` files
   read by the web app.

### 3b. Supabase Dashboard

*Authentication → Providers → Google*

1. Toggle **Enable Sign in with Google**.
2. Paste **Client ID** and **Client Secret** from step 3a.
3. Leave *Skip nonce check* off.
4. Save.

### 3c. Verify it is on

```bash
curl -s -H "apikey: $PEAK3_SUPABASE_ANON_KEY" \
  https://<project-ref>.supabase.co/auth/v1/settings \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(sorted(k for k,v in d["external"].items() if v))'
```

You want `google` in that list.

> **Current state of the hosted development project:** this returns
> `['email']` — **Google is not enabled**. All Google code, redirect handling,
> and tests are implemented and verified against a mocked provider; completing
> steps 3a–3b is the only remaining work for live Google sign-in. No credential
> was read, requested, or fabricated to reach this state.

---

## 4. Email magic link

*Authentication → Providers → Email*

1. **Enable Email provider**: on.
2. **Confirm email**: on. (`mailer_autoconfirm` must stay `false` — turning it
   on would let anyone sign in as any address they can type.)
3. **Enable email OTP / magic link**: on.
4. **Secure email change**: on (requires confirmation on both addresses).
5. OTP expiry: 3600 s or less. Shorter is better; the default 24 h is long for
   a link that lands in a mailbox.

### 4a. Email templates

*Authentication → Email Templates → Magic Link*

The redirect must route through the app's callback so the PKCE code is
exchanged and the guest-state claim runs:

```html
<h2>Sign in to PEAK3 Arena</h2>
<p>Click below to sign in. This link expires in one hour and can be used once.</p>
<p><a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=magiclink&next=/">
  Sign in to PEAK3 Arena
</a></p>
<p>If you did not request this, you can ignore this email.</p>
```

Keep `{{ .SiteURL }}` — hardcoding an origin breaks every non-production
environment. Any `next` you template in is still re-validated by `safeNext()`.

### 4b. SMTP — required before any real traffic

Supabase's built-in email sender is **rate-limited to a few messages per hour
and is not for production**. Sign-ins will silently stop working under load.

*Project Settings → Authentication → SMTP Settings* → enable custom SMTP:

| Field | Notes |
|---|---|
| Sender email | An address on a domain you control |
| Sender name | `PEAK3 Arena` |
| Host / Port | Provider's SMTP host, port 587 (STARTTLS) |
| Username / Password | From the provider. Store in the dashboard only. |

Recommended providers: Resend, Postmark, or Amazon SES. Whichever you pick,
configure **SPF**, **DKIM**, and **DMARC** on the sending domain — magic links
land in spam without them, which presents to users as "sign-in is broken".

Then raise *Authentication → Rate Limits → Emails per hour* from the built-in
default to something matched to real traffic.

---

## 5. Database schema

The API's durable storage requires the migrations in `supabase/migrations/`.
Apply them with the Supabase CLI:

```bash
npx supabase link --project-ref <project-ref>   # once, prompts for the DB password
npx supabase migration list                      # local vs remote
npx supabase db push                             # apply
```

`db push` is the only supported path. Do not hand-apply SQL to a hosted
project — `scripts/validate_migrations.py` enforces ordering, forward-reference
safety, and policy uniqueness across the whole chain, and a hand-applied file
silently breaks that guarantee.

---

## 6. Verification checklist

Run in order. Every step is observable; none requires reading a secret.

```bash
# 1. Which signing regime the project uses (public key material only)
curl -s https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json | head -c 200

# 2. Which providers are enabled
curl -s -H "apikey: $ANON" https://<project-ref>.supabase.co/auth/v1/settings \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(sorted(k for k,v in d["external"].items() if v), "autoconfirm:", d["mailer_autoconfirm"])'

# 3. What the API can verify
curl -s localhost:8000/health/readiness | python3 -m json.tool | grep auth_verification_mode

# 4. Token verification, including a live check of the real published key set
cd apps/api && PEAK3_SUPABASE_URL=https://<project-ref>.supabase.co \
  python -m pytest tests/test_auth_jwks.py -q

# 5. Migrations applied
npx supabase migration list
```

Then, in a browser:

1. `/` loads and is playable **with no sign-in** — there must be no auth wall
   before first play.
2. `Sign in` appears in the global nav.
3. Google sign-in returns to the exact page you left, not to `/`.
4. Magic link: request → email arrives → link returns you signed in.
5. A tampered `?next=//evil.example` falls back to `/`.
6. After sign-in, guest work done before signing in appears in your history,
   and the UI states what was imported.
7. Sign out clears the session and any private cached data.

---

## 7. Security notes

* **Nothing secret reaches the browser.** Only `NEXT_PUBLIC_SUPABASE_URL` and
  the anon/publishable key are exposed, both public by design.
* **The API never trusts a client-submitted user id.** Identity comes from a
  verified JWT `sub`, or from the HMAC-signed httponly `peak3_anon` cookie.
* **Guest ownership is a server-side token.** The claim flow accepts only that
  signed cookie — never a localStorage run id.
* **Audience and issuer are verified** on the asymmetric path. The legacy HS256
  path verified neither, so any holder of the shared secret was accepted.
* **Only asymmetric algorithms are allowed on the JWKS path**, so a token
  cannot downgrade itself into having a public key treated as an HMAC secret.
* **Rotate `PEAK3_SIGNING_SECRET` separately** from anything Supabase issues.
  It signs guest-ownership cookies; rotating it invalidates outstanding guest
  sessions, which is the intended blast radius.
* If a Google client secret or database password is ever exposed, rotate it in
  the provider console first, then update the dashboard. Do not attempt to
  scrub it from history as the primary remedy.
