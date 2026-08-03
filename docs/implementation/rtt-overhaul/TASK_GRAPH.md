# TASK GRAPH — Arena RTT Overhaul

Live state is in the shared task list; this file is the durable record of the
dependency structure so the pass survives a context compaction.

## Phases

```
PHASE 0  baseline + workspace safety                         [lead]
PHASE 1  parallel research & audit          #1 #2 #3 #4      [all four, concurrent]
PHASE 2  lead synthesis gate                #5               [lead]   ← hard gate
PHASE 3  parallel implementation            #6 #7 #8 #9 #10 #11 #15
PHASE 4  integration                        #12              [lead]
PHASE 5  adversarial verification           #13              [writer-verifier]
PHASE 6  validation + hosted acceptance     #14              [lead + all]
```

## Dependency graph

```
#1 score semantics ──┐
#2 product audit  ───┤
#3 perf baseline  ───┼──> #5 SYNTHESIS GATE ──┬──> #6  score integrity + receipts
#4 leaderboard    ───┘                        ├──> #7  82-0 leaderboard backend
                                              ├──> #15 reveal payload contract
                                              ├──> #8  theme + shared primitives
                                              │        │
                                              │        ├──> #9  RTT reveal + boss
                                              │        ├──> #10 RTT shell/decision/result
                                              │        └──> #11 homepage/assets/perf/LB UI
                                              │
   #6 #7 #8 #9 #10 #11 #15 ──> #12 INTEGRATION ──┬──> #13 adversarial verification
                                                 └──> #14 validation matrix
```

`#8` blocks `#9`, `#10`, `#11` because the theme tokens and shared motion/a11y
primitives must exist before any surface is restyled against them. This is the
single most important ordering constraint in the graph — it is what prevents
two teammates independently inventing incompatible visual systems.

## Task register

| # | Task | Owner | Blocked by |
| --- | --- | --- | --- |
| 1 | RTT score-semantics reconciliation audit | `score-integrity` | — |
| 2 | Product/visual audit of every RTT state | `product-director` | — |
| 3 | Architecture/performance baseline audit | `platform` | — |
| 4 | Leaderboard + security contract audit | `score-integrity` | — |
| 5 | **Lead synthesis gate — implementation contract** | `lead` | 1, 2, 3, 4 |
| 6 | Score integrity + battle receipts (backend) | `score-integrity` | 5 |
| 7 | Global 82-0 leaderboard backend + RLS | `score-integrity` | 5 |
| 15 | RTT reveal payload contract: conceal + batch | `score-integrity` | 5 |
| 8 | Theme system + shared primitives | `platform` | 5 |
| 9 | RTT opening reveal + cinematic boss sequence | `rtt-experience` | 5, 8 |
| 10 | RTT game shell, decision quality, result experience | `rtt-experience` | 5, 8 |
| 11 | Homepage, assets, performance, Arena Leaderboards UI | `platform` | 5, 8 |
| 12 | Lead integration into `feature/arena-rtt-overhaul` | `lead` | 6, 7, 8, 9, 10, 11, 15 |
| 13 | Independent adversarial verification | writer-verifier pairs | 12 |
| 14 | Full validation matrix + hosted staging acceptance | `lead` + all | 12 |

Task **#15** was created mid-Phase-1: `rtt-experience`'s audit proved the
opening-reveal identity leak is a backend serialization bug, not a frontend
rendering bug, so ownership moved to `score-integrity`. Task **#4**'s
leaderboard-*frontend* half moved to `platform` (#11) for the same reason —
`rtt-experience` owns RTT surfaces only.

## Writer–verifier pairing for Phase 5

No teammate certifies its own work.

| Work | Implementer | Verifier |
| --- | --- | --- |
| Score semantics, receipts, leaderboard, RLS | `score-integrity` | `product-director` (labels/comprehension) + `lead` (numerics re-run) |
| RTT reveal, boss cinematics, shell, results | `rtt-experience` | `product-director` (product/a11y) + `platform` (perf/CLS) |
| Theme, homepage, assets, leaderboard UI | `platform` | `product-director` (visual/a11y) |
| Product contract itself | `product-director` | `lead` — recommendations are not self-approving |

A rejection creates a **new task**, reassigned to the implementer. A task is
not complete until its verifier approves with evidence.

## Completion rule

Every task must end in one of exactly three states:

- **COMPLETE** with verifier-approved evidence;
- **BLOCKED BY AN EXTERNAL CONSOLE/LEGAL DECISION** (asset rights may
  legitimately end here);
- **EXPLICITLY REJECTED WITH EVIDENCE**.

"Future work" is not an accepted terminal state for a product or engineering
task merely because the pass is long.
