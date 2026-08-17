/**
 * Shared tone vocabulary for every PEAK3 V2 primitive.
 *
 * "Five component colors: ONLY where they encode real PEAK3 component
 * data" (brief §Color) — a `tone` prop is how a primitive's caller states
 * THAT, explicitly, rather than a primitive guessing from a label string or
 * defaulting to decorative color. `"accent"` is gold (primary
 * action/focus/selected/identity); `"positive"`/`"negative"` are true
 * status only; `"neutral"` renders with no color emphasis at all — the
 * correct default for anything that is not actually PEAK3 component data.
 */

export type V2Tone =
  | "accent"
  | "si"
  | "tp"
  | "rec"
  | "po"
  | "team"
  | "positive"
  | "negative"
  | "neutral";

export type V2ComponentTone = "si" | "tp" | "rec" | "po" | "team";

/** The five real PEAK3 component tones, for callers that need to iterate
 *  them (e.g. a lane comparison rendering all five in order) rather than
 *  hardcode the list a second time. */
export const V2_COMPONENT_TONES: readonly V2ComponentTone[] = ["si", "tp", "rec", "po", "team"];

export const V2_COMPONENT_TONE_LABELS: Record<V2ComponentTone, string> = {
  si: "Statistical Impact",
  tp: "Traditional Production",
  rec: "Individual Recognition",
  po: "Playoff Rate Impact",
  team: "Team Result",
};

/** Resolves a tone to its CSS custom property — `undefined` for `"neutral"`,
 *  which callers use as "fall back to the surrounding text color." */
export function v2ToneVar(tone: V2Tone): string | undefined {
  switch (tone) {
    case "accent":
      return "var(--v2-color-accent)";
    case "si":
      return "var(--v2-color-comp-si)";
    case "tp":
      return "var(--v2-color-comp-tp)";
    case "rec":
      return "var(--v2-color-comp-rec)";
    case "po":
      return "var(--v2-color-comp-po)";
    case "team":
      return "var(--v2-color-comp-team)";
    case "positive":
      return "var(--v2-color-positive)";
    case "negative":
      return "var(--v2-color-negative)";
    case "neutral":
    default:
      return undefined;
  }
}
