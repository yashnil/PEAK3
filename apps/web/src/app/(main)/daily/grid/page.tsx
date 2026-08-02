import type { Metadata } from "next";
import DailyGridGame from "@/components/daily-grid/DailyGridGame";

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
  title: "Daily Grid Challenge | PEAK3 Arena",
  description:
    "A new 3x3 grid every day. Fill each square with an exact NBA player-season that satisfies both its row and column constraint — nine squares, nine different players.",
};

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The board is fetched client-side rather than in this server component on
 * purpose: if the API is down the page still renders its own error state and a
 * retry, instead of failing the whole route render (the same lesson the Peak
 * Season practice route learned in Phase 9B).
 */
export default async function DailyGridPage({ searchParams }: Props) {
  const sp = await searchParams;
  const raw = sp.date;
  const date = typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;

  return (
    <main className="min-h-screen">
      <DailyGridGame date={date} />
    </main>
  );
}
