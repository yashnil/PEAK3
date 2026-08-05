#!/usr/bin/env python3
"""Build the NBA Fact of the Day bank into `data/web/nba_facts.v1.json`.

OFFLINE AND DETERMINISTIC. Reads one committed JSON, runs every generator in
`nba_peak.nba_facts`, and writes a sorted bank. No network, no clock, no LLM --
running it twice against unchanged data produces a byte-identical file, which is
what makes "the bank changed" mean "the data changed".

Run it as part of the web dataset build:

    python scripts/build_nba_facts.py
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from nba_peak.nba_facts import (  # noqa: E402
    BANK_PATH,
    CATEGORIES,
    bank_payload,
    build_bank,
)

#: A bank smaller than this is a broken build, not a thin one. The brief asks
#: for at least sixty high-quality facts; failing loudly beats shipping a
#: homepage panel that repeats itself every fortnight.
MIN_FACTS = 60


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out", type=Path, default=BANK_PATH, help="where to write the bank"
    )
    args = parser.parse_args()

    bank = build_bank()
    if len(bank) < MIN_FACTS:
        print(
            f"ERROR: only {len(bank)} facts generated, expected at least {MIN_FACTS}. "
            "A generator or its source data has regressed.",
            file=sys.stderr,
        )
        return 1

    missing_evidence = [fact.fact_id for fact in bank if not fact.evidence]
    if missing_evidence:
        print(
            f"ERROR: {len(missing_evidence)} facts carry no evidence rows "
            f"(first: {missing_evidence[0]}). A fact nobody can check is not a fact.",
            file=sys.stderr,
        )
        return 1

    unknown = sorted({fact.category for fact in bank} - set(CATEGORIES))
    if unknown:
        print(f"ERROR: unknown categories {unknown}", file=sys.stderr)
        return 1

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(bank_payload(bank), indent=2, sort_keys=True) + "\n"
    )

    by_category: dict[str, int] = {}
    for fact in bank:
        by_category[fact.category] = by_category.get(fact.category, 0) + 1
    print(f"wrote {len(bank)} facts to {args.out}")
    for category, count in sorted(by_category.items()):
        print(f"  {category:20s} {count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
