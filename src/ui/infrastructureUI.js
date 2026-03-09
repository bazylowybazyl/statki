// src/ui/infrastructureUI.js

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
  gas: { label: 'Gaz' }, fuel: { label: 'Paliwo' },
  rawMetal: { label: 'Surowy metal' }, refinedMetal: { label: 'Rafinowany metal' }
};
const ECONOMY_RESOURCE_KEYS = Object.keys(ECONOMY_RESOURCES);
const ECONOMY_BASE_CAPACITY = { gas: 60, fuel: 90, rawMetal: 140, refinedMetal: 100 };
const ECONOMY_STORAGE_BONUS = {
  storage_gas: { gas: 260 }, storage_fuel: { fuel: 240 }, storage_metal: { rawMetal: 320, refinedMetal: 240 }
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

export const infrastructureBuilder = {
  overlay: null, list: null, grid: null, info: null,
  gridCols: INFRA_MIN_GRID, gridRows: INFRA_MIN_GRID,
  gridCells: [], stationStates: new Map(),
  selectedCell: null, activeStationKey: null, activeStationRef: null,
  hideTimer: null, isVisible: false, needsRender: false,
  hoveredCell: null, draggingBuildingId: null, draggingOverlay: false,
  overlayOffset: { x: 0, y: 0 }, overlayPosition: null,
  editorAlpha: 0, ghostAlpha: 0, ghostRotation: 0, layout: null,
  layoutCache: null, layoutKey: ''
};

function getInfrastructureLayout(cols, rows) {
  const key = `${cols}x${rows}`;
  if (!infrastructureBuilder.layoutCache || infrastructureBuilder.layoutKey !== key) {
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
    infrastructureBuilder.layoutCache = {
      cellSize: INFRA_CELL_WORLD_SIZE, cellGap: INFRA_CELL_WORLD_GAP, step: INFRA_CELL_WORLD_STEP,
      cols, rows, originOffset, width, height, cells, centerIndex,
      core: { startCol: coreStartCol, startRow: coreStartRow, indices: coreIndices }
    };
    infrastructureBuilder.layoutKey = key;
  }
  return infrastructureBuilder.layoutCache;
}

function computeInfrastructureGridSize(station) {
  const planet = station?.planet;
  const orbitRadii = planet ? window.planetOrbitRadii(planet) : null;
  const innerOrbitRadius = orbitRadii?.inner || Math.max(1200, (station?.r || 0) * 10);
  const squareSide = innerOrbitRadius * Math.SQRT2;
  const approximateCols = Math.floor(squareSide / INFRA_CELL_WORLD_STEP);
  let cols = Math.max(INFRA_MIN_GRID, Math.min(INFRA_MAX_GRID, approximateCols));
  if (cols % 2 !== 0) cols += 1; 
  return { cols, rows: cols };
}

function getInfrastructureStationKey(station) {
  if (!station) return null;
  if (station.id != null) return `station-${station.id}`;
  if (station.name) return `station-${station.name}`;
  return `station-${Math.round(station.x ?? 0)}-${Math.round(station.y ?? 0)}`;
}

function findStationByKey(key) {
  if (!key) return null;
  for (const st of window.stations) {
    if (getInfrastructureStationKey(st) === key) return st;
  }
  return null;
}

function updateInfrastructureGridForStation(station) {
  const size = computeInfrastructureGridSize(station);
  const changed = size && (size.cols !== infrastructureBuilder.gridCols || size.rows !== infrastructureBuilder.gridRows);
  if (changed) {
    infrastructureBuilder.gridCols = size.cols;
    infrastructureBuilder.gridRows = size.rows;
    infrastructureBuilder.layoutCache = null;
    infrastructureBuilder.layoutKey = '';
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
    canvas.width = 96; canvas.height = 96;
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
      const state = InfrastructureUI.ensureState();
      const rootIdx = state ? getRootCellIndex(state, i) : null;
      infrastructureBuilder.selectedCell = rootIdx != null ? rootIdx : i;
      renderInfrastructureOverlay();
    });
    infrastructureBuilder.gridCells.push(cell);
    grid.appendChild(cell);
  }
}

function getRootCellIndex(state, idx) {
  if (!state || !state.cells || !Number.isInteger(idx)) return null;
  const cell = state.cells[idx];
  return (cell && Number.isInteger(cell.rootIndex)) ? cell.rootIndex : idx;
}

