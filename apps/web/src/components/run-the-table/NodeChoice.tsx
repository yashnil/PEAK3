"use client";
import { StageOption } from "@/types/run-the-table";
import { NODE_TYPE_BLURBS, NODE_TYPE_LABELS } from "@/lib/run-the-table-state";

/**
 * The branch: two nodes, one stage. Both are plain `<button>`s so the whole
 * choice is keyboard-operable with nothing but Tab and Enter.
 *
 * `title` and `summary` are the generator's own text for this seed — the
 * client adds only the node-type label and a static blurb of what that node
 * type does, never anything about what is inside it.
 */
interface Props {
  options: StageOption[];
  act: number;
  stage: number;
  stagesPerAct: number;
  busy: boolean;
  onChoose: (option: StageOption) => void;
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
          You take one. The other closes for this run.
        </p>
      </header>

      {/* Container query, not `sm:` — see `.rtt-decision-surface`. */}
      <ul className="grid gap-2.5 @[440px]:grid-cols-2">
        {options.map((option) => (
          <li key={option.node_id} className="min-w-0">
            <button
              type="button"
              data-testid={`rtt-node-option-${option.node_id}`}
              onClick={() => onChoose(option)}
              disabled={busy}
              className="rtt-choice-btn h-full w-full text-left disabled:opacity-60"
            >
              <span
                className="text-[9px] font-semibold uppercase tracking-widest"
                style={{ color: "var(--text-muted)" }}
              >
                {NODE_TYPE_LABELS[option.node_type]}
              </span>
              <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                {option.title}
              </span>
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {option.summary}
              </span>
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                {NODE_TYPE_BLURBS[option.node_type]}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
