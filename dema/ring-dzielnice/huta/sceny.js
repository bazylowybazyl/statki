// HUTA — bryły stałe (dane instancji zestawu budowli portowych; kontrakt: dema/ring-dzielnice/README.md).
// Trzy budowle: rzędy przy drodze z bramami ciężarówek, ZAKŁAD (plac wyrobów, hala walcowni, pętla kadzi, piece, piec
// tunelowy ceramiki) i NABRZEŻE RUDY (zasieki, pirsy, odkurzacze). To, co się rusza albo zmienia barwę i żar (ruda,
// kopce, ciekły metal, kęsiska, kręgi, ciężarówki), rysuje wtyczka przez tworzywo (index.js).
// Wzór wyglądu: obrazy użytkownika (.tmp/huta/wzor/) — jasne mury z płyt, żółte suwnice i poręcze, niebieskie bloki
// bram, ośmiokątne piece, czarne kraty chłodni, grube rury.
import {
  PB_FX, PB_MAT, PB_MAX_GROUPS, YARD_H, bodies, k7HeightToZ, lintel, newScene, pitDetail, pbHash1, sceneOf, xzTools
} from '../kit/sceny.js';
import { RING_V } from '../kit/uklad.js';

const M = PB_MAT;
const H = YARD_H;
const V = RING_V;
const FLOOR = H.floor;          // 18: posadzka zakładu
const WALL = 150;               // korona murów

const addLamp = (lamps, x, z, y, kind = 1) => { if (lamps.length < 8) lamps.push([x, k7HeightToZ(y), z, kind]); };
const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

/** Mur z koroną z jasnych płyt: odcinek a → b, grubość t, od posadzki do `top`. */
function wall(Q, a, b, { top = WALL, t = 60, base = FLOOR, mat = M.steel, cap = M.pale } = {}) {
  Q.seg(a, b, (base + top - 8) / 2, top - 8 - base, t, mat, 1.0);
  Q.seg(a, b, top - 4, 8, t + 8, cap, 1.0);
}
/** Niebieski blok (jak bloki bram na obrazie-wzorze): okuwa mur co kawałek i w narożnikach. */
function blueBlock(Q, p, dx = 1, dz = 0, len = 170, wid = 96, top = WALL + 14) {
  Q.box(p, (FLOOR + top) / 2, len, top - FLOOR, wid, M.teal, dx, dz);
  Q.box(p, top + 3, len * 0.8, 6, wid * 0.7, M.rail, dx, dz);
}
/** Mur z niebieskimi blokami co `pitch`. */
function wallRun(Q, a, b, o = {}) {
  wall(Q, a, b, o);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.floor(len / (o.pitch || 1500));
  const dx = (b[0] - a[0]) / len;
  const dz = (b[1] - a[1]) / len;
  for (let i = 1; i <= n; i++) { const k = i / (n + 1); blueBlock(Q, [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], dx, dz); }
}
/** Samotok: łoże, burty i rolki co `pitch`. */
function rollerTable(Q, a, b, { y = FLOOR, wid = 130, pitch = 56, side = M.rail } = {}) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1) return;
  const dx = (b[0] - a[0]) / len;
  const dz = (b[1] - a[1]) / len;
  Q.seg(a, b, y + 3, 6, wid + 24, M.dark, 1.0);
  for (const o of [-1, 1]) Q.seg([a[0] - dz * o * (wid / 2 + 6), a[1] + dx * o * (wid / 2 + 6)], [b[0] - dz * o * (wid / 2 + 6), b[1] + dx * o * (wid / 2 + 6)], y + 10, 12, 8, side, 1.0);
  const n = Math.max(1, Math.floor(len / pitch));
  for (let i = 0; i < n; i++) { const k = (i + 0.5) / n; Q.box([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], y + 9, 10, 6, wid, M.rail, dx, dz); }
}
/** Chłodnia: skrzynia z czarną kratą i wentylatorami (obraz-wzór: baterie po bokach zakładu). */
function cooler(Q, f, x, z, w, d, seed = 0) {
  Q.box([x, z], FLOOR + 45, w, 90, d, M.steel);
  Q.box([x, z], FLOOR + 93, w - 22, 6, d - 22, M.black);
  const n = Math.max(2, Math.round(w / 110));
  for (let i = 0; i < n; i++) Q.box([x - w / 2 + (w * (i + 0.5)) / n, z], FLOOR + 98, 6, 6, d - 26, M.rail);
  for (const o of [-1, 1]) Q.box([x, z + o * (d / 2 - 6)], FLOOR + 100, w, 10, 12, M.rail);
  const fans = Math.max(1, Math.round(w / 200));
  for (let i = 0; i < fans; i++) Q.cyl([x - w / 2 + (w * (i + 0.5)) / fans, z + (pbHash1(seed + i) > 0.5 ? 0.18 : -0.18) * d], FLOOR + 102, Math.min(d, w / fans) * 0.26, 8, M.dark);
}
/** Gruba rura po łamanej (pozioma), z kolanami i obejmami. */
function pipeLine(Q, pts, y, r, mat = M.steel) {
  for (let i = 0; i + 1 < pts.length; i++) {
    Q.pipe(pts[i], pts[i + 1], y, r, mat);
    Q.cyl(pts[i + 1], y, r * 1.12, r * 2.1, mat);
    const m = [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2];
    const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    Q.box(m, y, r * 0.5, r * 2.3, r * 2.3, M.rail, (pts[i + 1][0] - pts[i][0]) / len, (pts[i + 1][1] - pts[i][1]) / len);
  }
}
/** Galeria przenośnika po ścieżce z wysokością: koryto, burty, podpory. */
function gallery(Q, path, { wid = 66, mat = M.steel } = {}) {
  const pts = path.points;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1) continue;
    Q.beam(a, a[2] - 12, b, b[2] - 12, wid, mat);
    Q.beam(a, a[2] - 3, b, b[2] - 3, wid * 0.62, M.black);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = -(b[1] - a[1]) / len;
    const nz = (b[0] - a[0]) / len;
    for (const o of [-1, 1]) Q.beam([a[0] + nx * o * (wid / 2), a[1] + nz * o * (wid / 2)], a[2] + 6, [b[0] + nx * o * (wid / 2), b[1] + nz * o * (wid / 2)], b[2] + 6, 8, M.yellow);
    if (b[2] > 90) { const h = b[2] - 20 - FLOOR; Q.box([b[0], b[1]], FLOOR + h / 2, 26, h, 26, mat); }
  }
}

