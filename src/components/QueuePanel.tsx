import { AnimatePresence, motion } from "framer-motion";
import type { Track } from "../types";

export function QueuePanel({
  queue,
  onRemove,
}: {
  queue: Track[];
  onRemove: (id: string) => void;
}) {
  return (
    <section className="queue">
      <header className="queue__head mono">
        <span>UP NEXT</span>
        <span className="queue__count">{String(queue.length).padStart(2, "0")}</span>
      </header>
      {queue.length === 0 ? (
        <p className="queue__empty mono">QUEUE EMPTY — AUTO-DJ WILL SELF-SELECT</p>
      ) : (
        <ol className="queue__list">
          <AnimatePresence initial={false}>
            {queue.map((t, i) => (
              <motion.li
                key={t.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -24, transition: { duration: 0.18 } }}
                transition={{ type: "spring", stiffness: 320, damping: 30 }}
                className={`queue__item ${i === 0 ? "queue__item--next" : ""}`}
              >
                <span className="queue__idx mono">{String(i + 1).padStart(2, "0")}</span>
                <img className="queue__art" src={t.thumbnail} alt="" draggable={false} />
                <div className="queue__info">
                  <span className="queue__title">
                    {t.title.length > 38 ? t.title.slice(0, 38) + "…" : t.title}
                  </span>
                  <span className="queue__artist mono">{t.artist}</span>
                </div>
                {i === 0 && <span className="queue__next-tag mono">NEXT</span>}
                <button
                  className="queue__remove mono"
                  onClick={() => onRemove(t.id)}
                  aria-label={`Remove ${t.title} from queue`}
                >
                  ×
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}
    </section>
  );
}
