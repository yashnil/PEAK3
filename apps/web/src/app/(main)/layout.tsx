import { Footer } from "@/components/layout/Footer";
import { Nav } from "@/components/layout/nav";
import HandleOnboardingPrompt from "@/components/profile/HandleOnboardingPrompt";
import PeakV2ArenaBackdrop from "@/components/v2/PeakV2ArenaBackdrop";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    /* THE ROOM IS MOUNTED ONCE, HERE, AND NOWHERE ELSE.
     *
     * `PeakV2ArenaBackdrop` is `position: fixed`, so a second instance would
     * mean a second floodlight over the same viewport — the exact violation
     * of the one-light rule (`DESIGN_SYSTEM.md` §Motion) that this pass
     * exists to fix. Mounting at the layout also means the light and the
     * court belong to the BUILDING rather than to whichever container
     * happened to render them, which is what stops it acquiring the hard
     * rectangular edge the per-component `.pk-atmosphere` instances had.
     *
     * A route says what kind of surface it is with `data-arena="live"` or
     * `data-arena="quiet"` on its own root element; `styles/v2/arena-room.css`
     * reads that upward through `:has()`. No prop threading, no client
     * component, no route table — and an unclassified route gets the ambient
     * default, which is the right fallback.
     *
     * It is a Server Component with no props and no state, so it costs
     * nothing in the client bundle.
     */
    <div className="pk-arena-room">
      <PeakV2ArenaBackdrop />
      <Nav />
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
      <Footer />
      {/* Mounted at the layout so a signed-in account without a public handle
          is prompted wherever it lands, not only on pages that happen to submit
          somewhere public. It never blocks gameplay — it can be dismissed and
          private play continues — but a public leaderboard submission is
          refused server-side until a handle exists, so the prompt has to be
          reachable everywhere rather than deferred to the moment of refusal. */}
      <HandleOnboardingPrompt />
    </div>
  );
}
