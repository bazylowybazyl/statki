// src/data/editorEngines.js
//
// Czyste funkcje markerów edytora gniazd (dysze MAIN / SIDE, gniazda broni, rdzenie) — przeniesione z
// src/game/npcHardpointRuntime.js (E17b, 2026-10-28), żeby czytał je też render (proxy statków ruchu: modele dysz SIDE,
// wieże — src/3d nie importuje src/game, strażnik tests/szewRenderu.test.mjs). Bez stanu, DOM i localStorage; runtime
// NPC (npcHardpointRuntime.js) importuje je stąd — jedna konwencja kątów, montażu i gimbala dla gry i obrazu.

export function forwardFromEditorDeg(deg) {
  const rad = (Number(deg) || 0) * Math.PI / 180;
  return { x: Math.sin(rad), y: -Math.cos(rad) };
}

export function normalizeEditorEngineDeg(value, fallback = 0) {
  let deg = Number.isFinite(Number(value)) ? Number(value) : Number(fallback) || 0;
  while (deg > 180) deg -= 360;
  while (deg < -180) deg += 360;
  return deg;
}

export function inferEditorEngineMount(kind, x, y) {
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

export function normalizeEditorEngineMount(kind, mount, x, y) {
  const allowed = kind === 'side'
    ? ['upper_left', 'center_left', 'lower_left', 'upper_right', 'center_right', 'lower_right']
    : ['rear_center', 'rear_upper', 'rear_lower', 'front_upper', 'front_lower'];
  const raw = String(mount || 'auto').toLowerCase();
  if (raw === 'auto') return inferEditorEngineMount(kind, x, y);
  if (allowed.includes(raw)) return raw;
  return inferEditorEngineMount(kind, x, y);
}

export function normalizeEditorEngineGimbal(kind, minDeg, maxDeg) {
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

export function clampNozzleDegToGimbal(nozzleDeg, baseDeg, gimbalMinDeg, gimbalMaxDeg) {
  const base = normalizeEditorEngineDeg(baseDeg, 0);
  const nozzle = normalizeEditorEngineDeg(nozzleDeg, base);
  const rel = normalizeEditorEngineDeg(nozzle - base, 0);
  const min = Number.isFinite(Number(gimbalMinDeg)) ? Number(gimbalMinDeg) : -45;
  const max = Number.isFinite(Number(gimbalMaxDeg)) ? Number(gimbalMaxDeg) : 45;
  const clamped = Math.max(min, Math.min(max, rel));
  return normalizeEditorEngineDeg(base + clamped, base);
}

export function inferEditorEngineSide(mount, y = 0) {
  const raw = String(mount || '').toLowerCase();
  if (raw.endsWith('_left')) return 'left';
  if (raw.endsWith('_right')) return 'right';
  return (Number(y) || 0) < 0 ? 'left' : 'right';
}

export function resolveEditorEngineOffset(kind, mount, y, offsetX, offsetY) {
  let dx = Number(offsetX) || 0;
  const dy = Number(offsetY) || 0;
  if (kind === 'side' && Math.abs(dx) > 1e-6) {
    dx *= inferEditorEngineSide(mount, y) === 'left' ? -1 : 1;
  }
  return { dx, dy };
}

export function normalizeEditorHardpoint(marker, idx, hpEnum, validTypes) {
  const x = Number(marker?.x);
  const y = Number(marker?.y);
  const rot = Number(marker?.rot);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const type = String(marker?.type || hpEnum.MAIN).toLowerCase();
  return {
    id: marker?.id || `ehp_${idx}`,
    type: validTypes.includes(type) ? type : hpEnum.MAIN,
    x,
    y,
    rot: Number.isFinite(rot) ? normalizeEditorEngineDeg(rot, 90) : (type === hpEnum.BUILTIN ? 90 : 0)
  };
}

export function normalizeEditorCore(marker, idx) {
  const x = Number(marker?.x);
  const y = Number(marker?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    id: marker?.id || `core_${idx}`,
    x,
    y
  };
}

export function normalizeEditorEngine(marker, idx, kind = 'main') {
  const x = Number(marker?.x);
  const y = Number(marker?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const rawDeg = normalizeEditorEngineDeg(marker?.deg, 0);
  const mount = normalizeEditorEngineMount(kind, marker?.mount, x, y);
  // SIDE: kąt z edytora (deg 0 — prawa burta, 180 — lewa: wydech na zewnątrz), jak dysze gracza (index.html,
  // normalizeEditorEngineMarker). Do 2026-10-07 baza ±90° (wydech wzdłuż kadłuba, w zakresie gimbala także pod
  // kadłub) — przy modelach 3D dysz dzwon celował w pokład. Marker bez kąta — na zewnątrz swojej burty.
  const baseDeg = (kind === 'side' && !Number.isFinite(Number(marker?.deg)))
    ? (inferEditorEngineSide(mount, y) === 'left' ? 180 : 0)
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

// Dysze MAIN (visual.mainThrusters) z markerów edytora: pozycje w px PNG × skala hardpointów kadłuba.
export function buildMainThrusters(markers, hpScaleX, hpScaleY) {
  const mainThrusters = [];
  if (!Array.isArray(markers)) return mainThrusters;
  for (let i = 0; i < markers.length; i++) {
    const engine = normalizeEditorEngine(markers[i], i, 'main');
    if (!engine) continue;
    mainThrusters.push({
      offset: { x: engine.x * hpScaleX, y: engine.y * hpScaleY },
      forward: forwardFromEditorDeg(engine.nozzleDeg),
      mount: engine.mount,
      baseDeg: engine.baseDeg,
      nozzleDeg: engine.nozzleDeg,
      gimbalMinDeg: engine.gimbalMinDeg,
      gimbalMaxDeg: engine.gimbalMaxDeg,
      yNudge: engine.offsetY * hpScaleY,
      vfxLengthMin: engine.vfxLengthMin,
      vfxLengthMax: engine.vfxLengthMax
    });
  }
  return mainThrusters;
}

// Dysze SIDE (visual.torqueThrusters) z markerów edytora: pozycje w px PNG × skala hardpointów kadłuba.
export function buildSideThrusters(markers, hpScaleX, hpScaleY) {
  const sideThrusters = [];
  if (!Array.isArray(markers)) return sideThrusters;
  for (let i = 0; i < markers.length; i++) {
    const engine = normalizeEditorEngine(markers[i], i, 'side');
    if (!engine) continue;
    sideThrusters.push({
      offset: { x: engine.x * hpScaleX, y: engine.y * hpScaleY },
      forward: forwardFromEditorDeg(engine.nozzleDeg),
      mount: engine.mount,
      baseDeg: engine.baseDeg,
      nozzleDeg: engine.nozzleDeg,
      gimbalMinDeg: engine.gimbalMinDeg,
      gimbalMaxDeg: engine.gimbalMaxDeg,
      side: inferEditorEngineSide(engine.mount, engine.y),
      yNudge: engine.offsetY * hpScaleY,
      vfxWidthMin: engine.vfxWidthMin,
      vfxWidthMax: engine.vfxWidthMax,
      vfxLengthMin: engine.vfxLengthMin,
      vfxLengthMax: engine.vfxLengthMax
    });
  }
  return sideThrusters;
}
