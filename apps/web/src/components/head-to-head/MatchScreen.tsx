"use client";
import { useCallback, useEffect, useState } from "react";

import { getAccessToken } from "@/lib/auth";
import {
  headToHeadApi,
  HeadToHeadAPIError,
  inviteUrl,
  type HeadToHeadCreated,
  type HeadToHeadMatchView,
  type HeadToHeadReceipt,
} from "@/lib/head-to-head-api";
import SideBySideReceipt from "./SideBySideReceipt";
import PeakV2Shell from "@/components/v2/PeakV2Shell";
import PeakV2PrimaryAction from "@/components/v2/PeakV2PrimaryAction";
import PeakV2SecondaryAction from "@/components/v2/PeakV2SecondaryAction";
import { StatusChip, type StatusChipTone } from "@/components/ui/StatusChip";
import { ErrorState } from "@/components/ui/ErrorState";

/**
 * One head-to-head match: status, opponent, your run, and -- once both sides
 * are in -- the side-by-side receipt and a rematch offer.
 *
 * SPOILER SAFETY IS THE SERVER'S, NOT THIS COMPONENT'S. `opponent_status` is
 * the literal string `"hidden"` until `both_complete`, and `opponent.result` is
 * simply absent. This renders what it was given; there is no client-side
 * "don't show it yet" flag that a devtools user could flip, because the data is
 * not in the response to begin with.
 */
export default function MatchScreen({ matchId }: { matchId: string }) {
  const [match, setMatch] = useState<HeadToHeadMatchView | null>(null);
  const [receipt, setReceipt] = useState<HeadToHeadReceipt | null>(null);
  const [rematch, setRematch] = useState<HeadToHeadCreated | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setError("Sign in to see this head-to-head.");
      return;
    }
    try {
      const view = await headToHeadApi.getMatch(matchId, token);
      setMatch(view);
      if (view.both_complete) {
        setReceipt(await headToHeadApi.getReceipt(matchId, token));
      }
    } catch (err) {
      setError((err as HeadToHeadAPIError).message);
    }
  }, [matchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSubmit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new HeadToHeadAPIError(401, "Sign in first.");
      setMatch(await headToHeadApi.submitResult(matchId, token));
      await load();
    } catch (err) {
      setError((err as HeadToHeadAPIError).message);
    } finally {
      setBusy(false);
    }
  }, [load, matchId]);

  const onRematch = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new HeadToHeadAPIError(401, "Sign in first.");
      setRematch(await headToHeadApi.rematch(matchId, token));
    } catch (err) {
      setError((err as HeadToHeadAPIError).message);
    } finally {
      setBusy(false);
    }
  }, [matchId]);

  if (error && !match) {
    return (
      <PeakV2Shell width="live">
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 py-16 text-center">
          <h1 className="v2-page-title" style={{ fontSize: "var(--v2-display-size-line)" }}>
            Head-to-Head
          </h1>
          <ErrorState message={error} />
          <PeakV2SecondaryAction href="/arena/run-the-table/h2h">
            Your head-to-head history
          </PeakV2SecondaryAction>
        </div>
      </PeakV2Shell>
    );
  }

  if (!match) {
    return (
      <PeakV2Shell width="live">
        <div className="mx-auto max-w-2xl py-16" aria-busy="true">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Loading match…
          </p>
        </div>
      </PeakV2Shell>
    );
  }

  const waiting = !match.opponent;
  const submitted = Boolean(match.you.result);
  const [yourLabel, yourTone] = yourStatus(submitted);
  const [oppLabel, oppTone] = opponentStatus(waiting, match.opponent_status);

  return (
    <PeakV2Shell width="live">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <header className="v2-page-header">
          <p className="v2-page-kicker">Head-to-Head</p>
          <h1 className="v2-page-title" style={{ fontSize: "var(--v2-display-size-line)" }}>
            {waiting ? "Waiting for an opponent" : `You vs ${match.opponent?.display_name}`}
          </h1>
        </header>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              Your run
            </dt>
            <dd className="mt-1" data-testid="h2h-your-status">
              <StatusChip tone={yourTone}>{yourLabel}</StatusChip>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              Opponent
            </dt>
            <dd className="mt-1" data-testid="h2h-opponent-status">
              <StatusChip tone={oppTone}>{oppLabel}</StatusChip>
            </dd>
          </div>
        </dl>

        {!submitted && match.you.run_id && (
          <div className="flex flex-wrap gap-3">
            <PeakV2SecondaryAction href={`/arena/run-the-table?run=${encodeURIComponent(match.you.run_id)}`}>
              Continue your run
            </PeakV2SecondaryAction>
            <PeakV2PrimaryAction onClick={onSubmit} disabled={busy} busy={busy}>
              Submit my finished run
            </PeakV2PrimaryAction>
          </div>
        )}

        {submitted && !match.both_complete && (
          <p
            className="text-sm"
            role="status"
            data-testid="h2h-awaiting"
            style={{ color: "var(--text-secondary)" }}
          >
            Your run is in. Nothing about it is shown to your opponent, and nothing about
            theirs is shown to you, until you have both finished.
          </p>
        )}

        {receipt && <SideBySideReceipt receipt={receipt} />}

        {match.both_complete && (
          <div>
            {rematch ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm" style={{ color: "var(--text-primary)" }}>
                  Rematch link — a brand new board, same rules:
                </p>
                <div
                  className="flex flex-wrap items-center gap-2 rounded-lg border p-3"
                  style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}
                >
                  <code className="score-number break-all text-xs" style={{ color: "var(--text-secondary)" }}>
                    {inviteUrl(rematch.invite_url_path)}
                  </code>
                  <PeakV2SecondaryAction
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard?.writeText(inviteUrl(rematch.invite_url_path));
                      setCopied(true);
                    }}
                  >
                    {copied ? "Copied" : "Copy"}
                  </PeakV2SecondaryAction>
                </div>
              </div>
            ) : (
              <PeakV2SecondaryAction onClick={onRematch} disabled={busy}>
                Offer a rematch
              </PeakV2SecondaryAction>
            )}
          </div>
        )}

        {error && (
          <p className="text-sm" role="alert" style={{ color: "var(--incorrect)" }}>
            {error}
          </p>
        )}

        <PeakV2SecondaryAction href="/arena/run-the-table/h2h" size="sm" className="self-start">
          All your head-to-heads
        </PeakV2SecondaryAction>
      </div>
    </PeakV2Shell>
  );
}

function yourStatus(submitted: boolean): [string, StatusChipTone] {
  return submitted ? ["Submitted", "positive"] : ["In progress", "muted"];
}

function opponentStatus(waiting: boolean, opponentStatus: string): [string, StatusChipTone] {
  if (waiting) return ["Not joined yet", "muted"];
  if (opponentStatus === "hidden") return ["Hidden until you have both finished", "neutral"];
  return ["Submitted", "positive"];
}
