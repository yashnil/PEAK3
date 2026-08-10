"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getAccessToken } from "@/lib/auth";
import { rankedApi } from "@/lib/ranked-api";
import { RANKED_MODES, RANKED_MODE_LABELS, type QueueRatingResponse, type RankedMode } from "@/types/ranked";

/**
 * Three separate rating cards, one per queue (spec section S — "Profile:
 * separate rating cards for all three queues... no composite rank until
 * at least two queues are established"). Exact rating shown in detail here;
 * uncertainty is explained in plain language, never just a raw RD number.
 */
export default function RankedRatingCards() {
  const [ratings, setRatings] = useState<Partial<Record<RankedMode, QueueRatingResponse>>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const token = await getAccessToken();
      if (!token) {
        setLoaded(true);
        return;
      }
      for (const mode of RANKED_MODES) {
        try {
          const r = await rankedApi.getRating(token, mode);
          setRatings((prev) => ({ ...prev, [mode]: r }));
        } catch {
          // Ranked disabled or not yet playable for this account — omit silently.
        }
      }
      setLoaded(true);
    })();
  }, []);

  if (!loaded || Object.keys(ratings).length === 0) return null;

  const establishedCount = Object.values(ratings).filter((r) => r?.established).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>
          Ranked rating
        </h2>
        <Link href="/arena/ranked" className="text-xs" style={{ color: "var(--peak-accent-text)" }}>
          View queues
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {RANKED_MODES.map((mode) => {
          const rating = ratings[mode];
          if (!rating) return null;
          return (
            <div
              key={mode}
              className="pk-depth pk-crown rounded-lg border p-3"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              {/* WAS `--text-muted`. It names the queue the rating belongs to,
                  and three cards side by side are indistinguishable without
                  it. No count-up here on purpose: a standing rating on a
                  profile is DISPLAYED, not resolved — it did not just happen. */}
              <div className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                {RANKED_MODE_LABELS[mode]}
              </div>
              {rating.established ? (
                <>
                  <div
                    className="score-number font-display text-2xl font-bold"
                    style={{ color: "var(--text-primary)" }}
                    aria-label={`${RANKED_MODE_LABELS[mode]} rating: ${rating.rating?.toFixed(0)}`}
                  >
                    {rating.rating?.toFixed(0)}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                    {rating.division} · {rating.uncertainty_label}
                  </div>
                </>
              ) : (
                <div className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
                  Placement {rating.valid_rated_matches} of 7
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* No composite rank shown until at least two queues are established. */}
      {establishedCount < 2 && (
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          A combined ranked profile appears once at least two queues are established.
        </p>
      )}
    </div>
  );
}
