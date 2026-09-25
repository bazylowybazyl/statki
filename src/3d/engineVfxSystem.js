// Dysze silników: MAIN i WARP w nowych modułach, SIDE na starym batchu.
//
//   MAIN  — mainExhaust3D.js (port dema wydechu): struga + iskry, jedna pula
//           na całą flotę; rozmiar i paleta PER STATEK (visual.engineFx,
//           edytowane w edytorze hardpointów, src/data/engineFx.js).
//   WARP  — warpPlume3D.js (port PlasmaEngineFX): leci z tych samych dysz co
//           MAIN na czas ładowania i skoku; pula z limitem, nadmiar dysz
//           dostaje strugę MAIN z dopalaczem.
//   SIDE  — engineExhaustBatch.js bez zmian (globalny tuner sideW/sideL).
import { Core3D } from './core3d.js';
import { EngineExhaustBatch, createExhaustState } from './engineExhaustBatch.js';
import { getEngineVfxClassScale } from './engineVfxScale.js';
import {
  MainExhaust3D,
  MAIN_EXHAUST_Z,
  createMainExhaustState,
  releaseMainExhaustState
} from './mainExhaust3D.js';
import { WarpPlume3D } from './warpPlume3D.js';
import { sceneOriginNearCamera } from './sceneOrigin.js';
import { GameState } from '../game/gameState.js';
import { buildEntityEngineFx, fallbackNozzleRadius } from '../data/engineFx.js';
import {
  getHullRenderProfile,
  resolveEntityHullProfileId,
  HULL_RENDER_WORLD_SCALE
} from '../data/ships.js';

import { DrawCallStats } from './drawCallStats.js';

// Silnik żywego statku nigdy nie gaśnie do zera — na jałowym dysza lekko
// pracuje (dawny płomień miał w tym miejscu stały rdzeń w wylocie).
const MAIN_IDLE_THROTTLE = 0.06;
// Iskry NPC rzadziej niż gracza: bank iskier dzielą bronie całej bitwy.
const NPC_SPARK_MUL = 0.35;

function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

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
// ktory batch przepisuje na atrybuty instancji. Cala flota rysuje sie stala
// liczba wywolan zamiast kilkoma NA DYSZE. Dysza MAIN trzyma stan strugi
// i (tylko w skoku) instancje plazmy warpa z puli.
function createEffects(slots) {
  const exhausts = [];
  for (const slot of slots) {
    if (slot.kind === 'side') exhausts.push({ state: createExhaustState(), slot, main: null, warp: null });
    else exhausts.push({ state: null, slot, main: createMainExhaustState(), warp: null });
  }
  return { exhausts, slotKey: makeSlotKey(slots) };
}

/**
 * Konfiguracja silników encji: blok z edytora (visual.engineFx — ustawia go
 * runtime układu NPC i układ gracza) albo zapas liczony od kadłuba.
 */
function resolveEntityEngineFx(entity) {
  const fx = entity?.visual?.engineFx;
  if (fx && typeof fx === 'object') return fx;
  const hullId = resolveEntityHullProfileId(entity);
  const cached = entity.__engineFxFallback;
  if (cached && cached.hullId === hullId) return cached;
  const renderLength = (Number(getHullRenderProfile(hullId)?.length) || 3000) * HULL_RENDER_WORLD_SCALE;
  const fallback = buildEntityEngineFx(hullId, null, 1);
  // Promień z domyślnych edytora jest w pikselach PNG i bez hpScale nic nie
  // znaczy — kadłub bez układu z edytora bierze dyszę od długości renderu.
  fallback.nozzleRadius = fallbackNozzleRadius(renderLength);
  fallback.hullId = hullId;
  entity.__engineFxFallback = fallback;
  return fallback;
}

/** Tryb napędu skokowego encji: 'off' | 'charging' | 'active'. */
function resolveWarpMode(entity) {
  if (entity.__warpPreview === true) return 'active';
  const player = GameState.ship;
  if (player && entity === player) {
    const w = GameState.warp;
    if (w?.state === 'charging') return 'charging';
    if (w?.state === 'active') return 'active';
    return 'off';
  }
  if (entity.state === 'warping_in' || entity.phase === 'warping') return 'active';
  return 'off';
}

/** Dopalacz silników MAIN (Shift w strefie planety; w edytorze — Shift testu). */
function resolveMainBoost(entity) {
  if (entity.__editorBoost === true) return true;
  const player = GameState.ship;
  return !!(player && entity === player && GameState.boost?.state === 'active');
}

/**
 * Plazma warpa na dyszy MAIN. Zwraca, co ma robić struga MAIN tej dyszy:
 * 'none' — normalna praca, 'on' — plazma pali (struga gaśnie),
 * 'fallback' — skok bez wolnej instancji (struga na dopalaczu).
 */
