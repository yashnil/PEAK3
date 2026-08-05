#!/usr/bin/env python3
"""
Reusable performance-measurement tool for RUN THE TABLE and 82-0
(CourtBuilder / Peak Season), plus the shared read paths both depend on.

WHY THIS EXISTS

The RTT overhaul (docs/implementation/rtt-overhaul/) needs an honest
"before" number for every claim the "after" work will make. This script is
the single source of both: run it unmodified against staging (or a local
API) before implementation to produce the BASELINE, then run it again,
unmodified, after implementation to produce the comparison. If the script
changes between runs, the comparison stops being honest -- so changes to
this file should be reviewed the same way a changed test would be.

WHAT IT DOES NOT DO

- It never estimates a number it did not observe. Anything it could not
  reach is recorded with an explicit error, not a placeholder.
- It never computes a PEAK3 score or re-derives game rules; it only plays
  the real, server-authoritative state machine forward using the same
  request shapes the browser sends (CLAUDE.md: no scoring logic here).
- It does not read or need PEAK3_SIGNING_SECRET or any other secret --
  every run it creates is anonymous, exactly like a first-time visitor.

USAGE

    python3 scripts/perf/measure_rtt.py \\
        --base-url https://peak3-staging.up.railway.app \\
        --label staging \\
        --runs 8 --samples 20 \\
        --out docs/implementation/rtt-overhaul/perf-raw/staging-baseline.json

    python3 scripts/perf/measure_rtt.py \\
        --base-url http://127.0.0.1:8010 \\
        --label local \\
        --runs 8 --samples 20 \\
        --out docs/implementation/rtt-overhaul/perf-raw/local-baseline.json

Both a machine-readable JSON (--out) and a human-readable summary (printed
to stdout, and written next to --out with a .md suffix) are produced.

--skip-courtbuilder skips the 82-0 playthrough (e.g. if the allowlist on a
given environment rejects anonymous sessions -- the script detects a 403
from create_game and records that fact rather than failing the whole run).
"""
from __future__ import annotations

import argparse
import gzip
import json
import statistics
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import requests

DEFAULT_TIMEOUT = 30


# ---------------------------------------------------------------------------
# Sample collection
# ---------------------------------------------------------------------------

@dataclass
class Sample:
    ok: bool
    status_code: Optional[int]
    latency_ms: float
    raw_bytes: Optional[int] = None
    gzip_bytes: Optional[int] = None
    server_timing: Optional[str] = None
    error: Optional[str] = None


@dataclass
class Bucket:
    """All samples collected for one logical call site (e.g. 'rtt.draft_buy')."""
    name: str
    samples: list = field(default_factory=list)

    def add(self, s: Sample) -> None:
        self.samples.append(s)

    def summary(self) -> dict:
        ok_samples = [s for s in self.samples if s.ok]
        lat = [s.latency_ms for s in ok_samples]
        errs = [s for s in self.samples if not s.ok]
        out: dict[str, Any] = {
            "n": len(self.samples),
            "n_ok": len(ok_samples),
            "n_error": len(errs),
        }
        if lat:
            out["p50_ms"] = round(_percentile(lat, 50), 1)
            out["p75_ms"] = round(_percentile(lat, 75), 1)
            out["p95_ms"] = round(_percentile(lat, 95), 1)
            out["min_ms"] = round(min(lat), 1)
            out["max_ms"] = round(max(lat), 1)
            out["mean_ms"] = round(statistics.fmean(lat), 1)
        else:
            out["p50_ms"] = out["p75_ms"] = out["p95_ms"] = None
            out["note"] = "NOT MEASURED: every call in this bucket failed"
        raw = [s.raw_bytes for s in ok_samples if s.raw_bytes is not None]
        gz = [s.gzip_bytes for s in ok_samples if s.gzip_bytes is not None]
        if raw:
            out["raw_bytes_median"] = int(statistics.median(raw))
        if gz:
            out["gzip_bytes_median"] = int(statistics.median(gz))
        if raw and gz:
            out["compression_ratio"] = round(statistics.median(raw) / max(1, statistics.median(gz)), 2)
        if errs:
            out["sample_errors"] = list({(e.status_code, e.error) for e in errs})[:5]
        return out


