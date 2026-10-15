// src/render/drawBox.js
//
// Smuga dalekiego kadłuba / zimnego wraku — progi wspólne dla gry i renderu (RW-31, docs/PLAN-render-worker.md § 2.6
// p. 29–30): render (hexShips3D.js: LOD skóry, zimne wraki) i gra (src/game/coldWreckView.js: bramka zamrażania, wybór
// ciał do rysowania) liczą to samo z kamery klatki — w workerze renderu gra nie pyta renderu. Czysty moduł: bez three,
// DOM i `window`.

// Pudła (isEntityInCull, isEntityInDrawBox, DRAW_BOX_MARGIN_PX) — jedno źródło w src/render/renderCull.js (RW-26).
export { isEntityInCull, isEntityInDrawBox, DRAW_BOX_MARGIN_PX } from './renderCull.js';

/** Promień smugi wraku [px] — poniżej wrak / daleki kadłub rysuje się smugą (`window.DevTuning.wreckImpostorPx`). */
export const WRECK_IMPOSTOR_PX = 15;

/** Próg smugi z konsolowego strojenia (`DevTuning.wreckImpostorPx`) albo domyślny. */
export function wreckImpostorEnterPx(tuning) {
  return Number.isFinite(Number(tuning?.wreckImpostorPx)) ? Number(tuning.wreckImpostorPx) : WRECK_IMPOSTOR_PX;
}

/**
 * Promień zasięgu żywych węzłów kadłuba na belkach na ekranie [px] — miara smugi skóry kadłuba
 * (`body._boundsMinMax` silnika belek). `pixelRatio` = px bufora renderu na px CSS (Core3D.pixelRatio).
 */
export function beamBodyRadiusPx(entity, zoom, pixelRatio) {
  const body = entity.beamHull.body;
  const mm = body._boundsMinMax;
  if (!mm) return Infinity;
  const half = Math.max(mm[3] - mm[0], mm[4] - mm[1]) * 0.5 + body.cellSize * 0.5;
  return half * Math.max(0.0001, zoom) * (pixelRatio || 1);
}
