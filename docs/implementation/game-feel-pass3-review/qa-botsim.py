"""Opponent-proxy simulation harness for The $20 Showdown bot (v5 recalibration).

Recreates the session-local v4 harness: drives `nba_peak.twenty_dollar.state`
one action at a time (the same loop as tests/twenty_dollar/test_bot_calibration
.py::_play), with the shipped bot in one seat and one of four opponents in the
other. Seats alternate by seed so opening-seat advantage cancels.

Every opponent sees exactly what the bot sees: the seat projection plus the
coarse public rank band. Nobody reads the hidden score.

Usage:
    python botsim.py [--seeds 2000] [--opp all|proxy|max|min|self] [--verbose]
"""
from __future__ import annotations

import argparse
import math
import random
import statistics
import sys
from collections import Counter, defaultdict

sys.path.insert(0, "/Users/yashnilmohanty/Desktop/PEAK3")

from nba_peak.twenty_dollar import rules  # noqa: E402
from nba_peak.twenty_dollar import state as S  # noqa: E402
from nba_peak.twenty_dollar.bot import TwentyDollarBot  # noqa: E402
from nba_peak.twenty_dollar.config import (  # noqa: E402
    HARD_MAX_LOTS,
    STANDARD_MARKET_LOTS,
    STARTING_BUDGET,
    rank_band,
)
from nba_peak.twenty_dollar.pool import get_pool  # noqa: E402

BAND_ORDER = ["1-10", "11-25", "26-50", "51-100", "101-250", "251-500"]


def _seat(public, idx):
    for s in public["seats"]:
        if s["seat_index"] == idx:
            return s
    return None


# ---------------------------------------------------------------------------
# Opponents. Each is `(public, private, rng) -> (command, amount)`.
# ---------------------------------------------------------------------------

#: A competent human's reservation price by public rank band, in dollars, when
#: holding a fair share of budget per open slot (~$3.2 discretionary/slot).
PROXY_RESERVATION = {
    "1-10": 9.0, "11-25": 7.0, "26-50": 5.0, "51-100": 3.0, "101-250": 1.5, "251-500": 1.0,
}
PROXY_OPEN_BANDS = {"1-10", "11-25", "26-50", "51-100", "101-250"}


def rank_aware_proxy(public, private, rng):
    """A RANK-AWARE HUMAN PROXY.

    Values a candidate by its public rank band, prefers filling roster needs
    (single-fit candidates and scarce positions), pays up to a rank-based
    reservation price scaled by how rich it is per open slot, with seeded
    noise of about +/-1 dollar, respects budget and the reserve rule, spends
    down in the last lots, and uses its skips on sub-101 candidates while it
    has spare skips.
    """
    if not private.get("is_your_turn"):
        return S.COMMAND_PASS, 0
    minimum = int(private["minimum_bid"])
    max_bid = int(private["max_bid"])
    fits = list(private.get("candidate_fits") or [])
    can_pass = private.get("can_pass", True)
    if minimum > max_bid or not private.get("can_acquire_candidate") or not fits:
        return (S.COMMAND_PASS, 0) if can_pass else (S.COMMAND_BID, minimum)

    me = _seat(public, private["seat_index"])
    open_slots = list(me["open_slots"])
    n_open = max(1, len(open_slots))
    budget = int(me["budget"])
    discretionary = max(0, budget - (n_open - 1))
    band = private.get("candidate_band", "251-500")
    lot_index = int(public["lot_index"])
    lots_left = max(0, STANDARD_MARKET_LOTS - lot_index) + 3
    standing = int(public.get("current_bid") or 0)

    base = PROXY_RESERVATION.get(band, 1.0)
    # Richer per slot than the opening fair share -> willing to pay more.
    per_slot = discretionary / n_open
    base *= min(1.6, max(0.4, per_slot / 3.2))
    usable = [s for s in fits if s in open_slots] or fits
    if len(usable) == 1:
        base *= 1.1
    if any(s in ("C", "PG") for s in usable):
        base += 0.3
    # Endgame: the money is dead soon; spend it on anything decent.
    if lots_left / n_open <= 2.5 and band in PROXY_OPEN_BANDS:
        base = max(base, discretionary * 0.8)
    reservation = int(round(base + rng.gauss(0, 0.9)))
    reservation = max(1, min(reservation, discretionary, max_bid))

    if standing <= 0:
        skips = int(private.get("market_skips", 0))
        wants = band in PROXY_OPEN_BANDS or skips <= n_open or private.get("lot_already_rejected")
        if wants or not can_pass:
            return S.COMMAND_BID, min(minimum, max_bid)
        return S.COMMAND_PASS, 0
    if minimum <= reservation:
        return S.COMMAND_BID, minimum
    return (S.COMMAND_PASS, 0) if can_pass else (S.COMMAND_BID, minimum)


