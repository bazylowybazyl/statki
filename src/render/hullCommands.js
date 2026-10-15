// src/render/hullCommands.js
//
// Rekordy strumienia rozkazów renderu dla KADŁUBÓW (RW-22, docs/PLAN-render-worker.md § 3.3 — „uzupełnienie
// 2026-10-15”): mapa ran i rany brył (haki silnika belek, łaty roju, rzazy przebić). Kody typów 32…63 (RW-21 —
// src/render/renderCommands.js — ma 1…31). Czysty moduł: kody, układy pól, OPIS KADŁUBA (blok HULL) — zapis z obiektu
// gry i odczyt do zastępnika (obiekt o polach, które czyta mapa ran: src/3d/hullDamageMap.js, src/3d/solidWounds.js).
// Bez three, DOM i `window`.
//
// Gra (src/game/hullDamageEvents.js) liczy w chwili haka wszystko, o co render pytał dotąd silnik belek
// synchronicznie: pozę encji (dawniej HullBodies.entityPose w kolejce stempli), uv skóry (spriteUvAt), komórki
// kratownicy brył (solidLatticeAt), środek komórki łaty (cellWorld), źródło trafienia (dawniej HullDamageMap.setSource
// — globalny stan renderu). Render (src/3d/hullDamageCommands.js) woła z rekordu te same funkcje mapy ran.

export const HC = Object.freeze({
  DMG_HOOK: 32,        // HullBodies.onImpact → HullDamageMap.onHullImpact (krater / rzaz; ciało płaskie i bryła)
  DMG_TEAR: 33,        // HullBodies.onNodeLost (część obrazowa) → HullDamageMap.onHullNodeLost
  DMG_SOLID_TEAR: 34,  // HullBodies.onSolidNodeLost → HullDamageMap.onSolidNodeLost (SolidWounds.tear)
  DMG_REPAIR: 35,      // HullBodies.onRepair → HullDamageMap.onHullRepair
  DMG_PATCH: 36,       // łata roju naprawczego (onCellRegrown) → HullDamageMap.patchCell
  DMG_KERF: 37,        // pas rzazu przebicia (applyBulletHullPass) → HullDamageMap.stampKerf
  EXPLOSION: 38,       // wybuch z gazu (fabryka wybuchów WebGPU: makeReactorBlow / shipBlastFactory)
  HULL_DEBRIS: 39      // odłamek zniszczonego węzła (HullBodies.onDebris → window.spawnHullDebris; losowanie w renderze)
});

/** Najwięcej znaków rzazu na odcinek (= DMG_KERF_MAX w hullDamageMap.js; pilnuje test). */
export const KERF_MAX = 8;

/**
 * Opis kadłuba (blok HULL): encja (slot, gen — 2 słowa), klucz rodu mapy ran, wymiary obrazu, skala, komórka, rozstaw
 * pikseli, wiersze kratownicy, bryła (0 / 1), wymiary kratownicy szablonu (bryły), kwaternion ciała (bryły), kąt skóry
 * θ (poza: c = cos θ, s = sin θ — jak HullBodies.entityPose).
 */
export const HULL = Object.freeze({
  ENT: 0, KEY: 2, SRC_W: 3, SRC_H: 4, SCALE: 5, CELL: 6, PITCH: 7, NY: 8, SOLID: 9,
  DIM_X: 10, DIM_Y: 11, DIM_Z: 12, QX: 13, QY: 14, QZ: 15, QW: 16, THETA: 17, WORDS: 18
});

