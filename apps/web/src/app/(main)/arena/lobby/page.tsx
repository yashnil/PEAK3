import { Suspense } from "react";
import type { Metadata } from "next";

import ArenaLobby from "@/components/arena/ArenaLobby";

export const metadata: Metadata = {
  title: "Multiplayer · PEAK3 Arena",
  description:
    "Three-Man Weave and The $20 Showdown. Play a public match, play with friends on a shared code, or start immediately against bots.",
};

/**
 * The multiplayer entry surface.
 *
 * ONE LOBBY FOR EVERY MODE. The mode list comes from the server's registry
 * (`GET /arena/readiness`), so a mode that is not registered is not offered and
 * this page needs no edit when one is added.
 *
 * WRAPPED IN `<Suspense>` because `ArenaLobby` reads `useSearchParams()` — the
 * `?game=` deep link from the homepage and the Play menu highlights the card
 * you came for. Without the boundary Next refuses to prerender the route at
 * all, which is a BUILD failure rather than a runtime one: the page compiles,
 * static export throws, and the whole build exits. The fallback is the shell
 * the lobby itself renders while readiness is loading, so the two states look
 * the same rather than flashing between two different empties.
 */
export default function ArenaLobbyPage() {
  return (
    <Suspense
      fallback={
        <div className="ar-lobby">
          <header className="ar-lobby-head">
            <p className="ar-eyebrow">PEAK3 Arena</p>
            <h1 className="ar-lobby-title">Multiplayer</h1>
          </header>
          <p className="ar-notice">Loading the Arena…</p>
        </div>
      }
    >
      <ArenaLobby />
    </Suspense>
  );
}
