import { AnimatePresence, motion } from "framer-motion";
import type { CrossfadeState, DeckState } from "../types";
import { Waveform } from "./Waveform";
import { ScrambleText } from "./ScrambleText";
import { MagneticButton } from "./MagneticButton";

function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return "00:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

const cardVariants = {
  initial: { opacity: 0, y: 24, scale: 0.985, filter: "blur(8px)" },
  enter: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: "blur(0px)",
    transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const },
  },
  exit: {
    opacity: 0,
    y: -18,
    scale: 0.99,
    filter: "blur(6px)",
    transition: { duration: 0.3, ease: [0.4, 0, 1, 1] as const },
  },
};

export function Deck({
  deck,
  isActive,
  crossfade,
  autoFadeCountdown,
  onRequestSearch,
}: {
  deck: DeckState;
  isActive: boolean;
  crossfade: CrossfadeState;
  autoFadeCountdown: number | null;
  onRequestSearch?: () => void;
}) {
  const fadingIn = crossfade.active && crossfade.to === deck.id;
  const fadingOut = crossfade.active && crossfade.from === deck.id;
  const live = isActive && deck.status === "playing" && !fadingOut;

  const statusLabel = fadingIn
    ? "INCOMING"
    : fadingOut
      ? "FADING OUT"
      : deck.status === "loading"
        ? "BUFFERING"
        : live
          ? "LIVE"
          : deck.status === "paused"
            ? "HELD"
            : deck.track
              ? "ARMED"
              : "STANDBY";

  const progress = deck.duration > 0 ? deck.currentTime / deck.duration : 0;
  const remaining = Math.max(0, deck.duration - deck.currentTime);
  const showCountdown = isActive && autoFadeCountdown !== null && autoFadeCountdown <= 20;

  return (
    <motion.section
      className={`deck ${isActive ? "deck--active" : ""} ${fadingIn ? "deck--incoming" : ""}`}
      animate={{
        borderColor: live || fadingIn ? "rgba(198,255,0,0.55)" : "rgba(255,255,255,0.12)",
        boxShadow:
          live || fadingIn
            ? "0 0 56px rgba(198,255,0,0.10), inset 0 0 0 1px rgba(198,255,0,0.12)"
            : "0 0 0 rgba(0,0,0,0), inset 0 0 0 1px rgba(255,255,255,0.02)",
      }}
      transition={{ duration: 0.6 }}
    >
      <header className="deck__head">
        <div className="deck__id">
          <span className="deck__letter">{deck.id}</span>
          <span className="deck__sub mono">DECK / {deck.id === "A" ? "01" : "02"}</span>
        </div>
        <div className={`deck__status mono status--${statusLabel.toLowerCase().replace(/\s/g, "-")}`}>
          <span className="status-dot" />
          {statusLabel}
        </div>
      </header>

      <AnimatePresence mode="wait">
        {deck.track ? (
          <motion.div
            key={deck.track.id}
            className="deck__body"
            variants={cardVariants}
            initial="initial"
            animate="enter"
            exit="exit"
          >
            <div className="deck__meta">
              <div className="deck__art-wrap">
                <motion.img
                  className="deck__art"
                  src={deck.track.thumbnail}
                  alt=""
                  draggable={false}
                  animate={{ scale: live ? [1, 1.04, 1] : 1 }}
                  transition={
                    live
                      ? { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
                      : { duration: 0.4 }
                  }
                />
                <div className="deck__art-scan" />
              </div>
              <div className="deck__titles">
                <ScrambleText
                  text={deck.track.title.length > 52 ? deck.track.title.slice(0, 52) + "…" : deck.track.title}
                  as="h2"
                  className="deck__title"
                />
                <p className="deck__artist mono">{deck.track.artist.toUpperCase()}</p>
              </div>
            </div>

            <div className="deck__data mono">
              <div className="datum">
                <span className="datum__label">BPM</span>
                <span className="datum__value datum__value--big">
                  {deck.analysisPending && !deck.analysis ? (
                    <span className="skeleton skeleton--num">———</span>
                  ) : (
                    deck.analysis?.bpm.toFixed(1) ?? "—"
                  )}
                </span>
                {deck.analysis && (
                  <span className={`datum__tag tag--${deck.analysis.source}`}>
                    {deck.analysis.source === "dsp" ? "DSP VERIFIED" : "AI MODEL"}
                  </span>
                )}
              </div>
              <div className="datum">
                <span className="datum__label">GENRE</span>
                <span className="datum__value">
                  {deck.analysis?.genre ?? <span className="skeleton skeleton--txt">SCANNING</span>}
                </span>
              </div>
              <div className="datum">
                <span className="datum__label">KEY</span>
                <span className="datum__value">{deck.analysis?.camelotKey ?? "--"}</span>
              </div>
              <div className="datum">
                <span className="datum__label">ENERGY</span>
                <span className="datum__value">
                  {deck.analysis ? `${Math.round(deck.analysis.energy * 100)}%` : "--"}
                </span>
              </div>
            </div>

            <Waveform
              seed={deck.track.id}
              progress={progress}
              gain={deck.volume}
              playing={deck.status === "playing"}
              accent={fadingOut ? "#ff5b4a" : "#c6ff00"}
            />

            <footer className="deck__foot mono">
              <span>{fmtTime(deck.currentTime)}</span>
              <div className="deck__fader">
                <span className="deck__fader-label">GAIN</span>
                <div className="deck__fader-track">
                  <motion.div
                    className="deck__fader-fill"
                    animate={{ width: `${Math.round(deck.volume * 100)}%` }}
                    transition={{ duration: 0.12, ease: "linear" }}
                  />
                </div>
                <span className="deck__fader-pct">{Math.round(deck.volume * 100)}</span>
              </div>
              <span className={remaining <= 15 && live ? "time--critical" : ""}>
                -{fmtTime(remaining)}
              </span>
            </footer>
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            className="deck__body deck__body--empty"
            variants={cardVariants}
            initial="initial"
            animate="enter"
            exit="exit"
          >
            <div className="deck__empty-glyph">◌</div>
            <p className="mono deck__empty-text">
              {isActive ? "THIS DECK IS FREE" : "NEXT TRACK LANDS HERE AUTOMATICALLY"}
            </p>
            {onRequestSearch && isActive && (
              <MagneticButton className="deck__empty-cta" onClick={onRequestSearch}>
                <span className="mono">+ LOAD A TRACK</span>
              </MagneticButton>
            )}
            <div className="deck__empty-bars">
              {Array.from({ length: 24 }).map((_, i) => (
                <span key={i} style={{ animationDelay: `${i * 0.07}s` }} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCountdown && (
          <motion.div
            className="deck__countdown mono"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
          >
            <span className="deck__countdown-label">AUTO-FADE IN</span>
            <span className="deck__countdown-num">{autoFadeCountdown?.toFixed(1)}s</span>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
