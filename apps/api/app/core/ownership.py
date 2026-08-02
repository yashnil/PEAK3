"""The one place PEAK3 decides whether a caller may mutate an owned resource.

Before this module, nine mutation routes across Peak Draft and 82-0 PEAK Season
took a resource id and no identity at all. Possessing a `game_id` was
sufficient to drive a stranger's game to completion -- which, for Peak Draft,
also wrote a `DailyCompletion` under `ON CONFLICT DO NOTHING` and permanently
burned the victim's daily attempt with a garbage lineup. Three of those routes
were documented as knowingly-unfixed in
`docs/implementation/AUTH_DAILY_BALANCE_REPORT.md:571-584`; a fourth
(`POST /draft/challenges`) appeared in no prior report.

The rule this module encodes, from the pass spec §7:

    possessing an ID never grants mutation rights

Two functions, deliberately kept apart from `app.core.auth.resolve_owner_sub`:

* ``existing_owner_sub`` resolves the caller's identity **without ever minting
  one**. `resolve_owner_sub` mints an anonymous subject and sets a 30-day
  cookie when the caller has none -- correct for a *creation* route, actively
  harmful for a *mutation* route, where it would hand the attacker a fresh
  credential and then cheerfully compare it against the victim's row. A caller
  with no credential cannot be the owner of anything; that is the whole point.

* ``assert_owns`` compares and raises 403. It fails **closed**: a null caller
  or a null resource owner is a denial, never a pass.

Why 403 and not 404: `run_the_table.py:189-194` already chose 403
`run_not_owned`, and the two-tab idempotency behaviour depends on being able to
tell "not yours" from "gone". Game ids are unguessable UUIDs, so the marginal
enumeration hardening a 404 would buy is not worth the inconsistency.
"""
from __future__ import annotations

from typing import Optional

from fastapi import HTTPException

from app.core.auth import AuthSubject, verify_anon_subject


def existing_owner_sub(
    auth: Optional[AuthSubject],
    anon_cookie: Optional[str],
    signing_secret: str,
) -> Optional[str]:
    """The caller's identity if they already have one, else ``None``.

    Never mints, never sets a cookie. Trusts only a verified JWT `sub` or an
    HMAC-verified `peak3_anon` cookie -- never a client-submitted subject.
    """
    if auth is not None:
        return auth.sub
    if anon_cookie:
        return verify_anon_subject(anon_cookie, signing_secret)
    return None


def assert_owns(
    resource_owner_sub: Optional[str],
    caller_sub: Optional[str],
    *,
    code: str = "not_your_game",
    message: str = "This game belongs to a different player.",
) -> None:
    """Raise 403 unless ``caller_sub`` is exactly the resource's owner.

    Fails closed on either side being ``None``:

    * a ``None`` caller has presented no credential at all;
    * a ``None`` resource owner is a pre-ownership legacy row. Every creation
      path in the codebase sets a non-null owner today (`draft.py:128`, `:174`,
      `:718`; `perfect_season.py:192`, `:221`), so a null owner means a row
      that predates ownership. Games expire on their own; refusing to mutate an
      ownerless row is the safe reading of an ambiguous case.
    """
    if caller_sub is None or resource_owner_sub is None or resource_owner_sub != caller_sub:
        raise HTTPException(
            status_code=403,
            detail={"error_code": code, "message": message},
        )
