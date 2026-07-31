"use client";
import { ActiveNode } from "@/types/run-the-table";
import { NODE_TYPE_LABELS } from "@/lib/run-the-table-state";

/**
 * Film Room and Rest / Bank — both are "pick one of two written choices",
 * and the API gives them the identical `choices: [{id, label, description,
 * disabled?}]` shape, so they share one screen rather than two near-copies.
 *
 * The labels carry real numbers ("Bank 12 credits") because the server built
 * them from the node's own payload. They are printed, never recomputed.
 */
interface Props {
  node: ActiveNode;
  busy: boolean;
  onChoose: (choiceId: string) => void;
}

export default function ChoiceNode({ node, busy, onChoose }: Props) {
  const choices = node.choices ?? [];
  return (
    <section data-testid="rtt-choice-node" className="rtt-decision-surface flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <span
          className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: "var(--peak-accent)" }}
        >
          {NODE_TYPE_LABELS[node.node_type]}
        </span>
        <h2 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
          {node.title}
        </h2>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {node.summary}
        </p>
      </header>

      {/* Container query, not `sm:` — see `.rtt-decision-surface`. */}
      <ul className="grid gap-2.5 @[440px]:grid-cols-2">
        {choices.map((choice) => (
          <li key={choice.id} className="min-w-0">
            <button
              type="button"
              data-testid={`rtt-choice-${choice.id}`}
              onClick={() => onChoose(choice.id)}
              disabled={busy || choice.disabled === true}
              className="rtt-choice-btn h-full w-full text-left disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                {choice.label}
              </span>
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {choice.description}
              </span>
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
        ))}
      </ul>
    </section>
  );
}
