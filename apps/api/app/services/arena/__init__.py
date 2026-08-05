"""Mode-agnostic server-authoritative multiplayer.

Layout:

  modes.py        the `ArenaMode` plug-in contract and the mode registry --
                  the seam a specific game implements against.
  clock.py        stored, ENFORCED deadlines and the lazy sweep that fires them.
  bots.py         bot policies, the registry, and the driver. The
                  hidden-information guarantee is structural; see the docstring.
  matchmaking.py  the three entry paths and the rated policy they imply.

Nothing in this package knows a game rule. Every rule lives behind
`ArenaMode.reduce`, which the repository calls while holding the match's row
lock -- see `ArenaRepository.apply_command`.
"""
from __future__ import annotations

from app.services.arena import bots, clock, matchmaking, modes

__all__ = ["bots", "clock", "matchmaking", "modes"]
