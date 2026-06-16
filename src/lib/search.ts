import type { Track } from "../types";
import { settingsStore } from "./settings";

/**
 * Streaming search — resolves real, playable YouTube tracks without ever
 * downloading media. Resolution order:
 *
 *  1. Official YouTube Data API v3, when the user has supplied a (free) API
 *     key in SETTINGS — full catalogue, every song findable.
 *  2. The entire pool of public Piped / Invidious gateways raced in
 *     parallel; the first non-empty answer wins, so dead instances cost
 *     nothing but their timeout.
 *  3. A curated, embeddable onboard library so the app never dead-ends.
 */

const PIPED_INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://api.piped.private.coffee",
  "https://pipedapi.reallyaweso.me",
  "https://pipedapi.ducks.party",
  "https://api.piped.yt",
];

const INVIDIOUS_INSTANCES = [
  "https://yewtu.be",
  "https://inv.nadeko.net",
  "https://invidious.nerdvpn.de",
  "https://iv.melmac.space",
  "https://invidious.f5.si",
  "https://invidious.private.coffee",
];

const REQUEST_TIMEOUT_MS = 6_000;

/**
 * Hard catalogue policy: only proper single songs are mixable.
 * Anything over 5 minutes is almost always a multi-song mix/compilation,
 * and anything under a minute is a short/ident; livestreams and unknown
 * durations (0) have no end to mix out of. All are excluded categorically.
 */
const MIN_TRACK_SECONDS = 60;
const MAX_TRACK_SECONDS = 300;

function isMixableDuration(seconds: number): boolean {
  return seconds >= MIN_TRACK_SECONDS && seconds <= MAX_TRACK_SECONDS;
}

function fetchJSON(url: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<unknown>;
    })
    .finally(() => window.clearTimeout(timer));
}

function thumbFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

/* ------------------------- official Data API v3 -------------------------- */

interface ApiSearchItem {
  id?: { videoId?: string };
  snippet?: { title?: string; channelTitle?: string };
}

interface ApiVideoItem {
  id?: string;
  contentDetails?: { duration?: string };
}

