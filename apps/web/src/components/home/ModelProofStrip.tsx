/**
 * The homepage's credibility strip: which model is running, over what data,
 * how much of it, and where the method is written down.
 *
 * EVERY NUMBER HERE IS SOURCED, NOT TYPED. The values come from
 * `/api/v1/meta` (the generated `data/web/metadata.json`) and from the
 * `/api/v1/peaks` response envelope — see `home-data.ts`. A field the API does
 * not send is `null` and its fact is simply not rendered. Nothing is
 * substituted, estimated or rounded up, because a proof strip that guesses is
 * worse than no proof strip.
 *
 * DELIBERATELY OMITTED, with reasons:
 *  - `source_commit`: `metadata.json` records a commit that provably predates
 *    the current methodology (integration plan §1.4.1). W6 owns that fix;
 *    printing a wrong commit hash on the front page would be the exact
 *    opposite of provenance.
 *  - "player-seasons scored" (11,429): a real field, but it lives on
 *    `/api/v1/seasons`, which is a much heavier response than this strip
 *    justifies fetching. Ranked peak windows and evaluated players, both
 *    already on hand, carry the same point.
 *
 * Server component on purpose — this is static text and must not cost the
 * homepage any client JS.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { HomeModelProof } from "./home-data";

interface ProofFact {
  key: string;
  label: string;
  value: string;
  detail?: string;
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/** "2026-07-30T17:47:31Z" → "30 Jul 2026". Returns null if unparseable. */
function formatGeneratedAt(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function buildProofFacts(proof: HomeModelProof): ProofFact[] {
  const facts: ProofFact[] = [];

  const model = proof.modelLabel ?? proof.modelVersion;
  if (model) {
    facts.push({
      key: "model",
      label: "Active model",
      value: model,
      detail: proof.isDefaultModel ? "Default scoring model" : "Preview model",
    });
  }

  if (proof.startSeason && proof.endSeason) {
    facts.push({
      key: "coverage",
      label: "Data through",
      value: proof.endSeason,
      detail: `Every season from ${proof.startSeason}`,
    });
  } else if (proof.endSeason) {
    facts.push({ key: "coverage", label: "Data through", value: proof.endSeason });
  }

  if (proof.rankedWindows !== null) {
    facts.push({
      key: "windows",
      // "Leaderboard rows", NOT "ranked peak windows".
      //
      // `peak_window_count` is `sum(len(v))` over the four committed top-250
      // CSV exports (250 + 249 + 248 + 237 = 984). Calling that "ranked peak
      // windows" read as a count of the whole universe -- and was flatly
      // contradicted by the rankings page, which reports 1,000 rows for the
      // 1-Year board ALONE. One published board cannot be larger than the site's
      // stated total. Both numbers are correct; only this label was wrong.
      label: "Leaderboard rows",
      value: formatCount(proof.rankedWindows),
      detail: "Top 250 at each window length",
    });
  }

  if (proof.playersEvaluated !== null) {
    facts.push({
      key: "players",
      label: "Players evaluated",
      value: formatCount(proof.playersEvaluated),
      detail: "Before any ranking cut-off",
    });
  }

  if (proof.generatedAt) {
    const generated = formatGeneratedAt(proof.generatedAt);
    if (generated) {
      facts.push({ key: "generated", label: "Dataset built", value: generated });
    }
  }

  return facts;
}

export interface ModelProofStripProps {
  proof: HomeModelProof;
  /** Where the method is documented. */
  methodologyHref?: string;
}

export default function ModelProofStrip({
  proof,
  methodologyHref = "/methodology",
}: ModelProofStripProps) {
  const facts = buildProofFacts(proof);

  // Nothing arrived — say nothing. An empty strip is honest; a strip of
  // dashes reads like the model is broken.
  if (facts.length === 0) return null;

  return (
    <section
      className="home-proof px-4 py-8"
      aria-labelledby="model-proof-heading"
      data-testid="home-model-proof"
    >
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2
            id="model-proof-heading"
            className="text-[11px] font-bold uppercase tracking-[0.18em]"
            style={{ color: "var(--text-muted)" }}
          >
            The model behind every game
          </h2>
          <Link
            href={methodologyHref}
            data-testid="home-methodology-link"
            className="arena-inline-link"
            style={{ color: "var(--peak-accent-text)" }}
          >
            Read the methodology
            <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </div>

        <dl className="home-proof-grid mt-4">
          {facts.map((fact) => (
            <div key={fact.key} className="home-proof-item" data-proof-fact={fact.key}>
              <dt
                className="text-[10px] font-bold uppercase tracking-[0.14em]"
                style={{ color: "var(--text-muted)" }}
              >
                {fact.label}
              </dt>
              {/* The detail lives INSIDE the <dd>, not beside it.
                  A <dl> may wrap each pair in a <div>, but that <div> may only
                  contain <dt> and <dd> -- a sibling <p> is invalid, and axe
                  flags it `serious` (`definition-list`), which failed the
                  landing-page accessibility gate. Nesting it also happens to be
                  more correct semantically: the elaboration is part of the
                  value, not a third thing. */}
              <dd className="home-proof-value font-display mt-1 text-lg font-bold">
                {fact.value}
                {fact.detail && (
                  <span
                    className="mt-0.5 block font-sans text-[11px] font-normal"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {fact.detail}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
