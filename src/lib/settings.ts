import { useSyncExternalStore } from "react";
import type { Track } from "../types";

/**
 * Tiny reactive, localStorage-persisted stores powering the tool suite:
 * engine settings, the saved library and the play history.
 */

export type FadeCurve = "smooth" | "power" | "linear";

export interface EngineSettings {
  /** YouTube Data API v3 key — unlocks full official catalogue search. */
  apiKey: string;
  /** Base crossfade length in milliseconds (3000–12000). */
  fadeDurationMs: number;
  /** Seconds before track end when the auto-fade engages (10–30). */
  fadeTriggerSec: number;
  /** Volume automation curve. */
  fadeCurve: FadeCurve;
  /**
   * Smart Blend: adapt each transition to the match quality — perfect
   * matches get long seamless blends, tempo clashes get quick swaps.
   */
  smartFade: boolean;
}

export const DEFAULT_SETTINGS: EngineSettings = {
  apiKey: "",
  fadeDurationMs: 6000,
  fadeTriggerSec: 15,
  fadeCurve: "smooth",
  smartFade: true,
};

class PersistedStore<T> {
  private value: T;
  private listeners = new Set<() => void>();

  constructor(
    private key: string,
    defaults: T,
  ) {
    this.value = defaults;
    try {
      const raw = localStorage.getItem(key);
      if (raw) this.value = { ...defaults, ...(JSON.parse(raw) as Partial<T>) };
    } catch {
      // corrupted storage — keep defaults
    }
  }

  get = (): T => this.value;

  set = (patch: Partial<T>) => {
    this.value = { ...this.value, ...patch };
    try {
      localStorage.setItem(this.key, JSON.stringify(this.value));
    } catch {
      // storage full/blocked — stay in-memory
    }
    this.listeners.forEach((fn) => fn());
  };

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
}

export const settingsStore = new PersistedStore<EngineSettings>(
  "djmixer.settings.v1",
  DEFAULT_SETTINGS,
);

interface LibraryState {
  saved: Track[];
  history: Track[];
}

const libraryStore = new PersistedStore<LibraryState>("djmixer.library.v1", {
  saved: [],
  history: [],
});

export function useSettings(): EngineSettings {
  return useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
}

export function updateSettings(patch: Partial<EngineSettings>) {
  settingsStore.set(patch);
}

export function useLibrary(): LibraryState {
  return useSyncExternalStore(libraryStore.subscribe, libraryStore.get);
}

export function toggleSaved(track: Track) {
  const { saved } = libraryStore.get();
  const exists = saved.some((t) => t.id === track.id);
  libraryStore.set({
    saved: exists ? saved.filter((t) => t.id !== track.id) : [track, ...saved].slice(0, 200),
  });
}

export function isSaved(id: string): boolean {
  return libraryStore.get().saved.some((t) => t.id === id);
}

export function recordHistory(track: Track) {
  const { history } = libraryStore.get();
  libraryStore.set({
    history: [track, ...history.filter((t) => t.id !== track.id)].slice(0, 100),
  });
}

export function clearHistory() {
  libraryStore.set({ history: [] });
}
