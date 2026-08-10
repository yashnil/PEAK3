"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { usePrefersReducedMotion } from "@/lib/a11y";
import { useDailyReset } from "@/lib/use-daily-reset";
import { TourLauncher } from "@/components/ui/GuidedTour";
import { motionTransition } from "@/lib/motion";
import {
  CreditSink,
  LaneField,
  RevealSlot,
  Role,
  RulesetMeta,
  RunPublicState,
  RunReadiness,
  RunType,
  DailyDescriptor,
} from "@/types/run-the-table";
import {
  ChallengeDescriptor,
  RunTheTableAPIError,
  createChallenge,
  createRun,
  getChallenge,
  getDailyRun,
  getRulesetMeta,
  getRun,
  getRunReadiness,
  postRunAction,
  restartRun,
  runActions,
} from "@/lib/run-the-table-api";
import {
  clearActiveRun,
  currentBattle,
  draftOffers,
  isStaleDailyPointer,
  isTerminal,
  loadActiveRun,
  makeIdempotencyKey,
  LANE_LABELS,
  needsBossReveal,
  needsOpeningReveal,
  NODE_TYPE_LABELS,
  saveActiveRun,
  screenForStatus,
  ScoutIntel,
  shouldClearStoredRun,
  tradeIncoming,
  trackRunTheTable,
} from "@/lib/run-the-table-state";
import CreditSinks from "./CreditSinks";
import RevealSequenceSurface, { revealSourceFor } from "./RevealSequenceSurface";
import { useRevealSequence } from "./useRevealSequence";
import ScoutPrepare from "./ScoutPrepare";
import RunStartGate from "./RunStartGate";
import RunSkeleton from "./RunSkeleton";
import RunMap from "./RunMap";
import RunTray from "./RunTray";
import MobileTray from "./MobileTray";
import RunProgressStrip from "./RunProgressStrip";
import SystemSelect from "./SystemSelect";
import NodeChoice from "./NodeChoice";
import DraftRoom from "./DraftRoom";
import TradeDesk from "./TradeDesk";
import ChoiceNode from "./ChoiceNode";
import RunHUD from "./RunHUD";
import RestartRunControl from "./RestartRunControl";
import BossIntro from "./BossIntro";
import BossPreview from "./BossPreview";
import BattleReveal from "./BattleReveal";
import RunResult from "./RunResult";

/**
 * RUN THE TABLE, top to bottom.
 *
 * SERVER-AUTHORITATIVE, the CourtBuilder.tsx way: every action POSTs and the
 * whole `RunPublicState` object is replaced from the response. There is no
 * optimistic update, no local score, no local price, and no local battle
 * resolution anywhere in this tree.
 *
 * The active run's id is mirrored to localStorage so a refresh resumes at the
 * same screen — `screenForStatus` is the only thing that decides which screen
 * that is, and it reads the server's `status`, so resume can never disagree
 * with the engine about where the player is.
 */
interface Props {
  /** Free-play only — `?seed=`. Ignored for a daily run (server re-derives). */
  initialSeed?: number;
  /** Daily only — `?date=` for replaying an earlier day. */
  initialDate?: string;
  /** Challenge link token — starts a `challenge` run on the shared seed. */
  challengeToken?: string;
  /** Emphasise one start button. Never auto-starts — see the route docstring. */
  preferredMode?: "daily";
}

/**
 * `?start=` values this component will act on. Anything else is ignored.
 *
 * `standard` ONLY. `daily` was removed after review: a standard run costs
 * nothing to create (random seed, start as many as you like), but the daily is
 * one shared board and one attempt per UTC day. With `?start=daily` the URL
 * itself spends that attempt, so copying the address bar into a group chat
 * would burn it for every recipient on navigation. The homepage launcher now
 * links to `?mode=daily`, which lands on the start gate with the daily button
 * emphasised — exactly what `/arena` has always linked to, and what this
 * route's own docstring promises.
 */
const START_PARAM_VALUES: readonly RunType[] = ["standard"] as const;

/**
 * Read `?start=` from the live URL, once.
 *
 * `window.location.search` rather than `useSearchParams()` deliberately: this
 * value is consumed exactly once and then removed, so there is nothing to
 * subscribe to, and reading it this way keeps the component free of the
 * Suspense boundary `useSearchParams` requires of any route Next tries to
 * prerender. Returns null during SSR and for every unrecognised value.
 */
export function readStartParam(search?: string): RunType | null {
  const raw = search ?? (typeof window === "undefined" ? "" : window.location.search);
  if (!raw) return null;
  const value = new URLSearchParams(raw).get("start");
  return START_PARAM_VALUES.includes(value as RunType) ? (value as RunType) : null;
}

/** The same URL with `start` removed, path and every other param preserved. */
export function urlWithoutStartParam(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete("start");
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}

/**
 * Remove `?start=` from the address bar, synchronously, in the current history
 * entry.
 *
 * WHY NOT `router.replace`. It was `router.replace`, and that is a *deferred*
 * operation: the App Router treats it as a navigation, fetches the RSC payload
 * for the new URL, and only calls `history.replaceState` once that response
 * lands. The CI trace for this exact failure shows the sequence plainly — the
 * run is created (`POST /run-the-table/runs` → 200), the game surface paints,
 * and the `?_rsc=` request for the stripped URL is still in flight. Anything
 * that reads `location.search` in that window — a refresh, a copied link, an
 * assertion — still sees `start=standard`. On a warm local dev server the gap
 * is a few milliseconds and invisible; on a cold CI dev server it is long
 * enough to lose. Nothing about the product wanted a navigation here: the route
 * is unchanged, the component must not remount (it is holding the run that was
 * just created), and no Server Component depends on the param.
 *
 * `history.replaceState` is the supported way to express that in Next 15 — it
 * rewrites the current entry in place, synchronously, with no refetch and no
 * re-render. The param is read once at mount from `window.location.search`
 * (see `readStartParam`) rather than through `useSearchParams`, so there is no
 * subscription for this to fall out of sync with.
 *
 * Idempotent by construction: with `start` already absent the rewritten URL
 * equals the current one, so a second call is a no-op, and back/forward
 * navigation cannot resurrect the param in this entry.
 */
export function stripStartParamFromUrl(): void {
  if (typeof window === "undefined") return;
  const { pathname, search, hash } = window.location;
  if (!new URLSearchParams(search).has("start")) return;
  window.history.replaceState(
    window.history.state,
    "",
    `${urlWithoutStartParam(pathname, search)}${hash}`,
  );
}

