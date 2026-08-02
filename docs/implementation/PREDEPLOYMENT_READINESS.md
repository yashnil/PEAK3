# PEAK3 Arena — Predeployment Readiness

Status of this document: **partial**. It records what has been verified, with
the evidence, and states plainly what has not. Sections marked **UNVERIFIED**
are blockers for a real deploy, not omissions to be waved through.

Verified against branch `feature/predeployment-readiness`, commit `02e5e6b`,
running the API on a local `supabase start` stack (ES256 / JWKS).

Run `scripts/ci/preflight-config.sh` before any deploy. It reports presence and
agreement, never secret values.

---

## 1. Authentication — VERIFIED

Every check below was executed against a real local Supabase project with
genuine access tokens issued by `POST /auth/v1/signup`. No E2E auth mode, no
injected test session, no service-role key.

| Check | Result | Evidence |
|---|---|---|
| Signed-in 82-0 save succeeds | ✅ | `POST /perfect-season/games/{id}/save` → **HTTP 200**, saved_run id `2334b5aa…` |
| Saved run appears in history | ✅ | `GET /perfect-season/me/saved-runs` → 200, contains the saved id |
| API resolves the correct subject | ✅ | `GET /progression/me` → 200 for the token's `sub` |
| Guest run claimed after sign-in | ✅ | `POST /auth/claim` → 200, `game_count: 1`; the guest game then reads 200 as the account |
| Logged-out write blocked | ✅ | 401 with `error_code: authentication_required` |
| Account B cannot read A's game | ✅ | **403** |
| Account B cannot save A's run | ✅ | **403** `not_your_game` |
| B's history excludes A's run | ✅ | 200, 0 rows |
| Token refresh works | ✅ | `grant_type=refresh_token` → 200; refreshed token → `GET /progression/me` 200 |
| Bearer token reaches FastAPI | ✅ | `Authorization: Bearer <915-char ES256 JWT>`; API log shows the 200 |

### The failure mode this replaced

A token minted by one Supabase project, presented to an API configured for
another, returned exactly `HTTP 401 {"detail":"authentication_required"}` — and
the API logged **nothing**, because the reason went to `logger.debug`. That is
the "visibly signed in, every write 401s" report.

Both halves are fixed:

* `get_required_auth` returns the structured `{error_code, message}` shape, so
  clients that render `detail` show a sentence and keep the code for
  diagnostics.
* A rejection from `token_unknown_key` / `token_invalid_issuer` /
  `token_invalid_audience` logs at WARNING naming the token's issuer **and** the
  configured issuer. The issuer is a public project URL already in the browser
  bundle; no token, key or signature is logged.

**Operational note.** Changing either Supabase URL does not invalidate sessions
already in a browser. A stale cookie from the previous project keeps a user
looking signed in while every write 401s. Sign out and back in after repointing.

## 2. Ranked — VERIFIED (currently disabled by configuration)

Root cause of "Ranked is not currently enabled." was configuration alone:
`apps/api/.env` carries `PEAK3_RANKED_ENABLED=false` and
`PEAK3_RANKED_READINESS_LEVEL=disabled`.

**There is one contract and it is server-side.** The frontend has no ranked
flag; `/arena/ranked` renders whatever `GET /api/v1/ranked/readiness` reports.
The two cannot disagree.

To enable, all four:

```
PEAK3_RANKED_ENABLED=true
PEAK3_RANKED_MATCHMAKING_ENABLED=true
PEAK3_RANKED_RATING_WRITES_ENABLED=true
PEAK3_RANKED_READINESS_LEVEL=internal_alpha   # or closed_alpha / public_beta
```

`READINESS_LEVEL=disabled` with the booleans true is a valid kill switch.

Validated with two real authenticated accounts:

