import base64
import hashlib
import hmac
import json
import time


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(s: str) -> bytes:
    # Add padding back
    padding = 4 - len(s) % 4
    if padding != 4:
        s += "=" * padding
    return base64.urlsafe_b64decode(s)


def create_session_token(payload: dict, secret: str, ttl_seconds: int) -> str:
    """Create an HMAC-SHA256 signed session token.

    Token format: base64url(json_payload) + "." + base64url(hmac_signature)
    The payload must NOT be logged — it contains session duel data.
    """
    full_payload = dict(payload)
    full_payload["exp"] = int(time.time()) + ttl_seconds

    payload_bytes = json.dumps(full_payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    encoded_payload = _b64url_encode(payload_bytes)

    sig = hmac.new(secret.encode("utf-8"), encoded_payload.encode("utf-8"), hashlib.sha256).digest()
    encoded_sig = _b64url_encode(sig)

    return f"{encoded_payload}.{encoded_sig}"


def verify_session_token(token: str, secret: str) -> dict | None:
    """Verify an HMAC-SHA256 signed session token.

    Returns the decoded payload dict if valid and not expired.
    Returns None if the signature is invalid or the token has expired.
    Never logs the token value.
    """
    try:
        parts = token.split(".")
        if len(parts) != 2:
            return None

        encoded_payload, encoded_sig = parts[0], parts[1]

        # Verify signature
        expected_sig = hmac.new(
            secret.encode("utf-8"),
            encoded_payload.encode("utf-8"),
            hashlib.sha256,
        ).digest()
        expected_encoded_sig = _b64url_encode(expected_sig)

        if not hmac.compare_digest(encoded_sig, expected_encoded_sig):
            return None

        # Decode payload
        payload_bytes = _b64url_decode(encoded_payload)
        payload = json.loads(payload_bytes.decode("utf-8"))

        # Check expiry
        exp = payload.get("exp")
        if exp is None or int(time.time()) > exp:
            return None

        return payload

    except Exception:
        return None
