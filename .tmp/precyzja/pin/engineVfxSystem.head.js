import { Core3D } from '/src/3d/core3d.js';
import { EngineExhaustBatch, createExhaustState } from '/src/3d/engineExhaustBatch.js';
import { getEngineVfxClassScale } from '/src/3d/engineVfxScale.js';

import { DrawCallStats } from '/src/3d/drawCallStats.js';
function getEntityScale(entity) {
  if (entity?.visual && typeof entity.visual.spriteScale === 'number') return entity.visual.spriteScale;
  return 1.0;
}

function getInterpolatedPose(entity) {
  if (typeof window === 'undefined') return null;
  if (!window.ship || entity !== window.ship) return null;
  const pose = window.__interpShipPose;
  if (!pose) return null;
  if (!Number.isFinite(pose.x) || !Number.isFinite(pose.y) || !Number.isFinite(pose.angle)) return null;
  return pose;
}

function normalizeDeg(value, fallback = 0) {
  let deg = Number.isFinite(Number(value)) ? Number(value) : Number(fallback) || 0;
  while (deg > 180) deg -= 360;
  while (deg < -180) deg += 360;
  return deg;
}

function normalizeForward(forward, fallbackX = 0, fallbackY = 1) {
  const rawX = Number(forward?.x);
  const rawY = Number(forward?.y);
  const x = Number.isFinite(rawX) ? rawX : fallbackX;
  const y = Number.isFinite(rawY) ? rawY : fallbackY;
  const lenSq = x * x + y * y;
  if (lenSq <= 1e-10) return { x: fallbackX, y: fallbackY };
  const inv = 1 / Math.sqrt(lenSq);
  return { x: x * inv, y: y * inv };
}

function forwardToDeg(forward) {
  const norm = normalizeForward(forward, 0, 1);
  return normalizeDeg(Math.atan2(norm.x, -norm.y) * 180 / Math.PI, 0);
}

function degToForward(deg) {
  const rad = normalizeDeg(deg, 0) * Math.PI / 180;
  return normalizeForward({ x: Math.sin(rad), y: -Math.cos(rad) }, 0, 1);
}

function normalizeGimbal(minDeg, maxDeg, fallbackMin, fallbackMax) {
  let min = normalizeDeg(minDeg, fallbackMin);
  let max = normalizeDeg(maxDeg, fallbackMax);
  if (min > max) {
    const tmp = min;
    min = max;
    max = tmp;
  }
  return { min, max };
}

function clampNozzleDegToGimbal(nozzleDeg, baseDeg, gimbalMinDeg, gimbalMaxDeg) {
  const base = normalizeDeg(baseDeg, 0);
  const nozzle = normalizeDeg(nozzleDeg, base);
  const rel = normalizeDeg(nozzle - base, 0);
  const min = Number.isFinite(Number(gimbalMinDeg)) ? Number(gimbalMinDeg) : -45;
  const max = Number.isFinite(Number(gimbalMaxDeg)) ? Number(gimbalMaxDeg) : 45;
  const clamped = Math.max(min, Math.min(max, rel));
  return normalizeDeg(base + clamped, base);
}

function inferSideFromMount(mount, y = 0) {
  const raw = String(mount || '').toLowerCase();
  if (raw.endsWith('_left')) return 'left';
  if (raw.endsWith('_right')) return 'right';
  return (Number(y) || 0) < 0 ? 'left' : 'right';
}

function resolveSlotForward(slot) {
  if (!slot) return { x: 0, y: 1 };
  const source = slot.source;
  const baseDeg = Number.isFinite(Number(source?.baseDeg))
    ? normalizeDeg(source.baseDeg, slot.baseDeg)
    : normalizeDeg(slot.baseDeg, forwardToDeg(slot.forward));
  const fallbackMin = slot.kind === 'side' ? -90 : -45;
  const fallbackMax = slot.kind === 'side' ? 90 : 45;
  const range = normalizeGimbal(
    Number.isFinite(Number(source?.gimbalMinDeg)) ? source.gimbalMinDeg : slot.gimbalMinDeg,
    Number.isFinite(Number(source?.gimbalMaxDeg)) ? source.gimbalMaxDeg : slot.gimbalMaxDeg,
    fallbackMin,
    fallbackMax
  );
  const nozzleRaw = Number.isFinite(Number(source?.nozzleDeg))
    ? source.nozzleDeg
    : (Number.isFinite(Number(slot.nozzleDeg)) ? slot.nozzleDeg : baseDeg);
  const nozzleDeg = clampNozzleDegToGimbal(nozzleRaw, baseDeg, range.min, range.max);
  return degToForward(nozzleDeg);
}

