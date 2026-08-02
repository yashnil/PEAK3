# Rankings synchronization and provenance report

**Workstream:** W6 (UX / Organization / Polish pass)
**Baseline:** `HEAD = efaeff4a5c00b12c8f8c3ed4bd03cf0221609f17` on `feature/run-the-table`
**Date of run:** 2026-07-31

---

## 0. Verdict, in one line

**No visible ranking value changed, and none could have.** The rankings were not
stale. What was wrong was the *provenance* — the dataset described itself with a
commit that provably did not produce it, the model version was spelled three
different ways, the parity tests silently disabled themselves on every clean
checkout, and the page told the reader that two boards asked different questions
when at the 1-Year setting they return the same rows. All four are fixed. No
leaderboard row, weight, or calibration was touched.

---

## 1. Independent re-verification of the "not stale" verdict

The plan's §1.4 verdict was re-derived from scratch rather than accepted.

### 1.1 Row-by-row parity, data/web vs the canonical CSVs

Every row of every duration compared on rank, player, `Prime raw` → `prime_index`,
and `Prime display` → `prime_score`:

```
n=1: csv_rows=250 json_rows=250 mismatches=0
n=2: csv_rows=249 json_rows=249 mismatches=0
n=3: csv_rows=248 json_rows=248 mismatches=0
n=5: csv_rows=237 json_rows=237 mismatches=0
TOTAL MISMATCHES: 0
```

Independently reproduced. This is now a permanent test
(`test_every_exported_row_matches_the_canonical_csv`) rather than a one-off script.

### 1.2 The mtime skew is a checkout artifact

```
$ git status --porcelain leaderboards/
(empty)

$ git log --oneline -3 -- leaderboards/
6731270 Generate leaderboards
17e0db6 cleanup
```

The CSVs have not changed content since `17e0db6`. Their mtimes have. Confirmed:
the `leaderboards/` Jul 31 02:18 vs `data/web/` Jul 30 10:47 skew carries no
information about content.

### 1.3 Input CSV digests (SHA-256), now recorded in the artifact

```
298ec24a3f573b1af3bacb3bc2de7c4f6082aefa96582ed3dcb32256a1f0b387  leaderboards/top_250_1_year_prime.csv
9723ad7ec2915878069273e27687c1c57a21c9c7ec5b6938088429a6565c5eac  leaderboards/top_250_2_year_prime.csv
83bf92bf6f20c97ff3702cda0e3fc79a0926f8556745fb4cef2802e6fa831b71  leaderboards/top_250_3_year_prime.csv
ef59f6f2a8bd9cd7a460de90c121d88f7a868abce09aefc37b9b018569a37c6c  leaderboards/top_250_5_year_prime.csv
```

### 1.4 `peak3_v2` is not in play

`DEFAULT_FORMULA_VERSION = PEAK3_V1` in `nba_peak/formula_version.py:41`. v2 is
served only when a caller names it, reads separate parquets, and writes separate
artifacts (`top_1000_*.v2.json`). Nothing on any default surface is v2.

---

## 2. A correction to the audit's model of the system

**The rankings page does not read `data/web/`.** This matters, because the whole
"the rankings look stale" report was reasoning about the wrong artifact.

There are two independent generated pipelines:

```
leaderboards/*.csv                          (COMMITTED, canonical, 250-player pool)
  └─ scripts/build_web_dataset.py
       └─ data/web/*.json                   [GITIGNORED — .gitignore:58]
            └─ DatasetStore → /api/v1/leaderboards, /api/v1/meta
            └─ Peak Duel
            └─ nba_peak/run_the_table/cards.py  (peak_windows.json)

cache/processed/scored_1980_2026.parquet    (gitignored, rebuild-only)
  └─ scripts/build_top_peaks.py / build_top_seasons.py
       └─ data/game/experimental/player_pool_1500/top_1000_{peaks,seasons}.v{1,2}.json
            [COMMITTED — git ls-files confirms all four are tracked]
            └─ /api/v1/peaks, /api/v1/seasons
                 └─ apps/web/src/app/(main)/rankings/page.tsx   ← THE WEBSITE BOARD
```

Consequences:

- `make build-dataset` **cannot** change the rankings page. It regenerates
  `data/web/` only.
- The rankings page **can** start from a clean checkout; its artifacts are
  committed. RUN THE TABLE cannot (see §7).
- The two pipelines carry deliberately different `model_version` spellings.
  That is a namespace, not drift (see §4).

Both pipelines are now pinned, and pinned *to each other*.

---

## 3. Regeneration through the authoritative pipeline

Run twice on purpose — once before any edit to `build_web_dataset.py`, once
after — so "regeneration is a no-op" is separated from "my provenance fields
changed the file".

### Commands