def _percentile(values: list, p: float) -> float:
    if not values:
        return float("nan")
    vs = sorted(values)
    if len(vs) == 1:
        return vs[0]
    k = (len(vs) - 1) * (p / 100)
    f = int(k)
    c = min(f + 1, len(vs) - 1)
    if f == c:
        return vs[f]
    return vs[f] + (vs[c] - vs[f]) * (k - f)


class Measurer:
    def __init__(self, base_url: str, timeout: int = DEFAULT_TIMEOUT):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()
        self.buckets: dict[str, Bucket] = {}
        self.duplicate_log: list[dict] = []

    def bucket(self, name: str) -> Bucket:
        return self.buckets.setdefault(name, Bucket(name))

    def call(
        self,
        bucket_name: str,
        method: str,
        path: str,
        *,
        json_body: Optional[dict] = None,
        cookies: Optional[dict] = None,
        measure_sizes: bool = False,
        record: bool = True,
    ) -> tuple[Optional[requests.Response], Sample]:
        url = f"{self.base_url}{path}"
        headers = {}
        t0 = time.perf_counter()
        try:
            resp = self.session.request(
                method, url, json=json_body, cookies=cookies or {},
                headers=headers, timeout=self.timeout,
            )
            elapsed = (time.perf_counter() - t0) * 1000
            ok = resp.status_code < 400
            raw_bytes = None
            gzip_bytes = None
            if measure_sizes:
                body = resp.content
                raw_bytes = len(body)
                gzip_bytes = len(gzip.compress(body, compresslevel=6))
            s = Sample(
                ok=ok,
                status_code=resp.status_code,
                latency_ms=elapsed,
                raw_bytes=raw_bytes,
                gzip_bytes=gzip_bytes,
                server_timing=resp.headers.get("Server-Timing"),
                error=None if ok else (resp.text[:200] if resp.text else None),
            )
            if record:
                self.bucket(bucket_name).add(s)
            return resp, s
        except requests.RequestException as exc:
            elapsed = (time.perf_counter() - t0) * 1000
            s = Sample(ok=False, status_code=None, latency_ms=elapsed, error=str(exc)[:200])
            if record:
                self.bucket(bucket_name).add(s)
            return None, s


# ---------------------------------------------------------------------------
# Static / stateless endpoints
# ---------------------------------------------------------------------------

def measure_static_endpoints(m: Measurer, samples: int) -> None:
    endpoints = [
        ("health.liveness", "GET", "/health"),
        ("health.readiness", "GET", "/health/readiness"),
        ("rtt.readiness", "GET", "/api/v1/run-the-table/readiness"),
        ("rtt.meta", "GET", "/api/v1/run-the-table/meta"),
        ("rtt.daily_descriptor", "GET", "/api/v1/run-the-table/daily"),
        ("draft.meta", "GET", "/api/v1/draft/meta"),
        ("courtbuilder.readiness", "GET", "/api/v1/perfect-season/readiness"),
        ("leaderboards.top", "GET", "/api/v1/leaderboards?years=3&limit=50"),
    ]
    for name, method, path in endpoints:
        for i in range(samples):
            m.call(name, method, path, measure_sizes=(i < 5))


