// src/3d/ships3d/ships/atlasHull3D.js
//
// MODEL 3D KADŁUBA ATLASA — z obrysu i rysunku sprite'a gry (assets/capital_ship_rect_v1.png,
// 3747 × 1677 px), gniazd z edytora (ATLAS_EDITOR_DEFAULTS) i mostków gry (bridge3DShapes.js).
// Demo: dema/atlas3d-webgpu.html, opis: docs/webgpu/DEMO-ATLAS-3D.md.
//
// UKŁAD: jak warstwa 3D gry (Core3D) — X ku dziobowi, Y = −y obrazka (górna połowa sprite'a
// to +Y), Z w górę (ku kamerze gry). Projekt w PIKSELACH sprite'a (środek płótna = 0, te same
// liczby co markery edytora), wynik w jednostkach świata: × ATLAS3D_SCALE (1800 j. na
// dłuższy bok płótna, jak getHullRenderSize('atlas') — kadłub zajmuje w grze to samo miejsce).
//
// Z góry model wygląda jak sprite: dachy wszystkich brył mają materiał POKŁADU (rzut
// tekstury sprite'a z góry), bryły tylko podnoszą albo obniżają fragmenty rysunku.
// Burty, fazy, kil i detale — paleta (SHIP3D_MAT, shipMaterials3D.tsl.js).

import { MeshBuilder3D, SHIP3D_MAT as M, mirrorHalf, octPoly, rectPoly, pointInPoly, ensureCCW } from '../meshBuilder3D.js';
import { ATLAS_EDITOR_DEFAULTS } from '../../../data/atlasHardpointDefaults.js';
import { buildBridgeModel, BRIDGE3D_MAT, BRIDGE3D_EMIT } from '../../../3d/bridge3DShapes.js';

export const ATLAS3D_SPRITE = Object.freeze({ width: 3747, height: 1677 });
/** Jednostki świata na piksel sprite'a (1800 / 3747). */
export const ATLAS3D_SCALE = 1800 / 3747;

// ---------------------------------------------------------------------------
// Obrys (px sprite'a, górna połowa, y ≥ 0) — z kanału alfa: profil kolumn symetrycznej
// maski, Douglas–Peucker 2,2 px, płetwy startowe wycięte (osobne bryły), drobne ząbki
// krawędzi wygładzone. Od rufy (−1751) do cięcia wideł (x = 815).
// ---------------------------------------------------------------------------

const HULL_HALF = [
  [-1751, 0], [-1750, 65], [-1715, 95], [-1703, 96], [-1692, 186], [-1680, 213], [-1669, 218],
  [-1667, 268], [-1635, 347], [-1624, 352], [-1565, 353], [-1562, 407], [-1518, 469],
  [-1374, 478], [-1353, 474], [-1314, 406], [-1311, 352], [-1284, 352], [-1282, 425], [-1278, 441],
  [-1146, 618], [-579, 618], [-489, 526], [-444, 500], [-442, 477], [-383, 417], [-351, 416],
  [-349, 456], [-287, 503], [-165, 493], [-80, 494], [-72, 446], [230, 423], [235, 399],
  [242, 387], [351, 383], [364, 379], [368, 372], [410, 370], [418, 375], [458, 426],
  [546, 428], [547, 422], [556, 420], [689, 409], [729, 358], [738, 351], [764, 352], [815, 346]
];

// Widły dziobowe (górna): krawędź zewnętrzna od cięcia do czubka, wewnętrzna (szczelina
// działa osiowego) od czubka do rozwidlenia.
const PRONG_OUTER = [
  [815, 346], [839, 343], [859, 338], [864, 330], [876, 327], [1275, 269], [1298, 267], [1309, 276],
  [1429, 262], [1447, 248], [1617, 218], [1658, 203], [1714, 136], [1741, 121], [1758, 94], [1786, 50]
];
const PRONG_INNER = [[1787, 46], [1778, 38], [1745, 33], [934, 32], [906, 30], [878, 23], [843, 6], [815, 0]];

const X_CUT = 815;
const X_TIP = 1787;

// Płetwy startowe (szyny myśliwców; u nasady hangary), górna połowa. Nasada wchodzi w kadłub.
const FINS = [
  { poly: [[-158, 470], [-76, 470], [-78, 494], [-88, 582], [-137, 582], [-156, 494]], hangar: [-117, 494], w: 64 },
  { poly: [[138, 412], [231, 408], [229, 423], [215, 561], [170, 562], [140, 429]], hangar: [185, 425], w: 70 },
  { poly: [[458, 410], [548, 410], [545, 428], [535, 537], [490, 538], [460, 427]], hangar: [506, 427], w: 66 }
];

