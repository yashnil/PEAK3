# Visual identity + game-feel upgrade — progress

Branch: `fix/gameplay-ux-production-polish`

## Landed

- `353c5a8` **Design foundation.** Syne → Space Grotesk (`--font-display`,
  `.font-display` now one source of truth). New additive token layer at the end
  of `globals.css` under the `VISUAL IDENTITY + GAME-FEEL PASS` banner: display
  type scale + tracking, gold ramp (`--peak-accent-wash/-veil/-edge/-rim`),
  arena atmosphere (`--pk-atmosphere`, `--pk-glow-*`), depth (`--pk-rim`,
  `--pk-well`, `--pk-hairline*`, `--pk-grad-*`), new motion tokens
  (`--pk-dur-lift/-pulse`, `--pk-ease-settle/-decel`, `--pk-stagger`).
  Seven motion primitives: `.pk-lift`, `.pk-press`, `.pk-reveal`,
  `.pk-turn-pulse`, `.pk-spotlight`, `.pk-depth`, `.pk-crown`,
  `.pk-atmosphere`, `.pk-sheen`, `.pk-counting`. Scoped reduced-motion block.
  `lib/motion.ts` mirrors the new tokens. `design-system.test.ts` (49 tests)
  locks font single-sourcing, primitive definition, reduced-motion coverage,
  light-theme token parity, and CSS↔JS time agreement.

- `8dcd82f` **Shared UI primitives.** `ScorePill` size-prop defect fixed
  (animated branch dropped `fontSize`); `AnimatedNumber` accepts `style`.
  Fine-grey audit on ScorePill label / SectionHeader eyebrow / EmptyState icon
  (muted → secondary, sizes raised off 9–10px). Depth applied by meaning
  (`--pk-rim` on chips/pills, `--pk-well` on EmptyState).

## In flight (parallel agents, file-ownership partitioned)

| Workstream | Owns |
|---|---|
| Fact hardening | `data/facts/`, `nba_peak/nba_facts/`, `tests/test_nba_facts*` |
| Multiplayer game-feel | `three-man-weave.css`, `twenty-dollar.css`, `arena.css`, matching components, `app/(main)/arena/**` |
| Homepage + light mode | `home.css`, `nav.css`, `app/(main)/page.tsx`, `components/home/**`, `components/layout/**` |
| Result screens | `components/game/**`, `run-the-table/**`, `draft/**`, `daily-grid/**`, `progression/**`, `head-to-head/**`, `ranked/**`, `rtt-polish.css` |

`globals.css` is owned by the main session only.

## Deliberately out of scope

- Rankings bar composition logic and the visual bar concept (`rankings.css`,
  `components/rankings/**`, `--comp-*` tokens) — explicitly off limits.
- `components/court/**`, `spinner.css`, `tour.css` — not named in the brief;
  their existing ceremonies already work.

## Known false fact being removed

`international_leagues-4df672ba6165` — "Europe's most successful basketball club
has more continental titles than any NBA franchise has championships."
Real Madrid: 11 EuroLeague. Boston: 18 NBA. The comparative is false.
