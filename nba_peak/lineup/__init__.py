"""PEAK3 Experimental Lineup Model — v0.

This package is explicitly experimental. It produces a hypothetical lineup rating
from five selected peak windows. It is NOT part of the canonical individual PEAK3
scoring model and makes no claim about predicted win totals or objective basketball truth.

The canonical individual scoring model lives in peak3.py and is never touched here.
"""
from nba_peak.lineup.schemas import CardProfile, LineupEvaluation, Board, RoundOffers
from nba_peak.lineup.scoring import evaluate_lineup
from nba_peak.lineup.board import generate_board, BoardConfig

__all__ = [
    "CardProfile",
    "LineupEvaluation",
    "Board",
    "RoundOffers",
    "evaluate_lineup",
    "generate_board",
    "BoardConfig",
]
