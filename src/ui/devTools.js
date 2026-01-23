// src/ui/devTools.js

const STYLES = `
#devtools { position: fixed; right: 16px; top: 16px; width: 340px; max-height: 80vh; overflow: auto; padding: 14px; border-radius: 12px; background: rgba(10, 14, 25, .92); border: 1px solid #1b2337; color: #dfe7ff; z-index: 1000; font-family: Inter, system-ui, Segoe UI, Roboto, Arial; display: none }
#devtools h3 { margin: 0 0 8px 0; font-size: 16px; letter-spacing: .04em; text-transform: uppercase; color: #8fb5ff }
#devtools .group { margin: 12px 0; padding: 10px; background: #0b0f1a; border: 1px solid #1b2337; border-radius: 10px }
#devtools .row { display: flex; align-items: center; gap: 8px; margin: 6px 0 }
#devtools .row label { flex: 1 }
#devtools input[type=range] { width: 180px }
#devtools .val { min-width: 64px; text-align: right; font-variant-numeric: tabular-nums }
#devtools .small { opacity: .7; font-size: 12px }
#devtools .pill { display: inline-block; padding: 2px 8px; border: 1px solid #2a3a5a; border-radius: 999px; background: #0a1020 }
#devtools textarea { width: 100%; height: 90px; background: #0b1224; color: #dfe7ff; border: 1px solid #2a3a5a; border-radius: 8px; padding: 8px }
#devtools .muted { color: #9fb0d8 }
#devtools .dt-row { display: flex; gap: 8px; margin-top: 6px }
#devtools .dt-col { display: flex; flex-direction: column }
#devtools .dt-stack { display: flex; flex-direction: column }
#devtools .dt-btn { padding: 4px 8px; border: 1px solid #2a3a5a; border-radius: 8px; background: #0a1020; color: #dfe7ff; cursor: pointer }
#devtools .dt-btn:hover { background: #18233c }
#devtools .dt-label { font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #9fb0d8 }
`;

