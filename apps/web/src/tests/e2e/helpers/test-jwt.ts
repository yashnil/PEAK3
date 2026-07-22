/**
 * Mints a Supabase-shaped HS256 JWT for Playwright e2e use, signed with the
 * same PEAK3_SUPABASE_JWT_SECRET the API server under test was started with.
 *
 * This does not talk to Supabase at all: app.core.auth._decode_jwt only
 * verifies the HS256 signature against SUPABASE_JWT_SECRET and reads the
 * `sub`/`email`/`is_anonymous` claims — Supabase Auth tokens ARE just HS256
 * JWTs signed with that shared secret, so a test that knows the secret can
 * mint an equivalent token without a live Supabase project. This is exactly
 * the gap documented in the Phase 4.0 report: it proves the JWT verification
 * path works, but is not a substitute for the real sign-up/sign-in/session
 * flows a live Supabase project would exercise (see the dedicated Supabase
 * integration-test job for that).
 */
import { createHmac } from "crypto";

const TEST_JWT_SECRET = process.env.PEAK3_TEST_JWT_SECRET || "e2e-ranked-test-secret-do-not-use-in-prod";

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function mintTestAccessToken(sub: string, email: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub,
    email,
    is_anonymous: false,
    aud: "authenticated",
    role: "authenticated",
    iat: now,
    exp: now + 3600,
  };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = createHmac("sha256", TEST_JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  return `${encodedHeader}.${encodedPayload}.${base64url(signature)}`;
}

export { TEST_JWT_SECRET };