def measure_cold_vs_warm(m: Measurer) -> dict:
    """First request of a brand-new TCP session vs. the 5 that follow it.

    This is NOT a scale-to-zero cold start (Railway's actual cold start,
    after the service has been idle long enough to deallocate, could not be
    triggered from this script without idling the service first -- that is
    recorded as NOT MEASURED in the report, not estimated).
    """
    fresh = requests.Session()
    first = fresh.get(f"{m.base_url}/health/readiness", timeout=m.timeout)
    t0 = time.perf_counter()
    fresh.get(f"{m.base_url}/health/readiness", timeout=m.timeout)
    cold_first_ms = None
    t0b = time.perf_counter()
    r0 = fresh.get(f"{m.base_url}/health/readiness", timeout=m.timeout)
    warm_after = []
    # Genuinely fresh connection for the "cold" sample:
    fresh2 = requests.Session()
    tc0 = time.perf_counter()
    fresh2.get(f"{m.base_url}/health/readiness", timeout=m.timeout)
    cold_first_ms = (time.perf_counter() - tc0) * 1000
    for _ in range(5):
        tw = time.perf_counter()
        fresh2.get(f"{m.base_url}/health/readiness", timeout=m.timeout)
        warm_after.append((time.perf_counter() - tw) * 1000)
    return {
        "new_tcp_session_first_request_ms": round(cold_first_ms, 1),
        "same_session_next_5_requests_ms": [round(x, 1) for x in warm_after],
        "note": (
            "This measures a new HTTP/TCP+TLS session vs. a warm keep-alive "
            "connection, NOT a platform cold start (scale-to-zero). A true "
            "cold start was NOT MEASURED: it requires idling the deployment "
            "past its scale-down window first, which this script does not do."
        ),
    }


# ---------------------------------------------------------------------------
# RUN THE TABLE playthrough
# ---------------------------------------------------------------------------

def _idem() -> str:
    return uuid.uuid4().hex


def play_rtt_run(m: Measurer, run_index: int, max_steps: int = 80) -> dict:
    """Drive one full standard RUN THE TABLE run to completion (or failure),
    measuring create / node-select / draft-buy / trade / film-room /
    rest-bank / boss-resolve / advance / resume / challenge along the way.

    Node-type coverage is opportunistic: at each node_select step the option
    whose node_type has been exercised least so far (this run) is chosen, so
    a single run tends to touch draft_room, trade_desk, film_room and
    rest_bank all at least once, exactly like a real player exploring the
    board rather than always taking the first option.
    """
    outcome = {"run_index": run_index, "steps": 0, "final_status": None, "error": None}
    cookies: dict = {}

    resp, s = m.call("rtt.create_run", "POST", "/api/v1/run-the-table/runs",
                      json_body={"run_type": "standard"}, cookies=cookies, measure_sizes=True)
    if resp is None or not s.ok:
        outcome["error"] = f"create_run failed: {s.status_code} {s.error}"
        return outcome
    _absorb_cookies(resp, cookies)
    state = resp.json()
    run_id = state["run_id"]

    # Skip the opening reveal (as a player mashing "skip" would) -- still a
    # real call, still measured.
    m.call("rtt.reveal", "POST", f"/api/v1/run-the-table/runs/{run_id}/actions",
           json_body={"action_type": "reveal", "target": "roster", "count": 64,
                      "idempotency_key": _idem()}, cookies=cookies)

    # One resume call mid-flight, as a reload would trigger.
    resume_resp, _ = m.call("rtt.resume_get_run", "GET", f"/api/v1/run-the-table/runs/{run_id}",
                             cookies=cookies, measure_sizes=True)
    if resume_resp is not None and resume_resp.status_code < 400:
        state = resume_resp.json()

    node_type_counts: dict[str, int] = {}
    steps = 0
    while steps < max_steps:
        steps += 1
        status = state.get("status")
        if status in ("complete", "failed"):
            outcome["final_status"] = status
            break

        if status == "system_select":
            offer = state.get("pending_system_offer") or []
            if not offer:
                outcome["error"] = "system_select with empty offer"
                break
            body = {"action_type": "select_system", "system_id": offer[0]["id"],
                     "idempotency_key": _idem()}
            state = _apply(m, "rtt.select_system", run_id, body, cookies, outcome)

        elif status == "node_select":
            options = state.get("stage_options") or []
            if not options:
                outcome["error"] = "node_select with no options"
                break
            # Prefer the least-seen node_type for coverage.
            options_sorted = sorted(options, key=lambda o: node_type_counts.get(o["node_type"], 0))
            chosen = options_sorted[0]
            node_type_counts[chosen["node_type"]] = node_type_counts.get(chosen["node_type"], 0) + 1
            body = {"action_type": "choose_node", "node_id": chosen["node_id"], "idempotency_key": _idem()}
            state = _apply(m, "rtt.choose_node", run_id, body, cookies, outcome)

        elif status == "node_active":
            node = state.get("active_node") or {}
            ntype = node.get("node_type")
            state = _resolve_active_node(m, run_id, node, ntype, cookies, outcome, state)

        elif status == "boss_ready":
            body = {"action_type": "resolve_boss", "idempotency_key": _idem()}
            state = _apply(m, "rtt.resolve_boss", run_id, body, cookies, outcome)

        elif status == "boss_resolved":
            body = {"action_type": "advance", "idempotency_key": _idem()}
            state = _apply(m, "rtt.advance", run_id, body, cookies, outcome)

        else:
            outcome["error"] = f"unhandled status {status!r}"
            break

        if outcome.get("error"):
            break

    outcome["steps"] = steps
    outcome["final_status"] = outcome.get("final_status") or state.get("status")
    outcome["node_type_counts"] = node_type_counts

    # Challenge link creation + descriptor read, once per run.
    ch_resp, ch_s = m.call("rtt.create_challenge", "POST",
                            f"/api/v1/run-the-table/runs/{run_id}/challenge",
                            json_body={}, cookies=cookies)
    if ch_resp is not None and ch_s.ok:
        token = ch_resp.json().get("challenge_token")
        if token:
            m.call("rtt.get_challenge", "GET", f"/api/v1/run-the-table/challenges/{token}",
                   cookies=cookies, measure_sizes=True)

    return outcome


