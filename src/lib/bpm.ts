import type { BpmSource, CompatibilityTier, Track, TrackAnalysis } from "../types";

/**
 * Web-safe audio analysis engine.
 *
 * Two analysis paths, tried in order:
 *
 *  1. DSP — when a CORS-accessible audio stream for the track can be fetched
 *     (Piped exposes proxied audio for many videos), we decode ~30s with the
 *     Web Audio API and run a real tempo estimator: a short-time energy onset
 *     envelope followed by autocorrelation over the 60–180 BPM lag window.
 *
 *  2. MODEL — YouTube iframe audio is cross-origin and cannot be tapped, so
 *     when no analysable stream exists we fall back to a deterministic
 *     metadata model: genre inference from title/artist keywords anchors a
 *     BPM range, and a stable hash of the video id places the track inside
 *     that range. The same track always yields the same BPM, so beatmatching
 *     decisions stay consistent across sessions.
 */

/* ----------------------------- genre model ------------------------------ */

interface GenreProfile {
  genre: string;
  keywords: string[];
  bpmMin: number;
  bpmMax: number;
  energy: number;
}

const GENRE_PROFILES: GenreProfile[] = [
  { genre: "DRUM & BASS", keywords: ["drum and bass", "drum & bass", "dnb", "d&b", "neurofunk", "liquid funk", "jungle"], bpmMin: 170, bpmMax: 178, energy: 0.95 },
  { genre: "DUBSTEP", keywords: ["dubstep", "riddim", "brostep"], bpmMin: 138, bpmMax: 144, energy: 0.92 },
  { genre: "TECHNO", keywords: ["techno", "berghain", "rave", "acid", "industrial"], bpmMin: 126, bpmMax: 134, energy: 0.88 },
  { genre: "TRANCE", keywords: ["trance", "uplifting", "psytrance", "asot"], bpmMin: 132, bpmMax: 140, energy: 0.85 },
  { genre: "HARDSTYLE", keywords: ["hardstyle", "hardcore", "gabber"], bpmMin: 150, bpmMax: 160, energy: 0.97 },
  { genre: "HOUSE", keywords: ["house", "deep house", "tech house", "ibiza", "club mix", "edm", "festival", "big room", "progressive"], bpmMin: 120, bpmMax: 128, energy: 0.8 },
  { genre: "TRAP / BASS", keywords: ["trap", "bass boosted", "phonk", "drill"], bpmMin: 140, bpmMax: 160, energy: 0.83 },
  { genre: "HIP-HOP", keywords: ["hip hop", "hip-hop", "rap", "freestyle", "boom bap"], bpmMin: 84, bpmMax: 100, energy: 0.65 },
  { genre: "R&B / SOUL", keywords: ["r&b", "rnb", "soul", "slow jam"], bpmMin: 70, bpmMax: 95, energy: 0.5 },
  { genre: "LO-FI", keywords: ["lofi", "lo-fi", "chillhop", "study", "relax", "beats to"], bpmMin: 70, bpmMax: 90, energy: 0.35 },
  { genre: "AMBIENT", keywords: ["ambient", "drone", "meditation", "sleep"], bpmMin: 60, bpmMax: 80, energy: 0.2 },
  { genre: "DISCO / FUNK", keywords: ["disco", "funk", "nu-disco", "groove"], bpmMin: 110, bpmMax: 120, energy: 0.75 },
  { genre: "ROCK", keywords: ["rock", "metal", "punk", "guitar"], bpmMin: 100, bpmMax: 140, energy: 0.8 },
  { genre: "LATIN", keywords: ["reggaeton", "latin", "despacito", "salsa", "bachata"], bpmMin: 90, bpmMax: 105, energy: 0.7 },
  { genre: "POP", keywords: ["pop", "official video", "official audio", "lyrics", "vevo"], bpmMin: 98, bpmMax: 122, energy: 0.6 },
];

const DEFAULT_PROFILE: GenreProfile = {
  genre: "ELECTRONIC",
  keywords: [],
  bpmMin: 110,
  bpmMax: 128,
  energy: 0.7,
};

function classifyGenre(track: Track): GenreProfile {
  const hay = `${track.title} ${track.artist}`.toLowerCase();
  let best: GenreProfile | null = null;
  let bestHits = 0;
  for (const p of GENRE_PROFILES) {
    const hits = p.keywords.reduce((n, k) => n + (hay.includes(k) ? 1 : 0), 0);
    if (hits > bestHits) {
      bestHits = hits;
      best = p;
    }
  }
  return best ?? DEFAULT_PROFILE;
}