```bash
shasum -a 256 data/web/*.json > /tmp/before.txt
ls -la data/web/
make build-dataset        # == python3 scripts/build_web_dataset.py
shasum -a 256 data/web/*.json > /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt
```

### Artifact hashes at all three states

| Artifact | As checked out | Rebuild, **before** my edits | Rebuild, **after** my edits |
|---|---|---|---|
| `leaderboards.json` | `cd634321…1bffa` | `cd634321…1bffa` ✅ | `cd634321…1bffa` ✅ |
| `methodology.json` | `373bbef9…6abf` | `373bbef9…6abf` ✅ | `373bbef9…6abf` ✅ |
| `peak_windows.json` | `491651e8…6fc0d` | `491651e8…6fc0d` ✅ | `491651e8…6fc0d` ✅ |
| `metadata.json` | `d81e7877…86b8a` | `e729e11d…1231c` ⚠️ | `2b6280b4…8db20` ⚠️ |

Full digests:

```
--- as checked out ---
cd63432106a37709ae81dfb2e4f74afed65194023f13e968c8dc77fe4de1bffa  data/web/leaderboards.json
d81e78770e9947ab330a16ccc8fdb7ba2b59ebc48136446b2e4451943f286b8a  data/web/metadata.json
373bbef94737d3b9acbed40e2f17afc73458f9d8eda1561ad646994ce9eb6abf  data/web/methodology.json
491651e82d07ecfee193c6424b996f0021528428aa4edc49b4e06d9c2696fc0d  data/web/peak_windows.json

--- rebuild, before my edits ---
cd63432106a37709ae81dfb2e4f74afed65194023f13e968c8dc77fe4de1bffa  data/web/leaderboards.json
e729e11de154ba618ca6b371e685a59760920ea067958ab137387cb617c1231c  data/web/metadata.json
373bbef94737d3b9acbed40e2f17afc73458f9d8eda1561ad646994ce9eb6abf  data/web/methodology.json
491651e82d07ecfee193c6424b996f0021528428aa4edc49b4e06d9c2696fc0d  data/web/peak_windows.json

--- rebuild, after my edits (final) ---
cd63432106a37709ae81dfb2e4f74afed65194023f13e968c8dc77fe4de1bffa  data/web/leaderboards.json
2b6280b43753fcfcb7768f089c5236755ce9f6ddd3b242994aadc69df918db20  data/web/metadata.json
373bbef94737d3b9acbed40e2f17afc73458f9d8eda1561ad646994ce9eb6abf  data/web/methodology.json
491651e82d07ecfee193c6424b996f0021528428aa4edc49b4e06d9c2696fc0d  data/web/peak_windows.json
```

**Reading of the table.** All three ranking-bearing artifacts are byte-identical
across all three states. Regeneration from the committed CSVs is a bit-exact
no-op. `metadata.json` changed twice, and only there:

1. **Before my edits**, it changed because `generated_at` is a timestamp and
   because `source_commit` moved from `d5e8acf…` to the true `efaeff4…`. That
   single change is the *proof of defect 1*: the file on disk had been labelled
   with a commit it did not come from.
2. **After my edits**, it changed again because the additive provenance fields
   were introduced (`source_tree_dirty`, `leaderboards_dir_dirty`,
   `formula_version_id`, `formula_version`, `model_label`, `source_inputs`,
   `source_input_digest_algorithm`).

No ranking payload shape changed. No score changed.

### Committed board artifacts — untouched, and verified so

```
0585059f38f2225ba7089fe121ccf669d2857eacc2e7642531a05f26f86288b0  top_1000_peaks.v1.json
976718c26b4e32fbedcd46473fbdd271c6d4061e7e9456a0a8ab2f12f90b6bc7  top_1000_seasons.v1.json
```

Neither was regenerated. `git status --porcelain` on `data/game/` is empty.

---

## 4. The four defects and their fixes

### Defect 1 — `metadata.json`'s `source_commit` was provably wrong

**Evidence.** The file recorded `source_commit: d5e8acf9d97bf0abe617835431fc75983171cb94`.
But `data/web/methodology.json` is byte-equal to the **current** `METHODOLOGY`
dict, and not to the one at `d5e8acf`:

```
methodology.json == current METHODOLOGY dict:        True
d5e8acf METHODOLOGY == data/web/methodology.json:    False
```

`build_web_dataset.py` was changed after `d5e8acf` by `0e366d2`. So the recorded
commit could not have produced the file beside it. `get_source_commit()`
(`scripts/build_web_dataset.py:98-108`) ran a bare `git rev-parse HEAD` with no
dirty check and no hash of its inputs — it describes *the checkout*, not *what
was read*, and therefore cannot detect this class of drift at all.

**Fix.** `metadata.json` now additionally carries:

