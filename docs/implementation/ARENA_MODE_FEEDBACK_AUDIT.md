# Arena mode feedback audit

One pass over every genuinely playable mode, asking the same six questions of
each. The point of the audit is not "more CSS" — it is the loop:

> ACTION → IMMEDIATE FEEDBACK → CONSEQUENCE → NEXT DECISION

A mode fails this audit when a player presses the thing the mode is about and
nothing happens until the network answers.

For each mode: **A.** the one dominant game object · **B.** what changes when
the player acts · **C.** what confirms success · **D.** where tension lives ·
**E.** what makes it visually distinct · **F.** is the most important thing
the most prominent thing.

---

## Three-Man Weave

| | |
|---|---|
| **A** | Your court — six slots, five on the floor and one on the bench. |
| **B** | The card lands in the slot you chose, in the same frame as the press. |
| **C** | The slot locks with the arrival beat; the pending marking clears when the server agrees. |
| **D** | The turn clock, on whichever court the server says is on it, plus the identity lock — a name taken by any seat is gone for every seat. |
| **E** | Three painted half-courts, one lit. |
| **F** | Yes. |

**Fixed this pass.** The court had no floor, so three columns of slots read as
three forms; a press waited a full round trip before anything moved; a stale
move could take the page down; and the result screen's standings were three
flat lines. See the pass's own commits.

**Remaining weakness.** The draft room's roster pane has visible empty space
below the six slots now that the dialog uses the viewport height. Not a
regression — the alternative was the internal scrollbar that was reported —
but the pane could carry more.

## $20 Showdown

| | |
|---|---|
| **A** | The lot: one player, one card, centre stage. |
| **B** | The bid locks, the budget projects, both turn rails change state. |
| **C** | SOLD, settling toward the column that won it, and the slot locking on that lineup. |
| **D** | Two turn rails and one central clock counting the same authoritative deadline, against a budget that only goes down. |
| **E** | An auction floor: two lineups facing each other across a lot. |
| **F** | Yes. |

**Fixed this pass.** The room used to blank itself for the length of every
request; there was no per-seat clock; and a resolved lot stamped in the middle
while the card appeared silently on one side.

**Remaining weakness.** The event moment ("FullCourtPress raises to $3") is
positioned directly under the standing bid, which is where the central clock
sits, so it covers the countdown digits for its 1.4s hold. The information is
no longer lost — both turn rails now show the same number — but the overlap is
still an overlap.

## Daily Grid

| | |
|---|---|
| **A** | The 3x3 board. |
| **B** | The pressed search row depresses and marks itself in flight. |
| **C** | The square fills and locks, and only then reveals its score. |
| **D** | Nine squares, nine different players, and every pick final. |
| **E** | A grid with real basketball axes and a hidden score. |
| **F** | Yes. |

**Fixed this pass.** The mode's single most repeated control — the search row
that locks a square — had no press state at all, and submitting disabled every
row at once with nothing to say which one had been chosen. The result screen
buried its most useful sentence in 11px muted prose.

## Peak Duel (Daily and Endless)

| | |
|---|---|
| **A** | Two peak windows, side by side. |
| **B** | The chosen side presses and holds a selected state. |
| **C** | The reveal: correct or not, with the two real scores. |
| **D** | A daily run of ten with no second chances; endless runs until a miss. |
| **E** | A two-card comparison, nothing else on screen. |
| **F** | Yes. |

**No change needed.** `.duel-side` already has a press transform and a
`data-pending` state on the selected card, which is the contract this audit
asks for.

## Run the Table

| | |
|---|---|
| **A** | The run map and the roster it feeds. |
| **B** | Every decision goes through `GameActionButton`. |
| **C** | The node resolves and the map advances. |
| **D** | Credits, a boss ladder, and a run that ends. |
| **E** | A roguelike run track. |
| **F** | Yes. |

**No change needed.** Every primary control in the mode is already the shared
acknowledged-on-pointer-down button.

## 82-0 / CourtBuilder

| | |
|---|---|
| **A** | The lineup court. |
| **B** | The chooser's controls acknowledge on press. |
| **C** | The slot fills; the season simulates. |
| **D** | A perfect season with one shot at it. |
| **E** | A single full court rather than three. |
| **F** | Yes. |

**No change needed** for the press contract; its controls already use
`GameActionButton`.

---

## The one rule that came out of this

Every mode that failed the audit failed it the same way: the control the mode
is *about* was not built on the shared press primitive. `GameActionButton` (or
`.pk-press` for a row that is not a command) is the difference between a game
and a form, and it is cheap enough that there is no reason for a repeated
control to go without it.