function getRootCell(state, idx) {
  const rootIdx = getRootCellIndex(state, idx);
  return rootIdx == null ? null : (state.cells[rootIdx] || null);
}

function buildingFootprint(building, rotation = 0) {
  const base = building?.footprint || { w: 1, h: 1 };
  return (rotation % 2 !== 0) ? { w: base.h, h: base.w } : { ...base };
}

function computeFootprintCells(layout, anchorIdx, building, rotation) {
  if (!layout || !layout.cells || !building || !Number.isInteger(anchorIdx)) return null;
  const anchorMeta = layout.cells[anchorIdx];
  if (!anchorMeta) return null;
  const fp = buildingFootprint(building, rotation);
  if (anchorMeta.col + fp.w > layout.cols || anchorMeta.row + fp.h > layout.rows) return null;
  
  const cells = [];
  for (let dy = 0; dy < fp.h; dy++) {
    for (let dx = 0; dx < fp.w; dx++) {
      const idx = (anchorMeta.row + dy) * layout.cols + (anchorMeta.col + dx);
      if (layout.cells[idx]) cells.push(layout.cells[idx]);
    }
  }
  const center = cells.reduce((acc, meta) => { acc.x += meta.local.x; acc.y += meta.local.y; return acc; }, { x: 0, y: 0 });
  center.x /= cells.length; center.y /= cells.length;
  return { cells, width: fp.w, height: fp.h, center };
}

function isBuildingAllowedOnStation(building, station) {
  if (!building) return { allowed: false, reason: 'Brak definicji.' };
  if (building.requiresSolarSystem && !window.USE_SOLAR) return { allowed: false, reason: 'Wymaga Ukladu Slonecznego.' };
  if (Array.isArray(building.allowedPlanetTypes) && building.allowedPlanetTypes.length) {
    const pType = station?.planet?.type?.toLowerCase();
    if (!pType || !building.allowedPlanetTypes.includes(pType)) return { allowed: false, reason: 'Niewłaściwy typ planety.' };
  }
  return { allowed: true, reason: null };
}

function validateInfrastructurePlacement(state, anchorIdx, building, rotation) {
  const layout = state?.layout || infrastructureBuilder.layout || getInfrastructureLayout(infrastructureBuilder.gridCols, infrastructureBuilder.gridRows);
  const station = state?.stationRef || window.stationUI.station || null;
  const avail = isBuildingAllowedOnStation(building, station);
  if (!avail.allowed) return { valid: false, footprint: null, reason: avail.reason };
  
  const fp = computeFootprintCells(layout, anchorIdx, building, rotation);
  if (!layout || !fp) return { valid: false, footprint: null };
  const blocked = fp.cells.some(m => m.blocked);
  const occupied = fp.cells.some(m => state.cells?.[m.index]);
  return { valid: !blocked && !occupied, blocked, occupied, layout, footprint: fp };
}

function startInfrastructureBuildAtCell(state, idx, buildingId, rotation = 0, footprintOverride = null) {
  const building = INFRA_BUILDING_MAP.get(buildingId);
  if (!state || !building) return false;
  const layout = state.layout || infrastructureBuilder.layout;
  const placement = footprintOverride ? { footprint: footprintOverride, layout } : validateInfrastructurePlacement(state, idx, building, rotation);
  if (!placement || !placement.footprint || placement.blocked || placement.occupied) return false;
  
  const fp = placement.footprint;
  const duration = Math.max(1, building.buildTime);
  const base = {
    buildingId, status: 'building', elapsed: 0, duration, progress: 0,
    startedAt: performance.now() / 1000, cellIndex: idx, rootIndex: idx,
    rotation: Math.abs(rotation) % 2, footprint: { w: fp.width, h: fp.height },
    cells: fp.cells.map(m => m.index),
    gridX: layout.cells[idx]?.col ?? 0, gridY: layout.cells[idx]?.row ?? 0,
    localPos: { x: fp.center.x, y: fp.center.y }, emitted: false
  };
  
  for (const m of fp.cells) state.cells[m.index] = base;
  infrastructureBuilder.selectedCell = idx;
  infrastructureBuilder.needsRender = true;
  return true;
}

// --- Drag & Drop Handlery ---
function infrastructureDragBuildingId(ev) {
  let id = ev?.dataTransfer?.getData('text/infrastructure-building') || ev?.dataTransfer?.getData('text/plain') || infrastructureBuilder.draggingBuildingId;
  return INFRA_BUILDING_MAP.has(id) ? id : null;
}

