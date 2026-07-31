/**
 * Row-specific receipts for the rankings modal (Phase 12A).
 *
 * The property that matters is NOT that some text is produced — it is that two
 * different player-seasons produce DIFFERENT text, and that the surprising
 * PO/TEAM values get the explanation the audit says they deserve. The old modal
 * failed exactly there: it explained the formula identically for every row.
 *
 * Fixtures mirror the shape of real served explain blocks
 * (data/game/experimental/player_pool_1500/top_1000_peaks.v1.json) with the
 * real values from docs/model/POSTSEASON_TEAM_AUDIT.md.
 */
import { describe, it, expect } from "vitest";
import type { RankingExplain } from "@/types";
import { buildComponentReceipts, buildHeldBack } from "@/lib/rankings-receipts";

function explain(overrides: Partial<RankingExplain> = {}): RankingExplain {
  return {
    row_id: "test-1yr-199091",
    player_slug: "test",
    player_name: "Test Player",
    label: "1990-91",
    rank: 1,
    prime_score: 90,
    prime_index: 80,
    components: {},
    percentiles: {},
    window_type: "1Y",
    seasons_in_window: ["1990-91"],
    weights: {},
    teammate_adjustment: null,
    score_split: { regular_season: null, postseason: null, recognition: null, team: null },
    strongest_components: [],
    weakest_components: [],
    season_stats: null,
    recognition: null,
    postseason: null,
    team_context: null,
    role_and_sample: null,
    comparisons: { same_player: [], similar_scores: [], same_season_peers: [] },
    caveats: [],
    ...overrides,
  } as unknown as RankingExplain;
}

function receipt(block: RankingExplain | null, key: string, contributions = {}) {
  return buildComponentReceipts(block, contributions).find((r) => r.key === key)!;
}

// ---------------------------------------------------------------------------
// Postseason — the component the audit exists for
// ---------------------------------------------------------------------------

describe("postseason receipt", () => {
  it("explains a zero as 'did not play', never as a penalty", () => {
    // Wembanyama 2024-25: missed the playoffs, PO exactly 0.
    const r = receipt(
      explain({ team_context: { made_playoffs: 0, championship: 0, finals_appearance: 0 } }),
      "postseason_individual_value",
      { postseason_individual_value: 0 },
    );
    expect(r.note).toMatch(/did not reach the playoffs/i);
    expect(r.note).toMatch(/exactly zero/i);
    expect(r.note).toMatch(/not a penalty/i);
  });

  it("explains a negative as below the replacement baseline, and bounded", () => {
    // Klay Thompson 2014-15: a title, and PO −1.46.
    const r = receipt(
      explain({
        postseason: { games: 21, minutes: 761, series_count: 4 },
        team_context: { made_playoffs: 1, championship: 1, finals_appearance: 1 },
      }),
      "postseason_individual_value",
      { postseason_individual_value: -1.457 },
    );
    expect(r.note).toMatch(/negative/i);
    expect(r.note).toMatch(/replacement-level/i);
    expect(r.note).toMatch(/bounded/i);
    // The line a user needs when a champion has negative postseason value.
    expect(r.note).toMatch(/winning the title does not by itself add/i);
  });

  it("explains a short sample as shrunk rather than extrapolated", () => {
    // David Robinson 1993-94: four playoff games.
    const r = receipt(
      explain({
        postseason: { games: 4, minutes: 146, series_count: 1 },
        team_context: { made_playoffs: 1, championship: 0, finals_appearance: 0 },
      }),
      "postseason_individual_value",
      { postseason_individual_value: 0.08 },
    );
    expect(r.note).toMatch(/only 4 playoff games/i);
    expect(r.note).toMatch(/shrinks/i);
  });

  it("says PO is individual play, not winning, on a healthy positive", () => {
    // Hakeem 1993-94.
    const r = receipt(
      explain({
        postseason: { games: 23, minutes: 989, series_count: 4 },
        team_context: { made_playoffs: 1, championship: 1, finals_appearance: 1 },
      }),
      "postseason_individual_value",
      { postseason_individual_value: 9.131 },
    );
    expect(r.note).toMatch(/not winning/i);
    expect(r.note).toMatch(/team result/i);
  });

  it("cites this row's own sample", () => {
    const r = receipt(
      explain({ postseason: { games: 22, minutes: 874, series_count: 4 } }),
      "postseason_individual_value",
    );
    expect(r.evidence).toContain("22 playoff games");
    expect(r.evidence).toContain("874 playoff minutes");
    expect(r.evidence).toContain("4 series");
  });

  it("produces different text for Butler and Ginobili", () => {
    // The two rows a reviewer compared directly.
    const butler = receipt(
      explain({
        postseason: { games: 22, minutes: 874, series_count: 4 },
        team_context: { made_playoffs: 1, championship: 0, finals_appearance: 1 },
      }),
      "postseason_individual_value",
      { postseason_individual_value: 2.482 },
    );
    const ginobili = receipt(
      explain({
        postseason: { games: 23, minutes: 772, series_count: 4 },
        team_context: { made_playoffs: 1, championship: 1, finals_appearance: 1 },
      }),
      "postseason_individual_value",
      { postseason_individual_value: 10.286 },
    );
    expect(butler.evidence).not.toEqual(ginobili.evidence);
  });
});

