// src/game/ringGasField.js
//
// GAZ PRZESTRZENI — scena RINGU W BUDOWIE (Jowisz, GK-6 docs/PLAN-gazy-kosmos.md; decyzja użytkownika 2026-10-23:
// „wszędzie pył, gaz”). Pole ringu dla wejścia gazu (src/game/spaceGasInput.js) z tym samym API co pole pasa
// (`sampleMacro`, `rectTouchesBelt`, `holeVersion`, `forEachRockInRect`), więc pakowanie, okno i render są wspólne —
// inna jest kotwica (środek planety), obwiednia, wiatr i wygląd (scena `ring` w src/3d/spaceGas/spaceGasBelt.js).
//
// Obwiednia: pas pyłu budowy wokół obręczy ringu (szerszy od strony habitatu, gdzie stoją doki), gęściej przy
// frontach budowy (spawanie, cięcie, odgazowanie), rzadziej przy halach K-7 (hala ma własny gaz — reguła `pyl-hal-k7`).
// Odgazowanie: struga z każdego frontu (od strony habitatu i od strony planety) — „skały” z kierunkiem wylotu.
// Przeszkoda: płyta ringu (wyspy, nie przerwy) jako „olbrzym” rastra przekroju (`giants` — to samo API co olbrzymy
// pasa: `giant.sampleWorld` < 0 w bryle) — gaz płynie przerwami, płyta wysp go zatrzymuje; płyta z kolidera gry
// (`pointInSlab`: przerwy, tranzyty, teren), więc gaz widzi tę samą płytę co statki i pociski.
// Czysty moduł: bez three, DOM i `window`.

import { haloGapEdgeDistance, haloAngleDiff } from '../3d/haloRing/haloRingConstruction.js';
import { haloPortComplexAngles } from '../3d/haloRing/haloRingConfig.js';
import { haloGameToLocal, haloLocalToGame, haloLocalToGameVec } from './haloRingPlanets.js';

/** Typ „skały” strugi odgazowania ringu (zbiór `iceTypes` wejścia gazu dla sceny ringu). */
export const RING_GAS_VENT_TYPE = -71;
export const RING_GAS_VENT_TYPES = new Set([RING_GAS_VENT_TYPE]);

/** Strojenie obwiedni (konsola: window.RingGasTune w ?dev). */
export const RING_GAS_TUNE = {
  sigmaIn: 3200,      // pas pyłu od strony planety [j.]
  sigmaOut: 5200,     // od strony habitatu i doków [j.]
  base: 0.5,          // tło budowy wzdłuż całego ringu
  front: 0.5,         // dodatek przy frontach budowy
  frontReach: 2600,   // zasięg frontu wzdłuż ringu [j.]
  hallDim: 0.45,      // przy halach K-7 (własny gaz hali) — mnożnik
  hallReach: 9000,
  wind: 22,           // dryf wzdłuż obręczy [j/s]
  windOut: 6,         // od planety [j/s]
  ventSize: 110,      // „promień skały” strugi frontu [j.] (szerokość wylotu)
  ventGain: 0.16      // wydajność strugi względem skały pasa (struga frontu to opary, nie gejzer)
};

const _m = { weight: 0, cluster: 1, hole: 1, gas: 0, ice: 0 };
const _p = {};

/**
 * Pole gazu ringu w budowie z wpisu świata ringów (`haloWorld.entries[]`: `collider` — layout, place, construction).
 * null, gdy ring nie jest w budowie.
 */
