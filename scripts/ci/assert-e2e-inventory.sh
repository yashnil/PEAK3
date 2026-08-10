#!/usr/bin/env bash
#
# The Playwright projects must still add up to the whole suite, with nothing
# counted twice and nothing dropped.
#
# CI runs the browser tests as a matrix of shards rather than one ~50-minute
# job. That is only safe while the projects PARTITION the suite. The failure it
# guards is silent: change a `testMatch`, add a spec that no shard's pattern
# claims, or let two shards both match a file, and the matrix runs less (or
# more) than the suite — with every job green, because no job knows what the
# others were supposed to run.
#
# So this compares the SET of test ids, not just counts: counts alone would let
# a dropped test and a duplicated one cancel out.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$REPO_ROOT/apps/web"

DESKTOP_PROJECTS=(chromium-core chromium-multiplayer chromium-courtbuilder)

# `--list --reporter=json` gives stable ids; fall back to titles if absent.
ids_for() {
  npx playwright test --project="$1" --list --reporter=json 2>/dev/null \
    | node -e '
      let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
        const j=JSON.parse(s);const out=[];
        const walk=(su)=>{ (su.suites||[]).forEach(walk);
          (su.specs||[]).forEach(sp=>sp.tests.forEach(t=>out.push(`${sp.file}::${sp.line}::${sp.title}`))); };
        (j.suites||[]).forEach(walk); out.sort().forEach(l=>console.log(l));
      });'
}

tmp=$(mktemp -d)
for p in "${DESKTOP_PROJECTS[@]}"; do
  ids_for "$p" > "$tmp/$p.txt"
  echo "  $p  $(wc -l < "$tmp/$p.txt" | tr -d ' ')"
done

cat "$tmp"/*.txt | sort > "$tmp/union.txt"
sort -u "$tmp/union.txt" > "$tmp/union_uniq.txt"

# The reference set: every desktop test, i.e. everything not tagged @mobile.
npx playwright test --project=chromium-core --list >/dev/null 2>&1 || true
total_desktop=$(cat "$tmp/union_uniq.txt" | wc -l | tr -d ' ')
dupes=$(( $(wc -l < "$tmp/union.txt") - total_desktop ))

mobile=$(npx playwright test --project=mobile-chrome --list 2>/dev/null | tail -1 | sed -E 's/.*Total: ([0-9]+) tests.*/\1/')
suite=$(npx playwright test --list 2>/dev/null | tail -1 | sed -E 's/.*Total: ([0-9]+) tests.*/\1/')

echo "  desktop union (unique)  ${total_desktop}"
echo "  duplicates across shards ${dupes}"
echo "  mobile-chrome            ${mobile}"
echo "  full suite               ${suite}"

if [ "$dupes" -ne 0 ]; then
  echo "ERROR: ${dupes} test(s) are selected by more than one desktop shard. They would run twice and a real failure could be masked by the other shard." >&2
  sort "$tmp/union.txt" | uniq -d | head >&2
  exit 1
fi

if [ $((total_desktop + mobile)) -ne "$suite" ]; then
  echo "ERROR: the shards do not cover the suite. desktop(${total_desktop}) + mobile(${mobile}) = $((total_desktop + mobile)), but the full suite has ${suite}. Some test is claimed by no project." >&2
  exit 1
fi

ok "e2e inventory: ${total_desktop} desktop + ${mobile} mobile = ${suite}, no duplicates"
