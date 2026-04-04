import { SUPPORT_SHIP_TEMPLATES, CAPITAL_SHIP_TEMPLATES } from '../data/ships.js';

const PANEL_ID = 'destructor-mass-panel';
const STYLE_ID = 'destructor-mass-panel-style';
const STORAGE_KEY = 'devDestructorMassConfig';
const MASS_APPLY_TAG = '__destructorMassStamp';

const CONTROLS = [
  { key: 'playerMass', label: 'Masa gracza', min: 10, max: 20000000, step: 1000 },
  { key: 'npcBattleshipMass', label: 'NPC battleship', min: 10, max: 20000000, step: 1000 },
  { key: 'npcDestroyerMass', label: 'NPC destroyer', min: 10, max: 20000000, step: 1000 },
  { key: 'npcCapitalMass', label: 'NPC capital', min: 10, max: 20000000, step: 1000 },
  { key: 'ringMass', label: 'Ring planetarny', min: 10, max: 50000000, step: 1000 }
];

const SHIP_DEFAULTS = {
  playerMass: Math.round(Number(CAPITAL_SHIP_TEMPLATES?.supercapital?.mass) || 200000),
  npcBattleshipMass: Math.round(Number(SUPPORT_SHIP_TEMPLATES?.battleship?.stats?.mass) || 50000),
  npcDestroyerMass: Math.round(Number(SUPPORT_SHIP_TEMPLATES?.destroyer?.stats?.mass) || 25000),
  npcCapitalMass: Math.round(Number(CAPITAL_SHIP_TEMPLATES?.carrier?.mass) || 100000),
  ringMass: 2500000
};

let defaults = { ...SHIP_DEFAULTS };
let state = { ...SHIP_DEFAULTS, version: 1 };
let autoApplyTimer = null;

function toNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sanitizeMass(raw, control) {
  let next = toNumber(raw, state[control.key]);
  next = clamp(next, control.min, control.max);
  return Math.round(next);
}

function readCurrentState() {
  const out = {};
  for (const control of CONTROLS) out[control.key] = state[control.key];
  return out;
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(readCurrentState()));
  } catch {
    // ignore
  }
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

function getRingEntities() {
  const fn = window.__planetaryRingsDebug?.entities;
  if (typeof fn !== 'function') return [];
  const list = fn();
  return Array.isArray(list) ? list : [];
}

function classifyNpcMassKey(npc) {
  if (!npc || npc.dead || npc.isPlayer) return null;
  const type = String(npc.type || '').toLowerCase();
  if (type === 'destroyer') return 'npcDestroyerMass';
  if (type === 'battleship' || type === 'pirate_battleship') return 'npcBattleshipMass';
  const isCapital = type.includes('capital') || type.includes('carrier') || type === 'carrier' || npc.isCapitalShip === true;
  return isCapital ? 'npcCapitalMass' : null;
}

function pickNpcMassByKey(key) {
  const list = Array.isArray(window.npcs) ? window.npcs : [];
  for (const npc of list) {
    if (classifyNpcMassKey(npc) !== key) continue;
    const mass = Number(npc.mass);
    if (Number.isFinite(mass) && mass > 0) return mass;
  }
  return null;
}

function resolveDefaultsFromRuntime() {
  const next = { ...SHIP_DEFAULTS };

  const ringMass = Number(getRingEntities().find(e => e && e.isRingSegment && !e.dead)?.mass);
  if (Number.isFinite(ringMass) && ringMass > 0) next.ringMass = Math.round(ringMass);

  return next;
}

function syncGlobal() {
  window.DESTRUCTOR_MASS_CONFIG = readCurrentState();
}

function applyMassToEntity(entity, mass, stamp, opts = {}) {
  if (!entity || entity.dead) return false;
  if (entity[MASS_APPLY_TAG] === stamp) return false;

  const nextMass = Math.max(1, Number(mass) || 1);
  entity.mass = nextMass;

  if (opts.updateRamming || Number.isFinite(entity.rammingMass)) entity.rammingMass = nextMass;

  if (opts.updateInertia && Number.isFinite(entity.w) && Number.isFinite(entity.h)) {
    entity.inertia = (1 / 12) * nextMass * ((entity.w * entity.w) + (entity.h * entity.h));
  }

  entity[MASS_APPLY_TAG] = stamp;
  return true;
}

function applyMassOverridesNow() {
  const cfg = readCurrentState();
  const version = state.version;
  const summary = { player: 0, npc: 0, ring: 0 };

  const player = window.ship;
  if (player) {
    if (applyMassToEntity(player, cfg.playerMass, `v${version}:player`, { updateRamming: true, updateInertia: true })) {
      summary.player++;
    }
  }

  const npcs = Array.isArray(window.npcs) ? window.npcs : [];
  for (const npc of npcs) {
    const key = classifyNpcMassKey(npc);
    if (!key) continue;
    if (applyMassToEntity(npc, cfg[key], `v${version}:${key}`)) summary.npc++;
  }

  const ringEntities = getRingEntities();
  for (const seg of ringEntities) {
    if (!seg?.isRingSegment) continue;
    if (applyMassToEntity(seg, cfg.ringMass, `v${version}:ring`)) summary.ring++;
  }

  syncGlobal();
  return summary;
}

