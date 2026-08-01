"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { useAuth } from "@/lib/auth-context";
import { getAccessToken } from "@/lib/auth";
import {
  headToHeadApi,
  HeadToHeadAPIError,
  type InviteDescriptor,
} from "@/lib/head-to-head-api";

/**
 * The invite landing page (spec §6, "Experience").
 *
 * SHOWS: who challenged you, the challenge's status, when it expires, and what
 * a head-to-head is.
 *
 * DELIBERATELY DOES NOT SHOW: the seed, the roster, the bosses, the node map,
 * or a single number about the creator's run -- not even whether they finished
 * well. The server enforces that by omission (`InviteDescriptorResponse`); this
 * component could not render a spoiler if it wanted to, because none is sent.
 *
 * Readable signed out. Accepting requires an account, and the page says so up
 * front rather than at the button, because "sign in to continue" discovered
 * after a decision is a worse experience than one stated before it.
 */
export default function InviteLanding({ token }: { token: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const [invite, setInvite] = useState<InviteDescriptor | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await headToHeadApi.getInvite(token);
        if (!cancelled) setInvite(data);
      } catch (err) {
        if (cancelled) return;
        const e = err as HeadToHeadAPIError;
        setError({ message: e.message, code: e.code });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const onAccept = useCallback(async () => {
    setAccepting(true);
    setError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError({ message: "Sign in to accept this challenge.", code: "auth_required" });
        return;
      }
      const match = await headToHeadApi.accept(token, accessToken);
      router.push(`/arena/run-the-table/h2h/${match.match_id}`);
    } catch (err) {
      const e = err as HeadToHeadAPIError;
      setError({ message: e.message, code: e.code });
    } finally {
      setAccepting(false);
    }
  }, [router, token]);

  if (error && !invite) {
    return (
      <section className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">This challenge link did not work</h1>
        <p className="mt-3 text-sm opacity-80">{error.message}</p>
        <Link
          href="/arena/run-the-table"
          className="mt-6 inline-block rounded border border-current px-4 py-2 text-sm"
        >
          Play RUN THE TABLE
        </Link>
      </section>
    );
  }

  if (!invite) {
    return (
      <section className="mx-auto max-w-xl px-4 py-16 text-center" aria-busy="true">
        <p className="text-sm opacity-70">Loading challenge…</p>
      </section>
    );
  }

  const full = invite.seats_taken >= 2;
  const staleRules = !invite.expired && !full && !invite.playable;

  return (
    <section className="mx-auto max-w-xl px-4 py-12">
      <p className="text-xs uppercase tracking-widest opacity-60">Head-to-Head</p>
      <h1 className="mt-2 text-3xl font-semibold">
        {invite.creator_display_name} challenged you to RUN THE TABLE
      </h1>

      <p className="mt-4 text-sm opacity-80">
        You will both play the <strong>same board</strong> — the same starting roster, the
        same perk offers, the same node map and the same bosses. Only your choices differ.
      </p>
      <p className="mt-2 text-sm opacity-80">
        Neither of you sees the other&apos;s result until you have both finished.
      </p>
      <p className="mt-2 text-sm opacity-70">
        This does not use your daily attempt.
      </p>

      <dl className="mt-6 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="opacity-60">Status</dt>
          <dd data-testid="invite-status">{statusLabel(invite.status, full)}</dd>
        </div>
        <div>
          <dt className="opacity-60">Expires</dt>
          <dd>{new Date(invite.expires_at).toLocaleDateString()}</dd>
        </div>
      </dl>

      {invite.expired && (
        <p className="mt-6 text-sm" role="status">
          This challenge has expired. Ask {invite.creator_display_name} for a new link.
        </p>
      )}
      {full && !invite.expired && (
        <p className="mt-6 text-sm" role="status">
          This challenge has already been accepted by someone else.
        </p>
      )}
      {staleRules && (
        <p className="mt-6 text-sm" role="status">
          This link was made under an older ruleset, so the same seed no longer
          produces the same board. Ask for a new link.
        </p>
      )}

      {invite.playable && !user && (
        <div className="mt-8">
          <p className="text-sm opacity-80">
            Head-to-head is account-backed, so a result cannot be lost with a cleared
            cookie. Sign in to accept.
          </p>
          <Link
            href={`/signin?next=${encodeURIComponent(
              `/arena/run-the-table/h2h/invite/${token}`,
            )}`}
            className="mt-3 inline-block rounded bg-[var(--peak-accent)] px-5 py-2.5 text-sm font-semibold text-black"
          >
            Sign in to accept
          </Link>
        </div>
      )}

      {invite.playable && user && (
        <button
          type="button"
          onClick={onAccept}
          disabled={accepting}
          className="mt-8 rounded bg-[var(--peak-accent)] px-5 py-2.5 text-sm font-semibold text-black disabled:opacity-60"
        >
          {accepting ? "Setting up your board…" : "Accept challenge"}
        </button>
      )}

      {error && (
        <p className="mt-4 text-sm" role="alert">
          {error.message}
        </p>
      )}
    </section>
  );
}

function statusLabel(status: string, full: boolean): string {
  if (status === "complete") return "Finished";
  if (full || status === "in_progress") return "Both players in";
  return "Waiting for an opponent";
}
