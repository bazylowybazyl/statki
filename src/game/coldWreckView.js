// src/game/coldWreckView.js
//
// Widok klatki po stronie GRY (RW-31, docs/PLAN-render-worker.md § 2.6 p. 15, 29, 30): to, o co gra pytała dotąd
// render (hexShips3D.js), liczone z kamery i pudeł klatki (`_hexCullInfo` w index.html) — w workerze renderu gra
// nie może czekać na odpowiedź renderu, a wynik ma być ten sam:
//  • flaga `entity.__inDrawBox` (model lotu NPC liczy poza kadrem stan dysz rzadziej — shipFlightModel.js; czyta ją
//    też render: engineVfxSystem.js) i `entity.__drawFogHidden` (encja ukryta mgłą wojny w tej klatce rysowania);
//  • bramka „zamrożenie wraku przejdzie niezauważone” (dawne isColdFreezeVisuallySafe — stan renderu
//    `lastCull`, `lastCameraZoom`, `__hiddenFromView`);
//  • wybór zimnych wraków na belkach, które w tej klatce potrzebują ciała do rysowania (dawniej render wołał grę:
//    `ensureBody` w updateColdBeamWrecks) — znacznik `w._coldDrawFrame`;
//  • smuga zimnego wraku na belkach (dawne captureBeamColdImpostor — `snapshot.impostor`, `snapshot.color`).
// Reguły są kopią renderu 1:1 (pudła — wspólny src/render/drawBox.js, kolor — src/render/bodyColor.js).

import { isEntityInCull, isEntityInDrawBox, beamBodyRadiusPx, wreckImpostorEnterPx, DRAW_BOX_MARGIN_PX } from '../render/drawBox.js';
import { averageImageRGB } from '../render/bodyColor.js';
import { HullBodies, hullSpriteRotation } from './hullBodies.js';
import { COLD_WRECK_CONFIG } from './coldWrecks.js';

/**
 * Widok ostatniej klatki rysowania (wypełnia gra w `render()` tuż przed aktualizacją kadłubów 3D): pudło
 * (ten sam obiekt co `_hexCullInfo` — gra go mutuje), zoom kamery, px bufora na px CSS, numer klatki rAF.
 * Do pierwszej klatki `cull` = null (zamrażanie bez ograniczeń — jak render przed pierwszym przebiegiem).
 */
export function createDrawView() {
  return { cull: null, zoom: 1, pixelRatio: 1, frameId: 0, tuning: null };
}

export function setDrawView(view, cull, zoom, pixelRatio, frameId, tuning = null) {
  view.cull = cull || null;
  view.zoom = Math.max(0.0001, Number(zoom) || 1);
  view.pixelRatio = Number(pixelRatio) || 1;
  view.frameId = frameId | 0;
  view.tuning = tuning || null;
  return view;
}

/** Kadłub na belkach do rysowania skórą (jak isBeamHullEntity w hexShips3D.js). */
export function isBeamHullEntity(entity) {
  const hull = entity?.beamHull;
  // bryła 3D (budowla, jej odłam — hullBodies.createSolid) nie ma sprite'a: rysuje ją skóra brył budowli
  return !!hull && hull.entity === entity && !hull.solid3D && !!hull.body && !hull.body.dead && hull.body.activeNodes > 0;
}

/**
 * Klasyfikacja encji listy rysowania (ta sama co pętla encji w updateHexShips3D): ukryte (`hideHexVisual`, mgła
 * wojny — `hiddenTest`) i poza pudłem rozgrzania → `__inDrawBox = false`; reszta → w pudle rysowania.
 * `__drawFogHidden` — ukryta mgłą w tej klatce (bramka zamrażania). Martwe encje bez zmian.
 */
export function stampDrawBoxFlags(entities, view, hiddenTest = null) {
  const cull = view.cull, zoom = view.zoom;
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (!entity || entity.dead) continue;
    if (entity.hideHexVisual === true || entity.visual?.hideHexMesh === true) { entity.__inDrawBox = false; continue; }
    if (hiddenTest && hiddenTest(entity)) { entity.__drawFogHidden = true; entity.__inDrawBox = false; continue; }
    entity.__drawFogHidden = false;
    entity.__inDrawBox = isEntityInCull(entity, cull) ? isEntityInDrawBox(entity, cull, zoom) : false;
  }
}

/**
 * Czy zamrożenie wraku przejdzie niezauważone: wrak poza pudłem rysowania ostatniej klatki albo (na belkach) przy
 * pełnym wyglądzie zimnego (staticSkin + nearExtras — ta sama skóra, mostek, rdzeń i cień co u śpiącego) w kadrze do
 * `inViewFreezeMaxPx`; bez niego — tylko na poziomie smugi. Ukryty mgłą wojny w kadrze — nie (zimny rysuje się jak
 * teren, bez mgły). Wrak bez kadłuba na belkach (heksy — tylko dema) → `fallback(entity)` (render).
 */
export function coldFreezeVisuallySafe(entity, view, config = null, fallback = null) {
  const cull = view?.cull;
  if (!entity || !cull) return true;
  if (!isEntityInDrawBox(entity, cull, view.zoom)) return true;
  if (!isBeamHullEntity(entity)) return fallback ? fallback(entity) : true;
  if (entity.__drawFogHidden === true) return false;
  const cfg = config || COLD_WRECK_CONFIG;
  const rPx = beamBodyRadiusPx(entity, view.zoom, view.pixelRatio);
  if (cfg.staticSkin !== false && cfg.nearExtras !== false) {
    const limit = Number(cfg.inViewFreezeMaxPx);
    return !(limit < Infinity) || rPx < limit;
  }
  // Bez pełnego wyglądu zimnego — tylko gdy kadłub już jest smugą (próg wejścia smugi z histerezą renderu).
  return rPx < wreckImpostorEnterPx(view.tuning);
}

