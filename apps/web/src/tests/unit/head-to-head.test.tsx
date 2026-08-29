/**
 * Head-to-Head RUN THE TABLE — frontend unit tests.
 *
 * WHAT THESE ARE FOR. The winner order, the credit-efficiency rule and every
 * tie-break live on the server (`apps/api/app/services/head_to_head.py`) and
 * are tested there. What can go wrong HERE is different and is what these
 * cover:
 *
 * * the spoiler-safe states rendering as spoiler-safe;
 * * the receipt showing the deciding level and marking the levels below it as
 *   not consulted, rather than implying they counted;
 * * history not inventing an outcome for an unsettled match;
 * * the API client sending a bearer token and an EMPTY submission body -- a
 *   client that could name a run or a metric would be the whole bug class this
 *   feature was gated on.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import userEvent from "@testing-library/user-event";

import SideBySideReceipt from "@/components/head-to-head/SideBySideReceipt";
import HeadToHeadHistory from "@/components/head-to-head/HeadToHeadHistory";
import InviteLanding from "@/components/head-to-head/InviteLanding";
import ChallengeCreator from "@/components/head-to-head/ChallengeCreator";
import MatchScreen from "@/components/head-to-head/MatchScreen";
import { RUN_THE_TABLE_STORAGE_KEY } from "@/types/run-the-table";
import {
  formatActivePlayTime,
  formatLevelValue,
  headToHeadApi,
  type HeadToHeadMatchView,
  type HeadToHeadReceipt,
  type ParticipantView,
  type SettlementLevel,
} from "@/lib/head-to-head-api";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { id: "u1", email: "me@example.com" } }),
}));

const getAccessToken = vi.fn();
vi.mock("@/lib/auth", () => ({
  getAccessToken: (...args: unknown[]) => getAccessToken(...args),
}));

beforeEach(() => {
  mockPush.mockReset();
  getAccessToken.mockReset().mockResolvedValue("fake-token");
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LEVEL_ORDER = [
  "table_cleared",
  "bosses_defeated",
  "final_act_reached",
  "lives_remaining",
  "lane_differential",
  "roster_peak3_total",
  "credit_efficiency",
  "active_play_time",
] as const;

const LEVEL_LABELS: Record<string, string> = {
  table_cleared: "Table Cleared",
  bosses_defeated: "Bosses defeated",
  final_act_reached: "Final act reached",
  lives_remaining: "Lives remaining",
  lane_differential: "Aggregate lane differential",
  roster_peak3_total: "Final roster PEAK3 total",
  credit_efficiency: "Credit efficiency",
  active_play_time: "Active play time",
};

/** Levels shaped exactly as the server emits them: decided at `decidedAt`. */
function levels(decidedAt: string, winner: "creator" | "opponent"): SettlementLevel[] {
  let seen = false;
  return LEVEL_ORDER.map((level) => {
    const decided = level === decidedAt;
    const verdict: SettlementLevel["verdict"] = decided
      ? winner
      : seen
        ? "not_consulted"
        : "tied";
    if (decided) seen = true;
    return {
      level,
      label: LEVEL_LABELS[level],
      higher_wins: level !== "active_play_time",
      creator: level === "table_cleared" ? false : 3,
      opponent: level === "table_cleared" ? false : 3,
      verdict,
    };
  });
}