MAX_RAISER_BANDS = {"1-10", "11-25", "26-50", "51-100"}


def always_max_raise(public, private, rng):
    """ALWAYS MAX-RAISE: every time it wants a player (a top-100 fit, or any
    fit once its skips are gone) it bids the most the reserve rule allows."""
    if not private.get("is_your_turn"):
        return S.COMMAND_PASS, 0
    minimum = int(private["minimum_bid"])
    max_bid = int(private["max_bid"])
    can_pass = private.get("can_pass", True)
    if minimum > max_bid or not private.get("can_acquire_candidate"):
        return (S.COMMAND_PASS, 0) if can_pass else (S.COMMAND_BID, minimum)
    band = private.get("candidate_band", "251-500")
    me = _seat(public, private["seat_index"])
    skips = int(private.get("market_skips", 0))
    wants = band in MAX_RAISER_BANDS or skips <= len(me["open_slots"])
    if wants or not can_pass:
        return S.COMMAND_BID, max(minimum, max_bid)
    return S.COMMAND_PASS, 0


def min_opener(public, private, rng):
    """MIN OPENER: opens at the minimum on every candidate it can use (never
    spends a skip voluntarily) and only ever bids the legal floor, staying in
    a contested lot while the floor is inside its (noise-free) rank-based
    reservation price."""
    if not private.get("is_your_turn"):
        return S.COMMAND_PASS, 0
    minimum = int(private["minimum_bid"])
    max_bid = int(private["max_bid"])
    can_pass = private.get("can_pass", True)
    if minimum > max_bid or not private.get("can_acquire_candidate"):
        return (S.COMMAND_PASS, 0) if can_pass else (S.COMMAND_BID, minimum)
    standing = int(public.get("current_bid") or 0)
    if standing <= 0:
        return S.COMMAND_BID, min(minimum, max_bid)
    me = _seat(public, private["seat_index"])
    n_open = max(1, len(me["open_slots"]))
    discretionary = max(0, int(me["budget"]) - (n_open - 1))
    band = private.get("candidate_band", "251-500")
    reservation = int(round(PROXY_RESERVATION.get(band, 1.0) * min(1.6, max(0.4, (discretionary / n_open) / 3.2))))
    reservation = max(1, min(reservation, max_bid))
    if minimum <= reservation:
        return S.COMMAND_BID, minimum
    return (S.COMMAND_PASS, 0) if can_pass else (S.COMMAND_BID, minimum)


def bot_player(policy):
    def play(public, private, rng):
        command, payload = policy.decide(public, private, rng)
        return command, int(payload.get("amount", 0))
    return play


OPPONENTS = {
    "proxy": rank_aware_proxy,
    "max": always_max_raise,
    "min": min_opener,
}


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------


