// src/render/describeEntity.js — opis encji dla lustra renderu: konfiguracja statyczna z BIAŁEJ LISTY pól
// (docs/PLAN-render-worker.md § 3.6, RW-11a).
//
// Obiekty gry nie przechodzą przez `structuredClone`: obrazy DOM (`hull.image`, `visualImage`), funkcje
// (`hull.world.build`, `__lightOcclude`), cykle (encja ↔ kadłub ↔ ciało), instancje klas (magazyny SoA). Opis kopiuje
// tylko pola, które czyta render, jako zwykłe dane (w workerze — `postMessage`; w `inline` — świeże kopie, więc gra
// może dalej zmieniać swoje obiekty bez wpływu na lustro). Obrazy → sloty zasobów (`resourceSlot(obraz)`).
// Dysze: tylko klucze konfiguracji (offset, forward, mount, side, długości / szerokości VFX); kąty, ciąg, skala VFX
// i zniszczenie idą co klatkę w bloku NOZZLES.
//
// Czysty moduł (bez three, DOM i `window`).

const pt = (p) => (p && typeof p === 'object' ? { x: p.x, y: p.y } : p);

/** Konfiguracja dyszy (bez pól klatki: __throttle, __*, nozzleDeg, vfxScale, __destroyed — NOZZLES). */
function nozzleConfig(t) {
  if (!t || typeof t !== 'object') return t;
  return {
    offset: pt(t.offset), forward: pt(t.forward), mount: t.mount, side: t.side,
    baseDeg: t.baseDeg, nozzleDeg: t.nozzleDeg, gimbalMinDeg: t.gimbalMinDeg, gimbalMaxDeg: t.gimbalMaxDeg,
    yNudge: t.yNudge, vfxLengthMin: t.vfxLengthMin, vfxLengthMax: t.vfxLengthMax,
    vfxWidthMin: t.vfxWidthMin, vfxWidthMax: t.vfxWidthMax
  };
}

/** Kopia zwykłych danych (JSON: liczby, napisy, tablice, obiekty) — dla profili i lamp edytora. */
export function plainCopy(o, depth = 0) {
  if (o === null || typeof o !== 'object') return typeof o === 'function' ? undefined : o;
  if (depth > 6) return undefined;
  if (Array.isArray(o)) return o.map((x) => plainCopy(x, depth + 1));
  if (ArrayBuffer.isView(o)) return o.slice();
  const proto = Object.getPrototypeOf(o);
  if (proto !== Object.prototype && proto !== null) return undefined;   // DOM, klasy, Map — poza opisem
  const out = {};
  for (const k of Object.keys(o)) {
    const v = plainCopy(o[k], depth + 1);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function visualConfig(v) {
  if (!v || typeof v !== 'object') return v === undefined ? undefined : null;
  return {
    spriteScale: v.spriteScale, spriteScaleX: v.spriteScaleX, spriteScaleY: v.spriteScaleY,
    spriteRotation: v.spriteRotation,
    preserveBillboardLighting: v.preserveBillboardLighting, preserveBillboardOrientation: v.preserveBillboardOrientation,
    hideHexMesh: v.hideHexMesh, engineVfxClassScale: v.engineVfxClassScale,
    turretTop: pt(v.turretTop), turretBottom: pt(v.turretBottom), mainEngine: pt(v.mainEngine),
    engineFx: plainCopy(v.engineFx),
    lights: plainCopy(v.lights),
    mainThrusters: Array.isArray(v.mainThrusters) ? v.mainThrusters.map(nozzleConfig) : v.mainThrusters,
    torqueThrusters: Array.isArray(v.torqueThrusters) ? v.torqueThrusters.map(nozzleConfig) : v.torqueThrusters
  };
}

function enginesConfig(en) {
  if (!en || typeof en !== 'object') return en;
  const m = en.main;
  return {
    main: m ? {
      ...nozzleConfig(m), visualOffset: pt(m.visualOffset), vfxOffset: pt(m.vfxOffset), vfxForward: pt(m.vfxForward),
      vfxYNudge: m.vfxYNudge, maxThrust: m.maxThrust
    } : m
  };
}

/**
 * Opis encji. `resourceSlot(obraz)` → slot zasobu (renderIds.resources) albo −1. Pola kadłuba stałe dla rekordu
 * (obrazy, siatka, kotwica) — zmienne w czasie (kotwica, skala, pivot, flagi, ród) idą w BODY co klatkę.
 */
export function describeEntity(e, resourceSlot) {
  const hull = e.beamHull;
  const body = hull ? hull.body : null;
  return {
    visual: visualConfig(e.visual),
    capitalProfile: plainCopy(e.capitalProfile),
    profile: plainCopy(e.profile),
    editorLights: plainCopy(e.editorLights),
    engines: enginesConfig(e.engines),
    id: e.id, uid: e.uid, name: e.name,
    type: e.type, shipFrame: e.shipFrame, activeHullId: e.activeHullId,
    hull: hull ? {
      image: hull.image ? resourceSlot(hull.image) : -1,
      visualImage: hull.visualImage ? resourceSlot(hull.visualImage) : -1,
      normalMapImage: hull.normalMapImage ? resourceSlot(hull.normalMapImage) : -1,
      cellSize: hull.cellSize, pixelPitch: hull.pixelPitch, nx: hull.nx, ny: hull.ny, cellPx: hull.cellPx,
      anchorMode: hull.anchorMode, hexPerNode: hull.hexPerNode, anchorDZ: hull.anchorDZ,
      spriteSkin: body && body.spriteSkin ? {
        width: body.spriteSkin.width, height: body.spriteSkin.height, pixelPitch: body.spriteSkin.pixelPitch,
        nx: body.spriteSkin.nx, ny: body.spriteSkin.ny, cellSize: body.spriteSkin.cellSize
      } : null,
      dims: body && body.dims ? { x: body.dims.x, y: body.dims.y, z: body.dims.z } : null,
      anchored: body ? !!body.anchored : false
    } : null
  };
}
