/**
 * The auth surfaces, as things a person interacts with.
 *
 * WHAT IS PINNED, AND WHY EACH ONE:
 *   - Google and magic link are both offered. Neither existed anywhere in this
 *     codebase before this pass; a regression that quietly drops one would leave
 *     a working sign-in page and an unreachable provider.
 *   - The Google button surfaces its error. The development project reports
 *     `external: ["email"]`, so today this button *does* fail — and a dead
 *     button with no message is the worst way to ship a configuration gap.
 *   - The return path survives sign-in. `/signin?returnTo=…` is the existing
 *     convention and eight call sites build it; losing it drops a player who
 *     signed in from a result screen back onto the homepage.
 *   - Sign-out is reachable from the header. It used to require navigating to
 *     `/profile` first.
 *   - No auth wall. Every guest-facing assertion here is really one assertion:
 *     nothing blocks play.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const signInWithGoogle = vi.fn();
const sendMagicLink = vi.fn();
const signInWithEmail = vi.fn();
const signUpWithEmail = vi.fn();
const push = vi.fn();

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    supabaseConfigured: true,
    signInWithGoogle: (...args: unknown[]) => signInWithGoogle(...args),
    sendMagicLink: (...args: unknown[]) => sendMagicLink(...args),
    signInWithEmail: (...args: unknown[]) => signInWithEmail(...args),
    signUpWithEmail: (...args: unknown[]) => signUpWithEmail(...args),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const authState = {
  user: null as null | { id: string; email?: string; isAnonymous: boolean; name?: string },
  loading: false,
  supabaseEnabled: true,
  signOut: vi.fn(),
};

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => authState,
}));

import { AccountMenu } from "@/components/auth/AccountMenu";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { InitialsAvatar, initialsFor } from "@/components/auth/InitialsAvatar";
import { MagicLinkForm } from "@/components/auth/MagicLinkForm";
import { SignInPanel } from "@/components/auth/SignInPanel";

beforeEach(() => {
  vi.clearAllMocks();
  signInWithGoogle.mockResolvedValue({ error: null });
  sendMagicLink.mockResolvedValue({ error: null });
  signInWithEmail.mockResolvedValue({ error: null });
  signUpWithEmail.mockResolvedValue({ error: null });
  authState.user = null;
  authState.supabaseEnabled = true;
  authState.signOut = vi.fn().mockResolvedValue(undefined);
});

/* ================================================================== */
/* Google OAuth                                                        */
/* ================================================================== */

