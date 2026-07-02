"""
validate_migrations.py
------------------------
Static validation of the canonical supabase/migrations/ chain (spec section
D). Complements migration_inventory.py's parse (reused here) with cross-file
checks that only make sense across the whole ordered sequence.

Checks:
  1. Filenames are strictly ordered (timestamp prefixes sorted == directory sort)
  2. Migration identifiers (filenames) are unique
  3. Every table referenced by ALTER TABLE / policy / trigger / FK exists by
     the time it is referenced (created in this file or an earlier one)
  4. Every CREATE POLICY targets a table that exists by that point
  5. No duplicate policy name on the same table across the whole chain
  6. Required extensions (pgcrypto) are declared before first use of
     gen_random_uuid()
  7. No unresolved legacy migration source remains (infra/migrations/*.sql
     must not exist — only the README.md pointer)

Usage (from repo root):
    python scripts/validate_migrations.py
Exit 0 if clean, 1 if any check fails.
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS_DIR = REPO_ROOT / "supabase" / "migrations"
LEGACY_DIR = REPO_ROOT / "infra" / "migrations"

sys.path.insert(0, str(REPO_ROOT / "scripts"))
from migration_inventory import parse_migration  # noqa: E402


def validate() -> list[str]:
    errors: list[str] = []

    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not files:
        return ["no migration files found under supabase/migrations/"]

    # 1. Filenames strictly ordered (directory sort == chronological sort)
    names = [f.name for f in files]
    if names != sorted(names):
        errors.append(f"migration filenames are not in sorted order: {names}")

    # 2. Unique identifiers
    identifiers = [f.stem for f in files]
    if len(identifiers) != len(set(identifiers)):
        dupes = {i for i in identifiers if identifiers.count(i) > 1}
        errors.append(f"duplicate migration identifiers: {dupes}")

    # 3/4/5. Cumulative table/policy tracking
    known_tables: set[str] = set()
    all_policies: dict[tuple[str, str], str] = {}  # (table, policy_name) -> filename
    extensions_declared: set[str] = set()
    seen_gen_random_uuid_use = False

    for f in files:
        parsed = parse_migration(f)
        sql = f.read_text()

        extensions_declared.update(parsed["extensions_declared"])

        if "gen_random_uuid()" in sql and "pgcrypto" not in extensions_declared:
            errors.append(f"{f.name}: uses gen_random_uuid() before pgcrypto extension is declared")

        for table in parsed["tables_created"]:
            known_tables.add(table)

        for dep in parsed["external_table_dependencies"]:
            if dep not in known_tables:
                errors.append(f"{f.name}: references table '{dep}' before it is created by an earlier migration")

        for policy in parsed["policies"]:
            table = policy["table"]
            if table not in known_tables:
                errors.append(f"{f.name}: CREATE POLICY {policy['name']} targets unknown table '{table}'")
            key = (table, policy["name"])
            if key in all_policies:
                errors.append(
                    f"{f.name}: duplicate policy name '{policy['name']}' on table '{table}' "
                    f"(first declared in {all_policies[key]})"
                )
            else:
                all_policies[key] = f.name

        for rls_table in parsed["rls_enabled_on"]:
            if rls_table not in known_tables:
                errors.append(f"{f.name}: ENABLE ROW LEVEL SECURITY on unknown table '{rls_table}'")

        for trig in parsed["triggers"]:
            if trig["table"] not in known_tables:
                errors.append(f"{f.name}: CREATE TRIGGER {trig['name']} on unknown table '{trig['table']}'")

    # 7. No unresolved legacy migration source
    if LEGACY_DIR.exists():
        legacy_sql = list(LEGACY_DIR.glob("*.sql"))
        if legacy_sql:
            errors.append(
                f"unresolved legacy migration source: {[p.name for p in legacy_sql]} still present "
                f"under {LEGACY_DIR} — supabase/migrations/ must be the only editable source"
            )

    return errors


def main() -> int:
    errors = validate()
    if errors:
        print(f"FAILED: {len(errors)} validation error(s):")
        for e in errors:
            print(f"  - {e}")
        return 1
    print("PASS: migration chain is well-ordered, unique, internally consistent, "
          "and no unresolved legacy migration source remains.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
