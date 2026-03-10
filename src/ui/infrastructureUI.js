// Infrastructure UI Module - extracted from index.html
// Accesses globals via window: stationUI, stations, Game, camera, clamp, worldToScreen, screenToWorld, planetOrbitRadii

const INFRASTRUCTURE_BUILDINGS = [
  { id: 'solar_array', name: 'Orbitalna Elektrownia Słoneczna', buildTime: 75, icon: 'solar', footprint: { w: 4, h: 4 } },
  { id: 'dock_s', name: 'Dok Orbitalny (S)', buildTime: 55, icon: 'dock', footprint: { w: 1, h: 1 } },
  { id: 'dock_m', name: 'Dok Orbitalny (M)', buildTime: 75, icon: 'dock', footprint: { w: 2, h: 1 }, rotatable: true },
  { id: 'dock_l', name: 'Dok Orbitalny (L)', buildTime: 105, icon: 'dock', footprint: { w: 2, h: 2 } },
  { id: 'dock_capital', name: 'Dok Orbitalny (Capital)', buildTime: 140, icon: 'dock', footprint: { w: 3, h: 3 } },
  { id: 'shipyard_s', name: 'Fighter Factory', buildTime: 90, icon: 'shipyard', tier: 'S', footprint: { w: 3, h: 3 }, rotatable: true },
  { id: 'shipyard_m', name: 'Orbitalna Stocznia (M)', buildTime: 110, icon: 'shipyard', tier: 'M', footprint: { w: 2, h: 2 } },
  { id: 'shipyard_l', name: 'Orbitalna Stocznia (L)', buildTime: 140, icon: 'shipyard', tier: 'L', footprint: { w: 3, h: 2 }, rotatable: true },
  { id: 'shipyard_capital', name: 'Orbitalna Stocznia (Capital)', buildTime: 170, icon: 'shipyard', tier: 'C', footprint: { w: 3, h: 4 }, rotatable: true },
  { id: 'shipyard_supercapital', name: 'Orbitalna Stocznia (SuperCapital)', buildTime: 210, icon: 'shipyard', tier: 'SC', footprint: { w: 3, h: 4 }, rotatable: true },
  { id: 'storage_metal', name: 'Magazyn Metali', buildTime: 60, icon: 'storage', label: 'M', color: '#60a5fa', footprint: { w: 4, h: 4 } },
  { id: 'storage_fuel', name: 'Magazyn Paliwa', buildTime: 70, icon: 'storage', label: 'F', color: '#f97316', footprint: { w: 4, h: 4 } },
  { id: 'storage_gas', name: 'Magazyn Gazów', buildTime: 65, icon: 'storage', label: 'G', color: '#14b8a6', footprint: { w: 4, h: 4 } },
  { id: 'storage_plastics', name: 'Magazyn Tworzyw Sztucznych', buildTime: 85, icon: 'storage', label: 'P', color: '#a855f7', footprint: { w: 4, h: 4 } },
  { id: 'metal_harvester', name: 'Metal Harvester', buildTime: 95, icon: 'metal_harvester', footprint: { w: 4, h: 4 }, allowedPlanetTypes: ['rocky'] },
  { id: 'metal_refinery', name: 'Metal Refinery', buildTime: 125, icon: 'metal_refinery', footprint: { w: 4, h: 4 }, allowedPlanetTypes: ['rocky'] },
  { id: 'gas_harvester', name: 'Gas Harvester', buildTime: 110, icon: 'gas_harvester', footprint: { w: 4, h: 4 }, requiresSolarSystem: true, allowedPlanetTypes: ['gas'] },
  { id: 'gas_refinery', name: 'Gas Refinery', buildTime: 140, icon: 'gas_refinery', footprint: { w: 4, h: 4 }, requiresSolarSystem: true, allowedPlanetTypes: ['gas'] }
];
const ECONOMY_RESOURCES = {
  gas: { label: 'Gaz' },
  fuel: { label: 'Paliwo' },
  rawMetal: { label: 'Surowy metal' },
  refinedMetal: { label: 'Rafinowany metal' }
};
const ECONOMY_RESOURCE_KEYS = Object.keys(ECONOMY_RESOURCES);
const ECONOMY_BASE_CAPACITY = { gas: 60, fuel: 90, rawMetal: 140, refinedMetal: 100 };
const ECONOMY_STORAGE_BONUS = {
  storage_gas: { gas: 260 },
  storage_fuel: { fuel: 240 },
  storage_metal: { rawMetal: 320, refinedMetal: 240 }
};
const ECONOMY_BUILDING_RULES = {
  gas_harvester: { produce: { gas: 22 } },
  gas_refinery: { consume: { gas: 16 }, produce: { fuel: 14 } },
  metal_harvester: { produce: { rawMetal: 24 } },
  metal_refinery: { consume: { rawMetal: 18 }, produce: { refinedMetal: 12 } }
};
const ECONOMY_TICK_SECONDS = 60;
const INFRA_BUILDING_MAP = new Map(INFRASTRUCTURE_BUILDINGS.map(b => [b.id, b]));

const INFRA_CELL_WORLD_SIZE = 220;
const INFRA_CELL_WORLD_GAP = 60;
const INFRA_CELL_WORLD_STEP = INFRA_CELL_WORLD_SIZE + INFRA_CELL_WORLD_GAP;
const INFRA_STATION_CORE_SIZE = 4;
const INFRA_MIN_GRID = 8;
const INFRA_MAX_GRID = 26;
let infrastructureLayoutCache = null;
let infrastructureLayoutKey = '';

function computeInfrastructureLayout(cols, rows) {
  const width = INFRA_CELL_WORLD_SIZE + (cols - 1) * INFRA_CELL_WORLD_STEP;
  const height = INFRA_CELL_WORLD_SIZE + (rows - 1) * INFRA_CELL_WORLD_STEP;
  const originOffset = { x: -width / 2, y: -height / 2 };
  const cells = [];
  const coreStartCol = Math.max(0, Math.floor((cols - INFRA_STATION_CORE_SIZE) / 2));
  const coreStartRow = Math.max(0, Math.floor((rows - INFRA_STATION_CORE_SIZE) / 2));
  const coreEndCol = Math.min(cols, coreStartCol + INFRA_STATION_CORE_SIZE) - 1;
  const coreEndRow = Math.min(rows, coreStartRow + INFRA_STATION_CORE_SIZE) - 1;
  const coreIndices = [];
  const centerIndex = (coreStartRow + Math.floor(INFRA_STATION_CORE_SIZE / 2)) * cols + coreStartCol + Math.floor(INFRA_STATION_CORE_SIZE / 2);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col;
      const local = {
        x: originOffset.x + col * INFRA_CELL_WORLD_STEP + INFRA_CELL_WORLD_SIZE / 2,
        y: originOffset.y + row * INFRA_CELL_WORLD_STEP + INFRA_CELL_WORLD_SIZE / 2
      };
      const blocked = col >= coreStartCol && col <= coreEndCol && row >= coreStartRow && row <= coreEndRow;
      if (blocked) coreIndices.push(idx);
      cells.push({ index: idx, col, row, local, blocked });
    }
  }
  return {
    cellSize: INFRA_CELL_WORLD_SIZE,
    cellGap: INFRA_CELL_WORLD_GAP,
    step: INFRA_CELL_WORLD_STEP,
    cols,
    rows,
    originOffset,
    width,
    height,
    cells,
    centerIndex,
    core: { startCol: coreStartCol, startRow: coreStartRow, indices: coreIndices }
  };
}

function getInfrastructureLayout(cols, rows) {
  const key = `${cols}x${rows}`;
  if (!infrastructureLayoutCache || infrastructureLayoutKey !== key) {
    infrastructureLayoutCache = computeInfrastructureLayout(cols, rows);
    infrastructureLayoutKey = key;
  }
  return infrastructureLayoutCache;
}

function computeInfrastructureGridSize(station) {
  const planet = station?.planet;
  const orbitRadii = planet ? window.planetOrbitRadii(planet) : null;
  const innerOrbitRadius = orbitRadii?.inner || Math.max(1200, (station?.r || 0) * 10);
  const squareSide = innerOrbitRadius * Math.SQRT2;
  const approximateCols = Math.floor(squareSide / INFRA_CELL_WORLD_STEP);
  let cols = Math.max(INFRA_MIN_GRID, Math.min(INFRA_MAX_GRID, approximateCols));
  if (cols % 2 !== 0) cols += 1; // symetria względem środka stacji
  const rows = cols;
  return { cols, rows };
}

