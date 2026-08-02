#!/usr/bin/env bash
#
# Predeployment configuration check.
#
# Reports whether each required setting is PRESENT and, where it is safe and
# useful, whether two settings AGREE. It never prints a secret value: for every
# sensitive variable it prints presence and length only, and for the Supabase
# project it prints the project ref, which already ships in the browser bundle.
#
# Exit 0 = ready. Exit 1 = at least one blocker. Warnings do not fail.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$REPO_ROOT"

blockers=0
warnings=0

present() {                       # present NAME [required]
  local name="$1" required="${2:-required}" value="${!1:-}"
  if [ -n "$value" ]; then
    printf '  \033[0;32m✓\033[0m %-42s set (%d chars)\n' "$name" "${#value}"
  elif [ "$required" = "required" ]; then
    printf '  \033[0;31m✗\033[0m %-42s MISSING\n' "$name"; blockers=$((blockers+1))
  else
    printf '  \033[0;33m·\033[0m %-42s unset (optional)\n' "$name"; warnings=$((warnings+1))
  fi
}

# The project ref is the subdomain of a Supabase URL. Public by construction.
project_ref() { printf '%s' "${1:-}" | sed -E 's#^https?://##; s#\..*$##'; }

step "Supabase project identity"
web_url="${NEXT_PUBLIC_SUPABASE_URL:-}"
api_url="${PEAK3_SUPABASE_URL:-}"
present PEAK3_SUPABASE_URL
if [ -n "$web_url" ] && [ -n "$api_url" ]; then
  if [ "$(project_ref "$web_url")" = "$(project_ref "$api_url")" ]; then
    printf '  \033[0;32m✓\033[0m web and API agree: project %s\n' "$(project_ref "$api_url")"
  else
    printf '  \033[0;31m✗\033[0m MISMATCH: web=%s api=%s\n' "$(project_ref "$web_url")" "$(project_ref "$api_url")"
    printf '      A browser session from one project is unverifiable by the other.\n'
    printf '      Symptom: signed in, avatar visible, every write 401s.\n'
    blockers=$((blockers+1))
  fi
else
  printf '  \033[0;33m·\033[0m cannot compare (NEXT_PUBLIC_SUPABASE_URL not in this shell)\n'
  warnings=$((warnings+1))
fi

step "Secrets (presence only — values are never printed)"
present PEAK3_SIGNING_SECRET
present PEAK3_DATABASE_URL
present PEAK3_SUPABASE_JWT_SECRET optional   # only legacy HS256 projects need this
if [ "${PEAK3_SIGNING_SECRET:-}" = "INSECURE_DEV_SECRET_CHANGE_IN_PRODUCTION" ]; then
  printf '  \033[0;31m✗\033[0m PEAK3_SIGNING_SECRET is still the shipped dev default\n'; blockers=$((blockers+1))
fi
case "${PEAK3_DATABASE_URL:-}" in
  *localhost*|*127.0.0.1*) printf '  \033[0;33m·\033[0m PEAK3_DATABASE_URL points at localhost\n'; warnings=$((warnings+1)) ;;
esac

step "Ranked contract (all four, or ranked stays off)"
for v in PEAK3_RANKED_ENABLED PEAK3_RANKED_MATCHMAKING_ENABLED \
         PEAK3_RANKED_RATING_WRITES_ENABLED PEAK3_RANKED_READINESS_LEVEL; do
  printf '  %-44s %s\n' "$v" "${!v:-<unset>}"
done
if [ "${PEAK3_RANKED_ENABLED:-false}" = "true" ] && [ "${PEAK3_RANKED_READINESS_LEVEL:-disabled}" = "disabled" ]; then
  printf '  \033[0;33m·\033[0m enabled but readiness=disabled — the UI will report ranked unavailable\n'
  warnings=$((warnings+1))
fi

step "Production posture"
if [ "${PEAK3_DEBUG:-true}" = "true" ]; then
  printf '  \033[0;33m·\033[0m PEAK3_DEBUG=true — must be false in production\n'; warnings=$((warnings+1))
else
  printf '  \033[0;32m✓\033[0m PEAK3_DEBUG=false\n'
fi
if [ -n "${NEXT_PUBLIC_PEAK3_E2E_AUTH:-}" ]; then
  printf '  \033[0;33m·\033[0m NEXT_PUBLIC_PEAK3_E2E_AUTH is set. It is inert in a production\n'
  printf '      build (NODE_ENV is inlined), but it should not be in a deploy env.\n'
  warnings=$((warnings+1))
fi
present PEAK3_CORS_ORIGINS

step "Generated data"
require_generated_data && ok "generated datasets present"

printf '\n'
if [ "$blockers" -gt 0 ]; then
  die "$blockers blocker(s), $warnings warning(s) — not ready to deploy"
fi
ok "no blockers, $warnings warning(s)"
