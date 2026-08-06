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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const { getAccessToken } = vi.hoisted(() => ({ getAccessToken: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAccessToken }));

import {
  nextThemePreference,
  setThemePreference,
  themeInitScript,
  THEME_STORAGE_KEY,
  useAccountThemeSync,
  useResolvedTheme,
  useTheme,
  useThemePreference,
  __resetThemeStoreForTests,
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
  getAccessToken.mockReset().mockResolvedValue(null); // signed out unless a test says otherwise
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
  vi.unstubAllGlobals();
});

describe("useThemePreference / setThemePreference", () => {
  // Launch-polish IMPLEMENTATION_CONTRACT.md §2: new/signed-out users
  // default to Dark, not System. System is still fully choosable (see
  // "honors an explicitly stored 'system' preference" below) -- only the
  // NO-preference-stored fallback changed.
  it("defaults to dark with nothing stored", () => {
    const { result } = renderHook(() => useThemePreference());
    expect(result.current).toBe("dark");
  });

  it("reads a previously stored preference on first use", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    const { result } = renderHook(() => useThemePreference());
    expect(result.current).toBe("light");
  });

  it("honors an explicitly stored 'system' preference and still follows the OS", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "system");
    mockMatchMedia(true);
    const { result: pref } = renderHook(() => useThemePreference());
    expect(pref.current).toBe("system");
    const { result: resolved } = renderHook(() => useResolvedTheme());
    expect(resolved.current).toBe("light");
  });

  it("ignores a corrupt stored value rather than throwing, falling back to dark", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    const { result } = renderHook(() => useThemePreference());
    expect(result.current).toBe("dark");
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
  // Both tests below set an explicit "system" preference first -- nothing-
  // stored now defaults to "dark" (§2), which would make these pass
  // vacuously (dark resolves to dark regardless of matchMedia) if they
  // relied on the old system-by-default behavior instead.
  it("resolves 'system' against prefers-color-scheme: light -> light", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "system");
    mockMatchMedia(true);
    const { result } = renderHook(() => useResolvedTheme());
    expect(result.current).toBe("light");
  });

  it("resolves 'system' with no light match -> dark", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "system");
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
    expect(result.current.preference).toBe("dark");
    expect(result.current.resolved).toBe("dark");
    act(() => result.current.setPreference("light"));
    expect(result.current.preference).toBe("light");
    expect(result.current.resolved).toBe("light");
  });
});

describe("nextThemePreference", () => {
  // THE REGRESSION THAT MATTERS. This used to cycle System -> Dark -> Light ->
  // System, three preferences over a two-state appearance, so from "light" the
  // next preference was "system" -- which on a light-mode OS resolves straight
  // back to light and changes nothing visible. Light -> Dark therefore took two
  // clicks while Dark -> Light took one. The input is now the RESOLVED theme and
  // the output is always an explicit preference for the other one.
  it("always names the appearance you are not currently in", () => {
    expect(nextThemePreference("dark")).toBe("light");
    expect(nextThemePreference("light")).toBe("dark");
  });

  it("never returns 'system', so no click can be a visual no-op", () => {
    expect(nextThemePreference("dark")).not.toBe("system");
    expect(nextThemePreference("light")).not.toBe("system");
  });
});

