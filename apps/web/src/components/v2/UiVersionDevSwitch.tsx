"use client";

/**
 * UiVersionDevSwitch — "a development/local-only switch is fine" (brief).
 * NOT a production control: renders nothing at all unless
 * `NEXT_PUBLIC_PEAK3_UI_VERSION_SWITCH` is explicitly set to `"1"` — a
 * brand-new env var nobody has added to the Vercel/Railway project config,
 * so a real deploy has it unset and this component returns `null` there,
 * same as everywhere else it is not explicitly turned on. `npm run dev`
 * leaves it unset too by default; a developer opts in locally with
 * `NEXT_PUBLIC_PEAK3_UI_VERSION_SWITCH=1 npm run dev`. This is a narrower
 * guarantee than "hidden from nav" (`/arena/labs`'s approach) — the
 * control does not exist in the rendered DOM at all unless opted in.
 *
 * A small fixed corner control, not a page element — mount it once, high
 * in the tree (see `app/(main)/layout.tsx`), and it stays out of the way
 * of every screenshot/test that is not specifically testing it.
 */

import { useUiVersionControl } from "@/lib/ui-version";

export default function UiVersionDevSwitch() {
  const { version, setVersion } = useUiVersionControl();
  if (process.env.NEXT_PUBLIC_PEAK3_UI_VERSION_SWITCH !== "1") return null;
  return (
    <div
      data-testid="ui-version-dev-switch"
      className="fixed bottom-3 right-3 z-[999] flex items-center gap-1 rounded-full border px-2 py-1 text-xs"
      style={{
        background: "rgba(10, 11, 13, 0.92)",
        borderColor: "var(--border-emphasis)",
        color: "var(--text-secondary)",
        fontFamily: "var(--font-mono)",
      }}
    >
      <span className="px-1 opacity-60">ui</span>
      {(["legacy", "v2"] as const).map((option) => (
        <button
          key={option}
          type="button"
          data-testid={`ui-version-dev-switch-${option}`}
          onClick={() => setVersion(option)}
          aria-pressed={version === option}
          className="rounded-full px-2 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
          style={{
            background: version === option ? "var(--peak-accent)" : "transparent",
            color: version === option ? "var(--text-inverse)" : "var(--text-secondary)",
            fontWeight: 700,
          }}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
