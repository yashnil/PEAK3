import type { Metadata } from "next";
import { Inter, Syne } from "next/font/google";
import { AuthProvider } from "@/lib/auth-context";
import { themeInitScript } from "@/lib/theme-script";
import "@/styles/globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const syne = Syne({
  subsets: ["latin"],
  variable: "--font-syne",
  display: "swap",
  weight: ["700", "800"],
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
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${syne.variable}`}>
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
