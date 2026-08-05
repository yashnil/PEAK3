"""The $20 Showdown: the API-side adapter for the two-player sealed-bid auction.

WHY THIS LIVES OUTSIDE `app/services/arena/`. `app/services/arena/**` is the
foundation's package -- the mode contract, the clock, the bot driver and
matchmaking -- and nothing game-specific belongs in it. Keeping each mode in its
own package makes ownership legible from the path alone rather than from a
naming convention, and mirrors the layout `app/services/perfect_season/`
already uses.

WHAT IS AND IS NOT HERE. `mode.py` is a translation layer: `ReducerInput` in,
`ReducerOutput` out. Every actual RULE lives in `nba_peak/twenty_dollar/`, which
depends on neither FastAPI nor the repositories and is tested without a
database, an app or an event loop.

Importing this package does NOT register the mode. `mode.py` self-registers on
its own import, and the application imports that module explicitly -- the reason
`ModeRegistry`'s docstring gives: a mode appearing because a file was copied
into a directory is a deployment surprise rather than a feature.
"""
from __future__ import annotations

__all__: list[str] = []
