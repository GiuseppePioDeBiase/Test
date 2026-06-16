import type {
  DeckId,
  DeckState,
  EngineLogEntry,
  EngineState,
  MixCandidate,
  Track,
} from "../types";
import { DeckPlayer } from "./youtube";
import {
  analyzeTrack,
  bpmDistance,
  mixScore,
  quickAnalyze,
  suggestionQueries,
  tierFor,
} from "./bpm";
import { searchTracks } from "./search";
import { CURATED_LIBRARY } from "./search";
import {
  recordHistory,
  settingsStore,
  type EngineSettings,
  type FadeCurve,
} from "./settings";

/** The idle deck pre-buffers the next track this many seconds before the fade. */
const PRELOAD_LEAD_SECONDS = 11;
/** Max time the engine waits for the incoming stream before ramping anyway. */
const ARM_TIMEOUT_MS = 5_000;
/** Engine clock. */
const TICK_MS = 150;

/**
 * Volume automation curves. "smooth" (S-curve) is the Spotify-like default:
 * gentle in, gentle out, with the energy handover concentrated mid-fade.
 * "power" is the classic constant-energy DJ fade.
 */
function fadeGains(curve: FadeCurve, p: number): { out: number; in: number } {
  switch (curve) {
    case "linear":
      return { out: 1 - p, in: p };
    case "power":
      return { out: Math.cos((p * Math.PI) / 2), in: Math.sin((p * Math.PI) / 2) };
    case "smooth": {
      const s = p * p * (3 - 2 * p);
      return { out: 1 - s, in: s };
    }
  }
}

export interface BlendPlan {
  durationMs: number;
  curve: FadeCurve;
  label: string;
}

/**
 * Smart Blend — what makes this better than a fixed-length crossfade:
 * the transition adapts to how well the two tracks actually fit.
 * Perfect tempo matches earn a long, constant-energy seamless blend;
 * harmonic neighbours get the user's base fade; tempo clashes get a quick
 * S-curve swap so the rhythmic mismatch is never audible for long.
 */
export function planBlend(
  refBpm: number | null,
  incomingBpm: number | null,
  settings: EngineSettings,
): BlendPlan {
  const { fadeDurationMs, fadeCurve, smartFade } = settings;
  if (!smartFade || refBpm === null || incomingBpm === null) {
    return { durationMs: fadeDurationMs, curve: fadeCurve, label: "FIXED BLEND" };
  }
  const delta = bpmDistance(refBpm, incomingBpm);
  if (delta <= 2.5) {
    return {
      durationMs: Math.min(12_000, Math.round(fadeDurationMs * 1.5)),
      curve: "power",
      label: "LONG SEAMLESS BLEND",
    };
  }
  if (delta <= 7) {
    return { durationMs: fadeDurationMs, curve: fadeCurve, label: "STANDARD BLEND" };
  }
  return {
    durationMs: Math.max(3_000, Math.round(fadeDurationMs * 0.55)),
    curve: "smooth",
    label: "QUICK SWAP — TEMPO CLASH",
  };
}

/** Longest fade Smart Blend may choose — the mix point must leave room for it. */
function maxBlendMs(settings: EngineSettings): number {
  return settings.smartFade
    ? Math.min(12_000, Math.round(settings.fadeDurationMs * 1.5))
    : settings.fadeDurationMs;
}

const MAX_LOG = 28;

function emptyDeck(id: DeckId): DeckState {
  return {
    id,
    track: null,
    analysis: null,
    analysisPending: false,
    status: "empty",
    currentTime: 0,
    duration: 0,
    volume: id === "A" ? 1 : 0,
  };
}

/**
 * The autonomous mixing brain. Owns both embedded players, the queue, the
 * candidate scout and the crossfade automation. Pure TS — the UI subscribes
 * to immutable snapshots.
 */
