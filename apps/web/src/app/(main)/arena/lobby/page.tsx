import type { Metadata } from "next";

import ArenaLobby from "@/components/arena/ArenaLobby";

export const metadata: Metadata = {
  title: "Arena · PEAK3",
  description:
    "Choose a game and an opponent. Public matches are rated; private games and bot practice are not.",
};

/**
 * The shared Arena entry surface.
 *
 * One lobby for every mode. The mode list comes from the server's registry
 * (`GET /arena/readiness`), so a mode that is not registered is not offered and
 * this page needs no edit when one is added.
 */
export default function ArenaLobbyPage() {
  return <ArenaLobby />;
}
