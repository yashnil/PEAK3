# ADR-006 — Prime Cut and Find the Prime are additive Arena modes

- **Status:** Accepted (2026-09-13)
- **Context branch:** `feature/prime-modes`

## Context

PEAK3 Arena has two server-authoritative multiplayer modes (Three-Man Weave,
The $20 Showdown) behind a deliberately mode-agnostic foundation
(`app/services/arena/`, `app/repositories/arena_*`), plus four single-player
modes with their own state machines (Daily Grid, Peak Duel, Run the Table,
82-0). Two new games — PRIME CUT and FIND THE PRIME — make the multi-year
(2Y/3Y/5Y) peak windows central to play.

Building them invites a tempting refactor: a common "game engine" that all
seven modes share. Each existing mode encodes hard-won fixes (phantom-state
beats, server-timed ceremonies, newer-wins snapshot application, bot timing)
whose regressions were only visible in a browser, and several past visual or
structural passes needed dedicated rescue PRs.

## Decision

1. **Both games are new `ArenaMode` modules** registered exactly like the
   existing two. Rules live in pure Python packages (`nba_peak/prime_cut`,
   `nba_peak/find_the_prime`); the API modules are translation layers.
2. **No existing mode's reducer, projection, bot or frontend is modified.**
3. **Foundation changes are limited to optional hooks that default to the
   current behaviour** and are proven unchanged by the existing suites:
   `simultaneous_action_grace(phase)` (clock), `simultaneous_bot_think_seconds`
   (bot driver), `bot_seat_rating` (bot seating), plus per-mode enable flags
   and one read-only personal-stats route.
4. **Canonical data is a new committed artifact** produced by the Python model
   (`scripts/build_prime_windows.py`), not a TypeScript computation, and pinned
   to the committed leaderboard CSVs by tests.
5. **No migration.** The existing match/result/rating tables represent 4-seat
   matches, placements with ties and mode-scoped ratings honestly.
6. **New frontend primitives are shared only between the two new modes**
   (`useArenaRoom`, the match strip, the podium). Existing rooms keep their
   own components.

## Consequences

- A defect in either new game cannot change the rules of another game.
- Some duplication remains (a new polling hook next to the Showdown's). That
  is accepted: migrating the Showdown onto it would be a behaviour change
  outside this pass's mandate.
- A future engine consolidation, if ever wanted, can start from two modes that
  already share `useArenaRoom` rather than from seven divergent ones.
