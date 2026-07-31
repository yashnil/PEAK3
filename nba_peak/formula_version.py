"""The single source of truth for which PEAK3 scoring formula produced a number.

WHY THIS MODULE EXISTS. Before it, `peak3.py` carried no version identifier at
all, and the descriptive string "peak3_official_weights_v1 (...)" was hand-copied
into four unrelated files. Nothing tied that string to `OFFICIAL_WEIGHTS`, so a
weight could have changed without a single artifact saying so -- every consumer
would have kept reporting v1. A model cannot be versioned by a comment.

So: version identity lives here, the descriptive strings are BUILT from
`peak3.OFFICIAL_WEIGHTS` rather than retyped, and the four call sites import
from here.

THE ONE THING THAT MUST NOT CHANGE. `V1_DESCRIPTION` is byte-identical to the
literal those four files used to hold. Committed artifacts, saved 82-0 runs and
leaderboard rows carry that exact string; regenerating it differently would
orphan them. `test_formula_version.py` pins it character for character.

WHAT A VERSION MEANS HERE. A formula version identifies the SCORING RULES, not
the data. Same version + same input data => same score, always. Two rows with
different versions are not comparable and the UI must not present them as if
they were.
"""
from __future__ import annotations

from typing import Dict, Literal

import peak3 as _peak3

# The identifiers. Narrow Literal rather than str so a typo is a type error.
FormulaVersion = Literal["peak3_v1", "peak3_v2"]

PEAK3_V1: FormulaVersion = "peak3_v1"
PEAK3_V2: FormulaVersion = "peak3_v2"

ALL_FORMULA_VERSIONS: tuple[FormulaVersion, ...] = (PEAK3_V1, PEAK3_V2)

# The version served unless a caller explicitly asks otherwise. v2 stays a
# labelled preview until its blast radius is reviewed; see
# docs/model/PEAK3_V2_FORMULA_DESIGN.md section 7.
DEFAULT_FORMULA_VERSION: FormulaVersion = PEAK3_V1


def _weights_clause() -> str:
    """The weights, rendered exactly as the original hand-typed literal did.

    Built from OFFICIAL_WEIGHTS so the string cannot drift away from the numbers
    it claims to describe -- which was the entire failure mode this module
    closes.
    """
    w = _peak3.OFFICIAL_WEIGHTS
    return (
        f"statistical_impact={w['statistical_impact']:.2f}, "
        f"traditional_production={w['traditional_production']:.2f}, "
        f"recognition={w['recognition']:.2f}, "
        f"postseason={w['postseason']:.2f}, "
        f"team_achievement={w['team_achievement']:.2f}"
    )


# Byte-identical to the literal that used to live in build_top_peaks.py:104,
# build_top_seasons.py:100, perfect_season/config.py:126 and
# build_experimental_card_extension.py:206. Do not reformat.
V1_DESCRIPTION = f"peak3_official_weights_v1 ({_weights_clause()})"

# v2 keeps the same weights -- it changes the postseason COMPONENT, not the
# weighting -- so the description names the component instead.
V2_DESCRIPTION = (
    f"peak3_official_weights_v2 ({_weights_clause()}; "
    "postseason component recalibrated to replacement level)"
)

_DESCRIPTIONS: Dict[str, str] = {
    PEAK3_V1: V1_DESCRIPTION,
    PEAK3_V2: V2_DESCRIPTION,
}

# Short, user-facing labels. The UI shows these; it never shows the raw slug.
_LABELS: Dict[str, str] = {
    PEAK3_V1: "PEAK3 v1",
    PEAK3_V2: "PEAK3 v2 (preview)",
}


def normalize(version: str | None) -> FormulaVersion:
    """Accept a version string, or None for the default. Reject anything else.

    Deliberately strict: a silently-defaulted bad version would mislabel scores,
    which is worse than a loud failure at the edge.
    """
    if version is None:
        return DEFAULT_FORMULA_VERSION
    if version in _DESCRIPTIONS:
        return version  # type: ignore[return-value]
    raise ValueError(
        f"unknown formula version {version!r}; expected one of {ALL_FORMULA_VERSIONS}"
    )


def description(version: str | None = None) -> str:
    """The long `formula_version` string written into artifacts."""
    return _DESCRIPTIONS[normalize(version)]


def label(version: str | None = None) -> str:
    """The short label shown to a person."""
    return _LABELS[normalize(version)]


def is_default(version: str | None) -> bool:
    return normalize(version) == DEFAULT_FORMULA_VERSION
