import { AnimatePresence, motion } from "framer-motion";
import type { EngineState, MixCandidate } from "../types";
import { MagneticButton } from "./MagneticButton";
import { ScrambleText } from "./ScrambleText";

const TIER_LABEL: Record<MixCandidate["tier"], string> = {
  perfect: "PERFECT MATCH",
  compatible: "COMPATIBLE",
  stretch: "STRETCH MIX",
};

function CandidateRow({
  c,
  isBest,
  onAccept,
  queued,
}: {
  c: MixCandidate;
  isBest: boolean;
  onAccept: (c: MixCandidate) => void;
  queued: boolean;
}) {
  return (
    <motion.li
      layout
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16, transition: { duration: 0.18 } }}
      transition={{ type: "spring", stiffness: 300, damping: 28 }}
      className={`cand ${isBest ? "cand--best" : ""} tier--${c.tier}`}
    >
      <img className="cand__art" src={c.track.thumbnail} alt="" draggable={false} />
      <div className="cand__info">
        <span className="cand__title">
          {c.track.title.length > 44 ? c.track.title.slice(0, 44) + "…" : c.track.title}
        </span>
        <span className="cand__meta mono">
          {c.analysis.bpm.toFixed(1)} BPM · Δ{c.bpmDelta.toFixed(1)} · {c.analysis.genre}
        </span>
      </div>
      <span className={`cand__badge mono badge--${c.tier}`}>{TIER_LABEL[c.tier]}</span>
      <MagneticButton
        className="cand__add"
        strength={8}
        disabled={queued}
        onClick={() => onAccept(c)}
        aria-label={`Queue ${c.track.title}`}
      >
        {queued ? "✓" : "+"}
      </MagneticButton>
    </motion.li>
  );
}

export function SuggestionPanel({
  state,
  onAccept,
}: {
  state: EngineState;
  onAccept: (c: MixCandidate) => void;
}) {
  const { suggestionPhase, candidates, bestCandidate, queue } = state;
  const queuedIds = new Set(queue.map((t) => t.id));

  return (
    <section className="suggest">
      <header className="suggest__head">
        <ScrambleText text="AI MIX ENGINE" as="h3" className="suggest__title" />
        <span className={`suggest__phase mono phase--${suggestionPhase}`}>
          {suggestionPhase === "scanning" && "SCANNING CATALOGUE…"}
          {suggestionPhase === "ready" && `${candidates.length} CANDIDATES LOCKED`}
          {suggestionPhase === "idle" && "AWAITING SIGNAL"}
          {suggestionPhase === "exhausted" && "POOL EXHAUSTED"}
        </span>
      </header>

      <AnimatePresence mode="wait">
        {suggestionPhase === "scanning" ? (
          <motion.ul
            key="skeleton"
            className="suggest__list"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
          >
            {Array.from({ length: 3 }).map((_, i) => (
              <li key={i} className="cand cand--skeleton" style={{ animationDelay: `${i * 0.12}s` }}>
                <span className="skeleton-block skeleton-block--art" />
                <div className="cand__info">
                  <span className="skeleton-block skeleton-block--line" style={{ width: "72%" }} />
                  <span className="skeleton-block skeleton-block--line" style={{ width: "46%" }} />
                </div>
              </li>
            ))}
          </motion.ul>
        ) : candidates.length > 0 ? (
          <motion.ul
            key="results"
            className="suggest__list"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
          >
            <AnimatePresence initial={false}>
              {candidates.map((c) => (
                <CandidateRow
                  key={c.track.id}
                  c={c}
                  isBest={bestCandidate?.track.id === c.track.id}
                  onAccept={onAccept}
                  queued={queuedIds.has(c.track.id)}
                />
              ))}
            </AnimatePresence>
          </motion.ul>
        ) : (
          <motion.p
            key="idle"
            className="suggest__idle mono"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {suggestionPhase === "exhausted"
              ? "NO COMPATIBLE MATERIAL — QUEUE MANUALLY"
              : "DROP A TRACK ON A DECK TO ACTIVATE THE SCOUT"}
          </motion.p>
        )}
      </AnimatePresence>
    </section>
  );
}
