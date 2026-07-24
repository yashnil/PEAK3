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
 * Eligible-player candidate cards for the current spin (Phase 6B rebuild:
 * real game cards, not a flat admin-UI list of text rows).
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
      {candidates.length > 4 && (
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="group" aria-label="Eligible players">
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
              className="candidate-card-v2"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-default)",
                color: "var(--text-primary)",
              }}
            >
              {/* DOM order deliberately puts the name text node before the
                  avatar's initials text node (order:-1 below only reorders
                  visual/flex layout, not DOM/text order) -- innerText()
                  returns text in DOM order, and this button's accessible/
                  extractable name must be the player's name, not the
                  avatar's initials glyph. */}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold truncate">{c.player_name}</div>
                {c.team_name && c.season && (
                  <div className="text-[10px] truncate" style={{ color: "var(--text-secondary)" }} data-testid="candidate-team-season">
                    {c.team_name} · {c.season}
                  </div>
                )}
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {positions && (
                    <span
                      data-testid="candidate-position-badge"
                      className="inline-block text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5"
                      style={{ color: "var(--text-muted)", background: "rgba(255,255,255,0.06)" }}
                    >
                      Plays {positions}
                    </span>
                  )}
                  {isRosterOnly && (
                    <span
                      data-testid="candidate-roster-only-badge"
                      className="inline-block text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5"
                      style={{ color: "var(--text-muted)", background: "rgba(255,255,255,0.06)" }}
                      title="Real roster member; not in the canonical or 1500-player scored pool"
                    >
                      Roster-only
                    </span>
                  )}
                  {isUnscored && (
                    <span
                      data-testid="candidate-unscored-badge"
                      className="inline-block text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5"
                      style={{ color: "#fb923c", background: "rgba(251,146,60,0.1)" }}
                      title="No official PEAK3 score for this exact season (below the model's minutes threshold)"
                    >
                      Unscored
                    </span>
                  )}
                </div>
              </div>
              <div style={{ order: -1 }}>
                <PlayerAvatar name={c.player_name} size={38} />
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
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            No players match &ldquo;{query}&rdquo;.
          </p>
        )}
      </div>
    </div>
  );
}
