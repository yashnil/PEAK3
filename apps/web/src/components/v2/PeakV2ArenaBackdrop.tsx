/**
 * PeakV2ArenaBackdrop — the room every Arena screen is played in.
 *
 * WHY THIS EXISTS. Before this component, PEAK3's only environmental motif
 * was `.pk-atmosphere` / `.court-grid-bg`: two low-opacity corner glows over
 * a UNIFORM 48px square grid. Two problems, both confirmed by screenshotting
 * every mode at 1440x900:
 *
 *   1. A uniform square grid is graph paper, not a basketball court. It has
 *      no sideline, no half-court line, no centre circle, no arc, no key —
 *      nothing that identifies the sport the entire product is about. It
 *      reads as a spreadsheet backdrop, which is exactly the "generic dark
 *      SaaS" failure `VISUAL_RUBRIC.md` rejects on sight.
 *   2. It was applied PER COMPONENT (six separate call sites: the lobby, the
 *      TMW room, the Showdown stage, both Peak Duel routes, the Daily Grid
 *      board). So each screen was a lit rectangle sitting in an unlit void,
 *      and the two floodlights terminated at whatever container happened to
 *      own them rather than at the horizon. Cropping the RTT opening reveal
 *      shows the resulting hard horizontal edge where the light's box starts.
 *
 * WHAT THIS DRAWS. A real NBA court seen overhead — the shot a broadcast
 * opens on — in the viewport's own coordinate space rather than any
 * component's:
 *
 *   - the boundary, the division line and the centre circle
 *   - both keys, both free-throw circles, both restricted-area arcs
 *   - both three-point lines: straight corner runs and the arc between them
 *
 * Proportions are the real ones (94x50ft court, 16ft key, 23'9" arc from a
 * basket 5'3" off the baseline, 22ft corner threes), so it reads correctly to
 * anyone who knows the sport and reads as "structure" to anyone who does not.
 *
 * AND ONE LIGHT. A single broad floodlight from above the court, plus a
 * vignette, replacing the two clipped corner glows. `position: fixed` is the
 * point: the light belongs to the ROOM, so it can never acquire a container
 * edge, and the court does not slide around under scrolling content.
 *
 * COST. Zero JS at runtime after mount, zero network requests (the geometry
 * is inline SVG, not an asset), one composited layer, and nothing animates —
 * so there is no repaint on scroll and no `requestAnimationFrame` loop. This
 * is the reason the dependency audit rejected React Three Fiber: the thing
 * this product actually needed from "an atmospheric arena background" is a
 * lit court plane seen flat-on, and that is a stroked path.
 *
 * CONTRAST. Every stroke is driven by `--court-line` (already
 * theme-defined: rgba(245,200,66,0.06) dark / rgba(180,138,20,0.08) light) via
 * `--pk-backdrop-line`, so this cannot change the contrast ratio of any text
 * rendered above it in either theme. `aria-hidden`, `pointer-events: none`.
 *
 * THIS IS NOT A SECOND LIGHT SOURCE. `DESIGN_SYSTEM.md` allows one ambient
 * light per surface. This replaces the per-screen `.pk-atmosphere` copies
 * rather than stacking on them; a surface that mounts a `PeakV2ArenaLight`
 * for a genuine focus (the lot up for bid, the active court) still has
 * exactly one light of its own, now sitting inside a room instead of inside
 * a void.
 */

export interface PeakV2ArenaBackdropProps {
  /**
   * How present the room is.
   *
   * `"ambient"` (default) — a hub, a start gate, a result. The court is
   * readable if you look for it and invisible if you do not.
   *
   * `"live"` — an active game surface. Same geometry, marginally stronger
   * lines and a tighter floodlight, so the screen feels attended to. Still
   * under the 12% alpha ceiling the atmosphere tokens have always held.
   *
   * `"quiet"` — a reading surface (methodology, about, a data table). Light
   * and vignette only, no court geometry, so nothing competes with a dense
   * table. Used instead of dropping the backdrop entirely, so navigating
   * from a game to Rankings does not feel like leaving the building.
   */
  intensity?: "ambient" | "live" | "quiet";
  /**
   * Where the floodlight hangs, as a percentage across the viewport.
   * Defaults to centre. A surface whose focus is genuinely off-centre (the
   * Showdown stage, a duel's chosen side) can move the room's light rather
   * than adding one of its own.
   */
  lightX?: string;
  className?: string;
}