function ensureAutoApplyLoop() {
  if (autoApplyTimer != null) return;
  autoApplyTimer = window.setInterval(() => {
    applyMassOverridesNow();
  }, 1000);
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
#${PANEL_ID}{
  position:fixed; right:390px; top:16px; width:340px; max-height:86vh; overflow:auto; z-index:1202;
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
  display:grid; grid-template-columns:140px 1fr; gap:8px; align-items:center; margin:8px 0;
}
#${PANEL_ID} .row label{ opacity:.95; white-space:nowrap; }
#${PANEL_ID} input[type=number]{
  width:100%; background:#081224; color:#e4ecff; border:1px solid #304776;
  border-radius:6px; padding:4px 6px; text-align:right;
}
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
    <input type="number" min="${control.min}" max="${control.max}" step="${control.step}">
  `;

  const input = row.querySelector('input');

  const apply = (raw, opts = {}) => {
    const next = sanitizeMass(raw, control);
    const prev = state[control.key];
    state[control.key] = next;
    input.value = String(next);
    if (opts.silent) return;
    if (next === prev) return;
    state.version++;
    saveState();
    applyMassOverridesNow();
  };

  input.addEventListener('input', () => apply(input.value));
  apply(state[control.key], { silent: true });
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
    <div class="head">Destructor Masy</div>
    <div class="body">
      <div class="controls"></div>
      <div class="buttons">
        <button type="button" data-action="apply">Apply</button>
        <button type="button" data-action="copy">Copy JSON</button>
        <button type="button" data-action="reset">Reset</button>
      </div>
      <div class="hint">Panel sterowany z DevTools (F10)</div>
    </div>
  `;

  const controlsRoot = panel.querySelector('.controls');
  rebuildControls(controlsRoot);

  panel.querySelector('button[data-action="apply"]')?.addEventListener('click', () => {
    applyMassOverridesNow();
  });

  panel.querySelector('button[data-action="copy"]')?.addEventListener('click', async () => {
    const payload = { destructorMass: readCurrentState() };
    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
    console.log(text);
  });

  panel.querySelector('button[data-action="reset"]')?.addEventListener('click', () => {
    state = { ...defaults, version: state.version + 1 };
    saveState();
    rebuildControls(controlsRoot);
    applyMassOverridesNow();
  });

  document.body.appendChild(panel);
  return panel;
}

function applySavedState() {
  const saved = loadSavedState();
  if (!saved) return;
  for (const control of CONTROLS) {
    if (saved[control.key] == null) continue;
    state[control.key] = sanitizeMass(saved[control.key], control);
  }
}

export function initDestructorMassPanel() {
  if (typeof window === 'undefined') return;

  defaults = resolveDefaultsFromRuntime();
  state = { ...defaults, version: 1 };
  applySavedState();

  ensureStyle();
  const panel = createPanel();
  syncGlobal();

  // Apply immediately, then keep scanning for newly spawned entities.
  state.version++;
  applyMassOverridesNow();
  ensureAutoApplyLoop();

  const api = {
    show: () => {
      if (panel) panel.style.display = 'block';
      return api;
    },
    hide: () => {
      if (panel) panel.style.display = 'none';
      return api;
    },
    toggle: () => {
      if (panel) {
        const hidden = panel.style.display === 'none' || panel.style.display === '';
        panel.style.display = hidden ? 'block' : 'none';
      }
      return api;
    },
    get: () => readCurrentState(),
    set: (next = {}) => {
      if (!next || typeof next !== 'object') return api;
      let changed = false;
      for (const control of CONTROLS) {
        if (next[control.key] == null) continue;
        const prev = state[control.key];
        const val = sanitizeMass(next[control.key], control);
        if (val !== prev) changed = true;
        state[control.key] = val;
      }
      if (changed) state.version++;
      saveState();
      const controlsRoot = panel?.querySelector('.controls');
      if (controlsRoot) rebuildControls(controlsRoot);
      if (changed) applyMassOverridesNow();
      return api;
    },
    reset: () => {
      state = { ...defaults, version: state.version + 1 };
      saveState();
      const controlsRoot = panel?.querySelector('.controls');
      if (controlsRoot) rebuildControls(controlsRoot);
      applyMassOverridesNow();
      return api;
    },
    apply: () => {
      applyMassOverridesNow();
      return api;
    }
  };

  window.__destructorMassPanel = api;
}
