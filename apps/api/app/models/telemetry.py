"""Product telemetry — request/response models, the closed allowlists, and the
subject-hashing function (Track F).

THE WHOLE DESIGN IN ONE PARAGRAPH. Telemetry here is a *closed* vocabulary,
not a generic event pipe. There is one allowlist of event NAMES, one allowlist
of property KEYS, one allowlist of value TYPES, and a charset bound on string
values. A payload that steps outside any of those is a 422 -- not a silently
dropped field, not a stored-and-sorted-out-later blob. The reason is that the
only way to be *sure* an email address never lands in the analytics store is
to make "arbitrary string" unrepresentable, and the only way to keep that true
as five other tracks add call sites is for the boundary to reject loudly.

WHY REJECT RATHER THAN STRIP. Stripping is the friendlier default and the
wrong one here: a stripped field is a privacy bug that produces no signal, so
the call site that sent `{"email": ...}` keeps sending it forever. A 422
surfaces in dev the first time it happens. The client mirrors the same
allowlist (apps/web/src/lib/analytics.ts) and drops offending keys before they
leave the browser, so in practice the 422 is a development-time assertion
rather than a user-facing failure.

WHAT IS NEVER REPRESENTABLE HERE (the authoritative list is duplicated, in
prose, in docs/implementation/TELEMETRY.md):
  email addresses; OAuth / magic-link / access / refresh tokens; the
  Authorization header or any part of it; raw localStorage contents; IP
  addresses; user agents; free-text the player typed; player names, search
  queries, or any board answer; the raw `sub` of an authenticated user or the
  raw `anon:` cookie subject.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

# ---------------------------------------------------------------------------
# The closed event allowlist
#
# Exactly the 21 product events in the pass spec, in the order the player
# meets them. Adding one is a deliberate, reviewed edit here -- there is no
# dynamic registration path, and the ingest endpoint types this as a Literal
# so an unknown name is rejected by Pydantic before any handler code runs.
# ---------------------------------------------------------------------------
EventName = Literal[
    # Identity
    "auth_started",
    "auth_completed",
    "guest_state_claimed",
    # Session / onboarding
    "game_opened",
    "tutorial_completed",
    "tutorial_skipped",
    # RUN THE TABLE
    "run_started",
    "run_ended",
    "second_run_started",
    "run_replayed",
    "perk_selected",
    "node_selected",
    "card_bought",
    "trade_completed",
    "boss_won",
    "boss_lost",
    "table_cleared",
    # Social
    "challenge_created",
    "challenge_completed",
    # Daily
    "daily_opened",
    "daily_completed",
]

EVENT_NAMES: frozenset[str] = frozenset(EventName.__args__)  # type: ignore[attr-defined]

# ---------------------------------------------------------------------------
# The closed property-key allowlist
#
# One flat allowlist rather than a per-event schema. A per-event schema would
# be more precise and would also be a second place for every track to edit; a
# flat closed set is what actually delivers the privacy property (no key
# outside this list can ever be stored) at a fraction of the maintenance.
#
# Every key below is a low-cardinality product dimension or an opaque
# client-minted reference. None of them can carry an identity:
#   * `run_ref` / `session_ref` are random tokens the CLIENT mints for
#     within-telemetry correlation. They are NOT the server's run ids, so they
#     do not create a path from a telemetry row back to a named account.
#   * `daily_key` is a calendar date, shared by every player that day.
# ---------------------------------------------------------------------------
PROPERTY_KEYS: frozenset[str] = frozenset(
    {
        # Correlation (opaque, client-minted, see above)
        "run_ref",
        "session_ref",
        # Where / what
        "mode",
        "surface",
        "source",
        "method",
        "board_type",
        "challenge_kind",
        "node_type",
        "ruleset",
        # Outcome
        "outcome",
        "result",
        "boss",
        "boss_id",
        "perk",
        "perk_id",
        # Run shape
        "act",
        "stage",
        "run_index",
        "duration_seconds",
        "lanes_won",
        "lives_remaining",
        "credits_remaining",
        "cards_bought",
        "trades_made",
        "replay",
        # Onboarding / daily
        "tutorial_step",
        "daily_key",
        "streak",
        "is_first_run",
        "is_second_run",
    }
)

# ---------------------------------------------------------------------------
# Keys that are rejected with a distinct, loud error even though they are
# already outside PROPERTY_KEYS.
#
# Strictly redundant -- an allowlist already denies everything not on it. It
# exists so that the one mistake that matters produces an unmistakable message
# ("forbidden_property") instead of the generic "unknown_property", both in
# the 422 body and in the test that guards this file. A privacy regression
# should not read like a typo.
# ---------------------------------------------------------------------------
FORBIDDEN_PROPERTY_KEYS: frozenset[str] = frozenset(
    {
        "access_token",
        "address",
        "api_key",
        "auth",
        "authorization",
        "bearer",
        "cookie",
        "credential",
        "email",
        "email_address",
        "id_token",
        "ip",
        "ip_address",
        "jwt",
        "localstorage",
        "magic_link",
        "name",
        "otp",
        "password",
        "phone",
        "provider_token",
        "query",
        "refresh_token",
        "search",
        "secret",
        "session",
        "sub",
        "token",
        "user_agent",
        "user_id",
        "username",
    }
)

# ---------------------------------------------------------------------------
# Bounds
# ---------------------------------------------------------------------------

#: Events per POST. A batch bigger than this is a client bug or an abuser.
MAX_EVENTS_PER_BATCH = 20

#: Properties per event.
MAX_PROPERTIES_PER_EVENT = 12

#: Serialized bytes of one event's `props`. Every allowed value is a scalar
#: and every string is <= MAX_STRING_VALUE_LENGTH, so this is a backstop
#: against pathological combinations rather than the primary bound.
MAX_PROPS_BYTES = 1024

#: Characters in any string property value.
MAX_STRING_VALUE_LENGTH = 64

#: Default retention. Long enough for a week-over-week retention read, short
#: enough that the store is not a growing liability. Overridable per
#: deployment (see the config note in docs/implementation/TELEMETRY.md).
DEFAULT_RETENTION_DAYS = 90

# Property values are constrained to an ASCII slug charset with NO SPACES.
# This is the rule that makes "free-text user input" unrepresentable: a
# player's search query, a display name, a sentence, an email address and an
# `Authorization` header value all fail it, while every legitimate value the
# product actually sends -- "run_the_table", "table_cleared", "2026-08-01", a
# hex run_ref -- passes. Excluding the space is what does most of the work:
# almost nothing a human types lacks one, and no product dimension needs one.
_SAFE_STRING = re.compile(r"^[A-Za-z0-9_.:\-]{1,64}$")
_SAFE_KEY = re.compile(r"^[a-z][a-z0-9_]{0,39}$")

# The slug charset alone is not enough, because a JWT is *also* slug-shaped:
# `eyJhbGciOi....eyJzdWIiOi....signature` is nothing but letters, digits,
# `-`, `_` and `.`. These two patterns close that hole.
#   * `eyJ` is the base64 of `{"` and therefore the opening of every JWT
#     header and payload segment in existence.
#   * A run of 32+ opaque characters is not a product dimension. Every real
#     value here is a short slug, a date, or a 16-character run_ref; anything
#     longer and structureless is a key, a token or an id.
_JWT_PREFIX = re.compile(r"eyJ[A-Za-z0-9_\-]")
_OPAQUE_BLOB = re.compile(r"^[A-Za-z0-9_\-]{32,}$")


def looks_like_a_secret(value: str) -> bool:
    """True for values shaped like a token, whatever key they arrived under.

    Backstop for the case the property allowlist cannot catch: a legitimate
    key (`mode`, `source`) carrying an illegitimate value.
    """
    return bool(_JWT_PREFIX.search(value) or _OPAQUE_BLOB.match(value))

PropertyValue = bool | int | float | str | None


class TelemetryValidationError(ValueError):
    """A payload that the closed vocabulary refuses.

    Carries a stable `code` so the route can put a machine-readable reason in
    the error envelope without ever echoing the offending VALUE back -- the
    value is the thing we are trying not to handle.
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def validate_properties(props: dict[str, Any]) -> dict[str, PropertyValue]:
    """Return `props` unchanged, or raise TelemetryValidationError.

    Never echoes a rejected value -- only the offending KEY, which is by
    definition drawn from a bounded, non-sensitive vocabulary (either an
    allowlisted key or one of the forbidden ones we are naming on purpose).
    """
    if len(props) > MAX_PROPERTIES_PER_EVENT:
        raise TelemetryValidationError(
            "too_many_properties",
            f"An event may carry at most {MAX_PROPERTIES_PER_EVENT} properties.",
        )

    for key, value in props.items():
        if not isinstance(key, str) or not _SAFE_KEY.match(key):
            raise TelemetryValidationError(
                "invalid_property_name", "Property names must be lower_snake_case."
            )
        if key in FORBIDDEN_PROPERTY_KEYS:
            raise TelemetryValidationError(
                "forbidden_property",
                f"Property '{key}' is never collected by PEAK3 telemetry.",
            )
        if key not in PROPERTY_KEYS:
            raise TelemetryValidationError(
                "unknown_property",
                f"Property '{key}' is not in the telemetry property allowlist.",
            )
        if isinstance(value, bool) or value is None:
            continue
        if isinstance(value, int):
            continue
        if isinstance(value, float):
            # NaN/Inf are not JSON and are not a measurement.
            if value != value or value in (float("inf"), float("-inf")):
                raise TelemetryValidationError(
                    "invalid_property_value", f"Property '{key}' must be a finite number."
                )
            continue
        if isinstance(value, str):
            if len(value) > MAX_STRING_VALUE_LENGTH:
                raise TelemetryValidationError(
                    "invalid_property_value",
                    f"Property '{key}' exceeds {MAX_STRING_VALUE_LENGTH} characters.",
                )
            if not _SAFE_STRING.match(value) or looks_like_a_secret(value):
                # The message deliberately describes the RULE, not the value.
                raise TelemetryValidationError(
                    "invalid_property_value",
                    f"Property '{key}' must be a short slug "
                    "(letters, digits, '_', '.', ':', '-'; no spaces). "
                    "Free text and token-shaped values are never accepted.",
                )
            continue
        raise TelemetryValidationError(
            "invalid_property_value",
            f"Property '{key}' must be a string, number, boolean or null.",
        )

    encoded = json.dumps(props, separators=(",", ":"), sort_keys=True)
    if len(encoded.encode("utf-8")) > MAX_PROPS_BYTES:
        raise TelemetryValidationError(
            "properties_too_large",
            f"Event properties exceed {MAX_PROPS_BYTES} bytes.",
        )
    return props  # type: ignore[return-value]


