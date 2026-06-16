/**
 * Thin, promise-based wrapper around the YouTube IFrame Player API.
 *
 * Streams are played through two invisible embedded players (Deck A / Deck B)
 * so nothing is ever downloaded — audio is pulled straight off YouTube's CDN
 * by the iframe, while we automate volume, seek and transport from outside.
 */

type YTPlayerState = -1 | 0 | 1 | 2 | 3 | 5;

interface YTPlayer {
  loadVideoById(videoId: string, startSeconds?: number): void;
  cueVideoById(videoId: string, startSeconds?: number): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  getVolume(): number;
  mute(): void;
  unMute(): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): YTPlayerState;
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    el: HTMLElement | string,
    opts: {
      width?: string | number;
      height?: string | number;
      videoId?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (e: { target: YTPlayer }) => void;
        onStateChange?: (e: { data: YTPlayerState; target: YTPlayer }) => void;
        onError?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
  PlayerState: {
    UNSTARTED: -1;
    ENDED: 0;
    PLAYING: 1;
    PAUSED: 2;
    BUFFERING: 3;
    CUED: 5;
  };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

/** Loads the IFrame API exactly once, resolving when `window.YT` is usable. */
export function loadYouTubeAPI(): Promise<YTNamespace> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    if (window.YT && window.YT.Player) {
      resolve(window.YT);
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT) resolve(window.YT);
      else reject(new Error("YouTube IFrame API failed to initialise"));
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.async = true;
    tag.onerror = () => reject(new Error("Could not reach youtube.com/iframe_api"));
    document.head.appendChild(tag);
    // Hard timeout so a blocked network never hangs the engine forever.
    window.setTimeout(() => {
      if (window.YT && window.YT.Player) resolve(window.YT);
      else reject(new Error("YouTube IFrame API timed out"));
    }, 12_000);
  });
  return apiPromise;
}

export type DeckPlayerEvent =
  | { type: "ready" }
  | { type: "playing" }
  | { type: "paused" }
  | { type: "buffering" }
  | { type: "ended" }
  | { type: "error"; code: number };

/**
 * One deck = one embedded player. The engine owns two of these and drives
 * their volume curves directly during crossfades.
 */
export class DeckPlayer {
  private player: YTPlayer | null = null;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private listeners = new Set<(e: DeckPlayerEvent) => void>();
  private lastVolume = 100;
  private dead = false;

  constructor(container: HTMLElement) {
    this.readyPromise = new Promise((res) => (this.resolveReady = res));
    void this.init(container);
  }

  private async init(container: HTMLElement) {
    try {
      const YT = await loadYouTubeAPI();
      if (this.dead) return;
      this.player = new YT.Player(container, {
        width: 1,
        height: 1,
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          iv_load_policy: 3,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            this.resolveReady();
            this.emit({ type: "ready" });
          },
          onStateChange: (e) => {
            if (e.data === 1) this.emit({ type: "playing" });
            else if (e.data === 2) this.emit({ type: "paused" });
            else if (e.data === 3) this.emit({ type: "buffering" });
            else if (e.data === 0) this.emit({ type: "ended" });
          },
          onError: (e) => this.emit({ type: "error", code: e.data }),
        },
      });
    } catch {
      this.emit({ type: "error", code: -1 });
    }
  }

  on(fn: (e: DeckPlayerEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: DeckPlayerEvent) {
    this.listeners.forEach((fn) => fn(e));
  }

  async load(videoId: string, volumePct: number, startSeconds = 0): Promise<void> {
    await this.readyPromise;
    if (!this.player) throw new Error("player unavailable");
    this.setVolume(volumePct);
    this.player.loadVideoById(videoId, startSeconds);
  }

  /** Buffers a video without starting playback — used to pre-arm the idle deck. */
  async cue(videoId: string, startSeconds = 0): Promise<void> {
    await this.readyPromise;
    if (!this.player) throw new Error("player unavailable");
    this.player.cueVideoById(videoId, startSeconds);
  }

  play() {
    this.player?.playVideo();
  }

  pause() {
    this.player?.pauseVideo();
  }

  stop() {
    this.player?.stopVideo();
  }

  /** volume is 0..100 */
  setVolume(volume: number) {
    const v = Math.max(0, Math.min(100, volume));
    this.lastVolume = v;
    this.player?.setVolume(v);
  }

  getVolume(): number {
    return this.lastVolume;
  }

  getCurrentTime(): number {
    try {
      return this.player?.getCurrentTime() ?? 0;
    } catch {
      return 0;
    }
  }

  getDuration(): number {
    try {
      return this.player?.getDuration() ?? 0;
    } catch {
      return 0;
    }
  }

  isPlaying(): boolean {
    try {
      return this.player?.getPlayerState() === 1;
    } catch {
      return false;
    }
  }

  destroy() {
    this.dead = true;
    this.listeners.clear();
    try {
      this.player?.destroy();
    } catch {
      /* iframe already gone */
    }
    this.player = null;
  }
}
