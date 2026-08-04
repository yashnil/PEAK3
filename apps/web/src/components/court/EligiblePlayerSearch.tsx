"use client";
import { useState } from "react";
import { SpinCandidate } from "@/types/perfect-season";
import PlayerAvatar from "./PlayerAvatar";
import { getTeamColors } from "@/lib/team-colors";

interface Props {
  candidates: SpinCandidate[];
  onSelect: (playerSlug: string) => void;
  disabled?: boolean;
}

/**
 * Eligible-player candidate list for the current spin (Phase 6E rebuild).
 *
 * Product decision (Phase 6E Part C): single column, one player per row,
 * scrollable -- not a two-column grid. A grid of ~15 cards read as an admin
 * roster table, not a game. Order is whatever the backend sends (see
 * scripts/build_experimental_team_year_dataset.py -- alphabetical by
 * display name, never minutes/score/star-weighted) and this component does
 * NOT re-sort it -- re-sorting here would silently reintroduce a star-first
 * bias the backend was fixed to remove.
 *
 * ADR-005 Decision 6: this component NEVER renders a score or rank for any
 * candidate. `SpinCandidate` (types/perfect-season.ts) has no score field at
 * all, so there is nothing to accidentally render here -- the omission is
 * enforced by the type, not just by discipline in this file.
 *
 * Still deliberately a plain list of buttons, not an ARIA listbox
 * (role="listbox"/"option"): that pattern implies roving-tabindex arrow-key
 * navigation, which this component does not implement, so applying the
 * roles without the behavior would be a misleading promise to assistive
 * tech. Plain buttons + native Tab order match the convention already used
 * by the existing Peak Draft offer cards (components/draft/DraftCard.tsx).
 */
export default function EligiblePlayerSearch({ candidates, onSelect, disabled }: Props) {
  const [query, setQuery] = useState("");

  const filtered = candidates.filter((c) =>
    c.player_name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div data-testid="eligible-player-search" className="flex flex-col gap-2">
      {candidates.length > 6 && (
        <input
          type="text"
          placeholder="Search eligible players…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="rounded-lg px-3 py-2 text-sm"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-default)",
            color: "var(--text-primary)",
          }}
          aria-label="Search eligible players"
        />
      )}
      <div
        className="flex flex-col gap-1.5 overflow-y-auto pr-1"
        style={{ maxHeight: 360 }}
        role="group"
        aria-label="Eligible players"
        data-testid="candidate-list"
      >
        {filtered.map((c) => {
          // Phase 9B: `secondary_positions` now carries the OTHER positions
          // this player really logged career minutes at
          // (nba_peak/perfect_season/career_positions.py). It used to be
          // unconditionally [] -- parse_real_position never yields secondaries
          // for the committed data -- so a genuine multi-position player like
          // Jimmy Butler rendered a bare "SF" and looked position-locked,
          // which is exactly what made a later SF/SG/PF placement read as
          // "off-slot" out of nowhere. Now it reads "SF / SG / PF" up front,
          // so the fit the game will report is visible BEFORE the pick.
          const positions = [c.primary_position, ...c.secondary_positions].filter(Boolean).join(" / ");
          const isRosterOnly = c.identity_pool_status === "team_year_roster_only";
          const isUnscored = c.score_status === "exact_season_unscored";
          // Phase 7A Part A: traded player whose score is the whole
          // season's aggregate, not team-specific (see exact_season.py's
          // score_source taxonomy) -- shown so it's clear the number isn't
          // this exact team stint's own performance.
          const isSeasonAggregate = c.score_source === "exact_season_aggregate";
          const teamAccent = getTeamColors(c.team_name).primary;
          return (
            <button
              key={c.player_slug}
              data-testid="candidate-card"
              data-player-slug={c.player_slug}
              disabled={disabled}
              onClick={() => onSelect(c.player_slug)}
              className="candidate-row-v3"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-default)",
                borderLeft: `3px solid color-mix(in srgb, ${teamAccent} 55%, transparent)`,
                color: "var(--text-primary)",
              }}
            >
              {/* Name first in DOM order so the button's accessible/
                  extractable name (innerText()) is the player's name, not
                  the avatar's initials glyph -- `order:-1` below only
                  reorders visual/flex layout, not DOM/text order. */}
              <div className="min-w-0 flex-1 text-left">
                <div className="text-sm font-bold" style={{ wordBreak: "break-word" }}>{c.player_name}</div>
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-0.5">
                  {c.team_name && c.season && (
                    <span className="text-[10px]" style={{ color: "var(--text-secondary)" }} data-testid="candidate-team-season">
                      {c.team_name} · {c.season}
                    </span>
                  )}
                  {positions && (
                    <span
                      data-testid="candidate-position-badge"
                      className="text-[9px] font-semibold uppercase tracking-wide rounded px-1 py-px"
                      style={{ color: "var(--text-muted)", background: "var(--pk-surface-inset, var(--bg-elevated))" }}
                    >
                      {positions}
                    </span>
                  )}
                  {isRosterOnly && (
                    <span
                      data-testid="candidate-roster-only-badge"
                      className="text-[9px] font-semibold uppercase tracking-wide rounded px-1 py-px"
                      style={{ color: "var(--text-muted)", background: "var(--pk-surface-inset, var(--bg-elevated))" }}
                      title="Roster Only: a real team-season roster member, not currently part of PEAK3's scored universe."
                    >
                      Roster Only
                    </span>
                  )}
                  {isUnscored && (
                    <span
                      data-testid="candidate-unscored-badge"
                      className="text-[9px] font-semibold uppercase tracking-wide rounded px-1 py-px"
                      style={{ color: "var(--accent-orange)", background: "color-mix(in srgb, var(--accent-orange) 10%, transparent)" }}
                      title="Score Pending: exact season score unavailable; the official lineup score may be incomplete."
                    >
                      Score Pending
                    </span>
                  )}
                  {isSeasonAggregate && (
                    <span
                      data-testid="candidate-season-aggregate-badge"
                      className="text-[9px] font-semibold uppercase tracking-wide rounded px-1 py-px"
                      style={{ color: "var(--text-muted)", background: "var(--pk-surface-inset, var(--bg-elevated))" }}
                      title="Season Aggregate: this player was traded mid-season -- the score shown is their whole-season total, not specific to this exact team stint."
                    >
                      Season Aggregate
                    </span>
                  )}
                </div>
              </div>

              <div
                style={{
                  order: -1,
                  padding: 2,
                  borderRadius: "999px",
                  background: `color-mix(in srgb, ${teamAccent} 50%, transparent)`,
                }}
              >
                <PlayerAvatar name={c.player_name} size={36} imageUrl={c.headshot_url} />
              </div>

              <span
                aria-hidden="true"
                className="shrink-0 text-[10px] font-bold uppercase tracking-wide rounded-full px-2.5 py-1"
                style={{ color: "var(--text-inverse)", background: "var(--peak-accent, #f5c842)" }}
              >
                Choose
              </span>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-sm py-2" style={{ color: "var(--text-muted)" }}>
            No players match &ldquo;{query}&rdquo;.
          </p>
        )}
      </div>
    </div>
  );
}
