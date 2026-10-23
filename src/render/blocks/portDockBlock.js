// src/render/blocks/portDockBlock.js — blok migawki: budowle doków portów bez ringu w zasięgu kadru (E14).
//
// Rozgrywka (kolizje, ścieżki bańki) liczy budowle w grze (`src/game/portDockWorld.js` — tabela `bubbleDocks`
// z workera ruchu), obraz rysuje worker renderu (`updatePortDocks3D`, src/3d/portDocks3D.js). Na budowlę 8 liczb:
// indeks rodzaju (`PORT_DOCK_KIND_IDS`), składu (`BERTH_MIX_IDS`) i stylu (`PORT_DOCK_STYLE_IDS`), mnożnik składu,
// liczba doków, środek i kąt osi +u w grze — geometrię obie strony liczą z `buildPortDockGeometry`.
//
// Rejestracja (strona gry): `packer.addBlock(createPortDockBlock())`, w klatce `frame.portDocks = { list, count }`
// (rekordy budowli `PortDockWorld`: `kindIndex`, `mixIndex`, `styleIndex`, `spec.repeats`, `spec.dockCount`, `x`, `y`,
// `angle`). Strona renderu: `applyPortDockBlock(view.blocks.portDocks, out)` → rekordy wielokrotnego użytku.
// Czysty moduł (bez three, DOM i `window`).

export const PORT_DOCK_BLOCK = Object.freeze({
  HEAD: 2,                         // [liczba budowli, słowa użyte]
  DOCK: Object.freeze({ KIND: 0, MIX: 1, STYLE: 2, REPEATS: 3, COUNT: 4, X: 5, Y: 6, ANGLE: 7, STRIDE: 8 }),
  /** Budowle w zasięgu kadru — przy księżycach olbrzymów 2–3, zapas. */
  CAP: 8
});

const D = PORT_DOCK_BLOCK.DOCK;

const field = (r, key) => (r[key] !== undefined ? r[key] : r.spec ? r.spec[key] : 0);

/** Rekordy budowli → blok (`f64`). Zwraca liczbę spakowanych. */
export function packPortDockBlock(F, list, count) {
  const n = Math.min(count | 0, PORT_DOCK_BLOCK.CAP, list ? list.length : 0);
  let o = PORT_DOCK_BLOCK.HEAD;
  let k = 0;
  for (let i = 0; i < n; i++) {
    const r = list[i];
    if (!r || !(r.kindIndex >= 0)) continue;
    F[o + D.KIND] = r.kindIndex;
    F[o + D.MIX] = r.mixIndex | 0;
    F[o + D.STYLE] = r.styleIndex | 0;
    F[o + D.REPEATS] = Number(field(r, 'repeats')) || 1;
    F[o + D.COUNT] = Number(field(r, 'dockCount')) || 1;
    F[o + D.X] = r.x;
    F[o + D.Y] = r.y;
    F[o + D.ANGLE] = r.angle;
    o += D.STRIDE;
    k++;
  }
  F[0] = k;
  F[1] = o;
  return k;
}

/** Blok do `packer.addBlock` (faza begin). */
export function createPortDockBlock() {
  return {
    name: 'portDocks', f64: PORT_DOCK_BLOCK.HEAD + PORT_DOCK_BLOCK.CAP * D.STRIDE, phase: 'begin',
    pack(blk, frame) {
      const d = frame.portDocks;
      if (!d || !d.list) { blk.f64[0] = 0; blk.f64[1] = PORT_DOCK_BLOCK.HEAD; return; }
      packPortDockBlock(blk.f64, d.list, d.count);
    }
  };
}

/**
 * Strona renderu: rekordy z bloku do `out` (tablica obiektów trzymana przez wołającego — rekordy wielokrotnego użytku,
 * kształt dla `updatePortDocks3D`). Zwraca `out`.
 */
export function applyPortDockBlock(blk, out) {
  const F = blk && blk.f64;
  const n = F ? Math.min(F[0] | 0, PORT_DOCK_BLOCK.CAP) : 0;
  let o = PORT_DOCK_BLOCK.HEAD;
  for (let i = 0; i < n; i++, o += D.STRIDE) {
    let r = out[i];
    if (!r) {
      r = { kindIndex: 0, mixIndex: 0, styleIndex: 0, repeats: 1, dockCount: 1, x: 0, y: 0, angle: 0 };
      out[i] = r;
    }
    r.kindIndex = F[o + D.KIND];
    r.mixIndex = F[o + D.MIX];
    r.styleIndex = F[o + D.STYLE];
    r.repeats = F[o + D.REPEATS];
    r.dockCount = F[o + D.COUNT];
    r.x = F[o + D.X];
    r.y = F[o + D.Y];
    r.angle = F[o + D.ANGLE];
  }
  out.length = n;
  return out;
}