function handleInfrastructureCellDragEnter(ev) {
  const id = infrastructureDragBuildingId(ev);
  if (!id) return;
  ev.preventDefault();
  infrastructureBuilder.hoveredCell = Number.parseInt(ev.currentTarget.dataset.index, 10);
  ev.currentTarget.classList.add('drag-over');
}
function handleInfrastructureCellDragOver(ev) {
  const id = infrastructureDragBuildingId(ev);
  if (!id) return;
  ev.preventDefault();
  const placement = validateInfrastructurePlacement(InfrastructureUI.ensureState(), Number.parseInt(ev.currentTarget.dataset.index, 10), INFRA_BUILDING_MAP.get(id), infrastructureBuilder.ghostRotation);
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = placement?.valid ? 'copy' : 'none';
}
function handleInfrastructureCellDragLeave(ev) {
  ev.currentTarget.classList.remove('drag-over');
}
function handleInfrastructureCellDrop(ev) {
  ev.preventDefault();
  ev.currentTarget.classList.remove('drag-over');
  const id = infrastructureDragBuildingId(ev);
  const idx = Number.parseInt(ev.currentTarget.dataset.index, 10);
  if (!id || !Number.isInteger(idx)) return;
  const state = InfrastructureUI.ensureState();
  const placement = validateInfrastructurePlacement(state, idx, INFRA_BUILDING_MAP.get(id), infrastructureBuilder.ghostRotation);
  if (placement?.valid) {
    startInfrastructureBuildAtCell(state, idx, id, infrastructureBuilder.ghostRotation, placement.footprint);
    infrastructureBuilder.hoveredCell = idx;
    renderInfrastructureOverlay();
  }
}

function infrastructureCellFromWorld(worldPos, station, layout) {
  if (!worldPos || !station || !layout) return null;
  const col = Math.floor(((worldPos.x - station.x) - layout.originOffset.x) / layout.step);
  const row = Math.floor(((worldPos.y - station.y) - layout.originOffset.y) / layout.step);
  if (col < 0 || row < 0 || col >= layout.cols || row >= layout.rows) return null;
  return row * layout.cols + col;
}

