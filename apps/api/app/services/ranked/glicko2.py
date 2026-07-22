"""Glicko-2 rating system — Mark Glickman's published algorithm, implemented
step-for-step from "Example of the Glicko-2 system"
(http://www.glicko.net/glicko/glicko2.pdf).

This is not an approximation and not a custom Elo-style update (ADR-004 §6).
Every step below is labelled with the paper's step number so the mapping from
spec to code is auditable line by line.

Rating-period strategy (ADR-004 §7, GLICKO2_RATING_PERIOD_STRATEGY =
"one_match_per_period"): PEAK3 closed alpha settles one opponent per call to
``rate_match``. The general multi-opponent Step 3/4 summations degrade
gracefully to a single term in that case; ``rate_period`` (which accepts a
list of opponents) is kept as the general-form entry point so the reference
test can reproduce Glickman's own three-opponent worked example verbatim.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from app.services.ranked.versions import (
    GLICKO2_ALGORITHM_VERSION,
    GLICKO2_EPSILON,
    GLICKO2_INITIAL_RATING,
    GLICKO2_INITIAL_RD,
    GLICKO2_INITIAL_VOLATILITY,
    GLICKO2_MAX_VOLATILITY_ITERATIONS,
    GLICKO2_TAU,
)

# Glicko-1 <-> Glicko-2 scale conversion constant from the paper.
_GLICKO2_SCALE = 173.7178

# Decimal precision used when persisting/comparing rating outputs, chosen to
# match the NUMERIC(8,4) / NUMERIC(10,8) column precision in
# infra/migrations/014_ranked_rating.sql. Rounding here — once, at the
# boundary — is what makes "identical input produces identical stored
# output" true across repeated runs and across replay (spec V.4), rather than
# leaving raw float64 bit patterns as the thing callers compare.
RATING_DECIMALS = 4
RD_DECIMALS = 4
VOLATILITY_DECIMALS = 8


class Glicko2ConvergenceError(RuntimeError):
    """Raised when the volatility root-find does not converge within the
    configured iteration bound. Never silently return an unconverged value.
    """


@dataclass(frozen=True)
class Glicko2Rating:
    """A player's rating state in one queue, on the Glicko-1 display scale."""

    rating: float
    rd: float
    volatility: float

    def __post_init__(self) -> None:
        if self.rd <= 0:
            raise ValueError(f"rd must be positive, got {self.rd}")
        if self.volatility <= 0:
            raise ValueError(f"volatility must be positive, got {self.volatility}")


@dataclass(frozen=True)
class Glicko2Opponent:
    """One opponent faced during the rating period, with the match outcome
    from this player's perspective: 1.0 = win, 0.5 = draw, 0.0 = loss.
    """

    rating: float
    rd: float
    score: float

    def __post_init__(self) -> None:
        if self.score not in (0.0, 0.5, 1.0):
            raise ValueError(f"score must be 0.0, 0.5, or 1.0, got {self.score}")


def initial_rating() -> Glicko2Rating:
    return Glicko2Rating(
        rating=GLICKO2_INITIAL_RATING,
        rd=GLICKO2_INITIAL_RD,
        volatility=GLICKO2_INITIAL_VOLATILITY,
    )


def _g(phi: float) -> float:
    """Step 3 helper: g(phi)."""
    return 1.0 / math.sqrt(1.0 + 3.0 * phi**2 / math.pi**2)


def _e(mu: float, mu_j: float, phi_j: float) -> float:
    """Step 3 helper: E(mu, mu_j, phi_j)."""
    return 1.0 / (1.0 + math.exp(-_g(phi_j) * (mu - mu_j)))


def _solve_volatility(
    phi: float,
    v: float,
    delta: float,
    sigma: float,
    tau: float,
    epsilon: float,
    max_iterations: int,
) -> float:
    """Step 5: Illinois-algorithm root-find for the new volatility, on the
    ln(sigma^2) scale, exactly per the paper's procedure.
    """
    a = math.log(sigma**2)

    def f(x: float) -> float:
        ex = math.exp(x)
        numerator = ex * (delta**2 - phi**2 - v - ex)
        denominator = 2.0 * (phi**2 + v + ex) ** 2
        return numerator / denominator - (x - a) / tau**2

    A = a
    if delta**2 > phi**2 + v:
        B = math.log(delta**2 - phi**2 - v)
    else:
        k = 1
        while f(a - k * tau) < 0:
            k += 1
            if k > max_iterations:
                raise Glicko2ConvergenceError(
                    "Glicko-2 volatility solve: could not bracket a root within "
                    f"{max_iterations} iterations (initial bracket search)."
                )
        B = a - k * tau

    fA = f(A)
    fB = f(B)

    iterations = 0
    while abs(B - A) > epsilon:
        iterations += 1
        if iterations > max_iterations:
            raise Glicko2ConvergenceError(
                "Glicko-2 volatility solve did not converge within "
                f"{max_iterations} iterations (|B-A|={abs(B - A)!r} > epsilon={epsilon!r})."
            )
        C = A + (A - B) * fA / (fB - fA)
        fC = f(C)
        if fC * fB <= 0:
            A, fA = B, fB
        else:
            fA = fA / 2.0
        B, fB = C, fC

    return math.exp(A / 2.0)


