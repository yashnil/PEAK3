"""Read-only calibration diagnostics for the served PEAK3 boards (Phase 12B).

WHAT THIS IS FOR. Manual review of the top-50 Peak Windows produced a list of
"this looks wrong" reactions. Answering those needs the served rows and their
inputs side by side -- component contributions, the playoff sample that
produced PO, the advancement flags that produced TEAM, the awards that produced
REC -- which no existing surface assembles in one place.

STRICTLY READ-ONLY AND DETERMINISTIC. Nothing here scores, re-scores, mutates
an artifact or reads the network. It loads the two committed served artifacts,
joins each row to its explain block, and answers questions. Given the same
artifacts it produces byte-identical output, which is what makes the numbers in
docs/model/PEAK3_SCORING_CALIBRATION_DIAGNOSIS.md checkable rather than
anecdotal.

WHY THE SERVED ARTIFACTS AND NOT THE PARQUET. The complaint is about what users
see, and what users see is the served board. Diagnosing the parquet instead
would risk "fixing" something that never reaches the UI, or missing a
generator-layer distortion. The scored parquet is still reachable for the
inputs the artifacts do not carry (playoff rate stats), and those reads are
marked where they happen.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable, Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
PEAKS_PATH = (
    REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500" / "top_1000_peaks.v1.json"
)
SEASONS_PATH = (
    REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500" / "top_1000_seasons.v1.json"
)

COMPONENT_KEYS = (
    "statistical_impact",
    "traditional_production",
    "individual_recognition",
    "postseason_individual_value",
    "team_achievement",
)

# Short names used in every table, so a 12-column row still fits on a page.
ABBR = {
    "statistical_impact": "SI",
    "traditional_production": "TP",
    "individual_recognition": "REC",
    "postseason_individual_value": "PO",
    "team_achievement": "TEAM",
}


@dataclass(frozen=True)
class DiagnosticRow:
    """One served board row plus everything needed to explain its components."""

    board: str                      # "1y" | "3y" | "5y" | "seasons"
    rank: int
    row_id: str
    player: str
    label: str                      # window or season label
    anchor_season: str
    team: str
    total: float
    prime_index: Optional[float]
    components: dict[str, float]
    percentiles: dict[str, float]
    season_in_progress: bool
    data_completeness: Optional[str]
    # Inputs, from the row's explain block. Any may be None on a row whose
    # block omits the section -- never defaulted to a number.
    games: Optional[float]
    minutes: Optional[float]
    mpg: Optional[float]
    awards: Optional[str]
    po_games: Optional[float]
    po_minutes: Optional[float]
    po_series: Optional[float]
    made_playoffs: Optional[float]
    championship: Optional[float]
    finals_appearance: Optional[float]
    caveats: tuple[str, ...] = ()

    @property
    def po(self) -> float:
        return self.components.get("postseason_individual_value", 0.0)

    @property
    def team_ach(self) -> float:
        return self.components.get("team_achievement", 0.0)

    @property
    def rec(self) -> float:
        return self.components.get("individual_recognition", 0.0)

    @property
    def si(self) -> float:
        return self.components.get("statistical_impact", 0.0)

    @property
    def tp(self) -> float:
        return self.components.get("traditional_production", 0.0)

    @property
    def po_mpg(self) -> Optional[float]:
        """Playoff minutes per game -- the load question the audit asks about."""
        if not self.po_games or not self.po_minutes:
            return None
        return self.po_minutes / self.po_games


def _num(block: Any, key: str) -> Optional[float]:
    if not isinstance(block, dict):
        return None
    value = block.get(key)
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _text(block: Any, key: str) -> Optional[str]:
    if not isinstance(block, dict):
        return None
    value = block.get(key)
    if isinstance(value, (list, tuple)):
        return ", ".join(str(v) for v in value) or None
    return str(value) if value not in (None, "") else None


@dataclass
class Boards:
    """Every served row, joined to its explain block."""

    rows: list[DiagnosticRow] = field(default_factory=list)

    # -- loading ------------------------------------------------------------
    @classmethod
    def load(
        cls, peaks_path: Path | None = None, seasons_path: Path | None = None
    ) -> "Boards":
        rows: list[DiagnosticRow] = []
        peaks = json.loads((peaks_path or PEAKS_PATH).read_text())
        explain = peaks.get("explain") or {}
        for board, bucket in (peaks.get("windows") or {}).items():
            for row in bucket.get("rows", []):
                rows.append(cls._row(board, row, explain.get(row["row_id"])))

        seasons = json.loads((seasons_path or SEASONS_PATH).read_text())
        season_explain = seasons.get("explain") or {}
        for row in seasons.get("seasons") or seasons.get("rows") or []:
            rows.append(cls._row("seasons", row, season_explain.get(row["row_id"])))
        return cls(rows=rows)

    @staticmethod
    def _row(board: str, row: dict, block: Optional[dict]) -> DiagnosticRow:
        stats = (block or {}).get("season_stats") or {}
        post = (block or {}).get("postseason") or {}
        team_ctx = (block or {}).get("team_context") or {}
        recognition = (block or {}).get("recognition") or {}
        return DiagnosticRow(
            board=board,
            rank=int(row["rank"]),
            row_id=row["row_id"],
            player=row["player_name"],
            label=row.get("label") or row.get("window_label") or row.get("season") or "",
            anchor_season=row.get("anchor_season") or row.get("season") or "",
            team=row.get("team") or "",
            total=float(row["prime_score"]),
            prime_index=_num(row, "prime_index"),
            components={k: float(row["components"].get(k) or 0.0) for k in COMPONENT_KEYS},
            percentiles={
                k: v for k, v in (row.get("percentiles") or {}).items() if v is not None
            },
            season_in_progress=bool(row.get("season_in_progress")),
            data_completeness=row.get("data_completeness"),
            games=_num(stats, "games"),
            minutes=_num(stats, "minutes_total"),
            mpg=_num(stats, "mpg") or _num(row, "mpg"),
            awards=_text(recognition, "awards"),
            po_games=_num(post, "games"),
            po_minutes=_num(post, "minutes"),
            po_series=_num(post, "series_count"),
            made_playoffs=_num(team_ctx, "made_playoffs"),
            championship=_num(team_ctx, "championship"),
            finals_appearance=_num(team_ctx, "finals_appearance"),
            caveats=tuple((block or {}).get("caveats") or ()),
        )

    # -- selection ----------------------------------------------------------
    def board(self, board: str, limit: Optional[int] = None) -> list[DiagnosticRow]:
        rows = sorted((r for r in self.rows if r.board == board), key=lambda r: r.rank)
        return rows[:limit] if limit else rows

    def find(self, player: str, season: str | None = None, board: str = "1y") -> list[DiagnosticRow]:
        """Every row for a player, optionally pinned to one season."""
        out = [r for r in self.rows if r.player == player and r.board == board]
        if season:
            out = [r for r in out if season in (r.label, r.anchor_season)]
        return sorted(out, key=lambda r: r.rank)

    def player_seasons(self, player: str) -> list[DiagnosticRow]:
        """All 1Y rows for one player -- the anchor-selection question."""
        return sorted(self.find(player), key=lambda r: -r.total)

    # -- query helpers the audit asks for -----------------------------------
    def where(
        self, board: str, predicate: Callable[[DiagnosticRow], bool], limit: int = 100
    ) -> list[DiagnosticRow]:
        return [r for r in self.board(board, limit) if predicate(r)]

    def negative_po(self, board: str = "1y", limit: int = 100) -> list[DiagnosticRow]:
        return self.where(board, lambda r: r.po < 0, limit)

    def zero_po(self, board: str = "1y", limit: int = 100) -> list[DiagnosticRow]:
        return self.where(board, lambda r: r.po == 0, limit)

    def no_playoffs(self, board: str = "1y", limit: int = 100) -> list[DiagnosticRow]:
        return self.where(board, lambda r: r.made_playoffs == 0, limit)

    def zero_team(self, board: str = "1y", limit: int = 100) -> list[DiagnosticRow]:
        return self.where(board, lambda r: r.team_ach == 0, limit)

    def top_by(
        self, key: Callable[[DiagnosticRow], float], board: str = "1y", limit: int = 100, n: int = 10
    ) -> list[DiagnosticRow]:
        return sorted(self.board(board, limit), key=lambda r: -key(r))[:n]

    def high_rec_low_po(
        self, board: str = "1y", limit: int = 100, rec_min: float = 14.0, po_max: float = 3.0
    ) -> list[DiagnosticRow]:
        return self.where(board, lambda r: r.rec >= rec_min and r.po <= po_max, limit)

    def high_po_low_load(
        self, board: str = "1y", limit: int = 100, po_min: float = 6.0, mpg_max: float = 36.0
    ) -> list[DiagnosticRow]:
        """High postseason value on comparatively light playoff minutes -- the
        "does PO overreward rate?" question."""
        return self.where(
            board,
            lambda r: r.po >= po_min and (r.po_mpg is not None and r.po_mpg <= mpg_max),
            limit,
        )

    def in_progress(self, limit: int = 1000) -> list[DiagnosticRow]:
        """Rows still labelled in progress. Expected to be EMPTY -- the label is
        derived from resolved playoffs (nba_peak/season_status.py)."""
        return [r for r in self.rows if r.season_in_progress][:limit]

    def score_cliffs(self, board: str = "1y", limit: int = 100, n: int = 10) -> list[tuple]:
        """The largest rank-to-rank score drops -- where the board is least
        stable and a small formula change would reorder the most."""
        rows = self.board(board, limit)
        gaps = [
            (rows[i].total - rows[i + 1].total, rows[i], rows[i + 1])
            for i in range(len(rows) - 1)
        ]
        return sorted(gaps, key=lambda g: -g[0])[:n]

    def iconic_not_anchored(
        self, cases: Iterable[tuple[str, str]]
    ) -> list[tuple[str, str, Optional[DiagnosticRow], Optional[DiagnosticRow]]]:
        """For each (player, expected_season): the row the board actually
        anchored, and the row for the season a fan would expect."""
        out = []
        for player, expected in cases:
            seasons = self.player_seasons(player)
            chosen = seasons[0] if seasons else None
            wanted = next((r for r in seasons if expected in (r.label, r.anchor_season)), None)
            out.append((player, expected, chosen, wanted))
        return out


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------

def markdown_table(rows: Iterable[DiagnosticRow], columns: Iterable[str]) -> str:
    """A GitHub-flavoured table of the requested columns."""
    columns = list(columns)
    header = "| " + " | ".join(columns) + " |"
    divider = "|" + "|".join("---" for _ in columns) + "|"
    lines = [header, divider]
    for row in rows:
        lines.append("| " + " | ".join(_cell(row, c) for c in columns) + " |")
    return "\n".join(lines)


def _cell(row: DiagnosticRow, column: str) -> str:
    mapping = {
        "rank": lambda: str(row.rank),
        "player": lambda: row.player,
        "season": lambda: row.label,
        "team": lambda: row.team,
        "total": lambda: f"{row.total:.2f}",
        "SI": lambda: f"{row.si:.2f}",
        "TP": lambda: f"{row.tp:.2f}",
        "REC": lambda: f"{row.rec:.2f}",
        "PO": lambda: f"{row.po:.2f}",
        "TEAM": lambda: f"{row.team_ach:.2f}",
        "g": lambda: _opt(row.games, 0),
        "mpg": lambda: _opt(row.mpg, 1),
        "po_g": lambda: _opt(row.po_games, 0),
        "po_mpg": lambda: _opt(row.po_mpg, 1),
        "po_series": lambda: _opt(row.po_series, 0),
        "awards": lambda: row.awards or "—",
        "round": lambda: _round_label(row),
    }
    fn = mapping.get(column)
    return fn() if fn else ""


def _opt(value: Optional[float], digits: int) -> str:
    return "—" if value is None else f"{value:.{digits}f}"


def _round_label(row: DiagnosticRow) -> str:
    if row.championship == 1:
        return "Champion"
    if row.finals_appearance == 1:
        return "Finals"
    if row.made_playoffs == 1:
        return "Playoffs"
    if row.made_playoffs == 0:
        return "Missed"
    return "—"
