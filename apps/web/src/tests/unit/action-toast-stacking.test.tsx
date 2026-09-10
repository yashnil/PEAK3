/**
 * The Undo toast has to be physically tappable while the next round's
 * chooser sheet is open.
 *
 * That is the whole point of the toast: `handlePlace` commits immediately and
 * the chooser for the next round opens on top of the board, so the ONLY
 * window in which Undo is offered is a window in which a full-screen dialog
 * is also on screen. On a phone the sheet covers the viewport, so "offered"
 * and "reachable" are the same claim or the feature does not exist.
 *
 * The e2e guard for this (`@mobile Undo is reachable and activatable by a
 * real tap`, courtbuilder.spec.ts) needs a browser, a real touch device and a
 * live API. It has now caught the SAME defect twice from two different
 * directions — first when V2's chooser adopted a higher-z-index dialog
 * primitive, then when `.pk-arena-room` wrapped the page in `isolation:
 * isolate` and sealed the toast into a stacking context below the dialog's
 * body-level portal, at which point no z-index the toast could name would
 * have helped.
 *
 * Both times the mechanism was structural and cheap to state: the toast and
 * the dialog must end up in the SAME stacking context, which means the toast
 * must escape the page tree exactly the way `Dialog` does. This pins that
 * mechanism where it costs a millisecond instead of a browser.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

import ActionToast from "@/components/court/ActionToast";

const ROOM_CSS = fs.readFileSync(
  path.join(process.cwd(), "src/styles/v2/arena-room.css"),
  "utf8",
);

function renderInsideTheRoom() {
  // The real ancestry: `(main)/layout.tsx` renders every page inside
  // `.pk-arena-room`, and the toast is declared deep inside that page tree by
  // `CourtBuilder`.
  const room = document.createElement("div");
  room.className = "pk-arena-room";
  document.body.appendChild(room);
  const page = document.createElement("div");
  room.appendChild(page);
  render(
    <ActionToast
      message="Placed Buck Johnson"
      actionLabel="Undo"
      onAction={() => {}}
      onDismiss={() => {}}
    />,
    { container: page },
  );
  return room;
}

describe("ActionToast stacking", () => {
  it("escapes the arena room's stacking context instead of rendering in place", () => {
    const room = renderInsideTheRoom();
    const toast = screen.getByTestId("court-action-toast");

    // The assertion that matters: NOT inside the isolated wrapper. Inside it,
    // the toast's z-index is scoped to a context that paints below the
    // body-level dialog portal, and a real finger lands on the sheet.
    expect(room.contains(toast)).toBe(false);
    expect(toast.parentElement).toBe(document.body);
  });

  it("outranks the dialog primitive it has to be tapped over", () => {
    renderInsideTheRoom();
    const toast = screen.getByTestId("court-action-toast");

    // Same context (both at `document.body` now), so the numbers finally
    // order them. `Dialog` uses `var(--pk-z-dialog, 110)`; the toast must be
    // above that fallback and above the token itself.
    expect(toast.className).toContain("z-[120]");
    const dialogZ = Number(
      /--pk-z-dialog:\s*(\d+)/.exec(
        fs.readFileSync(path.join(process.cwd(), "src/styles/globals.css"), "utf8"),
      )![1],
    );
    expect(dialogZ).toBeLessThan(120);
  });

  it("keeps the isolation that made escaping necessary", () => {
    // The other half of the contract, stated so the next person does not
    // "fix" a stacking bug by deleting this instead. The room's backdrop is
    // `z-index: -1`; without `isolation: isolate` on the wrapper it paints
    // behind the page background and the room disappears.
    expect(ROOM_CSS).toMatch(/\.pk-arena-room\s*\{[^}]*isolation:\s*isolate/);
    expect(ROOM_CSS).toMatch(/\.pk-arena-backdrop\s*\{[^}]*z-index:\s*-1/);
  });
});