// ---------------------------------------------------------------------------
// Wysokości (px)
// ---------------------------------------------------------------------------

export const ATLAS3D_Z = Object.freeze({
  belt: -40,      // pas burtowy: dół płyty pokładu, początek kila
  deck: 48,       // pokład główny
  tipDeck: 24,    // pokład na czubkach wideł
  tipBelt: -16,
  citadel: 104,   // podniesiony pokład cytadeli
  waist: 78,      // podniesiony pokład śródokręcia
  engines: 118,   // bloki silnikowe rufy
  stern: 124,     // kwadratowa platforma rufowa (wieża główna w osi)
  spine: 120      // kręgosłup Hexlance'a (średnio)
});
const Z = ATLAS3D_Z;

// Kil kadłuba: głębokość (z) liniowo między punktami x; przekrój zwężony do KEEL_S szerokości.
const KEEL_X = [-1751, -1560, -1290, -560, -300, 300, X_CUT];
const KEEL_Z = [-130, -178, -218, -230, -202, -156, -100];
const KEEL_S = 0.62;
const keelZ = (x) => {
  if (x <= KEEL_X[0]) return KEEL_Z[0];
  for (let i = 1; i < KEEL_X.length; i++) {
    if (x <= KEEL_X[i]) {
      const t = (x - KEEL_X[i - 1]) / (KEEL_X[i] - KEEL_X[i - 1]);
      return KEEL_Z[i - 1] + (KEEL_Z[i] - KEEL_Z[i - 1]) * t;
    }
  }
  return KEEL_Z[KEEL_Z.length - 1];
};

// Widły: pokład i pas pochyłe ku czubkom, kil płytszy.
const prongT = (x) => Math.min(1, Math.max(0, (x - X_CUT) / (X_TIP - X_CUT)));
const prongDeck = (x) => Z.deck + (Z.tipDeck - Z.deck) * prongT(x);
const prongBelt = (x) => Z.belt + (Z.tipBelt - Z.belt) * prongT(x);
const prongKeel = (x) => -100 + 84 * prongT(x);
const prongAxis = (x) => 185 + (45 - 185) * prongT(x);

// ---------------------------------------------------------------------------
// Pomocnicze wielokąty
// ---------------------------------------------------------------------------

function insertBreaks(line, xs) {
  const out = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const lo = Math.min(a[0], b[0]);
    const hi = Math.max(a[0], b[0]);
    const cuts = xs.filter((x) => x > lo + 1e-6 && x < hi - 1e-6).sort((p, q) => (b[0] > a[0] ? p - q : q - p));
    for (const x of cuts) {
      const t = (x - a[0]) / (b[0] - a[0]);
      out.push([x, a[1] + (b[1] - a[1]) * t]);
    }
    out.push(b);
  }
  return out;
}

/** Wielokąt przycięty do pasa xa ≤ x ≤ xb (Sutherland–Hodgman). */
function clipStrip(poly, xa, xb) {
  const clip = (P, keep, cross) => {
    const out = [];
    for (let i = 0; i < P.length; i++) {
      const a = P[i];
      const b = P[(i + 1) % P.length];
      const ka = keep(a); const kb = keep(b);
      if (ka) out.push(a);
      if (ka !== kb) out.push(cross(a, b));
    }
    return out;
  };
  const at = (xc) => (a, b) => { const t = (xc - a[0]) / (b[0] - a[0]); return [xc, a[1] + (b[1] - a[1]) * t]; };
  let P = clip(poly, (p) => p[0] >= xa, at(xa));
  if (P.length >= 3) P = clip(P, (p) => p[0] <= xb, at(xb));
  return P.length >= 3 ? P : null;
}

/** Półszerokość zewnętrznej krawędzi kadłuba w x (bez płetw). */
export function atlasEdgeHalfWidth(x) {
  const line = x <= X_CUT ? HULL_HALF : PRONG_OUTER;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    if (x >= Math.min(a[0], b[0]) && x <= Math.max(a[0], b[0]) && b[0] !== a[0]) {
      return a[1] + (b[1] - a[1]) * ((x - a[0]) / (b[0] - a[0]));
    }
  }
  return 0;
}

const BODY_POLY = mirrorHalf(HULL_HALF);
const PRONG_POLY = ensureCCW(PRONG_INNER.slice().reverse().concat(PRONG_OUTER.slice().reverse()).filter((p, i, arr) => {
  const q = arr[(i + arr.length - 1) % arr.length];
  return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6;
}));

