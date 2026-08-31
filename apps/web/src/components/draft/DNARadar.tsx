"use client";
import { LineupDNA, DNA_LABELS } from "@/types/draft";

const DIMS = [
  "primary_creation",
  "scoring_pressure",
  "individual_validation",
  "postseason_translation",
  "team_context",
  "context_completeness",
] as const;

interface Props {
  dna: LineupDNA;
  size?: number;
  color?: string;
}

export default function DNARadar({
  dna,
  size = 120,
  color = "var(--peak-accent)",
}: Props) {
  const n = DIMS.length;
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38;

  // FINAL RC AUDIT FIX: the accessible name used to be the static string
  // "Lineup DNA radar" — real for sighted users (the polygon's shape and
  // fill IS the six dimensions), but a screen-reader user got no data at
  // all, only "there is a radar chart here." The six per-point `<title>`
  // elements below never fixed this: a `role="img"` element's accessible
  // name/description comes from `aria-label`/`aria-labelledby` per the
  // accname spec, so those never reached assistive tech in the first
  // place (they're kept as native hover tooltips for a mouse, which is
  // real, separate behavior). Building the label from the actual values
  // is the smallest fix that closes the gap without adding a visible
  // table this thumbnail-sized decoration has no room for.
  const summary = DIMS.map((dim) => `${DNA_LABELS[dim]} ${Math.round(dna[dim] ?? 0)}`).join(", ");

  function polarToXY(angleIdx: number, radius: number) {
    const angle = (Math.PI * 2 * angleIdx) / n - Math.PI / 2;
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  }

  // Polygon for DNA values
  const points = DIMS.map((dim, i) => {
    const val = (dna[dim] ?? 0) / 100;
    const pt = polarToXY(i, r * val);
    return `${pt.x},${pt.y}`;
  }).join(" ");

  // Spoke endpoints and ring levels
  const spokes = DIMS.map((_, i) => polarToXY(i, r));
  const rings = [0.25, 0.5, 0.75, 1.0].map((frac) =>
    DIMS.map((_, i) => polarToXY(i, r * frac)).map((p) => `${p.x},${p.y}`).join(" ")
  );

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="max-w-full h-auto"
      aria-label={`Lineup DNA: ${summary}`}
      role="img"
    >
      {/* Ring guides */}
      {rings.map((pts, ri) => (
        <polygon
          key={ri}
          points={pts}
          fill="none"
          stroke="var(--border-subtle)"
          strokeWidth={0.5}
        />
      ))}

      {/* Spokes */}
      {spokes.map((end, i) => (
        <line
          key={i}
          x1={cx}
          y1={cy}
          x2={end.x}
          y2={end.y}
          stroke="var(--border-subtle)"
          strokeWidth={0.5}
        />
      ))}

      {/* DNA fill */}
      <polygon
        points={points}
        fill={`${color}30`}
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />

      {/* Label dots */}
      {DIMS.map((dim) => (
        <title key={dim}>
          {DNA_LABELS[dim]}: {Math.round(dna[dim] ?? 0)}
        </title>
      ))}
    </svg>
  );
}
