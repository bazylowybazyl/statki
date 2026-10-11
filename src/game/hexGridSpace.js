// Przestrzeń siatki kadłuba heksowego: siatka (gridX/gridY) → lokalna → świat.
//
// Wydzielone z shipCore.js (etap 8 portu silnika belek, docs/PORT-silnik-belek.md): model 3D
// reaktora (reactor3D.js) liczy z tego pozycję rdzenia na kadłubie heksowym w demach, a sam
// shipCore.js ciągnie heksowy destructor.js — gra go nie ładuje. Bez silnika, bez DOM i three.

import { DESTRUCTOR_CONFIG } from './destructorConfig.js';

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function entityPosX(e) { return (e?.pos && typeof e.pos.x === 'number') ? e.pos.x : finite(e?.x); }
export function entityPosY(e) { return (e?.pos && typeof e.pos.y === 'number') ? e.pos.y : finite(e?.y); }
export function entityScaleX(e) {
  if (e?.visual && typeof e.visual.spriteScaleX === 'number') return e.visual.spriteScaleX;
  if (e?.visual && typeof e.visual.spriteScale === 'number') return e.visual.spriteScale;
  return 1;
}
export function entityScaleY(e) {
  if (e?.visual && typeof e.visual.spriteScaleY === 'number') return e.visual.spriteScaleY;
  if (e?.visual && typeof e.visual.spriteScale === 'number') return e.visual.spriteScale;
  return 1;
}
export function entitySpriteRotation(e) {
  if (e?.isPlayer) return 0;
  const r = (e?.visual && typeof e.visual.spriteRotation === 'number') ? e.visual.spriteRotation
    : (e?.capitalProfile && typeof e.capitalProfile.spriteRotation === 'number') ? e.capitalProfile.spriteRotation
      : (e?.profile && typeof e.profile.spriteRotation === 'number') ? e.profile.spriteRotation
        : 0;
  return Number.isFinite(r) ? r : 0;
}
export function billboardOrientation(e) {
  return e?.isAsteroidHex === true || e?.visual?.preserveBillboardOrientation === true;
}

// Kąt i skala dokładnie jak w destruktorze (getEntityHexAngle, getFinalScaleX/Y,
// localDeltaToWorldX/Y) — sonda, krater i efekty muszą trafiać w te same heksy.
export function getEntityHexAngle(entity) {
  return finite(entity?.angle) + entitySpriteRotation(entity) + finite(DESTRUCTOR_CONFIG.visualRotationOffset);
}

export function gridToLocal(entity, gridX, gridY, out = {}) {
  const grid = entity?.hexGrid;
  out.x = gridX - finite(grid?.srcWidth) * 0.5 - finite(grid?.pivot?.x);
  out.y = gridY - finite(grid?.srcHeight) * 0.5 - finite(grid?.pivot?.y);
  return out;
}

export function localToWorld(entity, localX, localY, out = {}) {
  const ang = getEntityHexAngle(entity);
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const lx = localX * entityScaleX(entity);
  const ly = localY * entityScaleY(entity);
  if (billboardOrientation(entity)) {
    out.x = entityPosX(entity) + lx * c + ly * s;
    out.y = entityPosY(entity) - lx * s + ly * c;
  } else {
    out.x = entityPosX(entity) + lx * c - ly * s;
    out.y = entityPosY(entity) + lx * s + ly * c;
  }
  return out;
}

export function worldToLocal(entity, worldX, worldY, out = {}) {
  const ang = getEntityHexAngle(entity);
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const dx = worldX - entityPosX(entity);
  const dy = worldY - entityPosY(entity);
  if (billboardOrientation(entity)) {
    out.x = (dx * c - dy * s) / entityScaleX(entity);
    out.y = (dx * s + dy * c) / entityScaleY(entity);
  } else {
    out.x = (dx * c + dy * s) / entityScaleX(entity);
    out.y = (-dx * s + dy * c) / entityScaleY(entity);
  }
  return out;
}
