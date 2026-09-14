"""Server-side action lifecycle timing for TMW and $20 Showdown.

Runs real practice matches through the FastAPI routes (in-process TestClient,
memory repositories by default) and wraps each server stage with a timer, so a
route's wall time can be split into: clock.enforce, apply_command (incl. the
reducer), bot driving, rating settlement, projection, event listing.

Usage: python server_timing.py [--matches N] [--label before]
"""
from __future__ import annotations

import argparse
import asyncio
import contextvars
import functools
import json
import os
import statistics
import sys
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]  # the repository root
os.environ["PEAK3_ENV_FILE"] = ""
os.environ.pop("PEAK3_DATABASE_URL", None)
PG = os.environ.get("PG") == "1"
RTT_MS = float(os.environ.get("RTT_MS", "0"))
if PG:
    _env = dict(l.split("=", 1) for l in (ROOT / "apps/api/.env").read_text().splitlines() if "=" in l and not l.startswith("#"))
    os.environ["PEAK3_DATABASE_URL"] = _env["PEAK3_TEST_DATABASE_URL"]
sys.path[:0] = [str(ROOT), str(ROOT / "apps" / "api")]
os.chdir(ROOT / "apps" / "api")

from fastapi.testclient import TestClient  # noqa: E402

from app.core.auth import AuthSubject, get_optional_auth, get_required_auth  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.core.dependencies import _memory_arena_repo as repo  # noqa: E402
from app.main import app  # noqa: E402
from app.api.v1 import arena as routes  # noqa: E402
from app.services.arena import bots as bot_service  # noqa: E402
from app.services.arena import clock  # noqa: E402
from app.services.arena import rating as arena_rating  # noqa: E402
from app.services.arena import matchmaking as mm  # noqa: E402
from app.services.three_man_weave import mode as tmw_module  # noqa: E402
from app.services.twenty_dollar import mode as td_module  # noqa: E402

settings.ARENA_ENABLED = True
settings.ARENA_BOTS_ENABLED = True
settings.ARENA_PUBLIC_QUEUE_ENABLED = True
settings.ARENA_ALPHA_ALLOWLIST = []

label_var: contextvars.ContextVar[str] = contextvars.ContextVar("label", default="?")
STAGES: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))


def _record(stage: str, ms: float) -> None:
    STAGES[label_var.get()][stage].append(ms)


def wrap_async(owner, name: str, stage: str):
    original = getattr(owner, name)

    @functools.wraps(original)
    async def timed(*a, **k):
        t0 = time.perf_counter()
        try:
            return await original(*a, **k)
        finally:
            _record(stage, (time.perf_counter() - t0) * 1000)

    setattr(owner, name, timed)


def wrap_sync(owner, name: str, stage: str):
    original = getattr(owner, name)

    @functools.wraps(original)
    def timed(*a, **k):
        t0 = time.perf_counter()
        try:
            return original(*a, **k)
        finally:
            _record(stage, (time.perf_counter() - t0) * 1000)

    setattr(owner, name, timed)


wrap_async(clock, "enforce", "clock.enforce")
wrap_async(bot_service, "drive_pending_bots", "bots.drive_pending")
wrap_async(arena_rating, "settle_match_rating", "rating.settle")
wrap_async(routes, "_build_view", "build_view")
if PG:
    from app.repositories.arena_postgres import PostgresArenaRepository as _PGRepo
    wrap_async(_PGRepo, "apply_command", "repo.apply_command")
    wrap_async(_PGRepo, "list_events", "repo.list_events")
    import asyncpg.connection as _apc
    q_var: contextvars.ContextVar[list] = contextvars.ContextVar("q", default=[0])
    for _name in ("fetch", "fetchrow", "fetchval", "execute", "executemany"):
        _orig = getattr(_apc.Connection, _name)
        def _mk(_orig):
            async def counted(self, *a, **k):
                q_var.get()[0] += 1
                if RTT_MS:
                    await asyncio.sleep(RTT_MS / 1000)
                return await _orig(self, *a, **k)
            return counted
        setattr(_apc.Connection, _name, _mk(_orig))
else:
    wrap_async(repo, "apply_command", "repo.apply_command")
    wrap_async(repo, "list_events", "repo.list_events")
for m in (tmw_module.mode, td_module.mode):
    wrap_sync(m, "project", "mode.project")
    # reduce is called inside apply_command; the wrapper sees it via the bound
    # attribute routes pass (`mode.reduce`).
    wrap_sync(m, "reduce", "mode.reduce")
