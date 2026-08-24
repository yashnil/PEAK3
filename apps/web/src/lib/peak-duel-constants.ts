// Peak Duel's one authoritative decision-clock length (daily mode only).
// Both `GameEngine` (legacy render) and `PeakDuelV2Question` (V2 render) must
// import this rather than declaring their own copy — a hand-copied second
// constant is exactly how the two presentations drifted before (V2 stayed at
// 5s after legacy's clock was never actually 10s to begin with; this file
// exists so that class of drift can't happen again).
export const DECISION_CLOCK_SECONDS = 10;
