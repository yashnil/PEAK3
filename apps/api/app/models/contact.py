"""Contact / feedback — request/response models and closed vocabularies
(launch-polish IMPLEMENTATION_CONTRACT.md §9).

Modeled directly on app/models/telemetry.py: `hash_subject`/`subject_kind`
are imported from there rather than re-implemented, because the identity
math (HMAC-SHA256 keyed with PEAK3_SIGNING_SECRET, never storing the raw
subject) is exactly the same security property this table needs, and a
second implementation is a second place it could drift.

WHAT IS DIFFERENT FROM TELEMETRY. This is the one surface in this codebase
that deliberately stores genuine free text from an authentication-optional
route -- `subject` and `message` are whatever the sender typed, bounded only
by length. Telemetry's whole design is built around making free text
unrepresentable; this model's job is the opposite one: bound it, never
pretend to sanitize its CONTENT (that is the reading/rendering side's job,
not the storage side's), and keep every OTHER field on this model closed and
validated so the free-text fields are the only place that risk lives.
"""
from __future__ import annotations

import re
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

from app.models.telemetry import hash_subject, subject_kind  # noqa: F401 (re-exported for callers)

# ---------------------------------------------------------------------------
# Closed vocabularies -- authoritative here; supabase/migrations/
# 20260803110000_contact_submissions.sql's CHECK constraints mirror this
# list as a second, independent layer, the same "app validates, database
# double-checks the shape" split telemetry_events uses for event_name.
# ---------------------------------------------------------------------------

ContactCategory = Literal[
    "new_mode",
    "improve_mode",
    "bug",
    "question_ranking_or_data",
    "accessibility",
    "account_or_privacy",
    "partnership_or_press",
    "other",
]

CONTACT_CATEGORIES: tuple[str, ...] = (
    "new_mode",
    "improve_mode",
    "bug",
    "question_ranking_or_data",
    "accessibility",
    "account_or_privacy",
    "partnership_or_press",
    "other",
)

ContactRelevantArea = Literal[
    "daily_grid",
    "peak_season_82_0",
    "run_the_table",
    "ranked",
    "rankings_model",
    "account",
    "other",
]

CONTACT_RELEVANT_AREAS: tuple[str, ...] = (
    "daily_grid",
    "peak_season_82_0",
    "run_the_table",
    "ranked",
    "rankings_model",
    "account",
    "other",
)

#: Loose shape check, not a deliverability check -- same posture as every
#: other "is this roughly an email" validator in this codebase (there isn't
#: one to mirror yet; this is deliberately simple rather than a regex that
#: tries to be RFC 5322-complete and gets it subtly wrong).
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

MAX_SUBJECT_LENGTH = 200
MAX_MESSAGE_LENGTH = 4000


class ContactSubmissionIn(BaseModel):
    """The client-submitted shape. Deliberately narrow: no client-supplied
    id, no client-supplied timestamp, no client-supplied identity -- those
    are exactly the fields the route derives itself (see
    api/v1/contact.py::submit_contact), the same discipline
    SubmitRunRequest uses for leaderboard submissions."""

    category: ContactCategory
    relevant_area: Optional[ContactRelevantArea] = None
    subject: str = Field(min_length=1, max_length=MAX_SUBJECT_LENGTH)
    message: str = Field(min_length=1, max_length=MAX_MESSAGE_LENGTH)
    reply_email: Optional[str] = Field(None, max_length=320)

    # Honeypot. A real user never sees or fills this field (hidden by the
    # frontend form); a naive bot filling every input in a scraped form will.
    # Never validated against a vocabulary, never stored -- the route reads
    # it, and if it is non-empty, responds exactly like a normal success
    # (so the bot learns nothing) while writing nothing to the database.
    website: str = Field(default="", max_length=200)

    @field_validator("subject", "message")
    @classmethod
    def _not_just_whitespace(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped:
            raise ValueError("This field cannot be blank.")
        return stripped

    @field_validator("reply_email")
    @classmethod
    def _validate_reply_email(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        v = v.strip()
        if not _EMAIL_RE.match(v):
            raise ValueError("That doesn't look like a valid email address.")
        return v


class ContactSubmissionResponse(BaseModel):
    """202-Accepted response. Deliberately does not echo back subject/message
    -- there is no reason to, and echoing user-submitted free text in a JSON
    response is one more place it could be misrendered by a careless caller.

    `request_id` is the stored row's own id. There is no GET route to look
    anything up with it and no client-facing meaning beyond "reference this
    if you follow up" -- it is not a lookup token, just a correlation
    handle a human (support, or the sender quoting it in a follow-up email)
    can match against the table directly."""

    request_id: str
    accepted: bool = True
