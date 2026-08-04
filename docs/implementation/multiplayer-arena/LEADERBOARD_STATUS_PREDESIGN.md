# Pre-design: state the leaderboard verdict before the button is pressed

**Status: SKETCH FOR REVIEW. Not implemented, not approved.** Written at the
lead's request so the user can see the shape before anything is committed to.

## The problem this addresses

The hosted investigation ended with two live mechanisms (A: the player saved
instead of submitting; B: the submission was refused for a missing handle) and
one that collapses into A (C: an incomplete-score run disables the submit
button, which funnels the player to Save). They share one root shape:

> The player learns they cannot get onto the leaderboard **at the moment of
> refusal, or never at all.**

Today the result screen answers "can this run be ranked?" in three places, none
of which is a single plain statement:

| Where | What it says | When the player sees it |
| --- | --- | --- |
| `SeasonResultStub.tsx:442-453` | "Not leaderboard-eligible · <server reason>" | only when *ineligible for score reasons* |
| `LeaderboardSubmitPanel.tsx:124-143` | disabled "Not eligible yet" button | only when `lineup_score_status === "incomplete"` |
| `LeaderboardSubmitPanel.tsx:160-186` | red error + "Set up your public handle" | only **after** a click that failed |

The handle requirement — the one most likely to be hit by a real player, since
onboarding deliberately never blocks gameplay — is the only one with *no*
pre-click representation at all.

## The shape

**One status line, always present, in the submit panel, rendered before any
interaction.** It answers exactly one question: *is this run going on the
leaderboard, and if not, what would fix that?*

Four states, mutually exclusive:

| State | Line | Action shown |
| --- | --- | --- |
| Eligible, signed in, handle set | "This run is eligible for the global leaderboard." | **Submit to leaderboard** |
| Eligible, signed in, **no handle** | "Set a public handle to submit this run — it's the name that appears on the board." | **Set up your handle** → `/profile` |
| Eligible, **signed out** | "Sign in to put this run on the global leaderboard." | **Sign in** |
| **Not eligible** (unscored cards) | server's `reason_detail`, verbatim | none; Save/Share remain |

## Constraints this must respect

1. **Not a redesign.** Everything lands inside the existing
   `LeaderboardSubmitPanel`, which already renders in all four of these
   situations. No new surface, no layout change to the result screen, no
   change to `SaveRunPanel`.
2. **No new server contract.** `compute_eligibility` already returns
   `leaderboard_eligible` / `reason` / `reason_detail`, and the public state
   already carries `lineup_score_status`. The only genuinely new input is
   "does this account have a handle?", which `GET /profiles/me` already
   answers — no endpoint changes.
3. **Do not loosen the eligibility gate.** A fully-scored roster stays
   required. This work makes the existing rule *legible*, never weaker.
4. **Do not restate the eligibility banner.** If the panel states the
   ineligibility reason, the separate banner at `SeasonResultStub.tsx:442`
   becomes a duplicate and one of the two should go — a deletion to decide
   deliberately, not to leave as accidental redundancy.
5. **Saving must never imply submitting.** Out of scope for the line itself,
   but note `SaveRunPanel`'s success copy is "Saved to your history" plus
   "New personal best!" — accurate, and still the most likely thing a player
   reads as "I'm on the board". Worth deciding on alongside this.

## Open questions for the user

- Should the handle prompt appear on the result screen at all, or is the right
  fix to make onboarding ask for a handle at sign-up (making this state rare
  rather than well-explained)? These are different products, not two versions
  of the same fix.
- When a run is ineligible, should the panel be visible at all? Showing a
  permanently-disabled button has its own cost.

## What this does not claim

This is not a diagnosis. The hosted root cause is still unconfirmed pending the
DevTools check. This shape helps under mechanism A **and** B, which is why it
was worth sketching before the answer arrives — but if the check shows
something else entirely, this sketch should be reconsidered, not retrofitted.
