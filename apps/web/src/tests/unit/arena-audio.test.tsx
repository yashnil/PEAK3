/**
 * The audio layer's guarantees.
 *
 * This layer is decoration over state that is already on screen, and it is
 * off by default. Both of those are promises to the player, not stylistic
 * preferences, so they are asserted rather than left to review — as is the
 * thing that would actually hurt if it broke: a cue must never be able to
 * throw into a press.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  ARENA_AUDIO_STORAGE_KEY,
  __resetArenaAudioForTests,
  isArenaAudioEnabled,
  playArenaCue,
  setArenaAudioEnabled,
  type ArenaCue,
} from "@/lib/arena-audio";
import { SoundToggle } from "@/components/ui/SoundToggle";

const ALL_CUES: ArenaCue[] = [
  "lock",
  "bid",
  "sold",
  "spin_lock",
  "roster",
  "boss",
  "life_lost",
  "victory",
];

/** A minimal Web Audio double. Records what was constructed and started. */
function installAudioContext() {
  const started: number[] = [];
  const oscillators: Array<{ type: string; frequency: number }> = [];
  class FakeParam {
    setValueAtTime = vi.fn().mockReturnThis();
    linearRampToValueAtTime = vi.fn().mockReturnThis();
    exponentialRampToValueAtTime = vi.fn().mockReturnThis();
  }
  class FakeNode {
    connect = vi.fn((target: unknown) => target);
    disconnect = vi.fn();
  }
  class FakeContext {
    state = "running";
    currentTime = 0;
    sampleRate = 48000;
    destination = new FakeNode();
    resume = vi.fn().mockResolvedValue(undefined);
    suspend = vi.fn().mockResolvedValue(undefined);
    createGain() {
      return Object.assign(new FakeNode(), { gain: new FakeParam() });
    }
    createBiquadFilter() {
      return Object.assign(new FakeNode(), { type: "lowpass", frequency: new FakeParam() });
    }
    createBuffer(_c: number, frames: number) {
      return { getChannelData: () => new Float32Array(frames) };
    }
    createBufferSource() {
      return Object.assign(new FakeNode(), {
        buffer: null,
        start: vi.fn((t: number) => started.push(t)),
        stop: vi.fn(),
      });
    }
    createOscillator() {
      const node = Object.assign(new FakeNode(), {
        type: "sine",
        frequency: new FakeParam(),
        start: vi.fn((t: number) => started.push(t)),
        stop: vi.fn(),
      });
      oscillators.push(node as unknown as { type: string; frequency: number });
      return node;
    }
  }
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeContext;
  return { started, oscillators };
}

beforeEach(() => {
  __resetArenaAudioForTests();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { AudioContext?: unknown }).AudioContext;
  __resetArenaAudioForTests();
});

describe("arena audio is off until asked for", () => {
  it("defaults to off with nothing stored", () => {
    expect(isArenaAudioEnabled()).toBe(false);
  });

  it("plays nothing at all while off, and constructs no AudioContext", () => {
    const ctor = vi.fn();
    (window as unknown as { AudioContext: unknown }).AudioContext = ctor;
    for (const cue of ALL_CUES) playArenaCue(cue);
    expect(ctor).not.toHaveBeenCalled();
  });

  it("remembers the choice, and reads it back on a fresh module state", () => {
    setArenaAudioEnabled(true);
    expect(window.localStorage.getItem(ARENA_AUDIO_STORAGE_KEY)).toBe("1");
    __resetArenaAudioForTests();
    expect(isArenaAudioEnabled()).toBe(true);
  });

  it("treats a browser that refuses storage as off rather than as an error", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("site data blocked");
    });
    expect(() => isArenaAudioEnabled()).not.toThrow();
    expect(isArenaAudioEnabled()).toBe(false);
    getItem.mockRestore();
  });
});

describe("every cue actually renders once enabled", () => {
  it("starts at least one source for each of the eight cues", () => {
    const { started } = installAudioContext();
    setArenaAudioEnabled(true);
    for (const cue of ALL_CUES) {
      const before = started.length;
      playArenaCue(cue);
      expect(started.length, cue).toBeGreaterThan(before);
    }
  });
});

describe("a cue can never break a press", () => {
  it("swallows a browser with no Web Audio at all", () => {
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
    setArenaAudioEnabled(true);
    expect(() => playArenaCue("lock")).not.toThrow();
  });

  it("swallows a context that throws while building the graph", () => {
    class Exploding {
      state = "running";
      currentTime = 0;
      sampleRate = 48000;
      destination = {};
      resume = vi.fn();
      createGain() {
        throw new Error("no");
      }
    }
    (window as unknown as { AudioContext: unknown }).AudioContext = Exploding;
    setArenaAudioEnabled(true);
    expect(() => playArenaCue("victory")).not.toThrow();
  });

  it("returns nothing, so no call site can branch on whether a sound played", () => {
    installAudioContext();
    setArenaAudioEnabled(true);
    expect(playArenaCue("lock")).toBeUndefined();
  });
});

describe("SoundToggle", () => {
  it("renders off on the first frame, which is the honest default", () => {
    render(<SoundToggle />);
    const button = screen.getByTestId("sound-toggle");
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAccessibleName("Sound: off. Turn game sounds on.");
  });

  it("states both the current state and what a press does, in both states", () => {
    installAudioContext();
    render(<SoundToggle />);
    const button = screen.getByTestId("sound-toggle");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveAccessibleName("Sound: on. Turn game sounds off.");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("meets the project's 44px tap floor", () => {
    render(<SoundToggle />);
    const button = screen.getByTestId("sound-toggle");
    expect(button.style.width).toBe("var(--pk-tap-min, 44px)");
    expect(button.style.height).toBe("var(--pk-tap-min, 44px)");
  });
});
