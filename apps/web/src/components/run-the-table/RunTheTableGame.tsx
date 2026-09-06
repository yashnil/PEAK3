"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/a11y";
import { useDailyReset } from "@/lib/use-daily-reset";
import { CreditSink, LaneField, RevealSlot, Role, RulesetMeta, RunPublicState, RunReadiness, RunType, DailyDescriptor } from "@/types/run-the-table";
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
  actNumeral,
  clearActiveRun,
  currentBattle,
  describeRunTransition,
  draftOffers,
  isNewerRun,
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
  type RunMoment,
} from "@/lib/run-the-table-state";
import { useCommandLane } from "@/lib/game-feel/authoritative";
import { revealSourceFor } from "./RevealSequenceSurface";
import { useRevealSequence } from "./useRevealSequence";
import RunStartGate from "./RunStartGate";
import RunSkeleton from "./RunSkeleton";
import RestartRunControl from "./RestartRunControl";
import PeakV2RTTShell, { type ActTransitionMoment } from "@/components/v2/rtt/PeakV2RTTShell";
import PeakV2RTTBossIntro from "@/components/v2/rtt/PeakV2RTTBossIntro";
import PeakV2RTTBossLineup from "@/components/v2/rtt/PeakV2RTTBossLineup";
import PeakV2RTTBattleResult from "@/components/v2/rtt/PeakV2RTTBattleResult";
import PeakV2RTTDraftRoom from "@/components/v2/rtt/PeakV2RTTDraftRoom";
import PeakV2RTTTradeDesk from "@/components/v2/rtt/PeakV2RTTTradeDesk";
import PeakV2RTTScoutPrepare from "@/components/v2/rtt/PeakV2RTTScoutPrepare";
import PeakV2RTTChoiceNode from "@/components/v2/rtt/PeakV2RTTChoiceNode";
import PeakV2RTTSystemSelect from "@/components/v2/rtt/PeakV2RTTSystemSelect";
import PeakV2RTTNodeChoice from "@/components/v2/rtt/PeakV2RTTNodeChoice";
import PeakV2RTTBossPreview from "@/components/v2/rtt/PeakV2RTTBossPreview";
import PeakV2RTTCreditSinks from "@/components/v2/rtt/PeakV2RTTCreditSinks";
import PeakV2RTTResult from "@/components/v2/rtt/PeakV2RTTResult";
import { GuidedTour, useGuidedTour } from "@/components/ui/GuidedTour";
import { RUN_THE_TABLE_TOUR, RUN_THE_TABLE_TOUR_ID, RUN_THE_TABLE_TOUR_VERSION } from "@/components/ui/tour-steps";

/**
 * RUN THE TABLE, top to bottom.
 *
 * SERVER-AUTHORITATIVE: every action POSTs through ONE command lane
 * (`useCommandLane` — a press while a command is in flight is refused before
 * any handler runs) and the whole `RunPublicState` is replaced from the
 * response, but only when it is NEWER than what is on screen (`isNewerRun`,
 * on `action_count`) — a stale read can never roll the board back. There is
 * no local score, price or battle resolution anywhere in this tree; the one
 * local number is the PROJECTED credits figure while a card is selected,
 * which the authoritative snapshot reconciles.
 *
 * The active run's id is mirrored to localStorage so a refresh resumes at
 * the same screen — `screenForStatus` is the only thing that decides which
 * screen that is.
 *
 * Every announcement (a signing, a life lost, an act cleared) is DERIVED
 * from two consecutive snapshots in the same render the new one lands
 * (`describeRunTransition`), never from a timer and never before the board
 * it describes.
 */
interface Props {
  initialSeed?: number;
  initialDate?: string;
  challengeToken?: string;
  preferredMode?: "daily";
}

const START_PARAM_VALUES: readonly RunType[] = ["standard"] as const;

export function readStartParam(search?: string): RunType | null {
  const raw = search ?? (typeof window === "undefined" ? "" : window.location.search);
  if (!raw) return null;
  const value = new URLSearchParams(raw).get("start");
  return START_PARAM_VALUES.includes(value as RunType) ? (value as RunType) : null;
}

