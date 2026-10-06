"""The $20 Showdown bot is pinned while Three-Man Weave's bot changes.

WHY THIS FILE EXISTS. Three-Man Weave's bot (tmw_bot_v4) was made deliberately
less predictable: seeded drafting styles, bounded taste noise and a GAME-ONLY
recognition preference (`nba_peak/three_man_weave/recognition.py`). The
Showdown's bot is a different policy that is allowed -- and meant -- to stay
highly optimised. Nothing in the TMW change may leak into it.

Two guards, at the two layers a leak could happen at:

  1. BEHAVIOUR. Forty seeded bot-vs-bot Showdown matches are replayed and the
     full decision sequence (seat, command, amount, candidate) is hashed. The
     digest was captured from the code BEFORE the TMW change and is
     hard-coded: any change in Showdown decisions -- a nerf or otherwise --
     fails here, and has to be made on purpose by re-pinning.
  2. STRUCTURE. No Showdown module imports the TMW bot or the recognition
     layer, and the Showdown's policy version is unchanged.
"""
from __future__ import annotations

import ast
import hashlib
import json
from pathlib import Path

from nba_peak.twenty_dollar.config import BOT_POLICY_VERSION

from .conftest import bot_strategy, play_match

SEEDS = range(40)

#: Captured from main@d8c9900 (pre tmw_bot_v4). Re-pin ONLY for an intended
#: Showdown change.
PINNED_DECISION_DIGEST = "1cefe3312e02dfb498acf6792dd36354806f0a90736d756160b51a46cf0a5ed9"

TWENTY_DOLLAR_DIR = Path(__file__).resolve().parents[2] / "nba_peak" / "twenty_dollar"
SHOWDOWN_ADAPTER = (
    Path(__file__).resolve().parents[2] / "apps" / "api" / "app" / "services" / "twenty_dollar"
)
FORBIDDEN = ("nba_peak.three_man_weave.bot", "nba_peak.three_man_weave.recognition")


def _recording(log: list):
    play = bot_strategy()

    def strategy(state, seat_index, pool, rng):
        command, amount = play(state, seat_index, pool, rng)
        log.append([seat_index, command, amount, state.get("current_candidate")])
        return command, amount

    return strategy


def _decision_digest(pool) -> str:
    sequences = []
    for seed in SEEDS:
        log: list = []
        play_match(seed, pool, seat_strategies={0: _recording(log), 1: _recording(log)})
        sequences.append(log)
    blob = json.dumps(sequences, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()


def test_showdown_bot_decisions_are_unchanged(pool):
    assert _decision_digest(pool) == PINNED_DECISION_DIGEST


def test_showdown_policy_version_is_unchanged():
    assert BOT_POLICY_VERSION == "twenty_dollar_bot_v5"


def _imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text())
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            found.add(node.module)
            found.update(f"{node.module}.{alias.name}" for alias in node.names)
    return found


def test_no_showdown_module_imports_the_tmw_bot_or_recognition():
    files = list(TWENTY_DOLLAR_DIR.glob("*.py")) + list(SHOWDOWN_ADAPTER.glob("*.py"))
    assert files
    for path in files:
        imported = _imports(path)
        for name in imported:
            assert not any(name == f or name.startswith(f + ".") for f in FORBIDDEN), (
                f"{path.name} imports {name}"
            )
            assert not name.startswith("nba_peak.three_man_weave"), f"{path.name} imports {name}"
