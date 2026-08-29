"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { getAccessToken } from "@/lib/auth";
import { useAuth } from "@/lib/auth-context";
import { RUN_THE_TABLE_STORAGE_KEY } from "@/types/run-the-table";
import {
  headToHeadApi,
  HeadToHeadAPIError,
  inviteUrl,
  type HeadToHeadCreated,
} from "@/lib/head-to-head-api";
import PeakV2PrimaryAction from "@/components/v2/PeakV2PrimaryAction";
import PeakV2SecondaryAction from "@/components/v2/PeakV2SecondaryAction";
import { ErrorState } from "@/components/ui/ErrorState";

/**
 * "Challenge someone to this board" — the creation half of head-to-head.
 *
 * WHERE THE RUN COMES FROM. The active RUN THE TABLE run, read from the
 * localStorage breadcrumb the game already keeps -- `RUN_THE_TABLE_STORAGE_KEY`
 * from `@/types/run-the-table`, the same constant `lib/run-the-table-state.ts`
 * writes with. Importing it rather than re-declaring the string is deliberate:
 * two copies of a storage key is how a rename silently detaches a feature.
 *
 * The breadcrumb is a CONVENIENCE, not a credential. The server independently
 * checks that the caller owns the run before pinning anything
 * (`assert_owns` in `POST /run-the-table/h2h`), so a hand-edited localStorage
 * entry naming a stranger's run gets a 403, not a challenge.
 */
export default function ChallengeCreator() {
  const { user } = useAuth();
  const [runId, setRunId] = useState<string | null>(null);
  const [created, setCreated] = useState<HeadToHeadCreated | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(RUN_THE_TABLE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { run_id?: unknown };
      if (typeof parsed.run_id === "string" && parsed.run_id) setRunId(parsed.run_id);
    } catch {
      // A corrupt entry must never be the reason this panel cannot render.
    }
  }, []);

  const onCreate = useCallback(async () => {
    if (!runId) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new HeadToHeadAPIError(401, "Sign in to challenge someone.");
      setCreated(await headToHeadApi.create(runId, token));
    } catch (err) {
      setError((err as HeadToHeadAPIError).message);
    } finally {
      setBusy(false);
    }
  }, [runId]);

  if (!runId) {
    return (
      <p className="text-sm" style={{ color: "var(--text-secondary)" }} data-testid="h2h-create-no-run">
        Start a RUN THE TABLE run first — then you can challenge someone to the exact
        same board.{" "}
        <Link href="/arena/run-the-table" className="underline" style={{ color: "var(--peak-accent-text)" }}>
          Play RUN THE TABLE
        </Link>
      </p>
    );
  }

  if (created) {
    const url = inviteUrl(created.invite_url_path);
    return (
      <div data-testid="h2h-created" className="flex flex-col gap-3">
        <p className="text-sm" style={{ color: "var(--text-primary)" }}>
          Challenge created. Send this link — whoever opens it plays your exact board.
        </p>
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border p-3"
          style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}
        >
          <code className="score-number break-all text-xs" style={{ color: "var(--text-secondary)" }}>
            {url}
          </code>
          <PeakV2SecondaryAction
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText(url);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </PeakV2SecondaryAction>
        </div>
        <PeakV2SecondaryAction href={`/arena/run-the-table/h2h/${created.match_id}`} size="sm" className="self-start">
          Open the match
        </PeakV2SecondaryAction>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        Challenge someone to your current board. They get the same starting roster,
        the same perk offers, the same node map and the same five bosses — each one
        scaled to the team you build — and neither of you sees the other&apos;s
        result until you have both finished.
      </p>
      {user ? (
        <PeakV2PrimaryAction onClick={onCreate} disabled={busy} busy={busy} className="self-start">
          {busy ? "Creating…" : "Create a head-to-head"}
        </PeakV2PrimaryAction>
      ) : (
        <PeakV2SecondaryAction href="/signin?next=/arena/run-the-table/h2h" className="self-start">
          Sign in to challenge someone
        </PeakV2SecondaryAction>
      )}
      {error && <ErrorState message={error} />}
    </div>
  );
}
