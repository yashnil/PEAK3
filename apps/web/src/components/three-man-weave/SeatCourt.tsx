"use client";
import type { ArenaSeatPublic, TmwPick, TmwRoster, TmwSlotType } from "@/types/three-man-weave";
import { TMW_SLOT_LABELS, TMW_STARTER_SLOTS } from "@/types/three-man-weave";
import { benchSlots, filledCount, hasTradedEvidence } from "@/lib/three-man-weave-state";

/**
 * One participant's roster court. Rendered for ALL THREE seats, always.
 *
 * Every roster is public the whole way through — a draft is open information,
 * and reading what your opponents still need is the entire strategy. A surface
 * that showed only your own board would hide the game rather than the hidden
 * information (which is future rolls, and lives nowhere in this file).
 *
 * REUSES CourtBuilder's court, not a new one. The `.court-panel-wrapper` /
 * `.roster-board*` classes in `globals.css` are the shipped visual system:
 * PG at the point, SG and SF on the wings, PF and C inside, with the paint,
 * arc and rim drawn behind. Its own docstring makes the case — a flat row of
 * five equal cards reads as a form, a court reads as a lineup.
 *
 * The CSS is reused rather than the `CourtLayout` component itself, and that
 * is deliberate: `CourtLayout` is typed against `CourtSlotPublic` from
 * `@/types/perfect-season`. Importing it would either mean casting a
 * Three-Man Weave pick into another game's shape (a lie about the domain) or
 * editing a component the 82-0 surface depends on. Sharing the stylesheet
 * gets the identical geometry with neither risk — and the wrapper already
 * carries a `container-name: court-panel` query that collapses to a single
 * column under 380px, which is exactly what three side-by-side courts need.
 *
 * Cells are compact by necessity: three courts abreast leaves each one narrow.
 * The full labelled ELIGIBLE THROUGH / SCORING CARD block therefore lives
 * where it carries the most weight — `PickPanel` at the moment of choosing and
 * `PodiumReceipt` at the moment of explaining — while each cell here still
 * names the scoring SEASON, which is the part that would otherwise look wrong.
 */
export default function SeatCourt({
  roster,
  seat,
  isYou,
  isOnTurn,
  justPickedSlug,
}: {
  roster: TmwRoster;
  seat: ArenaSeatPublic | undefined;
  isYou: boolean;
  isOnTurn: boolean;
  justPickedSlug?: string | null;
}) {
  const name = seat?.display_name ?? `Seat ${roster.seat_index + 1}`;
  const filled = filledCount(roster);

  return (
    <section
      data-testid={`tmw-seat-court-${roster.seat_index}`}
      data-on-turn={isOnTurn ? "true" : "false"}
      aria-labelledby={`tmw-seat-heading-${roster.seat_index}`}
      className="flex min-w-0 flex-col gap-2"
    >
      <header className="flex items-baseline justify-between gap-2 px-0.5">
        <h3
          id={`tmw-seat-heading-${roster.seat_index}`}
          className="min-w-0 truncate text-sm font-bold"
          style={{ color: isOnTurn ? "var(--peak-accent-text)" : "var(--text-primary)" }}
        >
          {name}
          {isYou && (
            <span
              className="ml-1.5 text-[9px] font-bold uppercase tracking-widest"
              style={{ color: "var(--peak-accent-text)" }}
            >
              you
            </span>
          )}
          {seat?.is_bot && (
            <span
              className="ml-1.5 text-[9px] font-bold uppercase tracking-widest"
              style={{ color: "var(--text-muted)" }}
            >
              bot
            </span>
          )}
        </h3>
        <span
          data-testid={`tmw-seat-progress-${roster.seat_index}`}
          className="shrink-0 text-[10px] tabular-nums"
          style={{ color: "var(--text-muted)" }}
        >
          {filled}/6
        </span>
      </header>

      <div
        className="court-panel-wrapper"
        style={{
          // The turn spotlight is a ring on the court itself, layered over the
          // wrapper's own border so a seat that is both yours and on-turn
          // still reads as on-turn first.
          boxShadow: isOnTurn ? "inset 0 0 0 2px var(--peak-accent)" : undefined,
        }}
      >
        <div className="roster-board">
          <div className="roster-board-sideline" aria-hidden="true" />
          <div className="roster-board-court-markings" aria-hidden="true">
            <div className="roster-board-ft-circle" />
            <div className="roster-board-paint" />
            <div className="roster-board-arc" />
            <div className="roster-board-rim" />
          </div>
          <div className="roster-board-starters">
            {TMW_STARTER_SLOTS.map((slotType) => (
              <div key={slotType} className={`roster-board-slot-${slotType}`}>
                <SlotCard
                  slotType={slotType}
                  pick={roster.slots[slotType] ?? null}
                  highlight={roster.slots[slotType]?.player_slug === justPickedSlug}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="roster-board-bench-row">
          <div className="roster-board-bench-label">Bench</div>
          <div className="roster-board-bench">
            {benchSlots(roster).map(({ slotType, pick }) => (
              <SlotCard
                key={slotType}
                slotType={slotType}
                pick={pick}
                highlight={pick?.player_slug === justPickedSlug}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function SlotCard({
  slotType,
  pick,
  highlight,
}: {
  slotType: TmwSlotType;
  pick: TmwPick | null;
  highlight: boolean;
}) {
  const label = slotType === "bench_1" ? "BN" : slotType;
  return (
    <div
      data-testid={`tmw-slot-${slotType}`}
      data-filled={pick ? "true" : "false"}
      data-just-picked={highlight ? "true" : "false"}
      className="flex min-w-0 flex-col gap-0.5 rounded-md px-2 py-1.5"
      style={{
        // Opaque, so the decorative court markings show only through the gaps
        // between cards — the same layering the stylesheet's own comment
        // describes.
        background: highlight ? "var(--peak-accent-bg)" : "var(--bg-elevated)",
        border: `1px solid ${highlight ? "var(--peak-accent)" : "var(--border-subtle)"}`,
        // The pick "animation" is a one-shot highlight rather than a movement.
        // A colour change is not motion, so it survives `prefers-reduced-motion`
        // untouched, and it cannot leave a card stranded mid-flight if a poll
        // lands while it is showing.
      }}
    >
      <span
        className="text-[9px] font-bold uppercase tracking-wider"
        style={{ color: "var(--text-muted)" }}
      >
        <span aria-hidden="true">{label}</span>
        <span className="sr-only">{TMW_SLOT_LABELS[slotType]}</span>
      </span>
      {pick ? (
        <>
          <span
            className="truncate text-[11px] font-semibold leading-tight"
            style={{ color: "var(--text-primary)" }}
          >
            {pick.player_name}
          </span>
          <span
            data-testid={`tmw-slot-season-${slotType}`}
            className="flex items-baseline justify-between gap-1 text-[9px] tabular-nums"
            style={{ color: "var(--text-muted)" }}
          >
            {/* The scoring SEASON, on the card. Without it a 2000s-roll Shaq
                showing 2000-01 rather than his better 1999-00 looks wrong. */}
            <span className="truncate">
              {pick.scoring_card?.season ?? "—"}
              {hasTradedEvidence(pick) && <span className="ml-1">·via trade</span>}
            </span>
            <span className="shrink-0 font-bold" style={{ color: "var(--peak-accent-text)" }}>
              {pick.scoring_card ? pick.scoring_card.prime_score.toFixed(1) : "—"}
            </span>
          </span>
        </>
      ) : (
        <span className="text-[10px] italic" style={{ color: "var(--text-muted)" }}>
          Open
        </span>
      )}
    </div>
  );
}
