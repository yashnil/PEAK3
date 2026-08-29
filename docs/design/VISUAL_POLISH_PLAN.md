# PEAK3 "Arena Archive" Visual-Polish Program — Plan & Baseline

## Status

Program started 2026-08-29. This document is the single source of truth for
baseline recovery, scope, and staging. It is updated as batches land; it is
not a one-time snapshot.

## Phase 0 — recoverable baseline (DONE)

- **Pre-polish branch:** `main`
- **Pre-polish SHA:** `45345342c83778daf381a44b2f30f50f5eb58494`
- **Working tree at start:** clean, `main` == `origin/main` (verified via
  `git rev-parse main` / `git rev-parse origin/main`).
- **Backup ref:** annotated tag `backup/pre-visual-polish-2026-08-29`,
  pushed to `origin` (verified via `git ls-remote --tags origin`).
- **Working branch for this program:** `feature/arena-archive-visual-polish`,
  cut from the baseline SHA above.

### Exact revert instructions

```bash
git fetch origin
git checkout main
git reset --hard backup/pre-visual-polish-2026-08-29   # local recovery only
# or, to see the diff without discarding anything:
git diff backup/pre-visual-polish-2026-08-29 main
```

Never force-push `main` to roll this back if anyone else has pulled newer
commits — prefer a revert commit or a fast-forward reset of a local checkout.

## Critical context discovered before any implementation

This repo has **already been through several rounds of exactly the failure
mode this program is warned against.** This is not a fresh coat of paint on
an untouched app — treat the following as load-bearing:

1. **A full "V2" presentation already exists and is the only thing shipped
   in production.** `apps/web/src/lib/ui-version.ts` — `useUiVersion()`
   always resolves `"v2"` server-side and there is no user-facing control;
   `"legacy"` only exists behind a dev-only, env-gated switch
   (`UiVersionDevSwitch.tsx`) for internal comparison. **"V2" is not a
   preview — it is the current production UI.** This program polishes *that*
   system; it does not introduce a third competing identity. "Arena Archive"
   is the name for this polish pass's design language *applied to the
   existing V2 system*, not a new parallel build.
2. **Prior visual passes on this exact system caused real regressions,
   repeatedly**, per `git log --oneline` on `main`:
   - #15 "Upgrade PEAK3 visual identity and game feel"
   - #17 "Polish PEAK3 gameplay across Daily, Arena, 82-0 and Run the Table"
   - #13 "Rescue PEAK3 gameplay and product experience" (a *rescue*, i.e. a
     prior visual/UX pass broke gameplay and had to be recovered)
   - #22 "Fix Arena playability regressions"
   - #23 "PEAK3 V2 final product integration"
   - #24 "Complete PEAK3 product UX recovery" (current HEAD — another
     recovery commit)
   The pattern is: broad visual pass → functional regression → dedicated
   rescue/recovery PR. `.claude-private/PROGRESS.md`,
   `reconstruction_plan_v5.md`, and `visual_reconstruction_cloud.md` document
   at least two more full "V2 reconstruction" attempts on top of that,
   including one the human reviewer explicitly rejected as a visual baseline
   ("too many screens still read as settings pages / generic dark SaaS").
   **Implication for this program:** the Phase-11 discipline (small batches,
   functionality QA before AND after every batch, independent visual review,
   test gate before commit) is not boilerplate — it is the specific control
   that has been missing in the passes that caused damage. It will be
   followed literally, not abbreviated for speed.
3. **There is an existing, richer design reference already in the repo**:
   `.claude-private/design/PEAK3-Directions-E.pdf`, referenced by
   `visual_reconstruction_cloud.md` as the visual-ambition source of truth
   for the V2 system, plus `docs/product/PEAK3_Product_Implementation_Blueprint.pdf`
   and `docs/product/PEAK3_BLUEPRINT_INDEX.md` (the CLAUDE.md-mandated
   blueprint). All three are treated as authoritative product/visual intent
   for this program; "Arena Archive" per the user's brief is a refinement of
   direction (premium sports-editorial/archival authority, less neon/gaming)
   layered on top of what these documents already establish, not a
   replacement of them.
