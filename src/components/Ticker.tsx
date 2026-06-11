import { AnimatePresence, motion } from "framer-motion";
import type { EngineLogEntry } from "../types";

function fmtClock(t: number): string {
  const d = new Date(t);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

/** Rolling engine telemetry feed — the HUD's heartbeat. */
export function Ticker({ log }: { log: EngineLogEntry[] }) {
  return (
    <div className="ticker mono">
      <div className="ticker__head">
        <span className="ticker__pulse" />
        ENGINE FEED
      </div>
      <ul className="ticker__list">
        <AnimatePresence initial={false}>
          {log.slice(0, 7).map((e) => (
            <motion.li
              key={e.id}
              layout
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              transition={{ type: "spring", stiffness: 400, damping: 32 }}
              className={`ticker__row ticker__row--${e.kind}`}
            >
              <span className="ticker__time">{fmtClock(e.at)}</span>
              <span className="ticker__text">{e.text}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}