// ---------------------------------------------------------------------------
// Team achievement
// ---------------------------------------------------------------------------

describe("team achievement receipt", () => {
  it("names a title and its 3% ceiling", () => {
    const r = receipt(
      explain({ team_context: { made_playoffs: 1, championship: 1, finals_appearance: 1 } }),
      "team_achievement",
    );
    expect(r.evidence).toMatch(/won the title/i);
    expect(r.note).toMatch(/3%/);
    expect(r.note).toMatch(/cannot close/i);
  });

  it("distinguishes a Finals loss from a title", () => {
    const r = receipt(
      explain({ team_context: { made_playoffs: 1, championship: 0, finals_appearance: 1 } }),
      "team_achievement",
    );
    expect(r.evidence).toMatch(/reached the Finals without winning/i);
  });

  it("explains a zero for a first-round exit", () => {
    const r = receipt(
      explain({ team_context: { made_playoffs: 1, championship: 0, finals_appearance: 0 } }),
      "team_achievement",
    );
    expect(r.note).toMatch(/first-round exit scores exactly zero/i);
  });

  it("explains a zero for no playoffs", () => {
    const r = receipt(
      explain({ team_context: { made_playoffs: 0, championship: 0, finals_appearance: 0 } }),
      "team_achievement",
    );
    expect(r.evidence).toMatch(/did not reach the playoffs/i);
  });
});

// ---------------------------------------------------------------------------
// Statistical impact / production / recognition
// ---------------------------------------------------------------------------

describe("statistical impact receipt", () => {
  it("cites this row's own impact metrics and sample", () => {
    const r = receipt(
      explain({
        season_stats: { bpm: 12.0, vorp: 10.8, ws_per_48: 0.321, per: 31.6, games: 82, mpg: 37.0 },
      }),
      "statistical_impact",
    );
    expect(r.evidence).toContain("12.0 BPM");
    expect(r.evidence).toContain("10.8 VORP");
    expect(r.evidence).toContain("0.321 WS/48");
    expect(r.evidence).toContain("82 games at 37.0 minutes per game");
  });

  it("omits itself entirely when the row has no impact metrics", () => {
    expect(receipt(explain({ season_stats: null }), "statistical_impact").evidence).toBeNull();
  });
});

describe("traditional production receipt", () => {
  it("cites volume and efficiency from this row", () => {
    const r = receipt(
      explain({
        season_stats: { pts_per_75: 32.0, ast_per_75: 5.6, trb_per_100: 8.1, ts_pct: 0.605, ts_plus: 113.6, usg_pct: 32.9 },
      }),
      "traditional_production",
    );
    expect(r.evidence).toContain("32.0 pts/75");
    expect(r.evidence).toContain("60.5% true shooting");
    expect(r.evidence).toContain("32.9% usage");
  });

  it("falls back to ppg when per-75 is unavailable", () => {
    const r = receipt(explain({ season_stats: { ppg: 28.4 } }), "traditional_production");
    expect(r.evidence).toContain("28.4 ppg");
  });
});

describe("recognition receipt", () => {
  it("lists the awards actually on record, in readable form", () => {
    // The served block encodes them compactly; a reader needs the names.
    const r = receipt(
      explain({ recognition: { awards: "MVP-1,DPOY-7,AS,NBA1,DEF1" } }),
      "individual_recognition",
    );
    expect(r.evidence).toContain("MVP");
    expect(r.evidence).toContain("Defensive Player of the Year (7th in voting)");
    expect(r.evidence).toContain("All-Star");
    expect(r.evidence).toContain("All-NBA First Team");
    expect(r.evidence).toContain("All-Defensive First Team");
    // The raw tokens must not leak through.
    expect(r.evidence).not.toContain("NBA1");
    expect(r.evidence).not.toContain("DEF1");
  });

  it("passes an unrecognised token through rather than dropping it", () => {
    const r = receipt(
      explain({ recognition: { awards: "MVP-1,FUTURE_AWARD" } }),
      "individual_recognition",
    );
    expect(r.evidence).toContain("FUTURE_AWARD");
  });

  it("accepts an already-readable array unchanged", () => {
    const r = receipt(
      explain({ recognition: { awards: ["MVP", "All-NBA First Team"] } }),
      "individual_recognition",
    );
    expect(r.evidence).toContain("All-NBA First Team");
  });

  it("says plainly when there are none rather than inventing a reason", () => {
    const r = receipt(explain({ recognition: null }), "individual_recognition");
    expect(r.evidence).toMatch(/no awards/i);
  });
});

