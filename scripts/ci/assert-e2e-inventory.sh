#!/usr/bin/env bash
#
# The two Playwright projects must still add up to the whole suite.
#
# CI runs the browser tests as a matrix over `chromium` and `mobile-chrome`
# rather than as one 55-minute job. That is only safe while the projects
# PARTITION the suite: `chromium` is `grepInvert: /@mobile/` and
# `mobile-chrome` is `grep: /@mobile/`, so every test belongs to exactly one.
#
# The failure this guards is silent. Add a third project, change a grep, or tag
# a spec `@mobile` in a file the desktop job was carrying, and the split starts
# dropping tests — with both jobs green, because neither job knows what the
# other was supposed to run. Nothing else in CI would notice.
#
# So: count each project, count the whole suite, and require the sum to match.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$REPO_ROOT/apps/web"

count() { npx playwright test "$@" --list 2>/dev/null | tail -1 | sed -E 's/.*Total: ([0-9]+) tests.*/\1/'; }

desktop=$(count --project=chromium)
mobile=$(count --project=mobile-chrome)
total=$(count)

echo "  chromium       ${desktop}"
echo "  mobile-chrome  ${mobile}"
echo "  full suite     ${total}"

if [ -z "$desktop" ] || [ -z "$mobile" ] || [ -z "$total" ]; then
  echo "ERROR: could not read a test count from 'playwright test --list'." >&2
  exit 1
fi

sum=$((desktop + mobile))
if [ "$sum" -ne "$total" ]; then
  echo "ERROR: the split does not cover the suite. chromium(${desktop}) + mobile-chrome(${mobile}) = ${sum}, but the full suite has ${total} tests. Some test is in both projects or in neither, so the matrix would run more or less than the suite." >&2
  exit 1
fi

ok "e2e inventory: ${desktop} + ${mobile} = ${total}"