def run_match(seed, pool, players, rngs=None):
    """`players[seat] -> strategy`. Returns (terminal_state, lot_records).

    lot_records carry, per resolved lot, the loser's legal max bid at the
    moment it resolved, which the underpricing metric needs.
    """
    state = S.initial_state(seed=seed)
    rng = random.Random(seed ^ 0x5EED)
    rngs = rngs or {0: rng, 1: rng}
    actions = 0
    records = []
    prev_hist = 0
    while not S.is_complete(state):
        actions += 1
        assert actions < 4000, f"seed {seed}: no termination"
        seat_index = state["active_seat"]
        if seat_index is None:
            if S.is_forced_fill_pending(state):
                S.resolve_forced_fill(state, pool)
            else:
                assert S.is_unwinnable_lot_pending(state)
                S.resolve_unwinnable_lot(state, pool)
            continue
        snapshot = [
            (int(s["budget"]), len(s["roster"]), int(s.get("market_skips", 5)))
            for s in state["seats"]
        ]
        public, private, legal = S.project(state, seat_index, pool)
        private = {
            **private,
            "candidate_tier": state.get("current_candidate_tier"),
            "candidate_band": rank_band(pool.get(state["current_candidate"]).rank),
        }
        command, amount = players[seat_index](public, private, rngs[seat_index])
        assert command in legal, f"seed {seed}: seat {seat_index} chose {command}, legal {legal}"
        _, code, message = S.submit_action(state, seat_index, command, amount, pool)
        assert code is None, f"seed {seed}: rejected {code}: {message}"
        while len(state["history"]) > prev_hist:
            record = state["history"][prev_hist]
            prev_hist += 1
            winner = record["winner_seat"]
            entry = {
                "lot_index": record["lot_index"],
                "winner": winner,
                "price": int(record["price"]) if winner is not None else 0,
                "rank": record["candidate"].get("rank"),
                "band": rank_band(record["candidate"]["rank"]) if record["candidate"].get("rank") else None,
                "positions": list(record["candidate"].get("positions") or []),
                "decided_by": record["decided_by"],
                "loser_max_bid": None,
                "loser_fit": None,
            }
            if winner is not None:
                loser = 1 - winner
                b, filled, _ = snapshot[loser]
                entry["loser_max_bid"] = rules.max_legal_bid(b, filled)
                # did the loser have an open slot this candidate could fill?
                open_slots = public["seats"][loser]["open_slots"]
                entry["loser_fit"] = bool(set(entry["positions"]) & set(open_slots))
            records.append(entry)
    return state, records


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

EARLY_LOTS = 6           # both purchases inside the first six lots
EARLY_SHARE = 0.5        # >= 50% of the starting budget across the first two buys
HEAVY_SHARE = 0.6        # >= 60% ($12): the v4 double-star shape
DECIDED_MARGIN = 10.0    # the front-loading seat wins by at least this many points
LATE_LOT = 6             # the second half of a typical match (mean ~12 auctioned lots)
PREMIUM_RANK = 25        # a "premium" lot: public rank 1-25
CHEAP_PRICE = 2


def analyse(seed, state, records, pool, bot_seat):
    scores = S.final_scores(state, pool)
    opp = 1 - bot_seat
    bot_total, opp_total = scores[bot_seat], scores[opp]
    win = 1.0 if bot_total > opp_total else (0.5 if bot_total == opp_total else 0.0)
    out = {
        "seed": seed,
        "win": win,
        "margin": bot_total - opp_total,
        "bot_total": bot_total,
        "opp_total": opp_total,
        "bot_spend": STARTING_BUDGET - state["seats"][bot_seat]["budget"],
        "opp_spend": STARTING_BUDGET - state["seats"][opp]["budget"],
        "lots": len([r for r in records if r["decided_by"] != S.DECIDED_BY_AUTOFILL]),
        "frontload": {0: False, 1: False},
        "early_blowout": {0: False, 1: False},
        "heavy_frontload": {0: False, 1: False},
        "heavy_blowout": {0: False, 1: False},
        "first_two_spend": {0: None, 1: None},
        "late_cheap_premium": 0,
        "late_lockout_premium": 0,
        "prices": [],
    }
    buys = {0: [], 1: []}
    for r in records:
        if r["winner"] is None or r["decided_by"] == S.DECIDED_BY_AUTOFILL:
            continue
        buys[r["winner"]].append(r)
        out["prices"].append((r["band"], r["price"], r["winner"] == bot_seat, r["rank"]))
        if (
            r["lot_index"] >= LATE_LOT
            and r["rank"] is not None
            and r["rank"] <= PREMIUM_RANK
            and r["price"] <= CHEAP_PRICE
            and r["loser_fit"]
        ):
            out["late_cheap_premium"] += 1
            if r["loser_max_bid"] is not None and r["loser_max_bid"] <= r["price"]:
                out["late_lockout_premium"] += 1
    for seat in (0, 1):
        first_two = buys[seat][:2]
        if len(first_two) == 2 and first_two[1]["lot_index"] < EARLY_LOTS:
            spent = sum(r["price"] for r in first_two)
            out["first_two_spend"][seat] = spent
            margin = scores[seat] - scores[1 - seat]
            if spent >= STARTING_BUDGET * EARLY_SHARE:
                out["frontload"][seat] = True
                if margin >= DECIDED_MARGIN:
                    out["early_blowout"][seat] = True
            if spent >= STARTING_BUDGET * HEAVY_SHARE:
                out["heavy_frontload"][seat] = True
                if margin >= DECIDED_MARGIN:
                    out["heavy_blowout"][seat] = True
    return out


