/**
 * What the Arena can actually do right now, as one derived value.
 *
 * THE DEFECT THIS EXISTS TO REMOVE. `ArenaLobby` asked one question —
 * `readiness.arena_enabled` — and answered everything else with per-control
 * `disabled` flags. So a closed alpha, where bot practice is the whole point,
 * rendered two of the three controls on every card greyed out under a heading
 * about "live games against other people". And with the Arena flags simply
 * absent from an environment, the page said
 *
 *     "Multiplayer is not open yet.
 *      Three-Man Weave and The $20 Showdown are in closed alpha."
 *
 * — a blanket wall that is TRUE about human matchmaking and FALSE about the two
 * modes a reviewer was there to play. One boolean cannot carry that
 * distinction, so this file makes the distinction the type.
 *
 * The three postures, and what decides each:
 *
 *   unavailable   the Arena is off, or is serving no mode this build knows.
 *                 A real wall, and it stays a real wall.
 *   practice_only bots can seat, the public queue cannot. Both games are
 *                 PLAYABLE; live human matchmaking is not. This is closed
 *                 alpha, and it is the posture the review found misreported.
 *   open          the public queue is accepting joins.
 *
 * NOTHING HERE DECIDES A CAPABILITY. Every input is the server's own
 * `GET /arena/readiness`; this only says which sentence is true about them, so
 * the lobby and the API cannot disagree about what is playable.
 */

import type { ArenaReadiness } from "@/lib/arena-lobby-api";
import { offerableModes, type OfferableMode } from "@/lib/arena-modes";

export type ArenaPosture = "unavailable" | "practice_only" | "open";

export interface ArenaCapability {
  posture: ArenaPosture;
  /** The modes both the server serves and this build can route to. */
  modes: OfferableMode[];
  /** Bot practice can be started right now. */
  practiceAvailable: boolean;
  /** The public matchmaking queue accepts joins. */
  publicQueueAvailable: boolean;
  /** A private room can be opened or joined by code. */
  privateRoomAvailable: boolean;
  /**
   * Why nothing is playable, when nothing is. `null` in every posture other
   * than `unavailable` — a reason string that is present when there is no
   * problem is how "unavailable" copy leaks onto a working page.
   */
  unavailableReason: "arena_disabled" | "no_modes" | "no_entry_paths" | null;
}

export function arenaCapability(readiness: ArenaReadiness): ArenaCapability {
  const modes = offerableModes(readiness.modes);

  // A private room needs a second person to arrive by code, which is a human
  // path — but it is not the PUBLIC queue, and the server gates the two
  // separately (`create_private` checks only that the Arena is enabled). So it
  // follows the Arena, not the queue.
  const privateRoomAvailable = readiness.arena_enabled;
  const practiceAvailable = readiness.arena_enabled && readiness.bots_enabled;
  const publicQueueAvailable = readiness.arena_enabled && readiness.public_queue_enabled;

  if (!readiness.arena_enabled) {
    return {
      posture: "unavailable",
      modes: [],
      practiceAvailable: false,
      publicQueueAvailable: false,
      privateRoomAvailable: false,
      unavailableReason: "arena_disabled",
    };
  }
  if (modes.length === 0) {
    return {
      posture: "unavailable",
      modes,
      practiceAvailable,
      publicQueueAvailable,
      privateRoomAvailable,
      unavailableReason: "no_modes",
    };
  }
  // Enabled, serving modes, and no way in. Rare, and deliberately its own
  // reason: "the Arena is off" and "the Arena is on but every door is shut"
  // are different operational states and a reader who is told the first when
  // the second is true will go looking in the wrong place.
  if (!practiceAvailable && !publicQueueAvailable && !privateRoomAvailable) {
    return {
      posture: "unavailable",
      modes,
      practiceAvailable,
      publicQueueAvailable,
      privateRoomAvailable,
      unavailableReason: "no_entry_paths",
    };
  }

  return {
    posture: publicQueueAvailable ? "open" : "practice_only",
    modes,
    practiceAvailable,
    publicQueueAvailable,
    privateRoomAvailable,
    unavailableReason: null,
  };
}

/** The heading and the sentence under it, per posture. Kept beside the
 *  derivation so a new posture cannot be added without copy for it. */
export function arenaHeadline(capability: ArenaCapability): {
  title: string;
  intro: string;
} {
  switch (capability.posture) {
    case "open":
      return {
        title: "Multiplayer",
        intro:
          "Live games against other people, decided by the same open five-component formula as the rest of PEAK3 — with a full receipt at the end.",
      };
    case "practice_only":
      return {
        title: "Multiplayer",
        intro:
          "Live matchmaking against other people is not open yet. Both Arena games are playable right now against PEAK3 Bot, decided by the same open five-component formula as the rest of PEAK3 — with a full receipt at the end.",
      };
    default:
      return {
        title: "Multiplayer",
        intro:
          "The Arena's live games are not being served right now. Everything else in PEAK3 is playable.",
      };
  }
}

/** What a closed alpha is holding back, said once and in one place rather than
 *  as a disabled control on every card. */
export const ARENA_COMING_LATER: readonly { title: string; detail: string }[] = [
  {
    title: "Public matchmaking",
    detail: "Queue up and be paired with another player.",
  },
  {
    title: "Ratings",
    detail: "A rating that moves with every public result.",
  },
  {
    title: "Arena leaderboard",
    detail: "Where every rated player stands.",
  },
] as const;
