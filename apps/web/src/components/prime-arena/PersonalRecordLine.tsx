"use client";

/**
 * Personal best, win streak and rating lines for a finished match, as receipt
 * rows. Every figure is the server's (`GET /arena/modes/{mode}/me`). While the
 * record loads the rows say so; if it cannot load they say that instead of
 * inventing a number.
 */

import { useEffect, useState } from "react";

import { getPersonalRecord, type PersonalRecordResponse } from "@/lib/prime-arena/personal";

export default function PersonalRecordLine({
  mode,
  matchId,
  rated,
  scoreLabel,
  formatScore,
}: {
  mode: string;
  matchId: string;
  rated: boolean;
  scoreLabel: string;
  formatScore: (value: number) => string;
}) {
  const [record, setRecord] = useState<PersonalRecordResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPersonalRecord(mode, matchId)
      .then((value) => {
        if (!cancelled) setRecord(value);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, matchId]);

  if (failed) {
    return (
      <div className="parena-personal" data-testid="parena-personal">
        <dt>Your record</dt>
        <dd>Your record could not be loaded right now.</dd>
      </div>
    );
  }
  if (!record) {
    return (
      <div className="parena-personal" data-testid="parena-personal">
        <dt>Your record</dt>
        <dd>Loading…</dd>
      </div>
    );
  }

  let best: string;
  if (!record.match_found || record.match_score === null) {
    best = record.best_score !== null ? `Best ${scoreLabel}: ${formatScore(record.best_score)}` : "No finished matches yet";
  } else if (record.previous_best_score === null) {
    best = `First result: ${formatScore(record.match_score)} is your best ${scoreLabel} so far`;
  } else if (record.is_personal_best) {
    best = `New personal best — up from ${formatScore(record.previous_best_score)}`;
  } else {
    best = `Personal best stands at ${formatScore(record.previous_best_score)}`;
  }

  const streak = record.streak_after_match ?? record.current_win_streak;
  const streakText =
    streak > 0
      ? `${streak} win${streak === 1 ? "" : "s"} in a row · longest ${record.longest_win_streak}`
      : `No active streak · longest ${record.longest_win_streak}`;

  let ratingText: string;
  if (!rated) ratingText = "Unrated match — practice and private rooms never move a rating";
  else if (!record.ratings_enabled) ratingText = "Rated match — ratings are not being written yet";
  else if (record.match_rating_change === null) ratingText = "Rating update pending";
  else {
    const delta = record.match_rating_change;
    ratingText = `${delta >= 0 ? "+" : ""}${delta.toFixed(0)} → ${record.rating?.toFixed(0) ?? "—"}${record.rating_provisional ? " (provisional)" : ""}`;
  }

  return (
    <>
      <div className="parena-personal" data-testid="parena-personal-best">
        <dt>Personal best</dt>
        <dd>{best}</dd>
      </div>
      <div className="parena-personal" data-testid="parena-personal-streak">
        <dt>Win streak</dt>
        <dd>{streakText}</dd>
      </div>
      <div className="parena-personal" data-testid="parena-personal-rating">
        <dt>Rating</dt>
        <dd>{ratingText}</dd>
      </div>
      <div className="parena-personal" data-testid="parena-personal-played">
        <dt>Played</dt>
        <dd className="pk-numeral">
          {record.matches_played} match{record.matches_played === 1 ? "" : "es"} · {record.wins} win{record.wins === 1 ? "" : "s"}
        </dd>
      </div>
    </>
  );
}