/**
 * A full NBA court, in feet, drawn overhead into a 94-wide x 50-tall viewBox.
 *
 * THE FULL COURT, NOT A HALF COURT. A half court fills a landscape viewport
 * with its own sidelines running vertically down the screen, which reads as
 * two arbitrary vertical rules rather than as a court — the first attempt at
 * this component did exactly that and had to be thrown away. The overhead
 * full court is the shot every basketball broadcast opens on: both keys, both
 * arcs, and the centre circle, all legible at once. It also happens to be
 * 1.88:1, which sits close enough to a 16:9 viewport that `slice` crops only
 * the outer few feet of each baseline instead of discarding half the floor.
 *
 * Every number is a real dimension, not a shape that looked about right:
 *
 *   court             94 x 50 ft
 *   key (paint)       16 ft wide, 19 ft deep from each baseline
 *   free-throw circle 6 ft radius, centred on the key's far edge
 *   basket centre     5 ft 3 in in from the baseline
 *   restricted area   4 ft radius around the basket
 *   backboard         6 ft wide, 4 ft in from the baseline
 *   three-point       23 ft 9 in radius from the basket, with 22 ft straight
 *                     corner runs meeting the arc 14 ft in from the baseline
 *   centre circle     6 ft radius on the division line
 *
 * The corner-three tangent is derived rather than eyeballed: 14 ft in from
 * the baseline is 8.75 ft past the basket, so the perpendicular offset is
 * sqrt(23.75^2 - 8.75^2) = 22.08 ft, putting the straight run at y = 2.92 and
 * y = 47.08 — the real 22 ft corner three, 3 ft off each sideline.
 */
const COURT_L = 94;
const COURT_W = 50;
const MID_Y = COURT_W / 2;
const BASKET_IN = 5.25;
const ARC_R = 23.75;
const CORNER_Y = 2.92;
const CORNER_IN = 14;
/** The apron of floor outside the boundary — see the viewBox comment. */
const APRON_X = 8;
const APRON_Y = 6;

/** One end of the floor. `side` flips every x about the court's centre so the
 *  two ends are the same geometry rather than two hand-mirrored path strings
 *  that can drift apart. */
function CourtEnd({ side }: { side: 1 | -1 }) {
  const x = (ft: number) => (side === 1 ? ft : COURT_L - ft);
  return (
    <g>
      {/* The key, and the free-throw circle straddling its far edge. The far
          half of that circle is dashed on a real floor; keeping the detail is
          most of the difference between "a basketball court" and "rectangles". */}
      <path d={`M${x(0)} ${MID_Y - 8} L${x(19)} ${MID_Y - 8} L${x(19)} ${MID_Y + 8} L${x(0)} ${MID_Y + 8}`} />
      <path d={`M${x(19)} ${MID_Y - 6} A 6 6 0 0 ${side === 1 ? 1 : 0} ${x(19)} ${MID_Y + 6}`} />
      <path
        d={`M${x(19)} ${MID_Y - 6} A 6 6 0 0 ${side === 1 ? 0 : 1} ${x(19)} ${MID_Y + 6}`}
        style={{ strokeDasharray: "1.1 0.9" }}
      />

      {/* Backboard and the restricted-area arc under the rim. */}
      <path d={`M${x(4)} ${MID_Y - 3} L${x(4)} ${MID_Y + 3}`} />
      <path
        d={`M${x(BASKET_IN)} ${MID_Y - 4} A 4 4 0 0 ${side === 1 ? 1 : 0} ${x(BASKET_IN)} ${MID_Y + 4}`}
      />

      {/* Three-point line: two 22 ft corner runs and the arc between them. */}
      <path
        d={`M${x(0)} ${CORNER_Y} L${x(CORNER_IN)} ${CORNER_Y} A ${ARC_R} ${ARC_R} 0 0 ${
          side === 1 ? 1 : 0
        } ${x(CORNER_IN)} ${COURT_W - CORNER_Y} L${x(0)} ${COURT_W - CORNER_Y}`}
      />
    </g>
  );
}