// ---------------------------------------------------------------------------
// Rzędy przy drodze i bramy ciężarówek

export function buildHutaRowsScene(layout, style, { occupied = new Set() } = {}) {
  const { f, plates, labels, lamps, T } = newScene();
  const Hu = layout.huta;
  const status = [];
  bodies(T, f, layout, ['HI', 'HS'], { strip: M.warm });
  bodies(T, f, layout, ['HL', 'HR'], { strip: M.warm });
  for (const pit of layout.pits) {
    let sch = -1;
    if (pit.kind === 'drydock') { sch = status.length; status.push({ ch: sch, berthId: pit.berth.id }); }
    pitDetail(T, f, pit, { occupied: occupied.has(pit.berth.id), statusCh: sch, lamps: pit.kind === 'drydock' ? lamps : null });
  }
  // bramy: posadzka ulicy przez rząd, niebieskie bloki przy wlocie, światła biegnące ku zakładowi (wjazd) i ku drodze (wyjazd)
  for (const side of [-1, 1]) {
    const sg = side * Hu.gateS;
    const a = sg - Hu.gateHalf;
    const b = sg + Hu.gateHalf;
    T.sec(a, b, V.outer0 - 10, V.outer1, H.keel, FLOOR - H.keel, M.floor);
    T.hazardRad(a + 14, V.outer0 + 30, V.outer0 + 330, FLOOR + 2, 12);
    T.hazardRad(b - 14, V.outer0 + 30, V.outer0 + 330, FLOOR + 2, 12);
    for (const e of [a - 36, b + 36]) {
      T.box(e, V.outer0 + 60, (FLOOR + H.deck + 30) / 2, 96, H.deck + 30 - FLOOR, 150, M.teal);
      T.box(e, V.outer0 + 60, H.deck + 34, 76, 8, 120, M.rail);
    }
    const n = 14;
    for (let i = 0; i < n; i++) {
      const v = V.outer0 + 120 + ((V.outer1 - V.outer0 - 200) * i) / (n - 1);
      for (const e of [a + 26, b - 26]) T.lamp(e, v, FLOOR + 6, 12, side < 0 ? M.green : M.warm, 1.2, PB_FX.chase, side < 0 ? 1 - i / n : i / n, 1.0);
    }
    lintel(T, f, a - 60, V.outer0 + 110, b + 60, V.outer0 + 110, 80, [{ t0: 0.25, t1: 0.75, mat: side < 0 ? M.green : M.warm, gain: 1.1 }], 60 + side);
    T.label(side < 0 ? 'WJAZD' : 'WYJAZD', sg, V.outer0 + 560, 250, 76, style.labels.gate, 'HUTA · CIĘŻARÓWKI', FLOOR + 3);
  }
  for (const s of [-1900, 1900]) T.label('HUTA ZIEMI', s, 5850, 1500, 180, style.labels.hub, 'TERRA NOVA · STAL I STOPY');
  T.label('WYSYŁKA STATKAMI', 0, 6130, 900, 100, style.labels.clear);
  return sceneOf(f, plates, labels, lamps, { status });
}

// ---------------------------------------------------------------------------
// Zakład: plac wyrobów, hala walcowni, pętla kadzi, piece, ceramika

/**
 * `rig.cranes`: [{ bridge, trolley }] — grupy ruchome suwnic placu (most jedzie po x, wózek po x i z; położenie
 * wyjściowe: `home` suwnicy, środek rozpiętości).
 */
