import { DESTRUCTOR_CONFIG } from '../game/destructor.js';

const PANEL_ID = 'destructor-config-panel';
const STYLE_ID = 'destructor-config-panel-style';
const STORAGE_KEY = 'devDestructorConfig';

const CONTROL_SECTIONS = [
  {
    title: 'Deform',
    controls: [
      { key: 'tearThreshold', label: 'tear threshold', min: 20, max: 600, step: 1 },
      { key: 'yieldPoint', label: 'yield point', min: 10, max: 400, step: 1 },
      { key: 'maxDeform', label: 'max deform', min: 40, max: 800, step: 1 },
      { key: 'deformMul', label: 'impact deform mul', min: 0.1, max: 2.5, step: 0.01 },
      { key: 'bendingRadius', label: 'bending radius', min: 4, max: 120, step: 1 },
      { key: 'collisionDeformScale', label: 'collision deform', min: 0.2, max: 2.0, step: 0.01 },
      { key: 'armorThreshold', label: 'armor threshold', min: 0.05, max: 4.0, step: 0.01 },
      { key: 'inflictedDamageMult', label: 'damage multiplier', min: 0.05, max: 4.0, step: 0.01 }
    ]
  },
  {
    title: 'Soft Body',
    controls: [
      { key: 'softBodyTension', label: 'soft body tension', min: 0.01, max: 0.8, step: 0.005 },
      { key: 'gpuPropagationDamping', label: 'gpu damping', min: 0.7, max: 0.999, step: 0.001 },
      { key: 'recoverSpeed', label: 'recover speed', min: 0, max: 8.0, step: 0.05 },
      { key: 'repairRate', label: 'repair rate', min: 0, max: 800, step: 5 },
      { key: 'visualLerpSpeed', label: 'visual lerp', min: 0.1, max: 40, step: 0.1 },
      { key: 'friction', label: 'shard friction', min: 0.7, max: 1.0, step: 0.001 }
    ]
  },
  {
    title: 'Collision',
    controls: [
      { key: 'collisionIterations', label: 'iterations', min: 1, max: 6, step: 1, integer: true },
      { key: 'collisionSearchRadius', label: 'search radius', min: 2, max: 12, step: 1, integer: true },
      { key: 'restitution', label: 'restitution', min: 0, max: 0.4, step: 0.01 },
      { key: 'crushImpulseScale', label: 'crush impulse', min: 0.05, max: 1.5, step: 0.01 },
      { key: 'crushPenetrationMin', label: 'crush penetration', min: 0.05, max: 1.0, step: 0.01 },
      { key: 'shearK', label: 'shear k', min: 0, max: 0.25, step: 0.005 },
      { key: 'crashApproachSpeedThreshold', label: 'crash speed', min: 20, max: 400, step: 1 }
    ]
  },
  {
    title: 'Sleep / Wake',
    controls: [
      { key: 'elasticSleepFrames', label: 'sleep frames', min: 1, max: 120, step: 1, integer: true },
      { key: 'elasticSleepThreshold', label: 'sleep threshold', min: 0.0001, max: 2.0, step: 0.001 },
      { key: 'elasticWakeFrames', label: 'wake frames', min: 1, max: 120, step: 1, integer: true }
    ]
  },
  {
    title: 'Broadphase',
    controls: [
      { key: 'broadphaseCellSize', label: 'cell size', min: 200, max: 5000, step: 50, integer: true },
      { key: 'broadphaseMaxCandidates', label: 'max candidates', min: 16, max: 512, step: 8, integer: true },
      { key: 'ringBroadphaseRadiusCap', label: 'ring radius cap', min: 200, max: 5000, step: 50, integer: true }
    ]
  },
  {
    title: 'Split',
    controls: [
      { key: 'splitForceThreshold', label: 'force threshold', min: 10, max: 300, step: 1 },
      { key: 'splitDamageThreshold', label: 'damage threshold', min: 20, max: 600, step: 1 },
      { key: 'splitCheckInterval', label: 'check interval', min: 1, max: 60, step: 1, integer: true },
      { key: 'splitMaxPerTick', label: 'max per tick', min: 1, max: 12, step: 1, integer: true },
      { key: 'splitTimeBudgetMs', label: 'time budget ms', min: 0.1, max: 10.0, step: 0.1 }
    ]
  },
  {
    title: 'GPU / Shards',
    controls: [
      { key: 'gpuSoftBody', label: 'gpu soft body', min: 0, max: 1, step: 1, integer: true },
      { key: 'gpuSoftBodyMinShards', label: 'gpu min shards', min: 1, max: 512, step: 1, integer: true },
      { key: 'shardHP', label: 'shard hp', min: 1, max: 500, step: 1 },
      { key: 'shardMass', label: 'shard mass', min: 0.1, max: 100, step: 0.1 }
    ]
  },
  {
    title: 'Shield',
    controls: [
      { key: 'shieldRestitution', label: 'shield restitution', min: 0, max: 1.0, step: 0.01 },
      { key: 'shieldCollisionDamageScale', label: 'collision damage', min: 0, max: 2.0, step: 0.01 },
      { key: 'shieldSeparationPercent', label: 'separation percent', min: 0, max: 1.0, step: 0.01 },
      { key: 'shieldSeparationSlop', label: 'separation slop', min: 0, max: 10.0, step: 0.1 },
      { key: 'shieldCollisionCooldown', label: 'collision cooldown', min: 0, max: 1.0, step: 0.01 },
      { key: 'shieldActivationDamageMult', label: 'activation damage', min: 0, max: 1.0, step: 0.01 },
      { key: 'shieldCapitalDominanceRatio', label: 'capital dominance', min: 1.0, max: 8.0, step: 0.05 },
      { key: 'shieldCapitalDominanceHeavyDamageMult', label: 'dominance heavy dmg', min: 0.01, max: 1.0, step: 0.01 },
      { key: 'shieldAuthorityShieldMaxExp', label: 'authority shield exp', min: 0, max: 2.0, step: 0.01 },
      { key: 'shieldAuthorityMassExp', label: 'authority mass exp', min: 0, max: 2.0, step: 0.01 }
    ]
  }
];

