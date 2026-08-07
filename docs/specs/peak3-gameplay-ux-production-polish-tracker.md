# PEAK3 Production Gameplay + Visual Polish — Requirement Tracker

**Spec:** [`peak3-gameplay-ux-production-polish.md`](./peak3-gameplay-ux-production-polish.md)
**Branch:** `fix/gameplay-ux-production-polish`
**Status legend:** TODO · IN PROGRESS · VERIFIED · BLOCKED

Every requirement ID in the spec appears below. A row may only move to **VERIFIED**
after (1) root cause identified, (2) durable fix implemented, (3) regression coverage
added, (4) behavior observed in a real browser where applicable.

---

## Shared foundations (spec §5)

| ID | Requirement | Status | Root cause | Implementation | Verification |
|---|---|---|---|---|---|
| SHARED-01 | One competitive timing model (reveal phase, action freeze, no overlapping timers, server-authoritative) | TODO | | | |
| SHARED-02 | Clear pending-action state + single in-flight request + server idempotency | TODO | | | |
| SHARED-03 | Shared player headshot/avatar primitive reused from 82–0 | TODO | | | |
| SHARED-04 | Stronger interactive affordances (buttons, disabled, focus-visible, touch targets) | TODO | | | |
| SHARED-05 | Remove low-value faint microcopy (Rankings exempt) | TODO | | | |

## Three-Man Weave (spec §6)

| ID | Requirement | Status | Root cause | Implementation | Verification |
|---|---|---|---|---|---|
| TMW-01 | Timeout must never reward inactivity; deterministic legal non-exploitable fallback | TODO | | | |
| TMW-02 | Strict per-season position legality; no transitive illegal placement | TODO | | | |
| TMW-03 | Complete franchise×decade candidate pools + audit doc | TODO | | | |
| TMW-04 | Bot choice quality (strong/near-optimal, seeded sims) | TODO | | | |
| TMW-05 | Bot think time 4–10s, visible, real scheduled phase | TODO | | | |
| TMW-06 | Spinner/reveal becomes a full-focus game moment | TODO | | | |
| TMW-07 | One turn-status surface, not three stacked rows | TODO | | | |
| TMW-08 | Remove Draft order · snake strip | TODO | | | |
| TMW-09 | Improve three-roster composition (desktop + mobile) | TODO | | | |
| TMW-10 | Manual roster rearrangement during normal gameplay (drag + click + keyboard) | TODO | | | |
| TMW-11 | Player-selection panel refinement | TODO | | | |
| TMW-12 | Off the Board becomes compact activity history | TODO | | | |
| TMW-13 | Game opening sequence (competitive intro) | TODO | | | |
| TMW-14 | Results screen full redesign | TODO | | | |
| TMW-15 | Result and match visual verification matrix | TODO | | | |

## The $20 Showdown (spec §7)

| ID | Requirement | Status | Root cause | Implementation | Verification |
|---|---|---|---|---|---|
| S20-01 | Pre-match competitive intro | TODO | | | |
| S20-02 | Player/lot reveal before human timer | TODO | | | |
| S20-03 | Unmistakable active-seat highlighting | TODO | | | |
| S20-04 | Redesigned auction decision surface / hierarchy | TODO | | | |
| S20-05 | Better bid controls | TODO | | | |
| S20-06 | Skips remaining is a first-class number | TODO | | | |
| S20-07 | Correct skip accounting semantics (market_skip / follow_pass / auction_pass) | TODO | | | |
| S20-08 | Stop the human timer immediately on click | TODO | | | |
| S20-09 | Inter-turn breathing room | TODO | | | |
| S20-10 | Fix "While you were away" at the state-machine level | TODO | | | |
| S20-11 | Reconnect / reload / two-tab correctness matrix | TODO | | | |
| S20-12 | Errors become actionable product states | TODO | | | |
| S20-13 | Bot auction quality audit | TODO | | | |
| S20-14 | Roster/sidebar redesign | TODO | | | |
| S20-15 | Results screen full redesign | TODO | | | |
| S20-16 | Visual/browser verification matrix | TODO | | | |

## Daily Grid (spec §8)

| ID | Requirement | Status | Root cause | Implementation | Verification |
|---|---|---|---|---|---|
| DG-01 | Remove redundant textual best-grid list | TODO | | | |
| DG-02 | Add player headshots to optimal grid | TODO | | | |
| DG-03 | Preserve scoring semantics | TODO | | | |

