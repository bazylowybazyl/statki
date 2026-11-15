// DZIELNICE RINGU — PYLONY: rząd przy ringu wisi w wylocie habitatu ringu Ziemi (ściany na z ±2 700…2 950, rzędy dema
// na z ≈ −560…+56), więc trzymają go pylony od podłogi habitatu (v = −1 500, płaszczyzna gry przecina podłogę w połowie
// wstęgi) do lica rzędu (v = 0) — decyzja użytkownika 2026-11-13: „pylony”.
// KSZTAŁT JAK W GRZE (uwaga użytkownika: „prostokątne kształty — źle wygląda”): obrys pylonu zatoki K-7
// (`k7DockArms` z `HALO_PORT.armBay`, src/3d/haloRing/haloPortK7Layout.js) — stopa przy podłodze i korzeń przy rzędzie
// rozszerzone (×1,5), między nimi zwężenia i dźwigar; na wierzchu pasy po obrysie i żebra w poprzek, po bokach dźwigara
// kratownica Warrena, okna korytarza, światła przeszkodowe i bieg świateł (bryły jak w `haloRingRoofPlan.js`, pętla
// `dock.arms`). Długość: 1 500 j. zamiast ~4 000 w grze, więc stopa, korzeń i zwężenia są krótsze w tej samej proporcji.
// Rysowane tylko z ringiem z gry. Pylon leży w habitacie (v < 0) — tam kolizje dema już są (dawny pas ściany).
// STREFA PRZEMYSŁOWA przy stopie (w grze: płyta portu i pas fabryczny w terenie ringu wokół miejsc portu) wymaga zmiany
// w src/ (miejsca podłogi spoza szablonu kompleksów) — opis w raporcie sesji ring-z-gry.
import { HALO_PORT } from '../../../src/3d/haloRing/haloRingConfig.js';
import { PB_FX, PB_MAT, YARD_H, newScene, pbPlate, sceneOf } from './sceny.js';
import { YARD_R0, yardPoint } from './uklad.js';

const M = PB_MAT;
const H = YARD_H;
const A = HALO_PORT.armBay;

export const PYLON = Object.freeze({
  step: 4500,              // rozstaw wzdłuż łuku (na R0); w grze dwa pylony na zatokę 6 160 j.
  width: A.width,          // dźwigar 700
  flare: A.flare,          // stopa i korzeń × 1,5
  foot: 380,               // stopa (w grze 600 na ~4 000 długości)
  root: 260,               // korzeń przy licu rzędu
  taper: 260,
  vFloor: -1500,           // podłoga habitatu
  into: 60,                // korzeń wchodzi w lico rzędu
  zHalf: 420               // zasięg w z świata (± od płaszczyzny gry) do sprawdzania kopuł i budowli
});

/**
 * Miejsca pylonów (s) na łuku [sMin, sMax]: co `step`, bez przedziałów `skip` ([s0, s1], np. przelot tranzytu)
 * i bez kolizji z `obstacles` ({ s, halfS, z, halfZ } — kopuły i megabudowle na podłodze habitatu).
 */
export function pylonPlan({ sMin, sMax, step = PYLON.step, skip = [], obstacles = [] }) {
  const out = [];
  const n = Math.floor((sMax - sMin) / step);
  const s0 = sMin + ((sMax - sMin) - n * step) / 2;
  const half = (PYLON.width * PYLON.flare) / 2;
  for (let k = 0; k <= n; k++) {
    const s = s0 + k * step;
    if (skip.some(([a, b]) => s + half > a && s - half < b)) continue;
    if (obstacles.some((o) => Math.abs(s - o.s) < o.halfS + half && Math.abs(o.z) < o.halfZ + PYLON.zHalf)) continue;
    out.push(s);
  }
  return out;
}

/** Obrys pylonu (x w poprzek — j. świata, v promieniowo): stopa ze zwężeniem, dźwigar, korzeń — trzy wielokąty wypukłe. */
export function pylonOutline() {
  const P = PYLON;
  const hw = P.width / 2;
  const hf = (P.width * P.flare) / 2;
  const v0 = P.vFloor - 40;
  const footEnd = P.vFloor + P.foot;
  const rootStart = -P.root;
  const a = footEnd + P.taper;
  const b = rootStart - P.taper;
  return {
    hw, hf, v0, footEnd, rootStart, a, b, v1: P.into,
    polys: [
      [[-hf, v0], [hf, v0], [hf, footEnd], [hw, a], [-hw, a], [-hf, footEnd]],
      [[-hw, a], [hw, a], [hw, b], [-hw, b]],
      [[-hw, b], [hw, b], [hf, rootStart], [hf, P.into], [-hf, P.into], [-hf, rootStart]]
    ]
  };
}

