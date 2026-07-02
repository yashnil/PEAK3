# Phase 2.3 Report — Daily Peak + Challenge Loop

**Date:** 2026-06-29  
**Branch:** main  
**Phase scope:** Daily board routing, challenge creation, challenge flow (spoiler-safe landing → play → comparison)

---

## Summary

Phase 2.3 ships the two features that close the Phase 2 loop:

1. **Daily Peak** — `/arena/daily` hub listing today's 1Y/3Y/5Y boards, each linking to `/arena/daily/{mode}` which creates or resumes that day's deterministic game, saves completion to `localStorage`, and shows the "already completed" gate on revisit.

2. **Challenge Loop** — After completing any draft (daily or practice), the user can generate a signed `/c/{token}` URL. The recipient lands on a spoiler-safe page, clicks "Start Challenge", plays the same board, then sees a full side-by-side comparison (`ChallengeComparison`). All state persists across refresh via `localStorage`. Settlement is computed server-side.

---

## Test results (as of 2026-06-29)

| Suite | Count | Result |
|-------|-------|--------|
| Python model tests (`tests/` excl. lineup) | 186 | PASS |
| Lineup model tests (`tests/lineup/`) | 41 | PASS |
| FastAPI tests (`apps/api/tests/`) | 112 | PASS (0 skipped) |
| Frontend unit tests (Vitest) | 24 | PASS |
| TypeScript typecheck | — | PASS (0 errors) |
| Production build (`next build`) | — | PASS (11 routes) |
| Board corpus validation (75 seeds × 3 modes) | 225 boards | PASS |

Total automated tests: **363 passing across all suites.**

---

## Files changed

### FastAPI backend

| File | Change |
|------|--------|
| `apps/api/app/api/v1/draft.py` | Added: `GET /drafts/daily/{mode}`, `POST /challenges`, `GET /challenges/{token}/meta`, `GET /challenges/{token}/game`, `GET /challenges/{token}/comparison` |
| `apps/api/app/models/draft.py` | Added: `ChallengeCreateResponse`, `ChallengeMeta`, `ChallengeComparisonResponse`, `ComparisonPlayer`, `ComparisonOutcome` |
| `apps/api/app/services/draft/state.py` | Added: challenger snapshot extraction, challenge record expiry |
| `apps/api/app/services/draft/store.py` | Added: `ChallengeRecord`, in-memory challenge store with 7-day TTL |
| `apps/api/tests/test_challenges.py` | New: 485-line challenge endpoint test suite |
| `apps/api/tests/test_daily_board.py` | New: 88-line daily board determinism tests |
| `apps/api/tests/test_draft.py` | Updated: expanded to cover new action paths |

API test count grew from 92 (Phase 2.2) to **112** (Phase 2.3).

### Next.js frontend

| File | Change |
|------|--------|
| `apps/web/src/app/(main)/arena/daily/page.tsx` | New: Daily Hub — 3 mode cards, completion status from `localStorage` |
| `apps/web/src/app/(main)/arena/daily/[mode]/page.tsx` | New: Daily Mode page — create/resume/completed-gate state machine |
| `apps/web/src/app/c/[token]/page.tsx` | New: Challenge page — loading → landing → playing → complete state machine |
| `apps/web/src/app/c/not-found.tsx` | New: Custom "Challenge not found" error page |
| `apps/web/src/components/draft/ChallengeComparison.tsx` | New: Side-by-side comparison with outcome banner, score columns, picks, DNA |
| `apps/web/src/components/draft/ShareChallenge.tsx` | New: Share modal with `aria-label="Challenge link"` input, Copy Link, native share |
| `apps/web/src/components/draft/DraftScreen.tsx` | Updated: challenge creation handler, `ShareChallenge` modal integration |
| `apps/web/src/components/draft/DraftReceipt.tsx` | Updated: "Create Challenge Link" button via `onShare` prop |
| `apps/web/src/lib/draft-api.ts` | Updated: `getDailyDraft`, `getChallengeMeta`, `loadChallenge`, `getChallengeComparison`, `createChallenge` |
| `apps/web/src/lib/draft-progress.ts` | Updated: `saveChallengeGameId`, `getChallengeGameId`, `clearChallengeGame`, `saveDailyCompletion`, `hasDailyCompletion`, `getAllDailyCompletions` |
| `apps/web/src/lib/utils.ts` | Updated: `challengeTokenKey`, `todayUTC` |
| `apps/web/src/lib/analytics.ts` | Updated: `challenge_created`, `challenge_opened`, `challenge_started`, `challenge_shared`, `daily_board_opened` events |
| `apps/web/src/types/draft.ts` | Updated: `ChallengeMeta`, `ChallengeComparisonResponse`, `ComparisonPlayer`, `ComparisonOutcome`, `DraftCompletionSummary` |
| `apps/web/src/app/(main)/page.tsx` | Updated: homepage links to `/arena/daily` |

