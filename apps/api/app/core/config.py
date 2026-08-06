import os
import warnings
from pathlib import Path
from typing import Literal, Optional

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

#: Which dotenv file ``Settings`` reads, overridable through the environment.
#:
#: Defaults to ``.env`` — unchanged for every deployment and for ordinary local
#: development. Setting ``PEAK3_ENV_FILE`` to an empty string disables dotenv
#: loading entirely, which is what ``tests/conftest.py`` does before the app is
#: imported.
#:
#: WHY THIS IS OVERRIDABLE AT ALL. ``.env`` was read unconditionally, so the
#: unit suite's storage backend was decided by whether the developer running it
#: happened to have an untracked ``apps/api/.env`` containing a
#: ``PEAK3_DATABASE_URL``: the same command on the same commit gave in-memory
#: repositories in CI and a hosted Postgres on a laptop. A suite whose
#: configuration depends on a file that is not in the repository cannot be used
#: to reproduce a CI failure, which is most of what a suite is for.
_ENV_FILE = os.getenv("PEAK3_ENV_FILE", ".env")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="PEAK3_", env_file=_ENV_FILE or None, extra="ignore"
    )

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

    # Supabase project JWT secret — verifies HS256 access tokens.
    #
    # LEGACY / LOCAL ONLY. Supabase projects created after the asymmetric
    # signing-key rollout do not have one, and none is needed: those projects
    # publish public keys via JWKS (see SUPABASE_JWKS_URL below) and the API
    # verifies ES256/RS256/EdDSA tokens with no shared secret at all. Keep this
    # set only for the local `supabase start` stack, a pre-migration hosted
    # project, or test suites that mint tokens directly.
    SUPABASE_JWT_SECRET: Optional[str] = None

    # Supabase anon (or publishable) key — sent to the frontend for the
    # Supabase JS client. Public by design; never a service-role key.
    SUPABASE_ANON_KEY: Optional[str] = None

    # Supabase project URL — sent to the frontend for the Supabase JS client,
    # and the source the JWKS URL and expected token issuer are derived from.
    SUPABASE_URL: Optional[str] = None

    # Explicit overrides for the asymmetric verification path. Both are derived
    # from SUPABASE_URL when unset, which is the normal case:
    #   JWKS   -> {SUPABASE_URL}/auth/v1/.well-known/jwks.json
    #   issuer -> {SUPABASE_URL}/auth/v1
    SUPABASE_JWKS_URL: Optional[str] = None
    SUPABASE_JWT_ISSUER: Optional[str] = None

    # Expected `aud` claim on asymmetric tokens. Supabase stamps
    # "authenticated" on every user access token. Set to "" to disable the
    # audience check (not recommended).
    SUPABASE_JWT_AUDIENCE: str = "authenticated"

    @property
    def auth_verification_mode(self) -> str:
        """How this process can verify Supabase access tokens.

        Surfaced on the readiness endpoint so a misconfigured deploy is visible
        rather than silently 401-ing every authenticated request.
        """
        asymmetric = bool(self.SUPABASE_JWKS_URL or self.SUPABASE_URL)
        symmetric = bool(self.SUPABASE_JWT_SECRET)
        if asymmetric and symmetric:
            return "jwks+hs256"
        if asymmetric:
            return "jwks"
        if symmetric:
            return "hs256"
        return "unconfigured"

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

    # ---------------------------------------------------------------------------
    # First-party product telemetry (see docs/implementation/TELEMETRY.md)
    #
    # Off by default: an unauthenticated write endpoint should be an explicit
    # opt-in, not something a deploy acquires by upgrading. Rate limiting reuses
    # the shared limiter in app/core/rate_limit.py and follows the
    # PEAK3_DAILY_GRID_*_RATE_LIMIT naming already established there.
    # ---------------------------------------------------------------------------

    # Peak Duel Daily result submission. An unauthenticated write endpoint
    # (guests record attempts under their anon cookie) needs a bound, and the
    # legitimate ceiling is tiny: one attempt per day per identity, plus
    # retries. Shares the shared limiter in app/core/rate_limit.py.
    PEAK_DUEL_RESULT_RATE_LIMIT: int = 20
    PEAK_DUEL_RESULT_RATE_LIMIT_WINDOW_SECONDS: float = 60.0

    TELEMETRY_ENABLED: bool = False
    TELEMETRY_RATE_LIMIT: int = 60
    TELEMETRY_RATE_LIMIT_WINDOW_SECONDS: float = 60.0
    TELEMETRY_MAX_BATCH_SIZE: int = 20
    TELEMETRY_RETENTION_DAYS: int = 90

    # launch-polish IMPLEMENTATION_CONTRACT.md §9. Off by default -- same
    # posture as every other new-collection-surface flag in this file
    # (TELEMETRY_ENABLED, COURTBUILDER_LEADERBOARD_ENABLED): a deployment
    # opts in rather than a new endpoint being live at install time. The
    # rate limit is intentionally much lower than telemetry's -- a real
    # visitor submits contact at most a handful of times ever, never per
    # minute, so this is sized to stop a script, not to accommodate normal
    # use at any real volume.
    CONTACT_ENABLED: bool = False
    CONTACT_RATE_LIMIT: int = 3
    CONTACT_RATE_LIMIT_WINDOW_SECONDS: float = 600.0

    # ---------------------------------------------------------------------------
    # Arena — server-authoritative multiplayer foundation
    #
    # ITS OWN FLAG NAMESPACE, NOT `RANKED_*`. Reusing the ranked flags would make
    # the ranked kill-switch ambiguous: `PEAK3_RANKED_ENABLED=false` currently
    # means exactly one thing -- the Phase 4.0 ranked duel routes are dark -- and
    # an operator turning it off during an incident must not have to wonder
    # whether they also just stopped a different subsystem. Ranked's four flags
    # are untouched by this pass and remain False by default.
    #
    # Mirrors the RANKED_*/COURTBUILDER_*/RUN_THE_TABLE_* pattern exactly:
    # independent capability switches plus a human-facing readiness level whose
    # consistency is validated at startup.
    # ---------------------------------------------------------------------------

    # Master switch: arena routes answer at all. /readiness is the one exception
    # -- it always answers, so the web app can fail closed cleanly rather than
    # guess why it got a 403 (the same carve-out RUN_THE_TABLE_ENABLED has).
    ARENA_ENABLED: bool = False

    # Whether the public matchmaking queue accepts joins. Separately switchable
    # so the queue can be closed -- mid-rating-migration, or during an incident
    # -- without taking private rooms and practice down with it.
    ARENA_PUBLIC_QUEUE_ENABLED: bool = False

    # Whether bots may occupy a seat. Off independently of the queue because a
    # miscalibrated bot is a reason to stop filling seats while still letting
    # humans play each other. With this off, a public queue entry waits for
    # humans until its own TTL rather than being bot-filled, and practice is
    # refused outright -- practice IS a bot match.
    ARENA_BOTS_ENABLED: bool = False

    # Closed-cohort allowlist of owner_sub values permitted to reach arena
    # routes while ARENA_ENABLED=True but the release is not yet public. Empty +
    # enabled = internal engineering only, the same semantics as
    # RANKED_ALPHA_ALLOWLIST and COURTBUILDER_ALPHA_ALLOWLIST.
    ARENA_ALPHA_ALLOWLIST: list[str] = []

    # Whether a settled rated match updates public ratings.
    #
    # ITS OWN FLAG, NOT RANKED_*. Reusing the ranked namespace would make the
    # ranked kill-switch ambiguous: "is ranked off?" must have one answer, and
    # a shared flag would mean turning ranked off also silently stopped arena
    # ratings (or worse, that turning arena ratings on turned part of ranked
    # on). Two products, two switches.
    #
    # Independent of ARENA_PUBLIC_QUEUE_ENABLED on purpose: a miscalibrated
    # rating pass is a reason to stop WRITING ratings while still letting people
    # play. With this off, matches still settle and still record `rated` -- the
    # rating pass simply does not run, so the backlog can be replayed from
    # `arena_match_results` once the cause is fixed.
    ARENA_RATINGS_ENABLED: bool = False

    # Whether the public rating leaderboards return rows. Separate from writing
    # them, so a rating population can be built and inspected before it is shown
    # to anyone -- the same read/write split RANKED_PUBLIC_LEADERBOARD_ENABLED
    # keeps for the same reason.
    ARENA_LEADERBOARD_ENABLED: bool = False

    # LOCAL REVIEW ONLY: let bot practice run on the signed anon-cookie subject
    # instead of a Supabase account.
    #
    # WHY THIS EXISTS. Every arena route requires a real `auth.uid()`, for a
    # reason recorded in arena.py: an anon subject can be discarded by clearing
    # a cookie, and in a three-seat match that means abandoning two other people
    # mid-clock. That reason does not apply to PRACTICE -- it involves nobody
    # else -- and arena.py's own docstring says so ("the one path where this
    # could later be relaxed"). Without this, reviewing bot practice on a laptop
    # requires a hosted Supabase project, which is exactly the coupling this
    # repository avoids everywhere else (see `PEAK3_TEST_*` and
    # docs/implementation/LOCAL_DEV.md).
    #
    # WHAT IT DOES NOT DO. It does not touch the public queue, private rooms,
    # ratings, the leaderboard, or match history, all of which still require an
    # account. It cannot widen access to a match: every match-scoped route is
    # gated by `_seat_or_403`, which reads the caller's seat row rather than
    # anything on the request. And it REFUSES TO START outside DEBUG (validated
    # below) -- a deployed API cannot be talked into this by an environment
    # variable, so hosted authorization is unchanged by construction rather than
    # by convention.
    ARENA_ANONYMOUS_PRACTICE_ENABLED: bool = False

    # Human-facing readiness classification. Does not itself gate behavior --
    # the booleans above do -- but is surfaced on /api/v1/arena/readiness and
    # must be kept consistent with them (validated below).
    ARENA_READINESS_LEVEL: Literal[
        "disabled", "internal_dev", "internal_alpha", "closed_alpha", "public_beta"
    ] = "disabled"

    @model_validator(mode="after")
    def validate_arena_readiness(self) -> "Settings":
        level = self.ARENA_READINESS_LEVEL
        if level == "disabled" and (
            self.ARENA_ENABLED
            or self.ARENA_PUBLIC_QUEUE_ENABLED
            or self.ARENA_BOTS_ENABLED
        ):
            raise ValueError(
                "PEAK3_ARENA_READINESS_LEVEL is 'disabled' but an arena capability "
                "flag is enabled. Set an appropriate readiness level or disable "
                "the flag."
            )
        if self.ARENA_PUBLIC_QUEUE_ENABLED and not self.ARENA_ENABLED:
            raise ValueError(
                "PEAK3_ARENA_PUBLIC_QUEUE_ENABLED is set but PEAK3_ARENA_ENABLED "
                "is not. The queue creates matches of a mode that would not be "
                "servable; it cannot be on while the arena is off."
            )
        if self.ARENA_BOTS_ENABLED and not self.ARENA_ENABLED:
            raise ValueError(
                "PEAK3_ARENA_BOTS_ENABLED is set but PEAK3_ARENA_ENABLED is not."
            )
        if self.ARENA_RATINGS_ENABLED and not self.ARENA_ENABLED:
            raise ValueError(
                "PEAK3_ARENA_RATINGS_ENABLED is set but PEAK3_ARENA_ENABLED is "
                "not. Only a public-queue match is rated, and the arena being "
                "off means no such match can be created -- so this combination "
                "can only mean one of the two was set by mistake."
            )
        if self.ARENA_LEADERBOARD_ENABLED and not self.ARENA_RATINGS_ENABLED:
            # Refused rather than tolerated: a leaderboard reading a rating
            # table nothing is writing shows a frozen board that looks live,
            # which is worse than an obviously-disabled one.
            raise ValueError(
                "PEAK3_ARENA_LEADERBOARD_ENABLED is set but "
                "PEAK3_ARENA_RATINGS_ENABLED is not. The board would serve "
                "ratings that are no longer being updated."
            )
        if self.ARENA_READINESS_LEVEL == "disabled" and (
            self.ARENA_RATINGS_ENABLED or self.ARENA_LEADERBOARD_ENABLED
        ):
            raise ValueError(
                "PEAK3_ARENA_READINESS_LEVEL is 'disabled' but an arena rating "
                "capability flag is enabled."
            )
        if self.ARENA_ANONYMOUS_PRACTICE_ENABLED:
            if not self.DEBUG:
                # A HARD STARTUP ERROR, not a warning that is ignored and not a
                # silent downgrade to False. The whole value of this switch is
                # that a deployed API cannot have it; a deployment that sets it
                # is a deployment whose author believed something untrue about
                # its own authorization, and it should stop rather than serve.
                raise ValueError(
                    "PEAK3_ARENA_ANONYMOUS_PRACTICE_ENABLED is set with "
                    "PEAK3_DEBUG=False. Anonymous bot practice is a LOCAL "
                    "review affordance and must never be enabled on a deployed "
                    "API -- signed-in closed-alpha accounts already reach bot "
                    "practice there. Unset it, or set PEAK3_DEBUG=true if this "
                    "really is a developer machine."
                )
            if not self.ARENA_ENABLED:
                raise ValueError(
                    "PEAK3_ARENA_ANONYMOUS_PRACTICE_ENABLED is set but "
                    "PEAK3_ARENA_ENABLED is not."
                )
            if not self.ARENA_BOTS_ENABLED:
                raise ValueError(
                    "PEAK3_ARENA_ANONYMOUS_PRACTICE_ENABLED is set but "
                    "PEAK3_ARENA_BOTS_ENABLED is not. Practice IS a bot match, "
                    "so this combination grants access to nothing."
                )
        return self

    @model_validator(mode="after")
    def warn_insecure_secret(self) -> "Settings":
        if self.SIGNING_SECRET == "INSECURE_DEV_SECRET_CHANGE_IN_PRODUCTION":
            if self.DEBUG:
                warnings.warn(
                    "PEAK3_SIGNING_SECRET is set to the insecure default. "
                    "Set PEAK3_SIGNING_SECRET in your environment or .env file.",
                    stacklevel=2,
                )
            else:
                # Previously this check ran only under DEBUG, so a production
                # deploy that forgot the variable started silently on the
                # public default value and could forge anon-subject cookies.
                raise ValueError(
                    "PEAK3_SIGNING_SECRET is the public default value and "
                    "DEBUG is False. Set a real secret before deploying."
                )
        if not self.DEBUG and self.DATABASE_URL is None:
            raise ValueError(
                "PEAK3_DATABASE_URL must be set in production (DEBUG=False). "
                "See docs/implementation/LOCAL_DEV.md for setup instructions."
            )
        if not self.DEBUG:
            self._assert_deployable()
        if not self.DEBUG and self.auth_verification_mode == "unconfigured":
            # Without either PEAK3_SUPABASE_URL (JWKS) or
            # PEAK3_SUPABASE_JWT_SECRET (legacy HS256) the API cannot verify a
            # single access token: every authenticated route 401s for everyone,
            # which used to be a one-line WARNING and a total auth outage.
            raise ValueError(
                "No Supabase token verification is configured. Set "
                "PEAK3_SUPABASE_URL (asymmetric/JWKS — the current default for "
                "new projects) or PEAK3_SUPABASE_JWT_SECRET (legacy HS256). "
                "See docs/implementation/AUTH_CONFIGURATION.md."
            )
        return self


    # -----------------------------------------------------------------------
    # Deployment safety — the checks that only matter once DEBUG is False
    # -----------------------------------------------------------------------
    #
    # These reject configurations that are correct for a laptop and wrong for a
    # deployed environment. Each one has been an actual outage somewhere, and
    # each fails at STARTUP: a deploy that refuses to boot is a rollback, while
    # a deploy that boots misconfigured is an incident.
    #
    # `DEBUG=False` is the trigger rather than a separate PEAK3_ENV variable, so
    # there is one switch to get wrong instead of two that can disagree.

    #: Hosts that mean "this machine". A deployed service naming one of these is
    #: pointing at itself, not at the thing it was meant to reach.
    _LOCAL_HOSTS = ("localhost", "127.0.0.1", "0.0.0.0", "::1", "host.docker.internal")

    def _is_local_url(self, value: Optional[str]) -> bool:
        if not value:
            return False
        lowered = value.lower()
        return any(h in lowered for h in self._LOCAL_HOSTS)

    def _assert_deployable(self) -> None:
        problems: list[str] = []

        # 1. Localhost URLs. A staging API whose SUPABASE_URL is localhost
        #    cannot fetch JWKS, so every access token fails verification and
        #    every authenticated request 401s while the service looks healthy.
        for name, value in (
            ("PEAK3_SUPABASE_URL", self.SUPABASE_URL),
            ("PEAK3_SUPABASE_JWKS_URL", self.SUPABASE_JWKS_URL),
            ("PEAK3_DATABASE_URL", self.DATABASE_URL),
        ):
            if self._is_local_url(value):
                problems.append(
                    f"{name} points at localhost. A deployed service cannot reach "
                    f"the deployer's machine."
                )
        for origin in self.CORS_ORIGINS:
            if self._is_local_url(origin):
                problems.append(
                    f"PEAK3_CORS_ORIGINS contains {origin!r}. Allowing a localhost "
                    f"origin from a deployed API is a development leftover."
                )

        # 2. Wildcard CORS with credentials. The app sends
        #    `allow_credentials=True` (main.py), and Starlette answers a
        #    wildcard by echoing whatever Origin the caller sent -- so "*" here
        #    is not "any origin, no cookies", it is "every origin, with
        #    credentials", which is the whole same-origin policy switched off.
        if "*" in self.CORS_ORIGINS:
            problems.append(
                "PEAK3_CORS_ORIGINS contains '*' while the API sends credentialed "
                "responses. List the exact web origins instead."
            )
        if not self.CORS_ORIGINS:
            problems.append("PEAK3_CORS_ORIGINS is empty; the web app will be blocked by CORS.")

        # 3. Plaintext transport. A Supabase URL over http:// on a deployed
        #    service means bearer tokens crossing the network in the clear.
        for name, value in (
            ("PEAK3_SUPABASE_URL", self.SUPABASE_URL),
            ("PEAK3_SUPABASE_JWKS_URL", self.SUPABASE_JWKS_URL),
        ):
            if value and value.lower().startswith("http://"):
                problems.append(f"{name} is http://; use https:// outside local development.")

        # 4. Missing dataset. Without it the service starts, logs one warning,
        #    and serves 503 from readiness forever while /health says 200. The
        #    Dockerfile generates it at build time, so reaching here means the
        #    image was built wrong -- worth failing loudly at boot rather than
        #    discovering it from a graph of 503s.
        for artifact in ("leaderboards.json", "peak_windows.json"):
            path = self.DATA_DIR / artifact
            if not path.exists() or path.stat().st_size == 0:
                problems.append(
                    f"Generated dataset missing or empty: {path}. Run "
                    f"scripts/build_web_dataset.py during the build."
                )

        # 5. Ranked must be an explicit decision. The defaults are already off;
        #    this refuses the specific combination of "enabled" plus a readiness
        #    level that has not been raised past internal, which is what an
        #    accidental copy of a developer's env looks like.
        if self.RANKED_ENABLED and self.RANKED_READINESS_LEVEL in ("disabled", "simulation_only"):
            problems.append(
                "PEAK3_RANKED_ENABLED is true but PEAK3_RANKED_READINESS_LEVEL is "
                f"{self.RANKED_READINESS_LEVEL!r}. Ranked must be turned on deliberately."
            )

        if problems:
            raise ValueError(
                "Refusing to start: this configuration is not deployable.\n  - "
                + "\n  - ".join(problems)
            )


settings = Settings()
