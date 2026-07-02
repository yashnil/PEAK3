import type { Metadata } from "next";
import { Inter, Syne } from "next/font/google";
import { AuthProvider } from "@/lib/auth-context";
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
    <html lang="en" className={`${inter.variable} ${syne.variable}`}>
      <body>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
