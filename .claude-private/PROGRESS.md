# Visual identity + game-feel upgrade — progress

Branch: `fix/gameplay-ux-production-polish`. Started from `4a2b50b`. **Nothing pushed.**

## Status: complete and green

| Commit | What |
|---|---|
| `353c5a8` | Design foundation — Space Grotesk, token layer, motion primitives, test lock |
| `8dcd82f` | Shared UI primitives — depth by meaning, fine-grey audit, `ScorePill` defect |
| `312925e` | Cross-session progress tracking |
| `75d9d3b` | Two composability traps (`.pk-lift-lg` standalone, `.pk-depth` shorthand) |
| `7f22bef` | `.pk-crown-accent` drew nothing alone; `.pk-lift` lied about `:disabled` |
| `6a77e20` | Game-feel across multiplayer, result screens, homepage, nav + bundle fix |
| `3d9ca61` | Fact-bank hardening — 91 audited, build-time structural gate |
| *(final)* | Review close-out — deterministic e2e, retired-claims register, cleanup |

## Verification

- `scripts/ci/frontend-verify.sh` — green (typecheck, lint 0 warnings, 1952 unit tests, prod build)
- `scripts/ci/api-unit-tests.sh` — 1651 passed, 2 skipped
- `scripts/ci/model-tests.sh` — 1677 passed, 1 xfailed
- Fact-bank targeted — 296 passed (`test_nba_facts`, `_validation`, `_retired_claims`, `_deployment`, API route)
- `scripts/ci/e2e-tests.sh` at `PLAYWRIGHT_RETRIES=0` — **411 passed, 0 failed**
- Stability: the two repaired specs 10/10 (×5 each); all accessibility specs 130/130 (×5)

## The three e2e defects that were fixed, and what each really was

1. **Daily Grid optimal-grid avatars.** Asserted `img` count 0, which in practice
   meant "all nine `a.espncdn.com` portraits failed to load within 5s". It passed
   when the CDN was slow and failed when it served bytes — green precisely when
   the product worked least well, and no timeout could fix that. Now every
   cross-origin *image* request is aborted before navigation, so `onError` fires
   deterministically and offline, and the assertion is on the rendered fallback
   (nine `div.player-avatar`, no surviving `<img>`).
2. **Rankings mobile sheet.** `390.0000071525574 <= 390` — the residue of the
   browser's 1/64px LayoutUnit → double conversion, not an overflow. Now measured
   against `window.innerWidth` with a 0.5 CSS px tolerance (half a device pixel at
   DPR 1). The zero-tolerance no-horizontal-scroll assertion is untouched.
3. **Draft card season labels (axe, serious `color-contrast`).** `--text-muted`
   is 4.6:1 on `--bg-surface-hover` and the card is hoverable — clearing AA by a
   tenth of a point. Promoted to `--text-secondary` (9.1:1). Also correct on the
   merits: the season window is *which peak this card is*, not metadata.

## A methodology trap worth not repeating

Attributing #1 initially pointed the wrong way. A `git worktree` of the pre-pass
commit passed it twice while this branch failed twice. That baseline was invalid:
the worktree differed from the main working copy, and the test's outcome depends
on external network reachability. Checking `4a2b50b -- apps/web/` out **in the
main working copy** reproduced the failure exactly. Use the same working copy.

## Architectural decisions worth not re-litigating

1. **No new text colours in this pass.** Every measured ratio in `globals.css`
   came from an earlier audit. Where this pass touches text it only moves UP a
   tier, which can only increase contrast.
2. **Reduced-motion is scoped to the `.pk-*` primitives**, not folded into the
   global blanket rule, which collapses `animation-duration` but not
   `animation-delay` — and existing cinematic sequences pair CSS delays with JS
   timers.
3. **`checked_on` is never compared to the clock.** The fact build stays a pure
   function of committed inputs and byte-reproducible.
4. **Deep imports, not the `@/components/ui` barrel**, on any route not already
   carrying `lucide-react`. The barrel reaches it via `ThemeToggle`; one number
   component cost `/play/daily` 74 kB of First Load JS.
5. **Structural validation does not prove truth.** `validation.py` gates
   sourcing, review date, claim type and language. Truth is established by human
   audit and ratcheted by `tests/test_nba_facts_retired_claims.py`.

## Deliberately out of scope

- Rankings bar composition logic and the visual bar concept — off limits, untouched.
- `components/court/**`, `spinner.css`, `tour.css` — not named in the brief.
- No CI link-checker for fact `source_url`s: several cited hosts answer
  automated requests with 403/429, so it would be flaky rather than a guard.

## Known limits

- `ResultNumber` server-renders `0`; documented in its docstring, not observable
  because every call site is a post-gameplay screen requiring JS.
- The fact schedule's period is 93 days against a 187-fact bank, so roughly half
  the bank is reachable in a cycle. Pre-existing rotation behaviour, unchanged by
  this pass, and worth a look separately.