export class AutoDJEngine {
  private players: Record<DeckId, DeckPlayer>;
  private state: EngineState;
  private snapshot: EngineState;
  private listeners = new Set<() => void>();
  private tickTimer: number | null = null;
  private fadeRaf: number | null = null;
  private fadeStartedAt = 0;
  private logSeq = 0;
  private cuedOnIdle: string | null = null;
  private scoutToken = 0;
  private recentlyPlayed: string[] = [];
  private destroyed = false;

  constructor(containerA: HTMLElement, containerB: HTMLElement) {
    this.players = {
      A: new DeckPlayer(containerA),
      B: new DeckPlayer(containerB),
    };
    this.state = {
      decks: { A: emptyDeck("A"), B: emptyDeck("B") },
      activeDeck: "A",
      queue: [],
      crossfade: {
        active: false,
        phase: "arming",
        progress: 0,
        from: "A",
        to: "B",
        durationMs: settingsStore.get().fadeDurationMs,
      },
      suggestionPhase: "idle",
      candidates: [],
      bestCandidate: null,
      autoMixEnabled: true,
      autoPickId: null,
      mixPoint: null,
      mixCountdown: null,
      autoFadeCountdown: null,
      transport: "stopped",
      log: [],
    };
    this.log("ENGINE ONLINE — DUAL DECK STANDBY", "info");
    this.snapshot = this.clone();

    this.players.A.on((e) => this.onPlayerEvent("A", e.type === "error" ? "error" : e.type));
    this.players.B.on((e) => this.onPlayerEvent("B", e.type === "error" ? "error" : e.type));

    this.tickTimer = window.setInterval(() => this.tick(), TICK_MS);
  }

  /** Reacts to raw iframe player state changes (natural end, stream errors). */
  private onPlayerEvent(id: DeckId, type: string) {
    const deck = this.state.decks[id];
    if (type === "ended") {
      if (this.state.crossfade.active) return; // completion handler owns this
      if (id !== this.state.activeDeck || !deck.track) return;
      // Track ran out with nothing to mix into — wind the engine down.
      deck.status = "ended";
      this.state.transport = "stopped";
      this.state.autoFadeCountdown = null;
      this.state.mixPoint = null;
      this.state.mixCountdown = null;
      this.log(`DECK ${id} ▸ TRACK ENDED — NO NEXT MATERIAL`, "warn");
      this.notify();
    } else if (type === "error") {
      if (!deck.track) return;
      this.log(`DECK ${id} ▸ STREAM ERROR — ADVANCING`, "warn");
      if (id === this.state.activeDeck && !this.state.crossfade.active) {
        if (this.ensureNextAvailable()) {
          this.beginCrossfade("skip");
        } else {
          deck.status = "ended";
          this.state.transport = "stopped";
          this.notify();
        }
      }
    } else if (type === "playing" && deck.status === "loading") {
      deck.status = "playing";
      this.notify();
    }
  }

