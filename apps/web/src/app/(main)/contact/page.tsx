import type { Metadata } from "next";
import Link from "next/link";
import ContactForm from "@/components/contact/ContactForm";

export const metadata: Metadata = {
  title: "Contact",
};

/**
 * launch-polish IMPLEMENTATION_CONTRACT.md §9. Replaces the static
 * `mailto:` to a deliberate `.invalid` placeholder that used to be the
 * entire contents of this page -- there was no contact/feedback route or
 * storage anywhere in this codebase before this pass.
 *
 * HONEST COPY ONLY, still. This page never claims a delivery service or a
 * response-time commitment (there is neither) -- see ContactForm's own
 * confirmation state for the exact line that must not be strengthened.
 */
export default function ContactPage() {
  return (
    <div className="min-h-screen px-4 py-12">
      <div className="mx-auto max-w-2xl space-y-10">
        <div>
          <h1 className="font-display text-3xl font-bold">Contact</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Bug reports, accessibility problems, data requests, and everything else.
          </p>
        </div>

        <div className="rounded-lg border border-[var(--peak-accent-dim)] bg-[var(--peak-accent-bg)] px-4 py-3 text-sm text-[var(--text-secondary)]">
          <strong className="text-[var(--peak-accent-text)]">Beta draft — pending legal review.</strong>{" "}
          This page was written by the engineering team and has not been reviewed by a lawyer.
          It will change before a public launch.
        </div>

        <Section title="Send a message">
          <ContactForm />
          <p className="mt-3 text-xs text-[var(--text-muted)]">
            PEAK3 Arena is a beta project run by a small team. There is no guaranteed response
            time and no automated confirmation email.
          </p>
        </Section>

        <Section title="What to include">
          <p>
            A report we can act on almost always contains these details. Adding them the first
            time saves a round trip:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
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
              Sign in before sending your message (so it carries your account association) and
              say clearly that you are requesting deletion. See the{" "}
              <Link href="/privacy" className="text-[var(--peak-accent-text)] underline">
                privacy notice
              </Link>
              .
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">Accessibility.</strong> Reports are
              treated as defects. Background and known gaps are listed on the{" "}
              <Link href="/accessibility" className="text-[var(--peak-accent-text)] underline">
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
              <Link href="/methodology" className="text-[var(--peak-accent-text)] underline">
                methodology
              </Link>{" "}
              and{" "}
              <Link href="/data-sources" className="text-[var(--peak-accent-text)] underline">
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
