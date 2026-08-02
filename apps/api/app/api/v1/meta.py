"""Dataset provenance for the data/web pipeline.

WHICH DATASET THIS DESCRIBES. There are two independent generated pipelines and
this route describes only the first:

  leaderboards/*.csv -> scripts/build_web_dataset.py -> data/web/*.json
      -> /api/v1/leaderboards, /api/v1/meta, Peak Duel, RUN THE TABLE's card pool

  cache/processed/*.parquet -> scripts/build_top_{peaks,seasons}.py
      -> data/game/.../top_1000_*.json -> /api/v1/peaks, /api/v1/seasons
      -> the /rankings page

The two carry DIFFERENT model_version spellings on purpose: this one is
hyphenated ("peak3-v1"), the rankings boards use the underscored slug from
nba_peak/formula_version.py ("peak3_v1"). That is not drift -- it is a
namespace, and apps/api/tests/test_model_version.py asserts it, so a Peak Duel
score can never be read as a peaks-board score. Since this pass, the hyphenated
value is DERIVED from the underscored one through one explicit mapping in
scripts/build_web_dataset.py rather than being typed twice.
"""
from fastapi import APIRouter

from app.core.dataset import dataset_store

router = APIRouter()


@router.get("/meta")
async def get_meta() -> dict:
    """Return the pre-generated metadata.json describing the dataset.

    Returned verbatim -- this route adds nothing and computes nothing. Since
    this pass the underlying metadata.json additionally carries:

      source_tree_dirty        was the working tree modified at build time?
                               (True/False/None-if-git-could-not-answer)
      leaderboards_dir_dirty   were the canonical CSVs specifically modified?
      source_inputs            {repo-relative CSV path: sha256 of its bytes}
      formula_version_id       the underscored slug from nba_peak.formula_version
      formula_version          the full description built from OFFICIAL_WEIGHTS
      model_label              the short human label ("PEAK3 v1")

    `source_commit` alone was a provenance lie waiting to happen: it records
    HEAD, but HEAD is not what the exporter read -- the files on disk were. That
    failure was observed, not theorised (a recorded commit that provably could
    not have produced the methodology.json beside it). The digests are the half
    that stays true when the commit does not.
    """
    return dataset_store.get_metadata()
