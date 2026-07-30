import type { Metadata } from "next";
import DailyGridGame from "@/components/daily-grid/DailyGridGame";

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