def hash_subject(owner_sub: str, signing_secret: str) -> str:
    """Pseudonymise an owner subject for storage.

    HMAC-SHA256 rather than a bare SHA-256: the anon subject space is
    `anon:{token_urlsafe(16)}` (high entropy, safe either way) but the
    authenticated subject space is UUIDs, and an unkeyed digest of a UUID is
    reversible by anyone who already holds the user table. Keying it with
    PEAK3_SIGNING_SECRET means a telemetry extract on its own -- leaked,
    exported for analysis, handed to a contractor -- cannot be re-identified.

    The deliberate cost: this hash cannot be joined to `games.owner_sub`,
    `profiles.id`, or anything else that stores the raw subject. Every metric
    in scripts/telemetry_report.py is a per-subject aggregate, so nothing needs
    that join; see the migration header.
    """
    return hmac.new(
        signing_secret.encode("utf-8"), owner_sub.encode("utf-8"), hashlib.sha256
    ).hexdigest()


def subject_kind(owner_sub: str) -> Literal["anon", "user"]:
    """'anon' for a cookie subject, 'user' for a verified Supabase sub."""
    return "anon" if owner_sub.startswith("anon:") else "user"


def retention_expiry(
    created_at: Optional[datetime] = None, retention_days: int = DEFAULT_RETENTION_DAYS
) -> datetime:
    """The `expires_at` stamped on a row at write time."""
    base = created_at or datetime.now(timezone.utc)
    return base + timedelta(days=max(1, retention_days))


