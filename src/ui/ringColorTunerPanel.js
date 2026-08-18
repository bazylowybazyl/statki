import {
    RING_BUILDING_COLOR_KEYS,
    RING_COLOR_DEFAULTS,
    applyRingColorToMaterial,
    applyRingColorsToObject,
    getRingColorConfig,
    normalizeRingColorConfig,
    normalizeRingHexColor,
    resetRingColorConfig,
    setRingColorConfig
} from '../3d/ringColorConfig.js';
import { synthCityAssets } from '../3d/ringCityAssets.js';

const PANEL_ID = 'ring-color-tuner-panel';
const STYLE_ID = 'ring-color-tuner-panel-style';
const STORAGE_KEY = 'devRingColors';

const BUILDING_LABELS = Object.freeze({
    building_01: 'Budynek 01',
    building_02: 'Budynek 02',
    building_03: 'Budynek 03',
    building_04: 'Budynek 04',
    building_05: 'Budynek 05',
    building_06: 'Budynek 06',
    building_07: 'Budynek 07',
    building_08: 'Budynek 08',
    building_09: 'Budynek 09',
    building_10: 'Budynek 10',
    mega_building_01: 'Mega-budynek',
    storefronts: 'Pasaże / sklepy'
});

function isDevPersistEnabled() {
    try {
        return typeof window !== 'undefined'
            && new URLSearchParams(window.location.search).has('dev');
    } catch {
        return false;
    }
}

function loadSavedState() {
    if (!isDevPersistEnabled()) return null;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const patch = parsed?.ringColors || parsed;
        return patch && typeof patch === 'object' ? patch : null;
    } catch {
        return null;
    }
}

function saveState(state) {
    if (!isDevPersistEnabled()) return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // localStorage can be unavailable in hardened/private contexts.
    }
}

function replaceState(target, source) {
    target.dome = { ...source.dome };
    target.buildings = { ...source.buildings };
    return target;
}

function applyState(state) {
    const applied = setRingColorConfig(state);
    replaceState(state, applied);

    // Shared source materials are not guaranteed to be attached to the scene
    // at the moment the user moves a picker (assets can still be loading).
    for (const material of Object.values(synthCityAssets.materials || {})) {
        if (Array.isArray(material)) {
            for (const entry of material) applyRingColorToMaterial(entry);
        } else {
            applyRingColorToMaterial(material);
        }
    }
    applyRingColorsToObject(window.Core3D?.scene || null);
    return state;
}

function exportState(state) {
    return JSON.stringify({ ringColors: normalizeRingColorConfig(state, RING_COLOR_DEFAULTS) }, null, 2);
}

