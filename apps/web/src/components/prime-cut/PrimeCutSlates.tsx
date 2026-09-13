"use client";

/**
 * The two ceremonies: the match intro and a heat's opening slate. Both render a
 * SERVER phase that ends on its own clock -- there is no skip and no Start
 * button, the Arena convention for a shared beat every seat watches together.
 */

import type { PrimeCutSeatPublic } from "@/types/prime-cut";

export function PrimeCutIntro({ seats, yourSeat }: { seats: PrimeCutSeatPublic[]; yourSeat: number | null }) {
  return (
    <div className="pcut-slate" data-testid="pcut-intro">
      <p className="parena-eyebrow">Prime Cut</p>
      <h2 className="pcut-slate-title">Keep four. Cut four.</h2>
      <p className="pcut-slate-body">
        Eight multi-year peaks arrive one at a time. Keep the four you think were greatest.
      </p>
      <ul className="pcut-slate-rules">
        <li>Decisions lock immediately.</li>
        <li>You won&apos;t see what&apos;s coming next.</li>
        <li>A full match tests 2-year, 3-year and 5-year peaks.</li>
      </ul>
      <p className="pcut-slate-table">
        At the table:{" "}
        {seats.map((seat, index) => (
          <span key={seat.seat_index}>
            {index > 0 ? ", " : ""}
            {seat.seat_index === yourSeat ? "you" : seat.display_name}
            {seat.is_bot ? ` (bot${seat.bot_tier ? `, ${seat.bot_tier}` : ""})` : ""}
          </span>
        ))}
      </p>
    </div>
  );
}

export function PrimeCutHeatOpen({ heatIndex, duration }: { heatIndex: number; duration: number }) {
  return (
    <div className="pcut-slate" data-testid="pcut-heat-open">
      <p className="parena-eyebrow">Heat {heatIndex + 1} of 3</p>
      <h2 className="pcut-slate-title pk-numeral">{duration}-year peaks</h2>
      <p className="pcut-slate-body">Eight cards. Keep four. The first card is being dealt.</p>
    </div>
  );
}