def wilson(p, n, z=1.96):
    if n == 0:
        return (0.0, 0.0)
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (centre - half, centre + half)


def pct(xs, q):
    xs = sorted(xs)
    if not xs:
        return float("nan")
    k = (len(xs) - 1) * q
    f = math.floor(k)
    c = min(f + 1, len(xs) - 1)
    return xs[f] + (xs[c] - xs[f]) * (k - f)


_POLICY = None
_OPP = None


def _one(seed):
    pool = get_pool()
    bot_seat = seed % 2
    bot = bot_player(_POLICY)
    other = bot_player(_POLICY) if _OPP is None else OPPONENTS[_OPP]
    players = {bot_seat: bot, 1 - bot_seat: other}
    state, records = run_match(seed, pool, players)
    return analyse(seed, state, records, pool, bot_seat)


def sweep(name, seeds, pool, policy, opponent_name=None, verbose=False, workers=8):
    global _POLICY, _OPP
    _POLICY, _OPP = policy, opponent_name
    import multiprocessing as mp
    ctx = mp.get_context("fork")
    with ctx.Pool(workers) as p:
        results = p.map(_one, list(seeds), chunksize=25)
    return summarise(name, results, verbose=verbose)


def summarise(name, results, verbose=False):
    n = len(results)
    wins = sum(r["win"] for r in results) / n
    lo, hi = wilson(wins, n)
    bot_totals = [r["bot_total"] for r in results]
    opp_totals = [r["opp_total"] for r in results]
    bot_spend = [r["bot_spend"] for r in results]
    opp_spend = [r["opp_spend"] for r in results]
    margins = [r["margin"] for r in results]
    frontload_bot = sum(1 for r in results if r["frontload"][r["seed"] % 2]) / n
    frontload_any = sum(1 for r in results if any(r["frontload"].values())) / n
    blow_bot = sum(1 for r in results if r["early_blowout"][r["seed"] % 2]) / n
    blow_any = sum(1 for r in results if any(r["early_blowout"].values())) / n
    hfront_bot = sum(1 for r in results if r["heavy_frontload"][r["seed"] % 2]) / n
    hfront_any = sum(1 for r in results if any(r["heavy_frontload"].values())) / n
    hblow_bot = sum(1 for r in results if r["heavy_blowout"][r["seed"] % 2]) / n
    hblow_any = sum(1 for r in results if any(r["heavy_blowout"].values())) / n
    late_cheap = sum(r["late_cheap_premium"] for r in results)
    late_lock = sum(r["late_lockout_premium"] for r in results)
    late_cheap_m = sum(1 for r in results if r["late_cheap_premium"]) / n
    late_lock_m = sum(1 for r in results if r["late_lockout_premium"]) / n
    # Overpay: price minus the sweep median price for the band, bot's buys.
    by_band = defaultdict(list)
    for r in results:
        for band, price, is_bot, rank in r["prices"]:
            by_band[band].append(price)
    med = {b: statistics.median(v) for b, v in by_band.items()}
    overpays = []
    for r in results:
        for band, price, is_bot, rank in r["prices"]:
            if is_bot:
                overpays.append((price - med[band], price, band, r["seed"], rank))
    max_over = max(overpays) if overpays else (0, 0, "", 0, 0)
    bot_prices = defaultdict(list)
    for r in results:
        for band, price, is_bot, rank in r["prices"]:
            if is_bot:
                bot_prices[band].append(price)
    lines = []
    lines.append(f"### {name} (n={n})")
    lines.append("")
    lines.append("| metric | value |")
    lines.append("|---|---|")
    lines.append(f"| bot win rate | {wins:.1%} (95% CI {lo:.1%}-{hi:.1%}) |")
    lines.append(f"| bot roster total p10/p50/p90 | {pct(bot_totals,.1):.1f} / {pct(bot_totals,.5):.1f} / {pct(bot_totals,.9):.1f} |")
    lines.append(f"| opp roster total p10/p50/p90 | {pct(opp_totals,.1):.1f} / {pct(opp_totals,.5):.1f} / {pct(opp_totals,.9):.1f} |")
    lines.append(f"| margin (bot-opp) p10/p50/p90 | {pct(margins,.1):.1f} / {pct(margins,.5):.1f} / {pct(margins,.9):.1f} |")
    lines.append(f"| bot spend p10/p50/p90 (mean) | {pct(bot_spend,.1):.0f} / {pct(bot_spend,.5):.0f} / {pct(bot_spend,.9):.0f} (${statistics.fmean(bot_spend):.2f}) |")
    lines.append(f"| opp spend p10/p50/p90 (mean) | {pct(opp_spend,.1):.0f} / {pct(opp_spend,.5):.0f} / {pct(opp_spend,.9):.0f} (${statistics.fmean(opp_spend):.2f}) |")
    lines.append(f"| front-load (bot / any seat) | {frontload_bot:.1%} / {frontload_any:.1%} |")
    lines.append(f"| early blowout (bot / any seat) | {blow_bot:.1%} / {blow_any:.1%} |")
    lines.append(f"| heavy front-load >=$12 (bot / any seat) | {hfront_bot:.1%} / {hfront_any:.1%} |")
    lines.append(f"| heavy early blowout >=$12 (bot / any seat) | {hblow_bot:.1%} / {hblow_any:.1%} |")
    lines.append(f"| late cheap premium: lots (matches) | {late_cheap} ({late_cheap_m:.1%}) |")
    lines.append(f"| late locked-out premium: lots (matches) | {late_lock} ({late_lock_m:.1%}) |")
    lines.append(f"| max single bot overpay vs band median | +${max_over[0]:.0f} (${max_over[1]} for band {max_over[2]}, rank {max_over[4]}, seed {max_over[3]}) |")
    lines.append(f"| bot mean price by band | " + ", ".join(f"{b}: ${statistics.fmean(bot_prices[b]):.2f} (max ${max(bot_prices[b])})" for b in BAND_ORDER if b in bot_prices) + " |")
    lines.append(f"| mean auctioned lots | {statistics.fmean(r['lots'] for r in results):.1f} |")
    text = "\n".join(lines)
    print(text)
    print()
    if verbose:
        seeds = [r["seed"] for r in results if any(r["early_blowout"].values())][:10]
        print("early-blowout seeds:", seeds)
    return {"text": text, "results": results, "win": wins, "ci": (lo, hi),
            "blow_any": blow_any, "blow_bot": blow_bot, "hblow_bot": hblow_bot, "hblow_any": hblow_any,
            "frontload_any": frontload_any, "late_cheap": late_cheap_m, "spend": statistics.fmean(bot_spend)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", type=int, default=2000)
    ap.add_argument("--opp", default="all")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--label", default="")
    ap.add_argument("--v4", action="store_true", help="use the frozen v4 copy in the scratchpad")
    args = ap.parse_args()
    pool = get_pool()
    if args.v4:
        import importlib.util
        spec = importlib.util.spec_from_file_location("bot_v4", __file__.replace("botsim.py", "bot_v4.py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        policy = mod.TwentyDollarBot()
    else:
        policy = TwentyDollarBot()
    seeds = range(args.seeds)
    which = ["proxy", "max", "min", "self"] if args.opp == "all" else args.opp.split(",")
    label = args.label or policy.policy_version
    for w in which:
        if w == "self":
            sweep(f"{label} self-play", seeds, pool, policy, None, verbose=args.verbose)
        else:
            sweep(f"{label} vs {w}", seeds, pool, policy, w, verbose=args.verbose)


if __name__ == "__main__":
    main()
