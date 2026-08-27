import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

// Mock next/font/local — the faces are self-hosted via @fontsource-variable
// rather than fetched from Google at build time (see app/layout.tsx).
vi.mock("next/font/local", () => ({
  default: (opts: { variable?: string }) => ({
    variable: opts?.variable ?? "--font-local",
    className: "local-font",
  }),
}));

// Mock ResizeObserver — jsdom does not implement it at all (unlike
// getBoundingClientRect, which exists but always returns zeros). Needed by
// `PeakV2TMWCourts` (TMW viewport containment, final closure pass): it
// observes its own header block to keep the scrollable court region's
// height cap correct as the header's real height changes. `observe`/
// `disconnect` are enough for tests -- none currently assert on a fired
// resize callback, only on the synchronous `getBoundingClientRect()`-based
// initial measurement the component also does.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver = ResizeObserverMock;

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });
