"use client";

/**
 * One SHARED DRAFT match — two seats, one board.
 *
 * SERVER-AUTHORITATIVE, ONE SNAPSHOT PER RENDER (`useArenaRoom`). The client
 * never learns a card's PEAK3 score before the draft is complete -- the view
 * has no field for one -- and never decides legality, order or a winner: it
 * renders `legal_cards`, `order` and `placements` as the server sent them.
 *
 * HIERARCHY
 *   top      pick N of 10, whose pick it is, the pick clock
 *   rail     the snake order, live pick highlighted
 *   centre   the shared pool in five position columns
 *   support  your five and their five
 *   bottom   the selected card and DRAFT, thumb-reachable on a phone
 *
 * SELECT, THEN DRAFT. A tap selects (a card is an irreversible pick that also
 * takes something from the opponent, so a mis-tap must not commit it); the
 * Draft button, or Enter, commits. The selection is dropped the moment the card
 * stops being legal (taken, or the turn moved on).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createPracticeMatch } from "@/lib/arena-api";
import { modeMeta } from "@/lib/arena-modes";
import { useArenaRoom, useReportIntroSeen } from "@/lib/prime-arena/useArenaRoom";
import {
  SHARED_DRAFT_COMMAND_FORFEIT,
  SHARED_DRAFT_COMMAND_INTRO_SEEN,
  SHARED_DRAFT_COMMAND_PICK,
  SHARED_DRAFT_MODE,
  SHARED_DRAFT_PICK_SECONDS,
  type SharedDraftMatchView,
} from "@/types/shared-draft";
import ArenaTimer from "@/components/shared/ArenaTimer";
import HowToPlay from "@/components/arena/HowToPlay";
import PeakV2Shell from "@/components/v2/PeakV2Shell";
import { GameActionButton } from "@/components/game-feel";
import {
  ConcedeControl,
  LiveRegion,
  RoomErrorBanner,
  RoomForming,
  RoomLoadFailure,
  RoomLoading,
  useLiveAnnouncer,
} from "@/components/prime-arena/RoomChrome";
import { SharedDraftOrder, SharedDraftPool, SharedDraftRoster } from "./SharedDraftBoard";
import SharedDraftResult from "./SharedDraftResult";

export const SHARED_DRAFT_LOBBY_HREF = "/arena/lobby?game=shared_draft";

export function sharedDraftCadence(view: SharedDraftMatchView): number | null {
  if (view.status === "completed" || view.public_state.phase === "complete") return null;
  const bot = view.bot_reply_in_seconds;
  if (bot !== null && bot !== undefined) return Math.min(1500, Math.max(250, bot * 1000 + 120));
  if (view.public_state.phase === "pick") {
    // Your own pick: nothing changes until you act (or the clock runs out).
    return view.public_state.current_seat === view.your_seat_index ? 1500 : 700;
  }
  const left = view.turn_seconds_remaining;
  const ms = left === null ? 800 : left * 1000 + 150;
  return Math.min(1500, Math.max(300, ms));
}

export function sharedDraftStillValid(
  view: SharedDraftMatchView,
  command: string,
  payload: Record<string, unknown>,
): boolean {
  const state = view.public_state;
  if (command === SHARED_DRAFT_COMMAND_INTRO_SEEN) return view.legal_commands.includes(command) && state.phase === "arrival";
  if (command === SHARED_DRAFT_COMMAND_PICK) {
    return (
      view.legal_commands.includes(command) &&
      state.phase === "pick" &&
      payload.pick_number === state.pick_index + 1 &&
      view.private_state.legal_cards.includes(payload.card_index as number)
    );
  }
  return view.legal_commands.includes(command);
}

export default function SharedDraftGame({ matchId }: { matchId: string }) {
  return <SharedDraftRoom key={matchId} matchId={matchId} />;
}

function SharedDraftRoom({ matchId }: { matchId: string }) {
  const router = useRouter();
  const room = useArenaRoom<SharedDraftMatchView>({
    matchId,
    cadenceMs: sharedDraftCadence,
    stillValid: sharedDraftStillValid,
  });
  const [message, announce] = useLiveAnnouncer();
  const meta = modeMeta(SHARED_DRAFT_MODE);
  const view = room.view;
  const [selected, setSelected] = useState<number | null>(null);
  const previous = useRef<SharedDraftMatchView | null>(null);
  const resumedComplete = useRef<boolean | null>(null);
  useReportIntroSeen(room, SHARED_DRAFT_COMMAND_INTRO_SEEN, view?.status === "active" && view.public_state.phase === "arrival");

  const you = view?.your_seat_index ?? null;
  const opponent = view?.public_state.seats.find((s) => s.seat_index !== you) ?? null;
  const opponentName = opponent?.display_name ?? "Opponent";

  // A selection survives only while it is still a legal pick for you.
  const legal = useMemo(() => view?.private_state.legal_cards ?? [], [view]);
  useEffect(() => {
    if (selected !== null && !legal.includes(selected)) setSelected(null);
  }, [legal, selected]);

  // -- announcements, derived from consecutive snapshots ------------------
  useEffect(() => {
    if (!view) return;
    const prev = previous.current;
    previous.current = view;
    if (resumedComplete.current === null) resumedComplete.current = view.status === "completed";
    const state = view.public_state;
    const before = prev?.public_state;
    if (before && before.picks.length < state.picks.length) {
      for (const pick of state.picks.slice(before.picks.length)) {
        const card = state.cards[pick.card_index];
        const who = pick.seat_index === view.your_seat_index ? "You" : (state.seats.find((s) => s.seat_index === pick.seat_index)?.display_name ?? "Opponent");
        announce(
          `Pick ${pick.pick_number}: ${who} ${pick.auto ? "ran out of time and were given" : "drafted"} ${card.player_name}, ${card.position}.`,
        );
      }
    }
    if (state.phase === "pick" && (before?.phase !== "pick" || before.pick_index !== state.pick_index)) {
      if (state.current_seat === view.your_seat_index) announce(`Your pick. ${view.private_state.legal_cards.length} players available to you.`);
    }
    if (state.phase === "complete" && before && before.phase !== "complete") {
      const mine = state.seats.find((s) => s.seat_index === view.your_seat_index);
      const placement = state.placements?.find((p) => p.seat_index === view.your_seat_index);
      announce(`Draft complete. ${placement?.outcome === "win" ? "You won" : placement?.outcome === "draw" ? "It is a draw" : "You lost"} with ${mine?.roster_total?.toFixed(2) ?? "no"} total.`);
    }
  }, [view, announce]);

  const draft = useCallback(async (): Promise<boolean> => {
    const current = room.view;
    if (!current || selected === null) return false;
    const state = current.public_state;
    if (!current.private_state.legal_cards.includes(selected)) return false;
    return room.send(SHARED_DRAFT_COMMAND_PICK, { card_index: selected, pick_number: state.pick_index + 1 });
  }, [room, selected]);

  // Keyboard: Enter drafts the selected card while it is your pick.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(target.tagName))) return;
      void draft();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft]);

  const playAgain = useCallback(async () => {
    const current = room.view;
    if (!current) return;
    const soloTable = current.seats.every((seat) => seat.is_bot || seat.seat_index === current.your_seat_index);
    if (soloTable) {
      const created = await createPracticeMatch(SHARED_DRAFT_MODE);
      router.replace(`/arena/shared-draft/${created.match_id}`);
      return;
    }
    router.push(SHARED_DRAFT_LOBBY_HREF);
  }, [room.view, router]);

  if (room.loadError && !view) {
    return <RoomLoadFailure error={room.loadError} gameName="Shared Draft" lobbyHref={SHARED_DRAFT_LOBBY_HREF} testId="sdraft-load-error" />;
  }
  if (!view) return <RoomLoading label="Dealing the board…" testId="sdraft-loading" />;
  if (view.status === "forming") {
    return (
      <RoomForming
        gameName="Shared Draft"
        seatsTaken={view.seats.length}
        seatCount={view.seat_count}
        roomCode={view.room_code}
        testId="sdraft-forming"
      />
    );
  }

  const state = view.public_state;
  const mine = view.private_state;
  const phase = state.phase;

  if (phase === "complete" || view.status === "completed") {
    return (
      <SharedDraftResult
        view={view}
        resumed={resumedComplete.current === true}
        onPlayAgain={playAgain}
        message={message}
        lobbyHref={SHARED_DRAFT_LOBBY_HREF}
      />
    );
  }

  const yourSeat = state.seats.find((s) => s.seat_index === you) ?? state.seats[0];
  const theirSeat = state.seats.find((s) => s.seat_index !== yourSeat.seat_index) ?? state.seats[1];
  const yourPick = phase === "pick" && state.current_seat === you;
  const waitingFor = state.seats.filter((s) => !s.arrived && s.seat_index !== you).length;
  const selectedCard = selected !== null ? state.cards[selected] : null;
  const heading =
    phase === "pick"
      ? yourPick
        ? `Pick ${state.pick_index + 1} of ${state.pick_count} · your pick`
        : `Pick ${state.pick_index + 1} of ${state.pick_count} · ${opponentName}`
      : "The board is dealt";
  const clockLabel = phase === "pick" ? (yourPick ? "Your pick" : `${opponentName} picking`) : phase === "intro" ? "Draft opens in" : "Starting";
  const clockCaption =
    phase === "pick"
      ? yourPick
        ? "Runs out: first open card is taken for you"
        : "Their clock"
      : waitingFor > 0
        ? `Waiting for ${waitingFor} player${waitingFor === 1 ? "" : "s"}`
        : `${state.order[0] === you ? "You pick" : `${opponentName} picks`} first`;

  return (
    <PeakV2Shell width="live-wide">
      <div className="sdraft-room" data-arena="live" data-phase={phase} data-your-pick={yourPick ? "true" : undefined} data-testid="sdraft-room">
        <header className="sdraft-head">
          <div className="sdraft-head-title">
            <p className="parena-eyebrow">
              Shared Draft · {view.rated ? "Rated" : view.entry_path === "private_room" ? "Private room" : "Practice"}
            </p>
            <h1 className="sdraft-heading" data-testid="sdraft-heading">{heading}</h1>
          </div>
          <div className="sdraft-clock">
            <ArenaTimer
              deadlineAt={phase === "arrival" ? null : room.deadlineAt}
              totalSeconds={view.turn_total_seconds ?? SHARED_DRAFT_PICK_SECONDS}
              label={clockLabel}
              yours={yourPick}
              consequence={clockCaption}
              testId="sdraft-clock"
            />
          </div>
        </header>

        <SharedDraftOrder
          order={state.order}
          pickIndex={state.pick_index}
          you={you}
          opponentName={opponentName}
          live={phase === "pick"}
        />

        {room.commandError ? (
          <RoomErrorBanner message={room.commandError.message} onDismiss={room.dismissError} testId="sdraft-error" />
        ) : null}

        {phase === "arrival" || phase === "intro" ? (
          <div className="sdraft-intro" data-testid="sdraft-intro">
            <p className="parena-eyebrow">Shared Draft</p>
            <h2 className="sdraft-intro-title">One board. Two drafts.</h2>
            <p className="sdraft-intro-body">
              Twelve players from {state.latest_season}, two at every position. Take one of each — and whoever you take, {opponentName} can&apos;t.
            </p>
            <ul className="sdraft-intro-rules">
              <li>Snake order: one pick, then two each way.</li>
              <li>Scores stay hidden until the tenth pick.</li>
              <li>The higher roster PEAK3 total wins.</li>
            </ul>
            {phase === "arrival" && waitingFor > 0 ? (
              <p className="sdraft-intro-body" data-testid="sdraft-arrival">
                Waiting for {waitingFor} more player{waitingFor === 1 ? "" : "s"} to arrive.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="sdraft-main">
          <SharedDraftPool
            cards={state.cards}
            slots={state.slots}
            you={you}
            openPositions={mine.open_positions}
            legal={yourPick ? legal : []}
            selected={selected}
            onSelect={setSelected}
            opponentName={opponentName}
          />
          <div className="sdraft-rosters">
            <SharedDraftRoster
              seat={yourSeat}
              cards={state.cards}
              slots={state.slots}
              label="You"
              isYou
              onClock={yourPick}
              testId="sdraft-roster-you"
            />
            <SharedDraftRoster
              seat={theirSeat}
              cards={state.cards}
              slots={state.slots}
              label={opponentName}
              isYou={false}
              onClock={phase === "pick" && !yourPick}
              testId="sdraft-roster-opponent"
            />
          </div>
        </div>

        {phase === "pick" ? (
          <div className="sdraft-controls" data-testid="sdraft-controls">
            {yourPick ? (
              <>
                <p className="sdraft-controls-label" aria-live="polite">
                  {selectedCard ? (
                    <>
                      <span className="sdraft-controls-pos">{selectedCard.position}</span> {selectedCard.player_name}
                    </>
                  ) : (
                    "Choose a player from the pool"
                  )}
                </p>
                <GameActionButton
                  onAction={draft}
                  disabled={selected === null || room.pending === SHARED_DRAFT_COMMAND_PICK}
                  pendingLabel="Drafting…"
                  data-testid="sdraft-draft"
                >
                  Draft
                </GameActionButton>
              </>
            ) : (
              <p className="sdraft-controls-label" data-testid="sdraft-waiting">
                {opponentName} is on the clock
              </p>
            )}
          </div>
        ) : null}

        <footer className="sdraft-foot">
          {meta ? <HowToPlay title={meta.name} rules={meta.rules} testId="sdraft-rules" /> : null}
          {view.legal_commands.includes(SHARED_DRAFT_COMMAND_FORFEIT) ? (
            <ConcedeControl
              busy={room.pending === SHARED_DRAFT_COMMAND_FORFEIT}
              onConfirm={() => room.send(SHARED_DRAFT_COMMAND_FORFEIT, {})}
              testId="sdraft-concede"
            />
          ) : null}
        </footer>
        <LiveRegion message={message} testId="sdraft-live" />
      </div>
    </PeakV2Shell>
  );
}
