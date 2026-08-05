#!/usr/bin/env bash
#
# The Supabase/Postgres integration suite, run FOR REAL against a local
# `supabase start` stack -- no hosted project and no secrets required.
#
# ---------------------------------------------------------------------------
# WHY A SUPABASE STACK AND NOT `services: postgres:17`
# ---------------------------------------------------------------------------
# A bare Postgres service container was the obvious cheap answer and it does
# not work. Measured, not assumed -- `postgres:17` in Docker, the chain applied
# in filename order with ON_ERROR_STOP=1:
#
#     19 of 35 migrations fail.
#     ERROR:  schema "auth" does not exist      (14 files, every RLS migration)
#     ERROR:  role "anon" does not exist        (the GRANT/REVOKE migrations)
#
# Fourteen migrations write policies against `auth.uid()` and the privilege
# migrations GRANT/REVOKE to `anon`/`authenticated`. NO migration in the chain
# creates the `auth` schema, the `auth.uid()` function, or those three roles --
# Supabase provisions them, so the chain is only applicable on a stack that has
# them.
#
# The tempting workaround is a bootstrap file that creates a fake `auth` schema,
# a hand-written `auth.uid()` and the three roles. That is rejected on purpose:
# `tests/integration/test_rls_policies.py` exists to prove the real policies
# behave correctly, and pointing it at a locally-invented `auth.uid()` would
# make it prove that MY shim behaves correctly instead. A test that validates
# its own fixture is worse than no test, because it is green.
#
# ---------------------------------------------------------------------------
# WHY THIS RUNS ALL 95 TESTS RATHER THAN SPLITTING THE SUITE
# ---------------------------------------------------------------------------
# Splitting into "DB-only" and "Supabase-auth" halves was considered and is not
# a real split. Only `tests/integration/test_auth_flows.py` talks HTTP to
# GoTrue; `test_rls_policies.py` and `test_migrations.py` use asyncpg only --
# but they still need Supabase's `anon`/`authenticated` roles and `auth.uid()`
# to exist, per the measurement above. So the "DB-only" half is not actually
# runnable on bare Postgres either, and a split would be by convenience rather
# than by dependency. One stack runs everything.
#
# ---------------------------------------------------------------------------
# THE SILENT-SKIP GUARD -- THE POINT OF THIS FILE
# ---------------------------------------------------------------------------
# `tests/integration/conftest.py:25-30` requires all four of
# PEAK3_TEST_SUPABASE_URL / _ANON_KEY / _SERVICE_ROLE_KEY / _DATABASE_URL, and
# its autouse fixture skips the whole package when any is missing. That gate is
# CORRECT and is deliberately left untouched -- it is what stops a missing
# configuration from reading as a pass.
#
# What was wrong was upstream of it: the CI job supplied none of the four, so
# all 95 tests skipped and the job still reported success. `pytest` exits 0 on
# a fully-skipped run, so an exit code alone cannot tell "everything passed"
# from "nothing ran".
#
# This script therefore asserts on the JUnit XML that tests actually EXECUTED:
# collected > 0 and skipped == 0. A skip here is not a soft signal to be
# tolerated -- given the four variables are exported below, the only way a test
# in this suite can skip is a misconfiguration this job exists to catch.
#
# ---------------------------------------------------------------------------
# DESTRUCTIVENESS
# ---------------------------------------------------------------------------
# `supabase db reset` REPLAYS the migration chain from scratch and DROPS every
# row in the local database. That is correct and free on a fresh CI runner, and
# would destroy a developer's local data. So it is opt-in via
# PEAK3_CI_SUPABASE_RESET=1, which the CI job sets and a laptop does not. Run
# locally, this script uses whatever state the stack already has.
#
# This script never stops the stack it did not start, and never touches a
# hosted project: every value comes from `supabase status`, which only ever
# describes the local stack.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$REPO_ROOT"

# The CLI is a dev dependency, not a runtime one, so an installed `supabase`
# binary is preferred and `npx` is the fallback that works on a clean checkout.
if command -v supabase >/dev/null 2>&1; then
  SUPABASE=(supabase)
elif command -v npx >/dev/null 2>&1; then
  SUPABASE=(npx --yes supabase)
else
  die "Neither the 'supabase' CLI nor 'npx' is available.
  This suite needs a local Supabase stack; see apps/api/.env.example."
fi

step "Ensuring the local Supabase stack is running"
if "${SUPABASE[@]}" status >/dev/null 2>&1; then
  ok "stack already running (left as-is; this script does not stop it)"
else
  "${SUPABASE[@]}" start
fi

if [ "${PEAK3_CI_SUPABASE_RESET:-0}" = "1" ]; then
  step "Replaying supabase/migrations from scratch (db reset)"
  # DESTRUCTIVE -- see the header. Only ever reached when the caller has
  # explicitly opted in, which on a CI runner means a container that was
  # created seconds ago and holds nothing.
  "${SUPABASE[@]}" db reset