// Wynik haka (hullImpactResult) i źródło trafienia.
export const DMG_HOOK = Object.freeze({
  HULL: 0,
  KIND: HULL.WORDS,            // 0 — krater, 1 — rzaz
  X: HULL.WORDS + 1, Y: HULL.WORDS + 2, U: HULL.WORDS + 3, V: HULL.WORDS + 4,
  DIR_X: HULL.WORDS + 5, DIR_Y: HULL.WORDS + 6, LEN: HULL.WORDS + 7, KILLED: HULL.WORDS + 8, RADIUS: HULL.WORDS + 9,
  CRATER: HULL.WORDS + 10, LAT_X: HULL.WORDS + 11, LAT_Y: HULL.WORDS + 12, LAT_Z: HULL.WORDS + 13,
  SRC: HULL.WORDS + 14,        // 0 — bez źródła (stempel ogólny / rzaz Hexlance), 1 — źródło niżej
  FAMILY: HULL.WORDS + 15, VARIANT: HULL.WORDS + 16, POWER: HULL.WORDS + 17, FLAK_R: HULL.WORDS + 18,
  R_KEY: HULL.WORDS + 19,     // klucz rodu z wyniku haka (r.dmgKey — slot ciała płaskiego; bryła — klucz z opisu kadłuba)
  WORDS: HULL.WORDS + 20
});
export const DMG_TEAR = Object.freeze({ HULL: 0, U: HULL.WORDS, V: HULL.WORDS + 1, X: HULL.WORDS + 2, Y: HULL.WORDS + 3, WORDS: HULL.WORDS + 4 });
export const DMG_SOLID_TEAR = Object.freeze({
  HULL: 0, IX: HULL.WORDS, IY: HULL.WORDS + 1, IZ: HULL.WORDS + 2, X: HULL.WORDS + 3, Y: HULL.WORDS + 4, WORDS: HULL.WORDS + 5
});
export const DMG_REPAIR = Object.freeze({ HULL: 0, DT: HULL.WORDS, CHANGED: HULL.WORDS + 1, WORDS: HULL.WORDS + 2 });
export const DMG_PATCH = Object.freeze({
  HULL: 0, IX: HULL.WORDS, IY: HULL.WORDS + 1, HAS_W: HULL.WORDS + 2, WX: HULL.WORDS + 3, WY: HULL.WORDS + 4,
  SEAM: HULL.WORDS + 5, WORDS: HULL.WORDS + 6
});
// Rzaz: odcinek, rodzina; ciało płaskie — uv początku (spriteUvAt), bryła — komórki kratownicy znaków (≤ KERF_MAX:
// ok, latX, latY, latZ).
export const DMG_KERF = Object.freeze({
  HULL: 0, X0: HULL.WORDS, Y0: HULL.WORDS + 1, X1: HULL.WORDS + 2, Y1: HULL.WORDS + 3, FAMILY: HULL.WORDS + 4,
  U0: HULL.WORDS + 5, V0: HULL.WORDS + 6, N: HULL.WORDS + 7, LAT: HULL.WORDS + 8, WORDS: HULL.WORDS + 8 + KERF_MAX * 4
});

// Wybuch (opcje fabryki createExplosionFactory rozwiązane w grze: domyślne `??` jak w fabryce, oś, zanik strumieni,
// barwa dymu, sam gaz, gospodarz — klucz rodu kadłuba). Profil — napis (id z rekordu STR).
export const EXPLOSION = Object.freeze({
  X: 0, Y: 1, SIZE: 2, PROFILE: 3, VX: 4, VY: 5, AXIS_X: 6, AXIS_Y: 7, JET_TAU: 8, HAS_TINT: 9, TINT_R: 10, TINT_G: 11,
  TINT_B: 12, GAS_ONLY: 13, HOST_KEY: 14, WORDS: 15
});

// Odłamek węzła: punkt i prędkość (świat gry), kolor blachy, komórka, kształtownik możliwy, bryła, wysokość i prędkość
// pionowa (bryła 3D).
export const HULL_DEBRIS = Object.freeze({
  X: 0, Y: 1, VX: 2, VY: 3, R: 4, G: 5, B: 6, CELL: 7, STRUCT: 8, SOLID: 9, Z: 10, VZ: 11, WORDS: 12
});

/**
 * Zapis opisu kadłuba do rekordu. `entSlot`, `entGen` — encja (przestrzeń slotów rozkazów); `theta` — kąt skóry z pozy
 * gry w chwili zdarzenia. Pola bez wartości — 0.
 */
