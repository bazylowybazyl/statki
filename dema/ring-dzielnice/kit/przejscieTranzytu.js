// DZIELNICE RINGU — PRZEJŚCIE DO TRANZYTU (decyzja użytkownika 2026-11-13: „przejście — dodaj drogę, zabudowany skręt
// do tranzytu”). Ring Ziemi ma cztery tranzyty (przeloty przez płytę ringu od strony Ziemi do habitatu, co 90°); przy
// obrocie ringu z portem dema na miejscu portu gry dwa wypadają pod dzielnicami (T-04 pod fabrykami, T-01 pod składami),
// a ich wylot zamyka rząd przy ringu. Gospodarz wycina rząd przy ringu w miejscu tranzytu i stawia tu przejście:
//   • korytarz od tranzytu (światło T-0x w płycie, ±630) przez habitat do lica drogi (±910 — rama tranzytu w grze),
//     z pokładem, pasami, szewronami ku tranzytowi i ścianami ze światłem;
//   • ZABUDOWANY SKRĘT przy drodze: korytarz rozszerza się skosami do ±2 400 przy licu drogi (wjazd z obu pasów),
//     nad całością dach (zestaw 'roof', zanika jak dachy hangarów, gdy Atlas jest pod nim), za skosami bloki rzędu;
//   • nad drogą w tym miejscu bez bramownic (gospodarz dopisuje `openings`).
// Czysta geometria (plan, przycinanie wielokątów, filtr scen) + scena PortRecorder. Kolizje: ściany, skosy i bloki.
import { PB_FX, PB_MAT, YARD_H, newScene, pbLabel, pbPlate, sceneOf } from './sceny.js';
import { YARD_R0, yardPoint, yardToArc } from './uklad.js';

const M = PB_MAT;
const H = YARD_H;

export const PASSAGE = Object.freeze({
  hT: 630,         // światło tranzytu w płycie ringu (HALO_TRANSIT.halfWidth + wall)
  hc: 910,         // korytarz przez habitat i rząd (rama tranzytu: halfWidth + wall + frame)
  hj: 2400,        // wylot skrętu przy licu drogi
  wall: 120,
  vBack: -2010,    // od strony Ziemi (spód ringu v −1 952)
  vFloor: -1500,   // podłoga habitatu
  vTurn: 380,      // od tu skosy skrętu
  vFace: 1000,     // lico drogi (koniec rzędu przy ringu)
  carve: 2650      // pół szerokości wycięcia rzędu przy ringu
});