const HTML = `
<h3>DevTools</h3>
<div class="group">
  <div class="row"><strong>Wszechświat</strong></div>
  <div class="row"><label>Słońce – promień 2D (R)</label><input id="sunR2D" type="range" min="50" max="1500" step="1" value="823"><div class="val" id="sunR2DVal"></div></div>
  <div class="row"><label>Słońce – promień 3D (R)</label><input id="sunR3D" type="range" min="50" max="1500" step="1" value="399"><div class="val" id="sunR3DVal"></div></div>
  <div class="row"><label>Planety – skala globalna (×)</label><input id="planetScaleAll" type="range" min="0.5" max="3" step="0.01" value="1"><div class="val" id="planetScaleAllVal"></div></div>
</div>
<div class="group" id="planetsGroup"><div class="row"><strong>Planety (R)</strong> <span class="small muted">(per-planeta)</span></div></div>
<div class="group" id="distancesGroup"><div class="row"><strong>Dystanse od Słońca</strong> <span class="small muted">(AU → promień orbity)</span></div></div>
<div class="group">
  <div class="row"><strong>Stacje</strong></div>
  <div class="row"><label>Skala stacji pirackiej (×)</label><input id="pirScale" type="range" min="0.4" max="12" step="0.01" value="6"><div class="val" id="pirScaleVal"></div></div>
  <div class="row"><label>Skala stacji 3D (×) (Global)</label><input id="station3DScale" type="range" min="0.2" max="12.0" step="0.05" value="2.70"><div class="val" id="station3DScaleVal"></div></div>
  <div class="row"><label>Stacja 3D – rozmiar sprite (px)</label><input id="stationSpritePx" type="number" min="64" max="4096" step="32" value="1024" style="width:96px;"></div>
  <div class="dt-row">
    <div class="dt-col">
      <div class="dt-label" style="margin-top:6px;">Skala per stacja (3D Override)</div>
      <div id="dt-stations-per-scale" class="dt-stack" style="gap:6px;"></div>
      <button id="dt-reset-station-scales" class="dt-btn" style="margin-top:6px;">Reset per stacja</button>
    </div>
  </div>
  <label style="display:flex;gap:6px;align-items:center;margin-top:8px"><input id="dt-use-planet-stations" type="checkbox" /> Planet Stations 3D (overlay)</label>
  <label style="display:flex;gap:6px;align-items:center;margin-top:8px"><input id="dt-use-3d-pirate" type="checkbox" /> 3D Pirate Station (hide 2D)</label>
</div>
<div class="group" id="stationsFramesGroup"><div class="row"><strong>Stacje (kadr per stacja)</strong> <span class="small muted">(zoom kamery na sprite)</span></div></div>
<div class="group" id="warpVfxGroup">
  <div class="row"><strong>Warp Wormhole VFX</strong> <span class="small muted">(soczewka statku)</span></div>
  <div class="row"><label>Próg trybu pełnego</label><input id="warpLensThreshold" type="range" min="0" max="1" step="0.01"><input id="warpLensThresholdNum" type="number" min="0" max="1" step="0.01" style="width:72px;"><div class="val" id="warpLensThresholdVal"></div></div>
  <div class="row"><label>Promień bazowy</label><input id="warpRadiusBase" type="range" min="0.05" max="0.6" step="0.005"><input id="warpRadiusBaseNum" type="number" min="0.05" max="0.6" step="0.005" style="width:72px;"><div class="val" id="warpRadiusBaseVal"></div></div>
  <div class="row"><label>Promień — skala</label><input id="warpRadiusScale" type="range" min="0" max="0.3" step="0.005"><input id="warpRadiusScaleNum" type="number" min="0" max="0.3" step="0.005" style="width:72px;"><div class="val" id="warpRadiusScaleVal"></div></div>
  <div class="row"><label>Masa bazowa</label><input id="warpMassBase" type="range" min="0" max="0.5" step="0.005"><input id="warpMassBaseNum" type="number" min="0" max="0.5" step="0.005" style="width:72px;"><div class="val" id="warpMassBaseVal"></div></div>
  <div class="row"><label>Masa — skala</label><input id="warpMassScale" type="range" min="0" max="0.6" step="0.005"><input id="warpMassScaleNum" type="number" min="0" max="0.6" step="0.005" style="width:72px;"><div class="val" id="warpMassScaleVal"></div></div>
  <div class="row"><label>Miękkość krawędzi</label><input id="warpSoftness" type="range" min="0" max="1" step="0.01"><input id="warpSoftnessNum" type="number" min="0" max="1" step="0.01" style="width:72px;"><div class="val" id="warpSoftnessVal"></div></div>
  <div class="row"><label>Przezroczystość bazowa</label><input id="warpOpacityBase" type="range" min="0" max="1" step="0.01"><input id="warpOpacityBaseNum" type="number" min="0" max="1" step="0.01" style="width:72px;"><div class="val" id="warpOpacityBaseVal"></div></div>
  <div class="row"><label>Przezroczystość — skala</label><input id="warpOpacityScale" type="range" min="0" max="1" step="0.01"><input id="warpOpacityScaleNum" type="number" min="0" max="1" step="0.01" style="width:72px;"><div class="val" id="warpOpacityScaleVal"></div></div>
  <div class="row"><label>Wydłużenie wzdłuż lotu</label><input id="warpLensForwardStretch" type="range" min="0.1" max="2" step="0.01"><input id="warpLensForwardStretchNum" type="number" min="0.1" max="2" step="0.01" style="width:72px;"><div class="val" id="warpLensForwardStretchVal"></div></div>
  <div class="row"><label>Offset wzdłuż kadłuba</label><input id="warpTailDepthExtra" type="range" min="-0.2" max="0.8" step="0.01"><input id="warpTailDepthExtraNum" type="number" min="-0.2" max="0.8" step="0.01" style="width:72px;"><div class="val" id="warpTailDepthExtraVal"></div></div>
</div>
<div class="group">
  <div class="row"><label><input id="toggleRuler" type="checkbox"> Miarka (okręgi dystansu)</label></div>
  <div class="row"><label><input id="togglePlanetOrbits" type="checkbox"> Miarki planet (inner/outer/gravity)</label></div>
  <div class="row"><label><input id="toggleUnlimitedWarp" type="checkbox"> Nielimitowany warp <span class="pill">F9</span></label></div>
  <div class="row"><label><input id="dt-show-sundir" type="checkbox"> Pokaż kierunek słońca</label></div>
  <div class="row"><label><input id="dt-disable-shake" type="checkbox"> Wyłącz wstrząsy kamery</label></div>
</div>
<div class="group">
  <div class="row"><strong>Konfiguracja</strong></div>
  <div class="row"><button id="btnCopy">Kopiuj aktualną konfigurację</button><button id="btnReset" style="margin-left:auto">Reset</button></div>
  <div class="row"><textarea id="cfgOut" readonly></textarea></div>
  <div class="small muted">Skopiuj JSON i wklej do kodu.</div>
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

  // Obsługa F10
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F10') {
      e.preventDefault();
      const el = document.getElementById('devtools');
      if (el) {
        const isHidden = el.style.display === 'none' || el.style.display === '';
        el.style.display = isHidden ? 'block' : 'none';
      }
    }
  });

  wireDevToolsLogic();
}

function wireDevToolsLogic() {
  const el = (id) => document.getElementById(id);
  const ui = {};
  const uiIds = {
    root: 'devtools',
    sunR2D: 'sunR2D', sunR2DVal: 'sunR2DVal',
    sunR3D: 'sunR3D', sunR3DVal: 'sunR3DVal',
    planetScaleAll: 'planetScaleAll', planetScaleAllVal: 'planetScaleAllVal',
    pirScale: 'pirScale', pirScaleVal: 'pirScaleVal',
    station3DScale: 'station3DScale', station3DScaleVal: 'station3DScaleVal',
    stationSpritePx: 'stationSpritePx',
    stationsFramesGroup: 'stationsFramesGroup', planetsGroup: 'planetsGroup', distancesGroup: 'distancesGroup',
    cbRuler: 'toggleRuler', cbPlanetOrbits: 'togglePlanetOrbits', cbUnlimited: 'toggleUnlimitedWarp',
    cbSunDir: 'dt-show-sundir', cbShake: 'dt-disable-shake', cbPlanetStations3D: 'dt-use-planet-stations',
    cbPirate3D: 'dt-use-3d-pirate', btnCopy: 'btnCopy', btnReset: 'btnReset', cfgOut: 'cfgOut'
  };
  function refreshUIRefs() { for (const [k, id] of Object.entries(uiIds)) ui[k] = el(id); }
  refreshUIRefs();

  // Domyślne wartości
  const DEFAULT_PIRATE_SCALE = 6;
  const DEFAULT_STATION3D_SCALE = 2.70;

  const DevConfig = window.DevConfig || {
    sunR2D: 823, sunR3D: 399, planetRById: {}, planetOrbitAUById: {},
    planetScaleAll: 1, pirateScale: DEFAULT_PIRATE_SCALE, station3DScale: DEFAULT_STATION3D_SCALE, stationSpriteSize: 1024,
    stationSpriteFrame: 3.00, stationSpriteFrameById: {}, stationScaleById: {}
  };
  window.DevConfig = DevConfig;
  
  // Upewniamy się, że obiekt Dev istnieje (silnik 3D z niego korzysta w getDevScale)
  window.Dev = window.Dev || {};
  window.Dev.station3DScale = DevConfig.station3DScale;

  const WarpLensDefaults = window.__WARP_LENS_DEFAULTS || {};
  const DevVFX = window.DevVFX = window.DevVFX || {};
  DevVFX.warpLens = Object.assign({}, WarpLensDefaults, DevVFX.warpLens || {});

  const DevTuning = window.DevTuning = window.DevTuning || {};

  function loadLS() {
    try { Object.assign(DevConfig, JSON.parse(localStorage.getItem('devConfig') || '{}')); } catch { }
    // Synchronizacja z Dev
    window.Dev.station3DScale = DevConfig.station3DScale;
    try {
      const savedFlags = JSON.parse(localStorage.getItem('devFlags') || '{}');
      if (!window.DevFlags) window.DevFlags = {};
      Object.assign(window.DevFlags, savedFlags);
    } catch { }
  }
  function saveLS() {
    localStorage.setItem('devConfig', JSON.stringify(DevConfig));
    localStorage.setItem('devFlags', JSON.stringify(window.DevFlags || {}));
  }
  window.__devtoolsSaveLS = saveLS;
  window.__devtoolsReflectToCfg = reflectToCfg;

  function reflectToCfg() {
    if (ui.cfgOut) ui.cfgOut.value = JSON.stringify({ DevConfig, VFX: DevVFX }, null, 2);
  }

  function stationKey(st) {
    if (!st) return null;
    if (st.id != null) return String(st.id).toLowerCase();
    if (st.name) return String(st.name).toLowerCase();
    return null;
  }

  function keyFor(p) {
    return (p?.name || p?.id || String(p?.index || '')).toString().toLowerCase();
  }

  // --- REBUILD 3D (Throttle) ---
  let rebuildTimer = null;
  function scheduleRebuild3D() {
    if (rebuildTimer) cancelAnimationFrame(rebuildTimer);
    rebuildTimer = requestAnimationFrame(() => {
      // (Kod przebudowy planet) ...
      // Tutaj zostawiamy, ale najważniejsze dzieje się w event listenerach
    });
  }

  // --- PLANET UI ---
  function buildPlanetsUI() {
    refreshUIRefs();
    const root = ui.planetsGroup;
    if (!root) return;
    root.querySelectorAll('.row.p').forEach(n => n.remove());

    const planetList = Array.isArray(window.planets) ? window.planets : null;
    if (!planetList || planetList.length === 0) {
        // Retry logic...
        setTimeout(buildPlanetsUI, 500);
        return;
    }

    for (const p of planetList) {
      const key = keyFor(p);
      const stored = DevConfig.planetRById[key];
      const base = Number.isFinite(stored) ? stored : (Number.isFinite(p.baseR) ? p.baseR : p.r);
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

    // Listenery
    root.querySelectorAll('input.plR').forEach(inp => {
        const key = inp.dataset.k;
        const num = root.querySelector(`input.plRVal[data-k="${key}"]`);
        
        const apply = (vRaw) => {
            let v = Number(vRaw);
            if (!Number.isFinite(v)) v = 1;
            v = Math.max(1, Math.min(2000, v));
            
            // 1. Zapisz w konfigu
            DevConfig.planetRById[key] = v;
            
            // 2. ZNAJDŹ PLANETĘ I ZAKTUALIZUJ JĄ NA ŻYWO
            const targetP = planetList.find(p => keyFor(p) === key);
            if (targetP) {
                targetP.baseR = v;
                // Jeśli mamy globalną skalę, uwzględnij ją
                const scaleAll = DevConfig.planetScaleAll || 1;
                targetP.r = v * scaleAll; 
                if (targetP.orbit) targetP.orbit.radius = targetP.orbitRadius; 
            }

            if (num) num.value = String(v);
            inp.value = String(v);
            saveLS();
        };
        inp.addEventListener('input', () => apply(inp.value));
        if (num) num.addEventListener('input', () => apply(num.value));
    });
  }

  // --- DISTANCES UI (FIXED) ---
  function getBaseOrbit() {
    if (window.BASE_ORBIT) return window.BASE_ORBIT;
    return 3000; // Fallback
  }

  function formatAUValue(distWorld) {
    const base = getBaseOrbit();
    if (!Number.isFinite(base) || !Number.isFinite(distWorld)) return 0;
    return distWorld / base;
  }

  function fmtU(v) {
    if (!Number.isFinite(v)) return '—';
    return Math.round(v).toLocaleString('pl-PL');
  }

  function buildDistancesUI() {
    refreshUIRefs();
    const root = ui.distancesGroup;
    if (!root) return;
    root.querySelectorAll('.row.dist').forEach(n => n.remove());
    if (!Array.isArray(window.planets) || !window.SUN) return;

    for (const p of window.planets) {
      const k = keyFor(p);
      const dWorld = Math.hypot((p.x || 0) - window.SUN.x, (p.y || 0) - window.SUN.y);
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
      const slot = document.getElementById('au_val_' + k);

      if (!DevConfig.planetOrbitAUById) DevConfig.planetOrbitAUById = {};
      inp.value = dAU;
      if (inpVal) inpVal.value = (+dAU).toFixed(2);

      const renderVal = (au) => {
        let num = Number(au);
        if (!Number.isFinite(num)) num = 0;
        const baseOrbit = getBaseOrbit();
        const worldR = Number.isFinite(baseOrbit) ? num * baseOrbit : NaN;
        if (slot) slot.textContent = `${num.toFixed(2)} AU (${fmtU(worldR)} u)`;
        return worldR;
      };
      
      renderVal(dAU);

      const apply = () => {
        const au = +inp.value;
        DevConfig.planetOrbitAUById[k] = au;
        const worldR = renderVal(au);
        
        // --- KLUCZOWA POPRAWKA ---
        // Bezpośrednia modyfikacja promienia orbity planety w grze
        p.orbitRadius = worldR;
        p.orbitR = worldR;
        if(p.orbit) p.orbit.radius = worldR;
        
        // Aktualizacja pozycji natychmiast (opcjonalne, ale daje płynność)
        p.x = window.SUN.x + Math.cos(p.angle) * worldR;
        p.y = window.SUN.y + Math.sin(p.angle) * worldR;
        // -------------------------

        saveLS();
        if (inpVal) inpVal.value = au.toFixed(2);
      };

      inp.addEventListener('input', apply);
      if(inpVal) inpVal.addEventListener('change', () => { inp.value = inpVal.value; apply(); });
    }
  }

  // --- STATION FRAMES UI (ZOOM SPRITE) ---
  function buildStationFramesUI() {
    refreshUIRefs();
    const root = ui.stationsFramesGroup;
    if (!root) return;

    root.querySelectorAll('.row.frame').forEach(n => n.remove());

    const stations = Array.isArray(window.stations) ? window.stations : [];
    if (!stations.length) return;

    if (!DevConfig.stationSpriteFrameById) DevConfig.stationSpriteFrameById = {};

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

      // Ustawienie etykiety
      if (valEl) valEl.textContent = '×' + val.toFixed(2);

      const apply = (vRaw) => {
        let v = Number(vRaw);
        if (!Number.isFinite(v)) v = 3.0;
        v = Math.max(0.1, Math.min(3.0, v));

        // 1. Zapisz w konfigu
        DevConfig.stationSpriteFrameById[key] = v;

        // 2. Wyślij do silnika 3D
        if (typeof window.setStationSpriteFrame === 'function') {
          window.setStationSpriteFrame(key, v);
        }

        if (num) num.value = String(v);
        if (slider) slider.value = String(v);
        if (valEl) valEl.textContent = '×' + v.toFixed(2);

        saveLS();
      };
      
      slider?.addEventListener('input', e => apply(e.target.value));
      num?.addEventListener('input', e => apply(e.target.value));
    }
  }

  // --- 3D SCALES UI (Per Station) ---
  function setupPerStationScales() {
    const root = document.getElementById('dt-stations-per-scale');
    if (!root) return;

    function currentStations() {
      if (Array.isArray(window.stations) && window.stations.length) return window.stations;
      return [];
    }

    function rebuild() {
      root.innerHTML = '';
      const list = currentStations();
      for (const st of list) {
        const id = stationKey(st);
        if (!id) continue;
        const initial = (DevConfig.stationScaleById && DevConfig.stationScaleById[id]) || 1;

        const wrap = document.createElement('div');
        wrap.className = 'dt-row';
        wrap.style.alignItems = 'center';
        wrap.innerHTML = `
          <div class="dt-col" style="min-width:120px">${st.name || id}</div>
          <div class="dt-col" style="flex:1">
             <input type="range" min="0.2" max="5" step="0.01" value="${initial}" id="dt-scale-${id}">
             <input type="number" min="0.2" max="5" step="0.01" value="${initial}" id="dt-scale-num-${id}" style="width:72px;margin-left:8px">
          </div>
        `;
        root.appendChild(wrap);

        const range = wrap.querySelector(`input[type="range"]`);
        const num = wrap.querySelector(`input[type="number"]`);

        const apply = (v) => {
          const val = parseFloat(v);
          if (!isFinite(val)) return;
          DevConfig.stationScaleById[id] = val;
          // Przekazanie do silnika 3D
          if (typeof window.setStationScale === 'function') {
              window.setStationScale(id, val);
          }
          range.value = val;
          num.value = val;
          saveLS();
        };

        range.addEventListener('input', e => apply(e.target.value));
        num.addEventListener('input', e => apply(e.target.value));
      }
    }
    rebuild();
    setInterval(() => {
      if (root.children.length === 0 && currentStations().length > 0) rebuild();
    }, 2000);
  }

  function wireDevTools() {
    // --- GLOBALNA SKALA STACJI ---
    const elStation3DScale = document.getElementById('station3DScale');
    if (elStation3DScale) {
      elStation3DScale.addEventListener('input', e => {
        const val = parseFloat(e.target.value);
        // Aktualizacja globalnego stanu
        DevConfig.station3DScale = val;
        window.Dev.station3DScale = val; // Synchronizacja
        
        // Wymuszenie aktualizacji w silniku 3D
        if (typeof window.updateStations3D === 'function' && window.stations) {
            window.updateStations3D(window.stations);
        }
        
        const l = document.getElementById('station3DScaleVal');
        if (l) l.textContent = '×' + val.toFixed(2);
        saveLS();
      });
    }

    const elUnlimited = document.getElementById('toggleUnlimitedWarp');
    if (elUnlimited) {
      elUnlimited.checked = !!(window.DevFlags && window.DevFlags.unlimitedWarp);
      elUnlimited.addEventListener('change', e => {
        if (!window.DevFlags) window.DevFlags = {};
        window.DevFlags.unlimitedWarp = e.target.checked;
        saveLS();
      });
    }

    if (ui.planetScaleAll) {
      ui.planetScaleAll.addEventListener('input', () => {
        DevConfig.planetScaleAll = +ui.planetScaleAll.value;
        if (ui.planetScaleAllVal) ui.planetScaleAllVal.textContent = '×' + DevConfig.planetScaleAll.toFixed(2);
        // TODO: Można tu dodać logikę apply dla planetScaleAll
        saveLS(); 
      });
    }
    if (ui.pirScale) {
      ui.pirScale.addEventListener('input', () => {
        const v = +ui.pirScale.value;
        DevConfig.pirateScale = v;
        DevTuning.pirateStationScale = v;
        if (ui.pirScaleVal) ui.pirScaleVal.textContent = '×' + v.toFixed(2);
        saveLS();
      });
    }
  }

  // --- BOOT ---
  loadLS();
  refreshUIRefs();
  
  if (typeof DevConfig.stationSpriteFrame !== 'number') DevConfig.stationSpriteFrame = 3.0;

  // Renderowanie sekcji
  buildPlanetsUI();
  buildDistancesUI();
  buildStationFramesUI();
  setupPerStationScales();

  // Wypełnienie wartości początkowych w UI
  if (ui.sunR2D) ui.sunR2D.value = DevConfig.sunR2D || 823;
  if (ui.sunR3D) ui.sunR3D.value = DevConfig.sunR3D || 399;
  if (ui.planetScaleAll) ui.planetScaleAll.value = DevConfig.planetScaleAll || 1;
  if (ui.pirScale) ui.pirScale.value = DevConfig.pirateScale || 6;
  if (ui.station3DScale) ui.station3DScale.value = DevConfig.station3DScale || 2.7;

  // Odświeżenie opisów
  if (ui.sunR2DVal) ui.sunR2DVal.textContent = ui.sunR2D?.value;
  if (ui.sunR3DVal) ui.sunR3DVal.textContent = ui.sunR3D?.value;
  if (ui.planetScaleAllVal) ui.planetScaleAllVal.textContent = '×' + (+ui.planetScaleAll?.value).toFixed(2);
  if (ui.pirScaleVal) ui.pirScaleVal.textContent = '×' + (+ui.pirScale?.value).toFixed(2);
  if (ui.station3DScaleVal) ui.station3DScaleVal.textContent = '×' + (+ui.station3DScale?.value).toFixed(2);

  wireDevTools();

  // Pętla odświeżania dla dynamicznie ładowanych obiektów
  setInterval(() => {
    buildStationFramesUI();
  }, 2000);
}