// ---------------------------------------------------------------------------
// Bryły nadbudówek (px). full — wielokąt symetryczny (cały), side — górna połowa (lustro).
// ---------------------------------------------------------------------------

const CITADEL = mirrorHalf([[-1256, 0], [-1256, 372], [-1150, 452], [-1004, 452], [-766, 376], [-472, 376], [-338, 206], [-300, 0]]);
const WAIST = mirrorHalf([[-316, 0], [-316, 196], [-170, 322], [236, 322], [268, 296], [700, 262], [792, 150], [804, 0]]);

// Rufa: rdzeń silnika (oś), skrzydła silnikowe, moduły silnikowe burt, platforma wieży.
const STERN_CORE = rectPoly(-1751, -95, -1588, 95);
const STERN_WING = [[-1692, 95], [-1565, 95], [-1565, 353], [-1624, 352], [-1635, 347], [-1667, 268], [-1669, 218], [-1680, 213], [-1692, 186]];
const ENGINE_MODULE = [[-1565, 196], [-1300, 196], [-1300, 404], [-1314, 406], [-1353, 474], [-1374, 478], [-1518, 469], [-1562, 407], [-1565, 353]];
const RADIATOR = [[-1540, 366], [-1346, 366], [-1346, 404], [-1368, 452], [-1510, 456], [-1540, 410]];
const STERN_PLATFORM = octPoly(-1590, -122, -1352, 122, 26);

// Kręgosłup = działo osiowe Hexlance (kil ze sprite'a: moduły i korytarze od rufy do rozwidlenia).
const SPINE = [
  { poly: octPoly(-1352, -100, -1228, 100, 16), z1: 112, bevel: 8 },                                   // szyja
  { poly: octPoly(-1232, -118, -962, 118, 34), z1: 136, bevel: 10, pod: true },                        // gniazdo wyrzutni rufowej
  { poly: octPoly(-968, -58, -452, 58, 14), z1: 126, bevel: 10, rings: [-930, -470, 58] },             // korytarz pod mostkiem
  { poly: [[-452, -70], [-404, -96], [-232, -96], [-198, -62], [-198, 62], [-232, 96], [-404, 96], [-452, 70]], z1: 140, bevel: 10, pod: true }, // gniazdo Supernovej
  { poly: [[-202, -78], [-56, -50], [-56, 50], [-202, 78]], z1: 118, bevel: 8 },
  { poly: octPoly(-60, -48, 364, 48, 12), z1: 110, bevel: 9, rings: [-30, 340, 52] },                   // szyna akceleratora
  { poly: octPoly(360, -62, 506, 62, 18), z1: 122, bevel: 9, pod: true },                              // gniazdo wyrzutni dziobowej
  { poly: [[502, -42], [700, -40], [758, -30], [758, 30], [700, 40], [502, 42]], z1: 104, bevel: 8 }   // korytarz dziobowy (mostek zapasowy)
];

// Wyrzutnie pionowe (VLS) na cytadeli — rysunek sprite'a: 5 komór na burtę.
const VLS_X = [-951, -893, -835, -777, -719];

// Kopuły czujników ze sprite'a (poza gniazdami).
const DOMES = [[-1025, 290], [-485, 290], [-1405, 237], [1071, 265]];

// Typy gniazd → promień podstawy (pierścień barbety) w px sprite'a.
const MOUNT_RADIUS = { main: 34, special: 46, aux: 20, missile: 30, special_missile: 40, builtin: 0, hangar: 0 };

// ---------------------------------------------------------------------------
// Budowa
// ---------------------------------------------------------------------------

/**
 * Buduje model. Zwraca budowniczego (geometria) i dane: gniazda, dysze, światła, hangary,
 * wylot Hexlance'a — w jednostkach ŚWIATA (× ATLAS3D_SCALE), układ Core3D.
 * @param {object} [o]
 * @param {boolean} [o.bridges=true] mostki z gry (bridge3DShapes: atlas_main, atlas_backup)
 * @param {number} [o.bridgeZScale=2.6] podbicie wysokości mostków (w grze są płaskie — kamera z góry)
 * @param {boolean} [o.rcs=true] skrzynki dysz RCS w bryle (gra: false — modele dysz SIDE z partii)
 */
