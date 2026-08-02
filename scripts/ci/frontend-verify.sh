#!/usr/bin/env bash
#
# Everything the frontend must satisfy without a browser: types, lint at zero
# warnings, unit tests, and a production build from a clean .next.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$REPO_ROOT/apps/web"

export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:8000}"

step "Type check"
npm run typecheck

step "Lint (zero warnings)"
npm run lint -- --max-warnings 0

step "Unit tests (vitest)"
npm run test

step "Production build (clean .next)"
rm -rf .next
npm run build

ok "Frontend verified"
