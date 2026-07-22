# Reference screenshots (pending capture)

This directory is the intended home for the screenshot manifest referenced
by [`PEAK3_GAME_PLATFORM_MASTER_PLAN.md`](../PEAK3_GAME_PLATFORM_MASTER_PLAN.md)
(§1.1's "How future AI agents must use this plan," §2.1, and Appendix B). It
does not exist as tracked content yet — this README exists so the master
plan's relative links (`reference_screenshots/...`) resolve to a real,
documented location instead of a dead path.

## Why this directory exists

The master plan's product case for retiring the current Peak Draft as the
flagship loop rests partly on visual evidence, not just prose: what the
existing draft screen looks like, where it breaks, and what comparable
products (Six Rings, First Down Studio) do differently. Appendix B expects
these files:

| Expected file | Purpose |
|---|---|
| `current-peak-draft-round-2.png` | Current Peak Draft mid-round — visible ratings/rank make the choice too obvious |
| `current-peak-draft-round-4.png` | Rigid role completion, minimal opponent/story context |
| `current-peak-draft-role-dead-end.png` | A selected player cannot be assigned because all compatible roles are filled or ineligible |
| `current-result-load-failure.png` | The P0 result-loading failure after a completed draft (see master plan §2.1, §19.5) |
| `first-down-studio-result-card.png` | Competitor reference: iconic goal, compact roster, record, grade, share actions |
| `idea-100-score-gauntlet.png` | Concept reference: constraint/boss-team ideas |
| `idea-peak-doku.png` | Concept reference: grid/rarity inspiration for a side mode |
| `idea-salary-cap-draft.png` | Concept reference: salary/value draft and multiplayer ladder inspiration |
| `six-rings-trophy-case.png` | Competitor reference: persistent accomplishments, mode shelves, identity |
| `six-rings-duels.png` | Competitor reference: ranked/FFA/rooms/lobbies ecosystem |

## Status

**Not yet captured.** None of the files above exist in this repository. The
master plan's links to them are placeholders for future work, not evidence
that the underlying failure modes (in particular the result-loading failure)
have been reproduced and documented visually — see
`docs/implementation/CURRENT_PROJECT_STATE.md` for what has and hasn't been
independently verified.

## How to fill this in

When capturing these:

- Save PNGs directly into this directory using the exact filenames in the
  table above, so the master plan's existing relative links resolve without
  further edits.
- Competitor screenshots (Six Rings, First Down Studio) are for internal
  product-lesson reference only — see the licensing/rights caveats in the
  master plan's own principles before using them in any public-facing
  document.
- This is unrelated to `docs/product/blueprint_pages/` (the rendered
  69-page source blueprint PDF) and `docs/product/blueprint-assets/` (hand-
  picked crops from that PDF) — those are already populated and serve a
  different purpose (visual index of the original blueprint document, not
  product-failure/competitor evidence).
