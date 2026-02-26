import { DESTRUCTOR_CONFIG } from '../game/destructor.js';

const PANEL_ID = 'destructor-config-panel';
const STYLE_ID = 'destructor-config-panel-style';
const STORAGE_KEY = 'devDestructorConfig';

const CONTROLS = [
  { key: 'tearThreshold', label: 'teargpu px', min: 20, max: 600, step: 1 },
  { key: 'gpuPropagationDamping', label: 'tlumienie propagacji', min: 0.7, max: 0.999, step: 0.001 },
  { key: 'softBodyTension', label: 'propagacja k', min: 0.01, max: 0.8, step: 0.005 },
  { key: 'yieldPoint', label: 'yield px', min: 10, max: 400, step: 1 },
  { key: 'maxDeform', label: 'max deform px', min: 40, max: 800, step: 1 },
  { key: 'deformMul', label: 'impact deform mul', min: 0.1, max: 2.5, step: 0.01 },
  { key: 'collisionDeformScale', label: 'collision deform scale', min: 0.2, max: 2.0, step: 0.01 },
  { key: 'crushImpulseScale', label: 'crush impulse', min: 0.05, max: 1.5, step: 0.01 },
  { key: 'crashApproachSpeedThreshold', label: 'crash speed px/s', min: 20, max: 400, step: 1 }
];

const DEFAULTS = Object.freeze(
  CONTROLS.reduce((acc, control) => {
    acc[control.key] = DESTRUCTOR_CONFIG[control.key];
    return acc;
  }, {})
);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function formatValue(value, step) {
  if (!Number.isFinite(value)) return '-';
  if (!Number.isFinite(step) || step >= 1) return String(Math.round(value));
  const decimals = Math.max(0, Math.min(4, String(step).split('.')[1]?.length || 0));
  return value.toFixed(decimals);
}

function ensureGlobal() {
  if (typeof window === 'undefined') return;
  window.DESTRUCTOR_CONFIG = DESTRUCTOR_CONFIG;
}

function readCurrentState() {
  return CONTROLS.reduce((acc, control) => {
    acc[control.key] = DESTRUCTOR_CONFIG[control.key];
    return acc;
  }, {});
}

function loadSavedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(readCurrentState()));
  } catch {
    // ignore
  }
}

function applyControlValue(control, nextRaw) {
  let next = clamp(toNumber(nextRaw, DESTRUCTOR_CONFIG[control.key]), control.min, control.max);
  if (control.integer) next = Math.round(next);
  DESTRUCTOR_CONFIG[control.key] = next;
  return next;
}

