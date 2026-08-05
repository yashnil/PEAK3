/*
  ============================================================================
  LEGAL REVIEW REQUIRED BEFORE PUBLIC LAUNCH.

  This page is a BETA DRAFT written by engineering. Every commitment listed
  here is backed by code that exists in this repository (the skip link in
  app/layout.tsx, the focus-trap / Escape / reduced-motion hooks in
  lib/a11y.ts, the LiveRegion component, and the axe-based Playwright suite at
  src/tests/e2e/accessibility.spec.ts). It deliberately makes NO claim of WCAG
  conformance and no claim of any third-party audit, because neither has
  happened. The "known gaps" section must stay honest.
  ============================================================================
*/
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Accessibility",
};

export default function AccessibilityPage() {
  return (
    <div className="min-h-screen px-4 py-12">
      <div className="mx-auto max-w-2xl space-y-10">
        <div>
          <h1 className="font-display text-3xl font-bold">Accessibility</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            What is built, what is tested, and what is still missing.
          </p>
        </div>

        <div className="rounded-lg border border-[var(--peak-accent-dim)] bg-[var(--peak-accent-bg)] px-4 py-3 text-sm text-[var(--text-secondary)]">
          <strong className="text-[var(--peak-accent-text)]">Beta draft — pending legal review.</strong>{" "}
          This statement was written by the engineering team from the code. It has not been
          through legal review or an independent accessibility audit, and it will change
          before a public launch.
        </div>

        <Section title="Our commitment">
          <p>
            PEAK3 Arena should be playable without a mouse and without animation. That is
            treated as a build requirement rather than a nice-to-have: the behaviours below
            are implemented in shared code and exercised by an automated test suite, so a
            redesign that loses them fails the build rather than shipping quietly.
          </p>
          <p className="mt-3">
            We do not claim conformance to a specific WCAG level, and no independent audit
            has been carried out. Saying otherwise would be a guess.
          </p>
        </Section>

        <Section title="What is implemented">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-[var(--text-primary)]">Skip link.</strong> A
              &ldquo;skip to content&rdquo; link is the first focusable element on every page
              and jumps to the <code>#main-content</code> landmark.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">Keyboard-navigable game
              boards.</strong> Game boards are operable from the keyboard — every interactive
              cell and control is reachable and activatable without a pointer.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">Dialog behaviour.</strong> Modal
              dialogs trap focus, close on Escape, lock background scrolling, and restore
              focus to the control that opened them. This lives in one shared module
              (<code>lib/a11y.ts</code>) so every dialog inherits it.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">Reduced motion.</strong> The
              <code> prefers-reduced-motion</code> setting is respected in both CSS and
              component code; animated reveals and counters fall back to their end state.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">Live status regions.</strong>{" "}
              Score changes, turn results and other asynchronous updates are announced through{" "}
              <code>aria-live</code> regions rather than only visually.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">Semantic landmarks.</strong>{" "}
              Navigation, main content and footer are real landmarks with accessible names, so
              screen-reader users can jump between them.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">Automated testing.</strong> An
              axe-based accessibility suite runs against real pages in a browser
              (<code>src/tests/e2e/accessibility.spec.ts</code>) as part of the test run.
            </li>
          </ul>
        </Section>

        <Section title="Known gaps">
          <p>
            Automated checks catch a minority of real accessibility problems, so this list is
            certainly incomplete. What we know about today:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              <strong className="text-[var(--text-primary)]">Daily Grid board navigation.</strong>{" "}
              The grid is reachable in Tab order only. It does not implement arrow-key movement
              with a roving tabindex, which is what a grid of that shape should offer, so
              crossing the board takes more keystrokes than it should.
            </li>
            <li>
              No independent accessibility audit and no assistive-technology test matrix has
              been carried out yet.
            </li>
          </ul>
        </Section>

        <Section title="Report a problem">
          <p>
            If something is unusable for you, that is a bug and we want the report. Tell us
            what you were trying to do, what happened, the page you were on, and the browser
            and assistive technology you were using, through the{" "}
            <Link href="/contact" className="text-[var(--peak-accent-text)] underline">
              contact page
            </Link>
            . Accessibility reports are treated as defects, not feature requests.
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