function rebuildInfrastructureGrid(layout) {
  const grid = infrastructureBuilder.grid;
  if (!grid) return;
  const cols = infrastructureBuilder.gridCols;
  grid.style.setProperty('--infra-cols', cols);
  grid.innerHTML = '';
  infrastructureBuilder.gridCells = [];
  const total = cols * infrastructureBuilder.gridRows;
  for (let i = 0; i < total; i++) {
    const meta = layout.cells?.[i];
    const cell = document.createElement('div');
    cell.className = 'infra-cell empty';
    cell.dataset.index = String(i);
    if (meta?.blocked) {
      cell.classList.add('core');
      cell.classList.remove('empty');
      cell.dataset.blocked = '1';
    } else {
      cell.dataset.blocked = '0';
    }
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    cell.appendChild(canvas);
    const progressBar = document.createElement('div');
    progressBar.className = 'infra-progress-bar';
    const fill = document.createElement('div');
    fill.className = 'infra-progress-fill';
    progressBar.appendChild(fill);
    cell.appendChild(progressBar);
    const status = document.createElement('div');
    status.className = 'infra-cell-status';
    status.textContent = meta?.blocked ? 'Rdzeń stacji' : 'Puste';
    cell.appendChild(status);
    cell.addEventListener('dragenter', handleInfrastructureCellDragEnter);
    cell.addEventListener('dragover', handleInfrastructureCellDragOver);
    cell.addEventListener('dragleave', handleInfrastructureCellDragLeave);
    cell.addEventListener('drop', handleInfrastructureCellDrop);
    cell.addEventListener('click', () => {
      const state = getActiveInfrastructureState();
      const rootIdx = state ? getRootCellIndex(state, i) : null;
      infrastructureBuilder.selectedCell = rootIdx != null ? rootIdx : i;
      renderInfrastructureOverlay();
    });
    infrastructureBuilder.gridCells.push(cell);
    grid.appendChild(cell);
  }
}

function updateInfrastructureGridForStation(station) {
  const size = computeInfrastructureGridSize(station);
  const changed = size && (size.cols !== infrastructureBuilder.gridCols || size.rows !== infrastructureBuilder.gridRows);
  if (changed) {
    infrastructureBuilder.gridCols = size.cols;
    infrastructureBuilder.gridRows = size.rows;
    infrastructureLayoutCache = null;
    infrastructureLayoutKey = '';
    infrastructureBuilder.selectedCell = null;
    infrastructureBuilder.hoveredCell = null;
  }
  const layout = getInfrastructureLayout(infrastructureBuilder.gridCols, infrastructureBuilder.gridRows);
  if (changed || !infrastructureBuilder.layout) {
    infrastructureBuilder.layout = layout;
    rebuildInfrastructureGrid(layout);
    infrastructureBuilder.needsRender = true;
  }
  return layout;
}

const infrastructureBuilder = {
  overlay: document.getElementById('infrastructure-overlay'),
  list: document.getElementById('infra-building-list'),
  grid: document.getElementById('infra-grid'),
  info: document.getElementById('infra-info'),
  gridCols: INFRA_MIN_GRID,
  gridRows: INFRA_MIN_GRID,
  gridCells: [],
  stationStates: new Map(),
  selectedCell: null,
  activeStationKey: null,
  activeStationRef: null,
  hideTimer: null,
  isVisible: false,
  needsRender: false,
  hoveredCell: null,
  draggingBuildingId: null,
  draggingOverlay: false,
  overlayOffset: { x: 0, y: 0 },
  overlayPosition: null,
  editorAlpha: 0,
  ghostAlpha: 0,
  ghostRotation: 0,
  layout: null
};

function clampInfrastructureOverlayPosition(pos, overlay) {
  const maxX = Math.max(8, window.innerWidth - overlay.offsetWidth - 8);
  const maxY = Math.max(12, window.innerHeight - overlay.offsetHeight - 12);
  return {
    x: Math.min(Math.max(8, pos.x), maxX),
    y: Math.min(Math.max(12, pos.y), maxY)
  };
}

function applyInfrastructureOverlayPosition() {
  const overlay = infrastructureBuilder.overlay;
  if (!overlay) return;
  if (!infrastructureBuilder.overlayPosition) {
    const rect = overlay.getBoundingClientRect();
    infrastructureBuilder.overlayPosition = { x: rect.left, y: rect.top };
  }
  const pos = clampInfrastructureOverlayPosition(infrastructureBuilder.overlayPosition, overlay);
  infrastructureBuilder.overlayPosition = pos;
  overlay.style.left = `${pos.x}px`;
  overlay.style.top = `${pos.y}px`;
  overlay.style.right = 'auto';
  overlay.style.bottom = 'auto';
}

function setupInfrastructureOverlayDrag() {
  const overlay = infrastructureBuilder.overlay;
  if (!overlay) return;
  const header = overlay.querySelector('h3');
  if (!header) return;

  const endDrag = () => {
    if (!infrastructureBuilder.draggingOverlay) return;
    infrastructureBuilder.draggingOverlay = false;
    overlay.classList.remove('dragging');
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', endDrag);
  };

  const onMove = (ev) => {
    if (!infrastructureBuilder.draggingOverlay) return;
    const nextPos = {
      x: ev.clientX - infrastructureBuilder.overlayOffset.x,
      y: ev.clientY - infrastructureBuilder.overlayOffset.y
    };
    infrastructureBuilder.overlayPosition = clampInfrastructureOverlayPosition(nextPos, overlay);
    overlay.style.left = `${infrastructureBuilder.overlayPosition.x}px`;
    overlay.style.top = `${infrastructureBuilder.overlayPosition.y}px`;
  };

  header.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || !infrastructureBuilder.isVisible) return;
    const rect = overlay.getBoundingClientRect();
    infrastructureBuilder.overlayOffset = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    infrastructureBuilder.overlayPosition = { x: rect.left, y: rect.top };
    infrastructureBuilder.draggingOverlay = true;
    overlay.classList.add('dragging');
    applyInfrastructureOverlayPosition();
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', endDrag);
  });

  window.addEventListener('resize', () => {
    if (infrastructureBuilder.overlayPosition && infrastructureBuilder.isVisible) {
      applyInfrastructureOverlayPosition();
    }
  });
}

setupInfrastructureOverlayDrag();

function handleInfrastructureRotationWheel(ev) {
  if (!infrastructureBuilder.draggingBuildingId) return;
  if (!window.stationUI.open || window.stationUI.tab !== 'infrastructure') return;
  const building = INFRA_BUILDING_MAP.get(infrastructureBuilder.draggingBuildingId);
  const fp = building?.footprint;
  const canRotate = building && (building.rotatable || (fp && fp.w !== fp.h));
  if (!canRotate) return;
  ev.preventDefault();
  const delta = ev.deltaY > 0 ? 1 : -1;
  infrastructureBuilder.ghostRotation = (infrastructureBuilder.ghostRotation + delta + 2) % 2;
  infrastructureBuilder.needsRender = true;
}
window.addEventListener('wheel', handleInfrastructureRotationWheel, { passive: false });

function getInfrastructureStationKey(station) {
  if (!station) return null;
  if (station.id != null) return `station-${station.id}`;
  if (station.name) return `station-${station.name}`;
  const x = Math.round(station.x ?? 0);
  const y = Math.round(station.y ?? 0);
  return `station-${x}-${y}`;
}

function findStationByKey(key) {
  if (!key) return null;
  for (const st of (window.stations || [])) {
    if (getInfrastructureStationKey(st) === key) return st;
  }
  return null;
}

function ensureInfrastructureState(station) {
  const key = getInfrastructureStationKey(station);
  if (!key) return null;
  const layout = updateInfrastructureGridForStation(station);
  const cols = infrastructureBuilder.gridCols;
  const rows = infrastructureBuilder.gridRows;
  const totalCells = cols * rows;
  infrastructureBuilder.layout = layout;
  let state = infrastructureBuilder.stationStates.get(key);
  if (!state) {
    state = {
      stationKey: key,
      stationRef: station || null,
      stationName: station?.name || null,
      cells: Array.from({ length: totalCells }, () => null),
      cellMeta: layout.cells,
      layout,
      centerIndex: layout.centerIndex
    };
    infrastructureBuilder.stationStates.set(key, state);
  } else {
    if (state.cells.length !== totalCells) {
      if (state.cells.length > totalCells) {
        state.cells.length = totalCells;
      } else {
        state.cells = state.cells.concat(Array(totalCells - state.cells.length).fill(null));
      }
    }
    state.cellMeta = layout.cells;
    state.layout = layout;
    state.centerIndex = layout.centerIndex;
    if (station) state.stationRef = station;
    if (station?.name) state.stationName = station.name;
  }
  if (!state.stationRef) {
    state.stationRef = station || findStationByKey(key) || null;
  }
  return state;
}

function createEmptyEconomyResources() {
  const res = {};
  for (const key of ECONOMY_RESOURCE_KEYS) {
    res[key] = 0;
  }
  return res;
}

function getEconomyStationKey(ctx) {
  if (!ctx) return null;
  if (ctx.stationKey) return ctx.stationKey;
  if (ctx.stationRef) return getInfrastructureStationKey(ctx.stationRef);
  return getInfrastructureStationKey(ctx);
}