export function buildAtlasHull3D(o = {}) {
  const S = ATLAS3D_SCALE;
  const B = new MeshBuilder3D({ deck: ATLAS3D_SPRITE });
  const tops = []; // { poly, z | zOf } — dachy do wysokości gniazd

  const addTop = (poly, z, zOf = null) => tops.push({ poly: ensureCCW(poly), z, zOf });

  // --- 1. Płyta pokładu (sylwetka sprite'a) i widły -------------------------
  const breaks = KEEL_X.slice(1, -1);
  const halfB = insertBreaks(HULL_HALF, breaks);
  const bodyBelt = mirrorHalf(halfB);
  // Styk kadłuba z widłami (x = 815) bez fazy — pokład przechodzi w widły bez rowka.
  const atCut = (a, b) => Math.abs(a[0] - X_CUT) < 0.5 && Math.abs(b[0] - X_CUT) < 0.5;
  B.prism(bodyBelt, Z.belt, Z.deck, { bevel: [7, 7], flush: atCut, wallMat: M.PAINT, bevelMat: M.DECK, capMat: M.DECK });
  addTop(BODY_POLY, Z.deck);

  B.mirrorY(() => {
    B.prism(PRONG_POLY, 0, 0, {
      bevel: [6, 6], flush: atCut, wallMat: M.PAINT, bevelMat: M.DECK, capMat: M.DECK,
      zTop: (x) => prongDeck(x), zBottom: (x) => prongBelt(x)
    });
  });
  addTop(PRONG_POLY, 0, (x) => prongDeck(x));
  addTop(PRONG_POLY.map(([x, y]) => [x, -y]), 0, (x) => prongDeck(x));

  // --- 2. Kil: pochyłe burty dolne i dno z pasów (dno liniowe w x w każdym pasie) --
  const keelRing = bodyBelt.map(([x, y]) => [x, y * KEEL_S]);
  B.walls(keelRing, 0, bodyBelt, Z.belt, M.PANEL, { zOf0: (x) => keelZ(x) });
  for (let i = 0; i < KEEL_X.length - 1; i++) {
    const part = clipStrip(keelRing, KEEL_X[i], KEEL_X[i + 1]);
    if (part) B.poly(part, 0, M.DARK, false, (x) => keelZ(x));
  }
  B.mirrorY(() => {
    const belt = PRONG_POLY;
    const keel = belt.map(([x, y]) => [x, prongAxis(x) + (y - prongAxis(x)) * 0.55]);
    B.walls(keel, 0, belt, 0, M.PANEL, { zOf0: (x) => prongKeel(x), zOf1: (x) => prongBelt(x) });
    B.poly(keel, 0, M.DARK, false, (x) => prongKeel(x));
  });

  // --- 3. Cytadela i śródokręcie --------------------------------------------
  B.prism(CITADEL, Z.deck - 2, Z.citadel, { bevel: [10, 10], wallMat: M.PAINT, bevelMat: M.DECK, capMat: M.DECK });
  addTop(CITADEL, Z.citadel);
  B.prism(WAIST, Z.deck - 2, Z.waist, { bevel: [8, 8], wallMat: M.PAINT, bevelMat: M.DECK, capMat: M.DECK });
  addTop(WAIST, Z.waist);

  // --- 4. Rufa ----------------------------------------------------------------
  B.prism(STERN_CORE, Z.deck - 2, 132, { bevel: [12, 12], wallMat: M.PAINT, bevelMat: M.DECK, capMat: M.DECK });
  addTop(STERN_CORE, 132);
  B.mirrorY(() => {
    B.prism(STERN_WING, Z.deck - 2, 100, { bevel: [10, 10], wallMat: M.PAINT, bevelMat: M.DECK, capMat: M.DECK });
    B.prism(ENGINE_MODULE, Z.deck - 2, Z.engines, { bevel: [10, 10], wallMat: M.PAINT, bevelMat: M.DECK, capMat: M.DECK });
    B.prism(RADIATOR, Z.engines - 2, 146, { bevel: [6, 6], wallMat: M.PANEL, bevelMat: M.DECK, capMat: M.DECK });
    // Żebra radiatora (pionowe płetwy na dachu bloku).
    for (let k = 0; k < 4; k++) {
      const x = -1512 + k * 44;
      B.box(x, 410, 154, 30, 70, 16, { mat: M.DARK, bevel: [3, 3] });
    }
  });
  addTop(STERN_WING, 100);
  addTop(STERN_WING.map(([x, y]) => [x, -y]), 100);
  addTop(ENGINE_MODULE, Z.engines);
  addTop(ENGINE_MODULE.map(([x, y]) => [x, -y]), Z.engines);
  addTop(RADIATOR, 146);
  addTop(RADIATOR.map(([x, y]) => [x, -y]), 146);
  B.prism(STERN_PLATFORM, Z.deck - 2, Z.stern, { bevel: [10, 10], wallMat: M.PAINT, bevelMat: M.DECK, capMat: M.DECK });
  addTop(STERN_PLATFORM, Z.stern);

  // --- 5. Kręgosłup (Hexlance) -----------------------------------------------
  for (const seg of SPINE) {
    B.prism(seg.poly, Z.deck - 4, seg.z1, { bevel: [seg.bevel, seg.bevel], wallMat: M.PANEL, bevelMat: M.DECK, capMat: M.DECK });
    addTop(seg.poly, seg.z1);
    if (seg.rings) {
      // Cewki akceleratora: poprzeczne pierścienie z lodową szczeliną.
      const [x0, x1, step] = seg.rings;
      const half = Math.max(...seg.poly.map((p) => Math.abs(p[1])));
      for (let x = x0; x <= x1; x += step) {
        B.box(x, 0, (Z.deck + seg.z1) / 2 + 3, 12, half * 2 + 10, seg.z1 - Z.deck + 12, { mat: M.DARK, bevel: [3, 3] });
        B.box(x, 0, seg.z1 + 9.2, 4, half * 1.6, 1.2, { mat: M.E_ICE });
      }
    }
  }
  // Wylot Hexlance'a: dwie szyny nad rozwidleniem i rdzeń soczewki.
  B.mirrorY(() => {
    B.alongX(730, 884, [[14, 46], [30, 46], [30, 94], [14, 94]], { mat: M.METAL, bevel: [3, 3] });
    B.alongX(740, 880, [[13.6, 58], [14.2, 58], [14.2, 84], [13.6, 84]], { mat: M.E_ICE });
  });
  B.cylinder([700, 0, 71], [858, 0, 71], 13, 13, { seg: 12, mat: M.DARK });
  B.cylinder([858, 0, 71], [872, 0, 71], 13, 8, { seg: 12, mat: M.E_ICE });
  const hexlanceMuzzle = [884, 0, 71];

  // --- 6. Płetwy startowe, hangary ----------------------------------------------
  const hangars = [];
  B.mirrorY((mir) => {
    for (const fin of FINS) {
      B.prism(fin.poly, 6, 26, { bevel: [4, 4], bevelBottom: [3, 3], bottom: true, wallMat: M.PANEL, bevelMat: M.DECK, capMat: M.DECK, bottomMat: M.DARK });
      // Wspornik pod szyną (klin od burty).
      const cx = fin.poly.reduce((s, p) => s + p[0], 0) / fin.poly.length;
      const yEdge = fin.hangar[1];
      const tipY = Math.max(...fin.poly.map((p) => p[1])) - 10;
      B.face([[cx - 10, yEdge - 4, -16], [cx - 10, tipY, 6], [cx - 10, yEdge - 4, 6]], M.DARK, [-1, 0, 0]);
      B.face([[cx + 10, yEdge - 4, -16], [cx + 10, yEdge - 4, 6], [cx + 10, tipY, 6]], M.DARK, [1, 0, 0]);
      B.face([[cx - 10, yEdge - 4, -16], [cx + 10, yEdge - 4, -16], [cx + 10, tipY, 6], [cx - 10, tipY, 6]], M.DARK, [0, 1, -1]);
      // Wrota hangaru nad nasadą szyny: rama i ciemne wnętrze ze światłem.
      const [hx, hy] = fin.hangar;
      B.box(hx, hy + 2, 34, fin.w + 10, 10, 18, { mat: M.PANEL, bevel: [2, 2] });
      B.face([[hx - fin.w / 2, hy + 7.2, 27], [hx + fin.w / 2, hy + 7.2, 27], [hx + fin.w / 2, hy + 7.2, 41], [hx - fin.w / 2, hy + 7.2, 41]], M.HANGAR, [0, 1, 0]);
      B.box(hx, hy + 7.4, 26.2, fin.w, 1.2, 1.4, { mat: M.E_AMBER });
      if (!mir) hangars.push({ x: hx, y: hy + 8, z: 34 });
      else hangars.push({ x: hx, y: -(hy + 8), z: 34 });
      // Światła szyny (przerywana linia ze sprite'a).
      const base = fin.poly.filter((p) => p[1] > yEdge + 20);
      const tip = [(base[0][0] + base[1][0]) / 2, Math.max(base[0][1], base[1][1])];
      for (let k = 0; k < 6; k++) {
        const t = (k + 0.5) / 6;
        const y = yEdge + 14 + (tip[1] - 14 - yEdge) * t;
        B.box(tip[0] + (hx - tip[0]) * (1 - t) * 0.4, y, 26.8, 4, 7, 1.2, { mat: M.E_WHITE });
      }
    }
  });

  // --- 7. VLS, kopuły, detale burt --------------------------------------------
  B.mirrorY(() => {
    for (const x of VLS_X) {
      B.prism(octPoly(x - 20, 100, x + 20, 256, [6, 6, 18, 18]), Z.citadel - 2, Z.citadel + 10, { bevel: [3, 3], wallMat: M.DARK, bevelMat: M.DECK, capMat: M.DECK });
      B.box(x, 118, Z.citadel + 12, 26, 26, 4, { mat: M.DARK, bevel: [1.5, 1.5] });
    }
    for (const [x, y] of DOMES) {
      const z = heightAt(tops, x, y);
      B.cylinder([x, y, z - 2], [x, y, z + 6], 17, 17, { seg: 18, mat: M.PANEL });
      B.dome(x, y, z + 6, 15, 15, { seg: 20, rings: 5, mat: M.PANEL });
    }
  });

  // Okna pokładów na burtach (pas w połowie wysokości płyty) — skala okrętu.
  // Pas okien: cienkie świecące kreski co kilka paneli wzdłuż długich prostych burt.
  B.mirrorY(() => {
    const runs = [[-1130, -600, 618], [-270, -180, 499], [-60, 220, 438], [250, 350, 385], [560, 680, 414]];
    for (const [x0, x1] of runs) {
      for (let x = x0; x < x1; x += 22) {
        const y = atlasEdgeHalfWidth(x + 5);
        const lit = ((x * 7919) % 5) !== 0;
        if (!lit) continue;
        B.face([[x, y + 0.6, 8], [x + 9, y + 0.6, 8], [x + 9, y + 0.6, 13], [x, y + 0.6, 13]], M.E_WINDOW, [0, 1, 0]);
      }
    }
  });

  // --- 8. Dysze MAIN (rufa), dysze SIDE (burty) --------------------------------
  // Sprite nie ma namalowanych dysz (struga to efekt), markery MAIN leżą na dachu rufy —
  // dzwony stoją na tylnych ścianach bloków, na wysokościach markerów w osi Y.
  const nozzles = [];
  mainNozzle(B, -1751, 0, 18, 62, 58);
  nozzles.push({ x: -1751 - 58, y: 0, z: 18, r: 62, dir: [-1, 0, 0] });
  for (const [x, y, z, r, len] of [[-1667, 282, 14, 50, 50], [-1565, 380, 26, 44, 46]]) {
    B.mirrorY(() => mainNozzle(B, x, y, z, r, len));
    nozzles.push({ x: x - len, y, z, r, dir: [-1, 0, 0] }, { x: x - len, y: -y, z, r, dir: [-1, 0, 0] });
  }

  // Skrzynki RCS w bryle — tylko poza grą (demo); gra rysuje modele dysz SIDE partią (o.rcs === false,
  // thrusterBatch3D.js) w miejscach markerów, z dzwonem za kierunkiem wydechu.
  const side = ATLAS_EDITOR_DEFAULTS.engines?.side || [];
  const rcs = [];
  for (const e of side) {
    const x = e.x;
    const yImg = e.y;
    const sgn = yImg < 0 ? 1 : -1; // górna połowa obrazka = +Y
    const yEdge = atlasEdgeHalfWidth(x);
    const z = x > X_CUT ? prongBelt(x) + 18 : 12;
    if (o.rcs !== false) {
      B.box(x, sgn * (yEdge + 3), z, 34, 8, 16, { mat: M.PANEL, bevel: [2, 2] });
      B.face([[x - 12, sgn * (yEdge + 7.2), z - 5], [x + 12, sgn * (yEdge + 7.2), z - 5], [x + 12, sgn * (yEdge + 7.2), z + 5], [x - 12, sgn * (yEdge + 7.2), z + 5]], M.DARK, [0, sgn, 0]);
    }
    rcs.push({ id: e.id, x, y: sgn * (yEdge + 8), z, dir: [0, sgn, 0] });
  }

  // --- 9. Mostki z gry (bridge3DShapes) ------------------------------------------
  const bridges = [];
  if (o.bridges !== false) {
    const zs = o.bridgeZScale ?? 2.6;
    const place = [
      { kind: 'atlas_main', x: -735, y: 13, z: 126 },
      { kind: 'atlas_backup', x: 632, y: 8, z: 104 }
    ];
    for (const p of place) bridges.push(addBridge(B, p, zs));
  }

  // --- 10. Gniazda broni (markery edytora) ---------------------------------------
  // Barbeta: niski pierścień z fazą na namalowanym gnieździe; wieża (weapons3D.js) stoi na niej.
  const mounts = [];
  for (const hp of ATLAS_EDITOR_DEFAULTS.hardpoints) {
    const type = String(hp.type || '').toLowerCase();
    const x = hp.x;
    const y = -hp.y;
    const z = heightAt(tops, x, y);
    const r = MOUNT_RADIUS[type] ?? 24;
    if (r > 0) {
      // Pierścień z fazą i zamknięty właz (płyta z ciemną szczeliną) — puste gniazdo nie jest „dziurą”.
      B.push().translate(x, y, z);
      B.lathe([[r + 5, -4], [r + 5, 2], [r + 2, 5.5], [r * 0.86, 5.5], [r * 0.82, 5.0], [r * 0.78, 5.5], [0, 5.5]],
        { seg: 28, mats: [M.PANEL, M.BRIGHT, M.PANEL, M.DARK, M.DARK, M.PANEL] });
      B.pop();
    }
    mounts.push({ id: hp.id, type, x, y, z: z + (r > 0 ? 5.5 : 0), radius: r, rot: hp.rot || 0 });
  }

  return finalize(B, { tops, mounts, nozzles, rcs, hangars, bridges, hexlanceMuzzle, S });
}