function buildSlots(entity) {
  const slots = [];

  const mainThrusters = Array.isArray(entity?.visual?.mainThrusters) ? entity.visual.mainThrusters : null;
  if (mainThrusters && mainThrusters.length) {
    for (const thruster of mainThrusters) {
      if (!thruster?.offset) continue;
      const ox = Number(thruster.offset.x);
      const oy = Number(thruster.offset.y);
      if (!Number.isFinite(ox) || !Number.isFinite(oy)) continue;
      const fwd = normalizeForward(thruster.forward, 0, 1);
      const baseDeg = Number.isFinite(Number(thruster?.baseDeg))
        ? normalizeDeg(thruster.baseDeg, forwardToDeg(fwd))
        : forwardToDeg(fwd);
      const gimbal = normalizeGimbal(thruster?.gimbalMinDeg, thruster?.gimbalMaxDeg, -45, 45);
      const nozzleDeg = clampNozzleDegToGimbal(
        Number.isFinite(Number(thruster?.nozzleDeg)) ? thruster.nozzleDeg : baseDeg,
        baseDeg,
        gimbal.min,
        gimbal.max
      );
      slots.push({
        kind: 'main',
        mode: 'absolute',
        source: thruster,
        offset: { x: ox, y: oy },
        forward: degToForward(nozzleDeg),
        mount: String(thruster?.mount || ''),
        baseDeg,
        nozzleDeg,
        gimbalMinDeg: gimbal.min,
        gimbalMaxDeg: gimbal.max,
        side: null
      });
    }
  } else {
    const mainEngine = entity?.engines?.main;
    if (mainEngine) {
      const mainOffset = mainEngine.vfxOffset || mainEngine.visualOffset || mainEngine.offset;
      if (mainOffset && Number.isFinite(mainOffset.x) && Number.isFinite(mainOffset.y)) {
        const baseForward = normalizeForward(mainEngine.vfxForward, 0, 1);
        const baseDeg = Number.isFinite(Number(mainEngine?.baseDeg))
          ? normalizeDeg(mainEngine.baseDeg, forwardToDeg(baseForward))
          : forwardToDeg(baseForward);
        const gimbal = normalizeGimbal(mainEngine?.gimbalMinDeg, mainEngine?.gimbalMaxDeg, -45, 45);
        const nozzleDeg = clampNozzleDegToGimbal(
          Number.isFinite(Number(mainEngine?.nozzleDeg)) ? mainEngine.nozzleDeg : baseDeg,
          baseDeg,
          gimbal.min,
          gimbal.max
        );
        slots.push({
          kind: 'main',
          mode: 'absolute',
          source: mainEngine,
          offset: { x: Number(mainOffset.x) || 0, y: Number(mainOffset.y) || 0 },
          forward: degToForward(nozzleDeg),
          mount: String(mainEngine?.mount || ''),
          baseDeg,
          nozzleDeg,
          gimbalMinDeg: gimbal.min,
          gimbalMaxDeg: gimbal.max,
          side: null
        });
      }
    }
  }

  const sideThrusters = Array.isArray(entity?.visual?.torqueThrusters) ? entity.visual.torqueThrusters : null;
  if (sideThrusters && sideThrusters.length) {
    for (const thruster of sideThrusters) {
      if (!thruster?.offset) continue;
      const ox = Number(thruster.offset.x);
      const oy = Number(thruster.offset.y);
      if (!Number.isFinite(ox) || !Number.isFinite(oy)) continue;
      const fwd = normalizeForward(thruster.forward, 0, 1);
      const baseDeg = Number.isFinite(Number(thruster?.baseDeg))
        ? normalizeDeg(thruster.baseDeg, forwardToDeg(fwd))
        : forwardToDeg(fwd);
      const gimbal = normalizeGimbal(thruster?.gimbalMinDeg, thruster?.gimbalMaxDeg, -90, 90);
      const nozzleDeg = clampNozzleDegToGimbal(
        Number.isFinite(Number(thruster?.nozzleDeg)) ? thruster.nozzleDeg : baseDeg,
        baseDeg,
        gimbal.min,
        gimbal.max
      );
      const mount = String(thruster?.mount || '');
      slots.push({
        kind: 'side',
        mode: 'absolute',
        source: thruster,
        offset: { x: ox, y: oy },
        forward: degToForward(nozzleDeg),
        mount,
        baseDeg,
        nozzleDeg,
        gimbalMinDeg: gimbal.min,
        gimbalMaxDeg: gimbal.max,
        side: thruster.side === 'left' || thruster.side === 'right'
          ? thruster.side
          : inferSideFromMount(mount, oy)
      });
    }
  }

  if (slots.length > 0) return slots;

  const legacyOffsets = Array.isArray(entity?.capitalProfile?.engineOffsets) ? entity.capitalProfile.engineOffsets : null;
  if (!legacyOffsets || !legacyOffsets.length) return slots;
  for (const offset of legacyOffsets) {
    const ox = Number(offset?.x);
    const oy = Number(offset?.y);
    if (!Number.isFinite(ox) || !Number.isFinite(oy)) continue;
    slots.push({
      kind: 'main',
      mode: 'normalized',
      offset: { x: ox, y: oy },
      forward: { x: 0, y: 1 },
      side: null
    });
  }

  return slots;
}

