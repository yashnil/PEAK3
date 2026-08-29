import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LegacyLabsPage from "@/app/(main)/arena/labs/page";

describe("LegacyLabsPage", () => {
  it("labels itself as legacy, links back to the flagship, and offers all three modes", () => {
    render(<LegacyLabsPage />);

    expect(screen.getByTestId("legacy-labs-page")).toBeVisible();
    expect(screen.getByTestId("legacy-labs-banner")).toHaveTextContent(
      /not part of the main PEAK3 experience/i,
    );
    expect(screen.getByTestId("labs-back-to-flagship")).toHaveAttribute(
      "href",
      "/arena/court/practice/apex_1y",
    );

    const dailyLinks = screen.getAllByRole("link", { name: "Daily Draft" });
    const practiceLinks = screen.getAllByRole("link", { name: "Practice" });
    for (const [label, mode] of [
      ["1Y Apex", "apex_1y"],
      ["3Y Prime", "prime_3y"],
      ["5Y Foundation", "foundation_5y"],
    ] as const) {
      expect(screen.getByText(label)).toBeVisible();
      expect(dailyLinks.some((a) => a.getAttribute("href") === `/arena/daily/${mode}`)).toBe(true);
      expect(practiceLinks.some((a) => a.getAttribute("href") === `/arena/practice/${mode}`)).toBe(true);
    }
  });

  it("keeps the Ranked entry point, and never renders it as an offer to start a run", () => {
    render(<LegacyLabsPage />);
    expect(screen.getByRole("link", { name: /view ranked/i })).toHaveAttribute(
      "href",
      "/arena/ranked",
    );
  });
});