// Dzwon dyszy MAIN na tylnej ścianie (x, y, z), osią za rufę (−X): kołnierz, dzwon
// (zewnątrz metal, wewnątrz ciemny), żar gardzieli (E_ENGINE — świeci w bloomie).
function mainNozzle(B, x, y, z, r, len) {
  B.push().translate(x, y, z).rotateY(-Math.PI / 2); // lokalne +Z = −X
  B.lathe([[r * 0.78, -14], [r * 0.78, 6], [r * 0.62, 10]], { seg: 24, mats: [M.PANEL, M.DARK] });
  B.lathe([[r * 0.62, 8], [r * 0.7, 18], [r * 0.9, len * 0.7], [r, len], [r * 0.92, len]], { seg: 28, mats: [M.METAL, M.METAL, M.METAL, M.BRIGHT] });
  B.lathe([[r * 0.92, len], [r * 0.83, len * 0.72], [r * 0.6, 20], [r * 0.52, 12]], { seg: 28, mats: [M.DARK, M.DARK, M.E_ENGINE], inside: true });
  B.lathe([[0, 12], [r * 0.52, 12]], { seg: 28, mats: [M.E_ENGINE], inside: true });
  B.pop();
}

function heightAt(tops, x, y) {
  let z = -Infinity;
  for (const t of tops) {
    if (!pointInPoly(x, y, t.poly)) continue;
    const h = t.zOf ? t.zOf(x, y) : t.z;
    if (h > z) z = h;
  }
  return Number.isFinite(z) ? z : Z.deck;
}

