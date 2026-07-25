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
});
