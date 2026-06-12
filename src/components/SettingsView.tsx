import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { updateSettings, useSettings, type FadeCurve } from "../lib/settings";
import { pingGateways, testApiKey, type GatewayStatus } from "../lib/search";
import { MagneticButton } from "./MagneticButton";
import { ScrambleText } from "./ScrambleText";

const CURVES: Array<{ id: FadeCurve; label: string; hint: string }> = [
  { id: "smooth", label: "SMOOTH", hint: "S-CURVE — SPOTIFY-STYLE AUTOMIX FEEL" },
  { id: "power", label: "EQUAL POWER", hint: "CONSTANT ENERGY — CLASSIC DJ HANDOVER" },
  { id: "linear", label: "LINEAR", hint: "STRAIGHT RAMP — SURGICAL & DRY" },
];

/** SETTINGS tool — transition engine tuning, API key, gateway diagnostics. */
export function SettingsView() {
  const settings = useSettings();
  const [keyDraft, setKeyDraft] = useState(settings.apiKey);
  const [keyStatus, setKeyStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [testingKey, setTestingKey] = useState(false);
  const [gateways, setGateways] = useState<GatewayStatus[] | null>(null);
  const [pinging, setPinging] = useState(false);

  const saveAndTestKey = async () => {
    const key = keyDraft.trim();
    updateSettings({ apiKey: key });
    if (!key) {
      setKeyStatus(null);
      return;
    }
    setTestingKey(true);
    setKeyStatus(null);
    const res = await testApiKey(key);
    setKeyStatus(res);
    setTestingKey(false);
  };

  const runDiagnostics = async () => {
    setPinging(true);
    setGateways(null);
    const res = await pingGateways();
    res.sort((a, b) => Number(b.ok) - Number(a.ok) || (a.latencyMs ?? 1e9) - (b.latencyMs ?? 1e9));
    setGateways(res);
    setPinging(false);
  };

  return (
    <div className="toolview">
      <header className="toolview__head">
        <ScrambleText text="SETTINGS" as="h2" className="toolview__title" />
        <p className="toolview__sub mono">
          TRANSITION ENGINE · SEARCH BACKENDS · DIAGNOSTICS — SAVED LOCALLY, LIVE INSTANTLY
        </p>
      </header>

      <div className="settings__grid">
        <section className="analyzer__card">
          <h3 className="analyzer__card-title mono">TRANSITION ENGINE</h3>

          <div className="setting">
            <div className="setting__row mono">
              <span>CROSSFADE LENGTH</span>
              <span className="is-hot">{(settings.fadeDurationMs / 1000).toFixed(1)}s</span>
            </div>
            <input
              type="range"
              className="slider"
              min={3000}
              max={12000}
              step={500}
              value={settings.fadeDurationMs}
              onChange={(e) => updateSettings({ fadeDurationMs: Number(e.target.value) })}
              aria-label="Crossfade length in seconds"
            />
            <p className="setting__hint mono">SPOTIFY DEFAULTS TO ~6S — LONGER = DREAMIER BLENDS</p>
          </div>

          <div className="setting">
            <div className="setting__row mono">
              <span>AUTO-FADE TRIGGER</span>
              <span className="is-hot">T-{settings.fadeTriggerSec}s</span>
            </div>
            <input
              type="range"
              className="slider"
              min={10}
              max={30}
              step={1}
              value={settings.fadeTriggerSec}
              onChange={(e) => updateSettings({ fadeTriggerSec: Number(e.target.value) })}
              aria-label="Seconds before track end when the fade engages"
            />
            <p className="setting__hint mono">
              HOW EARLY THE NEXT TRACK TAKES OVER — SKIPS LONG OUTROS
            </p>
          </div>

          <div className="setting">
            <div className="setting__row mono">
              <span>FADE CURVE</span>
            </div>
            <div className="curve-picker">
              {CURVES.map((c) => (
                <button
                  key={c.id}
                  className={`curve-option mono ${settings.fadeCurve === c.id ? "curve-option--on" : ""}`}
                  onClick={() => updateSettings({ fadeCurve: c.id })}
                >
                  <CurvePreview curve={c.id} active={settings.fadeCurve === c.id} />
                  <span className="curve-option__label">{c.label}</span>
                  <span className="curve-option__hint">{c.hint}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="analyzer__card">
          <h3 className="analyzer__card-title mono">SEARCH BACKENDS</h3>

          <div className="setting">
            <div className="setting__row mono">
              <span>YOUTUBE DATA API KEY</span>
              {settings.apiKey && <span className="is-hot">ACTIVE</span>}
            </div>
            <form
              className="search-form"
              onSubmit={(e) => {
                e.preventDefault();
                void saveAndTestKey();
              }}
            >
              <span className="search-form__prompt mono">▸</span>
              <input
                className="search-form__input mono"
                type="password"
                placeholder="PASTE YOUR FREE API V3 KEY…"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
              <MagneticButton className="search-form__go" type="submit" strength={10} disabled={testingKey}>
                {testingKey ? "…" : "SAVE & TEST"}
              </MagneticButton>
            </form>
            <AnimatePresence>
              {keyStatus && (
                <motion.p
                  className={`setting__status mono ${keyStatus.ok ? "is-hot" : "setting__status--bad"}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  {keyStatus.message}
                </motion.p>
              )}
            </AnimatePresence>
            <p className="setting__hint mono">
              UNLOCKS THE FULL OFFICIAL CATALOGUE — EVERY SONG FINDABLE. FREE AT
              CONSOLE.CLOUD.GOOGLE.COM → ENABLE "YOUTUBE DATA API V3" → CREATE API KEY.
              WITHOUT A KEY, SEARCH FALLS BACK TO PUBLIC GATEWAYS BELOW.
            </p>
          </div>

          <div className="setting">
            <div className="setting__row mono">
              <span>PUBLIC GATEWAY HEALTH</span>
              <MagneticButton className="result__btn" strength={8} onClick={runDiagnostics} disabled={pinging}>
                {pinging ? "PINGING…" : "RUN DIAGNOSTICS"}
              </MagneticButton>
            </div>
            <AnimatePresence mode="wait">
              {pinging && (
                <motion.p
                  key="pinging"
                  className="setting__hint mono"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <span className="skeleton skeleton--txt">PROBING ALL GATEWAYS IN PARALLEL…</span>
                </motion.p>
              )}
              {gateways && (
                <motion.ul
                  key="results"
                  className="gateway-list"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  {gateways.map((g) => (
                    <li key={g.host} className="gateway mono">
                      <span className={`status-dot ${g.ok ? "gateway__dot--ok" : "gateway__dot--down"}`} />
                      <span className="gateway__host">{g.host}</span>
                      <span className="gateway__kind dim">{g.kind.toUpperCase()}</span>
                      <span className={g.ok ? "is-hot" : "setting__status--bad"}>
                        {g.ok ? `${g.latencyMs}ms` : "DOWN"}
                      </span>
                    </li>
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
          </div>
        </section>
      </div>
    </div>
  );
}

/** Tiny SVG sketch of each fade curve so the choice is visual, not abstract. */
function CurvePreview({ curve, active }: { curve: FadeCurve; active: boolean }) {
  const pts: string[] = [];
  for (let i = 0; i <= 24; i++) {
    const p = i / 24;
    let g: number;
    if (curve === "linear") g = p;
    else if (curve === "power") g = Math.sin((p * Math.PI) / 2);
    else g = p * p * (3 - 2 * p);
    pts.push(`${p * 60},${28 - g * 24}`);
  }
  return (
    <svg viewBox="0 0 60 30" width="60" height="30" aria-hidden>
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={active ? "#c6ff00" : "rgba(255,255,255,0.4)"}
        strokeWidth="1.5"
      />
    </svg>
  );
}
