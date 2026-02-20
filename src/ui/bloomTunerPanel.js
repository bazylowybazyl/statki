const PANEL_ID = 'bloom-f12-panel';
const STYLE_ID = 'bloom-f12-panel-style';
const STORAGE_KEY = 'devBloomPanel';

const BLOOM_DEFAULTS = Object.freeze({
  strength: 0.31,
  radius: 0.18,
  threshold: 0.2,
  resolutionScale: Math.SQRT1_2
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function ensureBloomState() {
  const devVfx = (window.DevVFX = window.DevVFX || {});
  const saved = loadSavedBloom();
  const bloom = (devVfx.bloom = Object.assign({}, BLOOM_DEFAULTS, devVfx.bloom || {}, saved || {}));

  bloom.strength = clamp(toNumber(bloom.strength, BLOOM_DEFAULTS.strength), 0, 5);
  bloom.radius = clamp(toNumber(bloom.radius, BLOOM_DEFAULTS.radius), 0, 2);
  bloom.threshold = clamp(toNumber(bloom.threshold, BLOOM_DEFAULTS.threshold), 0, 2);
  bloom.resolutionScale = clamp(toNumber(bloom.resolutionScale, BLOOM_DEFAULTS.resolutionScale), 0.5, 1.0);
  return bloom;
}

function loadSavedBloom() {
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

function saveBloomState(bloom) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      strength: bloom.strength,
      radius: bloom.radius,
      threshold: bloom.threshold,
      resolutionScale: bloom.resolutionScale
    }));
  } catch {
    // ignore localStorage errors
  }
}

function applyToCore3D(bloom) {
  const core3d = window.Core3D || null;
  if (core3d) {
    const nextScale = clamp(toNumber(bloom.resolutionScale, BLOOM_DEFAULTS.resolutionScale), 0.5, 1.0);
    if (core3d.bloomResolutionScale !== nextScale) {
      core3d.bloomResolutionScale = nextScale;
      if (core3d.isInitialized && typeof core3d.resize === 'function') {
        core3d.resize(core3d.width || window.innerWidth, core3d.height || window.innerHeight);
      }
    }
  }

  const pass = window.Core3D?.bloomPass;
  if (!pass) return;
  pass.strength = bloom.strength;
  pass.radius = bloom.radius;
  pass.threshold = bloom.threshold;
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
#${PANEL_ID}{
  position:fixed; right:16px; top:16px; width:360px; z-index:1200;
  background:rgba(9,13,24,.95); border:1px solid #263659; border-radius:12px;
  box-shadow:0 12px 32px rgba(0,0,0,.45); color:#e4ecff; display:none;
  font:12px/1.35 Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;
}
#${PANEL_ID} .head{
  padding:10px 12px; border-bottom:1px solid #22304f; font-weight:700; letter-spacing:.04em;
  text-transform:uppercase; color:#9fc1ff;
}
#${PANEL_ID} .body{ padding:10px 12px 12px; }
#${PANEL_ID} .row{
  display:grid; grid-template-columns:95px 1fr 78px 56px; gap:8px; align-items:center; margin:8px 0;
}
#${PANEL_ID} .row label{ opacity:.95; }
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

function createControlRow(parent, options) {
  const { label, min, max, step, key, state } = options;
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `
    <label>${label}</label>
    <input type="range" min="${min}" max="${max}" step="${step}">
    <input type="number" min="${min}" max="${max}" step="${step}">
    <div class="val"></div>
  `;
  const range = row.children[1];
  const number = row.children[2];
  const value = row.children[3];

  const apply = (nextRaw) => {
    const next = clamp(toNumber(nextRaw, state[key]), min, max);
    state[key] = next;
    range.value = String(next);
    number.value = String(next);
    value.textContent = Number(next).toFixed(2);
    saveBloomState(state);
    applyToCore3D(state);
  };

  range.addEventListener('input', () => apply(range.value));
  number.addEventListener('input', () => apply(number.value));

  apply(state[key]);
  parent.appendChild(row);
}

