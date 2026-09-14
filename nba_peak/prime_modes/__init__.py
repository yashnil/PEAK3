"""Shared canonical data for the two multi-year-window Arena modes.

PRIME CUT (`nba_peak/prime_cut`) and FIND THE PRIME (`nba_peak/find_the_prime`)
both read one committed, versioned artifact:

    data/game/prime_modes/career_windows.v1.json

It is produced by `build.py` from the canonical PEAK3 model -- the same
`peak3.n_year_windows` / `nyear_window_decomposition` / `calibrate_score`
chain `nba_peak/leaderboards.py` uses for the committed top-250 CSVs -- and a
test pins every best window in it to those CSVs. Nothing in this package, and
nothing downstream of it, computes a PEAK3 score.

`artifact.py` is the runtime reader and imports neither pandas nor `peak3`, so
the API can warm it at import without paying for the model.
"""
