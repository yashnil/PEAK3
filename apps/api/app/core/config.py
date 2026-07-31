import warnings
from pathlib import Path
from typing import Literal, Optional

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PEAK3_", env_file=".env", extra="ignore")

    SIGNING_SECRET: str = "INSECURE_DEV_SECRET_CHANGE_IN_PRODUCTION"
    DEBUG: bool = True
    CORS_ORIGINS: list[str] = ["http://localhost:3000"]
    SESSION_TTL_SECONDS: int = 86400
    # Absolute path resolved relative to this file: apps/api/app/core/config.py → repo root / data / web
    DATA_DIR: Path = Path(__file__).resolve().parent.parent.parent.parent.parent / "data" / "web"
    DAILY_DUEL_COUNT: int = 10
    ENDLESS_MAX_COUNT: int = 50

    # ---------------------------------------------------------------------------
    # Phase 3.0 — durable persistence + auth
    # ---------------------------------------------------------------------------

    # PostgreSQL connection string, e.g. postgresql://user:pass@host/db
    # Required in production (DEBUG=False).  In DEBUG mode, omitting this falls
    # back to in-memory repositories with a startup warning.
    DATABASE_URL: Optional[str] = None

    # Supabase project JWT secret — used to verify access tokens issued by
    # Supabase Auth.  Required for /api/v1/auth/me and protected endpoints.
    SUPABASE_JWT_SECRET: Optional[str] = None

    # Supabase anon key — sent to the frontend for the Supabase JS client.
    SUPABASE_ANON_KEY: Optional[str] = None

    # Supabase project URL — sent to the frontend for the Supabase JS client.
    SUPABASE_URL: Optional[str] = None

    # ---------------------------------------------------------------------------
    # Phase 4.0 — Ranked duels feature flags
    #
    # These are independent capability switches, not one ambiguous boolean.
    # RANKED_READINESS_LEVEL is the human-facing summary of the combination below;
    # the individual booleans are what code actually branches on.
    # ---------------------------------------------------------------------------

    # Master switch: ranked routes/UI exist at all (still gated further by the
    # switches below and by RANKED_ALPHA_ALLOWLIST).
    RANKED_ENABLED: bool = False

    # Whether the matchmaker will pair waiting queue entries into matches.
    # Can be off even when RANKED_ENABLED=True (e.g. simulation-only readiness).
    RANKED_MATCHMAKING_ENABLED: bool = False

    # Whether settlement is allowed to write rating ledger entries / update
    # queue_ratings. Kept independently switchable so a dry-run settlement path
    # (compute but do not persist) is possible during validation.
    RANKED_RATING_WRITES_ENABLED: bool = False

    # Whether the public (feature-gated) leaderboard endpoints return data.
    RANKED_PUBLIC_LEADERBOARD_ENABLED: bool = False

    # Closed-alpha allowlist of Supabase auth_sub values permitted to see/use
    # ranked routes when RANKED_ENABLED=True but the release is not yet public.
    # Empty list + RANKED_ENABLED=True means "internal engineering only."
    RANKED_ALPHA_ALLOWLIST: list[str] = []

    # Human-facing readiness classification. Does not itself gate behavior —
    # the booleans above do — but is surfaced on /api/v1/ranked/readiness and
    # must be kept consistent with them (validated below).
    RANKED_READINESS_LEVEL: Literal[
        "disabled", "simulation_only", "internal_alpha", "closed_alpha", "public_beta"
    ] = "disabled"

    @model_validator(mode="after")
    def validate_ranked_readiness(self) -> "Settings":
        level = self.RANKED_READINESS_LEVEL
        if level == "disabled" and (
            self.RANKED_ENABLED or self.RANKED_MATCHMAKING_ENABLED or self.RANKED_RATING_WRITES_ENABLED
        ):
            raise ValueError(
                "PEAK3_RANKED_READINESS_LEVEL is 'disabled' but a ranked capability "
                "flag is enabled. Set an appropriate readiness level or disable the flag."
            )
        if level == "public_beta" and not self.RANKED_PUBLIC_LEADERBOARD_ENABLED:
            # Public beta without a public leaderboard is a valid (conservative)
            # configuration, so this is intentionally not an error — just documented
            # here as a case operators should double-check.
            pass
        return self

    # ---------------------------------------------------------------------------
    # Phase 5C — CourtBuilder / 82-0 Peak Season feature flags
    #
    # Mirrors the RANKED_* pattern above exactly: independent capability
    # switches, plus a human-facing readiness level validated for internal
    # consistency. See docs/architecture/ADR-005-arena-pivot-and-courtbuilder.md
    # and docs/implementation/PHASE_5_COURTBUILDER_VERTICAL_SLICE.md §1.
    # ---------------------------------------------------------------------------

    # Master switch: CourtBuilder routes/API exist at all.
    COURTBUILDER_ENABLED: bool = False

    # Whether team+decade/exact-team-season spins are offered, vs. a simpler
    # duration-only spin fallback. Separately switchable because the interim
    # team dataset (data/game/interim/courtbuilder_team_seasons.v0.json) is
    # intentionally narrow — this flag lets the rest of the loop ship even if
    # team spins need to be turned off independently.
    COURTBUILDER_TEAM_SPIN_ENABLED: bool = False

    # Closed-cohort allowlist of owner_sub values (real auth sub or signed
    # anon-cookie subject) permitted to see CourtBuilder while
    # COURTBUILDER_ENABLED=True but not yet publicly linked from nav. Empty +
    # enabled = internal engineering only, same semantics as RANKED_ALPHA_ALLOWLIST.
    # Unlike ranked, CourtBuilder is anonymous-friendly by design (ADR-005
    # Decision 1), so this allowlist matches against owner_sub (which may be
    # an anon subject), never requires a signed-in account.
    COURTBUILDER_ALPHA_ALLOWLIST: list[str] = []

    # Phase 6A: team+YEAR (exact season, e.g. "2015-16") spins -- the real
    # flagship engine (nba_peak.perfect_season.board.generate_team_year_board),
    # reading data/game/experimental/player_pool_1500/courtbuilder_team_year.
    # experimental.v0.json. Independent of COURTBUILDER_TEAM_SPIN_ENABLED.
    #
    # Phase 8F: flipped default False -> True. This flag's own comment used
    # to say "deliberately never used for the official/global CourtBuilder
    # mode while coverage is this narrow (currently 3 exact Golden State
    # Warriors seasons only)" -- that was true when the flag was introduced,
    # but the dataset has since grown to 1,314 rollable team-seasons and
    # nobody flipped the default to match. Root cause of a real regression
    # report: a normal local run with only COURTBUILDER_ENABLED/
    # COURTBUILDER_TEAM_SPIN_ENABLED set (the flags this project's own docs
    # told developers to use) silently fell back to the old, tiny interim
    # team_decade/exact_team_season engine (~19 entries, era-level "1980s"
    # spins, a handful of curated legends per entry) while the UI still
    # said "Experimental exact-season mode" -- misleading, and nowhere near
    # flagship quality. The broad engine is now the default; the interim
    # engine remains reachable (COURTBUILDER_TEAM_SPIN_ENABLED alone, with
    # this flag explicitly set false) as a clearly-secondary fallback, not
    # the flagship path. See docs/architecture/PHASE_5X_PLAYER_EXPANSION_STRATEGY.md.
    COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED: bool = True

    # Phase 6F Part C: render real player/team image URLs (ESPN CDN, sourced
    # from data/game/assets/{player,team}_assets.v2.json -- see
    # scripts/build_espn_asset_manifests.py) instead of always falling back
    # to initials/abbreviation badges. Default OFF: no image binaries are
    # ever downloaded or committed by this repo, and no human has reviewed/
    # approved ESPN's terms of use for hotlinking in a shipped product yet
    # (every resolved asset entry's license_status is "unknown_do_not_cache"
    # until that review happens) -- so the safe default is to never render
    # an external image unless a developer explicitly opts in locally.
    ENABLE_EXTERNAL_ASSET_URLS: bool = False

    # Phase 6F Part G: gates the dev-only manual-lineup-simulation endpoint
    # (POST /api/v1/perfect-season/dev/simulate-lineup). Independent of
    # COURTBUILDER_READINESS_LEVEL so it can be enabled without changing the
    # public readiness classification, but internal_dev also enables it (see
    # the route's own check).
    DEV_TOOLS_ENABLED: bool = False

    # Phase 6G Part E: authenticated global leaderboard for PEAK Season.
    # Default OFF -- submitting/reading requires this AND COURTBUILDER_ENABLED.
    # Reading is public once enabled; submitting always requires a real
    # authenticated user (never anonymous, unlike CourtBuilder play itself).
    COURTBUILDER_LEADERBOARD_ENABLED: bool = False

    # Human-facing readiness classification. Does not itself gate behavior —
    # the booleans above do — but is surfaced on /api/v1/perfect-season/readiness
    # and must be kept consistent with them (validated below).
    COURTBUILDER_READINESS_LEVEL: Literal[
        "disabled", "internal_dev", "internal_alpha", "public_beta"
    ] = "disabled"

    @model_validator(mode="after")
    def validate_courtbuilder_readiness(self) -> "Settings":
        level = self.COURTBUILDER_READINESS_LEVEL
        if level == "disabled" and self.COURTBUILDER_ENABLED:
            raise ValueError(
                "PEAK3_COURTBUILDER_READINESS_LEVEL is 'disabled' but "
                "COURTBUILDER_ENABLED is set. Set an appropriate readiness "
                "level or disable the flag."
            )
        return self

    # ---------------------------------------------------------------------------
    # Phase 11D — Daily Grid rate limiting
    #
    # The Daily Grid is the only surface where a client repeatedly queries the
    # server while the server is withholding a secret (the day's answer key), so
    # it is the only one that carries limits. Every value is per client key per
    # 60s -- see app/core/rate_limit.py for what the key is and for the honest
    # account of what an in-process limiter does and does not buy.
    #
    # Defaults are set well above what a person playing the game can produce
    # (filling nine squares is ~9 searches and ~9 submissions) and well below
    # what a script enumerating an answer set needs.
    # ---------------------------------------------------------------------------

    # Master switch. Left ON by default so the limited path is the one that runs
    # everywhere, including local dev -- a limiter that is only enabled in
    # production is a limiter nobody has tested.
    DAILY_GRID_RATE_LIMIT_ENABLED: bool = True

    # Board fetch: generous. It returns no answer information, and a client
    # legitimately re-fetches on reload, on date change and on retry.
    DAILY_GRID_BOARD_RATE_LIMIT: int = 120

    # Search: the endpoint an answer-key harvester would actually use.
    DAILY_GRID_SEARCH_RATE_LIMIT: int = 60

    # Answer submission: a player submits at most nine times plus mistakes.
    DAILY_GRID_ANSWER_RATE_LIMIT: int = 30

    # Result: called once per completed board (the client fetches it once and
    # caches it in component state), so this is already very generous.
    DAILY_GRID_RESULT_RATE_LIMIT: int = 20

    # Distinct dates one client may pull boards for per window. Replaying an
    # archive board is a supported feature, so this is not a block -- it is a
    # ceiling on walking the calendar to build an offline board corpus.
    DAILY_GRID_DATE_ENUMERATION_LIMIT: int = 30

    DAILY_GRID_RATE_LIMIT_WINDOW_SECONDS: float = 60.0

    # ---------------------------------------------------------------------------
    # RUN THE TABLE feature flags
    #
    # Mirrors the COURTBUILDER_* pattern above exactly: independent capability
    # switches plus a human-facing readiness level validated for internal
    # consistency. See docs/implementation/RUN_THE_TABLE_IMPLEMENTATION_PLAN.md.
    #
    # DEFAULT ON, unlike RANKED_* and COURTBUILDER_*. Those two default off
    # because they were shipped as gated alpha slices; RUN THE TABLE is the
    # flagship mode, its engine is deterministic and fully covered by the
    # tests under tests/run_the_table/, and the e2e suite plays a complete run
    # against a default local API. A flagship mode that is off by default is a
    # mode nobody's local environment exercises.
    # ---------------------------------------------------------------------------

    # Master switch: RUN THE TABLE routes answer at all. /readiness is the one
    # exception -- it always answers, so the web app can fail closed cleanly
    # rather than guess why it got a 403.
    RUN_THE_TABLE_ENABLED: bool = True

    # The shared daily run. Separately switchable from the mode itself so the
    # daily can be paused (e.g. mid-ruleset-change, when everyone's seed would
    # move underneath them) without taking standard runs down with it.
    RUN_THE_TABLE_DAILY_ENABLED: bool = True

    # Human-facing readiness classification. Does not itself gate behavior --
    # the booleans above do -- but is surfaced on
    # /api/v1/run-the-table/readiness and must be kept consistent with them
    # (validated below).
    RUN_THE_TABLE_READINESS_LEVEL: Literal[
        "disabled", "internal_dev", "internal_alpha", "public_beta"
    ] = "public_beta"

    @model_validator(mode="after")
    def validate_run_the_table_readiness(self) -> "Settings":
        level = self.RUN_THE_TABLE_READINESS_LEVEL
        if level == "disabled" and self.RUN_THE_TABLE_ENABLED:
            raise ValueError(
                "PEAK3_RUN_THE_TABLE_READINESS_LEVEL is 'disabled' but "
                "RUN_THE_TABLE_ENABLED is set. Set an appropriate readiness "
                "level or disable the flag."
            )
        if self.RUN_THE_TABLE_DAILY_ENABLED and not self.RUN_THE_TABLE_ENABLED:
            raise ValueError(
                "PEAK3_RUN_THE_TABLE_DAILY_ENABLED is set but "
                "RUN_THE_TABLE_ENABLED is not. The daily is a run of the same "
                "mode; it cannot be served while the mode is off."
            )
        return self

    @model_validator(mode="after")
    def warn_insecure_secret(self) -> "Settings":
        if self.DEBUG and self.SIGNING_SECRET == "INSECURE_DEV_SECRET_CHANGE_IN_PRODUCTION":
            warnings.warn(
                "PEAK3_SIGNING_SECRET is set to the insecure default. "
                "Set PEAK3_SIGNING_SECRET in your environment or .env file.",
                stacklevel=2,
            )
        if not self.DEBUG and self.DATABASE_URL is None:
            raise ValueError(
                "PEAK3_DATABASE_URL must be set in production (DEBUG=False). "
                "See docs/implementation/LOCAL_DEV.md for setup instructions."
            )
        return self


settings = Settings()
