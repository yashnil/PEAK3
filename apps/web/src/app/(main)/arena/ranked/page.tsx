"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { getAccessToken } from "@/lib/auth";
import { rankedApi } from "@/lib/ranked-api";
import { RANKED_MODES, RANKED_MODE_LABELS, type QueueRatingResponse, type RankedMode, type RankedReadinessResponse } from "@/types/ranked";
import PeakV2Shell from "@/components/v2/PeakV2Shell";

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
  const statusLabel =
    readiness == null
      ? "Checking ranked status…"
      : enabled
      ? "Closed alpha — open to a limited group while matchmaking is tuned."
      : "Ranked is not currently enabled.";

  return (
    <PeakV2Shell width="live">
        <header className="v2-page-header">
          <p className="v2-page-kicker">Competitive</p>
          <h1 className="v2-page-title">Ranked</h1>
          <p className="v2-page-lede">
            Paired with another player on the identical hidden board. Neither
            side sees the other&apos;s picks, score, or progress until both
            are done.
          </p>
          <p
            className="mt-4 inline-flex items-center gap-2"
            style={{
              fontFamily: "var(--v2-font-ui)",
              fontSize: "0.75rem",
              fontWeight: 700,
              color: enabled ? "var(--v2-color-positive)" : "var(--v2-text-muted)",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: enabled ? "var(--v2-color-positive)" : "var(--v2-text-muted)",
              }}
            />
            {statusLabel}
          </p>
          {!user && enabled ? (
            <p className="mt-2" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem", color: "var(--v2-text-secondary)" }}>
              <Link href="/signin?returnTo=/arena/ranked" style={{ color: "var(--v2-color-accent)", fontWeight: 700 }}>
                Sign in
              </Link>{" "}
              to join a ranked queue.
            </p>
          ) : null}
        </header>

        {enabled ? (
          <div className="v2-slate-grid" style={{ gridTemplateColumns: `repeat(${RANKED_MODES.length}, 1fr)` }}>
            {RANKED_MODES.map((mode) => {
              const rating = ratings[mode];
              return (
                <Link key={mode} href={`/arena/ranked/${mode}`} className="v2-slate-cell">
                  <span className="v2-slate-cell-head">
                    <span className="v2-slate-cell-tag">Ranked</span>
                  </span>
                  <span className="v2-slate-cell-title">{RANKED_MODE_LABELS[mode]}</span>
                  <span className="v2-slate-cell-desc">
                    {rating
                      ? rating.established
                        ? `Rating ${rating.rating?.toFixed(0)} · ${rating.division ?? rating.uncertainty_label}`
                        : `Placement ${rating.valid_rated_matches} of 7`
                      : "No rating yet — placement starts on your first match."}
                  </span>
                  <span className="v2-slate-cell-action" aria-hidden="true">
                    Join queue <span className="v2-slate-cell-arrow">→</span>
                  </span>
                </Link>
              );
            })}
          </div>
        ) : null}

        <p
          className="mt-10 pb-10"
          style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", lineHeight: 1.6, color: "var(--v2-text-muted)", maxWidth: "62ch" }}
        >
          Ranked results never affect Daily or Practice, and Daily/Practice/Direct
          Challenge results never affect ranked rating. XP is awarded for
          participation only — never for winning, rating, or division.
        </p>
      </PeakV2Shell>
    );
}
