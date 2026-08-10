import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { AuthProvider } from "@/lib/auth-context";
import { themeInitScript } from "@/lib/theme-script";
import "@/styles/globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

/**
 * THE DISPLAY FACE, AND WHY IT IS NO LONGER SYNE.
 *
 * Syne is an editorial/fashion display face: high-contrast, quirky terminals,
 * a wide `a` and a very distinctive `y`. It reads as a magazine masthead. This
 * product is a competitive game whose entire visual argument is "measured,
 * technical, arena-lit", and a masthead face fights that on every screen where
 * it sits beside a scoreboard.
 *
 * Space Grotesk is drawn from Space Mono's proportions — a grotesque with
 * mono-derived skeletons. Three properties earn it here:
 *
 *   1. ITS DIGITS MATCH THE SCOREBOARD. The numerals are near-monospaced by
 *      construction, so a headline number and the `--pk-numeral` tabular figures
 *      in `.score-number` beside it read as the same system. Syne's did not.
 *   2. IT TIGHTENS WITHOUT BREAKING. Display type here is set at negative
 *      tracking (see `--pk-track-display`); Space Grotesk's open counters stay
 *      legible there, where Syne's already-tight joins closed up.
 *   3. IT SHARES INTER'S VERTICAL METRICS closely enough that a display line
 *      and a body line in the same block sit on a common baseline rhythm
 *      without per-surface nudging.
 *
 * Weights 400-700: 400 and 500 are new here and exist for the eyebrow/label
 * tier, which previously had no display weight available and therefore always
 * fell back to Inter. 800 is dropped — Space Grotesk has no 800, and the six
 * call sites using `font-extrabold` now resolve to 700, its heaviest.
 */
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "PEAK3 Arena",
    template: "%s | PEAK3 Arena",
  },
  description:
    "PEAK3 Arena: the basketball analytics game. Challenge your knowledge of NBA peak performance through data-driven duels.",
  keywords: ["NBA", "basketball", "analytics", "peak performance", "PEAK3", "statistics"],
  openGraph: {
    title: "PEAK3 Arena",
    description: "Which player had the greater peak? Play PEAK3 Arena.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // `suppressHydrationWarning` is scoped to this element only (React does
    // not propagate it to descendants) and covers exactly one attribute:
    // `data-theme`, written by the blocking script below before React ever
    // mounts. That is an EXPECTED difference from the server-rendered
    // markup, not a real mismatch — the standard `next-themes`-style
    // pattern this implements (see `lib/theme.ts`'s module docstring and
    // PRODUCT_EXPERIENCE_CONTRACT.md §9's "Sources").
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${spaceGrotesk.variable}`}
    >
      <head>
        {/* Sets `data-theme` synchronously, before first paint, so there is
            no flash of the wrong theme and no client/server visual
            mismatch to correct after hydration. Must run before any CSS
            that reads `[data-theme]` is applied to the page — first child
            of `<head>` is the earliest that guarantees. Static fallback
            `content` matches Arena Night (`--bg-page`); the script
            overwrites it synchronously once it knows the real theme. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />
        <meta name="theme-color" content="#0a0b0d" />
      </head>
      <body>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