fi

step "Reading connection details from 'supabase status -o env'"
# `-o env` prints KEY="value" lines, plus at least one non-assignment status
# line ("Stopped services: [...]"), so this parses the assignments rather than
# eval-ing the whole output. The mapping below is the one already documented in
# apps/api/.env.example:60-65; it is restated in code so the two cannot drift
# apart silently.
_status_env="$("${SUPABASE[@]}" status -o env)"

_read_status() {                       # _read_status KEY
  printf '%s\n' "$_status_env" \
    | sed -nE "s/^$1=\"(.*)\"$/\1/p" \
    | head -n 1
}

PEAK3_TEST_SUPABASE_URL="$(_read_status API_URL)"
PEAK3_TEST_SUPABASE_ANON_KEY="$(_read_status ANON_KEY)"
PEAK3_TEST_SUPABASE_SERVICE_ROLE_KEY="$(_read_status SERVICE_ROLE_KEY)"
PEAK3_TEST_DATABASE_URL="$(_read_status DB_URL)"
PEAK3_TEST_SUPABASE_JWT_SECRET="$(_read_status JWT_SECRET)"

# Newer CLI versions publish ANON_KEY as PUBLISHABLE_KEY; .env.example already
# records the two as interchangeable for this variable.
if [ -z "$PEAK3_TEST_SUPABASE_ANON_KEY" ]; then
  PEAK3_TEST_SUPABASE_ANON_KEY="$(_read_status PUBLISHABLE_KEY)"
fi

export PEAK3_TEST_SUPABASE_URL PEAK3_TEST_SUPABASE_ANON_KEY \
       PEAK3_TEST_SUPABASE_SERVICE_ROLE_KEY PEAK3_TEST_DATABASE_URL \
       PEAK3_TEST_SUPABASE_JWT_SECRET

# Fail here, naming the variable, rather than letting the suite skip 95 tests
# with a reason nobody reads. Values are never printed -- three of these are
# credentials, and the two that are not are URLs whose absence is the whole
# message.
_missing=()
for _v in PEAK3_TEST_SUPABASE_URL PEAK3_TEST_SUPABASE_ANON_KEY \
          PEAK3_TEST_SUPABASE_SERVICE_ROLE_KEY PEAK3_TEST_DATABASE_URL \
          PEAK3_TEST_SUPABASE_JWT_SECRET; do
  [ -n "${!_v:-}" ] || _missing+=("$_v")
done
if [ ${#_missing[@]} -gt 0 ]; then
  die "Could not read ${_missing[*]} from 'supabase status -o env'.
  The stack is up but is not reporting the values this suite needs.
  Check:  ${SUPABASE[*]} status -o env"
fi
ok "all five values resolved from the local stack"

step "Supabase / Postgres integration tests (real database)"
_junit="$(mktemp -t peak3-integration-XXXXXX).xml"
_rc=0
# Delegates to the ONE canonical definition of this suite rather than
# restating its selection flags -- the same file the Makefile and the hosted
# ranked-release-gate job call. This script provisions the environment; it does
# not redefine what the suite is.
scripts/ci/api-integration-tests.sh --junitxml="$_junit" || _rc=$?

# Runs even when pytest failed, so a run that both failed AND silently skipped
# reports both facts instead of only the first.
step "Verifying the suite actually executed"
"$PYTHON_BIN" - "$_junit" <<'PY'
import sys
import xml.etree.ElementTree as ET

path = sys.argv[1]
try:
    root = ET.parse(path).getroot()
except (OSError, ET.ParseError) as exc:
    sys.exit(f"could not read the JUnit report at {path}: {exc}")

suites = [root] if root.tag == "testsuite" else list(root.iter("testsuite"))
total = sum(int(s.get("tests", 0)) for s in suites)
skipped = sum(int(s.get("skipped", 0)) for s in suites)
failures = sum(int(s.get("failures", 0)) for s in suites)
errors = sum(int(s.get("errors", 0)) for s in suites)

print(f"  collected={total} skipped={skipped} failures={failures} errors={errors}")

if total == 0:
    sys.exit(
        "NO TESTS RAN. An empty integration run is the exact failure this job "
        "exists to make visible -- it must never be reported as a pass."
    )
if skipped:
    sys.exit(
        f"{skipped} test(s) SKIPPED. All five connection values were exported "
        "from the local stack, so a skip here means the suite could not reach "
        "the database or a fixture is unconfigured. A skipped integration test "
        "is a check that did not happen; it is not a pass."
    )
PY

rm -f "$_junit"

if [ "$_rc" -ne 0 ]; then
  die "Integration tests failed (pytest exit $_rc)."
fi

ok "Supabase/Postgres integration suite passed against a real database"
