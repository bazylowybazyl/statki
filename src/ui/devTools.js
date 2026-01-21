// src/ui/devTools.js

const STYLES = `
#devtools {
  position: fixed;
  right: 16px;
  top: 16px;
  width: 340px;
  max-height: 80vh;
  overflow: auto;
  padding: 14px;
  border-radius: 12px;
  background: rgba(10, 14, 25, .92);
  border: 1px solid #1b2337;
  color: #dfe7ff;
  z-index: 1000;
  font-family: Inter, system-ui, Segoe UI, Roboto, Arial;
  display: none
}

#devtools h3 {
  margin: 0 0 8px 0;
  font-size: 16px;
  letter-spacing: .04em;
  text-transform: uppercase;
  color: #8fb5ff
}

#devtools .group {
  margin: 12px 0;
  padding: 10px;
  background: #0b0f1a;
  border: 1px solid #1b2337;
  border-radius: 10px
}

#devtools .row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0
}

#devtools .row label {
  flex: 1
}

#devtools input[type=range] {
  width: 180px
}

#devtools .val {
  min-width: 64px;
  text-align: right;
  font-variant-numeric: tabular-nums
}

#devtools .small {
  opacity: .7;
  font-size: 12px
}

#devtools .pill {
  display: inline-block;
  padding: 2px 8px;
  border: 1px solid #2a3a5a;
  border-radius: 999px;
  background: #0a1020
}

#devtools textarea {
  width: 100%;
  height: 90px;
  background: #0b1224;
  color: #dfe7ff;
  border: 1px solid #2a3a5a;
  border-radius: 8px;
  padding: 8px
}

#devtools .muted {
  color: #9fb0d8
}

#devtools .dt-row {
  display: flex;
  gap: 8px;
  margin-top: 6px
}

#devtools .dt-col {
  display: flex;
  flex-direction: column
}

#devtools .dt-stack {
  display: flex;
  flex-direction: column
}

#devtools .dt-btn {
  padding: 4px 8px;
  border: 1px solid #2a3a5a;
  border-radius: 8px;
  background: #0a1020;
  color: #dfe7ff;
  cursor: pointer
}

#devtools .dt-btn:hover {
  background: #18233c
}

#devtools .dt-label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .04em;
  text-transform: uppercase;
  color: #9fb0d8
}
`;

const HTML = `
<h3>DevTools</h3>

<div class="group">
  <div class="row"><strong>Wszechświat</strong></div>
  <div class="row">
    <label>Słońce – promień 2D (R)</label>
    <input id="sunR2D" type="range" min="50" max="1500" step="1" value="823">
    <div class="val" id="sunR2DVal"></div>
  </div>
  <div class="row">
    <label>Słońce – promień 3D (R)</label>
    <input id="sunR3D" type="range" min="50" max="1500" step="1" value="399">
    <div class="val" id="sunR3DVal"></div>
  </div>
  <div class="row">
    <label>Planety – skala globalna (×)</label>
    <input id="planetScaleAll" type="range" min="0.5" max="3" step="0.01" value="1">
    <div class="val" id="planetScaleAllVal"></div>
  </div>
</div>

<div class="group" id="planetsGroup">
  <div class="row"><strong>Planety (R)</strong> <span class="small muted">(per-planeta)</span></div>
  <!-- Tu JS doda po 1 wierszu na planetę -->
</div>

<!-- === Dystanse od Słońca (AU → promień orbity) ======================== -->
<div class="group" id="distancesGroup">
  <div class="row">
    <strong>Dystanse od Słońca</strong>
    <span class="small muted">(AU → promień orbity)</span>
  </div>
  <!-- Wiersze z suwakami będą dodane przez buildDistancesUI() -->
</div>

<div class="group">
  <div class="row"><strong>Stacje</strong></div>
  <div class="row">
    <label>Skala stacji pirackiej (×)</label>
    <input id="pirScale" type="range" min="0.4" max="12" step="0.01" value="6">
    <div class="val" id="pirScaleVal"></div>
  </div>
  <div class="row">
    <label>Skala stacji 3D (×)</label>
    <input id="station3DScale" type="range" min="0.2" max="12.0" step="0.05" value="2.70">
    <div class="val" id="station3DScaleVal"></div>
  </div>
  <div class="row">
    <label>Stacja 3D – rozmiar sprite (px)</label>
    <input id="stationSpritePx" type="number" min="64" max="4096" step="32" value="1024" style="width:96px;">
  </div>
  <div class="dt-row">
    <div class="dt-col">
      <div class="dt-label" style="margin-top:6px;">Skala per stacja</div>
      <div id="dt-stations-per-scale" class="dt-stack" style="gap:6px;"></div>
      <button id="dt-reset-station-scales" class="dt-btn" style="margin-top:6px;">Reset per stacja</button>
    </div>
  </div>
  <label style="display:flex;gap:6px;align-items:center;margin-top:8px">
    <input id="dt-use-planet-stations" type="checkbox" />
    Planet Stations 3D (overlay)
  </label>
  <label style="display:flex;gap:6px;align-items:center;margin-top:8px">
    <input id="dt-use-3d-pirate" type="checkbox" />
    3D Pirate Station (hide 2D)
  </label>
</div>

<div class="group" id="stationsFramesGroup">
  <div class="row"><strong>Stacje (kadr per stacja)</strong></div>
  <!-- Wiersze z suwakami per stacja będą dodane dynamicznie przez buildStationFramesUI() -->
</div>

<div class="group" id="warpVfxGroup">
  <div class="row"><strong>Warp Wormhole VFX</strong> <span class="small muted">(soczewka statku)</span></div>
  <div class="row">
    <label>Próg trybu pełnego</label>
    <input id="warpLensThreshold" type="range" min="0" max="1" step="0.01">
    <input id="warpLensThresholdNum" type="number" min="0" max="1" step="0.01" style="width:72px;">
    <div class="val" id="warpLensThresholdVal"></div>
  </div>
  <div class="row">
    <label>Promień bazowy</label>
    <input id="warpRadiusBase" type="range" min="0.05" max="0.6" step="0.005">
    <input id="warpRadiusBaseNum" type="number" min="0.05" max="0.6" step="0.005" style="width:72px;">
    <div class="val" id="warpRadiusBaseVal"></div>
  </div>
  <div class="row">
    <label>Promień — skala</label>
    <input id="warpRadiusScale" type="range" min="0" max="0.3" step="0.005">
    <input id="warpRadiusScaleNum" type="number" min="0" max="0.3" step="0.005" style="width:72px;">
    <div class="val" id="warpRadiusScaleVal"></div>
  </div>
  <div class="row">
    <label>Masa bazowa</label>
    <input id="warpMassBase" type="range" min="0" max="0.5" step="0.005">
    <input id="warpMassBaseNum" type="number" min="0" max="0.5" step="0.005" style="width:72px;">
    <div class="val" id="warpMassBaseVal"></div>
  </div>
  <div class="row">
    <label>Masa — skala</label>
    <input id="warpMassScale" type="range" min="0" max="0.6" step="0.005">
    <input id="warpMassScaleNum" type="number" min="0" max="0.6" step="0.005" style="width:72px;">
    <div class="val" id="warpMassScaleVal"></div>
  </div>
  <div class="row">
    <label>Miękkość krawędzi</label>
    <input id="warpSoftness" type="range" min="0" max="1" step="0.01">
    <input id="warpSoftnessNum" type="number" min="0" max="1" step="0.01" style="width:72px;">
    <div class="val" id="warpSoftnessVal"></div>
  </div>
  <div class="row">
    <label>Przezroczystość bazowa</label>
    <input id="warpOpacityBase" type="range" min="0" max="1" step="0.01">
    <input id="warpOpacityBaseNum" type="number" min="0" max="1" step="0.01" style="width:72px;">
    <div class="val" id="warpOpacityBaseVal"></div>
  </div>
  <div class="row">
    <label>Przezroczystość — skala</label>
    <input id="warpOpacityScale" type="range" min="0" max="1" step="0.01">
    <input id="warpOpacityScaleNum" type="number" min="0" max="1" step="0.01" style="width:72px;">
    <div class="val" id="warpOpacityScaleVal"></div>
  </div>
  <div class="row">
    <label>Wydłużenie wzdłuż lotu</label>
    <input id="warpLensForwardStretch" type="range" min="0.1" max="2" step="0.01">
    <input id="warpLensForwardStretchNum" type="number" min="0.1" max="2" step="0.01" style="width:72px;">
    <div class="val" id="warpLensForwardStretchVal"></div>
  </div>
  <div class="row">
    <label>Offset wzdłuż kadłuba</label>
    <input id="warpTailDepthExtra" type="range" min="-0.2" max="0.8" step="0.01">
    <input id="warpTailDepthExtraNum" type="number" min="-0.2" max="0.8" step="0.01" style="width:72px;">
    <div class="val" id="warpTailDepthExtraVal"></div>
  </div>
</div>

<div class="group">
  <div class="row">
    <label><input id="toggleRuler" type="checkbox"> Miarka (okręgi dystansu)</label>
  </div>
  <div class="row">
    <label><input id="togglePlanetOrbits" type="checkbox"> Miarki planet (inner/outer/gravity)</label>
  </div>
  <div class="row">
    <label><input id="toggleUnlimitedWarp" type="checkbox"> Nielimitowany warp <span class="pill">F9</span></label>
  </div>
  <div class="row">
    <label><input id="dt-show-sundir" type="checkbox"> Pokaż kierunek słońca</label>
  </div>
  <div class="row">
    <label><input id="dt-disable-shake" type="checkbox"> Wyłącz wstrząsy kamery</label>
  </div>
</div>

<div class="group">
  <div class="row"><strong>Konfiguracja</strong></div>
  <div class="row">
    <button id="btnCopy">Kopiuj aktualną konfigurację</button>
    <button id="btnReset" style="margin-left:auto">Reset</button>
  </div>
  <div class="row"><textarea id="cfgOut" readonly></textarea></div>
  <div class="small muted">Skopiuj JSON i wklej do kodu (np. stałe R), gdy chcesz utrwalić w repo.</div>
</div>

<div class="small muted">F10 — pokaż/ukryj panel</div>
`;

