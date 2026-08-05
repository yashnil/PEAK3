/**
 * The global footer.
 *
 * Before this pass the footer was two sentences of prose with no links at all,
 * so /terms, /privacy, /accessibility, /contact and /data-sources had nowhere to
 * be reached from. These tests pin the three things a redesign silently loses:
 * the link inventory, the affiliation disclaimer (whose wording is not ours to
 * paraphrase), and the fact that the copyright year is computed rather than
 * typed — a hardcoded year is wrong on 1 January and nobody notices.
 *
 * The routes themselves are covered by `nav-model.test.ts`'s reachability
 * helper for nav hrefs; here we additionally assert that every footer href has a
 * real `page.tsx` behind it, because the footer is deliberately NOT part of the
 * nav model and would otherwise be the one link inventory nothing checks.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import React from "react";

import { Footer, FOOTER_COLUMNS, NBA_DISCLAIMER } from "@/components/layout/Footer";

const APP_DIR = path.resolve(__dirname, "../../app/(main)");

const EXPECTED_LINKS: Record<string, readonly [string, string][]> = {
  Play: [
    ["Run the Table", "/arena/run-the-table"],
    ["82-0 Peak Season", "/arena/court/daily"],
    ["Daily Grid", "/daily/grid"],
    ["Peak Duel", "/play/daily"],
    ["Multiplayer", "/arena/lobby"],
    ["Rankings", "/rankings"],
  ],
  Learn: [
    ["Methodology", "/methodology"],
    ["Data Sources", "/data-sources"],
    ["About", "/about"],
    ["Accessibility", "/accessibility"],
  ],
  Legal: [
    ["Terms of Use", "/terms"],
    ["Privacy", "/privacy"],
    ["Contact", "/contact"],
  ],
};

function footerNav(): HTMLElement {
  return screen.getByRole("navigation", { name: "Footer" });
}

describe("Footer structure", () => {
  it("renders a footer landmark containing a navigation landmark", () => {
    render(<Footer />);
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    expect(footerNav()).toBeInTheDocument();
  });

  it("renders all three column headings", () => {
    render(<Footer />);
    for (const title of ["Play", "Learn", "Legal"]) {
      expect(screen.getByRole("heading", { name: title, level: 2 })).toBeInTheDocument();
    }
  });

  it("names each column's list after its heading, so the groups are announced", () => {
    render(<Footer />);
    const lists = within(footerNav()).getAllByRole("list");
    expect(lists.map((list) => list.getAttribute("aria-labelledby"))).toEqual([
      "footer-heading-play",
      "footer-heading-learn",
      "footer-heading-legal",
    ]);
  });
});

describe("Footer links", () => {
  it("renders every documented link, with the documented href", () => {
    render(<Footer />);
    const nav = footerNav();
    for (const [column, links] of Object.entries(EXPECTED_LINKS)) {
      for (const [label, href] of links) {
        const link = within(nav).getByRole("link", { name: label });
        expect(link, `${column} → ${label}`).toHaveAttribute("href", href);
      }
    }
  });

  it("renders exactly the documented links and nothing else", () => {
    render(<Footer />);
    const rendered = within(footerNav())
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    const expected = Object.values(EXPECTED_LINKS).flat().map(([, href]) => href);
    expect(rendered).toEqual(expected);
  });

  it("keeps the exported inventory and the DOM in step", () => {
    // The component builds its DOM from FOOTER_COLUMNS; if the two ever diverge
    // the test above is asserting against a copy nobody renders.
    expect(FOOTER_COLUMNS.map((c) => c.title)).toEqual(Object.keys(EXPECTED_LINKS));
    for (const column of FOOTER_COLUMNS) {
      expect(column.links.map((l) => [l.label, l.href])).toEqual(
        EXPECTED_LINKS[column.title].map(([label, href]) => [label, href]),
      );
    }
  });

  it("every footer href resolves to a real route", () => {
    for (const column of FOOTER_COLUMNS) {
      for (const item of column.links) {
        const segments = item.href.split("/").filter(Boolean);
        const dir = path.join(APP_DIR, ...segments);
        expect(
          fs.existsSync(path.join(dir, "page.tsx")),
          `${item.href} must resolve to a page`,
        ).toBe(true);
      }
    }
  });

  it("guards the route helper: an invented path does not resolve", () => {
    expect(fs.existsSync(path.join(APP_DIR, "definitely-not-a-route", "page.tsx"))).toBe(false);
  });
});

describe("Footer legal copy", () => {
  it("states the NBA affiliation disclaimer verbatim", () => {
    render(<Footer />);
    expect(
      screen.getByText(
        "PEAK3 is an independent basketball analytics project and is not affiliated with or endorsed by the NBA or its teams. Team names, marks, and logos belong to their respective owners.",
      ),
    ).toBeInTheDocument();
    // The exported constant is the one the component renders, so a reworded
    // constant cannot pass this file by editing only the expectation above.
    expect(NBA_DISCLAIMER).toBe(
      "PEAK3 is an independent basketball analytics project and is not affiliated with or endorsed by the NBA or its teams. Team names, marks, and logos belong to their respective owners.",
    );
  });

  it("keeps the two provenance sentences the previous footer carried", () => {
    render(<Footer />);
    expect(
      screen.getByText(/Data sourced from Basketball Reference\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/not a claim of objective historical truth\./),
    ).toBeInTheDocument();
  });

  it("shows the current year, computed rather than hardcoded", () => {
    render(<Footer />);
    const currentYear = new Date().getFullYear();
    expect(screen.getByText(`© ${currentYear} PEAK3 Arena`)).toBeInTheDocument();
  });

  it("renders next year's year next year", () => {
    // The real assertion behind the one above: with the clock moved forward the
    // rendered year moves with it, which a literal in the JSX cannot do.
    const nextYear = new Date().getFullYear() + 1;
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(`${nextYear}-06-15T12:00:00Z`));
      render(<Footer />);
      expect(screen.getByText(`© ${nextYear} PEAK3 Arena`)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
