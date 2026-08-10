/**
 * Phase 6G Part D: PlayerAvatar image-rendering behavior -- initials
 * fallback when no URL, real <img> when a URL is present, broken-image
 * fallback via onError, and accessibility (decorative image with empty
 * alt, name conveyed by sibling text elsewhere in the real UI -- PlayerAvatar
 * itself is intentionally aria-hidden in both render paths).
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

import PlayerAvatar from "@/components/court/PlayerAvatar";

describe("PlayerAvatar", () => {
  it("renders initials fallback when no imageUrl is provided (default safe production behavior)", () => {
    render(<PlayerAvatar name="LeBron James" />);
    const el = screen.getByTestId("player-avatar");
    expect(el.tagName).toBe("DIV");
    expect(el).toHaveTextContent("LJ");
  });

  it("renders a real <img> element when imageUrl is present", () => {
    render(<PlayerAvatar name="LeBron James" imageUrl="https://a.espncdn.com/i/headshots/nba/players/full/1966.png" />);
    const el = screen.getByTestId("player-avatar");
    expect(el.tagName).toBe("IMG");
    expect(el).toHaveAttribute("src", "https://a.espncdn.com/i/headshots/nba/players/full/1966.png");
  });

  it("falls back to initials if the image fails to load (onError), with no layout shift (same testid, same slot)", () => {
    render(<PlayerAvatar name="LeBron James" imageUrl="https://a.espncdn.com/broken.png" size={40} />);
    const img = screen.getByTestId("player-avatar");
    expect(img.tagName).toBe("IMG");
    fireEvent.error(img);
    const fallback = screen.getByTestId("player-avatar");
    expect(fallback.tagName).toBe("DIV");
    expect(fallback).toHaveTextContent("LJ");
  });

  it("image variant has empty alt text and is aria-hidden (decorative -- the player's name is conveyed by adjacent text in every real caller, never by this element alone)", () => {
    render(<PlayerAvatar name="Stephen Curry" imageUrl="https://a.espncdn.com/i/headshots/nba/players/full/3975.png" />);
    const el = screen.getByTestId("player-avatar");
    expect(el).toHaveAttribute("alt", "");
    expect(el).toHaveAttribute("aria-hidden", "true");
  });

  it("initials fallback variant is also aria-hidden with no accessible text of its own", () => {
    render(<PlayerAvatar name="Stephen Curry" />);
    const el = screen.getByTestId("player-avatar");
    expect(el).toHaveAttribute("aria-hidden", "true");
  });

  // -------------------------------------------------------------------------
  // Hardening, now that this primitive is on the $20 Showdown, the Daily Grid
  // and Three-Man Weave hot paths rather than one experimental court.
  // -------------------------------------------------------------------------

  it("reserves the same box in both branches, so a failed image shifts nothing", () => {
    const { rerender } = render(
      <PlayerAvatar name="LeBron James" imageUrl="https://a.espncdn.com/x.png" size={44} />,
    );
    const img = screen.getByTestId("player-avatar");
    // Both attributes AND styles: the attributes reserve the box before the
    // bytes arrive, the styles hold it against any stylesheet.
    expect(img).toHaveAttribute("width", "44");
    expect(img).toHaveAttribute("height", "44");
    expect(img).toHaveStyle({ width: "44px", height: "44px" });

    fireEvent.error(img);
    expect(screen.getByTestId("player-avatar")).toHaveStyle({ width: "44px", height: "44px" });

    rerender(<PlayerAvatar name="LeBron James" size={44} />);
    expect(screen.getByTestId("player-avatar")).toHaveStyle({ width: "44px", height: "44px" });
  });

  it("loads lazily, decodes async and sends no referrer to a third-party host", () => {
    render(<PlayerAvatar name="Nikola Jokic" imageUrl="https://a.espncdn.com/x.png" />);
    const img = screen.getByTestId("player-avatar");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("decoding", "async");
    expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
  });

  it("gives a NEW url its own chance after a previous one failed in the same slot", () => {
    // THE STICKY-FLAG BUG THIS GUARDS. These avatars are reused in place — a
    // roster slot re-fills, a lot advances, a grid square swaps identity — all
    // under a stable React key. A boolean "the image failed" would survive the
    // prop change and suppress every later photograph in that position.
    const { rerender } = render(
      <PlayerAvatar name="Player One" imageUrl="https://a.espncdn.com/broken.png" />,
    );
    fireEvent.error(screen.getByTestId("player-avatar"));
    expect(screen.getByTestId("player-avatar").tagName).toBe("DIV");

    rerender(<PlayerAvatar name="Player Two" imageUrl="https://a.espncdn.com/good.png" />);
    const next = screen.getByTestId("player-avatar");
    expect(next.tagName).toBe("IMG");
    expect(next).toHaveAttribute("src", "https://a.espncdn.com/good.png");
  });

  it("stays on the medallion for the url that actually failed", () => {
    const { rerender } = render(
      <PlayerAvatar name="Player One" imageUrl="https://a.espncdn.com/broken.png" />,
    );
    fireEvent.error(screen.getByTestId("player-avatar"));
    // A re-render with the SAME url must not retry: one image request per
    // avatar, no retry loop against a host that already said no.
    rerender(<PlayerAvatar name="Player One" imageUrl="https://a.espncdn.com/broken.png" />);
    expect(screen.getByTestId("player-avatar").tagName).toBe("DIV");
  });

  it("treats a null url exactly like an absent one", () => {
    // The API sends `null` for an identity the manifest cannot resolve, which
    // is the majority of every mode's pool. That must be the medallion, not an
    // <img src="null">.
    render(<PlayerAvatar name="Bill Russell" imageUrl={null} />);
    const el = screen.getByTestId("player-avatar");
    expect(el.tagName).toBe("DIV");
    expect(el).toHaveTextContent("BR");
  });
});
