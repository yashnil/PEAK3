# Lead verification — 82-0 positional placement and swapping

`game-experience` built this and, per the writer/verifier rule, may not certify
it. `visual-platform` is occupied with the perf harness and screenshots, so the
lead verified. Source-level against the integrated branch @ `ddba3f1`.

## The four gaps

| # | Gap | Verdict |
| --- | --- | --- |
| 1 | No preview before commit | **PASS** |
| 2 | No undo | **PASS**, with an honest asymmetry |
| 3 | Occupied slots inert during placement | **PASS** |
| 4 | ~9 px Move button | **PASS with a documented deviation** |

### 1. Preview before commit

`pendingSwapConfirm` state (`CourtBuilder.tsx:97`), set on destination click
(`:300`), resolved only by explicit confirm or cancel (`:308-318`). The mutating
call no longer fires on the click that selects a destination. Move-into-empty
still commits in one click, which is correct — there is nothing to disambiguate.

### 2. Undo, and where it honestly isn't one

Swaps get a real `showToast(message, "Undo", …)` (`:279`) that re-swaps.
`action_swap_slots` is its own inverse, so the reversal is exact rather than
reconstructed.

Placement gets a toast labelled **"Move", not "Undo"**, because `state.py` has
no un-place action (`:200`). It jumps into rearrange mode with the card
preselected. **This is the right call.** An "Undo" that does not undo teaches a
false model of the control; the weaker true label beats the stronger false one.

### 3. Occupied slots during placement — **MY VERDICT HERE WAS WRONG**

**Corrected after `game-experience` found the gap in its own work.** What I
wrote below is accurate about the code and wrong about the product.

I read both branches, noted the `onMove` path falls back to a labelled
container because a disabled button wrapping a live button is invalid HTML, and
called it "a deliberate, documented trade". **I never checked which branch
actually renders in ordinary play.**

`onMove` requires `rearrangeAvailable = filledSlotCount >= 1` — true the instant
*any* slot is filled. So from a player's second pick onward, the labelled
disabled button is **unreachable**. The branch I treated as the corner case is
the common case, and the branch I verified as the fix is the corner case. The
accessible explanation reaches a real player almost never.

Caught by the e2e test `game-experience` wrote for its own work, which failed
reproducibly in a clean single-worker environment — not by my source read. My
method's stated limit (source-level, not driven live) is exactly what let this
through, which is why the limit was worth writing down even though it read as a
caveat at the time.

Fixed by giving the container branch its own `aria-label`/`aria-disabled`, so
the explanation reaches assistive tech regardless of which branch renders, and
by re-pointing the test at the *property* rather than a specific testid.

**Original (incomplete) verification follows.**

### 3a. Occupied slots during placement — as originally verified

Was a plain `<div>` with no handler — clicking did nothing, with no explanation.
Now a real `<button disabled>` carrying the reason as its `aria-label`:
*"{Slot} is already filled by {player}. Place your new pick in an open slot
instead."*

Where `onMove` is simultaneously live it stays a container instead, because a
`<button disabled>` wrapping a working button is invalid, inert HTML. The reason
is then visible text (*"Full — place in an open slot"*) rather than the card's
accessible name. That text is in the accessibility tree, so it is reachable —
a deliberate, documented trade, not an oversight.

The reasoning is grounded in the engine rather than assumed: `action_place_card`
genuinely rejects an occupied slot, while `action_swap_slots` explicitly permits
rearranging "including with a selection pending". So the fix is to *state* the
illegality, not to make it clickable.

### 4. Touch target — deviation recorded rather than claimed

Grown from `px-1.5 py-0.5` at 9 px font to `min-h-[32px]` with `px-3 py-2`.

**32 px is not the project's own `--pk-tap-min: 44px` floor**, and the previous
pass's contract said not to regress below it for any new control. This is not a
regression — it is a ~3.5× improvement on the previous value — but it does not
reach the stated floor either.

The stated reason is real: the card is `min-h-[72px]` and already carries a
name, a team/season line and a fit badge, so a literal 44 px button would
dominate it. 32 px clears WCAG 2.2 SC 2.5.8 (24 px) comfortably.

**Accepted as a documented deviation.** Recorded here rather than reported as
"touch target fixed", because the project's own floor is 44 px and a reader
comparing this to the previous pass's rule should see the difference, not
discover it.

## What was correctly left alone

The brief's two headline hypotheses were false and were not "fixed":

- It is already **click/tap-only** — no drag anywhere.
- It is **fully keyboard-operable** through real `<button>`s.
- Legal targets already carried dashed borders and explicit
  "Place here" / "Swap here" / "Move here" labels.
- Selection state was already visible.

None of this regressed. Not touching working behaviour is as much a result as
changing broken behaviour.

## Verification method and its limit

Source-level, against the integrated tree, cross-read with `state.py` to confirm
the engine actually behaves as the UI claims.

**Not** driven live in a browser by the lead — and that limit produced a real
miss, recorded above in §3. Reading two branches and reasoning about which one
*should* apply is not the same as observing which one *does*. A source read can
confirm code exists; only running it confirms code runs. Live click/keyboard/mobile
exercise of the swap flow is covered by the two Playwright specs
`game-experience` added and by the full e2e run in validation. Recording the
limit rather than implying a browser session that did not happen.