/** Plan przejścia w układzie (x w poprzek — j. świata na promieniu R0 + v, v promieniowo); punkty → (x, z) wspólne. */
export function passagePlan(sT) {
  const P = PASSAGE;
  const sx = (x, v) => sT + (x * YARD_R0) / (YARD_R0 + v);
  const pt = (x, v) => yardPoint(sx(x, v), v);
  const poly = (pts) => pts.map(([x, v]) => pt(x, v));
  const t = P.wall;
  const walls = [];
  const blocks = [];
  for (const side of [-1, 1]) {
    const m = (pts) => pts.map(([x, v]) => [side * x, v]);
    walls.push({ id: 'ściana tranzytu', pts: m([[P.hT, P.vBack], [P.hT + t, P.vBack], [P.hT + t, P.vFloor], [P.hT, P.vFloor]]) });
    walls.push({ id: 'próg habitatu', pts: m([[P.hT, P.vFloor - t], [P.hc + t, P.vFloor - t], [P.hc + t, P.vFloor], [P.hT, P.vFloor]]) });
    walls.push({ id: 'ściana korytarza', pts: m([[P.hc, P.vFloor], [P.hc + t, P.vFloor], [P.hc + t, P.vTurn], [P.hc, P.vTurn]]) });
    walls.push({ id: 'skos skrętu', pts: m([[P.hc, P.vTurn], [P.hc + t, P.vTurn], [P.hj + t, P.vFace], [P.hj, P.vFace]]) });
    // blok rzędu za skosem (od lica habitatu do lica drogi)
    blocks.push({ id: 'blok przy skręcie', pts: m([[P.hc + t, 0], [P.carve, 0], [P.carve, P.vFace], [P.hj + t, P.vFace], [P.hc + t, P.vTurn]]) });
  }
  // wielokąty w kolejności przeciwnej do ruchu wskazówek po odbiciu — wypukłość nie zależy od kierunku
  const deck = [
    [[-P.hT, P.vBack], [P.hT, P.vBack], [P.hT, P.vFloor], [-P.hT, P.vFloor]],
    [[-P.hc, P.vFloor], [P.hc, P.vFloor], [P.hc, P.vTurn], [-P.hc, P.vTurn]],
    [[-P.hc, P.vTurn], [P.hc, P.vTurn], [P.hj, P.vFace], [-P.hj, P.vFace]]
  ];
  const roof = [
    [[-P.hc - t, P.vFloor - t], [P.hc + t, P.vFloor - t], [P.hc + t, P.vTurn], [-P.hc - t, P.vTurn]],
    [[-P.hc - t, P.vTurn], [P.hc + t, P.vTurn], [P.hj + t, P.vFace], [-P.hj - t, P.vFace]]
  ];
  return {
    sT, sx, pt, poly,
    walls: walls.map((w) => ({ ...w, points: poly(w.pts) })),
    blocks: blocks.map((b) => ({ ...b, points: poly(b.pts) })),
    deck: deck.map(poly),
    roof: roof.map(poly),
    /** Zakres s wycięcia rzędu przy ringu (na R0) i korytarza w habitacie. */
    rowCut: [sT - P.carve, sT + P.carve],
    bandCut: [sx(-P.hc - t, P.vFloor), sx(P.hc + t, P.vFloor)],
    /** Obrys pod dachem (do zaniku dachu, punkty { x, z }). */
    footprint: poly([[-P.hc - t, P.vFloor - t], [P.hc + t, P.vFloor - t], [P.hc + t, P.vTurn], [P.hj + t, P.vFace], [-P.hj - t, P.vFace], [-P.hc - t, P.vTurn]])
      .map(([x, z]) => ({ x, z }))
  };
}

// --- przycinanie wypukłego wielokąta półpłaszczyzną „po lewej / po prawej” promienia s (prosta przez środek ringu)
function sideOf(s) {
  const ph = s / YARD_R0;
  const c = Math.cos(ph);
  const sn = Math.sin(ph);
  // f(p) = r · sin(φp − φ): < 0 — mniejsze s
  return (p) => p[0] * c - (p[1] + YARD_R0) * sn;
}
function clipHalf(pts, f, keepNeg) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const fa = keepNeg ? -f(a) : f(a);
    const fb = keepNeg ? -f(b) : f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out.length >= 3 ? out : null;
}
/** Wielokąt wypukły bez części między promieniami s0 i s1: 0, 1 albo 2 wielokąty wypukłe. */
export function cutPolygonArc(pts, s0, s1) {
  const res = [];
  const left = clipHalf(pts, sideOf(s0), true);
  const right = clipHalf(pts, sideOf(s1), false);
  for (const p of [left, right]) if (p && polyArea(p) > 1) res.push(p);
  return res;
}
function polyArea(p) {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  return Math.abs(a) / 2;
}
/** Zakres łuku wielokąta: { s0, s1, v0, v1 }. */
export function arcRange(pts) {
  const r = { s0: Infinity, s1: -Infinity, v0: Infinity, v1: -Infinity };
  const a = {};
  for (const [x, z] of pts) {
    yardToArc(x, z, a);
    r.s0 = Math.min(r.s0, a.s); r.s1 = Math.max(r.s1, a.s);
    r.v0 = Math.min(r.v0, a.v); r.v1 = Math.max(r.v1, a.v);
  }
  return r;
}

/**
 * Wycina z brył złożenia (ring.solids) rząd przy ringu w zakresie przejścia i korytarz w pasie ringu (habitat) i dokłada
 * ściany, skosy i bloki przejścia. Zwraca nową listę brył.
 */
