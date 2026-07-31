/**
 * One description per game mode, for the whole product.
 *
 * Before this file, Daily Grid / Peak Duel Daily / 82-0 PEAK Season each had
 * three or four near-identical descriptions hand-written into the homepage, the
 * Arena hub and the Daily hub. They drifted: the Grid was "the same board for
 * everyone" in one place and "everyone gets the same board" in another, the
 * 82-0 pitch gained and lost the "what PEAK3 would have picked" clause
 * depending on the surface, and the Daily hub still called 82-0 the flagship
 * after RUN THE TABLE took that slot. Copy that lives in four files stops being
 * copy and starts being four opinions.
 *
 * `MODE_COPY` is the single source of truth. A surface may override
 * `cta` (a card that knows you already played today should say "See your
 * result") and may add a `status`, but the title, the eyebrow and the sentence
 * describing what the mode IS come from here.
 *
 * Deliberately NOT consumed by PeakSeasonStartGate: that component describes a
 * specific run about to begin (board variant, daily vs practice), not the mode
 * in the abstract.
 */

export type ModeId = "run-the-table" | "peak-season" | "daily-grid" | "peak-duel";

export interface ModeCopy {
  id: ModeId;
  /** Where the mode starts. Card hrefs come from here, never a literal. */
  href: string;
  /** Small uppercase category above the title. */
  eyebrow: string;
  title: string;
  /** One sentence on what the mode actually is — concrete, no marketing. */
  description: string;
  /** Up to three compact facts. */
  meta: string[];
  cta: string;
}

export const MODE_COPY: Record<ModeId, ModeCopy> = {
  "run-the-table": {
    id: "run-the-table",
    href: "/arena/run-the-table",
    eyebrow: "Flagship",
    title: "RUN THE TABLE",
    description:
      "Draft exact NBA 3-year peak windows across a branching run, spend scarce credits, and beat three escalating statistical lineups — every battle decided by the five open PEAK3 components, with a full receipt.",
    meta: ["3 acts · 3 boss battles", "10–15 minutes", "No sign-in needed"],
    cta: "Start a run",
  },
  "peak-season": {
    id: "peak-season",
    href: "/arena/court/practice/apex_1y",
    eyebrow: "Full season",
    title: "82-0 PEAK Season",
    description:
      "Spin a real team and era, draft a position-aware 5+3 roster from exact NBA player-seasons, and chase a perfect season — with a receipt on every rating and a round-by-round comparison to what PEAK3 itself would have picked.",
    meta: ["8 roster slots", "Full-season simulation", "Play any time"],
    cta: "Build a roster",
  },
  "daily-grid": {
    id: "daily-grid",
    href: "/daily/grid",
    eyebrow: "New board every day",
    title: "Daily Grid Challenge",
    description:
      "Fill a 3x3 board with exact NBA player-seasons — teams, awards, eras, playoff runs. Nine squares, nine different players, and everyone gets the same board.",
    meta: ["3x3 board", "Picks are final", "One player per board"],
    cta: "Play today's grid",
  },
  "peak-duel": {
    id: "peak-duel",
    href: "/play/daily",
    eyebrow: "New questions every day",
    title: "Peak Duel Daily",
    description:
      "Ten head-to-head questions: pick which player's peak PEAK3 rates higher. The same ten comparisons for everyone, with the real numbers revealed only after you choose.",
    meta: ["10 questions", "Same board for everyone"],
    cta: "Play today's duel",
  },
};

/** The one mode the product leads with. Read this instead of hardcoding the
 *  flagship's id, so promoting a different mode is a one-line change here. */
export const FLAGSHIP_MODE: ModeCopy = MODE_COPY["run-the-table"];

/** RUN THE TABLE's own once-a-day board — the same seeded run for everyone. */
export const RUN_THE_TABLE_DAILY_HREF = "/arena/run-the-table?mode=daily";

/**
 * Where a player goes to pick their run back up.
 *
 * Deliberately the mode's own route with no invented query param: RUN THE TABLE
 * has no separate run-history page, and an unsaved run resumes from the start
 * screen itself (`rtt-resume-notice`). Pointing this at `?view=runs` would have
 * put a URL in the product promising a view that does not exist. When a real
 * history surface lands, this constant is the one place to change.
 */
export const RUN_THE_TABLE_RUNS_HREF = "/arena/run-the-table";