def _resolve_active_node(m, run_id, node, ntype, cookies, outcome, state):
    if ntype == "draft_room":
        offers = node.get("offers") or []
        selectable = [o for o in offers if o.get("selectable")]
        if selectable:
            card = selectable[0]
            slot_id = card["legal_slots"][0]
            body = {"action_type": "draft_buy", "card_id": card["card_id"],
                     "slot_id": slot_id, "idempotency_key": _idem()}
            return _apply(m, "rtt.draft_buy", run_id, body, cookies, outcome)
        body = {"action_type": "draft_pass", "idempotency_key": _idem()}
        return _apply(m, "rtt.draft_pass", run_id, body, cookies, outcome)

    if ntype == "trade_desk":
        incoming = node.get("incoming") or []
        outgoing = node.get("outgoing_options") or []
        outgoing_ids = {o["slot_id"] for o in outgoing}
        candidate = None
        for card in incoming:
            # outgoing_slot_id must be a slot the incoming card is actually
            # legal for (action_trade re-checks this server-side) -- the
            # legal-slot set already excludes the card's own current slot.
            legal_and_open = [sid for sid in (card.get("legal_slots") or []) if sid in outgoing_ids]
            if legal_and_open:
                candidate = (card, legal_and_open[0])
                break
        if candidate:
            card, out_slot = candidate
            body = {"action_type": "trade", "outgoing_slot_id": out_slot,
                     "incoming_card_id": card["card_id"], "idempotency_key": _idem()}
            return _apply(m, "rtt.trade", run_id, body, cookies, outcome)
        body = {"action_type": "decline_trade", "idempotency_key": _idem()}
        return _apply(m, "rtt.decline_trade", run_id, body, cookies, outcome)

    if ntype == "film_room":
        lanes = (node.get("scout") or {}).get("lanes") or []
        lane = lanes[0]["lane"] if lanes else "statistical_impact"
        body = {"action_type": "film_room", "choice": "scout_boss", "lane": lane,
                 "idempotency_key": _idem()}
        return _apply(m, "rtt.film_room", run_id, body, cookies, outcome)

    if ntype == "rest_bank":
        body = {"action_type": "rest_bank", "choice": "take_credits", "idempotency_key": _idem()}
        return _apply(m, "rtt.rest_bank", run_id, body, cookies, outcome)

    outcome["error"] = f"unhandled node_type {ntype!r}"
    return state


