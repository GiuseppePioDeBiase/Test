import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AutoDJProvider, useEngine, useEngineState } from "./hooks/useAutoDJ";
import { Deck } from "./components/Deck";
import { Crossfader } from "./components/Crossfader";
import { TransportControls } from "./components/TransportControls";
import { SuggestionPanel } from "./components/SuggestionPanel";
import { QueuePanel } from "./components/QueuePanel";
import { SearchOverlay } from "./components/SearchOverlay";
import { Ticker } from "./components/Ticker";
import { ScrambleText } from "./components/ScrambleText";
import { MagneticButton } from "./components/MagneticButton";
import { LibraryView } from "./components/LibraryView";
import { AnalyzerView } from "./components/AnalyzerView";
import { SettingsView } from "./components/SettingsView";
import type { EngineState } from "./types";

type ToolId = "decks" | "library" | "analyzer" | "settings";

const TOOLS: Array<{ id: ToolId; label: string; glyph: string }> = [
  { id: "decks", label: "DECKS", glyph: "◉" },
  { id: "library", label: "LIBRARY", glyph: "▤" },
  { id: "analyzer", label: "ANALYZER", glyph: "∿" },
  { id: "settings", label: "SETTINGS", glyph: "⚙" },
];

const viewVariants = {
  initial: { opacity: 0, y: 24, filter: "blur(6px)" },
  enter: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const },
  },
  exit: {
    opacity: 0,
    y: -16,
    filter: "blur(4px)",
    transition: { duration: 0.22, ease: [0.4, 0, 1, 1] as const },
  },
};

function MixerView({ state }: { state: EngineState }) {
  const engine = useEngine();
  return (
    <>
      <main className="stage">
        <div className="stage__deck stage__deck--a">
          <Deck
            deck={state.decks.A}
            isActive={state.activeDeck === "A"}
            crossfade={state.crossfade}
            autoFadeCountdown={state.activeDeck === "A" ? state.autoFadeCountdown : null}
          />
        </div>

        <div className="stage__center">
          <Crossfader crossfade={state.crossfade} activeDeck={state.activeDeck} />
          <TransportControls
            state={state}
            onPause={() => engine?.pause()}
            onResume={() => engine?.resume()}
            onSkip={() => engine?.skipNext()}
            onStop={() => engine?.stop()}
          />
          <SuggestionPanel state={state} onAccept={(c) => engine?.acceptSuggestion(c)} />
        </div>

        <div className="stage__deck stage__deck--b">
          <Deck
            deck={state.decks.B}
            isActive={state.activeDeck === "B"}
            crossfade={state.crossfade}
            autoFadeCountdown={state.activeDeck === "B" ? state.autoFadeCountdown : null}
          />
        </div>
      </main>

      <footer className="lower">
        <QueuePanel queue={state.queue} onRemove={(id) => engine?.removeFromQueue(id)} />
        <Ticker log={state.log} />
      </footer>
    </>
  );
}

function Console() {
  const engine = useEngine();
  const state = useEngineState();
  const [searchOpen, setSearchOpen] = useState(false);
  const [tool, setTool] = useState<ToolId>("decks");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "/" || (e.key === "k" && (e.metaKey || e.ctrlKey))) && !searchOpen) {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen]);

  const queuedIds = useMemo(() => new Set(state.queue.map((t) => t.id)), [state.queue]);
  const live = state.decks[state.activeDeck];

  const playNow = (t: Parameters<NonNullable<typeof engine>["playNow"]>[0]) => {
    void engine?.playNow(t);
    setTool("decks");
  };

  return (
    <div className="console console--suite">
      <div className="bg-grid" aria-hidden />
      <div className="bg-noise" aria-hidden />

      <nav className="rail" aria-label="Tool suite">
        <span className="rail__mark" aria-hidden />
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`rail__item mono ${tool === t.id ? "rail__item--on" : ""}`}
            onClick={() => setTool(t.id)}
            aria-current={tool === t.id}
          >
            <span className="rail__glyph">{t.glyph}</span>
            <span className="rail__label">{t.label}</span>
            {t.id === "decks" && state.transport === "playing" && (
              <span className="rail__live" aria-label="Playing" />
            )}
          </button>
        ))}
        <div className="rail__foot mono">{state.transport.toUpperCase()}</div>
      </nav>

      <div className="suite-body">
        <motion.header
          className="masthead"
          initial={{ opacity: 0, y: -24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="masthead__brand">
            <div>
              <ScrambleText text="MINI AI DJ MIXER" as="h1" className="masthead__title" />
              <p className="masthead__sub mono">
                AUTONOMOUS MIX SUITE · V2.0 · TOOL / {tool.toUpperCase()}
              </p>
            </div>
          </div>

          <div className="masthead__right">
            <div className="masthead__now mono">
              {live.track ? (
                <>
                  <span className="dim">ON AIR ▸ </span>
                  {live.track.title.slice(0, 38)}
                  {live.track.title.length > 38 ? "…" : ""}
                </>
              ) : (
                <span className="dim">SILENCE ON THE FLOOR</span>
              )}
            </div>
            <MagneticButton className="masthead__search" onClick={() => setSearchOpen(true)}>
              <span className="mono">SEARCH TRACKS</span>
              <kbd className="mono">/</kbd>
            </MagneticButton>
          </div>
        </motion.header>

        <AnimatePresence mode="wait">
          <motion.div
            key={tool}
            className="suite-view"
            variants={viewVariants}
            initial="initial"
            animate="enter"
            exit="exit"
          >
            {tool === "decks" && <MixerView state={state} />}
            {tool === "library" && (
              <LibraryView
                onPlay={playNow}
                onQueue={(t) => engine?.enqueue(t)}
                queuedIds={queuedIds}
              />
            )}
            {tool === "analyzer" && (
              <AnalyzerView referenceBpm={live.analysis?.bpm ?? null} />
            )}
            {tool === "settings" && <SettingsView />}
          </motion.div>
        </AnimatePresence>
      </div>

      <SearchOverlay
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onPlayNow={playNow}
        onQueue={(t) => engine?.enqueue(t)}
        queuedIds={queuedIds}
      />
    </div>
  );
}

export default function App() {
  return (
    <AutoDJProvider>
      <Console />
    </AutoDJProvider>
  );
}
