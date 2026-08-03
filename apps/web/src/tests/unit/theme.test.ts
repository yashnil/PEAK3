/**
 * Theme system (P3-G): System / Dark / Light persistence, resolution against
 * `prefers-color-scheme`, the header-toggle cycle order, and the blocking
 * inline script's content.
 *
 * jsdom notes: `window.matchMedia` does not exist in jsdom, so it is
 * installed here — same stub shape `ui-primitives.test.tsx` already uses for
 * `prefers-reduced-motion`, generalized to answer `(prefers-color-scheme:
 * light)` too.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import {
  nextThemePreference,
  setThemePreference,
  themeInitScript,
  THEME_STORAGE_KEY,
  useResolvedTheme,
  useTheme,
  useThemePreference,
  __resetThemeStoreForTests,
  type ThemePreference,
} from "@/lib/theme";

/** `systemLight = true` answers `(prefers-color-scheme: light)` as matching. */
function mockMatchMedia(systemLight: boolean) {
  type Listener = (event: MediaQueryListEvent) => void;
  const listeners = new Set<Listener>();
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-color-scheme: light") ? systemLight : false,
      media: query,
      onchange: null,
      addEventListener: (_: string, cb: Listener) => listeners.add(cb),
      removeEventListener: (_: string, cb: Listener) => listeners.delete(cb),
      addListener: (cb: Listener) => listeners.add(cb),
      removeListener: (cb: Listener) => listeners.delete(cb),
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => {
  window.localStorage.clear();
  __resetThemeStoreForTests();
  mockMatchMedia(false); // system = dark, unless a test says otherwise
});

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
});

describe("useThemePreference / setThemePreference", () => {
  it("defaults to system with nothing stored", () => {
    const { result } = renderHook(() => useThemePreference());
    expect(result.current).toBe("system");
  });

  it("reads a previously stored preference on first use", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    const { result } = renderHook(() => useThemePreference());
    expect(result.current).toBe("light");
  });

  it("ignores a corrupt stored value rather than throwing", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    const { result } = renderHook(() => useThemePreference());
    expect(result.current).toBe("system");
  });

  it("persists an explicit choice and reflects it back", () => {
    const { result } = renderHook(() => useThemePreference());
    act(() => setThemePreference("dark"));
    expect(result.current).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("sets data-theme and colorScheme on <html> as a side effect", () => {
    act(() => setThemePreference("light"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("survives localStorage being unavailable", () => {
    const original = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error("quota exceeded");
    };
    expect(() => setThemePreference("dark")).not.toThrow();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    window.localStorage.setItem = original;
  });
});

describe("useResolvedTheme", () => {
  it("resolves 'system' against prefers-color-scheme: light -> light", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useResolvedTheme());
    expect(result.current).toBe("light");
  });

  it("resolves 'system' with no light match -> dark", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useResolvedTheme());
    expect(result.current).toBe("dark");
  });

  it("an explicit 'dark' choice is never overridden by system light", () => {
    mockMatchMedia(true);
    act(() => setThemePreference("dark"));
    const { result } = renderHook(() => useResolvedTheme());
    expect(result.current).toBe("dark");
  });
});

describe("useTheme", () => {
  it("exposes preference, resolved, and a working setter together", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe("system");
    expect(result.current.resolved).toBe("dark");
    act(() => result.current.setPreference("light"));
    expect(result.current.preference).toBe("light");
    expect(result.current.resolved).toBe("light");
  });
});

describe("nextThemePreference", () => {
  it("cycles system -> dark -> light -> system", () => {
    const order: ThemePreference[] = ["system", "dark", "light"];
    let current: ThemePreference = "system";
    const seen: ThemePreference[] = [current];
    for (let i = 0; i < 3; i += 1) {
      current = nextThemePreference(current);
      seen.push(current);
    }
    expect(seen).toEqual([...order, "system"]);
  });
});

describe("themeInitScript", () => {
  it("references the real storage key and the data-theme attribute", () => {
    const src = themeInitScript();
    expect(src).toContain(THEME_STORAGE_KEY);
    expect(src).toContain("data-theme");
    expect(src).toContain("prefers-color-scheme: light");
    expect(src).toContain("colorScheme");
  });

  it("is wrapped in try/catch so a throw can never blank the page", () => {
    const src = themeInitScript();
    expect(src.trim().startsWith("(function(){try{")).toBe(true);
    expect(src.trim().endsWith("}catch(e){}})();")).toBe(true);
  });

  it("is actually valid, executable JS", () => {
    // The strongest guarantee available without a real browser: `new
    // Function` throws a SyntaxError on malformed JS, so this catches a
    // broken template before it ever ships as an inline <script>.
    expect(() => new Function(themeInitScript())).not.toThrow();
  });
});
