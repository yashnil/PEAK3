"""`/api/v1/nba-facts/today`, and the readiness signal that should have caught
its absence in production.

WHAT WENT WRONG IN STAGING. The fact bank is generated data: `data/web/` is
gitignored and excluded from the Docker build context, so everything under it
has to be produced during the image build. The Dockerfile ran the web-dataset
exporter and nothing else, so the deployed image was missing exactly one file.
This route returned 503, the homepage dropped its panel, and
`/health/readiness` reported "ready" the whole time.

These tests cover the runtime half of the fix: the route serves a real fact when
the bank is there, and BOTH the route and the probe report the same thing when
it is not.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from nba_peak import nba_facts


@pytest.fixture(autouse=True)
def _fresh_bank_cache():
    """The bank is process-cached, so a test that points it elsewhere must not
    leak that into the next one."""
    nba_facts.clear_bank_cache()
    yield
    nba_facts.clear_bank_cache()


def _repoint_bank(monkeypatch, path: Path) -> None:
    """Point every reader at `path`, exactly as a different image layout would.

    THREE readers, and every one is patched, because `nba_facts` is a package
    now: the route imports `cached_bank` by name, `bank_status` reads
    `nba_facts.bank.BANK_PATH` from inside the submodule, and the package
    re-exports the same constant. Patching only the package attribute would
    leave `bank_status` reading the real file -- which is precisely the
    disagreement between the route and the readiness probe that this suite
    exists to rule out.
    """
    from app.api.v1 import nba_facts as route
    from nba_peak.nba_facts import bank as bank_module

    monkeypatch.setattr(nba_facts, "BANK_PATH", path)
    monkeypatch.setattr(bank_module, "BANK_PATH", path)
    monkeypatch.setattr(route, "cached_bank", lambda: tuple(nba_facts.load_bank(path)))


# ---------------------------------------------------------------------------
# The healthy path
# ---------------------------------------------------------------------------


def test_the_route_serves_a_sourced_fact_with_metadata(client):
    response = client.get("/api/v1/nba-facts/today")
    if response.status_code == 503:
        pytest.skip("data/web/ has not been built in this checkout")

    assert response.status_code == 200
    body = response.json()

    assert body["fact_id"]
    assert body["headline"].strip()
    # `text` is retained so a client built against v1 keeps rendering.
    assert body["text"].strip()
    assert body["category"]
    assert body["source_label"]
    assert body["bank_version"] == nba_facts.FACT_BANK_VERSION
    assert body["bank_size"] >= nba_facts.MIN_FACTS
    assert body["date"]

    # SOURCING IS THE POINT, and it takes two forms now. A DERIVED fact carries
    # the rows it was computed from; a CURATED one carries the record a person
    # checked it against. What no published fact may be is neither.
    assert body["provenance"] in ("derived", "editorial")
    assert body["source_detail"].strip(), "the fact names no source"
    assert body["verified"] is True
    if body["provenance"] == "derived":
        assert body["evidence"], "a generated fact carries no supporting rows"
        for row in body["evidence"]:
            assert row["player"] and row["season"] and row["team"]


def test_the_route_uses_the_applications_own_day_boundary(client, monkeypatch):
    """PACIFIC, NOT UTC. This route used to default to the server's UTC date, so
    the homepage fact rolled over at 4pm or 5pm local while every other daily
    surface in the product rolled over at midnight America/Los_Angeles. One
    product, two different days."""
    from app.api.v1 import nba_facts as route
    from nba_peak.daily_key import daily_key

    if client.get("/api/v1/nba-facts/today").status_code == 503:
        pytest.skip("data/web/ has not been built in this checkout")

    today = client.get("/api/v1/nba-facts/today").json()
    assert today["date"] == daily_key()
    # And the module actually reads that helper, rather than happening to agree
    # with it on the day the test ran.
    assert route.daily_key is daily_key


def test_selection_is_deterministic_by_date(client):
    if client.get("/api/v1/nba-facts/today").status_code == 503:
        pytest.skip("data/web/ has not been built in this checkout")

    first = client.get("/api/v1/nba-facts/today?on=2026-08-05").json()
    again = client.get("/api/v1/nba-facts/today?on=2026-08-05").json()
    next_day = client.get("/api/v1/nba-facts/today?on=2026-08-06").json()

    assert first["fact_id"] == again["fact_id"]
    assert first["fact_id"] != next_day["fact_id"]


def test_readiness_reports_the_bank_when_it_is_present(client):
    body = client.get("/health/readiness").json()
    assert "fact_bank" in body, "readiness says nothing about the fact bank"
    bank = body["fact_bank"]
    assert bank["bank_version"] == nba_facts.FACT_BANK_VERSION
    # The resolved path is reported, so "where did it look?" is answerable.
    assert bank["path"].endswith("data/web/nba_facts.v1.json")
    if bank["loaded"]:
        assert bank["fact_count"] >= nba_facts.MIN_FACTS


# ---------------------------------------------------------------------------
# The failure path — visible, not silent
# ---------------------------------------------------------------------------


def test_a_missing_bank_makes_readiness_fail_rather_than_report_ready(
    client, monkeypatch, tmp_path
):
    """THE REGRESSION TEST FOR THE STAGING INCIDENT.

    Before this fix, readiness returned 200 "ready" while this exact route
    returned 503. A probe that can report ready while a served endpoint cannot
    answer is not reporting readiness, and it is why nobody noticed for a
    deploy.
    """
    _repoint_bank(monkeypatch, tmp_path / "absent.json")

    facts = client.get("/api/v1/nba-facts/today")
    assert facts.status_code == 503

    readiness = client.get("/health/readiness")
    assert readiness.status_code == 503, (
        "readiness reported healthy while /api/v1/nba-facts/today served 503"
    )
    body = readiness.json()
    assert body["status"] == "unavailable"
    assert body["fact_bank"]["loaded"] is False
    assert body["fact_bank"]["exists"] is False


def test_a_corrupt_bank_is_reported_and_never_a_500(client, monkeypatch, tmp_path):
    corrupt = tmp_path / "nba_facts.v1.json"
    corrupt.write_text("{ not json at all")
    _repoint_bank(monkeypatch, corrupt)

    assert client.get("/api/v1/nba-facts/today").status_code == 503
    assert client.get("/health/readiness").status_code == 503


def test_the_route_never_fabricates_a_fact_when_the_bank_is_empty(
    client, monkeypatch, tmp_path
):
    """An empty bank must 503, never return a placeholder. Fabricated trivia on
    a homepage is worse than an absent panel."""
    empty = tmp_path / "nba_facts.v1.json"
    empty.write_text(json.dumps({"version": "x", "count": 0, "facts": []}))
    _repoint_bank(monkeypatch, empty)

    response = client.get("/api/v1/nba-facts/today")
    assert response.status_code == 503
    assert "build_nba_facts" in response.json()["detail"]


def test_a_bad_date_is_a_400_not_a_500(client):
    assert client.get("/api/v1/nba-facts/today?on=not-a-date").status_code == 400
