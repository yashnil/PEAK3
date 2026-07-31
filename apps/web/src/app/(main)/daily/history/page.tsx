import type { Metadata } from "next";
import DailyGridHistory from "@/components/daily-grid/DailyGridHistory";

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