export function writeHullDesc(d, o, hull, entSlot, entGen, theta) {
  d[o + HULL.ENT] = entSlot;
  d[o + HULL.ENT + 1] = entGen;
  d[o + HULL.KEY] = hull.dmgKey > 0 ? hull.dmgKey : 0;
  d[o + HULL.SRC_W] = Number(hull.srcWidth) || 0;
  d[o + HULL.SRC_H] = Number(hull.srcHeight) || 0;
  d[o + HULL.SCALE] = Number(hull.scale) || 0;
  const body = hull.body;
  d[o + HULL.CELL] = Number(hull.cellSize) || Number(body?.cellSize) || 0;
  d[o + HULL.PITCH] = Number(hull.pixelPitch) || 0;
  d[o + HULL.NY] = Number(hull.ny) || 0;
  const solid = !!hull.solid3D;
  d[o + HULL.SOLID] = solid ? 1 : 0;
  const dims = solid ? (hull.structure?.dims || body?.dims) : null;
  d[o + HULL.DIM_X] = dims ? dims.x : 0;
  d[o + HULL.DIM_Y] = dims ? dims.y : 0;
  d[o + HULL.DIM_Z] = dims ? dims.z : 0;
  const q = solid ? body?.quat : null;
  d[o + HULL.QX] = q ? q.x : 0;
  d[o + HULL.QY] = q ? q.y : 0;
  d[o + HULL.QZ] = q ? q.z : 0;
  d[o + HULL.QW] = q ? q.w : 1;
  d[o + HULL.THETA] = theta;
}

/**
 * Zastępnik kadłuba dla mapy ran (render): obiekt o polach, które czytają HullDamageMap i SolidWounds, i jego encja
 * (`proxy.entity`, `entity.beamHull === proxy`). Poza z rekordu w `__pose` (c, s) — mapa ran czyta ją zamiast
 * HullBodies.entityPose. Jeden obiekt na dekoder, wypełniany w miejscu (bez alokacji na rekord).
 */
export function createHullProxy() {
  const entity = { beamHull: null, real: null };
  const proxy = {
    entity, dmgKey: 0, srcWidth: 0, srcHeight: 0, scale: 1, cellSize: 0, pixelPitch: 0, ny: 0, solid3D: null,
    structure: { dims: { x: 0, y: 0, z: 0 } },
    body: { cellSize: 0, quat: { x: 0, y: 0, z: 0, w: 1 }, dims: null },
    __pose: { x: 0, y: 0, theta: 0, c: 1, s: 0 }
  };
  entity.beamHull = proxy;
  return proxy;
}

/** Odczyt opisu kadłuba do zastępnika. `real` — encja z (slot, gen) albo null (tylko diagnostyka). */
export function readHullDesc(d, o, proxy, real = null) {
  proxy.dmgKey = d[o + HULL.KEY];
  proxy.srcWidth = d[o + HULL.SRC_W];
  proxy.srcHeight = d[o + HULL.SRC_H];
  proxy.scale = d[o + HULL.SCALE];
  proxy.cellSize = d[o + HULL.CELL];
  proxy.pixelPitch = d[o + HULL.PITCH];
  proxy.ny = d[o + HULL.NY];
  proxy.solid3D = d[o + HULL.SOLID] ? true : null;
  const dims = proxy.structure.dims;
  dims.x = d[o + HULL.DIM_X]; dims.y = d[o + HULL.DIM_Y]; dims.z = d[o + HULL.DIM_Z];
  proxy.body.cellSize = proxy.cellSize;
  const q = proxy.body.quat;
  q.x = d[o + HULL.QX]; q.y = d[o + HULL.QY]; q.z = d[o + HULL.QZ]; q.w = d[o + HULL.QW];
  const p = proxy.__pose;
  p.theta = d[o + HULL.THETA];
  p.c = Math.cos(p.theta);
  p.s = Math.sin(p.theta);
  proxy.entity.real = real;
  return proxy;
}
