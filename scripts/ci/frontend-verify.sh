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
# This build proves the app compiles; it is never served. next.config.ts's
# deployability assertion correctly refuses the localhost API URL set above --
# which means it refused THIS step, so CI's own required frontend gate could
# not pass as scripted. The opt-out is deliberate and scoped to verification:
# Vercel and Railway invoke `next build` directly and never set it, so a real
# deploy still gets the full assertion.
export PEAK3_BUILD_VERIFY_ONLY=1
rm -rf .next
npm run build

ok "Frontend verified"
