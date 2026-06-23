const STYLE_ID = 'scanner-overview-ui-style';
const ROOT_ID = 'scanner-overview-ui-root';
const STORAGE_KEY = 'statki.scannerOverview.layout.v1';

const DEFAULT_FILTERS = {
  all: true,
  hostile: true,
  asteroid: true,
  station: true,
  friendly: true
};

const STYLES = `
:root {
  --scanner-bg: rgba(3, 9, 12, 0.88);
  --scanner-bg-strong: rgba(7, 18, 22, 0.94);
  --scanner-line: rgba(115, 235, 214, 0.32);
  --scanner-text: #d9fbf3;
  --scanner-muted: #89aaa4;
  --scanner-green: #63f0b7;
  --scanner-red: #ff6868;
  --scanner-amber: #eeb763;
  --scanner-cyan: #6ed9ff;
}
#${ROOT_ID} {
  position: fixed;
  inset: 0;
  z-index: 230;
  pointer-events: none;
  font-family: "Consolas", "Courier New", monospace;
}
#${ROOT_ID}.hidden { display: none; }
#${ROOT_ID} .scanner-panel {
  position: absolute;
  color: var(--scanner-text);
  background: var(--scanner-bg);
  border: 1px solid var(--scanner-line);
  box-shadow: 0 14px 42px rgba(0, 0, 0, 0.46);
  pointer-events: auto;
  user-select: none;
}
#${ROOT_ID} .scanner-panel.collapsed .scanner-body { display: none; }
#${ROOT_ID} .scanner-overview { top: 78px; right: 18px; width: 342px; max-height: calc(100vh - 126px); }
#${ROOT_ID} .scanner-details { left: 18px; bottom: 88px; width: 342px; }
#${ROOT_ID} .scanner-lock-stack {
  position: absolute;
  left: 18px;
  bottom: 18px;
  width: 330px;
  max-height: 44vh;
  display: flex;
  flex-direction: column-reverse;
  gap: 6px;
  overflow: hidden;
  pointer-events: none;
}
#${ROOT_ID} .scanner-lock-chip {
  display: grid;
  grid-template-columns: 34px 34px 1fr 48px;
  align-items: center;
  gap: 7px;
  min-height: 34px;
  padding: 5px 9px;
  color: var(--scanner-text);
  background: rgba(7, 18, 22, 0.9);
  border: 1px solid rgba(255, 104, 104, 0.42);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.38), inset 3px 0 0 rgba(255, 104, 104, 0.7);
  user-select: none;
}
#${ROOT_ID} .scanner-lock-index {
  color: var(--scanner-red);
  font-size: 11px;
  font-weight: 700;
}
#${ROOT_ID} .scanner-lock-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: #ffe1e1;
}
#${ROOT_ID} .scanner-lock-type {
  color: var(--scanner-muted);
  font-size: 10px;
  text-align: right;
}
#${ROOT_ID}.floating .scanner-overview,
#${ROOT_ID}.floating .scanner-details { right: auto; bottom: auto; }
#${ROOT_ID}.floating .scanner-overview { left: 58px; top: 92px; }
#${ROOT_ID}.floating .scanner-details { left: 430px; top: 350px; }
#${ROOT_ID} .scanner-head {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  min-height: 20px;
  border-bottom: 1px solid rgba(115, 235, 214, 0.2);
  background: var(--scanner-bg-strong);
  cursor: default;
}
#${ROOT_ID}.floating .scanner-head { cursor: move; }
#${ROOT_ID} .scanner-title { font-size: 12px; font-weight: 700; color: #eafff9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#${ROOT_ID} .scanner-count { font-size: 10px; color: var(--scanner-muted); }
#${ROOT_ID} .scanner-head-actions { display: flex; align-items: center; gap: 7px; }
#${ROOT_ID} .scanner-collapse-toggle {
  min-width: 54px;
  padding: 3px 6px;
  font-size: 9px;
  line-height: 1;
}
#${ROOT_ID} .scanner-tools {
  display: flex;
  gap: 5px;
  padding: 7px 8px;
  border-bottom: 1px solid rgba(115, 235, 214, 0.12);
  background: rgba(0, 0, 0, 0.16);
  flex-wrap: wrap;
}
#${ROOT_ID} button {
  font: inherit;
  color: var(--scanner-muted);
  background: rgba(0, 0, 0, 0.18);
  border: 1px solid rgba(115, 235, 214, 0.22);
  padding: 4px 7px;
  cursor: pointer;
}
#${ROOT_ID} button:hover { color: var(--scanner-text); border-color: rgba(115, 235, 214, 0.54); }
#${ROOT_ID} button.active {
  color: var(--scanner-green);
  border-color: rgba(99, 240, 183, 0.58);
  background: rgba(99, 240, 183, 0.12);
}
#${ROOT_ID} .scanner-table { overflow: auto; max-height: 390px; }
#${ROOT_ID} .scanner-row {
  display: grid;
  grid-template-columns: 54px 1fr 58px 48px 38px;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 0 9px;
  border-bottom: 1px solid rgba(115, 235, 214, 0.08);
  color: #b9d8d2;
  font-size: 11px;
}
#${ROOT_ID} .scanner-row.header {
  min-height: 23px;
  color: #627f7a;
  background: rgba(0, 0, 0, 0.22);
  font-size: 10px;
  position: sticky;
  top: 0;
  z-index: 1;
}
#${ROOT_ID} .scanner-row.contact { cursor: pointer; }
#${ROOT_ID} .scanner-row.contact:hover { background: rgba(115, 235, 214, 0.08); }
#${ROOT_ID} .scanner-row.selected {
  background: rgba(238, 183, 99, 0.16);
  border-left: 3px solid var(--scanner-amber);
  padding-left: 6px;
  color: #fff2c7;
}
#${ROOT_ID} .scanner-row.locked .lock-cell { color: var(--scanner-red); }
#${ROOT_ID} .tone-hostile { color: var(--scanner-red); }
#${ROOT_ID} .tone-resource { color: var(--scanner-amber); }
#${ROOT_ID} .tone-station { color: #f97316; }
#${ROOT_ID} .tone-friendly { color: var(--scanner-cyan); }
#${ROOT_ID} .class-cell { display: flex; align-items: center; justify-content: center; min-width: 0; }
#${ROOT_ID} .ship-class-icon {
  --class-color: var(--scanner-cyan);
  position: relative;
  display: inline-block;
  width: 18px;
  height: 16px;
  filter: drop-shadow(0 0 5px rgba(110, 217, 255, 0.36));
}
#${ROOT_ID} .ship-class-icon::before,
#${ROOT_ID} .ship-class-icon::after {
  content: "";
  position: absolute;
  display: block;
}
#${ROOT_ID} .ship-class-icon::before { inset: 3px 2px; background: var(--class-color); }
#${ROOT_ID} .ship-class-icon.fighter::before {
  inset: 2px 5px;
  clip-path: polygon(50% 0, 100% 100%, 50% 76%, 0 100%);
}
#${ROOT_ID} .ship-class-icon.frigate::before {
  inset: 5px 2px;
  clip-path: polygon(0 50%, 18% 0, 100% 34%, 100% 66%, 18% 100%);
}
#${ROOT_ID} .ship-class-icon.destroyer::before {
  inset: 3px 2px;
  clip-path: polygon(0 50%, 24% 8%, 78% 0, 100% 50%, 78% 100%, 24% 92%);
}
#${ROOT_ID} .ship-class-icon.cruiser::before {
  inset: 2px 1px;
  clip-path: polygon(0 50%, 16% 16%, 66% 0, 100% 50%, 66% 100%, 16% 84%);
}
#${ROOT_ID} .ship-class-icon.capital::before {
  inset: 2px 0;
  clip-path: polygon(0 32%, 10% 14%, 76% 14%, 100% 50%, 76% 86%, 10% 86%, 0 68%);
}
#${ROOT_ID} .ship-class-icon.capital::after {
  left: 5px;
  right: 5px;
  top: 5px;
  height: 2px;
  background: rgba(3, 9, 12, 0.72);
}
#${ROOT_ID} .ship-class-icon.station::before {
  inset: 2px;
  background: transparent;
  border: 2px solid var(--class-color);
  border-radius: 50%;
}
#${ROOT_ID} .ship-class-icon.station::after {
  left: 8px;
  top: 0;
  width: 2px;
  height: 16px;
  background: var(--class-color);
  box-shadow: -6px 8px 0 -1px var(--class-color), 6px 8px 0 -1px var(--class-color);
}
#${ROOT_ID} .ship-class-icon.platform::before {
  inset: 3px;
  background: transparent;
  border: 2px solid var(--class-color);
  transform: rotate(45deg);
}
#${ROOT_ID} .ship-class-icon.platform::after {
  left: 3px;
  right: 3px;
  top: 7px;
  height: 2px;
  background: var(--class-color);
}
#${ROOT_ID} .ship-class-icon.contact::before {
  inset: 5px;
  border: 2px solid var(--class-color);
  border-radius: 50%;
  background: transparent;
}
#${ROOT_ID} .scanner-empty { padding: 14px 10px; color: var(--scanner-muted); font-size: 11px; }
#${ROOT_ID} .detail-body { padding: 10px; }
#${ROOT_ID} .detail-title { color: #fff2c7; font-size: 12px; font-weight: 700; margin-bottom: 8px; }
#${ROOT_ID} .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 10px; }
#${ROOT_ID} .detail-row { display: flex; justify-content: space-between; gap: 8px; font-size: 10px; color: #d8cda6; }
#${ROOT_ID} .detail-row span:first-child { color: var(--scanner-muted); }
#${ROOT_ID} .scanner-actions { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; margin-top: 9px; }
#${ROOT_ID} .scanner-actions button { color: #f6d482; border-color: rgba(238, 183, 99, 0.3); padding: 5px 0; font-size: 10px; }
#${ROOT_ID} .scanner-hidden { display: none; }
@media (max-width: 760px) {
  #${ROOT_ID} .scanner-overview { left: 10px; right: 10px; top: 64px; width: auto; }
  #${ROOT_ID} .scanner-details { left: 10px; right: 10px; bottom: 78px; width: auto; }
  #${ROOT_ID} .scanner-lock-stack { left: 10px; right: 10px; bottom: 10px; width: auto; max-height: 34vh; }
  #${ROOT_ID} .scanner-row { grid-template-columns: 48px 1fr 50px 36px 30px; }
}
`;

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function copyFilters(filters = DEFAULT_FILTERS) {
  return {
    all: filters.all !== false,
    hostile: filters.hostile !== false,
    asteroid: filters.asteroid !== false,
    station: filters.station !== false,
    friendly: filters.friendly !== false
  };
}