describe("Google sign-in", () => {
  it("starts the OAuth flow with the destination the caller asked for", async () => {
    const user = userEvent.setup();
    render(<GoogleSignInButton next="/arena/ranked/apex_1y" />);
    await user.click(screen.getByTestId("google-signin"));
    expect(signInWithGoogle).toHaveBeenCalledWith("/arena/ranked/apex_1y");
  });

  it("shows the provider's refusal rather than doing nothing", async () => {
    // This is today's real behaviour: Google is not enabled on the project.
    signInWithGoogle.mockResolvedValue({ error: "Unsupported provider: provider is not enabled" });
    const user = userEvent.setup();
    render(<SignInPanel mode="signin" next="/" />);
    await user.click(screen.getByTestId("google-signin"));

    const alert = await screen.findByTestId("google-signin-error");
    expect(alert).toHaveTextContent(/provider is not enabled/i);
    expect(alert).toHaveAttribute("role", "alert");
  });

  it("re-enables itself after a failure so the user can retry", async () => {
    signInWithGoogle.mockResolvedValue({ error: "temporary failure" });
    const user = userEvent.setup();
    render(<GoogleSignInButton next="/" />);
    const button = screen.getByTestId("google-signin");
    await user.click(button);
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it("carries no Google trademark image — house rule, and no third-party request", () => {
    const { container } = render(<GoogleSignInButton next="/" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });
});

/* ================================================================== */
/* Magic link                                                          */
/* ================================================================== */

describe("Magic link", () => {
  it("sends a link to the address typed, for the destination requested", async () => {
    const user = userEvent.setup();
    render(<MagicLinkForm next="/profile" />);
    await user.type(screen.getByLabelText("Email"), "player@example.com");
    await user.click(screen.getByTestId("magic-link-submit"));
    expect(sendMagicLink).toHaveBeenCalledWith("player@example.com", "/profile");
  });

  it("confirms by naming the address, so a typo is visible", async () => {
    const user = userEvent.setup();
    render(<MagicLinkForm next="/" />);
    await user.type(screen.getByLabelText("Email"), "typo@exampel.com");
    await user.click(screen.getByTestId("magic-link-submit"));

    const sent = await screen.findByTestId("magic-link-sent");
    expect(sent).toHaveTextContent("typo@exampel.com");
    expect(sent).toHaveAttribute("role", "status");
  });

  it("offers a way back when the address was wrong", async () => {
    const user = userEvent.setup();
    render(<MagicLinkForm next="/" />);
    await user.type(screen.getByLabelText("Email"), "typo@exampel.com");
    await user.click(screen.getByTestId("magic-link-submit"));
    await user.click(await screen.findByRole("button", { name: /different address/i }));
    expect(screen.getByTestId("magic-link-form")).toBeInTheDocument();
  });

  it("reports a rejection instead of claiming the mail was sent", async () => {
    sendMagicLink.mockResolvedValue({ error: "Email rate limit exceeded" });
    const user = userEvent.setup();
    render(<MagicLinkForm next="/" />);
    await user.type(screen.getByLabelText("Email"), "player@example.com");
    await user.click(screen.getByTestId("magic-link-submit"));

    expect(await screen.findByTestId("magic-link-error")).toHaveTextContent(/rate limit/i);
    expect(screen.queryByTestId("magic-link-sent")).toBeNull();
  });
});

/* ================================================================== */
/* The sign-in panel                                                   */
/* ================================================================== */

describe("SignInPanel", () => {
  it("offers Google and magic link up front, password behind a disclosure", () => {
    render(<SignInPanel mode="signin" next="/" />);
    expect(screen.getByTestId("google-signin")).toBeInTheDocument();
    expect(screen.getByTestId("magic-link-form")).toBeInTheDocument();
    // Present, but not competing for attention with the two recommendations.
    expect(screen.queryByTestId("password-form")).toBeNull();
    expect(screen.getByTestId("password-toggle")).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the existing email + password path working", async () => {
    const user = userEvent.setup();
    render(<SignInPanel mode="signin" next="/arena" />);
    await user.click(screen.getByTestId("password-toggle"));

    const form = screen.getByTestId("password-form");
    await user.type(within(form).getByLabelText("Email"), "player@example.com");
    await user.type(within(form).getByLabelText("Password"), "correct-horse");
    await user.click(screen.getByTestId("password-submit"));

    expect(signInWithEmail).toHaveBeenCalledWith("player@example.com", "correct-horse");
    // The return path survives the password flow too.
    await waitFor(() => expect(push).toHaveBeenCalledWith("/arena"));
  });

  it("passes the destination to sign-up so the confirmation email returns there", async () => {
    const user = userEvent.setup();
    render(<SignInPanel mode="signup" next="/arena/court/daily" />);
    await user.click(screen.getByTestId("password-toggle"));

    const form = screen.getByTestId("password-form");
    await user.type(within(form).getByLabelText("Email"), "new@example.com");
    await user.type(within(form).getByLabelText("Password"), "a-long-enough-one");
    await user.type(within(form).getByLabelText("Confirm password"), "a-long-enough-one");
    await user.click(screen.getByTestId("password-submit"));

    expect(signUpWithEmail).toHaveBeenCalledWith(
      "new@example.com",
      "a-long-enough-one",
      "/arena/court/daily",
    );
  });

  it("carries the destination across the sign-in / sign-up switch", () => {
    render(<SignInPanel mode="signin" next="/arena/run-the-table" />);
    expect(screen.getByRole("link", { name: /create one/i })).toHaveAttribute(
      "href",
      "/signup?returnTo=%2Farena%2Frun-the-table",
    );
  });

  it("says out loud that an account is optional", () => {
    render(<SignInPanel mode="signin" next="/" />);
    expect(screen.getByText(/play every mode without an account/i)).toBeInTheDocument();
  });
});

/* ================================================================== */
/* Initials avatar                                                     */
/* ================================================================== */

describe("InitialsAvatar", () => {
  it("derives initials from a name, then an email, then gives up honestly", () => {
    expect(initialsFor({ name: "Ada Lovelace" })).toBe("AL");
    expect(initialsFor({ name: "Ada" })).toBe("AD");
    expect(initialsFor({ email: "ada.lovelace@example.com" })).toBe("AL");
    expect(initialsFor({ email: "ada_lovelace@example.com" })).toBe("AL");
    expect(initialsFor({ email: "ada@example.com" })).toBe("A");
    // Not a fabricated letter.
    expect(initialsFor({})).toBe("?");
    expect(initialsFor(null)).toBe("?");
  });

  it("prefers the provider's name over the email local-part", () => {
    expect(initialsFor({ name: "Ada Lovelace", email: "xyz123@example.com" })).toBe("AL");
  });

  it("is decorative, and never an image", () => {
    const { container } = render(<InitialsAvatar email="ada@example.com" />);
    const avatar = screen.getByTestId("account-avatar");
    expect(avatar).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("img")).toBeNull();
  });
});

/* ================================================================== */
/* The header account control                                          */
/* ================================================================== */

describe("AccountMenu — signed out", () => {
  it("offers one link, and it is an offer rather than a wall", () => {
    render(<AccountMenu pathname="/arena/run-the-table" />);
    const link = screen.getByTestId("nav-signin");
    expect(link).toHaveTextContent("Sign in");
    // No dialog, no interstitial, nothing that intercepts navigation.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("returns the player to where they were", () => {
    render(<AccountMenu pathname="/arena/run-the-table" search="mode=daily" />);
    expect(screen.getByTestId("nav-signin")).toHaveAttribute(
      "href",
      "/signin?returnTo=%2Farena%2Frun-the-table%3Fmode%3Ddaily",
    );
  });

  it("refuses to build a returnTo out of a hostile path", () => {
    render(<AccountMenu pathname="/" returnTo="https://evil.example" />);
    expect(screen.getByTestId("nav-signin")).toHaveAttribute("href", "/signin");
  });

  it("renders nothing at all when Supabase is not configured", () => {
    authState.supabaseEnabled = false;
    const { container } = render(<AccountMenu pathname="/" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("AccountMenu — signed in", () => {
  beforeEach(() => {
    authState.user = { id: "u-1", email: "ada.lovelace@example.com", isAnonymous: false };
  });

  it("shows an initials avatar instead of a photograph", () => {
    render(<AccountMenu pathname="/" />);
    expect(screen.getByTestId("account-avatar")).toHaveAttribute("data-initials", "AL");
    expect(screen.queryByTestId("nav-signin")).toBeNull();
  });

  it("names the account it belongs to, for screen readers", () => {
    render(<AccountMenu pathname="/" />);
    expect(screen.getByTestId("nav-account-trigger")).toHaveAccessibleName(
      "Account menu for ada.lovelace@example.com",
    );
  });

  it("is a collapsed disclosure until pressed", async () => {
    const user = userEvent.setup();
    render(<AccountMenu pathname="/" />);
    const trigger = screen.getByTestId("nav-account-trigger");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).not.toHaveAttribute("aria-controls");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger.getAttribute("aria-controls")).toBe(
      screen.getByTestId("nav-account-panel").id,
    );
  });

  it("reaches profile, progress and history — none of which the header offered before", async () => {
    const user = userEvent.setup();
    render(<AccountMenu pathname="/" />);
    await user.click(screen.getByTestId("nav-account-trigger"));
    const panel = screen.getByTestId("nav-account-panel");

    for (const [id, href] of [
      ["profile", "/profile"],
      ["progress", "/progress"],
      ["history", "/history"],
    ] as const) {
      expect(panel.querySelector(`[data-nav-item="${id}"]`)).toHaveAttribute("href", href);
    }
  });

  it("marks the destination the user is already on", async () => {
    const user = userEvent.setup();
    render(<AccountMenu pathname="/progress" />);
    await user.click(screen.getByTestId("nav-account-trigger"));
    const current = screen
      .getByTestId("nav-account-panel")
      .querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("data-nav-item", "progress");
  });

  it("signs out from the header, without a trip to /profile first", async () => {
    const user = userEvent.setup();
    render(<AccountMenu pathname="/" />);
    await user.click(screen.getByTestId("nav-account-trigger"));
    await user.click(screen.getByTestId("nav-signout"));
    expect(authState.signOut).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<AccountMenu pathname="/" />);
    const trigger = screen.getByTestId("nav-account-trigger");
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("nav-account-panel")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on an outside pointer press", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <AccountMenu pathname="/" />
        <button type="button">elsewhere</button>
      </div>,
    );
    await user.click(screen.getByTestId("nav-account-trigger"));
    await user.click(screen.getByRole("button", { name: "elsewhere" }));
    expect(screen.queryByTestId("nav-account-panel")).toBeNull();
  });
});