## Homepage + Fact of the Day (spec §9)

| ID | Requirement | Status | Root cause | Implementation | Verification |
|---|---|---|---|---|---|
| HOME-01 | Fact of the Day must teach something worth returning for | TODO | | | |
| HOME-02 | Homepage-quality tier / suitability gate | TODO | | | |
| HOME-03 | Redesign the fact card | TODO | | | |

## Global visual system (spec §10)

| ID | Requirement | Status | Root cause | Implementation | Verification |
|---|---|---|---|---|---|
| VIS-01 | Preserve Rankings component bars (protected) | TODO | | | |
| VIS-02 | Typography refresh | TODO | | | |
| VIS-03 | Richer dark palette | TODO | | | |
| VIS-04 | First-class light palette | TODO | | | |
| VIS-05 | Shared surfaces / primitives | TODO | | | |
| VIS-06 | Color communicates hierarchy (never color alone) | TODO | | | |
| VIS-07 | Animation language + reduced motion | TODO | | | |
| VIS-08 | Site-wide smoke audit without destabilizing other games | TODO | | | |

## Cross-cutting (spec §11–§12)

| ID | Requirement | Status | Root cause | Implementation | Verification |
|---|---|---|---|---|---|
| ACC-01 | Accessibility + responsive requirements on all touched surfaces | TODO | | | |
| PERF-01 | No performance regression (layout shift, image storms, interval leaks, timer-tick rerenders) | TODO | | | |

---

## Proactive defects found during this pass (spec §16)

Issues discovered while inspecting these surfaces that were not named by the user.
Each gets an ID `EXTRA-nn` and must be fixed or explicitly deferred with a reason.

| ID | Surface | Defect | Status | Notes |
|---|---|---|---|---|
| _(none yet)_ | | | | |

---

## Browser review matrix (spec §15)

Every cell requires: capture → **open and visually inspect the image** → one-sentence
judgement recorded here → fix → recapture.

| Surface | 1440×900 dark | 1440×900 light | 1440×700 dark | 390×844 dark | 390×844 light |
|---|---|---|---|---|---|
| TMW intro | ☐ | ☐ | — | ☐ | — |
| TMW spinner | ☐ | ☐ | ☐ | ☐ | — |
| TMW user pick | ☐ | ☐ | ☐ | ☐ | ☐ |
| TMW bot turn | ☐ | — | ☐ | ☐ | — |
| TMW result | ☐ | ☐ | ☐ | ☐ | ☐ |
| S20 intro | ☐ | ☐ | — | ☐ | — |
| S20 unopened | ☐ | ☐ | ☐ | ☐ | ☐ |
| S20 auction live | ☐ | ☐ | ☐ | ☐ | — |
| S20 reconnect recap | ☐ | — | ☐ | ☐ | — |
| S20 result | ☐ | ☐ | ☐ | ☐ | ☐ |
| Daily result | ☐ | ☐ | — | ☐ | ☐ |
| Homepage fact | ☐ | ☐ | ☐ | ☐ | ☐ |
| Rankings (regression check) | ☐ | ☐ | — | ☐ | — |

### Visual review notes

_(one sentence per reviewed frame — hierarchy / readability judgement)_

---

## Audits required by the spec

| Audit | Artifact | Status |
|---|---|---|
| Franchise × decade pool completeness | `docs/implementation/THREE_MAN_WEAVE_POOL_AUDIT.md` | TODO |
| Position legality property audit | tests + audit doc | TODO |
| TMW timeout non-exploitability simulation | tests | TODO |
| TMW bot simulation statistics | tests / audit doc | TODO |
| S20 skip-semantics + timing simulation | tests | TODO |
| Fact featured-tier counts and categories | fact bank build report | TODO |

## Completion gates (spec §19)

Gates A–F are tracked verbatim in the spec. This tracker records per-requirement
evidence; the closure report cites gate status.

| Gate | Status |
|---|---|
| A — Three-Man Weave gameplay | TODO |
| B — $20 Showdown gameplay | TODO |
| C — Daily Grid | TODO |
| D — Homepage / facts | TODO |
| E — Visual system | TODO |
| F — Validation | TODO |