function driveWarpPlume(item, mode, frame, x, y, dirX, dirY, radius, fx) {
  let plume = item.warp;
  if (!plume) {
    if (mode === 'off') return 'none';
    plume = WarpPlume3D.acquire();
    if (!plume) return 'fallback';
    item.warp = plume;
  }
  if (mode === 'off') {
    plume.shutdown();
  } else {
    plume.ignite();              // bez skutku, gdy już pali
    plume.setBoost(mode === 'active');
  }
  plume.setPalette(fx.warpPaletteIndex | 0);
  plume.params.plumeLength = Number(fx.warpLength) > 0 ? Number(fx.warpLength) : 1;
  plume.setPose(x, y, MAIN_EXHAUST_Z, dirX, dirY, radius);
  plume.update(frame.dt, frame.camera, frame.viewportH, frame.isOrtho);
  if (plume.finished) {
    WarpPlume3D.release(plume);
    item.warp = null;
    return 'none';
  }
  return (plume.state === 'ignition' || plume.state === 'running') ? 'on' : 'none';
}

// Kontekst klatki (jeden obiekt, bez alokacji per klatkę).
const frameOrigin = { x: 0, y: 0 };
const frameCtx = {
  dt: 1 / 60,
  zoom: 1,
  camera: null,
  isOrtho: true,
  viewportH: 1080
};
const mainPush = {
  x: 0, y: 0, dirX: 0, dirY: -1, radius: 0, throttle: 0, boost: false,
  lengthMul: 1, widthMul: 1, palette: 0, jetGain: 1, sparkMul: 1, pixelRadius: 99, dt: 0
};

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

  // MAIN: rozmiar i paleta per statek, tryb skoku, dopalacz — raz na encję.
  const engineFx = resolveEntityEngineFx(entity);
  const warpMode = resolveWarpMode(entity);
  const mainBoost = resolveMainBoost(entity);
  const isPlayerEntity = entity === GameState.ship || entity.isPlayer === true;
  const isHulk = entity.isBridgeHulk === true;
  const jetGainRaw = (isPlayerEntity && typeof window !== 'undefined') ? Number(window.OPTIONS?.vfx?.bloomGain) : NaN;
  const jetGain = Number.isFinite(jetGainRaw) && jetGainRaw >= 0 ? jetGainRaw : 1;
  const sparkMul = isPlayerEntity ? 1 : NPC_SPARK_MUL;

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
    } else if (!isHulk) {
      slotThrottle = Math.max(slotThrottle, MAIN_IDLE_THROTTLE);
    }
    if (hasForcedThrottle) slotThrottle = forcedThrottleRaw;
    slotThrottle = Math.max(0, Math.min(1, slotThrottle));

    // Pozycje dysz pozostają w przestrzeni kadłuba. vfxScale dyszy dławi ją
    // przy utracie dowodzenia (shipBridge) — dla MAIN i SIDE tak samo.
    const slotScaleRaw = Number(slot?.source?.vfxScale);
    const slotScale = Number.isFinite(slotScaleRaw) && slotScaleRaw > 0 ? slotScaleRaw : 1;

    // Rozwiniety lancuch transformacji, ktory wczesniej robila hierarchia
    // Object3D: T(ex,-ey) . Rz(-angle) . S(scale) . T(lx,ly). Skala encji jest
    // jednorodna, wiec przechodzi przez obrot i mozna ja zwinac do jednej
    // pozycji i jednego kata na dysze.
    const nozzleWorldX = ex + (lx * scale) * cA - (ly * scale) * sA;
    const nozzleWorldY = sceneOriginY + (lx * scale) * sA + (ly * scale) * cA;

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

    if (slot.kind !== 'side') {
      const nozzleR = Math.max(0, Number(engineFx.nozzleRadius) || 0) * scale * slotScale;
      const warpUse = driveWarpPlume(item, isHulk ? 'off' : warpMode, frameCtx,
        nozzleWorldX, nozzleWorldY, dirX, dirY, nozzleR, engineFx);
      const warpOn = warpUse === 'on';
      const warpFallback = warpUse === 'fallback';

      const p = mainPush;
      p.x = nozzleWorldX;
      p.y = nozzleWorldY;
      p.dirX = dirX;
      p.dirY = dirY;
      p.radius = nozzleR;
      // Plazma pali — struga MAIN gaśnie; skok bez wolnej instancji — dopalacz.
      p.throttle = warpOn ? 0 : (warpFallback ? 1 : slotThrottle);
      p.boost = !warpOn && (warpFallback || mainBoost);
      p.lengthMul = Number(engineFx.mainLength) > 0 ? Number(engineFx.mainLength) : 1;
      p.widthMul = Number(engineFx.mainWidth) > 0 ? Number(engineFx.mainWidth) : 1;
      p.palette = engineFx.mainPaletteIndex | 0;
      p.jetGain = jetGain;
      p.sparkMul = sparkMul;
      p.pixelRadius = nozzleR * frameCtx.zoom;
      p.dt = dt;
      MainExhaust3D.push(item.main, p);

      // Gorące powietrze jak w demie plazmy: źródło = wylot (promień dyszy),
      // siła = rampa mocy × (1 + 0,5 · dopalacz); kształt stożka liczy uberPass.
      if (nozzleR > 0 && Core3D.pushHeatHazeWorld) {
        const plume = warpOn ? item.warp : null;
        const hazePower = plume ? plume.ch.power : Math.min(1, item.main.power);
        const hazeBoost = plume ? plume.ch.boost : (item.main.boosting ? 1 : 0);
        const hazeK = smoothstep(0.08, 0.45, hazePower) * (1 + 0.5 * hazeBoost);
        if (hazeK > 0.01) {
          Core3D.pushHeatHazeWorld(nozzleWorldX, nozzleWorldY, -4, nozzleR * (plume ? 1 : p.widthMul), hazeK, dirX, dirY);
        }
      }
      continue;
    }

    const tune = (typeof window !== 'undefined' && window.VFX_TUNE) ? window.VFX_TUNE : null;
    const widthMul = Math.max(0.05, Number(tune?.sideW) || 1);
    const lengthMul = Math.max(0.05, Number(tune?.sideL) || 1);
    const curveVal = Number(tune?.sideCurve ?? tune?.curve);
    const curve = Number.isFinite(curveVal) ? Math.max(0.2, Math.min(4.0, curveVal)) : 1.8;

    // Płomień boczny skaluje się z klasą statku, a globalny tuner jest końcowym
    // mnożnikiem (dysze boczne zostają na starym batchu).
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

    // Dalej łańcuch dyszy bocznej: . Rz(nozzleRot) . S(widthMul*effectScale,
    // lengthMul*effectScale) — para skal na instancję.
    EngineExhaustBatch.push(state, {
      x: nozzleWorldX,
      y: nozzleWorldY,
      rot: sceneAngle + nozzleRot,
      scaleX: scale * widthMul * effectScale,
      scaleY: scale * lengthMul * effectScale,
      dt
    });

    // Ten sam model gorącego powietrza co MAIN (stożek od wylotu w uberPass),
    // słabszy: wylot bocznej dyszy ~1/5 dawnego promienia smugi.
    const sideHaze = smoothstep(0.08, 0.45, Number(state.currentThrottle) || 0) * 0.6;
    if (sideHaze > 0.01 && Core3D.pushHeatHazeWorld) {
      const sideR = 78 * scale * classScale * slotScale * widthMul * 0.2;
      Core3D.pushHeatHazeWorld(nozzleWorldX, nozzleWorldY, -4, sideR, sideHaze, dirX, dirY);
    }
  }
}

