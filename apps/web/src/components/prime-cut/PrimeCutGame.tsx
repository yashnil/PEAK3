"use client";

/**
 * One PRIME CUT match — scouting board, cut day, broadcast decision room.
 *
 * SERVER-AUTHORITATIVE, ONE SNAPSHOT PER RENDER (`useArenaRoom`). The client
 * never learns a card's PEAK3 score before its heat resolves -- the view has no
 * field for one -- and never computes a capture, a placement or a winner.
 *
 * HIERARCHY
 *   top      heat, KEEP and CUT remaining, the card clock
 *   centre   one incoming multi-year peak
 *   support  four KEEP slots filling, a compact CUT ledger, the match strip
 *   bottom   CUT and KEEP, thumb-reachable on a phone
 *
 * Every visible beat is a real server phase: the intro, the heat slate, a
 * forced card, the heat reveal. Nothing here holds a control shut on a client
 * timer.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";

import { createPracticeMatch } from "@/lib/arena-api";
import { modeMeta } from "@/lib/arena-modes";
import { useArenaRoom } from "@/lib/prime-arena/useArenaRoom";
import { primeTelemetry } from "@/lib/prime-arena/telemetry";
import {
  PRIME_CUT_CARD_SECONDS,
  PRIME_CUT_COMMAND_CUT,
  PRIME_CUT_COMMAND_FORFEIT,
  PRIME_CUT_COMMAND_KEEP,
  PRIME_CUT_MODE,
  type PrimeCutCard as PrimeCutCardData,
  type PrimeCutMatchView,
} from "@/types/prime-cut";
import ArenaTimer from "@/components/shared/ArenaTimer";
import HowToPlay from "@/components/arena/HowToPlay";
import PeakV2Shell from "@/components/v2/PeakV2Shell";
import ArenaMatchStrip, { ordinal, type StripSeat } from "@/components/prime-arena/ArenaMatchStrip";
import {
  ConcedeControl,
  LiveRegion,
  RoomErrorBanner,
  RoomForming,
  RoomLoadFailure,
  RoomLoading,
  useLiveAnnouncer,
} from "@/components/prime-arena/RoomChrome";
import PrimeCutCard from "./PrimeCutCard";
import PrimeCutControls from "./PrimeCutControls";
import PrimeCutLedger from "./PrimeCutLedger";
import { PrimeCutHeatOpen, PrimeCutIntro } from "./PrimeCutSlates";
import PrimeCutHeatReveal from "./PrimeCutHeatReveal";
import PrimeCutResult from "./PrimeCutResult";

const LOBBY_HREF = "/arena/lobby?game=prime_cut";

export function primeCutCadence(view: PrimeCutMatchView): number | null {
  if (view.status === "completed" || view.public_state.phase === "complete") return null;
  if (view.public_state.phase === "card") return 700;
  const left = view.turn_seconds_remaining;
  const ms = left === null ? 800 : left * 1000 + 150;
  return Math.min(1500, Math.max(300, ms));
}

export function primeCutStillValid(view: PrimeCutMatchView, command: string, payload: Record<string, unknown>): boolean {
  const state = view.public_state;
  return (
    view.legal_commands.includes(command) &&
    state.phase === "card" &&
    state.heat_index === payload.heat_index &&
    state.card_index === payload.card_index
  );
}

export function describeCard(card: PrimeCutCardData, keepsLeft: number, cutsLeft: number): string {
  return `Card ${card.card_index + 1} of 8: ${card.player_name}, ${card.duration}-year peak, ${card.start_season} to ${card.end_season}. ${keepsLeft} keep${keepsLeft === 1 ? "" : "s"} and ${cutsLeft} cut${cutsLeft === 1 ? "" : "s"} left.`;
}

export default function PrimeCutGame({ matchId }: { matchId: string }) {
  return <PrimeCutRoom key={matchId} matchId={matchId} />;
}

function PrimeCutRoom({ matchId }: { matchId: string }) {
  const router = useRouter();
  const room = useArenaRoom<PrimeCutMatchView>({
    matchId,
    cadenceMs: primeCutCadence,
    stillValid: primeCutStillValid,
  });
  const [message, announce] = useLiveAnnouncer();
  const meta = modeMeta(PRIME_CUT_MODE);
  const view = room.view;
  const previous = useRef<PrimeCutMatchView | null>(null);
  const resumedComplete = useRef<boolean | null>(null);

  // -- announcements, derived from consecutive snapshots ------------------
  useEffect(() => {
    if (!view) return;
    const prev = previous.current;
    previous.current = view;
    if (resumedComplete.current === null) resumedComplete.current = view.status === "completed";
    const state = view.public_state;
    const mine = view.private_state;
    const prevState = prev?.public_state;
    const moved = !prevState || prevState.phase !== state.phase || prevState.card_index !== state.card_index || prevState.heat_index !== state.heat_index;
    if (!moved) return;
    if (state.phase === "card" || state.phase === "card_forced") {
      if (state.current_card) {
        const forced = mine.forced_decision ? ` Forced ${mine.forced_decision.toUpperCase()}.` : "";
        announce(describeCard(state.current_card, mine.keeps_left, mine.cuts_left) + forced);
      }
    } else if (state.phase === "heat_open") {
      const duration = state.durations[state.heat_index];
      announce(`Heat ${state.heat_index + 1} of 3: ${duration}-year peaks.`);
    } else if (state.phase === "heat_reveal") {
      const result = state.heat_results[state.heat_results.length - 1];
      const row = result?.seats.find((s) => s.seat_index === view.your_seat_index);
      const standing = state.standings.find((s) => s.seat_index === view.your_seat_index);
      if (row && standing) {
        announce(`Heat ${result.heat_index + 1} results. You scored ${row.capture.toFixed(1)} and kept ${row.optimal_kept} of the four highest-rated peaks. You are ${ordinal(standing.position)}.`);
      }
    } else if (state.phase === "complete") {
      const placement = state.placements?.find((p) => p.seat_index === view.your_seat_index);
      const standing = state.standings.find((s) => s.seat_index === view.your_seat_index);
      if (placement) {
        announce(`Match complete. You finished ${ordinal(placement.placement)} with ${standing?.match_score?.toFixed(1) ?? "no score"}.`);
      }
    }
    // A timed-out call on the previous card.
    if (prev && prevState?.phase === "card" && prevState.card_index !== null) {
      const record = view.private_state.decisions.find((d) => d.card_index === prevState.card_index && d.auto === "timeout");
      if (record) announce(`Time ran out on card ${record.card_index + 1}: it was ${record.decision === "cut" ? "cut" : "kept"} for you.`);
    }
  }, [view, announce]);

  // -- telemetry, from the same consecutive snapshots ----------------------
  const telemetryPrev = useRef<PrimeCutMatchView | null>(null);
  const openedAt = useRef<number | null>(null);
  useEffect(() => {
    if (!view) return;
    const prev = telemetryPrev.current;
    telemetryPrev.current = view;
    const state = view.public_state;
    if (!prev) {
      openedAt.current = Date.now();
      primeTelemetry.opened(PRIME_CUT_MODE);
      if (state.phase === "intro") primeTelemetry.matchStarted(PRIME_CUT_MODE, view.entry_path, state.ruleset_version);
      return;
    }
    const before = prev.public_state;
    if (before.phase === state.phase && before.card_index === state.card_index && before.heat_index === state.heat_index) return;
    const stage = state.heat_index + 1;
    if (state.phase === "heat_open") primeTelemetry.roundStarted(PRIME_CUT_MODE, stage, state.durations[state.heat_index]);
    if ((state.phase === "card" || state.phase === "card_forced") && state.card_index !== null) {
      primeTelemetry.promptShown(PRIME_CUT_MODE, stage, state.card_index);
      const call = view.private_state.current_decision;
      if (call?.auto === "forced") {
        primeTelemetry.decision(PRIME_CUT_MODE, { stage, cardIndex: state.card_index, decision: call.decision, forced: true });
      }
    }
    if (before.phase === "card" && before.card_index !== null) {
      const previousCard = before.card_index;
      const ownResult = state.heat_results.find((r) => r.heat_index === before.heat_index)?.seats.find((s) => s.seat_index === view.your_seat_index);
      const timedOut = [...view.private_state.decisions, ...(ownResult?.decisions ?? [])].find(
        (d) => d.card_index === previousCard && d.auto === "timeout",
      );
      if (timedOut) primeTelemetry.timeout(PRIME_CUT_MODE, before.heat_index + 1, timedOut.decision, previousCard);
    }
    if (state.heat_results.length > before.heat_results.length) {
      const result = state.heat_results[state.heat_results.length - 1];
      const row = result.seats.find((s) => s.seat_index === view.your_seat_index);
      primeTelemetry.roundCompleted(PRIME_CUT_MODE, result.heat_index + 1, result.duration, row?.capture);
    }
    if (state.phase === "complete" && before.phase !== "complete") {
      const placement = state.placements?.find((p) => p.seat_index === view.your_seat_index);
      const standing = state.standings.find((s) => s.seat_index === view.your_seat_index);
      primeTelemetry.matchCompleted(PRIME_CUT_MODE, {
        outcome: placement?.outcome,
        placement: placement?.placement,
        score: standing?.match_score,
        durationSeconds: openedAt.current ? Math.round((Date.now() - openedAt.current) / 1000) : undefined,
        bots: view.seats.filter((s) => s.is_bot).length,
      });
    }
  }, [view]);

  const decide = useCallback(
    (decision: "keep" | "cut") => {
      const current = room.view;
      if (!current) return;
      const state = current.public_state;
      if (state.phase !== "card" || state.card_index === null) return;
      const command = decision === "keep" ? PRIME_CUT_COMMAND_KEEP : PRIME_CUT_COMMAND_CUT;
      if (!current.legal_commands.includes(command)) return;
      void room.send(command, { heat_index: state.heat_index, card_index: state.card_index }).then((ok) => {
        if (!ok) return;
        announce(`${decision === "keep" ? "Kept" : "Cut"}: ${state.current_card?.player_name ?? "card"}.`);
        primeTelemetry.decision(PRIME_CUT_MODE, { stage: state.heat_index + 1, cardIndex: state.card_index ?? undefined, decision });
      });
    },
    [room, announce],
  );

  // Keyboard: K keeps, C cuts, while a card is live and focus is not in a field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const key = event.key.toLowerCase();
      if (key === "k") decide("keep");
      else if (key === "c") decide("cut");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide]);

  const playAgain = useCallback(async () => {
    const current = room.view;
    if (!current) return;
    primeTelemetry.rematch(PRIME_CUT_MODE);
    const soloTable = current.seats.every((seat) => seat.is_bot || seat.seat_index === current.your_seat_index);
    if (soloTable) {
      const created = await createPracticeMatch(PRIME_CUT_MODE);
      router.replace(`/arena/prime-cut/${created.match_id}`);
      return;
    }
    router.push(LOBBY_HREF);
  }, [room.view, router]);

  const stripSeats: StripSeat[] = useMemo(() => {
    if (!view) return [];
    const state = view.public_state;
    return state.seats.map((seat) => {
      const standing = state.standings.find((s) => s.seat_index === seat.seat_index);
      return {
        seatIndex: seat.seat_index,
        name: seat.display_name,
        isBot: seat.is_bot,
        botTier: seat.bot_tier,
        position: standing?.position ?? 1,
        scoreText: standing?.match_score != null ? standing.match_score.toFixed(1) : "—",
        locked: seat.locked,
        forfeited: seat.forfeited,
      };
    });
  }, [view]);

  if (room.loadError && !view) {
    return <RoomLoadFailure error={room.loadError} gameName="Prime Cut" lobbyHref={LOBBY_HREF} testId="pcut-load-error" />;
  }
  if (!view) return <RoomLoading label="Dealing the board…" testId="pcut-loading" />;
  if (view.status === "forming") {
    return (
      <RoomForming
        gameName="Prime Cut"
        seatsTaken={view.seats.length}
        seatCount={view.seat_count}
        roomCode={view.room_code}
        testId="pcut-forming"
      />
    );
  }

  const state = view.public_state;
  const mine = view.private_state;
  const phase = state.phase;
  const duration = state.durations[Math.min(state.heat_index, state.durations.length - 1)];

  if (phase === "complete" || view.status === "completed") {
    return (
      <PrimeCutResult
        view={view}
        resumed={resumedComplete.current === true}
        onPlayAgain={playAgain}
        message={message}
      />
    );
  }

  const heatCards = state.dealt_cards;
  const liveCard = state.current_card;
  const yourCall = mine.current_decision;
  const waitingOn = state.seats.filter((s) => !s.locked && !s.forfeited).length;
  const clockLabel =
    phase === "card" ? (yourCall ? "Locked · waiting" : "Your call") : phase === "heat_reveal" ? "Next heat" : phase === "intro" ? "Starts in" : "Dealing";
  // ALWAYS a caption, so the clock keeps one footprint and the header never jumps.
  const clockCaption =
    phase === "card"
      ? yourCall
        ? "Next card when the table is in"
        : mine.cuts_left > 0
          ? "Runs out: cut"
          : "Runs out: keep"
      : phase === "heat_reveal"
        ? "Scores for this heat"
        : phase === "card_forced"
          ? "Every call was forced"
          : phase === "intro"
            ? "Heat 1 deals first"
            : "First card coming";

  return (
    <PeakV2Shell width="live-wide">
      <div className="pcut-room" data-arena="live" data-phase={phase} data-testid="pcut-room">
        <header className="pcut-head">
          <div className="pcut-head-title">
            <p className="parena-eyebrow">
              Prime Cut · {view.rated ? "Rated" : view.entry_path === "private_room" ? "Private room" : "Practice"}
            </p>
            <h1 className="pcut-heading">
              {`Heat ${state.heat_index + 1} of 3 · ${duration}-year peaks`}
            </h1>
          </div>
          <dl className="pcut-quota" aria-label="Your calls left this heat" data-testid="pcut-quota">
            <div className="pcut-quota-item" data-kind="keep">
              <dt>Keep</dt>
              <dd className="pk-numeral" data-testid="pcut-keeps-left">{mine.keeps_left}</dd>
              <dd className="pcut-quota-unit">left</dd>
            </div>
            <div className="pcut-quota-item" data-kind="cut">
              <dt>Cut</dt>
              <dd className="pk-numeral" data-testid="pcut-cuts-left">{mine.cuts_left}</dd>
              <dd className="pcut-quota-unit">left</dd>
            </div>
          </dl>
          <div className="pcut-clock">
            <ArenaTimer
              deadlineAt={room.deadlineAt}
              totalSeconds={view.turn_total_seconds ?? PRIME_CUT_CARD_SECONDS}
              label={clockLabel}
              yours={phase === "card" && !yourCall}
              consequence={clockCaption}
              testId="pcut-clock"
            />
          </div>
        </header>

        <section className="pcut-stage" aria-label="The table" data-testid="pcut-stage">
          {room.commandError ? (
            <RoomErrorBanner message={room.commandError.message} onDismiss={room.dismissError} testId="pcut-error" />
          ) : null}
          {phase === "intro" ? <PrimeCutIntro seats={state.seats} yourSeat={view.your_seat_index} /> : null}
          {phase === "heat_open" ? <PrimeCutHeatOpen heatIndex={state.heat_index} duration={duration} /> : null}
          {(phase === "card" || phase === "card_forced") && liveCard ? (
            <PrimeCutCard
              card={liveCard}
              decision={yourCall}
              forcedDecision={mine.forced_decision}
              everyoneForced={phase === "card_forced"}
            />
          ) : null}
          {phase === "heat_reveal" ? <PrimeCutHeatReveal view={view} /> : null}
        </section>

        {phase === "card" && liveCard ? (
          <PrimeCutControls
            keepsLeft={mine.keeps_left}
            cutsLeft={mine.cuts_left}
            legal={view.legal_commands}
            decision={yourCall}
            pending={room.pending}
            waitingOn={waitingOn}
            onKeep={() => decide("keep")}
            onCut={() => decide("cut")}
          />
        ) : null}

        <PrimeCutLedger
          view={view}
          heatCards={heatCards}
        />

        <div className="pcut-strip">
          <ArenaMatchStrip
            seats={stripSeats}
            yourSeat={view.your_seat_index}
            showLocks={phase === "card"}
            title="Standings"
            progress={
              phase === "card" || phase === "card_forced"
                ? `Card ${(state.card_index ?? 0) + 1} / ${state.cards_per_heat}`
                : `${state.heat_results.length} of 3 heats scored`
            }
            scoreLabel="Match score"
            ranked={state.heat_results.length > 0}
            testId="pcut-strip"
          />
        </div>

        <footer className="pcut-foot">
          {meta ? <HowToPlay title={meta.name} rules={meta.rules} testId="pcut-rules" /> : null}
          {view.legal_commands.includes(PRIME_CUT_COMMAND_FORFEIT) ? (
            <ConcedeControl
              busy={room.pending === PRIME_CUT_COMMAND_FORFEIT}
              onConfirm={() => {
                primeTelemetry.abandoned(PRIME_CUT_MODE, state.heat_index + 1);
                return room.send(PRIME_CUT_COMMAND_FORFEIT, {});
              }}
              testId="pcut-concede"
            />
          ) : null}
        </footer>
        <LiveRegion message={message} testId="pcut-live" />
      </div>
    </PeakV2Shell>
  );
}
