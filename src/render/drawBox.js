// src/render/drawBox.js
//
// Pudła klatki — wspólne dla gry i renderu (RW-31, docs/PLAN-render-worker.md § 2.6 p. 29–30). Czysty moduł: bez
// three, DOM i `window`.
//
// Pudło ROZGRZANIA (cull.halfW/halfH — w index.html 3× połowa widoku, czyli 9 ekranów): mesh powstaje zawczasu,
// emitery świateł drogowych i dysze trzymają ciągłość. Pudło RYSOWANIA (cull.drawHalfW/drawHalfH = kadr): pełna
// aktualizacja mesha (instancje, LOD, lampy, uniformy), draw call, billboardy świateł i wieżyczki idą tylko dla encji,
// które mogą być na ekranie — meshe kadłubów mają frustumCulled = false, więc bez tego ~8/9 wywołań trafiało poza kadr.
// Promień z wymiarów sprite'a × skala (entity.radius wraków jest w jednostkach siatki), plus pivot i stały margines
// ekranowy na dryf / deformację. Bez cull.drawHalfW (np. lot po mieście) — dawne zachowanie: rysuj całe pudło.
//
// Te same reguły liczy render (hexShips3D.js: klasyfikacja encji, zimne wraki) i gra (src/game/coldWreckView.js:
// flaga `__inDrawBox` dla modelu lotu, bramka zamrażania zimnych wraków, wybór ciał do rysowania) — w workerze
// renderu gra nie pyta renderu, tylko liczy to samo z kamery klatki.

/** Margines pudła rysowania [px ekranu]. */
export const DRAW_BOX_MARGIN_PX = 96;

/** Promień smugi wraku [px] — poniżej wrak / daleki kadłub rysuje się smugą (`window.DevTuning.wreckImpostorPx`). */
export const WRECK_IMPOSTOR_PX = 15;

/** Próg smugi z konsolowego strojenia (`DevTuning.wreckImpostorPx`) albo domyślny. */
export function wreckImpostorEnterPx(tuning) {
  return Number.isFinite(Number(tuning?.wreckImpostorPx)) ? Number(tuning.wreckImpostorPx) : WRECK_IMPOSTOR_PX;
}

function posX(entity) { return entity?.pos ? entity.pos.x : entity?.x || 0; }
function posY(entity) { return entity?.pos ? entity.pos.y : entity?.y || 0; }
function scaleX(entity) {
  if (entity?.visual && typeof entity.visual.spriteScaleX === 'number') return entity.visual.spriteScaleX;
  if (entity?.visual && typeof entity.visual.spriteScale === 'number') return entity.visual.spriteScale;
  return 1.0;
}
function scaleY(entity) {
  if (entity?.visual && typeof entity.visual.spriteScaleY === 'number') return entity.visual.spriteScaleY;
  if (entity?.visual && typeof entity.visual.spriteScale === 'number') return entity.visual.spriteScale;
  return 1.0;
}

/** Encja w pudle ROZGRZANIA (bez pudła — zawsze). */
export function isEntityInCull(entity, cull) {
  if (!cull) return true;
  const x = posX(entity);
  const y = posY(entity);
  const r = Math.max(140, Number(entity?.radius) || Number(entity?.r) || 140);
  return (
    Math.abs(x - cull.x) <= cull.halfW + r &&
    Math.abs(y - cull.y) <= cull.halfH + r
  );
}

/** Encja w pudle RYSOWANIA (kadr + margines; bez `cull.drawHalfW` — zawsze). */
export function isEntityInDrawBox(entity, cull, cameraZoom) {
  if (!cull || !Number.isFinite(cull.drawHalfW) || !Number.isFinite(cull.drawHalfH)) return true;
  const x = posX(entity);
  const y = posY(entity);
  // Kadłub na belkach niesie te same wymiary sprite'a i pivot co siatka heksów.
  const grid = entity?.hexGrid || entity?.beamHull;
  let r;
  if (grid) {
    const sx = Math.abs(scaleX(entity)) || 1;
    const sy = Math.abs(scaleY(entity)) || 1;
    const pivotX = (Number(grid.pivot?.x) || 0) * sx;
    const pivotY = (Number(grid.pivot?.y) || 0) * sy;
    r = Math.hypot((Number(grid.srcWidth) || 0) * sx, (Number(grid.srcHeight) || 0) * sy) * 0.5
      + Math.hypot(pivotX, pivotY);
  } else {
    r = Math.max(140, Number(entity?.radius) || Number(entity?.r) || 140);
  }
  r += DRAW_BOX_MARGIN_PX / Math.max(0.0001, cameraZoom);
  return (
    Math.abs(x - cull.x) <= cull.drawHalfW + r &&
    Math.abs(y - cull.y) <= cull.drawHalfH + r
  );
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
