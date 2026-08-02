/*
  ============================================================================
  LEGAL REVIEW REQUIRED BEFORE PUBLIC LAUNCH.

  This page is a BETA DRAFT written by engineering from what the code actually
  does. It has not been reviewed by a lawyer. Every factual statement below
  traces to implemented behaviour in this repository; nothing here asserts a
  compliance posture (GDPR, CCPA, COPPA, SOC 2 or any other), a hosting
  arrangement, or a licence from any data provider.
  ============================================================================
*/
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Use",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen px-4 py-12">
      <div className="mx-auto max-w-2xl space-y-10">
        <div>
          <h1 className="font-display text-3xl font-bold">Terms of Use</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            The rules for using PEAK3 Arena.
          </p>
        </div>

        <div className="rounded-lg border border-[var(--peak-accent-dim)] bg-[var(--peak-accent-bg)] px-4 py-3 text-sm text-[var(--text-secondary)]">
          <strong className="text-[var(--peak-accent)]">Beta draft — pending legal review.</strong>{" "}
          This document was written by the engineering team to describe how PEAK3 Arena
          actually behaves today. It has not yet been reviewed by a lawyer and will change
          before a public launch.
        </div>

        <Section title="1. PEAK3 Arena is beta software">
          <p>
            PEAK3 Arena is an in-development project. Features, game rules, scoring, saved
            progress and account data may change, break, or be removed without notice.
            Availability is not guaranteed: the service may be offline, reset, or
            discontinued at any time, and a run in progress may be lost.
          </p>
        </Section>

        <Section title="2. What this product is">
          <p>
            PEAK3 Arena is a basketball analytics and entertainment product. It rates
            historical NBA peak windows using a published, open-weight formula and turns
            those ratings into games. It is{" "}
            <strong className="text-[var(--text-primary)]">not</strong> betting advice, not
            a prediction service, and not a statement of objective historical truth. Nothing
            on this site should be used to inform a wager or any other financial decision.
          </p>
          <p className="mt-3">
            PEAK3 is an independent project. It is not affiliated with or endorsed by the
            NBA or its teams.
          </p>
        </Section>

        <Section title="3. Minimum age">
          <p>
            You must be at least 13 years old to use PEAK3 Arena or to create an account. If
            you are under 13, please do not use the service or submit any information to it.
            This is a limit we have chosen for the product; it is not a statement about any
            particular law.
          </p>
        </Section>

        <Section title="4. Accounts and guest play">
          <p>
            You can play as a guest without an account. Guest play is identified by a signed
            cookie stored in your browser, so clearing site data ends that identity and the
            games attached to it. Accounts are optional and exist so your progress survives
            a cleared browser or a second device.
          </p>
          <p className="mt-3">
            You are responsible for what happens under your account, including keeping your
            sign-in method secure. Handles and profile text you make public are visible to
            anyone.
          </p>
        </Section>

        <Section title="5. Acceptable use">
          <p>You agree not to:</p>
          <ul className="mt-3 list-disc space-y-1 pl-5">
            <li>
              scrape, crawl, or bulk-download this site or its API by automated means, or
              re-publish its data as a competing dataset;
            </li>
            <li>
              cheat — automate gameplay, script answers, forge results, use multiple
              identities to farm rankings, or otherwise submit scores you did not play;
            </li>
            <li>
              attack the service — probe for vulnerabilities in order to exploit them,
              overload it, attempt to reach another user&apos;s games or account data, or
              interfere with anyone else&apos;s use of it;
            </li>
            <li>
              use an abusive handle, display name, or profile text — including content that
              is hateful, harassing, sexual, or that impersonates another person or
              organisation.
            </li>
          </ul>
          <p className="mt-3">
            We may remove content, reset scores, or end access for any account or guest
            session that does these things.
          </p>
          <p className="mt-3">
            If you have found a security problem, please report it rather than exploit it —
            see{" "}
            <Link href="/contact" className="text-[var(--peak-accent)] underline">
              Contact
            </Link>
            .
          </p>
        </Section>

        <Section title="6. Data and intellectual property">
          <p>
            Statistics are derived from publicly published Basketball Reference data,
            processed offline. Team names and marks belong to their respective owners and
            appear here only to identify teams. PEAK3 Arena displays no player photographs
            and no NBA or team logos. See{" "}
            <Link href="/data-sources" className="text-[var(--peak-accent)] underline">
              Data Sources
            </Link>{" "}
            for how the dataset is built.
          </p>
        </Section>

        <Section title="7. No warranty">
          <p>
            PEAK3 Arena is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;,
            without warranties of any kind, express or implied. We do not warrant that the
            service will be uninterrupted, error-free, or secure, that saved progress will
            be preserved, or that any rating, ranking, or result is accurate, complete, or
            fit for any purpose.
          </p>
          <p className="mt-3">
            To the fullest extent permitted by applicable law, we are not liable for any
            loss arising from your use of the service, including lost progress, lost scores,
            or lost account data.
          </p>
        </Section>

        <Section title="8. Changes to these terms">
          <p>
            These terms will change as the product changes, and they will change again once
            they have been through legal review. The version published on this page is the
            one in effect. Continuing to use PEAK3 Arena after a change means you accept the
            updated terms; if you do not, stop using the service.
          </p>
        </Section>

        <Section title="9. Questions">
          <p>
            Questions about these terms, or a request to delete your data, go through the{" "}
            <Link href="/contact" className="text-[var(--peak-accent)] underline">
              contact page
            </Link>
            . See also the{" "}
            <Link href="/privacy" className="text-[var(--peak-accent)] underline">
              privacy notice
            </Link>
            .
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
