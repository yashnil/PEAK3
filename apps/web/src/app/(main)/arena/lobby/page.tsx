import { Suspense } from "react";
import type { Metadata } from "next";

import ArenaLobby from "@/components/arena/ArenaLobby";
import PeakV2Shell from "@/components/v2/PeakV2Shell";

export const metadata: Metadata = {
  title: "Multiplayer · PEAK3 Arena",
  description:
    "Live PEAK3 games — drafts, auctions and peak calls. Play a public match, play with friends on a shared code, or start immediately against bots.",
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
        <PeakV2Shell width="live">
          <div className="pb-14 pt-9">
            <header className="flex flex-col gap-1.5 pb-1">
              <p
                className="text-xs font-bold uppercase tracking-[0.14em]"
                style={{ color: "var(--v2-color-accent)" }}
              >
                PEAK3 Arena
              </p>
              <h1
                className="text-4xl font-bold sm:text-[2.75rem]"
                style={{ fontFamily: "var(--v2-font-display)", color: "var(--v2-text-primary)" }}
              >
                Multiplayer
              </h1>
            </header>
            <p className="mt-4 text-sm" style={{ color: "var(--v2-text-secondary)" }}>
              Loading the Arena…
            </p>
          </div>
        </PeakV2Shell>
      }
    >
      <ArenaLobby />
    </Suspense>
  );
}