/** FNV-1a — stable per-track randomness for the model path. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const CAMELOT_WHEEL = [
  "1A", "2A", "3A", "4A", "5A", "6A", "7A", "8A", "9A", "10A", "11A", "12A",
  "1B", "2B", "3B", "4B", "5B", "6B", "7B", "8B", "9B", "10B", "11B", "12B",
];

function modelAnalysis(track: Track): TrackAnalysis {
  const profile = classifyGenre(track);
  const h = hash32(track.id);
  const span = profile.bpmMax - profile.bpmMin;
  const bpm = profile.bpmMin + ((h % 1000) / 1000) * span;
  return {
    bpm: Math.round(bpm * 10) / 10,
    confidence: 0.62 + ((h >>> 10) % 200) / 1000,
    genre: profile.genre,
    energy: Math.min(1, profile.energy + (((h >>> 20) % 100) / 100 - 0.5) * 0.15),
    camelotKey: CAMELOT_WHEEL[h % CAMELOT_WHEEL.length],
    source: "model",
  };
}

/* ------------------------------- DSP path ------------------------------- */

const ANALYSIS_SECONDS = 30;

/**
 * Real tempo estimation over a decoded buffer:
 * energy-onset envelope (~86 frames/s) -> mean-removed autocorrelation over
 * the 60–180 BPM lag range -> parabolic-free peak pick with octave folding.
 */
export function detectBpmFromBuffer(buffer: AudioBuffer): { bpm: number; confidence: number } | null {
  const sr = buffer.sampleRate;
  const data = buffer.getChannelData(0);
  const hop = Math.floor(sr / 86);
  const frames = Math.floor(data.length / hop);
  if (frames < 86 * 8) return null; // need ≥ ~8s of material

  // Short-time energy envelope.
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let acc = 0;
    const off = f * hop;
    for (let i = 0; i < hop; i++) acc += data[off + i] * data[off + i];
    env[f] = Math.sqrt(acc / hop);
  }

  // Half-wave rectified differential = onset strength.
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f++) onset[f] = Math.max(0, env[f] - env[f - 1]);

  let mean = 0;
  for (let f = 0; f < frames; f++) mean += onset[f];
  mean /= frames;
  for (let f = 0; f < frames; f++) onset[f] -= mean;

  const fps = sr / hop;
  const minLag = Math.floor((60 / 180) * fps); // 180 BPM
  const maxLag = Math.ceil((60 / 60) * fps); // 60 BPM

  let bestLag = -1;
  let bestVal = -Infinity;
  let energy0 = 0;
  for (let f = 0; f < frames; f++) energy0 += onset[f] * onset[f];
  if (energy0 <= 0) return null;

  for (let lag = minLag; lag <= maxLag && lag < frames; lag++) {
    let acc = 0;
    for (let f = 0; f + lag < frames; f++) acc += onset[f] * onset[f + lag];
    // Mild bias toward club tempos so harmonics don't win by noise.
    const bpm = (60 * fps) / lag;
    const bias = 1 - Math.abs(bpm - 120) / 400;
    const val = (acc / energy0) * bias;
    if (val > bestVal) {
      bestVal = val;
      bestLag = lag;
    }
  }
  if (bestLag <= 0 || bestVal <= 0.01) return null;

  let bpm = (60 * fps) / bestLag;
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return { bpm: Math.round(bpm * 10) / 10, confidence: Math.min(0.98, 0.55 + bestVal) };
}

const AUDIO_PROXY_BASES = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
];

async function fetchAnalysableBuffer(videoId: string): Promise<AudioBuffer | null> {
  for (const base of AUDIO_PROXY_BASES) {
    try {
      const ctrl = new AbortController();
      const t = window.setTimeout(() => ctrl.abort(), 6_000);
      const meta = (await fetch(`${base}/streams/${videoId}`, { signal: ctrl.signal }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })) as { audioStreams?: Array<{ url?: string; mimeType?: string; bitrate?: number }> };
      window.clearTimeout(t);

      const stream = (meta.audioStreams ?? [])
        .filter((s) => s.url && /audio\/(mp4|webm)/.test(s.mimeType ?? ""))
        .sort((a, b) => (a.bitrate ?? 0) - (b.bitrate ?? 0))[0];
      if (!stream?.url) continue;

      const audioCtrl = new AbortController();
      const t2 = window.setTimeout(() => audioCtrl.abort(), 10_000);
      // Range-limit the fetch — ~700KB of low-bitrate audio ≈ 30–40s of material.
      const res = await fetch(stream.url, {
        signal: audioCtrl.signal,
        headers: { Range: "bytes=0-716800" },
      });
      window.clearTimeout(t2);
      if (!res.ok && res.status !== 206) continue;
      const bytes = await res.arrayBuffer();

      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      try {
        const buffer = await ctx.decodeAudioData(bytes.slice(0));
        return buffer.duration >= 8 ? trimBuffer(ctx, buffer, ANALYSIS_SECONDS) : null;
      } finally {
        void ctx.close();
      }
    } catch {
      // gateway unreachable / stream not proxyable — try the next base
    }
  }
  return null;
}

