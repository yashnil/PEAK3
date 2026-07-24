/**
 * Real NBA team brand colors (public, well-documented primary/secondary hex
 * values) keyed by the exact franchise_display_name strings the interim/
 * experimental team datasets use. Colors + initials only -- deliberately NO
 * logos, wordmarks, or any scraped imagery (CLAUDE.md / Phase 6A hard
 * constraint: no scraped images/headshots/logos in the repo). This is the
 * "safe team-color fallback badge" Goal 6 asks for, not a licensed asset.
 */
export interface TeamColors {
  primary: string;
  secondary: string;
  initials: string;
}

const TEAM_COLORS: Record<string, TeamColors> = {
  "Atlanta Hawks": { primary: "#E03A3E", secondary: "#C1D32F", initials: "ATL" },
  "Boston Celtics": { primary: "#007A33", secondary: "#BA9653", initials: "BOS" },
  "Brooklyn Nets": { primary: "#000000", secondary: "#FFFFFF", initials: "BKN" },
  "Charlotte Hornets": { primary: "#1D1160", secondary: "#00788C", initials: "CHA" },
  "Chicago Bulls": { primary: "#CE1141", secondary: "#000000", initials: "CHI" },
  "Cleveland Cavaliers": { primary: "#860038", secondary: "#FDBB30", initials: "CLE" },
  "Dallas Mavericks": { primary: "#00538C", secondary: "#002B5E", initials: "DAL" },
  "Denver Nuggets": { primary: "#0E2240", secondary: "#FEC524", initials: "DEN" },
  "Detroit Pistons": { primary: "#C8102E", secondary: "#1D42BA", initials: "DET" },
  "Golden State Warriors": { primary: "#1D428A", secondary: "#FFC72C", initials: "GSW" },
  "Houston Rockets": { primary: "#CE1141", secondary: "#000000", initials: "HOU" },
  "Indiana Pacers": { primary: "#002D62", secondary: "#FDBB30", initials: "IND" },
  "LA Clippers": { primary: "#C8102E", secondary: "#1D428A", initials: "LAC" },
  "Los Angeles Lakers": { primary: "#552583", secondary: "#FDB927", initials: "LAL" },
  "Memphis Grizzlies": { primary: "#5D76A9", secondary: "#12173F", initials: "MEM" },
  "Miami Heat": { primary: "#98002E", secondary: "#F9A01B", initials: "MIA" },
  "Milwaukee Bucks": { primary: "#00471B", secondary: "#EEE1C6", initials: "MIL" },
  "Minnesota Timberwolves": { primary: "#0C2340", secondary: "#236192", initials: "MIN" },
  "New Orleans Pelicans": { primary: "#0C2340", secondary: "#C8102E", initials: "NOP" },
  "New York Knicks": { primary: "#006BB6", secondary: "#F58426", initials: "NYK" },
  "Oklahoma City Thunder": { primary: "#007AC1", secondary: "#EF3B24", initials: "OKC" },
  "Orlando Magic": { primary: "#0077C0", secondary: "#C4CED4", initials: "ORL" },
  "Philadelphia 76ers": { primary: "#006BB6", secondary: "#ED174C", initials: "PHI" },
  "Phoenix Suns": { primary: "#1D1160", secondary: "#E56020", initials: "PHX" },
  "Portland Trail Blazers": { primary: "#E03A3E", secondary: "#000000", initials: "POR" },
  "Sacramento Kings": { primary: "#5A2D81", secondary: "#63727A", initials: "SAC" },
  "San Antonio Spurs": { primary: "#C4CED4", secondary: "#000000", initials: "SAS" },
  "Toronto Raptors": { primary: "#CE1141", secondary: "#000000", initials: "TOR" },
  "Utah Jazz": { primary: "#002B5C", secondary: "#F9A01B", initials: "UTA" },
  "Washington Wizards": { primary: "#002B5C", secondary: "#E31837", initials: "WAS" },
};

const FALLBACK_INITIALS_STOPWORDS = new Set(["los", "la", "san", "new", "oklahoma", "golden"]);

function deriveInitials(name: string): string {
  const words = name.split(/\s+/).filter((w) => w.length > 0);
  const meaningful = words.filter((w) => !FALLBACK_INITIALS_STOPWORDS.has(w.toLowerCase()));
  const source = meaningful.length > 0 ? meaningful : words;
  return source
    .slice(-3)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 3);
}

/** Real color if known; otherwise a deterministic neutral fallback (never a
 * fabricated "team color" for a franchise not in the table above). */
export function getTeamColors(franchiseDisplayName: string | null | undefined): TeamColors {
  if (!franchiseDisplayName) {
    return { primary: "var(--peak-accent, #f5c842)", secondary: "var(--bg-surface)", initials: "—" };
  }
  return TEAM_COLORS[franchiseDisplayName] ?? {
    primary: "var(--text-muted)",
    secondary: "var(--bg-surface)",
    initials: deriveInitials(franchiseDisplayName),
  };
}