export default function RunTheTableGame({
  initialSeed,
  initialDate,
  challengeToken,
  preferredMode,
}: Props) {
  const [state, setState] = useState<RunPublicState | null>(null);
  const [readiness, setReadiness] = useState<RunReadiness | null>(null);
  const [daily, setDaily] = useState<DailyDescriptor | null>(null);
  /**
   * The whole ruleset, so the start gate can state the run's real shape — five
   * acts, three lives, the four sink prices — instead of hardcoding counts that
   * a ruleset bump silently falsifies. Static and cacheable; a failure to fetch
   * it is not fatal, the gate simply drops the count-bearing sentences.
   */
  const [meta, setMeta] = useState<RulesetMeta | null>(null);
  const [challenge, setChallenge] = useState<ChallengeDescriptor | null>(null);
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  // The last thing that failed, so "Try again" retries THAT rather than
  // reloading the page and losing the player's place. Held in state, not a
  // ref, because the retry button's presence depends on it.
  const [retry, setRetry] = useState<{
    fn: () => Promise<RunPublicState>;
    announce?: string;
  } | null>(null);
  // Fires "offer viewed" once per node, not once per render.
  const seenNodeRef = useRef<string | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  /**
   * THE SHARED REVEAL CHOREOGRAPHY (PRODUCT_EXPERIENCE_CONTRACT.md §2/§3).
   *
   * Called unconditionally, every render (rules of hooks) — `items`/`total`
   * default to empty/0 before a run exists or before that reveal's track is
   * relevant, which is a legal, inert input to `useRevealSequence`.
   *
   * The roster instance is lifted here, rather than owned inside
   * `RevealSequenceSurface`, specifically so `RunTray`'s roster dock can
   * read the SAME `presentationCursor` the reveal stage is animating
   * against — one number, two consumers, which is what makes "the dock
   * shows nothing the stage hasn't shown yet" true by construction instead
   * of by two components agreeing to stay in sync.
   */
  const rosterTrack = state?.reveal?.roster ?? null;
  const rosterSequence = useRevealSequence<RevealSlot>({
    items: rosterTrack?.revealed_slots ?? [],
    total: rosterTrack?.total ?? 0,
    reducedMotion,
    // A new run's fresh, empty roster track must never inherit `started`/
    // `complete` left over from a PREVIOUS run's reveal — this component
    // does not remount between runs (see `runIdRef` below), and a session
    // can start "another run" without a page reload.
    resetKey: state?.run_id ?? null,
  });
  const bossTrack = state?.reveal?.boss ?? null;
  const bossSequence = useRevealSequence<RevealSlot>({
    items: bossTrack?.revealed_slots ?? [],
    total: bossTrack?.total ?? 0,
    reducedMotion,
    // P5-F4 (product-director): without this, the SECOND boss reveal in a
    // run inherited `started`/`complete`/`skippedRef` from the FIRST boss's
    // already-finished sequence and rendered fully complete with no start
    // button — every boss after the first was unreachable as a cinematic.
    resetKey: bossTrack?.boss_id ?? null,
  });

  /**
   * DISMISSAL, separate from COMPLETION.
   *
   * The lead's ruling: "skip-all must land on all 7 slots FULLY RESOLVED and
   * hold there, so the player sees the roster they were promised before the
   * screen changes... requires an explicit continue." So `sequence.complete`
   * (every card settled — from the hook) and "the player has left this
   * screen" (from here) are now two different facts. The reveal surface's
   * own "Continue" footer button is what flips these; skip-all only ever
   * advances `sequence.complete`, never dismissal directly.
   *
   * Reset on a new run (`run_id` change) — plain React state has no idea a
   * new run started, since `RunTheTableGame` does not remount between runs
   * (`commit()` just replaces `state`). Boss dismissal is keyed by
   * `boss_id`, not a bare boolean, because a five-act run meets five bosses
   * in one session and each needs its own intro + reveal + dismissal cycle.
   */
  const [rosterRevealDismissed, setRosterRevealDismissed] = useState(false);
  const [dismissedBossIntroId, setDismissedBossIntroId] = useState<string | null>(null);
  const [dismissedBossRevealId, setDismissedBossRevealId] = useState<string | null>(null);
  /**
   * SCOUT INTEL, remembered past the Scout & Prepare node it arrived on
   * (brief §E: "scout information must visibly matter later — pin the
   * discovered vulnerability into the HUD, highlight matching market
   * cards"). `ScoutReport` (the boss's weakest/strongest lanes) is already
   * on the wire the moment a `film_room` node is active — the same data
   * `ScoutPrepare.tsx` already renders, computed by `bosses.scout_report()`,
   * never anything this component derives. It exists ONLY on that one
   * node's payload, though, and is gone from every subsequent
   * `RunPublicState` the instant the player leaves it — so this is the one
   * place in the whole surface that remembers a past node's data on
   * purpose, purely for later PRESENTATION (a HUD pin, a market-card
   * highlight), never as a second source of truth for anything
   * server-authoritative: `legal_slots`/`selectable`/`blocked_reason` on
   * every offer are still read fresh off `state` everywhere they matter.
   * Declared here (not beside its effect below) so the run-reset effect
   * can clear it without a forward reference.
   */
  const [scoutIntel, setScoutIntel] = useState<ScoutIntel | null>(null);
  const runIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!state || state.run_id === runIdRef.current) return;
    runIdRef.current = state.run_id;
    setRosterRevealDismissed(false);
    setDismissedBossIntroId(null);
    setDismissedBossRevealId(null);
    // Scout intel (below) is keyed off `active_node`, which has no memory of
    // which run it came from — a fresh run's Act 1 must not open with a pin
    // left over from the previous run's scouting. Cleared HERE, in the same
    // effect that flips `runIdRef.current`, not a second effect watching
    // `run_id` on its own: a second effect's `!== runIdRef.current` check
    // would already see the ref this effect just updated in the same commit
    // and never fire.
    setScoutIntel(null);
  }, [state]);

  /**
   * Is the reveal surface still the thing on screen?
   *
   * `needsOpeningReveal(state)`/`needsBossReveal(state)` are the SERVER's
   * truth (`!roster.complete`) — still correct for "has this reveal even
   * started." But `SYNTHESIS_CONTRACT.md §2.2` batches the reveal into one
   * POST, so the server's `complete` flips true the instant that single
   * request resolves — long before the local, paced presentation has
   * finished. `rosterSequence.started` covers exactly that gap: once the
   * player's one press has fired the request, the surface stays up until
   * the player explicitly continues past the fully-resolved roster, never
   * the server's flag alone and never `sequence.complete` alone either.
   */
  const showRosterReveal =
    !!state && (needsOpeningReveal(state) || rosterSequence.started) && !rosterRevealDismissed;

  const bossActive =
    !!state && !!bossTrack && (needsBossReveal(state) || bossSequence.started);
  const bossIntroDone = !bossTrack || dismissedBossIntroId === bossTrack.boss_id;
  const bossRevealDismissedNow = !!bossTrack && dismissedBossRevealId === bossTrack.boss_id;
  /** The pre-roll: name, philosophy, win condition, countdown, skip. */
  const showBossIntro = bossActive && !bossIntroDone;
  /** The paired lineup reveal, after the intro is dismissed. */
  const showBossReveal = bossActive && bossIntroDone && !bossRevealDismissedNow;

  /**
   * Handed to `RunTray`'s roster dock — see that component's
   * `concealedRosterUnless` docstring. `null` when there is nothing to
   * conceal (no reveal track on this payload, or the reveal already fully
   * resolved either this session or a prior one); a `Set` — built from the
   * SAME `rosterSequence.visible` the reveal stage is animating — while an
   * opening reveal genuinely owns this roster right now.
   */
  const rosterConcealment: Set<string> | null =
    state && rosterTrack && (needsOpeningReveal(state) || rosterSequence.started) && !rosterRevealDismissed
      ? new Set(rosterSequence.visible.map((s) => s.slot_id))
      : null;

  /**
   * Capture the scout report the moment it's on the wire (see the
   * `scoutIntel` declaration above for why this survives past the node).
   */
  useEffect(() => {
    const report = state?.active_node?.scout?.choices.find((c) => c.id === "scout_boss")?.report;
    if (!report) return;
    setScoutIntel({
      bossId: report.boss_id,
      bossName: report.name,
      weakestLane: report.weakest_lane,
      weakestLabel: LANE_LABELS[report.weakest_lane],
    });
  }, [state?.active_node]);

  /**
   * A run can have 0, 1, or 2 `film_room` visits per act (node types are
   * rolled per stage, not guaranteed), and scouting only ever targets the
   * CURRENT act's boss (`bosses.scout_report()` reads `boss.boss_id` off
   * the same `blueprint.bosses[state.act - 1]` the rest of `state` uses).
   * `scoutIntel` itself is only cleared on a new run, not on an act
   * transition within one run — so a stale scout from Act 1 could
   * otherwise keep "mattering" into Act 2's Draft Room. Every consumer
   * reads THIS, not `scoutIntel` directly, so staleness is checked once
   * rather than re-derived at every call site.
   */
  const activeScoutIntel =
    scoutIntel && state?.next_boss && scoutIntel.bossId === state.next_boss.boss_id ? scoutIntel : null;

  /**
   * `?start=` — read ONCE, at first render, before any effect can run.
   *
   * Two separate guards, because they defend against two different things:
   *
   *   * `startParamRef` freezes the value at mount. The param is stripped from
   *     the URL once consumed, so a later read would see nothing — and a
   *     re-render between the two must not see a different answer.
   *   * `startConsumedRef` is set synchronously inside the effect BEFORE any
   *     await, so React 18 strict mode's double-invoke, and every subsequent
   *     re-render, both find it already true. This is what stops the launcher
   *     link from creating two runs.
   *
   * A bare `/arena/run-the-table` with no `start` param still falls through to
   * `RunStartGate` and creates nothing — `play-routing.spec.ts:112-134` and
   * `run-the-table.spec.ts`'s "navigating to the route creates no run" both
   * depend on that and are unaffected by this code path.
   */
  const startParamRef = useRef<RunType | null | undefined>(undefined);
  if (startParamRef.current === undefined) startParamRef.current = readStartParam();
  const startConsumedRef = useRef(false);
  // Focus management — see the effect below.
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const lastSurfaceKeyRef = useRef<string | null>(null);

  const commit = useCallback((next: RunPublicState) => {
    setState(next);
    saveActiveRun(next);
  }, []);

  // --- boot: readiness + daily descriptor + resume -------------------------
  const boot = useCallback(async () => {
    setBooting(true);
    setError(null);
    setChallengeError(null);
    const [readinessResult, dailyResult, challengeResult, metaResult] =
      await Promise.allSettled([
        getRunReadiness(),
        getDailyRun(),
        // Resolved eagerly so the gate can SHOW the seed the visitor was
        // challenged to before they commit, and so an expired link says so up
        // front instead of failing on the button press.
        challengeToken ? getChallenge(challengeToken) : Promise.resolve(null),
        // Optional: the gate degrades to count-free copy without it.
        getRulesetMeta(),
      ]);
    if (readinessResult.status === "fulfilled") setReadiness(readinessResult.value);
    if (dailyResult.status === "fulfilled") setDaily(dailyResult.value);
    if (metaResult.status === "fulfilled") setMeta(metaResult.value);
    if (challengeResult.status === "fulfilled") {
      setChallenge(challengeResult.value);
    } else if (challengeToken) {
      const e = challengeResult.reason;
      setChallengeError(
        e instanceof RunTheTableAPIError && e.status !== 0
          ? e.detail
          : "Could not reach the PEAK3 API to check it.",
      );
    }

    // A readiness failure is the only fatal one here: without it we cannot say
    // whether the mode is even enabled. The daily descriptor is optional.
    if (readinessResult.status === "rejected") {
      const e = readinessResult.reason;
      setError(
        e instanceof RunTheTableAPIError && e.status === 0
          ? "Could not reach the PEAK3 API. Is it running?"
          : "Could not load RUN THE TABLE. Try again.",
      );
    }

    /**
     * THE STALE-DAILY GATE (plan §4, path B).
     *
     * `StoredActiveRun` carried no date, `GET /runs/{id}` returns 200 for
     * yesterday's daily (it is a perfectly valid run), and
     * `shouldClearStoredRun` only fires on 404/409/410 — so an unfinished
     * daily was silently resumed today, and every day after that, and the
     * start gate never appeared again.
     *
     * The comparison is against the SERVER's daily key, taken from the daily
     * descriptor fetched two statements above, never a browser-computed date:
     * the reset is a timezone boundary the server owns (plan §2.1). If that
     * fetch failed, `todayDailyKey` is null and nothing is discarded — a
     * network blip must not throw away a run in progress.
     *
     * Track A's `useDailyReset` is wired below and calls `boot()` again when
     * the window rolls over mid-session, so this gate is what a live rollover
     * lands on as well as a cold start.
     */
    const todayDailyKey =
      dailyResult.status === "fulfilled"
        ? (dailyResult.value?.daily?.daily_key ?? dailyResult.value?.date ?? null)
        : null;

    const stored = loadActiveRun();
    if (isStaleDailyPointer(stored, todayDailyKey)) {
      clearActiveRun();
      setResumeNotice(
        "That daily run was from an earlier day. Today's board is ready below.",
      );
      setBooting(false);
      return;
    }
    if (stored) {
      try {
        const resumed = await getRun(stored.run_id);
        setState(resumed);
        // Claim the surface key WITHOUT focusing: a reload should land the
        // player back where they were with focus still at the top of the
        // document, not yanked into the middle of the page.
        lastSurfaceKeyRef.current = surfaceKeyFor(resumed);
        trackRunTheTable({
          type: "rtt_run_resumed",
          run_type: resumed.run_type,
          status: resumed.status,
        });
      } catch (e) {
        const status = e instanceof RunTheTableAPIError ? e.status : 500;
        if (shouldClearStoredRun(status)) {
          clearActiveRun();
          setResumeNotice(
            status === 404
              ? "Your last run has expired or no longer exists. Start a new one below."
              : "The ruleset changed since your last run, so it can no longer be replayed. Start a new one below.",
          );
        } else {
          setResumeNotice("Could not reload your last run right now. You can start a new one.");
        }
      }
    }
    setBooting(false);
  }, [challengeToken]);

  useEffect(() => {
    void boot();
  }, [boot]);

  /**
   * THE DAILY ROLLOVER, while the tab is already open (plan §2.1 / §4).
   *
   * Track A's `useDailyReset` fires when the server's window closes AND on
   * `visibilitychange`/`focus`, which is the case that actually matters: a
   * backgrounded tab's timers are throttled to a crawl and stop entirely while
   * a machine is asleep, so a countdown alone comes back reading hours that
   * never elapsed.
   *
   * ARMED ONLY WHEN A ROLLOVER COULD CHANGE ANYTHING: at the start gate, or
   * during a daily run. Passing a null `dailyKey` disarms the hook, so a
   * standard or challenge run — which belongs to no day — is never interrupted
   * by a boundary that has nothing to do with it.
   *
   * `boot()` is the whole handler: it refetches the descriptor, and
   * `isStaleDailyPointer` then sees yesterday's pointer against the new key and
   * drops it, landing the player on today's start gate.
   */
  const dailyWindow = daily?.daily ?? null;
  const watchDailyRollover = !state || state.run_type === "daily";
  useDailyReset({
    dailyKey: watchDailyRollover ? (dailyWindow?.daily_key ?? daily?.date ?? null) : null,
    secondsRemaining: watchDailyRollover ? (dailyWindow?.seconds_remaining ?? null) : null,
    window: watchDailyRollover ? dailyWindow : null,
    onReset: () => {
      void boot();
    },
  });

  // --- analytics -----------------------------------------------------------
  // Derived from the state the server sent, so an event can never describe a
  // run that did not happen. Each fires once per identity change, never per
  // render: `node_id` for the offer event, terminal status for the outcome
  // events.
  //
  // `rtt_run_started` is DELIBERATELY NOT an effect. It used to key on
  // `run_id`, which `boot()`'s resume path also sets — so resuming an existing
  // run, and every subsequent page reload of that run, re-fired "started" for a
  // run that had started once, hours earlier. Starting is an event, not a
  // state, so it is emitted from the three code paths that actually create a
  // run (`handleStart`, `handleRunItBack`, `handleReplaySeed`) once the server
  // has confirmed the creation.

  const nodeId = state?.active_node?.node_id ?? null;
  const nodeType = state?.active_node?.node_type ?? null;
  const nodeOfferCount = state ? offerCountFor(state) : 0;
  useEffect(() => {
    if (!nodeId || !nodeType) return;
    if (seenNodeRef.current === nodeId) return;
    seenNodeRef.current = nodeId;
    trackRunTheTable({
      type: "rtt_offer_viewed",
      node_type: nodeType,
      offer_count: nodeOfferCount,
    });
  }, [nodeId, nodeType, nodeOfferCount]);

  const terminalStatus = state && isTerminal(state.status) ? state.status : null;
  const receiptRecord = state?.receipt?.record ?? null;
  const ranTheTable = state?.receipt?.ran_the_table ?? false;
  const failedAct = state?.act ?? 0;
  useEffect(() => {
    if (!terminalStatus || !receiptRecord) return;
    if (terminalStatus === "complete") {
      trackRunTheTable({
        type: "rtt_run_completed",
        record: receiptRecord,
        ran_the_table: ranTheTable,
      });
    } else {
      trackRunTheTable({ type: "rtt_run_failed", record: receiptRecord, act: failedAct });
    }
  }, [terminalStatus, receiptRecord, ranTheTable, failedAct]);

  // --- focus management ----------------------------------------------------
  /**
   * Every action in this mode destroys keyboard focus: `busy` disables the
   * button the player just pressed, then the whole decision surface unmounts
   * and is replaced by the next one. A disabled-then-removed element cannot
   * keep focus, so it falls back to `<body>` and the next Tab press restarts
   * from the skip link at the top of the document — one Tab-from-the-top per
   * decision, eight decisions and four battles per run.
   *
   * Fix: after each committed state change, move focus to the new surface's
   * `<h2>` (its accessible title). `tabindex="-1"` is set at that moment rather
   * than baked into the child components, both because this file does not own
   * them and because a permanently focusable heading is itself a small a11y
   * smell — it is focusable only for as long as it is the focus target.
   *
   * The key is `screen:node_id` (falling back to `act`), so it changes on every
   * real transition and never re-fires on a re-render of the same surface. A
   * resume claims the key in `boot()` without focusing, so merely reloading the
   * page does not yank focus away from the top of the document.
   */
  const surfaceKey = state
    ? surfaceKeyFor(state, { roster: showRosterReveal, bossIntro: showBossIntro, boss: showBossReveal })
    : null;
  useEffect(() => {
    if (!surfaceKey) {
      lastSurfaceKeyRef.current = null;
      return;
    }
    const previous = lastSurfaceKeyRef.current;
    lastSurfaceKeyRef.current = surfaceKey;
    if (previous === surfaceKey) return;
    const container = surfaceRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>("h2") ?? container;
    target.setAttribute("tabindex", "-1");
    target.focus();
  }, [surfaceKey]);

  // --- action plumbing -----------------------------------------------------

  /** Applies one server round-trip. Returns the committed state, or null if it
   *  failed — so a caller that must only act on success (the start paths, which
   *  emit `rtt_run_started`) can tell the difference without another effect. */
  const run = useCallback(
    async (
      fn: () => Promise<RunPublicState>,
      announce?: string,
    ): Promise<RunPublicState | null> => {
      setBusy(true);
      setError(null);
      try {
        const next = await fn();
        commit(next);
        if (announce) setLiveMessage(announce);
        setRetry(null);
        return next;
      } catch (e) {
        // The same `fn` — and therefore the same idempotency key — so a retry
        // of a half-applied action is a no-op on the server, not a second buy.
        setRetry({ fn, announce });
        if (e instanceof RunTheTableAPIError) {
          setError(
            e.status === 0
              ? "Could not reach the PEAK3 API. Your run is safe — try again."
              : e.detail,
          );
          if (shouldClearStoredRun(e.status)) {
            clearActiveRun();
            setState(null);
            setResumeNotice(
              "That run is no longer valid under the current ruleset. Start a new one below.",
            );
          }
        } else {
          setError("Something went wrong. Try again.");
        }
        return null;
      } finally {
        setBusy(false);
      }
    },
    [commit],
  );

  function act(
    body: Parameters<typeof postRunAction>[1],
    label: string,
    announce?: string,
  ): void {
    if (!state) return;
    const key = makeIdempotencyKey(state.run_id, label);
    void run(() => postRunAction(state.run_id, body, key), announce);
  }

  /** The one place `rtt_run_started` is emitted, from a state the server has
   *  confirmed. Never fires on a resume, and never fires twice for one run. */
  function announceStarted(next: RunPublicState | null): void {
    if (!next) return;
    trackRunTheTable({ type: "rtt_run_started", run_type: next.run_type, seed: next.seed });
  }

  /**
   * Abandon the run in progress SERVER-SIDE and switch to its successor.
   *
   * Deliberately not `clearActiveRun()` + `handleStart()`. Clearing the local
   * pointer would leave the old run live on the server -- resumable from any
   * other tab, and countable by anything that reads runs -- which is the exact
   * defect this flow exists to close. `commit` then repoints local storage at
   * whatever the server returned, so a refresh mid-flow lands on the new run
   * and can never resurrect the abandoned one.
   *
   * Throws on failure so the dialog can stay open and say so; the run in
   * progress is untouched in that case.
   */
  const handleRestart = useCallback(async () => {
    if (!state) return;
    setError(null);
    setBusy(true);
    try {
      const next = await restartRun(state.run_id, state.action_count);
      commit(next);
      setLiveMessage("New run started. The previous run was abandoned.");
      announceStarted(next);
    } finally {
      setBusy(false);
    }
  }, [state, commit]);

  const handleStart = useCallback(
    async (runType: RunType) => {
      setResumeNotice(null);
      const next = await run(
        () =>
          createRun(runType, {
            seed: runType === "standard" ? initialSeed : undefined,
            date: runType === "daily" ? initialDate : undefined,
            challengeToken: runType === "challenge" ? challengeToken : undefined,
          }),
        "Run started.",
      );
      if (next) {
        trackRunTheTable({ type: "rtt_run_started", run_type: next.run_type, seed: next.seed });
      }
    },
    [run, initialSeed, initialDate, challengeToken],
  );

  // --- `?start=` — the homepage launcher's deep link (plan §5.1) ------------
  useEffect(() => {
    // Wait for boot: a stored run must be given the chance to resume first, or
    // a shared link would silently abandon a run in progress.
    if (booting) return;
    if (startConsumedRef.current) return;
    const requested = startParamRef.current;
    if (!requested) return;

    // Consume and strip BEFORE anything async. A refresh must not be able to
    // start a second run, and neither must a strict-mode double-invoke.
    startConsumedRef.current = true;
    stripStartParamFromUrl();

    // A resumed run wins outright. The param is still consumed and stripped —
    // it just does not create anything.
    if (state) return;
    // So does a challenge token. `?c=<token>&start=standard` must not quietly
    // start a fresh random-seed run and drop the token: the recipient came for
    // a specific shared board, and silently giving them a different one is the
    // wrong-board failure the challenge button exists to prevent. Fall through
    // to the gate, which offers the challenge explicitly.
    if (challengeToken) return;
    void handleStart(requested);
  }, [booting, state, handleStart, challengeToken]);

  // A fresh run on a NEW seed (the server picks one) versus the same seed
  // again — two genuinely different replays, so two buttons.
  async function handleRunItBack() {
    const runType = state?.run_type ?? "standard";
    trackRunTheTable({ type: "rtt_run_it_back", run_type: runType });
    clearActiveRun();
    announceStarted(await run(() => createRun("standard"), "New run started."));
  }

  async function handleReplaySeed() {
    const seed = state?.seed;
    clearActiveRun();
    announceStarted(
      await run(() => createRun("standard", { seed }), "Replaying the same seed."),
    );
  }

  async function handleChallenge(): Promise<string | null> {
    if (!state) return null;
    try {
      const res = await createChallenge(state.run_id);
      trackRunTheTable({ type: "rtt_challenge_created" });
      return res.challenge_token ?? null;
    } catch {
      return null;
    }
  }

  // --- render --------------------------------------------------------------

  if (booting) return <RunSkeleton />;

  if (!state) {
    return (
      <RunStartGate
        readiness={readiness}
        daily={daily}
        meta={meta}
        preferredMode={preferredMode}
        challengeToken={challengeToken}
        challenge={challenge}
        challengeError={challengeError}
        busy={busy}
        error={error}
        resumeNotice={resumeNotice}
        onStart={handleStart}
        onRetry={() => {
          setError(null);
          void boot();
        }}
      />
    );
  }

  const screen = screenForStatus(state.status);
  const node = state.active_node;
  const battle = currentBattle(state);

  /**
   * The HUD's one-line objective — RunHUD.tsx deliberately does not own this
   * (it would be a second switch statement duplicating the one below). Kept
   * as plain, short labels; the surface itself still carries the full title/
   * summary/consequence copy this only summarises.
   */
  const objective = showRosterReveal
    ? "Meet your roster"
    : showBossIntro || showBossReveal
      ? `Boss battle — ${bossTrack?.name ?? "Act " + state.act}`
      : screen === "system_select"
        ? "Choose a Front Office Perk"
        : screen === "node_active" && node
          ? NODE_TYPE_LABELS[node.node_type]
          : screen === "node_select"
            ? "Choose your next stop"
            : screen === "boss_preview"
              ? `Boss briefing — ${state.next_boss?.name ?? ""}`
              : screen === "battle"
                ? // P5-F5 (platform): this rendered the raw snake_case
                  // `boss_id` — `BattlePublic` (`battle`) never carries a
                  // display name at all, only the id. `state.next_boss` is
                  // the fix, not a new lookup: `action_resolve_boss` never
                  // increments `state.act` (only `action_advance` does,
                  // after this screen), so at the "battle" screen
                  // `next_boss` is still, correctly, the boss this battle
                  // was just fought against — the exact same source
                  // `BattleReveal`'s own header already trusts for the
                  // same reason. `battle.boss_id` stays only as the
                  // last-resort fallback `next_boss` itself already uses
                  // elsewhere in this file.
                  `Boss battle — ${state.next_boss?.name ?? battle?.boss_id ?? ""}`
                : screen === "result"
                  ? "Run complete"
                  : "Run the Table";

  let surface: React.ReactNode = null;
  let mobilePrimaryLabel: string | null = null;
  let mobilePrimary: (() => void) | null = null;

  /**
   * One `reveal` action — always called with `count = track.total` now
   * (SYNTHESIS_CONTRACT.md §2.2: "one user action → one request → server
   * returns all 7 authoritative `revealed_slots` in order"). The engine
   * already saturates a count beyond what remains, which is what makes this
   * legal and idempotent in one round trip; `RevealSequenceSurface` is what
   * paces the CLIENT's presentation of the response afterward.
   *
   * The idempotency key includes `action_count`, so a double-click on
   * "Reveal your roster" cannot fire the batch twice.
   */
  const reveal = (target: "roster" | "boss", count: number): void => {
    act(
      runActions.reveal(target, count),
      `reveal:${target}:${state.action_count}`,
      count > 1 ? "Roster revealed." : "Revealed.",
    );
  };

  /** Every priced control routes through here, so a sink is charged by exactly
   *  one action type and the client never guesses which. */
  const spendSink = (sink: CreditSink): void => {
    if (sink.id === "market_refresh") {
      act(runActions.marketRefresh(), `refresh:${nodeId}`, "Market refreshed.");
      return;
    }
    if (sink.id === "emergency_recovery") {
      act(
        runActions.emergencyRecovery(),
        `recovery:${state.run_id}`,
        "Life recovered.",
      );
    }
    // `role_focus` and `reserve_card` are Scout & Prepare branches, not
    // standalone actions: they need a role or a card id before they mean
    // anything, so `ScoutPrepare`'s panels call `act` directly and this
    // function is never reached with either id.
  };

  if (showRosterReveal && rosterTrack) {
    // Before act 1, and before the first decision: one press reveals all
    // seven slots in a single batched round trip (SYNTHESIS_CONTRACT.md
    // §2.2); the client then paces its OWN presentation of that
    // already-authoritative data through `useRevealSequence` — see
    // `showRosterReveal`'s docstring above for why this can no longer be
    // gated on the server's `roster.complete` alone.
    surface = (
      <RevealSequenceSurface
        track={rosterTrack}
        sequence={rosterSequence}
        kind="roster"
        title="Meet your roster"
        subtitle="Five starters and two bench players, revealed together."
        sourceNote={revealSourceFor("roster")}
        orderLabelFor={(slotId, label) => label ?? slotId.replace(/_/g, " ")}
        cardLookup={(cardId) =>
          [...state.starters, ...state.bench].find((s) => s.card?.card_id === cardId)?.card ?? null
        }
        reducedMotion={reducedMotion}
        busy={busy}
        onStartReveal={(count) => reveal("roster", count)}
        footer={
          // "Skip the animation" is not "skip the information" — skip-all
          // lands on all 7 slots fully resolved and HOLDS there; only this
          // explicit press leaves the screen (lead's ruling, see
          // `rosterRevealDismissed`'s docstring above).
          <button
            type="button"
            data-testid="rtt-reveal-continue-roster"
            onClick={() => setRosterRevealDismissed(true)}
            className="rtt-tap pk-lift pk-press self-start rounded-lg px-6 text-sm font-bold uppercase tracking-wide"
            style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
          >
            Continue
          </button>
        }
      />
    );
  } else if (showBossIntro && bossTrack && state.next_boss) {
    surface = (
      <BossIntro
        boss={state.next_boss}
        lanesToWin={state.next_boss.lanes_to_win ?? state.lanes_to_win}
        reducedMotion={reducedMotion}
        onComplete={() => setDismissedBossIntroId(bossTrack.boss_id)}
      />
    );
  } else if (showBossReveal && bossTrack) {
    surface = (
      <RevealSequenceSurface
        track={bossTrack}
        sequence={bossSequence}
        kind="boss"
        title={bossTrack.name}
        subtitle={bossTrack.tagline}
        sourceNote={revealSourceFor("boss")}
        orderLabelFor={(slotId, label) => label ?? slotId.replace(/_/g, " ")}
        cardLookup={(cardId) =>
          [...(state.next_boss?.starters ?? []), ...(state.next_boss?.bench ?? [])].find(
            (c) => c.card_id === cardId,
          ) ?? null
        }
        pairedCardLookup={(slotId) =>
          [...state.starters, ...state.bench].find((s) => s.slot_id === slotId)?.card ?? null
        }
        reducedMotion={reducedMotion}
        busy={busy}
        onStartReveal={(count) => reveal("boss", count)}
        footer={
          <button
            type="button"
            data-testid="rtt-reveal-continue-boss"
            onClick={() => setDismissedBossRevealId(bossTrack.boss_id)}
            className="rtt-tap pk-lift pk-press self-start rounded-lg px-6 text-sm font-bold uppercase tracking-wide"
            style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
          >
            Continue to the briefing
          </button>
        }
      />
    );
  } else if (screen === "system_select") {
    surface = (
      <SystemSelect
        offer={state.pending_system_offer ?? []}
        active={state.systems}
        act={state.act}
        busy={busy}
        onSelect={(systemId) => {
          trackRunTheTable({ type: "rtt_system_selected", system_id: systemId });
          // "Front Office Perk", not "System": this was the only surface in
          // the game using the internal name as the primary term, and it was
          // the one place a screen-reader user met it first.
          act(
            runActions.selectSystem(systemId),
            `system:${systemId}`,
            "Front Office Perk selected.",
          );
        }}
      />
    );
  } else if (screen === "node_select") {
    surface = (
      <NodeChoice
        options={state.stage_options ?? []}
        act={state.act}
        stage={state.stage}
        stagesPerAct={state.stages_per_act}
        busy={busy}
        onChoose={(option) => {
          trackRunTheTable({
            type: "rtt_node_chosen",
            node_type: option.node_type,
            act: state.act,
            stage: state.stage,
          });
          act(runActions.chooseNode(option.node_id), `node:${option.node_id}`, `${option.title} opened.`);
        }}
      />
    );
  } else if (screen === "node_active" && node) {
    // Every node's priced controls, in one place, under the node's own
    // decision. `credit_sinks` is empty on a node that offers none, and
    // `CreditSinks` renders nothing for an empty list — so this composes with
    // all four node types without a branch per type.
    const sinks = (
      <CreditSinks sinks={node.credit_sinks ?? []} busy={busy} onSpend={spendSink} />
    );
    if (node.node_type === "draft_room") {
      surface = (
        <>
        <DraftRoom
          node={node}
          slots={[...state.starters, ...state.bench]}
          credits={state.credits}
          busy={busy}
          onBuy={(offer, slotId, useVetMin) => {
            trackRunTheTable({
              type: "rtt_acquisition",
              cost: useVetMin ? 0 : offer.cost,
              veteran_minimum: useVetMin,
              act: state.act,
            });
            act(
              runActions.draftBuy(offer.card_id, slotId, useVetMin),
              `buy:${offer.card_id}:${slotId}`,
              `${offer.player_name} signed.`,
            );
          }}
          onPass={() => {
            trackRunTheTable({ type: "rtt_offer_passed", node_type: "draft_room", act: state.act });
            act(runActions.draftPass(), "draft_pass", "Passed on the draft room.");
          }}
          scoutIntel={activeScoutIntel}
        />
        {sinks}
        </>
      );
    } else if (node.node_type === "trade_desk") {
      surface = (
        <>
        <TradeDesk
          node={node}
          credits={state.credits}
          busy={busy}
          scoutIntel={activeScoutIntel}
          onTrade={(outgoingSlotId, incomingCardId, netCost) => {
            trackRunTheTable({ type: "rtt_trade", net_cost: netCost, act: state.act });
            act(
              runActions.trade(outgoingSlotId, incomingCardId),
              `trade:${outgoingSlotId}:${incomingCardId}`,
              "Trade completed.",
            );
          }}
          onDecline={() => {
            trackRunTheTable({ type: "rtt_offer_passed", node_type: "trade_desk", act: state.act });
            act(runActions.declineTrade(), "decline_trade", "Trade declined.");
          }}
        />
        {sinks}
        </>
      );
    } else if (node.node_type === "film_room") {
      // Scout & Prepare gets its own surface: each of its three branches needs
      // a second selection (a lane, a role, a card) before it is a legal
      // action, and the outcome of each is data the player has to read first.
      // Its two priced branches ARE the Role Focus and Reserve a Card sinks, so
      // they are rendered inside the panel rather than duplicated below it.
      surface = (
        <ScoutPrepare
          node={node}
          credits={state.credits}
          busy={busy}
          onScoutBoss={(lane: LaneField) =>
            act(
              runActions.filmRoom("scout_boss", { lane }),
              `scout:${node.node_id}:${lane}`,
              "Boss scouted. One lane prepared.",
            )
          }
          onShapeMarket={(role: Role) =>
            act(
              runActions.filmRoom("shape_market", { role }),
              `focus:${node.node_id}:${role}`,
              "Role Focus armed for the next market.",
            )
          }
          onReserveCard={(cardId: string) =>
            act(
              runActions.filmRoom("reserve_card", { card_id: cardId }),
              `reserve:${node.node_id}:${cardId}`,
              "Card reserved at today's price.",
            )
          }
        />
      );
    } else {
      surface = (
        <>
        <ChoiceNode
          node={node}
          busy={busy}
          onChoose={(choiceId) =>
            act(
              runActions.restBank(choiceId),
              `${node.node_type}:${choiceId}`,
              "Choice taken.",
            )
          }
        />
        {sinks}
        </>
      );
    }
  } else if (screen === "boss_preview" && state.next_boss) {
    const boss = state.next_boss;
    const resolve = () => {
      trackRunTheTable({ type: "rtt_boss_started", act: state.act, boss_id: boss.boss_id });
      act(runActions.resolveBoss(), `resolve:${boss.boss_id}`, "Battle resolved.");
    };
    mobilePrimaryLabel = "Resolve";
    mobilePrimary = resolve;
    surface = (
      <BossPreview
        boss={boss}
        playerLanes={state.lane_profile}
        playerTotal={state.roster_total}
        benchWeight={state.bench_weight}
        lives={state.lives}
        busy={busy}
        onResolve={resolve}
        /* THIS BOSS's number, not the ruleset default. A boss rule may raise
           the lanes an outright win takes for both sides
           (`config.BOSS_LANES_TO_WIN` — v3's Final Boss does), so stating the
           run-wide `lanes_to_win` here would print the wrong win condition on
           the one battle where it matters most. Falls back to the run's value
           for a payload that predates `boss.lanes_to_win`. */
        lanesToWin={boss.lanes_to_win ?? state.lanes_to_win}
      />
    );
  } else if (screen === "battle" && battle) {
    const advance = () => {
      trackRunTheTable({
        type: "rtt_boss_completed",
        act: battle.act,
        boss_id: battle.boss_id,
        outcome: battle.outcome,
      });
      act(runActions.advance(), `advance:${battle.act}`, "Moving on.");
    };
    mobilePrimaryLabel = "Continue";
    mobilePrimary = advance;
    surface = (
      <BattleReveal
        battle={battle}
        boss={state.next_boss}
        busy={busy}
        onAdvance={advance}
        advanceLabel={battle.act >= state.acts_total ? "See the receipt" : "Next act"}
        /* The number THIS battle was actually decided against, recorded on the
           result itself, so the reveal cannot narrate a threshold the fight did
           not use. */
        lanesToWin={battle.lanes_to_win ?? state.lanes_to_win}
      />
    );
  } else if (screen === "result" && state.receipt) {
    surface = (
      <RunResult
        receipt={state.receipt}
        versions={state.versions}
        actsTotal={state.acts_total}
        map={state.map}
        busy={busy}
        onRunItBack={handleRunItBack}
        onReplaySeed={handleReplaySeed}
        onChallenge={handleChallenge}
      />
    );
  } else {
    // Reachable only if the server sends a status whose payload block is
    // missing (e.g. `node_active` with no `active_node`). Say so plainly and
    // offer a reload rather than rendering a blank column.
    surface = (
      <div
        role="alert"
        className="rounded-xl border p-4 flex flex-col gap-2"
        style={{ background: "var(--bg-elevated)", borderColor: "var(--incorrect-dim)" }}
        data-testid="rtt-inconsistent-state"
      >
        <p className="text-sm" style={{ color: "var(--text-primary)" }}>
          This run came back in a state the board cannot draw ({state.status}).
        </p>
        <button
          type="button"
          onClick={() => void run(() => getRun(state.run_id))}
          className="rtt-tap self-start rounded-lg px-4 text-xs font-semibold uppercase tracking-wide"
          style={{
            background: "var(--bg-surface)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-default)",
          }}
        >
          Reload the run
        </button>
      </div>
    );
  }

  /**
   * Is a guided tour allowed to run right now?
   *
   * True while a server round-trip is in flight (`busy` — the surface is about
   * to be replaced under the spotlight) and for the whole battle screen, which
   * is a timed lane-by-lane reveal. W3's `GuidedTour` takes this as `blocked`.
   */
  const tourBlocked = busy || screen === "battle";

  return (
    <div className="rtt-shell" data-testid="rtt-shell" data-tour-blocked={tourBlocked ? "true" : "false"}>
      {/* Top HUD (PRODUCT_EXPERIENCE_CONTRACT.md §4) — credits, lives, act
          progress and the current objective, always visible above the
          three-zone grid. Spans the full shell width via `.rtt-hud`'s
          `grid-column: 1 / -1` (rtt-polish.css). */}
      <RunHUD
        state={state}
        objective={objective}
        scoutIntel={activeScoutIntel}
        restartControl={
          /* Only while the run is still live. A concluded run already offers
             "Run it back" on the result screen, which creates a new run WITHOUT
             abandoning anything -- a finished run is a result the player earned
             and must never be relabelled. */
          !isTerminal(state.status) ? (
            <RestartRunControl
              canRestart={state.can_restart !== false}
              busy={busy}
              onConfirm={handleRestart}
            />
          ) : null
        }
      />

      {/* Zone 1 — the ladder. Desktop only; a phone gets the progress strip
          inside the decision column instead (DOM order: strip, surface,
          roster). It RECEDES: `.rtt-map-rail` quiets the whole rail so the
          decision column is unambiguously the dominant surface, and only the
          current row keeps full contrast. */}
      <div className="rtt-zone-left" data-tour-id="run-map">
        <RunMap map={state.map} />
      </div>

      {/* Zone 2 — the decision surface */}
      <div className="flex flex-col gap-4 min-w-0">
        <div className="rtt-mobile-only">
          <RunProgressStrip map={state.map} />
        </div>

        <div aria-live="polite" className="sr-only" data-testid="rtt-live">
          {liveMessage}
        </div>

        {error && (
          <div
            role="alert"
            data-testid="rtt-error"
            className="rounded-lg px-3 py-2 flex flex-wrap items-center gap-2 text-sm"
            style={{ background: "var(--incorrect-bg)", color: "var(--incorrect)" }}
          >
            <span>{error}</span>
            {retry && (
              <button
                type="button"
                data-testid="rtt-error-retry"
                onClick={() => void run(retry.fn, retry.announce)}
                className="rtt-tap rounded px-3 text-xs font-semibold uppercase tracking-wide"
                style={{
                  background: "var(--bg-surface)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-default)",
                }}
              >
                Try again
              </button>
            )}
          </div>
        )}

        {/* The focus target's container. A plain wrapper, so it simply takes
            the surface's place as the flex item and the column's gaps are
            unchanged.

            `motion.div` keyed on the surface identity gives each decision a
            short directional enter — the new surface arrives from below rather
            than replacing the old one in a single frame, which is the only
            cue that the board moved. `layout={false}` and transform/opacity
            only; under reduced motion the transition is zero-length and the
            initial state is skipped entirely, so the surface is finished on
            first paint. */}
        <div
          ref={surfaceRef}
          /* `.rtt-decision-zone` is the "dominant surface" treatment, applied
             to a wrapper this file owns rather than to the shared
             `.rtt-decision-surface` class — three of the six components using
             that class belong to W3, and restyling it would reach into their
             work. Skipped on the receipt, which already has its own
             `.share-card-shell` frame and must not be double-boxed. */
          className={`min-w-0${screen === "result" ? "" : " rtt-decision-zone"}`}
          data-tour-id="rtt-decision"
        >
          <motion.div
            key={surfaceKey ?? "surface"}
            initial={reducedMotion ? false : { opacity: 0, transform: "translateY(8px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            transition={motionTransition("base", "out", reducedMotion)}
          >
            {surface}
          </motion.div>
        </div>

        {/* W3's guided tour: the visible Help / Tour control AND the
            auto-starting instance, in one mount. `blocked` defers the
            auto-start and disables the button while the board is mid-action —
            see `tourBlocked` above — and re-evaluates when the block clears.
            Placed AFTER the decision surface in DOM order deliberately: the
            e2e driver clicks the first enabled button inside a surface testid,
            and this button is outside every surface. */}
        <div className="flex flex-wrap items-center gap-2">
          <TourLauncher blocked={tourBlocked} data-testid="rtt-tour-launcher" />
        </div>
      </div>

      {/* Zone 3 — the persistent front-office rail.
          Rendered ONCE. It used to be two `<RunTray>` instances (a desktop rail
          plus an `.rtt-mobile-only` copy inside the decision column), which
          duplicated every `data-testid` and made a `data-tour-id` ambiguous.
          `.rtt-zone-right-fluid` (rtt-polish.css) drops the same element back
          into normal flow below 1024px, so the phone gets exactly one roster,
          after the decision and never above it. */}
      <div className="rtt-zone-right rtt-zone-right-fluid">
        <RunTray
          state={state}
          laneProfileRelevant={screen === "boss_preview" || screen === "battle"}
          concealedRosterUnless={rosterConcealment}
        />
      </div>

      <MobileTray
        state={state}
        primaryLabel={mobilePrimaryLabel}
        onPrimary={mobilePrimary}
        primaryDisabled={busy}
      />
    </div>
  );
}

/**
 * The identity of the decision surface currently on screen: one value per
 * distinct thing the player can be looking at. Exported for tests.
 *
 * `activeReveal` carries the CALLER's local `useRevealSequence` state
 * (`RunTheTableGame`'s `showRosterReveal`/`showBossReveal`) — since batching
 * the reveal into one POST (SYNTHESIS_CONTRACT.md §2.2) means the server's
 * own `roster.complete`/`boss.complete` flips true the instant that single
 * request resolves, long before the local paced presentation finishes, this
 * function can no longer answer "is a reveal surface showing" from `state`
 * alone. Omitting the second argument falls back to the server-only check
 * (`needsOpeningReveal`/`needsBossReveal`), which is still correct for a
 * caller with no local sequence state yet, such as the resume path in
 * `boot()` — see the call site there.
 */
export function surfaceKeyFor(
  state: RunPublicState,
  activeReveal?: { roster: boolean; bossIntro: boolean; boss: boolean },
): string {
  // A reveal is a distinct surface that OCCUPIES another screen's slot, so the
  // key has to say so — otherwise finishing the opening reveal would replace it
  // with the System select under the identical key `system_select:1`, and the
  // focus effect (which fires only on a key change) would never move focus to
  // the surface that just arrived. The boss intro is likewise its own key —
  // it occupies the same `boss_ready` status the reveal and the briefing
  // also occupy, and needs its own focus-on-arrival moment.
  if (activeReveal ? activeReveal.roster : needsOpeningReveal(state)) return "reveal_roster:1";
  if (activeReveal?.bossIntro) return `boss_intro:${state.act}`;
  if (activeReveal ? activeReveal.boss : needsBossReveal(state)) return `reveal_boss:${state.act}`;
  return `${screenForStatus(state.status)}:${state.active_node?.node_id ?? state.act}`;
}

/* ---------------------------------------------------------------------------
 * Guided tour contract (W3's `components/ui/tour-steps.ts::TOUR_TARGET_IDS`)
 * ---------------------------------------------------------------------------
 * Placed by this workstream, one attribute per element:
 *
 *   rtt-run-map        RunMap's <nav>
 *   rtt-progress-strip RunProgressStrip's root (mobile)
 *   rtt-decision       the surfaceRef wrapper above
 *   rtt-credits        RunHUD's Credits tile (moved out of RunTray — §4)
 *   rtt-lives          RunHUD's Lives tile (moved out of RunTray — §4)
 *   rtt-roster         RunTray's roster <section>
 *   rtt-systems        RunTray's rtt-active-systems <section>
 *   rtt-lane-profile   RunTray's lane-profile <details>
 *   rtt-mobile-tray    MobileTray's root
 *
 * `rtt-system-select` is W3's own, on SystemSelect, and is not duplicated here.
 *
 * `<TourLauncher blocked={tourBlocked} />` is mounted once, after the decision
 * surface — it is the visible Help / Tour control AND the auto-starting
 * instance. Coachmarks are mounted in DraftRoom, TradeDesk and BossPreview,
 * always AFTER that surface's action controls: `e2e/run-the-table.spec.ts`
 * drives the game by clicking the first enabled <button> inside a surface's
 * testid, and a coachmark's "Got it" would otherwise capture that click.
 * ------------------------------------------------------------------------- */

/** Exported for tests: how many offers a node is showing, used to fire the
 *  "offer viewed" event exactly once per node rather than per render. */
export function offerCountFor(state: RunPublicState): number {
  const node = state.active_node;
  if (!node) return 0;
  if (node.node_type === "draft_room") return draftOffers(node).length;
  if (node.node_type === "trade_desk") return tradeIncoming(node).length;
  return node.choices?.length ?? 0;
}
