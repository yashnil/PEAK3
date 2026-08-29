"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/lib/auth-context";
import { getAccessToken } from "@/lib/auth";
import {
  headToHeadApi,
  HeadToHeadAPIError,
  type InviteDescriptor,
} from "@/lib/head-to-head-api";
import PeakV2Shell from "@/components/v2/PeakV2Shell";
import PeakV2PrimaryAction from "@/components/v2/PeakV2PrimaryAction";
import PeakV2SecondaryAction from "@/components/v2/PeakV2SecondaryAction";
import { StatusChip, type StatusChipTone } from "@/components/ui/StatusChip";

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
      <PeakV2Shell width="live">
        <div className="mx-auto flex max-w-xl flex-col items-center gap-4 py-16 text-center">
          <h1 className="v2-page-title" style={{ fontSize: "var(--v2-display-size-line)" }}>
            This challenge link did not work
          </h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {error.message}
          </p>
          <PeakV2SecondaryAction href="/arena/run-the-table">Play RUN THE TABLE</PeakV2SecondaryAction>
        </div>
      </PeakV2Shell>
    );
  }

  if (!invite) {
    return (
      <PeakV2Shell width="live">
        <div className="mx-auto max-w-xl py-16 text-center" aria-busy="true">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Loading challenge…
          </p>
        </div>
      </PeakV2Shell>
    );
  }

  const full = invite.seats_taken >= 2;
  const staleRules = !invite.expired && !full && !invite.playable;
  const [label, tone] = statusLabelAndTone(invite.status, full);

  return (
    <PeakV2Shell width="live">
      <div className="mx-auto flex max-w-xl flex-col gap-6">
        <header className="v2-page-header">
          <p className="v2-page-kicker">Head-to-Head</p>
          <h1 className="v2-page-title" style={{ fontSize: "var(--v2-display-size-line)" }}>
            {invite.creator_display_name} challenged you to RUN THE TABLE
          </h1>
        </header>

        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          You will both play the <strong style={{ color: "var(--text-primary)" }}>same board</strong> — the
          same starting roster, the same perk offers, the same node map and the same five
          bosses, each one scaled to the team you build. Only your choices differ.
        </p>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Neither of you sees the other&apos;s result until you have both finished.
        </p>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          This does not use your daily attempt.
        </p>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              Status
            </dt>
            <dd className="mt-1" data-testid="invite-status">
              <StatusChip tone={tone}>{label}</StatusChip>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              Expires
            </dt>
            <dd className="score-number mt-1" style={{ color: "var(--text-primary)" }}>
              {new Date(invite.expires_at).toLocaleDateString()}
            </dd>
          </div>
        </dl>

        {invite.expired && (
          <p className="text-sm" role="status" style={{ color: "var(--text-secondary)" }}>
            This challenge has expired. Ask {invite.creator_display_name} for a new link.
          </p>
        )}
        {full && !invite.expired && (
          <p className="text-sm" role="status" style={{ color: "var(--text-secondary)" }}>
            This challenge has already been accepted by someone else.
          </p>
        )}
        {staleRules && (
          <p className="text-sm" role="status" style={{ color: "var(--text-secondary)" }}>
            This link was made under an older ruleset, so the same seed no longer
            produces the same board. Ask for a new link.
          </p>
        )}

        {invite.playable && !user && (
          <div className="flex flex-col gap-3">
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Head-to-head is account-backed, so a result cannot be lost with a cleared
              cookie. Sign in to accept.
            </p>
            <PeakV2PrimaryAction
              href={`/signin?next=${encodeURIComponent(
                `/arena/run-the-table/h2h/invite/${token}`,
              )}`}
              className="self-start"
            >
              Sign in to accept
            </PeakV2PrimaryAction>
          </div>
        )}

        {invite.playable && user && (
          <PeakV2PrimaryAction onClick={onAccept} disabled={accepting} busy={accepting} className="self-start">
            {accepting ? "Setting up your board…" : "Accept challenge"}
          </PeakV2PrimaryAction>
        )}

        {error && (
          <p className="text-sm" role="alert" style={{ color: "var(--incorrect)" }}>
            {error.message}
          </p>
        )}
      </div>
    </PeakV2Shell>
  );
}

function statusLabelAndTone(status: string, full: boolean): [string, StatusChipTone] {
  if (status === "complete") return ["Finished", "neutral"];
  if (full || status === "in_progress") return ["Both players in", "accent"];
  return ["Waiting for an opponent", "muted"];
}
