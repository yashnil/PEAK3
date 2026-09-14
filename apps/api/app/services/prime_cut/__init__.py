"""PRIME CUT: the API-side adapter onto the Arena foundation.

Rules live in `nba_peak/prime_cut/`; `mode.py` translates `ReducerInput` into a
rules call and its answer back into a `ReducerOutput`. Importing this package
does NOT register the mode -- `mode.py` self-registers on its own import, which
`app/main.py` performs explicitly.
"""
from __future__ import annotations

__all__: list[str] = []
