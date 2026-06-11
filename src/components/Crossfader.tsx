import { motion } from "framer-motion";
import type { CrossfadeState, DeckId } from "../types";

/**
 * Read-only visual of the automated A/B fader. The thumb position is the
 * literal volume automation: hard-left = Deck A full, hard-right = Deck B.
 */
export function Crossfader({
  crossfade,
  activeDeck,
}: {
  crossfade: CrossfadeState;
  activeDeck: DeckId;
}) {
  // Resting position follows the live deck; during a fade it tracks progress.
  let position: number;
  if (crossfade.active) {
    position = crossfade.to === "B" ? crossfade.progress : 1 - crossfade.progress;
  } else {
    position = activeDeck === "B" ? 1 : 0;
  }

  return (
    <div className={`xfader ${crossfade.active ? "xfader--live" : ""}`}>
      <div className="xfader__labels mono">
        <span className={activeDeck === "A" && !crossfade.active ? "is-hot" : ""}>A</span>
        <span className="xfader__title">AUTO CROSSFADE — 6.0S LINEAR</span>
        <span className={activeDeck === "B" && !crossfade.active ? "is-hot" : ""}>B</span>
      </div>
      <div className="xfader__rail">
        <div className="xfader__ticks">
          {Array.from({ length: 25 }).map((_, i) => (
            <span key={i} className={i % 6 === 0 ? "tick tick--major" : "tick"} />
          ))}
        </div>
        <motion.div
          className="xfader__thumb"
          animate={{ left: `${position * 100}%` }}
          transition={
            crossfade.active
              ? { duration: 0.1, ease: "linear" }
              : { type: "spring", stiffness: 200, damping: 24 }
          }
        />
        <motion.div
          className="xfader__glow"
          animate={{
            left: `${position * 100}%`,
            opacity: crossfade.active ? 1 : 0.35,
          }}
          transition={{ duration: 0.1, ease: "linear" }}
        />
      </div>
      <div className="xfader__readout mono">
        {crossfade.active ? (
          <span className="is-hot">
            TRANSITION {Math.round(crossfade.progress * 100)}% — {crossfade.from} ▸ {crossfade.to}
          </span>
        ) : (
          <span>FADER LOCKED TO DECK {activeDeck}</span>
        )}
      </div>
    </div>
  );
}
