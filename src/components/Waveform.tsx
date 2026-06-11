import { useEffect, useRef } from "react";

interface Props {
  /** Seed so each track gets its own stable waveform fingerprint. */
  seed: string;
  /** 0..1 playback progress. */
  progress: number;
  /** 0..1 deck fader gain — amplitude breathes with the crossfade. */
  gain: number;
  playing: boolean;
  accent: string;
  height?: number;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const BAR_COUNT = 96;

/**
 * GPU-friendly canvas waveform: a fixed bar fingerprint per track, with a
 * travelling energy pulse around the playhead while audio is live. Played
 * bars render in the accent colour; unplayed bars in ghosted white.
 */
export function Waveform({ seed, progress, gain, playing, accent, height = 120 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ progress, gain, playing, accent });
  stateRef.current = { progress, gain, playing, accent };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rng = mulberry32(seedFrom(seed));
    const bars = Array.from({ length: BAR_COUNT }, (_, i) => {
      const base = 0.25 + rng() * 0.75;
      // Sculpt a musical arc: quieter intro/outro, denser body.
      const arc = Math.sin((i / BAR_COUNT) * Math.PI) * 0.5 + 0.5;
      return Math.min(1, base * (0.45 + arc * 0.75));
    });

    let raf = 0;
    let smoothedGain = stateRef.current.gain;

    const draw = (now: number) => {
      const { progress: p, gain: g, playing: live, accent: ac } = stateRef.current;
      smoothedGain += (g - smoothedGain) * 0.12;

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const gap = 2;
      const bw = (w - gap * (BAR_COUNT - 1)) / BAR_COUNT;
      const mid = h / 2;
      const playheadX = p * w;

      for (let i = 0; i < BAR_COUNT; i++) {
        const x = i * (bw + gap);
        const center = x + bw / 2;
        let amp = bars[i];

        if (live) {
          // Travelling pulse: bars near the playhead breathe with a phase wave.
          const dist = Math.abs(center - playheadX);
          const proximity = Math.max(0, 1 - dist / (w * 0.16));
          const wave = Math.sin(now / 130 + i * 0.55) * 0.5 + 0.5;
          amp *= 0.82 + proximity * wave * 0.5;
        } else {
          amp *= 0.72;
        }
        amp *= 0.25 + smoothedGain * 0.75;

        const bh = Math.max(2, amp * (h * 0.92));
        const played = center <= playheadX;

        if (played) {
          ctx.fillStyle = ac;
          ctx.globalAlpha = 0.92;
        } else {
          ctx.fillStyle = "#ffffff";
          ctx.globalAlpha = 0.16;
        }
        ctx.fillRect(x, mid - bh / 2, bw, bh);
      }
      ctx.globalAlpha = 1;

      // Playhead needle with glow.
      if (p > 0.001) {
        ctx.save();
        ctx.shadowColor = ac;
        ctx.shadowBlur = 12;
        ctx.fillStyle = ac;
        ctx.fillRect(playheadX - 0.75, 2, 1.5, h - 4);
        ctx.restore();
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [seed]);

  return <canvas ref={canvasRef} className="waveform" style={{ height }} />;
}
