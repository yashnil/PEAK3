"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
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
  getRun,
  getRunReadiness,
  postRunAction,
  runActions,
} from "@/lib/run-the-table-api";
import {
  clearActiveRun,
  currentBattle,
  draftOffers,
  isTerminal,
  loadActiveRun,
  makeIdempotencyKey,
  saveActiveRun,
  screenForStatus,
  shouldClearStoredRun,
  tradeIncoming,
  trackRunTheTable,
} from "@/lib/run-the-table-state";
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

export default function RunTheTableGame({
  initialSeed,
  initialDate,
  challengeToken,
  preferredMode,
}: Props) {
  const [state, setState] = useState<RunPublicState | null>(null);
  const [readiness, setReadiness] = useState<RunReadiness | null>(null);
  const [daily, setDaily] = useState<DailyDescriptor | null>(null);
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
    const [readinessResult, dailyResult, challengeResult] = await Promise.allSettled([
      getRunReadiness(),
      getDailyRun(),
      // Resolved eagerly so the gate can SHOW the seed the visitor was
      // challenged to before they commit, and so an expired link says so up
      // front instead of failing on the button press.
      challengeToken ? getChallenge(challengeToken) : Promise.resolve(null),
    ]);
    if (readinessResult.status === "fulfilled") setReadiness(readinessResult.value);
    if (dailyResult.status === "fulfilled") setDaily(dailyResult.value);
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

    const stored = loadActiveRun();
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
   * decision, six decisions and three battles per run.
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
  const surfaceKey = state ? surfaceKeyFor(state) : null;
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

  async function handleStart(runType: RunType) {
    setResumeNotice(null);
    announceStarted(
      await run(
        () =>
          createRun(runType, {
            seed: runType === "standard" ? initialSeed : undefined,
            date: runType === "daily" ? initialDate : undefined,
            challengeToken: runType === "challenge" ? challengeToken : undefined,
          }),
        "Run started.",
      ),
    );
  }

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

  let surface: React.ReactNode = null;
  let mobilePrimaryLabel: string | null = null;
  let mobilePrimary: (() => void) | null = null;

  if (screen === "system_select") {
    surface = (
      <SystemSelect
        offer={state.pending_system_offer ?? []}
        active={state.systems}
        act={state.act}
        busy={busy}
        onSelect={(systemId) => {
          trackRunTheTable({ type: "rtt_system_selected", system_id: systemId });
          act(runActions.selectSystem(systemId), `system:${systemId}`, "System selected.");
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
    if (node.node_type === "draft_room") {
      surface = (
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
        />
      );
    } else if (node.node_type === "trade_desk") {
      surface = (
        <TradeDesk
          node={node}
          credits={state.credits}
          busy={busy}
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
      );
    } else {
      const isFilm = node.node_type === "film_room";
      surface = (
        <ChoiceNode
          node={node}
          busy={busy}
          onChoose={(choiceId) =>
            act(
              isFilm ? runActions.filmRoom(choiceId) : runActions.restBank(choiceId),
              `${node.node_type}:${choiceId}`,
              "Choice taken.",
            )
          }
        />
      );
    }
  } else if (screen === "boss_preview" && state.next_boss) {
    const boss = state.next_boss;
    const resolve = () => {
      trackRunTheTable({ type: "rtt_boss_started", act: state.act, boss_id: boss.boss_id });
      act(runActions.resolveBoss(), `resolve:${boss.boss_id}`, "Battle resolved.");
    };
    mobilePrimaryLabel = "Play";
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
      />
    );
  } else if (screen === "result" && state.receipt) {
    surface = (
      <RunResult
        receipt={state.receipt}
        versions={state.versions}
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

  return (
    <div className="rtt-shell" data-testid="rtt-shell">
      {/* Zone 1 — the ladder. Desktop only; a phone gets the progress strip
          inside the decision column instead (DOM order: strip, surface,
          roster). */}
      <div className="rtt-zone-left">
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
            unchanged. */}
        <div ref={surfaceRef} className="min-w-0">
          {surface}
        </div>

        {/* Mobile-only roster, below the decision — never above it. */}
        <div className="rtt-mobile-only">
          <RunTray state={state} />
        </div>
      </div>

      {/* Zone 3 — the persistent tray */}
      <div className="rtt-zone-right">
        <RunTray state={state} />
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

/** The identity of the decision surface currently on screen: one value per
 *  distinct thing the player can be looking at. Exported for tests. */
export function surfaceKeyFor(state: RunPublicState): string {
  return `${screenForStatus(state.status)}:${state.active_node?.node_id ?? state.act}`;
}

/** Exported for tests: how many offers a node is showing, used to fire the
 *  "offer viewed" event exactly once per node rather than per render. */
export function offerCountFor(state: RunPublicState): number {
  const node = state.active_node;
  if (!node) return 0;
  if (node.node_type === "draft_room") return draftOffers(node).length;
  if (node.node_type === "trade_desk") return tradeIncoming(node).length;
  return node.choices?.length ?? 0;
}
