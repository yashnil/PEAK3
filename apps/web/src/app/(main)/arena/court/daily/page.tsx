import { redirect } from "next/navigation";

/**
 * Phase 9A: `/arena/court/daily` with no mode goes to the standard 82-0 daily
 * board (`apex_1y`) -- the same default the arena's own CourtBuilder CTA and
 * the navbar "Play" link use. Exists so
 * "today's challenge" is a single memorable URL people can bookmark, not one
 * that requires knowing the mode slug.
 */
export default function DailyIndexRedirect() {
  redirect("/arena/court/daily/apex_1y");
}
