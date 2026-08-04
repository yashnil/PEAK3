import Link from "next/link";
import { ArrowRight, Gavel, Users } from "lucide-react";

import GameCard from "@/components/shared/GameCard";
import type { ArenaCatalogue } from "@/lib/arena-readiness-server";

/**
 * The "Multiplayer" band, shared by the homepage and the Arena catalog.
 *
 * ONE COMPONENT FOR TWO SURFACES. The homepage and `/arena` each grew their own
 * hand-written card grid for every other tier, and they drifted — that is what
 * `lib/modes.ts` exists to stop. These two games arrived after that lesson, so
 * they get one component from the start.
 *
 * READINESS-AWARE, AND HONEST EITHER WAY. `catalogue.available` comes from the
 * server's own `/arena/readiness`, fail-closed. When the Arena is dark the band
 * renders a plain closed-alpha note instead of a link — a card that 403s is
 * worse than a card that says "not yet". When it is live, every card points at
 * the lobby, which is the surface that knows how to start a match and which
 * enforces the allowlist itself.
 *
 * NO FEATURE-FLAG VOCABULARY. A player is told "closed alpha", never
 * "ARENA_ENABLED is false".
 */
export default function MultiplayerSection({
  catalogue,
  testIdPrefix,
}: {
  catalogue: ArenaCatalogue;
  testIdPrefix: string;
}) {
  if (!catalogue.available) {
    return (
      <div
        className="home-band flex flex-col gap-2 p-5"
        data-testid={`${testIdPrefix}-multiplayer-unavailable`}
      >
        <h3
          className="font-display text-lg font-bold"
          style={{ color: "var(--text-primary)" }}
        >
          Multiplayer is in closed alpha
        </h3>
        <p className="max-w-2xl text-sm" style={{ color: "var(--text-secondary)" }}>
          Three-Man Weave and The $20 Showdown are being tested with a small
          group. Everything else in the Arena is playable now.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid={`${testIdPrefix}-multiplayer-grid`}>
      {catalogue.modes.map((mode) => (
        <GameCard
          key={mode.id}
          testId={`${testIdPrefix}-${mode.id}-card`}
          href={mode.href}
          eyebrow={mode.kindBadge}
          title={mode.name}
          description={mode.description}
          icon={mode.id === "twenty_dollar" ? <Gavel size={17} /> : <Users size={17} />}
          meta={mode.facts}
          cta="Find a game"
          tone="raised"
          compact
        />
      ))}
    </div>
  );
}

/** The inline link every surface uses to reach the lobby directly. */
export function MultiplayerLobbyLink({ testId }: { testId: string }) {
  return (
    <Link
      href="/arena/lobby"
      data-testid={testId}
      className="arena-inline-link"
      style={{ color: "var(--peak-accent-text)" }}
    >
      Multiplayer lobby
      <ArrowRight size={13} aria-hidden="true" />
    </Link>
  );
}
