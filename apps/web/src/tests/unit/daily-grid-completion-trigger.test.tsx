/**
 * `CompletionTrigger.tsx` had zero dedicated test coverage before the final
 * RC audit — added alongside the audit's fix for a real, confirmed defect:
 * the trigger is `position: fixed` a constant distance from the viewport's
 * bottom edge, and the site footer is ordinary in-flow content at the true
 * end of the page, so scrolling all the way down put the pill on top of the
 * footer at every viewport width (worst at 390px). The fix hides the pill
 * via `IntersectionObserver` exactly when the footer it would otherwise
 * cover is on screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CompletionTrigger from "@/components/daily-grid/CompletionTrigger";
import { completedProgress, gridResult } from "./daily-grid-fixtures";

/** Captures the real callback/options an observer was constructed with, and
 *  lets a test fire it manually — jsdom implements no IntersectionObserver
 *  at all, so a real one is never available to fall back to here. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  options: IntersectionObserverInit | undefined;
  observed: Element[] = [];
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    FakeIntersectionObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
  fire(isIntersecting: boolean) {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

function renderTrigger(onOpen = vi.fn()) {
  const utils = render(
    <CompletionTrigger progress={completedProgress()} result={gridResult()} onOpen={onOpen} />,
  );
  return { ...utils, onOpen };
}

describe("CompletionTrigger", () => {
  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the result summary and reopens the recap on click", async () => {
    const user = userEvent.setup();
    const { onOpen } = renderTrigger();
    const trigger = screen.getByTestId("daily-grid-completion-trigger");
    expect(trigger).toHaveTextContent(String(gridResult().user_total));
    await user.click(trigger);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("stays visible with no footer in the document (e.g. this isolated render)", () => {
    // No <footer> exists in this render tree, so the observer never has
    // anything to watch -- the trigger must default to visible rather than
    // silently hiding because it found nothing.
    renderTrigger();
    const trigger = screen.getByTestId("daily-grid-completion-trigger");
    expect(trigger).toHaveAttribute("data-footer-visible", "false");
    expect(trigger).not.toHaveAttribute("aria-hidden");
  });

  it("hides once the page footer scrolls into view, and returns when it scrolls back out", () => {
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    const footer = document.createElement("footer");
    document.body.appendChild(footer);
    try {
      renderTrigger();
      const trigger = screen.getByTestId("daily-grid-completion-trigger");
      expect(trigger).toHaveAttribute("data-footer-visible", "false");

      const observer = FakeIntersectionObserver.instances.at(-1)!;
      expect(observer.observed).toContain(footer);

      act(() => observer.fire(true));
      expect(trigger).toHaveAttribute("data-footer-visible", "true");
      expect(trigger).toHaveAttribute("aria-hidden", "true");
      expect(trigger).toHaveAttribute("tabIndex", "-1");
      expect(trigger.style.opacity).toBe("0");
      expect(trigger.style.pointerEvents).toBe("none");

      act(() => observer.fire(false));
      expect(trigger).toHaveAttribute("data-footer-visible", "false");
      expect(trigger).not.toHaveAttribute("aria-hidden");
      expect(trigger.style.opacity).toBe("1");
    } finally {
      document.body.removeChild(footer);
    }
  });
});
