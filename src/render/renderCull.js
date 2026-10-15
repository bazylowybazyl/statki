// src/render/renderCull.js
//
// Pudła klatki renderu w świecie gry — czyste funkcje wspólne dla gry i renderu (RW-26, docs/PLAN-render-worker.md):
// rekordy wieżyczek (Turret2D.syncFrame, strona gry) i kadłuby 3D (hexShips3D.js) muszą brać TE SAME encje.
// Bez three, DOM i `window`.
//
// cull (z index.html, `_hexCullInfo`): x, y — środek; halfW / halfH — pudło ROZGRZANIA (3× połowa widoku: mesh
// powstaje zawczasu); drawHalfW / drawHalfH — pudło RYSOWANIA (kadr; margines i realny rozmiar sprite'a dolicza
// isEntityInDrawBox). Bez drawHalfW (np. lot po mieście) — dawne zachowanie: rysuj całe pudło.

export function getEntityPosX(entity) { return entity?.pos ? entity.pos.x : entity?.x || 0; }
export function getEntityPosY(entity) { return entity?.pos ? entity.pos.y : entity?.y || 0; }

export function getEntityScaleX(entity) {
  if (entity?.visual && typeof entity.visual.spriteScaleX === 'number') return entity.visual.spriteScaleX;
  if (entity?.visual && typeof entity.visual.spriteScale === 'number') return entity.visual.spriteScale;
  return 1.0;
}

export function getEntityScaleY(entity) {
  if (entity?.visual && typeof entity.visual.spriteScaleY === 'number') return entity.visual.spriteScaleY;
  if (entity?.visual && typeof entity.visual.spriteScale === 'number') return entity.visual.spriteScale;
  return 1.0;
}

export function getEntityScale(entity) {
  return Math.max(getEntityScaleX(entity), getEntityScaleY(entity));
}

/** Encja w pudle rozgrzania (bez cull — zawsze). */
export function isEntityInCull(entity, cull) {
  if (!cull) return true;
  const x = getEntityPosX(entity);
  const y = getEntityPosY(entity);
  const r = Math.max(140, Number(entity?.radius) || Number(entity?.r) || 140);
  return (
    Math.abs(x - cull.x) <= cull.halfW + r &&
    Math.abs(y - cull.y) <= cull.halfH + r
  );
}

// Pudło RYSOWANIA. Pudło rozgrzania (9 ekranów) zostaje dla meshy; pełna aktualizacja mesha (instancje, LOD, lampy,
// uniformy), draw call, billboardy świateł i wieżyczki idą tylko dla encji, które mogą być na ekranie — meshe
// kadłubów mają frustumCulled=false, więc bez tego ~8/9 wywołań trafiało poza kadr. Promień z wymiarów sprite'a ×
// skala (entity.radius wraków jest w jednostkach siatki), plus pivot i stały margines ekranowy na dryf / deformację.
export const DRAW_BOX_MARGIN_PX = 96;

export function isEntityInDrawBox(entity, cull, cameraZoom) {
  if (!cull || !Number.isFinite(cull.drawHalfW) || !Number.isFinite(cull.drawHalfH)) return true;
  const x = getEntityPosX(entity);
  const y = getEntityPosY(entity);
  // Kadłub na belkach niesie te same wymiary sprite'a i pivot co siatka heksów.
  const grid = entity?.hexGrid || entity?.beamHull;
  let r;
  if (grid) {
    const sx = Math.abs(getEntityScaleX(entity)) || 1;
    const sy = Math.abs(getEntityScaleY(entity)) || 1;
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
 * Encje klatki z efektami w pudle RYSOWANIA — w kolejności listy, jak `drawVfx` w hexShips3D.updateHexShips3D:
 * żywe, bez `hideHexVisual` / `visual.hideHexMesh`, nieukryte (`hidden(e)` — mgła wojny), w pudle rozgrzania
 * i rysowania. Wynik do `out` (wyczyszczona), zwraca `out`.
 */
export function collectDrawBoxEntities(entities, cull, cameraZoom, hidden, out) {
  out.length = 0;
  if (!entities) return out;
  for (const entity of entities) {
    if (!entity || entity.dead) continue;
    if (entity.hideHexVisual === true || entity.visual?.hideHexMesh === true) continue;
    if (hidden && hidden(entity)) continue;
    if (!isEntityInCull(entity, cull)) continue;
    if (isEntityInDrawBox(entity, cull, cameraZoom)) out.push(entity);
  }
  return out;
}
