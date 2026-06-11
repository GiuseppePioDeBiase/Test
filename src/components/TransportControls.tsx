import type { EngineState } from "../types";
import { MagneticButton } from "./MagneticButton";

const PlayIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
    <path d="M7 4.5v15l13-7.5-13-7.5z" fill="currentColor" />
  </svg>
);
const PauseIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
    <path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor" />
  </svg>
);
const SkipIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
    <path d="M5 4.5v15l10-7.5-10-7.5zM17 4h3v16h-3z" fill="currentColor" />
  </svg>
);
const StopIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
    <rect x="5.5" y="5.5" width="13" height="13" fill="currentColor" />
  </svg>
);

export function TransportControls({
  state,
  onPause,
  onResume,
  onSkip,
  onStop,
}: {
  state: EngineState;
  onPause: () => void;
  onResume: () => void;
  onSkip: () => void;
  onStop: () => void;
}) {
  const playing = state.transport === "playing";
  const stopped = state.transport === "stopped";
  const canSkip =
    !stopped && !state.crossfade.active && (state.queue.length > 0 || state.bestCandidate !== null);

  return (
    <div className="transport">
      <MagneticButton
        className={`tbtn ${playing ? "tbtn--accent" : ""}`}
        disabled={stopped}
        onClick={playing ? onPause : onResume}
        aria-label={playing ? "Pause" : "Resume"}
      >
        {playing ? PauseIcon : PlayIcon}
        <span className="mono">{playing ? "PAUSE" : "RESUME"}</span>
      </MagneticButton>

      <MagneticButton
        className="tbtn"
        disabled={!canSkip}
        onClick={onSkip}
        aria-label="Skip to next track"
      >
        {SkipIcon}
        <span className="mono">SKIP / FORCE FADE</span>
      </MagneticButton>

      <MagneticButton
        className="tbtn tbtn--danger"
        disabled={stopped}
        onClick={onStop}
        aria-label="Stop everything"
      >
        {StopIcon}
        <span className="mono">STOP</span>
      </MagneticButton>
    </div>
  );
}
