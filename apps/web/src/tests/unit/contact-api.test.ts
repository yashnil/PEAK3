/**
 * contact-api client (launch-polish §9).
 *
 * Covers the 429 path (mirrors daily-grid-api.test.ts's own rate-limit
 * coverage: vague copy, no leaked countdown) and the same three-detail-shape
 * parsing profile-api.test.ts covers, since app/api/v1/contact.py can
 * return all three (plain string is not used today but the parser stays
 * defensive the same way profile-api's does).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { CONTACT_RATE_LIMITED_MESSAGE, ContactAPIError, submitContact } from "@/lib/contact-api";

const realFetch = global.fetch;

function mockResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(headers),
  }) as unknown as typeof fetch;
}

afterEach(() => {
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

const VALID_INPUT = {
  category: "bug" as const,
  subject: "Something broke",
  message: "Here is what happened.",
};

describe("contact-api client", () => {
  it("returns the accepted response on success", async () => {
    mockResponse(202, { request_id: "abc-123", accepted: true });
    const result = await submitContact(VALID_INPUT);
    expect(result).toEqual({ request_id: "abc-123", accepted: true });
  });

  it("sends credentials: include so the anon cookie identity persists", async () => {
    mockResponse(202, { request_id: "abc-123", accepted: true });
    await submitContact(VALID_INPUT);
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toMatchObject({ credentials: "include" });
  });

  it("attaches an Authorization header only when a token is given", async () => {
    mockResponse(202, { request_id: "abc-123", accepted: true });
    await submitContact(VALID_INPUT, "a-real-token");
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = call[1].headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer a-real-token");
  });

  it("omits Authorization entirely for a signed-out sender", async () => {
    mockResponse(202, { request_id: "abc-123", accepted: true });
    await submitContact(VALID_INPUT);
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = call[1].headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it("turns a 429 into the vague wait-a-while sentence, not the server's own message", async () => {
    mockResponse(429, { detail: { error_code: "rate_limited", message: "some server-specific text" } });
    await expect(submitContact(VALID_INPUT)).rejects.toThrow(CONTACT_RATE_LIMITED_MESSAGE);
  });

  it("does not leak a retry countdown in the thrown message", async () => {
    expect(CONTACT_RATE_LIMITED_MESSAGE).not.toMatch(/\d/);
  });

  it("keeps the machine-readable code so callers can branch on 429", async () => {
    mockResponse(429, { detail: { error_code: "rate_limited", message: "x" } });
    await expect(submitContact(VALID_INPUT)).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
    });
  });

  it("surfaces a plain-string detail", async () => {
    mockResponse(403, { detail: "contact_disabled" });
    await expect(submitContact(VALID_INPUT)).rejects.toMatchObject({
      status: 403,
      message: "contact_disabled",
    });
  });

  it("surfaces an {error_code, message} object detail", async () => {
    mockResponse(503, { detail: { error_code: "storage_unavailable", message: "Could not store your message right now." } });
    await expect(submitContact(VALID_INPUT)).rejects.toMatchObject({
      status: 503,
      code: "storage_unavailable",
      message: "Could not store your message right now.",
    });
  });

  it("surfaces FastAPI's default 422 validation-list detail", async () => {
    mockResponse(422, {
      detail: [{ loc: ["body", "message"], msg: "Value error, This field cannot be blank.", type: "value_error" }],
    });
    try {
      await submitContact(VALID_INPUT);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ContactAPIError);
      expect((e as ContactAPIError).message).toMatch(/cannot be blank/);
    }
  });

  it("always sends the honeypot field, defaulting to empty", async () => {
    mockResponse(202, { request_id: "abc-123", accepted: true });
    await submitContact(VALID_INPUT);
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(call[1].body as string);
    expect(body.website).toBe("");
  });
});
