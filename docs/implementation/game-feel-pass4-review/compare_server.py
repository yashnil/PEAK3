import json, sys, os
labels = sys.argv[1:] or ["before_pg_rtt25", "after1_pg_rtt25"]
data = {}
for l in labels:
    f = f"timing/server_{l}.json"
    if os.path.exists(f):
        data[l] = json.load(open(f))["summary"]
routes = sorted(set().union(*[set(d) for d in data.values()]))
print(f"{'route':28s}" + "".join(f"{l:>34s}" for l in data))
for r in routes:
    row = f"{r:28s}"
    for l, d in data.items():
        s = d.get(r, {})
        t, q = s.get("TOTAL"), s.get("db.queries")
        cell = (f"{t['p50']:.0f}/{t['p95']:.0f}ms q{q['p50']:.0f}" if t and q else "-")
        row += f"{cell:>34s}"
    print(row)