function ensureStationEconomy(ctx) {
  const key = getEconomyStationKey(ctx);
  if (!key) return null;
  if (!window.Game.stationEconomy) window.Game.stationEconomy = new Map();
  let econ = window.Game.stationEconomy.get(key);
  if (!econ) {
    econ = {
      stationKey: key,
      resources: createEmptyEconomyResources(),
      capacity: { ...ECONOMY_BASE_CAPACITY },
      timer: 0
    };
    window.Game.stationEconomy.set(key, econ);
  }
  econ.stationRef = ctx?.stationRef || ctx || findStationByKey(key);
  return econ;
}

function computeEconomyCapacities(buildingCounts) {
  const capacity = { ...ECONOMY_BASE_CAPACITY };
  for (const [buildingId, bonus] of Object.entries(ECONOMY_STORAGE_BONUS)) {
    const count = buildingCounts?.[buildingId] || 0;
    if (!count) continue;
    for (const [res, value] of Object.entries(bonus)) {
      capacity[res] = (capacity[res] || 0) + value * count;
    }
  }
  return capacity;
}

function clampEconomyResources(econ) {
  if (!econ) return;
  for (const key of ECONOMY_RESOURCE_KEYS) {
    const cap = econ.capacity?.[key];
    const value = econ.resources?.[key] ?? 0;
    econ.resources[key] = Number.isFinite(cap) ? window.clamp(value, 0, cap) : Math.max(0, value);
  }
}

function applyEconomyProduction(econ, buildingCounts, ticks) {
  if (!econ || ticks <= 0) return;
  for (const [buildingId, rule] of Object.entries(ECONOMY_BUILDING_RULES)) {
    const count = buildingCounts?.[buildingId] || 0;
    if (!count) continue;
    const cycles = count * ticks;
    let ratio = 1;
    if (rule.consume) {
      for (const [res, amount] of Object.entries(rule.consume)) {
        const required = amount * cycles;
        if (required <= 0) continue;
        const available = econ.resources?.[res] ?? 0;
        ratio = Math.min(ratio, available / required);
      }
    }
    if (ratio <= 0) continue;
    if (rule.consume) {
      for (const [res, amount] of Object.entries(rule.consume)) {
        const delta = amount * cycles * ratio;
        econ.resources[res] = Math.max(0, (econ.resources?.[res] ?? 0) - delta);
      }
    }
    if (rule.produce) {
      for (const [res, amount] of Object.entries(rule.produce)) {
        const current = econ.resources?.[res] ?? 0;
        const cap = econ.capacity?.[res];
        const next = current + amount * cycles * ratio;
        econ.resources[res] = Number.isFinite(cap) ? Math.min(cap, next) : next;
      }
    }
  }
  clampEconomyResources(econ);
}

function updateStationEconomyFromBuildings(state, buildingCounts, dt) {
  const econ = ensureStationEconomy(state);
  if (!econ) return;
  econ.capacity = computeEconomyCapacities(buildingCounts || {});
  clampEconomyResources(econ);
  econ.timer = (econ.timer || 0) + dt;
  if (econ.timer < ECONOMY_TICK_SECONDS) return;
  const ticks = Math.floor(econ.timer / ECONOMY_TICK_SECONDS);
  econ.timer -= ticks * ECONOMY_TICK_SECONDS;
  applyEconomyProduction(econ, buildingCounts, ticks);
}

function setInfrastructureActiveStation(station) {
  updateInfrastructureGridForStation(station);
  const key = getInfrastructureStationKey(station);
  if (infrastructureBuilder.activeStationKey === key) {
    infrastructureBuilder.activeStationRef = station || null;
    if (key) {
      const state = ensureInfrastructureState(station || findStationByKey(key));
      if (state && station) state.stationRef = station;
    }
    return;
  }
  infrastructureBuilder.activeStationKey = key;
  infrastructureBuilder.activeStationRef = station || null;
  if (key) {
    const state = ensureInfrastructureState(station || findStationByKey(key));
    if (state && station) state.stationRef = station;
  }
  infrastructureBuilder.selectedCell = null;
  infrastructureBuilder.needsRender = true;
  if (infrastructureBuilder.isVisible) {
    renderInfrastructureOverlay();
  }
}

function getActiveInfrastructureState() {
  const station = infrastructureBuilder.activeStationRef || window.stationUI.station;
  return station ? ensureInfrastructureState(station) : null;
}

function getRootCellIndex(state, idx) {
  if (!state || !state.cells || !Number.isInteger(idx)) return null;
  const cell = state.cells[idx];
  if (!cell) return null;
  if (Number.isInteger(cell.rootIndex)) return cell.rootIndex;
  return idx;
}

function getRootCell(state, idx) {
  const rootIdx = getRootCellIndex(state, idx);
  if (rootIdx == null) return null;
  return state.cells[rootIdx] || null;
}

function buildingFootprint(building, rotation = 0) {
  const base = building?.footprint || { w: 1, h: 1 };
  const rotated = (rotation % 2 !== 0) ? { w: base.h, h: base.w } : base;
  return { ...rotated };
}

function computeFootprintCells(layout, anchorIdx, building, rotation) {
  if (!layout || !layout.cells || !building || !Number.isInteger(anchorIdx)) return null;
  const anchorMeta = layout.cells[anchorIdx];
  if (!anchorMeta) return null;
  const fp = buildingFootprint(building, rotation);
  const width = fp.w || 1;
  const height = fp.h || 1;
  if (anchorMeta.col + width > layout.cols || anchorMeta.row + height > layout.rows) return null;
  const cells = [];
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const col = anchorMeta.col + dx;
      const row = anchorMeta.row + dy;
      const idx = row * layout.cols + col;
      const meta = layout.cells[idx];
      if (!meta) return null;
      cells.push(meta);
    }
  }
  const center = cells.reduce((acc, meta) => {
    acc.x += meta.local.x; acc.y += meta.local.y; return acc;
  }, { x: 0, y: 0 });
  center.x /= cells.length;
  center.y /= cells.length;
  return { cells, width, height, center };
}

function isBuildingAllowedOnStation(building, station) {
  if (!building) return { allowed: false, reason: 'Brak definicji budynku.' };
  if (building.requiresSolarSystem && !USE_SOLAR) {
    return { allowed: false, reason: 'Dostępne tylko w Układzie Słonecznym.' };
  }
  if (Array.isArray(building.allowedPlanetTypes) && building.allowedPlanetTypes.length) {
    const allowed = building.allowedPlanetTypes.map(t => String(t).toLowerCase());
    const planetType = typeof station?.planet?.type === 'string' ? station.planet.type.toLowerCase() : null;
    if (!planetType || !allowed.includes(planetType)) {
      return { allowed: false, reason: 'Wymaga planety gazowej.' };
    }
  }
  return { allowed: true, reason: null };
}

function validateInfrastructurePlacement(state, anchorIdx, building, rotation) {
  const layout = state?.layout || infrastructureBuilder.layout || getInfrastructureLayout(infrastructureBuilder.gridCols, infrastructureBuilder.gridRows);
  const station = state?.stationRef || window.stationUI.station || null;
  const availability = isBuildingAllowedOnStation(building, station);
  if (!availability.allowed) return { valid: false, footprint: null, reason: availability.reason };
  const footprint = computeFootprintCells(layout, anchorIdx, building, rotation);
  if (!layout || !footprint) return { valid: false, footprint: null };
  const blocked = footprint.cells.some(meta => meta.blocked);
  const occupied = footprint.cells.some(meta => state.cells?.[meta.index]);
  return { valid: !blocked && !occupied, blocked, occupied, layout, footprint };
}

function infrastructureHasBuildings(state) {
  if (!state || !Array.isArray(state.cells)) return false;
  return state.cells.some(Boolean);
}

function finalizeInfrastructurePlacement(state, anchorIdx, building, placement, rotation) {
  if (!state || !placement || !building || !placement.footprint) return null;
  const layout = placement.layout || state.layout || infrastructureBuilder.layout || getInfrastructureLayout(infrastructureBuilder.gridCols, infrastructureBuilder.gridRows);
  const normalizedRotation = Math.abs(rotation || 0) % 2;
  const duration = Math.max(1, building.buildTime);
  const base = {
    buildingId: building.id,
    status: 'completed',
    elapsed: duration,
    duration,
    progress: 1,
    startedAt: (performance.now() / 1000) - duration,
    cellIndex: anchorIdx,
    rootIndex: anchorIdx,
    rotation: normalizedRotation,
    footprint: { w: placement.footprint.width, h: placement.footprint.height },
    cells: placement.footprint.cells.map(meta => meta.index),
    gridX: layout.cells?.[anchorIdx]?.col ?? 0,
    gridY: layout.cells?.[anchorIdx]?.row ?? 0,
    localPos: { x: placement.footprint.center.x, y: placement.footprint.center.y },
    emitted: false
  };
  for (const meta of placement.footprint.cells) {
    state.cells[meta.index] = base;
    if (state.cellMeta) state.cellMeta[meta.index] = layout.cells?.[meta.index] || meta;
  }
  return base;
}

