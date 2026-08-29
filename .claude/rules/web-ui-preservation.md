---
paths:
  - "apps/web/**"
---

# Web UI preservation (Arena Archive visual-polish program)

Visual-polish work must not silently modify API contracts, scoring, game
rules, persistence semantics, authentication semantics, route contracts, or
state-machine semantics. If a visual improvement requires a behavior change,
isolate it, justify it, verify it, and do not hide it inside a styling
commit.

## Why this exists

`apps/web` has already been through several rounds of this exact failure:
broad visual passes that damaged gameplay and required dedicated rescue PRs
(see `main` history: "Rescue PEAK3 gameplay and product experience", "Fix
Arena playability regressions", "Complete PEAK3 product UX recovery"). The
current V2 presentation (`components/v2/**`, `styles/v2/**`) is the sole
production UI, not a sandbox — see `docs/design/VISUAL_POLISH_PLAN.md` for
the full incident history and `docs/design/ROUTE_BEHAVIOR_MATRIX.md` for the
per-route "must not change" contracts.

## What this means concretely

- Before touching a shared primitive (`nav.tsx`, `Footer.tsx`, `Dialog.tsx`,
  `PeakV2Shell`, `styles/v2/tokens.css`), check
  `docs/design/ROUTE_BEHAVIOR_MATRIX.md` for every route/test that depends on
  it. These have the highest blast radius in the app.
- Never change a test's expected value to make a visual change pass. A
  failing test after a styling change means the styling change broke
  something, or the test asserts a literal (e.g. an active-nav class string,
  an `aria-label`) that the new markup must still satisfy — not that the
  assertion should move.
- State machines, timers, daily-key/reset logic, scoring (`arena_points`,
  never computed client-side), queue/rating logic, and persistence contracts
  are out of scope for a "polish" change. If a visual idea seems to require
  touching one of these, stop and treat it as a separate, explicit,
  justified change — not a silent side effect.
- Run the affected test tier (unit + relevant e2e spec) before treating any
  batch as done. `scripts/ci/frontend-verify.sh` and the relevant
  `scripts/ci/e2e-tests.sh` spec(s) are the gate, not a visual screenshot
  alone.
- Prefer consolidating/extending the existing token layer
  (`styles/v2/tokens.css`) over forking a new one. Two genuinely different
  surfaces do not need to be forced into one shared component.
