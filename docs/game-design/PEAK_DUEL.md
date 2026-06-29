# Peak Duel — Game Design Document

## Concept

Peak Duel is PEAK3 Arena's core game mode. The central question:

**"Which player had the greater peak?"**

Two player peak windows of equal duration are shown side by side. The user chooses the one they believe PEAK3 rates more highly, then receives an animated reveal showing real scores and component-level explanations.

## Modes

### Daily Challenge
- 10 duels per day
- Same 10 matchups for all players globally (UTC-date seed)
- One attempt per day per duration
- Completion persisted in localStorage
- Returns the next day with a new challenge

### Endless Mode
- User selects peak window duration (1, 2, 3, or 5 years)
- Generates 30 duels per session (server returns more when exhausted)
- No daily limit
- Tracks high score and best streak

## Duel Generation

### Pool
- Source: `data/web/leaderboards.json` for the selected duration
- Uses ranks 1–150 (prioritized) for competitive interest
- All duels within a session use the same duration

### Constraints
- No self-matchups (same player_id on both sides)
- No duplicate pairs in one session
- No consecutive same player when pool is large enough
- No ties (effectively identical prime_index)

### Determinism
- Daily challenge: seed = SHA256 hash of `{date}-{years}yr` truncated to int
- Endless: random seed returned from server, used for client-side state
- Same seed → always same duel list

### Difficulty
Derived from the distribution of `|prime_index gap|` across all possible pairs for the given duration:
- **Comfortable**: gap in top 25% of distribution (easy to tell apart)
- **Tricky**: 50th–75th percentile gap
- **Brutal**: 25th–50th percentile gap
- **Photo Finish**: bottom 25% (nearly indistinguishable by formula)

## Arena Points

Arena points are a **gameplay-only** scoring system, completely separate from PEAK3 basketball scores.

```
base = 100  (correct answer only)

closeness_bonus = up to 200 pts
  → percentile_rank(gap, all session gaps)
  → lower gap = harder = more points
  → bonus = 200 × (1 - gap_percentile / 100)

speed_bonus = up to 100 pts
  → 0 pts if elapsed < 1000ms (reaction floor)
  → full 100 pts if elapsed ≤ 5000ms
  → linear decay to 0 at 30000ms

streak_multiplier = 1.0 + (0.05 × streak), capped at 1.50
  → 1 correct = 1.05×
  → 10 correct = 1.50× (cap)

total = int((base + closeness_bonus + speed_bonus) × streak_mult)
      = max 600 pts per duel (capped)

incorrect = 0 pts, streak resets to 0
```

## Pre-reveal State

Before the user answers, only this is shown per player card:
- Player name
- Duration (e.g., "3-year peak")
- Season range (e.g., "2010-11 — 2012-13")

**Never shown before answer:**
- Official rank
- Prime score / prime index
- Component values
- Any ordering hint in page source or client state

## Reveal Animation

After the user selects, the API is called with the selection. On success:
1. Score numbers animate into view for both players
2. Winner card highlighted in green
3. Loser card dimmed
4. Points awarded displayed with spring animation
5. Component comparison bars animate in sequentially
6. Deterministic explanation displayed

## Explanation Generation

Explanations are generated from actual component differences — no LLM.

Algorithm:
1. Compute `diff[component] = winner_val - loser_val` for all 5 components
2. Sort by diff descending
3. Find the largest advantage for the winner
4. Find the largest advantage for the loser (negative diff)

Style rules:
- Photo Finish (gap < 2.0): "This was a photo finish: PEAK3 rates X ahead primarily through [component]."
- Single decisive component: "Within this formula, X's advantage came primarily from [component]."
- Two components + loser's best: "The model gives X the edge through [A] and [B], while Y led in [C]."
- Default: "PEAK3 rates X ahead of Y in this N-year window."

Language always:
- Uses "PEAK3 rates", "the model gives" — never "X is objectively greater"
- References the specific window duration and seasons
- Is concise (1–2 sentences)

## Keyboard Controls

| Key | Action |
|-----|--------|
| ← or A | Select left player |
| → or D | Select right player |
| Enter or Space | Advance after reveal |

## Share Format

```
PEAK3 Arena — Jun 28
8/10 correct
2,340 Arena Points
Best streak: 5
🟩🟩🟥🟩🟩🟩🟥🟩🟩🟩
peak3.arena
```

- Uses Web Share API when available, clipboard fallback
- Never includes which player won each matchup (avoids spoiling for others)