function contactMatchesFilters(contact, filters) {
  if (!contact) return false;
  const f = copyFilters(filters);
  if (f.all) return true;
  const type = String(contact.type || '').toLowerCase();
  const tone = String(contact.tone || '').toLowerCase();
  if (tone === 'hostile') return f.hostile;
  if (type === 'asteroid' || tone === 'resource') return f.asteroid;
  if (type === 'station' || tone === 'station') return f.station;
  if (tone === 'friendly') return f.friendly;
  return true;
}

function formatDistance(distance) {
  const d = Math.max(0, finiteNumber(distance, 0));
  if (d >= 1000) {
    const value = d / 1000;
    return `${value >= 10 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return `${Math.round(d)}u`;
}

function classForTone(tone) {
  const normalized = String(tone || 'neutral').toLowerCase();
  if (normalized === 'hostile') return 'tone-hostile';
  if (normalized === 'resource') return 'tone-resource';
  if (normalized === 'station') return 'tone-station';
  if (normalized === 'friendly') return 'tone-friendly';
  return '';
}

function normalizeClassName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function iconForClass(contact, classLabel) {
  const type = normalizeClassName(contact?.type);
  const tone = normalizeClassName(contact?.tone);
  const label = normalizeClassName(classLabel);
  if (type === 'asteroid' || tone === 'resource') return '';
  if (type === 'station' || tone === 'station' || label.includes('stacja') || label.includes('station')) return 'station';
  if (type === 'platform' || label.includes('platform')) return 'platform';
  if (label.includes('kapital') || label.includes('capital') || label.includes('supercapital')) return 'capital';
  if (label.includes('krazownik') || label.includes('cruiser') || label.includes('battleship') || label.includes('carrier')) return 'cruiser';
  if (label.includes('niszczyciel') || label.includes('destroyer')) return 'destroyer';
  if (label.includes('fregata') || label.includes('frigate')) return 'frigate';
  if (label.includes('mysliwiec') || label.includes('fighter') || label.includes('interceptor') || label.includes('drone')) return 'fighter';
  return type === 'ship' || label ? 'contact' : '';
}

const OBJECT_KEYS = new WeakMap();
let nextObjectKey = 1;

function targetKey(target, contact) {
  if (!target || typeof target !== 'object') return String(contact?.label || 'contact');
  if (target.id != null) return `id:${target.id}`;
  if (target.__radarUnitId) return `radar:${target.__radarUnitId}`;
  if (target.worldX != null && target.worldY != null) {
    return [
      'asteroid',
      target.type || target.resource || 'unknown',
      target.size || '',
      Math.round(finiteNumber(target.worldX, 0)),
      Math.round(finiteNumber(target.worldY, 0)),
      Math.round(finiteNumber(target.scale, 0))
    ].join(':');
  }
  if (!OBJECT_KEYS.has(target)) {
    OBJECT_KEYS.set(target, `object:${nextObjectKey++}`);
  }
  return OBJECT_KEYS.get(target);
}

export function updateScannerFilters(current = DEFAULT_FILTERS, key = '') {
  const next = copyFilters(current);
  const name = String(key || '').toLowerCase();
  if (name === 'all') {
    const enabled = !next.all;
    return { all: enabled, hostile: true, asteroid: true, station: true, friendly: true };
  }
  if (Object.prototype.hasOwnProperty.call(next, name)) {
    next[name] = !next[name];
    next.all = next.hostile && next.asteroid && next.station && next.friendly;
  }
  return next;
}

export function resolveScannerLayout(saved = {}) {
  const mode = saved?.mode === 'floating' ? 'floating' : 'fixed';
  return {
    mode,
    overview: saved?.overview && typeof saved.overview === 'object' ? saved.overview : null,
    details: saved?.details && typeof saved.details === 'object' ? saved.details : null,
    overviewCollapsed: saved?.overviewCollapsed === true,
    detailsCollapsed: saved?.detailsCollapsed === true
  };
}

export function getPanelCollapseLabel(collapsed) {
  return collapsed ? 'EXPAND' : 'COLLAPSE';
}

export function createScannerOverviewModel({
  contacts = [],
  selectedTarget = null,
  lockedTargets = [],
  filters = DEFAULT_FILTERS,
  maxRows = 80
} = {}) {
  const locks = new Set(Array.from(lockedTargets || []));
  const rows = [];
  const limit = Math.max(1, finiteNumber(maxRows, 80));
  for (const contact of contacts || []) {
    if (!contactMatchesFilters(contact, filters)) continue;
    if (rows.length >= limit) break;
    const key = `${String(contact.type || 'unknown').toLowerCase()}:${targetKey(contact.target, contact)}`;
    const classLabel = contact.classLabel || contact.target?.size || contact.target?.type || '';
    const classIcon = iconForClass(contact, classLabel);
    rows.push({
      key,
      contact,
      target: contact.target,
      type: String(contact.type || 'unknown').toUpperCase(),
      tone: String(contact.tone || 'neutral').toLowerCase(),
      label: contact.label || contact.target?.__radarUnitId || contact.target?.id || 'CONTACT',
      classLabel,
      classTitle: String(classLabel || ''),
      classIcon,
      classDisplay: classIcon ? '' : String(classLabel || ''),
      distanceLabel: formatDistance(contact.distance),
      selected: selectedTarget != null && contact.target === selectedTarget,
      locked: locks.has(contact.target)
    });
  }
  return { rows, filters: copyFilters(filters) };
}

export function createLockedTargetLogModel({
  lockedTargets = [],
  contacts = [],
  maxRows = 8,
  getTargetLabel = null,
  getTargetClass = null
} = {}) {
  const contactByTarget = new Map();
  for (const contact of contacts || []) {
    if (contact?.target) contactByTarget.set(contact.target, contact);
  }

  const rows = [];
  const seen = new Set();
  const limit = Math.max(1, finiteNumber(maxRows, 8));
  for (const target of lockedTargets || []) {
    if (!target || seen.has(target) || rows.length >= limit) continue;
    seen.add(target);
    const contact = contactByTarget.get(target) || null;
    const classLabel = contact?.classLabel
      || (typeof getTargetClass === 'function' ? getTargetClass(target) : '')
      || target?.size
      || target?.type
      || '';
    const classIcon = iconForClass(contact || { type: target?.__scannerContactType || target?.type }, classLabel);
    const label = contact?.label
      || (typeof getTargetLabel === 'function' ? getTargetLabel(target) : '')
      || target?.__radarUnitId
      || target?.id
      || 'CONTACT';

    rows.push({
      key: `lock:${targetKey(target, contact)}:${rows.length}`,
      target,
      contact,
      indexLabel: String(rows.length + 1).padStart(2, '0'),
      tone: String(contact?.tone || 'locked').toLowerCase(),
      label: String(label),
      classLabel,
      classTitle: String(classLabel || ''),
      classIcon,
      classDisplay: classIcon ? '' : String(classLabel || '').slice(0, 6)
    });
  }
  return { rows };
}

function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

function makeButton(label, className = '') {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  if (className) btn.className = className;
  return btn;
}

function loadLayout() {
  if (typeof localStorage === 'undefined') return resolveScannerLayout();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return resolveScannerLayout(raw ? JSON.parse(raw) : {});
  } catch {
    return resolveScannerLayout();
  }
}

function saveLayout(layout) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Storage can fail in private contexts; UI still works with defaults.
  }
}

function applyPanelPosition(panel, position) {
  if (!panel || !position) return;
  if (Number.isFinite(Number(position.left))) panel.style.left = `${Number(position.left)}px`;
  if (Number.isFinite(Number(position.top))) panel.style.top = `${Number(position.top)}px`;
}

function panelPosition(panel) {
  const rect = panel.getBoundingClientRect();
  return { left: Math.round(rect.left), top: Math.round(rect.top) };
}

export function initScannerOverviewUI(opts = {}) {
  if (typeof document === 'undefined') {
    return {
      update() {},
      setEnabled() {},
      getSelectedTarget() { return null; }
    };
  }

  ensureStyles();
  let layout = loadLayout();
  let filters = copyFilters(opts.filters);
  let selectedTarget = null;
  let lastRuntime = null;

  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.className = layout.mode === 'floating' ? 'floating hidden' : 'hidden';

  const overview = document.createElement('section');
  overview.className = 'scanner-panel scanner-overview';
  const details = document.createElement('section');
  details.className = 'scanner-panel scanner-details';
  const lockStack = document.createElement('div');
  lockStack.className = 'scanner-lock-stack';

  overview.innerHTML = `
    <div class="scanner-head" data-drag-panel="overview">
      <div class="scanner-title">OVERVIEW / SCANNER</div>
      <div class="scanner-head-actions">
        <button class="scanner-collapse-toggle" type="button" data-collapse-panel="overview">COLLAPSE</button>
        <div class="scanner-count">0 CONTACTS</div>
      </div>
    </div>
    <div class="scanner-body">
      <div class="scanner-tools"></div>
      <div class="scanner-table"></div>
    </div>
  `;

  details.innerHTML = `
    <div class="scanner-head" data-drag-panel="details">
      <div class="scanner-title">SELECTED OBJECT</div>
      <div class="scanner-head-actions">
        <button class="scanner-collapse-toggle" type="button" data-collapse-panel="details">COLLAPSE</button>
        <div class="scanner-count">NO TARGET</div>
      </div>
    </div>
    <div class="scanner-body detail-body"></div>
  `;

  root.appendChild(overview);
  root.appendChild(details);
  root.appendChild(lockStack);
  document.body.appendChild(root);

  const overviewCount = overview.querySelector('.scanner-count');
  const table = overview.querySelector('.scanner-table');
  const tools = overview.querySelector('.scanner-tools');
  const detailCount = details.querySelector('.scanner-count');
  const detailBody = details.querySelector('.detail-body');
  const overviewCollapseToggle = overview.querySelector('[data-collapse-panel="overview"]');
  const detailsCollapseToggle = details.querySelector('[data-collapse-panel="details"]');
  const toolButtons = new Map();
  const rowElements = new Map();
  let headerRow = null;
  let emptyRow = null;

  function syncCollapseToggle(button, panel) {
    if (!button || !panel) return;
    const collapsed = panel.classList.contains('collapsed');
    const label = getPanelCollapseLabel(collapsed);
    button.textContent = label;
    button.title = collapsed ? 'Expand panel' : 'Collapse panel';
    button.setAttribute('aria-label', collapsed ? 'Expand panel' : 'Collapse panel');
    button.classList.toggle('active', collapsed);
  }

  function syncCollapseToggles() {
    syncCollapseToggle(overviewCollapseToggle, overview);
    syncCollapseToggle(detailsCollapseToggle, details);
    const bodyCollapse = toolButtons.get('collapse');
    if (bodyCollapse) syncCollapseToggle(bodyCollapse, overview);
  }

  function setPanelCollapsed(panel, collapsed) {
    if (!panel) return;
    panel.classList.toggle('collapsed', !!collapsed);
    persist();
    syncCollapseToggles();
  }

  function togglePanelCollapsed(panel) {
    setPanelCollapsed(panel, !panel?.classList.contains('collapsed'));
  }

  function persist() {
    if (layout.mode === 'floating') {
      layout.overview = panelPosition(overview);
      layout.details = panelPosition(details);
    }
    layout.overviewCollapsed = overview.classList.contains('collapsed');
    layout.detailsCollapsed = details.classList.contains('collapsed');
    saveLayout(layout);
  }

  function setLayoutMode(mode) {
    layout = { ...layout, mode: mode === 'floating' ? 'floating' : 'fixed' };
    root.classList.toggle('floating', layout.mode === 'floating');
    overview.style.left = '';
    overview.style.top = '';
    details.style.left = '';
    details.style.top = '';
    if (layout.mode === 'floating') {
      applyPanelPosition(overview, layout.overview);
      applyPanelPosition(details, layout.details);
    }
    persist();
    render();
  }

  function addToolButton(key, label, onClick) {
    const btn = makeButton(label);
    btn.addEventListener('click', onClick);
    toolButtons.set(key, btn);
    tools.appendChild(btn);
    return btn;
  }

  function ensureTools() {
    if (toolButtons.size) return;
    tools.textContent = '';
    addToolButton('fixed', 'FIXED', (e) => {
      e.stopPropagation();
      setLayoutMode('fixed');
    });

    addToolButton('floating', 'FLOATING', (e) => {
      e.stopPropagation();
      setLayoutMode('floating');
    });

    for (const key of ['all', 'hostile', 'asteroid', 'station', 'friendly']) {
      addToolButton(key, key.toUpperCase(), (e) => {
        e.stopPropagation();
        filters = updateScannerFilters(filters, key);
        opts.onFilterChange?.(filters);
        render();
      });
    }

    addToolButton('collapse', 'COLLAPSE', (e) => {
      e.stopPropagation();
      togglePanelCollapsed(overview);
    });
  }

  function renderTools() {
    ensureTools();
    toolButtons.get('fixed')?.classList.toggle('active', layout.mode === 'fixed');
    toolButtons.get('floating')?.classList.toggle('active', layout.mode === 'floating');
    for (const key of ['all', 'hostile', 'asteroid', 'station', 'friendly']) {
      toolButtons.get(key)?.classList.toggle('active', filters[key] !== false);
    }
    syncCollapseToggles();
  }

  function ensureHeaderRow() {
    if (!headerRow) {
      headerRow = document.createElement('div');
      headerRow.className = 'scanner-row header';
      headerRow.innerHTML = '<span>TYPE</span><span>NAME</span><span>DIST</span><span>SZ</span><span>LCK</span>';
    }
    if (table.firstChild !== headerRow) {
      table.insertBefore(headerRow, table.firstChild);
    }
  }

  function updateRowElement(el, row) {
    el.__scannerRow = row;
    el.className = `scanner-row contact ${row.selected ? 'selected' : ''} ${row.locked ? 'locked' : ''}`;
    el.__cells.type.className = classForTone(row.tone);
    el.__cells.type.textContent = row.type.slice(0, 4);
    el.__cells.label.textContent = row.label;
    el.__cells.label.title = row.label;
    el.__cells.distance.textContent = row.distanceLabel;
    el.__cells.size.className = row.classIcon ? 'class-cell has-icon' : 'class-cell';
    if (row.classIcon) {
      let icon = el.__cells.size.__classIcon;
      if (!icon) {
        el.__cells.size.textContent = '';
        icon = document.createElement('span');
        el.__cells.size.__classIcon = icon;
        el.__cells.size.appendChild(icon);
      }
      icon.className = `ship-class-icon ${row.classIcon}`;
      icon.title = row.classTitle || row.classIcon;
      icon.setAttribute('aria-label', row.classTitle || row.classIcon);
    } else {
      if (el.__cells.size.__classIcon) {
        el.__cells.size.__classIcon.remove();
        el.__cells.size.__classIcon = null;
      }
      el.__cells.size.textContent = String(row.classDisplay ?? row.classLabel).slice(0, 6);
    }
    el.__cells.lock.textContent = row.locked ? 'LOCK' : '-';
  }

  function makeRowElement(row) {
    const el = document.createElement('div');
    el.innerHTML = `
      <span data-cell="type"></span>
      <span data-cell="label"></span>
      <span data-cell="distance"></span>
      <span data-cell="size" class="class-cell"></span>
      <span data-cell="lock" class="lock-cell"></span>
    `;
    el.__cells = {
      type: el.querySelector('[data-cell="type"]'),
      label: el.querySelector('[data-cell="label"]'),
      distance: el.querySelector('[data-cell="distance"]'),
      size: el.querySelector('[data-cell="size"]'),
      lock: el.querySelector('[data-cell="lock"]')
    };
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const activeRow = el.__scannerRow;
      selectedTarget = activeRow?.target || null;
      if (activeRow) {
        opts.onSelectTarget?.(activeRow.target, activeRow.contact, {
          ctrlKey: !!e.ctrlKey,
          shiftKey: !!e.shiftKey,
          altKey: !!e.altKey
        });
        if (e.ctrlKey) opts.onToggleLock?.(activeRow.target, activeRow.contact);
      }
      render();
    });
    el.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const activeRow = el.__scannerRow;
      selectedTarget = activeRow?.target || null;
      if (activeRow) opts.onToggleLock?.(activeRow.target, activeRow.contact);
      render();
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const activeRow = el.__scannerRow;
      selectedTarget = activeRow?.target || null;
      if (activeRow) opts.onAction?.('menu', activeRow.target, activeRow.contact);
      render();
    });
    updateRowElement(el, row);
    return el;
  }

  function renderRows(model) {
    ensureHeaderRow();
    const seen = new Set();

    if (!model.rows.length) {
      for (const el of rowElements.values()) el.remove();
      rowElements.clear();
      if (!emptyRow) {
        emptyRow = document.createElement('div');
        emptyRow.className = 'scanner-empty';
        emptyRow.textContent = 'NO CONTACTS';
      }
      if (emptyRow.previousSibling !== headerRow) {
        table.insertBefore(emptyRow, headerRow.nextSibling);
      }
      return;
    }
    if (emptyRow) emptyRow.remove();

    let anchor = headerRow;
    for (const row of model.rows) {
      seen.add(row.key);
      let el = rowElements.get(row.key);
      if (!el) {
        el = makeRowElement(row);
        rowElements.set(row.key, el);
      } else {
        updateRowElement(el, row);
      }
      if (el.previousSibling !== anchor) {
        table.insertBefore(el, anchor.nextSibling);
      }
      anchor = el;
    }
    for (const [key, el] of rowElements) {
      if (!seen.has(key)) {
        el.remove();
        rowElements.delete(key);
      }
    }
  }

  function renderDetails(target) {
    detailBody.textContent = '';
    if (!target) {
      detailCount.textContent = 'NO TARGET';
      const empty = document.createElement('div');
      empty.className = 'scanner-empty';
      empty.textContent = 'SELECT CONTACT';
      detailBody.appendChild(empty);
      return;
    }

    const detail = opts.getDetails?.(target) || { title: 'CONTACT', rows: [] };
    detailCount.textContent = opts.isLocked?.(target) ? 'LOCKED' : 'SELECTED';
    const title = document.createElement('div');
    title.className = 'detail-title';
    title.textContent = detail.title || 'CONTACT';
    detailBody.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'detail-grid';
    for (const row of detail.rows || []) {
      const line = document.createElement('div');
      line.className = 'detail-row';
      line.innerHTML = `<span>${row.name}</span><strong>${row.amount}</strong>`;
      grid.appendChild(line);
    }
    detailBody.appendChild(grid);

    const actions = document.createElement('div');
    actions.className = 'scanner-actions';
    for (const action of ['lock', 'scan', 'approach', 'orbit', 'jump']) {
      const btn = makeButton(action.toUpperCase());
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (action === 'lock') opts.onToggleLock?.(target);
        else opts.onAction?.(action, target);
        render();
      });
      actions.appendChild(btn);
    }
    detailBody.appendChild(actions);
  }

  function renderLockedTargetLog(runtime) {
    lockStack.textContent = '';
    const model = createLockedTargetLogModel({
      lockedTargets: runtime?.lockedTargets || [],
      contacts: runtime?.contacts || [],
      maxRows: runtime?.maxLockedRows || 8,
      getTargetLabel: opts.getTargetLabel,
      getTargetClass: opts.getTargetClass
    });
    lockStack.classList.toggle('scanner-hidden', model.rows.length === 0);
    for (const row of model.rows) {
      const chip = document.createElement('div');
      chip.className = `scanner-lock-chip ${classForTone(row.tone)}`;

      const index = document.createElement('span');
      index.className = 'scanner-lock-index';
      index.textContent = row.indexLabel;
      chip.appendChild(index);

      const classCell = document.createElement('span');
      classCell.className = row.classIcon ? 'class-cell has-icon' : 'class-cell';
      if (row.classIcon) {
        const icon = document.createElement('span');
        icon.className = `ship-class-icon ${row.classIcon}`;
        icon.title = row.classTitle || row.classIcon;
        icon.setAttribute('aria-label', row.classTitle || row.classIcon);
        classCell.appendChild(icon);
      } else {
        classCell.textContent = row.classDisplay;
      }
      chip.appendChild(classCell);

      const label = document.createElement('span');
      label.className = 'scanner-lock-label';
      label.textContent = row.label;
      label.title = row.label;
      chip.appendChild(label);

      const type = document.createElement('span');
      type.className = 'scanner-lock-type';
      type.textContent = 'LOCK';
      chip.appendChild(type);

      lockStack.appendChild(chip);
    }
  }

  function render() {
    if (!lastRuntime) return;
    renderTools();
    const runtimeSelected = lastRuntime.selectedTarget || selectedTarget;
    const model = createScannerOverviewModel({
      contacts: lastRuntime.contacts || [],
      selectedTarget: runtimeSelected,
      lockedTargets: lastRuntime.lockedTargets || [],
      filters,
      maxRows: lastRuntime.maxRows || 80
    });
    overviewCount.textContent = `${model.rows.length} CONTACTS`;
    renderRows(model);
    renderDetails(runtimeSelected);
    renderLockedTargetLog(lastRuntime);
  }

  function startDrag(e, panel) {
    if (layout.mode !== 'floating' || e.button !== 0) return;
    if (e.target?.closest?.('button')) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = panel.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const offsetX = startX - rect.left;
    const offsetY = startY - rect.top;

    const move = (ev) => {
      const maxLeft = Math.max(0, window.innerWidth - rect.width);
      const maxTop = Math.max(0, window.innerHeight - rect.height);
      const left = Math.max(0, Math.min(maxLeft, ev.clientX - offsetX));
      const top = Math.max(0, Math.min(maxTop, ev.clientY - offsetY));
      panel.style.left = `${Math.round(left)}px`;
      panel.style.top = `${Math.round(top)}px`;
    };
    const up = () => {
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', up, true);
      persist();
    };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
  }

  overview.querySelector('.scanner-head').addEventListener('mousedown', (e) => startDrag(e, overview));
  details.querySelector('.scanner-head').addEventListener('mousedown', (e) => startDrag(e, details));
  overviewCollapseToggle?.addEventListener('mousedown', (e) => e.stopPropagation());
  detailsCollapseToggle?.addEventListener('mousedown', (e) => e.stopPropagation());
  overviewCollapseToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePanelCollapsed(overview);
  });
  detailsCollapseToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePanelCollapsed(details);
  });
  root.addEventListener('mousedown', (e) => e.stopPropagation());
  root.addEventListener('click', (e) => e.stopPropagation());
  root.addEventListener('contextmenu', (e) => e.stopPropagation());

  if (layout.overviewCollapsed) overview.classList.add('collapsed');
  if (layout.detailsCollapsed) details.classList.add('collapsed');
  if (layout.mode === 'floating') {
    applyPanelPosition(overview, layout.overview);
    applyPanelPosition(details, layout.details);
  }
  syncCollapseToggles();

  return {
    update(runtime = {}) {
      lastRuntime = runtime;
      if (runtime.selectedTarget !== undefined) selectedTarget = runtime.selectedTarget;
      root.classList.toggle('hidden', runtime.enabled === false);
      root.classList.toggle('floating', layout.mode === 'floating');
      render();
    },
    setEnabled(enabled) {
      root.classList.toggle('hidden', !enabled);
    },
    getSelectedTarget() {
      return selectedTarget;
    },
    selectTarget(target) {
      selectedTarget = target || null;
      render();
    }
  };
}
