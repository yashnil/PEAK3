# Phase 5X — Team and Player Asset / Identity Strategy

**Status:** Strategy/design only. No image assets, team logos, or player
photos are fetched, scraped, downloaded, or committed to the repository by
this document or as part of this pass. Every concrete "safe to build now"
recommendation below is a data-shape or fallback-rendering decision, never
an asset-acquisition action.
**Depends on:** `docs/product/ARENA_OVERHAUL_PRODUCT_SPEC.md` (UI/UX
overhaul goals — team logo wheel, player headshots), `docs/implementation/PHASE_5X_ARENA_OVERHAUL_PLAN.md`
("Phase 5X.6 — Product Direction Reset" section, "Team and player imagery"
subsection), `docs/architecture/PHASE_5X_PLAYER_EXPANSION_STRATEGY.md`
(Sec 7 item 9, "photo/icon fallback coverage" QA gate — this document is
that gate's design source).
**Created:** Phase 5X.6, 2026-07-22.

---

## 0. Why this document exists

CourtBuilder's team + era wheel and player cards are currently text-only.
Comparable products (First Down Studio's 17-0/82-0 builders, Sleeper 17-0)
lean heavily on team logos and player photos for visual hook and
immediate recognizability — a wheel that lands on a team name reads very
differently from a wheel that lands on a spinning, recognizable logo. This
gap was flagged explicitly in the Phase 5X.6 manual review.

The blocking constraint is **not effort, it's rights**. NBA team logos are
trademarked; player likenesses (photos, especially professionally-shot
ones) carry both copyright (the photographer/agency) and, in most
jurisdictions, a separate right of publicity for the player. `CLAUDE.md`'s
existing "No player photographs, no NBA/team logos (unlicensed)" rule
(under Design principles) is not a Phase 1 scoping choice to revisit
casually — it is a standing legal-risk constraint that applies exactly as
much to CourtBuilder as it did to Peak Draft's original design. This
document is how PEAK3 gets the *visual benefit* of team/player identity
without violating that constraint, and defines exactly what would need to
change (a documented licensing decision) before it could.

---

## 1. What's safe to build now vs. blocked on a licensing decision

| Layer | Safe now? | Why |
|---|---|---|
| Asset manifest shape (schema, no URLs populated) | Yes | Pure data structure, no assets |
| Initials/silhouette fallback rendering | Yes | Generated client-side from data already in the pool (player name), no external asset |
| Team-color accent badges (no logo image) | Yes | Team colors are public information (a `#XXXXXX` hex value is not a copyrightable logo), already precedented by `--comp-*` color tokens in `CLAUDE.md` |
| Team logo images | **Blocked** | Trademarked; needs a documented licensing/usage decision (Sec 4) before any image is fetched or committed |
| Player headshot images | **Blocked** | Copyright (photo) + publicity right (player); same gate as team logos, generally a *harder* one to clear |
| A licensed/approved image provider integration (e.g. a paid sports-media API) | **Blocked**, but the **abstraction** for one is safe to build now | See Sec 5 — build the interface today, wire a real provider only after a licensing decision is documented |

---

## 2. Asset manifest shape

A new, versioned, committed JSON file (mirrors the existing interim
team-season dataset's own discipline — explicit version field, explicit
coverage/status note, never silently regenerated):

```text
data/game/interim/team_identity_manifest.v0.json
```

```jsonc
{
  "dataset_version": "team_identity_manifest.v0",
  "status": "placeholder_no_licensed_assets",
  "coverage_note": "No logo/headshot URLs are populated in this version --
    every entry resolves to the fallback badge/silhouette described in
    PHASE_5X_ASSET_AND_IDENTITY_STRATEGY.md Sec 3. This file exists so the
    frontend can render team-color accents and a stable manifest shape
    today, without waiting on a licensing decision.",
  "teams": {
    "boston-celtics": {
      "display_name": "Boston Celtics",
      "primary_color": "#007A33",
      "secondary_color": "#BA9653",
      "logo_url": null,          // populated only after Sec 4 clears
      "logo_license": null,      // provider + license terms, once populated
      "logo_source_provenance": null
    }
    // ... one entry per franchise reachable in the interim team-season
    // dataset (courtbuilder_team_seasons.v3.json), same "only what's
    // actually reachable" discipline as that file.
  }
}
```

Player identity (headshots) get a **parallel, per-player-slug manifest**,
not folded into `card_profiles.v3.json` — imagery is a presentation
concern, versioned and revisable independently of the scoring pipeline
(never touching `card_profiles.v3.json`, per `CLAUDE.md`'s "never
calculate scores" boundary extended to "never conflate scoring data with
presentation data"):

```text
data/game/interim/player_identity_manifest.v0.json
```

```jsonc
{
  "dataset_version": "player_identity_manifest.v0",
  "status": "placeholder_no_licensed_assets",
  "players": {
    "michael-jordan": {
      "display_name": "Michael Jordan",
      "initials": "MJ",
      "headshot_url": null,
      "headshot_license": null,
      "headshot_source_provenance": null
    }
    // ... one entry per player_slug reachable in the interim dataset,
    // same scoping discipline as the team manifest above.
  }
}
```

Both manifests are additive and optional at read time — a missing entry
(or a `null` URL) always resolves to the fallback (Sec 3), never a broken
image or a client-side error.

---

## 3. Fallback rendering (what actually ships this pass, if anything does)

**Silhouette/initials fallback (player cards):** a circular or rounded-
square badge showing the player's initials (derived from `player_name`,
already available, no new data) over a neutral background, optionally
tinted by the player's most-recent team color once the team manifest
above resolves one. No new dependency — pure CSS + a two-letter substring,
same discipline as `CourtLayout.tsx`'s existing CSS-only half-court
(`docs/product/ARENA_OVERHAUL_PRODUCT_SPEC.md` Sec 4.2's "no canvas/WebGL"
rule extends naturally to "no image dependency either, for the fallback
tier").

**Team-color fallback badge (wheel + court context):** a small colored
chip/border-accent using the manifest's `primary_color`/`secondary_color`,
next to the team name text — gives the wheel a visual identity signal
today without any logo image. This is the one piece of Sec 1's table
genuinely safe to ship as *code*, not just design, in a near-term follow-up
pass (not this session — see the plan doc's "What changed now" list, which
intentionally does not include this).

**Never:** a generic "basketball player" stock silhouette that could be
mistaken for a licensed/generic likeness, or any image asset fetched at
request time from an unlicensed third-party source (matches the existing
"never scrape at request time" discipline already binding for statistical
data, extended to imagery).

**Phase 6A update (2026-07-23):** the team-color fallback badge described
above shipped, in the CourtBuilder spin ceremony
(`apps/web/src/components/court/SpinStage.tsx`) — a colored circular badge
showing team initials over the team's real primary/secondary brand colors,
with a neutral fallback for any franchise not in the table. **Diverges
from Sec 2's manifest shape:** rather than a committed, versioned JSON
file (`data/game/interim/team_identity_manifest.v0.json`), this shipped as
a static TypeScript constant (`apps/web/src/lib/team-colors.ts`) covering
all 30 NBA franchises' real brand colors. Simpler for a fixed, small,
rarely-changing 30-team list that only the frontend needs; if a
server-driven or per-player manifest is ever needed (e.g. the player
identity/initials manifest below), Sec 2's JSON shape is still the
target, not this constant. The **player-card silhouette/initials
fallback** (as opposed to the wheel's team badge) was not built this
pass — see `PHASE_5X_ARENA_OVERHAUL_PLAN.md`'s new "Phase 6B" section for
this as an explicit, still-open target. No logo image, headshot, or any
other scraped/licensed asset was added — colors and initials only, both
derived from public, factual, unlicensed information.

---

## 4. Licensing decision this document does NOT make

This document does not choose a licensing path — that is a product/legal
decision requiring input beyond what a code-focused pass can respons­ibly
decide unilaterally. It documents the **shape of the decision** so it's
answerable later without re-deriving context:

- **Option A — No player/team imagery, ever, in PEAK3.** Lean entirely on
  the fallback tier (Sec 3) as the permanent visual language, differentiate
  through typography/color/motion instead. Lowest risk, zero ongoing cost,
  matches `CLAUDE.md`'s current stated design principle exactly as
  written today.
- **Option B — Licensed sports-media image API** (e.g. a paid provider
  with cleared rights for editorial/game use). Real cost, real ongoing
  vendor relationship, needs explicit legal review of the specific
  license terms for a *game* use case (editorial licenses often
  explicitly exclude games/apps) before any integration work starts.
- **Option C — User-uploaded/community-sourced assets with a takedown
  process.** Shifts risk to a moderation burden PEAK3 has no
  infrastructure for today; not recommended without a much larger scoping
  pass of its own.
- **Option D — Team colors + logos only (no player photos), pursued as a
  narrower licensing ask than full Option B.** Team logos are a smaller,
  more standardized rights landscape (30 marks, not thousands of player
  likenesses) — plausibly the highest-value/lowest-effort licensed option
  if a decision is made to pursue any licensing at all.

**Recommendation for whoever makes this call:** start with Option A
(already true today) validated against real user feedback on whether the
fallback tier (Sec 3) is visually compelling enough on its own before
spending any licensing effort. Option D is the natural next step if not.

---

## 5. Future licensed-provider abstraction (safe to design now, not to wire up)

```python
# nba_peak/perfect_season/imagery.py (NOT created this pass -- shape only)

class ImageProvider(Protocol):
    def team_logo_url(self, team_slug: str) -> str | None: ...
    def player_headshot_url(self, player_slug: str) -> str | None: ...

class NullImageProvider:
    """Always returns None -- current and default behavior. Every caller
    already handles None via the Sec 3 fallback, so this is a real,
    complete implementation, not a stub."""
    def team_logo_url(self, team_slug: str) -> str | None:
        return None
    def player_headshot_url(self, player_slug: str) -> str | None:
        return None

# A future LicensedProviderXYZ(ImageProvider) implementation gets wired in
# only after Sec 4's decision is made and documented -- swapping the
# provider is a one-line change at the call site, by design.
```

This keeps the *call sites* (wherever the frontend eventually asks "what's
this team's logo URL") stable regardless of which Sec 4 option gets
chosen, or if none does. Not implemented this pass — documented so the
seam exists conceptually before any code needs it.

---

## 6. Caching strategy (once/if real assets exist)

Mirrors the existing `nba_peak/data_complete.py` scrape-once/cache/
never-fetch-at-request-time discipline exactly:

- Real image assets (once licensed) are fetched **once**, at data-build
  time, cached to a committed or CDN-backed location — never fetched
  live from a third party on a user's request (same reasoning as the
  "never scrape Basketball Reference during a web request" rule in
  `CLAUDE.md`).
- Cache invalidation is version-keyed (`dataset_version` bump), not
  time-based — matches every other versioned artifact in this pipeline
  (`card_profiles.v3.json`, the interim team-season dataset).
- CDN/hosting choice is a Sec 4 licensing-decision-dependent detail, not
  scoped here.

---

## 7. Public-use risk summary

- **Unlicensed team logos or player photos committed to the repo or served
  from PEAK3's own infrastructure:** real legal exposure (trademark +
  copyright + publicity rights), explicitly what `CLAUDE.md`'s existing
  design principle already forbids. This document does not relax that
  rule; it explains what would need to be true to relax it deliberately
  (Sec 4).
- **Fallback-tier rendering (Sec 3):** effectively zero incremental risk
  beyond what already exists — initials and team-color chips are not
  copyrightable/trademarked assets.
- **A future licensed provider (Option B/D):** risk shifts from
  "unauthorized use" to "contract compliance" — a materially different
  and much more manageable risk category, but still requires the license
  terms to actually be read and matched against PEAK3's specific use case
  (a game, not editorial content) before integration.

---

## 8. Local dev placeholders

Development and testing use the fallback tier (Sec 3) exclusively — no
special "dev-only" image set, no placeholder stock photos. This keeps dev
and production visually identical for this layer, and means Playwright/
accessibility tests never need to account for image-loading states,
broken-image icons, or alt-text edge cases for assets that don't exist yet.
When/if Sec 4 resolves to an imagery option, dev environments get real
`alt` text requirements and loading-state tests added at that time, not
before.

---

## 9. Explicit non-goals for this document

- No image scraping, fetching, or committing of any kind.
- No licensing agreement, vendor selection, or legal sign-off — Sec 4
  documents the decision shape, not the decision.
- No frontend code changes in this pass beyond what's already noted as
  "safe" in Sec 1 (and even those are deferred to a near-term follow-up,
  not shipped in the same pass as this document).
- No changes to `CLAUDE.md`'s existing "no photographs, no logos" design
  principle — this document operates within that constraint and describes
  how it could be revisited later, not a decision to revisit it now.
