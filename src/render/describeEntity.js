// src/render/describeEntity.js — opis encji dla lustra renderu: konfiguracja statyczna z BIAŁEJ LISTY pól
// (docs/PLAN-render-worker.md § 3.6, RW-11a / RW-11b).
//
// Obiekty gry nie przechodzą przez `structuredClone`: obrazy DOM (`hull.image`, `visualImage`), funkcje
// (`hull.world.build`, `__lightOcclude`), cykle (encja ↔ kadłub ↔ ciało), instancje klas (magazyny SoA). Opis kopiuje
// tylko pola, które czyta render, jako zwykłe dane (w workerze — `postMessage`; w `inline` — świeże kopie, więc gra
// może dalej zmieniać swoje obiekty bez wpływu na lustro). Obrazy → sloty zasobów (`resourceSlot(obraz)`).
//
// TOŻSAMOŚĆ: każdy obiekt i tablica opisu niesie `__oid` — numer obiektu źródła (`oid(obj)`, WeakMap po stronie gry).
// Lustro uzgadnia drzewo (`reconcileDescriptor` w renderMirror.js): ten sam `__oid` = ten sam obiekt lustra
// aktualizowany w miejscu, nowy = nowy obiekt. Moduły renderu trzymają pamięć po tożsamości (`visual`, tablice dysz
// — `slot.source` w EngineVfxSystem, `engineFx`, `bridgeState`, `bridges[]`, rekord kadłuba), więc lustro musi
// zmieniać tożsamość dokładnie wtedy, gdy gra podmienia obiekt — nie przy każdym nowym opisie.
// Dysze: konfiguracja + pola klatki z chwili opisu (__throttle, nozzleDeg, …) — co klatkę nadpisuje je blok NOZZLES.
//
// Czysty moduł (bez three, DOM i `window`).

const NO_OID = () => 0;

function tag(out, src, oid) {
  if (out && src && typeof src === 'object') out.__oid = oid(src);
  return out;
}

const pt = (p, oid) => (p && typeof p === 'object' ? tag({ x: p.x, y: p.y }, p, oid) : p);

/** Kopia zwykłych danych (liczby, napisy, tablice, obiekty) z `__oid` na każdym obiekcie i tablicy. */
export function plainCopy(o, oid = NO_OID, depth = 0) {
  if (o === null || typeof o !== 'object') return typeof o === 'function' ? undefined : o;
  if (depth > 6) return undefined;
  if (ArrayBuffer.isView(o)) return o.slice();
  if (Array.isArray(o)) return tag(o.map((x) => plainCopy(x, oid, depth + 1)), o, oid);
  const proto = Object.getPrototypeOf(o);
  if (proto !== Object.prototype && proto !== null) return undefined;   // DOM, klasy, Map — poza opisem
  const out = {};
  for (const k of Object.keys(o)) {
    const v = plainCopy(o[k], oid, depth + 1);
    if (v !== undefined) out[k] = v;
  }
  return tag(out, o, oid);
}

/** Dysza: konfiguracja i pola klatki (stała kolejność kluczy — jedna klasa ukryta obiektów lustra). */
function nozzle(t, oid) {
  if (!t || typeof t !== 'object') return t;
  return tag({
    offset: pt(t.offset, oid), forward: pt(t.forward, oid), mount: t.mount, side: t.side,
    baseDeg: t.baseDeg, nozzleDeg: t.nozzleDeg, gimbalMinDeg: t.gimbalMinDeg, gimbalMaxDeg: t.gimbalMaxDeg,
    yNudge: t.yNudge, vfxLengthMin: t.vfxLengthMin, vfxLengthMax: t.vfxLengthMax,
    vfxWidthMin: t.vfxWidthMin, vfxWidthMax: t.vfxWidthMax,
    __throttle: t.__throttle, vfxScale: t.vfxScale, __destroyed: t.__destroyed
  }, t, oid);
}

function nozzleList(a, oid) {
  return Array.isArray(a) ? tag(a.map((t) => nozzle(t, oid)), a, oid) : a;
}