export function initDevTools() {
  if (document.getElementById('devtools')) return;

  const style = document.createElement('style');
  style.textContent = STYLES;
  document.head.appendChild(style);

  const container = document.createElement('div');
  container.id = 'devtools';
  container.innerHTML = HTML;
  document.body.appendChild(container);

  wireDevToolsLogic();
}

function wireDevToolsLogic() {
  function wireDevTools() {
    const saveLS = () => { window.__devtoolsSaveLS?.(); };
    const elUnlimited = document.getElementById('dt-unlimited-warp') || document.getElementById('toggleUnlimitedWarp');
    const elRuler = document.getElementById('dt-show-ruler') || document.getElementById('toggleRuler');
    const elPlanetOrbits = document.getElementById('dt-show-planet-orbits') || document.getElementById('togglePlanetOrbits');
    const elScale = document.getElementById('dt-pirate-scale') || document.getElementById('pirScale');
    const elScaleVal = document.getElementById('dt-pirate-scale-value') || document.getElementById('pirScaleVal');
    const elStation3DScale = document.getElementById('dt-station3d-scale') || document.getElementById('station3DScale');
    const elStation3DScaleVal = document.getElementById('dt-station3d-scale-value') || document.getElementById('station3DScaleVal');
    const elPlanet3D = document.getElementById('dt-use-planet-stations');
    const elPir3D = document.getElementById('dt-use-3d-pirate');
    const elSunDir = document.getElementById('dt-show-sundir');

    if (elUnlimited) {
      elUnlimited.checked = !!DevFlags.unlimitedWarp;
      elUnlimited.addEventListener('change', e => {
        DevFlags.unlimitedWarp = e.target.checked;
        if (DevFlags.unlimitedWarp) warp.fuel = warp.fuelMax;
        const legacyUnlimited = document.getElementById('toggleUnlimitedWarp');
        if (legacyUnlimited) legacyUnlimited.checked = DevFlags.unlimitedWarp;
      });
    }
    if (elRuler) {
      elRuler.checked = !!DevFlags.showRuler;
      elRuler.addEventListener('change', e => {
        DevFlags.showRuler = e.target.checked;
        const legacyRuler = document.getElementById('toggleRuler');
        if (legacyRuler) legacyRuler.checked = DevFlags.showRuler;
      });
    }
    if (elPlanetOrbits) {
      elPlanetOrbits.checked = !!DevFlags.showPlanetOrbits;
      elPlanetOrbits.addEventListener('change', e => {
        DevFlags.showPlanetOrbits = e.target.checked;
        const legacyPlanets = document.getElementById('togglePlanetOrbits');
        if (legacyPlanets) legacyPlanets.checked = DevFlags.showPlanetOrbits;
        saveLS();
      });
    }

    if (elSunDir) {
      elSunDir.checked = !!(window.DevFlags && DevFlags.showSunDir);
      elSunDir.addEventListener('change', e => {
        if (!window.DevFlags) window.DevFlags = {};
        DevFlags.showSunDir = !!e.target.checked;
        if (typeof scheduleRebuild3D === 'function') scheduleRebuild3D();
        saveLS();
      });
    }

    const applyScale = () => {
      if (!elScale) return;
      const v = parseFloat(elScale.value);
      DevTuning.pirateStationScale = isFinite(v) ? v : 1.0;
      if (window.DevConfig) {
        window.DevConfig.pirateScale = DevTuning.pirateStationScale;
      }
      const legacyScale = document.getElementById('pirScale');
      if (legacyScale) legacyScale.value = String(DevTuning.pirateStationScale);
      const legacyScaleVal = document.getElementById('pirScaleVal');
      if (legacyScaleVal) legacyScaleVal.textContent = '×' + DevTuning.pirateStationScale.toFixed(2);
      if (elScaleVal) elScaleVal.textContent = DevTuning.pirateStationScale.toFixed(2);
    };

    const applyStation3DScale = (inputValue) => {
      const parsed = Number(inputValue);
      const fallbackValue = window.DEFAULT_STATION_3D_SCALE ?? 2.70;
      const fallback = (Number.isFinite(parsed) && parsed > 0)
        ? parsed
        : fallbackValue;
      const value = fallback;
      DevTuning.pirateStationScale = value;
      Dev.station3DScale = value;
      if (window.DevConfig) {
        window.DevConfig.station3DScale = value;
      }
      if (window.USE_STATION_3D && typeof window.__setStation3DScale === 'function') {
        __setStation3DScale(value);
      }
      if (elStation3DScaleVal) elStation3DScaleVal.textContent = value.toFixed(2);
      const legacy = document.getElementById('station3DScale');
      const legacyVal = document.getElementById('station3DScaleVal');
      if (legacy) legacy.value = String(value);
      if (legacyVal) legacyVal.textContent = '×' + value.toFixed(2);
    };

    // Ustaw wartość z DevConfig (jeśli jest) i natychmiast zastosuj na starcie
    if (elStation3DScale) {
      const fallbackValue = window.DEFAULT_STATION_3D_SCALE ?? 2.70;
      const initialRaw =
        (window.DevConfig && Number.isFinite(DevConfig.station3DScale) && DevConfig.station3DScale) ||
        (Number.isFinite(+elStation3DScale.value) ? +elStation3DScale.value : NaN);
      const initial = (Number.isFinite(initialRaw) && initialRaw > 0)
        ? initialRaw
        : fallbackValue;
      elStation3DScale.value = String(initial);
      applyStation3DScale(initial);
      if (typeof scheduleRebuild3D === 'function') scheduleRebuild3D();
    }

    if (elScale) {
      if (!isFinite(parseFloat(elScale.value))) {
        elScale.value = String(DevTuning.pirateStationScale);
      }
      elScale.addEventListener('input', applyScale);
      elScale.addEventListener('change', applyScale);
      applyScale();
    } else if (elScaleVal) {
      elScaleVal.textContent = DevTuning.pirateStationScale.toFixed(2);
    }

    if (elStation3DScale) {
      if (!isFinite(parseFloat(elStation3DScale.value)) || parseFloat(elStation3DScale.value) <= 0) {
        elStation3DScale.value = String(DevTuning.pirateStationScale);
      }
      applyStation3DScale(elStation3DScale.value);
      elStation3DScale.addEventListener('input', e => applyStation3DScale(e.target.value));
      elStation3DScale.addEventListener('change', e => applyStation3DScale(e.target.value));
    } else if (elStation3DScaleVal) {
      elStation3DScaleVal.textContent = DevTuning.pirateStationScale.toFixed(2);
    }

    if (elPlanet3D) {
      const stored = typeof DevFlags.usePlanetStations3D === 'boolean'
        ? DevFlags.usePlanetStations3D
        : window.USE_PLANET_STATIONS_3D !== false;
      const enabled = stored !== false;
      DevFlags.usePlanetStations3D = enabled;
      window.USE_PLANET_STATIONS_3D = enabled;
      elPlanet3D.checked = enabled;
      elPlanet3D.addEventListener('change', (e) => {
        const value = !!e.target.checked;
        DevFlags.usePlanetStations3D = value;
        window.USE_PLANET_STATIONS_3D = value;
        if (Array.isArray(window.stations) && typeof window.updateStations3D === 'function') {
          window.updateStations3D(window.stations);
        }
        saveLS();
      });
    }

    if (elPir3D) {
      if (typeof DevFlags.use3DPirateStation === 'boolean') {
        window.USE_STATION_3D = DevFlags.use3DPirateStation;
      }
      elPir3D.checked = window.USE_STATION_3D !== false;
      elPir3D.addEventListener('change', e => {
        if (!window.DevFlags) window.DevFlags = {};
        DevFlags.use3DPirateStation = e.target.checked;
        window.USE_STATION_3D = e.target.checked;
        if (window.USE_STATION_3D && window.__setStation3DScale && typeof Dev.station3DScale === 'number') {
          __setStation3DScale(Dev.station3DScale);
        }
      });
    }
  }
  window.wireDevTools = wireDevTools;

  // Nie nadpisuj obiektu! Zachowaj referencję, bo gameplay trzyma do niej const.
  const __devtoolsDefaults = {
    showRuler: false,
    showPlanetOrbits: false,
    unlimitedWarp: false,
    showSunDir: false,
    use3DPirateStation: true,
    usePlanetStations3D: true,
    disableCameraShake: false
  };
  if (!window.DevFlags) window.DevFlags = {};
  for (const k in __devtoolsDefaults) {
    if (!(k in window.DevFlags)) window.DevFlags[k] = __devtoolsDefaults[k];
  }
  const DevFlags = window.DevFlags; // lokalny skrót do TEGO SAMEGO obiektu
  const DEFAULT_PIRATE_SCALE = (
    typeof window !== 'undefined' && typeof window.DEFAULT_STATION_SCALE === 'number'
  ) ? window.DEFAULT_STATION_SCALE : 6;
  const DEFAULT_STATION3D_SCALE = (
    typeof window !== 'undefined' && typeof window.DEFAULT_STATION_3D_SCALE === 'number'
  ) ? window.DEFAULT_STATION_3D_SCALE : 2.70;

  const Dev = window.Dev = window.Dev || {};
  const DevTuning = window.DevTuning = Object.assign({
    pirateStationScale: DEFAULT_PIRATE_SCALE
  }, window.DevTuning || {});

  if (!Number.isFinite(Dev.station3DScale) || Dev.station3DScale <= 0) {
    Dev.station3DScale = DEFAULT_STATION3D_SCALE;
  }

  // Klasyczny skrypt nie widzi stałych z ESM — korzystaj z window.* w runtime.
  // === Wczytaj podstawowe obiekty gry (muszą już istnieć globalnie): SUN, planets, initPlanets3D ===
  // Zakładamy: let SUN = {...}, let planets = [...]; render pętla już działa.

  // ---- Stan & persistencja ------------------------------------------------
  const DevConfig = {
    sunR2D: 823,               // liczba — promień Słońca (warstwa 2D)
    sunR3D: 399,               // liczba — promień Słońca (warstwa 3D)
    planetRById: {},           // { [id or name]: R }
    planetOrbitAUById: {
      mercury: 0.84,
      venus: 1.41,
      earth: 2.07,
      mars: 2.86,
      jupiter: 5.2,
      saturn: 9.58,
      uranus: 19.2,
      neptune: 30
    },      // { [id or name]: AU }
    // Nie zależ od momentu ładowania modułów – czytaj z window w runtime.
    planetScaleAll: (typeof window.DEFAULT_PLANET_SCALE === 'number' ? window.DEFAULT_PLANET_SCALE : 1),                  // mnożnik globalny ×R
    pirateScale: DEFAULT_PIRATE_SCALE,           // mnożnik rysowania stacji pirackiej
    station3DScale: DEFAULT_STATION3D_SCALE,     // mnożnik nakładki 3D
    stationSpriteSize: 1024,
    stationSpriteFrame: 3.00,
    stationSpriteFrameById: {},
    stationScaleById: { earth: 1.10 },
  };
  window.DevConfig = DevConfig;

  const WarpLensDefaults = (window.__WARP_LENS_DEFAULTS && typeof window.__WARP_LENS_DEFAULTS === 'object')
    ? window.__WARP_LENS_DEFAULTS
    : {
      threshold: 0,
      radiusBase: 0.6,
      radiusScale: 0.3,
      massBase: 0,
      massScale: 0.035,
      softness: 0.6,
      opacityBase: 0.55,
      opacityScale: 0.73,
      tailDepthExtra: -0.2,
      forwardStretch: 1.0
    };
  if (!window.__WARP_LENS_DEFAULTS) {
    window.__WARP_LENS_DEFAULTS = WarpLensDefaults;
  }
  const DevVFX = window.DevVFX = window.DevVFX || {};
  DevVFX.warpLens = Object.assign({}, WarpLensDefaults, DevVFX.warpLens || {});

  // ---- Elementy UI --------------------------------------------------------
  const el = (id) => document.getElementById(id);
  const ui = {};
  const uiIds = {
    root: 'devtools',
    sunR2D: 'sunR2D',
    sunR2DVal: 'sunR2DVal',
    sunR3D: 'sunR3D',
    sunR3DVal: 'sunR3DVal',
    planetScaleAll: 'planetScaleAll',
    planetScaleAllVal: 'planetScaleAllVal',
    pirScale: 'pirScale',
    pirScaleVal: 'pirScaleVal',
    station3DScale: 'station3DScale',
    station3DScaleVal: 'station3DScaleVal',
    stationSpritePx: 'stationSpritePx',
    stationsFramesGroup: 'stationsFramesGroup',
    planetsGroup: 'planetsGroup',
    distancesGroup: 'distancesGroup',
    cbRuler: 'toggleRuler',
    cbPlanetOrbits: 'togglePlanetOrbits',
    cbUnlimited: 'toggleUnlimitedWarp',
    cbSunDir: 'dt-show-sundir',
    cbShake: 'dt-disable-shake',
    cbPlanetStations3D: 'dt-use-planet-stations',
    cbPirate3D: 'dt-use-3d-pirate',
    btnCopy: 'btnCopy',
    btnReset: 'btnReset',
    cfgOut: 'cfgOut'
  };

  function refreshUIRefs() {
    for (const [key, id] of Object.entries(uiIds)) {
      ui[key] = el(id);
    }
  }

  refreshUIRefs();
  window.__refreshDevUIRefs = refreshUIRefs;

  const warpLensUI = {
    threshold: { slider: el('warpLensThreshold'), number: el('warpLensThresholdNum'), label: el('warpLensThresholdVal'), decimals: 2 },
    radiusBase: { slider: el('warpRadiusBase'), number: el('warpRadiusBaseNum'), label: el('warpRadiusBaseVal'), decimals: 3 },
    radiusScale: { slider: el('warpRadiusScale'), number: el('warpRadiusScaleNum'), label: el('warpRadiusScaleVal'), decimals: 3 },
    massBase: { slider: el('warpMassBase'), number: el('warpMassBaseNum'), label: el('warpMassBaseVal'), decimals: 3 },
    massScale: { slider: el('warpMassScale'), number: el('warpMassScaleNum'), label: el('warpMassScaleVal'), decimals: 3 },
    softness: { slider: el('warpSoftness'), number: el('warpSoftnessNum'), label: el('warpSoftnessVal'), decimals: 2 },
    opacityBase: { slider: el('warpOpacityBase'), number: el('warpOpacityBaseNum'), label: el('warpOpacityBaseVal'), decimals: 2 },
    opacityScale: { slider: el('warpOpacityScale'), number: el('warpOpacityScaleNum'), label: el('warpOpacityScaleVal'), decimals: 2 },
    forwardStretch: { slider: el('warpLensForwardStretch'), number: el('warpLensForwardStretchNum'), label: el('warpLensForwardStretchVal'), decimals: 2 },
    tailDepthExtra: { slider: el('warpTailDepthExtra'), number: el('warpTailDepthExtraNum'), label: el('warpTailDepthExtraVal'), decimals: 2 }
  };
  ui.warpLens = warpLensUI;

  const warpLensRanges = {
    threshold: { min: 0, max: 1 },
    radiusBase: { min: 0.01, max: 1 },
    radiusScale: { min: 0, max: 0.6 },
    massBase: { min: 0, max: 1 },
    massScale: { min: 0, max: 1 },
    softness: { min: 0, max: 1 },
    opacityBase: { min: 0, max: 1 },
    opacityScale: { min: 0, max: 1 },
    forwardStretch: { min: 0.1, max: 3 },
    tailDepthExtra: { min: -1, max: 1 }
  };

  function sanitizeWarpLensValue(key, raw) {
    const defaults = WarpLensDefaults;
    const range = warpLensRanges[key] || {};
    let v = Number(raw);
    if (!Number.isFinite(v)) v = defaults[key];
    if (typeof range.min === 'number') v = Math.max(range.min, v);
    if (typeof range.max === 'number') v = Math.min(range.max, v);
    return v;
  }

  function setWarpLensField(key, value) {
    const ctrl = warpLensUI[key];
    if (!ctrl) return;
    const decimals = typeof ctrl.decimals === 'number' ? ctrl.decimals : 2;
    const formatted = value.toFixed(decimals);
    if (ctrl.slider) ctrl.slider.value = String(value);
    if (ctrl.number) ctrl.number.value = formatted;
    if (ctrl.label) ctrl.label.textContent = formatted;
  }

  function reflectWarpLensToUI() {
    for (const key in warpLensUI) {
      const value = DevVFX.warpLens?.[key];
      const defaults = WarpLensDefaults;
      const v = Number.isFinite(value) ? value : defaults[key];
      setWarpLensField(key, v);
    }
  }

  function applyWarpLensValue(key, raw) {
    const value = sanitizeWarpLensValue(key, raw);
    if (!DevVFX.warpLens) DevVFX.warpLens = {};
    DevVFX.warpLens[key] = value;
    setWarpLensField(key, value);
    saveLS();
    reflectToCfg();
  }

  // ---- Inicjalne odczyty z gry -------------------------------------------
  function bootstrapFromGame() {
    const sun = window.SUN;
    if (sun) {
      if (DevConfig.sunR2D == null) DevConfig.sunR2D = sun.r;
      if (DevConfig.sunR3D == null) {
        const base3D = (typeof sun.r3D === 'number') ? sun.r3D : sun.r;
        DevConfig.sunR3D = base3D;
      }
    }
    // domyślne per-planeta (key = name lub id)
    const planetList = Array.isArray(window.planets) ? window.planets : [];
    for (const p of planetList) {
      const key = (p.name || p.id || String(p.index) || '').toString().toLowerCase();
      const baseR = p.baseR ?? p.r;
      if (baseR != null && !Number.isFinite(DevConfig.planetRById[key])) {
        DevConfig.planetRById[key] = baseR;
      }
    }
  }

  function stationKey(st) {
    if (!st) return null;
    if (st.id != null) return String(st.id).toLowerCase();
    if (st.name) return String(st.name).toLowerCase();
    return null;
  }

  // ---- Persistencja -------------------------------------------------------
  function loadLS() {
    try {
      const cfg = JSON.parse(localStorage.getItem('devConfig') || 'null');
      if (cfg && typeof cfg === 'object') {
        Object.assign(DevConfig, cfg);
        if (typeof DevConfig.pirateScale === 'number') {
          DevTuning.pirateStationScale = DevConfig.pirateScale;
        }
        if (typeof DevConfig.station3DScale === 'number') {
          if (DevConfig.station3DScale > 0) {
            Dev.station3DScale = DevConfig.station3DScale;
          } else {
            DevConfig.station3DScale = DEFAULT_STATION3D_SCALE;
            Dev.station3DScale = DEFAULT_STATION3D_SCALE;
          }
        }
      }
    } catch { }
    // devFlags w osobnym bloku – defensywnie:
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('devFlags') || 'null'); } catch { }
    if (saved && typeof saved === 'object') {
      // Mutacja ISTNIEJĄCEGO obiektu, bez utraty referencji
      Object.assign(window.DevFlags, saved);
    }
    if (typeof DevFlags.usePlanetStations3D !== 'boolean') {
      DevFlags.usePlanetStations3D = true;
    }
    if (typeof DevFlags.disableCameraShake !== 'boolean') {
      DevFlags.disableCameraShake = false;
    }
    try {
      const savedVfx = JSON.parse(localStorage.getItem('devVfx') || 'null');
      if (savedVfx && typeof savedVfx === 'object') {
        const savedLens = savedVfx.warpLens;
        if (savedLens && typeof savedLens === 'object') {
          DevVFX.warpLens = Object.assign({}, WarpLensDefaults, savedLens);
        }
      }
    } catch { }
    if (typeof window !== 'undefined') {
      window.USE_PLANET_STATIONS_3D = DevFlags.usePlanetStations3D !== false;
    }
    if (!DevConfig.planetOrbitAUById || typeof DevConfig.planetOrbitAUById !== 'object') {
      DevConfig.planetOrbitAUById = {};
    }
    if (typeof DevConfig.planetScaleAll !== 'number') {
      DevConfig.planetScaleAll = (typeof window.DEFAULT_PLANET_SCALE === 'number' ? window.DEFAULT_PLANET_SCALE : 1);
    }
    if (typeof DevConfig.pirateScale !== 'number') {
      DevConfig.pirateScale = DevTuning.pirateStationScale;
    }
    if (typeof DevConfig.station3DScale !== 'number' || DevConfig.station3DScale <= 0) {
      const fallback = (Dev.station3DScale > 0) ? Dev.station3DScale : DEFAULT_STATION3D_SCALE;
      DevConfig.station3DScale = fallback;
    }
    if (typeof DevConfig.stationSpriteSize !== 'number') {
      let saved = NaN;
      try {
        saved = Number(localStorage.getItem('stationSpriteSize'));
      } catch { }
      DevConfig.stationSpriteSize = Number.isFinite(saved) ? saved : 512;
    }
    if (typeof DevConfig.stationSpriteFrame !== 'number') {
      let saved = NaN;
      try {
        saved = Number(localStorage.getItem('stationSpriteFrame'));
      } catch { }
      DevConfig.stationSpriteFrame = Number.isFinite(saved) ? saved : 3.00;
    }
    if (!DevConfig.stationSpriteFrameById || typeof DevConfig.stationSpriteFrameById !== 'object') {
      try {
        DevConfig.stationSpriteFrameById = JSON.parse(localStorage.getItem('stationSpriteFrameById') || '{}') || {};
      } catch {
        DevConfig.stationSpriteFrameById = {};
      }
    }
    if (!DevConfig.stationScaleById || typeof DevConfig.stationScaleById !== 'object') {
      DevConfig.stationScaleById = {};
    }
    const legacySun = Number.isFinite(DevConfig.sunR) ? +DevConfig.sunR : null;
    if (!Number.isFinite(DevConfig.sunR2D) && legacySun != null) {
      DevConfig.sunR2D = legacySun;
    }
    if (!Number.isFinite(DevConfig.sunR3D) && legacySun != null) {
      DevConfig.sunR3D = legacySun;
    }
    if (!Number.isFinite(DevConfig.sunR2D)) {
      DevConfig.sunR2D = null;
    }
    if (!Number.isFinite(DevConfig.sunR3D) && Number.isFinite(DevConfig.sunR2D)) {
      DevConfig.sunR3D = DevConfig.sunR2D;
    }
    delete DevConfig.sunR;
    if (window.__setStation3DScale && window.USE_STATION_3D) {
      window.__lastStationScale = 1;
      __setStation3DScale(Dev.station3DScale);
    }
  }
  function saveLS() {
    localStorage.setItem('devConfig', JSON.stringify(DevConfig));
    localStorage.setItem('devFlags', JSON.stringify(DevFlags));
    try { localStorage.setItem('devVfx', JSON.stringify({ warpLens: DevVFX.warpLens })); } catch { }
  }
  window.__devtoolsSaveLS = saveLS;

  // ---- Rebuild 3D (throttle) ---------------------------------------------
  let rebuildTimer = null;
  function scheduleRebuild3D() {
    if (rebuildTimer) cancelAnimationFrame(rebuildTimer);
    rebuildTimer = requestAnimationFrame(() => {
      // aktualizujemy struktury gry na podstawie DevConfig
      const gameSun = window.SUN || { r: 823, r3D: 399 };

      const numericSun2D = Number.isFinite(DevConfig.sunR2D) ? DevConfig.sunR2D : gameSun.r;
      const appliedSun2D = Math.max(1, Math.round(numericSun2D || 0));
      SUN.r = appliedSun2D;
      const numericSun3D = Number.isFinite(DevConfig.sunR3D) ? DevConfig.sunR3D : appliedSun2D;
      const appliedSun3D = Math.max(1, Math.round(numericSun3D || 0));
      SUN.r3D = appliedSun3D;
      const defaultScale = (typeof window.DEFAULT_PLANET_SCALE === 'number' ? window.DEFAULT_PLANET_SCALE : 1);
      const scaleAll = Number.isFinite(+DevConfig.planetScaleAll) && +DevConfig.planetScaleAll > 0
        ? +DevConfig.planetScaleAll
        : defaultScale;
      const planetList = Array.isArray(window.planets) ? window.planets : [];
      for (const p of planetList) {
        const key = (p.name || p.id || String(p.index) || '').toString().toLowerCase();
        const base = DevConfig.planetRById[key] ?? p.baseR ?? p.r;
        if (base != null) {
          p.baseR = base;
          p.r = Math.max(1, Math.round(base * scaleAll));
        }
      }
      // Odbudowa warstwy 3D
      if (typeof initPlanets3D === 'function') {
        const sunFor3D = Object.assign({}, SUN, { r: appliedSun3D });
        if (!Number.isFinite(sunFor3D.r3D)) sunFor3D.r3D = appliedSun3D;
        initPlanets3D(planetList, sunFor3D);
      }
    });
  }

  // ---- Rysowanie miarki ---------------------------------------------------
  window.drawRangeRings = function drawRangeRings(ctx, cam) {
    drawRangeRuler(ctx, cam);
  };

  function drawSunDirection(ctx, cam) {
    if (!DevFlags.showSunDir) return;
    const planets = Array.isArray(window.planets) ? window.planets : null;
    const sun = (window.SUN || SUN);
    if (!planets || !sun) return;

    const camX = cam?.x ?? 0;
    const camY = cam?.y ?? 0;
    const zoom = cam?.zoom ?? 1;
    const halfW = canvas.width / 2;
    const halfH = canvas.height / 2;

    ctx.save();
    ctx.strokeStyle = '#66c2ff';
    ctx.fillStyle = '#cfe3ff';
    ctx.lineWidth = Math.max(1, 2 * zoom);
    ctx.font = `${Math.max(10, Math.round(12 * zoom))}px monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    const dash = Math.max(6, 12 * zoom);
    const labelOffset = 6 * zoom;
    const arrowSize = Math.max(8, 14 * zoom);

    for (const planet of planets) {
      if (!planet || typeof planet.x !== 'number' || typeof planet.y !== 'number') continue;

      const dx = (sun.x ?? 0) - planet.x;
      const dy = (sun.y ?? 0) - planet.y;
      const dist = Math.hypot(dx, dy);
      if (!isFinite(dist) || dist <= 0.0001) continue;

      const ux = dx / dist;
      const uy = dy / dist;

      const sx = (planet.x - camX) * zoom + halfW;
      const sy = (planet.y - camY) * zoom + halfH;

      const segWorld = Math.min(Math.max(dist * 0.25, 80), 240);
      const len = segWorld * zoom;
      const ex = sx + ux * len;
      const ey = sy + uy * len;

      ctx.setLineDash([dash, dash]);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      ctx.setLineDash([]);

      const ang = Math.atan2(uy, ux);
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - Math.cos(ang - 0.4) * arrowSize, ey - Math.sin(ang - 0.4) * arrowSize);
      ctx.lineTo(ex - Math.cos(ang + 0.4) * arrowSize, ey - Math.sin(ang + 0.4) * arrowSize);
      ctx.closePath();
      ctx.fillStyle = '#66c2ff';
      ctx.fill();

      ctx.fillStyle = '#cfe3ff';
      ctx.fillText('Sun →', ex + labelOffset, ey - labelOffset);
    }

    ctx.restore();
  }
  window.drawSunDirection = drawSunDirection;

  // ---- Cheat: unlimited warp ---------------------------------------------
  window.devtoolsApplyCheats = function devtoolsApplyCheats() {
    const f = window.DevFlags || {};
    if (!f.unlimitedWarp) return;
    const s = window.ship;
    if (s && s.warp) {
      if ('cooldown' in s.warp) s.warp.cooldown = 0;
      if ('charge' in s.warp) s.warp.charge = s.warp.chargeMax ?? s.warp.maxCharge ?? 1;
      if ('energy' in s.warp) s.warp.energy = s.warp.energyMax ?? s.warp.maxEnergy ?? 1;
    }
    if (typeof window.warpCooldown === 'number') window.warpCooldown = 0;
    if (typeof window.warpEnergy === 'number' && typeof window.warpEnergyMax === 'number') {
      window.warpEnergy = window.warpEnergyMax;
    }
  };

  // ---- Hook na stację piracką (rysowanie) --------------------------------
  // W drawStation*(...) gdzie skalujesz sprite/canvas po st.r — zamień na:
  //   const R = st.r * (st.style==='pirate' || st.name?.toLowerCase().includes('pir') ? DevConfig.pirateScale : 1);
  // Jeśli jest osobna funkcja wyliczająca promień — użyj jej (patrz Krok 4: „diff”).

  // ---- UI init ------------------------------------------------------------
  function buildPlanetsUI() {
    refreshUIRefs();
    const root = ui.planetsGroup;
    if (!root) return;
    // wyczyść stare
    root.querySelectorAll('.row.p').forEach(n => n.remove());

    const planetList = Array.isArray(window.planets) ? window.planets : null;
    if (!planetList || planetList.length === 0) {
      if (!buildPlanetsUI._retryTimer) {
        buildPlanetsUI._retryTimer = setTimeout(() => {
          buildPlanetsUI._retryTimer = null;
          buildPlanetsUI();
        }, 500);
      }
      return;
    }
    if (buildPlanetsUI._retryTimer) {
      clearTimeout(buildPlanetsUI._retryTimer);
      buildPlanetsUI._retryTimer = null;
    }

    // wylicz bazowe promienie dla UI i dołóż po 1 wierszu per planeta
    const planetDefaults = new Map();
    for (const p of planetList) {
      const key = (p.name || p.id || String(p.index) || '').toString().toLowerCase();
      const stored = DevConfig.planetRById[key];
      const base = Number.isFinite(stored)
        ? stored
        : (Number.isFinite(p.baseR)
          ? p.baseR
          : p.r);
      planetDefaults.set(key, base);
      DevConfig.planetRById[key] = base;

      const row = document.createElement('div');
      row.className = 'row p';
      row.innerHTML = `
        <label>${p.name || ('Planet ' + (p.id ?? ''))}</label>
        <input data-k="${key}" class="plR" type="range" min="20" max="2000" step="1" value="${base}">
        <input data-k="${key}" class="plRVal" type="number" min="20" max="2000" step="1" value="${base}" style="width:72px; margin-left:6px;">
      `;
      root.appendChild(row);
    }

    // suwak globalny
    ui.planetScaleAll.value = DevConfig.planetScaleAll;
    ui.planetScaleAllVal.textContent = '×' + (+DevConfig.planetScaleAll).toFixed(2);

    // per planeta
    root.querySelectorAll('input.plR').forEach(inp => {
      const key = inp.dataset.k;
      const num = root.querySelector(`input.plRVal[data-k="${key}"]`);
      const apply = (vRaw) => {
        let v = Number(vRaw);
        if (!Number.isFinite(v)) v = 1;
        v = Math.max(1, Math.min(2000, v));
        DevConfig.planetRById[key] = v;
        if (num) num.value = String(v);
        inp.value = String(v);
        saveLS();
        scheduleRebuild3D();
        reflectToCfg();
      };
      inp.addEventListener('input', () => apply(inp.value));
      inp.addEventListener('change', () => apply(inp.value));
      if (num) {
        num.addEventListener('input', () => apply(num.value));
        num.addEventListener('change', () => apply(num.value));
      }
    });
  }

  function buildStationFramesUI() {
    refreshUIRefs();
    const root = ui.stationsFramesGroup;
    if (!root) return;

    root.querySelectorAll('.row.frame').forEach(n => n.remove());

    const stations = Array.isArray(window.stations) ? window.stations : [];
    if (!stations.length) return;

    if (!DevConfig.stationSpriteFrameById || typeof DevConfig.stationSpriteFrameById !== 'object') {
      DevConfig.stationSpriteFrameById = {};
    }

    for (const st of stations) {
      const key = stationKey(st);
      if (!key) continue;

      const valRaw = DevConfig.stationSpriteFrameById[key] ?? DevConfig.stationSpriteFrame;
      const val = Number.isFinite(valRaw) ? valRaw : DevConfig.stationSpriteFrame;
      const row = document.createElement('div');
      row.className = 'row frame';
      row.innerHTML = `
        <label>${st.name || key}</label>
        <input data-k="${key}" class="stFrame" type="range" min="0.1" max="3.0" step="0.01" value="${val}">
        <input data-k="${key}" class="stFrameVal" type="number" min="0.1" max="3.0" step="0.01" value="${val}" style="width:72px; margin-left:6px;">
        <div class="val" id="stFrameVal_${key}"></div>
      `;
      root.appendChild(row);

      const slider = row.querySelector('input.stFrame');
      const num = row.querySelector('input.stFrameVal');
      const valEl = row.querySelector(`#stFrameVal_${key}`);

      const apply = (vRaw) => {
        let v = Number(vRaw);
        if (!Number.isFinite(v)) v = 1.25;
        v = Math.max(0.1, Math.min(3.0, v));
        DevConfig.stationSpriteFrameById[key] = v;
        if (num) num.value = String(v);
        if (slider) slider.value = String(v);
        if (valEl) valEl.textContent = '×' + v.toFixed(2);
        try { localStorage.setItem('stationSpriteFrameById', JSON.stringify(DevConfig.stationSpriteFrameById)); } catch { }
        __devtoolsReflectToCfg?.();
        __devtoolsSaveLS?.();
      };
      slider?.addEventListener('input', e => apply(e.target.value));
      slider?.addEventListener('change', e => apply(e.target.value));
      num?.addEventListener('input', e => apply(e.target.value));
      num?.addEventListener('change', e => apply(e.target.value));
    }
  }

  function buildDistancesUI() {
    refreshUIRefs();
    const root = ui.distancesGroup;
    if (!root) return;
    root.querySelectorAll('.row.dist').forEach(n => n.remove());
    if (!Array.isArray(window.planets) || !window.SUN) return;
    for (const p of window.planets) {
      const k = keyFor(p);
      const dWorld = Math.hypot((p.x || 0) - SUN.x, (p.y || 0) - SUN.y);
      const dAU = (DevConfig.planetOrbitAUById?.[k] ?? formatAUValue(dWorld));
      const row = document.createElement('div');
      row.className = 'row dist';
      row.innerHTML = `
        <label style="min-width:80px">${p.name || ('Planet ' + (p.id ?? ''))}</label>
        <input data-k="${k}" class="plAU" type="range" min="0" max="60" step="0.01">
        <input data-k="${k}" class="plAUVal" type="number" min="0" max="60" step="0.01" style="width:72px; margin:0 6px;">
        <div class="val" id="au_val_${k}" style="min-width:160px; text-align:right; font-variant-numeric: tabular-nums;"></div>
      `;
      root.appendChild(row);
      const inp = row.querySelector('input.plAU');
      const inpVal = row.querySelector('input.plAUVal');
      if (!DevConfig.planetOrbitAUById) DevConfig.planetOrbitAUById = {};
      inp.value = dAU;
      if (inpVal) inpVal.value = (+dAU).toFixed(2);
      const slot = document.getElementById('au_val_' + k);
      const renderVal = (au) => {
        let num = Number(au);
        if (!Number.isFinite(num)) num = 0;
        const baseOrbit = getBaseOrbit();
        const worldR = Number.isFinite(baseOrbit) ? num * baseOrbit : NaN;
        if (slot) slot.textContent = `${num.toFixed(2)} AU (${fmtU(worldR)} u)`;
        if (inpVal) inpVal.value = num.toFixed(2);
      };
      renderVal(dAU);
      inp.addEventListener('input', () => {
        const au = +inp.value;
        setPlanetOrbitAU(k, au);
        renderVal(au);
        saveLS();
        reflectToCfg();
        if (inpVal) inpVal.value = au.toFixed(2);
      });
      if (inpVal) {
        const applyAU = () => {
          let au = Number(inpVal.value);
          if (!Number.isFinite(au)) return;
          au = Math.max(0, Math.min(60, au));
          inp.value = String(au);
          setPlanetOrbitAU(k, au);
          renderVal(au);
          saveLS();
          reflectToCfg();
        };
        inpVal.addEventListener('change', applyAU);
        inpVal.addEventListener('keyup', (e) => { if (e.key === 'Enter') applyAU(); });
      }
    }
  }

  function setPlanetOrbitAU(key, au) {
    DevConfig.planetOrbitAUById = DevConfig.planetOrbitAUById || {};
    DevConfig.planetOrbitAUById[key] = +au;
    applyOrbitOverrides();
  }

  function applyOrbitOverrides() {
    if (!Array.isArray(window.planets) || !window.SUN) return;
    const baseOrbit = getBaseOrbit();
    const Sx = +window.SUN.x || 0, Sy = +window.SUN.y || 0;
    const map = DevConfig.planetOrbitAUById || {};
    for (const p of window.planets) {
      const k = keyFor(p);
      const au = +map[k];
      if (!(au > 0)) continue;
      const R = Number.isFinite(baseOrbit) ? au * baseOrbit : au;
      const ang = Math.atan2((p.y || 0) - Sy, (p.x || 0) - Sx);
      p.devOrbitOverrideR = R;
      if ('orbitRadius' in p) p.orbitRadius = R;
      if (p.orbit && 'radius' in p.orbit) p.orbit.radius = R;
      if ('orbitR' in p) p.orbitR = R;
      p.x = Sx + Math.cos(ang) * R;
      p.y = Sy + Math.sin(ang) * R;
    }
    if (typeof scheduleRebuild3D === 'function') scheduleRebuild3D();
  }

  function refreshDistancesReadout() {
    if (!Array.isArray(window.planets) || !window.SUN) return;
    const baseOrbit = getBaseOrbit();
    for (const p of window.planets) {
      const k = keyFor(p);
      const slot = document.getElementById('au_val_' + k);
      if (!slot) continue;
      const dWorld = Math.hypot((p.x || 0) - SUN.x, (p.y || 0) - SUN.y);
      const au = DevConfig.planetOrbitAUById?.[k] ?? formatAUValue(dWorld);
      const distWorld = Number.isFinite(baseOrbit) ? au * baseOrbit : NaN;
      slot.textContent = `${(+au).toFixed(2)} AU (${fmtU(distWorld)} u)`;
    }
  }

  function keyFor(p) {
    return (p?.name || p?.id || String(p?.index || '')).toString().toLowerCase();
  }

  function fmtU(v) {
    if (!Number.isFinite(v)) return '—';
    return Math.round(v).toLocaleString('pl-PL');
  }

  function getBaseOrbit() {
    if (window.__DEV_AU_ORBIT_BASE != null) return window.__DEV_AU_ORBIT_BASE;
    const planets = Array.isArray(window.planets) ? window.planets : [];
    const sun = window.SUN;
    if (!sun || planets.length === 0) return null;
    const earth = planets.find(p => (p.name || '').toLowerCase() === 'earth') || planets[0];
    if (!earth) return null;
    const d = Math.hypot((earth.x || 0) - sun.x, (earth.y || 0) - sun.y);
    if (!Number.isFinite(d)) return null;
    window.__DEV_AU_ORBIT_BASE = d / 1.0;
    return window.__DEV_AU_ORBIT_BASE;
  }

  function formatAUValue(distWorld) {
    const base = getBaseOrbit();
    if (!Number.isFinite(base) || !Number.isFinite(distWorld)) return 0;
    return distWorld / base;
  }

  function reflectToUI() {
    refreshUIRefs();
    if (ui.sunR2D) ui.sunR2D.value = String(DevConfig.sunR2D ?? 823);
    if (ui.sunR2DVal) ui.sunR2DVal.textContent = String(ui.sunR2D?.value ?? DevConfig.sunR2D ?? 823);
    if (ui.sunR3D) ui.sunR3D.value = String(DevConfig.sunR3D ?? 399);
    if (ui.sunR3DVal) ui.sunR3DVal.textContent = String(ui.sunR3D?.value ?? DevConfig.sunR3D ?? 399);
    if (ui.planetScaleAll) ui.planetScaleAll.value = String(DevConfig.planetScaleAll ?? 1);
    if (ui.planetScaleAllVal) ui.planetScaleAllVal.textContent = '×' + (+DevConfig.planetScaleAll || 1).toFixed(2);
    if (ui.pirScale) ui.pirScale.value = String(DevConfig.pirateScale ?? DEFAULT_PIRATE_SCALE);
    if (ui.pirScaleVal) ui.pirScaleVal.textContent = '×' + (+DevConfig.pirateScale || 1).toFixed(2);
    if (ui.station3DScale) ui.station3DScale.value = String(DevConfig.station3DScale ?? DEFAULT_STATION3D_SCALE);
    if (ui.station3DScaleVal) ui.station3DScaleVal.textContent = '×' + (+DevConfig.station3DScale || DEFAULT_STATION3D_SCALE).toFixed(2);
    if (ui.stationSpritePx) ui.stationSpritePx.value = String(DevConfig.stationSpriteSize ?? 512);

    if (ui.cbRuler) ui.cbRuler.checked = !!DevFlags.showRuler;
    if (ui.cbPlanetOrbits) ui.cbPlanetOrbits.checked = !!DevFlags.showPlanetOrbits;
    if (ui.cbUnlimited) ui.cbUnlimited.checked = !!DevFlags.unlimitedWarp;
    if (ui.cbSunDir) ui.cbSunDir.checked = !!DevFlags.showSunDir;
    if (ui.cbShake) ui.cbShake.checked = !!DevFlags.disableCameraShake;
    if (ui.cbPlanetStations3D) ui.cbPlanetStations3D.checked = DevFlags.usePlanetStations3D !== false;
    if (ui.cbPirate3D) ui.cbPirate3D.checked = DevFlags.use3DPirateStation !== false;

    reflectWarpLensToUI();
  }

  function reflectToCfg() {
    const cfg = {
      sunR2D: DevConfig.sunR2D,
      sunR3D: DevConfig.sunR3D,
      planetScaleAll: DevConfig.planetScaleAll,
      pirateScale: DevConfig.pirateScale,
      station3DScale: DevConfig.station3DScale,
      stationSpriteSize: DevConfig.stationSpriteSize,
      stationSpriteFrame: DevConfig.stationSpriteFrame,
      planetRById: DevConfig.planetRById,
      planetOrbitAUById: DevConfig.planetOrbitAUById,
      stationSpriteFrameById: DevConfig.stationSpriteFrameById,
      stationScaleById: DevConfig.stationScaleById,
      vfx: { warpLens: DevVFX.warpLens }
    };
    if (ui.cfgOut) ui.cfgOut.value = JSON.stringify(cfg, null, 2);
  }
  window.__devtoolsReflectToCfg = reflectToCfg;

  // listeners
  if (ui.sunR2D) {
    ui.sunR2D.addEventListener('input', () => {
      const val = +ui.sunR2D.value;
      DevConfig.sunR2D = val;
      if (ui.sunR2DVal) ui.sunR2DVal.textContent = ui.sunR2D.value;
      saveLS();
      scheduleRebuild3D();
      reflectToCfg();
    });
  }
  if (ui.sunR3D) {
    ui.sunR3D.addEventListener('input', () => {
      const val = +ui.sunR3D.value;
      DevConfig.sunR3D = val;
      if (ui.sunR3DVal) ui.sunR3DVal.textContent = ui.sunR3D.value;
      saveLS();
      scheduleRebuild3D();
      reflectToCfg();
    });
  }
  ui.planetScaleAll.addEventListener('input', () => { DevConfig.planetScaleAll = +ui.planetScaleAll.value; ui.planetScaleAllVal.textContent = '×' + (+DevConfig.planetScaleAll).toFixed(2); saveLS(); scheduleRebuild3D(); reflectToCfg(); });
  ui.pirScale.addEventListener('input', () => {
    DevTuning.pirateStationScale = +ui.pirScale.value;
    DevConfig.pirateScale = DevTuning.pirateStationScale;
    ui.pirScaleVal.textContent = '×' + (+DevConfig.pirateScale).toFixed(2);
    saveLS();
    reflectToCfg();
  });
  if (ui.stationSpritePx) {
    const applySpriteSize = () => {
      let v = Math.round(Number(ui.stationSpritePx.value));
      if (!Number.isFinite(v)) v = 512;
      v = Math.max(64, Math.min(4096, v));
      ui.stationSpritePx.value = String(v);
      DevConfig.stationSpriteSize = v;
      try { localStorage.setItem('stationSpriteSize', String(v)); } catch { }
      saveLS();
      reflectToCfg();
    };
    ui.stationSpritePx.addEventListener('change', applySpriteSize);
    ui.stationSpritePx.addEventListener('input', applySpriteSize);
  }
  for (const [key, ctrl] of Object.entries(warpLensUI)) {
    if (!ctrl) continue;
    if (ctrl.slider) {
      ctrl.slider.addEventListener('input', () => applyWarpLensValue(key, ctrl.slider.value));
      ctrl.slider.addEventListener('change', () => applyWarpLensValue(key, ctrl.slider.value));
    }
    if (ctrl.number) {
      const commit = () => applyWarpLensValue(key, ctrl.number.value);
      ctrl.number.addEventListener('change', commit);
      ctrl.number.addEventListener('keyup', (e) => { if (e.key === 'Enter') commit(); });
    }
  }
  ui.cbRuler.addEventListener('change', () => { DevFlags.showRuler = ui.cbRuler.checked; saveLS(); });
  if (ui.cbPlanetOrbits) {
    ui.cbPlanetOrbits.addEventListener('change', () => { DevFlags.showPlanetOrbits = ui.cbPlanetOrbits.checked; saveLS(); });
  }
  ui.cbUnlimited.addEventListener('change', () => { DevFlags.unlimitedWarp = ui.cbUnlimited.checked; saveLS(); });
  if (ui.cbSunDir) {
    ui.cbSunDir.addEventListener('change', () => {
      DevFlags.showSunDir = ui.cbSunDir.checked;
      saveLS();
    });
  }
  if (ui.cbShake) {
    ui.cbShake.addEventListener('change', () => {
      DevFlags.disableCameraShake = ui.cbShake.checked;
      if (DevFlags.disableCameraShake) {
        camera.shakeMag = 0;
        camera.shakeTime = 0;
        camera.shakeDur = 0;
      }
      saveLS();
    });
  }
  if (ui.cbPlanetStations3D) {
    ui.cbPlanetStations3D.addEventListener('change', () => {
      DevFlags.usePlanetStations3D = ui.cbPlanetStations3D.checked;
      window.USE_PLANET_STATIONS_3D = ui.cbPlanetStations3D.checked;
      if (Array.isArray(window.stations) && typeof window.updateStations3D === 'function') {
        window.updateStations3D(window.stations);
      }
      saveLS();
    });
  }
  if (ui.cbPirate3D) {
    ui.cbPirate3D.addEventListener('change', () => {
      DevFlags.use3DPirateStation = ui.cbPirate3D.checked;
      window.USE_STATION_3D = ui.cbPirate3D.checked;
      if (window.USE_STATION_3D && window.__setStation3DScale && typeof Dev.station3DScale === 'number') {
        __setStation3DScale(Dev.station3DScale);
      }
      saveLS();
    });
  }

  ui.btnCopy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(ui.cfgOut.value); ui.btnCopy.textContent = 'Skopiowano!'; setTimeout(() => ui.btnCopy.textContent = 'Kopiuj aktualną konfigurację', 1200); } catch { }
  });
  ui.btnReset.addEventListener('click', () => {
    localStorage.removeItem('devConfig'); localStorage.removeItem('devFlags'); localStorage.removeItem('stationSpriteSize');
    localStorage.removeItem('stationSpriteFrame'); localStorage.removeItem('stationSpriteFrameById');
    localStorage.removeItem('devVfx');
    location.reload();
  });

  // skróty klawiaturowe
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F10') { ui.root.style.display = (ui.root.style.display === 'none' || !ui.root.style.display) ? 'block' : 'none'; }
    if (e.key === 'F9') { DevFlags.unlimitedWarp = !DevFlags.unlimitedWarp; ui.cbUnlimited.checked = DevFlags.unlimitedWarp; saveLS(); }
    if (e.key === 'F8') {
      DevFlags.showSunDir = !DevFlags.showSunDir;
      if (ui.cbSunDir) ui.cbSunDir.checked = DevFlags.showSunDir;
      const el = document.getElementById('dt-show-sundir');
      if (el) el.checked = DevFlags.showSunDir;
      saveLS();
    }
  });

  // boot
  loadLS();
  bootstrapFromGame();
  if (!DevConfig.planetOrbitAUById || typeof DevConfig.planetOrbitAUById !== 'object') {
    DevConfig.planetOrbitAUById = {};
  }

  refreshUIRefs();

  // Planety (R)
  buildPlanetsUI();

  // Sekcja: Dystanse od Słońca (AU → promień orbity)
  buildDistancesUI();

  // Sekcja: Kadr sprite per stacja
  buildStationFramesUI();

  // Odbicie stanu
  reflectToUI();
  reflectToCfg();

  // Rebuild 3D po zmianach
  scheduleRebuild3D();

  // Przywróć zapisane AU i przelicz promienie orbit
  applyOrbitOverrides();

  // Aktualizuj readout AU/world-units w panelu
  refreshDistancesReadout();
  setInterval(refreshDistancesReadout, 250);
  setInterval(buildStationFramesUI, 2000);

  // Upewnij się, że panel można włączyć na starcie (dev wygoda)
  // ui.root.style.display = 'block';

  wireDevTools();

  // === DevTools: API + handler skali stacji 3D ===
  const DEFAULT_STATION3D_SCALE_GLOBAL = (
    typeof window.DEFAULT_STATION_3D_SCALE === 'number' && window.DEFAULT_STATION_3D_SCALE > 0
  ) ? window.DEFAULT_STATION_3D_SCALE : 2.70;

  // API dostępne globalnie — zapisuje skalę w dwóch miejscach, aby
  // 1) logika 3D miała natychmiastową wartość, 2) devtools mógł ją odczytać.
  if (!window.__setStation3DScale) {
    window.__setStation3DScale = (v) => {
      const raw = Number(v);
      const fallback = DEFAULT_STATION3D_SCALE_GLOBAL;
      const n = (Number.isFinite(raw) && raw > 0) ? raw : fallback;
      window.Dev = window.Dev || {};
      window.DevTuning = window.DevTuning || {};
      window.Dev.station3DScale = n;
      window.DevTuning.pirateStationScale = n;
      const cfg = window.DevConfig;
      if (cfg && typeof cfg === 'object') cfg.station3DScale = n;
      try { localStorage.setItem('station3DScale', String(n)); } catch { }
    };
  }

  // Podpięcie suwaka i wyświetlacza wartości (×1.00, ×1.25 itd.)
  const s = document.getElementById('station3DScale');
  const sv = document.getElementById('station3DScaleVal');
  if (s) {
    // inicjalizacja z LS (opcjonalnie)
    const saved = Number(localStorage.getItem('station3DScale'));
    if (Number.isFinite(saved) && saved > 0) {
      s.value = String(saved);
      if (sv) sv.textContent = '×' + saved.toFixed(2);
      window.__setStation3DScale(saved);
    } else {
      const def = DEFAULT_STATION3D_SCALE_GLOBAL;
      s.value = String(def);
      if (sv) sv.textContent = '×' + def.toFixed(2);
      window.__setStation3DScale(def);
    }

    s.addEventListener('input', () => {
      const v = +s.value;
      window.__setStation3DScale(v);
      if (sv) sv.textContent = '×' + v.toFixed(2);
      if (window.DevConfig && typeof window.DevConfig === 'object') {
        window.DevConfig.station3DScale = v;
      }
      window.__devtoolsSaveLS?.();
      window.__devtoolsReflectToCfg?.();
    });
  }

  (function setupPerStationScales() {
    const root = document.getElementById('dt-stations-per-scale');
    if (!root) return;

    if (!window.DevConfig) window.DevConfig = {};
    if (!window.DevConfig.stationScaleById || typeof window.DevConfig.stationScaleById !== 'object') {
      window.DevConfig.stationScaleById = {};
    }

    function currentStations() {
      if (Array.isArray(window.stations) && window.stations.length) return window.stations;
      if (Array.isArray(window.planets)) {
        return window.planets.map((pl) => ({ id: pl.id || pl.name || '', planet: pl }));
      }
      return [];
    }

    function makeRow(st) {
      const id = String(st?.id || st?.planet?.id || st?.planet?.name || '').toLowerCase();
      if (!id) return null;

      const map = typeof window.getStationScales === 'function' ? window.getStationScales() : null;
      const rawInitial = (window.DevConfig.stationScaleById && window.DevConfig.stationScaleById[id])
        ?? (map ? map[id] : undefined)
        ?? 1;
      const initial = Number(rawInitial) || 1;

      const wrap = document.createElement('div');
      wrap.className = 'dt-row';
      wrap.style.alignItems = 'center';

      const label = document.createElement('div');
      label.className = 'dt-col';
      label.style.minWidth = '120px';
      label.textContent = id[0].toUpperCase() + id.slice(1);

      const col = document.createElement('div');
      col.className = 'dt-col';
      col.style.flex = '1';

      const range = document.createElement('input');
      range.type = 'range';
      range.min = '0.2';
      range.max = '5';
      range.step = '0.01';
      range.value = String(initial);
      range.id = `dt-scale-station-${id}`;

      const val = document.createElement('span');
      val.style.marginLeft = '8px';
      val.textContent = initial.toFixed(2);

      const num = document.createElement('input');
      num.type = 'number';
      num.min = '0.2';
      num.max = '5';
      num.step = '0.01';
      num.value = String(initial);
      num.id = `dt-scale-station-${id}-num`;
      num.style.width = '72px';
      num.style.marginLeft = '8px';

      const apply = (vRaw) => {
        let v = Number(vRaw);
        if (!Number.isFinite(v)) v = 1;
        v = Math.max(0.2, Math.min(5, v));
        if (!window.DevConfig || typeof window.DevConfig !== 'object') window.DevConfig = {};
        if (!window.DevConfig.stationScaleById || typeof window.DevConfig.stationScaleById !== 'object') {
          window.DevConfig.stationScaleById = {};
        }
        window.DevConfig.stationScaleById[id] = v;
        range.value = String(v);
        num.value = String(v);
        val.textContent = v.toFixed(2);
        if (typeof window.setStationScale === 'function') window.setStationScale(id, v);
        window.__devtoolsSaveLS?.();
      };

      range.addEventListener('input', () => apply(range.value));
      num.addEventListener('input', () => apply(num.value));
      num.addEventListener('change', () => apply(num.value));
      num.addEventListener('keyup', (e) => { if (e.key === 'Enter') apply(num.value); });

      col.appendChild(range);
      col.appendChild(num);
      col.appendChild(val);
      wrap.appendChild(label);
      wrap.appendChild(col);
      return wrap;
    }

    function rebuild() {
      root.innerHTML = '';
      const list = currentStations();
      const seen = new Set();
      for (const st of list) {
        const row = makeRow(st);
        if (!row) continue;
        const input = row.querySelector('input[type="range"]');
        const key = input ? input.id : null;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        root.appendChild(row);
      }
    }

    const btnReset = document.getElementById('dt-reset-station-scales');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        if (!window.DevConfig) window.DevConfig = {};
        window.DevConfig.stationScaleById = {};
        window.__devtoolsSaveLS?.();
        if (typeof window.__saveDevLS === 'function') window.__saveDevLS();
        rebuild();
        if (Array.isArray(window.stations) && typeof window.updateStations3D === 'function') {
          window.updateStations3D(window.stations);
        }
      });
    }

    rebuild();
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      const count = root.querySelectorAll('input[type="range"]').length;
      const stationCount = Array.isArray(window.stations) ? window.stations.length : 0;
      if (stationCount > count || (count === 0 && tries < 120)) {
        rebuild();
      }
      if (tries >= 120) clearInterval(t);
    }, 500);

    if (typeof window.__saveDevLS !== 'function') {
      window.__saveDevLS = function __saveDevLSFallback() {
        try {
          const data = { DevFlags: window.DevFlags, DevTuning: window.DevTuning, DevConfig: window.DevConfig };
          localStorage.setItem('#__dev', JSON.stringify(data));
        } catch (err) {
          console.warn('DevTools: failed to persist station scales', err);
        }
      };
    }

  })();
}
