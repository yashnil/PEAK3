/*
  ============================================================================
  LEGAL REVIEW REQUIRED BEFORE PUBLIC LAUNCH.

  OPERATOR ACTION REQUIRED: `CONTACT_EMAIL` below is a deliberate placeholder.
  No contact address exists anywhere in this repository, so inventing one would
  have shipped a dead route for privacy and accessibility requests. An operator
  MUST replace it with a real, monitored address before this page is public.
  The placeholder uses the reserved `.invalid` TLD so a message sent to it
  cannot silently reach a stranger.

  This page is otherwise a BETA DRAFT written by engineering and not reviewed
  by a lawyer.
  ============================================================================
*/
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Contact",
};

/**
 * PLACEHOLDER — an operator must set a real monitored address before launch.
 *
 * Kept as a named constant with a single render site so that replacing it is a
 * one-line change, and so a grep for "example.invalid" finds every place the
 * unset address is user-visible.
 */
const CONTACT_EMAIL = "TODO-set-before-launch@example.invalid";

const ADDRESS_IS_PLACEHOLDER = CONTACT_EMAIL.endsWith(".invalid");

export default function ContactPage() {
  return (
    <div className="min-h-screen px-4 py-12">
      <div className="mx-auto max-w-2xl space-y-10">
        <div>
          <h1 className="font-display text-3xl font-bold">Contact</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Bug reports, accessibility problems, and data requests.
          </p>
        </div>

        <div className="rounded-lg border border-[var(--peak-accent-dim)] bg-[var(--peak-accent-bg)] px-4 py-3 text-sm text-[var(--text-secondary)]">
          <strong className="text-[var(--peak-accent)]">Beta draft — pending legal review.</strong>{" "}
          This page was written by the engineering team and has not been reviewed by a lawyer.
          It will change before a public launch.
        </div>

        <Section title="How to reach us">
          {ADDRESS_IS_PLACEHOLDER ? (
            <div className="rounded-lg border border-[var(--border-subtle)] px-4 py-3">
              <p>
                <strong className="text-[var(--text-primary)]">
                  No contact address has been set for this deployment yet.
                </strong>{" "}
                The address below is a placeholder and mail sent to it will not arrive
                anywhere. Whoever operates this instance must replace it with a real,
                monitored address before launch.
              </p>
              <p className="mt-3">
                <code className="text-[var(--text-primary)]">{CONTACT_EMAIL}</code>
              </p>
            </div>
          ) : (
            <p>
              Email{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-[var(--peak-accent)] underline"
              >
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          )}
          <p className="mt-3 text-xs text-[var(--text-muted)]">
            PEAK3 Arena is a beta project run by a small team. There is no guaranteed response
            time.
          </p>
        </Section>

        <Section title="What to include">
          <p>
            A report we can act on almost always contains these four things. Sending them the
            first time saves a round trip:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              <strong className="text-[var(--text-primary)]">Your account handle</strong> — or a
              note that you were playing as a guest, which changes where your data lives.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">What happened</strong> — what you
              were trying to do, what you expected, and what the product did instead. The page
              address and the approximate date and time help a great deal, because most game
              state is keyed by day.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">Your browser</strong> — its name
              and version, whether desktop or mobile, and any assistive technology you were
              using.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">A screenshot</strong>, if the
              problem is visual. Please redact anything you do not want stored.
            </li>
          </ul>
        </Section>

        <Section title="Specific kinds of request">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-[var(--text-primary)]">Data deletion.</strong> There is no
              self-serve account deletion or data export yet, so deletion is handled manually.
              Send your account handle and say clearly that you are requesting deletion. See
              the{" "}
              <Link href="/privacy" className="text-[var(--peak-accent)] underline">
                privacy notice
              </Link>
              .
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">Accessibility.</strong> Reports are
              treated as defects. Background and known gaps are listed on the{" "}
              <Link href="/accessibility" className="text-[var(--peak-accent)] underline">
                accessibility page
              </Link>
              .
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">Security.</strong> If you have
              found a vulnerability, please report it privately and do not exploit it or access
              anyone else&apos;s data while testing.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">The model.</strong> Disagreements
              with a rating are welcome, and best made against the published{" "}
              <Link href="/methodology" className="text-[var(--peak-accent)] underline">
                methodology
              </Link>{" "}
              and{" "}
              <Link href="/data-sources" className="text-[var(--peak-accent)] underline">
                data sources
              </Link>
              .
            </li>
          </ul>
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
