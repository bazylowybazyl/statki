// ============================================================
// Zone Painter UI — paint zone districts on planetary rings
// Ported from ringprocedural.html prototype
// ============================================================
import { ZONE_COLS, ZONE_ROWS, ZONE_CELL_ARC, COLORS, isGateAngle } from '../3d/ringCityZoneGrid.js';
import { getPlanetaryRing, rebuildRingCityCell } from '../3d/planetaryRing3D.js';
import { buildAllDistricts } from '../3d/ringCityBuildings.js';
import { buildAllInfrastructure } from '../3d/ringCityInfrastructure.js';

// --- State ---
let activeZoneTool = 'camera';
let brushRadius = 1;
let isPainting = false;
let lastPaintCellKey = '';
let visible = false;
let activePlanetKey = null;

// --- DOM refs ---
let overlay = null;
let gameCanvas = null;

// --- Public API ---
export const ZonePainterUI = {
  init(canvas) {
    gameCanvas = canvas;
    overlay = document.getElementById('zone-painter-overlay');
    if (!overlay) return;
    initToolButtons();
    initBrushSize();
    initFillButton();
    initCloseButton();
    initCanvasListeners();
  },

  setVisible(show, planetKey = null) {
    visible = !!show;
    if (planetKey != null) activePlanetKey = planetKey;
    if (overlay) overlay.classList.toggle('hidden', !visible);
    if (gameCanvas) {
      gameCanvas.style.cursor = (visible && activeZoneTool !== 'camera') ? 'crosshair' : '';
    }
    if (!visible) {
      isPainting = false;
      lastPaintCellKey = '';
    }
  },

  isVisible() { return visible; },
  getActivePlanetKey() { return activePlanetKey; }
};

// --- Tool buttons ---
function initToolButtons() {
  const buttons = overlay.querySelectorAll('.zp-tool-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => setZoneTool(btn.dataset.tool));
  });
}

function setZoneTool(toolId) {
  activeZoneTool = toolId;
  const buttons = overlay.querySelectorAll('.zp-tool-btn');
  buttons.forEach(btn => btn.classList.toggle('active', btn.dataset.tool === toolId));
  if (gameCanvas) {
    gameCanvas.style.cursor = toolId === 'camera' ? '' : 'crosshair';
  }
}

// --- Brush size ---
function initBrushSize() {
  const input = document.getElementById('zp-brushSize');
  const valueEl = document.getElementById('zp-brushSizeValue');
  if (!input || !valueEl) return;
  brushRadius = Number(input.value) || 1;
  valueEl.textContent = `${brushRadius}`;
  input.addEventListener('input', () => {
    brushRadius = Number(input.value) || 1;
    valueEl.textContent = `${brushRadius}`;
  });
}

// --- Fill button ---
function initFillButton() {
  const fillBtn = document.getElementById('zp-fillRingBtn');
  if (fillBtn) fillBtn.addEventListener('click', fillRingWithZones);

  const weightBindings = [
    ['zp-fillWeightResidential', 'zp-fillWeightResidentialValue'],
    ['zp-fillWeightIndustrial', 'zp-fillWeightIndustrialValue'],
    ['zp-fillWeightMilitary', 'zp-fillWeightMilitaryValue']
  ];
  for (const [inputId, valueId] of weightBindings) {
    const input = document.getElementById(inputId);
    if (!input) continue;
    updateFillWeightValue(inputId, valueId);
    input.addEventListener('input', () => updateFillWeightValue(inputId, valueId));
  }
}

function updateFillWeightValue(inputId, valueId) {
  const input = document.getElementById(inputId);
  const valueEl = document.getElementById(valueId);
  if (input && valueEl) valueEl.textContent = `${input.value}%`;
}

function getFillWeightsFromUI() {
  return {
    residential: Number(document.getElementById('zp-fillWeightResidential')?.value) || 0,
    industrial: Number(document.getElementById('zp-fillWeightIndustrial')?.value) || 0,
    military: Number(document.getElementById('zp-fillWeightMilitary')?.value) || 0
  };
}

function fillRingWithZones() {
  if (!activePlanetKey) return;
  const ring = getPlanetaryRing(activePlanetKey);
  if (!ring || !ring.zoneGrid) return;

  const weights = getFillWeightsFromUI();

  // Clear all existing district/infrastructure visuals
  for (let i = ring.visualMeshes.length - 1; i >= 0; i--) {
    const vm = ring.visualMeshes[i];
    if (vm.isDistrict || vm.isInfrastructure) {
      ring.ringFloor.remove(vm.mesh);
      ring.visualMeshes.splice(i, 1);
    }
  }

  // Fill grid with weighted random zones
  ring.zoneGrid.fillWithZones(weights);

  // Rebuild all
  const districtMeshes = buildAllDistricts(ring.zoneGrid, ring);
  ring.visualMeshes.push(...districtMeshes);

  const infraMeshes = buildAllInfrastructure(ring.zoneGrid, ring);
  ring.visualMeshes.push(...infraMeshes);
}