# ---------------------------------------------------------------------------
# Wire models
# ---------------------------------------------------------------------------


class TelemetryEventIn(BaseModel):
    """One client-submitted event.

    `extra="forbid"`: this is a trust boundary, and an unrecognised top-level
    key is exactly the shape a "just send the whole state object" mistake
    takes.

    WHY `name` IS A PLAIN BOUNDED STRING HERE AND NOT `EventName`, and why
    `props` carries no field_validator: a Pydantic ValidationError echoes the
    rejected INPUT back in its 422 body. For a field whose entire purpose is
    to be the place a leaked email or token might turn up, reflecting the
    value is precisely the wrong failure mode. So the shape is bounded here
    and the *vocabulary* is enforced in the route
    (`app/api/v1/telemetry.py:_validate_event`), which raises an error
    envelope naming only the offending KEY and never the value.
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=3, max_length=64)
    props: dict[str, Any] = Field(default_factory=dict)


class TelemetryBatchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    events: list[TelemetryEventIn] = Field(min_length=1, max_length=MAX_EVENTS_PER_BATCH)


class TelemetryBatchResponse(BaseModel):
    """Deliberately tells the caller almost nothing.

    `accepted` exists so a client can tell "the server took these" from "the
    feature is off". There is no per-event echo, no id list, and no stored
    representation returned: telemetry is write-only from the client's side
    (see the RLS section of the migration), and an ingest endpoint that reads
    anything back is one bug away from being a read endpoint.
    """

    accepted: int
    stored: bool