// Mostek gry (przestrzeń M: środek strefy, jednostki świata, +Z wysokość) → px kadłuba.
function addBridge(B, p, zs) {
  const model = buildBridgeModel(p.kind);
  const k = 1 / ATLAS3D_SCALE;
  const MAT = {
    [BRIDGE3D_MAT.PAINT]: M.PAINT, [BRIDGE3D_MAT.PANEL]: M.PANEL, [BRIDGE3D_MAT.DARK]: M.DARK,
    [BRIDGE3D_MAT.TRIM]: M.TRIM, [BRIDGE3D_MAT.GLASS]: M.GLASS, [BRIDGE3D_MAT.FRAME]: M.DARK,
    [BRIDGE3D_MAT.BRIGHT]: M.BRIGHT, [BRIDGE3D_MAT.GRIME]: M.PANEL
  };
  const P = (x, y, z) => [p.x + x * k, p.y + y * k, p.z + z * k * zs];
  const pos = model.positions;
  const idx = model.index;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]; const b = idx[t + 1]; const c = idx[t + 2];
    const pa = P(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]);
    const pb = P(pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]);
    const pc = P(pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]);
    const nx = model.normals[a * 3]; const ny = model.normals[a * 3 + 1]; const nz = model.normals[a * 3 + 2] / zs;
    const mat = MAT[model.mat[a]] ?? M.PAINT;
    B.face([pa, pb, pc], mat, [nx, ny, nz]);
  }
  let windows = 0;
  for (const e of model.emitters) {
    const lit = e.lit !== false;
    if (!lit) continue;
    const hw = (e.w || 1) * 0.5;
    const hh = (e.h || 1) * 0.5;
    const off = 0.05;
    const q = (st, sb) => P(
      e.c[0] + e.t[0] * st + e.b[0] * sb + e.n[0] * off,
      e.c[1] + e.t[1] * st + e.b[1] * sb + e.n[1] * off,
      e.c[2] + e.t[2] * st + e.b[2] * sb + e.n[2] * off
    );
    const mat = e.type === BRIDGE3D_EMIT.WINDOW ? M.E_WINDOW
      : e.type === BRIDGE3D_EMIT.STRIP ? M.E_CYAN
        : (String(e.color).includes('white') ? M.E_WHITE : M.E_RED);
    B.face([q(-hw, -hh), q(hw, -hh), q(hw, hh), q(-hw, hh)], mat, [e.n[0], e.n[1], e.n[2] / zs]);
    windows++;
  }
  return { kind: p.kind, x: p.x, y: p.y, z: p.z, windows, triangles: model.triangleCount };
}

