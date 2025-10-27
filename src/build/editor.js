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
  let selectedType = palette[0];
  let hoverCell = { stationId: null, gx: -1, gy: -1, valid: false, affordable: false };
  let lastEconResult = null;

  const state = {
    get areas(){ return areas; },
    get selected(){ return selectedType; },
    get hover(){ return hoverCell; },
    get lastEcon(){ return lastEconResult; },
  };

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
    const pos = window.ship && window.ship.pos ? window.ship.pos : { x: 0, y: 0 };
    const cam = window.camera || { zoom: 1 };
    return { x: pos.x, y: pos.y, zoom: cam.zoom || 1 };
  }

  function toScreen(wx, wy){
    const cam = getCamera();
    if (typeof window.worldToScreen === 'function'){
      return window.worldToScreen(wx, wy, cam);
    }
    const W = typeof window.W === 'number' ? window.W : window.innerWidth;
    const H = typeof window.H === 'number' ? window.H : window.innerHeight;
    return {
      x: (wx - cam.x) * cam.zoom + W / 2,
      y: (wy - cam.y) * cam.zoom + H / 2,
    };
  }

  function toWorld(sx, sy){
    if (typeof window.screenToWorld === 'function'){
      return window.screenToWorld(sx, sy);
    }
    const cam = getCamera();
    const W = typeof window.W === 'number' ? window.W : window.innerWidth;
    const H = typeof window.H === 'number' ? window.H : window.innerHeight;
    return {
      x: cam.x + (sx - W / 2) / cam.zoom,
      y: cam.y + (sy - H / 2) / cam.zoom,
    };
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

  function pointerToCell(sx, sy){
    const stationUI = window.stationUI;
    if (!stationUI || !stationUI.station) return null;
    const area = ensureAreaForStation(stationUI.station);
    if (!area) return null;
    const world = toWorld(sx, sy);
    const relX = world.x - area.origin.x;
    const relY = world.y - area.origin.y;
    const gx = Math.floor(relX / TILE);
    const gy = Math.floor(relY / TILE);
    const inside = gx >= 0 && gy >= 0 && gx < GRID_W && gy < GRID_H;
    return { area, gx, gy, inside };
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
    hoverCell = { ...hoverCell, valid: false };
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
    hoverCell = { ...hoverCell, valid: false };
    Build.state = state;
    return true;
  }

  function updateHover(sx, sy){
    const pointer = pointerToCell(sx, sy);
    if (!pointer || !pointer.area || !pointer.inside){
      hoverCell = { stationId: null, gx: -1, gy: -1, valid: false, affordable: false };
      Build.state = state;
      return;
    }
    const area = pointer.area;
    const valid = canPlace(area, selectedType, pointer.gx, pointer.gy);
    const affordable = canAfford(selectedType);
    hoverCell = {
      stationId: area.stationId,
      gx: pointer.gx,
      gy: pointer.gy,
      valid,
      affordable,
    };
    Build.state = state;
  }

  function ensureSelectedType(){
    if (!palette.includes(selectedType)){
      selectedType = palette[0];
    }
  }

  function renderPalette(){
    ensureSelectedType();
    const baseFill = '#E6F2FF';
    for (const type of palette){
      const isSelected = type === selectedType;
      const t = window.ctx ? window.ctx.getTransform() : null;
      if (!t) break;
      const label = type;
      const textWidth = window.ctx.measureText(label).width;
      const padding = 8;
      const w = textWidth + padding * 2;
      const h = 20;
      const L = t.e - padding;
      const T = t.f - 16;
      const R = L + w;
      const B = T + h;
      const over = window.mouse && window.mouse.x >= L && window.mouse.x <= R && window.mouse.y >= T && window.mouse.y <= B;
      if (over && window.canvas) window.canvas.style.cursor = 'pointer';
      window.ctx.fillStyle = isSelected ? 'rgba(96,165,250,0.35)' : 'rgba(15,23,42,0.55)';
      window.ctx.fillRect(L, T, w, h);
      window.ctx.fillStyle = isSelected ? '#f8fafc' : '#b8c9f3';
      window.ctx.fillText(label, 0, 0);
      if (over && window.mouse && window.mouse.click){
        selectedType = type;
        window.mouse.click = false;
      }
      window.ctx.translate(0, 24);
    }
    if (window.ctx) window.ctx.fillStyle = baseFill;
  }

  function formatSigned(val){
    if (!Number.isFinite(val)) return '0';
    if (val > 0) return `+${Math.round(val)}`;
    return String(Math.round(val));
  }

  Build.renderBuildTab = function(){
    const stationUI = window.stationUI;
    window.ctx.fillStyle = '#E6F2FF';
    uiTitle('Budowa');
    if (!stationUI || !stationUI.station){
      uiText('Brak stacji w zasięgu.');
      return;
    }

    if (window.__ECON){
      const econSnapshot = window.__ECON.serialize().economy || {};
      const credits = Math.floor(econSnapshot.credits || 0);
      const delta = Math.floor(econSnapshot.deltaPerMin || 0);
      uiText(`Kredyty: ${credits}  (Δ ${delta}/min)`);
    }

    const area = ensureAreaForStation(stationUI.station);
    recomputeArea(area);

    section('Paleta');
    renderPalette();
    window.ctx.translate(0, 8);

    section('Podsumowanie obszaru');
    uiText(`Energia netto: ${formatSigned(area.res.energyNet)} (prod ${Math.round(area.summary.energyProd)} / zużycie ${Math.round(area.summary.energyUse)})`);
    uiText(`Workforce: ${Math.round(area.res.wfHave)}/${Math.round(area.res.wfNeed)} (${formatSigned(area.res.workforce)})`);
    uiText(`Metale: ${Math.round(area.res.metal)}/${Math.round(area.res.capM)}`);
    uiText(`Gazy: ${Math.round(area.res.gas)}/${Math.round(area.res.capG)}`);
    uiText(`Stocznie: ${area.summary.shipyards}`);

    section('Wybrany budynek');
    ensureSelectedType();
    const meta = buildingMeta[selectedType];
    const econDefs = window.ECON_BUILDINGS || {};
    const econDef = econDefs[selectedType];
    if (meta && econDef){
      uiText(`${meta.label} — koszt: ${econDef.costCR || 0} CR`);
      uiText(`Koszt surowców: metal ${econDef.cost?.metal || 0}, gaz ${econDef.cost?.gas || 0}`);
      const energyLine = meta.energy.produce ? `+${meta.energy.produce}` : meta.energy.consume ? `-${meta.energy.consume}` : '0';
      const wfProvide = (meta.workforce && meta.workforce.provide) || 0;
      const wfNeed = (meta.workforce && meta.workforce.need) || 0;
      uiText(`Energia: ${energyLine}  Workforce: ${wfProvide}/${wfNeed}`);
      uiText(`Poj. metal: ${meta.storage.metal || 0}  gaz: ${meta.storage.gas || 0}`);
    } else {
      uiText(selectedType);
    }

    uiText('Sterowanie: LPM — buduj · PPM — usuń');

    Build.state = state;
  };

  Build.draw = function(ctx){
    if (!ctx) return;
    const stationUI = window.stationUI;
    if (!stationUI || !stationUI.open || stationUI.tab !== 'build' || !stationUI.station) return;
    const area = ensureAreaForStation(stationUI.station);
    recomputeArea(area);
    const cam = getCamera();
    const topLeft = toScreen(area.origin.x, area.origin.y);
    const tilePx = TILE * cam.zoom;
    const widthPx = GRID_W * tilePx;
    const heightPx = GRID_H * tilePx;

    ctx.save();
    ctx.fillStyle = 'rgba(12,16,32,0.62)';
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
      const bx = topLeft.x + b.x * tilePx;
      const by = topLeft.y + b.y * tilePx;
      const bw = (meta.size?.w || b.w || 1) * tilePx;
      const bh = (meta.size?.h || b.h || 1) * tilePx;
      ctx.globalAlpha = b.state === 'active' ? 0.95 : 0.55;
      ctx.fillStyle = meta.color || 'rgba(96,165,250,0.8)';
      ctx.fillRect(bx + 1, by + 1, bw - 2, bh - 2);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(15,23,42,0.7)';
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
      ctx.fillStyle = '#dbeafe';
      ctx.font = `${Math.max(10, tilePx * 0.28)}px Inter,system-ui,monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(meta.shortLabel || b.type, bx + bw / 2, by + bh / 2);
    }

    if (hoverCell && hoverCell.stationId === area.stationId && hoverCell.gx >= 0 && hoverCell.gy >= 0){
      const meta = buildingMeta[selectedType];
      if (meta){
        const bx = topLeft.x + hoverCell.gx * tilePx;
        const by = topLeft.y + hoverCell.gy * tilePx;
        const bw = (meta.size?.w || 1) * tilePx;
        const bh = (meta.size?.h || 1) * tilePx;
        const valid = hoverCell.valid && hoverCell.affordable;
        ctx.fillStyle = valid ? 'rgba(56,189,248,0.22)' : 'rgba(239,68,68,0.28)';
        ctx.fillRect(bx + 1, by + 1, bw - 2, bh - 2);
        ctx.strokeStyle = valid ? 'rgba(56,189,248,0.9)' : 'rgba(239,68,68,0.85)';
        ctx.lineWidth = 2;
        ctx.strokeRect(bx + 1, by + 1, bw - 2, bh - 2);
      }
    }

    ctx.restore();
  };

  Build.tick = function(dt, ctx){
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
    const stationUI = window.stationUI;
    if (!stationUI || stationUI.tab !== 'build') return false;
    if (e.button === 0){
      const mouse = window.mouse;
      if (mouse){
        const inX = mouse.x >= stationUI.x && mouse.x <= stationUI.x + stationUI.w;
        const inY = mouse.y >= stationUI.y && mouse.y <= stationUI.y + stationUI.h;
        if (inX && inY && mouse.y <= stationUI.y + 24){
          stationUI.dragging = true;
          stationUI.dragDX = mouse.x - stationUI.x;
          stationUI.dragDY = mouse.y - stationUI.y;
          return true;
        }
      }
      const pointer = pointerToCell(mouse?.x ?? 0, mouse?.y ?? 0);
      if (pointer && pointer.inside){
        if (placeBuilding(pointer.area, selectedType, pointer.gx, pointer.gy)){
          return true;
        }
      }
      return true;
    }
    if (e.button === 2){
      e.preventDefault();
      const mouse = window.mouse;
      const pointer = pointerToCell(mouse?.x ?? 0, mouse?.y ?? 0);
      if (pointer && pointer.inside){
        removeBuilding(pointer.area, pointer.gx, pointer.gy);
      }
      return true;
    }
    return false;
  };

  Build.onMouseUp = function(e){
    const stationUI = window.stationUI;
    if (!stationUI || stationUI.tab !== 'build') return false;
    if (e.button === 0){
      const wasDragging = stationUI.dragging;
      if (stationUI.dragging) stationUI.dragging = false;
      if (!wasDragging && window.mouse){
        window.mouse.click = true;
      }
      if (window.mouse) window.mouse.left = false;
      return true;
    }
    if (e.button === 2){
      if (window.mouse) window.mouse.right = false;
      return true;
    }
    return false;
  };

  Build.onMouseMove = function(e){
    const stationUI = window.stationUI;
    if (!stationUI || stationUI.tab !== 'build') return false;
    const mouse = window.mouse;
    if (mouse){
      updateHover(mouse.x, mouse.y);
    }
    return false;
  };

  Build.onContextMenu = function(e){
    const stationUI = window.stationUI;
    if (!stationUI || stationUI.tab !== 'build') return false;
    const mouse = window.mouse;
    const pointer = pointerToCell(mouse?.x ?? 0, mouse?.y ?? 0);
    if (pointer && pointer.inside && buildingAt(pointer.area, pointer.gx, pointer.gy)){
      e.preventDefault();
      return true;
    }
    return false;
  };

  Build.state = state;
})();
