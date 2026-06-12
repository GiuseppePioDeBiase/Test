import { AnimatePresence, motion } from "framer-motion";
import type { Track } from "../types";
import { clearHistory, toggleSaved, useLibrary } from "../lib/settings";
import { quickAnalyze } from "../lib/bpm";
import { MagneticButton } from "./MagneticButton";
import { ScrambleText } from "./ScrambleText";

function TrackRow({
  track,
  saved,
  queued,
  onPlay,
  onQueue,
}: {
  track: Track;
  saved: boolean;
  queued: boolean;
  onPlay: (t: Track) => void;
  onQueue: (t: Track) => void;
}) {
  const est = quickAnalyze(track);
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -24, transition: { duration: 0.18 } }}
      transition={{ type: "spring", stiffness: 320, damping: 30 }}
      className="result"
    >
      <img className="result__art" src={track.thumbnail} alt="" draggable={false} loading="lazy" />
      <div className="result__info">
        <span className="result__title">
          {track.title.length > 56 ? track.title.slice(0, 56) + "…" : track.title}
        </span>
        <span className="result__meta mono">
          {track.artist} · ~{Math.round(est.bpm)} BPM · {est.genre}
        </span>
      </div>
      <div className="result__actions">
        <MagneticButton className="result__btn result__btn--play" strength={8} onClick={() => onPlay(track)}>
          PLAY
        </MagneticButton>
        <MagneticButton className="result__btn" strength={8} disabled={queued} onClick={() => onQueue(track)}>
          {queued ? "QUEUED ✓" : "+ QUEUE"}
        </MagneticButton>
        <MagneticButton
          className={`result__btn ${saved ? "result__btn--saved" : ""}`}
          strength={8}
          onClick={() => toggleSaved(track)}
          aria-label={saved ? "Remove from library" : "Save to library"}
        >
          {saved ? "★" : "☆"}
        </MagneticButton>
      </div>
    </motion.li>
  );
}

/** LIBRARY tool — saved tracks plus full play history, both persisted. */
export function LibraryView({
  onPlay,
  onQueue,
  queuedIds,
}: {
  onPlay: (t: Track) => void;
  onQueue: (t: Track) => void;
  queuedIds: Set<string>;
}) {
  const { saved, history } = useLibrary();
  const savedIds = new Set(saved.map((t) => t.id));

  return (
    <div className="toolview">
      <header className="toolview__head">
        <ScrambleText text="LIBRARY" as="h2" className="toolview__title" />
        <p className="toolview__sub mono">
          SAVED TRACKS & SESSION HISTORY — PERSISTED LOCALLY, ZERO ACCOUNTS
        </p>
      </header>

      <div className="library__grid">
        <section className="library__col">
          <header className="queue__head mono">
            <span>SAVED ★</span>
            <span className="queue__count">{String(saved.length).padStart(2, "0")}</span>
          </header>
          {saved.length === 0 ? (
            <p className="queue__empty mono">
              NOTHING SAVED — HIT ☆ ON ANY SEARCH RESULT OR HISTORY ROW
            </p>
          ) : (
            <ul className="search-results__list library__list">
              <AnimatePresence initial={false}>
                {saved.map((t) => (
                  <TrackRow
                    key={t.id}
                    track={t}
                    saved
                    queued={queuedIds.has(t.id)}
                    onPlay={onPlay}
                    onQueue={onQueue}
                  />
                ))}
              </AnimatePresence>
            </ul>
          )}
        </section>

        <section className="library__col">
          <header className="queue__head mono">
            <span>PLAY HISTORY</span>
            <span className="library__actions">
              <span className="queue__count">{String(history.length).padStart(2, "0")}</span>
              {history.length > 0 && (
                <button className="library__clear mono" onClick={clearHistory}>
                  CLEAR
                </button>
              )}
            </span>
          </header>
          {history.length === 0 ? (
            <p className="queue__empty mono">NO PLAYS YET — EVERYTHING YOU MIX LANDS HERE</p>
          ) : (
            <ul className="search-results__list library__list">
              <AnimatePresence initial={false}>
                {history.map((t) => (
                  <TrackRow
                    key={t.id}
                    track={t}
                    saved={savedIds.has(t.id)}
                    queued={queuedIds.has(t.id)}
                    onPlay={onPlay}
                    onQueue={onQueue}
                  />
                ))}
              </AnimatePresence>
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
