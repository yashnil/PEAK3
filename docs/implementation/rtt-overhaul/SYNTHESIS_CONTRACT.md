# SYNTHESIS CONTRACT — Phase 2 gate

Binding on all four teammates. Where this document and a teammate's own audit
disagree, **this document wins**. Disagreements were resolved by evidence:
canonical datasets, deterministic engine output, live measurements against
hosted staging, accessibility standards, and product clarity — in that order.

Inputs: `SCORE_RECONCILIATION.md`, `PRODUCT_EXPERIENCE_CONTRACT.md`,
`PERFORMANCE.md`, `RTT_ARCHITECTURE_AUDIT.md`.

---

## 1. Score semantics

Settled in `SCORE_RECONCILIATION.md` §1–3. Summary of what binds implementers:

- **No numerical defect.** 75/75 lane-battles verified bit-identical. Nobody
  changes engine math in this pass.
- The lane number is a **bench-weighted average of a 0–100 normalized component
  index across the whole roster**.
- Labels: **`YOUR LINEUP RATING`** and **`BOSS LINEUP RATING`**.
- Definition string, verbatim, wherever the term is explained:
  > The bench-weighted average strength of the lineup in that PEAK3 component,
  > normalized to a 0–100 scale.
- Contract field names: **`lane_rating`** (per-lane), **`lineup_rating`**
  (lineup-level). **`roster_total` is reserved** for the existing distinct
  engine quantity and is neither reused nor renamed.
- `TOP CONTRIBUTOR` is rendered with **its own** value from `card.lane_index`
  (already on the wire). Relabelling alone is insufficient.
- **No individual player label may visually own a roster-wide number.**

## 2. Backend payload changes (`score-integrity`)

### 2.1 Conceal unrevealed slots

Apply the `boss_public()` pattern to `_slot_public()` / `public_state()`.

- A concealed slot serializes **shape only**: `slot_id`, `role`, `is_starter`,
  `card: null`. No name, slug, seasons, window, `prime_score`, percentile,
  cost, or lane values.
- Top-level `lane_profile` / `roster_total` / `bench_weight` must not leak
  unrevealed aggregate strength. Until the roster reveal is complete, compute
  them over **revealed slots only**, and mark the block `partial: true` so the
  client can label it honestly rather than silently showing a different number
  than it will show later.
- `reveal_public()` is already correct. Do not change it.
- Add an API test asserting no unrevealed identity appears anywhere in a
  freshly created run's serialized payload. This is the regression gate.

### 2.2 Batched reveal

The opening reveal currently costs **7 round trips**. Target: **one**.

The server already supports saturating the reveal in a single call
(`reveal("roster", 7)`). The contract is:

- One user action → **one** request → server returns all 7 authoritative
  `revealed_slots` in order.
- The client then **paces its own presentation** of already-committed data.
- The `can_skip` rule (skip offered only after the first card) is a server rule
  about the *reveal action*; it must not be reinterpreted client-side.

**Presentation cursor.** After the batched call, every slot is revealed
server-side, so the roster dock cannot gate on `revealed_slots` alone. The
client keeps a local presentation cursor and renders
`min(server_revealed, presentation_cursor)`. Server concealment (§2.1) remains
the security boundary for the pre-action state; the cursor is choreography only.
`rtt-experience` owns the cursor; it is **not** a second source of truth for
*which* card is revealed — only for *when it is shown*.

### 2.3 Battle receipts

Every lane payload separates, as distinct fields:

```
player_lineup_rating · boss_lineup_rating
pre_perk_rating · perk_adjustment · bench_adjustment · final_rating
top_contributor { name, own_lane_index_value }
margin · winner
```

Expandable receipt data must be sufficient to explain the result without the
client recomputing anything. Deterministic fixtures pin the three audited seeds.

### 2.4 Leaderboard (task #7)

Close gaps 1–4 in `SCORE_RECONCILIATION.md` §5: `next_cursor`, personal
placement, privacy/hide controls, and the email-local-part handle fallback.
Keep every item in the "already correct" table intact. Ranked stays disabled.

## 3. Theme token system (`platform`, owner of `globals.css`)

- `data-theme` on `<html>`, set by a **blocking inline script before paint**.
  System preference on first visit. Persisted. No FOUC, no hydration mismatch.
- Existing `:root` values become the dark block **unchanged**. Light is added
  **additively**. No existing token is renamed, removed, or has its dark value
  changed.
- `--peak-accent: #f5c842` and every `--comp-*` keep **identical hex values in
  both themes** (frozen by CLAUDE.md). What changes is *deployment*: glow
  against near-black in Arena Night, solid fill / underline in Arena Day.