function makeSlotKey(slots) {
  return slots.map((slot) => {
    const mode = slot.mode || 'absolute';
    const kind = slot.kind || 'main';
    const mount = String(slot.mount || '');
    const side = slot.side || '';
    const ox = Number(slot.offset?.x) || 0;
    const oy = Number(slot.offset?.y) || 0;
    const baseDeg = Number(slot.baseDeg) || 0;
    const gimbalMinDeg = Number(slot.gimbalMinDeg) || 0;
    const gimbalMaxDeg = Number(slot.gimbalMaxDeg) || 0;
    return `${mode}|${kind}|${side}|${mount}|${ox.toFixed(2)}|${oy.toFixed(2)}|${baseDeg.toFixed(2)}|${gimbalMinDeg.toFixed(2)}|${gimbalMaxDeg.toFixed(2)}`;
  }).join('||');
}

// Dysza nie ma juz wlasnych obiektow w scenie — zostaje sam stan wygladzania,
// ktory EngineExhaustBatch przepisuje na atrybuty instancji. Cala flota rysuje
// sie czterema wywolaniami zamiast czterema NA DYSZE.
function createEffects(slots) {
  const exhausts = [];
  for (const slot of slots) {
    exhausts.push({ state: createExhaustState(), slot });
  }
  return { exhausts, slotKey: makeSlotKey(slots) };
}

