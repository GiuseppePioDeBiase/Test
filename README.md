# MINI AI DJ MIXER — MIX SUITE

An autonomous dual-deck DJ **tool suite** for the browser — obsidian brutalism, glassmorphic decks, Spotify-style automix transitions, and an AI mix engine that beatmatches real streamed music end-to-end.

![stack](https://img.shields.io/badge/stack-React%2018%20·%20TypeScript%20·%20Vite%20·%20Framer%20Motion-c6ff00?style=flat-square&labelColor=0d0d0d)

## The suite

| Tool | What it does |
| --- | --- |
| **DECKS** | The dual-deck Auto-DJ console: waveforms, crossfader automation, AI mix scout, queue, telemetry feed |
| **LIBRARY** | Saved tracks (★ from any search result) + full play history — persisted locally, zero accounts |
| **ANALYZER** | Tap-tempo pad with live Δ against the playing deck, plus deep single-track analysis (name, URL or video id) |
| **SETTINGS** | Crossfade length (3–12 s), fade curve (smooth / equal-power / linear), trigger point (T-10…T-30 s), YouTube API key, gateway health diagnostics |

## What it does

- **Streaming search — every song findable.** Three resolution tiers: (1) the **official YouTube Data API v3** when you paste a free key in SETTINGS — full catalogue; (2) the entire pool of public Piped/Invidious gateways raced **in parallel**, first non-empty answer wins, so dead instances cost nothing; (3) a curated onboard library so the app never dead-ends. Nothing is ever downloaded — playback streams through embedded YouTube IFrame players.
- **Web-safe BPM analysis.** A two-path engine: when a CORS-accessible audio stream exists, ~30 s is decoded with the Web Audio API and run through a real DSP tempo estimator (energy-onset envelope → autocorrelation over the 60–180 BPM lag window, octave-folded). When the stream is iframe-only, a deterministic metadata model (genre keyword inference + stable per-track hash) takes over. The deck badge tells you which path verified the number (`DSP VERIFIED` vs `AI MODEL`).
- **Spotify-style auto-crossfade.** Two independent decks (A/B). The idle deck pre-buffers ahead of the fade; at the configured trigger the transition **arms** — the outgoing deck holds full volume until the incoming stream is *audibly rolling* (5 s safety timeout), so the handover never opens a hole into buffering silence. Then both faders ride the configured curve (default: smooth S-curve, like Spotify's automix) over the configured length, driven per-frame by `requestAnimationFrame`. The on-screen crossfader is the literal automation.
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
│   ├── search.ts     # Official API + parallel gateway race + onboard library + diagnostics
│   ├── bpm.ts        # DSP tempo estimator, metadata model, Camelot/mix scoring
│   ├── settings.ts   # Reactive localStorage stores: engine settings, library, history
│   └── autodj.ts     # The engine: queue, scout, arming handshake, curved fade automation
├── hooks/useAutoDJ.tsx   # Engine lifecycle + useSyncExternalStore snapshots
├── components/           # Deck, Waveform (canvas), Crossfader, SuggestionPanel,
│                         # QueuePanel, SearchOverlay, Ticker, LibraryView, AnalyzerView,
│                         # SettingsView, Scramble/Magnetic atoms
└── styles/global.css     # The design system — obsidian, acid-lime, glass, suite rail
```

The engine (`AutoDJEngine`) is pure TypeScript with zero React imports; the UI subscribes to immutable snapshots, so every state change — fader positions included — renders as one continuous motion stream.

## Design notes

High-contrast tech-brutalism: `#0d0d0d` obsidian, a single `#c6ff00` acid accent reserved for live/interactive states, Space Grotesk display type over IBM Plex Mono telemetry, asymmetric three-column stage (Deck B deliberately sits lower), heavy backdrop-blur glass, scanline artwork, animated grain, text-scramble decode effects, magnetic spring buttons, and skeleton shimmer for every loading state. `prefers-reduced-motion` collapses all of it gracefully.
