# Game-feel pass 3 — manual review evidence (2026-09-06)

Before/after screenshots from real play-throughs against the local API and dev
server (Playwright drivers in this directory; run from a Node script with
`apps/web/node_modules/playwright`). Numbered in run order: opening, first
decision, mid-act, boss, life loss, act transition, late run, failure, victory,
result, resume, phone. `showdown-bot-v5.md`, `tmw-flake.md` and
`peak-duel-endless.md` are the sub-workstream reports; the fact-bank
spot-check is `NBA_FACT_BANK_AUDIT.md` §10.

Measured on the rebuilt Run the Table (Playwright, DOM click → first mutation,
click → next surface): acknowledgement 2.5–18 ms; next surface median 27 ms
(2–104 ms) locally, ~800 ms at 400 ms added latency; reload-resume 470 ms
locally, 2.7 s throttled.

## Final pre-deploy polish pass (2026-09-07)

`polish/` holds the after-shots per mode (82-0 gate/intro/round card/result;
Three-Man Weave round card/lock/previous-pick beat/taken chips/end screen;
Run the Table draft room/perk cards + act-cleared/boss deal/battle
resolution/receipt journey; Showdown turn/result). `court-polish.md` and
`tmw-polish.md` are the sub-workstream reports with exact pacing values.
Suites at the end of the pass: frontend-verify (120 files / 2411 unit tests,
build), API unit 1833, model 1866, e2e multiplayer 31 / 82-0 99 / RTT 21.
