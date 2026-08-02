/**
 * `safeNext` — the single gate every post-authentication return URL passes.
 *
 * WHY THIS EXISTS. Three surfaces honour an attacker-controllable destination:
 * `?returnTo=` on `/signin` and `/signup`, and `?next=` on `/auth/callback`.
 * Before this pass all three did `params.get("returnTo") ?? "/"` and handed the
 * result straight to `router.push()` / a `Location` header. That is a textbook
 * open redirect: a link to
 * `https://peak3.example/signin?returnTo=https://evil.example` sends a user who
 * has just typed their credentials to an attacker's page, from the real
 * product's own domain, with the real product's own referrer.
 *
 * THE RULE. Accept a *same-origin path only*: it must begin with exactly one
 * `/`, must not be a protocol-relative URL, must not carry a scheme, and must
 * still be a same-origin path after URL-decoding. Anything else becomes `/`.
 * The function never throws and never returns `null` — callers cannot forget to
 * handle a rejection, because a rejection is indistinguishable from "no value
 * was supplied", which is the correct behaviour for both.
 *
 * WHY WHATWG PARSING AND NOT ONLY PREFIX CHECKS. `URL` resolves `\` as `/` for
 * special schemes, so `/\evil.example` parses to `http://evil.example/` — a
 * string that passes a naive `startsWith("/") && !startsWith("//")` test and is
 * nonetheless a cross-origin redirect in every browser. Parsing against a
 * sentinel origin and comparing `origin` catches that family exactly, including
 * the variants (`/\/`, `/\\`, `/%5C`) rather than one spelling at a time.
 *
 * Owner: Track B (auth surface).
 */

/** Where a rejected — or absent — destination lands. */
export const SAFE_NEXT_FALLBACK = "/";

/**
 * A sentinel origin used only for parsing. `.invalid` is reserved by RFC 2606
 * and can never resolve, so a bug that leaked this string could not become a
 * live redirect to somebody's host.
 */
const SENTINEL_ORIGIN = "http://peak3-safe-next.invalid";

/**
 * Control characters, DEL, and any whitespace — the classic parser-desync
 * payloads (`/\n//evil.example`, `\t//evil.example`). A legitimate path encodes
 * these, so rejecting the raw forms costs nothing.
 */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[\u0000-\u0020\u007f-\u009f]/;

/** `scheme:` per RFC 3986, anchored. */
const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * Is `value` a same-origin path, in this exact spelling?
 *
 * Applied to the raw string *and* to every decoding of it, so a payload cannot
 * hide behind percent-encoding.
 */
function isSameOriginPath(value: string): boolean {
  if (value.length === 0) return false;
  if (FORBIDDEN_CHARS.test(value)) return false;
  if (HAS_SCHEME.test(value)) return false;
  if (!value.startsWith("/")) return false;
  // Protocol-relative (`//host`) and the backslash variants browsers normalise
  // into it. Checked explicitly as well as via URL parsing so the intent is
  // readable at the call site of a failing test.
  if (value.startsWith("//")) return false;
  if (value.startsWith("/\\")) return false;

  try {
    const parsed = new URL(value, SENTINEL_ORIGIN);
    if (parsed.origin !== SENTINEL_ORIGIN) return false;
    // `new URL("/a", base).protocol` is the base's — a scheme that survived the
    // regex would have changed `origin` already, so this is belt-and-braces.
    if (parsed.protocol !== "http:") return false;
  } catch {
    return false;
  }
  return true;
}

/**
 * Normalise an untrusted return destination to a same-origin path.
 *
 * @param raw      the attacker-controllable value (`?next=`, `?returnTo=`, …)
 * @param fallback where rejected input lands; must itself be a safe path
 * @returns the original string when it is safe, otherwise `fallback`
 */
export function safeNext(
  raw: string | null | undefined,
  fallback: string = SAFE_NEXT_FALLBACK,
): string {
  const safeFallback =
    typeof fallback === "string" && isSameOriginPath(fallback)
      ? fallback
      : SAFE_NEXT_FALLBACK;

  if (typeof raw !== "string") return safeFallback;
  const value = raw.trim();
  if (value.length === 0) return safeFallback;
  if (!isSameOriginPath(value)) return safeFallback;

  // Decode repeatedly: a redirect chain can decode more than once, so
  // `/%252f%252fevil.example` must be rejected on the same grounds as
  // `//evil.example`. Three rounds is far past anything a real path needs.
  let decoded = value;
  for (let round = 0; round < 3; round += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      // A malformed escape sequence is not a path we are willing to emit.
      return safeFallback;
    }
    if (next === decoded) break;
    decoded = next;
    if (!isSameOriginPath(decoded)) return safeFallback;
  }

  return value;
}

/**
 * `?returnTo=` for a sign-in link, already encoded and already validated.
 *
 * Centralised so the encode step cannot be forgotten at one of the eight call
 * sites that build this link today.
 */
export function signInHref(returnTo?: string | null, base = "/signin"): string {
  const target = safeNext(returnTo);
  if (target === SAFE_NEXT_FALLBACK) return base;
  return `${base}?returnTo=${encodeURIComponent(target)}`;
}