function visualConfig(v, oid) {
  if (!v || typeof v !== 'object') return v === undefined ? undefined : null;
  // klucze zawsze obecne (także undefined) — usunięcie pola w grze = undefined w lustrze
  return tag({
    spriteScale: v.spriteScale, spriteScaleX: v.spriteScaleX, spriteScaleY: v.spriteScaleY,
    spriteRotation: v.spriteRotation,
    preserveBillboardLighting: v.preserveBillboardLighting, preserveBillboardOrientation: v.preserveBillboardOrientation,
    hideHexMesh: v.hideHexMesh, engineVfxClassScale: v.engineVfxClassScale,
    turretTop: pt(v.turretTop, oid), turretBottom: pt(v.turretBottom, oid), mainEngine: pt(v.mainEngine, oid),
    engineFx: plainCopy(v.engineFx, oid),
    lights: plainCopy(v.lights, oid),
    mainThrusters: nozzleList(v.mainThrusters, oid),
    torqueThrusters: nozzleList(v.torqueThrusters, oid)
  }, v, oid);
}

function enginesConfig(en, oid) {
  if (!en || typeof en !== 'object') return en;
  const m = en.main;
  const main = m ? Object.assign(nozzle(m, oid), {
    visualOffset: pt(m.visualOffset, oid), vfxOffset: pt(m.vfxOffset, oid), vfxForward: pt(m.vfxForward, oid),
    vfxYNudge: m.vfxYNudge, maxThrust: m.maxThrust
  }) : m;
  return tag({ main }, en, oid);
}

/**
 * Część statyczna `bridgeState` po montażu (shipBridgeBeams.js: createBeamBridgeState, windows): pola czytane przez
 * Bridge3D i BridgeFx3D. Zmienne (commandLost, commandLostAt, vent, bridges[].dead / deadAt / missing / vent) idą co
 * klatkę w bloku mostków strony. `backendKind` — lustro dostaje obiekt backendu z realmu renderu.
 */
export function describeBridgeState(st, oid = NO_OID) {
  if (!st || typeof st !== 'object') return null;
  const w = st.windows;
  const copy = (a) => (ArrayBuffer.isView(a) ? a.slice() : a);
  const bridges = Array.isArray(st.bridges) ? tag(st.bridges.map((b) => tag({
    def: plainCopy(b.def, oid), id: b.id, index: b.index, total: b.total,
    cellX: copy(b.cellX), cellY: copy(b.cellY), pos: copy(b.pos), lossX: b.lossX, lossY: b.lossY,
    dead: !!b.dead, deadAt: b.deadAt, missing: !!b.missing, vent: null
  }, b, oid)), st.bridges, oid) : null;
  return tag({
    version: st.version, backendKind: st.backend && st.backend.kind ? st.backend.kind : 'beam',
    lineage: st.lineage, srcW: st.srcW, srcH: st.srcH, spriteScale: st.spriteScale,
    anchorDX: st.anchorDX, anchorDY: st.anchorDY, cellSize: st.cellSize, dimsX: st.dimsX, dimsY: st.dimsY,
    scaleX: st.scaleX, scaleY: st.scaleY, rule: st.rule, hullKey: st.hullKey,
    windowColorSrgb: plainCopy(st.windowColorSrgb, oid),
    commandLost: !!st.commandLost, commandLostAt: st.commandLostAt, vent: null,
    bridges,
    windows: w ? tag({
      count: w.count, px: copy(w.px), py: copy(w.py), cellX: copy(w.cellX), cellY: copy(w.cellY),
      offX: copy(w.offX), offY: copy(w.offY), angle: copy(w.angle), seed: copy(w.seed), level: copy(w.level),
      bridge: copy(w.bridge), delay: copy(w.delay), colorsLinear: plainCopy(w.colorsLinear, oid), length: w.length,
      width: w.width
    }, w, oid) : null
  }, st, oid);
}

