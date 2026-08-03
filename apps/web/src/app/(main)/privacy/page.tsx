/*
  ============================================================================
  LEGAL REVIEW REQUIRED BEFORE PUBLIC LAUNCH.

  This page is a BETA DRAFT written by engineering from an audit of the code.
  Every claim below is traceable to implemented behaviour in this repository.
  It deliberately does NOT claim any compliance posture (GDPR, CCPA, COPPA,
  SOC 2 or otherwise), does not name a hosting provider or an email provider,
  and does not describe features that do not exist — notably account deletion
  and data export, which are stated here as ABSENT because they are.
  ============================================================================
*/
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen px-4 py-12">
      <div className="mx-auto max-w-2xl space-y-10">
        <div>
          <h1 className="font-display text-3xl font-bold">Privacy</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            What PEAK3 Arena stores, why, and what it deliberately never collects.
          </p>
        </div>

        <div className="rounded-lg border border-[var(--peak-accent-dim)] bg-[var(--peak-accent-bg)] px-4 py-3 text-sm text-[var(--text-secondary)]">
          <strong className="text-[var(--peak-accent-text)]">Beta draft — pending legal review.</strong>{" "}
          This notice was written by the engineering team from an audit of the code, so it
          describes what the software actually does today. It has not yet been reviewed by a
          lawyer and will change before a public launch.
        </div>

        <Section title="The short version">
          <ul className="list-disc space-y-1 pl-5">
            <li>There are zero third-party analytics or advertising trackers on this site.</li>
            <li>PEAK3 does not sell personal data. There is no one to sell it to.</li>
            <li>Product telemetry is off by default and cannot be linked back to your account.</li>
            <li>
              Most of what is stored is your game data — boards, runs, results, streaks — so
              your progress survives a refresh.
            </li>
            <li>
              There is currently no self-serve account deletion or data export. Deletion is a
              manual request; see below.
            </li>
          </ul>
        </Section>

        <Section title="Signing in">
          <p>
            Accounts are optional. The implemented sign-in methods are Google OAuth (using
            PKCE), an emailed magic link, and email with a password, plus password reset by
            email. Sign in with Apple is not implemented. Google OAuth exists in the code but
            may not be switched on for a given deployment.
          </p>
          <p className="mt-3">
            Anonymous Supabase sign-ins are disabled. Instead, guest play is identified by a
            first-party cookie named <code>peak3_anon</code>: it is HttpOnly, SameSite=Lax,
            cryptographically signed, and expires after 30 days. It exists so a guest can
            finish a run, reload the page, and still own their games. Clearing it ends that
            identity.
          </p>
        </Section>

        <Section title="What is stored on an account">
          <p>When you have an account, the service stores:</p>
          <ul className="mt-3 list-disc space-y-1 pl-5">
            <li>
              <strong className="text-[var(--text-primary)]">Profile</strong> — handle,
              display name, bio, region, avatar key, and your public-profile and
              history-visibility flags.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">Settings</strong> — timezone and
              reduced-motion preference.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">Game state and results</strong> —
              for Peak Draft, 82-0 Peak Season, Daily Grid, Peak Duel and Run the Table.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">Daily completions</strong> — which
              day&apos;s board you have finished, so a daily game stays once a day.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">Challenges</strong> — the links you
              create to send a board or run to someone else.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">Progression</strong> — XP, level,
              streaks, achievements and personal records.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">Ranked records</strong> — your
              results in ranked modes.
            </li>
          </ul>
          <p className="mt-3">
            All of it exists for one reason: so the game can show you your own progress and
            keep daily modes honest. Guest play stores the same game data against the
            <code> peak3_anon</code> identity rather than an account.
          </p>
        </Section>

        <Section title="Product telemetry">
          <p>
            Telemetry is{" "}
            <strong className="text-[var(--text-primary)]">off by default</strong>. When an
            operator enables it, it is deliberately built so that it cannot become a user
            profile:
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5">
            <li>
              A closed allowlist of 21 gameplay event names. An event that is not on the list
              is dropped.
            </li>
            <li>
              A closed allowlist of property keys. Values are capped at 64 characters and may
              not contain spaces, so free text cannot be represented at all.
            </li>
            <li>
              The subject is stored{" "}
              <strong className="text-[var(--text-primary)]">only as an HMAC digest</strong>,
              and by design it cannot be joined back to your account or your game data.
            </li>
            <li>Events are retained for 90 days.</li>
            <li>
              It never collects email addresses, tokens, IP addresses, user agents, board
              answers, or player selections.
            </li>
            <li>
              It honours the Global Privacy Control signal, the Do Not Track header, and a{" "}
              <code>peak3:telemetry</code> opt-out value in your browser&apos;s local storage.
            </li>
          </ul>
          <p className="mt-3 rounded-lg border border-[var(--border-subtle)] px-4 py-3">
            <strong className="text-[var(--text-primary)]">Known gap, stated plainly:</strong>{" "}
            there is currently no opt-out button anywhere in the product. The opt-out exists
            and is honoured, but it has no user interface control yet — today it can only be
            set manually in local storage, or expressed through Global Privacy Control or Do
            Not Track. A visible control is owed.
          </p>
        </Section>

        <Section title="No third-party analytics">
          <p>
            There are zero third-party analytics or advertising SDKs in this application. No
            Google Analytics, no PostHog, no Plausible, no Segment, no Sentry, no Vercel
            Analytics. PEAK3 does not sell personal data, and it does not share it with ad
            networks — there are none integrated.
          </p>
        </Section>

        <Section title="Cookies and browser storage">
          <p>Cookies:</p>
          <ul className="mt-3 list-disc space-y-1 pl-5">
            <li>
              <code>peak3_anon</code> — first-party, HttpOnly, SameSite=Lax, signed. Identifies
              a guest&apos;s games for 30 days.
            </li>
            <li>
              Supabase session cookies — set when you are signed in, so the session persists
              across page loads.
            </li>
          </ul>
          <p className="mt-4">
            Local storage keys, all first-party and all readable and clearable by you in your
            browser&apos;s developer tools:
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5">
            <li>
              <code>peak3_arena_progress</code> — Peak Duel progress and local scores.
            </li>
            <li>
              <code>peak3_draft_progress_v1</code> — Peak Draft progress.
            </li>
            <li>
              <code>peak3.daily-grid.archive</code> — your Daily Grid archive and streak.
            </li>
            <li>
              <code>peak3.daily-grid.rules-seen</code> — legacy key recording whether you had
              seen the Daily Grid rules. It is now only read, never written; the walkthrough
              state lives in <code>peak3.tour.state</code>.
            </li>
            <li>
              <code>peak3.daily-grid.&#123;boardId&#125;</code> — your in-progress board for a
              given day.
            </li>
            <li>
              <code>peak3.run-the-table.active</code> — your in-progress Run the Table run.
            </li>
            <li>
              <code>peak3.tour.state</code> — which guided tours you have already seen.
            </li>
            <li>
              <code>peak3_ranked_match_&#123;mode&#125;</code> — your active ranked match for a
              mode.
            </li>
            <li>
              <code>peak3:telemetry</code> — your telemetry opt-out, if you have set one.
            </li>
          </ul>
          <p className="mt-3 text-xs text-[var(--text-muted)]">
            Clearing site data removes all of the above, including the guest identity, which
            means guest game history stored against it is no longer reachable from that
            browser.
          </p>
        </Section>

        <Section title="Third parties">
          <p>
            <strong className="text-[var(--text-primary)]">Supabase</strong> provides
            authentication and the PostgreSQL database, and delivers magic-link and password
            reset emails. Account data and game data described above are stored there.
          </p>
          <p className="mt-3">
            Web fonts are self-hosted: Google Fonts are downloaded at build time by Next.js
            and served from this site, so loading a page does not call out to a font CDN.
          </p>
        </Section>

        <Section title="Retention, and how to request deletion">
          <p>
            Account and game data are kept for as long as the account exists. Telemetry
            events, when telemetry is enabled at all, are kept for 90 days.
          </p>
          <p className="mt-3 rounded-lg border border-[var(--border-subtle)] px-4 py-3">
            <strong className="text-[var(--text-primary)]">
              There is currently no account deletion endpoint and no data export endpoint.
            </strong>{" "}
            Neither feature exists in the product yet. Until they do, deletion is a manual
            request: contact us through the{" "}
            <Link href="/contact" className="text-[var(--peak-accent-text)] underline">
              contact page
            </Link>{" "}
            with your account handle, and the request will be carried out by hand.
          </p>
          <p className="mt-3">
            Guest data is a partial exception: clearing the <code>peak3_anon</code> cookie and
            your local storage detaches your browser from that guest identity immediately,
            though rows already written to the database remain until they are deleted by
            request.
          </p>
        </Section>

        <Section title="Changes to this notice">
          <p>
            This notice will be revised as the product changes and again after legal review.
            The version published here is the current one. Related reading:{" "}
            <Link href="/terms" className="text-[var(--peak-accent-text)] underline">
              Terms of Use
            </Link>{" "}
            and{" "}
            <Link href="/data-sources" className="text-[var(--peak-accent-text)] underline">
              Data Sources
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
