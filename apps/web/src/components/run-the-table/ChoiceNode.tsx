"use client";
import type { CSSProperties } from "react";
import { ActiveNode } from "@/types/run-the-table";
import { nodeChoiceTradeoff, nodeTypeCopy } from "@/lib/run-the-table-copy";
import { Coachmark } from "@/components/ui/GuidedTour";
import { NodeTypeIcon } from "./NodeChoice";

/**
 * Film Room and Rest / Bank — both are "pick one of two written choices", and
 * the API gives them the identical `choices: [{id, label, description,
 * disabled?}]` shape, so they share one screen rather than two near-copies.
 *
 * The labels carry real numbers ("Bank 12 credits") because the server built
 * them from the node's own payload. They are printed, never recomputed.
 *
 * FILM ROOM'S THIRD CHOICE IS DEFERRED, NOT FORGOTTEN. Plan §5.3:
 * `nba_peak/run_the_table/generation.py` derives the whole node blueprint from
 * the seed, so adding a third branch would make every existing daily seed and
 * challenge token produce a different run — a correctness regression wearing a
 * feature's clothes. What this component does instead is make the two real
 * choices unmistakable: each one now states what it COSTS you
 * (`nodeChoiceTradeoff`), which is the part the payload never says and the part
 * the decision actually turns on.
 *
 * DOM ORDER IS LOAD-BEARING. `e2e/run-the-table.spec.ts:124` clicks the first
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
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {node.summary}
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
