"""PRIME CUT: eight multi-year peaks arrive one at a time; keep four, cut four.

The rules as a pure package (no FastAPI, no repositories, no clock), in the same
split `nba_peak/twenty_dollar/` uses: `board` deals, `state` enforces, `scoring`
settles, `bot` decides from what a seat may see. `app/services/prime_cut/mode.py`
is the translation layer onto the Arena foundation.
"""
