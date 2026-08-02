/**
 * Every API client that touches an owner-scoped route must send its cookie.
 *
 * This test exists because of a regression caught by the e2e suite, not by a
 * unit test: this pass added ownership checks to `POST /draft/games/{id}/actions`
 * (previously it accepted *any* caller, which is the P0 it closed), and
 * `lib/draft-api.ts` was the one client in the app that never set
 * `credentials: "include"`. Peak Draft games are owned by the `peak3_anon`
 * cookie the API sets on its own origin; without that flag the browser omits it
 * cross-origin, so every action a player took on their own game came back
 * 403 `not_your_game`.
 *
 * The gap was invisible before the fix — a route that accepts anyone does not
 * care whether you identified yourself. That is exactly the shape of bug worth
 * pinning: it only becomes reachable at the moment the security fix lands.
 *
 * `progression-api.ts` and `ranked-api.ts` are deliberately absent from the
 * list: their routes are `RequiredAuth` and they authenticate with an
 * `Authorization: Bearer` header, not the cookie. `api.ts` is absent because it
 * only calls public, ownerless routes (`/meta`, `/methodology`,
 * `/game/answer`).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const LIB = path.resolve(__dirname, "../../lib");

/** Clients whose routes are scoped by the `peak3_anon` cookie. */
const COOKIE_SCOPED_CLIENTS = [
  "draft-api.ts",
  "daily-grid-api.ts",
  "perfect-season-api.ts",
  "run-the-table-api.ts",
  "head-to-head-api.ts",
];

describe("API clients on owner-scoped routes", () => {
  it.each(COOKIE_SCOPED_CLIENTS)(
    "%s sends credentials so the ownership cookie reaches the API",
    (file) => {
      const source = fs.readFileSync(path.join(LIB, file), "utf8");
      expect(
        source.includes('credentials: "include"'),
        `${file} calls owner-scoped API routes but never sets credentials: "include". ` +
          "The peak3_anon cookie will not be sent cross-origin, and every request " +
          "against the caller's own resource will 403.",
      ).toBe(true);
    },
  );

  it("names a client that actually exists, so a rename cannot silently empty this test", () => {
    for (const file of COOKIE_SCOPED_CLIENTS) {
      expect(
        fs.existsSync(path.join(LIB, file)),
        `${file} is listed here but does not exist — rename it in this test too.`,
      ).toBe(true);
    }
  });
});