export function createRingGasField(entry) {
  const col = entry?.collider;
  const K = col?.construction;
  if (!col || !K?.active) return null;
  const place = col.place;
  const L = col.layout;
  const R = L.radii;
  const Rc = 0.5 * (R.back + R.rim);
  const T = RING_GAS_TUNE;
  const halls = haloPortComplexAngles();
  const reachOut = Rc + 3 * T.sigmaOut;
  const reachIn = Math.max(0, Rc - 3 * T.sigmaIn);

  // strugi odgazowania: dwie na front (habitat i strona planety), wylot ku przerwie i od obręczy
  const vents = [];
  let seed = 1;
  for (const g of K.gaps) {
    for (const sgn of [-1, 1]) {
      const th = g.center + sgn * (g.half + K.front * 0.4);
      for (const side of [1, -1]) {
        const r = side > 0 ? R.rim + 120 : R.back - 120;
        const c = Math.cos(th), s = Math.sin(th);
        // kierunek lokalny: promieniowo (side) + stycznie ku przerwie (−sgn)
        const tx = s * sgn, ty = -c * sgn;
        let dx = c * side * 0.8 + tx * 0.6, dy = s * side * 0.8 + ty * 0.6;
        const l = Math.hypot(dx, dy) || 1;
        dx /= l; dy /= l;
        const p = haloLocalToGame(place, c * r, s * r, {});
        const d = haloLocalToGameVec(place, dx, dy, {});
        vents.push({ x: p.x, y: p.y, r: T.ventSize * (0.8 + 0.4 * ((seed * 0.618) % 1)), type: RING_GAS_VENT_TYPE, seed: seed * 7.31, dx: d.x, dy: d.y });
        seed++;
      }
    }
  }

  // płyta ringu w rastrze przeszkód gazu: jeden „olbrzym” na cały ring (pudło obręczy), próbka = kolider gry
  const giants = {
    entries: [{
      x: place.x,
      y: place.y,
      halfX: R.rim + 1500,
      halfY: R.rim + 1500,
      giant: { ready: true, band: 0, sampleWorld: (wx, wy) => (col.pointInSlab(wx, wy) ? -1 : 1) }
    }]
  };

  return {
    key: entry.key,
    giants,
    anchorX: place.x,
    anchorY: place.y,
    wind: T.wind,
    windOut: T.windOut,
    ventGain: T.ventGain,
    holeVersion: 0,
    vents,
    /** Prostokąt świata gry dotyka pasa gazu ringu (pierścień wokół obręczy). */
    rectTouchesBelt(x0, y0, x1, y1) {
      const nx = Math.max(x0, Math.min(place.x, x1)) - place.x;
      const ny = Math.max(y0, Math.min(place.y, y1)) - place.y;
      const near = Math.sqrt(nx * nx + ny * ny);
      const fx = Math.max(Math.abs(x0 - place.x), Math.abs(x1 - place.x));
      const fy = Math.max(Math.abs(y0 - place.y), Math.abs(y1 - place.y));
      const far = Math.sqrt(fx * fx + fy * fy);
      return near < reachOut && far > reachIn;
    },
    /** Obwiednia w punkcie świata gry (wynik współdzielony — jak `field.sampleMacro` pasa). */
    sampleMacro(wx, wy) {
      haloGameToLocal(place, wx, wy, _p);
      const r = Math.sqrt(_p.x * _p.x + _p.y * _p.y);
      const d = r - Rc;
      const sg = d > 0 ? T.sigmaOut : T.sigmaIn;
      const band = Math.exp(-(d * d) / (sg * sg));
      if (band < 1e-3) { _m.weight = 0; _m.ice = 0; return _m; }
      let th = Math.atan2(_p.y, _p.x);
      if (th < 0) th += Math.PI * 2;
      const e = Math.abs(haloGapEdgeDistance(th, K)) * R.floorMid;
      const fr = Math.exp(-(e * e) / (T.frontReach * T.frontReach));
      let hall = 1;
      for (let i = 0; i < halls.length; i++) {
        const a = Math.abs(haloAngleDiff(th, halls[i])) * R.floorMid;
        if (a < T.hallReach) hall = Math.min(hall, T.hallDim + (1 - T.hallDim) * (a / T.hallReach) * (a / T.hallReach));
      }
      _m.weight = band * (T.base + T.front * fr) * hall;
      _m.ice = 0.12 + 0.4 * fr;
      return _m;
    },
    /** Strugi odgazowania w prostokącie (API skał pola pasa: rock.x, y, r, type, seed + kierunek wylotu dx, dy). */
    forEachRockInRect(kind, x0, y0, x1, y1, minSize, cb) {
      for (let i = 0; i < vents.length; i++) {
        const v = vents[i];
        // strugi frontu to nie skały: bez progu rozmiaru skały odgazowującej (minSize pasa)
        if (v.x < x0 || v.x > x1 || v.y < y0 || v.y > y1) continue;
        cb(v);
      }
    }
  };
}

