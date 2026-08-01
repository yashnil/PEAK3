"use client";
import type { CSSProperties } from "react";
import { NodeType, StageOption } from "@/types/run-the-table";
import { NODE_ICON_PATHS, RTT_COPY, nodeTypeCopy } from "@/lib/run-the-table-copy";

/**
 * The branch: two nodes, one stage. Both are plain `<button>`s so the whole
 * choice is keyboard-operable with nothing but Tab and Enter.
 *
 * `title` and `summary` are the generator's own text for this seed — the client
 * adds only the node-type identity (icon, accent, purpose, consequence) and
 * never anything about what is inside the node.
 *
 * NODE DIFFERENTIATION (brief §7). The stage fork is the moment the player is
 * asked to compare two *kinds* of move, and before this pass the only thing
 * distinguishing them was a line of grey uppercase text. Each option now
 * carries the node type's icon, its accent (an existing frozen token — see
 * `NODE_TYPE_COPY`), a one-clause purpose, and the concrete consequence of
 * taking it. That is the whole "show the difference before the user picks a
 * path" requirement.
 *
 * DOM ORDER IS LOAD-BEARING. `e2e/run-the-table.spec.ts:112` drives the game by
 * clicking `[data-testid="rtt-node-choice"] button` — the FIRST button in this
 * subtree. Nothing that is not a stage option may be rendered before the list;
 * that rules out a header tooltip or an inline coachmark above it, both of
 * which render real `<button>` triggers.
 */
interface Props {
  options: StageOption[];
  act: number;
  stage: number;
  stagesPerAct: number;
  busy: boolean;
  onChoose: (option: StageOption) => void;
}

/**
 * The node-type glyph.
 *
 * Draws `NODE_ICON_PATHS`, so this component and anything W4 renders in the map
 * or the tray use the identical mark without importing each other. Purely
 * decorative — the label next to it is the accessible name.
 */
export function NodeTypeIcon({ type }: { type: NodeType }) {
  const copy = nodeTypeCopy(type);
  return (
    <span
      className="rtt-node-icon"
      aria-hidden="true"
      data-node-type={type}
      style={{ "--rtt-node-accent": copy.accentVar } as CSSProperties}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d={NODE_ICON_PATHS[copy.icon]} />
      </svg>
    </span>
  );
}

export default function NodeChoice({
  options,
  act,
  stage,
  stagesPerAct,
  busy,
  onChoose,
}: Props) {
  return (
    <section data-testid="rtt-node-choice" className="rtt-decision-surface flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <span
          className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: "var(--peak-accent)" }}
        >
          Act {act} · Stage {stage} of {stagesPerAct}
        </span>
        <h2 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
          Where does the front office spend this window?
        </h2>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {RTT_COPY.branch}
        </p>
      </header>

      {/* Container query, not `sm:` — see `.rtt-decision-surface`. */}
      <ul className="grid gap-2.5 @[440px]:grid-cols-2">
        {options.map((option) => {
          const copy = nodeTypeCopy(option.node_type);
          return (
            <li key={option.node_id} className="min-w-0">
              <button
                type="button"
                data-testid={`rtt-node-option-${option.node_id}`}
                data-node-type={option.node_type}
                onClick={() => onChoose(option)}
                disabled={busy}
                className="rtt-choice-btn rtt-node-option h-full w-full text-left disabled:opacity-60"
                style={{ "--rtt-node-accent": copy.accentVar } as CSSProperties}
              >
                <span className="rtt-node-head">
                  <NodeTypeIcon type={option.node_type} />
                  <span className="flex flex-col min-w-0">
                    <span className="rtt-node-kind">{copy.label}</span>
                    <span
                      className="text-sm font-bold"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {option.title}
                    </span>
                  </span>
                </span>

                {/* What this KIND of node is for — static, identical every run. */}
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {copy.purpose}
                </span>

                {/* What this PARTICULAR node is, in the generator's own words. */}
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {option.summary}
                </span>

                {/* What actually happens if you take it. */}
                <span className="rtt-node-consequence">{copy.consequence}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