function autoplaceInfrastructureBuilding(state, buildingId, desiredCol, desiredRow, rotation = 0) {
  const building = INFRA_BUILDING_MAP.get(buildingId);
  if (!state || !building) return false;
  const availability = isBuildingAllowedOnStation(building, state.stationRef || null);
  if (!availability.allowed) return false;
  const layout = state.layout || infrastructureBuilder.layout || getInfrastructureLayout(infrastructureBuilder.gridCols, infrastructureBuilder.gridRows);
  const fp = buildingFootprint(building, rotation);
  if (!fp || !layout) return false;
  const targetCol = window.clamp(Math.round(desiredCol), 0, Math.max(0, layout.cols - fp.w));
  const targetRow = window.clamp(Math.round(desiredRow), 0, Math.max(0, layout.rows - fp.h));
  const targetCenterCol = targetCol + (fp.w - 1) / 2;
  const targetCenterRow = targetRow + (fp.h - 1) / 2;
  const candidates = layout.cells.filter(meta => !meta.blocked);
  candidates.sort((a, b) => {
    const ac = { col: a.col + (fp.w - 1) / 2, row: a.row + (fp.h - 1) / 2 };
    const bc = { col: b.col + (fp.w - 1) / 2, row: b.row + (fp.h - 1) / 2 };
    const da = Math.hypot(ac.col - targetCenterCol, ac.row - targetCenterRow);
    const db = Math.hypot(bc.col - targetCenterCol, bc.row - targetCenterRow);
    return da - db;
  });
  for (const meta of candidates) {
    const placement = validateInfrastructurePlacement(state, meta.index, building, rotation);
    if (placement && placement.valid) {
      finalizeInfrastructurePlacement(state, meta.index, building, placement, rotation);
      return true;
    }
  }
  return false;
}

function autoplaceBuildingByOffset(state, buildingId, offsetCol, offsetRow, rotation = 0) {
  if (!state) return false;
  const layout = state.layout || infrastructureBuilder.layout || getInfrastructureLayout(infrastructureBuilder.gridCols, infrastructureBuilder.gridRows);
  if (!layout) return false;
  const building = INFRA_BUILDING_MAP.get(buildingId);
  if (!building) return false;
  const fp = buildingFootprint(building, rotation);
  const centerCol = (layout.cols - 1) / 2 + offsetCol;
  const centerRow = (layout.rows - 1) / 2 + offsetRow;
  const anchorCol = centerCol - (fp.w - 1) / 2;
  const anchorRow = centerRow - (fp.h - 1) / 2;
  return autoplaceInfrastructureBuilding(state, buildingId, anchorCol, anchorRow, rotation);
}