export const InfrastructureUI = {
  
  init(canvas) {
    infrastructureBuilder.overlay = document.getElementById('infrastructure-overlay');
    infrastructureBuilder.list = document.getElementById('infra-building-list');
    infrastructureBuilder.grid = document.getElementById('infra-grid');
    infrastructureBuilder.info = document.getElementById('infra-info');

    if (infrastructureBuilder.list) {
      infrastructureBuilder.list.innerHTML = '';
      for (const building of INFRASTRUCTURE_BUILDINGS) {
        const item = document.createElement('div');
        item.className = 'infra-building'; item.draggable = true; item.dataset.building = building.id;
        const cvs = document.createElement('canvas'); cvs.width = 96; cvs.height = 96;
        item.appendChild(cvs);
        const name = document.createElement('div'); name.className = 'infra-building-name'; name.textContent = building.name;
        item.appendChild(name);
        const meta = document.createElement('div'); meta.className = 'infra-building-meta';
        meta.textContent = `Czas: ${building.buildTime}s • Rozmiar: ${building.footprint.w}×${building.footprint.h}`;
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
          infrastructureBuilder.hoveredCell = null;
        });
        infrastructureBuilder.list.appendChild(item);
        
        // Draw icon
        const ctx = cvs.getContext('2d');
        ctx.fillStyle = 'rgba(6,10,24,0.95)'; ctx.fillRect(0,0,96,96);
        ctx.translate(48, 48);
        if (window.drawInfrastructureIcon) window.drawInfrastructureIcon(ctx, building, {x:0, y:0}, 57);
      }
    }

    if (canvas) {
      canvas.addEventListener('dragover', (ev) => {
        if (!window.stationUI?.editorMode || window.stationUI?.tab !== 'infrastructure') return;
        const id = infrastructureDragBuildingId(ev);
        const st = window.stationUI.station;
        if (!st || !id) return;
        const layout = this.ensureState(st)?.layout;
        const idx = infrastructureCellFromWorld(window.screenToWorld(ev.clientX, ev.clientY), st, layout);
        if (idx == null) { infrastructureBuilder.hoveredCell = null; return; }
        
        const placement = validateInfrastructurePlacement(this.ensureState(st), idx, INFRA_BUILDING_MAP.get(id), infrastructureBuilder.ghostRotation);
        if (placement?.valid) {
          ev.preventDefault();
          if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
          infrastructureBuilder.hoveredCell = idx;
          infrastructureBuilder.needsRender = true;
        }
      });
      canvas.addEventListener('drop', (ev) => {
        if (!window.stationUI?.editorMode || window.stationUI?.tab !== 'infrastructure') return;
        const id = infrastructureDragBuildingId(ev);
        const st = window.stationUI.station;
        if (!st || !id) return;
        const layout = this.ensureState(st)?.layout;
        const idx = infrastructureCellFromWorld(window.screenToWorld(ev.clientX, ev.clientY), st, layout);
        if (idx == null) return;

        const state = this.ensureState(st);
        const placement = validateInfrastructurePlacement(state, idx, INFRA_BUILDING_MAP.get(id), infrastructureBuilder.ghostRotation);
        if (placement?.valid) {
          ev.preventDefault();
          startInfrastructureBuildAtCell(state, idx, id, infrastructureBuilder.ghostRotation, placement.footprint);
          infrastructureBuilder.hoveredCell = idx;
          renderInfrastructureOverlay();
        }
      });
      canvas.addEventListener('dragleave', () => { infrastructureBuilder.hoveredCell = null; });
    }

    window.addEventListener('wheel', (ev) => {
      if (!infrastructureBuilder.draggingBuildingId || !window.stationUI?.open || window.stationUI?.tab !== 'infrastructure') return;
      const b = INFRA_BUILDING_MAP.get(infrastructureBuilder.draggingBuildingId);
      if (b && (b.rotatable || b.footprint.w !== b.footprint.h)) {
        ev.preventDefault();
        infrastructureBuilder.ghostRotation = (infrastructureBuilder.ghostRotation + (ev.deltaY > 0 ? 1 : -1) + 2) % 2;
        infrastructureBuilder.needsRender = true;
      }
    }, { passive: false });
  },

  ensureState(station = window.stationUI?.station) {
    const key = getInfrastructureStationKey(station);
    if (!key) return null;
    const layout = updateInfrastructureGridForStation(station);
    let state = infrastructureBuilder.stationStates.get(key);
    if (!state) {
      state = { stationKey: key, stationRef: station, cells: Array.from({ length: layout.cols * layout.rows }, () => null), cellMeta: layout.cells, layout, centerIndex: layout.centerIndex };
      infrastructureBuilder.stationStates.set(key, state);
    } else {
      state.layout = layout; state.cellMeta = layout.cells;
      if (station) state.stationRef = station;
    }
    return state;
  },

  setVisible(visible) {
    const overlay = infrastructureBuilder.overlay;
    if (!overlay) return;
    if (visible) {
      if (infrastructureBuilder.isVisible) {
        if (window.stationUI?.station) this.ensureState(window.stationUI.station);
        if (infrastructureBuilder.needsRender) renderInfrastructureOverlay();
        return;
      }
      clearTimeout(infrastructureBuilder.hideTimer);
      overlay.classList.remove('hidden', 'infra-hiding');
      overlay.classList.add('infra-visible');
      infrastructureBuilder.isVisible = true;
      renderInfrastructureOverlay();
    } else {
      if (!infrastructureBuilder.isVisible) return;
      overlay.classList.remove('infra-visible');
      overlay.classList.add('infra-hiding');
      infrastructureBuilder.isVisible = false;
      infrastructureBuilder.hideTimer = setTimeout(() => overlay.classList.add('hidden'), 220);
      infrastructureBuilder.hoveredCell = null;
    }
  },

  update(dt) {
    let changed = false;
    infrastructureBuilder.stationStates.forEach(state => {
      if (!state || !state.cells) return;
      const processed = new Set();
      const bCounts = {};
      state.cells.forEach((cell, idx) => {
        if (!cell) return;
        const rootIdx = getRootCellIndex(state, idx);
        if (rootIdx == null || processed.has(rootIdx)) return;
        processed.add(rootIdx);
        
        if (cell.status === 'building') {
          const prev = cell.progress || 0;
          cell.elapsed = (cell.elapsed || 0) + dt;
          cell.progress = window.clamp(cell.elapsed / Math.max(0.1, cell.duration || 1), 0, 1);
          if (cell.progress !== prev) changed = true;
          if (cell.progress >= 1) { cell.status = 'completed'; changed = true; }
        }
        
        if (cell.status === 'completed') {
          bCounts[cell.buildingId] = (bCounts[cell.buildingId] || 0) + 1;
          if (!cell.emitted) {
             // Emit to World
             const worldPos = { x: state.stationRef.x + cell.localPos.x, y: state.stationRef.y + cell.localPos.y };
             if (!window.Game.infrastructure) window.Game.infrastructure = new Map();
             let list = window.Game.infrastructure.get(state.stationKey) || [];
             list.push({ cellIndex: rootIdx, buildingId: cell.buildingId, worldPos, stationRef: state.stationRef, footprint: cell.footprint, rotation: cell.rotation, status: 'completed' });
             window.Game.infrastructure.set(state.stationKey, list);
             cell.emitted = true;
             changed = true;
          }
        }
      });
      
      // Update economy
      if (!window.Game.stationEconomy) window.Game.stationEconomy = new Map();
      let econ = window.Game.stationEconomy.get(state.stationKey);
      if (!econ) {
        econ = { resources: { gas: 0, fuel: 0, rawMetal: 0, refinedMetal: 0 }, capacity: { ...ECONOMY_BASE_CAPACITY }, timer: 0 };
        window.Game.stationEconomy.set(state.stationKey, econ);
      }
      
      // Proste przeliczanie zysków co tick
      econ.timer += dt;
      if (econ.timer >= ECONOMY_TICK_SECONDS) {
         econ.timer = 0;
         for (const [bId, rule] of Object.entries(ECONOMY_BUILDING_RULES)) {
            const count = bCounts[bId] || 0;
            if (!count) continue;
            // Uproszczona logika dla czystości:
            if (rule.produce) {
                for (const [res, amt] of Object.entries(rule.produce)) {
                    econ.resources[res] = Math.min(econ.resources[res] + amt * count, econ.capacity[res] || 9999);
                }
            }
         }
      }
    });

    if (changed && infrastructureBuilder.isVisible) renderInfrastructureOverlay();
  },

  updateEditorState(dt) {
    const target = window.stationUI?.editorMode ? 1 : 0;
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
  },

  drawGrid(ctx, cam, station, state) {
    const alpha = infrastructureBuilder.editorAlpha;
    if (alpha <= 0.001 || !state || !state.layout) return;
    const layout = state.layout;
    const cellSize = layout.cellSize * cam.zoom;
    const half = cellSize / 2;
    
    ctx.save();
    ctx.globalAlpha = alpha * 0.85;
    const processedRoots = new Set();
    
    for (let i = 0; i < layout.cells.length; i++) {
      const meta = layout.cells[i];
      const worldCenter = { x: station.x + meta.local.x, y: station.y + meta.local.y };
      const screen = window.worldToScreen(worldCenter.x, worldCenter.y, cam);
      const rootIdx = getRootCellIndex(state, i);
      const rootCell = rootIdx != null ? state.cells[rootIdx] : null;
      const building = rootCell ? INFRA_BUILDING_MAP.get(rootCell.buildingId) : null;
      
      if (meta.blocked) {
        ctx.strokeStyle = 'rgba(255,110,90,0.65)';
        ctx.setLineDash([8 * cam.zoom, 6 * cam.zoom]);
        ctx.lineDashOffset = performance.now() * 0.04;
        ctx.strokeRect(screen.x - half, screen.y - half, cellSize, cellSize);
        ctx.setLineDash([]);
        continue;
      }

      if (rootCell && rootCell.cells?.includes(meta.index)) {
        const done = rootCell.status === 'completed';
        ctx.fillStyle = done ? 'rgba(56,180,135,0.26)' : 'rgba(90,140,220,0.28)';
        ctx.fillRect(screen.x - half, screen.y - half, cellSize, cellSize);
        ctx.lineWidth = Math.max(1, 1.3 * cam.zoom);
        ctx.strokeStyle = done ? 'rgba(82,205,150,0.8)' : 'rgba(108,170,255,0.75)';
        ctx.strokeRect(screen.x - half, screen.y - half, cellSize, cellSize);
        
        if (building && !processedRoots.has(rootIdx)) {
          processedRoots.add(rootIdx);
          const cWorld = { x: station.x + rootCell.localPos.x, y: station.y + rootCell.localPos.y };
          const cScreen = window.worldToScreen(cWorld.x, cWorld.y, cam);
          const fpScale = Math.max(rootCell.footprint.w, rootCell.footprint.h);
          ctx.globalAlpha = done ? alpha * 0.92 : alpha * 0.85;
          if (window.drawInfrastructureIcon) window.drawInfrastructureIcon(ctx, building, cScreen, cellSize * 0.72 * fpScale, alpha, null);
        }
      } else {
        ctx.fillStyle = 'rgba(60,100,180,0.18)';
        ctx.fillRect(screen.x - half, screen.y - half, cellSize, cellSize);
        ctx.lineWidth = Math.max(1, 1.3 * cam.zoom);
        ctx.strokeStyle = 'rgba(130,170,255,0.35)';
        ctx.strokeRect(screen.x - half, screen.y - half, cellSize, cellSize);
      }
    }

    const hovered = infrastructureBuilder.hoveredCell;
    const ghostId = infrastructureBuilder.draggingBuildingId;
    if (ghostId && hovered != null) {
      const placement = validateInfrastructurePlacement(state, hovered, INFRA_BUILDING_MAP.get(ghostId), infrastructureBuilder.ghostRotation);
      if (placement?.footprint && infrastructureBuilder.ghostAlpha > 0.02) {
        ctx.globalAlpha = infrastructureBuilder.ghostAlpha * alpha * 0.9;
        ctx.fillStyle = (placement.blocked || placement.occupied) ? 'rgba(220,70,70,0.35)' : 'rgba(80,150,255,0.3)';
        for (const meta of placement.footprint.cells) {
          const s = window.worldToScreen(station.x + meta.local.x, station.y + meta.local.y, cam);
          ctx.fillRect(s.x - half, s.y - half, cellSize, cellSize);
        }
      }
    }
    ctx.restore();
  },

  drawInstances(ctx, cam) {
    if (!window.Game.infrastructure) return;
    const activeKey = (window.stationUI?.editorMode && window.stationUI.station) ? getInfrastructureStationKey(window.stationUI.station) : null;
    ctx.save();
    window.Game.infrastructure.forEach((list, key) => {
      if (activeKey && key === activeKey) return;
      for (const inst of list) {
        if (!inst || !inst.worldPos) continue;
        const b = INFRA_BUILDING_MAP.get(inst.buildingId);
        if (!b) continue;
        const screen = window.worldToScreen(inst.worldPos.x, inst.worldPos.y, cam);
        const scale = Math.max(inst.footprint?.w || 1, inst.footprint?.h || 1);
        ctx.globalAlpha = 0.9;
        if (window.drawInfrastructureIcon) window.drawInfrastructureIcon(ctx, b, screen, INFRA_CELL_WORLD_SIZE * cam.zoom * 0.6 * scale, 0.95, inst);
      }
    });
    ctx.restore();
  },
  
  getBuilder() { return infrastructureBuilder; }
};