// --- Close button ---
function initCloseButton() {
  const closeBtn = document.getElementById('zp-closeBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => ZonePainterUI.setVisible(false));
  }
}

// --- Canvas mouse listeners ---
function initCanvasListeners() {
  if (!gameCanvas) return;

  // Use capture phase so zone painter gets events before the game
  gameCanvas.addEventListener('mousedown', e => {
    if (!visible || activeZoneTool === 'camera') return;
    if (e.button !== 0 || e.shiftKey) return;
    isPainting = true;
    lastPaintCellKey = '';
    const cell = getCellFromScreenPos(e.clientX, e.clientY);
    if (cell) paintZoneAtCell(cell);
    e.stopPropagation();
  }, true);

  window.addEventListener('mouseup', e => {
    if (!isPainting) return;
    if (e.button !== 0) return;
    isPainting = false;
    lastPaintCellKey = '';
  }, true);

  window.addEventListener('mousemove', e => {
    if (!visible || !isPainting || activeZoneTool === 'camera') return;
    const cell = getCellFromScreenPos(e.clientX, e.clientY);
    if (cell) paintZoneAtCell(cell);
  }, true);
}

// --- Core painting logic ---

function getCellFromScreenPos(screenX, screenY) {
  if (!activePlanetKey) return null;
  const ring = getPlanetaryRing(activePlanetKey);
  if (!ring || !ring.zoneGrid) return null;

  const screenToWorld = window.screenToWorld;
  const cam = window.camera;
  if (!screenToWorld || !cam) return null;

  const world = screenToWorld(screenX, screenY, cam);

  // Relative to planet center
  const dx = world.x - ring.lastPlanetX;
  const dy = world.y - ring.lastPlanetY;

  // Undo ring rotation
  const rot = -(ring.currentRotation || 0);
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  const localX = dx * cosR - dy * sinR;
  const localY = dx * sinR + dy * cosR;

  // Polar coords
  const radius = Math.sqrt(localX * localX + localY * localY);
  let angle = Math.atan2(localY, localX);
  if (angle < 0) angle += Math.PI * 2;

  // Bounds check
  const grid = ring.zoneGrid;
  if (radius < grid.paintInner || radius > grid.paintOuter) return null;
  if (isGateAngle(angle)) return null;

  // Map to cell — uwzględniamy szczelinę autostrady
  const col = Math.floor(angle / ZONE_CELL_ARC);
  let row;
  const ROWS_PER_BAND = ZONE_ROWS / 2;
  if (radius < grid.innerBandOuter) {
    // Wewnętrzne pasmo (rows 0-1)
    row = Math.min(ROWS_PER_BAND - 1, Math.max(0,
      Math.floor((radius - grid.paintInner) / grid.innerLaneDepth)
    ));
  } else if (radius > grid.outerBandInner) {
    // Zewnętrzne pasmo (rows 2-3)
    row = ROWS_PER_BAND + Math.min(ROWS_PER_BAND - 1, Math.max(0,
      Math.floor((radius - grid.outerBandInner) / grid.outerLaneDepth)
    ));
  } else {
    // W szczeelinie autostrady — nie malujemy
    return null;
  }

  return grid.getCell(col, row);
}

function paintZoneAtCell(cell) {
  if (!cell || activeZoneTool === 'camera') return;
  if (cell.key === lastPaintCellKey) return;
  lastPaintCellKey = cell.key;

  if (!activePlanetKey) return;
  const ring = getPlanetaryRing(activePlanetKey);
  if (!ring || !ring.zoneGrid) return;

  const nextZone = activeZoneTool === 'erase' ? null : activeZoneTool;

  for (let rowOff = -brushRadius + 1; rowOff <= brushRadius - 1; rowOff++) {
    for (let colOff = -brushRadius + 1; colOff <= brushRadius - 1; colOff++) {
      const targetCell = ring.zoneGrid.getCell(cell.col + colOff, cell.row + rowOff);
      if (!targetCell) continue;
      const centerAngle = targetCell.angleStart + ZONE_CELL_ARC * 0.5;
      if (isGateAngle(centerAngle)) continue;

      if (ring.zoneGrid.setCell(targetCell.col, targetCell.row, nextZone)) {
        rebuildRingCityCell(activePlanetKey, targetCell);
      }
    }
  }
}