| Check | Result |
|---|---|
| Queue join / pairing | ✅ A `waiting` → B `matched`, one `match_id` |
| Identical hidden board | ✅ byte-identical offer lists for both players |
| Separate game instances | ✅ distinct `game_id`s |
| Both drafts complete | ✅ `draft_complete` |
| Settlement | ✅ `outcome: draw`, scores 70.3734 / 70.3734 |
| Glicko-2 update | ✅ RD 350.0 → 290.319 |
| Rating history persisted | ✅ 1 entry per account |
| Non-participant read | ✅ **403** |

**UNVERIFIED:** reconnect after refresh mid-match, queue timeout and cleanup,
leaving the queue, and settlement across a server restart.

## 3. Environment variables

Presence is checked by `scripts/ci/preflight-config.sh`; it prints lengths, not
values.

| Variable | Where | Required |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | web | yes — must match `PEAK3_SUPABASE_URL` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web | yes (public by design) |
| `NEXT_PUBLIC_API_URL` | web | yes |
| `PEAK3_SUPABASE_URL` | api | yes (JWKS is derived from it) |
| `PEAK3_DATABASE_URL` | api | yes in production |
| `PEAK3_SIGNING_SECRET` | api | yes — must not be the shipped dev default |
| `PEAK3_SUPABASE_JWT_SECRET` | api | only for legacy HS256 projects |
| `PEAK3_CORS_ORIGINS` | api | yes |
| `PEAK3_DEBUG` | api | must be `false` |
| `PEAK3_RANKED_*` | api | see §2 |
| `NEXT_PUBLIC_PEAK3_E2E_AUTH` | web | **never** in a deploy env |

`NEXT_PUBLIC_PEAK3_E2E_AUTH` cannot activate in production: `NODE_ENV` is
inlined at build time and folds the branch away
(`src/lib/supabase/config.ts`, `auth-session.test.ts` pins it).

## 4. Data build

`data/web/` and the served board artifacts are generated, not committed in the
case of `data/web/`. Before serving:

```
scripts/ci/build-web-data.sh      # data/web/ + card profiles v3
python scripts/build_top_peaks.py    # top_1000_peaks.v1.json (1y/2y/3y/5y)
python scripts/build_top_seasons.py  # top_1000_seasons.v1.json
```

The peaks/seasons artifacts **are** committed and must be regenerated whenever
the window set or comparison rails change.

## 5. Health and readiness

* `GET /health/readiness` — 200 once the dataset is loaded.
* `GET /api/v1/ranked/readiness` — the ranked contract, server-authoritative.
* `GET /api/v1/meta` — dataset provenance; `player_count` and `source_artifacts`
  distinguish the real dataset from the synthetic fallback.

## 6. UNVERIFIED — blockers for a real deploy

None of the following has been checked, and each is a genuine gate:

* **Production web and API URLs** — not known to this branch.
* **Google OAuth callback + allowed origins** — the local stack does not
  exercise Google at all. `docs/implementation/AUTH_CONFIGURATION.md` has the
  dashboard steps; they have not been performed or confirmed.
* **Supabase redirect allowlist** for the production origin.
* **API CORS** against the real web origin (`PEAK3_CORS_ORIGINS` is
  `http://localhost:3000` today).
* **HTTPS and cookie behaviour** — `Secure`/`SameSite` on a real domain.
* **Migrations against the production database.**
* **Rate limiting** under real traffic.
* **Service-role secret isolation** — `test_service_role_not_bundled.py` exists
  but skips unless `.next/` is built; it has not been run green here.
* **Connection pooling** limits.
* **Error monitoring** — no provider is wired.
* **Legal/footer routes, 404 and error states** — not audited.
* **Rollback** — no documented procedure.

## 7. Rollback (DRAFT — untested)

Not exercised. Written down so it exists, not because it has been proven:

1. Redeploy the previous web build and previous API image.
2. Set `PEAK3_RANKED_*` back to disabled; the UI follows the server with no
   redeploy.
3. Migrations are forward-only; there is no down-migration path. This is
   itself a blocker for a confident rollback.