wrap_sync(tmw_module.bot, "decide", "bot.decide") if hasattr(tmw_module.bot, "decide") else None

subject = AuthSubject(sub="timing-user", email="t@test.com", is_anonymous=False, raw_claims={})
app.dependency_overrides[get_required_auth] = lambda: subject
app.dependency_overrides[get_optional_auth] = lambda: subject
client = TestClient(app)
if PG:
    client.__enter__()


def timed_request(label: str, method: str, url: str, **kw):
    token = label_var.set(label)
    counter = [0]
    qtoken = q_var.set(counter) if PG else None
    t0 = time.perf_counter()
    try:
        response = client.request(method, url, **kw)
    finally:
        _record("TOTAL", (time.perf_counter() - t0) * 1000)
        if PG:
            _record("db.queries", float(counter[0]))
            q_var.reset(qtoken)
        label_var.reset(token)
    assert response.status_code == 200, (label, response.status_code, response.text[:400])
    return response.json()


def _sql(query, *args):
    import asyncpg
    async def run():
        conn = await asyncpg.connect(os.environ["PEAK3_DATABASE_URL"])
        try:
            await conn.execute(query, *args)
        finally:
            await conn.close()
    return asyncio.run(run())


def age_open_turn(match_id: str, seconds: float) -> None:
    if PG:
        _sql("UPDATE arena_turns SET opened_at = opened_at - make_interval(secs => $2) WHERE match_id = $1::uuid AND resolved_at IS NULL", match_id, float(seconds))
        return
    for turn in repo._turns.get(match_id, []):
        if turn.resolved_at is None:
            turn.opened_at = turn.opened_at - timedelta(seconds=seconds)


def expire_seatless(match_id: str) -> None:
    if PG:
        _sql("UPDATE arena_turns SET opened_at = LEAST(opened_at, now() - interval '30 seconds'), deadline_at = now() - interval '1 second' WHERE match_id = $1::uuid AND resolved_at IS NULL AND seat_index IS NULL", match_id)
        return
    past = datetime.now(timezone.utc) - timedelta(seconds=1)
    for turn in repo._turns.get(match_id, []):
        if turn.resolved_at is None and turn.seat_index is None:
            turn.deadline_at = past


def command(label, match_id, view, ctype, payload, key_suffix=""):
    return timed_request(
        label, "POST", f"/api/v1/arena/matches/{match_id}/commands",
        json={
            "command_type": ctype, "payload": payload,
            "expected_state_version": view["state_version"],
            "idempotency_key": f"h-{view['state_version']:05d}-{ctype}{key_suffix}",
        },
    )


def poll(label, match_id):
    return timed_request(label, "GET", f"/api/v1/arena/matches/{match_id}")


def play_tmw(seed: int | None) -> dict:
    if seed is not None:
        mm._new_seed = lambda: seed
    view = timed_request("tmw.create_practice", "POST", "/api/v1/arena/matches/practice", json={"mode": "three_man_weave"})
    match_id = view["match_id"]
    you = view["your_seat_index"]
    dead_end_states = 0
    for _ in range(600):
        if view["public_state"]["is_complete"]:
            break
        phase = view.get("turn_phase")
        if phase in ("intro", "reveal", "arrival"):
            expire_seatless(match_id)
            view = poll(f"tmw.poll_seatless", match_id)
            continue
        if view["current_turn_seat_index"] != you:
            age_open_turn(match_id, 11)
            before_v = view["state_version"]
            view = poll("tmw.poll_bot_due", match_id)
            if view["state_version"] == before_v and view["current_turn_seat_index"] != you and view.get("turn_phase") == "pick":
                return {"complete": False, "stuck_bot": True}
            continue
        private = view["private_state"]
        fits = private.get("candidate_fits") or {}
        selectable = [(slug, fit) for slug, fit in fits.items() if fit.get("selectable")]
        legal = private.get("legal_picks") or {}
        # A human-like turn: stage, maybe rearrange, then pick.
        if legal:
            slug = sorted(legal)[0]
            slot = legal[slug][0]
            payload = {"player_slug": slug, "slot_type": slot}
        else:
            dead_end_states += 1
            if not selectable:
                # No candidate fits this roster at all: nothing a player can do
                # but let the clock resolve the turn (auto-pick).
                past = datetime.now(timezone.utc) - timedelta(seconds=5)
                for turn in repo._turns.get(match_id, []):
                    if turn.resolved_at is None:
                        turn.deadline_at = past
                before_v = view["state_version"]
                view = poll("tmw.poll_dead_end_timeout", match_id)
                if view["state_version"] == before_v:
                    return {"complete": False, "stuck": True}
                continue
            slug, fit = selectable[0]
            slot = fit.get("slot_type") or (fit.get("slots") or [None])[0] or next(iter((fit.get("plan") or {}).keys()))
            payload = {"player_slug": slug, "slot_type": slot, "placements": fit.get("plan")}
        resp = command("tmw.stage", match_id, view, "tmw_stage_pick", {"player_slug": slug, "slot_type": slot if legal else slot})
        view = resp["match"]
        assignment = {k: v for k, v in (view["private_state"].get("assignment") or {}).items() if v}
        if len(assignment) >= 1:
            resp = command("tmw.rearrange_noop", match_id, view, "tmw_rearrange", {"placements": assignment})
            view = resp["match"]
        resp = command("tmw.pick", match_id, view, "tmw_pick", payload)
        assert resp["accepted"], resp.get("message")
        view = resp["match"]
    return {"complete": view["public_state"]["is_complete"], "dead_end_states": dead_end_states}


