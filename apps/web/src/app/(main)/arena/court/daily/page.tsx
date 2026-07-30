import { redirect } from "next/navigation";

/**
 * Phase 9A: `/arena/court/daily` with no mode goes to the flagship 1Y Apex
 * daily -- the same default the arena's own CourtBuilder CTA uses. Exists so
 * "today's challenge" is a single memorable URL people can bookmark, not one
 * that requires knowing the mode slug.
 */
export default function DailyIndexRedirect() {
  redirect("/arena/court/daily/apex_1y");
}
