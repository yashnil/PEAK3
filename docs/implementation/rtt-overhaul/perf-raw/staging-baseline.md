# Performance measurement — hosted-staging

- Base URL: `https://peak3-staging.up.railway.app`
- Measured at: 2026-08-03T06:36:15.918512+00:00
- RTT playthroughs: 8 (requested max 8)
- 82-0 playthroughs: 8 (requested max 8)
- Static-endpoint samples per endpoint: 15

| bucket | n | n_ok | p50 ms | p75 ms | p95 ms | raw bytes (median) | gzip bytes (median) |
|---|---|---|---|---|---|---|---|
| courtbuilder.complete_game | 8 | 8 | 634.9 | 651.6 | 664.5 | 10987 | 2970 |
| courtbuilder.create_game | 8 | 8 | 250.0 | 257.3 | 996.5 | 10227 | 1474 |
| courtbuilder.place_card | 64 | 64 | 492.4 | 557.8 | 647.4 | 12350 | 2157 |
| courtbuilder.readiness | 15 | 15 | 63.3 | 63.8 | 73.3 | 7953 | 1882 |
| courtbuilder.respin_season | 8 | 8 | 431.7 | 436.9 | 439.9 | 11996 | 1894 |
| courtbuilder.respin_team | 8 | 8 | 397.4 | 439.7 | 559.8 | 10869 | 1638 |
| courtbuilder.select_player | 64 | 64 | 389.6 | 400.0 | 484.1 | 7575 | 1668 |
| courtbuilder.shared_result | 8 | 8 | 297.5 | 300.9 | 337.5 | 9888 | 2678 |
| draft.meta | 15 | 15 | 60.7 | 63.7 | 73.1 | 818 | 473 |
| health.liveness | 15 | 15 | 60.9 | 64.7 | 102.8 | 61 | 77 |
| health.readiness | 15 | 15 | 60.1 | 62.3 | 63.4 | 110 | 110 |
| leaderboards.top | 15 | 15 | 65.4 | 67.2 | 77.2 | 25894 | 5171 |
| rtt.advance | 24 | 24 | 371.3 | 379.3 | 417.5 | 31997 | 5086 |
| rtt.choose_node | 64 | 64 | 369.2 | 374.2 | 404.8 | 32407 | 5176 |
| rtt.create_challenge | 8 | 8 | 209.1 | 211.2 | 212.3 |  |  |
| rtt.create_run | 8 | 8 | 217.0 | 223.4 | 600.7 | 12038 | 3229 |
| rtt.daily_descriptor | 15 | 15 | 59.9 | 62.0 | 64.6 | 312 | 203 |
| rtt.draft_buy | 18 | 18 | 366.3 | 372.3 | 430.9 | 22764 | 4367 |
| rtt.film_room | 15 | 15 | 370.9 | 386.6 | 409.5 | 29805 | 5246 |
| rtt.get_challenge | 8 | 8 | 60.2 | 62.6 | 66.4 | 263 | 166 |
| rtt.meta | 15 | 15 | 59.8 | 61.1 | 64.7 | 4858 | 1955 |
| rtt.readiness | 15 | 15 | 59.1 | 62.4 | 65.7 | 376 | 227 |
| rtt.resolve_boss | 32 | 32 | 369.8 | 374.4 | 389.8 | 42898 | 5905 |
| rtt.rest_bank | 15 | 15 | 369.2 | 373.5 | 406.1 | 32057 | 5076 |
| rtt.resume_get_run | 8 | 8 | 217.5 | 226.4 | 286.0 | 13511 | 3378 |
| rtt.reveal | 8 | 8 | 366.9 | 371.6 | 528.7 |  |  |
| rtt.select_system | 16 | 16 | 364.4 | 374.0 | 435.2 | 18146 | 3819 |
| rtt.trade | 16 | 16 | 370.1 | 375.9 | 410.9 | 35069 | 5520 |

## Cold (new TCP session) vs warm (keep-alive) — /health/readiness
- New session, first request: 166.1 ms
- Same session, next 5 requests: [59.1, 58.9, 55.9, 59.3, 59.9] ms
- This measures a new HTTP/TCP+TLS session vs. a warm keep-alive connection, NOT a platform cold start (scale-to-zero). A true cold start was NOT MEASURED: it requires idling the deployment past its scale-down window first, which this script does not do.