  /* ----------------------------- subscriptions --------------------------- */

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): EngineState => this.snapshot;

  private clone(): EngineState {
    const s = this.state;
    return {
      ...s,
      decks: { A: { ...s.decks.A }, B: { ...s.decks.B } },
      queue: [...s.queue],
      crossfade: { ...s.crossfade },
      candidates: [...s.candidates],
      log: [...s.log],
    };
  }

  private notify() {
    this.snapshot = this.clone();
    this.listeners.forEach((fn) => fn());
  }

  private log(text: string, kind: EngineLogEntry["kind"]) {
    this.state.log = [
      { id: this.logSeq++, at: Date.now(), text, kind },
      ...this.state.log,
    ].slice(0, MAX_LOG);
  }

  /* ------------------------------- transport ----------------------------- */

  private idleDeck(): DeckId {
    return this.state.activeDeck === "A" ? "B" : "A";
  }

  /** Load a track and start playing it immediately on the best deck. */
  async playNow(track: Track): Promise<void> {
    const target = this.state.transport === "stopped" ? this.state.activeDeck : this.idleDeck();
    if (this.state.transport !== "stopped" && !this.state.crossfade.active) {
      // Treat as an instant DJ takeover: hard-swap via forced crossfade.
      this.state.queue = [track, ...this.state.queue];
      this.notify();
      this.beginCrossfade("manual load");
      return;
    }
    const deck = this.state.decks[target];
    deck.track = track;
    deck.status = "loading";
    deck.analysis = null;
    deck.analysisPending = true;
    deck.currentTime = 0;
    deck.duration = track.duration;
    deck.volume = 1;
    this.state.activeDeck = target;
    this.state.transport = "playing";
    this.cuedOnIdle = null;
    this.log(`DECK ${target} ▸ LOADING "${track.title.toUpperCase().slice(0, 42)}"`, "info");
    this.notify();

    try {
      await this.players[target].load(track.id, 100);
    } catch {
      deck.status = "empty";
      this.log(`DECK ${target} ▸ STREAM UNAVAILABLE`, "warn");
      this.notify();
      return;
    }
    this.rememberPlayed(track);
    this.syncIdleDeck();
    this.notify();
    void this.analyzeDeck(target, track);
    this.scoutCandidates(track);
  }

  enqueue(track: Track) {
    if (this.state.queue.some((t) => t.id === track.id)) return;
    // A user choice always replaces the AI's own provisional pick.
    if (this.state.autoPickId && this.state.queue[0]?.id === this.state.autoPickId) {
      this.state.queue = [track, ...this.state.queue.slice(1)];
      this.state.autoPickId = null;
      this.log(`QUEUE + "${track.title.toUpperCase().slice(0, 40)}" — REPLACES AI PICK`, "info");
    } else {
      this.state.queue = [...this.state.queue, track];
      this.log(`QUEUE + "${track.title.toUpperCase().slice(0, 40)}"`, "info");
    }
    this.syncIdleDeck();
    this.notify();
  }

  acceptSuggestion(candidate: MixCandidate) {
    this.enqueue(candidate.track);
    this.state.candidates = this.state.candidates.filter(
      (c) => c.track.id !== candidate.track.id,
    );
    this.state.bestCandidate = this.state.candidates[0] ?? null;
    this.log(
      `AI PICK ACCEPTED — Δ${candidate.bpmDelta.toFixed(1)} BPM ${candidate.tier.toUpperCase()}`,
      "ai",
    );
    this.notify();
  }

  /** Master switch: when off, transitions only fire on explicit MIX NOW. */
  setAutoMix(on: boolean) {
    if (this.state.autoMixEnabled === on) return;
    this.state.autoMixEnabled = on;
    this.log(on ? "AUTO-MIX ▸ ENGAGED" : "AUTO-MIX ▸ MANUAL MODE", "info");
    this.notify();
  }

  /**
   * Puts a track first in line AND loads it onto the free deck right away —
   * visible, cued and ready, so the transition starts instantly when the
   * mix point (or MIX NOW) arrives.
   */
  armNext(track: Track) {
    if (this.state.crossfade.active) return;
    this.state.candidates = this.state.candidates.filter((c) => c.track.id !== track.id);
    this.state.bestCandidate = this.state.candidates[0] ?? null;
    if (this.state.transport === "stopped") {
      void this.playNow(track);
      return;
    }
    this.state.queue = [
      track,
      ...this.state.queue.filter((t) => t.id !== track.id && t.id !== this.state.autoPickId),
    ];
    this.state.autoPickId = null;
    this.armOnIdleDeck(track, "manual");
    this.notify();
  }

  /** Cues a track on the idle deck and surfaces it on the deck card. */
  private armOnIdleDeck(track: Track, reason: "auto" | "manual" | "queue") {
    const to = this.idleDeck();
    const deck = this.state.decks[to];
    const offset = this.entryOffsetFor(track);
    deck.track = track;
    deck.analysis = quickAnalyze(track);
    deck.analysisPending = false;
    deck.status = "ready";
    deck.currentTime = offset;
    deck.duration = track.duration;
    deck.volume = 0;
    this.cuedOnIdle = track.id;
    void this.players[to].cue(track.id, offset).catch(() => {
      this.cuedOnIdle = null;
    });
    this.log(
      reason === "auto"
        ? `DECK ${to} ▸ PRE-ARMED "${track.title.toUpperCase().slice(0, 36)}"`
        : `DECK ${to} ▸ ARMED "${track.title.toUpperCase().slice(0, 36)}" — READY FOR TRANSITION`,
      "mix",
    );
  }

  removeFromQueue(trackId: string) {
    this.state.queue = this.state.queue.filter((t) => t.id !== trackId);
    if (this.state.autoPickId === trackId) this.state.autoPickId = null;
    this.syncIdleDeck();
    this.notify();
  }

  /**
   * Keeps the free deck mirroring queue[0]: the moment a track becomes next
   * in line it appears on the deck, armed and buffering — and if the head of
   * the queue changes or empties, the deck follows.
   */
  private syncIdleDeck() {
    const s = this.state;
    if (s.crossfade.active || s.transport === "stopped") return;
    const idle = this.idleDeck();
    const deck = s.decks[idle];
    const next = s.queue[0] ?? null;
    if (!next) {
      if (deck.track && deck.status === "ready") {
        s.decks[idle] = emptyDeck(idle);
        s.decks[idle].volume = 0;
        this.cuedOnIdle = null;
      }
      return;
    }
    if (deck.track?.id === next.id) return;
    this.armOnIdleDeck(next, "queue");
  }

  pause() {
    if (this.state.transport !== "playing") return;
    this.players.A.pause();
    this.players.B.pause();
    this.state.transport = "paused";
    this.log("TRANSPORT ▸ PAUSED", "info");
    this.notify();
  }

  resume() {
    if (this.state.transport !== "paused") return;
    const active = this.state.activeDeck;
    this.players[active].play();
    if (this.state.crossfade.active) this.players[this.state.crossfade.to].play();
    this.state.transport = "playing";
    this.log("TRANSPORT ▸ RESUMED", "info");
    this.notify();
  }

  /** Forces an immediate crossfade into whatever is next. */
  skipNext() {
    if (this.state.crossfade.active) return;
    if (this.state.transport === "stopped") return;
    if (this.ensureNextAvailable()) {
      this.log("MANUAL SKIP ▸ FORCING TRANSITION", "mix");
      this.beginCrossfade("skip");
    } else {
      this.log("SKIP IGNORED — NOTHING QUEUED & NO AI PICK READY", "warn");
      this.notify();
    }
  }

  stop() {
    this.cancelFade();
    this.players.A.stop();
    this.players.B.stop();
    this.state.decks.A = emptyDeck("A");
    this.state.decks.B = emptyDeck("B");
    this.state.activeDeck = "A";
    this.state.transport = "stopped";
    this.state.autoFadeCountdown = null;
    this.state.mixPoint = null;
    this.state.mixCountdown = null;
    this.state.candidates = [];
    this.state.bestCandidate = null;
    this.state.suggestionPhase = "idle";
    this.state.autoPickId = null;
    this.cuedOnIdle = null;
    this.log("TRANSPORT ▸ HARD STOP", "warn");
    this.notify();
  }

  destroy() {
    this.destroyed = true;
    if (this.tickTimer !== null) window.clearInterval(this.tickTimer);
    this.cancelFade();
    this.players.A.destroy();
    this.players.B.destroy();
    this.listeners.clear();
  }

  /* ------------------------------ engine clock ---------------------------- */

  private tick() {
    if (this.destroyed) return;
    const s = this.state;
    let dirty = false;

    for (const id of ["A", "B"] as DeckId[]) {
      const deck = s.decks[id];
      if (!deck.track) continue;
      const t = this.players[id].getCurrentTime();
      const d = this.players[id].getDuration();
      if (Math.abs(t - deck.currentTime) > 0.05 || Math.abs(d - deck.duration) > 0.05) {
        deck.currentTime = t;
        if (d > 0) deck.duration = d;
        dirty = true;
      }
      const playing = this.players[id].isPlaying();
      if (playing && deck.status !== "playing") {
        deck.status = "playing";
        dirty = true;
      } else if (!playing && deck.status === "playing" && s.transport === "paused") {
        deck.status = "paused";
        dirty = true;
      }
    }

    const active = s.decks[s.activeDeck];
    if (s.transport === "playing" && active.track && active.duration > 0) {
      const remaining = active.duration - active.currentTime;

      // Where is the perfect moment to mix out of this track?
      const mixPoint = this.computeMixPoint(active);
      if (mixPoint !== s.mixPoint) {
        s.mixPoint = mixPoint;
        dirty = true;
      }
      const countdown =
        mixPoint !== null && !s.crossfade.active
          ? Math.round(Math.max(0, mixPoint - active.currentTime) * 10) / 10
          : null;
      if (countdown !== s.mixCountdown) {
        s.mixCountdown = countdown;
        dirty = true;
      }
      const deckChip = countdown !== null && countdown <= 20 ? countdown : null;
      if (deckChip !== s.autoFadeCountdown) {
        s.autoFadeCountdown = deckChip;
        dirty = true;
      }

      // Pre-arm the idle deck so the next track is visible and buffered.
      if (
        countdown !== null &&
        countdown <= PRELOAD_LEAD_SECONDS &&
        !s.crossfade.active &&
        this.ensureNextAvailable() &&
        this.cuedOnIdle !== s.queue[0]?.id
      ) {
        this.armOnIdleDeck(s.queue[0], "auto");
        dirty = true;
      }

      // The perfect moment arrived → curved crossfade (when AUTO is on).
      const shouldFire =
        (s.autoMixEnabled && countdown !== null && countdown <= 0) ||
        // Failsafe even in manual mode: never run off the end into silence.
        remaining <= Math.max(2, settingsStore.get().fadeDurationMs / 1000 * 0.4);
      if (shouldFire && remaining > 0.5 && !s.crossfade.active) {
        if (this.ensureNextAvailable()) {
          this.beginCrossfade("auto");
          return;
        }
      }
    } else if (s.transport === "stopped" && (s.mixPoint !== null || s.mixCountdown !== null)) {
      s.mixPoint = null;
      s.mixCountdown = null;
      dirty = true;
    }

    if (dirty) this.notify();
  }

  /**
   * The "perfect moment", governed by the EXIT auto: the phrase boundary
   * (8 bars of 4/4 at the track's BPM) nearest the chosen exit point —
   * outro, three-quarters or half — always leaving room for the full
   * crossfade. If the point is already behind the playhead (e.g. the user
   * switched mode mid-song), it snaps to the next phrase ahead instead.
   */
  private computeMixPoint(deck: DeckState): number | null {
    if (deck.duration <= 0) return null;
    const settings = settingsStore.get();
    const fadeLead = Math.max(settings.fadeTriggerSec, maxBlendMs(settings) / 1000 + 4);
    const lastUsable = deck.duration - fadeLead;
    if (lastUsable <= 0) return Math.round(Math.max(0, deck.duration - 5) * 10) / 10;

    let target = lastUsable;
    if (settings.exitMode === "half") target = Math.min(lastUsable, deck.duration * 0.5);
    else if (settings.exitMode === "threequarters")
      target = Math.min(lastUsable, deck.duration * 0.75);

    const bpm = deck.analysis?.bpm;
    const phraseSec = bpm && bpm > 0 ? (60 / bpm) * 32 : null; // 8 bars of 4/4
    let point = target;
    if (phraseSec) {
      const aligned = Math.floor(target / phraseSec) * phraseSec;
      if (aligned >= 30) point = aligned;
    }

    // Mode changed mid-song and the point is already gone: next phrase ahead.
    if (point < deck.currentTime - 1) {
      point = phraseSec
        ? Math.min(lastUsable, (Math.floor(deck.currentTime / phraseSec) + 1) * phraseSec)
        : lastUsable;
    }
    return Math.round(point * 10) / 10;
  }

  /**
   * Where the incoming track should start, governed by the ENTRY auto:
   * from the top, past the intro (one 8-bar phrase), or at its half —
   * phrase-aligned and always leaving at least a minute of material.
   */
  private entryOffsetFor(track: Track): number {
    const { entryMode } = settingsStore.get();
    if (entryMode === "start") return 0;
    const bpm = quickAnalyze(track).bpm;
    const phraseSec = (60 / bpm) * 32;
    const cap = track.duration > 0 ? Math.max(0, track.duration - 60) : Number.MAX_SAFE_INTEGER;
    if (entryMode === "skipintro") return Math.round(Math.min(phraseSec, cap));
    if (track.duration <= 0) return 0;
    const aligned = Math.floor((track.duration * 0.5) / phraseSec) * phraseSec;
    return Math.round(Math.min(aligned, cap));
  }

  /**
   * Guarantees queue[0] exists if at all possible: when the user queued
   * nothing, the Auto-DJ promotes its own best candidate.
   */
  private ensureNextAvailable(): boolean {
    if (this.state.queue.length > 0) return true;
    const pick = this.state.bestCandidate;
    if (pick) {
      this.state.queue = [pick.track];
      this.state.autoPickId = pick.track.id;
      this.state.candidates = this.state.candidates.filter(
        (c) => c.track.id !== pick.track.id,
      );
      this.state.bestCandidate = this.state.candidates[0] ?? null;
      this.log(
        `AUTO-DJ SELECTED "${pick.track.title.toUpperCase().slice(0, 36)}" — Δ${pick.bpmDelta.toFixed(1)} BPM`,
        "ai",
      );
      return true;
    }
    // Last resort — the floor never goes silent: pull something fresh from
    // the onboard library even when the scout came back empty-handed.
    const excluded = new Set<string>([
      ...this.recentlyPlayed,
      ...(["A", "B"] as DeckId[]).map((d) => this.state.decks[d].track?.id ?? ""),
    ]);
    const pool = CURATED_LIBRARY.filter((t) => !excluded.has(t.id));
    const fallback = (pool.length > 0 ? pool : CURATED_LIBRARY)[
      Math.floor(Math.random() * (pool.length > 0 ? pool.length : CURATED_LIBRARY.length))
    ];
    if (!fallback) return false;
    this.state.queue = [fallback];
    this.state.autoPickId = fallback.id;
    this.log(
      `AUTO-DJ FALLBACK ▸ "${fallback.title.toUpperCase().slice(0, 36)}" FROM ONBOARD LIBRARY`,
      "ai",
    );
    return true;
  }

  /* ------------------------------- crossfade ------------------------------ */

  private beginCrossfade(reason: "auto" | "skip" | "manual load") {
    const s = this.state;
    const from = s.activeDeck;
    const to = this.idleDeck();
    const next = s.queue[0];
    if (!next) return;
    s.queue = s.queue.slice(1);
    if (s.autoPickId === next.id) s.autoPickId = null;

    const settings = settingsStore.get();
    const blend = planBlend(
      s.decks[from].analysis?.bpm ?? null,
      quickAnalyze(next).bpm,
      settings,
    );
    const fadeDurationMs = blend.durationMs;
    const fadeCurve = blend.curve;

    // If the user (or the pre-arm pass) already cued this exact track on the
    // idle deck, it can start instantly — no reload, no buffering gap.
    const alreadyArmed = this.cuedOnIdle === next.id && s.decks[to].track?.id === next.id;

    const entryOffset = this.entryOffsetFor(next);

    const toDeck = s.decks[to];
    toDeck.track = next;
    toDeck.status = "loading";
    toDeck.analysis = quickAnalyze(next);
    toDeck.analysisPending = true;
    toDeck.currentTime = entryOffset;
    toDeck.duration = next.duration;
    toDeck.volume = 0;

    s.crossfade = {
      active: true,
      phase: "arming",
      progress: 0,
      from,
      to,
      durationMs: fadeDurationMs,
    };
    s.autoFadeCountdown = null;
    s.transport = "playing";
    this.log(
      reason === "auto"
        ? `AUTO-FADE ▸ ${from} → ${to} — ${blend.label} (${(fadeDurationMs / 1000).toFixed(1)}s)`
        : `CROSSFADE FORCED ▸ ${from} → ${to} — ${blend.label} (${(fadeDurationMs / 1000).toFixed(1)}s)`,
      "mix",
    );
    this.notify();

    if (alreadyArmed) {
      this.players[to].setVolume(0);
      this.players[to].play();
      this.rememberPlayed(next);
      void this.analyzeDeck(to, next);
    } else {
      void this.players[to]
        .load(next.id, 0, entryOffset)
        .then(() => {
          this.rememberPlayed(next);
          void this.analyzeDeck(to, next);
        })
        .catch(() => {
          this.log(`DECK ${to} ▸ STREAM FAILED — ABORTING FADE`, "warn");
          this.cancelFade();
          s.decks[to] = emptyDeck(to);
          s.decks[to].volume = 0;
          this.players[from].setVolume(100);
          s.decks[from].volume = 1;
          this.notify();
        });
    }

    // Phase 1 — ARMING: hold the outgoing deck at full volume until the
    // incoming stream is audibly rolling (or the safety timeout fires), so
    // the handover never opens a hole. This is what makes it feel like
    // Spotify's automix instead of fading into buffering silence.
    const armStarted = performance.now();
    let ramping = false;

    const run = (now: number) => {
      if (!this.state.crossfade.active || this.destroyed) return;

      if (!ramping) {
        const incomingLive = this.players[to].isPlaying();
        const timedOut = now - armStarted >= ARM_TIMEOUT_MS;
        if (incomingLive || timedOut) {
          ramping = true;
          this.state.crossfade.phase = "ramping";
          this.fadeStartedAt = now;
          this.lastFadeFrame = now;
          this.notify();
        } else {
          this.fadeRaf = requestAnimationFrame(run);
          return;
        }
      }

      if (this.state.transport === "paused") {
        // Freeze the fade while paused; resume continues where it left off.
        this.fadeStartedAt += now - this.lastFadeFrame;
      }
      this.lastFadeFrame = now;

      const p = Math.min(1, (now - this.fadeStartedAt) / fadeDurationMs);
      const g = fadeGains(fadeCurve, p);
      const outV = Math.round(g.out * 100);
      const inV = Math.round(g.in * 100);
      this.players[from].setVolume(outV);
      this.players[to].setVolume(inV);
      this.state.decks[from].volume = outV / 100;
      this.state.decks[to].volume = inV / 100;
      this.state.crossfade.progress = p;
      this.notify();
      if (p >= 1) {
        this.completeCrossfade(from, to);
      } else {
        this.fadeRaf = requestAnimationFrame(run);
      }
    };
    this.fadeRaf = requestAnimationFrame(run);
  }

  private lastFadeFrame = 0;

  private completeCrossfade(from: DeckId, to: DeckId) {
    const s = this.state;
    this.players[from].stop();
    s.decks[from] = emptyDeck(from);
    s.decks[from].volume = 0;
    s.decks[to].volume = 1;
    this.players[to].setVolume(100);
    s.activeDeck = to;
    s.crossfade = {
      active: false,
      phase: "arming",
      progress: 0,
      from,
      to,
      durationMs: settingsStore.get().fadeDurationMs,
    };
    this.cuedOnIdle = null;
    this.log(`TRANSITION COMPLETE ▸ DECK ${to} IS LIVE`, "mix");
    this.syncIdleDeck();
    this.notify();
    const live = s.decks[to].track;
    if (live) this.scoutCandidates(live);
  }

  private cancelFade() {
    if (this.fadeRaf !== null) cancelAnimationFrame(this.fadeRaf);
    this.fadeRaf = null;
    this.state.crossfade = {
      ...this.state.crossfade,
      active: false,
      phase: "arming",
      progress: 0,
    };
  }

  /* ----------------------------- intelligence ----------------------------- */

  private async analyzeDeck(id: DeckId, track: Track) {
    const deck = this.state.decks[id];
    deck.analysisPending = true;
    this.notify();
    const analysis = await analyzeTrack(track);
    if (this.destroyed) return;
    // The deck may have moved on while DSP ran.
    if (this.state.decks[id].track?.id !== track.id) return;
    this.state.decks[id].analysis = analysis;
    this.state.decks[id].analysisPending = false;
    this.log(
      `ANALYSIS ▸ ${analysis.bpm.toFixed(1)} BPM · ${analysis.genre} · KEY ${analysis.camelotKey} [${analysis.source.toUpperCase()}]`,
      "ai",
    );
    this.notify();
    if (id === this.state.activeDeck) this.scoutCandidates(track);
  }

  private rememberPlayed(track: Track) {
    this.recentlyPlayed = [
      track.id,
      ...this.recentlyPlayed.filter((x) => x !== track.id),
    ].slice(0, 24);
    recordHistory(track);
  }

  /**
   * Scouts 3–6 harmonically compatible follow-ups for the live track and
   * surfaces the best one as the glowing AI suggestion.
   */
  private scoutCandidates(reference: Track) {
    const token = ++this.scoutToken;
    const refAnalysis = this.state.decks[this.state.activeDeck].analysis ?? quickAnalyze(reference);
    this.state.suggestionPhase = "scanning";
    this.state.candidates = [];
    this.state.bestCandidate = null;
    this.log(`AI SCOUT ▸ SCANNING FOR ${Math.round(refAnalysis.bpm)} BPM MATERIAL`, "ai");
    this.notify();

    void (async () => {
      const queries = suggestionQueries(reference, refAnalysis);
      const pool = new Map<string, Track>();
      for (const q of queries) {
        if (token !== this.scoutToken || this.destroyed) return;
        try {
          const { tracks } = await searchTracks(q, 8);
          for (const t of tracks) pool.set(t.id, t);
        } catch {
          // scout queries are best-effort
        }
        if (pool.size >= 18) break;
      }
      if (token !== this.scoutToken || this.destroyed) return;

      const excluded = new Set<string>([
        reference.id,
        ...this.state.queue.map((t) => t.id),
        ...this.recentlyPlayed,
        ...(["A", "B"] as DeckId[]).map((d) => this.state.decks[d].track?.id ?? ""),
      ]);

      const candidates: MixCandidate[] = [...pool.values()]
        .filter((t) => !excluded.has(t.id))
        .map((track) => {
          const analysis = quickAnalyze(track);
          const delta = bpmDistance(refAnalysis.bpm, analysis.bpm);
          return {
            track,
            analysis,
            bpmDelta: Math.round(delta * 10) / 10,
            score: mixScore(refAnalysis, analysis),
            tier: tierFor(delta),
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 6);

      this.state.candidates = candidates;
      this.state.bestCandidate = candidates[0] ?? null;
      this.state.suggestionPhase = candidates.length > 0 ? "ready" : "exhausted";
      if (candidates.length > 0) {
        const best = candidates[0];
        this.log(
          `AI SCOUT ▸ ${candidates.length} CANDIDATES — BEST Δ${best.bpmDelta.toFixed(1)} BPM (${best.tier.toUpperCase()})`,
          "ai",
        );
        // Hands-free mode: with an empty queue the AI queues its own best
        // pick right away — visible in the queue and armed on the free deck.
        // Anything the user queues later replaces it.
        if (
          this.state.queue.length === 0 &&
          this.state.transport !== "stopped" &&
          !this.state.crossfade.active
        ) {
          this.state.queue = [best.track];
          this.state.autoPickId = best.track.id;
          this.state.candidates = this.state.candidates.filter(
            (c) => c.track.id !== best.track.id,
          );
          this.state.bestCandidate = this.state.candidates[0] ?? null;
          this.log(
            `AI PICK ▸ "${best.track.title.toUpperCase().slice(0, 36)}" QUEUED AUTOMATICALLY`,
            "ai",
          );
          this.syncIdleDeck();
        }
      } else {
        this.log("AI SCOUT ▸ NO VIABLE CANDIDATES FOUND", "warn");
      }
      this.notify();
    })();
  }
}