function drawMetalHarvesterIcon(ctx) {
  ctx.save();
  ctx.fillStyle = 'rgba(59,130,246,0.10)';
  ctx.strokeStyle = '#60a5fa';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.rect(-34, -26, 68, 52);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = '#93c5fd';
  ctx.lineWidth = 2.5;
  const gearTeeth = 8;
  for (let i = 0; i < gearTeeth; i++) {
    const angle = i * (Math.PI * 2 / gearTeeth);
    const x = Math.cos(angle) * 26;
    const y = Math.sin(angle) * 26;
    ctx.beginPath();
    ctx.moveTo(x * 0.6, y * 0.6);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  ctx.fillStyle = '#0b1224';
  ctx.strokeStyle = '#38bdf8';
  ctx.beginPath();
  ctx.arc(0, 0, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawMetalRefineryIcon(ctx) {
  ctx.save();
  ctx.fillStyle = 'rgba(12,74,110,0.12)';
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.rect(-30, -30, 60, 60);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = '#67e8f9';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-24, 12);
  ctx.lineTo(24, 12);
  ctx.moveTo(-18, 4);
  ctx.lineTo(18, 4);
  ctx.moveTo(-12, -4);
  ctx.lineTo(12, -4);
  ctx.moveTo(-6, -12);
  ctx.lineTo(6, -12);
  ctx.stroke();

  ctx.fillStyle = '#0f172a';
  ctx.strokeStyle = '#e0f2fe';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-18, 18);
  ctx.lineTo(0, -14);
  ctx.lineTo(18, 18);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawGasHarvesterIcon(ctx) {
  ctx.save();
  ctx.fillStyle = 'rgba(20,184,166,0.12)';
  ctx.strokeStyle = '#14b8a6';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, 36, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = '#5eead4';
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 3; i++) {
    const angle = (-Math.PI / 2) + i * (Math.PI * 2 / 3);
    const x = Math.cos(angle) * 18;
    const y = Math.sin(angle) * 18;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  ctx.fillStyle = '#0f172a';
  ctx.strokeStyle = '#22c55e';
  ctx.beginPath();
  ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawGasRefineryIcon(ctx) {
  ctx.save();
  ctx.fillStyle = 'rgba(30,64,175,0.12)';
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.rect(-32, -28, 64, 56);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#0f172a';
  ctx.strokeStyle = '#fbbf24';
  ctx.beginPath();
  ctx.moveTo(-20, 18); ctx.lineTo(0, -18); ctx.lineTo(20, 18); ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = '#22d3ee';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-18, 8);
  ctx.lineTo(18, 8);
  ctx.moveTo(-12, 0);
  ctx.lineTo(12, 0);
  ctx.moveTo(-6, -8);
  ctx.lineTo(6, -8);
  ctx.stroke();
  ctx.restore();
}

function drawDockIcon(ctx, size = 72) {
  const sprite = [
    '..cc..cc..',
    '.cddccddc.',
    'cddddddddc',
    '.cddddddc.',
    '..cddddc..',
    '..cddddc..',
    '.cddccddc.',
    'cddddddddc',
    '.cddddddc.',
    '..cddcc...',
    '..cc.....'
  ];
  const palette = {
    c: '#a5b4fc',
    d: '#38bdf8'
  };
  const cols = sprite[0].length;
  const rows = sprite.length;
  const cell = size / cols;
  ctx.save();
  ctx.translate(-(cols * cell) / 2, -(rows * cell) / 2);
  for (let y = 0; y < rows; y++) {
    const row = sprite[y];
    for (let x = 0; x < cols; x++) {
      const ch = row[x];
      if (palette[ch]) {
        ctx.fillStyle = palette[ch];
        ctx.fillRect(x * cell, y * cell, cell - 0.5, cell - 0.5);
      }
    }
  }
  ctx.restore();
}

function drawBuildingPreview(canvas, building) {
  if (!canvas || !building) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(6,10,24,0.95)';
  ctx.fillRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);
  ctx.shadowColor = 'rgba(32,64,128,0.45)';
  ctx.shadowBlur = 12;
  if (window.drawInfrastructureIcon) {
    const size = Math.min(w, h) * 0.6;
    window.drawInfrastructureIcon(ctx, building, { x: 0, y: 0 }, size, 1, null);
  }
  ctx.restore();
}

function infrastructureDragBuildingId(ev) {
  let id = null;
  if (ev && ev.dataTransfer) {
    id = ev.dataTransfer.getData('text/infrastructure-building') || ev.dataTransfer.getData('text/plain');
  }
  if (!id) {
    id = infrastructureBuilder.draggingBuildingId;
  }
  if (!id) return null;
  return INFRA_BUILDING_MAP.has(id) ? id : null;
}

function handleInfrastructureCellDragEnter(ev) {
  const id = infrastructureDragBuildingId(ev);
  const cellEl = ev.currentTarget;
  const idx = Number.parseInt(cellEl.dataset.index, 10);
  const state = getActiveInfrastructureState();
  const building = INFRA_BUILDING_MAP.get(id);
  const placement = building ? validateInfrastructurePlacement(state, idx, building, infrastructureBuilder.ghostRotation) : null;
  if (!id || !state || !placement || !placement.footprint) return;
  ev.preventDefault();
  infrastructureBuilder.hoveredCell = idx;
  cellEl.classList.add('drag-over');
}

function handleInfrastructureCellDragOver(ev) {
  const id = infrastructureDragBuildingId(ev);
  const cellEl = ev.currentTarget;
  const idx = Number.parseInt(cellEl.dataset.index, 10);
  const state = getActiveInfrastructureState();
  const building = INFRA_BUILDING_MAP.get(id);
  const placement = building ? validateInfrastructurePlacement(state, idx, building, infrastructureBuilder.ghostRotation) : null;
  if (!id || !state || !placement || !placement.footprint) return;
  ev.preventDefault();
  if (ev.dataTransfer) {
    ev.dataTransfer.dropEffect = placement.valid ? 'copy' : 'none';
  }
  infrastructureBuilder.hoveredCell = idx;
}

function handleInfrastructureCellDragLeave(ev) {
  const cellEl = ev.currentTarget;
  cellEl.classList.remove('drag-over');
  const related = ev.relatedTarget;
  if (!cellEl.contains(related)) { // left the cell entirely
    const idx = Number.parseInt(cellEl.dataset.index, 10);
    if (Number.isInteger(idx) && infrastructureBuilder.hoveredCell === idx) {
      infrastructureBuilder.hoveredCell = null;
    }
  }
}

function handleInfrastructureCellDrop(ev) {
  ev.preventDefault();
  const cellEl = ev.currentTarget;
  cellEl.classList.remove('drag-over');
  const id = infrastructureDragBuildingId(ev);
  if (!id) return;
  const idx = Number.parseInt(cellEl.dataset.index, 10);
  if (!Number.isInteger(idx)) return;
  const state = getActiveInfrastructureState();
  if (!state) return;
  const building = INFRA_BUILDING_MAP.get(id);
  const placement = building ? validateInfrastructurePlacement(state, idx, building, infrastructureBuilder.ghostRotation) : null;
  if (!placement || !placement.valid) return;
  startInfrastructureBuildAtCell(state, idx, id, infrastructureBuilder.ghostRotation, placement.footprint);
  infrastructureBuilder.hoveredCell = idx;
  renderInfrastructureOverlay();
}

function infrastructureCellFromWorld(worldPos, station, layout) {
  if (!worldPos || !station || !layout) return null;
  const localX = worldPos.x - station.x;
  const localY = worldPos.y - station.y;
  const col = Math.floor((localX - layout.originOffset.x) / layout.step);
  const row = Math.floor((localY - layout.originOffset.y) / layout.step);
  if (col < 0 || row < 0 || col >= layout.cols || row >= layout.rows) return null;
  return row * layout.cols + col;
}

function getInfrastructureDragContext(ev) {
  if (!window.stationUI.editorMode || window.stationUI.tab !== 'infrastructure') return null;
  const station = window.stationUI.station || infrastructureBuilder.activeStationRef;
  if (!station) return null;
  const state = ensureInfrastructureState(station);
  const layout = state?.layout || infrastructureBuilder.layout || getInfrastructureLayout(infrastructureBuilder.gridCols, infrastructureBuilder.gridRows);
  const world = window.screenToWorld(ev.clientX ?? mouse.x, ev.clientY ?? mouse.y);
  const idx = infrastructureCellFromWorld(world, station, layout);
  if (idx == null) return null;
  return { station, state, layout, idx };
}

function handleInfrastructureCanvasDragOver(ev) {
  if (!window.stationUI.editorMode || window.stationUI.tab !== 'infrastructure') return;
  const id = infrastructureDragBuildingId(ev);
  const ctx = getInfrastructureDragContext(ev);
  if (!ctx) {
    infrastructureBuilder.hoveredCell = null;
    return;
  }
  if (!id || !ctx.state) return;
  const building = INFRA_BUILDING_MAP.get(id);
  const placement = building ? validateInfrastructurePlacement(ctx.state, ctx.idx, building, infrastructureBuilder.ghostRotation) : null;
  if (placement && placement.footprint) {
    ev.preventDefault();
    if (ev.dataTransfer) {
      ev.dataTransfer.dropEffect = placement.valid ? 'copy' : 'none';
    }
    infrastructureBuilder.hoveredCell = ctx.idx;
    infrastructureBuilder.needsRender = true;
  }
}

function handleInfrastructureCanvasDrop(ev) {
  if (!window.stationUI.editorMode || window.stationUI.tab !== 'infrastructure') return;
  const id = infrastructureDragBuildingId(ev);
  if (!id) return;
  const ctx = getInfrastructureDragContext(ev);
  if (!ctx || !ctx.state) return;
  const building = INFRA_BUILDING_MAP.get(id);
  const placement = building ? validateInfrastructurePlacement(ctx.state, ctx.idx, building, infrastructureBuilder.ghostRotation) : null;
  if (!placement || !placement.valid) return;
  ev.preventDefault();
  startInfrastructureBuildAtCell(ctx.state, ctx.idx, id, infrastructureBuilder.ghostRotation, placement.footprint);
  infrastructureBuilder.hoveredCell = ctx.idx;
  renderInfrastructureOverlay();
}

function handleInfrastructureCanvasDragLeave() {
  infrastructureBuilder.hoveredCell = null;
}

function startInfrastructureBuildAtCell(state, idx, buildingId, rotation = 0, footprintOverride = null) {
  const building = INFRA_BUILDING_MAP.get(buildingId);
  if (!state || !building) return false;
  const station = state.stationRef || window.stationUI.station || null;
  const availability = isBuildingAllowedOnStation(building, station);
  if (!availability.allowed) return false;
  const totalCells = infrastructureBuilder.gridCols * infrastructureBuilder.gridRows;
  if (idx < 0 || idx >= totalCells) return false;
  const layout = state.layout || infrastructureBuilder.layout || getInfrastructureLayout(infrastructureBuilder.gridCols, infrastructureBuilder.gridRows);
  const placement = footprintOverride ? { footprint: footprintOverride, layout } : validateInfrastructurePlacement(state, idx, building, rotation);
  if (!placement || !placement.footprint || placement.blocked || placement.occupied) return false;
  const footprint = placement.footprint;
  const normalizedRotation = Math.abs(rotation) % 2;
  const base = {
    buildingId,
    status: 'building',
    elapsed: 0,
    duration: Math.max(1, building.buildTime),
    progress: 0,
    startedAt: performance.now() / 1000,
    cellIndex: idx,
    rootIndex: idx,
    rotation: normalizedRotation,
    footprint: { w: footprint.width, h: footprint.height },
    cells: footprint.cells.map(meta => meta.index),
    gridX: layout.cells[idx]?.col ?? 0,
    gridY: layout.cells[idx]?.row ?? 0,
    localPos: { x: footprint.center.x, y: footprint.center.y },
    emitted: false
  };
  for (const meta of footprint.cells) {
    state.cells[meta.index] = base;
  }
  infrastructureBuilder.selectedCell = idx;
  infrastructureBuilder.needsRender = true;
  return true;
}

function infrastructureLocalToWorld(station, local) {
  if (!station || !local) return { x: station?.x ?? 0, y: station?.y ?? 0 };
  return { x: station.x + local.x, y: station.y + local.y };
}

function emitInfrastructureCompletion(state, idx, cell) {
  if (!state || !cell || cell.emitted) return;
  const station = state.stationRef || findStationByKey(state.stationKey);
  if (!station) return;
  const rootIdx = getRootCellIndex(state, idx);
  const meta = state.cellMeta?.[rootIdx ?? idx];
  const local = cell.localPos || meta?.local;
  if (!local) return;
  cell.localPos = { x: local.x, y: local.y };
  const worldPos = infrastructureLocalToWorld(station, cell.localPos);
  if (!window.Game.infrastructure) window.Game.infrastructure = new Map();
  let list = window.Game.infrastructure.get(state.stationKey);
  if (!list) {
    list = [];
    window.Game.infrastructure.set(state.stationKey, list);
  }
  let existing = list.find(inst => inst.cellIndex === idx);
  if (!existing) {
    existing = { cellIndex: idx };
    list.push(existing);
  }
  existing.buildingId = cell.buildingId;
  existing.stationKey = state.stationKey;
  existing.localPos = { x: cell.localPos.x, y: cell.localPos.y };
  existing.worldPos = worldPos;
  existing.stationRef = station;
  existing.footprint = cell.footprint;
  existing.rotation = cell.rotation;
  existing.status = 'completed';
  cell.emitted = true;
}

function drawInfrastructureGrid(ctx, cam, station, state) {
  if (!ctx || !cam || !station || !state) return;
  const alpha = infrastructureBuilder.editorAlpha;
  if (alpha <= 0.001) return;
  const layout = state.layout || infrastructureBuilder.layout || getInfrastructureLayout(infrastructureBuilder.gridCols, infrastructureBuilder.gridRows);
  const cellSizeWorld = layout?.cellSize ?? INFRA_CELL_WORLD_SIZE;
  const cellSize = cellSizeWorld * cam.zoom;
  const half = cellSize / 2;
  ctx.save();
  ctx.globalAlpha = alpha * 0.85;
  const processedRoots = new Set();
  for (let i = 0; i < layout.cells.length; i++) {
    const meta = layout.cells[i];
    const worldCenter = infrastructureLocalToWorld(station, meta.local);
    const screen = window.worldToScreen(worldCenter.x, worldCenter.y, cam);
    const rootIdx = getRootCellIndex(state, i);
    const rootCell = rootIdx != null ? state.cells[rootIdx] : null;
    const building = rootCell ? INFRA_BUILDING_MAP.get(rootCell.buildingId) : null;
    const blocked = !!meta.blocked;
    const done = rootCell?.status === 'completed';
    const progress = window.clamp(rootCell?.progress ?? 0, 0, 1);
    const belongsToBuilding = rootCell && rootCell.cells?.includes(meta.index);

    if (blocked) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255,110,90,0.65)';
      ctx.setLineDash([8 * cam.zoom, 6 * cam.zoom]);
      ctx.lineDashOffset = performance.now() * 0.04;
      ctx.strokeRect(screen.x - half, screen.y - half, cellSize, cellSize);
      ctx.setLineDash([]);
      continue;
    }

    if (belongsToBuilding) {
      ctx.fillStyle = done ? 'rgba(56,180,135,0.26)' : 'rgba(90,140,220,0.28)';
      ctx.fillRect(screen.x - half, screen.y - half, cellSize, cellSize);
      ctx.lineWidth = Math.max(1, 1.3 * cam.zoom);
      ctx.strokeStyle = done ? 'rgba(82,205,150,0.8)' : 'rgba(108,170,255,0.75)';
      ctx.strokeRect(screen.x - half, screen.y - half, cellSize, cellSize);
    } else {
      ctx.fillStyle = 'rgba(60,100,180,0.18)';
      ctx.fillRect(screen.x - half, screen.y - half, cellSize, cellSize);
      ctx.lineWidth = Math.max(1, 1.3 * cam.zoom);
      ctx.strokeStyle = 'rgba(130,170,255,0.35)';
      ctx.strokeRect(screen.x - half, screen.y - half, cellSize, cellSize);
    }

    if (rootCell && building && !processedRoots.has(rootIdx)) {
      processedRoots.add(rootIdx);
      const centerWorld = infrastructureLocalToWorld(station, rootCell.localPos || meta.local);
      const centerScreen = window.worldToScreen(centerWorld.x, centerWorld.y, cam);
      const footprintScale = Math.max(rootCell.footprint?.w || 1, rootCell.footprint?.h || 1);
      const iconSize = cellSize * 0.72 * footprintScale;
      ctx.globalAlpha = done ? alpha * 0.92 : alpha * 0.85;
      if (window.drawInfrastructureIcon) {
        window.drawInfrastructureIcon(ctx, building, centerScreen, iconSize, alpha, null);
      }
      if (!done) {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(96,165,250,0.85)';
        ctx.lineWidth = Math.max(1.4, cam.zoom * 2.2);
        ctx.arc(centerScreen.x, centerScreen.y, (cellSize * 0.38) * footprintScale, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
        ctx.stroke();
      }
    }
  }

  const hovered = infrastructureBuilder.hoveredCell;
  const ghostId = infrastructureBuilder.draggingBuildingId;
  if (ghostId && hovered != null) {
    const building = INFRA_BUILDING_MAP.get(ghostId);
    const placement = building ? validateInfrastructurePlacement(state, hovered, building, infrastructureBuilder.ghostRotation) : null;
    if (placement && placement.footprint) {
      const ghostAlpha = infrastructureBuilder.ghostAlpha * alpha;
      if (ghostAlpha > 0.02) {
        const blocked = placement.blocked || placement.occupied;
        ctx.globalAlpha = ghostAlpha * 0.9;
        ctx.fillStyle = blocked ? 'rgba(220,70,70,0.35)' : 'rgba(80,150,255,0.3)';
        for (const meta of placement.footprint.cells) {
          const worldCenter = infrastructureLocalToWorld(station, meta.local);
          const screen = window.worldToScreen(worldCenter.x, worldCenter.y, cam);
          ctx.fillRect(screen.x - half, screen.y - half, cellSize, cellSize);
        }
        if (!blocked) {
          const centerWorld = infrastructureLocalToWorld(station, placement.footprint.center);
          const centerScreen = window.worldToScreen(centerWorld.x, centerWorld.y, cam);
          const footprintScale = Math.max(placement.footprint.width, placement.footprint.height);
          if (window.drawInfrastructureIcon) {
            window.drawInfrastructureIcon(ctx, building, centerScreen, cellSize * 0.72 * footprintScale, ghostAlpha, null);
          }
        }
        ctx.globalAlpha = alpha * 0.85;
      }
    }
  }
  ctx.restore();
}

