import Link from "next/link";
import { RefreshCw } from "lucide-react";

import type { ArenaAroundMeResponse, ArenaLeaderboardEntry } from "@/lib/arena-leaderboard-api";
import { formatRating, reasonCopy } from "./leaderboard-copy";

export type AroundYouState =
  | { kind: "signed_out" }
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "ready"; data: ArenaAroundMeResponse };

function NeighbourRow({ entry }: { entry: ArenaLeaderboardEntry }) {
  return (
    <li className="alb-around-row" data-testid="alb-around-row">
      <span className="alb-rank">{entry.rank.toLocaleString()}</span>
      <span className="alb-handle">{entry.handle}</span>
      <span className="alb-num">{formatRating(entry.rating)}</span>
    </li>
  );
}

/**
 * Around You — the caller and the listed players nearest them.
 *
 * Three honest answers from the server, never an estimate: not rated yet;
 * ranked but unlisted (no public handle); or listed. Signed-out readers get a
 * prompt and no request is made on their behalf.
 */
export default function AroundYouPanel({
  state,
  mode,
  signInHref,
  onRetry,
}: {
  state: AroundYouState;
  mode: string;
  signInHref: string;
  onRetry: () => void;
}) {
  return (
    <section className="alb-panel alb-around" aria-labelledby="alb-around-title" data-testid="alb-around" data-state={state.kind === "ready" ? state.data.status : state.kind}>
      <h2 id="alb-around-title" className="alb-panel-title">
        Around you
      </h2>

      {state.kind === "signed_out" && (
        <>
          <p>Sign in to see where you stand and the players rated closest to you.</p>
          <Link className="alb-link" href={signInHref} data-testid="alb-around-signin">
            Sign in
          </Link>
        </>
      )}

      {state.kind === "loading" && (
        <p role="status" data-testid="alb-around-loading">
          Finding your place on the board…
        </p>
      )}

      {state.kind === "failed" && (
        <div role="alert">
          <p>Your standing could not be loaded. This is a connection problem, not your rating.</p>
          <button type="button" className="alb-button" onClick={onRetry} data-testid="alb-around-retry">
            <RefreshCw size={13} aria-hidden="true" />
            Try again
          </button>
        </div>
      )}

      {state.kind === "ready" && state.data.status === "not_rated" && (
        <>
          <p data-testid="alb-around-not-rated">
            {state.data.me ? reasonCopy("not_rated", state.data.me) : "Not rated yet."}
          </p>
          <Link className="alb-link" href={`/arena/lobby?game=${encodeURIComponent(mode)}`}>
            Find a public match
          </Link>
        </>
      )}

      {state.kind === "ready" && state.data.status !== "not_rated" && state.data.me && (
        <>
          {state.data.status === "unlisted" && (
            <p className="alb-note" data-testid="alb-around-unlisted">
              You are ranked but not listed: choose a public handle on your{" "}
              <Link className="alb-link" href="/profile">
                profile
              </Link>{" "}
              to appear on the board.
            </p>
          )}
          <ol className="alb-around-list" aria-label="Players rated closest to you">
            {state.data.above.map((entry) => (
              <NeighbourRow key={`a-${entry.rank}`} entry={entry} />
            ))}
            <li className="alb-around-row alb-row-you" data-testid="alb-around-you" aria-current="true">
              <span className="alb-rank">
                {state.data.me.rank != null ? state.data.me.rank.toLocaleString() : "—"}
              </span>
              <span className="alb-handle">
                {state.data.me.handle ?? "You (unlisted)"}
                <span className="alb-chip alb-chip-you">You</span>
              </span>
              <span className="alb-num">{formatRating(state.data.me.rating)}</span>
            </li>
            {state.data.below.map((entry) => (
              <NeighbourRow key={`b-${entry.rank}`} entry={entry} />
            ))}
          </ol>
          {state.data.above.length === 0 && state.data.below.length === 0 && (
            <p className="alb-note">No other listed players in this mode yet.</p>
          )}
        </>
      )}
    </section>
  );
}