function renderInfrastructureInfo(state, uniqueRoots, completedRoots) {
  const info = infrastructureBuilder.info;
  if (!info) return;
  info.innerHTML = '';
  const station = infrastructureBuilder.activeStationRef || window.stationUI?.station;
  const title = document.createElement('h4');
  title.textContent = station?.name ? `Infrastruktura: ${station.name}` : 'Budowa stacji';
  info.appendChild(title);

  if (!state) {
    info.appendChild(document.createTextNode('Brak aktywnej stacji.'));
    return;
  }

  const totalUsed = uniqueRoots.size || state.cells.filter(Boolean).length;
  const completed = completedRoots.size || state.cells.filter(c => c?.status === 'completed').length;

  if (infrastructureBuilder.selectedCell == null) {
    info.appendChild(document.createTextNode(`Przeciągnij budynek na siatkę. Ukończone: ${completed}/${totalUsed}.`));
    return;
  }
  
  const rootIdx = getRootCellIndex(state, infrastructureBuilder.selectedCell);
  const cell = rootIdx != null ? state.cells[rootIdx] : null;
  
  if (!cell) {
    info.appendChild(document.createTextNode('Puste pole. Upuść budynek.'));
  } else {
    const b = INFRA_BUILDING_MAP.get(cell.buildingId);
    info.appendChild(document.createTextNode(`Status: ${cell.status === 'completed' ? 'Ukończono' : 'Budowa...'}`));
  }
}

function renderInfrastructureOverlay() {
  const state = InfrastructureUI.ensureState();
  const u = new Set(), c = new Set();
  if (state) {
    state.cells.forEach((cell, idx) => {
      if (!cell) return;
      const rIdx = getRootCellIndex(state, idx) ?? idx;
      u.add(rIdx);
      if (cell.status === 'completed') c.add(rIdx);
    });
  }
  infrastructureBuilder.needsRender = false;
  renderInfrastructureInfo(state, u, c);
}