const CONTROLS = CONTROL_SECTIONS.flatMap((section) => section.controls);

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

function clearSavedState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
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
#${PANEL_ID} .section{
  margin-top:12px; padding-top:10px; border-top:1px solid rgba(52,71,112,.55);
}
#${PANEL_ID} .section:first-child{
  margin-top:0; padding-top:0; border-top:none;
}
#${PANEL_ID} .section-title{
  margin:0 0 8px 0; color:#9fc1ff; font-weight:700; letter-spacing:.06em; text-transform:uppercase;
  font-size:11px;
}
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
  for (const section of CONTROL_SECTIONS) {
    const sectionEl = document.createElement('div');
    sectionEl.className = 'section';
    const titleEl = document.createElement('div');
    titleEl.className = 'section-title';
    titleEl.textContent = section.title;
    sectionEl.appendChild(titleEl);
    for (const control of section.controls) createControlRow(sectionEl, control);
    root.appendChild(sectionEl);
  }
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
        <button type="button" data-action="code-defaults">Reset to code defaults</button>
        <button type="button" data-action="clear-saved">Clear saved</button>
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

  panel.querySelector('button[data-action="code-defaults"]')?.addEventListener('click', () => {
    for (const control of CONTROLS) {
      DESTRUCTOR_CONFIG[control.key] = DEFAULTS[control.key];
    }
    saveState();
    rebuildControls(controlsRoot);
  });

  panel.querySelector('button[data-action="clear-saved"]')?.addEventListener('click', () => {
    clearSavedState();
    for (const control of CONTROLS) {
      DESTRUCTOR_CONFIG[control.key] = DEFAULTS[control.key];
    }
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
    },
    clearSaved: () => {
      clearSavedState();
      for (const control of CONTROLS) {
        DESTRUCTOR_CONFIG[control.key] = DEFAULTS[control.key];
      }
      const controlsRoot = panel?.querySelector('.controls');
      if (controlsRoot) rebuildControls(controlsRoot);
      return window.__destructorPanel;
    }
  };
}