function drawInfrastructureInstances(ctx, cam) {
  if (!ctx || !cam || !window.Game.infrastructure) return;
  const activeKey = (window.stationUI.editorMode && window.stationUI.station) ? getInfrastructureStationKey(window.stationUI.station) : null;
  ctx.save();
  window.Game.infrastructure.forEach((list, key) => {
    if (activeKey && key === activeKey) return;
    for (const inst of list) {
      if (!inst || !inst.worldPos || !inst.buildingId) continue;
      const building = INFRA_BUILDING_MAP.get(inst.buildingId);
      if (!building) continue;
      const screen = window.worldToScreen(inst.worldPos.x, inst.worldPos.y, cam);
      const footprintScale = inst.footprint ? Math.max(inst.footprint.w || 1, inst.footprint.h || 1) : 1;
      const size = INFRA_CELL_WORLD_SIZE * cam.zoom * 0.6 * footprintScale;
      ctx.globalAlpha = 0.9;
      if (window.drawInfrastructureIcon) {
        window.drawInfrastructureIcon(ctx, building, screen, size, 0.95, inst);
      }
    }
  });
  ctx.restore();
}

function initInfrastructureUI() {
  const overlay = infrastructureBuilder.overlay;
  if (!overlay) return;
  const tabBtn = overlay.querySelector('li[data-tab="infrastructure"]');
  if (tabBtn) {
    tabBtn.addEventListener('click', () => {
      window.stationUI.open = true;
      window.stationUI.tab = 'infrastructure';
      setInfrastructureUIVisible(true);
    });
  }

  const list = infrastructureBuilder.list;
  if (list) {
    list.innerHTML = '';
    for (const building of INFRASTRUCTURE_BUILDINGS) {
      const item = document.createElement('div');
      item.className = 'infra-building';
      item.draggable = true;
      item.dataset.building = building.id;
      const canvas = document.createElement('canvas');
      canvas.width = 96;
      canvas.height = 96;
      canvas.className = 'infra-building-canvas';
      item.appendChild(canvas);
      const name = document.createElement('div');
      name.className = 'infra-building-name';
      name.textContent = building.name;
      item.appendChild(name);
      const meta = document.createElement('div');
      meta.className = 'infra-building-meta';
      const fp = buildingFootprint(building);
      meta.textContent = `Czas budowy: ${building.buildTime}s • Rozmiar: ${fp.w}×${fp.h}`;
      item.appendChild(meta);
      item.addEventListener('dragstart', (ev) => {
        item.classList.add('dragging');
        infrastructureBuilder.draggingBuildingId = building.id;
        infrastructureBuilder.ghostRotation = 0;
        if (ev.dataTransfer) {
          ev.dataTransfer.effectAllowed = 'copy';
          ev.dataTransfer.setData('text/plain', building.id);
          ev.dataTransfer.setData('text/infrastructure-building', building.id);
        }
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        infrastructureBuilder.draggingBuildingId = null;
        infrastructureBuilder.ghostRotation = 0;
        infrastructureBuilder.hoveredCell = null;
      });
      list.appendChild(item);
      drawBuildingPreview(canvas, building);
    }
  }

  const grid = infrastructureBuilder.grid;
  if (grid) {
    const layout = updateInfrastructureGridForStation(window.stationUI.station || null);
    rebuildInfrastructureGrid(layout || getInfrastructureLayout(infrastructureBuilder.gridCols, infrastructureBuilder.gridRows));
  }

  setInfrastructureUIVisible(false);
  renderInfrastructureOverlay();
}

function setInfrastructureUIVisible(visible) {
  const overlay = infrastructureBuilder.overlay;
  if (!overlay) return;
  if (visible) {
    if (infrastructureBuilder.isVisible) {
      if (window.stationUI.station) {
        setInfrastructureActiveStation(window.stationUI.station);
      }
      if (infrastructureBuilder.needsRender) {
        renderInfrastructureOverlay();
      }
      return;
    }
    if (infrastructureBuilder.hideTimer) {
      clearTimeout(infrastructureBuilder.hideTimer);
      infrastructureBuilder.hideTimer = null;
    }
    overlay.classList.remove('hidden');
    overlay.classList.remove('infra-hiding');
    void overlay.offsetWidth;
    overlay.classList.add('infra-visible');
    applyInfrastructureOverlayPosition();
    infrastructureBuilder.isVisible = true;
    if (window.stationUI.station) {
      setInfrastructureActiveStation(window.stationUI.station);
    }
    renderInfrastructureOverlay();
  } else {
    if (!infrastructureBuilder.isVisible) {
      overlay.classList.add('hidden');
      return;
    }
    overlay.classList.remove('infra-visible');
    overlay.classList.add('infra-hiding');
    infrastructureBuilder.isVisible = false;
    if (infrastructureBuilder.hideTimer) {
      clearTimeout(infrastructureBuilder.hideTimer);
    }
    infrastructureBuilder.hideTimer = setTimeout(() => {
      overlay.classList.add('hidden');
      overlay.classList.remove('infra-hiding');
    }, 220);
    infrastructureBuilder.hoveredCell = null;
    infrastructureBuilder.draggingOverlay = false;
    overlay.classList.remove('dragging');
  }
}