| Field | Meaning |
|---|---|
| `source_tree_dirty` | `true` / `false` / `null` if git could not answer. `null` is preserved, not flattened to `false`. |
| `leaderboards_dir_dirty` | Narrower and more actionable: were the canonical CSVs specifically modified? |
| `source_inputs` | `{repo-relative CSV path: sha256}` for every input actually read. |
| `source_input_digest_algorithm` | `"sha256"`. |
| `formula_version_id` | The underscored slug, imported from `nba_peak.formula_version`. |
| `formula_version` | Full description, built from `OFFICIAL_WEIGHTS`. |
| `model_label` | `"PEAK3 v1"`. |

The exporter also prints the dirty state and every digest, and emits an explicit
`NOTE: built from a DIRTY working tree` banner when applicable. A build from a
dirty tree remains legitimate; doing it *silently* is what produced the defect.

The digests are the half of the provenance that stays true when `source_commit`
does not — and they are verifiable without git, which the parity tests now do.

### Defect 2 — three spellings of the model version

| Location | Value | Disposition |
|---|---|---|
| `scripts/build_web_dataset.py:50` | `"peak3-v1"` (hyphen) | **Kept byte-identical, now derived** |
| `nba_peak/formula_version.py:31-33` | `"peak3_v1"` (underscore) | The declared source of truth — imported |
| `apps/api/tests/conftest.py:73` | `"peak3-2026"` | **Not mine — escalated to the lead** |

**Investigation before deciding.** `MODEL_VERSION` is emitted into
`data/web/metadata.json` and returned verbatim by `GET /api/v1/meta`. It is a
published contract, and `apps/api/tests/test_model_version.py:150-159` asserts —
with an explicit rationale in its docstring — that this value is **not** one of
the peaks formula slugs, precisely so a Peak Duel score can never be read as a
peaks-board score. Changing `"peak3-v1"` to `"peak3_v1"` would have broken that
test and silently re-namespaced every stored duel result.

**So the wire value was not changed.** What changed is that it can no longer
drift: it is now *built* from the imported source of truth through one explicit,
visible mapping, and the exporter refuses to run if that mapping stops covering
the default version.

```python
_WIRE_MODEL_VERSION = {
    _formula_version.PEAK3_V1: "peak3-v1",
    _formula_version.PEAK3_V2: "peak3-v2",
}
MODEL_VERSION = _WIRE_MODEL_VERSION[SOURCE_FORMULA_VERSION]
assert MODEL_VERSION == "peak3-v1"   # published contract, pinned
```

The mapping is documented in `scripts/build_web_dataset.py`, in
`apps/api/app/api/v1/meta.py`'s module docstring, and pinned by
`test_the_wire_model_version_stays_the_published_contract`, which asserts
`model_version.replace("-", "_") == formula_version_id` — the two spellings must
name the same version.

> **For the lead:** `apps/api/tests/conftest.py:73` (`"peak3-2026"`) is the third
> spelling. It belongs to the synthetic fallback fixture, not to any generated
> artifact, so it is cosmetic — but the same file's `_load_dataset()` fallback
> (lines 95-99) is *not* cosmetic; see defect 3. That file is another
> workstream's and was not edited.

### Defect 3 — parity tests silently skipped

`apps/api/tests/test_regression.py:16-21` called `pytest.skip()` when
`data/web/leaderboards.json` was absent, and `data/web/` is gitignored. On a
clean checkout — which is every clean checkout — the entire parity suite
evaporated into "skipped" and CI reported success while asserting nothing.

