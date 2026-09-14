import { redirect } from "next/navigation";

import { ARENA_MODES } from "@/lib/arena-modes";

/** `/arena/leaderboard` opens the first catalogued multiplayer mode's board;
 *  the mode switcher on that page lists every mode the server registers. */
export default function ArenaLeaderboardIndexPage() {
  redirect(`/arena/leaderboard/${ARENA_MODES[0].id}`);
}