/** ISO-8601 duration (PT3M21S) → seconds. */
function parseIsoDuration(iso: string): number {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return 0;
  return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function searchOfficial(query: string, key: string, limit: number): Promise<Track[]> {
  const searchUrl =
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video` +
    `&maxResults=${Math.min(25, limit + 6)}&q=${encodeURIComponent(query)}` +
    `&videoEmbeddable=true&key=${encodeURIComponent(key)}`;
  const data = (await fetchJSON(searchUrl)) as { items?: ApiSearchItem[] };
  const items = (data.items ?? []).filter((it) => it.id?.videoId);
  if (items.length === 0) return [];

  const ids = items.map((it) => it.id!.videoId!).join(",");
  const durations = new Map<string, number>();
  try {
    const det = (await fetchJSON(
      `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids}` +
        `&key=${encodeURIComponent(key)}`,
    )) as { items?: ApiVideoItem[] };
    for (const v of det.items ?? []) {
      if (v.id) durations.set(v.id, parseIsoDuration(v.contentDetails?.duration ?? ""));
    }
  } catch {
    // durations are nice-to-have; the player reports them anyway
  }

  const mapped = items.map((it) => ({
    id: it.id!.videoId!,
    title: decodeEntities(it.snippet?.title ?? "Untitled"),
    artist: decodeEntities(it.snippet?.channelTitle ?? "Unknown artist"),
    duration: durations.get(it.id!.videoId!) ?? 0,
    thumbnail: thumbFor(it.id!.videoId!),
    source: "official" as const,
  }));
  // Apply the duration policy only when we actually know the durations —
  // if the details call failed, returning results beats returning nothing.
  return durations.size > 0 ? mapped.filter((t) => isMixableDuration(t.duration)) : mapped;
}

/** Cheap key validation for the SETTINGS tool. */
export async function testApiKey(key: string): Promise<{ ok: boolean; message: string }> {
  try {
    const tracks = await searchOfficial("music", key, 1);
    return tracks.length > 0
      ? { ok: true, message: "KEY VALID — FULL CATALOGUE UNLOCKED" }
      : { ok: false, message: "KEY ACCEPTED BUT RETURNED NO RESULTS" };
  } catch (e) {
    return { ok: false, message: `KEY REJECTED (${(e as Error).message})` };
  }
}

/* ------------------------------- Piped ---------------------------------- */

interface PipedItem {
  url?: string;
  title?: string;
  uploaderName?: string;
  duration?: number;
  thumbnail?: string;
  type?: string;
}

function mapPiped(items: PipedItem[]): Track[] {
  const out: Track[] = [];
  for (const it of items) {
    if (it.type && it.type !== "stream") continue;
    const m = /v=([\w-]{11})/.exec(it.url ?? "");
    if (!m) continue;
    const duration = typeof it.duration === "number" ? Math.max(0, it.duration) : 0;
    if (!isMixableDuration(duration)) continue; // shorts, live, multi-song mixes
    out.push({
      id: m[1],
      title: (it.title ?? "Untitled").trim(),
      artist: (it.uploaderName ?? "Unknown artist").trim(),
      duration,
      thumbnail: it.thumbnail || thumbFor(m[1]),
      source: "piped",
    });
  }
  return out;
}

async function searchPiped(base: string, query: string): Promise<Track[]> {
  const data = (await fetchJSON(
    `${base}/search?q=${encodeURIComponent(query)}&filter=videos`,
  )) as { items?: PipedItem[] };
  return mapPiped(data.items ?? []);
}

/* ----------------------------- Invidious -------------------------------- */

interface InvidiousItem {
  videoId?: string;
  title?: string;
  author?: string;
  lengthSeconds?: number;
}

async function searchInvidious(base: string, query: string): Promise<Track[]> {
  const data = (await fetchJSON(
    `${base}/api/v1/search?q=${encodeURIComponent(query)}&type=video`,
  )) as InvidiousItem[];
  const out: Track[] = [];
  for (const it of Array.isArray(data) ? data : []) {
    if (!it.videoId) continue;
    const duration =
      typeof it.lengthSeconds === "number" ? Math.max(0, it.lengthSeconds) : 0;
    if (!isMixableDuration(duration)) continue; // shorts, live, multi-song mixes
    out.push({
      id: it.videoId,
      title: (it.title ?? "Untitled").trim(),
      artist: (it.author ?? "Unknown artist").trim(),
      duration,
      thumbnail: thumbFor(it.videoId),
      source: "invidious",
    });
  }
  return out;
}

/* -------------------------- Curated fallback ----------------------------- */

export const CURATED_LIBRARY: Track[] = [
  { id: "y6120QOlsfU", title: "Sandstorm", artist: "Darude", duration: 225, thumbnail: thumbFor("y6120QOlsfU"), source: "library" },
  { id: "k85mRPqvMbE", title: "Crab Rave", artist: "Noisestorm", duration: 168, thumbnail: thumbFor("k85mRPqvMbE"), source: "library" },
  { id: "bM7SZ5SBzyY", title: "Faded", artist: "Alan Walker", duration: 212, thumbnail: thumbFor("bM7SZ5SBzyY"), source: "library" },
  { id: "60ItHLz5WEA", title: "Alone", artist: "Alan Walker", duration: 161, thumbnail: thumbFor("60ItHLz5WEA"), source: "library" },
  { id: "IcrbM1l_BoI", title: "Wake Me Up", artist: "Avicii", duration: 273, thumbnail: thumbFor("IcrbM1l_BoI"), source: "library" },
  { id: "gCYcHz2k5x0", title: "Levels", artist: "Avicii", duration: 219, thumbnail: thumbFor("gCYcHz2k5x0"), source: "library" },
  { id: "fzQ6gRAEoy0", title: "I Took A Pill In Ibiza (Seeb Remix)", artist: "Mike Posner", duration: 197, thumbnail: thumbFor("fzQ6gRAEoy0"), source: "library" },
  { id: "papuvlVeZg8", title: "Get Lucky", artist: "Daft Punk ft. Pharrell Williams", duration: 248, thumbnail: thumbFor("papuvlVeZg8"), source: "library" },
  { id: "5NV6Rdv1a3I", title: "Get Low", artist: "Dillon Francis & DJ Snake", duration: 213, thumbnail: thumbFor("5NV6Rdv1a3I"), source: "library" },
  { id: "YqeW9_5kURI", title: "Lean On", artist: "Major Lazer & DJ Snake ft. MØ", duration: 178, thumbnail: thumbFor("YqeW9_5kURI"), source: "library" },
  { id: "kJQP7kiw5Fk", title: "Despacito", artist: "Luis Fonsi ft. Daddy Yankee", duration: 282, thumbnail: thumbFor("kJQP7kiw5Fk"), source: "library" },
  { id: "JGwWNGJdvx8", title: "Shape of You", artist: "Ed Sheeran", duration: 263, thumbnail: thumbFor("JGwWNGJdvx8"), source: "library" },
  { id: "OPf0YbXqDm0", title: "Uptown Funk", artist: "Mark Ronson ft. Bruno Mars", duration: 270, thumbnail: thumbFor("OPf0YbXqDm0"), source: "library" },
  { id: "hT_nvWreIhg", title: "Counting Stars", artist: "OneRepublic", duration: 257, thumbnail: thumbFor("hT_nvWreIhg"), source: "library" },
  { id: "ktvTqknDobU", title: "Radioactive", artist: "Imagine Dragons", duration: 187, thumbnail: thumbFor("ktvTqknDobU"), source: "library" },
];

function curatedSearch(query: string): Track[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...CURATED_LIBRARY];
  const scored = CURATED_LIBRARY.map((t) => {
    const hay = `${t.title} ${t.artist}`.toLowerCase();
    const hits = tokens.reduce((n, tok) => n + (hay.includes(tok) ? 1 : 0), 0);
    return { t, hits };
  }).filter((s) => s.hits > 0);
  scored.sort((a, b) => b.hits - a.hits);
  return scored.length > 0 ? scored.map((s) => s.t) : [...CURATED_LIBRARY];
}

/* ------------------------------ Public API ------------------------------- */

export interface SearchOutcome {
  tracks: Track[];
  servedBy: string;
}

/** Resolves when the first attempt yields a non-empty track list. */
function firstNonEmpty(
  attempts: Array<{ name: string; run: () => Promise<Track[]> }>,
): Promise<SearchOutcome | null> {
  return new Promise((resolve) => {
    let pending = attempts.length;
    if (pending === 0) {
      resolve(null);
      return;
    }
    let done = false;
    for (const a of attempts) {
      a.run()
        .then((tracks) => {
          if (!done && tracks.length > 0) {
            done = true;
            resolve({ tracks, servedBy: a.name });
          }
        })
        .catch(() => undefined)
        .finally(() => {
          pending -= 1;
          if (pending === 0 && !done) resolve(null);
        });
    }
  });
}

/**
 * Never rejects — official API first, then the whole gateway pool in
 * parallel, then the onboard library.
 */
export async function searchTracks(query: string, limit = 12): Promise<SearchOutcome> {
  const { apiKey } = settingsStore.get();

  if (apiKey.trim()) {
    try {
      const tracks = await searchOfficial(query, apiKey.trim(), limit);
      if (tracks.length > 0) {
        return { tracks: dedupe(tracks).slice(0, limit), servedBy: "youtube data api" };
      }
    } catch {
      // quota exhausted / key revoked — fall through to gateways
    }
  }

  const attempts = [
    ...PIPED_INSTANCES.map((base) => ({
      name: new URL(base).host,
      run: () => searchPiped(base, query),
    })),
    ...INVIDIOUS_INSTANCES.map((base) => ({
      name: new URL(base).host,
      run: () => searchInvidious(base, query),
    })),
  ];

  const won = await firstNonEmpty(attempts);
  if (won) return { tracks: dedupe(won.tracks).slice(0, limit), servedBy: won.servedBy };

  return { tracks: curatedSearch(query).slice(0, limit), servedBy: "onboard library" };
}

function dedupe(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  return tracks.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

/* ----------------------------- diagnostics ------------------------------- */

export interface GatewayStatus {
  host: string;
  kind: "piped" | "invidious";
  ok: boolean;
  latencyMs: number | null;
}

/** Pings every gateway for the SETTINGS diagnostics panel. */
export async function pingGateways(): Promise<GatewayStatus[]> {
  const probes: Array<Promise<GatewayStatus>> = [
    ...PIPED_INSTANCES.map((base) => probe(base, "piped", () => searchPiped(base, "music"))),
    ...INVIDIOUS_INSTANCES.map((base) =>
      probe(base, "invidious", () => searchInvidious(base, "music")),
    ),
  ];
  return Promise.all(probes);
}

async function probe(
  base: string,
  kind: GatewayStatus["kind"],
  run: () => Promise<Track[]>,
): Promise<GatewayStatus> {
  const host = new URL(base).host;
  const started = performance.now();
  try {
    const tracks = await run();
    return {
      host,
      kind,
      ok: tracks.length > 0,
      latencyMs: Math.round(performance.now() - started),
    };
  } catch {
    return { host, kind, ok: false, latencyMs: null };
  }
}