A parity test that disables itself when the thing it guards is missing is not a
weak test; it is an anti-test, because it converts a real failure ("the dataset
was never built") into a pass.

**Fix.** The fixture now calls `pytest.fail()` with the exact command that fixes
it. One escape hatch exists — `PEAK3_ALLOW_MISSING_WEB_DATASET=1` — for genuine
bootstrap ordering (an API test image that runs before the data-build step). It
is an env var rather than a default so that skipping is a decision somebody made
and can be grepped for. CI already runs `python scripts/build_web_dataset.py` in
two jobs (`.github/workflows/ci.yml:69,89`), so failing is safe there.

**Verified by removing `data/web/`:**

```
without the escape hatch:   13 passed, 20 errors      (loud)
PEAK3_ALLOW_MISSING_WEB_DATASET=1:  13 passed, 20 skipped
with data/web/ present:     35 passed
```

The 13 that still pass without `data/web/` are the ones reading the *committed*
board artifacts — correct, since those are in git and their absence would mean a
broken working tree, not a pending build.

> **For the lead, unfixed and outside my ownership:** `apps/api/tests/conftest.py:95-99`
> still falls back to `FIXTURE_LEADERBOARDS` — 30 synthetic players named
> `First001 Last001` — when `data/web/leaderboards.json` is missing. So the
> *leaderboard API* tests continue to pass against fabricated data on a clean
> checkout. `test_regression.py` no longer participates in that fiction, but the
> fallback itself remains and should be given the same treatment.

### Defect 4 — the terminology contradiction

**The claim that was false.** `rankings/page.tsx:26-27` said the two boards "ask
genuinely different questions". At 3-Year and 5-Year that is true. At **1-Year**
it is not, and the artifacts prove it — a peak window of length one *is* a single
season:

| | 1-Year Peak Windows | Single Seasons |
|---|---|---|
| Rank 1 | Michael Jordan 1990-91 — 97.53 | Michael Jordan 1990-91 — 97.53 |
| Rank 2 | LeBron James 2008-09 — 95.85 | LeBron James 2008-09 — 95.85 |
| Rank 3 | Stephen Curry 2015-16 — 93.90 | LeBron James 2012-13 — 95.69 |

Identical `row_id`s at ranks 1-2. The boards diverge at rank 3 for exactly one
reason: the peaks board keeps **one row per player** (1,000 rows / 1,000 unique
players) and the seasons board does not (1,000 rows / 249 unique players).

Meanwhile the header at `:158` rendered **"1-Year Peak Windows"** directly beside
a tab named **"Single Seasons"** — two names for one concept, presented as a
choice between two things. And the blurb at `:46` ("their single best consecutive
stretch") was strained at n=1 for the same reason: a stretch of one.

**Resolution (per plan §5.6).** Copy moved into
`apps/web/src/components/rankings/board-copy.ts` so the heading and the explainer
are derived from the same two arguments and cannot drift apart again.

| Board / setting | Heading | Explainer |
|---|---|---|
| Peak Windows @ 1-Year | **Best single season (one row per player)** | "Best single season, one row per player. A one-year peak window is a single season, so this is the Single Seasons board with each player kept only once — **de-duplication is the only difference between the two at this setting**." |
| Peak Windows @ 3-Year | Best 3-season stretch (one row per player) | "Best three consecutive seasons… sustained level rather than a single year…" |
| Peak Windows @ 5-Year | Best 5-season stretch (one row per player) | as above, five |
| Single Seasons | **Every qualifying season** | "Every qualifying season, ranked on its own — so a player can appear many times. The same rows as the 1-Year board, without the one-per-player limit." |

Tab labels are **unchanged** (`"Peak Windows"` / `"Single Seasons"`, frozen and
asserted with `{exact: true}` at `rankings.spec.ts:466-469`). The window selector
keeps sole ownership of the `/3.year|3-year/i` phrasing that
`gameplay.spec.ts:152` depends on — the new headings deliberately say
"3-season stretch", not "3-Year".

The n=1 caveat is **not** repeated at 3Y/5Y, where the boards genuinely do differ;
flattening all three into one apologetic blurb would be the opposite error, and a
test asserts it does not happen.

---

## 5. Promoting the serving gate out of 10 px muted text

The served boards apply `min_anchor_season_mpg = 25.0`, which the canonical
250-pool CSVs do **not**. Excluded window counts:

| Board | Served | Excluded by the 25.0 MPG gate |
|---|---|---|
| Peaks 1Y | 1,000 | 722 |
| Peaks 3Y | 893 | 375 |
| Peaks 5Y | 685 | 173 |
| Seasons | 1,000 (of 11,429 scored) | 31 |

Real, committed players fall through it and are therefore **in the canonical CSVs
but absent from the website board**:

- Isaiah Hartenstein — canonical 1yr rank 185
- Tony Allen — canonical 1yr rank 245
- Andrew Bogut — canonical 3yr rank 205

This is documented at `nba_peak/leaderboards.py:9-31`, but on the page it
appeared only as a `serving_gate_note` fragment in 10 px `--text-muted`
(`rankings/page.tsx:376`). A board that filters rows without saying so legibly is
presenting an edited list as a complete one.

It is now a first-class note (`data-testid="rankings-serving-gate"`), at body
size in `--text-secondary`, prefixed **"What this board leaves out:"**, inside the
new provenance panel. An e2e asserts its computed `font-size >= 12px` — so the
regression that made a 722-window filter invisible cannot recur by styling.

---

## 6. UI provenance

`apps/web/src/components/rankings/RankingsProvenance.tsx` replaces the single
10 px grey line. It renders:

- **Scoring model** — `rankings-model-version` (enhanced in place, not replaced).
  A non-default model is marked with `data-default-model="false"` and the accent
  colour, because two model versions are not comparable.
- **Data through** — `2025-26`
- **Seasons covered** — `1979-80 to 2025-26`
- **Data release** — `top_1000_peaks.v1` / `top_1000_seasons.v1`
- **Rows on this board**
- **What this board leaves out** — the serving-gate note (§5)
- **How the score is built** → `/methodology`
- The full `formula_version` identity string, verbatim, set as code

Both frozen assertions still hold: `rankings-model-version` matches `/PEAK3 v1/`,
and `rankings-provenance` contains `"peak3_official_weights_v1"` and never
`"preview"`.

### What it deliberately does **not** show: a generated date

There is no "generated on" line, because there is no honest source for one. The
generator (`scripts/build_top_peaks.py`) does not write a timestamp into the
artifact. The only alternatives were a file mtime or git HEAD at request time —
and an mtime skew is **precisely** what produced the false "the rankings are
stale" report this whole pass began with. Publishing one as a release date would
have been fabricating provenance in the name of fixing it.

Instead:

- `dataset_version` is shown, which *is* the release identifier.
- `/api/v1/peaks` and `/api/v1/seasons` now pass `generated_at` through
  (currently `null`), plus `generation_command` and `artifact_digest`. The day
  the generator emits a timestamp, the line appears with no further change.
- A test (`test_provenance_is_passed_through_and_never_fabricated`) asserts
  `generated_at` is the pass-through value and not a back-filled mtime.

> **For the lead — one gap I could not close within my ownership.** The API now
> carries `artifact_digest`, `generated_at` and `generation_command` on the wire,
> but `apps/web/src/lib/api.ts::normalizeBoard` (lines 187-208) drops unknown
> fields, and neither `lib/api.ts` nor `types/index.ts` is in W6's owned file
> list. Surfacing the digest/date in the UI needs three additive lines in each.
> Recommended follow-up:
> - `types/index.ts` → add `artifact_digest`, `generated_at`, `generation_command`
>   to `RankingBoardMeta` and `RankingBoardPayload` (all `string | null`)
> - `lib/api.ts` → map them in `normalizeBoard`
> - `RankingsProvenance.tsx` → two more `<Fact>` rows (the component is written
>   to omit, not invent, so it needs no guard)
>
> Also worth fixing at the source: `scripts/build_top_peaks.py` /
> `build_top_seasons.py` should write a `generated_at` into their artifacts. That
> is the real fix; everything above is plumbing waiting for it.

---

## 7. RUN THE TABLE — the deploy-ordering trap (documented, not "fixed")

`nba_peak/run_the_table/cards.py:41` builds the card pool from
`data/web/peak_windows.json`, which is **gitignored**. RUN THE TABLE is therefore
the **only** game that cannot start from a clean checkout without a build step.

It degrades to a labelled `503` (`CardPoolUnavailable`) rather than fabricating
cards, which is the correct failure — but it is a deploy-ordering trap: an API
deployed before `make build-dataset` runs will serve a game that 503s.

**Deliberately not fixed by committing generated data.** `data/web/` is
gitignored by design (CLAUDE.md, Phase 1 data-export rules) and stays that way.
The fix, if the lead wants one, is deploy sequencing or a startup readiness gate
— not a committed artifact.

A parity test now covers the staleness half of the risk: every card must resolve
to a live window ID **and** carry the same `prime_index` as that window, so a
card can never be priced off a stale score.

Verified: 984 windows in `peak_windows.json`; every card in the built pool
resolves; zero score drift.

---

## 8. Component reconciliation — a real subtlety found

The two pipelines decompose a score differently, and a naive parity test would
have been wrong in one of them.

- **`data/web`** publishes **six** terms including `teammate_adjustment`. They sum
  to `prime_index`; worst case across all 984 windows is `2.0e-4` (CSV rounding).
- **The served board** publishes **five** on the table row — the official weighted
  contributions only. `teammate_adjustment` (Jordan 1990-91: `-0.2472`) lives in
  the explain block alone. So the five row-level components deliberately do
  **not** sum to `prime_index`:

  ```
  37.6059 + 13.9424 + 19.9989 + 12.5652 + 3.0000 = 87.1124
  87.1124 + (-0.2472)                            = 86.8652   → prime_index 86.87 ✅
  ```

The test reconciles the way the modal actually presents it — five contributions
plus the adjustment — with a `0.01` tolerance that is arithmetic (the artifact
rounds `prime_index` to two decimals, contributions to four), not slack. A
companion test pins that the row publishes exactly those five keys, so if a sixth
ever appears the reconciliation must be revisited rather than silently
double-counting.

---

## 9. Current top rows (post-regeneration)

### Served board — `top_1000_peaks.v1` (what the website renders)

**1Y**

| # | Player | Season | Score |
|---|---|---|---|
| 1 | Michael Jordan | 1990-91 | 97.53 |
| 2 | LeBron James | 2008-09 | 95.85 |
| 3 | Stephen Curry | 2015-16 | 93.90 |
| 4 | Shaquille O'Neal | 1999-00 | 93.56 |
| 5 | Nikola Jokic | 2022-23 | 93.48 |
| 6 | Shai Gilgeous-Alexander | 2024-25 | 92.90 |
| 7 | Tim Duncan | 2002-03 | 91.84 |
| 8 | Giannis Antetokounmpo | 2019-20 | 91.28 |
| 9 | Magic Johnson | 1986-87 | 90.62 |
| 10 | Hakeem Olajuwon | 1993-94 | 90.50 |

**3Y**

| # | Player | Window | Score |
|---|---|---|---|
| 1 | Michael Jordan | 1988-89 to 1990-91 | 95.54 |
| 2 | LeBron James | 2011-12 to 2013-14 | 94.50 |
| 3 | Nikola Jokic | 2021-22 to 2023-24 | 92.55 |
| 4 | Stephen Curry | 2014-15 to 2016-17 | 91.31 |
| 5 | Giannis Antetokounmpo | 2018-19 to 2020-21 | 90.85 |
| 6 | Shaquille O'Neal | 1999-00 to 2001-02 | 90.75 |
| 7 | Shai Gilgeous-Alexander | 2023-24 to 2025-26 | 90.61 |
| 8 | Tim Duncan | 2001-02 to 2003-04 | 88.89 |
| 9 | Kevin Durant | 2011-12 to 2013-14 | 88.79 |
| 10 | Larry Bird | 1983-84 to 1985-86 | 88.55 |

**5Y**

| # | Player | Window | Score |
|---|---|---|---|
| 1 | Michael Jordan | 1987-88 to 1991-92 | 95.16 |
| 2 | LeBron James | 2008-09 to 2012-13 | 94.12 |
| 3 | Nikola Jokic | 2020-21 to 2024-25 | 91.75 |
| 4 | Giannis Antetokounmpo | 2018-19 to 2022-23 | 89.38 |
| 5 | Stephen Curry | 2014-15 to 2018-19 | 88.62 |
| 6 | Shaquille O'Neal | 1998-99 to 2002-03 | 88.57 |
| 7 | Magic Johnson | 1986-87 to 1990-91 | 87.24 |
| 8 | Larry Bird | 1983-84 to 1987-88 | 87.10 |
| 9 | Tim Duncan | 2000-01 to 2004-05 | 86.31 |
| 10 | Shai Gilgeous-Alexander | 2021-22 to 2025-26 | 86.20 |

### Row counts

| Surface | Rows |
|---|---|
| `data/web` 1yr / 2yr / 3yr / 5yr | 250 / 249 / 248 / 237 (984 total, 250 unique players) |
| Served peaks 1Y / 3Y / 5Y | 1,000 / 893 / 685 |
| Served seasons | 1,000 of 11,429 scored |

### Version identifiers

| Identifier | Value | Source |
|---|---|---|
| Formula version (canonical slug) | `peak3_v1` | `nba_peak/formula_version.py` |
| Wire version, `data/web` | `peak3-v1` | derived via `_WIRE_MODEL_VERSION` |
| Wire version, rankings boards | `peak3_v1` | the artifacts themselves |
| Formula description | `peak3_official_weights_v1 (statistical_impact=0.38, traditional_production=0.21, recognition=0.20, postseason=0.18, team_achievement=0.03)` | built from `OFFICIAL_WEIGHTS` |
| User-facing label | `PEAK3 v1` | `formula_version.label()` |
| Schema version | `1.0.0` | `build_web_dataset.py` |
| Data releases | `top_1000_peaks.v1`, `top_1000_seasons.v1` | artifacts |
| Coverage | `1979-80` to `2025-26` | artifacts |
| Universe | 2,016 identities | artifacts |

---

## 10. Did any visible ranking change?

**No.** Not one row, on either pipeline.

| Possible cause | Ruled out by |
|---|---|
| Stale artifact | Byte-identical hashes across three regenerations (§3) |
| Stale frontend bundle | No row data is bundled; every row is fetched at runtime |
| Stale API cache / version | New test compares served `artifact_digest` to the file on disk (§11) |
| Pipeline correction already in source | `build_web_dataset.py` unchanged since `0e366d2`; rebuild is bit-exact |
| Newly included data | No new data; the CSVs are unchanged since `17e0db6` |
| Actual methodology change in the branch | `postseason_value_v2` exists but is opt-in; `DEFAULT_FORMULA_VERSION = PEAK3_V1` |

The only file whose bytes changed is `metadata.json`, and it contains no ranking
data — only provenance, which was wrong and is now right.

---

## 11. Parity tests added

All in `apps/api/tests/test_regression.py` unless noted. The file went from
**12 tests, all silently skippable** to **35 tests that cannot skip**.

| Test | Fails when |
|---|---|
| `_require_web_dataset` (fixture) | `data/web/` is missing — **fails**, no longer skips |
| `test_every_exported_row_matches_the_canonical_csv[1,2,3,5]` | *Any* row drifts from the CSV (not just rank 1 and the top 10) |
| `test_component_totals_reconcile_to_the_published_score` | The breakdown stops explaining the score it decomposes |
| `test_metadata_records_the_digest_of_every_input_csv` | A CSV changed since the export — i.e. `data/web/` is stale |
| `test_metadata_covers_every_canonical_csv_it_exported` | `source_artifacts` and `source_inputs` disagree |
| `test_metadata_declares_whether_the_tree_was_dirty` | The dirty flag is absent |
| `test_the_wire_model_version_stays_the_published_contract` | The hyphenated and underscored spellings stop naming the same version |
| `test_the_exported_formula_description_matches_the_official_weights` | A weight changed without a version bump |
| `test_served_peaks_board_declares_the_default_model` | The served board is not v1 |
| `test_served_seasons_board_declares_the_default_model` | ditto, seasons |
| `test_api_reports_the_same_version_the_artifact_carries` | **API version ≠ artifact version** |
| `test_the_api_serves_the_bytes_that_are_on_disk` | **The process-lifetime cache is holding a superseded artifact** |
| `test_provenance_is_passed_through_and_never_fabricated` | `generated_at` gets back-filled from an mtime |
| `test_served_board_rank1_agrees_with_the_canonical_csv[1y,3y,5y]` | The served rank 1 diverges from the canonical rank 1 |
| `test_the_frontend_top_rows_are_the_artifact_top_rows` | **Frontend top 50 ≠ the current generated artifact**, per window |
| `test_the_two_boards_differ_only_by_deduplication_at_one_year` | The terminology claim stops being true of the data |
| `test_the_serving_gate_is_declared_wherever_it_is_applied` | The gate applies without being published |
| `test_the_latest_supported_season_is_actually_present` | **The latest supported season silently disappears** |
| `test_served_board_components_reconcile_to_the_published_score` | Five contributions + teammate adjustment ≠ `prime_index` |
| `test_the_served_row_components_are_exactly_the_five_official_ones` | The row decomposition changes shape |
| `test_every_served_row_can_be_explained` | **A row references a missing explain block** (dead modal) |
| `test_run_the_table_card_pool_resolves_against_the_current_windows` | **A game card references a missing or stale window** |
| `test_peak_windows_artifact_agrees_with_leaderboards_artifact` | The game pool and the rankings disagree on a score |

Frontend, `apps/web/src/tests/unit/rankings-provenance.test.ts` (14 tests):
board terminology in every board × window combination, the de-duplication
sentence, no two names for one concept, retired-vocabulary bans, and a render
contract for `RankingsProvenance` (frozen testids, gate note present, non-default
model marked, absent facts omitted rather than invented).

E2E, `apps/web/src/tests/e2e/rankings.spec.ts` (10 new tests): board headings and
explainers per window, the 1Y/Single-Seasons top-rows equivalence *as rendered*,
the provenance panel's contents, the serving-gate note's computed font size
`>= 12px`, the methodology link, provenance surviving a board switch, and
`@mobile` no-horizontal-overflow.

### Two staleness vectors documented rather than changed

- `apps/api/app/api/v1/peaks.py` and `seasons.py` use a process-lifetime
  `_CACHE: dict[str, dict]` keyed only by formula version, populated once, never
  invalidated or mtime-checked. `DatasetStore` (`app/core/dataset.py`, loaded in
  `main.py:46`) is the same. **Regenerating artifacts requires an API restart.**
  Not changed — for committed, immutable-per-release artifacts the cache is
  correct. What changed is that it is now *detectable*: the response publishes
  `artifact_digest`, the digest of the bytes that process loaded, and a test
  compares it to disk.
- Both module docstrings now state the caveat explicitly.

---

## 12. Verification output

```
$ make build-dataset
  Loaded 1yr: 250 windows   2yr: 249   3yr: 248   5yr: 237
  Total windows: 984 · Unique players: 250
  Model version (wire): peak3-v1  <- peak3_v1
  Source commit: efaeff4a5c00b12c8f8c3ed4bd03cf0221609f17
  Working tree dirty: YES
  leaderboards/ dirty: no
  Input digests (sha256): [4 CSVs, listed in §1.3]
  NOTE: built from a DIRTY working tree. `source_commit` above does not
        fully identify these artifacts -- `source_inputs` digests do.
  Done. Exit 0.
  ✓ Dataset built in data/web/

$ cd apps/api && pytest tests/test_regression.py tests/test_model_version.py \
    tests/test_peak_index_serving_gate.py tests/test_peaks_rankings.py \
    tests/test_seasons_rankings.py tests/test_leaderboards.py -q
  146 passed, 1 warning in 1.50s

$ pytest tests/test_data_complete.py tests/test_leaderboards.py -q
  48 passed in 321.11s (0:05:21)

$ cd apps/web && npm run typecheck
  (clean)

$ npm run lint -- --max-warnings 0
  ✔ No ESLint warnings or errors

$ npx vitest run src/tests/unit/rankings-provenance.test.ts
  14 passed (14)

$ cd apps/api && pytest tests/ -q          # full API suite
  877 passed, 18 skipped, 556 warnings in 279.02s (0:04:39)
```

Vitest, whole suite: `747 passed, 1 failed (748)`. The single failure is
`src/tests/unit/trade-desk.test.tsx > changing the outgoing pick clears an
incoming pick that slot cannot take` — **W4's in-flight work**
(`TradeDesk.tsx` modified, `trade-desk.test.tsx` untracked), not a W6 file and
not caused by any change here. Reported to the lead separately.

Fail-loud behaviour, verified by removing `data/web/`:

```
(no escape hatch)                     13 passed, 20 errors
PEAK3_ALLOW_MISSING_WEB_DATASET=1     13 passed, 20 skipped
(restored)                            35 passed
```

---

## 13. Files changed by W6

| File | Change |
|---|---|
| `scripts/build_web_dataset.py` | Version derived from `formula_version`; dirty flags; per-input SHA-256; provenance summary output |
| `apps/api/tests/test_regression.py` | Fail-loud fixtures; 12 → 35 tests |
| `apps/api/app/api/v1/peaks.py` | `artifact_digest`, `generated_at`, `generation_command`; cache caveat documented |
| `apps/api/app/api/v1/seasons.py` | same |
| `apps/api/app/api/v1/meta.py` | Module docstring documenting the two pipelines and the version namespace |
| `apps/web/src/app/(main)/rankings/page.tsx` | Terminology fix; board heading; provenance panel |
| `apps/web/src/components/rankings/board-copy.ts` | **new** — the copy layer |
| `apps/web/src/components/rankings/RankingsProvenance.tsx` | **new** — the provenance panel |
| `apps/web/src/styles/rankings.css` | Filled in (was a W7 stub) |
| `apps/web/src/tests/unit/rankings-provenance.test.ts` | **new** — 14 tests |
| `apps/web/src/tests/e2e/rankings.spec.ts` | +10 tests |
| `docs/implementation/RANKINGS_SYNC_REPORT.md` | **new** — this file |

**Not touched, as required:** `peak3.py`, `OFFICIAL_WEIGHTS`, `calibrate_score`,
`nba_peak/leaderboards.py`, anything under `leaderboards/`, `globals.css`. No
leaderboard row was hand-edited. `data/web/` remains gitignored and uncommitted.

---

## 14. Post-review amendments (lead, after adversarial review R4)

Three changes landed on top of W6's work during integration. None of them alters a
ranking value; all three make the provenance story actually hold.

### 14.1 `artifact_digest` now hashes the bytes being served, not the file on disk

`_artifact_digest()` in `apps/api/app/api/v1/peaks.py` (and the identical function in
`seasons.py`) re-opened the artifact and hashed it, while `_load()` separately did
`path.read_text()` into a process-lifetime `_CACHE` that is never invalidated.

Those two reads can disagree. Regenerate the artifact while the API is up and the
process keeps serving the *old* rows, but a fresh read of the path returns the *new*
digest — so the response would publish a fingerprint matching disk while the body did
not. The one failure mode this value exists to expose would have been reported as
"current".

`_load()` now digests the exact string it parsed, in the same breath:

```python
raw = path.read_text()
_DIGEST_CACHE[resolved] = hashlib.sha256(raw.encode("utf-8")).hexdigest()
cached = _CACHE[resolved] = json.loads(raw)
```

and `_artifact_digest()` is a pure `_DIGEST_CACHE.get(version)`.

### 14.2 The digest reaches the page

`normalizeBoard` in `apps/web/src/lib/api.ts` was dropping `artifact_digest` and
`generated_at`, so the fields rode the wire and died at the client boundary. Both are
now on `RankingBoardMeta`, and the provenance panel renders the digest's first 12
characters as **Artifact fingerprint**.

This is the only fact on that panel that cannot drift: it is computed from the bytes
being served, so it changes if and only if the served data changes. A date or an mtime
cannot make that claim — mtime skew is exactly what produced the false "the rankings are
stale" report this pass began with.

`generated_at` remains unrendered because it remains null: `build_top_peaks.py` does not
write one, and back-filling it from a file mtime would be fabricating provenance in the
name of fixing it. The line appears by itself the day the generator emits one.

### 14.3 The synthetic-fixture fallback is no longer silent

`apps/api/tests/conftest.py` fell back to 30 fabricated players (`First001 Last001`)
whenever `data/web/leaderboards.json` was absent, with no announcement — so leaderboard
endpoint tests passed against invented data on any clean checkout.

The fallback stays (most of the 900-odd API tests have nothing to do with leaderboard
content, and requiring a build step to run them would be hostile), but it now prints a
loud stderr banner and sets a module-level `USING_FIXTURE_DATASET` flag, with a
`requires_real_dataset()` helper that **fails** rather than skips. A parity check that
silently disappears is worse than one that fails, because a green suite then reads as
evidence the data is correct.
