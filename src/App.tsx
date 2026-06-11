import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
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

function Console() {
  const engine = useEngine();
  const state = useEngineState();
  const [searchOpen, setSearchOpen] = useState(false);

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

  return (
    <div className="console">
      <div className="bg-grid" aria-hidden />
      <div className="bg-noise" aria-hidden />

      <motion.header
        className="masthead"
        initial={{ opacity: 0, y: -24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="masthead__brand">
          <span className="masthead__mark" aria-hidden />
          <div>
            <ScrambleText text="MINI AI DJ MIXER" as="h1" className="masthead__title" />
            <p className="masthead__sub mono">
              AUTONOMOUS DUAL-DECK ENGINE · V1.0 · {state.transport.toUpperCase()}
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

      <main className="stage">
        <motion.div
          className="stage__deck stage__deck--a"
          initial={{ opacity: 0, x: -40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
        >
          <Deck
            deck={state.decks.A}
            isActive={state.activeDeck === "A"}
            crossfade={state.crossfade}
            autoFadeCountdown={state.activeDeck === "A" ? state.autoFadeCountdown : null}
          />
        </motion.div>

        <motion.div
          className="stage__center"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          <Crossfader crossfade={state.crossfade} activeDeck={state.activeDeck} />
          <TransportControls
            state={state}
            onPause={() => engine?.pause()}
            onResume={() => engine?.resume()}
            onSkip={() => engine?.skipNext()}
            onStop={() => engine?.stop()}
          />
          <SuggestionPanel state={state} onAccept={(c) => engine?.acceptSuggestion(c)} />
        </motion.div>

        <motion.div
          className="stage__deck stage__deck--b"
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, delay: 0.34, ease: [0.22, 1, 0.36, 1] }}
        >
          <Deck
            deck={state.decks.B}
            isActive={state.activeDeck === "B"}
            crossfade={state.crossfade}
            autoFadeCountdown={state.activeDeck === "B" ? state.autoFadeCountdown : null}
          />
        </motion.div>
      </main>

      <motion.footer
        className="lower"
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.46, ease: [0.22, 1, 0.36, 1] }}
      >
        <QueuePanel queue={state.queue} onRemove={(id) => engine?.removeFromQueue(id)} />
        <Ticker log={state.log} />
      </motion.footer>

      <SearchOverlay
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onPlayNow={(t) => void engine?.playNow(t)}
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