def rate_period(
    player: Glicko2Rating,
    opponents: list[Glicko2Opponent],
    *,
    tau: float = GLICKO2_TAU,
    epsilon: float = GLICKO2_EPSILON,
    max_iterations: int = GLICKO2_MAX_VOLATILITY_ITERATIONS,
) -> Glicko2Rating:
    """General-form Glicko-2 update for a rating period against one or more
    opponents (Steps 1-8 of the paper). Deterministic: identical inputs
    always produce identical (rounded) output — no randomness, no
    unordered-collection iteration.

    If ``opponents`` is empty, this is the "player did not compete" case
    (Step 7 special case in the paper's remarks): rating and volatility are
    unchanged, and RD widens via ``phi* = sqrt(phi^2 + sigma^2)`` only.
    """
    mu = (player.rating - 1500.0) / _GLICKO2_SCALE
    phi = player.rd / _GLICKO2_SCALE

    if not opponents:
        phi_star = math.sqrt(phi**2 + player.volatility**2)
        new_rd = phi_star * _GLICKO2_SCALE
        return Glicko2Rating(
            rating=round(player.rating, RATING_DECIMALS),
            rd=round(new_rd, RD_DECIMALS),
            volatility=round(player.volatility, VOLATILITY_DECIMALS),
        )

    # Step 3: estimated variance v
    g_values = []
    e_values = []
    for opp in opponents:
        mu_j = (opp.rating - 1500.0) / _GLICKO2_SCALE
        phi_j = opp.rd / _GLICKO2_SCALE
        g_j = _g(phi_j)
        e_j = _e(mu, mu_j, phi_j)
        g_values.append(g_j)
        e_values.append(e_j)

    v_inv = sum(g**2 * e * (1.0 - e) for g, e in zip(g_values, e_values))
    v = 1.0 / v_inv

    # Step 4: delta
    delta = v * sum(
        g * (opp.score - e) for g, e, opp in zip(g_values, e_values, opponents)
    )

    # Step 5: new volatility
    new_volatility = _solve_volatility(
        phi=phi, v=v, delta=delta, sigma=player.volatility,
        tau=tau, epsilon=epsilon, max_iterations=max_iterations,
    )

    # Step 6: interim RD
    phi_star = math.sqrt(phi**2 + new_volatility**2)

    # Step 7: new RD and rating
    new_phi = 1.0 / math.sqrt(1.0 / phi_star**2 + 1.0 / v)
    new_mu = mu + new_phi**2 * sum(
        g * (opp.score - e) for g, e, opp in zip(g_values, e_values, opponents)
    )

    # Step 8: convert back to the Glicko-1 display scale
    new_rating = _GLICKO2_SCALE * new_mu + 1500.0
    new_rd = _GLICKO2_SCALE * new_phi

    return Glicko2Rating(
        rating=round(new_rating, RATING_DECIMALS),
        rd=round(new_rd, RD_DECIMALS),
        volatility=round(new_volatility, VOLATILITY_DECIMALS),
    )


def rate_match(
    player: Glicko2Rating,
    opponent_rating: float,
    opponent_rd: float,
    score: float,
    *,
    tau: float = GLICKO2_TAU,
    epsilon: float = GLICKO2_EPSILON,
    max_iterations: int = GLICKO2_MAX_VOLATILITY_ITERATIONS,
) -> Glicko2Rating:
    """One-match-per-rating-period entry point (ADR-004 §7) — the shape every
    ranked settlement in this phase actually calls. Thin wrapper over
    ``rate_period`` with a single opponent.
    """
    return rate_period(
        player,
        [Glicko2Opponent(rating=opponent_rating, rd=opponent_rd, score=score)],
        tau=tau,
        epsilon=epsilon,
        max_iterations=max_iterations,
    )


def apply_inactivity_rd_growth(
    player: Glicko2Rating,
    elapsed_days: float,
    *,
    c: float,
    rd_max: float,
) -> Glicko2Rating:
    """Widen RD (never rating or volatility) for elapsed inactivity, per
    ADR-004 §11: RD' = min(sqrt(RD^2 + c^2 * t), rd_max).
    """
    if elapsed_days <= 0:
        return player
    widened = math.sqrt(player.rd**2 + c**2 * elapsed_days)
    new_rd = min(widened, rd_max)
    return Glicko2Rating(
        rating=player.rating,
        rd=round(new_rd, RD_DECIMALS),
        volatility=player.volatility,
    )


__all__ = [
    "GLICKO2_ALGORITHM_VERSION",
    "Glicko2ConvergenceError",
    "Glicko2Opponent",
    "Glicko2Rating",
    "apply_inactivity_rd_growth",
    "initial_rating",
    "rate_match",
    "rate_period",
]