export function urlWithoutStartParam(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete("start");
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}

/** Synchronous `history.replaceState` — see the previous revision's note on
 *  why a deferred `router.replace` lost a race on cold CI. Idempotent. */
export function stripStartParamFromUrl(): void {
  if (typeof window === "undefined") return;
  const { pathname, search, hash } = window.location;
  if (!new URLSearchParams(search).has("start")) return;
  window.history.replaceState(window.history.state, "", `${urlWithoutStartParam(pathname, search)}${hash}`);
}

const ACT_TRANSITION_MS = 1700;

export default function RunTheTableGame({ initialSeed, initialDate, challengeToken, preferredMode }: Props) {
  const [state, setState] = useState<RunPublicState | null>(null);
  const [readiness, setReadiness] = useState<RunReadiness | null>(null);
  const [daily, setDaily] = useState<DailyDescriptor | null>(null);
  const [meta, setMeta] = useState<RulesetMeta | null>(null);
  const [challenge, setChallenge] = useState<ChallengeDescriptor | null>(null);
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const [retry, setRetry] = useState<{ fn: () => Promise<RunPublicState>; announce?: string } | null>(null);
  const seenNodeRef = useRef<string | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const lane = useCommandLane();
  const busy = lane.busy;

  // --- game-feel state ------------------------------------------------------
  const [moment, setMoment] = useState<RunMoment | null>(null);
  const [actTransition, setActTransition] = useState<ActTransitionMoment | null>(null);
  const [projectedCredits, setProjectedCredits] = useState<number | null>(null);
  const [targetedSlots, setTargetedSlots] = useState<string[]>([]);
  const [pendingSlot, setPendingSlot] = useState<string | null>(null);
  /** True when the run on screen arrived by RESUME rather than by an action —
   *  a resumed ending or battle shows its finished state, never a replay. */
  const [resumed, setResumed] = useState(false);
  /** The failure ending: the battle that ended the run is shown once before
   *  the receipt; the receipt itself follows on a client-side acknowledgement. */
  const [endingSeen, setEndingSeen] = useState<string | null>(null);
  const stateRef = useRef<RunPublicState | null>(null);

  const rosterTrack = state?.reveal?.roster ?? null;
  const rosterSequence = useRevealSequence<RevealSlot>({
    items: rosterTrack?.revealed_slots ?? [],
    total: rosterTrack?.total ?? 0,
    reducedMotion,
    resetKey: state?.run_id ?? null,
  });
  const bossTrack = state?.reveal?.boss ?? null;
  const bossSequence = useRevealSequence<RevealSlot>({
    items: bossTrack?.revealed_slots ?? [],
    total: bossTrack?.total ?? 0,
    reducedMotion,
    resetKey: bossTrack?.boss_id ?? null,
  });

  const [rosterRevealDismissed, setRosterRevealDismissed] = useState(false);
  const [dismissedBossIntroId, setDismissedBossIntroId] = useState<string | null>(null);
  const [dismissedBossRevealId, setDismissedBossRevealId] = useState<string | null>(null);
  const [scoutIntel, setScoutIntel] = useState<ScoutIntel | null>(null);
  const runIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!state || state.run_id === runIdRef.current) return;
    runIdRef.current = state.run_id;
    setRosterRevealDismissed(false);
    setDismissedBossIntroId(null);
    setDismissedBossRevealId(null);
    setScoutIntel(null);
    setEndingSeen(null);
  }, [state]);

  const showRosterReveal = !!state && (needsOpeningReveal(state) || rosterSequence.started) && !rosterRevealDismissed;
  const bossRevealDismissedNow = !!bossTrack && dismissedBossRevealId === bossTrack.boss_id;
  const bossActive =
    !!state &&
    !!bossTrack &&
    (needsBossReveal(state) || bossSequence.started || (state.status === "boss_ready" && bossTrack.revealed > 0 && !bossRevealDismissedNow));
  const bossIntroDone = !bossTrack || dismissedBossIntroId === bossTrack.boss_id || bossTrack.revealed > 0;
  const showBossIntro = bossActive && !bossIntroDone;
  const showBossReveal = bossActive && bossIntroDone && !bossRevealDismissedNow;

  // The walkthrough never opens by itself any more — the run teaches itself
  // (`PeakV2RTTCoach`). It is one press away behind "How to play".
  const tourBlocked = showRosterReveal || showBossIntro || showBossReveal || busy;
  const tour = useGuidedTour({ tourId: RUN_THE_TABLE_TOUR_ID, version: RUN_THE_TABLE_TOUR_VERSION, blocked: tourBlocked, autoStart: false });

  useEffect(() => {
    const report = state?.active_node?.scout?.choices.find((c) => c.id === "scout_boss")?.report;
    if (!report) return;
    setScoutIntel({ bossId: report.boss_id, bossName: report.name, weakestLane: report.weakest_lane, weakestLabel: LANE_LABELS[report.weakest_lane] });
  }, [state?.active_node]);

  const activeScoutIntel = scoutIntel && state?.next_boss && scoutIntel.bossId === state.next_boss.boss_id ? scoutIntel : null;

  const startParamRef = useRef<RunType | null | undefined>(undefined);
  if (startParamRef.current === undefined) startParamRef.current = readStartParam();
  const startConsumedRef = useRef(false);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const lastSurfaceKeyRef = useRef<string | null>(null);

  /**
   * THE ONE WAY A SNAPSHOT REACHES THE SCREEN. Newer wins; the moment it
   * announces is derived from the two snapshots in the same call.
   */
  const commit = useCallback((next: RunPublicState, options: { fromResume?: boolean } = {}) => {
    const prev = stateRef.current;
    if (!isNewerRun(prev, next)) return false;
    stateRef.current = next;
    setState(next);
    saveActiveRun(next);
    setResumed(options.fromResume === true);
    if (!options.fromResume) {
      const m = describeRunTransition(prev, next);
      if (m) {
        if (m.kind === "act_cleared") {
          setActTransition({ id: m.id, numeral: actNumeral(prev?.act ?? next.act - 1), detail: `${next.lives} ${next.lives === 1 ? "life" : "lives"} · ${next.credits} credits · Act ${actNumeral(next.act)} begins` });
        } else if (m.kind !== "life_lost" && m.kind !== "boss_won" && m.kind !== "boss_drawn") {
          // A battle's consequence is staged by the battle surface itself
          // (lanes → verdict → the life or the credits); a second banner over
          // it would announce the same thing twice.
          setMoment(m);
        }
      }
    }
    return true;
  }, []);

  useEffect(() => {
    if (!actTransition) return;
    const id = window.setTimeout(() => setActTransition(null), ACT_TRANSITION_MS);
    return () => window.clearTimeout(id);
  }, [actTransition]);

  // --- boot: readiness + daily descriptor + resume -------------------------
  const boot = useCallback(async () => {
    setBooting(true);
    setError(null);
    setChallengeError(null);
    const [readinessResult, dailyResult, challengeResult, metaResult] = await Promise.allSettled([
      getRunReadiness(),
      getDailyRun(),
      challengeToken ? getChallenge(challengeToken) : Promise.resolve(null),
      getRulesetMeta(),
    ]);
    if (readinessResult.status === "fulfilled") setReadiness(readinessResult.value);
    if (dailyResult.status === "fulfilled") setDaily(dailyResult.value);
    if (metaResult.status === "fulfilled") setMeta(metaResult.value);
    if (challengeResult.status === "fulfilled") {
      setChallenge(challengeResult.value);
    } else if (challengeToken) {
      const e = challengeResult.reason;
      setChallengeError(e instanceof RunTheTableAPIError && e.status !== 0 ? e.detail : "Could not reach the PEAK3 API to check it.");
    }
    if (readinessResult.status === "rejected") {
      const e = readinessResult.reason;
      setError(e instanceof RunTheTableAPIError && e.status === 0 ? "Could not reach the PEAK3 API. Is it running?" : "Could not load RUN THE TABLE. Try again.");
    }

    const todayDailyKey = dailyResult.status === "fulfilled" ? (dailyResult.value?.daily?.daily_key ?? dailyResult.value?.date ?? null) : null;
    const stored = loadActiveRun();
    if (isStaleDailyPointer(stored, todayDailyKey)) {
      clearActiveRun();
      setResumeNotice("That daily run was from an earlier day. Today's board is ready below.");
      setBooting(false);
      return;
    }
    if (stored) {
      try {
        const restored = await getRun(stored.run_id);
        lastSurfaceKeyRef.current = surfaceKeyFor(restored);
        commit(restored, { fromResume: true });
        if (!isTerminal(restored.status)) {
          setMoment({ id: `${restored.run_id}:resumed`, kind: "credits", title: "Run resumed", detail: `Act ${actNumeral(restored.act)} · ${restored.lives} lives · ${restored.credits} credits`, tone: "neutral" });
        }
        trackRunTheTable({ type: "rtt_run_resumed", run_type: restored.run_type, status: restored.status });
      } catch (e) {
        const status = e instanceof RunTheTableAPIError ? e.status : 500;
        if (shouldClearStoredRun(status)) {
          clearActiveRun();
          setResumeNotice(status === 404 ? "Your last run has expired or no longer exists. Start a new one below." : "The ruleset changed since your last run, so it can no longer be replayed. Start a new one below.");
        } else {
          setResumeNotice("Could not reload your last run right now. You can start a new one.");
        }
      }
    }
    setBooting(false);
  }, [challengeToken, commit]);

  useEffect(() => {
    void boot();
  }, [boot]);

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
  const nodeId = state?.active_node?.node_id ?? null;
  const nodeType = state?.active_node?.node_type ?? null;
  const nodeOfferCount = state ? offerCountFor(state) : 0;
  useEffect(() => {
    if (!nodeId || !nodeType) return;
    if (seenNodeRef.current === nodeId) return;
    seenNodeRef.current = nodeId;
    trackRunTheTable({ type: "rtt_offer_viewed", node_type: nodeType, offer_count: nodeOfferCount });
  }, [nodeId, nodeType, nodeOfferCount]);

  const terminalStatus = state && isTerminal(state.status) ? state.status : null;
  const receiptRecord = state?.receipt?.record ?? null;
  const ranTheTable = state?.receipt?.ran_the_table ?? false;
  const failedAct = state?.act ?? 0;
  useEffect(() => {
    if (!terminalStatus || !receiptRecord) return;
    if (terminalStatus === "complete") {
      trackRunTheTable({ type: "rtt_run_completed", record: receiptRecord, ran_the_table: ranTheTable });
    } else {
      trackRunTheTable({ type: "rtt_run_failed", record: receiptRecord, act: failedAct });
    }
  }, [terminalStatus, receiptRecord, ranTheTable, failedAct]);

  // --- focus management ----------------------------------------------------
  const screen = state ? screenForStatus(state.status) : null;
  const battle = state ? currentBattle(state) : null;
  /** A run that just FAILED shows the battle that ended it before the receipt. */
  const showEndingBattle = !!state && state.status === "failed" && !!battle && !resumed && endingSeen !== `${state.run_id}:${battle.act}`;

  const surfaceKey = state
    ? surfaceKeyFor(state, { roster: showRosterReveal, bossIntro: showBossIntro, boss: showBossReveal, endingBattle: showEndingBattle })
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
    const target = container.querySelector<HTMLElement>("h1, h2") ?? container;
    target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
    // A new decision starts at the top of the run — header, track and the
    // decision in view — never wherever the previous, taller surface left
    // the scroll position.
    // 64px keeps the sticky site nav off the run header.
    const top = container.getBoundingClientRect().top + window.scrollY - 64;
    if (window.scrollY > top + 8) {
      window.scrollTo({ top: Math.max(0, top), behavior: reducedMotion ? "auto" : "smooth" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceKey]);

  // --- action plumbing -----------------------------------------------------
  const run = useCallback(
    async (fn: () => Promise<RunPublicState>, announce?: string, kind = "action"): Promise<RunPublicState | null> => {
      setError(null);
      const result = await lane.run(kind, async () => {
        try {
          const next = await fn();
          commit(next);
          if (announce) setLiveMessage(announce);
          setRetry(null);
          return next;
        } catch (e) {
          setRetry({ fn, announce });
          if (e instanceof RunTheTableAPIError) {
            setError(e.status === 0 ? "Could not reach the PEAK3 API. Your run is safe — try again." : e.detail);
            if (shouldClearStoredRun(e.status)) {
              clearActiveRun();
              stateRef.current = null;
              setState(null);
              setResumeNotice("That run is no longer valid under the current ruleset. Start a new one below.");
            }
          } else {
            setError("Something went wrong. Try again.");
          }
          return null;
        }
      });
      return result ?? null;
    },
    [commit, lane],
  );

  function act(body: Parameters<typeof postRunAction>[1], label: string, announce?: string): Promise<RunPublicState | null> {
    if (!state) return Promise.resolve(null);
    const key = makeIdempotencyKey(state.run_id, label);
    return run(() => postRunAction(state.run_id, body, key), announce);
  }

  function announceStarted(next: RunPublicState | null): void {
    if (!next) return;
    trackRunTheTable({ type: "rtt_run_started", run_type: next.run_type, seed: next.seed });
  }

  const handleRestart = useCallback(async () => {
    if (!state) return;
    setError(null);
    const next = await lane.run("restart", () => restartRun(state.run_id, state.action_count));
    if (next) {
      commit(next);
      setLiveMessage("New run started. The previous run was abandoned.");
      announceStarted(next);
    }
  }, [state, commit, lane]);

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
        "start",
      );
      if (next) trackRunTheTable({ type: "rtt_run_started", run_type: next.run_type, seed: next.seed });
    },
    [run, initialSeed, initialDate, challengeToken],
  );

  useEffect(() => {
    if (booting) return;
    if (startConsumedRef.current) return;
    const requested = startParamRef.current;
    if (!requested) return;
    startConsumedRef.current = true;
    stripStartParamFromUrl();
    if (state) return;
    if (challengeToken) return;
    void handleStart(requested);
  }, [booting, state, handleStart, challengeToken]);

  async function handleRunItBack(): Promise<RunPublicState | null> {
    const runType = state?.run_type ?? "standard";
    trackRunTheTable({ type: "rtt_run_it_back", run_type: runType });
    clearActiveRun();
    const next = await run(() => createRun("standard"), "New run started.", "start");
    announceStarted(next);
    return next;
  }

  async function handleReplaySeed() {
    const seed = state?.seed;
    clearActiveRun();
    announceStarted(await run(() => createRun("standard", { seed }), "Replaying the same seed.", "start"));
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

  const onProject = useCallback((cost: number | null, slots: string[]) => {
    setProjectedCredits((current) => {
      const s = stateRef.current;
      if (!s || cost === null) return null;
      const next = s.credits - cost;
      return current === next ? current : next;
    });
    setTargetedSlots((current) => (current.join("|") === slots.join("|") ? current : slots));
  }, []);

  const momentDone = useCallback((id: string) => setMoment((m) => (m?.id === id ? null : m)), []);

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

  const node = state.active_node;
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
              : screen === "battle" || showEndingBattle
                ? `Boss battle — ${state.next_boss?.name ?? battle?.boss_id ?? ""}`
                : screen === "result"
                  ? "Run complete"
                  : "Run the Table";

  const reveal = (target: "roster" | "boss", count: number): Promise<RunPublicState | null> =>
    act(runActions.reveal(target, count), `reveal:${target}:${state.action_count}`, count > 1 ? "Roster revealed." : "Revealed.");

  const spendSink = (sink: CreditSink): Promise<RunPublicState | null> => {
    if (sink.id === "market_refresh") return act(runActions.marketRefresh(), `refresh:${nodeId}`, "Market refreshed.");
    if (sink.id === "emergency_recovery") return act(runActions.emergencyRecovery(), `recovery:${state.run_id}`, "Life recovered.");
    return Promise.resolve(null);
  };

  const stageProps = { act: state.act, stage: state.stage, stagesPerAct: state.stages_per_act };
  const bossEncounter = showBossIntro || showBossReveal || screen === "boss_preview" || screen === "battle" || showEndingBattle;

  let content: React.ReactNode = null;
  let layout: "live" | "focus" | "bare" = "live";

  if (showRosterReveal && rosterTrack) {
    layout = "focus";
    content = (
      <PeakV2RTTBossLineup
        kind="roster"
        title="Your opening seven"
        subtitle="Five starters and two bench players, dealt together."
        sourceNote={revealSourceFor("roster")}
        track={rosterTrack}
        sequence={rosterSequence}
        reducedMotion={reducedMotion}
        busy={busy}
        onStartReveal={(count) => void reveal("roster", count)}
        onContinue={() => setRosterRevealDismissed(true)}
        brief={{ lives: state.max_lives, credits: state.starting_credits, acts: state.acts_total }}
      />
    );
  } else if (showBossIntro && bossTrack && state.next_boss) {
    layout = "focus";
    content = (
      <PeakV2RTTBossIntro
        boss={state.next_boss}
        lanesToWin={state.next_boss.lanes_to_win ?? state.lanes_to_win}
        lives={state.lives}
        maxLives={state.max_lives}
        reducedMotion={reducedMotion}
        onComplete={() => setDismissedBossIntroId(bossTrack.boss_id)}
      />
    );
  } else if (showBossReveal && bossTrack) {
    layout = "focus";
    content = (
      <PeakV2RTTBossLineup
        kind="boss"
        title={bossTrack.name}
        subtitle={bossTrack.tagline}
        sourceNote={revealSourceFor("boss")}
        track={bossTrack}
        sequence={bossSequence}
        reducedMotion={reducedMotion}
        busy={busy}
        onStartReveal={(count) => void reveal("boss", count)}
        onContinue={() => setDismissedBossRevealId(bossTrack.boss_id)}
        pairedCardLookup={(slotId) => [...state.starters, ...state.bench].find((s) => s.slot_id === slotId)?.card ?? null}
      />
    );
  } else if (showEndingBattle && battle) {
    layout = "focus";
    content = (
      <PeakV2RTTBattleResult
        battle={battle}
        boss={state.next_boss}
        busy={busy}
        lives={state.lives}
        maxLives={state.max_lives}
        actsTotal={state.acts_total}
        lanesToWin={battle.lanes_to_win ?? state.lanes_to_win}
        advanceLabel="See how it ended"
        onAdvance={async () => {
          setEndingSeen(`${state.run_id}:${battle.act}`);
          return true;
        }}
      />
    );
  } else if (screen === "node_active" && node && node.node_type === "draft_room") {
    content = (
      <>
        <PeakV2RTTDraftRoom
          node={node}
          slots={[...state.starters, ...state.bench]}
          credits={state.credits}
          busy={busy}
          {...stageProps}
          scoutIntel={activeScoutIntel}
          onProject={onProject}
          onBuy={async (offer, slotId, useVetMin) => {
            trackRunTheTable({ type: "rtt_acquisition", cost: useVetMin ? 0 : offer.cost, veteran_minimum: useVetMin, act: state.act });
            setPendingSlot(slotId);
            try {
              return await act(runActions.draftBuy(offer.card_id, slotId, useVetMin), `buy:${offer.card_id}:${slotId}`, `${offer.player_name} signed.`);
            } finally {
              setPendingSlot(null);
            }
          }}
          onPass={() => {
            trackRunTheTable({ type: "rtt_offer_passed", node_type: "draft_room", act: state.act });
            return act(runActions.draftPass(), "draft_pass", "Passed on the draft room.");
          }}
        />
        <PeakV2RTTCreditSinks sinks={node.credit_sinks ?? []} busy={busy} onSpend={spendSink} />
      </>
    );
  } else if (screen === "node_active" && node && node.node_type === "trade_desk") {
    content = (
      <>
        <PeakV2RTTTradeDesk
          node={node}
          credits={state.credits}
          busy={busy}
          {...stageProps}
          scoutIntel={activeScoutIntel}
          onTrade={(outgoingSlotId, incomingCardId, netCost) => {
            trackRunTheTable({ type: "rtt_trade", net_cost: netCost, act: state.act });
            return act(runActions.trade(outgoingSlotId, incomingCardId), `trade:${outgoingSlotId}:${incomingCardId}`, "Trade completed.");
          }}
          onDecline={() => {
            trackRunTheTable({ type: "rtt_offer_passed", node_type: "trade_desk", act: state.act });
            return act(runActions.declineTrade(), "decline_trade", "Trade declined.");
          }}
        />
        <PeakV2RTTCreditSinks sinks={node.credit_sinks ?? []} busy={busy} onSpend={spendSink} />
      </>
    );
  } else if (screen === "node_active" && node && node.node_type === "film_room") {
    content = (
      <PeakV2RTTScoutPrepare
        node={node}
        credits={state.credits}
        busy={busy}
        {...stageProps}
        onScoutBoss={(laneField: LaneField) => act(runActions.filmRoom("scout_boss", { lane: laneField }), `scout:${node.node_id}:${laneField}`, "Boss scouted. One lane prepared.")}
        onShapeMarket={(role: Role) => act(runActions.filmRoom("shape_market", { role }), `focus:${node.node_id}:${role}`, "Role Focus armed for the next market.")}
        onReserveCard={(cardId: string) => act(runActions.filmRoom("reserve_card", { card_id: cardId }), `reserve:${node.node_id}:${cardId}`, "Card reserved at today's price.")}
      />
    );
  } else if (screen === "node_active" && node) {
    content = (
      <>
        <PeakV2RTTChoiceNode node={node} busy={busy} {...stageProps} onChoose={(choiceId) => act(runActions.restBank(choiceId), `${node.node_type}:${choiceId}`, "Choice taken.")} />
        <PeakV2RTTCreditSinks sinks={node.credit_sinks ?? []} busy={busy} onSpend={spendSink} />
      </>
    );
  } else if (screen === "system_select") {
    content = (
      <PeakV2RTTSystemSelect
        offer={state.pending_system_offer ?? []}
        active={state.systems}
        act={state.act}
        busy={busy}
        onSelect={(systemId) => {
          trackRunTheTable({ type: "rtt_system_selected", system_id: systemId });
          return act(runActions.selectSystem(systemId), `system:${systemId}`, "Front Office Perk selected.");
        }}
      />
    );
  } else if (screen === "node_select") {
    content = (
      <PeakV2RTTNodeChoice
        options={state.stage_options ?? []}
        {...stageProps}
        busy={busy}
        onChoose={(option) => {
          trackRunTheTable({ type: "rtt_node_chosen", node_type: option.node_type, act: state.act, stage: state.stage });
          return act(runActions.chooseNode(option.node_id), `node:${option.node_id}`, `${option.title} opened.`);
        }}
      />
    );
  } else if (screen === "boss_preview" && state.next_boss) {
    const boss = state.next_boss;
    layout = "focus";
    content = (
      <PeakV2RTTBossPreview
        boss={boss}
        playerLanes={state.lane_profile}
        playerTotal={state.roster_total}
        benchWeight={state.bench_weight}
        lives={state.lives}
        maxLives={state.max_lives}
        busy={busy}
        onResolve={() => {
          trackRunTheTable({ type: "rtt_boss_started", act: state.act, boss_id: boss.boss_id });
          return act(runActions.resolveBoss(), `resolve:${boss.boss_id}`, "Battle resolved.");
        }}
        lanesToWin={boss.lanes_to_win ?? state.lanes_to_win}
      />
    );
  } else if (screen === "battle" && battle) {
    layout = "focus";
    content = (
      <PeakV2RTTBattleResult
        battle={battle}
        boss={state.next_boss}
        busy={busy}
        lives={state.lives}
        maxLives={state.max_lives}
        actsTotal={state.acts_total}
        lanesToWin={battle.lanes_to_win ?? state.lanes_to_win}
        resumed={resumed}
        onAdvance={() => {
          trackRunTheTable({ type: "rtt_boss_completed", act: battle.act, boss_id: battle.boss_id, outcome: battle.outcome });
          return act(runActions.advance(), `advance:${battle.act}`, "Moving on.");
        }}
        advanceLabel={battle.act >= state.acts_total ? "See the receipt" : `On to Act ${actNumeral(battle.act + 1)}`}
      />
    );
  } else if (screen === "result" && state.receipt) {
    layout = "bare";
    content = (
      <PeakV2RTTResult
        receipt={state.receipt}
        versions={state.versions}
        actsTotal={state.acts_total}
        map={state.map}
        busy={busy}
        resumed={resumed}
        onRunItBack={handleRunItBack}
        onReplaySeed={handleReplaySeed}
        onChallenge={handleChallenge}
      />
    );
  } else {
    content = (
      <div role="alert" className="rtt-inconsistent" data-testid="rtt-inconsistent-state">
        <p>This run came back in a state the board cannot draw ({state.status}).</p>
        <button type="button" onClick={() => void run(() => getRun(state.run_id), undefined, "reload")} className="rtt-help">
          Reload the run
        </button>
      </div>
    );
  }

  return (
    <div ref={surfaceRef}>
      <div aria-live="polite" className="sr-only" data-testid="rtt-live">
        {liveMessage}
      </div>
      <GuidedTour
        steps={RUN_THE_TABLE_TOUR}
        tourId={RUN_THE_TABLE_TOUR_ID}
        version={RUN_THE_TABLE_TOUR_VERSION}
        eyebrow="How Run the Table works"
        open={tour.open}
        onOpenChange={(next) => {
          if (!next) tour.stop();
        }}
        autoStart={false}
        data-testid="guided-tour"
      />
      <PeakV2RTTShell
        state={state}
        objective={objective}
        layout={layout}
        content={content}
        scoutIntel={activeScoutIntel}
        projectedCredits={projectedCredits}
        targetedSlots={targetedSlots}
        pendingSlot={pendingSlot}
        moment={moment}
        onMomentDone={momentDone}
        actTransition={actTransition}
        boss={bossEncounter}
        onHelp={tour.start}
        restartControl={!isTerminal(state.status) ? <RestartRunControl canRestart={state.can_restart !== false} busy={busy} onConfirm={handleRestart} /> : null}
        errorBanner={
          error && (
            <div role="alert" data-testid="rtt-error" className="rtt-error">
              <span>{error}</span>
              {retry && (
                <button type="button" data-testid="rtt-error-retry" onClick={() => void run(retry.fn, retry.announce, "retry")} className="rtt-help">
                  Try again
                </button>
              )}
            </div>
          )
        }
      />
    </div>
  );
}

/**
 * The identity of the decision surface currently on screen: one value per
 * distinct thing the player can be looking at. Exported for tests.
 */
export function surfaceKeyFor(
  state: RunPublicState,
  activeReveal?: { roster: boolean; bossIntro: boolean; boss: boolean; endingBattle?: boolean },
): string {
  if (activeReveal ? activeReveal.roster : needsOpeningReveal(state)) return "reveal_roster:1";
  if (activeReveal?.bossIntro) return `boss_intro:${state.act}`;
  if (activeReveal ? activeReveal.boss : needsBossReveal(state)) return `reveal_boss:${state.act}`;
  if (activeReveal?.endingBattle) return `ending_battle:${state.act}`;
  return `${screenForStatus(state.status)}:${state.active_node?.node_id ?? state.act}`;
}

/** Exported for tests: how many offers a node is showing. */
export function offerCountFor(state: RunPublicState): number {
  const node = state.active_node;
  if (!node) return 0;
  if (node.node_type === "draft_room") return draftOffers(node).length;
  if (node.node_type === "trade_desk") return tradeIncoming(node).length;
  return node.choices?.length ?? 0;
}