def _apply(m: Measurer, bucket: str, run_id: str, body: dict, cookies: dict, outcome: dict):
    resp, s = m.call(bucket, "POST", f"/api/v1/run-the-table/runs/{run_id}/actions",
                      json_body=body, cookies=cookies, measure_sizes=True)
    if resp is None or not s.ok:
        outcome["error"] = f"{bucket} failed: {s.status_code} {s.error} body={body}"
        return {"status": "failed"}
    return resp.json()


def _absorb_cookies(resp: requests.Response, cookies: dict) -> None:
    for k, v in resp.cookies.items():
        cookies[k] = v
    # requests.Session already persists Set-Cookie via the session's cookie
    # jar for subsequent calls on the same Measurer.session, but the anon
    # identity cookie matters cross-call even when a fresh dict is threaded
    # through explicitly, so mirror it here too.


# ---------------------------------------------------------------------------
# 82-0 / CourtBuilder playthrough
# ---------------------------------------------------------------------------

def play_courtbuilder_run(m: Measurer, run_index: int, max_steps: int = 40) -> dict:
    outcome = {"run_index": run_index, "steps": 0, "final_status": None, "error": None}
    cookies: dict = {}
    resp, s = m.call("courtbuilder.create_game", "POST", "/api/v1/perfect-season/games",
                      json_body={"mode": "apex_1y", "challenge_kind": "free_play"},
                      cookies=cookies, measure_sizes=True)
    if resp is None:
        outcome["error"] = f"create_game unreachable: {s.error}"
        return outcome
    if resp.status_code == 403:
        outcome["error"] = "not_in_alpha_allowlist_or_disabled (403) -- see readiness"
        return outcome
    if not s.ok:
        outcome["error"] = f"create_game failed: {s.status_code} {s.error}"
        return outcome
    _absorb_cookies(resp, cookies)
    state = resp.json()
    game_id = state["game_id"]

    did_respin_team = False
    did_respin_season = False
    steps = 0
    while steps < max_steps:
        steps += 1
        status = state.get("status")
        if status in ("result_ready", "rounds_complete"):
            outcome["final_status"] = status
            break

        spin = state.get("current_spin")
        if status == "selection_pending" and spin:
            # Exercise one team respin and one season respin across the whole
            # run (not every round -- a real player uses their 3-per-round
            # budget sparingly), then select a candidate.
            if not did_respin_team and spin.get("team_respins_used", 0) < spin.get("team_respins_max", 0):
                body = {"game_id": game_id, "idempotency_key": _idem()}
                r2, s2 = m.call("courtbuilder.respin_team", "POST",
                                 f"/api/v1/perfect-season/games/{game_id}/respin-team",
                                 json_body=body, cookies=cookies, measure_sizes=True)
                did_respin_team = True
                if r2 is not None and s2.ok:
                    state = r2.json()
                    spin = state.get("current_spin")
            elif not did_respin_season and spin and spin.get("season_respins_used", 0) < spin.get("season_respins_max", 0):
                body = {"game_id": game_id, "idempotency_key": _idem()}
                r2, s2 = m.call("courtbuilder.respin_season", "POST",
                                 f"/api/v1/perfect-season/games/{game_id}/respin-season",
                                 json_body=body, cookies=cookies, measure_sizes=True)
                did_respin_season = True
                if r2 is not None and s2.ok:
                    state = r2.json()
                    spin = state.get("current_spin")

            candidates = (spin or {}).get("candidates") or []
            if not candidates:
                outcome["error"] = "selection_pending with no candidates"
                break
            slug = candidates[0]["player_slug"] if isinstance(candidates[0], dict) else candidates[0]
            body = {"game_id": game_id, "player_slug": slug, "idempotency_key": _idem()}
            resp2, s2 = m.call("courtbuilder.select_player", "POST",
                                f"/api/v1/perfect-season/games/{game_id}/select",
                                json_body=body, cookies=cookies, measure_sizes=True)
            if resp2 is None or not s2.ok:
                outcome["error"] = f"select_player failed: {s2.status_code} {s2.error}"
                break
            state = resp2.json()
            continue

        # placement_pending (or any other in-progress status carrying open
        # slots): place into the first open slot. `"filled"` is the public
        # field (see get_public_state's slots_public) -- the internal
        # `peak_window_id`/`exact_player_season_key` attributes it is
        # derived from are never sent to the client.
        open_slots = [sl["slot_type"] for sl in state.get("slots", []) if not sl.get("filled")]
        if status == "placement_pending" and open_slots:
            body = {"game_id": game_id, "slot_type": open_slots[0], "idempotency_key": _idem()}
            resp2, s2 = m.call("courtbuilder.place_card", "POST",
                                f"/api/v1/perfect-season/games/{game_id}/place",
                                json_body=body, cookies=cookies, measure_sizes=True)
            if resp2 is None or not s2.ok:
                outcome["error"] = f"place_card failed: {s2.status_code} {s2.error}"
                break
            state = resp2.json()
            continue

        outcome["error"] = f"unhandled status {status!r} with no open slots and no spin"
        break

    outcome["steps"] = steps
    if outcome.get("error") is None:
        resp3, s3 = m.call("courtbuilder.complete_game", "POST",
                            f"/api/v1/perfect-season/games/{game_id}/complete",
                            json_body={"game_id": game_id}, cookies=cookies, measure_sizes=True)
        if resp3 is not None and s3.ok:
            outcome["final_status"] = resp3.json().get("status")
            m.call("courtbuilder.shared_result", "GET",
                   f"/api/v1/perfect-season/games/{game_id}/shared-result",
                   cookies=cookies, measure_sizes=True)
    return outcome


