"use client";

/**
 * PEAK3 ARENA AUDIO — eight cues, no assets, no dependency, off by default.
 *
 * WHY THERE IS NO LIBRARY AND NO SOUND FILES.
 *
 * The dependency audit for this pass considered Howler (~9 kB gz) and
 * rejected it, and it considered shipping sample files and rejected that too.
 * Both were the wrong shape for what this product actually needs:
 *
 *   - Every cue here is a 40-180 ms envelope: a click, a tick, a stamp, a
 *     low knock. The Web Audio API synthesises all eight from an oscillator
 *     or a noise burst and a gain ramp, in about a hundred lines, with no
 *     network request, no asset pipeline and nothing to keep in sync.
 *   - A library buys sprite management and format fallbacks. There are no
 *     sprites and no formats.
 *   - Stock basketball sound effects are the audio equivalent of stock
 *     basketball animation, which this pass's brief explicitly rules out. A
 *     synthesised cue is at least authored FOR this product.
 *
 * WHAT THIS IS NOT. It is not a soundtrack, and it never will be from here:
 * there is no looping source, no music, and no cue longer than 320 ms.
 *
 * THE FOUR RULES IT HOLDS.
 *
 * 1. OFF BY DEFAULT, and the setting is explicit and persistent. Nobody gets
 *    sound they did not ask for.
 * 2. NO CUE CARRIES INFORMATION THAT IS NOT ALREADY VISIBLE. Every call site
 *    fires alongside a visual state change that is already in the DOM.
 *    Muting removes nothing; this is decoration over authoritative state,
 *    the same posture the motion layer takes.
 * 3. THE CONTEXT IS CREATED LAZILY, ON A REAL GESTURE. Browsers refuse to
 *    start an `AudioContext` outside a user gesture, and creating one
 *    eagerly on page load produces a suspended context and a console
 *    warning. Nothing is constructed until the first `play()` that follows
 *    an enable.
 * 4. IT NEVER THROWS INTO GAMEPLAY. Every entry point is wrapped: a browser
 *    with no Web Audio, a context that fails to resume, an autoplay refusal
 *    — all of them return quietly. A sound cue must never be able to break
 *    a press.
 *
 * WHAT A REAL SOUND DESIGNER WOULD CHANGE. The public surface is
 * `play(cue)`, not `oscillator`. Swapping these envelopes for recorded
 * samples is a change inside `render()` and nowhere else — no call site
 * moves. That is the point of building the layer before the assets exist.
 */

export type ArenaCue =
  /** A selection commits — a duel side, a grid cell, a draft slot. */
  | "lock"
  /** A bid is placed. */
  | "bid"
  /** The hammer falls on a Showdown lot. */
  | "sold"
  /** A spinner or reel settles on its result. */
  | "spin_lock"
  /** A player card lands in a roster slot. */
  | "roster"
  /** A boss title card opens. */
  | "boss"
  /** A life is lost. */
  | "life_lost"
  /** A run, board or match is won. */
  | "victory";

export const ARENA_AUDIO_STORAGE_KEY = "peak3.audio.enabled";

/**
 * One cue's synthesis recipe.
 *
 * `partials` are frequencies in Hz sounded together; `sweepTo` bends the
 * fundamental over the cue's life (a drop reads as weight landing, a rise as
 * something opening). `noise` swaps the oscillator for filtered white noise,
 * which is what makes a stamp read as an impact rather than a beep.
 *
 * The pitches are deliberately consonant across cues — everything sits on an
 * A-minor-ish set — so two cues that can fire close together (a lock then a
 * roster arrival) do not clash.
 */
interface CueSpec {
  partials: number[];
  durationMs: number;
  /** Peak gain, before the master. Nothing here goes above 0.16. */
  gain: number;
  attackMs: number;
  type?: OscillatorType;
  sweepTo?: number;
  noise?: boolean;
  /** Repeat the whole envelope, for a cue that reads as two beats. */
  repeat?: { times: number; gapMs: number };
}

const CUES: Record<ArenaCue, CueSpec> = {
  // A short, dry, high click. This is the most-fired cue in the product, so
  // it is the quietest and the shortest thing here by a wide margin.
  lock: { partials: [880, 1320], durationMs: 60, gain: 0.08, attackMs: 2, type: "triangle" },
  // A step up, literally: the pitch rises, because a bid raises.
  bid: { partials: [523.25], durationMs: 90, gain: 0.09, attackMs: 3, type: "square", sweepTo: 659.25 },
  // The hammer. Filtered noise with a low body under it, and a second,
  // quieter knock — a gavel is two sounds, not one.
  sold: { partials: [180, 90], durationMs: 150, gain: 0.14, attackMs: 1, noise: true, repeat: { times: 2, gapMs: 95 } },
  // A reel settling: a pitch drop into a stop.
  spin_lock: { partials: [660], durationMs: 110, gain: 0.1, attackMs: 2, type: "triangle", sweepTo: 440 },
  // A card landing in a slot: low, soft, brief. Felt more than heard.
  roster: { partials: [220, 330], durationMs: 120, gain: 0.09, attackMs: 6, type: "sine", sweepTo: 196 },
  // A boss opening: the one cue allowed to be dark and to take its time.
  boss: { partials: [110, 164.81], durationMs: 320, gain: 0.12, attackMs: 40, type: "sawtooth", sweepTo: 98 },
  // A life lost: a falling minor third, which is the most legible "wrong"
  // interval there is without being a buzzer.
  life_lost: { partials: [392], durationMs: 220, gain: 0.11, attackMs: 4, type: "triangle", sweepTo: 311.13 },
  // A win: a rising major triad, played as one short arpeggio.
  victory: { partials: [523.25, 659.25, 783.99], durationMs: 260, gain: 0.11, attackMs: 8, type: "triangle" },
};

