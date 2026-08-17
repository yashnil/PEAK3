"use client";

/**
 * PeakV2RTTNodeChoice — the V2 "branching path" decision: two node-type
 * options, one stage (Pass 3). Ports `NodeChoice.tsx`'s exact node-
 * differentiation contract — icon, accent, purpose, the generator's own
 * summary (unless `shouldSuppressServerSummary`), and consequence — into
 * V2's hairline-and-typography grammar instead of legacy's bordered card.
 *
 * `title` and `summary` are the generator's own text for this seed; the
 * client adds only the node-type identity (icon, accent, purpose,
 * consequence), same division of labor as `NodeChoice.tsx`.
 *
 * This is the one RTT decision screen genuinely ABOUT two different futures
 * — "You take one. The other closes for this run." (`RTT_COPY.branch`) — so
 * unlike every other V2 surface here the two options are allowed to look
 * different from each other. Each carries its own node-type accent
 * (`nodeTypeCopy(...).accentVar`, an existing frozen token, never a new
 * color) as a top hairline plus a small outlined icon glyph drawn from the
 * exact same `NODE_ICON_PATHS` stroke data `NodeChoice.tsx` uses, restyled
 * at V2 scale. Neither option gets a filled, bordered "card" treatment —
 * the whole block is a large tappable region, divided from its sibling and
 * from the rest of the page by rules and spacing, not a box.
 *
 * DOM ORDER kept identical to `NodeChoice.tsx` on purpose: the header
 * carries no buttons, and the option list is the first interactive content,
 * so `[data-testid="rtt-node-choice"] button` keeps meaning "the first
 * stage option" if this surface is ever wired in behind `?ui=v2`.
 */

import type { NodeType, StageOption } from "@/types/run-the-table";
import {
  NODE_ICON_PATHS,
  RTT_COPY,
  nodeTypeCopy,
  shouldSuppressServerSummary,
} from "@/lib/run-the-table-copy";
import PeakV2LiveHeader from "../PeakV2LiveHeader";

interface Props {
  options: StageOption[];
  act: number;
  stage: number;
  stagesPerAct: number;
  busy: boolean;
  onChoose: (option: StageOption) => void;
}

/**
 * The node-type glyph at V2 typographic scale.
 *
 * Draws the identical `NODE_ICON_PATHS` stroke data `NodeChoice.tsx`'s
 * `NodeTypeIcon` renders, but sized and colored inline rather than reusing
 * legacy's `.rtt-node-icon` CSS (built for legacy's larger card scale) —
 * `currentColor` tinted directly by the option's own `accentVar`, purely
 * decorative (the kind label beside it is the accessible name).
 */
function NodeTypeGlyph({ type }: { type: NodeType }) {
  const copy = nodeTypeCopy(type);
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={15}
      height={15}
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0, color: copy.accentVar }}
    >
      <path d={NODE_ICON_PATHS[copy.icon]} />
    </svg>
  );
}

export default function PeakV2RTTNodeChoice({
  options,
  act,
  stage,
  stagesPerAct,
  busy,
  onChoose,
}: Props) {
  return (
    <div data-testid="rtt-node-choice">
      <PeakV2LiveHeader
        as="h1"
        title="Where does the front office spend this window?"
        subtitle={RTT_COPY.branch}
        status={
          <span
            style={{
              fontFamily: "var(--v2-font-mono)",
              fontSize: "0.6875rem",
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--v2-text-muted)",
            }}
          >
            Act {act} · Stage {stage} of {stagesPerAct}
          </span>
        }
      />

      <ul className="grid grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-2">
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
                className="flex h-full w-full flex-col gap-2.5 pt-3 text-left transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--v2-bg-page)] disabled:cursor-not-allowed disabled:opacity-55"
                style={{ borderTop: `2px solid ${copy.accentVar}` }}
              >
                <span className="flex items-center gap-2">
                  <NodeTypeGlyph type={option.node_type} />
                  <span
                    style={{
                      fontFamily: "var(--v2-font-mono)",
                      fontSize: "0.6875rem",
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: copy.accentTextVar,
                    }}
                  >
                    {copy.label}
                  </span>
                </span>

                <span
                  style={{
                    fontFamily: "var(--v2-font-ui)",
                    fontWeight: 700,
                    fontSize: "0.9375rem",
                    color: "var(--v2-text-primary)",
                  }}
                >
                  {option.title}
                </span>

                {/* What this KIND of node is for — static, identical every run. */}
                <span
                  style={{
                    fontFamily: "var(--v2-font-ui)",
                    fontSize: "0.8125rem",
                    color: "var(--v2-text-secondary)",
                  }}
                >
                  {copy.purpose}
                </span>

                {/* What this PARTICULAR node is, in the generator's own words —
                    suppressed only where `shouldSuppressServerSummary` says the
                    generated line advertises a mechanic that does not exist. */}
                {!shouldSuppressServerSummary(option.node_type) && (
                  <span
                    style={{
                      fontFamily: "var(--v2-font-ui)",
                      fontSize: "0.8125rem",
                      color: "var(--v2-text-secondary)",
                    }}
                  >
                    {option.summary}
                  </span>
                )}

                {/* What actually happens if you take it. */}
                <span
                  className="mt-auto pt-1"
                  style={{
                    fontFamily: "var(--v2-font-ui)",
                    fontSize: "0.75rem",
                    color: "var(--v2-text-muted)",
                  }}
                >
                  {copy.consequence}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
