import type { Track } from "../types";

/**
 * Streaming search — resolves real, playable YouTube tracks without any API
 * key and without ever downloading media. We race through a pool of public
 * Piped / Invidious gateways (both expose CORS-enabled JSON search over the
 * YouTube catalogue); whichever instance answers first wins. If the entire
 * pool is unreachable (offline demo, locked-down network) we fall back to a
 * curated, embeddable library so the experience never dead-ends.
 */

const PIPED_INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://api.piped.yt",
  "https://pipedapi.darkness.services",
];

const INVIDIOUS_INSTANCES = [
  "https://yewtu.be",
  "https://inv.nadeko.net",
  "https://invidious.nerdvpn.de",
];

const REQUEST_TIMEOUT_MS = 5_000;

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

function parseIsoOrSeconds(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, v);
  return 0;
}

function thumbFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
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
    const duration = parseIsoOrSeconds(it.duration);
    if (duration > 0 && duration < 60) continue; // skip shorts/idents
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
  const url = `${base}/search?q=${encodeURIComponent(query)}&filter=music_songs`;
  const data = (await fetchJSON(url)) as { items?: PipedItem[] };
  let tracks = mapPiped(data.items ?? []);
  if (tracks.length === 0) {
    const fallback = (await fetchJSON(
      `${base}/search?q=${encodeURIComponent(query)}&filter=videos`,
    )) as { items?: PipedItem[] };
    tracks = mapPiped(fallback.items ?? []);
  }
  return tracks;
}

/* ----------------------------- Invidious -------------------------------- */

interface InvidiousItem {
  videoId?: string;
  title?: string;
  author?: string;
  lengthSeconds?: number;
}

async function searchInvidious(base: string, query: string): Promise<Track[]> {
  const url = `${base}/api/v1/search?q=${encodeURIComponent(query)}&type=video`;
  const data = (await fetchJSON(url)) as InvidiousItem[];
  const out: Track[] = [];
  for (const it of Array.isArray(data) ? data : []) {
    if (!it.videoId) continue;
    const duration = parseIsoOrSeconds(it.lengthSeconds);
    if (duration > 0 && duration < 60) continue;
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

/**
 * Embeddable, well-known uploads spanning several genres / BPM ranges so the
 * Auto-DJ always has harmonic material to work with even fully offline from
 * the search gateways.
 */
export const CURATED_LIBRARY: Track[] = [
  { id: "5qap5aO4i9A", title: "lofi hip hop radio — beats to relax/study to", artist: "Lofi Girl", duration: 0, thumbnail: thumbFor("5qap5aO4i9A"), source: "library" },
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

/**
 * Races the gateway pool, returning the first non-empty result set.
 * Never rejects — the curated library is the terminal fallback.
 */
export async function searchTracks(query: string, limit = 12): Promise<SearchOutcome> {
  const attempts: Array<{ name: string; run: () => Promise<Track[]> }> = [
    ...PIPED_INSTANCES.map((base) => ({
      name: new URL(base).host,
      run: () => searchPiped(base, query),
    })),
    ...INVIDIOUS_INSTANCES.map((base) => ({
      name: new URL(base).host,
      run: () => searchInvidious(base, query),
    })),
  ];

  // Try gateways two at a time so one slow instance can't stall the UX.
  for (let i = 0; i < attempts.length; i += 2) {
    const batch = attempts.slice(i, i + 2);
    const results = await Promise.allSettled(batch.map((a) => a.run()));
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === "fulfilled" && r.value.length > 0) {
        return { tracks: dedupe(r.value).slice(0, limit), servedBy: batch[j].name };
      }
    }
  }

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
