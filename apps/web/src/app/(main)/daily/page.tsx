import type { Metadata } from "next";
import { redirect } from "next/navigation";
import DailyHub from "@/components/daily/DailyHub";

export const metadata: Metadata = {
  title: "Daily Games | PEAK3 Arena",
  description:
    "Two PEAK3 games, new every day: the Daily Grid Challenge and Peak Duel Daily. Same board for everyone, worldwide.",
};

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The Daily hub.
 *
 * Phase 12A moved the Daily Grid to `/daily/grid` and made this route the hub
 * for every daily game, because there is more than one: the Grid and Peak Duel
 * Daily previously lived on opposite sides of the app (`/daily` and
 * `/play/daily`) with nothing linking them, so a player who found one had no
 * way to discover the other.
 *
 * OLD LINKS STILL WORK. `/daily?date=YYYY-MM-DD` was how an archive board was
 * reached, and those URLs are in players' history and in their own share text.
 * A dated request is redirected to the grid rather than being met with a hub
 * that ignores the date they asked for.
 */
export default async function DailyHubPage({ searchParams }: Props) {
  const sp = await searchParams;
  const raw = sp.date;
  const date = typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
  if (date) redirect(`/daily/grid?date=${date}`);

  return (
    <main className="min-h-screen">
      <DailyHub />
    </main>
  );
}