/**
 * Opis encji. `resourceSlot(obraz)` → slot zasobu (renderIds.resources) albo −1; `oid(obiekt)` → numer obiektu
 * źródła. Pola kadłuba stałe dla rekordu (obrazy, siatka, kotwica) — zmienne w czasie (kotwica, skala, pivot, flagi,
 * ród) idą w BODY co klatkę.
 */
export function describeEntity(e, resourceSlot, oid = NO_OID) {
  const hull = e.beamHull;
  const body = hull ? hull.body : null;
  return {
    visual: visualConfig(e.visual, oid),
    capitalProfile: plainCopy(e.capitalProfile, oid),
    profile: plainCopy(e.profile, oid),
    editorLights: plainCopy(e.editorLights, oid),
    engines: enginesConfig(e.engines, oid),
    id: e.id, uid: e.uid, name: e.name,
    type: e.type, shipFrame: e.shipFrame, activeHullId: e.activeHullId,
    bridge: describeBridgeState(e.bridgeState, oid),
    // kawałek ciała świata (budowla) — worker łączy lustro z repliką kawałka (bryła i raster z układu budowli)
    worldRef: hull && hull.world ? { s: hull.world.site?.structure ?? null, p: hull.world.id ?? null } : null,
    hull: hull ? tag({
      // raster kawałka ciała świata to obiekt { width, height, data } — worker liczy go sam z układu budowli
      image: hull.image && !hull.world ? resourceSlot(hull.image) : -1,
      visualImage: hull.visualImage ? resourceSlot(hull.visualImage) : -1,
      normalMapImage: hull.normalMapImage ? resourceSlot(hull.normalMapImage) : -1,
      cellSize: hull.cellSize, pixelPitch: hull.pixelPitch, nx: hull.nx, ny: hull.ny, cellPx: hull.cellPx,
      anchorMode: hull.anchorMode, hexPerNode: hull.hexPerNode, anchorDZ: hull.anchorDZ,
      spriteSkin: body && body.spriteSkin ? tag({
        width: body.spriteSkin.width, height: body.spriteSkin.height, pixelPitch: body.spriteSkin.pixelPitch,
        nx: body.spriteSkin.nx, ny: body.spriteSkin.ny, cellSize: body.spriteSkin.cellSize
      }, body.spriteSkin, oid) : null,
      dims: body && body.dims ? tag({ x: body.dims.x, y: body.dims.y, z: body.dims.z }, body.dims, oid) : null,
      anchored: body ? !!body.anchored : false
    }, hull, oid) : null
  };
}

/** Część statyczna rdzenia reaktora (reactorCore.js) — pola czytane przez reactorBlastFx, reactor3D, coreBands. */
export function describeCore(c) {
  const copy = (a) => (ArrayBuffer.isView(a) ? a.slice() : a);
  return {
    uid: c.uid, id: c.id, lineage: c.lineage, gx: c.gx, gy: c.gy, gridR: c.gridR, classId: c.classId,
    color: c.color, kind: c.kind, armorMul: c.armorMul, meltdownSec: c.meltdownSec, chamberMaxHpSum: c.chamberMaxHpSum,
    cellX: copy(c.cellX), cellY: copy(c.cellY), cellBaseHp: copy(c.cellBaseHp), cellMaxHp: copy(c.cellMaxHp)
  };
}

/** Część statyczna stacji (wybór modelu w stations3D.js: id, nazwa, styl, planeta, orbita, gospodarz, piracka). */
export function describeStation(st) {
  const ref = (o) => (o && typeof o === 'object' ? { name: o.name, id: o.id } : o);
  return {
    id: st.id, name: st.name, style: st.style, type: st.type, isPirate: st.isPirate === true,
    planet: ref(st.planet), orbit: ref(st.orbit), host: typeof st.host === 'object' ? ref(st.host) : st.host,
    home: typeof st.home === 'object' ? ref(st.home) : st.home, ringPort: !!st.ringPort, faction: st.faction,
    world3dPirate: st.__world3dPirate === true
  };
}
