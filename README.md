# MINI AI DJ MIXER

An autonomous dual-deck DJ console for the browser — obsidian brutalism, glassmorphic decks, and an AI mix engine that beatmatches real streamed music end-to-end.

![stack](https://img.shields.io/badge/stack-React%2018%20·%20TypeScript%20·%20Vite%20·%20Framer%20Motion-c6ff00?style=flat-square&labelColor=0d0d0d)

## What it does

- **Streaming search.** Search any real song. Tracks resolve through a pool of public YouTube gateways (Piped / Invidious JSON APIs, raced two at a time with hard timeouts) and play through embedded YouTube IFrame players — nothing is ever downloaded. A curated onboard library is the terminal fallback, so the app never dead-ends offline.
- **Web-safe BPM analysis.** A two-path engine: when a CORS-accessible audio stream exists, ~30 s is decoded with the Web Audio API and run through a real DSP tempo estimator (energy-onset envelope → autocorrelation over the 60–180 BPM lag window, octave-folded). When the stream is iframe-only, a deterministic metadata model (genre keyword inference + stable per-track hash) takes over — the same track always reports the same BPM. The deck badge tells you which path verified the number (`DSP VERIFIED` vs `AI MODEL`).
- **Dual-deck auto-crossfade.** Two independent decks (A/B). At **T-26 s** the idle deck pre-buffers the next track; at exactly **T-15 s** the Auto-DJ engages a **6-second linear crossfade** — outgoing fader rides 100→0 while the incoming deck rides 0→100, driven per-frame by `requestAnimationFrame`. The on-screen crossfader is the literal automation, not a decoration.
- **Intelligent Auto-DJ scout.** While a track plays, the engine scouts the catalogue with genre/BPM-derived queries, scores up to 6 candidates on harmonic BPM distance (half/double-time aware), energy, genre and Camelot-wheel key affinity, then surfaces the best one with a glowing **PERFECT MATCH** (Δ ≤ 2.5 BPM) or **COMPATIBLE** (Δ ≤ 7 BPM) badge. One click queues it. If you queue nothing, the Auto-DJ promotes its own best pick so the music never stops.
- **Full manual override.** Pause/Resume (freezes a mid-flight crossfade and resumes it where it left off), Skip (forces an immediate transition), and hard Stop.

## Run it

```bash
npm install
npm run dev      # → http://localhost:5173
npm run build    # typecheck + production bundle
```

> Browser autoplay policies require one user gesture — pressing **PLAY NOW** on any search result is that gesture; everything after is autonomous.

## Architecture

```
src/
├── lib/
│   ├── youtube.ts    # Promise-based IFrame API wrapper — two invisible DeckPlayers
│   ├── search.ts     # Multi-gateway streaming search with failover + onboard library
│   ├── bpm.ts        # DSP tempo estimator, metadata model, Camelot/mix scoring
│   └── autodj.ts     # The engine: queue, scout, preload, fade automation, telemetry
├── hooks/useAutoDJ.tsx   # Engine lifecycle + useSyncExternalStore snapshots
├── components/           # Deck, Waveform (canvas), Crossfader, SuggestionPanel,
│                         # QueuePanel, SearchOverlay, Ticker, Scramble/Magnetic atoms
└── styles/global.css     # The design system — obsidian, acid-lime, glass
```

The engine (`AutoDJEngine`) is pure TypeScript with zero React imports; the UI subscribes to immutable snapshots, so every state change — fader positions included — renders as one continuous motion stream.

## Design notes

High-contrast tech-brutalism: `#0d0d0d` obsidian, a single `#c6ff00` acid accent reserved for live/interactive states, Space Grotesk display type over IBM Plex Mono telemetry, asymmetric three-column stage (Deck B deliberately sits lower), heavy backdrop-blur glass, scanline artwork, animated grain, text-scramble decode effects, magnetic spring buttons, and skeleton shimmer for every loading state. `prefers-reduced-motion` collapses all of it gracefully.
