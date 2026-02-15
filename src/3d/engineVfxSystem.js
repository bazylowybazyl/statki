import * as THREE from 'three';
import { Core3D } from './core3d.js';
import { createShortNeedleExhaust } from '../../Engineeffects.js';

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

function buildSlots(entity) {
  const slots = [];

  const mainEngine = entity?.engines?.main;
  if (mainEngine) {
    const mainOffset = mainEngine.vfxOffset || mainEngine.visualOffset || mainEngine.offset;
    if (mainOffset && Number.isFinite(mainOffset.x) && Number.isFinite(mainOffset.y)) {
      slots.push({
        kind: 'main',
        mode: 'absolute',
        offset: { x: Number(mainOffset.x) || 0, y: Number(mainOffset.y) || 0 },
        forward: (mainEngine.vfxForward && Number.isFinite(mainEngine.vfxForward.x) && Number.isFinite(mainEngine.vfxForward.y))
          ? { x: Number(mainEngine.vfxForward.x) || 0, y: Number(mainEngine.vfxForward.y) || 1 }
          : { x: 0, y: 1 },
        side: null
      });
    }
  }

  const sideThrusters = Array.isArray(entity?.visual?.torqueThrusters) ? entity.visual.torqueThrusters : null;
  if (sideThrusters && sideThrusters.length) {
    for (const thruster of sideThrusters) {
      if (!thruster?.offset) continue;
      const ox = Number(thruster.offset.x);
      const oy = Number(thruster.offset.y);
      if (!Number.isFinite(ox) || !Number.isFinite(oy)) continue;
      const fwd = thruster.forward || { x: 0, y: 1 };
      slots.push({
        kind: 'side',
        mode: 'absolute',
        offset: { x: ox, y: oy },
        forward: {
          x: Number.isFinite(Number(fwd.x)) ? Number(fwd.x) : 0,
          y: Number.isFinite(Number(fwd.y)) ? Number(fwd.y) : 1
        },
        side: thruster.side === 'left' || thruster.side === 'right' ? thruster.side : null
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
    const side = slot.side || '';
    const ox = Number(slot.offset?.x) || 0;
    const oy = Number(slot.offset?.y) || 0;
    const fx = Number(slot.forward?.x) || 0;
    const fy = Number(slot.forward?.y) || 0;
    return `${mode}|${kind}|${side}|${ox.toFixed(2)}|${oy.toFixed(2)}|${fx.toFixed(4)}|${fy.toFixed(4)}`;
  }).join('||');
}

function createEffects(slots) {
  const group = new THREE.Group();
  Core3D.scene.add(group);

  const exhausts = [];
  for (const slot of slots) {
    const exhaust = createShortNeedleExhaust();
    const fwd = slot.forward || { x: 0, y: 1 };
    const len = Math.hypot(fwd.x || 0, fwd.y || 0) || 1;
    const nx = (fwd.x || 0) / len;
    const ny = (fwd.y || 0) / len;
    exhaust.group.rotation.z = Math.atan2(-ny, nx) - (Math.PI * 0.5);
    group.add(exhaust.group);
    exhausts.push({ instance: exhaust, slot });
  }

  return { group, exhausts, slotKey: makeSlotKey(slots) };
}

function updateEffects(entity, fxData, time) {
  const interpPose = getInterpolatedPose(entity);
  const ex = interpPose ? interpPose.x : (entity?.pos ? entity.pos.x : (entity?.x || 0));
  const ey = interpPose ? interpPose.y : (entity?.pos ? entity.pos.y : (entity?.y || 0));
  const angle = interpPose ? interpPose.angle : (entity?.angle || 0);
  const scale = getEntityScale(entity);

  fxData.group.position.set(ex, -ey, 0);
  fxData.group.rotation.z = -angle;
  fxData.group.scale.set(scale, scale, 1);

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
    const offset = slot.offset || { x: 0, y: 0 };
    const lx = slot.mode === 'normalized'
      ? (offset.x || 0) * halfL
      : (offset.x || 0);
    const ly = slot.mode === 'normalized'
      ? -(offset.y || 0) * halfW
      : -(offset.y || 0);

    let slotThrottle = mainThrottle;
    if (slot.kind === 'side') {
      const sideDrive = slot.side === 'left'
        ? strafeLeft
        : (slot.side === 'right' ? strafeRight : Math.max(strafeLeft, strafeRight));
      slotThrottle = Math.max(sideDrive, torque * 0.8, moveGlow * 0.55);
    }
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

    item.instance.group.position.set(lx, ly, -5);
    item.instance.group.scale.set(widthMul, lengthMul, 1);
    if (item.instance.setCurve) item.instance.setCurve(curve);
    if (item.instance.setThrottle) item.instance.setThrottle(slotThrottle);
    if (entity.isPlayer && typeof window !== 'undefined' && window.OPTIONS?.vfx) {
      if (item.instance.setColorTemp) item.instance.setColorTemp(window.OPTIONS.vfx.colorTempK);
      if (item.instance.setBloomGain) item.instance.setBloomGain(window.OPTIONS.vfx.bloomGain);
    }
    if (item.instance.update) item.instance.update(time);
  }
}

function disposeEffects(fxData) {
  if (Core3D.scene) {
    Core3D.scene.remove(fxData.group);
  }
}

export const EngineVfxSystem = {
  entityEffects: new Map(),

  update(entities = []) {
    if (!Core3D.isInitialized || !Core3D.scene) return;

    const activeEntities = new Set();
    const time = (typeof performance !== 'undefined') ? performance.now() / 1000 : 0;

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

      updateEffects(entity, fxData, time);
    }

    for (const [entity, fxData] of this.entityEffects) {
      if (!activeEntities.has(entity)) {
        disposeEffects(fxData);
        this.entityEffects.delete(entity);
      }
    }
  },

  disposeAll() {
    for (const [, fxData] of this.entityEffects) {
      disposeEffects(fxData);
    }
    this.entityEffects.clear();
  }
};