// Dane w jednostkach świata (× S), układ Core3D.
function finalize(B, d) {
  const S = d.S;
  const out = { mounts: [], nozzles: [], rcs: [], hangars: [], lights: [], bridges: d.bridges };
  for (const m of d.mounts) {
    out.mounts.push({
      id: m.id, type: m.type, rot: m.rot,
      x: m.x * S, y: m.y * S, z: m.z * S,
      radius: m.radius * S,
      px: [m.x, m.y]
    });
  }
  for (const n of d.nozzles) out.nozzles.push({ x: n.x * S, y: n.y * S, z: n.z * S, r: n.r * S, dir: n.dir });
  for (const r of d.rcs) out.rcs.push({ id: r.id, x: r.x * S, y: r.y * S, z: r.z * S, dir: r.dir });
  for (const h of d.hangars) out.hangars.push({ x: h.x * S, y: h.y * S, z: h.z * S });
  const L = ATLAS_EDITOR_DEFAULTS.lights || {};
  for (const l of L.position || []) {
    const y = -l.y;
    const z = heightAt(d.tops, l.x, y);
    out.lights.push({ id: l.id, kind: 'position', x: l.x * S, y: y * S, z: (z + 3) * S, color: l.color, power: l.power, radius: l.radius, group: l.sequenceGroup || '' });
  }
  for (const l of L.road || []) {
    const y = -l.y;
    const z = heightAt(d.tops, l.x, y);
    out.lights.push({ id: l.id, kind: 'road', x: l.x * S, y: y * S, z: (z + 4) * S, color: l.color, power: l.power, radius: l.radius, deg: l.deg, range: l.range, coneDeg: l.coneDeg });
  }
  out.hexlanceMuzzle = { x: d.hexlanceMuzzle[0] * S, y: d.hexlanceMuzzle[1] * S, z: d.hexlanceMuzzle[2] * S };
  out.builder = B;
  out.scale = S;
  // Wspólne pola modeli okrętów (rejestr ships3D.js, kadłuby floty: fleetHull3D.js).
  out.id = 'atlas';
  out.label = 'Atlas — okręt gracza';
  out.faction = 'player';
  out.tier = 'Capital';
  out.editorKey = 'atlas';
  out.profile = 'atlas';
  out.sprite = ATLAS3D_SPRITE;
  out.palette = null;
  out.deckZ = Z.deck * S;
  // Zapytania w jednostkach świata (układ modelu): dach nad punktem, dno kila, wnętrze obrysu.
  out.heightAt = (xw, yw) => heightAt(d.tops, xw / S, yw / S) * S;
  // Dno: kadłub — pochyłe burty dolne od pasu (krawędź obrysu) do obrysu kila (× KEEL_S), dalej
  // dno kila; widły — dno kila wideł (bez y). yw pominięte = oś (najgłębiej).
  out.bottomAt = (xw, yw = 0) => {
    const x = xw / S;
    if (x > X_CUT) return prongKeel(x) * S;
    const ye = atlasEdgeHalfWidth(x);
    const ay = Math.abs(yw / S);
    const kz = keelZ(x);
    if (ye <= 0 || ay <= ye * KEEL_S) return kz * S;
    const f = Math.max(0, Math.min(1, (ye - ay) / ((1 - KEEL_S) * ye)));
    return (Z.belt + f * (kz - Z.belt)) * S;
  };
  out.contains = (xw, yw) => pointInPoly(xw / S, yw / S, BODY_POLY) || pointInPoly(xw / S, Math.abs(yw / S), PRONG_POLY);
  return out;
}