describe("one click flips the theme in both directions", () => {
  /** Drives the real store the way the header toggle does. */
  function clickToggleOnce(): void {
    const resolved = document.documentElement.getAttribute("data-theme") === "light"
      ? "light"
      : "dark";
    act(() => setThemePreference(nextThemePreference(resolved)));
  }

  for (const systemLight of [true, false]) {
    it(`alternates cleanly for twenty cycles with a ${
      systemLight ? "light" : "dark"
    }-mode OS`, () => {
      mockMatchMedia(systemLight);
      __resetThemeStoreForTests();
      const { result } = renderHook(() => useResolvedTheme());
      // Establish a known starting appearance without relying on the default.
      act(() => setThemePreference("dark"));
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

      const seen: string[] = [];
      for (let i = 0; i < 40; i += 1) {
        clickToggleOnce();
        seen.push(document.documentElement.getAttribute("data-theme") ?? "?");
      }

      // Forty clicks, forty flips, starting from dark: light, dark, light...
      // A single repeated value anywhere in this list is the two-click defect.
      expect(seen).toEqual(
        Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? "light" : "dark")),
      );
      expect(result.current).toBe("dark");
    });
  }

  it("an explicit choice survives a light-mode OS (never re-resolved)", () => {
    mockMatchMedia(true);
    __resetThemeStoreForTests();
    act(() => setThemePreference("dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
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

  // Launch-polish IMPLEMENTATION_CONTRACT.md §2: "The blocking pre-paint
  // script and the resolver must change together -- a mismatch is exactly
  // what produces a wrong-theme flash." These two tests execute the actual
  // script (not just grep its source, like the tests above) against a
  // simulated fresh page, so a future edit to only one half of the pair
  // fails here instead of shipping a flash.
  it("resolves to dark, matching the resolver's default, when nothing is stored", () => {
    mockMatchMedia(true); // OS prefers light -- must NOT win when nothing is stored
    new Function(themeInitScript())();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("still follows the OS when 'system' was explicitly stored, matching the resolver", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "system");
    mockMatchMedia(true);
    new Function(themeInitScript())();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});

// Launch-polish IMPLEMENTATION_CONTRACT.md §2: "apply to documentElement
// synchronously, persist locally immediately, save to the account
// asynchronously in the background, and a failed account save must never
// revert the visible theme."
describe("account preference sync", () => {
  it("setThemePreference applies and persists locally BEFORE the account save even starts", () => {
    // getAccessToken is signed-out (mocked null by default) and would
    // reject if awaited synchronously -- if the local apply depended on
    // it in any way, this would already be wrong by the time the
    // assertions below run.
    act(() => setThemePreference("light"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("does not call the account endpoint while signed out", async () => {
    act(() => setThemePreference("light"));
    // Let any pending microtasks (the fire-and-forget save's own
    // `getAccessToken` await) flush.
    await Promise.resolve();
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("saves to the account in the background when signed in, without blocking or reverting on failure", async () => {
    getAccessToken.mockResolvedValue("fake-token");
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));
    act(() => setThemePreference("light"));
    // Applied and persisted locally immediately, synchronously -- not
    // waiting on the (failing) network call above.
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/api/v1/profiles/me/settings");
    expect(init).toMatchObject({
      method: "PUT",
      headers: expect.objectContaining({ Authorization: "Bearer fake-token" }),
    });
    expect(JSON.parse(init.body)).toEqual({ theme_preference: "light" });
    // The endpoint rejected -- confirm the visible theme is UNCHANGED by
    // that failure (still "light", not reverted to anything else).
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  describe("useAccountThemeSync", () => {
    it("does nothing while signed out", async () => {
      renderHook(() => useAccountThemeSync(false));
      await Promise.resolve();
      expect(fetch).not.toHaveBeenCalled();
    });

    it("pulls the account's saved preference onto this device on sign-in", async () => {
      getAccessToken.mockResolvedValue("fake-token");
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ timezone: "UTC", reduced_motion: false, theme_preference: "light" }),
      });
      renderHook(() => useAccountThemeSync(true));
      await waitFor(() => expect(document.documentElement.getAttribute("data-theme")).toBe("light"));
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    });

    it("leaves the local theme alone when the account has no saved preference yet", async () => {
      getAccessToken.mockResolvedValue("fake-token");
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ timezone: "UTC", reduced_motion: false }), // no theme_preference field
      });
      renderHook(() => useAccountThemeSync(true));
      await waitFor(() => expect(fetch).toHaveBeenCalled());
      await Promise.resolve();
      // Default (dark, nothing stored) is untouched -- no field to reconcile against.
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    });

    it("only fetches once per sign-in, not on every re-render", async () => {
      getAccessToken.mockResolvedValue("fake-token");
      const { rerender } = renderHook(({ signedIn }) => useAccountThemeSync(signedIn), {
        initialProps: { signedIn: true },
      });
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      rerender({ signedIn: true });
      rerender({ signedIn: true });
      await Promise.resolve();
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });
});
