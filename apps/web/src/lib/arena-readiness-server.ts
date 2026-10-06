import { ARENA_MODES, groupModeFamilies, variantLabelOf } from "@/lib/arena-modes";

/**
 * Arena readiness, read on the SERVER for the catalogue surfaces.
 *
 * WHY A SECOND READER. `arena-lobby-api.ts` attaches a Supabase bearer token
 * and is a client module; the homepage and `/arena` are server components with
 * no session and no need for one. `GET /arena/readiness` is deliberately the
 * one Arena route that takes no auth and always answers, precisely so a
 * signed-out catalogue can render honest cards instead of guessing.
 *
 * FAIL CLOSED, the same posture `getCourtBuilderReadiness` has and for the same
 * reason (ADR-005 Decision 7): a fetch failure is treated as "not enabled"
 * rather than shipping a link into a mode that may not work. What that costs is
 * a card that says "closed alpha" during an API blip; what the alternative
 * costs is a player clicking into a 403.
 *
 * `no-store`, because a flag flip must reach the next request rather than the
 * next deploy.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface ArenaCatalogueMode {
  id: string;
  name: string;
  /** One sentence on what the game is. */
  description: string;
  /** The catalogue's menu-sized one-liner, when it has one. */
  blurb?: string;
  /** "3 players · 10–15 min", built from the SERVER's seat count. */
  facts: string[];
  /** "Multiplayer" / "Auction". */
  kindBadge: string;
  /** Where the card points. Always the lobby: it is the surface that knows how
   *  to start a match, and it renders its own closed-alpha state. */
  href: string;
  /** A game played under several rulesets (Three-Man Weave: Classic,
   *  Franchise Draft, Decade Draft) lists the ones the server serves here, in
   *  catalogue order. Absent for a game with one ruleset. */
  variants?: ArenaCatalogueVariant[];
}

export interface ArenaCatalogueVariant {
  id: string;
  /** The ruleset's name inside its family ("Franchise Draft"). */
  label: string;
  /** One menu-sized line on how it differs. */
  summary: string;
  /** The lobby with this ruleset highlighted. */
  href: string;
}

export interface ArenaCatalogue {
  /** True only when the server says the Arena answers AND at least one
   *  catalogued mode is registered. */
  available: boolean;
  modes: ArenaCatalogueMode[];
}

const CLOSED: ArenaCatalogue = { available: false, modes: [] };

export async function getArenaCatalogue(): Promise<ArenaCatalogue> {
  try {
    const response = await fetch(`${API_BASE}/api/v1/arena/readiness`, {
      cache: "no-store",
    });
    if (!response.ok) return CLOSED;
    const body = (await response.json()) as {
      arena_enabled?: boolean;
      modes?: Array<{ id: string; seat_count: number }>;
    };
    if (!body.arena_enabled) return CLOSED;

    const live = body.modes ?? [];
    const served = ARENA_MODES.flatMap((meta) => {
      const entry = live.find((m) => m.id === meta.id);
      return entry ? [{ ...meta, seatCount: entry.seat_count }] : [];
    });
    // THE CATALOGUE LISTS GAMES, NOT RULESETS. Franchise Draft and Decade
    // Draft are Three-Man Weave played under one constraint, in the Weave's
    // room. Listing them as games made the homepage's two multiplayer cells
    // Weave, Franchise Draft -- and the $20 Showdown fell off the page. They
    // travel as the family's `variants` instead.
    const modes = groupModeFamilies(served).map((family): ArenaCatalogueMode => {
      const lead = family.variants[0];
      const grouped = family.variants.length > 1;
      const meta = family.parent ?? lead;
      return {
        id: lead.variantOf ? lead.id : family.id,
        name: family.name,
        description: grouped ? (meta.family?.description ?? meta.description) : lead.description,
        blurb: (grouped ? meta : lead).blurb,
        facts: [
          `${lead.seatCount} player${lead.seatCount === 1 ? "" : "s"}`,
          meta.duration,
          "Closed alpha",
        ],
        kindBadge: meta.kindBadge,
        href: grouped ? `/arena/lobby?family=${family.id}` : `/arena/lobby?game=${lead.id}`,
        variants: grouped
          ? family.variants.map((variant) => ({
              id: variant.id,
              label: variantLabelOf(variant),
              summary: variant.variantSummary ?? variant.tagline,
              href: `/arena/lobby?game=${variant.id}`,
            }))
          : undefined,
      };
    });
    return { available: modes.length > 0, modes };
  } catch {
    return CLOSED;
  }
}
