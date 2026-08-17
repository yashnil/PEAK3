/**
 * PEAK3 V2 UI-version switch (Pass 2, product-direction): the mechanism
 * `?ui=v2`/`?ui=legacy` and the local dev switch use to pick a
 * presentation without duplicating any game/domain state.
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
  it("defaults to legacy when nothing has set the attribute", () => {
    const { result } = renderHook(() => useUiVersion());
    expect(result.current).toBe("legacy");
  });

  it("reads whatever data-ui-version is already on <html> (as the blocking script would have set it)", () => {
    document.documentElement.setAttribute(UI_VERSION_ATTR, "v2");
    const { result } = renderHook(() => useUiVersion());
    expect(result.current).toBe("v2");
  });

  it("ignores a corrupt attribute value, falling back to legacy", () => {
    document.documentElement.setAttribute(UI_VERSION_ATTR, "garbage");
    const { result } = renderHook(() => useUiVersion());
    expect(result.current).toBe("legacy");
  });

  it("setUiVersion updates the attribute, persists to storage, and notifies subscribers", () => {
    const { result } = renderHook(() => useUiVersion());
    expect(result.current).toBe("legacy");
    act(() => setUiVersion("v2"));
    expect(result.current).toBe("v2");
    expect(document.documentElement.getAttribute(UI_VERSION_ATTR)).toBe("v2");
    expect(window.localStorage.getItem(UI_VERSION_STORAGE_KEY)).toBe("v2");
  });

  it("switching back to legacy is symmetric", () => {
    const { result } = renderHook(() => useUiVersion());
    act(() => setUiVersion("v2"));
    act(() => setUiVersion("legacy"));
    expect(result.current).toBe("legacy");
    expect(document.documentElement.getAttribute(UI_VERSION_ATTR)).toBe("legacy");
  });
});

describe("uiVersionInitScript", () => {
  it("references the real storage key and the data-ui-version attribute", () => {
    const src = uiVersionInitScript();
    expect(src).toContain(UI_VERSION_STORAGE_KEY);
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

  it("SAFETY: resolves to legacy when nothing is stored and no ?ui= is present", () => {
    new Function(uiVersionInitScript())();
    expect(document.documentElement.getAttribute(UI_VERSION_ATTR)).toBe("legacy");
  });

  it("a stored v2 preference is honored on a plain navigation", () => {
    window.localStorage.setItem(UI_VERSION_STORAGE_KEY, "v2");
    new Function(uiVersionInitScript())();
    expect(document.documentElement.getAttribute(UI_VERSION_ATTR)).toBe("v2");
  });

  it("?ui=v2 activates V2 even with no prior stored preference", () => {
    window.history.replaceState({}, "", "/?ui=v2");
    new Function(uiVersionInitScript())();
    expect(document.documentElement.getAttribute(UI_VERSION_ATTR)).toBe("v2");
  });

  it("?ui=v2 persists the choice to localStorage for subsequent navigations", () => {
    window.history.replaceState({}, "", "/?ui=v2");
    new Function(uiVersionInitScript())();
    expect(window.localStorage.getItem(UI_VERSION_STORAGE_KEY)).toBe("v2");
  });

  it("?ui= on this load wins over a DIFFERENT previously-stored preference", () => {
    window.localStorage.setItem(UI_VERSION_STORAGE_KEY, "v2");
    window.history.replaceState({}, "", "/?ui=legacy");
    new Function(uiVersionInitScript())();
    expect(document.documentElement.getAttribute(UI_VERSION_ATTR)).toBe("legacy");
    expect(window.localStorage.getItem(UI_VERSION_STORAGE_KEY)).toBe("legacy");
  });

  it("an invalid ?ui= value is ignored, falling back to the stored preference", () => {
    window.localStorage.setItem(UI_VERSION_STORAGE_KEY, "v2");
    window.history.replaceState({}, "", "/?ui=nonsense");
    new Function(uiVersionInitScript())();
    expect(document.documentElement.getAttribute(UI_VERSION_ATTR)).toBe("v2");
  });

  it("a corrupt stored value with no ?ui= falls back to legacy, never v2", () => {
    window.localStorage.setItem(UI_VERSION_STORAGE_KEY, "sepia");
    new Function(uiVersionInitScript())();
    expect(document.documentElement.getAttribute(UI_VERSION_ATTR)).toBe("legacy");
  });
});
