const DEFAULT_HP = Object.freeze({
  MAIN: 'main',
  MISSILE: 'missile',
  AUX: 'aux',
  HANGAR: 'hangar',
  SPECIAL: 'special'
});

const DEFAULT_COLORS = Object.freeze({
  main: '#53a7ff',
  missile: '#65e58e',
  aux: '#f8bd53',
  hangar: '#be7fff',
  special: '#ff6a6a'
});

function normalizeHpEnum(hardpointEnum) {
  return {
    MAIN: hardpointEnum?.MAIN || DEFAULT_HP.MAIN,
    MISSILE: hardpointEnum?.MISSILE || DEFAULT_HP.MISSILE,
    AUX: hardpointEnum?.AUX || DEFAULT_HP.AUX,
    HANGAR: hardpointEnum?.HANGAR || DEFAULT_HP.HANGAR,
    SPECIAL: hardpointEnum?.SPECIAL || DEFAULT_HP.SPECIAL
  };
}

function forwardFromEditorDeg(deg) {
  const rad = (Number(deg) || 0) * Math.PI / 180;
  return { x: Math.sin(rad), y: -Math.cos(rad) };
}

function normalizeEditorEngineDeg(value, fallback = 0) {
  let deg = Number.isFinite(Number(value)) ? Number(value) : Number(fallback) || 0;
  while (deg > 180) deg -= 360;
  while (deg < -180) deg += 360;
  return deg;
}

function inferEditorEngineMount(kind, x, y) {
  const lx = Number(x) || 0;
  const ly = Number(y) || 0;
  
  // y < 0 to lewa burta (góra sprite'a), y > 0 to prawa burta (dół sprite'a)
  if (kind === 'side') {
    const lateral = ly < 0 ? 'left' : 'right';
    if (Math.abs(lx) <= 12) return `center_${lateral}`;
    const longitudinal = lx < 0 ? 'rear' : 'front';
    return `${longitudinal}_${lateral}`;
  }
  
  const longitudinal = lx < 0 ? 'rear' : 'front';
  if (Math.abs(ly) <= 12) return `${longitudinal}_center`;
  return `${longitudinal}_${ly < 0 ? 'left' : 'right'}`;
}

function normalizeEditorEngineMount(kind, mount, x, y) {
  const allowed = kind === 'side'
    ? ['upper_left', 'center_left', 'lower_left', 'upper_right', 'center_right', 'lower_right']
    : ['rear_center', 'rear_upper', 'rear_lower', 'front_upper', 'front_lower'];
  const raw = String(mount || 'auto').toLowerCase();
  if (raw === 'auto') return inferEditorEngineMount(kind, x, y);
  if (allowed.includes(raw)) return raw;
  return inferEditorEngineMount(kind, x, y);
}

function normalizeEditorEngineGimbal(kind, minDeg, maxDeg) {
  const fallbackMin = kind === 'side' ? -90 : -45;
  const fallbackMax = kind === 'side' ? 90 : 45;
  let min = normalizeEditorEngineDeg(minDeg, fallbackMin);
  let max = normalizeEditorEngineDeg(maxDeg, fallbackMax);
  if (min > max) {
    const tmp = min;
    min = max;
    max = tmp;
  }
  return { min, max };
}

function clampNozzleDegToGimbal(nozzleDeg, baseDeg, gimbalMinDeg, gimbalMaxDeg) {
  const base = normalizeEditorEngineDeg(baseDeg, 0);
  const nozzle = normalizeEditorEngineDeg(nozzleDeg, base);
  const rel = normalizeEditorEngineDeg(nozzle - base, 0);
  const min = Number.isFinite(Number(gimbalMinDeg)) ? Number(gimbalMinDeg) : -45;
  const max = Number.isFinite(Number(gimbalMaxDeg)) ? Number(gimbalMaxDeg) : 45;
  const clamped = Math.max(min, Math.min(max, rel));
  return normalizeEditorEngineDeg(base + clamped, base);
}

function inferEditorEngineSide(mount, y = 0) {
  const raw = String(mount || '').toLowerCase();
  if (raw.endsWith('_left')) return 'left';
  if (raw.endsWith('_right')) return 'right';
  return (Number(y) || 0) < 0 ? 'left' : 'right';
}

