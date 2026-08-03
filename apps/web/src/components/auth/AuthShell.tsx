/**
 * The card every auth surface sits in.
 *
 * `/auth/*` renders outside the `(main)` route group, so these pages have no
 * global header and no footer — deliberate isolation for a screen that exists
 * for a few hundred milliseconds. That means the shell has to carry the
 * wordmark itself, otherwise a user who lands on the error page has no way back
 * and no evidence of what site they are on.
 *
 * No photographs, no logos: house rule, and there is nothing to illustrate here
 * anyway.
 *
 * Owner: Track B (auth surface).
 */

import type { ReactNode } from "react";

export interface AuthShellProps {
  title: string;
  /** One line under the title. Sentence case, no period unless multi-sentence. */
  subtitle?: ReactNode;
  children: ReactNode;
  /** Rendered under the card, muted — secondary links and reassurance. */
  footer?: ReactNode;
  testId?: string;
}

export function AuthShell({ title, subtitle, children, footer, testId }: AuthShellProps) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-4" data-testid={testId}>
        <div className="card-elevated w-full p-8 space-y-6">
          <div className="text-center">
            <p
              className="text-xs font-semibold tracking-[0.2em] uppercase"
              style={{ color: "var(--text-muted)" }}
            >
              <span style={{ color: "var(--peak-accent-text)" }}>PEAK</span>3 Arena
            </p>
            <h1 className="mt-2 text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
                {subtitle}
              </p>
            )}
          </div>
          {children}
        </div>
        {footer && (
          <div className="text-center text-xs" style={{ color: "var(--text-muted)" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export default AuthShell;
