// Panel strojenia kamery statku (src/game/cameraRig.js): F12 → „Kamera panel”.
// Suwaki piszą wprost we wspólne `cameraRigTune`, które render() czyta co klatkę.
// Zapis w localStorage tylko z ?dev w URL — jak bloom: bez tego eksperymenty
// suwakami po cichu nadpisywałyby CAMERA_RIG_DEFAULTS na zawsze.

import {
  CAMERA_RIG_DEFAULTS,
  CAMERA_RIG_RANGES,
  cameraRigTune,
  createCameraRigTune
} from '../game/cameraRig.js';

const PANEL_ID = 'camera-rig-panel';
const STYLE_ID = 'camera-rig-panel-style';
const STORAGE_KEY = 'devCameraRig';

const SECTIONS = Object.freeze([
  {
    title: 'Nawigacja',
    controls: [
      { key: 'navLook', label: 'Kursor', step: 0.01 },
      { key: 'navLead', label: 'Wyprzedzenie', step: 0.01 },
      { key: 'leadSpeedRef', label: 'Wyprz. od v (×v_max)', step: 0.01 },
      { key: 'navOmega', label: 'Sprężyna ω', step: 0.1 }
    ]
  },
  {
    title: 'Walka',
    controls: [
      { key: 'combatLook', label: 'Kursor', step: 0.01 },
      { key: 'combatLead', label: 'Wyprzedzenie', step: 0.01 },
      { key: 'combatOmega', label: 'Sprężyna ω', step: 0.1 }
    ]
  },
  {
    title: 'Kursor i kadr',
    controls: [
      { key: 'lookDeadZone', label: 'Martwa strefa', step: 0.01 },
      { key: 'lookExponent', label: 'Krzywa', step: 0.05 },
      { key: 'frameMargin', label: 'Margines kadru', step: 0.01 }
    ]
  },
  {
    title: 'Przełączanie postaw',
    controls: [
      { key: 'combatHold', label: 'Trzymanie (s)', step: 0.5 },
      { key: 'combatEnterTime', label: 'Wejście (s)', step: 0.05 },
      { key: 'combatExitTime', label: 'Wyjście (s)', step: 0.05 },
      { key: 'hostileRangeScale', label: 'Zasięg wroga ×', step: 0.05 }
    ]
  },
  {
    title: 'Wstrząs',
    controls: [
      { key: 'shakeScale', label: 'Wstrząs ×', step: 0.05 },
      { key: 'weaponShakeScale', label: 'Strzały ×', step: 0.01 },
      { key: 'shakeMaxPx', label: 'Sufit (px)', step: 1 },
      { key: 'shakeHz', label: 'Częstotliwość', step: 0.5 }
    ]
  },
  {
    title: 'Zoom startowy',
    controls: [
      { key: 'hullScreenFraction', label: 'Kadłub / ekran', step: 0.01 }
    ]
  },
  {
    // Demo „Nurt” (dema/warp-webgpu/scenes.js); opcja gracza: menu → Sterowanie → Kop kamery przy warpie.
    title: 'Kop warpa',
    controls: [
      { key: 'warpKickPx', label: 'Kop skoku (px)', step: 1 },
      { key: 'warpZoomOut', label: 'Zoom w skoku ×', step: 0.01 },
      { key: 'warpZoomKick', label: 'Impuls skoku', step: 0.01 },
      { key: 'warpZoomExit', label: 'Impuls wyjścia', step: 0.01 },
      { key: 'warpZoomReturn', label: 'Powrót (s)', step: 0.05 },
      { key: 'warpChargeShakePx', label: 'Drżenie ład. (px)', step: 0.5 }
    ]
  }
]);

function isDevPersistEnabled() {
  try {
    return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('dev');
  } catch {
    return false;
  }
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function save() {
  if (!isDevPersistEnabled()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot()));
  } catch {
    // ignore localStorage errors
  }
}

function snapshot() {
  const out = {};
  for (const key of Object.keys(CAMERA_RIG_DEFAULTS)) out[key] = cameraRigTune[key];
  return out;
}