function updateEffects(entity, fxData, dt) {
  const interpPose = getInterpolatedPose(entity);
  const ex = interpPose ? interpPose.x : (entity?.pos ? entity.pos.x : (entity?.x || 0));
  const ey = interpPose ? interpPose.y : (entity?.pos ? entity.pos.y : (entity?.y || 0));
  const angle = interpPose ? interpPose.angle : (entity?.angle || 0);
  const scale = getEntityScale(entity);
  const classScale = getEngineVfxClassScale(entity);

  const sceneOriginY = -ey;
  const sceneAngle = -angle;
  const cA = Math.cos(sceneAngle);
  const sA = Math.sin(sceneAngle);

  const speed = Math.hypot(entity.vx || entity.vel?.x || 0, entity.vy || entity.vel?.y || 0);
  const moveGlow = Math.min(speed / 900, 0.6) * 0.8;
  const thrustMain = Math.max(
    0,
    entity.thrusterInput?.main || 0,
    entity.input?.main || 0,
    entity.input?.thrustY || 0
  );
  const strafeLeft = Math.max(0, entity.thrusterInput?.leftSide || 0);
  const strafeRight = Math.max(0, entity.thrusterInput?.rightSide || 0);
  const torque = Math.abs(entity.thrusterInput?.torque || 0);
  const mainThrottle = Math.max(thrustMain, moveGlow);

  const lengthScale = entity.capitalProfile?.lengthScale || 3.2;
  const widthScale = entity.capitalProfile?.widthScale || 1.2;
  const radius = entity.radius || 20;
  const halfL = radius * lengthScale * 0.5;
  const halfW = radius * widthScale * 0.5;

  for (const item of fxData.exhausts) {
    const slot = item.slot || {};
    const slotForward = resolveSlotForward(slot);
    const nozzleRot = Math.atan2(-slotForward.y, slotForward.x) - (Math.PI * 0.5);
    const offset = slot.offset || { x: 0, y: 0 };
    const lx = slot.mode === 'normalized'
      ? (offset.x || 0) * halfL
      : (offset.x || 0);
    const ly = slot.mode === 'normalized'
      ? -(offset.y || 0) * halfW
      : -(offset.y || 0);

    const forcedThrottleRaw = Number(slot?.source?.__throttle);
    const hasForcedThrottle = Number.isFinite(forcedThrottleRaw);
    let slotThrottle = mainThrottle;
    if (slot.kind === 'side') {
      const sideDrive = slot.side === 'left'
        ? strafeLeft
        : (slot.side === 'right' ? strafeRight : Math.max(strafeLeft, strafeRight));
      slotThrottle = Math.max(sideDrive, torque * 0.8, moveGlow * 0.55);
    }
    if (hasForcedThrottle) slotThrottle = forcedThrottleRaw;
    slotThrottle = Math.max(0, Math.min(1, slotThrottle));

    const tune = (typeof window !== 'undefined' && window.VFX_TUNE) ? window.VFX_TUNE : null;
    const widthMul = slot.kind === 'side'
      ? Math.max(0.05, Number(tune?.sideW) || 1)
      : Math.max(0.05, Number(tune?.mainW) || 1);
    const lengthMul = slot.kind === 'side'
      ? Math.max(0.05, Number(tune?.sideL) || 1)
      : Math.max(0.05, Number(tune?.mainL) || 1);
    const curveVal = slot.kind === 'side'
      ? Number(tune?.sideCurve ?? tune?.curve)
      : Number(tune?.mainCurve ?? tune?.curve);
    const curve = Number.isFinite(curveVal) ? Math.max(0.2, Math.min(4.0, curveVal)) : 1.8;

    // Pozycje dysz pozostają w przestrzeni kadłuba. Tylko sam płomień skaluje
    // się z klasą statku, a globalny tuner jest końcowym mnożnikiem.
    const slotScaleRaw = Number(slot?.source?.vfxScale);
    const slotScale = Number.isFinite(slotScaleRaw) && slotScaleRaw > 0 ? slotScaleRaw : 1;
    const effectScale = classScale * slotScale;

    const state = item.state;
    state.curve = curve;
    state.throttleTarget = slotThrottle;
    if (entity.isPlayer && typeof window !== 'undefined' && window.OPTIONS?.vfx) {
      const driveColorTemp = Number(window.shipDriveState?.engineColorTempK);
      state.colorTempK = Number.isFinite(driveColorTemp)
        ? driveColorTemp
        : window.OPTIONS.vfx.colorTempK;
      state.bloomGain = window.OPTIONS.vfx.bloomGain;
    }

    // Rozwiniety lancuch transformacji, ktory wczesniej robila hierarchia
    // Object3D: T(ex,-ey) . Rz(-angle) . S(scale) . T(lx,ly) . Rz(nozzleRot)
    // . S(widthMul*effectScale, lengthMul*effectScale). Skala encji jest
    // jednorodna, wiec przechodzi przez obrot i mozna ja zwinac do jednej
    // pozycji, jednego kata i pary skal na instancje.
    const nozzleWorldX = ex + (lx * scale) * cA - (ly * scale) * sA;
    const nozzleWorldY = sceneOriginY + (lx * scale) * sA + (ly * scale) * cA;

    EngineExhaustBatch.push(state, {
      x: nozzleWorldX,
      y: nozzleWorldY,
      rot: sceneAngle + nozzleRot,
      scaleX: scale * widthMul * effectScale,
      scaleY: scale * lengthMul * effectScale,
      dt
    });

    if (slotThrottle > 0.06 && Core3D.pushHeatHazeWorld) {
      const localX = lx * scale;
      const localY = ly * scale;
      const worldX = ex + localX * cA - localY * sA;
      const worldY = sceneOriginY + localX * sA + localY * cA;
      const baseRadius = slot.kind === 'side' ? 78 : 110;
      const radiusWorld = baseRadius * scale * classScale * slotScale * widthMul * (0.55 + slotThrottle * 0.9);
      const warpState = (typeof window !== 'undefined' && window.warp?.state === 'active') ? 1 : 0;
      const strength = slotThrottle * (1.0 + moveGlow * 0.6 + warpState * 0.5);

      // Kierunek wydechu = os dyszy (slotForward) obrocona do sceny,
      // spojnie z meshem plomienia — nie wektor srodek statku -> dysza.
      const fwdX = Number(slotForward.x);
      const fwdY = Number(slotForward.y);
      const localDirX = Number.isFinite(fwdX) ? -fwdX : 0;
      const localDirY = Number.isFinite(fwdY) ? fwdY : 1;
      let dirX = localDirX * cA - localDirY * sA;
      let dirY = localDirX * sA + localDirY * cA;
      const dirLen = Math.sqrt(dirX * dirX + dirY * dirY);
      if (dirLen > 0.0001) {
        dirX /= dirLen;
        dirY /= dirLen;
      } else {
        dirX = 0;
        dirY = -1;
      }

      // Jedno zrodlo na dysze: shader sam wydluza haze w stozek wzdluz kierunku.
      const plumeBoost = 0.9 + slotThrottle * 0.35 + warpState * 0.3;
      Core3D.pushHeatHazeWorld(worldX, worldY, -4, radiusWorld * plumeBoost, strength, dirX, dirY);
    }
  }
}

