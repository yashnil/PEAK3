#!/usr/bin/env python3
"""Build (or check) data/game/prime_modes/career_windows.v1.json.

    python scripts/build_prime_windows.py          # write the artifact
    python scripts/build_prime_windows.py --check  # exit 1 if it would change

Offline and deterministic: reads the committed scored parquet, the canonical
universe, the player reference bio and the committed leaderboard CSVs. See
`nba_peak/prime_modes/build.py` for what is built and why.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from nba_peak.prime_modes.artifact import ARTIFACT_PATH  # noqa: E402
from nba_peak.prime_modes.build import build_payload, dumps  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if the committed artifact is stale")
    args = parser.parse_args()

    text = dumps(build_payload())
    if args.check:
        current = ARTIFACT_PATH.read_text(encoding="utf-8") if ARTIFACT_PATH.exists() else ""
        if current != text:
            print(f"STALE: {ARTIFACT_PATH.relative_to(REPO_ROOT)} does not match a fresh build.")
            print("Run: python scripts/build_prime_windows.py")
            return 1
        print(f"OK: {ARTIFACT_PATH.relative_to(REPO_ROOT)} is current.")
        return 0

    ARTIFACT_PATH.parent.mkdir(parents=True, exist_ok=True)
    ARTIFACT_PATH.write_text(text, encoding="utf-8")
    print(f"Wrote {ARTIFACT_PATH.relative_to(REPO_ROOT)} ({len(text) / 1024:.0f} KiB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
