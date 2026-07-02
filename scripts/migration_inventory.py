"""
migration_inventory.py
------------------------
Parses every file in supabase/migrations/ and produces a machine-readable
(JSON) and human-readable (Markdown) inventory of every SQL object each
migration creates: tables, columns, indexes, constraints, functions,
triggers, RLS enablement, policies, grants, seed/config INSERTs, extensions,
and a best-effort dependency list (tables referenced via REFERENCES/ALTER
that were not created in the same file).

This is a best-effort regex-based extraction, not a full SQL parser — good
enough for documentation and the sibling validation script
(scripts/validate_migrations.py), not a substitute for actually running the
migrations (see supabase/migrations/MIGRATION_INVENTORY.md's note on that).

Usage (from repo root):
    python scripts/migration_inventory.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS_DIR = REPO_ROOT / "supabase" / "migrations"

RE_EXTENSION = re.compile(r"CREATE EXTENSION IF NOT EXISTS (\w+)", re.IGNORECASE)
RE_TABLE = re.compile(r"CREATE TABLE IF NOT EXISTS (\w+)\s*\((.*?)\n\);", re.IGNORECASE | re.DOTALL)
RE_INDEX = re.compile(r"CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+)\s+ON\s+(\w+)", re.IGNORECASE)
RE_ADD_CONSTRAINT = re.compile(r"ADD CONSTRAINT (\w+)", re.IGNORECASE)
RE_TABLE_CONSTRAINT = re.compile(r"^\s*CONSTRAINT (\w+)", re.IGNORECASE | re.MULTILINE)
RE_FUNCTION = re.compile(r"CREATE (?:OR REPLACE )?FUNCTION (\w+)\s*\(", re.IGNORECASE)
RE_TRIGGER = re.compile(r"CREATE TRIGGER (\w+)\s+\S+\s+\S+(?:\s+\S+)?\s+ON\s+(\w+)", re.IGNORECASE)
RE_RLS_ENABLE = re.compile(r"ALTER TABLE (\w+) ENABLE ROW LEVEL SECURITY", re.IGNORECASE)
RE_POLICY = re.compile(r"CREATE POLICY (\w+) ON (\w+)", re.IGNORECASE)
RE_GRANT = re.compile(r"^GRANT\s+.*?\s+ON\s+(\w+)", re.IGNORECASE | re.MULTILINE)
RE_INSERT = re.compile(r"INSERT INTO (\w+)", re.IGNORECASE)
RE_REFERENCES = re.compile(r"REFERENCES\s+(\w+)", re.IGNORECASE)
RE_COLUMN_LINE = re.compile(r"^\s*(\w+)\s+(TEXT|UUID|BIGSERIAL|SERIAL|INTEGER|NUMERIC[^,]*|TIMESTAMPTZ|BOOLEAN|JSONB|SMALLINT|BIGINT)", re.IGNORECASE | re.MULTILINE)


def _extract_columns(table_body: str) -> list[str]:
    columns = []
    for line in table_body.splitlines():
        m = RE_COLUMN_LINE.match(line)
        if m:
            columns.append(m.group(1))
    return columns


def _strip_sql_line_comments(sql: str) -> str:
    """Strip `-- ...` line comments before regex analysis — a comment like
    "-- references the match it belongs to" would otherwise false-positive
    match RE_REFERENCES (case-insensitive) and capture "the" as a table name.
    Does not handle /* */ block comments (none are used in this codebase).
    """
    return "\n".join(line.split("--", 1)[0] for line in sql.splitlines())


def parse_migration(path: Path) -> dict:
    raw_sql = path.read_text()
    sql = _strip_sql_line_comments(raw_sql)
    tables = {}
    for m in RE_TABLE.finditer(sql):
        table_name, body = m.group(1), m.group(2)
        tables[table_name] = _extract_columns(body)

    indexes = [{"name": m.group(1), "table": m.group(2)} for m in RE_INDEX.finditer(sql)]
    constraints = [m.group(1) for m in RE_ADD_CONSTRAINT.finditer(sql)] + [
        m.group(1) for m in RE_TABLE_CONSTRAINT.finditer(sql)
    ]
    functions = sorted(set(RE_FUNCTION.findall(sql)))
    triggers = [{"name": m.group(1), "table": m.group(2)} for m in RE_TRIGGER.finditer(sql)]
    rls_enabled = sorted(set(RE_RLS_ENABLE.findall(sql)))
    policies = [{"name": m.group(1), "table": m.group(2)} for m in RE_POLICY.finditer(sql)]
    grants = sorted(set(RE_GRANT.findall(sql)))
    seed_inserts = sorted(set(RE_INSERT.findall(sql)))
    extensions = sorted(set(RE_EXTENSION.findall(sql)))

    referenced_tables = sorted(set(RE_REFERENCES.findall(sql)))
    external_dependencies = sorted(t for t in referenced_tables if t not in tables)

    idempotency_notes = []
    if "CREATE TABLE IF NOT EXISTS" in sql:
        idempotency_notes.append("tables: CREATE TABLE IF NOT EXISTS")
    if "CREATE INDEX IF NOT EXISTS" in sql or "CREATE UNIQUE INDEX IF NOT EXISTS" in sql:
        idempotency_notes.append("indexes: CREATE [UNIQUE] INDEX IF NOT EXISTS")
    if "DROP POLICY IF EXISTS" in sql:
        idempotency_notes.append("policies: DROP POLICY IF EXISTS guard before CREATE POLICY")
    if "DROP TRIGGER IF EXISTS" in sql:
        idempotency_notes.append("triggers: DROP TRIGGER IF EXISTS guard before CREATE TRIGGER")
    if "pg_constraint" in sql:
        idempotency_notes.append("constraints: guarded via pg_constraint existence check in a DO block")

    return {
        "filename": path.name,
        "identifier": path.stem,
        "tables_created": tables,
        "indexes": indexes,
        "constraints": sorted(set(constraints)),
        "functions": functions,
        "triggers": triggers,
        "rls_enabled_on": rls_enabled,
        "policies": policies,
        "grants": grants if grants else "none (RLS is the access gate; no explicit GRANTs used)",
        "seed_or_config_inserts": seed_inserts,
        "extensions_declared": extensions,
        "external_table_dependencies": external_dependencies,
        "idempotency_notes": idempotency_notes if idempotency_notes else ["none detected"],
    }


def build_inventory() -> list[dict]:
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    return [parse_migration(f) for f in files]


def render_markdown(inventory: list[dict]) -> str:
    lines = [
        "# Supabase Migration Inventory (Phase 4.0A)",
        "",
        "Auto-generated by `scripts/migration_inventory.py` — regenerate after any",
        "migration change rather than hand-editing this file.",
        "",
        "| # | Identifier | Tables | Indexes | Constraints | Functions | Triggers | RLS | Policies |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for i, m in enumerate(inventory, 1):
        lines.append(
            f"| {i} | `{m['identifier']}` | {len(m['tables_created'])} | {len(m['indexes'])} | "
            f"{len(m['constraints'])} | {len(m['functions'])} | {len(m['triggers'])} | "
            f"{len(m['rls_enabled_on'])} | {len(m['policies'])} |"
        )

    lines.append("")
    lines.append("## Detail per migration")
    for m in inventory:
        lines.append(f"\n### `{m['filename']}`\n")
        lines.append(f"**Tables created:** {', '.join(m['tables_created']) or 'none'}")
        for table, cols in m["tables_created"].items():
            lines.append(f"  - `{table}`: {', '.join(cols)}")
        lines.append(f"\n**Indexes:** {', '.join(idx['name'] for idx in m['indexes']) or 'none'}")
        lines.append(f"\n**Constraints:** {', '.join(m['constraints']) or 'none'}")
        lines.append(f"\n**Functions:** {', '.join(m['functions']) or 'none'}")
        lines.append(f"\n**Triggers:** {', '.join(t['name'] for t in m['triggers']) or 'none'}")
        lines.append(f"\n**RLS enabled on:** {', '.join(m['rls_enabled_on']) or 'none'}")
        lines.append(f"\n**Policies:** {', '.join(p['name'] for p in m['policies']) or 'none'}")
        lines.append(f"\n**Grants:** {m['grants']}")
        lines.append(f"\n**Seed/config INSERTs into:** {', '.join(m['seed_or_config_inserts']) or 'none'}")
        lines.append(f"\n**Extensions declared:** {', '.join(m['extensions_declared']) or 'none'}")
        lines.append(f"\n**External table dependencies (not created in this file):** {', '.join(m['external_table_dependencies']) or 'none'}")
        lines.append(f"\n**Idempotency:** {'; '.join(m['idempotency_notes'])}")
    return "\n".join(lines) + "\n"


def main() -> int:
    if not MIGRATIONS_DIR.exists():
        print(f"ERROR: {MIGRATIONS_DIR} not found")
        return 1

    inventory = build_inventory()

    json_path = MIGRATIONS_DIR / "MIGRATION_INVENTORY.json"
    json_path.write_text(json.dumps(inventory, indent=2))

    md_path = MIGRATIONS_DIR / "MIGRATION_INVENTORY.md"
    md_path.write_text(render_markdown(inventory))

    print(f"Wrote {json_path}")
    print(f"Wrote {md_path}")
    print(f"{len(inventory)} migrations inventoried.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
