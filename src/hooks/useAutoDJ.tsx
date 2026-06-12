import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { AutoDJEngine } from "../lib/autodj";
import type { EngineState } from "../types";

const EngineContext = createContext<AutoDJEngine | null>(null);

const BOOT_STATE: EngineState = {
  decks: {
    A: { id: "A", track: null, analysis: null, analysisPending: false, status: "empty", currentTime: 0, duration: 0, volume: 1 },
    B: { id: "B", track: null, analysis: null, analysisPending: false, status: "empty", currentTime: 0, duration: 0, volume: 0 },
  },
  activeDeck: "A",
  queue: [],
  crossfade: { active: false, phase: "arming", progress: 0, from: "A", to: "B", durationMs: 6000 },
  suggestionPhase: "idle",
  candidates: [],
  bestCandidate: null,
  autoMixEnabled: true,
  mixPoint: null,
  mixCountdown: null,
  autoFadeCountdown: null,
  transport: "stopped",
  log: [],
};

/**
 * Owns the engine lifecycle and the two off-screen iframe mounts the
 * YouTube players live in. Everything below this provider can read live
 * engine snapshots and issue transport commands.
 */
export function AutoDJProvider({ children }: { children: ReactNode }) {
  const mountA = useRef<HTMLDivElement>(null);
  const mountB = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<AutoDJEngine | null>(null);

  useEffect(() => {
    const hostA = mountA.current;
    const hostB = mountB.current;
    if (!hostA || !hostB) return;
    // The IFrame API replaces its target element, so each engine instance
    // gets fresh child nodes — keeps StrictMode double-mounting clean.
    const elA = document.createElement("div");
    const elB = document.createElement("div");
    hostA.appendChild(elA);
    hostB.appendChild(elB);
    const eng = new AutoDJEngine(elA, elB);
    setEngine(eng);
    return () => {
      eng.destroy();
      hostA.replaceChildren();
      hostB.replaceChildren();
    };
  }, []);

  return (
    <EngineContext.Provider value={engine}>
      <div className="yt-mounts" aria-hidden="true">
        <div ref={mountA} />
        <div ref={mountB} />
      </div>
      {children}
    </EngineContext.Provider>
  );
}

export function useEngine(): AutoDJEngine | null {
  return useContext(EngineContext);
}

export function useEngineState(): EngineState {
  const engine = useEngine();
  return useSyncExternalStore(
    engine ? engine.subscribe : () => () => undefined,
    engine ? engine.getSnapshot : () => BOOT_STATE,
  );
}
