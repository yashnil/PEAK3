/**
 * The signed-in marker: initials on a disc.
 *
 * WHY NOT THE GOOGLE PROFILE PHOTO. PEAK3 ships no photographs — the house rule
 * exists for player likenesses and this follows it for people too. It also means
 * the avatar never makes a request to `googleusercontent.com`, so a signed-in
 * user's presence on the page is not broadcast to a third party on every render,
 * and there is no image to fail to load.
 *
 * The disc is decorative; the accessible name lives on whatever control wraps it
 * (see `AccountMenu`), so this renders `aria-hidden` and never invents a label
 * that would then be announced twice.
 *
 * Owner: Track B (auth surface).
 */

import { cn } from "@/lib/utils";

/**
 * One or two letters for a person, from whatever identity we actually have.
 *
 * Email is usually all there is (magic link gives nothing else, and Google's
 * `full_name` is only present when the profile scope was granted). `ada.lovelace@…`
 * → `AL`; `ada@…` → `A`; nothing usable → `?`, which is honest rather than a
 * fabricated initial.
 */
export function initialsFor(
  identity: { email?: string | null; name?: string | null } | null | undefined,
): string {
  const name = identity?.name?.trim();
  if (name) {
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  }

  const email = identity?.email?.trim();
  if (email) {
    const local = email.split("@")[0] ?? "";
    const parts = local.split(/[._\-+]/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  }

  return "?";
}

export interface InitialsAvatarProps {
  email?: string | null;
  name?: string | null;
  /** Edge length in CSS pixels. */
  size?: number;
  className?: string;
}

export function InitialsAvatar({ email, name, size = 28, className }: InitialsAvatarProps) {
  const initials = initialsFor({ email, name });
  return (
    <span
      aria-hidden="true"
      data-testid="account-avatar"
      data-initials={initials}
      className={cn(
        "inline-flex items-center justify-center rounded-full font-semibold select-none",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        // Accent at low alpha rather than solid: a filled gold disc in the
        // header reads as a notification badge, which it is not.
        background: "rgba(245, 200, 66, 0.14)",
        border: "1px solid rgba(245, 200, 66, 0.35)",
        color: "var(--peak-accent, #f5c842)",
        letterSpacing: "0.02em",
      }}
    >
      {initials}
    </span>
  );
}

export default InitialsAvatar;