// ---------------------------------------------------------------------------
// What held it back
// ---------------------------------------------------------------------------

describe("what held this row back", () => {
  it("is empty when there is nothing specific to report", () => {
    expect(buildHeldBack(null)).toEqual([]);
    expect(
      buildHeldBack(
        explain({ team_context: { made_playoffs: 1, championship: 1, finals_appearance: 1 } }),
        { team_achievement: 3.0 },
      ),
    ).toEqual([]);
  });

  it("names a missing postseason as 18% scored at zero", () => {
    const out = buildHeldBack(
      explain({ team_context: { made_playoffs: 0, championship: 0, finals_appearance: 0 } }),
      { postseason_individual_value: 0 },
    );
    expect(out.join(" ")).toMatch(/no postseason/i);
    expect(out.join(" ")).toMatch(/18%/);
  });

  it("names a negative postseason", () => {
    const out = buildHeldBack(
      explain({
        postseason: { games: 21 },
        team_context: { made_playoffs: 1, championship: 1, finals_appearance: 1 },
      }),
      { postseason_individual_value: -1.457, team_achievement: 2.06 },
    );
    expect(out.join(" ")).toMatch(/negative/i);
  });

  it("names a short playoff sample with its game count", () => {
    const out = buildHeldBack(
      explain({
        postseason: { games: 4 },
        team_context: { made_playoffs: 1, championship: 0, finals_appearance: 0 },
      }),
      { postseason_individual_value: 0.08, team_achievement: 0 },
    );
    expect(out.join(" ")).toMatch(/short playoff sample \(4 games\)/i);
  });

  it("passes through the generated block's own caveats", () => {
    const out = buildHeldBack(
      explain({
        caveats: ["Availability flag: this player did not reach ~92% of the team's games."],
        team_context: { made_playoffs: 1, championship: 1, finals_appearance: 1 },
      }),
      { team_achievement: 3.0 },
    );
    expect(out.join(" ")).toMatch(/availability flag/i);
  });

  it("stays short — at most four reasons", () => {
    const out = buildHeldBack(
      explain({
        postseason: { games: 2 },
        team_context: { made_playoffs: 1, championship: 0, finals_appearance: 0 },
        caveats: ["one", "two", "three", "four", "five"],
        weakest_components: ["team_achievement"],
        percentiles: {
          statistical_impact: 40,
          traditional_production: 40,
          individual_recognition: 40,
          postseason_individual_value: 20,
          team_achievement: 5,
          total: 30,
        },
      }),
      { postseason_individual_value: -3, team_achievement: 0 },
    );
    expect(out.length).toBeLessThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// The anti-generic property
// ---------------------------------------------------------------------------

describe("receipts are row-specific", () => {
  it("produces different text for two different rows", () => {
    const hakeem = buildComponentReceipts(
      explain({
        season_stats: { bpm: 8.0, vorp: 6.6, games: 80, mpg: 41.0 },
        postseason: { games: 23, minutes: 989, series_count: 4 },
        team_context: { made_playoffs: 1, championship: 1, finals_appearance: 1 },
        recognition: { awards: ["MVP", "DPOY", "Finals MVP"] },
      }),
      { postseason_individual_value: 9.131, team_achievement: 3.0 },
    );
    const pippen = buildComponentReceipts(
      explain({
        season_stats: { bpm: 7.7, vorp: 6.1, games: 72, mpg: 38.3 },
        postseason: { games: 10, minutes: 384, series_count: 2 },
        team_context: { made_playoffs: 1, championship: 0, finals_appearance: 0 },
        recognition: { awards: ["All-NBA First Team"] },
      }),
      { postseason_individual_value: 1.064, team_achievement: 0.7 },
    );

    const asText = (rs: typeof hakeem) => rs.map((r) => `${r.evidence}|${r.note}`).join("~~");
    expect(asText(hakeem)).not.toEqual(asText(pippen));
    // ...and specifically on the two components under audit.
    const po = (rs: typeof hakeem) => rs.find((r) => r.key === "postseason_individual_value")!;
    expect(po(hakeem).evidence).not.toEqual(po(pippen).evidence);
    const team = (rs: typeof hakeem) => rs.find((r) => r.key === "team_achievement")!;
    expect(team(hakeem).evidence).not.toEqual(team(pippen).evidence);
  });

  it("never invents data for an empty block", () => {
    const rs = buildComponentReceipts(explain());
    // Only recognition has an honest "none on record" line; everything else
    // must stay null so the UI omits the card.
    expect(rs.find((r) => r.key === "statistical_impact")!.evidence).toBeNull();
    expect(rs.find((r) => r.key === "traditional_production")!.evidence).toBeNull();
    expect(rs.find((r) => r.key === "postseason_individual_value")!.evidence).toBeNull();
    expect(rs.find((r) => r.key === "team_achievement")!.evidence).toBeNull();
  });
});
