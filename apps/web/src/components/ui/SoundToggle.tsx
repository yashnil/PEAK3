"use client";

/**
 * The sound control — the mute setting for `lib/arena-audio`.
 *
 * WHY IT IS IN THE HEADER AND NOT BURIED IN SETTINGS. The brief for the
 * audio layer requires "an obvious mute setting". Three placements were
 * considered and two rejected: `/profile` is behind sign-in, and PEAK3 is
 * playable anonymously, so half the audience could not reach it;
 * `/accessibility` is a legal-review-pending document, not a settings
 * surface. The header already has a cluster for exactly this kind of global
 * presentation preference — `ThemeToggle` sits in it — so this is a sibling
 * there rather than a fourth place to look.
 *
 * OFF IS THE DEFAULT AND OFF IS THE HONEST FIRST FRAME. `arena-audio` reads
 * `localStorage`, which a server render cannot see, so this renders "off"
 * on the server and syncs in an effect. That is not a hydration compromise:
 * "off" IS the correct answer for a first-time visitor and for any browser
 * where storage is blocked, so the pre-sync frame is never a lie.
 *
 * IT SAYS WHAT IT DOES IN WORDS. `aria-label` states both the current state
 * and what a press will do, so a screen-reader user never has to press
 * blind — the same contract `ThemeToggle` holds. Nothing about the cue set
 * carries information that is not already on screen, so a muted player is
 * missing nothing; see `lib/arena-audio`'s rule 2.
 */

import { useCallback, useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { isArenaAudioEnabled, playArenaCue, setArenaAudioEnabled } from "@/lib/arena-audio";

export interface SoundToggleProps {
  className?: string;
}

export function SoundToggle({ className }: SoundToggleProps) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(isArenaAudioEnabled());
  }, []);

  const toggle = useCallback(() => {
    const next = !enabled;
    setArenaAudioEnabled(next);
    setEnabled(next);
    // TURNING IT ON PLAYS ONE CUE, and this is the only place in the product
    // that fires a sound for its own sake. Two reasons it earns the
    // exception: the press is a real user gesture, which is the only moment
    // a browser will let an `AudioContext` start at all, and a sound setting
    // that gives no sound when you enable it is indistinguishable from a
    // broken one. Turning it OFF is silent, which is the whole point.
    if (next) playArenaCue("lock");
  }, [enabled]);

  const Icon = enabled ? Volume2 : VolumeX;

  return (
    <button
      type="button"
      data-testid="sound-toggle"
      onClick={toggle}
      aria-pressed={enabled}
      data-enabled={enabled ? "true" : "false"}
      aria-label={
        enabled
          ? "Sound: on. Turn game sounds off."
          : "Sound: off. Turn game sounds on."
      }
      title={enabled ? "Sound on" : "Sound off"}
      className={cn(
        "pk-nav-account flex items-center justify-center rounded-md border transition-colors",
        "border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)]",
        className,
      )}
      style={{ width: "var(--pk-tap-min, 44px)", height: "var(--pk-tap-min, 44px)" }}
    >
      <Icon
        size={16}
        aria-hidden="true"
        style={{ color: enabled ? "var(--peak-accent)" : "var(--text-secondary)" }}
      />
    </button>
  );
}

export default SoundToggle;
