import json, sys, glob
def flat(s, prefix=""):
    out = {}
    for k, v in s.items():
        if isinstance(v, dict) and "p50" in v:
            out[prefix + k] = v
        elif isinstance(v, dict):
            out.update(flat(v, prefix + k + "."))
    return out
after = sys.argv[1] if len(sys.argv) > 1 else "after4"
for mode in ("tmw", "td", "td-forfeit"):
    for lat in (0, 250, 750):
        try:
            b = flat(json.load(open(f"timing/browser_before_{mode}_desktop_lat{lat}.json"))["summary"])
            a = flat(json.load(open(f"timing/browser_{after}_{mode}_desktop_lat{lat}.json"))["summary"])
        except FileNotFoundError:
            continue
        print(f"\n## {mode} lat{lat}")
        for k in sorted(set(a) | set(b)):
            bb, aa = b.get(k), a.get(k)
            f = lambda x: f"{x['p50']}/{x['p95']}/{x['max']} n={x['n']}" if x else "-"
            print(f"{k:55s} before {f(bb):28s} after {f(aa)}")