- Dark = **Arena Night**. Light = **Arena Day / Press Box** — warm-white to
  light-grey, not pure white. The three-tier elevation stack
  (page < elevated < surface) must remain legible in both. A card must not
  become flatter in light mode, only differently lit.
- **217 hardcoded hex values across 54 `.tsx` files** bypass tokens today
  (worst: `DraftReceipt.tsx` 15, `SeasonResultStub.tsx` 11, `SaveRunPanel.tsx`
  10). Migrating those that appear on RTT, homepage and leaderboard surfaces is
  in scope; a documented inventory of any remainder is required.
- Ship `theme-color` for the browser chrome.

## 4. RTT state-machine presentation (`rtt-experience`)

Per `PRODUCT_EXPERIENCE_CONTRACT.md` §2–6, which is adopted in full. Highlights
that are hard gates:

- Opening reveal: 7 concealed slots; **one** user action; automatic queueing;
  ~8–12 s; pause / skip-all / reduced-motion-immediate; the 9-step per-card
  sequence.
- The roster dock **defaults to fully concealed during an active reveal**,
  regardless of user preference. This resolves the leak by construction.
- Boss cinematic: named intro, philosophy, win condition, 3-2-1 countdown,
  arena treatment, skip from the first frame; paired sequential lineup reveal
  using the **same** per-card grammar (verified by shared component/hook usage,
  not visual similarity); automatic five-lane resolution; persistent scoreboard;
  decisive verdict; pause / skip-to-result / replay.
- **Replay replays an already-resolved result. It never re-fetches or
  re-decides.** No invented optimistic outcome while waiting for the server.
- Game shell: top HUD; one dominant centre interaction; compact expandable
  roster dock; compact act timeline with a history drawer. The run map renders
  **no more than 2 stages** of unreached future content by default.
- Preserve every server-authoritative signal already present: `legal_slots`,
  `selectable`, `blocked_reason`, `effective_cost`/`base_cost`, the
  `aria-disabled`-not-`disabled` pattern for blocked offers, the Trade Desk's
  honest weighting caveat, and Scout's `would_flip`. This is a presentation
  overhaul, not a mechanics overhaul.
- Every new cinematic surface registers in `surfaceKeyFor()` and inherits the
  existing focus-to-`<h2>` treatment. Do not special-case cinematics out of it.

## 5. Animation timing and reduced motion

`PRODUCT_EXPERIENCE_CONTRACT.md` §8's table is binding. New durations are added
to the existing `--pk-dur-*` / `MOTION_DURATION_MS` scale — **no new magic
numbers**.

Reduced motion collapses each beat to its **final, fully-informative state at
zero duration**, matching the existing `motionTransition(..., true)` contract.
"The same animation, only shorter" is a Phase 5 rejection.

**No state may be carried by a blanket `opacity` reduction on a text
container.** This codebase has already had to fix that bug twice
(`RunMap.tsx:56-62`, `DraftRoom.tsx:99-101`). The "lights lower" beat and the
run-map compaction must not reintroduce it.

### 5.1 Lead ruling — §8's table vs the 8–12 s target

`rtt-experience` found, and correctly flagged rather than silently resolved, a
**genuine internal contradiction** in `PRODUCT_EXPERIENCE_CONTRACT.md`: §8's
per-beat table sums to ≈2.9 s per card, which over 7 cards is ≈20 s, against
§2's stated total of 8–12 s. Read literally and strictly sequentially, both
cannot hold.

**Ruling:**

1. **The 8–12 s total is binding.** It originates in the product brief, not
   only in the contract, and it is the requirement a player actually
   experiences. Where the two conflict, the total wins.
2. **§8's table is a relative-emphasis reference, not a set of absolute
   durations.** Beats compress proportionally to fit the budget. The ordering
   and the relative weighting must be preserved — `identity` and `score` remain
   the two longest beats, per §2's "single most information-dense beat".
3. **`lights_lower` fires once per sequence, not once per card.** Dimming and
   undimming the shell seven times in ten seconds would itself be the
   distracting motion the contract exists to prevent. This is a correction to
   §8, which listed it as a per-card beat.
4. The **sequential compressed model (~9.4 s / 7 cards) is accepted.** The
   overlapping-cards alternative licensed by §2 step 9 remains valid but is not
   required; it is a materially larger implementation for the same visible
   result in the common case, and correctness under pause/resume/skip-all is
   harder to guarantee.