/** A ceiling over every cue, so no single spec can be loud on its own. */
const MASTER_GAIN = 0.55;

let context: AudioContext | null = null;
let enabled = false;
let hydrated = false;

function readStoredPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ARENA_AUDIO_STORAGE_KEY) === "1";
  } catch {
    // A private window, or site data blocked. Silence is the safe default.
    return false;
  }
}

/** Whether cues are currently on. Reads the stored preference once. */
export function isArenaAudioEnabled(): boolean {
  if (!hydrated) {
    enabled = readStoredPreference();
    hydrated = true;
  }
  return enabled;
}

/**
 * Turn cues on or off and remember it.
 *
 * Enabling does NOT create the context — see rule 3. The first `play()` after
 * this does, and that call is itself inside the gesture that flipped the
 * setting or a later one.
 */
export function setArenaAudioEnabled(next: boolean): void {
  enabled = next;
  hydrated = true;
  try {
    window.localStorage.setItem(ARENA_AUDIO_STORAGE_KEY, next ? "1" : "0");
  } catch {
    // Not being able to persist the choice is not a reason to refuse it for
    // this session.
  }
  if (!next && context) {
    void context.suspend().catch(() => {});
  }
}

function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!context) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      context = new Ctor();
    }
    if (context.state === "suspended") void context.resume().catch(() => {});
    return context;
  } catch {
    return null;
  }
}

/** A short burst of white noise, as an audio buffer. Built per call: at these
 *  durations the allocation is smaller than a single texture upload, and
 *  caching it would mean holding a buffer for a feature that is off by
 *  default for most sessions. */
function noiseBuffer(ctx: AudioContext, durationMs: number): AudioBuffer {
  const frames = Math.max(1, Math.floor((ctx.sampleRate * durationMs) / 1000));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) {
    // Decaying noise, so the burst reads as an impact rather than a hiss.
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }
  return buffer;
}

function render(ctx: AudioContext, spec: CueSpec, startAt: number): void {
  const seconds = spec.durationMs / 1000;
  const attack = Math.min(spec.attackMs / 1000, seconds * 0.5);

  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0, startAt);
  envelope.gain.linearRampToValueAtTime(spec.gain * MASTER_GAIN, startAt + attack);
  // Exponential release: a linear one reads as a cut, not a decay. The floor
  // is not zero because `exponentialRampToValueAtTime` is undefined at 0.
  envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + seconds);
  envelope.connect(ctx.destination);

  if (spec.noise) {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(ctx, spec.durationMs);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(spec.partials[0] ?? 200, startAt);
    source.connect(filter).connect(envelope);
    source.start(startAt);
    source.stop(startAt + seconds);
    return;
  }

  spec.partials.forEach((frequency, index) => {
    const osc = ctx.createOscillator();
    osc.type = spec.type ?? "sine";
    // An arpeggio, when there is more than one partial and no sweep: each
    // partial enters a beat after the last rather than all at once.
    const offset = spec.sweepTo === undefined && spec.partials.length > 1 ? index * (seconds / (spec.partials.length * 2)) : 0;
    osc.frequency.setValueAtTime(frequency, startAt + offset);
    if (spec.sweepTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(spec.sweepTo, startAt + seconds);
    }
    osc.connect(envelope);
    osc.start(startAt + offset);
    osc.stop(startAt + seconds);
  });
}

/**
 * Fire a cue. A no-op when audio is off, unsupported, or unavailable.
 *
 * Safe to call from anywhere, including a render path or an effect — it never
 * throws and never blocks. It is deliberately fire-and-forget with no return
 * value: a call site must not be able to branch on whether a sound played,
 * because that would be information the muted player does not have.
 */
export function playArenaCue(cue: ArenaCue): void {
  if (!isArenaAudioEnabled()) return;
  const ctx = ensureContext();
  if (!ctx) return;
  try {
    const spec = CUES[cue];
    if (!spec) return;
    const now = ctx.currentTime;
    const times = spec.repeat?.times ?? 1;
    for (let i = 0; i < times; i += 1) {
      render(ctx, spec, now + (i * (spec.repeat?.gapMs ?? 0)) / 1000);
    }
  } catch {
    // Never let a decoration break a press.
  }
}

/** Test seam: forget the hydrated preference and drop the context. */
export function __resetArenaAudioForTests(): void {
  context = null;
  enabled = false;
  hydrated = false;
}