### Tests and documentation (this session)

| File | Change |
|------|--------|
| `apps/web/src/tests/e2e/daily-challenge.spec.ts` | New: Playwright E2E tests — daily hub, daily play, daily resume, daily completed-gate, challenge creation, challenge spoiler-safety, challenge completion, challenge refresh, challenge comparison, invalid token, mobile overflow |
| `docs/architecture/ADR-001-board-snapshot-contract.md` | New: Decision record for board identity, challenge token format, version pinning |
| `docs/implementation/PHASE_2_3_REPORT.md` | This file |
| `.github/workflows/ci.yml` | Updated: API test job name from "92" to "112" |

---

## Architecture decisions

See `docs/architecture/ADR-001-board-snapshot-contract.md` for the full record. Key decisions:

- **Board identity is date-based for daily, seed-based for challenge.** No version is embedded in the `board_id`; card pool changes silently alter generated cards (accepted Phase 1 risk).
- **Challenge tokens are HMAC-SHA256-signed** and expire after 7 days. The signing secret (`PEAK3_SIGNING_SECRET`) is required at runtime.
- **Challenger result is persisted in a `ChallengeRecord`** in the in-memory store at creation time, so the comparison can be served after the 24h game TTL.
- **Spoiler protection** is enforced at the API layer: `GET /challenges/{token}/meta` never returns score or card data. Comparison is gated on both players reaching `draft_complete`.
- **Server authority is absolute.** No scores, seeds, or outcomes are accepted from the client.

---

## Known limitations

1. **In-memory store only.** All game and challenge state is lost on server restart. Phase 3 will migrate to Supabase.
2. **Daily board is UTC-based.** Users in UTC-5 see the next day's board at 7pm local time. No configurable timezone rollover.
3. **Challenge TTL is 7 days** but the comparison requires both parties to complete before either expires. No partial-completion notification.
4. **No global leaderboard** for daily boards in Phase 1. `board_percentile` is computed per-run against a fixed reference corpus.
5. **Playwright E2E tests require both services running.** They are marked `@daily-challenge` but run in the `playwright` CI job which auto-starts FastAPI and Next.js via `playwright.config.ts` webServer config.
6. **`data/web/` and `data/game/profiles/card_profiles.v3.json`** must be built before the API and E2E tests can pass. See `make build-dataset` and `python scripts/build_card_profiles.py`.

---

## Next pass recommendations

- **Phase 3 priority:** Replace the module-level dict store with Supabase. This unblocks global leaderboards, cross-device resume, and durable challenge comparisons.
- **Daily hub countdown:** Add a clock showing time until tomorrow's board unlocks (midnight UTC).
- **Challenge nudge:** If the recipient hasn't played after 24h, consider a "reminder" deeplink mechanism (requires user accounts, Phase 3).
- **4-year window:** The Python model supports it (`n_year_windows` accepts 4), but no `prime_4y` card profiles exist. Add when card pool is extended.
- **Version embedding in board_id:** Embed `card_pool_version` in the board_id string once the v3 pool is stable, so future pool bumps don't silently change existing boards (see ADR-001).