function trimBuffer(ctx: AudioContext, buffer: AudioBuffer, seconds: number): AudioBuffer {
  if (buffer.duration <= seconds) return buffer;
  const frames = Math.floor(seconds * buffer.sampleRate);
  const out = ctx.createBuffer(1, frames, buffer.sampleRate);
  out.getChannelData(0).set(buffer.getChannelData(0).subarray(0, frames));
  return out;
}

/* ------------------------------ Public API ------------------------------- */

const analysisCache = new Map<string, TrackAnalysis>();

export async function analyzeTrack(track: Track): Promise<TrackAnalysis> {
  const cached = analysisCache.get(track.id);
  if (cached) return cached;

  let result: TrackAnalysis | null = null;
  try {
    const buffer = await fetchAnalysableBuffer(track.id);
    if (buffer) {
      const dsp = detectBpmFromBuffer(buffer);
      if (dsp) {
        const model = modelAnalysis(track);
        result = {
          ...model,
          bpm: dsp.bpm,
          confidence: dsp.confidence,
          source: "dsp" as BpmSource,
        };
      }
    }
  } catch {
    // DSP path is strictly best-effort
  }

  if (!result) result = modelAnalysis(track);
  analysisCache.set(track.id, result);
  return result;
}

/**
 * Instant, network-free analysis (model path only). Used to score large
 * candidate pools; the full DSP pass runs once a track actually hits a deck.
 */
export function quickAnalyze(track: Track): TrackAnalysis {
  return analysisCache.get(track.id) ?? modelAnalysis(track);
}

/* -------------------------- compatibility model -------------------------- */

/** Harmonic-aware BPM distance: half/double-time mixes count as close. */
export function bpmDistance(a: number, b: number): number {
  return Math.min(Math.abs(a - b), Math.abs(a - b * 2), Math.abs(a * 2 - b), Math.abs(a - b / 2));
}

export function tierFor(delta: number): CompatibilityTier {
  if (delta <= 2.5) return "perfect";
  if (delta <= 7) return "compatible";
  return "stretch";
}

export function mixScore(reference: TrackAnalysis, candidate: TrackAnalysis): number {
  const delta = bpmDistance(reference.bpm, candidate.bpm);
  const bpmScore = Math.max(0, 1 - delta / 16);
  const energyScore = 1 - Math.min(1, Math.abs(reference.energy - candidate.energy));
  const genreScore = reference.genre === candidate.genre ? 1 : 0.55;
  const keyScore = camelotAffinity(reference.camelotKey, candidate.camelotKey);
  return bpmScore * 0.55 + energyScore * 0.15 + genreScore * 0.2 + keyScore * 0.1;
}

function camelotAffinity(a: string, b: string): number {
  if (a === b) return 1;
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  const ringDist = Math.min(Math.abs(na - nb), 12 - Math.abs(na - nb));
  const sameMode = a.endsWith(b.slice(-1));
  if (ringDist === 0) return 0.9; // relative major/minor
  if (ringDist === 1 && sameMode) return 0.8; // adjacent on the wheel
  return Math.max(0.2, 0.6 - ringDist * 0.08);
}

/** Seed queries the Auto-DJ uses to scout candidates for a given track. */
export function suggestionQueries(track: Track, analysis: TrackAnalysis): string[] {
  const primaryArtist = track.artist.replace(/\s*-\s*topic$/i, "").trim();
  const genre = analysis.genre.toLowerCase().replace(/[^a-z& -]/g, "");
  return [
    `${primaryArtist} mix`,
    `${genre} ${Math.round(analysis.bpm)} bpm`,
    `${genre} mix`,
  ];
}