function disposeEffects(fxData) {
  // Stan strugi oddaje właściciela (strugi dogasają same), plazma wraca do puli.
  if (fxData?.exhausts) {
    for (const item of fxData.exhausts) {
      if (item.main) releaseMainExhaustState(item.main);
      if (item.warp) WarpPlume3D.release(item.warp);
      item.main = null;
      item.warp = null;
    }
    fxData.exhausts.length = 0;
  }
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

    // Kamera tej klatki: zoom do LOD strug, kamera passa ortho do raymarchu
    // plazmy, początek układu strug przy środku kadru (precyzja float32).
    const cam = Core3D.activeCam1;
    frameCtx.dt = dt;
    frameCtx.zoom = Math.max(0.0001, Number(cam?.zoom) || 1);
    frameCtx.camera = Core3D.getPassCamera(true);
    frameCtx.isOrtho = frameCtx.camera === Core3D.cameraOrtho;
    frameCtx.viewportH = Math.max(1, Number(Core3D.renderer?.domElement?.height) || Number(Core3D.height) || 1080);
    sceneOriginNearCamera(frameOrigin, cam);

    EngineExhaustBatch.begin();
    MainExhaust3D.begin(frameOrigin.x, frameOrigin.y, dt);

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
    MainExhaust3D.flush(dt);
    const batchStats = EngineExhaustBatch.getStats();
    const mainStats = MainExhaust3D.getStats();
    // Plazma warpa: ~5 obiektów renderowalnych na aktywną instancję.
    const warpDraws = WarpPlume3D.activeCount * 5;
    DrawCallStats.addEngine(batchStats.nozzles + mainStats.nozzles, batchStats.draws + mainStats.draws + warpDraws);
  },

  disposeAll() {
    for (const [, fxData] of this.entityEffects) {
      disposeEffects(fxData);
    }
    this.entityEffects.clear();
    this._lastUpdateSec = 0;
    EngineExhaustBatch.dispose();
    MainExhaust3D.dispose();
    WarpPlume3D.disposeAll();
  }
};