def play_td(seed: int | None, forfeit_after: int | None = None) -> dict:
    if seed is not None:
        mm._new_seed = lambda: seed
    view = timed_request("td.create_practice", "POST", "/api/v1/arena/matches/practice", json={"mode": "twenty_dollar"})
    match_id = view["match_id"]
    you = view["your_seat_index"]
    actions = 0
    for _ in range(2000):
        ps = view["public_state"]
        if ps["phase"] == "complete":
            break
        if view.get("turn_phase") in ("intro", "lot_unwinnable", "lot_forced_fill", "arrival") or view["current_turn_seat_index"] is None:
            expire_seatless(match_id)
            view = poll("td.poll_seatless", match_id)
            continue
        if view["current_turn_seat_index"] != you:
            age_open_turn(match_id, 5)
            view = poll("td.poll_bot_due", match_id)
            continue
        if forfeit_after is not None and actions >= forfeit_after:
            resp = command("td.forfeit", match_id, view, "showdown_forfeit", {})
            view = resp["match"]
            continue
        private = view["private_state"]
        legal = view["legal_commands"]
        actions += 1
        if "bid" in legal and private["can_acquire_candidate"] and private["minimum_bid"] <= private["max_bid"] and actions % 2:
            resp = command("td.bid", match_id, view, "bid", {"amount": private["minimum_bid"]})
        else:
            resp = command("td.pass", match_id, view, "pass", {})
        view = resp["match"]
    return {"complete": view["public_state"]["phase"] == "complete", "actions": actions}


def summarize() -> dict:
    out = {}
    for label, stages in sorted(STAGES.items()):
        row = {}
        for stage, values in stages.items():
            values = sorted(values)
            p95 = values[min(len(values) - 1, int(round(0.95 * (len(values) - 1))))]
            row[stage] = {
                "n": len(values), "p50": round(statistics.median(values), 2),
                "p95": round(p95, 2), "max": round(values[-1], 2),
                "sum": round(sum(values), 1),
            }
        out[label] = row
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--matches", type=int, default=2)
    ap.add_argument("--label", default="run")
    ap.add_argument("--seeds", default="")
    args = ap.parse_args()
    seeds = [int(s) for s in args.seeds.split(",") if s] or [None] * args.matches
    info = []
    for seed in seeds:
        info.append(("tmw", seed, play_tmw(seed)))
    for seed in seeds:
        info.append(("td", seed, play_td(seed)))
    info.append(("td-forfeit", seeds[0], play_td(seeds[0], forfeit_after=3)))
    summary = summarize()
    for label, row in summary.items():
        print(f"\n== {label}")
        for stage in ["TOTAL", "clock.enforce", "repo.apply_command", "mode.reduce", "bots.drive_pending", "rating.settle", "build_view", "mode.project", "repo.list_events"]:
            if stage in row:
                s = row[stage]
                print(f"  {stage:22s} n={s['n']:4d} p50={s['p50']:8.2f} p95={s['p95']:8.2f} max={s['max']:8.2f}")
    print("\n", info)
    outdir = Path(__file__).parent / "timing"
    outdir.mkdir(exist_ok=True)
    (outdir / f"server_{args.label}.json").write_text(json.dumps({"summary": summary, "info": [list(map(str, i)) for i in info]}, indent=2))
