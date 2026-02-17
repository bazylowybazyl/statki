import terranFrigateImg from '../assets/ships/terranfrigate.png';
import terranDestroyerImg from '../assets/ships/terrandestroyer.png';
import terranBattleshipImg from '../assets/ships/terranbattleship.png';
import pirateFrigateImg from '../assets/ships/piratefrigate.png';
import pirateDestroyerImg from '../assets/ships/piratedestroyer.png';
import pirateBattleshipImg from '../assets/ships/piratebattleship.png';

const STYLE_ID = 'hp-editor-style';
const ROOT_ID = 'hp-editor-root';
const STORAGE_KEY = 'hpEditor.v1';

const SHIP_DEFS = [
  { id: 'player', label: 'Statek gracza', sprite: 'assets/capital_ship_rect_v1.png' },
  { id: 'capital_carrier', label: 'Capital Carrier', sprite: 'assets/carrier.png' },
  { id: 'battleship', label: 'Battleship', sprite: terranBattleshipImg },
  { id: 'destroyer', label: 'Destroyer', sprite: terranDestroyerImg },
  { id: 'frigate', label: 'Fregata', sprite: terranFrigateImg },
  { id: 'pirate_battleship', label: 'Piraci: Battleship', sprite: pirateBattleshipImg },
  { id: 'pirate_destroyer', label: 'Piraci: Destroyer', sprite: pirateDestroyerImg },
  { id: 'pirate_frigate', label: 'Piraci: Fregata', sprite: pirateFrigateImg }
];

const HARDPOINT_TYPES = ['main', 'missile', 'aux', 'hangar', 'special'];

const COLORS = {
  main: '#53a7ff',
  missile: '#65e58e',
  aux: '#f8bd53',
  hangar: '#be7fff',
  special: '#ff6a6a',
  core: '#ff3c3c',
  engineMain: '#7ae4ff',
  engineSide: '#ffd46a'
};

const PALETTE_ITEMS = [
  { id: 'erase', label: 'Gumka', tool: 'erase', hardpointType: null, color: '#ff4d6d' },
  { id: 'hp_main', label: 'Hardpoint MAIN', tool: 'hardpoint', hardpointType: 'main', color: COLORS.main },
  { id: 'hp_missile', label: 'Hardpoint MISSILE', tool: 'hardpoint', hardpointType: 'missile', color: COLORS.missile },
  { id: 'hp_aux', label: 'Hardpoint AUX', tool: 'hardpoint', hardpointType: 'aux', color: COLORS.aux },
  { id: 'hp_hangar', label: 'Hardpoint HANGAR', tool: 'hardpoint', hardpointType: 'hangar', color: COLORS.hangar },
  { id: 'hp_special', label: 'Hardpoint SPECIAL', tool: 'hardpoint', hardpointType: 'special', color: COLORS.special },
  { id: 'engine_main', label: 'Dysza MAIN', tool: 'engine_main', hardpointType: null, color: COLORS.engineMain },
  { id: 'engine_side', label: 'Dysza SIDE', tool: 'engine_side', hardpointType: null, color: COLORS.engineSide }
];

const state = {
  shipId: SHIP_DEFS[0].id,
  tool: 'hardpoint',
  hardpointType: HARDPOINT_TYPES[0],
  engineDeg: 90,
  engineOffsetX: 0,
  engineOffsetY: 0,
  mirrorLR: true,
  mirrorUD: false,
  snap: true,
  gridSize: 24,
  showDiag: true,
  zoom: 1,
  panX: 0,
  panY: 0,
  ships: {},
  mouseLocal: null,
  mouseScreen: null,
  vfxTestEnabled: false,
  vfxKeys: {},
  pausedByEditor: false,
  visible: false,
  needsDraw: true
};

const runtime = {
  root: null,
  canvas: null,
  ctx: null,
  dpr: 1,
  cssW: 1,
  cssH: 1,
  raf: 0,
  dragPan: null,
  dragPaint: null,
  vfxLoopRaf: 0,
  controls: {},
  spriteCache: new Map()
};

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function toDeg(forward) {
  const x = Number(forward?.x) || 0;
  const y = Number(forward?.y) || 1;
  return Math.atan2(x, y) * 180 / Math.PI;
}

