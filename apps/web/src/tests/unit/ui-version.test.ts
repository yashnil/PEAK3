/**
 * PEAK3 V2 UI-version switch (Pass 3, product-direction: V2-only cutover).
 * V2 reached full parity with legacy across every real user-facing route and
 * game mode; every legacy JSX branch has since been deleted at its call
 * site, and the blocking init script now unconditionally resolves `"v2"` —
 * `?ui=` and any stored preference are no longer read at all, since
 * `data-ui-version="v2"` is load-bearing for several V2-only stylesheets
 * (e.g. `styles/v2/rtt-result.css`) and a stray pre-cutover `"legacy"` value
 * left in a visitor's localStorage must never be able to break that
 * styling again.
 *
 * `setUiVersion`/`useUiVersion` remain as the mechanism the local dev switch
 * (`UiVersionDevSwitch`, gated behind `NEXT_PUBLIC_PEAK3_UI_VERSION_SWITCH`,
 * unset in every real deployment) and tests use to flip the DOM attribute
 * client-side — that choice never survives a fresh navigation, since the
 * init script always re-resolves to `"v2"`.
 *
 * Mirrors `theme.test.ts`'s structure for the blocking-script tests: the
 * actual script string is executed via `new Function(...)`, not
 * re-implemented as a second, parallel resolver that could silently drift
 * from what actually ships in `<head>`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  setUiVersion,
  useUiVersion,
  UI_VERSION_STORAGE_KEY,
  uiVersionInitScript,
  __resetUiVersionStoreForTests,
} from "@/lib/ui-version";
import { UI_VERSION_ATTR } from "@/lib/ui-version-script";

beforeEach(() => {
  window.localStorage.clear();
  __resetUiVersionStoreForTests();
  document.documentElement.removeAttribute(UI_VERSION_ATTR);
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  document.documentElement.removeAttribute(UI_VERSION_ATTR);
  window.history.replaceState({}, "", "/");
});

describe("useUiVersion", () => {
  it("defaults to v2 when nothing has set the attribute", () => {
    const { result } = renderHook(() => useUiVersion());
    expect(result.current).toBe("v2");
  });

  it("reads whatever data-ui-version is already on <html> (as the blocking script would have set it)", () => {
    document.documentElement.setAttribute(UI_VERSION_ATTR, "v2");
    const { result } = renderHook(() => useUiVersion());
    expect(result.current).toBe("v2");
  });

  it("ignores a corrupt attribute value, falling back to v2", () => {
    document.documentElement.setAttribute(UI_VERSION_ATTR, "garbage");
    const { result } = renderHook(() => useUiVersion());
    expect(result.current).toBe("v2");
  });

  it("setUiVersion updates the attribute, persists to storage, and notifies subscribers — the local dev switch's mechanism", () => {
    const { result } = renderHook(() => useUiVersion());
    expect(result.current).toBe("v2");
    act(() => setUiVersion("legacy"));
    expect(result.current).toBe("legacy");
    expect(document.documentElement.getAttribute(UI_VERSION_ATTR)).toBe("legacy");
    expect(window.localStorage.getItem(UI_VERSION_STORAGE_KEY)).toBe("legacy");
  });

  it("switching back to v2 is symmetric", () => {
    const { result } = renderHook(() => useUiVersion());
    act(() => setUiVersion("legacy"));
    act(() => setUiVersion("v2"));
    expect(result.current).toBe("v2");
    expect(document.documentElement.getAttribute(UI_VERSION_ATTR)).toBe("v2");
  });
});

describe("uiVersionInitScript", () => {
  it("references the data-ui-version attribute", () => {
    const src = uiVersionInitScript();
    expect(src).toContain(UI_VERSION_ATTR);
  });

  it("is wrapped in try/catch so a throw can never blank the page", () => {
    const src = uiVersionInitScript();
    expect(src.trim().startsWith("(function(){try{")).toBe(true);
    expect(src.trim().endsWith("}catch(e){}})();")).toBe(true);
  });

  it("is actually valid, executable JS", () => {
    expect(() => new Function(uiVersionInitScript())).not.toThrow();
  });

  // These execute the ACTUAL script (not a parallel hand-written resolver),
  // so a future edit that changes only the script and not this file's
  // expectations fails here — the same discipline `theme.test.ts` applies
  // to `themeInitScript`.

  it("SAFETY: always resolves to v2 when nothing is stored and no ?ui= is present", () => {
    new Function(uiVersionInitScript())();
    expect(document.documentElement.getAttribute(UI_VERSION_ATTR)).toBe("v2");
  });

  it("a stored legacy preference from before the cutover is ignored — still resolves to v2", () => {
    window.localStorage.setItem(UI_VERSION_STORAGE_KEY, "legacy");
    new Function(uiVersionInitScript())();
    expect(document.documentElement.getAttribute(UI_VERSION_ATTR)).toBe("v2");
  });

  it("?ui=legacy in the URL is a no-op — still resolves to v2", () => {
    window.history.replaceState({}, "", "/?ui=legacy");
    new Function(uiVersionInitScript())();
    expect(document.documentElement.getAttribute(UI_VERSION_ATTR)).toBe("v2");
  });

  it("?ui=legacy does not write anything to storage", () => {
    new Function(uiVersionInitScript())();
    expect(window.localStorage.getItem(UI_VERSION_STORAGE_KEY)).toBeNull();
  });

  it("a corrupt stored value has no effect either — still resolves to v2", () => {
    window.localStorage.setItem(UI_VERSION_STORAGE_KEY, "sepia");
    new Function(uiVersionInitScript())();
    expect(document.documentElement.getAttribute(UI_VERSION_ATTR)).toBe("v2");
  });
});
