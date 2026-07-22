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
  color = "#f5c842",
}: Props) {
  const n = DIMS.length;
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38;

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
      aria-label="Lineup DNA radar"
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
