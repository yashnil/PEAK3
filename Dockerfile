# PEAK3 Arena API — built from the REPOSITORY ROOT, not from apps/api.
#
# WHY THE ROOT IS THE BUILD CONTEXT. The FastAPI app is not self-contained. At
# import and at request time it reaches outside apps/api for three things:
#
#   * `nba_peak/` — app/main.py puts the repo root on sys.path and the API
#     imports the model package directly (daily keys, board generation, the
#     Daily Grid optimal solve, exact player-season resolution).
#   * committed data — `data/game/**` (served peak/season boards, card profiles)
#     and `data/generated/**`, both read through paths resolved relative to the
#     repo root.
#   * `leaderboards/*.csv` — the canonical input the web dataset is exported
#     from during this build.
#
# The previous apps/api/Dockerfile copied only apps/api. It produced an image
# that installed, started, and then failed on the first import of `nba_peak`,
# because `Path(__file__).parents[4]` inside the container pointed at `/`. It
# has been removed rather than fixed: a Dockerfile living in apps/api implies
# an apps/api build context, which is exactly the wrong instruction.
FROM python:3.12-slim

# curl is used by the container-level HEALTHCHECK below. Railway performs its
# own healthcheck over HTTP (railway.toml -> healthcheckPath), so this is for
# local `docker run` validation and for any other runtime that honours it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, so the layer cache survives every source edit.
#
# apps/api/requirements.txt ALONE is the runtime set: it already carries pandas,
# pyarrow and scipy for the request-time paths that need them. The root
# requirements.txt is deliberately NOT installed — it exists for the offline
# model/scraper pipeline (requests, beautifulsoup4, lxml, html5lib, pytest) and
# none of that runs in a serving container.
#
# unidecode is the one root dependency the BUILD step needs: the exporter
# ASCII-folds player names into slugs. It is named explicitly here so the reason
# it is present is recorded next to the reason it is needed.
COPY apps/api/requirements.txt ./apps/api/requirements.txt
RUN pip install --no-cache-dir -r apps/api/requirements.txt "unidecode>=1.3"

# Only what the API actually reads. Copying the whole repo would drag in
# apps/web (node_modules, .next), the test suites and the scrape caches.
COPY nba_peak/ ./nba_peak/
COPY peak3.py ./peak3.py
COPY scripts/ ./scripts/
COPY leaderboards/ ./leaderboards/
COPY data/game/ ./data/game/
COPY data/generated/ ./data/generated/
# Small (~6.5MB tracked) and load-bearing for CourtBuilder's exact
# player-season resolution. Absent, nba_peak/perfect_season/career_positions.py
# degrades silently rather than erroring, so leaving them out would cost
# position fidelity with nothing in the logs to say so.
COPY cache/processed/ ./cache/processed/
COPY apps/api/ ./apps/api/

# THE GENERATED-DATA BUILD STEP.
#
# `data/web/` is gitignored (CLAUDE.md, "Data export rules"), so a clean
# checkout has none of it and the API would start, log one warning, and serve
# 503 from /health/readiness forever. The exporter reads only the committed
# leaderboard CSVs — no network — and takes about a second.
#
# It runs at BUILD time, not at boot: a container that has to rebuild its
# dataset before it can answer is a slower cold start and a boot that can fail
# for a reason unrelated to the request that triggered it.
RUN python scripts/build_web_dataset.py \
 && test -s data/web/peak_windows.json \
 && test -s data/web/leaderboards.json

# Railway injects PORT. The default matches local development so `docker run`
# without -e PORT behaves like `make api`.
ENV PORT=8000 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1

WORKDIR /app/apps/api

# `sh -c` because $PORT must be expanded at runtime, not baked at build time.
# --host 0.0.0.0 is required: bound to localhost the container is unreachable
# from Railway's proxy and every request times out with a healthy-looking log.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