5. **Duration scale — superseded by a better resolution.** This clause
   originally permitted two coexisting scales: `platform`'s standalone
   `--pk-dur-reveal` (400 ms) / `--pk-dur-count` (600 ms), and
   `rtt-experience`'s sequence-local compressed values.

   `rtt-experience` instead **converged on one scale** (commit `7e7eadb`):
   `reveal-timing.ts` now consumes the official `MOTION_DURATION_MS.reveal` /
   `.count` for those two beats, and the *other* beats were re-tuned so the
   7-card sequence still lands at ~11.8 s — inside the binding 8–12 s target.

   This is strictly better and is now the contract: one scale, no divergence,
   nothing for a later reader to confuse. The permission to diverge is
   withdrawn. Note ~11.8 s sits near the top of the 8–12 s band, so any future
   beat added to the sequence must come out of an existing beat's budget, not
   on top of it.

### 5.2 Component colours are not text colours on Arena Day

Established independently by `platform` (homepage) and `rtt-experience` (RTT
surfaces), both by **measurement**, not inspection:

- Every `--comp-*` clears AA on Arena Night (6.2–10.2:1) and **fails even the
  3:1 large-text floor on Arena Day** (1.6–2.6:1) when used as plain text.
- `--comp-*` is therefore safe as **bar fill and border only**. Where a
  component colour currently carries a numeral or a word, the text moves to
  `var(--text-primary)` and the colour is retained as an adjacent dot or
  border accent, preserving identity without carrying legibility.
- `rtt-experience` additionally found `RunMap`'s "current row" state word using
  bare `--peak-accent` on the accent wash: 10.95:1 on Arena Night but
  **1.24:1 on Arena Day**. Pale gold on near-white is a bad pairing regardless
  of which theme intended the combination. Resolved with
  `color-mix(--peak-accent 40%, --text-primary)`, which inherits
  `--text-primary`'s per-theme flip automatically — 13.26:1 dark, 4.91:1 light.

**Rule for the remainder of the pass:** any token tuned for one theme must be
re-measured before it is reused as text in the other. Neither `--comp-*` nor
`--peak-accent` is theme-portable as a text colour. Contrast tables are
documented inline at the point of use, following the precedent already set in
`RunMap.tsx`.

### 5.3 Lead ruling — one text-safe colour mechanism, not two

Both frontend teammates independently hit the same wall and solved it
differently. `platform` additionally measured `--peak-accent` at **1.50:1**
against the light card surface, which fails AA at *every* text size — worse
than `--correct`/`--incorrect`, which failed only at small sizes.

| Teammate | Mechanism |
| --- | --- |
| `rtt-experience` | `color-mix(--peak-accent 40%, --text-primary)`, applied ad hoc at one call site |
| `platform` | Named additive sibling tokens `--peak-accent-text`, `--comp-{si,tp,rec,po,team,tm}-text` — identical hex on Arena Night, darkened and measured ≥4.5:1 on Arena Day — plus `componentTextColor()` in `lib/utils.ts`, mirroring the existing `componentColor()` |

**Ruling: `platform`'s named-token mechanism is the single approved one.**
Reasons, in order of weight:

1. It is **discoverable**. A later contributor reaching for a component colour
   as text finds `componentTextColor()` next to `componentColor()`. A
   `color-mix` expression buried at one call site teaches nobody.
2. It is **measured once and reused**, rather than re-derived per site — so
   correctness cannot drift between call sites.
3. It is **testable**: a single test can assert every `-text` token clears
   4.5:1 in both themes. An inline `color-mix` has to be verified visually at
   every site that uses it.
4. It mirrors the resolution already applied to `--correct`/`--incorrect`, so
   the codebase ends with one pattern for this class of problem, not three.

`rtt-experience` migrates its `RunMap` `color-mix` to `--peak-accent-text`.
The frozen values are untouched by either mechanism — verified: `--peak-accent`
`#f5c842`, `--comp-si` `#60a5fa`, `--comp-tp` `#a78bfa`, `--comp-rec` `#f472b6`,
`--comp-po` `#fb923c`, `--comp-team` `#34d399`, `--comp-tm` `#94a3b8`, all
matching CLAUDE.md exactly. The `-text` siblings are **additive**, which the
token contract permits.

### 5.4 Two latent CSS bugs found during migration

Both pre-existing, both unrelated to theming, both invisible until a token
replaced a literal:

- `DraftScreen.tsx` built `"var(--peak-accent)10"` — a hex-alpha suffix
  concatenated onto a `var()` reference. That is invalid CSS in **every**
  theme, silently dropped by the browser.
- `SpinStage.tsx` referenced `--border-muted`, a token **never defined
  anywhere**, so its `#333` fallback was the only value that ever rendered.

