"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

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
      <section className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">Head-to-Head</h1>
        <p className="mt-3 text-sm opacity-80" role="alert">{error}</p>
        <Link href="/arena/run-the-table/h2h" className="mt-6 inline-block text-sm underline">
          Your head-to-head history
        </Link>
      </section>
    );
  }

  if (!match) {
    return (
      <section className="mx-auto max-w-2xl px-4 py-16" aria-busy="true">
        <p className="text-sm opacity-70">Loading match…</p>
      </section>
    );
  }

  const waiting = !match.opponent;
  const submitted = Boolean(match.you.result);

  return (
    <section className="mx-auto max-w-2xl px-4 py-10">
      <p className="text-xs uppercase tracking-widest opacity-60">Head-to-Head</p>
      <h1 className="mt-2 text-2xl font-semibold">
        {waiting
          ? "Waiting for an opponent"
          : `You vs ${match.opponent?.display_name}`}
      </h1>

      <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="opacity-60">Your run</dt>
          <dd data-testid="h2h-your-status">{submitted ? "Submitted" : "In progress"}</dd>
        </div>
        <div>
          <dt className="opacity-60">Opponent</dt>
          <dd data-testid="h2h-opponent-status">
            {waiting
              ? "Not joined yet"
              : match.opponent_status === "hidden"
                ? "Hidden until you have both finished"
                : "Submitted"}
          </dd>
        </div>
      </dl>

      {!submitted && match.you.run_id && (
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={`/arena/run-the-table?run=${encodeURIComponent(match.you.run_id)}`}
            className="rounded border border-current px-4 py-2 text-sm"
          >
            Continue your run
          </Link>
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy}
            className="rounded bg-[var(--peak-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-60"
          >
            Submit my finished run
          </button>
        </div>
      )}

      {submitted && !match.both_complete && (
        <p className="mt-6 text-sm" role="status" data-testid="h2h-awaiting">
          Your run is in. Nothing about it is shown to your opponent, and nothing about
          theirs is shown to you, until you have both finished.
        </p>
      )}

      {receipt && (
        <div className="mt-8">
          <SideBySideReceipt receipt={receipt} />
        </div>
      )}

      {match.both_complete && (
        <div className="mt-8">
          {rematch ? (
            <div>
              <p className="text-sm">Rematch link — a brand new board, same rules:</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="break-all rounded bg-black/20 px-2 py-1 text-xs">
                  {inviteUrl(rematch.invite_url_path)}
                </code>
                <button
                  type="button"
                  className="rounded border border-current px-3 py-1 text-xs"
                  onClick={() => {
                    void navigator.clipboard?.writeText(inviteUrl(rematch.invite_url_path));
                    setCopied(true);
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={onRematch}
              disabled={busy}
              className="rounded border border-current px-4 py-2 text-sm disabled:opacity-60"
            >
              Offer a rematch
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="mt-4 text-sm" role="alert">
          {error}
        </p>
      )}

      <Link
        href="/arena/run-the-table/h2h"
        className="mt-8 inline-block text-sm underline opacity-80"
      >
        All your head-to-heads
      </Link>
    </section>
  );
}