function normalizeDeg(value) {
  let deg = Number(value) || 0;
  while (deg > 180) deg -= 360;
  while (deg < -180) deg += 360;
  return deg;
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
  #${ROOT_ID}{position:fixed;inset:0;z-index:3000;display:none;background:#050a13}
  #${ROOT_ID}.open{display:block}
  #${ROOT_ID} .hp-editor-shell{position:absolute;inset:22px;border:1px solid #294064;border-radius:12px;background:#0a1020;color:#e5f1ff;display:flex;flex-direction:column;overflow:hidden;font-family:Inter,system-ui,Segoe UI,Arial}
  #${ROOT_ID} .hp-editor-top{display:flex;flex-wrap:wrap;gap:8px;padding:10px;border-bottom:1px solid #21304c;background:#0d162a}
  #${ROOT_ID} .hp-c{display:flex;gap:6px;align-items:center;background:#0a1222;border:1px solid #243654;border-radius:8px;padding:6px 8px}
  #${ROOT_ID} .hp-c label{font-size:12px;opacity:.9}
  #${ROOT_ID} .hp-c input[type=number],#${ROOT_ID} .hp-c select{background:#091122;color:#fff;border:1px solid #2d4264;border-radius:6px;padding:3px 6px}
  #${ROOT_ID} .hp-c input[type=checkbox]{transform:translateY(1px)}
  #${ROOT_ID} .hp-editor-top button{background:#102244;border:1px solid #35588b;color:#fff;border-radius:7px;padding:6px 10px;cursor:pointer}
  #${ROOT_ID} .hp-editor-top button:hover{background:#1a3159}
  #${ROOT_ID} .hp-editor-body{display:flex;flex:1;min-height:0}
  #${ROOT_ID} .hp-left{width:250px;max-width:32vw;border-right:1px solid #21304c;background:#0b1325;display:flex;flex-direction:column;min-height:0}
  #${ROOT_ID} .hp-left-head{padding:8px 10px;border-bottom:1px solid #263a5a;color:#9bc9ff;font-size:12px;font-weight:600}
  #${ROOT_ID} .hp-palette{flex:1;overflow:auto;padding:8px;display:flex;flex-direction:column;gap:6px}
  #${ROOT_ID} .hp-item{display:flex;align-items:center;gap:8px;padding:7px 8px;border:1px solid #2b3e60;border-radius:8px;background:#0a1120;cursor:pointer;user-select:none}
  #${ROOT_ID} .hp-item:hover{background:#101b33}
  #${ROOT_ID} .hp-item.active{border-color:#5da2ff;box-shadow:0 0 0 1px rgba(93,162,255,.35) inset}
  #${ROOT_ID} .hp-dot{width:12px;height:12px;border-radius:50%;display:inline-block;flex:0 0 12px}
  #${ROOT_ID} .hp-canvas-wrap{flex:1;position:relative;min-width:0;background:#04080f}
  #${ROOT_ID} canvas{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:crosshair}
  #${ROOT_ID} .hp-side{width:340px;max-width:45vw;border-left:1px solid #21304c;background:#0b1325;display:flex;flex-direction:column;padding:10px;gap:8px}
  #${ROOT_ID} .hp-front{padding:8px;border:1px solid #2b3e60;border-radius:8px;background:#0a1120;color:#99cbff}
  #${ROOT_ID} .hp-help{font-size:12px;line-height:1.4;opacity:.9}
  #${ROOT_ID} .hp-stats{font-size:12px;border:1px solid #2b3e60;border-radius:8px;padding:8px;background:#0a1120}
  #${ROOT_ID} .hp-sel{border:1px solid #2b3e60;border-radius:8px;padding:8px;background:#0a1120}
  #${ROOT_ID} .hp-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
  #${ROOT_ID} .hp-grid .full{grid-column:1/3}
  #${ROOT_ID} .hp-grid input,#${ROOT_ID} .hp-grid select{width:100%;box-sizing:border-box;background:#091122;color:#fff;border:1px solid #2d4264;border-radius:6px;padding:4px 6px}
  #${ROOT_ID} textarea{flex:1;min-height:140px;background:#091122;color:#d6ebff;border:1px solid #2d4264;border-radius:8px;padding:8px;font:11px/1.3 ui-monospace,Consolas,monospace}
  #${ROOT_ID} .hp-cursor-badge{position:absolute;display:none;pointer-events:none;z-index:20;background:rgba(8,14,28,.94);border:1px solid rgba(115,170,255,.75);border-radius:8px;padding:5px 8px;color:#d9ebff;font:12px/1.1 Inter,system-ui,sans-serif;white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,.35)}
  #${ROOT_ID} .hp-cursor-badge .dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px;vertical-align:middle;border:1px solid #fff}
  `;
  document.head.appendChild(style);
}

function createRoot() {
  if (runtime.root) return;
  ensureStyle();
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.innerHTML = `
  <div class="hp-editor-shell">
    <div class="hp-editor-top">
      <div class="hp-c"><label>Statek</label><select id="hp-ship"></select></div>
      <div class="hp-c"><label>Silnik deg</label><input id="hp-engine-deg" type="number" step="1" min="-180" max="180" value="90" style="width:70px;"></div>
      <div class="hp-c"><label>Offset X</label><input id="hp-engine-offx" type="number" step="1" value="0" style="width:70px;"></div>
      <div class="hp-c"><label>Offset Y</label><input id="hp-engine-offy" type="number" step="1" value="0" style="width:70px;"></div>
      <div class="hp-c"><label>Grid</label><input id="hp-grid" type="number" min="2" max="256" step="1" value="24" style="width:64px;"></div>
      <div class="hp-c"><label>Snap</label><input id="hp-snap" type="checkbox" checked></div>
      <div class="hp-c"><label>Sym L/R</label><input id="hp-mirror-lr" type="checkbox" checked></div>
      <div class="hp-c"><label>Sym G/D</label><input id="hp-mirror-ud" type="checkbox"></div>
      <div class="hp-c"><label>Diag 45°</label><input id="hp-diag" type="checkbox" checked></div>
      <div class="hp-c"><label>Zoom</label><input id="hp-zoom" type="range" min="0.2" max="4" step="0.05" value="1"></div>
      <div class="hp-c"><label>Test VFX (WSAD+QE+Shift)</label><input id="hp-vfx-test" type="checkbox"></div>
      <button id="hp-clear-ship">Wyczyść statek</button>
      <button id="hp-copy-json">Kopiuj JSON</button>
      <button id="hp-download-json">Pobierz JSON</button>
      <button id="hp-close">Zamknij</button>
    </div>
    <div class="hp-editor-body">
      <div class="hp-left">
        <div class="hp-left-head">Paleta (kliknij i maluj)</div>
        <div id="hp-palette" class="hp-palette"></div>
      </div>
      <div class="hp-canvas-wrap"><canvas id="hp-canvas"></canvas></div>
      <div class="hp-side">
        <div class="hp-front">Przód statku: <strong>→ (w prawo)</strong></div>
        <div class="hp-help">LPM: maluj marker (także po przeciągnięciu) • PPM: usuń najbliższy • Alt+LPM: bez snap • MMB drag: pan • Kółko myszy: zoom • Test VFX: WSAD + Q/E + Shift</div>
        <div id="hp-stats" class="hp-stats"></div>
        <textarea id="hp-json-preview" readonly></textarea>
      </div>
    </div>
  </div>
  <div id="hp-cursor-badge" class="hp-cursor-badge"></div>`;
  document.body.appendChild(root);
  runtime.root = root;
  runtime.canvas = root.querySelector('#hp-canvas');
  runtime.ctx = runtime.canvas.getContext('2d');
  runtime.controls = {
    ship: root.querySelector('#hp-ship'),
    palette: root.querySelector('#hp-palette'),
    engineDeg: root.querySelector('#hp-engine-deg'),
    engineOffX: root.querySelector('#hp-engine-offx'),
    engineOffY: root.querySelector('#hp-engine-offy'),
    grid: root.querySelector('#hp-grid'),
    snap: root.querySelector('#hp-snap'),
    mirrorLR: root.querySelector('#hp-mirror-lr'),
    mirrorUD: root.querySelector('#hp-mirror-ud'),
    diag: root.querySelector('#hp-diag'),
    zoom: root.querySelector('#hp-zoom'),
    vfxTest: root.querySelector('#hp-vfx-test'),
    clearShip: root.querySelector('#hp-clear-ship'),
    copyJson: root.querySelector('#hp-copy-json'),
    downloadJson: root.querySelector('#hp-download-json'),
    close: root.querySelector('#hp-close'),
    stats: root.querySelector('#hp-stats'),
    preview: root.querySelector('#hp-json-preview'),
    cursorBadge: root.querySelector('#hp-cursor-badge')
  };
  fillSelects();
  buildPaletteUI();
  bindControls();
  bindCanvas();
  resizeCanvas();
  loadStorage();
  syncControlsFromState();
  scheduleDraw();
}

function fillSelects() {
  const { ship } = runtime.controls;
  ship.innerHTML = SHIP_DEFS.map((s) => `<option value="${s.id}">${s.label}</option>`).join('');
}

function activePaletteId() {
  if (state.tool === 'erase') return 'erase';
  if (state.tool === 'hardpoint') return `hp_${state.hardpointType}`;
  if (state.tool === 'engine_main') return 'engine_main';
  if (state.tool === 'engine_side') return 'engine_side';
  return 'hp_main';
}

function setBrushFromPalette(itemId) {
  const item = PALETTE_ITEMS.find((p) => p.id === itemId);
  if (!item) return;
  state.tool = item.tool;
  if (item.hardpointType) state.hardpointType = item.hardpointType;
  const previewActive = state.vfxTestEnabled || state.tool === 'engine_main' || state.tool === 'engine_side';
  if (!previewActive) {
    state.vfxKeys = {};
    clearVfxOverride();
  }
  refreshVfxLoop();
  buildPaletteUI();
  const badge = runtime.controls.cursorBadge;
  if (badge) {
    badge.style.display = 'none';
  }
  persist();
  scheduleDraw();
}

function buildPaletteUI() {
  const root = runtime.controls.palette;
  if (!root) return;
  const activeId = activePaletteId();
  root.innerHTML = PALETTE_ITEMS.map((item) => `
    <div class="hp-item ${item.id === activeId ? 'active' : ''}" data-palette-id="${item.id}">
      <span class="hp-dot" style="background:${item.color}"></span>
      <span>${item.label}</span>
    </div>
  `).join('');
  root.querySelectorAll('.hp-item').forEach((node) => {
    node.addEventListener('click', () => {
      setBrushFromPalette(node.getAttribute('data-palette-id') || '');
    });
  });
}

function defaultShipData() {
  return {
    hardpoints: [],
    cores: [],
    engines: { main: [], side: [] }
  };
}

function ensureShipData(shipId) {
  if (!state.ships[shipId]) state.ships[shipId] = defaultShipData();
  const data = state.ships[shipId];
  if (!Array.isArray(data.hardpoints)) data.hardpoints = [];
  if (!Array.isArray(data.cores)) data.cores = [];
  if (!data.engines || typeof data.engines !== 'object') data.engines = { main: [], side: [] };
  if (!Array.isArray(data.engines.main)) data.engines.main = [];
  if (!Array.isArray(data.engines.side)) data.engines.side = [];
  bootstrapIfNeeded(shipId);
  return state.ships[shipId];
}

function markerId() {
  return `m_${Math.random().toString(36).slice(2, 9)}`;
}

function bootstrapIfNeeded(shipId) {
  const data = state.ships[shipId];
  if (!data || data.__bootstrapped) return;
  data.__bootstrapped = true;
  if (shipId !== 'player') return;
  const player = window.Game?.player || window.ship;
  if (!player) return;
  if (Array.isArray(player.hardpoints) && player.hardpoints.length && data.hardpoints.length === 0) {
    for (const hp of player.hardpoints) {
      const x = Number(hp?.pos?.x);
      const y = Number(hp?.pos?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      data.hardpoints.push({
        id: markerId(),
        x: round2(x),
        y: round2(y),
        type: hp.type || 'main'
      });
    }
  }
  const main = player.engines?.main;
  if (main?.vfxOffset && data.engines.main.length === 0) {
    data.engines.main.push({
      id: markerId(),
      x: round2(main.vfxOffset.x || 0),
      y: round2(main.vfxOffset.y || 0),
      deg: round2(toDeg(main.vfxForward)),
      offsetX: 0,
      offsetY: round2(main.vfxYNudge || 0)
    });
  }
  const side = Array.isArray(player.visual?.torqueThrusters) ? player.visual.torqueThrusters : [];
  if (side.length && data.engines.side.length === 0) {
    for (const thruster of side) {
      const ox = Number(thruster?.offset?.x);
      const oy = Number(thruster?.offset?.y);
      if (!Number.isFinite(ox) || !Number.isFinite(oy)) continue;
      data.engines.side.push({
        id: markerId(),
        x: round2(ox),
        y: round2(oy),
        deg: round2(toDeg(thruster?.forward)),
        offsetX: 0,
        offsetY: round2(thruster?.yNudge || 0)
      });
    }
  }
}

function getSpriteSource(shipId) {
  if (shipId === 'player') {
    const canvas = window.ship?.hexGrid?.cacheCanvas;
    if (canvas) return { kind: 'canvas', value: canvas, key: `player_canvas_${canvas.width}x${canvas.height}` };
  }
  const def = SHIP_DEFS.find((s) => s.id === shipId);
  return { kind: 'url', value: def?.sprite || '', key: def?.sprite || shipId };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

async function ensureSprite(shipId) {
  const src = getSpriteSource(shipId);
  if (!src.value) return null;
  const cacheKey = `${shipId}|${src.key}`;
  if (runtime.spriteCache.has(cacheKey)) return runtime.spriteCache.get(cacheKey);
  try {
    const sprite = src.kind === 'canvas' ? src.value : await loadImage(src.value);
    runtime.spriteCache.set(cacheKey, sprite);
    return sprite;
  } catch {
    return null;
  }
}

function bindControls() {
  const c = runtime.controls;
  c.ship.addEventListener('change', () => {
    state.shipId = c.ship.value;
    ensureShipData(state.shipId);
    persist();
    scheduleDraw();
  });
  c.engineDeg.addEventListener('input', () => {
    state.engineDeg = normalizeDeg(c.engineDeg.value);
    persist();
    scheduleDraw();
  });
  c.engineOffX.addEventListener('input', () => {
    state.engineOffsetX = Number(c.engineOffX.value) || 0;
    persist();
    scheduleDraw();
  });
  c.engineOffY.addEventListener('input', () => {
    state.engineOffsetY = Number(c.engineOffY.value) || 0;
    persist();
    scheduleDraw();
  });
  c.grid.addEventListener('input', () => { state.gridSize = Math.max(2, Math.min(256, Math.round(Number(c.grid.value) || 24))); scheduleDraw(); });
  c.snap.addEventListener('change', () => { state.snap = !!c.snap.checked; scheduleDraw(); });
  c.mirrorLR.addEventListener('change', () => { state.mirrorLR = !!c.mirrorLR.checked; });
  c.mirrorUD.addEventListener('change', () => { state.mirrorUD = !!c.mirrorUD.checked; });
  c.diag.addEventListener('change', () => { state.showDiag = !!c.diag.checked; scheduleDraw(); });
  c.zoom.addEventListener('input', () => { state.zoom = Math.max(0.2, Math.min(4, Number(c.zoom.value) || 1)); scheduleDraw(); });
  c.vfxTest.addEventListener('change', () => {
    state.vfxTestEnabled = !!c.vfxTest.checked;
    if (!state.vfxTestEnabled) {
      state.vfxKeys = {};
      clearVfxOverride();
    }
    refreshVfxLoop();
    persist();
  });
  c.clearShip.addEventListener('click', () => {
    const data = ensureShipData(state.shipId);
    data.hardpoints = [];
    data.cores = [];
    data.engines = { main: [], side: [] };
    persist();
    scheduleDraw();
  });
  c.copyJson.addEventListener('click', async () => {
    const json = JSON.stringify(buildExportData(), null, 2);
    c.preview.value = json;
    try { await navigator.clipboard.writeText(json); } catch {}
  });
  c.downloadJson.addEventListener('click', () => {
    const json = JSON.stringify(buildExportData(), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ship-hardpoints-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
  c.close.addEventListener('click', closeHardpointEditor);
  runtime.root.addEventListener('mousemove', onRootMouseMove);
  runtime.root.addEventListener('mouseleave', onRootMouseLeave);
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
}

function getActivePaletteItem() {
  return PALETTE_ITEMS.find((p) => p.id === activePaletteId()) || null;
}

function updateCursorBadge(clientX, clientY) {
  const badge = runtime.controls.cursorBadge;
  if (!badge || !state.visible) return;
  const item = getActivePaletteItem();
  if (!item) {
    badge.style.display = 'none';
    return;
  }
  const rootRect = runtime.root.getBoundingClientRect();
  let x = clientX - rootRect.left + 14;
  let y = clientY - rootRect.top - 14;
  badge.innerHTML = `<span class="dot" style="background:${item.color}"></span><span>${item.label}</span>`;
  badge.style.display = 'block';
  const bw = badge.offsetWidth || 120;
  const bh = badge.offsetHeight || 24;
  if (x + bw > rootRect.width - 6) x = rootRect.width - bw - 6;
  if (y < 6) y = 6;
  badge.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

function onRootMouseMove(event) {
  if (!state.visible) return;
  updateCursorBadge(event.clientX, event.clientY);
}

function onRootMouseLeave() {
  const badge = runtime.controls.cursorBadge;
  if (badge) badge.style.display = 'none';
}

function onKeyDown(event) {
  if (!state.visible) return;
  if ((state.vfxTestEnabled || state.tool === 'engine_main' || state.tool === 'engine_side') && isVfxTestKey(event.code)) {
    state.vfxKeys[event.code] = true;
    event.preventDefault();
    event.stopPropagation();
    applyVfxOverride();
    scheduleDraw();
    return;
  }
  if (event.key === 'Escape') {
    closeHardpointEditor();
    return;
  }
}

function onKeyUp(event) {
  if (!state.visible) return;
  if (!(state.vfxTestEnabled || state.tool === 'engine_main' || state.tool === 'engine_side')) return;
  if (!isVfxTestKey(event.code)) return;
  delete state.vfxKeys[event.code];
  event.preventDefault();
  event.stopPropagation();
  applyVfxOverride();
  scheduleDraw();
}

function isVfxTestKey(code) {
  return code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD'
    || code === 'KeyQ' || code === 'KeyE'
    || code === 'ShiftLeft' || code === 'ShiftRight';
}

function applyVfxOverride() {
  if (!state.visible) return;
  if (!(state.vfxTestEnabled || state.tool === 'engine_main' || state.tool === 'engine_side')) return;
  const ship = window.ship;
  if (!ship) return;
  const keys = state.vfxKeys;
  const boost = !!(keys.ShiftLeft || keys.ShiftRight);
  const boostMul = boost ? 1.35 : 1.0;
  const mainPressed = !!(keys.KeyW || keys.KeyS);
  const main = mainPressed ? Math.min(1, 1.0 * boostMul) : 0;
  const leftSide = keys.KeyQ ? Math.min(1, 1.0 * boostMul) : 0;
  const rightSide = keys.KeyE ? Math.min(1, 1.0 * boostMul) : 0;
  const torque = keys.KeyA ? -Math.min(1, 1.0 * boostMul) : (keys.KeyD ? Math.min(1, 1.0 * boostMul) : 0);
  ship.thrusterInput = ship.thrusterInput || { main: 0, leftSide: 0, rightSide: 0, torque: 0 };
  ship.thrusterInput.main = main;
  ship.thrusterInput.leftSide = leftSide;
  ship.thrusterInput.rightSide = rightSide;
  ship.thrusterInput.torque = torque;
  if (ship.input) {
    ship.input.main = main;
    ship.input.thrustY = main;
    ship.input.leftSide = leftSide;
    ship.input.rightSide = rightSide;
    ship.input.torque = torque;
    ship.input.thrustX = rightSide - leftSide;
  }
}

function clearVfxOverride() {
  const ship = window.ship;
  if (!ship) return;
  ship.thrusterInput = ship.thrusterInput || { main: 0, leftSide: 0, rightSide: 0, torque: 0 };
  ship.thrusterInput.main = 0;
  ship.thrusterInput.leftSide = 0;
  ship.thrusterInput.rightSide = 0;
  ship.thrusterInput.torque = 0;
}

function refreshVfxLoop() {
  if (runtime.vfxLoopRaf) {
    cancelAnimationFrame(runtime.vfxLoopRaf);
    runtime.vfxLoopRaf = 0;
  }
  if (!state.visible) return;
  if (!(state.vfxTestEnabled || state.tool === 'engine_main' || state.tool === 'engine_side')) return;
  const tick = () => {
    runtime.vfxLoopRaf = 0;
    if (!state.visible) return;
    if (!(state.vfxTestEnabled || state.tool === 'engine_main' || state.tool === 'engine_side')) return;
    applyVfxOverride();
    scheduleDraw();
    runtime.vfxLoopRaf = requestAnimationFrame(tick);
  };
  runtime.vfxLoopRaf = requestAnimationFrame(tick);
}

function setGamePausedSafe(next) {
  if (typeof window.__setGamePaused === 'function') {
    window.__setGamePaused(!!next);
    return true;
  }
  return false;
}

function isGamePausedSafe() {
  if (typeof window.__isGamePaused === 'function') return !!window.__isGamePaused();
  return null;
}

function bindCanvas() {
  const wrap = runtime.canvas?.parentElement || runtime.canvas;
  if (!wrap) return;
  wrap.style.touchAction = 'none';
  wrap.addEventListener('contextmenu', (e) => e.preventDefault());
  wrap.addEventListener('mousedown', onCanvasDown, { passive: false });
  wrap.addEventListener('mousemove', onCanvasMove, { passive: false });
  wrap.addEventListener('mouseup', onCanvasUp, { passive: false });
  wrap.addEventListener('mouseleave', onCanvasLeave);
  wrap.addEventListener('wheel', onCanvasWheel, { passive: false });
}

function normalizeBrushState() {
  if (!['erase', 'hardpoint', 'core', 'engine_main', 'engine_side'].includes(state.tool)) {
    state.tool = 'hardpoint';
  }
  if (!HARDPOINT_TYPES.includes(state.hardpointType)) {
    state.hardpointType = 'main';
  }
}

function removeMarkersNearPoint(x, y, radiusLocal) {
  const data = ensureShipData(state.shipId);
  const radiusSq = radiusLocal * radiusLocal;
  const keepOutside = (marker) => {
    const dx = (Number(marker?.x) || 0) - x;
    const dy = (Number(marker?.y) || 0) - y;
    return ((dx * dx) + (dy * dy)) > radiusSq;
  };
  const before = data.hardpoints.length + data.cores.length + data.engines.main.length + data.engines.side.length;
  data.hardpoints = data.hardpoints.filter(keepOutside);
  data.cores = data.cores.filter(keepOutside);
  data.engines.main = data.engines.main.filter(keepOutside);
  data.engines.side = data.engines.side.filter(keepOutside);
  const after = data.hardpoints.length + data.cores.length + data.engines.main.length + data.engines.side.length;
  return before - after;
}

function eraseWithBrush(x, y) {
  const sym = buildSymmetryPositions(x, y);
  const radiusLocal = Math.max(14, state.gridSize * 0.9);
  let removed = 0;
  for (const pos of sym) {
    removed += removeMarkersNearPoint(pos.x, pos.y, radiusLocal);
  }
  if (removed <= 0) {
    const nearestThreshold = Math.max(42, state.gridSize * 2.4);
    for (const pos of sym) {
      const nearest = findNearestMarker(pos.x, pos.y);
      if (nearest && nearest.distance <= nearestThreshold) {
        removeMarkerById(nearest.marker.id);
        removed += 1;
      }
    }
  }
  return removed > 0;
}

function applyPrimaryBrushAction(x, y) {
  normalizeBrushState();
  const clamped = clampLocalToSprite(x, y);
  if (state.tool === 'erase') {
    return eraseWithBrush(clamped.x, clamped.y);
  }
  const placed = placeMarker(clamped.x, clamped.y);
  return placed.length > 0;
}

function onCanvasWheel(event) {
  event.preventDefault();
  const dir = event.deltaY > 0 ? -1 : 1;
  state.zoom = Math.max(0.2, Math.min(4, state.zoom + dir * 0.08));
  runtime.controls.zoom.value = String(state.zoom);
  scheduleDraw();
}

function onCanvasDown(event) {
  event.preventDefault();
  event.stopPropagation();
  const rect = runtime.canvas.getBoundingClientRect();
  state.mouseScreen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  if (event.button === 1) {
    runtime.dragPan = { x: event.clientX, y: event.clientY, panX: state.panX, panY: state.panY };
    return;
  }
  const local = screenToLocal(event.clientX, event.clientY, event.altKey || state.tool === 'erase');
  if (!local) return;
  state.mouseLocal = local;
  if (event.button === 2) {
    removeNearestMarker(local.x, local.y);
    persist();
    scheduleDraw();
    return;
  }
  if (event.button !== 0 && event.button !== undefined) return;
  const changed = applyPrimaryBrushAction(local.x, local.y);
  const key = `${local.x}|${local.y}|${activePaletteId()}`;
  runtime.dragPaint = { lastKey: key };
  if (changed) persist();
  scheduleDraw();
}

function onCanvasMove(event) {
  event.preventDefault();
  event.stopPropagation();
  const rect = runtime.canvas.getBoundingClientRect();
  state.mouseScreen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  const local = screenToLocal(event.clientX, event.clientY, event.altKey || state.tool === 'erase');
  state.mouseLocal = local;
  updateCursorBadge(event.clientX, event.clientY);
  if (runtime.dragPan) {
    const dx = event.clientX - runtime.dragPan.x;
    const dy = event.clientY - runtime.dragPan.y;
    state.panX = runtime.dragPan.panX + dx;
    state.panY = runtime.dragPan.panY + dy;
    scheduleDraw();
    return;
  }
  if (runtime.dragPaint && local) {
    const key = `${local.x}|${local.y}|${activePaletteId()}`;
    if (key !== runtime.dragPaint.lastKey) {
      const changed = applyPrimaryBrushAction(local.x, local.y);
      runtime.dragPaint.lastKey = key;
      if (changed) persist();
    }
  }
  scheduleDraw();
}

function onCanvasUp(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  runtime.dragPan = null;
  runtime.dragPaint = null;
}

function onCanvasLeave() {
  runtime.dragPan = null;
  runtime.dragPaint = null;
  state.mouseLocal = null;
  state.mouseScreen = null;
  scheduleDraw();
}

function resizeCanvas() {
  if (!runtime.canvas) return;
  const rect = runtime.canvas.getBoundingClientRect();
  runtime.cssW = Math.max(1, rect.width);
  runtime.cssH = Math.max(1, rect.height);
  runtime.dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  runtime.canvas.width = Math.round(runtime.cssW * runtime.dpr);
  runtime.canvas.height = Math.round(runtime.cssH * runtime.dpr);
  runtime.ctx.setTransform(runtime.dpr, 0, 0, runtime.dpr, 0, 0);
  scheduleDraw();
}

function getActiveSprite() {
  const src = getSpriteSource(state.shipId);
  const key = `${state.shipId}|${src.key}`;
  return runtime.spriteCache.get(key) || null;
}

function getDrawScale() {
  const sprite = getActiveSprite();
  const rawW = Number(sprite?.width ?? sprite?.naturalWidth ?? 0);
  const rawH = Number(sprite?.height ?? sprite?.naturalHeight ?? 0);
  const sw = Number.isFinite(rawW) && rawW > 2 ? rawW : 600;
  const sh = Number.isFinite(rawH) && rawH > 2 ? rawH : 300;
  const fit = Math.min((runtime.cssW * 0.72) / sw, (runtime.cssH * 0.82) / sh);
  if (!Number.isFinite(fit) || fit <= 0) return 1;
  return Math.max(0.02, fit * state.zoom);
}

function getSpriteLocalBounds() {
  const sprite = getActiveSprite();
  const rawW = Number(sprite?.width ?? sprite?.naturalWidth ?? 0);
  const rawH = Number(sprite?.height ?? sprite?.naturalHeight ?? 0);
  const sw = Number.isFinite(rawW) && rawW > 2 ? rawW : 600;
  const sh = Number.isFinite(rawH) && rawH > 2 ? rawH : 300;
  return { halfW: sw * 0.5, halfH: sh * 0.5 };
}

function clampLocalToSprite(x, y) {
  const bounds = getSpriteLocalBounds();
  return {
    x: round2(Math.max(-bounds.halfW, Math.min(bounds.halfW, Number(x) || 0))),
    y: round2(Math.max(-bounds.halfH, Math.min(bounds.halfH, Number(y) || 0)))
  };
}

function screenToLocal(clientX, clientY, noSnap) {
  const rect = runtime.canvas.getBoundingClientRect();
  const sx = clientX - rect.left;
  const sy = clientY - rect.top;
  const scale = getDrawScale();
  const cx = runtime.cssW * 0.5 + state.panX;
  const cy = runtime.cssH * 0.5 + state.panY;
  let x = (sx - cx) / scale;
  let y = (sy - cy) / scale;
  if (state.snap && !noSnap) {
    const g = Math.max(2, state.gridSize);
    x = Math.round(x / g) * g;
    y = Math.round(y / g) * g;
  }
  return { x: round2(x), y: round2(y) };
}

function localToScreen(x, y) {
  const scale = getDrawScale();
  return {
    x: runtime.cssW * 0.5 + state.panX + x * scale,
    y: runtime.cssH * 0.5 + state.panY + y * scale
  };
}

function addMarker(target, marker) {
  const data = ensureShipData(state.shipId);
  if (target === 'hardpoint') data.hardpoints.push(marker);
  else if (target === 'core') data.cores.push(marker);
  else if (target === 'engine_main') data.engines.main.push(marker);
  else if (target === 'engine_side') data.engines.side.push(marker);
}

function mirrorDeg(deg, mirrorX, mirrorY) {
  let out = Number(deg) || 0;
  if (mirrorX) out = 180 - out;
  if (mirrorY) out = -out;
  return normalizeDeg(out);
}

function buildSymmetryPositions(x, y) {
  const positions = [{ x, y, mirrorX: false, mirrorY: false }];
  if (state.mirrorLR) positions.push({ x: -x, y, mirrorX: true, mirrorY: false });
  if (state.mirrorUD) positions.push({ x, y: -y, mirrorX: false, mirrorY: true });
  if (state.mirrorLR && state.mirrorUD) positions.push({ x: -x, y: -y, mirrorX: true, mirrorY: true });
  const dedupe = new Map();
  for (const p of positions) {
    const key = `${round2(p.x)}|${round2(p.y)}`;
    if (!dedupe.has(key)) dedupe.set(key, p);
  }
  return [...dedupe.values()];
}

function placeMarker(x, y) {
  const placedIds = [];
  const sym = buildSymmetryPositions(x, y);
  for (const pos of sym) {
    if (state.tool === 'hardpoint') {
      const id = markerId();
      addMarker('hardpoint', { id, x: pos.x, y: pos.y, type: state.hardpointType });
      placedIds.push(id);
    } else if (state.tool === 'core') {
      const id = markerId();
      addMarker('core', { id, x: pos.x, y: pos.y, type: 'core' });
      placedIds.push(id);
    } else if (state.tool === 'engine_main' || state.tool === 'engine_side') {
      const id = markerId();
      addMarker(state.tool, {
        id,
        x: pos.x,
        y: pos.y,
        deg: mirrorDeg(state.engineDeg, pos.mirrorX, pos.mirrorY),
        offsetX: round2(state.engineOffsetX),
        offsetY: round2(state.engineOffsetY)
      });
      placedIds.push(id);
    }
  }
  return placedIds;
}

function getAllMarkers() {
  const data = ensureShipData(state.shipId);
  const out = [];
  for (const m of data.hardpoints) out.push({ marker: m, kind: 'hardpoint' });
  for (const m of data.cores) out.push({ marker: m, kind: 'core' });
  for (const m of data.engines.main) out.push({ marker: m, kind: 'engine_main' });
  for (const m of data.engines.side) out.push({ marker: m, kind: 'engine_side' });
  return out;
}

function findNearestMarker(x, y) {
  let best = null;
  for (const item of getAllMarkers()) {
    const dx = (item.marker.x || 0) - x;
    const dy = (item.marker.y || 0) - y;
    const d = Math.hypot(dx, dy);
    if (!best || d < best.distance) best = { marker: item.marker, kind: item.kind, distance: d };
  }
  return best;
}

function removeNearestMarker(x, y) {
  const nearest = findNearestMarker(x, y);
  if (!nearest || nearest.distance > (10 / getDrawScale())) return;
  removeMarkerById(nearest.marker.id);
}

function removeMarkerById(id) {
  const data = ensureShipData(state.shipId);
  data.hardpoints = data.hardpoints.filter((m) => m.id !== id);
  data.cores = data.cores.filter((m) => m.id !== id);
  data.engines.main = data.engines.main.filter((m) => m.id !== id);
  data.engines.side = data.engines.side.filter((m) => m.id !== id);
}

function draw() {
  if (!state.visible || !runtime.ctx) return;
  if (!ensureCanvasReady()) return;
  state.needsDraw = false;
  const ctx = runtime.ctx;
  ctx.clearRect(0, 0, runtime.cssW, runtime.cssH);
  ctx.fillStyle = '#050a13';
  ctx.fillRect(0, 0, runtime.cssW, runtime.cssH);
  drawGrid(ctx);
  drawSprite(ctx);
  drawFrontArrow(ctx);
  drawMarkers(ctx);
  drawEngineVfxPreview(ctx);
  drawBrushPreview(ctx);
  updateStatsAndPreview();
}

function ensureCanvasReady() {
  if (runtime.cssW >= 80 && runtime.cssH >= 80) return true;
  resizeCanvas();
  if (runtime.cssW >= 80 && runtime.cssH >= 80) return true;
  requestAnimationFrame(() => {
    resizeCanvas();
    scheduleDraw();
  });
  return false;
}

function drawGrid(ctx) {
  const scale = getDrawScale();
  const g = Math.max(2, state.gridSize) * scale;
  if (!Number.isFinite(g) || g < 6) return;
  const cx = runtime.cssW * 0.5 + state.panX;
  const cy = runtime.cssH * 0.5 + state.panY;
  ctx.save();
  ctx.strokeStyle = 'rgba(120,170,255,0.12)';
  ctx.lineWidth = 1;
  for (let x = cx % g; x <= runtime.cssW; x += g) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, runtime.cssH); ctx.stroke();
  }
  for (let y = cy % g; y <= runtime.cssH; y += g) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(runtime.cssW, y); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(90,140,220,0.32)';
  ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, runtime.cssH); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(runtime.cssW, cy); ctx.stroke();
  if (state.showDiag) {
    ctx.strokeStyle = 'rgba(100,140,210,0.16)';
    const len = Math.max(runtime.cssW, runtime.cssH);
    ctx.beginPath(); ctx.moveTo(cx - len, cy - len); ctx.lineTo(cx + len, cy + len); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - len, cy + len); ctx.lineTo(cx + len, cy - len); ctx.stroke();
  }
  ctx.restore();
}

function drawSprite(ctx) {
  const sprite = getActiveSprite();
  if (!sprite) {
    ensureSprite(state.shipId).then(() => scheduleDraw());
    return;
  }
  const rawW = Number(sprite?.width ?? sprite?.naturalWidth ?? 0);
  const rawH = Number(sprite?.height ?? sprite?.naturalHeight ?? 0);
  if (!Number.isFinite(rawW) || !Number.isFinite(rawH) || rawW <= 2 || rawH <= 2) {
    ensureSprite(state.shipId).then(() => scheduleDraw());
    return;
  }
  const scale = getDrawScale();
  const cx = runtime.cssW * 0.5 + state.panX;
  const cy = runtime.cssH * 0.5 + state.panY;
  const w = rawW * scale;
  const h = rawH * scale;
  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sprite, cx - w * 0.5, cy - h * 0.5, w, h);
  ctx.restore();
}

function drawFrontArrow(ctx) {
  const cx = runtime.cssW * 0.5 + state.panX;
  const cy = runtime.cssH * 0.5 + state.panY;
  ctx.save();
  ctx.strokeStyle = '#9fd0ff';
  ctx.fillStyle = '#9fd0ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + 120, cy);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + 120, cy);
  ctx.lineTo(cx + 105, cy - 7);
  ctx.lineTo(cx + 105, cy + 7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function markerColor(kind, marker) {
  if (kind === 'hardpoint') return COLORS[marker.type] || '#fff';
  if (kind === 'core') return COLORS.core;
  if (kind === 'engine_main') return COLORS.engineMain;
  if (kind === 'engine_side') return COLORS.engineSide;
  return '#fff';
}

function withAlpha(color, alpha) {
  const a = Math.max(0, Math.min(1, Number(alpha) || 1));
  if (typeof color !== 'string') return `rgba(255,255,255,${a})`;
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return `rgba(${r},${g},${b},${a})`;
    }
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return `rgba(${r},${g},${b},${a})`;
    }
  }
  return color;
}

function brushColor() {
  const id = activePaletteId();
  return PALETTE_ITEMS.find((p) => p.id === id)?.color || '#ffffff';
}

function getVfxPreviewThrottle() {
  const keys = state.vfxKeys || {};
  const boost = !!(keys.ShiftLeft || keys.ShiftRight);
  const boostMul = boost ? 1.35 : 1.0;
  const main = (keys.KeyW || keys.KeyS) ? Math.min(1, 1.0 * boostMul) : 0;
  const side = (keys.KeyQ || keys.KeyE || keys.KeyA || keys.KeyD) ? Math.min(1, 0.95 * boostMul) : 0;
  return { main, side, boost };
}

function drawEngineVfxPreview(ctx) {
  if (!(state.vfxTestEnabled || state.tool === 'engine_main' || state.tool === 'engine_side')) return;
  const data = ensureShipData(state.shipId);
  const throttle = getVfxPreviewThrottle();
  const scale = getDrawScale();
  const time = performance.now() * 0.003;
  const drawJet = (marker, color, power, kind) => {
    if (!marker || power <= 0) return;
    const baseX = Number(marker.x) + (Number(marker.offsetX) || 0);
    const baseY = Number(marker.y) + (Number(marker.offsetY) || 0);
    const p = localToScreen(baseX, baseY);
    const deg = Number(marker.deg) || 0;
    const rad = deg * Math.PI / 180;
    const bx = -Math.sin(rad);
    const by = Math.cos(rad);
    const flicker = 0.88 + Math.sin(time + baseX * 0.01 + baseY * 0.01) * 0.12;
    const len = (22 + (kind === 'main' ? 35 : 24)) * scale * power * flicker;
    const wid = (8 + 10 * power) * scale;
    const tipX = p.x + bx * len;
    const tipY = p.y + by * len;
    const nx = -by;
    const ny = bx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.78;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(p.x + nx * wid * 0.5, p.y + ny * wid * 0.5);
    ctx.lineTo(p.x - nx * wid * 0.5, p.y - ny * wid * 0.5);
    ctx.lineTo(tipX, tipY);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  for (const marker of data.engines.main || []) {
    drawJet(marker, 'rgba(110,220,255,0.95)', throttle.main, 'main');
  }
  for (const marker of data.engines.side || []) {
    drawJet(marker, 'rgba(255,205,120,0.9)', throttle.side, 'side');
  }

  if (state.mouseLocal && (state.tool === 'engine_main' || state.tool === 'engine_side')) {
    const color = state.tool === 'engine_main' ? 'rgba(110,220,255,0.95)' : 'rgba(255,205,120,0.9)';
    const kind = state.tool === 'engine_main' ? 'main' : 'side';
    const power = state.tool === 'engine_main' ? throttle.main : throttle.side;
    const sym = buildSymmetryPositions(state.mouseLocal.x, state.mouseLocal.y);
    for (const pos of sym) {
      drawJet({
        x: pos.x,
        y: pos.y,
        deg: mirrorDeg(state.engineDeg, !!pos.mirrorX, !!pos.mirrorY),
        offsetX: round2(state.engineOffsetX),
        offsetY: round2(state.engineOffsetY)
      }, color, power, kind);
    }
  }
}

function drawBrushPreview(ctx) {
  if (!state.mouseLocal) return;
  const sym = buildSymmetryPositions(state.mouseLocal.x, state.mouseLocal.y);
  const scale = getDrawScale();
  const radius = Math.max(4, Math.min(10, 6 + scale * 0.02));
  const color = brushColor();
  ctx.save();
  ctx.globalAlpha = 0.55;
  for (const pos of sym) {
    const p = localToScreen(pos.x, pos.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    if (state.tool === 'erase') {
      ctx.beginPath();
      ctx.moveTo(p.x - radius * 0.8, p.y - radius * 0.8);
      ctx.lineTo(p.x + radius * 0.8, p.y + radius * 0.8);
      ctx.moveTo(p.x + radius * 0.8, p.y - radius * 0.8);
      ctx.lineTo(p.x - radius * 0.8, p.y + radius * 0.8);
      ctx.stroke();
    } else if (state.tool === 'engine_main' || state.tool === 'engine_side') {
      const deg = mirrorDeg(state.engineDeg, !!pos.mirrorX, !!pos.mirrorY);
      const rad = deg * Math.PI / 180;
      const dx = Math.sin(rad) * radius * 2.2;
      const dy = -Math.cos(rad) * radius * 2.2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + dx, p.y + dy);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawCursorBrushBadge(ctx) {
  if (!state.mouseScreen) return;
  const item = PALETTE_ITEMS.find((p) => p.id === activePaletteId());
  if (!item) return;

  const label = item.label;
  const padX = 8;
  const boxH = 24;
  const iconR = 5;
  ctx.save();
  ctx.font = '12px Inter, system-ui, sans-serif';
  const textW = Math.ceil(ctx.measureText(label).width);
  const boxW = Math.max(110, textW + 34);

  let x = state.mouseScreen.x + 14;
  let y = state.mouseScreen.y - 14;
  if (x + boxW > runtime.cssW - 6) x = runtime.cssW - boxW - 6;
  if (y < boxH + 6) y = boxH + 6;

  const rx = x;
  const ry = y - boxH;
  const rr = 7;
  ctx.fillStyle = 'rgba(8,14,28,0.92)';
  ctx.strokeStyle = 'rgba(115,170,255,0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(rx + rr, ry);
  ctx.lineTo(rx + boxW - rr, ry);
  ctx.quadraticCurveTo(rx + boxW, ry, rx + boxW, ry + rr);
  ctx.lineTo(rx + boxW, ry + boxH - rr);
  ctx.quadraticCurveTo(rx + boxW, ry + boxH, rx + boxW - rr, ry + boxH);
  ctx.lineTo(rx + rr, ry + boxH);
  ctx.quadraticCurveTo(rx, ry + boxH, rx, ry + boxH - rr);
  ctx.lineTo(rx, ry + rr);
  ctx.quadraticCurveTo(rx, ry, rx + rr, ry);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const iconX = rx + padX + iconR;
  const iconY = ry + boxH * 0.5;
  ctx.fillStyle = item.color;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(iconX, iconY, iconR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (item.tool === 'erase') {
    ctx.strokeStyle = item.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(iconX - 6, iconY - 6);
    ctx.lineTo(iconX + 6, iconY + 6);
    ctx.moveTo(iconX + 6, iconY - 6);
    ctx.lineTo(iconX - 6, iconY + 6);
    ctx.stroke();
  } else if (item.tool === 'engine_main' || item.tool === 'engine_side') {
    const rad = (Number(state.engineDeg) || 0) * Math.PI / 180;
    const dx = Math.sin(rad) * 11;
    const dy = -Math.cos(rad) * 11;
    ctx.strokeStyle = item.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(iconX, iconY);
    ctx.lineTo(iconX + dx, iconY + dy);
    ctx.stroke();
  } else {
    ctx.strokeStyle = item.color;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(iconX - 6, iconY);
    ctx.lineTo(iconX + 6, iconY);
    ctx.moveTo(iconX, iconY - 6);
    ctx.lineTo(iconX, iconY + 6);
    ctx.stroke();
  }

  ctx.fillStyle = '#d9ebff';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, rx + padX + 16, iconY);
  ctx.restore();
}

function drawMarkers(ctx) {
  const scale = getDrawScale();
  const radius = Math.max(7, Math.min(14, 9 + scale * 0.025));
  for (const item of getAllMarkers()) {
    const marker = item.marker;
    const p = localToScreen(marker.x || 0, marker.y || 0);
    const color = markerColor(item.kind, marker);
    ctx.save();
    ctx.fillStyle = withAlpha(color, 0.34);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = 7;
    ctx.shadowColor = withAlpha(color, 0.95);
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(p.x - radius * 0.8, p.y);
    ctx.lineTo(p.x + radius * 0.8, p.y);
    ctx.moveTo(p.x, p.y - radius * 0.8);
    ctx.lineTo(p.x, p.y + radius * 0.8);
    ctx.stroke();
    if (item.kind === 'engine_main' || item.kind === 'engine_side') {
      const deg = Number(marker.deg) || 0;
      const rad = deg * Math.PI / 180;
      const dx = Math.sin(rad) * radius * 2.2;
      const dy = -Math.cos(rad) * radius * 2.2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + dx, p.y + dy);
      ctx.stroke();
      ctx.fillStyle = withAlpha(color, 0.92);
      ctx.beginPath();
      ctx.arc(p.x + dx, p.y + dy, Math.max(2, radius * 0.28), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function compactMarker(marker, kind) {
  if (kind === 'hardpoint') return { id: marker.id, type: marker.type, x: round2(marker.x), y: round2(marker.y) };
  if (kind === 'core') return { id: marker.id, x: round2(marker.x), y: round2(marker.y) };
  return {
    id: marker.id,
    x: round2(marker.x),
    y: round2(marker.y),
    deg: round2(marker.deg || 0),
    offsetX: round2(marker.offsetX || 0),
    offsetY: round2(marker.offsetY || 0)
  };
}

function buildExportData() {
  const ships = {};
  for (const def of SHIP_DEFS) {
    const data = ensureShipData(def.id);
    ships[def.id] = {
      label: def.label,
      frontAxis: '+X',
      hardpoints: data.hardpoints.map((m) => compactMarker(m, 'hardpoint')),
      cores: data.cores.map((m) => compactMarker(m, 'core')),
      engines: {
        main: data.engines.main.map((m) => compactMarker(m, 'engine')),
        side: data.engines.side.map((m) => compactMarker(m, 'engine'))
      }
    };
  }
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'hardpoint-editor',
    ships
  };
}

function updateStatsAndPreview() {
  const data = ensureShipData(state.shipId);
  const brush = PALETTE_ITEMS.find((p) => p.id === activePaletteId());
  const keys = state.vfxKeys || {};
  const keyState = ['W', 'A', 'S', 'D', 'Q', 'E', 'Shift']
    .filter((key) => {
      if (key === 'Shift') return !!(keys.ShiftLeft || keys.ShiftRight);
      return !!keys[`Key${key}`];
    }).join(' ') || '-';
  const mouseLabel = state.mouseLocal ? `${round2(state.mouseLocal.x)}, ${round2(state.mouseLocal.y)}` : '-';
  runtime.controls.stats.innerHTML = `
    <div><strong>${state.shipId}</strong></div>
    <div>Pędzel: ${brush ? brush.label : '-'}</div>
    <div>Hardpointy: ${data.hardpoints.length}</div>
    <div>Rdzenie: ${data.cores.length}</div>
    <div>Silniki MAIN: ${data.engines.main.length}</div>
    <div>Silniki SIDE: ${data.engines.side.length}</div>
    <div>Canvas: ${Math.round(runtime.cssW)} x ${Math.round(runtime.cssH)}</div>
    <div>Mysz local: ${mouseLabel}</div>
    <div>VFX test: ${(state.vfxTestEnabled || state.tool === 'engine_main' || state.tool === 'engine_side') ? 'ON' : 'OFF'} (${keyState})</div>
  `;
  runtime.controls.preview.value = JSON.stringify(buildExportData(), null, 2);
}

function scheduleDraw() {
  state.needsDraw = true;
  if (runtime.raf) return;
  runtime.raf = requestAnimationFrame(() => {
    runtime.raf = 0;
    if (state.needsDraw) draw();
  });
}

function persist() {
  const payload = {
    shipId: state.shipId,
    tool: state.tool,
    hardpointType: state.hardpointType,
    engineDeg: state.engineDeg,
    engineOffsetX: state.engineOffsetX,
    engineOffsetY: state.engineOffsetY,
    mirrorLR: state.mirrorLR,
    mirrorUD: state.mirrorUD,
    snap: state.snap,
    gridSize: state.gridSize,
    showDiag: state.showDiag,
    zoom: state.zoom,
    vfxTestEnabled: state.vfxTestEnabled,
    ships: state.ships
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn('Edytor: Nie udalo sie zapisac do localStorage', e);
  }
}

function loadStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return;
    state.shipId = data.shipId || state.shipId;
    state.tool = data.tool || state.tool;
    state.hardpointType = data.hardpointType || state.hardpointType;
    state.engineDeg = Number.isFinite(data.engineDeg) ? data.engineDeg : state.engineDeg;
    state.engineOffsetX = Number.isFinite(data.engineOffsetX) ? data.engineOffsetX : state.engineOffsetX;
    state.engineOffsetY = Number.isFinite(data.engineOffsetY) ? data.engineOffsetY : state.engineOffsetY;
    state.mirrorLR = !!data.mirrorLR;
    state.mirrorUD = !!data.mirrorUD;
    state.snap = data.snap !== false;
    state.gridSize = Number.isFinite(data.gridSize) ? data.gridSize : state.gridSize;
    state.showDiag = data.showDiag !== false;
    state.zoom = Number.isFinite(data.zoom) ? data.zoom : state.zoom;
    state.vfxTestEnabled = !!data.vfxTestEnabled;
    state.ships = data.ships && typeof data.ships === 'object' ? data.ships : {};
    if (!['erase', 'hardpoint', 'core', 'engine_main', 'engine_side'].includes(state.tool)) state.tool = 'hardpoint';
    if (!HARDPOINT_TYPES.includes(state.hardpointType)) state.hardpointType = 'main';
  } catch {}
}

function syncControlsFromState() {
  const c = runtime.controls;
  c.ship.value = state.shipId;
  c.engineDeg.value = String(state.engineDeg);
  c.engineOffX.value = String(state.engineOffsetX);
  c.engineOffY.value = String(state.engineOffsetY);
  c.grid.value = String(state.gridSize);
  c.snap.checked = !!state.snap;
  c.mirrorLR.checked = !!state.mirrorLR;
  c.mirrorUD.checked = !!state.mirrorUD;
  c.diag.checked = !!state.showDiag;
  c.zoom.value = String(state.zoom);
  c.vfxTest.checked = !!state.vfxTestEnabled;
  buildPaletteUI();
}

export function openHardpointEditor() {
  createRoot();
  const wasPaused = isGamePausedSafe();
  state.pausedByEditor = false;
  if (wasPaused === false) {
    state.pausedByEditor = setGamePausedSafe(true);
  }
  state.visible = true;
  runtime.root.classList.add('open');
  ensureShipData(state.shipId);
  ensureSprite(state.shipId).finally(() => scheduleDraw());
  syncControlsFromState();
  resizeCanvas();
  requestAnimationFrame(() => {
    resizeCanvas();
    scheduleDraw();
  });
  setTimeout(() => {
    if (!state.visible) return;
    resizeCanvas();
    scheduleDraw();
  }, 120);
  refreshVfxLoop();
  scheduleDraw();
}

export function closeHardpointEditor() {
  if (!runtime.root) return;
  state.visible = false;
  runtime.root.classList.remove('open');
  state.vfxKeys = {};
  state.mouseLocal = null;
  clearVfxOverride();
  refreshVfxLoop();
  if (runtime.controls.cursorBadge) {
    runtime.controls.cursorBadge.style.display = 'none';
  }
  if (state.pausedByEditor) {
    setGamePausedSafe(false);
    state.pausedByEditor = false;
  }
  if (typeof window !== 'undefined' && typeof window.__onHardpointEditorClosed === 'function') {
    const callback = window.__onHardpointEditorClosed;
    window.__onHardpointEditorClosed = null;
    try { callback(); } catch {}
  }
}

export function toggleHardpointEditor() {
  if (!runtime.root || !state.visible) openHardpointEditor();
  else closeHardpointEditor();
}