function renderInfrastructureInfo(state, uniqueRoots = new Set(), completedRoots = new Set()) {
  const info = infrastructureBuilder.info;
  if (!info) return;
  info.innerHTML = '';
  const station = infrastructureBuilder.activeStationRef || window.stationUI.station;
  const title = document.createElement('h4');
  title.textContent = station?.name ? `Infrastruktura: ${station.name}` : 'Budowa stacji';
  info.appendChild(title);

  if (!state) {
    const p = document.createElement('p');
    p.textContent = 'Brak aktywnej stacji. Wybierz stację, aby rozpocząć budowę.';
    info.appendChild(p);
    return;
  }

  const totalUsed = uniqueRoots.size || state.cells.filter(Boolean).length;
  const completed = completedRoots.size || state.cells.filter(cell => cell && cell.status === 'completed').length;

  if (infrastructureBuilder.selectedCell == null) {
    const p = document.createElement('p');
    p.textContent = 'Przeciągnij budynek z listy na siatkę wokół stacji, aby rozpocząć budowę.';
    info.appendChild(p);
    const summary = document.createElement('p');
    summary.textContent = `Ukończone budynki: ${completed}/${totalUsed}.`;
    summary.style.fontSize = '12px';
    summary.style.color = '#94a9d6';
    info.appendChild(summary);
    return;
  }

  const idx = getRootCellIndex(state, infrastructureBuilder.selectedCell ?? 0);
  const meta = state.cellMeta?.[idx ?? 0];
  if (!meta) {
    const p = document.createElement('p');
    p.textContent = 'Nie można odczytać danych pola. Odśwież interfejs.';
    info.appendChild(p);
    return;
  }
  const cell = getRootCell(state, idx);
  const local = cell?.localPos || meta.local;
  if (cell && !cell.localPos && local) {
    cell.localPos = { x: local.x, y: local.y };
  }
  if (meta.blocked && !cell) {
    const p = document.createElement('p');
    p.textContent = 'Rdzeń stacji — strefa serwisowa niedostępna dla infrastruktury.';
    info.appendChild(p);
    const coords = document.createElement('p');
    coords.textContent = `Położenie rdzenia: Δx ${Math.round(local?.x ?? 0)}, Δy ${Math.round(local?.y ?? 0)}.`;
    coords.style.fontSize = '12px';
    coords.style.color = '#94a9d6';
    info.appendChild(coords);
    return;
  }
  if (!cell) {
    const p = document.createElement('p');
    p.textContent = 'Puste pole. Upuść budynek z listy po lewej, aby rozpocząć konstrukcję.';
    info.appendChild(p);
    if (local) {
      const coords = document.createElement('p');
      coords.textContent = `Położenie względem centrum: Δx ${Math.round(local.x)}, Δy ${Math.round(local.y)}.`;
      coords.style.fontSize = '12px';
      coords.style.color = '#94a9d6';
      info.appendChild(coords);
    }
    return;
  }

  const building = INFRA_BUILDING_MAP.get(cell.buildingId);
  const name = document.createElement('p');
  name.textContent = building?.name || 'Budowa';
  name.style.fontWeight = '600';
  info.appendChild(name);

  const status = document.createElement('p');
  const progress = cell.status === 'completed' ? 1 : window.clamp(cell.progress ?? 0, 0, 1);
  if (cell.status === 'completed') {
    status.textContent = 'Status: Zakończono budowę.';
  } else {
    const remaining = Math.max(0, (cell.duration ?? 0) - (cell.elapsed ?? 0));
    status.textContent = `Status: W budowie — ${Math.round(progress * 100)}% (pozostało ${remaining.toFixed(1)}s).`;
  }
  info.appendChild(status);

  const buildTime = document.createElement('p');
  buildTime.textContent = `Czas budowy: ${building?.buildTime ?? '?'} s`;
  buildTime.style.fontSize = '13px';
  buildTime.style.color = '#a8b4d9';
  info.appendChild(buildTime);

  if (cell.footprint) {
    const fp = cell.footprint;
    const footprint = document.createElement('p');
    footprint.textContent = `Zajętość siatki: ${fp.w}×${fp.h}`;
    footprint.style.fontSize = '12px';
    footprint.style.color = '#94a9d6';
    info.appendChild(footprint);
  }

  if (local) {
    const coords = document.createElement('p');
    coords.textContent = `Położenie względem stacji: Δx ${Math.round(local.x)}, Δy ${Math.round(local.y)}.`;
    coords.style.fontSize = '12px';
    coords.style.color = '#94a9d6';
    info.appendChild(coords);
  }

  const progressWrap = document.createElement('div');
  progressWrap.className = 'infra-info-progress';
  const strong = document.createElement('strong');
  strong.textContent = 'Postęp';
  progressWrap.appendChild(strong);
  const bar = document.createElement('div');
  bar.className = 'infra-progress-bar';
  const fill = document.createElement('div');
  fill.className = 'infra-progress-fill';
  fill.style.width = `${Math.round(progress * 100)}%`;
  bar.appendChild(fill);
  progressWrap.appendChild(bar);
  info.appendChild(progressWrap);
}

function renderInfrastructureOverlay() {
  const station = infrastructureBuilder.activeStationRef || window.stationUI.station;
  const state = station ? ensureInfrastructureState(station) : null;
  if (station && !infrastructureBuilder.activeStationRef) {
    infrastructureBuilder.activeStationRef = station;
  }
  const uniqueRoots = new Set();
  const completedRoots = new Set();
  if (state) {
    state.cells.forEach((cell, idx) => {
      if (!cell) return;
      const rootIdx = getRootCellIndex(state, idx) ?? idx;
      uniqueRoots.add(rootIdx);
      if (cell.status === 'completed') completedRoots.add(rootIdx);
    });
  }
  infrastructureBuilder.needsRender = false;
  renderInfrastructureInfo(state || null, uniqueRoots, completedRoots);
}

function renderInfrastructureTab() {
  uiTitle('Infrastruktura stacji');
  const station = window.stationUI.station;
  if (!station) {
    uiText('Brak aktywnej stacji.');
    return;
  }
  const state = ensureInfrastructureState(station);
  const totalUsed = state.cells.filter(Boolean).length;
  const completed = state.cells.filter(cell => cell && cell.status === 'completed').length;
  uiText('Zarządzaj infrastrukturą w panelu Infrastructure obok.');
  uiText(`Budowy ukończone: ${completed}/${totalUsed}.`);
  uiText('Przeciągnij budynek na siatkę, aby rozpocząć konstrukcję lub kliknij pole, by zobaczyć postęp.');
}

function updateInfrastructureEditorState(dt) {
  const target = window.stationUI.editorMode ? 1 : 0;
  if (target > infrastructureBuilder.editorAlpha) {
    infrastructureBuilder.editorAlpha = Math.min(target, infrastructureBuilder.editorAlpha + dt * 4.2);
  } else if (target < infrastructureBuilder.editorAlpha) {
    infrastructureBuilder.editorAlpha = Math.max(target, infrastructureBuilder.editorAlpha - dt * 5.6);
    if (infrastructureBuilder.editorAlpha <= 0.001) {
      infrastructureBuilder.editorAlpha = 0;
      infrastructureBuilder.hoveredCell = null;
    }
  }

  const ghostTarget = infrastructureBuilder.draggingBuildingId ? 1 : 0;
  if (ghostTarget > infrastructureBuilder.ghostAlpha) {
    infrastructureBuilder.ghostAlpha = Math.min(ghostTarget, infrastructureBuilder.ghostAlpha + dt * 10);
  } else if (ghostTarget < infrastructureBuilder.ghostAlpha) {
    infrastructureBuilder.ghostAlpha = Math.max(ghostTarget, infrastructureBuilder.ghostAlpha - dt * 8);
  }
}

