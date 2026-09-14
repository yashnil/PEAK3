import type { ArenaLeaderboardEntry } from "@/lib/arena-leaderboard-api";
import { compositionCopy, formatRating, modeLabel, recordCopy } from "./leaderboard-copy";

/**
 * The Top Players table. Rows arrive in the server's order and carry the
 * server's rank — this component numbers nothing. A gap in the rank column is
 * a rated player without a public handle, explained beneath the table.
 */
export default function TopPlayersTable({
  entries,
  mode,
  youHandle,
}: {
  entries: ArenaLeaderboardEntry[];
  mode: string;
  youHandle?: string | null;
}) {
  return (
    <div className="alb-scroll">
      <table className="alb-table" data-testid="alb-top-table">
        <caption className="sr-only">
          {modeLabel(mode)} rated leaderboard. Ranked by rating, then by rated matches played. Opponents
          shows how many of each player&apos;s rated matches were all-human and how many included bots.
        </caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Player</th>
            <th scope="col">Tier</th>
            <th scope="col" className="alb-num">
              Rating
            </th>
            <th scope="col" className="alb-num">
              Record
            </th>
            <th scope="col">Opponents</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const isYou = !!youHandle && entry.handle === youHandle;
            return (
              <tr
                key={`${entry.rank}-${entry.handle}`}
                data-testid="alb-top-row"
                data-rank={entry.rank}
                data-you={isYou ? "true" : "false"}
                className={isYou ? "alb-row-you" : undefined}
              >
                <td className="alb-rank">{entry.rank.toLocaleString()}</td>
                <td className="alb-player">
                  <span className="alb-handle">{entry.handle}</span>
                  {isYou && <span className="alb-chip alb-chip-you">You</span>}
                  {entry.provisional && <span className="alb-chip">Provisional</span>}
                </td>
                <td className="alb-tier">
                  {entry.tier ?? (
                    <span className="alb-muted">
                      —<span className="sr-only"> no tier while provisional</span>
                    </span>
                  )}
                </td>
                <td className="alb-num alb-rating">{formatRating(entry.rating)}</td>
                <td className="alb-num">
                  {recordCopy(entry.wins, entry.losses, entry.draws)}
                </td>
                <td className="alb-composition">
                  {compositionCopy(entry.matches_all_human, entry.matches_with_bots)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
