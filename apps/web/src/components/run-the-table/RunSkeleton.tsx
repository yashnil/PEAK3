"use client";

/**
 * A real skeleton of the three-zone shell — the ladder rail, the decision
 * surface, the tray. No artificial delay anywhere: it is mounted while the
 * first fetch is genuinely in flight and unmounted the moment it lands.
 */
export default function RunSkeleton() {
  return (
    <>
      {/* The shell itself is `aria-hidden` — pulsing blocks are noise to a
          screen reader. Without this line the whole loading state was silent:
          nothing at all was announced between the click and the first frame
          of the run. */}
      <span role="status" className="sr-only" data-testid="rtt-skeleton-status">
        Loading your run…
      </span>
      <div className="rtt-shell" data-testid="rtt-skeleton" aria-hidden="true">
        <div className="rtt-zone-left flex flex-col gap-1.5">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="rtt-skeleton-block" style={{ height: i % 3 === 2 ? 42 : 34 }} />
          ))}
        </div>
        <div className="rtt-decision-surface flex flex-col gap-3 min-w-0">
          <div className="rtt-skeleton-block" style={{ height: 22, width: "40%" }} />
          <div className="rtt-skeleton-block" style={{ height: 60 }} />
          <div className="grid gap-2.5 @[560px]:grid-cols-2">
            <div className="rtt-skeleton-block" style={{ height: 150 }} />
            <div className="rtt-skeleton-block" style={{ height: 150 }} />
            <div className="rtt-skeleton-block" style={{ height: 150 }} />
          </div>
        </div>
        <div className="rtt-zone-right flex flex-col gap-3">
          <div className="rtt-skeleton-block" style={{ height: 56 }} />
          <div className="rtt-skeleton-block" style={{ height: 200 }} />
          <div className="rtt-skeleton-block" style={{ height: 120 }} />
        </div>
      </div>
    </>
  );
}
