/**
 * Session refresh, and the redirect URL the provider is handed.
 *
 * WHY REFRESH NEEDS A TEST. A Supabase access token lasts about an hour. Before
 * this pass the session lived in `localStorage`, which no server runtime can
 * see, so "is the session current on the server" was not a question the codebase
 * could even ask. Now that it is a cookie, the middleware is the only thing
 * keeping it fresh for Server Components and Route Handlers — and the failure
 * mode of getting the response-object dance wrong is users being logged out at
 * apparently random intervals, which is close to impossible to debug after the
 * fact. So the dance is pinned.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

// jsdom ships its own `Headers`, while a `NextRequest` carries undici's, so
// `NextResponse.next({ request })` — which asserts `headers instanceof Headers`
// against the *global* — fails under the default test environment for a reason
// that has nothing to do with the code under test. Restoring the runtime
// `Headers` (the one production actually uses on the Edge) is the narrow fix;
// swapping the whole file to the node environment is not, because the shared
// `tests/setup.ts` touches `window`.
beforeAll(() => {
  const runtimeHeaders = new Request("http://localhost/").headers.constructor;
  Object.defineProperty(globalThis, "Headers", {
    value: runtimeHeaders,
    configurable: true,
    writable: true,
  });
});

const getUser = vi.fn();
const createServerClient = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => createServerClient(...args),
}));

/** The `{ getAll, setAll }` adapter the middleware handed to `@supabase/ssr`. */
type CookieAdapter = {
  getAll: () => { name: string; value: string }[];
  setAll: (list: { name: string; value: string; options?: unknown }[]) => void;
};

function cookieAdapter(): CookieAdapter {
  return createServerClient.mock.calls[0][2].cookies as CookieAdapter;
}

async function runMiddleware(url: string, cookies: Record<string, string> = {}) {
  const { updateSession } = await import("@/lib/supabase/middleware");
  const { NextRequest } = await import("next/server");
  const request = new NextRequest(new Request(url));
  for (const [name, value] of Object.entries(cookies)) {
    request.cookies.set(name, value);
  }
  return { response: await updateSession(request), request };
}

describe("updateSession", () => {
  beforeEach(() => {
    vi.resetModules();
    getUser.mockReset().mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
    createServerClient.mockReset().mockImplementation(() => ({ auth: { getUser } }));
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-for-tests");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("revalidates the session on navigation", async () => {
    await runMiddleware("http://localhost:3000/arena");
    // `getUser()`, not `getSession()`: on the server the cookie is untrusted
    // input, and only the revalidating call proves anything.
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it("hands Supabase every request cookie", async () => {
    await runMiddleware("http://localhost:3000/arena", {
      "sb-project-auth-token": "session-value",
      peak3_anon: "anon:abc",
    });
    const names = cookieAdapter()
      .getAll()
      .map((cookie) => cookie.name);
    expect(names).toContain("sb-project-auth-token");
    expect(names).toContain("peak3_anon");
  });

  it("writes a rotated token onto the outgoing response", async () => {
    // This is the refresh actually landing. Losing it is what logs people out.
    createServerClient.mockImplementation((_url, _key, options: { cookies: CookieAdapter }) => ({
      auth: {
        getUser: vi.fn(async () => {
          options.cookies.setAll([
            { name: "sb-project-auth-token", value: "rotated", options: { path: "/" } },
          ]);
          return { data: { user: { id: "u-1" } }, error: null };
        }),
      },
    }));

    const { response } = await runMiddleware("http://localhost:3000/arena", {
      "sb-project-auth-token": "stale",
    });

    expect(response.cookies.get("sb-project-auth-token")?.value).toBe("rotated");
  });

  it("passes the navigation through when a refresh fails, rather than 500ing the site", async () => {
    getUser.mockRejectedValue(new Error("supabase unreachable"));
    const { response } = await runMiddleware("http://localhost:3000/arena");
    expect(response.status).toBe(200);
  });

  it("does nothing at all when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.resetModules();
    const { response } = await runMiddleware("http://localhost:3000/arena");
    // Anonymous-only deployments must not acquire a per-navigation dependency
    // on a project that does not exist.
    expect(createServerClient).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });
});

describe("middleware matcher", () => {
  it("skips build output and static assets, and covers everything else", async () => {
    const { config } = await import("@/middleware");
    const pattern = new RegExp(`^${config.matcher[0]}$`);

    for (const path of ["/", "/arena", "/arena/run-the-table", "/signin", "/auth/callback", "/profile"]) {
      expect(pattern.test(path), `${path} must be matched`).toBe(true);
    }
    for (const path of [
      "/_next/static/chunks/main.js",
      "/_next/image",
      "/favicon.ico",
      "/logo.svg",
      "/fonts/inter.woff2",
      "/data/board.json",
    ]) {
      expect(pattern.test(path), `${path} must be skipped`).toBe(false);
    }
  });
});

/**
 * E2E auth mode — the switch that lets the account surface render without a
 * hosted project.
 *
 * Two properties are load-bearing and neither is obvious from reading the
 * call sites, so both are pinned here:
 *
 *   1. It enables the SURFACE only. It must never make a Supabase client
 *      constructible, because `createServerClient("", "")` throws
 *      `Invalid supabaseUrl` and would take middleware down on every
 *      navigation.
 *   2. It cannot activate in production, whatever the environment says.
 */
describe("the E2E auth-mode switch", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function config(env: Record<string, string>) {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    vi.resetModules();
    return import("@/lib/supabase/config");
  }

  it("renders the surface with no credentials, without making a client constructible", async () => {
    const c = await config({
      NODE_ENV: "test",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      NEXT_PUBLIC_PEAK3_E2E_AUTH: "1",
    });
    expect(c.e2eAuthMode).toBe(true);
    expect(c.authSurfaceEnabled).toBe(true);
    // The half that must stay false — see property 1 above.
    expect(c.supabaseCredentialsPresent).toBe(false);
  });

  it("is inert in a production build even when the variable is set", async () => {
    const c = await config({
      NODE_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      NEXT_PUBLIC_PEAK3_E2E_AUTH: "1",
    });
    expect(c.e2eAuthMode).toBe(false);
    expect(c.authSurfaceEnabled).toBe(false);
  });

  it("leaves a real deployment exactly as it was", async () => {
    const c = await config({
      NODE_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    });
    expect(c.supabaseCredentialsPresent).toBe(true);
    expect(c.authSurfaceEnabled).toBe(true);
    expect(c.e2eAuthMode).toBe(false);
  });

  it("is off by default — an unset variable enables nothing", async () => {
    const c = await config({
      NODE_ENV: "test",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      NEXT_PUBLIC_PEAK3_E2E_AUTH: "",
    });
    expect(c.e2eAuthMode).toBe(false);
    expect(c.authSurfaceEnabled).toBe(false);
  });

  it("does not give the middleware a project to talk to", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_PEAK3_E2E_AUTH", "1");
    vi.resetModules();
    createServerClient.mockReset();
    const { response } = await runMiddleware("http://localhost:3000/arena");
    expect(createServerClient).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });
});
