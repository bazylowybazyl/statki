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
  return { x: Math.sin(rad), y: Math.cos(rad) };
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

function normalizeEditorEngine(marker, idx) {
  const x = Number(marker?.x);
  const y = Number(marker?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const offsetX = Number(marker?.offsetX) || 0;
  const offsetY = Number(marker?.offsetY) || 0;
  return {
    id: marker?.id || `eng_${idx}`,
    x: x + offsetX,
    y: y + offsetY,
    deg: Number(marker?.deg) || 0,
    offsetX,
    offsetY,
    vfxLengthMin: Number(marker?.vfxLengthMin) || 49,
    vfxLengthMax: Number(marker?.vfxLengthMax) || 354,
    vfxWidthMin: Number(marker?.vfxWidthMin) || 25,
    vfxWidthMax: Number(marker?.vfxWidthMax) || 227
  };
}

function getEditorShipIdForNpc(npc) {
  if (!npc) return null;
  const type = String(npc.type || '').toLowerCase();
  if (type === 'capital_carrier' || type === 'carrier') return 'capital_carrier';
  if (type === 'battleship') return npc.isPirate ? 'pirate_battleship' : 'battleship';
  if (type === 'destroyer') return npc.isPirate ? 'pirate_destroyer' : 'destroyer';
  if (type.includes('frigate')) return npc.isPirate ? 'pirate_frigate' : 'frigate';
  return null;
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

export function createNpcHardpointRuntime({
  hardpointEnum = DEFAULT_HP,
  storageKey = 'hpEditor.v1',
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
    ships: {},
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
      state.ships = {};
      return true;
    }
    try {
      const parsed = JSON.parse(raw);
      const ships = parsed?.ships;
      state.ships = ships && typeof ships === 'object' ? ships : {};
    } catch {
      state.ships = {};
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
    npc.editorHardpointCursor = {};

    const enginesMainRaw = Array.isArray(cfg?.engines?.main) ? cfg.engines.main : [];
    const enginesSideRaw = Array.isArray(cfg?.engines?.side) ? cfg.engines.side : [];
    const mainEngine = enginesMainRaw.length ? normalizeEditorEngine(enginesMainRaw[0], 0) : null;

    if (mainEngine || enginesSideRaw.length) {
      npc.engines = npc.engines || {};
      npc.visual = npc.visual || {};
    }

    if (mainEngine) {
      npc.engines.main = Object.assign({}, npc.engines.main || {}, {
        vfxOffset: { x: mainEngine.x, y: mainEngine.y },
        vfxForward: forwardFromEditorDeg(mainEngine.deg),
        vfxYNudge: mainEngine.offsetY,
        vfxLengthMin: Number(mainEngine.vfxLengthMin) || 10,
        vfxLengthMax: Number(mainEngine.vfxLengthMax) || 180
      });
    }

    if (enginesSideRaw.length) {
      const sideThrusters = [];
      for (let i = 0; i < enginesSideRaw.length; i++) {
        const engine = normalizeEditorEngine(enginesSideRaw[i], i);
        if (!engine) continue;
        sideThrusters.push({
          offset: { x: engine.x, y: engine.y },
          forward: forwardFromEditorDeg(engine.deg),
          side: null,
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

    const localX = Number(hp.x) || 0;
    const localY = Number(hp.y) || 0;
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
