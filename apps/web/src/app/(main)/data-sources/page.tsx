/*
  ============================================================================
  LEGAL REVIEW REQUIRED BEFORE PUBLIC LAUNCH.

  This page is a BETA DRAFT written by engineering. It describes data
  provenance as implemented: Basketball Reference, scraped offline into a
  committed cache, never during a web request. It deliberately makes NO claim
  of any licence, permission, or partnership with Basketball Reference or any
  other provider — that posture is unverified and is a question for counsel.
  ============================================================================
*/
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Data Sources",
};

const COMPONENTS: readonly { label: string; weight: string; token: string }[] = [
  { label: "Statistical Impact", weight: "0.38", token: "--comp-si" },
  { label: "Traditional Production", weight: "0.21", token: "--comp-tp" },
  { label: "Individual Recognition", weight: "0.20", token: "--comp-rec" },
  { label: "Playoff Rate Impact", weight: "0.18", token: "--comp-po" },
  { label: "Team Result", weight: "0.03", token: "--comp-team" },
];

export default function DataSourcesPage() {
  return (
    <div className="min-h-screen px-4 py-12">
      <div className="mx-auto max-w-2xl space-y-10">
        <div>
          <h1 className="font-display text-3xl font-bold">Data Sources</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Where the numbers come from, and what is done to them.
          </p>
        </div>

        <div className="rounded-lg border border-[var(--peak-accent-dim)] bg-[var(--peak-accent-bg)] px-4 py-3 text-sm text-[var(--text-secondary)]">
          <strong className="text-[var(--peak-accent)]">Beta draft — pending legal review.</strong>{" "}
          This page was written by the engineering team from the code and has not been reviewed
          by a lawyer. It will change before a public launch.
        </div>

        <Section title="One source">
          <p>
            Every statistic behind a PEAK3 rating comes from{" "}
            <strong className="text-[var(--text-primary)]">Basketball Reference</strong>. There
            is no second statistical provider, no vendor feed, and no hand-entered season
            totals.
          </p>
        </Section>

        <Section title="Collected offline, never during a request">
          <p>
            Source pages are scraped{" "}
            <strong className="text-[var(--text-primary)]">offline</strong>, into a cache that
            is committed to the repository. The model is then run over that cache to produce
            the ranking files the site reads.
          </p>
          <p className="mt-3">
            Nothing on this site scrapes Basketball Reference while you are using it. Loading a
            page, playing a game, or opening a player never triggers a request to any data
            provider — the answer was computed before the page existed. This is enforced in the
            build, not merely a convention.
          </p>
          <p className="mt-3">
            A small number of optional manual override files sit alongside the scrape, used to
            correct specific values the source does not expose cleanly: season context, external
            impact metrics, and statistical titles. They override named player-seasons only;
            they never invent a player, a season, or a rating.
          </p>
        </Section>

        <Section title="Seasons covered">
          <p>
            The dataset covers{" "}
            <strong className="text-[var(--text-primary)]">1979-80 through 2025-26</strong>.
            Seasons before 1979-80 are excluded because consistent advanced metrics are not
            available for them. Excluding those seasons is an admission about the data, not a
            judgement about the players.
          </p>
        </Section>

        <Section title="What is computed from it">
          <p>
            PEAK3 is a Five-Component Open Weighted Index. It scores a player&apos;s best
            consecutive peak window using published, fixed weights:
          </p>
          <ul className="mt-4 space-y-2">
            {COMPONENTS.map((component) => (
              <li key={component.label} className="flex items-baseline gap-3">
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: `var(${component.token})` }}
                />
                <span className="text-[var(--text-primary)]">{component.label}</span>
                <span className="ml-auto tabular-nums">{component.weight}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4">
            A teammate adjustment of at most ±0.5 accounts for surrounding talent. The weights
            are the same for every player; there are no exceptions, no hand-picked winners, and
            no per-player tuning.
          </p>
          <p className="mt-3">
            PEAK3 rates. It does not claim objective historical truth — a different set of
            weights produces a different ranking, which is exactly why the weights are
            published.
          </p>
        </Section>

        <Section title="Regenerated, not edited">
          <p>
            Rankings are regenerated by running the model over the cached data. They are not
            edited by hand after the fact, and a rating cannot be changed without changing the
            code or the inputs that produced it — both of which are visible in the repository
            and covered by tests.
          </p>
        </Section>

        <Section title="What is not shown">
          <p>
            PEAK3 Arena displays no player photographs and no NBA or team logos; external asset
            URLs are disabled by default. Team names and publicly documented team colours appear
            as text and colour only, to identify a team. Team marks belong to their respective
            owners.
          </p>
        </Section>

        <Section title="Read further">
          <p>
            <Link href="/methodology" className="text-[var(--peak-accent)] underline">
              The methodology →
            </Link>
          </p>
          <p className="mt-2">
            <Link href="/about" className="text-[var(--peak-accent)] underline">
              About PEAK3 Arena →
            </Link>
          </p>
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="font-display text-xl font-bold mb-3">{title}</h2>
      <div className="text-sm text-[var(--text-secondary)] leading-relaxed">{children}</div>
    </section>
  );
}
