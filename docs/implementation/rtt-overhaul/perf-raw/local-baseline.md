# Performance measurement — local-memory-backend

- Base URL: `http://127.0.0.1:8010`
- Measured at: 2026-08-03T06:33:15.309790+00:00
- RTT playthroughs: 15 (requested max 15)
- 82-0 playthroughs: 15 (requested max 15)
- Static-endpoint samples per endpoint: 30

| bucket | n | n_ok | p50 ms | p75 ms | p95 ms | raw bytes (median) | gzip bytes (median) |
|---|---|---|---|---|---|---|---|
| courtbuilder.complete_game | 15 | 15 | 215.3 | 219.1 | 230.0 | 10499 | 2898 |
| courtbuilder.create_game | 15 | 15 | 22.6 | 25.9 | 29.7 | 10030 | 1404 |
| courtbuilder.place_card | 120 | 120 | 103.1 | 160.6 | 198.3 | 11764 | 2004 |
| courtbuilder.readiness | 30 | 30 | 1.3 | 1.4 | 1.7 | 5823 | 1586 |
| courtbuilder.respin_season | 15 | 15 | 49.7 | 56.2 | 67.8 | 11568 | 1815 |
| courtbuilder.respin_team | 15 | 15 | 22.0 | 26.2 | 30.3 | 10322 | 1509 |
| courtbuilder.select_player | 120 | 120 | 22.3 | 31.7 | 40.7 | 7395 | 1606 |
| courtbuilder.shared_result | 15 | 15 | 15.3 | 16.7 | 34.4 | 9402 | 2599 |
| draft.meta | 30 | 30 | 0.7 | 0.8 | 0.9 | 818 | 473 |
| health.liveness | 30 | 30 | 0.7 | 0.8 | 1.1 | 61 | 77 |
| health.readiness | 30 | 30 | 0.7 | 0.8 | 0.9 | 118 | 115 |
| leaderboards.top | 30 | 30 | 0.9 | 1.0 | 1.1 | 25929 | 5195 |
| rtt.advance | 39 | 39 | 3.0 | 3.3 | 3.6 | 31865 | 5034 |
| rtt.choose_node | 108 | 108 | 2.9 | 3.2 | 3.6 | 31258 | 4913 |
| rtt.create_challenge | 15 | 15 | 1.7 | 1.9 | 6.4 |  |  |
| rtt.create_run | 15 | 15 | 2.4 | 2.7 | 4.3 | 11949 | 3195 |
| rtt.daily_descriptor | 30 | 30 | 0.9 | 1.0 | 1.3 | 312 | 202 |
| rtt.draft_buy | 32 | 32 | 2.9 | 3.5 | 4.3 | 29083 | 5059 |
| rtt.film_room | 22 | 22 | 3.0 | 3.4 | 3.7 | 38603 | 5939 |
| rtt.get_challenge | 15 | 15 | 1.1 | 1.3 | 4.4 | 263 | 166 |
| rtt.meta | 30 | 30 | 0.8 | 0.9 | 1.1 | 4858 | 1955 |
| rtt.readiness | 30 | 30 | 0.8 | 1.0 | 1.2 | 376 | 227 |
| rtt.resolve_boss | 54 | 54 | 3.3 | 3.7 | 4.6 | 38377 | 5557 |
| rtt.rest_bank | 26 | 26 | 2.9 | 3.2 | 12.3 | 26038 | 4674 |
| rtt.resume_get_run | 15 | 15 | 2.2 | 2.4 | 2.6 | 13421 | 3346 |
| rtt.reveal | 15 | 15 | 2.5 | 2.7 | 3.2 |  |  |
| rtt.select_system | 30 | 30 | 2.6 | 2.8 | 3.4 | 18119 | 3781 |
| rtt.trade | 28 | 28 | 3.0 | 3.3 | 3.6 | 26006 | 4762 |

## Cold (new TCP session) vs warm (keep-alive) — /health/readiness
- New session, first request: 0.9 ms
- Same session, next 5 requests: [0.7, 0.6, 0.6, 0.6, 0.6] ms
- This measures a new HTTP/TCP+TLS session vs. a warm keep-alive connection, NOT a platform cold start (scale-to-zero). A true cold start was NOT MEASURED: it requires idling the deployment past its scale-down window first, which this script does not do.