function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
#${PANEL_ID}{
  position:fixed; right:372px; top:16px; width:372px; max-height:calc(100vh - 32px); z-index:1210;
  overflow:auto; display:none; color:#e4ecff; background:rgba(9,13,24,.96);
  border:1px solid #263659; border-radius:12px; box-shadow:0 12px 32px rgba(0,0,0,.48);
  font:12px/1.35 Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;
}
#${PANEL_ID} .head{
  position:sticky; top:0; z-index:1; padding:10px 12px; background:rgba(9,13,24,.98);
  border-bottom:1px solid #22304f; color:#9fc1ff; font-weight:700; letter-spacing:.04em;
  text-transform:uppercase;
}
#${PANEL_ID} .body{padding:10px 12px 12px}
#${PANEL_ID} .section{
  margin:12px 0 6px; padding-top:9px; border-top:1px solid rgba(60,85,134,.45);
  color:#8fb3ff; font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase;
}
#${PANEL_ID} .section:first-child{margin-top:0;padding-top:0;border-top:0}
#${PANEL_ID} .color-row{
  display:grid; grid-template-columns:minmax(112px,1fr) 42px 92px; gap:8px; align-items:center; margin:7px 0;
}
#${PANEL_ID} .color-row label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#${PANEL_ID} input[type=color]{width:42px;height:28px;padding:1px;border:1px solid #375486;border-radius:6px;background:#081224;cursor:pointer}
#${PANEL_ID} input[type=text]{width:100%;box-sizing:border-box;padding:5px 6px;border:1px solid #304776;border-radius:6px;background:#081224;color:#e4ecff;font:12px ui-monospace,SFMono-Regular,Consolas,monospace}
#${PANEL_ID} .buttons{display:flex;gap:7px;margin-top:12px}
#${PANEL_ID} button{flex:1;padding:7px 8px;border:1px solid #375486;border-radius:8px;background:#112243;color:#e4ecff;cursor:pointer}
#${PANEL_ID} button:hover{background:#19305b}
#${PANEL_ID} .hint,#${PANEL_ID} .status{margin-top:8px;color:#8fa3cd}
#${PANEL_ID} .status{min-height:16px;color:#79e6bb}
@media (max-width:820px){#${PANEL_ID}{right:16px;width:min(372px,calc(100vw - 32px))}}
`;
    document.head.appendChild(style);
}

function createColorRow(parent, label, getter, setter) {
    const row = document.createElement('div');
    row.className = 'color-row';
    row.innerHTML = `
      <label></label>
      <input type="color">
      <input type="text" maxlength="7" spellcheck="false">
    `;
    row.children[0].textContent = label;
    const picker = row.children[1];
    const text = row.children[2];

    const sync = (raw, commitInvalid = false) => {
        const previous = getter();
        const isValid = /^#[0-9a-f]{6}$/i.test(String(raw).trim()) || /^#[0-9a-f]{3}$/i.test(String(raw).trim());
        const normalized = normalizeRingHexColor(raw, previous);
        if (isValid) setter(normalized);
        const current = isValid ? normalized : previous;
        picker.value = current;
        if (isValid || commitInvalid) text.value = current;
        return isValid;
    };

    picker.addEventListener('input', () => sync(picker.value, true));
    text.addEventListener('change', () => sync(text.value, true));
    text.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            sync(text.value, true);
            text.blur();
        }
    });
    sync(getter(), true);
    parent.appendChild(row);
}

function createSection(parent, title) {
    const node = document.createElement('div');
    node.className = 'section';
    node.textContent = title;
    parent.appendChild(node);
}

function buildControls(parent, state, onChange) {
    parent.innerHTML = '';
    createSection(parent, 'Bańka ochronna Ring City');
    createColorRow(parent, 'Powłoka', () => state.dome.shell, value => {
        state.dome.shell = value;
        onChange();
    });
    createColorRow(parent, 'Żebra / obrys', () => state.dome.frame, value => {
        state.dome.frame = value;
        onChange();
    });

    createSection(parent, 'Paleta budynków (światła / okna)');
    for (const key of RING_BUILDING_COLOR_KEYS) {
        createColorRow(parent, BUILDING_LABELS[key] || key, () => state.buildings[key], value => {
            state.buildings[key] = value;
            onChange();
        });
    }
}

function createPanel(state) {
    const existing = document.getElementById(PANEL_ID);
    if (existing) return existing;
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="head">Ring Colors — live</div>
      <div class="body">
        <div class="controls"></div>
        <div class="buttons">
          <button type="button" data-action="copy">Kopiuj JSON</button>
          <button type="button" data-action="reset">Reset</button>
          <button type="button" data-action="clear">Wyczyść zapis</button>
        </div>
        <div class="status" aria-live="polite"></div>
        <div class="hint"><code>F8</code> pokazuje/ukrywa tuner. Zmiany są natychmiastowe. Z <code>?dev</code> zostają w localStorage. Eksport możesz wkleić do zadania, a kolory przeniosę do <code>ringColorConfig.js</code>.</div>
      </div>
    `;
    document.body.appendChild(panel);

    const controls = panel.querySelector('.controls');
    const status = panel.querySelector('.status');
    const renderControls = () => buildControls(controls, state, () => {
        applyState(state);
        saveState(state);
        if (status) status.textContent = 'Zastosowano na żywo.';
    });
    renderControls();

    panel.querySelector('[data-action="copy"]')?.addEventListener('click', async () => {
        const text = exportState(state);
        let copied = false;
        try {
            await navigator.clipboard.writeText(text);
            copied = true;
        } catch {
            // Console output is the fallback when clipboard permissions fail.
        }
        console.log(text);
        if (status) status.textContent = copied ? 'JSON skopiowany do schowka.' : 'JSON wypisany w konsoli.';
    });

    panel.querySelector('[data-action="reset"]')?.addEventListener('click', () => {
        replaceState(state, resetRingColorConfig());
        applyState(state);
        saveState(state);
        renderControls();
        if (status) status.textContent = 'Przywrócono kolory domyślne.';
    });

    panel.querySelector('[data-action="clear"]')?.addEventListener('click', () => {
        try { localStorage.removeItem(STORAGE_KEY); } catch { }
        replaceState(state, resetRingColorConfig());
        applyState(state);
        renderControls();
        if (status) status.textContent = 'Usunięto zapis i przywrócono domyślne.';
    });
    return panel;
}

export function initRingColorTunerPanel() {
    ensureStyle();
    const initial = normalizeRingColorConfig(loadSavedState() || {}, getRingColorConfig());
    const state = replaceState({}, initial);
    applyState(state);
    const panel = createPanel(state);
    const controls = panel.querySelector('.controls');
    const rebuildControls = () => {
        if (!controls) return;
        buildControls(controls, state, () => {
            applyState(state);
            saveState(state);
        });
    };
    const show = () => { panel.style.display = 'block'; return window.RingColors; };
    const hide = () => { panel.style.display = 'none'; return window.RingColors; };
    const toggle = () => {
        panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
        return window.RingColors;
    };

    window.RingColors = {
        show,
        hide,
        toggle,
        get: () => normalizeRingColorConfig(state, RING_COLOR_DEFAULTS),
        set: (patch = {}) => {
            const source = patch?.ringColors || patch;
            replaceState(state, normalizeRingColorConfig(source, state));
            applyState(state);
            saveState(state);
            rebuildControls();
            return window.RingColors;
        },
        reset: () => {
            replaceState(state, resetRingColorConfig());
            applyState(state);
            saveState(state);
            rebuildControls();
            return window.RingColors;
        },
        apply: () => {
            applyState(state);
            return window.RingColors;
        },
        export: () => exportState(state),
        copy: async () => {
            const text = exportState(state);
            try { await navigator.clipboard.writeText(text); } catch { }
            console.log(text);
            return text;
        }
    };
    if (!window.__ringColorTunerHotkeyBound) {
        window.__ringColorTunerHotkeyBound = true;
        window.addEventListener('keydown', event => {
            if (event.code !== 'F8' || event.repeat) return;
            const tag = String(event.target?.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
            event.preventDefault();
            toggle();
        });
    }
    return window.RingColors;
}
