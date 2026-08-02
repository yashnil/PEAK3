/**
 * `/auth/complete` — the claim interstitial.
 *
 * WHAT IT HAS TO GET RIGHT:
 *   - Tell the user what was imported. A silent transfer is indistinguishable
 *     from a lost one; "where did my runs go" is the support ticket this page
 *     prevents.
 *   - Never become a wall. When nothing was imported — the common case — it must
 *     redirect without asking for a decision.
 *   - Never claim success it did not have. The client component this replaced
 *     wrapped the claim in `catch {}`; a failure now has a visible state.
 *   - Honour only a validated destination.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const replace = vi.fn();
const getAccessToken = vi.fn();
const claimGuestActivity = vi.fn();
let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/auth/complete",
  useSearchParams: () => searchParams,
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    authSurfaceEnabled: true,
    getAccessToken: () => getAccessToken(),
  };
});

vi.mock("@/lib/supabase/claim", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/supabase/claim")>("@/lib/supabase/claim");
  return {
    ...actual,
    claimGuestActivity: (...args: unknown[]) => claimGuestActivity(...args),
  };
});

import AuthCompletePage from "@/app/auth/complete/page";
import { summarizeClaim } from "@/lib/supabase/claim";

function renderAt(query: string) {
  searchParams = new URLSearchParams(query);
  return render(<AuthCompletePage />);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  getAccessToken.mockResolvedValue("access-token");
  claimGuestActivity.mockResolvedValue(summarizeClaim({ claimed: true }));
});

describe("/auth/complete — nothing to import", () => {
  it("continues straight to the destination without asking anything", async () => {
    renderAt("next=%2Farena%2Franked");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/arena/ranked"));
    expect(screen.queryByTestId("auth-complete-summary")).toBeNull();
  });

  it("falls back to the homepage when no destination was carried", async () => {
    renderAt("");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("refuses a hostile destination and lands on the homepage", async () => {
    for (const hostile of ["//evil.example", "https://evil.example", "/%5Cevil.example"]) {
      replace.mockClear();
      const { unmount } = renderAt(`next=${encodeURIComponent(hostile)}`);
      await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
      unmount();
    }
  });

  it("continues even when this tab cannot see a session", async () => {
    getAccessToken.mockResolvedValue(null);
    renderAt("next=%2Fprofile");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/profile"));
    expect(claimGuestActivity).not.toHaveBeenCalled();
  });
});

describe("/auth/complete — something was imported", () => {
  beforeEach(() => {
    claimGuestActivity.mockResolvedValue(
      summarizeClaim({
        claimed: true,
        reason: "claimed",
        game_count: 3,
        completion_count: 2,
        run_the_table_run_count: 1,
      }),
    );
  });

  it("names every domain and its count", async () => {
    renderAt("next=%2Fprofile");
    const list = await screen.findByTestId("claim-summary-list");
    expect(list).toHaveTextContent("duels");
    expect(list).toHaveTextContent("3");
    expect(list).toHaveTextContent("daily completions");
    expect(list).toHaveTextContent("RUN THE TABLE runs");
  });

  it("announces the same thing to a screen reader as one sentence", async () => {
    renderAt("next=%2Fprofile");
    await screen.findByTestId("claim-summary-list");
    expect(
      screen.getByText(/Imported 3 duels, 2 daily completions and 1 RUN THE TABLE runs\./),
    ).toBeInTheDocument();
  });

  it("lets the user continue immediately rather than waiting it out", async () => {
    const user = userEvent.setup();
    renderAt("next=%2Fprofile");
    await user.click(await screen.findByTestId("auth-complete-continue"));
    expect(replace).toHaveBeenCalledWith("/profile");
  });

  it("continues on its own if the user does nothing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderAt("next=%2Fprofile");
    await screen.findByTestId("auth-complete-summary");
    await vi.advanceTimersByTimeAsync(6000);
    expect(replace).toHaveBeenCalledWith("/profile");
    vi.useRealTimers();
  });

  it("sends the access token, and leaves the cookie to the browser", async () => {
    renderAt("next=%2Fprofile");
    await screen.findByTestId("claim-summary-list");
    expect(claimGuestActivity).toHaveBeenCalledWith("access-token");
  });

  it("claims once, not once per Strict Mode pass", async () => {
    renderAt("next=%2Fprofile");
    await screen.findByTestId("claim-summary-list");
    expect(claimGuestActivity).toHaveBeenCalledTimes(1);
  });
});

describe("/auth/complete — the claim failed", () => {
  it("says so, instead of the silent catch this replaced", async () => {
    claimGuestActivity.mockResolvedValue(null);
    renderAt("next=%2Fprofile");

    const panel = await screen.findByTestId("auth-complete-claim-failed");
    // Signed in either way — the failure is about the import, not the session.
    expect(panel).toHaveTextContent(/You're signed in/i);
    expect(panel).toHaveTextContent(/couldn't import/i);
    expect(panel).toHaveTextContent(/Nothing has been lost/i);
    expect(replace).not.toHaveBeenCalled();
  });

  it("still lets the user carry on to where they were going", async () => {
    claimGuestActivity.mockResolvedValue(null);
    const user = userEvent.setup();
    renderAt("next=%2Fprofile");
    await user.click(await screen.findByTestId("auth-complete-continue"));
    expect(replace).toHaveBeenCalledWith("/profile");
  });
});