function disposeEffects(fxData) {
  // Brak obiektow w scenie — stan dyszy odchodzi razem z wpisem w mapie.
  if (fxData?.exhausts) fxData.exhausts.length = 0;
}

export const EngineVfxSystem = {
  entityEffects: new Map(),
  _activeScratch: new Set(),
  _lastUpdateSec: 0,

  update(entities = []) {
    if (!Core3D.isInitialized || !Core3D.scene) return;

    // Licznik zrodel kasuje pass w Core3D.render(); tutaj tylko dorzucamy.

    // Wspólny Set zamiast nowego co klatkę (update nie jest re-entrant).
    const activeEntities = this._activeScratch;
    activeEntities.clear();
    const now = (typeof performance !== 'undefined') ? performance.now() / 1000 : 0;
    // UWAGA na zmiane zachowania: stary kod wolal `exhaust.update(time)`, gdzie
    // `time` to bylo BEZWZGLEDNE performance.now()/1000, a funkcja oczekiwala
    // `dt`. Skutki: wewnetrzne uTime rosnie o kilkanascie tysiecy na klatke
    // (turbulencja i shock diamonds migotaly losowo zamiast plynac, a po dluzszej
    // sesji float32 tracil precyzje), a heatAccumulator saturowal sie do 1.0 w
    // pierwszej klatce (heat glow zawsze na maksa). Teraz leci prawdziwy dt.
    const dt = this._lastUpdateSec > 0 ? Math.max(0, Math.min(0.1, now - this._lastUpdateSec)) : 1 / 60;
    this._lastUpdateSec = now;

    EngineExhaustBatch.begin();

    for (const entity of entities) {
      if (!entity || entity.dead) continue;

      const slots = buildSlots(entity);
      if (!slots.length) continue;
      activeEntities.add(entity);

      let fxData = this.entityEffects.get(entity);
      const slotKey = makeSlotKey(slots);
      if (!fxData || fxData.slotKey !== slotKey) {
        if (fxData) disposeEffects(fxData);
        fxData = createEffects(slots);
        this.entityEffects.set(entity, fxData);
      }

      updateEffects(entity, fxData, dt);
    }

    for (const [entity, fxData] of this.entityEffects) {
      if (!activeEntities.has(entity)) {
        disposeEffects(fxData);
        this.entityEffects.delete(entity);
      }
    }

    EngineExhaustBatch.flush();
    const batchStats = EngineExhaustBatch.getStats();
    DrawCallStats.addEngine(batchStats.nozzles, batchStats.draws);
  },

  disposeAll() {
    for (const [, fxData] of this.entityEffects) {
      disposeEffects(fxData);
    }
    this.entityEffects.clear();
    this._lastUpdateSec = 0;
    EngineExhaustBatch.dispose();
  }
};
