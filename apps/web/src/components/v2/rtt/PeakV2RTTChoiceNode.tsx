"use client";

/**
 * PeakV2RTTChoiceNode — the V2 "written choice" node surface: pick one of a
 * short list of labelled options, taking one closes the others. Mainly
 * `rest_bank` under `rtt_ruleset_v3` (recover a life vs. bank credits), but
 * generic to any `choices: [{id, label, description, disabled?}]` payload,
 * same as legacy `ChoiceNode.tsx` — see that file for the full rationale.
 *
 * Deliberately a distinct identity from `PeakV2RTTDraftRoom`: this is a
 * binary/small decision, not a shop, so it stays a compact header plus a
 * hairline list of rows — no card selection, no second "confirm slot" step.
 * A click on a choice IS the decision.
 *
 * Every choice states what it COSTS you (`nodeChoiceTradeoff`) beneath its
 * label — the payload only ever says what you gain, and since taking one
 * closes the other, the cost is the actual decision driver. A disabled
 * choice states why, verbatim from legacy: the full-lives sentence is true
 * of `rest_bank` only, so anything else gets the neutral line rather than a
 * wrong one.
 */

import { ActiveNode } from "@/types/run-the-table";
import { nodeChoiceTradeoff, nodeTypeCopy } from "@/lib/run-the-table-copy";
import PeakV2LiveHeader from "../PeakV2LiveHeader";

interface Props {
  node: ActiveNode;
  busy: boolean;
  onChoose: (choiceId: string) => void;
}

export default function PeakV2RTTChoiceNode({ node, busy, onChoose }: Props) {
  const choices = node.choices ?? [];
  const copy = nodeTypeCopy(node.node_type);

  return (
    <div data-testid="rtt-choice-node">
      <PeakV2LiveHeader
        as="h1"
        title={node.title}
        subtitle={copy.consequence}
        status={
          <span
            style={{
              fontFamily: "var(--v2-font-mono)",
              fontSize: "0.6875rem",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: copy.accentTextVar,
            }}
          >
            {copy.label}
          </span>
        }
      />

      <ul className="flex flex-col">
        {choices.map((choice) => {
          const tradeoff = nodeChoiceTradeoff(node.node_type, choice.id);
          const disabled = busy || choice.disabled === true;
          return (
            <li key={choice.id}>
              <button
                type="button"
                data-testid={`rtt-choice-${choice.id}`}
                onClick={() => onChoose(choice.id)}
                disabled={disabled}
                aria-disabled={disabled || undefined}
                className="pk-lift flex w-full flex-col items-start gap-1 py-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed"
                style={{
                  borderBottom: "1px solid var(--v2-border-subtle)",
                  // A real click affordance: without this, an enabled choice
                  // rendered identically to disabled prose text next to it —
                  // nothing on screen said "this whole row is a button."
                  // The node type's own accent (the same token its status
                  // label already carries) marks it actionable, never
                  // decorative — transparent once disabled, same as legacy.
                  borderLeft: `2px solid ${disabled ? "transparent" : copy.accentVar}`,
                  paddingLeft: "var(--v2-space-3)",
                  opacity: choice.disabled ? 0.55 : 1,
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--v2-font-ui)",
                    fontWeight: 700,
                    fontSize: "0.9375rem",
                    color: "var(--v2-text-primary)",
                  }}
                >
                  {choice.label}
                </span>
                <span
                  style={{
                    fontFamily: "var(--v2-font-ui)",
                    fontSize: "0.8125rem",
                    color: "var(--v2-text-secondary)",
                  }}
                >
                  {choice.description}
                </span>
                {/* What you give up. The payload only ever says what you gain,
                    and since taking one closes the other, the cost IS the
                    decision. */}
                {tradeoff ? (
                  <span
                    data-testid={`rtt-choice-tradeoff-${choice.id}`}
                    style={{
                      fontFamily: "var(--v2-font-ui)",
                      fontSize: "0.75rem",
                      color: "var(--v2-text-muted)",
                    }}
                  >
                    {tradeoff}
                  </span>
                ) : null}
                {/* This component serves any written-choice node type, and the
                    payload carries no reason field — only `disabled`. The
                    full-lives sentence is true of `rest_bank` only, so
                    anything else gets a neutral line rather than a wrong
                    one. */}
                {choice.disabled ? (
                  <span
                    data-testid={`rtt-choice-disabled-${choice.id}`}
                    style={{
                      fontFamily: "var(--v2-font-ui)",
                      fontSize: "0.6875rem",
                      color: "var(--v2-text-muted)",
                    }}
                  >
                    {node.node_type === "rest_bank"
                      ? "Nothing to recover — you are already at full lives."
                      : "Not available on this node."}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