4. **Stale branches/worktrees exist from prior agent sessions** — left
   untouched, not deleted, not merged from, not treated as authoritative:
   `backup/pre-cloud-reconstruction`, `feature/peak3-product-polish`,
   `feature/peak3-v2-ui`, `fix/product-ux-recovery`,
   `recovery/peak3-v2-visual-reconstruction`, and ten `worktree-agent-*`
   branches. These are prior sessions' scratch/checkpoint branches, not
   current work in progress on `main`; they are recorded here for awareness
   only. If any of them turn out to contain something the user wants
   recovered, that's a separate, explicit decision — this program does not
   merge from them.

## Scope decision for this pass

Given (2) above, this program runs as an **incremental, multi-session
sequence of small verified batches** against the route/behavior matrix
(`ROUTE_BEHAVIOR_MATRIX.md`), not a single big-bang rewrite. Each batch:
touches one shared-foundation layer or one route family, is verified against
the test/QA gates in `VISUAL_RUBRIC.md`, and is committed independently
before the next batch starts. Progress across sessions is tracked in
`.claude-private/PROGRESS.md`.

## Phase 3 — baseline test results (2026-08-29, on `4534534` before any UI change)

| Suite | Command | Result |
|---|---|---|
| Model tests | `scripts/ci/model-tests.sh` | 1859 passed, 1 xfailed, 4 warnings (939.96s) |
| API unit tests | `scripts/ci/api-unit-tests.sh` | 1804 passed, 2 skipped, 15 deselected (244.05s) |
| Frontend verify | `scripts/ci/frontend-verify.sh` | typecheck clean; lint 0 warnings; 2240/2240 vitest (96 files); production build succeeded |
| Playwright e2e + axe | `scripts/ci/e2e-tests.sh` | 448 passed, 1 skipped, 0 failed (27.8 min) |

All four gates are green on the baseline. Any of these regressing during the
polish program is a stop-the-line signal, not something to patch around by
loosening the assertion.

### Bundle baseline (from the frontend-verify production build, 2026-08-29)

Shared JS: 102 kB. Heaviest routes by First Load JS: `/arena/run-the-table`
48.2 kB / 289 kB total, `/arena/court/daily/[mode]` + `/arena/court/practice/[mode]`
261 kB, `/daily/grid` 221 kB, `/arena/twenty-dollar/[matchId]` 211 kB,
`/rankings` 20.4 kB / 150 kB, `/methodology` 5.09 kB / 159 kB. Middleware
91.3 kB. Any batch touching these routes should re-check First Load JS in the
same build output and flag a regression instead of shipping it silently.

## Phase 5 — dependency audit (2026-08-29)

`apps/web/package.json` is already lean and correctly chosen for this
program's needs: `motion` (meaningful animation), `lucide-react` (single
icon language), `@axe-core/playwright` + `lighthouse` (already-present a11y/
perf tooling), Tailwind v4 + CSS custom properties (no competing token
system). No Radix/React Aria (Dialog.tsx is a working custom focus-trap
implementation per the route matrix) and no D3/Observable Plot (no route
currently needs a bespoke chart beyond what exists). **Conclusion: no new
dependency is needed for the batches currently planned.** Re-evaluate only if
a specific batch hits a problem the existing stack cannot solve cleanly, and
name that problem explicitly before adding anything.

## Companion documents

- `docs/design/REFERENCE_BOARD.md` — external research synthesis
- `docs/design/ROUTE_BEHAVIOR_MATRIX.md` — full current-app surface map
- `docs/design/DESIGN_SYSTEM.md` — PEAK3 design constitution (tokens, type,
  spacing, motion, responsive rules)
- `docs/design/VISUAL_RUBRIC.md` — the pass/fail + 1-5 scoring gate used by
  the independent UI evaluator every batch
