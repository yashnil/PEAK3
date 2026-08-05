/**
 * profile-api client (launch-polish §8).
 *
 * Covers the error-shape parsing specifically: apps/api/app/api/v1/profiles.py
 * returns three DIFFERENT detail shapes across its own error paths -- a plain
 * string ("handle_taken"), an object ({error_code, message}, used elsewhere in
 * this codebase's newer routes), and FastAPI's default 422 validation list
 * ([{loc, msg, type}], which is what a pydantic ValueError on the handle
 * field actually produces). A caller that only handles one shape silently
 * shows "Request failed." for the other two -- exactly the case that matters
 * most, since the 422 shape is what carries the actual "why" (reserved word,
 * impersonation guard, too short, etc.) a player needs to see.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { fetchProfile, updateProfile, ProfileAPIError, handleLooksValid } from "@/lib/profile-api";

const realFetch = global.fetch;

function mockResponse(status: number, body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

afterEach(() => {
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("profile-api client — error shapes", () => {
  it("surfaces a plain-string detail (handle_taken)", async () => {
    mockResponse(409, { detail: "handle_taken" });
    await expect(updateProfile("t", { handle: "x" })).rejects.toMatchObject({
      status: 409,
      message: "handle_taken",
    });
  });

  it("surfaces an {error_code, message} object detail (handle_required)", async () => {
    mockResponse(400, {
      detail: { error_code: "handle_required", message: "Set a public handle before submitting to the leaderboard." },
    });
    await expect(fetchProfile("t")).rejects.toMatchObject({
      status: 400,
      code: "handle_required",
      message: "Set a public handle before submitting to the leaderboard.",
    });
  });

  it("surfaces FastAPI's default 422 validation-list detail", async () => {
    mockResponse(422, {
      detail: [
        {
          loc: ["body", "handle"],
          msg: "Value error, Handle must be 3-20 characters, start/end with a letter or digit, and contain only letters, digits, and underscores.",
          type: "value_error",
        },
      ],
    });
    await expect(updateProfile("t", { handle: "a" })).rejects.toMatchObject({ status: 422 });
    try {
      await updateProfile("t", { handle: "a" });
    } catch (e) {
      expect(e).toBeInstanceOf(ProfileAPIError);
      expect((e as ProfileAPIError).message).toMatch(/3-20 characters/);
    }
  });

  it("falls back to a generic message when detail is unrecognizable", async () => {
    mockResponse(500, {});
    await expect(fetchProfile("t")).rejects.toMatchObject({ status: 500 });
  });
});

describe("handleLooksValid — client-side hint, mirrors HANDLE_RE", () => {
  it.each(["abc", "a_b_c", "playoffs99", "u" + "b".repeat(18)])("accepts %s", (h) => {
    expect(handleLooksValid(h)).toBe(true);
  });

  it.each([
    "ab", // too short
    "_abc", // leading underscore
    "abc_", // trailing underscore
    "a".repeat(21), // too long
    "has space",
    "HAS-DASH",
  ])("rejects %s", (h) => {
    expect(handleLooksValid(h)).toBe(false);
  });

  it("is case-insensitive the same way the server normalizes to lowercase", () => {
    expect(handleLooksValid("MixedCase123")).toBe(true);
  });
});
