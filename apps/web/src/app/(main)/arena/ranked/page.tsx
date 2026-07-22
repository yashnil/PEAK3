"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { getAccessToken } from "@/lib/auth";
import { rankedApi } from "@/lib/ranked-api";
import { RANKED_MODES, RANKED_MODE_LABELS, type QueueRatingResponse, type RankedMode, type RankedReadinessResponse } from "@/types/ranked";

export default function RankedHubPage() {
  const { user } = useAuth();
  const [readiness, setReadiness] = useState<RankedReadinessResponse | null>(null);
  const [ratings, setRatings] = useState<Partial<Record<RankedMode, QueueRatingResponse>>>({});

  useEffect(() => {
    rankedApi.getReadiness().then(setReadiness).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user || !readiness?.ranked_enabled) return;
    (async () => {
      const token = await getAccessToken();
      if (!token) return;
      for (const mode of RANKED_MODES) {
        try {
          const r = await rankedApi.getRating(token, mode);
          setRatings((prev) => ({ ...prev, [mode]: r }));
        } catch {
          // not eligible / not signed in — leave unset
        }
      }
    })();
  }, [user, readiness]);

  const enabled = readiness?.ranked_enabled ?? false;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
        Ranked
      </h1>
      <p className="mt-2 text-base" style={{ color: "var(--text-secondary)" }}>
        Ranked pairs you with another player on the identical hidden board. Neither side sees
        the other&apos;s picks, score, or progress until both are done.
      </p>

      <div
        className="mt-3 text-xs px-3 py-2 rounded-lg border inline-block"
        style={{
          background: enabled ? "#34d39910" : "#f59e0b10",
          borderColor: enabled ? "#34d39940" : "#f59e0b40",
          color: enabled ? "#34d399" : "#f59e0b",
        }}
      >
        {readiness == null
          ? "Checking ranked status…"
          : enabled
          ? `Closed alpha — readiness: ${readiness.readiness_level}`
          : "Ranked is not currently enabled."}
      </div>

      {!user && enabled && (
        <p className="mt-4 text-sm" style={{ color: "var(--text-muted)" }}>
          <Link href="/signin?returnTo=/arena/ranked" style={{ color: "var(--peak-accent)" }}>
            Sign in
          </Link>{" "}
          to join a ranked queue.
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
        {RANKED_MODES.map((mode) => {
          const rating = ratings[mode];
          return (
            <div
              key={mode}
              className="rounded-2xl border p-5 flex flex-col gap-3"
              style={{ background: "var(--bg-elevated)", borderColor: "var(--border-default)" }}
            >
              <div className="font-bold text-base" style={{ color: "var(--text-primary)" }}>
                {RANKED_MODE_LABELS[mode]}
              </div>

              {rating && (
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {rating.established
                    ? `Rating ${rating.rating?.toFixed(0)} · ${rating.division ?? rating.uncertainty_label}`
                    : `Placement ${rating.valid_rated_matches} of 7`}
                </div>
              )}

              <Link
                href={enabled ? `/arena/ranked/${mode}` : "#"}
                aria-disabled={!enabled}
                className="text-center py-2 rounded-lg text-sm font-semibold transition-all"
                style={{
                  background: enabled ? "var(--peak-accent)" : "var(--border-default)",
                  color: enabled ? "var(--text-inverse)" : "var(--text-muted)",
                  pointerEvents: enabled ? "auto" : "none",
                }}
              >
                {enabled ? "Join queue" : "Unavailable"}
              </Link>
            </div>
          );
        })}
      </div>

      <div className="mt-10 text-xs" style={{ color: "var(--text-muted)" }}>
        <p>
          Ranked results never affect Daily or Practice, and Daily/Practice/Direct Challenge
          results never affect ranked rating. XP is awarded for participation only — never for
          winning, rating, or division.
        </p>
      </div>
    </div>
  );
}