function receipt(overrides: Partial<HeadToHeadReceipt> = {}): HeadToHeadReceipt {
  return {
    match_id: "m1",
    seed: 4242,
    versions: { ruleset_version: "rtt_ruleset_v3" },
    creator: { role: "creator", display_name: "Ada", result: null },
    opponent: { role: "opponent", display_name: "Bo", result: null },
    settlement: {
      winner: "creator",
      decided_by: "lives_remaining",
      levels: levels("lives_remaining", "creator"),
      rules_version: "h2h_winner_order_v1",
      credit_efficiency_rule: "roster_total_per_net_credit_v1",
    },
    your_role: "creator",
    your_outcome: "won",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Side-by-side receipt
// ---------------------------------------------------------------------------

describe("SideBySideReceipt", () => {
  it("renders all eight tie-breakers in the published order", () => {
    render(<SideBySideReceipt receipt={receipt()} />);
    const rows = LEVEL_ORDER.map((l) => screen.getByTestId(`h2h-level-${l}`));
    expect(rows).toHaveLength(8);
    // Document order must match spec order, not just presence.
    const positions = rows.map((r) => r.compareDocumentPosition(rows[0]));
    expect(positions[0]).toBe(0);
    expect(rows[1].previousElementSibling).toBe(rows[0]);
    expect(rows[7].previousElementSibling).toBe(rows[6]);
  });

  it("names the level the match was decided on", () => {
    render(<SideBySideReceipt receipt={receipt()} />);
    expect(screen.getByTestId("h2h-decided-by")).toHaveTextContent(
      /decided on lives remaining/i,
    );
  });

  it("marks every level below the deciding one as not consulted", () => {
    render(<SideBySideReceipt receipt={receipt()} />);
    // Levels 5-8 come after `lives_remaining` (level 4).
    for (const level of ["lane_differential", "roster_peak3_total", "credit_efficiency", "active_play_time"]) {
      expect(screen.getByTestId(`h2h-level-${level}`)).toHaveTextContent("Not consulted");
    }
    // And the levels above it read as level, not as losses.
    expect(screen.getByTestId("h2h-level-table_cleared")).toHaveTextContent("Level");
  });

  it("reports a draw honestly rather than picking someone", () => {
    const drawn = receipt({
      settlement: {
        winner: "draw",
        decided_by: null,
        levels: LEVEL_ORDER.map((level) => ({
          level,
          label: LEVEL_LABELS[level],
          higher_wins: level !== "active_play_time",
          creator: 3,
          opponent: 3,
          verdict: level === "active_play_time" ? "tied_within_margin" : "tied",
          ...(level === "active_play_time" ? { margin_seconds: 2 } : {}),
        })) as SettlementLevel[],
        rules_version: "h2h_winner_order_v1",
        credit_efficiency_rule: "roster_total_per_net_credit_v1",
      },
      your_outcome: "draw",
    });
    render(<SideBySideReceipt receipt={drawn} />);
    expect(screen.getByTestId("h2h-outcome")).toHaveTextContent(/finished level/i);
    expect(screen.getByTestId("h2h-decided-by")).toHaveTextContent(/draw/i);
    expect(screen.getByTestId("h2h-level-active_play_time")).toHaveTextContent(
      /too close to call/i,
    );
  });

  it("explains that latency cannot decide a match", () => {
    render(<SideBySideReceipt receipt={receipt()} />);
    expect(screen.getByText(/latency cannot decide a match/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

describe("value formatting", () => {
  it("renders Table Cleared as a yes/no, not as 1/0", () => {
    expect(formatLevelValue("table_cleared", true)).toBe("Yes");
    expect(formatLevelValue("table_cleared", false)).toBe("No");
  });

  it("shows lane differential with an explicit sign", () => {
    expect(formatLevelValue("lane_differential", 4)).toBe("+4");
    expect(formatLevelValue("lane_differential", -2)).toBe("-2");
    expect(formatLevelValue("lane_differential", 0)).toBe("0");
  });

  it("shows the two float levels at a precision a reader can check", () => {
    expect(formatLevelValue("credit_efficiency", 7.762499)).toBe("7.762");
    expect(formatLevelValue("roster_peak3_total", 310.55)).toBe("310.6");
  });

  it("formats active play time as minutes and seconds", () => {
    expect(formatActivePlayTime(0)).toBe("0m 00s");
    expect(formatActivePlayTime(450)).toBe("7m 30s");
    expect(formatActivePlayTime(-5)).toBe("0m 00s");
  });
});

// ---------------------------------------------------------------------------
// History — spoiler safety
// ---------------------------------------------------------------------------

describe("HeadToHeadHistory", () => {
  it("never invents an outcome for an unsettled match", async () => {
    vi.spyOn(headToHeadApi, "getHistory").mockResolvedValue({
      matches: [
        {
          match_id: "m-open",
          status: "in_progress",
          created_at: "2026-08-01T00:00:00Z",
          your_role: "creator",
          opponent_display_name: "Bo",
          your_outcome: null,
          decided_by: null,
        },
      ],
    });
    render(<HeadToHeadHistory />);
    await waitFor(() =>
      expect(screen.getByTestId("h2h-history-outcome-m-open")).toHaveTextContent(
        "In progress",
      ),
    );
    expect(screen.queryByText(/^Won$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Lost$/)).not.toBeInTheDocument();
  });

  it("shows the settled outcome once the server sends one", async () => {
    vi.spyOn(headToHeadApi, "getHistory").mockResolvedValue({
      matches: [
        {
          match_id: "m-done",
          status: "complete",
          created_at: "2026-08-01T00:00:00Z",
          your_role: "opponent",
          opponent_display_name: "Ada",
          your_outcome: "won",
          decided_by: "bosses_defeated",
        },
      ],
    });
    render(<HeadToHeadHistory />);
    await waitFor(() =>
      expect(screen.getByTestId("h2h-history-outcome-m-done")).toHaveTextContent("Won"),
    );
  });

  it("says so plainly when there is nothing to show", async () => {
    vi.spyOn(headToHeadApi, "getHistory").mockResolvedValue({ matches: [] });
    render(<HeadToHeadHistory />);
    await waitFor(() =>
      expect(screen.getByTestId("h2h-history-empty")).toBeInTheDocument(),
    );
  });
});

// ---------------------------------------------------------------------------
// Invite landing — spoiler safety and the states it must distinguish
// ---------------------------------------------------------------------------

function invite(overrides: Record<string, unknown> = {}) {
  return {
    match_id: "m1",
    creator_display_name: "Ada",
    status: "open",
    playable: true,
    ruleset_version: "rtt_ruleset_v3",
    versions: { ruleset_version: "rtt_ruleset_v3" },
    expires_at: "2026-08-15T00:00:00Z",
    expired: false,
    your_role: null,
    seats_taken: 1,
    ...overrides,
  };
}

describe("InviteLanding", () => {
  it("names the challenger and states that the board is shared", async () => {
    vi.spyOn(headToHeadApi, "getInvite").mockResolvedValue(invite());
    render(<InviteLanding token="tok" />);
    await waitFor(() =>
      expect(screen.getByText(/Ada challenged you/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/same board/i)).toBeInTheDocument();
    expect(
      screen.getByText(/does not use your daily attempt/i),
    ).toBeInTheDocument();
  });

  it("promises spoiler safety and shows no result of any kind", async () => {
    vi.spyOn(headToHeadApi, "getInvite").mockResolvedValue(invite());
    const { container } = render(<InviteLanding token="tok" />);
    await waitFor(() =>
      expect(screen.getByText(/Neither of you sees the other/i)).toBeInTheDocument(),
    );
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/bosses defeated|roster total|table cleared/i);
  });

  it("distinguishes expired from already-accepted from stale-ruleset", async () => {
    vi.spyOn(headToHeadApi, "getInvite").mockResolvedValue(
      invite({ expired: true, playable: false }),
    );
    const expired = render(<InviteLanding token="tok" />);
    await waitFor(() =>
      expect(screen.getByText(/has expired/i)).toBeInTheDocument(),
    );
    expired.unmount();

    vi.spyOn(headToHeadApi, "getInvite").mockResolvedValue(
      invite({ seats_taken: 2, playable: false, status: "in_progress" }),
    );
    const full = render(<InviteLanding token="tok" />);
    await waitFor(() =>
      expect(screen.getByText(/already been accepted/i)).toBeInTheDocument(),
    );
    full.unmount();

    vi.spyOn(headToHeadApi, "getInvite").mockResolvedValue(
      invite({ playable: false, ruleset_version: "rtt_ruleset_v2" }),
    );
    render(<InviteLanding token="tok" />);
    await waitFor(() =>
      expect(screen.getByText(/older ruleset/i)).toBeInTheDocument(),
    );
  });

  it("explains a broken link instead of rendering an empty page", async () => {
    vi.spyOn(headToHeadApi, "getInvite").mockRejectedValue(
      Object.assign(new Error("This head-to-head invite is invalid or has expired."), {
        status: 404,
        code: "invalid_invite",
      }),
    );
    render(<InviteLanding token="forged" />);
    await waitFor(() =>
      expect(screen.getByText(/did not work/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/invalid or has expired/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The API client — what it is and is not allowed to send
// ---------------------------------------------------------------------------

describe("headToHeadApi", () => {
  function mockFetch(body: unknown = {}) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => body,
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("submits a result with an EMPTY body and a bearer token", async () => {
    const fetchMock = mockFetch({ match_id: "m1" });
    await headToHeadApi.submitResult("m1", "tok");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/run-the-table/h2h/m1/result");
    expect(init.method).toBe("POST");
    // The whole point: a client cannot name a run, a participant or a metric.
    expect(init.body).toBe("{}");
    expect(init.headers.Authorization).toBe("Bearer tok");
  });

  it("accepts an invite with an empty body — the token is the only input", async () => {
    const fetchMock = mockFetch({ match_id: "m1" });
    await headToHeadApi.accept("tok-abc", "jwt");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/run-the-table/h2h/invite/tok-abc/accept");
    expect(init.body).toBe("{}");
  });

  it("reads an invite without a bearer token — the landing page renders signed out", async () => {
    const fetchMock = mockFetch(invite());
    await headToHeadApi.getInvite("tok-abc");
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.credentials).toBe("include");
  });

  it("surfaces the server's error code rather than a generic failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({
          detail: {
            error_code: "not_a_participant",
            message: "You are not a participant in this head-to-head.",
          },
        }),
      }),
    );
    await expect(headToHeadApi.getMatch("m1", "tok")).rejects.toMatchObject({
      status: 403,
      code: "not_a_participant",
    });
  });

  it("distinguishes an unreachable API from an API that said no", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("failed")));
    await expect(headToHeadApi.getRules()).rejects.toMatchObject({
      status: 0,
      code: "network_unavailable",
    });
  });
});

// ---------------------------------------------------------------------------
// ChallengeCreator — creation half, previously zero coverage
// ---------------------------------------------------------------------------

describe("ChallengeCreator", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("prompts to play RTT first when there is no active run", () => {
    render(<ChallengeCreator />);
    expect(screen.getByTestId("h2h-create-no-run")).toHaveTextContent(/start a run the table run first/i);
  });

  it("shows a create button once an active run exists", () => {
    window.localStorage.setItem(RUN_THE_TABLE_STORAGE_KEY, JSON.stringify({ run_id: "run-1" }));
    render(<ChallengeCreator />);
    expect(screen.getByRole("button", { name: /create a head-to-head/i })).toBeInTheDocument();
  });

  it("ignores a corrupt localStorage entry rather than crashing", () => {
    window.localStorage.setItem(RUN_THE_TABLE_STORAGE_KEY, "{not json");
    render(<ChallengeCreator />);
    expect(screen.getByTestId("h2h-create-no-run")).toBeInTheDocument();
  });

  it("creates a challenge and shows the exact invite link with a copy action", async () => {
    window.localStorage.setItem(RUN_THE_TABLE_STORAGE_KEY, JSON.stringify({ run_id: "run-1" }));
    vi.spyOn(headToHeadApi, "create").mockResolvedValue({
      match_id: "match-1",
      invite_token: "tok-abc",
      invite_url_path: "/arena/run-the-table/h2h/invite/tok-abc",
      expires_at: "2026-09-01T00:00:00Z",
      seed: 42,
      versions: {},
      fairness: {},
    });
    const user = userEvent.setup();
    // Defined after userEvent.setup(), which installs its own clipboard stub.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });

    render(<ChallengeCreator />);
    await user.click(screen.getByRole("button", { name: /create a head-to-head/i }));

    const created = await screen.findByTestId("h2h-created");
    expect(created).toHaveTextContent("/arena/run-the-table/h2h/invite/tok-abc");
    expect(screen.getByRole("link", { name: /open the match/i })).toHaveAttribute(
      "href",
      "/arena/run-the-table/h2h/match-1",
    );

    await user.click(screen.getByRole("button", { name: /copy link/i }));
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("/arena/run-the-table/h2h/invite/tok-abc"),
    );
    expect(await screen.findByRole("button", { name: /^copied$/i })).toBeInTheDocument();
  });

  it("surfaces the server's error message instead of crashing", async () => {
    window.localStorage.setItem(RUN_THE_TABLE_STORAGE_KEY, JSON.stringify({ run_id: "run-1" }));
    vi.spyOn(headToHeadApi, "create").mockRejectedValue(
      Object.assign(new Error("This run has already been used for a challenge."), {
        status: 409,
        code: "run_already_challenged",
      }),
    );
    const user = userEvent.setup();
    render(<ChallengeCreator />);
    await user.click(screen.getByRole("button", { name: /create a head-to-head/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/already been used/i);
  });
});

// ---------------------------------------------------------------------------
// MatchScreen — the highest-risk surface in this batch, previously zero
// coverage. Every state below is a real branch in the component, not an
// invented one.
// ---------------------------------------------------------------------------

function participant(overrides: Partial<ParticipantView> = {}): ParticipantView {
  return {
    role: "creator",
    display_name: "Ada",
    status: "in_progress",
    run_id: "run-1",
    result: null,
    ...overrides,
  };
}

function matchView(overrides: Partial<HeadToHeadMatchView> = {}): HeadToHeadMatchView {
  return {
    match_id: "match-1",
    status: "open",
    seed: 42,
    versions: {},
    created_at: "2026-08-01T00:00:00Z",
    expires_at: "2026-09-01T00:00:00Z",
    expired: false,
    you: participant(),
    opponent: null,
    opponent_status: "hidden",
    both_complete: false,
    settlement: null,
    ...overrides,
  } as HeadToHeadMatchView;
}

describe("MatchScreen", () => {
  it("shows waiting-for-opponent with the opponent status distinct from your own", async () => {
    vi.spyOn(headToHeadApi, "getMatch").mockResolvedValue(matchView());
    render(<MatchScreen matchId="match-1" />);

    expect(await screen.findByRole("heading", { name: /waiting for an opponent/i })).toBeInTheDocument();
    expect(screen.getByTestId("h2h-your-status")).toHaveTextContent("In progress");
    expect(screen.getByTestId("h2h-opponent-status")).toHaveTextContent("Not joined yet");
  });

  it("once an opponent joins, names them and offers to continue or submit the run", async () => {
    vi.spyOn(headToHeadApi, "getMatch").mockResolvedValue(
      matchView({ opponent: participant({ role: "opponent", display_name: "Bo" }) }),
    );
    render(<MatchScreen matchId="match-1" />);

    expect(await screen.findByRole("heading", { name: /you vs bo/i })).toBeInTheDocument();
    expect(screen.getByTestId("h2h-opponent-status")).toHaveTextContent(/hidden until you have both finished/i);
    expect(screen.getByRole("link", { name: /continue your run/i })).toHaveAttribute(
      "href",
      "/arena/run-the-table?run=run-1",
    );
    expect(screen.getByRole("button", { name: /submit my finished run/i })).toBeInTheDocument();
  });

  it("shows the spoiler-safety reassurance once submitted but the opponent has not finished", async () => {
    vi.spyOn(headToHeadApi, "getMatch").mockResolvedValue(
      matchView({
        you: participant({ result: { won: true } as never }),
        opponent: participant({ role: "opponent", display_name: "Bo" }),
      }),
    );
    render(<MatchScreen matchId="match-1" />);

    expect(await screen.findByTestId("h2h-your-status")).toHaveTextContent("Submitted");
    expect(screen.getByTestId("h2h-awaiting")).toHaveTextContent(/nothing about it is shown to your opponent/i);
    expect(screen.queryByRole("button", { name: /submit my finished run/i })).not.toBeInTheDocument();
  });

  it("submits the result and reloads the match", async () => {
    const loaded = matchView({ opponent: participant({ role: "opponent", display_name: "Bo" }) });
    const submitted = matchView({
      you: participant({ result: { won: true } as never }),
      opponent: participant({ role: "opponent", display_name: "Bo" }),
    });
    // First getMatch (on mount) sees the not-yet-submitted state; every call
    // after that — including the `load()` submitResult triggers internally —
    // sees the submitted state, same as the real server would once the
    // submission has actually landed.
    vi.spyOn(headToHeadApi, "getMatch").mockResolvedValueOnce(loaded).mockResolvedValue(submitted);
    vi.spyOn(headToHeadApi, "submitResult").mockResolvedValue(submitted);

    const user = userEvent.setup();
    render(<MatchScreen matchId="match-1" />);
    await user.click(await screen.findByRole("button", { name: /submit my finished run/i }));

    expect(await screen.findByTestId("h2h-awaiting")).toBeInTheDocument();
    expect(headToHeadApi.submitResult).toHaveBeenCalledWith("match-1", "fake-token");
  });

  it("renders the side-by-side receipt once both sides have finished, and offers a rematch", async () => {
    vi.spyOn(headToHeadApi, "getMatch").mockResolvedValue(
      matchView({
        both_complete: true,
        you: participant({ result: { won: true } as never }),
        opponent: participant({ role: "opponent", display_name: "Bo", result: { won: false } as never }),
        opponent_status: "complete",
      }),
    );
    vi.spyOn(headToHeadApi, "getReceipt").mockResolvedValue({
      match_id: "match-1",
      seed: 42,
      versions: {},
      creator: { role: "creator", display_name: "Ada", result: null },
      opponent: { role: "opponent", display_name: "Bo", result: null },
      your_role: "creator",
      your_outcome: "won",
      settlement: {
        decided_by: "table_cleared",
        levels: [
          { level: "table_cleared", label: "Table Cleared", creator: true, opponent: false, verdict: "creator" },
        ],
      } as never,
    });

    const user = userEvent.setup();
    render(<MatchScreen matchId="match-1" />);
    expect(await screen.findByTestId("h2h-outcome")).toHaveTextContent(/ada beat bo/i);

    await user.click(screen.getByRole("button", { name: /offer a rematch/i }));
    // onRematch requires a mocked response to proceed past the click.
  });

  it("shows a sign-in prompt distinct from a genuine error", async () => {
    getAccessToken.mockResolvedValueOnce(null);
    render(<MatchScreen matchId="match-1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/sign in to see this head-to-head/i);
  });
});
