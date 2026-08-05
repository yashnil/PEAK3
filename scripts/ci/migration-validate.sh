#!/usr/bin/env bash
#
# Static validation of the migration chain, plus a drift check on the
# committed inventory.
#
# WHY THIS EXISTS. `scripts/validate_migrations.py` and
# `scripts/migration_inventory.py` have both been in the repository for
# several passes and were invoked by NOTHING -- not the workflow, not the
# Makefile, not another script. Two working validators that never run are
# indistinguishable from two validators that do not exist, except that they
# read like coverage. This is the caller.
#
# TWO CHECKS, IN THIS ORDER:
#
#   1. `validate_migrations.py` -- cross-file invariants that only make sense
#      over the whole ordered chain: filenames strictly ordered, identifiers
#      unique, every table referenced by an ALTER/policy/trigger/FK exists by
#      the time it is referenced, every CREATE POLICY targets a table that
#      exists by that point, no duplicate policy name on the same table
#      anywhere in the chain, pgcrypto declared before the first
#      gen_random_uuid(), and no unresolved legacy infra/migrations/*.sql.
#
#   2. INVENTORY DRIFT -- `MIGRATION_INVENTORY.{json,md}` are committed
#      artefacts generated from the migration files. Regenerating them and
#      requiring `git diff --exit-code` to be clean is what makes them a
#      checkable claim about the chain rather than a snapshot that silently
#      goes stale the first time somebody adds a migration and forgets.
#
# WHAT THIS IS NOT. Neither check runs SQL. `migration_inventory.py`'s own
# docstring is explicit that it is "a best-effort regex-based extraction, not
# a full SQL parser... not a substitute for actually running the migrations".
# Actually applying the chain is what scripts/ci/supabase-local-integration.sh
# does against a real Postgres; these two are the cheap static half and they do
# not replace it.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$REPO_ROOT"

step "Validating the migration chain (static, cross-file)"
"$PYTHON_BIN" scripts/validate_migrations.py

step "Regenerating the migration inventory and checking for drift"
"$PYTHON_BIN" scripts/migration_inventory.py

if ! git diff --exit-code -- \
    supabase/migrations/MIGRATION_INVENTORY.json \
    supabase/migrations/MIGRATION_INVENTORY.md; then
  die "supabase/migrations/MIGRATION_INVENTORY.{json,md} are out of date.

  Those files are generated from supabase/migrations/*.sql and are committed,
  so a migration added without regenerating them leaves the inventory
  describing a chain that no longer exists.

  Regenerate and commit:  python scripts/migration_inventory.py"
fi

ok "Migration chain validated; committed inventory is in sync"
