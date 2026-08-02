/**
 * `safeNext` — the open-redirect gate.
 *
 * Every hostile input below is a real, published bypass for the naive check this
 * function replaced (`value.startsWith("/")`, or `startsWith("/") &&
 * !startsWith("//")`). They are enumerated rather than fuzzed because each one
 * fails for a *different* reason, and a regression that re-admits exactly one of
 * them should name which one.
 */
import { describe, it, expect } from "vitest";
import {
  safeNext,
  signInHref,
  SAFE_NEXT_FALLBACK,
} from "@/lib/supabase/safe-next";

describe("safeNext — accepts same-origin paths", () => {
  const accepted = [
    "/",
    "/profile",
    "/arena/run-the-table",
    "/arena/ranked/apex_1y",
    "/play/daily",
    "/arena/run-the-table?mode=daily",
    "/rankings?duration=3",
    "/daily/grid#board",
    "/c/abc123",
    // Percent-encoded characters that decode to something still path-shaped.
    "/players/luka-don%C4%8Di%C4%87",
  ];

  for (const value of accepted) {
    it(`keeps ${JSON.stringify(value)} verbatim`, () => {
      expect(safeNext(value)).toBe(value);
    });
  }

  it("trims surrounding whitespace rather than rejecting", () => {
    expect(safeNext("  /profile  ")).toBe("/profile");
  });
});

describe("safeNext — rejects everything cross-origin", () => {
  const rejected: ReadonlyArray<readonly [string, string]> = [
    // The four the brief names explicitly.
    ["//evil.example", "protocol-relative URL"],
    ["/\\evil.example", "backslash that browsers normalise to //"],
    ["\\\\evil.example", "UNC-style double backslash"],
    ["https://evil.example", "absolute URL with a scheme"],

    // The rest of the same families.
    ["//evil.example/profile", "protocol-relative with a path"],
    ["///evil.example", "triple slash"],
    ["/\\/evil.example", "mixed slash/backslash"],
    ["/\\\\evil.example", "slash then double backslash"],
    ["\\/evil.example", "backslash then slash"],
    ["http://evil.example", "http scheme"],
    ["HTTPS://EVIL.EXAMPLE", "uppercase scheme"],
    ["javascript:alert(1)", "javascript: scheme"],
    ["JaVaScRiPt:alert(1)", "mixed-case javascript: scheme"],
    ["data:text/html;base64,PHNjcmlwdD4=", "data: scheme"],
    ["vbscript:msgbox(1)", "vbscript: scheme"],
    ["file:///etc/passwd", "file: scheme"],
    ["mailto:someone@evil.example", "mailto: scheme"],

    // Encoded forms — rejected only because the decode loop re-checks.
    ["/%2f%2fevil.example", "single-encoded //"],
    ["/%2F%2Fevil.example", "single-encoded // uppercase"],
    ["/%252f%252fevil.example", "double-encoded //"],
    ["/%5Cevil.example", "encoded backslash"],
    ["/%5c%5cevil.example", "encoded double backslash"],

    // Parser desync via control characters.
    ["/\n//evil.example", "embedded newline"],
    ["/\r//evil.example", "embedded carriage return"],
    ["/\t//evil.example", "embedded tab"],
    ["\t//evil.example", "leading tab before //"],
    ["/\u0000//evil.example", "embedded NUL"],
    ["java\nscript:alert(1)", "scheme split by a newline"],

    // Not a path at all.
    ["evil.example", "bare host"],
    ["profile", "relative path with no leading slash"],
    ["", "empty string"],
    ["   ", "whitespace only"],
    ["/%", "malformed percent escape"],
    ["/%zz", "invalid percent escape"],
  ];

  for (const [value, why] of rejected) {
    it(`rejects ${JSON.stringify(value)} (${why})`, () => {
      expect(safeNext(value)).toBe(SAFE_NEXT_FALLBACK);
    });
  }

  it("rejects null and undefined", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext(undefined)).toBe("/");
  });

  it("never throws, whatever it is handed", () => {
    for (const value of ["/%E0%A4%A", "/\uD800", "/".repeat(5000)]) {
      expect(() => safeNext(value)).not.toThrow();
    }
  });
});

describe("safeNext — the fallback", () => {
  it("honours a safe custom fallback", () => {
    expect(safeNext("https://evil.example", "/arena")).toBe("/arena");
  });

  it("refuses an unsafe fallback and uses `/` instead", () => {
    // A caller that passes a hostile fallback must not be able to launder it
    // through this function.
    expect(safeNext(null, "https://evil.example")).toBe("/");
    expect(safeNext("//evil.example", "//also-evil.example")).toBe("/");
  });
});

describe("signInHref", () => {
  it("carries a safe destination, encoded", () => {
    expect(signInHref("/arena/ranked/apex_1y")).toBe(
      "/signin?returnTo=%2Farena%2Franked%2Fapex_1y",
    );
  });

  it("encodes a query string in the destination so it survives the round trip", () => {
    expect(signInHref("/arena/run-the-table?mode=daily")).toBe(
      "/signin?returnTo=%2Farena%2Frun-the-table%3Fmode%3Ddaily",
    );
  });

  it("drops a hostile destination rather than passing it on", () => {
    expect(signInHref("https://evil.example")).toBe("/signin");
    expect(signInHref("//evil.example")).toBe("/signin");
  });

  it("omits the parameter entirely when the destination is the homepage", () => {
    expect(signInHref("/")).toBe("/signin");
    expect(signInHref(null)).toBe("/signin");
  });
});
