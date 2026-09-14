# Game-feel pass 4 — latency evidence (2026-09-14)

How the Three-Man Weave and $20 Showdown responsiveness numbers in the pass-4
report were measured, so they can be re-run rather than trusted.

**Before** is a production build of `720ebbd` (the merge of #30), served from a
separate worktree. **After** is a production build of this branch. Both run
against a local API. Browser runs use the anonymous local-practice cookie
(`PEAK3_ARENA_ANONYMOUS_PRACTICE_ENABLED=true`), because the e2e test-auth hook
is compiled out of production builds.

## Tools

| File | What it measures |
|---|---|
| `latency-driver.mjs` | A real Chromium session plays a whole practice match: every draft, stage, rearrange, bid, pass and forfeit. For each action it records the time to press acknowledgement (first frame), to dispatch, to response, and to the authoritative render. It also records turn handoffs (read → controls live), the delay from a bot's move being due to the client seeing it, poll round trips, and how far into the intro the first read landed. Latency is injected with Playwright request routing (0 / 250 / 750 ms). |
| `server_timing.py` | Runs the API in-process on the memory or Postgres repository (`PG=1`), optionally adding `RTT_MS` to each database round trip. It counts queries per request and splits handler time into read / clock / apply / bots / view. |
| `compare.py` | Prints p50 / p95 / max for every metric, before vs after, from `timing/`. |

```bash
# API :8000 and web :3100 on the build under test
node latency-driver.mjs --web http://localhost:3100 --api http://localhost:8000 \
  --mode tmw|td|td-forfeit --latency 0|250|750 --label after
PG=1 RTT_MS=25 python server_timing.py --label after_pg_rtt25
python compare.py after
```

`timing/browser_<label>_<mode>_desktop_lat<N>.json` holds the raw samples and a
`summary` block. `timing/server_<label>.json` holds the per-route server
breakdown. The files contain durations and local URLs only: no tokens, no
cookies, no player data.

## Reading the numbers

- **ack** is local and should stay under 16 ms at any latency. It is the press
  being acknowledged, not the server agreeing.
- **confirm** includes the network. At 750 ms of injected latency, a confirm of
  about 770 ms means the client added nothing on top of the round trip.
- **select_stage** is the background save of a highlighted player. It is
  debounced by 600 ms on purpose, so a Draft press never queues behind it. The
  selection itself is acknowledged in the same frame.
- **handoff_read_to_actionable_ms_upper** is sampled at frame granularity, so
  it is an upper bound.
