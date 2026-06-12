/** Core domain types shared across the engine and the UI. */

export type DeckId = "A" | "B";

export interface Track {
  /** YouTube video id. */
  id: string;
  title: string;
  artist: string;
  /** Duration in seconds (0 when unknown until the player reports it). */
  duration: number;
  thumbnail: string;
  /** Where this track record came from. */
  source: "official" | "piped" | "invidious" | "library";
}

export type BpmSource = "dsp" | "model";

export interface TrackAnalysis {
  bpm: number;
  /** Confidence in [0,1]. */
  confidence: number;
  genre: string;
  energy: number;
  camelotKey: string;
  source: BpmSource;
}

export type CompatibilityTier = "perfect" | "compatible" | "stretch";

export interface MixCandidate {
  track: Track;
  analysis: TrackAnalysis;
  /** Absolute BPM delta against the reference track (harmonic-aware). */
  bpmDelta: number;
  /** Overall mixability score in [0,1]. */
  score: number;
  tier: CompatibilityTier;
}

export type DeckStatus =
  | "empty"
  | "loading"
  | "ready"
  | "playing"
  | "paused"
  | "ended";

export interface DeckState {
  id: DeckId;
  track: Track | null;
  analysis: TrackAnalysis | null;
  analysisPending: boolean;
  status: DeckStatus;
  currentTime: number;
  duration: number;
  /** 0..1 — the automated fader position for this deck. */
  volume: number;
}

export interface CrossfadeState {
  active: boolean;
  /**
   * "arming" — the incoming deck is buffering; the outgoing deck holds full
   * volume so there is never a hole in the audio. "ramping" — both faders
   * are riding the configured curve.
   */
  phase: "arming" | "ramping";
  /** 0..1 progress through the ramp. */
  progress: number;
  from: DeckId;
  to: DeckId;
  durationMs: number;
}

export type SuggestionPhase = "idle" | "scanning" | "ready" | "exhausted";

export interface EngineState {
  decks: Record<DeckId, DeckState>;
  activeDeck: DeckId;
  queue: Track[];
  crossfade: CrossfadeState;
  suggestionPhase: SuggestionPhase;
  candidates: MixCandidate[];
  bestCandidate: MixCandidate | null;
  /** Seconds remaining on the active deck before the auto-fade fires (null = far away). */
  autoFadeCountdown: number | null;
  /** Master transport state. */
  transport: "stopped" | "playing" | "paused";
  /** Rolling event log for the HUD ticker. */
  log: EngineLogEntry[];
}

export interface EngineLogEntry {
  id: number;
  at: number;
  text: string;
  kind: "info" | "mix" | "ai" | "warn";
}

export interface SearchState {
  status: "idle" | "searching" | "done" | "error";
  query: string;
  results: Track[];
  /** Which backend actually served the results. */
  servedBy: string | null;
}
