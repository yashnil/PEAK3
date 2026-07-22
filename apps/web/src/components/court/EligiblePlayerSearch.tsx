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
      <div className="flex flex-col gap-2" role="listbox" aria-label="Eligible players">
        {filtered.map((c) => (
          <button
            key={c.player_slug}
            data-testid="candidate-card"
            data-player-slug={c.player_slug}
            role="option"
            aria-selected={false}
            disabled={disabled}
            onClick={() => onSelect(c.player_slug)}
            className="text-left rounded-xl px-4 py-3 font-medium transition-all hover:opacity-90"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-default)",
              color: "var(--text-primary)",
            }}
          >
            {c.player_name}
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            No players match &ldquo;{query}&rdquo;.
          </p>
        )}
      </div>
    </div>
  );
}
