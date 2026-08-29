"use client";

/**
 * Full-page loading gate for an authenticated personal surface (profile,
 * progress, history) while auth resolves and the first fetch is in flight.
 * Was three byte-identical inline spinners (one per page) with no
 * accessible label at all; extracted once all three needed it, and given
 * the `role="status"` announcement they were missing.
 */
export function PersonalPageLoading() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]" role="status" aria-label="Loading">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-[var(--border-default)] border-t-[var(--peak-accent)]" />
    </div>
  );
}

export default PersonalPageLoading;
