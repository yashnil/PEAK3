"use client";
import { useState } from "react";
import { SpinCandidate } from "@/types/perfect-season";
import PlayerAvatar from "./PlayerAvatar";

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
          const positions = [c.primary_position, ...c.secondary_positions].filter(Boolean).join(" / ");
          const isRosterOnly = c.identity_pool_status === "team_year_roster_only";
          const isUnscored = c.score_status === "exact_season_unscored";
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
                color: "var(--text-primary)",
              }}
            >
              {/* Name first in DOM order so the button's accessible/
                  extractable name (innerText()) is the player's name, not
                  the avatar's initials glyph -- `order:-1` below only
                  reorders visual/flex layout, not DOM/text order. */}
              <div className="min-w-0 flex-1 text-left">
                <div className="text-sm font-bold truncate">{c.player_name}</div>
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-0.5">
                  {c.team_name && c.season && (
                    <span className="text-[10px] truncate" style={{ color: "var(--text-secondary)" }} data-testid="candidate-team-season">
                      {c.team_name} · {c.season}
                    </span>
                  )}
                  {positions && (
                    <span
                      data-testid="candidate-position-badge"
                      className="text-[9px] font-semibold uppercase tracking-wide rounded px-1 py-px"
                      style={{ color: "var(--text-muted)", background: "rgba(255,255,255,0.06)" }}
                    >
                      {positions}
                    </span>
                  )}
                  {isRosterOnly && (
                    <span
                      data-testid="candidate-roster-only-badge"
                      className="text-[9px] font-semibold uppercase tracking-wide rounded px-1 py-px"
                      style={{ color: "var(--text-muted)", background: "rgba(255,255,255,0.06)" }}
                      title="Roster Only: a real team-season roster member, not currently part of PEAK3's scored universe."
                    >
                      Roster Only
                    </span>
                  )}
                  {isUnscored && (
                    <span
                      data-testid="candidate-unscored-badge"
                      className="text-[9px] font-semibold uppercase tracking-wide rounded px-1 py-px"
                      style={{ color: "#fb923c", background: "rgba(251,146,60,0.1)" }}
                      title="Score Pending: exact season score unavailable; the official lineup score may be incomplete."
                    >
                      Score Pending
                    </span>
                  )}
                </div>
              </div>

              <div style={{ order: -1 }}>
                <PlayerAvatar name={c.player_name} size={34} />
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
