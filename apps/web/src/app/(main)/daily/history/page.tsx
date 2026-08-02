import type { Metadata } from "next";
import DailyGridHistory from "@/components/daily-grid/DailyGridHistory";

/**
 * Declared, not inherited.
 *
 * These routes render a board that changes at midnight America/Los_Angeles.
 * They already end up dynamic today because they await `searchParams`, but
 * that is an accident of their current shape, not a statement of intent — drop
 * the searchParams read and Next would happily prerender a daily surface at
 * build time and serve it until the next deploy. Saying so explicitly is
 * cheaper than rediscovering it after a stale board ships.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Daily Grid History | PEAK3 Arena",
  description:
    "Your completed Daily Grid boards, streak and best results — stored in this browser.",
};

/**
 * Local Daily Grid history.
 *
 * Deliberately NOT the account-backed /history route (which reads the 82-0
 * result snapshots from the API). Everything on this page comes from this
 * browser's localStorage, so it renders client-side and needs no session: an
 * anonymous player is the primary audience, not a fallback.
 */
export default function DailyGridHistoryPage() {
  return (
    <main className="min-h-screen">
      <DailyGridHistory />
    </main>
  );
}