Root cause worth recording: `${color}NN` hex-alpha string concatenation only
ever worked because the source was a literal hex. The moment such a value
becomes a `var(--token)` reference, concatenation produces invalid CSS that
fails silently. Every such site is now a `color-mix()` alpha wash. **Any future
alpha-on-token work uses `color-mix()`, never string concatenation.**

**Phase 5 must verify against the 8–12 s total and the preserved relative
emphasis — not against §8's literal per-beat numbers.** An implementation
matching §8 literally would violate the binding total and must be rejected.

## 6. Loading and latency behaviour

Measured baseline (`PERFORMANCE.md`), not estimated:

- Every RTT action POST costs a flat **~365–375 ms p50 on staging** vs ~3 ms
  locally against an in-memory backend. Payload size does not explain it
  (`rtt.meta` 4.9 KB/60 ms vs `rtt.choose_node` 32 KB/369 ms). It is write-path
  cost — `load_run` + `save_run` per action against real Postgres.
- Every action response resends the **full** run state: ~600 KB–1.4 MB raw JSON
  per playthrough for data that is 90 %+ identical call to call.
- `courtbuilder.place_card` is 103 ms p50 *locally* — 10–30× every RTT bucket
  under identical conditions. `complete_game` is 634.9 ms p50 on staging.
- `getAccessToken()` runs a real `getSession()` on **every** RTT fetch, read and
  write, un-memoized and serial.

Required:

- Visible response to interaction **< 100 ms**, always. Never a blank stage.
- Skeletons retain dimensions. **Zero CLS** during stage transitions.
- Memoize `getAccessToken()`. Cache invariant static rules/card metadata.
- Avoid duplicate requests; parallelize independent reads; prefetch predictable
  next-stage assets.
- Instrument action timings; re-run `scripts/perf/measure_rtt.py` **unmodified**
  for after-numbers. A "performance improvement" without before/after numbers
  from that script is a Phase 5 rejection.
- The ~365 ms write-path floor is infrastructure-bound. Report it honestly
  rather than claiming an improvement not achieved.

## 7. Homepage scope — full brief scope

`product-director` proposed narrowing this to hierarchy fixes. **Overruled by
the product owner.** `platform` builds the full section-H scope:

- Hero: live roster-versus-boss visual, real canonical rotating player-window
  cards, `Start RUN THE TABLE`, `Explore Rankings`, `Continue Run` when
  available.
- Interactive PEAK3 comparison: real rows, five components, click a component
  for its explanation, links into the exact rankings entries.
- Mode gallery: RTT, 82-0, Daily Grid, Peak Duel — each with duration,
  objective, account requirement.
- Leaderboard preview: 82-0 all-time, daily, personal best, authenticated state.
- Credibility: five-component model, provenance, receipts. **No fake metrics,
  no testimonials.**

Preserve the frozen invariants `product-director` correctly identified: the
single `<h1>` with its exact frozen sentence, exactly one
`[data-featured="true"]`, the `MODE_COPY` single source of truth, and every
listed `data-testid`.

## 8. Assets

- Every resolved asset carries `license_status="unknown_do_not_cache"` and
  `cache_policy="dev_hotlink_preview_only"` **in the committed manifest itself**.
  Coverage is 534/3494 players (15.3 %) and 30/40 teams (75 %).
- `PEAK3_ENABLE_EXTERNAL_ASSET_URLS` defaults false; RTT has **zero** asset-URL
  surface today. `PlayerAvatar`'s deterministic initials-on-gradient fallback is
  the actual default path.
- Support the flag for staging. Fixed dimensions, no layout shift, premium
  local fallback, images **never structurally required**.
- **Turning the flag on for public use is a licensing decision, not an
  engineering one.** It is recorded as an external blocker and must not be
  presented as resolved. Do not state legal or asset assumptions as facts.

## 9. Ownership and integration order

`FILE_OWNERSHIP.md` is binding, including the contested-file arbitration.
`platform` owns `globals.css`; `rtt-experience` consumes `var(--token)` only and
requests new tokens. `platform` notifies `rtt-experience` before any
`GuidedTour` prop change — the `data-tour-id` contract at
`RunTheTableGame.tsx:1062-1085` is load-bearing for existing tour tests.

Cherry-pick order: **score/API → theme/shared primitives → RTT frontend →
homepage/leaderboards/assets → test and generated-file reconciliation.**

`#8` (theme + shared primitives) blocks `#9`, `#10`, `#11`. This is the single
most important ordering constraint: it is what stops two teammates inventing
incompatible visual systems.

## 10. Standing constraints

No merge to `main`. No public deployment. Ranked stays disabled. No formula or
canonical-row change (none is authorized — see §1). No weakening of auth,
ownership, RLS or IDOR protections. No secrets or environment values in git.