/** Bryły pylonów (scena PortRecorder w układzie wspólnym łuku). */
export function buildRingPylonScene(list) {
  const { f, plates, labels, lamps, T } = newScene();
  const O = pylonOutline();
  const keel = H.keel;            // spód rzędu
  const top = H.deck;             // wierzch rzędu
  const rail = 50;
  for (const s of list) {
    // punkt (x w poprzek, v) → (s, v) łuku: szerokość w j. świata na promieniu R0 + v
    const sx = (x, v) => s + (x * YARD_R0) / (YARD_R0 + v);
    const P = (x, v) => yardPoint(sx(x, v), v);
    const seg = (x0, v0, x1, v1, y, h, wid, mat) => T.seg(sx(x0, v0), v0, sx(x1, v1), v1, y, h, wid, mat);
    // bryła: stopa wyższa (wieża przy podłodze), dźwigar, korzeń wpięty w lico rzędu
    pbPlate(plates, O.polys[0].map(([x, v]) => P(x, v)), keel - 140, top - keel + 220, M.dark);
    pbPlate(plates, O.polys[1].map(([x, v]) => P(x, v)), keel + 30, top - keel - 50, M.dark);
    pbPlate(plates, O.polys[2].map(([x, v]) => P(x, v)), keel - 20, top - keel + 30, M.dark);
    // pasy po obrysie na wierzchu (z góry — kontur belki)
    for (const side of [-1, 1]) {
      const path = [[side * O.hf, O.v0 + 60], [side * O.hf, O.footEnd], [side * O.hw, O.a], [side * O.hw, O.b], [side * O.hf, O.rootStart], [side * O.hf, -40]];
      const ox = -side * rail * 0.5;
      for (let k = 0; k + 1 < path.length; k++) {
        const [xa, va] = path[k];
        const [xb, vb] = path[k + 1];
        const yTop = k === 0 ? top + 80 : k === path.length - 2 ? top + 10 : top - 50;
        seg(xa + ox, va, xb + ox, vb, yTop + 14, 28, rail, M.rail);
      }
    }
    // żebra dachu w poprzek dźwigara
    for (let v = O.a + 90; v < O.b - 40; v += 150) T.box(sx(0, v), v, top - 50 + 8, O.hw * 2 - rail * 1.6, 12, 26, M.steel);
    // lica dźwigara: słupki i krzyżulce (kratownica Warrena)
    const n = Math.max(2, Math.round((O.b - O.a) / 220));
    const st = (O.b - O.a) / n;
    for (let i = 0; i <= n; i++) {
      const v = O.a + i * st;
      for (const side of [-1, 1]) {
        const x = side * (O.hw + 8);
        T.box(sx(x, v), v, (keel + 30 + top - 50) / 2, 26, top - keel - 90, 26, M.steel);
        if (i < n) {
          const up = (i & 1) === 0;
          const v2 = v + st;
          T.beam([sx(x, v), v, up ? keel + 50 : top - 70], [sx(x, v2), v2, up ? top - 70 : keel + 50], 18, M.rail);
        }
      }
    }
    // okna korytarza i listwy świetlne wzdłuż pasów
    f.fx(1.1, PB_FX.steady);
    for (const side of [-1, 1]) seg(side * (O.hw + 4), O.a + 40, side * (O.hw + 4), O.b - 40, keel + 120, 24, 6, M.glass);
    f.nofx();
    f.fx(1.0, PB_FX.steady);
    for (const side of [-1, 1]) seg(side * (O.hw - rail - 6), O.a + 30, side * (O.hw - rail - 6), O.b - 30, top - 34, 6, 10, M.cyan);
    f.nofx();
    // stopa: płyta kotwy na podłodze habitatu, pasy ostrzegawcze na wierzchu
    T.box(s, PYLON.vFloor - 20, (keel + top) / 2, O.hf * 2.6, top - keel + 420, 60, M.steel);
    T.hazardRun(sx(-O.hf + 30, O.footEnd - 40), sx(O.hf - 30, O.footEnd - 40), O.footEnd - 40, top + 82, 22);
    // światła przeszkodowe na narożnikach stopy i korzenia, bieg świateł wzdłuż dachu
    for (const side of [-1, 1]) {
      T.lamp(sx(side * (O.hf - 30), O.footEnd - 50), O.footEnd - 50, top + 104, 22, M.red, 1.7, PB_FX.blink, 0.3 + 0.2 * side, 0.6);
      T.lamp(sx(side * (O.hf - 30), O.rootStart + 40), O.rootStart + 40, top + 34, 18, M.red, 1.5, PB_FX.blink, 0.55 + 0.2 * side, 0.6);
    }
    for (let k = 0; k < 4; k++) {
      const v = O.a + 60 + (k * (O.b - O.a - 120)) / 3;
      T.lamp(sx(0, v), v, top - 30, 14, M.white, 1.1, PB_FX.chase, k / 4, 0.8);
    }
  }
  return sceneOf(f, plates, labels, lamps);
}
