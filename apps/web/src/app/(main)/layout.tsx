import { Footer } from "@/components/layout/Footer";
import { Nav } from "@/components/layout/nav";
import HandleOnboardingPrompt from "@/components/profile/HandleOnboardingPrompt";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
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
    </>
  );
}
