import { Nav } from "@/components/layout/nav";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Nav />
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
      <footer className="border-t border-[var(--border-subtle)] mt-24 py-8 text-center text-xs text-[var(--text-muted)]">
        <div className="mx-auto max-w-7xl px-4">
          <p>
            PEAK3 Arena — open basketball analytics. Data sourced from Basketball Reference.
          </p>
          <p className="mt-1">
            Rankings reflect the PEAK3 formula, not a claim of objective historical truth.
          </p>
        </div>
      </footer>
    </>
  );
}