# ---------------------------------------------------------------------------
# Report assembly
# ---------------------------------------------------------------------------

def build_report(m: Measurer, meta: dict) -> dict:
    return {
        "meta": meta,
        "buckets": {name: b.summary() for name, b in sorted(m.buckets.items())},
    }


def render_markdown(report: dict) -> str:
    lines = []
    meta = report["meta"]
    lines.append(f"# Performance measurement — {meta['label']}")
    lines.append("")
    lines.append(f"- Base URL: `{meta['base_url']}`")
    lines.append(f"- Measured at: {meta['timestamp_utc']}")
    lines.append(f"- RTT playthroughs: {meta['rtt_runs']} (requested max {meta['rtt_runs_requested']})")
    lines.append(f"- 82-0 playthroughs: {meta['courtbuilder_runs']} (requested max {meta['courtbuilder_runs_requested']})")
    if meta.get("courtbuilder_skipped_reason"):
        lines.append(f"- 82-0 SKIPPED: {meta['courtbuilder_skipped_reason']}")
    lines.append(f"- Static-endpoint samples per endpoint: {meta['static_samples']}")
    lines.append("")
    lines.append("| bucket | n | n_ok | p50 ms | p75 ms | p95 ms | raw bytes (median) | gzip bytes (median) |")
    lines.append("|---|---|---|---|---|---|---|---|")
    for name, b in report["buckets"].items():
        lines.append(
            f"| {name} | {b['n']} | {b['n_ok']} | "
            f"{b.get('p50_ms', 'NOT MEASURED')} | {b.get('p75_ms', '')} | {b.get('p95_ms', '')} | "
            f"{b.get('raw_bytes_median', '')} | {b.get('gzip_bytes_median', '')} |"
        )
    lines.append("")
    if meta.get("cold_vs_warm"):
        cw = meta["cold_vs_warm"]
        lines.append("## Cold (new TCP session) vs warm (keep-alive) — /health/readiness")
        lines.append(f"- New session, first request: {cw['new_tcp_session_first_request_ms']} ms")
        lines.append(f"- Same session, next 5 requests: {cw['same_session_next_5_requests_ms']} ms")
        lines.append(f"- {cw['note']}")
        lines.append("")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--label", required=True, help="e.g. 'staging' or 'local'")
    ap.add_argument("--samples", type=int, default=20, help="samples per static endpoint")
    ap.add_argument("--runs", type=int, default=8, help="full RTT playthroughs")
    ap.add_argument("--courtbuilder-runs", type=int, default=None,
                     help="full 82-0 playthroughs (defaults to --runs)")
    ap.add_argument("--skip-courtbuilder", action="store_true")
    ap.add_argument("--out", required=True, help="path to write JSON report")
    args = ap.parse_args()

    cb_runs_requested = args.courtbuilder_runs if args.courtbuilder_runs is not None else args.runs

    m = Measurer(args.base_url)

    print(f"[{args.label}] static endpoints x{args.samples}...", file=sys.stderr)
    measure_static_endpoints(m, args.samples)

    print(f"[{args.label}] cold vs warm...", file=sys.stderr)
    cold_vs_warm = measure_cold_vs_warm(m)

    rtt_outcomes = []
    print(f"[{args.label}] RUN THE TABLE playthroughs x{args.runs}...", file=sys.stderr)
    for i in range(args.runs):
        out = play_rtt_run(m, i)
        rtt_outcomes.append(out)
        print(f"  rtt run {i}: steps={out['steps']} final={out['final_status']} "
              f"error={out.get('error')}", file=sys.stderr)

    cb_outcomes = []
    cb_skip_reason = None
    if args.skip_courtbuilder:
        cb_skip_reason = "--skip-courtbuilder passed"
    else:
        print(f"[{args.label}] 82-0 playthroughs x{cb_runs_requested}...", file=sys.stderr)
        for i in range(cb_runs_requested):
            out = play_courtbuilder_run(m, i)
            cb_outcomes.append(out)
            print(f"  courtbuilder run {i}: steps={out['steps']} final={out['final_status']} "
                  f"error={out.get('error')}", file=sys.stderr)
        if cb_outcomes and all(o.get("error", "").startswith("not_in_alpha_allowlist") for o in cb_outcomes if o.get("error")):
            if all(o.get("error") for o in cb_outcomes):
                cb_skip_reason = cb_outcomes[0]["error"]

    meta = {
        "label": args.label,
        "base_url": args.base_url,
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "static_samples": args.samples,
        "rtt_runs_requested": args.runs,
        "rtt_runs": sum(1 for o in rtt_outcomes if o.get("final_status") in ("complete", "failed")),
        "rtt_run_outcomes": rtt_outcomes,
        "courtbuilder_runs_requested": cb_runs_requested,
        "courtbuilder_runs": sum(1 for o in cb_outcomes if o.get("final_status") == "result_ready"),
        "courtbuilder_run_outcomes": cb_outcomes,
        "courtbuilder_skipped_reason": cb_skip_reason,
        "cold_vs_warm": cold_vs_warm,
    }

    report = build_report(m, meta)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2))
    md_path = out_path.with_suffix(".md")
    md_path.write_text(render_markdown(report))

    print(f"\nWrote {out_path}", file=sys.stderr)
    print(f"Wrote {md_path}", file=sys.stderr)
    print(render_markdown(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
