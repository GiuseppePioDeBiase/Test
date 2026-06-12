import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Track, TrackAnalysis } from "../types";
import { analyzeTrack, bpmDistance, tierFor } from "../lib/bpm";
import { searchTracks } from "../lib/search";
import { MagneticButton } from "./MagneticButton";
import { ScrambleText } from "./ScrambleText";

/* ------------------------------ tap tempo ------------------------------- */

function useTapTempo() {
  const taps = useRef<number[]>([]);
  const [bpm, setBpm] = useState<number | null>(null);
  const [count, setCount] = useState(0);

  const tap = () => {
    const now = performance.now();
    const list = taps.current;
    // A pause longer than 2s starts a fresh measurement.
    if (list.length > 0 && now - list[list.length - 1] > 2000) list.length = 0;
    list.push(now);
    if (list.length > 16) list.shift();
    setCount(list.length);
    if (list.length >= 2) {
      const intervals = list.slice(1).map((t, i) => t - list[i]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      setBpm(Math.round((60000 / avg) * 10) / 10);
    }
  };

  const reset = () => {
    taps.current = [];
    setBpm(null);
    setCount(0);
  };

  return { bpm, count, tap, reset };
}

/* ---------------------------- track analysis ----------------------------- */

function extractVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;
  const m =
    /(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/.exec(trimmed);
  return m ? m[1] : null;
}

interface AnalysisResult {
  track: Track;
  analysis: TrackAnalysis;
}

/** ANALYZER tool — tap tempo pad + deep single-track analysis. */
export function AnalyzerView({ referenceBpm }: { referenceBpm: number | null }) {
  const { bpm: tappedBpm, count, tap, reset } = useTapTempo();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const analyze = async () => {
    const q = input.trim();
    if (!q || busy) return;
    const mySeq = ++seq.current;
    setBusy(true);
    setError(null);
    setResult(null);

    let track: Track | null = null;
    const id = extractVideoId(q);
    if (id) {
      track = {
        id,
        title: `VIDEO ${id}`,
        artist: "Direct link",
        duration: 0,
        thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        source: "library",
      };
    } else {
      const { tracks } = await searchTracks(q, 1);
      track = tracks[0] ?? null;
    }
    if (mySeq !== seq.current) return;
    if (!track) {
      setError("NO TRACK RESOLVED FOR THAT QUERY");
      setBusy(false);
      return;
    }
    const analysis = await analyzeTrack(track);
    if (mySeq !== seq.current) return;
    setResult({ track, analysis });
    setBusy(false);
  };

  const delta =
    result && referenceBpm !== null ? bpmDistance(referenceBpm, result.analysis.bpm) : null;

  return (
    <div className="toolview">
      <header className="toolview__head">
        <ScrambleText text="ANALYZER" as="h2" className="toolview__title" />
        <p className="toolview__sub mono">
          TAP-TEMPO PAD + DEEP TRACK ANALYSIS — DSP WHEN A STREAM IS REACHABLE, MODEL OTHERWISE
        </p>
      </header>

      <div className="analyzer__grid">
        <section className="analyzer__card">
          <h3 className="analyzer__card-title mono">TAP TEMPO</h3>
          <button className="tap-pad" onClick={tap} aria-label="Tap to the beat">
            <span className="tap-pad__bpm">{tappedBpm !== null ? tappedBpm.toFixed(1) : "TAP"}</span>
            <span className="tap-pad__label mono">
              {tappedBpm !== null ? `BPM · ${count} TAPS` : "HIT THE PAD ON EVERY BEAT"}
            </span>
          </button>
          <div className="analyzer__row">
            <MagneticButton className="result__btn" strength={8} onClick={reset} disabled={count === 0}>
              RESET
            </MagneticButton>
            {referenceBpm !== null && tappedBpm !== null && (
              <span className="mono analyzer__delta">
                Δ {bpmDistance(referenceBpm, tappedBpm).toFixed(1)} VS LIVE DECK ({referenceBpm.toFixed(1)})
              </span>
            )}
          </div>
        </section>

        <section className="analyzer__card">
          <h3 className="analyzer__card-title mono">TRACK ANALYSIS</h3>
          <form
            className="search-form"
            onSubmit={(e) => {
              e.preventDefault();
              void analyze();
            }}
          >
            <span className="search-form__prompt mono">▸</span>
            <input
              className="search-form__input mono"
              placeholder="SONG NAME, YOUTUBE URL OR VIDEO ID…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              spellCheck={false}
            />
            <MagneticButton className="search-form__go" type="submit" strength={10} disabled={busy}>
              {busy ? "…" : "ANALYZE"}
            </MagneticButton>
          </form>

          <AnimatePresence mode="wait">
            {busy && (
              <motion.div
                key="busy"
                className="analyzer__pending mono"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <span className="skeleton skeleton--txt">DECODING AUDIO…</span>
              </motion.div>
            )}
            {error && !busy && (
              <motion.p
                key="err"
                className="analyzer__error mono"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {error}
              </motion.p>
            )}
            {result && !busy && (
              <motion.div
                key={result.track.id}
                className="analyzer__result"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="analyzer__result-head">
                  <img className="result__art" src={result.track.thumbnail} alt="" draggable={false} />
                  <div className="result__info">
                    <span className="result__title">{result.track.title}</span>
                    <span className="result__meta mono">{result.track.artist}</span>
                  </div>
                </div>
                <div className="deck__data mono analyzer__data">
                  <div className="datum">
                    <span className="datum__label">BPM</span>
                    <span className="datum__value datum__value--big">
                      {result.analysis.bpm.toFixed(1)}
                    </span>
                    <span className={`datum__tag tag--${result.analysis.source}`}>
                      {result.analysis.source === "dsp" ? "DSP VERIFIED" : "AI MODEL"}
                    </span>
                  </div>
                  <div className="datum">
                    <span className="datum__label">GENRE</span>
                    <span className="datum__value">{result.analysis.genre}</span>
                  </div>
                  <div className="datum">
                    <span className="datum__label">KEY</span>
                    <span className="datum__value">{result.analysis.camelotKey}</span>
                  </div>
                  <div className="datum">
                    <span className="datum__label">ENERGY</span>
                    <span className="datum__value">{Math.round(result.analysis.energy * 100)}%</span>
                  </div>
                </div>
                {delta !== null && (
                  <p className="mono analyzer__delta">
                    Δ {delta.toFixed(1)} BPM VS LIVE DECK —{" "}
                    <span className={`badge--${tierFor(delta)} analyzer__tier`}>
                      {tierFor(delta).toUpperCase()}
                    </span>
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </div>
    </div>
  );
}
