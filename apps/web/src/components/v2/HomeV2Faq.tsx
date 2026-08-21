"use client";

/**
 * HomeV2Faq — "Questions, answered plainly," made secondary (Pass 6,
 * product-direction consistency pass). The heading and copy are unchanged
 * from Pass 5's `HomePageV2`; only the presentation changed, from five
 * permanently-open paragraphs to a collapsed accordion — the same
 * disclosure grammar `ComponentComparison`'s methodology rows already use
 * on this same page, so a visitor who opened one already knows how this
 * one works. Nothing opens by default: the brief is explicit that five
 * open paragraphs must not compete with play for the eye.
 */

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

const QA: { q: string; a: string }[] = [
  {
    q: "What is a PEAK3 peak?",
    a: "A contiguous window of seasons — one, two, three or five years — scored as a single unit against every other window since 1979-80. It measures how good a player was at their best, not how long they lasted.",
  },
  {
    q: "Windows, or careers?",
    a: "Windows. A player's greatest stretch can be three seasons or one — PEAK3 never averages a peak down across years that were not part of it.",
  },
  {
    q: "How does PEAK3 rate a player?",
    a: "Five open components — statistical impact, traditional production, individual recognition, playoff rate impact and team result — combined at fixed, published weights. Every game in the Arena is settled on those same five lanes.",
  },
  {
    q: "Does PEAK3 simulate games?",
    a: "No. It rates real, already-played peak windows on real box-score and award data. Nothing here predicts a game that has not happened.",
  },
  {
    q: "Can I compete with other people?",
    a: "Three-Man Weave and The $20 Showdown are live, seat-based games against real opponents. Every other mode is single-player against the model itself, with a leaderboard behind it.",
  },
];

export default function HomeV2Faq() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section aria-labelledby="v2-faq-heading">
      <h2 id="v2-faq-heading" className="v2-faq-heading">
        Questions, answered plainly.
      </h2>
      <div className="mt-5 flex flex-col">
        {QA.map((item, i) => {
          const open = openIndex === i;
          const panelId = `v2-faq-panel-${i}`;
          return (
            <div key={item.q} className="v2-faq-row">
              <button
                type="button"
                className="v2-faq-question"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpenIndex((cur) => (cur === i ? null : i))}
              >
                <span>{item.q}</span>
                <ChevronDown size={16} aria-hidden="true" className="v2-faq-chevron" data-open={open ? "true" : undefined} />
              </button>
              {open ? (
                <p id={panelId} className="v2-faq-answer">
                  {item.a}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="mt-4">
        <Link href="/methodology" className="v2-hero-object-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
          Read the full methodology →
        </Link>
      </p>
    </section>
  );
}