export function carveSolids(solids, plans, v) {
  let list = solids;
  for (const pl of plans) {
    const next = [];
    for (const q of list) {
      const r = arcRange(q.points);
      const band = q.zone === 'RING';
      const [a, b] = band ? pl.bandCut : pl.rowCut;
      const inner = band || r.v1 <= v.inner1 + 60;
      if (!inner || r.s1 <= a || r.s0 >= b) { next.push(q); continue; }
      cutPolygonArc(q.points, a, b).forEach((pts, i) => next.push({ ...q, id: `${q.id} (przejście ${i})`, points: pts }));
    }
    for (const w of [...pl.walls, ...pl.blocks]) next.push({ id: `PRZEJŚCIE ${pl.name}: ${w.id}`, tag: 'przejście', zone: 'PASSAGE', part: null, points: w.points });
    list = next;
  }
  return list;
}

/**
 * Filtr sceny dzielnicy (PortRecorder): bez instancji, płyt, napisów i lamp, których środek leży w wycięciu rzędu przy
 * ringu. `toCommon(x, z, out)` — punkt sceny (układ dzielnicy) → układ wspólny. Zwraca liczbę usuniętych.
 */
export function carveScene(scene, toCommon, cuts, v) {
  const P = [0, 0];
  const A = {};
  const inCut = (x, z) => {
    toCommon(x, z, P);
    yardToArc(P[0], P[1], A);
    if (A.v < -260 || A.v > v.inner1 + 40) return false;
    for (const [a, b] of cuts) if (A.s > a && A.s < b) return true;
    return false;
  };
  let removed = 0;
  for (const set of Object.values(scene.sets || {})) {
    for (const kind of Object.keys(set)) {
      const src = set[kind];
      if (!src.length) continue;
      const STR = 20;
      const out = [];
      for (let o = 0; o < src.length; o += STR) {
        if (inCut(src[o], src[o + 2])) { removed++; continue; }
        for (let k = 0; k < STR; k++) out.push(src[o + k]);
      }
      set[kind] = out;
    }
  }
  const keep = (arr, at) => arr.filter((e) => { const [x, z] = at(e); if (!inCut(x, z)) return true; removed++; return false; });
  if (scene.plates) {
    scene.plates = keep(scene.plates, (p) => {
      let x = 0; let z = 0;
      for (const q of p.points) { x += q[0]; z += q[1]; }
      return [x / p.points.length, z / p.points.length];
    });
  }
  if (scene.labels) scene.labels = keep(scene.labels, (l) => [l.x, l.z]);
  if (scene.lamps) scene.lamps = keep(scene.lamps, (l) => [l[0], l[2]]);
  return removed;
}

