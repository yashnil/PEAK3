"use client";

/**
 * The peak ridge — shown only AFTER a round resolves.
 *
 * One point per legal window at the window's centre, on the same season axis
 * the rail used, at its canonical PEAK3 score. PEAK3's highest-rated window is
 * a filled band; your window a bar under the axis; every other seat a tick.
 *
 * STRETCH-SAFE BY CONSTRUCTION. The SVG fills the width at a fixed height
 * (`preserveAspectRatio="none"`), so nothing inside it may have a shape that
 * distorts: marks are line segments and rectangles with non-scaling strokes,
 * and every piece of TEXT lives in HTML under the drawing, where it stays a
 * readable size on a 390 px phone.
 *
 * Plain SVG: no chart library for one ridge. Reduced motion skips the line's
 * draw-in (CSS) and shows the same drawing.
 */

import { useId } from "react";

import type { FindThePrimeRoundReveal } from "@/types/find-the-prime";

const WIDTH = 1000;
const HEIGHT = 240;
const PAD_TOP = 18;
const PAD_BOTTOM = 34;

export default function PrimeRidge({
  reveal,
  yourSeat,
  seatNames,
}: {
  reveal: FindThePrimeRoundReveal;
  yourSeat: number | null;
  seatNames: Map<number, string>;
}) {
  const titleId = useId();
  const seasons = reveal.seasons;
  const first = seasons[0].season_end;
  const last = seasons[seasons.length - 1].season_end;
  const span = Math.max(1, last - first + 1);
  const cell = WIDTH / span;
  const x = (seasonEnd: number) => (seasonEnd - first + 0.5) * cell;
  const scores = reveal.windows.map((w) => w.prime_score);
  const low = Math.floor(Math.min(...scores) - 2);
  const high = Math.ceil(Math.max(...scores) + 2);
  const plotBottom = HEIGHT - PAD_BOTTOM;
  const y = (score: number) => PAD_TOP + (1 - (score - low) / Math.max(1, high - low)) * (plotBottom - PAD_TOP);
  const centre = (start: number) => start + (reveal.duration - 1) / 2;
  const bandX = (start: number) => (start - first) * cell;
  const bandW = cell * reveal.duration;

  const best = reveal.windows.find((w) => w.window_id === reveal.best_window_id);
  const mine = reveal.seats.find((s) => s.seat_index === yourSeat);
  const others = reveal.seats.filter((s) => s.seat_index !== yourSeat && s.start_season_end !== null);
  const points = reveal.windows.map((w) => `${x(centre(w.start_season_end)).toFixed(1)},${y(w.prime_score).toFixed(1)}`).join(" ");
  const topWindows = [...reveal.windows].sort((a, b) => b.prime_score - a.prime_score).slice(0, 3);

  return (
    <figure className="fprime-ridge" data-testid="fprime-ridge" aria-labelledby={titleId}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
        {best ? (
          <rect className="fprime-ridge-best" x={bandX(best.start_season_end)} y={4} width={bandW} height={plotBottom - 4} />
        ) : null}
        <polyline className="fprime-ridge-line" points={points} fill="none" />
        {reveal.windows.map((w) => {
          const cx = x(centre(w.start_season_end));
          const cy = y(w.prime_score);
          return (
            <line
              key={w.window_id}
              className="fprime-ridge-mark"
              data-best={w.window_id === reveal.best_window_id ? "true" : "false"}
              x1={cx}
              x2={cx}
              y1={cy - 6}
              y2={cy + 6}
            />
          );
        })}
        {mine && mine.start_season_end !== null ? (
          <rect
            className="fprime-ridge-yours"
            data-testid="fprime-ridge-yours"
            x={bandX(mine.start_season_end) + 3}
            y={plotBottom + 6}
            width={Math.max(4, bandW - 6)}
            height={10}
          />
        ) : null}
        {others.map((answer) => {
          const cx = x(centre(answer.start_season_end as number));
          return <line key={answer.seat_index} className="fprime-ridge-seat" x1={cx} x2={cx} y1={plotBottom + 20} y2={HEIGHT - 2} />;
        })}
      </svg>
      <div className="fprime-ridge-axis" aria-hidden="true">
        <span className="pk-numeral">{seasons[0].season}</span>
        <span className="pk-numeral">{seasons[seasons.length - 1].season}</span>
      </div>
      <figcaption id={titleId}>
        <span className="sr-only">
          {`${reveal.player_name}'s ${reveal.duration}-year windows as PEAK3 rates them. Highest rated: ${topWindows
            .map((w) => `${w.start_season} to ${w.end_season}, ${w.prime_score.toFixed(2)}`)
            .join("; ")}.`}
        </span>
        <span className="fprime-ridge-legend">
          <span data-kind="best">PEAK3&apos;s highest-rated window</span>
          <span data-kind="yours">Your window</span>
          <span data-kind="seat">Other players</span>
        </span>
      </figcaption>
      {others.length > 0 ? (
        <ul className="fprime-ridge-seats" aria-label="Other players' windows">
          {others.map((answer) => {
            const window = reveal.windows.find((w) => w.window_id === answer.window_id);
            return (
              <li key={answer.seat_index}>
                {seatNames.get(answer.seat_index) ?? `Seat ${answer.seat_index + 1}`}:{" "}
                <span className="pk-numeral">{window ? `${window.start_season.slice(0, 4)}–${window.end_season.slice(-2)}` : "—"}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </figure>
  );
}