/**
 * Zimne wraki na belkach, które w tej klatce potrzebują ciała do rysowania (reguła z dawnego updateColdBeamWrecks):
 * w pudle rysowania i większe od 0,8 progu smugi (ciało gotowe, zanim skóra jest potrzebna), albo z ciałem poza
 * kadrem w pudle rozgrzania / w kadrze do połowy progu smugi. `ensureBody(w)` — ciało z migawki w budżecie klatki
 * (coldWreckSystem.ensureRenderBody); znacznik `w._coldDrawFrame = view.frameId` dla wraków z ciałem — render rysuje
 * tylko je. Bez staticSkin zimny jest zawsze smugą. Zwraca liczbę oznaczonych.
 */
export function selectColdRenderBodies(coldWrecks, view, config, ensureBody) {
  if (!Array.isArray(coldWrecks) || coldWrecks.length === 0 || typeof ensureBody !== 'function') return 0;
  const cfg = config || COLD_WRECK_CONFIG;
  if (cfg.staticSkin === false) return 0;
  const cull = view.cull, cameraZoom = view.zoom;
  const zoomPx = Math.max(0.0001, cameraZoom) * (view.pixelRatio || 1);
  const enterPx = wreckImpostorEnterPx(view.tuning);
  const boxed = !!cull && Number.isFinite(cull.x) && Number.isFinite(cull.y);
  const drawBoxed = boxed && Number.isFinite(cull.drawHalfW) && Number.isFinite(cull.drawHalfH);
  const margin = DRAW_BOX_MARGIN_PX / Math.max(0.0001, cameraZoom);
  const frameId = view.frameId;
  let n = 0;
  for (let i = 0; i < coldWrecks.length; i++) {
    const w = coldWrecks[i];
    const snap = w?._coldSnapshot;
    if (!snap || snap.kind !== 'beam' || w.dead) continue;
    const imp = snap.impostor;
    if (!imp) continue;
    if (boxed && (Math.abs(imp.wx - cull.x) > cull.halfW + imp.reach || Math.abs(imp.wy - cull.y) > cull.halfH + imp.reach)) continue;
    const inDraw = !drawBoxed || (Math.abs(imp.wx - cull.x) <= cull.drawHalfW + imp.reach + margin &&
      Math.abs(imp.wy - cull.y) <= cull.drawHalfH + imp.reach + margin);
    const rPx = Math.max(imp.halfW, imp.halfH) * zoomPx;
    const has = isBeamHullEntity(w);
    const want = inDraw && rPx >= enterPx * 0.8;
    const keep = has && (!inDraw || rPx >= enterPx * 0.5);
    if (!(want || keep) || !ensureBody(w) || !isBeamHullEntity(w)) continue;
    w._coldDrawFrame = frameId;
    n++;
  }
  return n;
}

/**
 * Smuga zimnego wraku na belkach — ta sama co smuga gorącego w updateBeamSkinMesh (zasięg żywych węzłów, środek
 * pudła w układzie ciała, kąt skóry, kolor sprite'a): zamrożenie i zwolnienie ciała nie zmieniają obrazu. Pisze
 * `snapshot.color` i `snapshot.impostor` (współrzędne sceny: y = −y gry). Zwraca, czy się udało.
 */
export function captureBeamColdImpostor(entity, snapshot, config = null) {
  const hull = entity?.beamHull;
  if (!snapshot || !hull || hull.entity !== entity || !hull.body || hull.body.dead) return false;
  const body = hull.body;
  const mm = body._boundsMinMax;
  if (!mm) return false;
  const theta = -((Number(entity.angle) || 0) + hullSpriteRotation(entity));
  const c = Math.cos(theta), s = Math.sin(theta);
  const ax = HullBodies.anchorLocalX(hull), ay = HullBodies.anchorLocalY(hull);
  const ex = entity.pos ? entity.pos.x : entity.x || 0;
  const ey = entity.pos ? entity.pos.y : entity.y || 0;
  const originX = ex - (c * ax - s * ay);
  const originY = -ey - (s * ax + c * ay);
  const halfW = (mm[3] - mm[0]) * 0.5 + body.cellSize * 0.5;
  const halfH = (mm[4] - mm[1]) * 0.5 + body.cellSize * 0.5;
  const cxL = (mm[0] + mm[3]) * 0.5, cyL = (mm[1] + mm[4]) * 0.5;
  const x = originX + c * cxL - s * cyL;
  const y = originY + s * cxL + c * cyL;
  const color = averageImageRGB(hull.visualImage || hull.image) || snapshot.color || { r: 0.35, g: 0.37, b: 0.4 };
  snapshot.color = { r: color.r, g: color.g, b: color.b };
  const cfg = config || COLD_WRECK_CONFIG;
  const out = snapshot.impostor || (snapshot.impostor = {});
  out.x = x;
  out.y = y;
  out.rot = theta;
  out.halfW = halfW;
  out.halfH = halfH;
  out.r = color.r;
  out.g = color.g;
  out.b = color.b;
  out.wx = x;
  out.wy = -y;
  out.reach = Math.hypot(halfW, halfH);
  out.opacity = Number.isFinite(Number(cfg.beamImpostorOpacity)) ? Number(cfg.beamImpostorOpacity) : 1;
  return true;
}