function resolveEditorEngineOffset(kind, mount, y, offsetX, offsetY) {
  let dx = Number(offsetX) || 0;
  const dy = Number(offsetY) || 0;
  if (kind === 'side' && Math.abs(dx) > 1e-6) {
    dx *= inferEditorEngineSide(mount, y) === 'left' ? -1 : 1;
  }
  return { dx, dy };
}

function normalizeEditorHardpoint(marker, idx, hpEnum, validTypes) {
  const x = Number(marker?.x);
  const y = Number(marker?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const type = String(marker?.type || hpEnum.MAIN).toLowerCase();
  return {
    id: marker?.id || `ehp_${idx}`,
    type: validTypes.includes(type) ? type : hpEnum.MAIN,
    x,
    y
  };
}

function normalizeEditorCore(marker, idx) {
  const x = Number(marker?.x);
  const y = Number(marker?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    id: marker?.id || `core_${idx}`,
    x,
    y
  };
}

function normalizeEditorEngine(marker, idx, kind = 'main') {
  const x = Number(marker?.x);
  const y = Number(marker?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const rawDeg = normalizeEditorEngineDeg(marker?.deg, 0);
  const mount = normalizeEditorEngineMount(kind, marker?.mount, x, y);
  const baseDeg = (kind === 'side')
    ? (mount.endsWith('_right') ? 90 : -90)
    : rawDeg;
  const gimbal = normalizeEditorEngineGimbal(kind, marker?.gimbalMinDeg, marker?.gimbalMaxDeg);
  const nozzleRaw = normalizeEditorEngineDeg(marker?.nozzleDeg, baseDeg);
  const nozzleDeg = clampNozzleDegToGimbal(nozzleRaw, baseDeg, gimbal.min, gimbal.max);
  const resolvedOffset = resolveEditorEngineOffset(kind, mount, y, marker?.offsetX, marker?.offsetY);
  return {
    id: marker?.id || `eng_${idx}`,
    x: x + resolvedOffset.dx,
    y: y + resolvedOffset.dy,
    deg: baseDeg,
    baseDeg,
    nozzleDeg,
    mount,
    gimbalMinDeg: gimbal.min,
    gimbalMaxDeg: gimbal.max,
    offsetX: resolvedOffset.dx,
    offsetY: resolvedOffset.dy,
    vfxLengthMin: Number(marker?.vfxLengthMin) || 49,
    vfxLengthMax: Number(marker?.vfxLengthMax) || 354,
    vfxWidthMin: Number(marker?.vfxWidthMin) || 25,
    vfxWidthMax: Number(marker?.vfxWidthMax) || 227
  };
}

function getEditorShipIdForNpc(npc) {
  if (!npc) return null;
  const type = String(npc.type || '').toLowerCase();
  if (type === 'supercapital') return 'atlas';
  if (type === 'capital_carrier' || type === 'carrier') return 'capital_carrier';
  if (type === 'battleship') return npc.isPirate ? 'pirate_battleship' : 'battleship';
  if (type === 'destroyer') return npc.isPirate ? 'pirate_destroyer' : 'destroyer';
  if (type.includes('frigate')) return npc.isPirate ? 'pirate_frigate' : 'frigate';
  return null;
}

function cloneShipsMap(ships) {
  if (!ships || typeof ships !== 'object') return {};
  try {
    return JSON.parse(JSON.stringify(ships));
  } catch {
    return {};
  }
}

function mergeShipsDefaults(defaultShips, loadedShips) {
  const merged = cloneShipsMap(defaultShips);
  if (!loadedShips || typeof loadedShips !== 'object') return merged;
  for (const [shipId, shipCfg] of Object.entries(loadedShips)) {
    if (!shipCfg || typeof shipCfg !== 'object') continue;
    const base = merged[shipId] && typeof merged[shipId] === 'object' ? merged[shipId] : {};
    merged[shipId] = {
      ...base,
      ...shipCfg,
      hardpoints: Array.isArray(shipCfg.hardpoints) ? shipCfg.hardpoints : (Array.isArray(base.hardpoints) ? base.hardpoints : []),
      cores: Array.isArray(shipCfg.cores) ? shipCfg.cores : (Array.isArray(base.cores) ? base.cores : []),
      engines: {
        ...(base.engines && typeof base.engines === 'object' ? base.engines : {}),
        ...(shipCfg.engines && typeof shipCfg.engines === 'object' ? shipCfg.engines : {})
      }
    };
  }
  return merged;
}

function pickNpcHardpoint(owner, preferredType) {
  const list = Array.isArray(owner?.editorHardpoints) ? owner.editorHardpoints : null;
  if (!list || !list.length) return null;
  const typed = list.filter(h => h && h.type === preferredType);
  const pool = typed.length ? typed : list;
  owner.editorHardpointCursor = owner.editorHardpointCursor || {};
  const key = typed.length ? preferredType : 'all';
  const idx = Number(owner.editorHardpointCursor[key]) || 0;
  owner.editorHardpointCursor[key] = (idx + 1) % pool.length;
  return pool[idx % pool.length] || null;
}

function getOwnerHardpointScale(owner) {
  const scaleXRaw = Number(owner?.__hardpointScaleX);
  const scaleYRaw = Number(owner?.__hardpointScaleY);
  const uniformRaw = Number(owner?.__hardpointScale);
  const uniform = (Number.isFinite(uniformRaw) && uniformRaw > 0) ? uniformRaw : 1;
  return {
    x: (Number.isFinite(scaleXRaw) && scaleXRaw > 0) ? scaleXRaw : uniform,
    y: (Number.isFinite(scaleYRaw) && scaleYRaw > 0) ? scaleYRaw : uniform
  };
}

export function createNpcHardpointRuntime({
  hardpointEnum = DEFAULT_HP,
  storageKey = 'hpEditor.v1',
  defaultShips = {},
  pollInterval = 0.35
} = {}) {
  const HP = normalizeHpEnum(hardpointEnum);
  const validTypes = [HP.MAIN, HP.MISSILE, HP.AUX, HP.HANGAR, HP.SPECIAL];
  const colors = {
    [HP.MAIN]: DEFAULT_COLORS.main,
    [HP.MISSILE]: DEFAULT_COLORS.missile,
    [HP.AUX]: DEFAULT_COLORS.aux,
    [HP.HANGAR]: DEFAULT_COLORS.hangar,
    [HP.SPECIAL]: DEFAULT_COLORS.special
  };

  const state = {
    raw: '',
    version: 0,
    defaultShips: cloneShipsMap(defaultShips),
    ships: cloneShipsMap(defaultShips),
    pollTimer: 0
  };

  function refreshCache(force = false) {
    if (typeof localStorage === 'undefined') return false;
    let raw = '';
    try {
      raw = localStorage.getItem(storageKey) || '';
    } catch {
      return false;
    }
    if (!force && raw === state.raw) return false;
    state.raw = raw;
    state.version += 1;
    if (!raw) {
      state.ships = cloneShipsMap(state.defaultShips);
      return true;
    }
    try {
      const parsed = JSON.parse(raw);
      const ships = parsed?.ships;
      state.ships = mergeShipsDefaults(state.defaultShips, ships && typeof ships === 'object' ? ships : {});
    } catch {
      state.ships = cloneShipsMap(state.defaultShips);
    }
    return true;
  }

  function pollCache(dt) {
    state.pollTimer -= dt;
    if (state.pollTimer > 0) return false;
    state.pollTimer = pollInterval;
    return refreshCache(false);
  }

  function applyLayoutToNpc(npc) {
    if (!npc || npc.dead) return false;
    const editorShipId = getEditorShipIdForNpc(npc);
    if (!editorShipId) return false;

    const cfg = state.ships?.[editorShipId];
    if (!cfg || typeof cfg !== 'object') return false;
    if (npc.__editorLayoutVersion === state.version && npc.__editorLayoutShipId === editorShipId) {
      return true;
    }

    const hardpointsRaw = Array.isArray(cfg.hardpoints) ? cfg.hardpoints : [];
    const hardpoints = [];
    for (let i = 0; i < hardpointsRaw.length; i++) {
      const hp = normalizeEditorHardpoint(hardpointsRaw[i], i, HP, validTypes);
      if (hp) hardpoints.push(hp);
    }
    npc.editorHardpoints = hardpoints;
    const coresRaw = Array.isArray(cfg.cores) ? cfg.cores : [];
    const cores = [];
    for (let i = 0; i < coresRaw.length; i++) {
      const core = normalizeEditorCore(coresRaw[i], i);
      if (core) cores.push(core);
    }
    npc.editorCores = cores;
    npc.editorHardpointCursor = {};

    const enginesMainRaw = Array.isArray(cfg?.engines?.main) ? cfg.engines.main : [];
    const enginesSideRaw = Array.isArray(cfg?.engines?.side) ? cfg.engines.side : [];
    const mainEngine = enginesMainRaw.length ? normalizeEditorEngine(enginesMainRaw[0], 0, 'main') : null;

    if (mainEngine || enginesSideRaw.length) {
      npc.engines = npc.engines || {};
      npc.visual = npc.visual || {};
    }

    if (mainEngine) {
      npc.engines.main = Object.assign({}, npc.engines.main || {}, {
        vfxOffset: { x: mainEngine.x, y: mainEngine.y },
        vfxForward: forwardFromEditorDeg(mainEngine.nozzleDeg),
        vfxYNudge: mainEngine.offsetY,
        vfxLengthMin: Number(mainEngine.vfxLengthMin) || 10,
        vfxLengthMax: Number(mainEngine.vfxLengthMax) || 180,
        mount: mainEngine.mount,
        baseDeg: mainEngine.baseDeg,
        nozzleDeg: mainEngine.nozzleDeg,
        gimbalMinDeg: mainEngine.gimbalMinDeg,
        gimbalMaxDeg: mainEngine.gimbalMaxDeg
      });
    }

    if (enginesSideRaw.length) {
      const sideThrusters = [];
      for (let i = 0; i < enginesSideRaw.length; i++) {
        const engine = normalizeEditorEngine(enginesSideRaw[i], i, 'side');
        if (!engine) continue;
        sideThrusters.push({
          offset: { x: engine.x, y: engine.y },
          forward: forwardFromEditorDeg(engine.nozzleDeg),
          mount: engine.mount,
          baseDeg: engine.baseDeg,
          nozzleDeg: engine.nozzleDeg,
          gimbalMinDeg: engine.gimbalMinDeg,
          gimbalMaxDeg: engine.gimbalMaxDeg,
          side: inferEditorEngineSide(engine.mount, engine.y),
          yNudge: engine.offsetY,
          vfxWidthMin: engine.vfxWidthMin,
          vfxWidthMax: engine.vfxWidthMax,
          vfxLengthMin: engine.vfxLengthMin,
          vfxLengthMax: engine.vfxLengthMax
        });
      }
      if (sideThrusters.length) {
        npc.visual.torqueThrusters = sideThrusters;
      }
    }

    npc.__editorLayoutShipId = editorShipId;
    npc.__editorLayoutVersion = state.version;
    return true;
  }

  function resolveWeaponHardpointType(weaponDef, opts = {}) {
    const explicit = String(opts.hardpointType || '').toLowerCase();
    if (validTypes.includes(explicit)) return explicit;

    const kind = String(opts.type || '').toLowerCase();
    if (kind === 'rocket' || kind.includes('missile')) return HP.MISSILE;
    if (kind === 'ciws' || kind === 'flak' || kind === 'aux') return HP.AUX;

    const key = `${weaponDef?.id || ''} ${weaponDef?.name || ''}`.toLowerCase();
    if (key.includes('missile') || key.includes('rocket')) return HP.MISSILE;
    if (key.includes('ciws') || key.includes('pd') || key.includes('flak') || key.includes('autocannon')) return HP.AUX;
    if (key.includes('hangar') || key.includes('bay')) return HP.HANGAR;
    return HP.MAIN;
  }

  function resolveOwnerHardpointOrigin(owner, weaponDef, opts = {}) {
    if (!owner || opts.useHardpoint === false) return null;
    if (!owner.editorHardpoints || !owner.editorHardpoints.length) return null;
    const type = resolveWeaponHardpointType(weaponDef, opts);
    const hp = pickNpcHardpoint(owner, type);
    if (!hp) return null;

    const hpScale = getOwnerHardpointScale(owner);
    const localX = (Number(hp.x) || 0) * hpScale.x;
    const localY = (Number(hp.y) || 0) * hpScale.y;
    const baseX = Number.isFinite(owner.x) ? owner.x : (owner.pos?.x || 0);
    const baseY = Number.isFinite(owner.y) ? owner.y : (owner.pos?.y || 0);
    const angle = (owner.angle || 0) + (Number(owner.capitalProfile?.spriteRotation) || 0);
    const c = Math.cos(angle);
    const s = Math.sin(angle);

    return {
      x: baseX + localX * c - localY * s,
      y: baseY + localX * s + localY * c
    };
  }

  return {
    colors,
    refreshCache,
    pollCache,
    applyLayoutToNpc,
    resolveOwnerHardpointOrigin,
    resolveWeaponHardpointType,
    get version() {
      return state.version;
    }
  };
}