function createPanel(state) {
  if (document.getElementById(PANEL_ID)) return document.getElementById(PANEL_ID);

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.innerHTML = `
    <div class="head">Bloom Tuner</div>
    <div class="body">
      <div class="controls"></div>
      <div class="buttons">
        <button type="button" data-action="copy">Copy JSON</button>
        <button type="button" data-action="reset">Reset</button>
      </div>
      <div class="hint">F12 - pokaz/ukryj</div>
    </div>
  `;

  const controls = panel.querySelector('.controls');
  createControlRow(controls, { label: 'Strength', min: 0, max: 5, step: 0.01, key: 'strength', state });
  createControlRow(controls, { label: 'Radius', min: 0, max: 2, step: 0.01, key: 'radius', state });
  createControlRow(controls, { label: 'Threshold', min: 0, max: 2, step: 0.01, key: 'threshold', state });
  createControlRow(controls, { label: 'Resolution', min: 0.5, max: 1.0, step: 0.01, key: 'resolutionScale', state });

  panel.querySelector('button[data-action="copy"]')?.addEventListener('click', async () => {
    const payload = {
      bloom: {
        strength: state.strength,
        radius: state.radius,
        threshold: state.threshold,
        resolutionScale: state.resolutionScale
      }
    };
    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore clipboard errors
    }
    console.log(text);
  });

  panel.querySelector('button[data-action="reset"]')?.addEventListener('click', () => {
    state.strength = BLOOM_DEFAULTS.strength;
    state.radius = BLOOM_DEFAULTS.radius;
    state.threshold = BLOOM_DEFAULTS.threshold;
    state.resolutionScale = BLOOM_DEFAULTS.resolutionScale;
    saveBloomState(state);
    applyToCore3D(state);
    const controlsRoot = panel.querySelector('.controls');
    if (controlsRoot) {
      controlsRoot.innerHTML = '';
      createControlRow(controlsRoot, { label: 'Strength', min: 0, max: 5, step: 0.01, key: 'strength', state });
      createControlRow(controlsRoot, { label: 'Radius', min: 0, max: 2, step: 0.01, key: 'radius', state });
      createControlRow(controlsRoot, { label: 'Threshold', min: 0, max: 2, step: 0.01, key: 'threshold', state });
      createControlRow(controlsRoot, { label: 'Resolution', min: 0.5, max: 1.0, step: 0.01, key: 'resolutionScale', state });
    }
  });

  document.body.appendChild(panel);
  return panel;
}

export function initBloomTunerPanel() {
  ensureStyle();
  const bloomState = ensureBloomState();
  applyToCore3D(bloomState);
  const panel = createPanel(bloomState);

  const togglePanel = () => {
    if (!panel) return;
    const isHidden = panel.style.display === 'none' || panel.style.display === '';
    panel.style.display = isHidden ? 'block' : 'none';
  };

  window.addEventListener('keydown', (event) => {
    if (event.code !== 'F12') return;
    event.preventDefault();
    togglePanel();
  });

  window.__bloomPanel = {
    show: () => {
      if (panel) panel.style.display = 'block';
      return window.__bloomPanel;
    },
    hide: () => {
      if (panel) panel.style.display = 'none';
      return window.__bloomPanel;
    },
    toggle: () => {
      togglePanel();
      return window.__bloomPanel;
    },
    get: () => ({
      strength: bloomState.strength,
      radius: bloomState.radius,
      threshold: bloomState.threshold,
      resolutionScale: bloomState.resolutionScale
    }),
    set: (next = {}) => {
      if (next && typeof next === 'object') {
        if (next.strength != null) bloomState.strength = clamp(toNumber(next.strength, bloomState.strength), 0, 5);
        if (next.radius != null) bloomState.radius = clamp(toNumber(next.radius, bloomState.radius), 0, 2);
        if (next.threshold != null) bloomState.threshold = clamp(toNumber(next.threshold, bloomState.threshold), 0, 2);
        if (next.resolutionScale != null) bloomState.resolutionScale = clamp(toNumber(next.resolutionScale, bloomState.resolutionScale), 0.5, 1.0);
        saveBloomState(bloomState);
        applyToCore3D(bloomState);
      }
      return window.__bloomPanel;
    }
  };
}
