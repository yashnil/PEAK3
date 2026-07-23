"use client";
import { useState } from "react";
import { SpinCandidate } from "@/types/perfect-season";

interface Props {
  candidates: SpinCandidate[];
  onSelect: (playerSlug: string) => void;
  disabled?: boolean;
}

/**
 * Search/browse eligible players for the current spin.
 *
 * ADR-005 Decision 6: this component NEVER renders a score or rank for any
 * candidate. `SpinCandidate` (types/perfect-season.ts) has no score field at
 * all, so there is nothing to accidentally render here -- the omission is
 * enforced by the type, not just by discipline in this file.
 *
 * Deliberately a plain list of buttons, not an ARIA listbox
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
      <div className="flex flex-col gap-2" role="group" aria-label="Eligible players">
        {filtered.map((c) => {
          const positions = [c.primary_position, ...c.secondary_positions].filter(Boolean).join(" / ");
          return (
            <button
              key={c.player_slug}
              data-testid="candidate-card"
              data-player-slug={c.player_slug}
              disabled={disabled}
              onClick={() => onSelect(c.player_slug)}
              className="text-left rounded-xl px-4 py-3 font-medium transition-all hover:opacity-90 flex items-center justify-between gap-3"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-default)",
                color: "var(--text-primary)",
              }}
            >
              <span>{c.player_name}</span>
              {positions && (
                <span
                  data-testid="candidate-position-badge"
                  className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 shrink-0"
                  style={{ color: "var(--text-muted)", background: "rgba(255,255,255,0.06)" }}
                >
                  {positions}
                </span>
              )}
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
