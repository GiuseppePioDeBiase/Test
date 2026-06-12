import { AnimatePresence, motion } from "framer-motion";
import type { DeckId, EngineState, Track } from "../types";
import { quickAnalyze, bpmDistance, tierFor } from "../lib/bpm";
import { planBlend } from "../lib/autodj";
import { useSettings } from "../lib/settings";
import { MagneticButton } from "./MagneticButton";

function fmtClock(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "--:--";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

const TIER_LABEL: Record<string, string> = {
  perfect: "PERFECT MATCH",
  compatible: "COMPATIBLE",
  stretch: "STRETCH MIX",
};

/**
 * The AUTO section: the engine's own advice on WHEN to change track.
 * Shows the computed perfect mix moment, a live countdown, what's coming
 * next (and on which deck), the AUTO on/off switch and MIX NOW.
 */
export function AutoMixPanel({
  state,
  onToggleAuto,
  onMixNow,
}: {
  state: EngineState;
  onToggleAuto: (on: boolean) => void;
  onMixNow: () => void;
}) {
  const { autoMixEnabled, mixPoint, mixCountdown, crossfade, transport, queue, bestCandidate } =
    state;
  const settings = useSettings();
  const live = state.decks[state.activeDeck];
  const idle: DeckId = state.activeDeck === "A" ? "B" : "A";

  const nextTrack: Track | null = queue[0] ?? bestCandidate?.track ?? null;
  const nextIsArmed = nextTrack !== null && state.decks[idle].track?.id === nextTrack.id;
  const nextDelta =
    nextTrack && live.analysis
      ? bpmDistance(live.analysis.bpm, quickAnalyze(nextTrack).bpm)
      : null;
  const blend = nextTrack
    ? planBlend(live.analysis?.bpm ?? null, quickAnalyze(nextTrack).bpm, settings)
    : null;

  const playing = transport === "playing" && live.track;
  const imminent = mixCountdown !== null && mixCountdown <= 20 && !crossfade.active;

  return (
    <section className={`automix ${imminent && autoMixEnabled ? "automix--imminent" : ""}`}>
      <header className="automix__head">
        <div className="automix__title-wrap">
          <h3 className="automix__title">AUTO</h3>
          <span className="automix__sub mono">THE ENGINE PICKS THE PERFECT MOMENT</span>
        </div>
        <button
          className={`switch ${autoMixEnabled ? "switch--on" : ""}`}
          onClick={() => onToggleAuto(!autoMixEnabled)}
          role="switch"
          aria-checked={autoMixEnabled}
          aria-label="Auto-mix"
        >
          <span className="switch__knob" />
          <span className="switch__label mono">{autoMixEnabled ? "ON" : "OFF"}</span>
        </button>
      </header>

      <div className="automix__countdown">
        <AnimatePresence mode="wait">
          {crossfade.active ? (
            <motion.div
              key="fading"
              className="automix__big is-hot"
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
            >
              {crossfade.phase === "arming" ? "SYNC" : `${Math.round(crossfade.progress * 100)}%`}
              <span className="automix__big-label mono">
                {crossfade.phase === "arming" ? "STARTING NEXT TRACK…" : "MIXING NOW"}
              </span>
            </motion.div>
          ) : playing && mixCountdown !== null ? (
            <motion.div
              key="counting"
              className={`automix__big ${imminent ? "automix__big--hot" : ""}`}
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
            >
              {mixCountdown <= 60 ? `${Math.ceil(mixCountdown)}s` : fmtClock(mixCountdown)}
              <span className="automix__big-label mono">
                {autoMixEnabled ? "TO THE PERFECT SWITCH" : "TO THE SUGGESTED SWITCH (AUTO OFF)"}
              </span>
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              className="automix__big automix__big--dim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              --
              <span className="automix__big-label mono">PLAY SOMETHING TO START THE CLOCK</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {playing && mixPoint !== null && live.duration > 0 && (
        <div className="automix__timeline">
          <div className="automix__timeline-rail">
            <motion.div
              className="automix__timeline-fill"
              animate={{ width: `${Math.min(100, (live.currentTime / live.duration) * 100)}%` }}
              transition={{ duration: 0.15, ease: "linear" }}
            />
            <div
              className="automix__timeline-mark"
              style={{ left: `${Math.min(100, (mixPoint / live.duration) * 100)}%` }}
              title={`Perfect mix point @ ${fmtClock(mixPoint)}`}
            />
          </div>
          <div className="automix__timeline-meta mono">
            <span>{fmtClock(live.currentTime)}</span>
            <span className="is-hot">SWITCH @ {fmtClock(mixPoint)} — PHRASE-ALIGNED</span>
            <span>{fmtClock(live.duration)}</span>
          </div>
        </div>
      )}

      <div className="automix__next">
        <span className="automix__next-label mono">NEXT UP</span>
        <AnimatePresence mode="wait">
          {nextTrack ? (
            <motion.div
              key={nextTrack.id}
              className="automix__next-card"
              initial={{ opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -14 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
              <img src={nextTrack.thumbnail} alt="" draggable={false} />
              <div className="automix__next-info">
                <span className="automix__next-title">
                  {nextTrack.title.length > 40 ? nextTrack.title.slice(0, 40) + "…" : nextTrack.title}
                </span>
                <span className="mono automix__next-meta">
                  {nextDelta !== null && (
                    <span className={`badge--${tierFor(nextDelta)} automix__next-badge`}>
                      {TIER_LABEL[tierFor(nextDelta)]}
                    </span>
                  )}
                  {nextIsArmed ? (
                    <span className="is-hot">⚡ ARMED ON DECK {idle}</span>
                  ) : (
                    <span className="dim">WILL LOAD ON DECK {idle}</span>
                  )}
                </span>
                {blend && (
                  <span className="mono automix__blend dim">
                    PLAN: {blend.label} · {(blend.durationMs / 1000).toFixed(1)}s{" "}
                    {blend.curve.toUpperCase()}
                  </span>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.p
              key="none"
              className="automix__next-empty mono"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              NOTHING CHOSEN YET — PICK A SUGGESTION BELOW OR SEARCH
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <MagneticButton
        className="automix__mixnow"
        disabled={!playing || crossfade.active || !nextTrack}
        onClick={onMixNow}
      >
        <span className="mono">⚡ MIX NOW</span>
      </MagneticButton>
    </section>
  );
}
