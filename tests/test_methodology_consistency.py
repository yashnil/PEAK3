"""Phase 10D: the documentation must agree with the code.

Every mismatch this file guards was a real, shipped mismatch:

  * `peak3.py`'s OFFICIAL SCORE header block read `23% / 15% / 12%` for
    Traditional Production / Recognition / Postseason long after the weights
    moved to `21 / 20 / 18`.
  * `score_dataset` annotated its two biggest components `# 43% component` and
    `# 23% component`.
  * `statistical_impact.__doc__` described "sub-weights of the 45" when the
    effective denominator has always been 38 on the committed data.
  * `docs/model/SCORING_METHODOLOGY.md` §17 claimed postseason sample
    reliability means "a short hot run cannot dwarf a Finals-length one" -- an
    invariant `tests/test_postseason_sample_invariant.py` measures as false.
  * `METHODOLOGY.md` §4 describes an `0.18 Role/workload` component. That
    section is explicitly headed SUPERSEDED, but its bullets are written in
    the present tense, so a reader skimming bullets past the heading comes
    away believing a role-player safeguard exists. It does not.

A weight typo in a comment is not cosmetic here: these documents are the
project's account of why the numbers are what they are, and the last audit
round spent real effort re-deriving intent from stale prose.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
PEAK3_PATH = REPO_ROOT / "peak3.py"
METHODOLOGY_PATH = REPO_ROOT / "METHODOLOGY.md"
SCORING_DOC_PATH = REPO_ROOT / "docs" / "model" / "SCORING_METHODOLOGY.md"

EXPECTED_WEIGHTS = {
    "statistical_impact": 0.38,
    "traditional_production": 0.21,
    "recognition": 0.20,
    "postseason": 0.18,
    "team_achievement": 0.03,
}


@pytest.fixture(scope="module")
def peak3_source() -> str:
    return PEAK3_PATH.read_text()


@pytest.fixture(scope="module")
def scoring_doc() -> str:
    return SCORING_DOC_PATH.read_text()


# ---------------------------------------------------------------------------
# Weights
# ---------------------------------------------------------------------------

def test_official_weights_are_exactly_the_documented_vector():
    import peak3 as P

    assert P.OFFICIAL_WEIGHTS == EXPECTED_WEIGHTS
    assert sum(P.OFFICIAL_WEIGHTS.values()) == pytest.approx(1.0)


def test_peak3_header_block_states_the_live_weights(peak3_source):
    """The OFFICIAL SINGLE-SEASON SCORE banner above OFFICIAL_WEIGHTS."""
    header = peak3_source.split("OFFICIAL SINGLE-SEASON SCORE")[1].split("OFFICIAL_WEIGHTS = {")[0]
    for label, pct in [
        ("STATISTICAL IMPACT", 38), ("TRADITIONAL PRODUCTION", 21),
        ("INDIVIDUAL RECOGNITION", 20), ("POSTSEASON INDIVIDUAL", 18),
        ("TEAM ACHIEVEMENT", 3),
    ]:
        match = re.search(rf"{label}\s+(\d+)%", header)
        assert match, f"{label} not stated in the header block"
        assert int(match.group(1)) == pct, (
            f"header block says {label} is {match.group(1)}% but OFFICIAL_WEIGHTS says {pct}%"
        )


def test_no_stale_component_percentages_remain_in_peak3(peak3_source):
    """The specific stale annotations Phase 9B catalogued."""
    for stale in ("# 43% component", "# 23% component"):
        assert stale not in peak3_source, f"stale annotation still present: {stale!r}"


def test_scoring_doc_states_the_live_weights(scoring_doc):
    formula = scoring_doc.split("## 2.")[1].split("## 3.")[0]
    for coefficient in ("0.38", "0.21", "0.20", "0.18", "0.03"):
        assert coefficient in formula, f"weight {coefficient} missing from the published formula"


# ---------------------------------------------------------------------------
# The statistical_impact denominator
# ---------------------------------------------------------------------------

def test_statistical_impact_docstring_states_the_effective_denominator():
    import peak3 as P

    doc = P.statistical_impact.__doc__ or ""
    assert "EFFECTIVE DENOMINATOR IS 38" in doc
    assert "73.7" in doc, "the real rate share should be stated, not left to be re-derived"
    # The old text was "Sub-weights of the 45", which presented 45 as the
    # operative denominator. Naming 45 is fine now -- only in contrast.
    assert "Sub-weights of the 45" not in doc


def test_modern_impact_supplement_really_is_absent():
    """The premise of the correction above. If real EPM/LEBRON data is ever
    backfilled this fails, and the docs in §3 must be revised -- deliberately,
    because it changes every score."""
    import pandas as pd

    scored_path = REPO_ROOT / "cache" / "processed" / "scored_1980_2026.parquet"
    if not scored_path.exists():
        pytest.skip("scored parquet not present")
    scored = pd.read_parquet(scored_path)
    present = [c for c in ("epm", "lebron", "raptor", "darko", "rapm") if c in scored.columns]
    for col in present:
        assert scored[col].notna().sum() == 0, (
            f"{col} now has data -- the effective denominator moves from 38 to 45 and "
            "docs/model/SCORING_METHODOLOGY.md §3 must be updated"
        )


def test_scoring_doc_discloses_the_effective_denominator(scoring_doc):
    section = scoring_doc.split("## 3. Statistical Impact")[1].split("## 4.")[0]
    assert "73.7" in section, "the effective rate share must be published"
    assert "0 of the 11,429" in section, (
        "the doc must state that the modern supplement is absent from every row, "
        "which is what makes the denominator 38"
    )


# ---------------------------------------------------------------------------
# No document may claim a safeguard the code does not implement
# ---------------------------------------------------------------------------

def test_superseded_methodology_section_is_marked_as_historical():
    """METHODOLOGY.md §4's `0.18 Role/workload` component does not exist in the
    live model. The heading always said SUPERSEDED; the body did not."""
    text = METHODOLOGY_PATH.read_text()
    section = text.split("## 4. Scoring formula")[1].split("\n## ")[0]
    assert "Role/workload" in section, "fixture assumption: the retired component is described here"
    assert "DOES NOT EXIST in" in section, (
        "the superseded section must state plainly that the role/workload "
        "component is not part of the current index"
    )
    assert "HISTORICAL" in section


def test_role_workload_is_not_read_by_any_scoring_path(peak3_source):
    """The claim the docs now make, verified against the code rather than
    asserted. `role_workload` / `workload_score` / `workload_qualified` are
    COMPUTED as diagnostics, but must not feed the official index.

    Checked against the actual assembly of `prime_raw` -- the open weighted sum
    that becomes `prime_index` / `prime_score` -- not against a function name
    that may not exist.
    """
    import peak3 as P

    assert "role_workload" not in P.OFFICIAL_WEIGHTS

    assembly = peak3_source.split('df["prime_raw"] = (')[1].split(")\n")[0]
    assert "contrib_statistical_impact" in assembly, "fixture assumption: found the real assembly"
    for diagnostic in ("role_workload", "workload_score", "workload_qualified"):
        assert diagnostic not in assembly, (
            f"{diagnostic} feeds the official index; METHODOLOGY.md's correction "
            "and SCORING_METHODOLOGY.md §15 both state that it does not"
        )

    # The five contributions the index sums must be exactly the five official
    # components -- no sixth term other than the documented teammate adjustment.
    summed = {t.strip() for t in assembly.split("+")}
    assert summed == {
        'df["contrib_statistical_impact"]', 'df["contrib_traditional_production"]',
        'df["contrib_recognition"]', 'df["contrib_postseason"]',
        'df["contrib_team_achievement"]', "tmadj",
    }, f"unexpected terms in the official index assembly: {summed}"


def test_postseason_reliability_claim_is_qualified(scoring_doc):
    """§17 used to assert flatly that a short hot run "cannot dwarf a
    Finals-length one". It can -- see tests/test_postseason_sample_invariant.py.
    The doc must not restate the unqualified claim."""
    safeguards = scoring_doc.split("## 17. Methodological safeguards")[1].split("\n## ")[0]
    assert "cannot dwarf a Finals-length one." not in safeguards, (
        "unqualified claim restored; it is measurably false"
    )
    assert "not corrected" in safeguards.lower() or "incomplete" in safeguards.lower()
    assert "test_postseason_sample_invariant" in safeguards, (
        "the doc should point at the executable contract for this defect"
    )


def test_limitations_section_names_the_open_defects(scoring_doc):
    limitations = scoring_doc.split("## 15.")[1].split("## 16.")[0]
    assert "Known open defects" in limitations
    assert "no role/workload component" in limitations.lower()
    assert "MIN_SERVED_ANCHOR_MPG" in limitations, (
        "the limitations section should say what currently contains the defect"
    )