function CourtPlan() {
  return (
    <svg
      /* THE VIEWBOX IS PADDED, AND THAT IS THE WHOLE COMPOSITION.
       *
       * A tight `0 0 94 50` box with `slice` scales the court until it
       * overflows the viewport, so on a 1440x900 display you see a fragment:
       * two enormous arcs sweeping through the body copy and no boundary
       * anywhere. It reads as abstract geometry, not as a court — which was
       * the second thing this component got wrong and had to be re-cut.
       *
       * Padding the box by 8ft of apron on each side and 6ft top and bottom
       * makes the aspect 1.77:1, close enough to a 16:9 viewport that `slice`
       * crops only the apron. The whole floor then lands inside the screen
       * with its own boundary visible and a margin of unlit page around it:
       * at 1440x900 the court runs x 38→1403, y 87→813. You see a court,
       * with room around it, rather than a piece of one.
       */
      viewBox={`${-APRON_X} ${-APRON_Y} ${COURT_L + APRON_X * 2} ${COURT_W + APRON_Y * 2}`}
      /* `slice`, so the apron always fills the viewport and the floor is
         never a letterboxed rectangle floating in black — the room has no
         edges. In portrait it crops inward to the centre circle and the
         division line, which is still unmistakably a basketball floor. */
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        stroke: "var(--pk-backdrop-line)",
        /* Stroke width is in viewBox units and therefore scales with the
           court. At the two verification viewports that lands at ~1.4 device
           px either way (1440x900 scales x18, 390x844 scales x16.9), so a
           line neither hairlines away on a phone nor turns into a stripe on
           a desktop. `vector-effect: non-scaling-stroke` would do the exact
           opposite — it pins the width to the pre-transform user unit, i.e.
           0.08 device px, which is invisible. */
        strokeWidth: 0.08,
        fill: "none",
        strokeLinejoin: "round",
      }}
    >
      {/* THE FLOOR ITSELF. Without this the court is lines suspended in a
          void; with it the page is standing on something. One flat fill, so
          it shifts every contrast ratio above it by the same constant rather
          than varying underneath a paragraph. */}
      <rect
        x={-APRON_X}
        y={-APRON_Y}
        width={COURT_L + APRON_X * 2}
        height={COURT_W + APRON_Y * 2}
        fill="var(--pk-backdrop-floor)"
        stroke="none"
      />

      {/* Boundary, division line, centre circle. These three carry more
          weight than the detail lines because they are what identifies the
          shape from the corner of the eye; the key and the arcs reward a
          direct look but do not have to win one. */}
      <path
        d={`M0 0 L${COURT_L} 0 L${COURT_L} ${COURT_W} L0 ${COURT_W} Z`}
        style={{ strokeWidth: 0.13 }}
      />
      <path d={`M${COURT_L / 2} 0 L${COURT_L / 2} ${COURT_W}`} style={{ strokeWidth: 0.13 }} />
      <circle cx={COURT_L / 2} cy={MID_Y} r={6} style={{ strokeWidth: 0.13 }} />

      <CourtEnd side={1} />
      <CourtEnd side={-1} />
    </svg>
  );
}

export default function PeakV2ArenaBackdrop({
  intensity = "ambient",
  lightX = "50%",
  className,
}: PeakV2ArenaBackdropProps) {
  return (
    <div
      aria-hidden="true"
      data-testid="arena-backdrop"
      data-intensity={intensity}
      className={`pk-arena-backdrop ${className ?? ""}`}
      style={{ ["--pk-backdrop-light-x" as string]: lightX }}
    >
      {intensity !== "quiet" ? <CourtPlan /> : null}
    </div>
  );
}