function applySavedState() {
  const saved = loadSavedState();
  if (!saved) return;
  for (const control of CONTROLS) {
    if (saved[control.key] == null) continue;
    applyControlValue(control, saved[control.key]);
  }
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
#${PANEL_ID}{
  position:fixed; right:390px; top:16px; width:430px; max-height:86vh; overflow:auto; z-index:1201;
  background:rgba(9,13,24,.96); border:1px solid #263659; border-radius:12px;
  box-shadow:0 12px 32px rgba(0,0,0,.45); color:#e4ecff; display:none;
  font:12px/1.35 Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;
}
#${PANEL_ID} .head{
  padding:10px 12px; border-bottom:1px solid #22304f; font-weight:700; letter-spacing:.04em;
  text-transform:uppercase; color:#9fc1ff;
}
#${PANEL_ID} .body{ padding:10px 12px 12px; }
#${PANEL_ID} .row{
  display:grid; grid-template-columns:145px 1fr 82px 64px; gap:8px; align-items:center; margin:8px 0;
}
#${PANEL_ID} .row label{ opacity:.95; white-space:nowrap; }
#${PANEL_ID} input[type=range]{ width:100%; }
#${PANEL_ID} input[type=number]{
  width:100%; background:#081224; color:#e4ecff; border:1px solid #304776;
  border-radius:6px; padding:4px 6px; text-align:right;
}
#${PANEL_ID} .val{ text-align:right; color:#9fb4df; font-variant-numeric:tabular-nums; }
#${PANEL_ID} .buttons{ display:flex; gap:8px; margin-top:10px; }
#${PANEL_ID} button{
  flex:1; padding:6px 10px; background:#112243; color:#e4ecff; border:1px solid #375486;
  border-radius:8px; cursor:pointer;
}
#${PANEL_ID} button:hover{ background:#19305b; }
#${PANEL_ID} .hint{ margin-top:8px; color:#8fa3cd; opacity:.9; }
`;
  document.head.appendChild(style);
}

function createControlRow(parent, control) {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `
    <label>${control.label}</label>
    <input type="range" min="${control.min}" max="${control.max}" step="${control.step}">
    <input type="number" min="${control.min}" max="${control.max}" step="${control.step}">
    <div class="val"></div>
  `;

  const range = row.children[1];
  const number = row.children[2];
  const value = row.children[3];

  const apply = (nextRaw) => {
    const next = applyControlValue(control, nextRaw);
    range.value = String(next);
    number.value = String(next);
    value.textContent = formatValue(next, control.step);
    saveState();
  };

  range.addEventListener('input', () => apply(range.value));
  number.addEventListener('input', () => apply(number.value));
  apply(DESTRUCTOR_CONFIG[control.key]);
  parent.appendChild(row);
}

function rebuildControls(root) {
  root.innerHTML = '';
  for (const control of CONTROLS) createControlRow(root, control);
}

function createPanel() {
  const existing = document.getElementById(PANEL_ID);
  if (existing) return existing;

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.innerHTML = `
    <div class="head">Destructor Config</div>
    <div class="body">
      <div class="controls"></div>
      <div class="buttons">
        <button type="button" data-action="copy">Copy JSON</button>
        <button type="button" data-action="reset">Reset</button>
      </div>
      <div class="hint">Panel sterowany z DevTools</div>
    </div>
  `;

  const controlsRoot = panel.querySelector('.controls');
  rebuildControls(controlsRoot);

  panel.querySelector('button[data-action="copy"]')?.addEventListener('click', async () => {
    const payload = { destructor: readCurrentState() };
    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
    console.log(text);
  });

  panel.querySelector('button[data-action="reset"]')?.addEventListener('click', () => {
    for (const control of CONTROLS) {
      DESTRUCTOR_CONFIG[control.key] = DEFAULTS[control.key];
    }
    saveState();
    rebuildControls(controlsRoot);
  });

  document.body.appendChild(panel);
  return panel;
}

export function initDestructorConfigPanel() {
  ensureGlobal();
  ensureStyle();
  applySavedState();
  const panel = createPanel();

  const togglePanel = () => {
    if (!panel) return;
    const isHidden = panel.style.display === 'none' || panel.style.display === '';
    panel.style.display = isHidden ? 'block' : 'none';
  };

  window.__destructorPanel = {
    show: () => {
      if (panel) panel.style.display = 'block';
      return window.__destructorPanel;
    },
    hide: () => {
      if (panel) panel.style.display = 'none';
      return window.__destructorPanel;
    },
    toggle: () => {
      togglePanel();
      return window.__destructorPanel;
    },
    get: () => readCurrentState(),
    set: (next = {}) => {
      if (!next || typeof next !== 'object') return window.__destructorPanel;
      for (const control of CONTROLS) {
        if (next[control.key] == null) continue;
        applyControlValue(control, next[control.key]);
      }
      saveState();
      const controlsRoot = panel?.querySelector('.controls');
      if (controlsRoot) rebuildControls(controlsRoot);
      return window.__destructorPanel;
    },
    reset: () => {
      for (const control of CONTROLS) {
        DESTRUCTOR_CONFIG[control.key] = DEFAULTS[control.key];
      }
      saveState();
      const controlsRoot = panel?.querySelector('.controls');
      if (controlsRoot) rebuildControls(controlsRoot);
      return window.__destructorPanel;
    }
  };
}