/** Bryły przejścia (pokład, ściany, bloki) — zestaw podstawowy. */
export function buildPassageScene(plan, name, style) {
  const { f, plates, labels, lamps, T } = newScene();
  const P = PASSAGE;
  const { sx, pt } = plan;
  for (const d of plan.deck) pbPlate(plates, d, H.keel, H.floor - H.keel, M.floor);
  for (const w of plan.walls) pbPlate(plates, w.points, H.keel - 40, H.over + 60 - H.keel, M.steel);
  for (const b of plan.blocks) {
    pbPlate(plates, b.points, H.keel, H.deck - H.keel, M.dark);
    pbPlate(plates, b.points, H.deck, 8, M.steel);
  }
  const seg = (x0, v0, x1, v1, y, h, w, mat) => T.seg(sx(x0, v0), v0, sx(x1, v1), v1, y, h, w, mat);
  // pasy: krawędzie (żółte), oś przerywana, szewrony ku tranzytowi
  for (const side of [-1, 1]) {
    seg(side * (P.hT - 40), P.vBack + 40, side * (P.hT - 40), P.vFloor, H.mark, 2, 26, M.yellow);
    seg(side * (P.hc - 40), P.vFloor, side * (P.hc - 40), P.vTurn, H.mark, 2, 26, M.yellow);
    seg(side * (P.hc - 40), P.vTurn, side * (P.hj - 40), P.vFace - 20, H.mark, 2, 26, M.yellow);
  }
  f.fx(0.9, PB_FX.steady);
  for (let v = P.vBack + 120; v < P.vFace - 100; v += 260) seg(0, v, 0, v + 130, H.mark, 2, 18, M.white);
  f.nofx();
  for (let v = P.vFloor + 300; v < P.vTurn; v += 420) T.chevron(sx(0, v), v, H.mark + 1, 260, 22, M.paintCold, 0, -1);
  // światła na licach ścian (wysokość kadłuba) i bieg świateł ku tranzytowi na pokładzie
  f.fx(1.1, PB_FX.steady);
  for (const side of [-1, 1]) {
    seg(side * (P.hT + 4), P.vBack + 60, side * (P.hT + 4), P.vFloor - 20, H.wallLight, 6, 6, M.cyan);
    seg(side * (P.hc + 4), P.vFloor + 20, side * (P.hc + 4), P.vTurn - 20, H.wallLight, 6, 6, M.cyan);
    seg(side * (P.hc + 4), P.vTurn + 20, side * (P.hj + 4), P.vFace - 20, H.wallLight, 6, 6, M.cyan);
  }
  f.nofx();
  for (let k = 0; k < 10; k++) {
    const v = P.vFace - 120 - (k * (P.vFace - P.vBack - 240)) / 9;
    for (const side of [-1, 1]) T.lamp(sx(side * (v < P.vFloor ? P.hT - 90 : P.hc - 90), v), v, H.mark + 6, 22, M.green, 1.3, PB_FX.chase, k / 10, 0.9);
  }
  // wylot na drogę: pasy ostrzegawcze i napis na pokładzie
  T.hazardRun(sx(-P.hj + 60, P.vFace - 40), sx(P.hj - 60, P.vFace - 40), P.vFace - 40, H.floor + 3, 50);
  const [lx, lz] = pt(0, (P.vTurn + P.vFace) / 2 - 80);
  pbLabel(labels, `TRANZYT ${name}`, lx, lz, 1500, 220, style.labels.clear, 'PRZELOT DO ZIEMI', (plan.sT / YARD_R0) + Math.PI, H.mark + 2, 'bg');
  // bloki przy skręcie: nadbudówki i światła narożne
  for (const side of [-1, 1]) {
    const x = side * (P.hc + P.carve) / 2 + side * 260;
    T.box(sx(x, 300), 300, H.deck + 50, 520, 100, 360, M.steel);
    T.lamp(sx(side * (P.hj + 160), P.vFace - 60), P.vFace - 60, H.deck + 30, 24, M.red, 1.6, PB_FX.blink, 0.3 * side, 0.8);
  }
  void lamps;
  return sceneOf(f, plates, labels, lamps);
}

/** Dach przejścia (zestaw 'roof' — zanika, gdy Atlas jest pod nim), żebra i światła. */
export function buildPassageRoofScene(plan) {
  const { f, plates, labels, lamps, T } = newScene();
  const P = PASSAGE;
  const { sx } = plan;
  f.set = 'roof';
  for (const r of plan.roof) pbPlate(plates, r, H.over, 50, M.steel, 'roof');
  for (let v = P.vFloor + 100; v < P.vFace - 60; v += 240) {
    const half = v < P.vTurn ? P.hc + P.wall : P.hc + P.wall + ((P.hj - P.hc) * (v - P.vTurn)) / (P.vFace - P.vTurn);
    T.box(sx(0, v), v, H.over + 62, half * 2 - 60, 24, 40, M.pale);
  }
  for (const side of [-1, 1]) {
    T.seg(sx(side * (P.hc + 60), P.vFloor), P.vFloor, sx(side * (P.hc + 60), P.vTurn), P.vTurn, H.over + 70, 30, 50, M.yellow);
    T.seg(sx(side * (P.hc + 60), P.vTurn), P.vTurn, sx(side * (P.hj + 60), P.vFace), P.vFace, H.over + 70, 30, 50, M.yellow);
  }
  for (let k = 0; k < 6; k++) {
    const v = P.vFloor + 150 + (k * (P.vFace - P.vFloor - 300)) / 5;
    T.lamp(sx(0, v), v, H.over + 90, 26, M.white, 1.2, PB_FX.chase, k / 6, 0.7);
  }
  f.set = 'bg';
  return sceneOf(f, plates, labels, lamps);
}
