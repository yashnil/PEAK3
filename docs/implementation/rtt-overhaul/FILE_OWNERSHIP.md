# FILE OWNERSHIP — Arena RTT Overhaul

Rule: **no two teammates edit the same file concurrently.** Where a file is
genuinely shared, one owner is named and everyone else consumes it read-only.
Ownership disputes go to the lead, not to a merge conflict.

## Teammates

| Name | Role | Worktree | Branch |
| --- | --- | --- | --- |
| `product-director` | Product/UX research + adversarial reviewer | none (read-only) | n/a |
| `score-integrity` | Score semantics, Python engine, API, leaderboard, migrations | `~/Desktop/PEAK3-agent-score` | `wt/arena-score` |
| `rtt-experience` | RTT frontend experience | `~/Desktop/PEAK3-agent-rtt` | `wt/arena-rtt` |
| `platform` | Theme, homepage, leaderboard UI, assets, performance | `~/Desktop/PEAK3-agent-platform` | `wt/arena-platform` |
| `lead` | Task graph, contracts, integration, hosted validation | `~/Desktop/PEAK3` | `feature/arena-rtt-overhaul` |

## Ownership map

### `score-integrity`

Exclusive write access:

```
nba_peak/**
apps/api/**
tests/**
apps/api/tests/**
supabase/migrations/**
scripts/  (audit + fixture generation scripts only)
```

Must **not** edit frontend visual components. Generated TypeScript types are
the only permitted exception, and only if unavoidable — flag to the lead first.

### `rtt-experience`

Exclusive write access:

```
apps/web/src/components/run-the-table/**
apps/web/src/app/**  (RTT route-specific files only)
apps/web/src/styles/rtt-polish.css
apps/web/  (RTT-specific vitest + playwright specs)
```

Must **not** implement score calculations in TypeScript. Must **not** edit
`globals.css` or shared primitives — request the change from `platform`.

### `platform`

Exclusive write access:

```
apps/web/src/styles/globals.css          (design tokens — sole owner)
apps/web/src/styles/tour.css
apps/web/src/components/ui/**            (shared primitives)
apps/web/src/lib/a11y, apps/web/src/lib/motion
apps/web/  homepage files
apps/web/  global layout + theme files
apps/web/  header / account-menu components
apps/web/  Arena Leaderboards frontend
apps/web/  asset components (PlayerAvatar, AnimatedNumber, image loading)
scripts/perf/**                          (performance instrumentation)
```

Must coordinate **every** shared-primitive change with `rtt-experience`
*before* making it.

### `lead`

```
docs/implementation/rtt-overhaul/**
integration merges + shared-file conflict resolution on feature/arena-rtt-overhaul
```

`product-director` writes only into `docs/implementation/rtt-overhaul/` and is
read-only on all code for the entire implementation phase.

## Contested files — arbitrated

Sourced from `rtt-experience`'s Phase 1 audit (§7 of `RTT_ARCHITECTURE_AUDIT.md`).

| File | Owner | Rule for everyone else |
| --- | --- | --- |
| `apps/web/src/styles/globals.css` | `platform` | Highest-conflict file in the repo. `rtt-experience` consumes `var(--token)` only and never edits. New tokens are requested from `platform`. |
| `@/components/ui/GuidedTour` + `tour.css` | `platform` | The `data-tour-id` placement contract documented at `RunTheTableGame.tsx:1062-1085` is load-bearing for existing tour tests. `platform` must notify `rtt-experience` before any GuidedTour prop change. |
| `@/lib/a11y`, `@/lib/motion` | `platform` | Shared utilities. `rtt-experience` consumes only. Reduced-motion primitives live here, so both cinematics depend on them — changes are additive, never breaking. |
| `PlayerAvatar`, `AnimatedNumber` | `platform` | Shared. RTT consumes. `rtt-experience` may request props; `platform` implements. |
| `apps/web/src/styles/rtt-polish.css` | `rtt-experience` | Exclusive. `platform` does not touch. |
| `apps/web/src/components/run-the-table/**` | `rtt-experience` | Exclusive. |
| `apps/api/app/services/run_the_table/public.py` | `score-integrity` | The reveal-concealment payload contract lives here. `rtt-experience` found the defect but does not own the fix. |

## Integration order (cherry-pick sequence)

Conflicts are resolved centrally by the lead, never by dropping a teammate's
functionality.

1. **Score / API / data contract** — `wt/arena-score`. Everything downstream
   depends on the payload shape, so it lands first.
2. **Theme / shared primitives** — `wt/arena-platform` (tokens, motion, a11y,
   skeletons only). RTT cannot be styled correctly until tokens exist.
3. **RTT frontend** — `wt/arena-rtt`. Consumes 1 and 2.
4. **Homepage / leaderboards / assets** — remainder of `wt/arena-platform`.
5. **Test + generated-file reconciliation** — lead, on the integration branch.

After integration: rebuild generated artifacts once, validate API/frontend
schema agreement, remove dead compatibility branches and temporary
instrumentation, and confirm no secret or environment value entered git.