export function buildHutaPlantScene(layout, style) {
  const { f, plates, labels, lamps } = newScene();
  const Q = xzTools(f, plates, labels);
  const Hu = layout.huta;
  const Z = Hu.Z0;
  const PL = Hu.plant;
  const W = PL.halfW;
  const p = (x, pz) => [x, Z + pz];
  let group = 0;

  // --- podstawa: plac i część gorąca (posadzka), obrzeże
  Q.plate(rect(-W, Z + PL.top, W, Z + PL.hot[1]), H.keel, FLOOR - H.keel, M.floor);

  // --- mury: zachodni i wschodni, północny z bramami, między placem a częścią gorącą (z przejściami samotoków)
  wallRun(Q, p(-W + 30, 60), p(-W + 30, PL.hot[1]), {});
  wallRun(Q, p(W - 30, 60), p(W - 30, PL.hot[1]), {});
  const gx = PL.gateX;
  const gh = PL.gateW / 2 + 20;
  wallRun(Q, p(-W, 40), p(-gx - gh, 40), {});
  wallRun(Q, p(-gx + gh, 40), p(gx - gh, 40), { pitch: 1700 });
  wallRun(Q, p(gx + gh, 40), p(W, 40), {});
  for (const s of [-1, 1]) for (const o of [-1, 1]) blueBlock(Q, p(s * gx + o * gh, 40), 0, 1, 190, 100, WALL + 30);

  // --- PLAC WYROBÓW: pas ciężarówek, zatoki, tory suwnic, samotoki, kołyski regałów
  const laneZ = PL.laneZ;
  for (const o of [-62, 62]) for (let x = -gx + 260; x < gx - 260; x += 240) Q.box(p(x, laneZ + o), FLOOR + 1.6, 130, 1.6, 7, M.yellow);
  for (const s of [-1, 1]) Q.seg(p(s * gx, 70), p(s * gx, laneZ - 80), FLOOR + 1.6, 1.6, 7, M.yellow);
  for (const R of Hu.racks) {
    const sx = R.stop.x;
    Q.box(p(sx, PL.bayZ), FLOOR + 1.2, 560, 1.2, 126, M.dark);
    for (const o of [-1, 1]) Q.box(p(sx, PL.bayZ + o * 66), FLOOR + 2, 560, 2, 7, M.yellow);
    for (const e of [-290, 290]) Q.box(p(sx + e, PL.bayZ), FLOOR + 2, 7, 2, 126, M.yellow);
    f.fx(1.15, PB_FX.blink, R.lane * 0.2, 0.4);
    for (const e of [-300, 300]) Q.box(p(sx + e, PL.bayZ + 78), FLOOR + 8, 14, 8, 14, M.warm);
    f.nofx();
    // kołyski pod wyroby
    for (const s of R.slots) {
      Q.box([s.x, s.z], FLOOR + 2.5, 118, 5, 104, M.rail);
      for (const o of [-1, 1]) Q.box([s.x + o * 46, s.z], FLOOR + 7, 10, 6, 96, M.dark);
    }
    // obrzeże regału
    const z0 = Z + 480;
    const z1 = Z + 1030;
    for (const zz of [z0, z1]) Q.seg([R.x0 - 20, zz], [R.x1 + 20, zz], FLOOR + 4, 8, 12, M.yellow);
  }
  // samotoki placu: wzdłuż regałów (pz 1 090) i dojścia z hali
  const cz = Hu.convZ - Z;
  rollerTable(Q, p(Hu.xCoil + 80, cz), p(-4130, cz));
  rollerTable(Q, p(Hu.xStack + 80, cz), p(3040, cz));
  rollerTable(Q, p(3200, cz), p(4100, cz));
  rollerTable(Q, p(Hu.xCoil, 1330), p(Hu.xCoil, cz + 70));
  rollerTable(Q, p(Hu.xStack + 150, 1330), p(Hu.xStack + 150, cz + 70));
  rollerTable(Q, p(layout.huta.lanes[4].x, 1560), p(layout.huta.lanes[4].x, cz + 70));
  // tory suwnic bramowych i suwnice (grupy ruchome)
  const cranes = [];
  for (const C of Hu.cranes) {
    for (const zz of [C.z0, C.z1]) {
      Q.seg([C.x0 - 80, zz], [C.x1 + 80, zz], FLOOR + 5, 10, 16, M.rail);
      for (const e of [C.x0 - 90, C.x1 + 90]) Q.box([e, zz], FLOOR + 22, 30, 44, 44, M.yellow);
    }
    const mid = (C.z0 + C.z1) / 2;
    const span = C.z1 - C.z0;
    group++;
    const bridge = group;
    f.group = bridge;
    const yb = 330;
    for (const zz of [C.z0, C.z1]) {
      for (const e of [-70, 70]) Q.box([C.home + e, zz], (FLOOR + yb) / 2, 26, yb - FLOOR, 30, M.yellow);
      Q.box([C.home, zz], FLOOR + 26, 200, 40, 54, M.yellow);
      Q.box([C.home, zz], yb - 30, 190, 20, 26, M.yellow);
    }
    for (const e of [-52, 52]) Q.box([C.home + e, mid], yb + 14, 26, 44, span + 80, M.yellow);
    for (let i = 0; i <= 6; i++) Q.box([C.home, C.z0 + (span * i) / 6], yb + 24, 130, 10, 14, M.yellow);
    Q.box([C.home, C.z0 - 20], yb + 60, 110, 70, 90, M.steel);
    Q.box([C.home, C.z0 - 20], yb + 100, 90, 10, 70, M.pale);
    Q.lamp([C.home, C.z1 + 30], yb + 50, 16, M.warm, 1.5, PB_FX.blink, 0.3 * bridge, 0.9);
    Q.lamp([C.home, C.z0 - 70], yb + 50, 16, M.warm, 1.5, PB_FX.blink, 0.3 * bridge + 0.5, 0.9);
    group++;
    const trolley = group;
    f.group = trolley;
    Q.box([C.home, mid], yb + 46, 150, 26, 130, M.dark);
    Q.box([C.home, mid], yb + 66, 90, 18, 80, M.steel);
    Q.box([C.home + 40, mid + 30], yb + 82, 40, 14, 40, M.glass);
    f.fx(1.3, PB_FX.steady);
    for (const e of [-60, 60]) Q.box([C.home + e, mid], yb + 30, 12, 6, 12, M.white);
    f.nofx();
    f.group = 0;
    cranes.push({ bridge, trolley });
  }
  Q.label('PLAC WYROBÓW', p(0, 190), 1300, 110, style.labels.clear, 'ODBIÓR CIĘŻARÓWKAMI', FLOOR + 3);

  // --- HALA WALCOWNI: mury z przejściami, belki dachu, samotok, odlewnia, piec grzewczy, trzy klatki, zwijarka, układarka
  const HL = Hu.hall;
  const LN = Hu.line;
  const lz = LN.z - Z;
  const hx0 = HL.x0;
  const hx1 = HL.x1;
  const hz0 = HL.z0 - Z;
  const hz1 = HL.z1 - Z;
  Q.plate(rect(hx0, HL.z0, hx1, HL.z1), FLOOR, 3, M.deckPad);
  const HW = { top: 196, t: 54 };
  // północny mur z przejściami samotoków (zwijarka, układarka)
  let cur = hx0;
  for (const gap of [Hu.xCoil, Hu.xStack + 150]) { wallRun(Q, p(cur, hz0), p(gap - 100, hz0), HW); cur = gap + 100; }
  wallRun(Q, p(cur, hz0), p(hx1, hz0), HW);
  // południowy mur z wnęką kadzi przy odlewni
  wallRun(Q, p(hx0, hz1), p(Hu.caster.x - 150, hz1), HW);
  wallRun(Q, p(Hu.caster.x + 150, hz1), p(hx1, hz1), HW);
  wall(Q, p(hx0, hz0), p(hx0, hz1), HW);
  wall(Q, p(hx1, hz0), p(hx1, hz1), HW);
  for (const [x, z] of [[hx0, hz0], [hx0, hz1], [hx1, hz0], [hx1, hz1]]) blueBlock(Q, p(x, z), 1, 0, 120, 120, HW.top + 16);
  // belki dachu (hala bez pokrycia — widać linię) i lampy
  for (let x = hx0 + 400; x < hx1 - 200; x += 520) {
    Q.box(p(x, (hz0 + hz1) / 2), HW.top + 6, 14, 12, hz1 - hz0, M.rail);
    f.fx(1.2, PB_FX.steady);
    for (const o of [-1, 1]) Q.box(p(x, (hz0 + hz1) / 2 + o * 250), HW.top - 4, 22, 8, 22, M.warm);
    f.nofx();
  }
  // samotok linii
  rollerTable(Q, p(LN.x0 - 60, lz), p(LN.x0 + LN.end, lz), { wid: LN.width + 20, pitch: 50 });
  // odlewnia: kadź pośrednia we wnęce muru, wieża, łuk prowadzenia pasma, żółta brama
  const cx = Hu.caster.x;
  Q.box(p(cx, 2010), FLOOR + 60, 220, 120, 150, M.steel);
  Q.box(p(cx, 2010), FLOOR + 124, 190, 8, 120, M.dark);
  Q.box(p(cx, 1840), FLOOR + 110, 300, 220, 260, M.steel);
  Q.box(p(cx, 1840), FLOOR + 224, 260, 8, 220, M.rail);
  Q.box(p(cx + 40, 1700), FLOOR + 70, 330, 140, 200, M.dark);
  Q.box(p(cx + 100, 1650), FLOOR + 144, 180, 8, 150, M.rail);
  for (const o of [-1, 1]) Q.box(p(cx + o * 200, 1840), (FLOOR + 300) / 2, 34, 300 - FLOOR, 34, M.yellow);
  Q.box(p(cx, 1840), 300, 440, 30, 44, M.yellow);
  Q.label('ODLEWNIA', p(cx + 20, 1440), 420, 64, style.labels.clear, '', FLOOR + 5);
  // piec grzewczy: tunel z rusztem dachu (żar kęsiska widać w szczelinach)
  const r0 = LN.x0 + LN.reheat[0];
  const r1 = LN.x0 + LN.reheat[1];
  for (const o of [-1, 1]) Q.box(p((r0 + r1) / 2, lz + o * 110), FLOOR + 60, r1 - r0, 120, 60, M.steel);
  for (let x = r0 + 30; x < r1; x += 78) Q.box(p(x, lz), FLOOR + 124, 40, 10, 270, M.dark);
  for (const e of [r0 - 14, r1 + 14]) { Q.box(p(e, lz), FLOOR + 100, 28, 60, 290, M.yellow); }
  f.fx(1.25, PB_FX.steady);
  for (const o of [-1, 1]) Q.box(p((r0 + r1) / 2, lz + o * 78), FLOOR + 30, r1 - r0 - 20, 6, 6, M.warm);
  f.nofx();
  Q.label('PIEC GRZEWCZY', p((r0 + r1) / 2, 1440), 420, 64, style.labels.clear, '', FLOOR + 5);
  // klatki walcownicze: stojaki po obu stronach, walce nad samotokiem, napęd w niebieskiej obudowie
  LN.stands.forEach((u, i) => {
    const x = LN.x0 + u;
    for (const o of [-1, 1]) {
      Q.box(p(x, lz + o * 128), FLOOR + 110, 190, 220, 86, M.steel);
      Q.box(p(x, lz + o * 128), FLOOR + 224, 170, 8, 70, M.rail);
      Q.box(p(x, lz + o * 128), FLOOR + 236, 110, 16, 50, M.yellow);
    }
    for (const e of [-44, 44]) Q.pipe(p(x + e, lz - 90), p(x + e, lz + 90), FLOOR + 96, 34, M.rail);
    for (const e of [-70, 70]) Q.box(p(x + e, lz), FLOOR + 214, 16, 20, 190, M.dark);
    Q.box(p(x, lz + 250), FLOOR + 60, 150, 120, 130, M.teal);
    Q.box(p(x, lz + 250), FLOOR + 124, 120, 8, 100, M.rail);
    Q.pipe(p(x, lz + 170), p(x, lz + 190), FLOOR + 96, 22, M.dark);
    Q.label(`KLATKA ${i + 1}`, p(x, 1440), 300, 56, style.labels.clear, '', FLOOR + 5);
    addLamp(lamps, x, LN.z, 260, 1);
  });
  // chłodzenie pasma: kolektory wody nad samotokiem
  for (let x = LN.x0 + LN.stands[2] + 500; x < LN.x0 + LN.coiler - 300; x += 190) {
    Q.pipe(p(x, lz - 110), p(x, lz + 110), FLOOR + 80, 9, M.teal);
    for (const o of [-1, 1]) Q.box(p(x, lz + o * 112), FLOOR + 44, 16, 80, 16, M.teal);
  }
  // zwijarka i układarka blach
  Q.box(p(Hu.xCoil, lz), FLOOR + 8, 190, 16, 190, M.dark);
  for (const o of [-1, 1]) Q.box(p(Hu.xCoil + o * 108, lz + 70), FLOOR + 50, 26, 100, 60, M.yellow);
  Q.box(p(Hu.xStack, lz), FLOOR + 8, 300, 16, 170, M.dark);
  for (const o of [-1, 1]) Q.box(p(Hu.xStack + o * 160, lz), FLOOR + 40, 20, 80, 190, M.yellow);
  Q.label('ZWIJARKA', p(Hu.xCoil - 20, 1880), 300, 56, style.labels.clear, '', FLOOR + 5);
  Q.label('WALCOWNIA', p(-1000, 1880), 1000, 100, style.labels.berthLead, 'ODLEWNIA → PIEC GRZEWCZY → TRZY KLATKI → ZWIJARKA', FLOOR + 5);

  // --- pętla kadzi: podtorze i szyny po ścieżce
  const lp = Hu.loop.points;
  for (let i = 0; i + 1 < lp.length; i++) {
    const a = lp[i];
    const b = lp[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.5) continue;
    Q.seg(a, b, FLOOR + 2.5, 5, 150, M.dark, 1.04);
    const nx = -(b[1] - a[1]) / len;
    const nz = (b[0] - a[0]) / len;
    for (const o of [-1, 1]) Q.seg([a[0] + nx * o * 52, a[1] + nz * o * 52], [b[0] + nx * o * 52, b[1] + nz * o * 52], FLOOR + 8, 8, 9, M.rail, 1.04);
  }
  for (let x = -4200; x < 2500; x += 300) Q.box(p(x, 2290), FLOOR + 3, 60, 3, 8, M.yellow);
  Q.label('TOR KADZI', p(900, 2290), 620, 60, style.labels.clear, 'PEŁNE KU ODLEWNI · PUSTE WRACAJĄ', FLOOR + 3);

  // --- piece: ośmiokątny płaszcz, wymurówka, pomost zasypowy, rynna spustowa, nagrzewnice i rury
  const OCT = Math.tan(Math.PI / 8);
  Hu.lanes.slice(0, 4).forEach((L, i) => {
    const F = L.furnace;
    const ro = F.r;
    const ri = F.pool + 22;
    const mid = (ro + ri) / 2;
    const side = 2 * ro * OCT;
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const c = [F.x + Math.cos(a) * mid, F.z + Math.sin(a) * mid];
      const top = 300 - (k % 2) * 4;
      // ściana: długość po stycznej
      Q.box(c, (FLOOR + top) / 2, side + 2, top - FLOOR, ro - ri, M.steel, -Math.sin(a), Math.cos(a));
      Q.box(c, top + 3, side - 30, 6, ro - ri - 34, M.pale, -Math.sin(a), Math.cos(a));
      Q.box([F.x + Math.cos(a) * (ro - 6), F.z + Math.sin(a) * (ro - 6)], top + 12, side - 10, 12, 7, M.yellow, -Math.sin(a), Math.cos(a));
      // narożne przypory
      const av = a + Math.PI / 8;
      const rv = ro / Math.cos(Math.PI / 8);
      Q.box([F.x + Math.cos(av) * (rv - 26), F.z + Math.sin(av) * (rv - 26)], (FLOOR + 250) / 2, 120, 250 - FLOOR, 120, M.steel, Math.cos(av), Math.sin(av));
      Q.box([F.x + Math.cos(av) * (rv - 26), F.z + Math.sin(av) * (rv - 26)], 254, 96, 8, 96, M.rail, Math.cos(av), Math.sin(av));
    }
    // trzon i wymurówka
    Q.cyl([F.x, F.z], (FLOOR + 150) / 2, ri + 6, 150 - FLOOR, M.dark);
    f.ring(F.x, 286, F.z, F.pool + 12, 0, M.orange, [Math.PI / 2, 0, 0]);
    f.ring(F.x, 240, F.z, F.pool + 4, 0, M.copper, [Math.PI / 2, 0, 0]);
    // pomost zasypowy nad piecem (jak na obrazie-wzorze): dwie belki i głowica
    for (const e of [-46, 46]) Q.box([F.x + e, F.z + 40], 356, 22, 30, 2 * ro + 160, M.yellow);
    for (let k = -3; k <= 3; k++) Q.box([F.x, F.z + 40 + k * 110], 364, 110, 8, 14, M.yellow);
    Q.box([F.x, F.z + 30], 372, 130, 44, 150, M.dark);
    Q.box([F.x, F.z + 30], 398, 96, 10, 110, M.rail);
    for (const o of [-1, 1]) Q.box([F.x, F.z + 40 + o * (ro + 70)], (FLOOR + 340) / 2, 120, 340 - FLOOR, 40, M.yellow);
    Q.lamp([F.x, F.z + 30], 408, 18, M.red, 1.7, PB_FX.blink, i * 0.23, 0.5);
    // rynna spustowa do toru kadzi
    const [ra, rb] = L.runner;
    Q.seg(ra, [rb[0], rb[1] - 10], FLOOR + 76, 40, 84, M.dark);
    for (const o of [-1, 1]) Q.seg([ra[0] + o * 36, ra[1]], [rb[0] + o * 36, rb[1] - 10], FLOOR + 102, 14, 12, M.steel);
    Q.box([F.x, ra[1] + 20], FLOOR + 140, 150, 90, 70, M.steel);
    // nagrzewnice i odpylnik po stronie wschodniej, rury do płaszcza
    for (let k = 0; k < 3; k++) {
      const c = [F.x + 580, F.z - 250 + k * 190];
      Q.cyl(c, (FLOOR + 330) / 2, 78, 330 - FLOOR, M.steel);
      Q.cyl(c, 336, 84, 12, M.rail);
      Q.cyl(c, 356, 50, 30, M.pale);
    }
    pipeLine(Q, [[F.x + 580, F.z - 250], [F.x + 580, F.z - 400], [F.x + 300, F.z - 400]], 200, 34);
    Q.cyl([F.x + 600, F.z + 380], (FLOOR + 400) / 2, 40, 400 - FLOOR, M.dark);
    Q.lamp([F.x + 600, F.z + 380], 406, 16, M.red, 1.7, PB_FX.blink, 0.4 + i * 0.17, 0.5);
    // galeria przenośnika zasypowego
    gallery(Q, L.feed);
    Q.label(`PIEC ${i + 1} · ${L.name}`, [F.x - 40, F.z - 560], 560, 80, style.labels.berthLead, '', FLOOR + 3);
    addLamp(lamps, F.x, F.z, 330, 1);
  });
  // wlewki glinu do pieca tytanu i przenośnik rudy glinu do ceramiki
  gallery(Q, Hu.ingotFeed, { wid: 54 });
  gallery(Q, Hu.cross, { wid: 60 });
  Q.box([Hu.ingots.x, Hu.ingots.z], FLOOR + 5, 220, 10, 300, M.dark);
  Q.label('WLEWKI GLINU', [Hu.ingots.x + 30, Hu.ingots.z + 230], 300, 50, style.labels.clear, 'DO STOPU TYTANU', FLOOR + 3);

  // --- chłodnie i rury: bateria zachodnia przy piecu stali, pole chłodni na wschód od hali
  for (let k = 0; k < 4; k++) cooler(Q, f, -W + 190, Z + 2620 + k * 270, 240, 230, k);
  pipeLine(Q, [p(-W + 190, 2480), p(-W + 190, 2560)], 110, 46);
  pipeLine(Q, [p(-W + 330, 2700), p(-W + 520, 2700), p(-W + 520, 3050), p(-W + 590, 3050)], 150, 52);
  pipeLine(Q, [p(-W + 330, 3240), p(-W + 470, 3240), p(-W + 470, 3420), p(-4010, 3420)], 120, 44, M.pale);
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) cooler(Q, f, 2150 + c * 470, Z + 1500 + r * 380, 420, 320, r * 3 + c + 9);
  pipeLine(Q, [p(1950, 2080), p(3330, 2080)], 130, 50);
  pipeLine(Q, [p(1950, 1320), p(1950, 2080)], 130, 40, M.pale);
  Q.label('CHŁODNIE', p(2620, 1260), 560, 64, style.labels.clear, '', FLOOR + 3);
  // rozdzielnia i warsztaty w wolnych miejscach części gorącej
  for (const [x, pz, w, d, h] of [[2760, 3040, 420, 520, 150], [3250, 2560, 300, 380, 110], [-2800, 3450, 380, 200, 100], [-940, 3450, 380, 200, 100], [940, 3450, 300, 200, 100]]) {
    Q.box(p(x, pz), FLOOR + h / 2, w, h, d, M.steel);
    Q.box(p(x, pz), FLOOR + h + 4, w - 40, 8, d - 40, M.pale);
    Q.box(p(x - w * 0.2, pz), FLOOR + h + 16, w * 0.3, 16, d * 0.4, M.dark);
  }

  // --- ceramika: mieszalnia z prasą, piec tunelowy ku placowi, kominy
  const K = Hu.lanes[4].kiln;
  Q.box([K.x, K.mixer.z], FLOOR + 110, 330, 220, 250, M.steel);
  Q.box([K.x, K.mixer.z], FLOOR + 224, 290, 8, 210, M.rail);
  Q.cyl([K.x - 60, K.mixer.z + 20], FLOOR + 262, 70, 70, M.pale);
  Q.cyl([K.x + 70, K.mixer.z - 30], FLOOR + 252, 54, 50, M.pale);
  Q.box([K.x, K.z0 + 60], FLOOR + 60, 240, 120, 130, M.dark);
  for (const o of [-1, 1]) Q.box([K.x + o * (K.width / 2 + 24), (K.z0 + K.z1) / 2], FLOOR + 60, 48, 120, K.z0 - K.z1, M.steel);
  for (let z = K.z1 + 60; z < K.z0; z += 150) Q.box([K.x, z], FLOOR + 124, K.width + 100, 10, 84, M.dark);
  for (const e of [K.z1 - 16, K.z0 + 16]) Q.box([K.x, e], FLOOR + 100, K.width + 110, 60, 30, M.yellow);
  f.fx(1.2, PB_FX.steady);
  for (const o of [-1, 1]) Q.box([K.x + o * (K.width / 2 - 4), (K.z0 + K.z1) / 2], FLOOR + 30, 6, 6, K.z0 - K.z1 - 40, M.warm);
  f.nofx();
  for (const zq of [0.3, 0.62]) {
    const c = [K.x + K.width / 2 + 120, K.z0 + (K.z1 - K.z0) * zq];
    Q.cyl(c, (FLOOR + 380) / 2, 46, 380 - FLOOR, M.steel);
    Q.cyl(c, 384, 52, 10, M.rail);
    Q.lamp(c, 394, 16, M.red, 1.7, PB_FX.blink, zq, 0.5);
  }
  gallery(Q, Hu.lanes[4].feed);
  Q.label('PIEC TUNELOWY · CERAMIKA', [K.x - K.width / 2 - 150, (K.z0 + K.z1) / 2], 900, 70, style.labels.berthLead, '', FLOOR + 3, 'bg', 0, 1);
  addLamp(lamps, cx, Z + 1840, 300, 1);

  if (group + 1 > PB_MAX_GROUPS) throw new Error(`huta, zakład: ${group} grup`);
  return sceneOf(f, plates, labels, lamps, { cranes });
}

