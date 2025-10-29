(function(){
  const Build = window.Build || (window.Build = {});

  const TILE = 40;
  const GRID_W = 20;
  const GRID_H = 12;
  const GRID_W_PX = GRID_W * TILE;
  const GRID_H_PX = GRID_H * TILE;

  const palette = [
    'Power',
    'ShipyardS',
    'ShipyardM',
    'ShipyardL',
    'ShipyardC',
    'StoreS',
    'StoreM',
    'StoreL',
    'StoreC'
  ];

  const buildingMeta = {
    Power: {
      label: 'Power',
      shortLabel: 'PWR',
      size: { w: 2, h: 2 },
      color: '#60a5fa',
      energy: { produce: 80 },
      workforce: { provide: 4 },
      storage: { metal: 0, gas: 0 },
      shipyards: 0,
    },
    ShipyardS: {
      label: 'Shipyard S',
      shortLabel: 'SY-S',
      size: { w: 3, h: 3 },
      color: '#f97316',
      energy: { consume: 25 },
      workforce: { need: 6 },
      storage: { metal: 0, gas: 0 },
      shipyards: 1,
    },
    ShipyardM: {
      label: 'Shipyard M',
      shortLabel: 'SY-M',
      size: { w: 4, h: 3 },
      color: '#fb923c',
      energy: { consume: 40 },
      workforce: { need: 10 },
      storage: { metal: 0, gas: 0 },
      shipyards: 1,
    },
    ShipyardL: {
      label: 'Shipyard L',
      shortLabel: 'SY-L',
      size: { w: 4, h: 4 },
      color: '#fb7185',
      energy: { consume: 60 },
      workforce: { need: 16 },
      storage: { metal: 0, gas: 0 },
      shipyards: 2,
    },
    ShipyardC: {
      label: 'Shipyard Capital',
      shortLabel: 'SY-C',
      size: { w: 5, h: 4 },
      color: '#ef4444',
      energy: { consume: 90 },
      workforce: { need: 24 },
      storage: { metal: 0, gas: 0 },
      shipyards: 3,
    },
    StoreS: {
      label: 'Store S',
      shortLabel: 'ST-S',
      size: { w: 2, h: 2 },
      color: '#22d3ee',
      energy: { consume: 6 },
      workforce: { provide: 6 },
      storage: { metal: 200, gas: 60 },
      shipyards: 0,
    },
    StoreM: {
      label: 'Store M',
      shortLabel: 'ST-M',
      size: { w: 3, h: 2 },
      color: '#0ea5e9',
      energy: { consume: 8 },
      workforce: { provide: 12 },
      storage: { metal: 400, gas: 120 },
      shipyards: 0,
    },
    StoreL: {
      label: 'Store L',
      shortLabel: 'ST-L',
      size: { w: 3, h: 3 },
      color: '#38bdf8',
      energy: { consume: 12 },
      workforce: { provide: 20 },
      storage: { metal: 800, gas: 200 },
      shipyards: 0,
    },
    StoreC: {
      label: 'Store Capital',
      shortLabel: 'ST-C',
      size: { w: 4, h: 3 },
      color: '#0284c7',
      energy: { consume: 18 },
      workforce: { provide: 32 },
      storage: { metal: 1200, gas: 320 },
      shipyards: 0,
    },
  };

  const areas = new Map();
  let lastEconResult = null;

  Build.mode = Build.mode || 'idle';
  Build._camPrev = { x: 0, y: 0, zoom: 1 };
  Build._drag = { active: false, type: null, gx: -1, gy: -1, valid: false, affordable: false, area: null };
  Build._hover = { inside: false, gx: -1, gy: -1, valid: false, affordable: false, area: null };
  Build._paletteBoxes = [];
  Build._panelRect = null;
  Build._exitButtonRect = null;
  Build._activeStation = Build._activeStation || null;

  const state = {
    get areas(){ return areas; },
    get drag(){ return Build._drag; },
    get hover(){ return Build._hover; },
    get mode(){ return Build.mode; },
    get lastEcon(){ return lastEconResult; },
  };

  let cameraTween = null;

  function defaultRes(){
    return {
      energyNet: 0,
      workforce: 0,
      wfHave: 0,
      wfNeed: 0,
      capM: 0,
      capG: 0,
      metal: 0,
      gas: 0,
    };
  }

  function getStations(){
    return Array.isArray(window.stations) ? window.stations : [];
  }

  function findStationById(id){
    if (id == null) return null;
    const stations = getStations();
    for (const st of stations){
      if (String(st.id) === String(id)) return st;
    }
    return null;
  }

  function stationGridOrigin(station){
    if (!station) return { x: 0, y: 0 };
    const pad = (station.r || 160) + 80;
    return {
      x: station.x + pad,
      y: station.y - GRID_H_PX / 2,
    };
  }

  function ensureAreaForStation(station){
    if (!station || station.id == null) return null;
    const id = String(station.id);
    let area = areas.get(id);
    if (!area){
      area = {
        stationId: id,
        origin: stationGridOrigin(station),
        buildings: [],
        res: defaultRes(),
        grid: new Array(GRID_W * GRID_H).fill(null),
        summary: { energyProd: 0, energyUse: 0, shipyards: 0 },
      };
      areas.set(id, area);
    }
    area.origin = stationGridOrigin(station);
    if (!Array.isArray(area.grid) || area.grid.length !== GRID_W * GRID_H){
      area.grid = new Array(GRID_W * GRID_H).fill(null);
    }
    if (!area.res) area.res = defaultRes();
    return area;
  }

  function getCamera(){
    const cam = window.camera || { x: 0, y: 0, zoom: 1 };
    return {
      x: cam.x || 0,
      y: cam.y || 0,
      zoom: cam.zoom || 1,
    };
  }

  function toScreen(wx, wy){
    // ZAWSZE względem tweenowanej kamery edytora
    const cam = getCamera();
    const W = typeof window.W === 'number' ? window.W : window.innerWidth;
    const H = typeof window.H === 'number' ? window.H : window.innerHeight;
    return { x: (wx - cam.x) * cam.zoom + W/2, y: (wy - cam.y) * cam.zoom + H/2 };
  }

  function toWorld(sx, sy){
    // ZAWSZE względem tweenowanej kamery edytora
    const cam = getCamera();
    const W = typeof window.W === 'number' ? window.W : window.innerWidth;
    const H = typeof window.H === 'number' ? window.H : window.innerHeight;
    return { x: cam.x + (sx - W/2) / cam.zoom, y: cam.y + (sy - H/2) / cam.zoom };
  }

  function resetGrid(area){
    if (!area) return;
    if (!Array.isArray(area.grid) || area.grid.length !== GRID_W * GRID_H){
      area.grid = new Array(GRID_W * GRID_H).fill(null);
    } else {
      area.grid.fill(null);
    }
  }

  function recomputeArea(area){
    if (!area) return;
    resetGrid(area);
    let energyProd = 0;
    let energyUse = 0;
    let wfNeed = 0;
    let wfHave = 0;
    let capM = 0;
    let capG = 0;
    let shipyards = 0;

    for (const b of area.buildings){
      const meta = buildingMeta[b.type];
      if (!meta) continue;
      const size = meta.size || { w: 1, h: 1 };
      b.w = size.w;
      b.h = size.h;
      b.wfNeed = (meta.workforce && meta.workforce.need) || 0;
      b.wfHave = (meta.workforce && meta.workforce.provide) || 0;

      for (let dy = 0; dy < b.h; dy++){
        for (let dx = 0; dx < b.w; dx++){
          const gx = b.x + dx;
          const gy = b.y + dy;
          if (gx < 0 || gy < 0 || gx >= GRID_W || gy >= GRID_H) continue;
          area.grid[gy * GRID_W + gx] = b;
        }
      }

      energyProd += (meta.energy && meta.energy.produce) || 0;
      energyUse  += (meta.energy && meta.energy.consume) || 0;
      wfNeed += b.wfNeed;
      wfHave += b.wfHave;
      capM += (meta.storage && meta.storage.metal) || 0;
      capG += (meta.storage && meta.storage.gas) || 0;
      shipyards += meta.shipyards || 0;
    }

    area.res.energyNet = Math.round(energyProd - energyUse);
    area.res.wfNeed = Math.round(wfNeed);
    area.res.wfHave = Math.round(wfHave);
    area.res.workforce = area.res.wfHave - area.res.wfNeed;
    area.res.capM = capM;
    area.res.capG = capG;
    area.res.metal = Math.min(area.res.metal || 0, capM);
    area.res.gas = Math.min(area.res.gas || 0, capG);
    area.summary = {
      energyProd,
      energyUse,
      shipyards,
    };

    const active = area.res.energyNet >= 0 && area.res.wfHave >= area.res.wfNeed;
    for (const b of area.buildings){
      b.state = active ? 'active' : 'offline';
    }
  }

  function buildingAt(area, gx, gy){
    if (!area || gx < 0 || gy < 0 || gx >= GRID_W || gy >= GRID_H) return null;
    return area.grid[gy * GRID_W + gx] || null;
  }

  function canPlace(area, type, gx, gy){
    const meta = buildingMeta[type];
    if (!area || !meta) return false;
    const size = meta.size || { w: 1, h: 1 };
    if (gx < 0 || gy < 0) return false;
    if (gx + size.w > GRID_W || gy + size.h > GRID_H) return false;
    for (let dy = 0; dy < size.h; dy++){
      for (let dx = 0; dx < size.w; dx++){
        const cell = area.grid[(gy + dy) * GRID_W + (gx + dx)];
        if (cell) return false;
      }
    }
    return true;
  }

  function canAfford(type){
    const econ = window.__ECON;
    const defs = window.ECON_BUILDINGS;
    if (!econ || !defs) return true;
    const def = defs[type];
    if (!def) return true;
    return econ.canAfford(def);
  }

  function placeBuilding(area, type, gx, gy){
    if (!area || !type) return false;
    if (!canPlace(area, type, gx, gy)) return false;
    if (!canAfford(type)) return false;
    const meta = buildingMeta[type];
    const size = meta.size || { w: 1, h: 1 };
    const building = {
      type,
      x: gx,
      y: gy,
      w: size.w,
      h: size.h,
      wfNeed: (meta.workforce && meta.workforce.need) || 0,
      wfHave: (meta.workforce && meta.workforce.provide) || 0,
      state: 'constructing',
    };
    area.buildings.push(building);
    recomputeArea(area);
    if (window.__ECON && window.ECON_BUILDINGS){
      const econAreaId = area.stationId + '_area';
      window.__ECON.ensureArea(econAreaId, { res: { ...area.res } });
      window.__ECON.place(econAreaId, type, {
        wfNeed: building.wfNeed,
        wfHave: building.wfHave,
        state: building.state,
      });
    }
    Build._drag.active = false;
    Build._drag.type = null;
    Build._drag.area = null;
    Build._hover = { inside: false, gx: -1, gy: -1, valid: false, affordable: false, area: null };
    Build.state = state;
    return true;
  }

  function removeBuilding(area, gx, gy){
    const econ = window.__ECON;
    const building = buildingAt(area, gx, gy);
    if (!building) return false;
    const idx = area.buildings.indexOf(building);
    if (idx === -1) return false;
    area.buildings.splice(idx, 1);
    if (econ){
      const econAreaId = area.stationId + '_area';
      econ.remove(econAreaId, idx);
    }
    recomputeArea(area);
    Build._hover = { inside: false, gx: -1, gy: -1, valid: false, affordable: false, area: null };
    Build.state = state;
    return true;
  }

  function pointerToCell(sx, sy){
    const station = Build._activeStation || (window.stationUI && window.stationUI.station);
    if (!station) return null;
    const area = ensureAreaForStation(station);
    if (!area) return null;
    const world = toWorld(sx, sy);
    const relX = world.x - area.origin.x;
    const relY = world.y - area.origin.y;
    const gx = Math.floor(relX / TILE);
    const gy = Math.floor(relY / TILE);
    const inside = gx >= 0 && gy >= 0 && gx < GRID_W && gy < GRID_H;
    return { area, gx, gy, inside, world };
  }

  function tweenCameraTo(target, ms){
    const cam = window.camera;
    if (!cam) return;
    const now = performance.now();
    cameraTween = {
      start: { x: cam.x || 0, y: cam.y || 0, zoom: cam.zoom || 1 },
      target: {
        x: target && Number.isFinite(target.x) ? target.x : cam.x || 0,
        y: target && Number.isFinite(target.y) ? target.y : cam.y || 0,
        zoom: target && Number.isFinite(target.zoom) ? target.zoom : cam.zoom || 1,
      },
      startTime: now,
      duration: Math.max(1, ms || 300),
    };
  }

  function stepCameraTween(){
    if (!cameraTween) return;
    const cam = window.camera;
    if (!cam){
      cameraTween = null;
      return;
    }
    const now = performance.now();
    const t = Math.min(1, (now - cameraTween.startTime) / cameraTween.duration);
    const ease = t;
    cam.x = cameraTween.start.x + (cameraTween.target.x - cameraTween.start.x) * ease;
    cam.y = cameraTween.start.y + (cameraTween.target.y - cameraTween.start.y) * ease;
    cam.zoom = cameraTween.start.zoom + (cameraTween.target.zoom - cameraTween.start.zoom) * ease;
    if (t >= 1){
      cameraTween = null;
    }
  }

  function updateHoverFromPointer(sx, sy){
    if (Build.mode !== 'editor'){
      Build._hover = { inside: false, gx: -1, gy: -1, valid: false, affordable: false, area: null };
      return;
    }
    const pointer = pointerToCell(sx, sy);
    if (!pointer){
      Build._hover = { inside: false, gx: -1, gy: -1, valid: false, affordable: false, area: null };
      return;
    }
    const dragType = Build._drag.active ? Build._drag.type : null;
    const type = dragType || null;
    const area = pointer.area;
    const valid = type ? canPlace(area, type, pointer.gx, pointer.gy) : false;
    const affordable = type ? canAfford(type) : false;
    Build._hover = {
      inside: pointer.inside,
      gx: pointer.gx,
      gy: pointer.gy,
      valid,
      affordable,
      area,
    };
    if (Build._drag.active){
      Build._drag.gx = pointer.gx;
      Build._drag.gy = pointer.gy;
      Build._drag.area = area;
      Build._drag.valid = pointer.inside && valid;
      Build._drag.affordable = affordable;
    }
  }

  function paletteAffordable(type){
    try {
      return canAfford(type);
    } catch {
      return true;
    }
  }

  function isMouseOverRect(mouse, rect){
    if (!mouse || !rect) return false;
    return mouse.x >= rect.x && mouse.x <= rect.x + rect.w && mouse.y >= rect.y && mouse.y <= rect.y + rect.h;
  }

  function refreshCursor(){
    const canvas = window.canvas;
    if (!canvas) return;
    let cursor = 'default';
    const mouse = window.mouse;
    if (Build.mode === 'editor'){
      if (Build._drag.active){
        cursor = 'grabbing';
      } else if (mouse){
        if (isMouseOverRect(mouse, Build._exitButtonRect)){
          cursor = 'pointer';
        } else {
          const paletteHit = Build._paletteBoxes.find(box => isMouseOverRect(mouse, box));
          if (paletteHit){
            cursor = 'pointer';
          } else if (Build._hover.inside){
            cursor = 'crosshair';
          }
        }
      }
    }
    canvas.style.cursor = cursor;
  }

  Build.enterEditor = function(station){
    const st = station || (window.stationUI && window.stationUI.station);
    if (!st) return;
    Build._activeStation = st;
    const cam = window.camera || { x: st.x, y: st.y, zoom: 1 };
    Build._camPrev = { x: cam.x || st.x || 0, y: cam.y || st.y || 0, zoom: cam.zoom || 1 };
    // PRZEŁĄCZ na free-camera (nie śledzimy statku)
    if (window.camera) camera.followShip = false;
    if (window.stationUI){
      window.stationUI.open = false;
      window.stationUI.dragging = false;
    }

    const pad = (st.r || 160) + 80;
    const W = window.W || window.innerWidth;
    const H = window.H || window.innerHeight;
    const targetZoom = Math.min(1.6, Math.max(0.8, (H * 0.75) / (GRID_H * TILE)));
    const worldLeft = st.x - (W * 0.35) / targetZoom;
    const worldY = st.y;
    tweenCameraTo({ x: worldLeft, y: worldY, zoom: targetZoom }, 300);

    Build.mode = 'editor';
    Build._drag = { active: false, type: null, gx: -1, gy: -1, valid: false, affordable: false, area: null };
    Build._hover = { inside: false, gx: -1, gy: -1, valid: false, affordable: false, area: null };
    const area = ensureAreaForStation(st);
    if (area) recomputeArea(area);
    Build.state = state;
  };

  Build.exitEditor = function(){
    const cam = window.camera;
    const t = Build._camPrev;
    if (cam && t) tweenCameraTo(t, 250);
    // WRÓĆ do śledzenia statku
    if (window.camera) camera.followShip = true;
    Build._drag = { active: false, type: null, gx: -1, gy: -1, valid: false, affordable: false, area: null };
    Build._hover = { inside: false, gx: -1, gy: -1, valid: false, affordable: false, area: null };
    Build.mode = 'idle';
    Build._activeStation = null;
    Build._paletteBoxes = [];
    Build._panelRect = null;
    Build._exitButtonRect = null;
    Build.state = state;
    refreshCursor();
  };

  function getPaletteMetrics(panelW){
    const tileW = 148;
    const tileH = 64;
    const gap = 12;
    const cols = Math.max(1, Math.floor((panelW - gap) / (tileW + gap)));
    const rows = Math.ceil(palette.length / cols);
    const height = rows * (tileH + gap);
    return { tileW, tileH, gap, cols, rows, height };
  }

  function drawPalette(ctx, originX, originY, panelW, metrics){
    const mouse = window.mouse;
    const defs = window.ECON_BUILDINGS || {};
    const { tileW, tileH, gap, cols, rows } = metrics;
    const innerCols = Math.min(cols, palette.length);
    const startX = originX + (panelW - innerCols * (tileW + gap) + gap) / 2;
    const startY = originY;
    Build._paletteBoxes = [];

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '600 14px Inter,system-ui,Segoe UI,Roboto,Arial';
    for (let i = 0; i < palette.length; i++){
      const type = palette[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = startX + col * (tileW + gap);
      const y = startY + row * (tileH + gap);
      const box = { type, x, y, w: tileW, h: tileH };
      Build._paletteBoxes.push(box);
      const meta = buildingMeta[type];
      const def = defs[type] || {};
      const affordable = paletteAffordable(type);
      const isHover = mouse ? isMouseOverRect(mouse, box) : false;
      const isDragging = Build._drag.active && Build._drag.type === type;

      ctx.fillStyle = isDragging
        ? 'rgba(59,130,246,0.32)'
        : isHover
          ? 'rgba(30,41,59,0.88)'
          : 'rgba(15,23,42,0.82)';
      ctx.fillRect(x, y, tileW, tileH);
      ctx.strokeStyle = affordable ? 'rgba(125,211,252,0.55)' : 'rgba(239,68,68,0.6)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 0.75, y + 0.75, tileW - 1.5, tileH - 1.5);

      ctx.fillStyle = '#e2e8ff';
      ctx.fillText(meta.label, x + 12, y + 8);
      ctx.font = '12px Inter,system-ui,Segoe UI,Roboto,Arial';
      ctx.fillStyle = '#9fb5ff';
      ctx.fillText(`${def.costCR || 0} CR`, x + 12, y + 28);
      const energyLine = meta.energy?.produce ? `+${meta.energy.produce}` : meta.energy?.consume ? `-${meta.energy.consume}` : '0';
      const wfProvide = meta.workforce?.provide || 0;
      const wfNeed = meta.workforce?.need || 0;
      ctx.fillStyle = '#8fa2d9';
      ctx.fillText(`E ${energyLine}  WF ${wfProvide}/${wfNeed}`, x + 12, y + 44);

      ctx.fillStyle = meta.color || '#60a5fa';
      ctx.globalAlpha = 0.15;
      ctx.fillRect(x + tileW - 40, y + 12, 24, 24);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawGrid(ctx, area, topLeft, tilePx){
    const widthPx = GRID_W * tilePx;
    const heightPx = GRID_H * tilePx;

    ctx.save();
    ctx.fillStyle = 'rgba(12,16,32,0.68)';
    ctx.fillRect(topLeft.x, topLeft.y, widthPx, heightPx);
    ctx.strokeStyle = 'rgba(148,163,209,0.35)';
    ctx.lineWidth = 1;
    for (let gx = 0; gx <= GRID_W; gx++){
      const x = topLeft.x + gx * tilePx;
      ctx.beginPath();
      ctx.moveTo(x, topLeft.y);
      ctx.lineTo(x, topLeft.y + heightPx);
      ctx.stroke();
    }
    for (let gy = 0; gy <= GRID_H; gy++){
      const y = topLeft.y + gy * tilePx;
      ctx.beginPath();
      ctx.moveTo(topLeft.x, y);
      ctx.lineTo(topLeft.x + widthPx, y);
      ctx.stroke();
    }

    for (const b of area.buildings){
      const meta = buildingMeta[b.type];
      if (!meta) continue;
      const sx = topLeft.x + b.x * tilePx;
      const sy = topLeft.y + b.y * tilePx;
      const bw = (meta.size?.w || b.w || 1) * tilePx;
      const bh = (meta.size?.h || b.h || 1) * tilePx;
      ctx.fillStyle = (meta.color || '#60a5fa') + '80';
      ctx.fillRect(sx + 1, sy + 1, bw - 2, bh - 2);
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx + 1, sy + 1, bw - 2, bh - 2);
      ctx.fillStyle = '#0f172a';
      ctx.font = `${Math.max(12, Math.round(12 * Math.min(2, tilePx / TILE)))}px Inter,system-ui,Segoe UI,Roboto,Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(meta.shortLabel || b.type, sx + bw / 2, sy + bh / 2);
    }

    if (Build._hover.inside && !Build._drag.active){
      const meta = buildingMeta[Build._drag.type || ''];
      const hx = topLeft.x + Build._hover.gx * tilePx;
      const hy = topLeft.y + Build._hover.gy * tilePx;
      const hw = (meta?.size?.w || 1) * tilePx;
      const hh = (meta?.size?.h || 1) * tilePx;
      ctx.strokeStyle = 'rgba(125,211,252,0.5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(hx + 1, hy + 1, hw - 2, hh - 2);
    }

    if (Build._drag.active && Build._drag.type){
      const meta = buildingMeta[Build._drag.type];
      if (meta && Build._drag.gx >= -1 && Build._drag.gy >= -1){
        const gx = Math.max(Build._drag.gx, 0);
        const gy = Math.max(Build._drag.gy, 0);
        const sx = topLeft.x + gx * tilePx;
        const sy = topLeft.y + gy * tilePx;
        const bw = (meta.size?.w || 1) * tilePx;
        const bh = (meta.size?.h || 1) * tilePx;
        const valid = Build._drag.valid && Build._drag.affordable;
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = valid ? 'rgba(74,222,128,0.45)' : 'rgba(248,113,113,0.35)';
        ctx.fillRect(sx + 1, sy + 1, bw - 2, bh - 2);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = valid ? 'rgba(74,222,128,0.9)' : 'rgba(248,113,113,0.9)';
        ctx.lineWidth = 3;
        ctx.strokeRect(sx + 1.5, sy + 1.5, bw - 3, bh - 3);
        ctx.restore();
      }
    }

    ctx.restore();
  }

  function drawHud(ctx, station){
    const mouse = window.mouse;
    const econ = window.__ECON;
    let credits = 0;
    let delta = 0;
    if (econ && typeof econ.serialize === 'function'){
      try {
        const snapshot = econ.serialize().economy || {};
        credits = Math.floor(snapshot.credits || 0);
        delta = Math.floor(snapshot.deltaPerMin || 0);
      } catch {}
    }
    const info = `Kredyty: ${credits}   Δ ${delta}/min`;
    const cam = getCamera();
    const leftWorldX = station.x - ((station.r || 160) + 60) / (cam.zoom || 1);
    const anchor = toScreen(leftWorldX, station.y - (station.r || 160) * 0.75);
    const pad = 14;

    ctx.save();
    ctx.font = '600 16px Inter,system-ui,Segoe UI,Roboto,Arial';
    const measured = ctx.measureText ? ctx.measureText(info) : null;
    const width = measured ? Math.max(180, measured.width + pad * 2) : 240;
    const height = 64;
    const x = anchor.x - width;
    const y = anchor.y - height / 2;

    ctx.fillStyle = 'rgba(8,12,24,0.82)';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = 'rgba(59,130,246,0.5)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.75, y + 0.75, width - 1.5, height - 1.5);
    ctx.fillStyle = '#dbe5ff';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText('TRYB EDYTORA', x + pad, y + pad - 2);
    ctx.font = '13px Inter,system-ui,Segoe UI,Roboto,Arial';
    ctx.fillStyle = '#9fb5ff';
    ctx.fillText(info, x + pad, y + pad + 18);

    const btnW = 120;
    const btnH = 28;
    const btnX = x + pad;
    const btnY = y + height - btnH - pad + 6;
    const overBtn = mouse ? (mouse.x >= btnX && mouse.x <= btnX + btnW && mouse.y >= btnY && mouse.y <= btnY + btnH) : false;
    ctx.fillStyle = overBtn ? 'rgba(239,68,68,0.85)' : 'rgba(248,113,113,0.75)';
    ctx.fillRect(btnX, btnY, btnW, btnH);
    ctx.fillStyle = '#0f172a';
    ctx.font = '600 13px Inter,system-ui,Segoe UI,Roboto,Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Wyjdź (Esc)', btnX + btnW / 2, btnY + btnH / 2);

    Build._exitButtonRect = { x: btnX, y: btnY, w: btnW, h: btnH };
    ctx.restore();
  }

  Build.draw = function(ctx){
    if (!ctx || Build.mode !== 'editor'){
      refreshCursor();
      return;
    }
    const station = Build._activeStation || (window.stationUI && window.stationUI.station);
    if (!station){
      refreshCursor();
      return;
    }
    const area = ensureAreaForStation(station);
    if (!area){
      refreshCursor();
      return;
    }
    recomputeArea(area);
    const cam = getCamera();
    const topLeft = toScreen(area.origin.x, area.origin.y);
    const tilePx = TILE * (cam.zoom || 1);
    const gridWidth = GRID_W * tilePx;
    const gridHeight = GRID_H * tilePx;
    const margin = 16;
    const gap = 12;
    const panelW = gridWidth + margin * 2;
    const innerWidth = panelW - margin * 2;
    const paletteMetrics = getPaletteMetrics(innerWidth);
    const paletteHeight = paletteMetrics.height;
    const panelH = margin + paletteHeight + gap + gridHeight + margin;
    const panelX = topLeft.x - margin;
    const panelY = topLeft.y - (margin + paletteHeight + gap);

    ctx.save();
    ctx.fillStyle = 'rgba(7,11,22,0.78)';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = 'rgba(59,130,246,0.55)';
    ctx.lineWidth = 2;
    ctx.strokeRect(panelX + 1, panelY + 1, panelW - 2, panelH - 2);
    ctx.restore();

    Build._panelRect = { x: panelX, y: panelY, w: panelW, h: panelH };

    drawPalette(ctx, panelX + margin, panelY + margin, innerWidth, paletteMetrics);
    drawGrid(ctx, area, topLeft, tilePx);
    drawHud(ctx, station);
    refreshCursor();
  };

  Build.tick = function(dt, ctx){
    stepCameraTween();
    const econ = window.__ECON;
    const stations = Array.isArray(ctx?.stations) ? ctx.stations : getStations();
    for (const area of areas.values()){
      const station = findStationById(area.stationId) || stations.find(st => String(st.id) === String(area.stationId));
      if (station){
        area.origin = stationGridOrigin(station);
      }
      recomputeArea(area);
    }
    if (!econ) return null;
    for (const area of areas.values()){
      const econAreaId = area.stationId + '_area';
      const econArea = econ.ensureArea(econAreaId, { res: { ...area.res } });
      econArea.res = { ...econArea.res, ...area.res };
      econArea.buildings = area.buildings.map(b => ({
        type: b.type,
        state: b.state,
        wfNeed: b.wfNeed,
        wfHave: b.wfHave,
      }));
    }
    lastEconResult = econ.tick(dt || 0, { stations });
    for (const area of areas.values()){
      const econArea = econ.ensureArea(area.stationId + '_area');
      if (econArea && econArea.res){
        area.res.metal = econArea.res.metal ?? area.res.metal;
        area.res.gas = econArea.res.gas ?? area.res.gas;
        area.res.capM = econArea.res.capM ?? area.res.capM;
        area.res.capG = econArea.res.capG ?? area.res.capG;
      }
    }
    Build.state = state;
    return lastEconResult;
  };

  Build.onMouseDown = function(e){
    if (Build.mode !== 'editor') return false;
    const mouse = window.mouse;
    if (!mouse) return true;
    if (e.button === 0){
      mouse.left = true;
      const exit = Build._exitButtonRect && isMouseOverRect(mouse, Build._exitButtonRect);
      if (exit){
        Build.exitEditor();
        return true;
      }
      const paletteHit = Build._paletteBoxes.find(box => isMouseOverRect(mouse, box));
      if (paletteHit){
        Build._drag = {
          active: true,
          type: paletteHit.type,
          gx: -1,
          gy: -1,
          valid: false,
          affordable: paletteAffordable(paletteHit.type),
          area: null,
        };
        updateHoverFromPointer(mouse.x, mouse.y);
        refreshCursor();
        return true;
      }
      updateHoverFromPointer(mouse.x, mouse.y);
      return true;
    }
    if (e.button === 2){
      mouse.right = true;
      const pointer = pointerToCell(mouse.x, mouse.y);
      if (pointer && pointer.inside){
        removeBuilding(pointer.area, pointer.gx, pointer.gy);
      }
      refreshCursor();
      return true;
    }
    return Build.mode === 'editor';
  };

  Build.onMouseUp = function(e){
    if (Build.mode !== 'editor') return false;
    const mouse = window.mouse;
    if (e.button === 0){
      if (mouse) mouse.left = false;
      if (Build._drag.active){
        const pointer = mouse ? pointerToCell(mouse.x, mouse.y) : null;
        if (pointer && pointer.inside && Build._drag.valid && Build._drag.affordable){
          placeBuilding(pointer.area, Build._drag.type, pointer.gx, pointer.gy);
        }
        Build._drag = { active: false, type: null, gx: -1, gy: -1, valid: false, affordable: false, area: null };
        Build._hover = { inside: false, gx: -1, gy: -1, valid: false, affordable: false, area: null };
        refreshCursor();
        return true;
      }
      refreshCursor();
      return true;
    }
    if (e.button === 2){
      if (mouse) mouse.right = false;
      return true;
    }
    return false;
  };

  Build.onMouseMove = function(e){
    if (!window.mouse) return false;
    if (Build.mode !== 'editor'){
      refreshCursor();
      return false;
    }
    updateHoverFromPointer(window.mouse.x, window.mouse.y);
    refreshCursor();
    return true;
  };

  Build.onContextMenu = function(e){
    if (Build.mode !== 'editor') return false;
    const mouse = window.mouse;
    const pointer = mouse ? pointerToCell(mouse.x, mouse.y) : null;
    if (pointer && pointer.inside && buildingAt(pointer.area, pointer.gx, pointer.gy)){
      e.preventDefault();
      removeBuilding(pointer.area, pointer.gx, pointer.gy);
      refreshCursor();
      return true;
    }
    e.preventDefault();
    return true;
  };

  Build.ensureAreaForStation = ensureAreaForStation;
  Build.recomputeArea = recomputeArea;
  Build.canPlace = canPlace;
  Build.canAfford = canAfford;
  Build.placeBuilding = placeBuilding;
  Build.removeBuilding = removeBuilding;
  Build.state = state;
})();