function applyValues(values) {
  Object.assign(cameraRigTune, createCameraRigTune(values));
}

function formatValue(value, step) {
  const digits = step >= 1 ? 0 : (step >= 0.1 ? 1 : 2);
  return Number(value).toFixed(digits);
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
#${PANEL_ID}{
  position:fixed; right:16px; top:16px; width:380px; max-height:calc(100vh - 32px); overflow:auto;
  z-index:1200; background:rgba(9,13,24,.95); border:1px solid #263659; border-radius:12px;
  box-shadow:0 12px 32px rgba(0,0,0,.45); color:#e4ecff; display:none;
  font:12px/1.35 Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;
}
#${PANEL_ID} .head{
  padding:10px 12px; border-bottom:1px solid #22304f; font-weight:700; letter-spacing:.04em;
  text-transform:uppercase; color:#9fc1ff;
}
#${PANEL_ID} .body{ padding:10px 12px 12px; }
#${PANEL_ID} .live{
  padding:8px 10px; border:1px solid #22304f; border-radius:8px; background:#081224;
  color:#b8cbf2; font-variant-numeric:tabular-nums; white-space:pre-line;
}
#${PANEL_ID} .section{
  margin:10px 0 4px; padding-top:8px; border-top:1px solid rgba(60,85,134,.45);
  font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:#8fb3ff;
}
#${PANEL_ID} .row{
  display:grid; grid-template-columns:110px 1fr 70px; gap:8px; align-items:center; margin:6px 0;
}
#${PANEL_ID} input[type=range]{ width:100%; }
#${PANEL_ID} input[type=number]{
  width:100%; background:#081224; color:#e4ecff; border:1px solid #304776;
  border-radius:6px; padding:3px 6px; text-align:right;
}
#${PANEL_ID} .buttons{ display:flex; gap:8px; margin-top:10px; }
#${PANEL_ID} button{
  flex:1; padding:6px 10px; background:#112243; color:#e4ecff; border:1px solid #375486;
  border-radius:8px; cursor:pointer;
}
#${PANEL_ID} button:hover{ background:#19305b; }
#${PANEL_ID} .hint{ margin-top:8px; color:#8fa3cd; }
`;
  document.head.appendChild(style);
}

function buildControls(root) {
  root.innerHTML = '';
  for (const section of SECTIONS) {
    const head = document.createElement('div');
    head.className = 'section';
    head.textContent = section.title;
    root.appendChild(head);
    for (const control of section.controls) {
      const [min, max] = CAMERA_RIG_RANGES[control.key];
      const row = document.createElement('div');
      row.className = 'row';
      const label = document.createElement('label');
      label.textContent = control.label;
      label.title = control.key;
      const range = document.createElement('input');
      range.type = 'range';
      const number = document.createElement('input');
      number.type = 'number';
      for (const input of [range, number]) {
        input.min = String(min);
        input.max = String(max);
        input.step = String(control.step);
      }
      const apply = (raw) => {
        applyValues({ ...snapshot(), [control.key]: raw });
        const value = cameraRigTune[control.key];
        range.value = String(value);
        number.value = formatValue(value, control.step);
        save();
      };
      range.addEventListener('input', () => apply(range.value));
      number.addEventListener('change', () => apply(number.value));
      range.value = String(cameraRigTune[control.key]);
      number.value = formatValue(cameraRigTune[control.key], control.step);
      row.append(label, range, number);
      root.appendChild(row);
    }
  }
}

function describeLive() {
  const rig = window.CameraRig?.rig;
  if (!rig) return 'Kamera: gra jeszcze nie wystartowała.';
  const mode = window.OPTIONS?.cameraLook || 'auto';
  const combatPct = Math.round((Number(rig.combat) || 0) * 100);
  const hold = Math.max(0, Number(rig.combatHoldLeft) || 0);
  const reason = hold > 0 ? (rig.combatReason || '—') : '—';
  const kick = window.OPTIONS?.cameraWarpKick === 'off' ? 'wył.' : 'wł.';
  const warpZoom = Math.exp(Number(rig.warpZoomLog) || 0);
  return [
    `Opcja: ${mode} · walka ${combatPct}%`,
    `Trzymanie: ${hold.toFixed(1)} s · powód: ${reason}`,
    `Offset: ${Math.round(rig.offsetX)}, ${Math.round(rig.offsetY)} px (cel ${Math.round(rig.targetX)}, ${Math.round(rig.targetY)})`,
    `Kop warpa (${kick}): zoom ×${warpZoom.toFixed(3)} · cofnięcie ${Math.round(Number(rig.warpLagPx) || 0)} px`
  ].join('\n');
}

function createPanel() {
  const existing = document.getElementById(PANEL_ID);
  if (existing) return existing;
  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.innerHTML = `
    <div class="head">Kamera statku</div>
    <div class="body">
      <div class="live"></div>
      <div class="controls"></div>
      <div class="buttons">
        <button type="button" data-action="copy">Copy JSON</button>
        <button type="button" data-action="reset">Reset</button>
        <button type="button" data-action="clear">Wyczyść zapis</button>
      </div>
      <div class="hint">Kursor i wyprzedzenie: ułamek pół ekranu. ω: 1/s (95% drogi po ~4,7/ω s). Zapis w localStorage tylko z ?dev; docelowe wartości wklej do CAMERA_RIG_DEFAULTS w src/game/cameraRig.js (Copy JSON).</div>
    </div>
  `;
  const controls = panel.querySelector('.controls');
  const live = panel.querySelector('.live');
  buildControls(controls);

  panel.querySelector('[data-action="copy"]')?.addEventListener('click', async () => {
    const text = JSON.stringify(snapshot(), null, 2);
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
    console.log(text);
  });
  panel.querySelector('[data-action="reset"]')?.addEventListener('click', () => {
    applyValues(CAMERA_RIG_DEFAULTS);
    save();
    buildControls(controls);
  });
  panel.querySelector('[data-action="clear"]')?.addEventListener('click', () => {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    applyValues(CAMERA_RIG_DEFAULTS);
    buildControls(controls);
  });

  // Podgląd na żywo tylko przy otwartym panelu (4 razy na sekundę wystarczy).
  let liveTimer = 0;
  const tick = () => {
    live.textContent = describeLive();
  };
  panel.__startLive = () => {
    tick();
    if (!liveTimer) liveTimer = setInterval(tick, 250);
  };
  panel.__stopLive = () => {
    if (liveTimer) clearInterval(liveTimer);
    liveTimer = 0;
  };

  document.body.appendChild(panel);
  return panel;
}

export function initCameraTunerPanel() {
  if (isDevPersistEnabled()) {
    const saved = loadSaved();
    if (saved) applyValues({ ...CAMERA_RIG_DEFAULTS, ...saved });
  } else {
    try {
      if (localStorage.getItem(STORAGE_KEY)) {
        console.info('[cameraTuner] Pominięto zapisane strojenie kamery — obowiązuje CAMERA_RIG_DEFAULTS (tryb dev: dodaj ?dev do URL).');
      }
    } catch {
      // ignore localStorage errors
    }
  }
  ensureStyle();
  const panel = createPanel();
  const show = (visible) => {
    panel.style.display = visible ? 'block' : 'none';
    if (visible) panel.__startLive();
    else panel.__stopLive();
  };
  window.__cameraPanel = {
    show: () => { show(true); return window.__cameraPanel; },
    hide: () => { show(false); return window.__cameraPanel; },
    toggle: () => { show(panel.style.display !== 'block'); return window.__cameraPanel; },
    get: () => snapshot(),
    set: (values = {}) => {
      applyValues({ ...snapshot(), ...values });
      save();
      buildControls(panel.querySelector('.controls'));
      return window.__cameraPanel;
    }
  };
  return window.__cameraPanel;
}
