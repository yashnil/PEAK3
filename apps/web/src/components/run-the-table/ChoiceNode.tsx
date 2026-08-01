"use client";
import type { CSSProperties } from "react";
import { ActiveNode } from "@/types/run-the-table";
import {
  nodeChoiceTradeoff,
  nodeTypeCopy,
  shouldSuppressServerSummary,
} from "@/lib/run-the-table-copy";
import { Coachmark } from "@/components/ui/GuidedTour";
import { NodeTypeIcon } from "./NodeChoice";

/**
 * The written-choice node surface: "pick one of these, taking one closes the
 * others".
 *
 * UNDER rtt_ruleset_v3 THIS IS REST / BANK. It used to serve the Film Room as
 * well, because v2 gave both node types the identical two-choice payload. v3's
 * Scout & Prepare has three branches, each of which needs a SECOND selection (a
 * lane, a role, a card) and each of which shows data the player must read
 * first, so it has its own surface (`ScoutPrepare.tsx`). This component stays
 * generic rather than being renamed to `RestBank`: the payload shape it renders
 * is the shared `choices: [{id, label, description, disabled?}]` one, and any
 * future written-choice node arrives here with no change.
 *
 * The labels carry real numbers ("Bank 11 credits") because the server built
 * them from the node's own payload. They are printed, never recomputed.
 *
 * Each choice states what it COSTS you (`nodeChoiceTradeoff`) — the part the
 * payload never says, and the part the decision actually turns on.
 *
 * DOM ORDER IS LOAD-BEARING. `e2e/run-the-table.spec.ts` clicks the first
 * ENABLED `<button>` inside this subtree, so the coachmark — which renders a
 * "Got it" button — is mounted AFTER the choices, never before them.
 */
interface Props {
  node: ActiveNode;
  busy: boolean;
  onChoose: (choiceId: string) => void;
}

export default function ChoiceNode({ node, busy, onChoose }: Props) {
  const choices = node.choices ?? [];
  const copy = nodeTypeCopy(node.node_type);

  return (
    <section
      data-testid="rtt-choice-node"
      className="rtt-decision-surface flex flex-col gap-3"
      style={{ "--rtt-node-accent": copy.accentVar } as CSSProperties}
    >
      <header className="flex flex-col gap-1">
        <div className="rtt-node-head">
          <NodeTypeIcon type={node.node_type} />
          <div className="flex flex-col min-w-0">
            <span className="rtt-node-kind">{copy.label}</span>
            <h2 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
              {node.title}
            </h2>
          </div>
        </div>
        {/* The generator's own line for this node. `shouldSuppressServerSummary`
            is false for every node type under v3 — the one string it existed
            for (the v2 Film Room's phantom "prep advantage") no longer exists —
            but the check stays, because it is the mechanism that keeps a
            generated line the engine cannot honour off the screen. */}
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {shouldSuppressServerSummary(node.node_type) ? copy.purpose : node.summary}
        </p>
        {/* The static rule for this KIND of node, so the choice below is read
            against something. Never anything about this node's contents. */}
        <p className="rtt-node-consequence">{copy.consequence}</p>
      </header>

      {/* Container query, not `sm:` — see `.rtt-decision-surface`. */}
      <ul className="grid gap-2.5 @[440px]:grid-cols-2">
        {choices.map((choice) => {
          const tradeoff = nodeChoiceTradeoff(node.node_type, choice.id);
          return (
            <li key={choice.id} className="min-w-0">
              <button
                type="button"
                data-testid={`rtt-choice-${choice.id}`}
                onClick={() => onChoose(choice.id)}
                disabled={busy || choice.disabled === true}
                className="rtt-choice-btn rtt-node-option h-full w-full text-left disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                  {choice.label}
                </span>
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {choice.description}
                </span>
                {/* What you give up. The payload only ever says what you gain,
                    and since taking one closes the other, the cost IS the
                    decision. */}
                {tradeoff && (
                  <span
                    className="rtt-node-consequence"
                    data-testid={`rtt-choice-tradeoff-${choice.id}`}
                  >
                    {tradeoff}
                  </span>
                )}
                {/* This component serves BOTH `film_room` and `rest_bank`, and
                    the payload carries no reason field — only `disabled`. The
                    full-lives sentence is true of `rest_bank` only, so anything
                    else gets a neutral line rather than a wrong one. */}
                {choice.disabled && (
                  <span
                    className="text-[10px]"
                    style={{ color: "var(--text-muted)" }}
                    data-testid={`rtt-choice-disabled-${choice.id}`}
                  >
                    {node.node_type === "rest_bank"
                      ? "Nothing to recover — you are already at full lives."
                      : "Not available on this node."}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {/* One-time hint for the first visit to this node type. Shown once ever,
          per node type — never a replay of the whole tour. */}
      {(node.node_type === "film_room" || node.node_type === "rest_bank") && (
        <Coachmark id={node.node_type} />
      )}
    </section>
  );
}
