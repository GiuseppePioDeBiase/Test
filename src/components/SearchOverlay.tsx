import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { SearchState, Track } from "../types";
import { searchTracks } from "../lib/search";
import { quickAnalyze } from "../lib/bpm";
import { toggleSaved, useLibrary } from "../lib/settings";
import { MagneticButton } from "./MagneticButton";
import { ScrambleText } from "./ScrambleText";

const overlayVariants = {
  hidden: { opacity: 0, backdropFilter: "blur(0px)" },
  visible: {
    opacity: 1,
    backdropFilter: "blur(24px)",
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const },
  },
  exit: {
    opacity: 0,
    backdropFilter: "blur(0px)",
    transition: { duration: 0.28 },
  },
};

const panelVariants = {
  hidden: { opacity: 0, y: 48, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const, delay: 0.06 },
  },
  exit: { opacity: 0, y: 24, scale: 0.98, transition: { duration: 0.22 } },
};

export function SearchOverlay({
  open,
  onClose,
  onPlayNow,
  onQueue,
  queuedIds,
}: {
  open: boolean;
  onClose: () => void;
  onPlayNow: (t: Track) => void;
  onQueue: (t: Track) => void;
  queuedIds: Set<string>;
}) {
  const [search, setSearch] = useState<SearchState>({
    status: "idle",
    query: "",
    results: [],
    servedBy: null,
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const reqSeq = useRef(0);
  const { saved } = useLibrary();
  const savedIds = new Set(saved.map((t) => t.id));

  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 120);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const runSearch = useCallback(async (query: string) => {
    const q = query.trim();
    if (!q) return;
    const seq = ++reqSeq.current;
    setSearch((s) => ({ ...s, status: "searching", query: q }));
    const { tracks, servedBy } = await searchTracks(q, 14);
    if (seq !== reqSeq.current) return;
    setSearch({ status: "done", query: q, results: tracks, servedBy });
  }, []);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="search-overlay"
          variants={overlayVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div className="search-panel" variants={panelVariants}>
            <header className="search-panel__head">
              <ScrambleText text="TRACK SEARCH" as="h2" className="search-panel__title" />
              <button className="search-panel__close mono" onClick={onClose} aria-label="Close search">
                ESC ×
              </button>
            </header>

            <form
              className="search-form"
              onSubmit={(e) => {
                e.preventDefault();
                void runSearch(inputRef.current?.value ?? "");
              }}
            >
              <span className="search-form__prompt mono">▸</span>
              <input
                ref={inputRef}
                className="search-form__input mono"
                placeholder="SEARCH ANY TRACK, ARTIST OR GENRE…"
                spellCheck={false}
                autoComplete="off"
              />
              <MagneticButton className="search-form__go" type="submit" strength={10}>
                SCAN
              </MagneticButton>
            </form>

            <div className="search-results">
              <AnimatePresence mode="wait">
                {search.status === "searching" && (
                  <motion.ul
                    key="loading"
                    className="search-results__list"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.15 } }}
                  >
                    {Array.from({ length: 5 }).map((_, i) => (
                      <li
                        key={i}
                        className="result result--skeleton"
                        style={{ animationDelay: `${i * 0.09}s` }}
                      >
                        <span className="skeleton-block skeleton-block--art" />
                        <div className="result__info">
                          <span className="skeleton-block skeleton-block--line" style={{ width: `${68 - i * 6}%` }} />
                          <span className="skeleton-block skeleton-block--line" style={{ width: `${38 + i * 4}%` }} />
                        </div>
                      </li>
                    ))}
                  </motion.ul>
                )}

                {search.status === "done" && (
                  <motion.div
                    key={`done-${search.query}`}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, transition: { duration: 0.15 } }}
                    transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <p className="search-results__meta mono">
                      {search.results.length} STREAMS · SERVED BY {search.servedBy?.toUpperCase()}
                    </p>
                    <ul className="search-results__list">
                      {search.results.map((t, i) => {
                        const est = quickAnalyze(t);
                        return (
                          <motion.li
                            key={t.id}
                            className="result"
                            initial={{ opacity: 0, y: 14 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.04, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                          >
                            <img className="result__art" src={t.thumbnail} alt="" draggable={false} loading="lazy" />
                            <div className="result__info">
                              <span className="result__title">
                                {t.title.length > 56 ? t.title.slice(0, 56) + "…" : t.title}
                              </span>
                              <span className="result__meta mono">
                                {t.artist} · ~{Math.round(est.bpm)} BPM · {est.genre}
                              </span>
                            </div>
                            <div className="result__actions">
                              <MagneticButton
                                className="result__btn result__btn--play"
                                strength={8}
                                onClick={() => {
                                  onPlayNow(t);
                                  onClose();
                                }}
                              >
                                PLAY NOW
                              </MagneticButton>
                              <MagneticButton
                                className="result__btn"
                                strength={8}
                                disabled={queuedIds.has(t.id)}
                                onClick={() => onQueue(t)}
                              >
                                {queuedIds.has(t.id) ? "QUEUED ✓" : "+ QUEUE"}
                              </MagneticButton>
                              <MagneticButton
                                className={`result__btn ${savedIds.has(t.id) ? "result__btn--saved" : ""}`}
                                strength={8}
                                onClick={() => toggleSaved(t)}
                                aria-label={savedIds.has(t.id) ? "Remove from library" : "Save to library"}
                              >
                                {savedIds.has(t.id) ? "★" : "☆"}
                              </MagneticButton>
                            </div>
                          </motion.li>
                        );
                      })}
                    </ul>
                  </motion.div>
                )}

                {search.status === "idle" && (
                  <motion.div
                    key="hint"
                    className="search-results__hint mono"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <p>TYPE A QUERY AND HIT SCAN.</p>
                    <p className="dim">
                      STREAMS RESOLVE VIA YOUTUBE — NOTHING IS EVER DOWNLOADED. TRACKS OVER
                      5 MINUTES ARE FILTERED OUT: THEY ARE USUALLY MULTI-SONG MIXES.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