function updateInfrastructureState(dt) {
  let changed = false;
  infrastructureBuilder.stationStates.forEach(state => {
    if (!state || !state.cells) return;
    const processed = new Set();
    const buildingCounts = {};
    state.cells.forEach((cell, idx) => {
      if (!cell) return;
      const rootIdx = getRootCellIndex(state, idx);
      if (rootIdx == null || processed.has(rootIdx)) return;
      processed.add(rootIdx);
      if (cell.status === 'building') {
        const prev = cell.progress || 0;
        cell.elapsed = (cell.elapsed || 0) + dt;
        const duration = Math.max(0.1, cell.duration || 1);
        cell.progress = window.clamp(cell.elapsed / duration, 0, 1);
        if (cell.progress !== prev) changed = true;
        if (cell.progress >= 1 && cell.status !== 'completed') {
          cell.status = 'completed';
          changed = true;
        }
      }
      if (cell.status === 'completed') {
        buildingCounts[cell.buildingId] = (buildingCounts[cell.buildingId] || 0) + 1;
      }
      if (cell.status === 'completed' && !cell.emitted) {
        emitInfrastructureCompletion(state, rootIdx, cell);
        changed = true;
      }
    });
    updateStationEconomyFromBuildings(state, buildingCounts, dt);
  });
  if (changed) {
    if (infrastructureBuilder.isVisible) {
      renderInfrastructureOverlay();
    } else {
      infrastructureBuilder.needsRender = true;
    }
  } else if (infrastructureBuilder.isVisible && infrastructureBuilder.needsRender) {
    renderInfrastructureOverlay();
  }
}

function syncInfrastructureWorldPositions() {
  if (!window.Game.infrastructure) return;
  window.Game.infrastructure.forEach((list, key) => {
    const station = findStationByKey(key);
    if (!station) return;
    for (const inst of list) {
      if (!inst || !inst.localPos) continue;
      inst.stationRef = station;
      inst.worldPos = infrastructureLocalToWorld(station, inst.localPos);
    }
  });
}

function populateStationInfrastructureDefaults(station, preset) {
  if (!station || !preset) return false;
  const state = ensureInfrastructureState(station);
  if (!state || infrastructureHasBuildings(state)) return false;
  const stationKey = getInfrastructureStationKey(station);
  const existingList = stationKey && window.Game.infrastructure ? window.Game.infrastructure.get(stationKey) : null;
  if (existingList && existingList.length) return false;
  const layout = state.layout || infrastructureBuilder.layout || getInfrastructureLayout(infrastructureBuilder.gridCols, infrastructureBuilder.gridRows);
  if (!layout) return false;

  const bandBase = Math.floor(Math.min(layout.cols, layout.rows) / 4);
  const midBand = Math.max(bandBase, INFRA_STATION_CORE_SIZE + 3);
  const farBand = Math.max(Math.floor(Math.min(layout.cols, layout.rows) / 3), midBand + 2);

  const plans = {
    mercury: [
      { id: 'metal_harvester', offset: { col: -midBand, row: 0 }, rotation: 0 },
      { id: 'metal_harvester', offset: { col: midBand, row: 0 }, rotation: 0 },
      { id: 'metal_refinery', offset: { col: 0, row: -midBand }, rotation: 0 },
      { id: 'metal_refinery', offset: { col: 0, row: midBand }, rotation: 0 },
      { id: 'solar_array', offset: { col: -midBand + 1, row: midBand - 1 }, rotation: 0 },
      { id: 'solar_array', offset: { col: midBand - 1, row: midBand - 1 }, rotation: 0 },
    ],
    earth: [
      { id: 'shipyard_capital', offset: { col: midBand + 2, row: 0 }, rotation: 0 },
      { id: 'shipyard_l', offset: { col: -(midBand + 2), row: 0 }, rotation: 0 },
      { id: 'shipyard_m', offset: { col: 0, row: -midBand }, rotation: 0 },
      { id: 'shipyard_s', offset: { col: -2, row: midBand - 1 }, rotation: 0 },
      { id: 'shipyard_s', offset: { col: 2, row: midBand - 1 }, rotation: 0 },
      { id: 'solar_array', offset: { col: -midBand + 1, row: -(midBand + 1) }, rotation: 0 },
      { id: 'solar_array', offset: { col: midBand - 1, row: -(midBand + 1) }, rotation: 0 },
      { id: 'solar_array', offset: { col: 0, row: midBand }, rotation: 0 },
      { id: 'storage_metal', offset: { col: -farBand, row: -farBand }, rotation: 0 },
      { id: 'storage_metal', offset: { col: -farBand, row: farBand }, rotation: 0 },
      { id: 'storage_fuel', offset: { col: farBand, row: -farBand }, rotation: 0 },
      { id: 'storage_fuel', offset: { col: farBand, row: farBand }, rotation: 0 },
      { id: 'storage_gas', offset: { col: -(farBand + 2), row: 0 }, rotation: 0 },
      { id: 'storage_gas', offset: { col: farBand + 2, row: 0 }, rotation: 0 },
      { id: 'storage_plastics', offset: { col: 0, row: -(farBand + 2) }, rotation: 0 },
      { id: 'storage_plastics', offset: { col: 0, row: farBand + 2 }, rotation: 0 },
    ],
    mars: [
      { id: 'shipyard_l', offset: { col: midBand, row: 0 }, rotation: 0 },
      { id: 'solar_array', offset: { col: -midBand + 1, row: -(midBand + 1) }, rotation: 0 },
      { id: 'solar_array', offset: { col: midBand - 1, row: midBand - 1 }, rotation: 0 },
      { id: 'metal_harvester', offset: { col: -farBand, row: -farBand }, rotation: 0 },
      { id: 'metal_refinery', offset: { col: farBand, row: farBand }, rotation: 0 },
      { id: 'storage_metal', offset: { col: -farBand, row: 0 }, rotation: 0 },
      { id: 'storage_fuel', offset: { col: 0, row: -farBand }, rotation: 0 },
      { id: 'storage_gas', offset: { col: farBand, row: 0 }, rotation: 0 },
      { id: 'storage_plastics', offset: { col: 0, row: farBand }, rotation: 0 },
    ],
    jupiter: [
      { id: 'gas_harvester', offset: { col: -farBand, row: -farBand }, rotation: 0 },
      { id: 'gas_harvester', offset: { col: farBand, row: -farBand }, rotation: 0 },
      { id: 'gas_harvester', offset: { col: -farBand, row: farBand }, rotation: 0 },
      { id: 'gas_harvester', offset: { col: farBand, row: farBand }, rotation: 0 },
      { id: 'gas_refinery', offset: { col: midBand, row: 0 }, rotation: 0 },
      { id: 'gas_refinery', offset: { col: -midBand, row: 0 }, rotation: 0 },
      { id: 'storage_fuel', offset: { col: 0, row: -(midBand + 2) }, rotation: 0 },
    ]
  };

  const plan = plans[preset];
  if (!Array.isArray(plan)) return false;

  let placedAny = false;
  for (const step of plan) {
    const success = autoplaceBuildingByOffset(state, step.id, step.offset.col, step.offset.row, step.rotation || 0);
    placedAny = placedAny || success;
  }
  return placedAny;
}

function autopopulateDefaultInfrastructure() {
  if (!Array.isArray(window.stations) || !stations.length) return;
  let changed = false;
  for (const st of (window.stations || [])) {
    if (!st || !st.id) continue;
    const key = st.id.toLowerCase();
    if (key === 'mercury') changed = populateStationInfrastructureDefaults(st, 'mercury') || changed;
    if (key === 'earth') changed = populateStationInfrastructureDefaults(st, 'earth') || changed;
    if (key === 'mars') changed = populateStationInfrastructureDefaults(st, 'mars') || changed;
    if (key === 'jupiter') changed = populateStationInfrastructureDefaults(st, 'jupiter') || changed;
  }
  if (changed) {
    updateInfrastructureState(0.001);
    syncInfrastructureWorldPositions();
  }
}

// Public API
export const InfrastructureUI = {
  get builder() { return infrastructureBuilder; },
  getBuilder() { return infrastructureBuilder; },
  BUILDINGS: INFRASTRUCTURE_BUILDINGS,
  BUILDING_MAP: INFRA_BUILDING_MAP,
  init(gameCanvas) {
    if (gameCanvas) {
      gameCanvas.addEventListener("dragover", handleInfrastructureCanvasDragOver);
      gameCanvas.addEventListener("drop", handleInfrastructureCanvasDrop);
      gameCanvas.addEventListener("dragleave", handleInfrastructureCanvasDragLeave);
    }
    initInfrastructureUI();
  },
  updateEditorState: updateInfrastructureEditorState,
  update: updateInfrastructureState,
  syncWorldPositions: syncInfrastructureWorldPositions,
  autopopulate: autopopulateDefaultInfrastructure,
  drawGrid: drawInfrastructureGrid,
  drawInstances: drawInfrastructureInstances,
  ensureState: ensureInfrastructureState,
  getLayout: getInfrastructureLayout,
  setActiveStation: setInfrastructureActiveStation,
  setVisible: setInfrastructureUIVisible,
  hasBuildings: infrastructureHasBuildings,
  ensureEconomy: ensureStationEconomy,
};