// ---------------------------------------------------------------------------
// Nabrzeże rudy: zasieki, nabrzeże, pirsy, odkurzacze

/**
 * `rig.vacs`: [{ gantry, trolley }] — grupy ruchome odkurzacza toru: suwnica jedzie po pirsie (z), wózek ssawy po
 * wysięgniku (x) i razem z suwnicą (z). Położenie wyjściowe: `lane.gantry.park`, wózek 280 j. od osi statku.
 */
export function buildHutaDockScene(layout, style) {
  const { f, plates, labels, lamps } = newScene();
  const Q = xzTools(f, plates, labels);
  const Hu = layout.huta;
  const Z = Hu.Z0;
  const PL = Hu.plant;
  const W = PL.halfW;
  const b0 = Z + PL.bunk[0];
  const b1 = Z + PL.bunk[1];
  const q1 = Z + PL.depth;
  let group = 0;
  const vacs = [];

  // podstawa: dno zasieków (zagłębione), nabrzeże
  Q.plate(rect(-W, b0, W, b1), H.keel, 110, M.deckPad);
  Q.plate(rect(-W, b1, W, q1), H.keel, FLOOR - H.keel, M.floor);
  // mury zasieków: od części gorącej, od nabrzeża, boczne i działowe
  const BW = { top: WALL, t: 60, base: -60 };
  wallRun(Q, [-W, b0 + 30], [W, b0 + 30], { ...BW, pitch: 1880 });
  wallRun(Q, [-W, b1 - 30], [W, b1 - 30], { ...BW, pitch: 1880 });
  for (const x of [-W + 30, W - 30]) wall(Q, [x, b0], [x, b1], BW);
  for (let i = 0; i < Hu.lanes.length - 1; i++) { const x = (Hu.lanes[i].x + Hu.lanes[i + 1].x) / 2; wall(Q, [x, b0 + 60], [x, b1 - 60], BW); }

  Hu.lanes.forEach((L, i) => {
    const B = L.bunker;
    // krata nad lejem przenośnika (pod kopcem) i tablica toru na nabrzeżu
    Q.box([L.x - 560, Z + 4000], B.floor + 6, 150, 12, 150, M.rail);
    Q.label(L.oreName, [L.x - 250, b1 + 150], 760, 96, style.labels.berthLead, `TOR ${i + 1} · ${L.name}`, FLOOR + 3);
    // stacja dmuchawy na nabrzeżu: budynek, cyklon, rura z pirsu, kanał wyrzutowy nad mur zasieku
    const bl = L.blower;
    Q.box([bl.x, bl.z], FLOOR + 110, 250, 220, 230, M.steel);
    Q.box([bl.x, bl.z], FLOOR + 224, 214, 8, 194, M.rail);
    Q.cyl([bl.x + 40, bl.z + 20], FLOOR + 280, 74, 110, M.pale);
    Q.cyl([bl.x + 40, bl.z + 20], FLOOR + 340, 30, 20, M.dark);
    Q.beam([bl.x - 40, bl.z - 60], 250, [L.spout.x + 20, L.spout.z + 40], L.spout.y + 20, 96, M.steel);
    Q.beam([L.spout.x + 20, L.spout.z + 40], L.spout.y + 20, [L.spout.x - 20, L.spout.z - 50], L.spout.y - 10, 104, M.dark);
    for (const o of [-1, 1]) Q.box([L.spout.x + 20 + o * 70, L.spout.z + 60], (FLOOR + 290) / 2, 20, 290 - FLOOR, 20, M.yellow);
    Q.lamp([bl.x - 90, bl.z + 100], FLOOR + 236, 16, M.warm, 1.4, PB_FX.blink, i * 0.21, 0.7);
    // pirs: korpus, tory suwnicy, rura ssąca wzdłuż pirsu, światło końca
    const P = L.pier;
    const px = (P.x0 + P.x1) / 2;
    Q.plate(rect(P.x0, P.z0 - 20, P.x1, P.z1), H.keel, WALL - H.keel, M.dark);
    Q.box([px, (P.z0 + P.z1) / 2], WALL + 2, P.x1 - P.x0 - 16, 4, P.z1 - P.z0 - 20, M.steel);
    for (const o of [-1, 1]) Q.box([px + o * 52, (P.z0 + P.z1) / 2], WALL + 8, 9, 10, P.z1 - P.z0 - 60, M.rail);
    Q.pipe([px, P.z0 - 60], [px, P.z1 - 120], WALL + 40, 30, M.hose);
    for (let z = P.z0 + 200; z < P.z1 - 150; z += 320) Q.box([px, z], WALL + 40, 80, 70, 22, M.rail);
    Q.lamp([px, P.z1 - 40], WALL + 30, 22, M.red, 1.8, PB_FX.blink, i * 0.13, 0.5);
    for (let k = 0; k < 7; k++) Q.lamp([P.x0 - 4, P.z0 + 150 + k * 280], WALL - 20, 12, M.cyan, 1.2, PB_FX.chase, 1 - k / 7, 0.7);
    // odkurzacz: suwnica bramowa nad pirsem z wysięgnikiem nad ładownię (FG — nad statkiem)
    f.set = 'fg';
    group++;
    const gantry = group;
    f.group = gantry;
    const gz = L.gantry.park;
    const yb = 430;
    for (const o of [-1, 1]) for (const e of [-90, 90]) Q.box([px + o * 60, gz + e], (WALL + yb) / 2, 22, yb - WALL, 26, M.yellow);
    for (const e of [-90, 90]) Q.box([px, gz + e], yb - 8, 150, 20, 30, M.yellow);
    for (const e of [-34, 34]) Q.box([(L.x - 230 + px + 70) / 2, gz + e], yb + 16, px + 70 - (L.x - 230), 32, 20, M.yellow);
    for (let x = L.x - 200; x < px; x += 120) Q.box([x, gz], yb + 30, 12, 8, 80, M.yellow);
    Q.box([px + 10, gz], yb + 62, 170, 70, 210, M.steel);
    Q.box([px + 10, gz], yb + 102, 140, 10, 180, M.pale);
    Q.pipe([L.x - 200, gz], [px - 40, gz], yb + 2, 26, M.hose);
    Q.beam([px, gz], yb + 150, [L.x - 220, gz], yb + 34, 10, M.rail);
    Q.box([px, gz], yb + 124, 22, 60, 22, M.yellow);
    Q.lamp([L.x - 226, gz], yb + 38, 16, M.red, 1.7, PB_FX.blink, i * 0.31, 0.5);
    Q.lamp([px + 10, gz - 96], yb + 112, 14, M.white, 1.4, PB_FX.blink, i * 0.19 + 0.4, 1.3);
    group++;
    const trolley = group;
    f.group = trolley;
    Q.box([L.x + 280, gz], yb + 40, 110, 26, 120, M.dark);
    Q.box([L.x + 280, gz], yb + 60, 70, 16, 80, M.steel);
    Q.cyl([L.x + 280, gz], yb - 60, 34, 160, M.hose);
    Q.cyl([L.x + 280, gz], yb - 140, 40, 14, M.rail);
    f.fx(1.3, PB_FX.steady);
    for (const e of [-48, 48]) Q.box([L.x + 280 + e, gz], yb + 24, 10, 6, 10, M.white);
    f.nofx();
    f.group = 0;
    f.set = 'bg';
    vacs.push({ gantry, trolley });
    if (i % 2 === 0) addLamp(lamps, L.mound.x, L.mound.z, 320, 2);
  });
  // nabrzeże: odbojnice, pachoły, światła krawędzi
  for (let x = -W + 60; x < W; x += 210) Q.box([x, q1 - 8], FLOOR - 30, 150, 80, 16, M.black);
  for (let x = -W + 120; x < W; x += 470) Q.cyl([x, q1 - 60], FLOOR + 16, 20, 32, M.yellow);
  const n = 44;
  for (let k = 0; k <= n; k++) Q.lamp([-W + 60 + ((2 * W - 120) * k) / n, q1 - 28], FLOOR + 5, 12, M.warm, 1.15, PB_FX.chase, (k / n) * 6 % 1, 0.6);
  Q.label('NABRZEŻE RUDY', [0, q1 - 130], 1500, 120, style.labels.hub, 'ODKURZACZE WYSYSAJĄ ŁADOWNIE · KAŻDA RUDA MA SWÓJ ZASIEK');
  if (group + 1 > PB_MAX_GROUPS) throw new Error(`huta, nabrzeże: ${group} grup`);
  return sceneOf(f, plates, labels, lamps, { vacs });
}
