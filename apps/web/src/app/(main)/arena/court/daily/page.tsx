import { redirect } from "next/navigation";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Phase 9A: `/arena/court/daily` with no mode goes to the standard 82-0 daily
 * board (`apex_1y`) -- the same default the arena's own CourtBuilder CTA and
 * the navbar "Play" link use. Exists so
 * "today's challenge" is a single memorable URL people can bookmark, not one
 * that requires knowing the mode slug.
 *
 * The query string is forwarded (`?date=`, `?ui=`, …) -- a bare redirect
 * used to drop it, which silently reset `?ui=v2` back to whatever this
 * device had stored (the flip happens client-side, and a server redirect
 * never runs that client code) and would have replayed the WRONG day for a
 * `?date=` deep link.
 */
export default async function DailyIndexRedirect({ searchParams }: Props) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (Array.isArray(value)) {
      for (const v of value) qs.append(key, v);
    } else if (value !== undefined) {
      qs.append(key, value);
    }
  }
  const suffix = qs.toString();
  redirect(`/arena/court/daily/apex_1y${suffix ? `?${suffix}` : ""}`);
}
