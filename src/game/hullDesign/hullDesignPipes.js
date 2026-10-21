// src/game/hullDesign/hullDesignPipes.js
//
// KREATOR KADŁUBÓW — SIEĆ SYSTEMÓW: trasy rur paliwa i kabli zasilania (czysta: bez three i DOM; testy
// tests/hullDesignNetwork.test.mjs, tests/hullDesign.test.mjs). Kto z kim — src/game/hullDesign/hullDesignSystems.js:
// rury paliwa zbiornik → reaktor → każda gondola MAIN i dysza SIDE, kable reaktor → każde urządzenie. Wzór wyglądu:
// sprite'y Terra Novy — wiązki w rowach maszynowni między płytami, proste i 45° z zaokrąglonymi kolanami, znikające pod
// płytami (kołnierz na wejściu), osprzęt (skrzynki rozdzielcze, zawory, pompy, kolektory przy gondolach, obejmy).
//
// GENERATOR (deterministyczny z ziarna projektu, `design.pipeNet = { density, seed }`, gęstość 0 — brak sieci):
//   1. siatka trasowania (komórka HD_PIPE_TUNE.cellDu jd) nad kadłubem — przy lustrze tylko burta y < 0 (druga to
//      lustro wyniku: symetria z konstrukcji); koszt komórki: rów maszynowni tanio (najtaniej przy ścianie płyty), pod
//      płytą drożej (trasa chowa się pod płytę), przez cudzy moduł najdrożej, przy burcie drożej, przy sylwetce zakaz,
//   2. TRZY SIECI po kolei (HD_NETS): rury do silników (reaktor → MAIN, SIDE), rury dopływu (zbiornik → reaktor),
//      kable (reaktor → urządzenia). Każda to drzewo od PRZYŁĄCZY reaktora: urządzenie (najbliższe sieci pierwsze)
//      dołącza najkrótszą trasą (A* w stanach komórka × kierunek: 8 kierunków = 45°, kara za skręt; heurystyka =
//      odległość do sieci) do najbliższego miejsca drzewa TEJ SAMEJ sieci albo do wolnego przyłącza reaktora (nowy pień,
//      pnie co portGapCells). KAŻDA TRASA MA DWA PRAWDZIWE KOŃCE: przyłącze urządzenia i węzeł / przyłącze reaktora —
//      bez celów „donikąd”; komórka przyłącza urządzenia jest zamknięta dla innych tras sieci. Wiązki wcześniejszych
//      sieci są dla następnych przeszkodą (ślad w koszcie i w polu wolnego miejsca) — rury i kable we wspólnym rowie
//      leżą obok siebie, przecinają się tylko tam, gdzie inaczej się nie da,
//   3. obciążenie krawędzi = suma wag tras (HD_FUEL_LOAD, HD_POWER_LOAD) od urządzenia do reaktora → liczba rur / kabli
//      w wiązce (1 + k · log2(1 + obciążenie)) — kable gęstnieją przy rdzeniu, rury przy silnikach (gondola waży 3),
//   4. biegi (odcinki drzewa między węzłami) → łamane PROSTE: schodki trasy A* → najwyżej dwa odcinki (prosty + 45°),
//      gdy koszt nie rośnie (straightenOctilinear); każdy prosty odcinek z JEDNYM przesunięciem w poprzek, przy którym
//      wiązka mieści się w rowie (pole wolnego miejsca), rogi z przecięć przesuniętych prostych (offsetRun); koniec
//      przy urządzeniu wchodzi w nie odcinkiem co 45° (przyłącze, dalej rysuje się moduł); kolana zaokrąglone; CAŁA
//      szerokość wiązki (oś ± pół-szerokość) z zapasem marginDu wewnątrz sylwetki — inaczej wiązka cieńsza,
//   5. osprzęt: skrzynki rozdzielcze (rury) i puszki (kable) w rozgałęzieniach, kołnierze / przepusty na wejściach pod
//      płyty, przyłącza przy urządzeniach (kołnierz, dławnica kablowa, pompa przy zbiorniku, kolektor przy gondoli),
//      zawory i pompy na długich odcinkach rur, rozdzielnia przy przyłączu reaktora bez własnej bryły.
// Do tego RĘCZNE rury projektu (`design.pipes`: łamana, liczba rur, materiał; domyślnie leżą też na płytach).
//
// RASTER (rasterPipeNetwork): na siatce pola (jak grooveField) — dla tekseli przy wiązkach przesunięcie w poprzek
// od osi biegu ze znakiem [j.], cos / sin fazy długości łuku (obejmy co clampDu jd), numer odcinka między obejmami
// (kołnierze rur, opaski kabli), numer biegu i numer elementu osprzętu; kompozytor (src/3d/hullDesign/hullComposer.js)
// rysuje z tego rury, kable w korytkach i osprzęt. Wymiary rur i osprzętu w jd.

import { HD_MODULES } from './hullDesignSchema.js';
import { fuelLoad, hullDesignSystems, powerLoad, serviceChannel, serviceChannelSdf } from './hullDesignSystems.js';

export const HD_PIPE_TUNE = Object.freeze({
  cellDu: 5,            // komórka trasowania [jd]
  freeDu: 2,            // komórka pola wolnego miejsca (przesuw wiązek w rowie) [jd]
  edgeDu: 3,            // oś trasy (środek komórki) co najmniej tyle jd wewnątrz sylwetki
  marginDu: 0.6,        // CAŁA szerokość wiązki co najmniej tyle jd wewnątrz sylwetki
  edgeNearDu: 14,       // pas przy burcie z karą `edge` (rośnie ku burcie) [jd]
  cost: Object.freeze({
    gap: 1, plate: 4, module: 9, halo: 1.1, axis: 2.5, edge: 1.2, wall: 0.45, occ: 6,
    termPlate: 5,       // rury paliwa: płyta przy przyłączu silnika / dyszy / zbiornika (ostatni odcinek widać z rowu)
    turn45: 0.8, turn90: 2.4, turn135: 7
  }),
  termCells: 5,         // … w pasie tylu komórek wokół urządzenia
  haloCells: 2,         // pas kary wokół sieci [komórki] — równoległe wiązki tej samej sieci nie nachodzą na siebie
  heurK: 1.25,          // A* ważone: heurystyka × k (szybciej, trasy prawie najkrótsze) — rury (bliżej najtańszej: rowem) …
  heurKCable: 2.2,      // … i kable (trasa kabla może być mniej najkrótsza)
  relaxCells: 48,       // heurystyka (odległość do sieci) poprawiana w promieniu tylu komórek od nowej gałęzi
  portGapCells: 2,      // pnie wychodzące z reaktora co najmniej tyle komórek od siebie
  anchorDu: 2.5,        // przyłącze wchodzi w urządzenie na tyle jd (dalej rysuje się moduł) …
  anchorInDu: 6,        // … w punkt co najmniej tyle jd w głąb sylwetki
  maxPipes: 8,
  fillShare: 0.5,       // wiązka RUR wypełnia co najmniej taki ułamek szerokości rowu (mediana na widocznej długości) …
  fillExtra: 2,         // … dokładając najwyżej tyle rur ponad liczbę z obciążenia
  pipesK: 1.3,          // rur / kabli w wiązce: 1 + k · log2(1 + obciążenie)
  rThin: Object.freeze([1.15, 1.8]), rThick: Object.freeze([2.2, 3.1]), thickP: 0.72, gap: Object.freeze([0.25, 0.55]),
  rCable: Object.freeze([0.5, 0.75]), rCableMain: Object.freeze([0.95, 1.2]), gapCable: Object.freeze([0.08, 0.16]),
  clearDu: 0.5,         // luz wiązki od ścian [jd]
  shiftDu: 9,           // przesuw wiązki w poprzek najwyżej [jd]
  filletK: 1.2,         // promień kolana = k · (pół-szerokość + najgrubsza rura) [jd]
  clampDu: 26,          // okres obejm [jd]
  valveDu: 95,          // zawór / kołnierz co ~ [jd] na długich widocznych odcinkach rur
  boxDu: 120,           // puszka kablowa co ~ [jd] na długich widocznych odcinkach kabli
  maxRuns: 255,
  maxFits: 255
});

/** Sieci systemów w kolejności trasowania: rury do silników, rury dopływu ze zbiorników, kable zasilania. */
export const HD_NETS = Object.freeze(['feed', 'supply', 'power']);
/** Rodzaje osprzętu (te same kody rysuje kompozytor: _pipeNet w hullComposer.js) i ich pierwszeństwo przy nakładaniu. */
export const HD_PIPE_FIT = Object.freeze({ box: 1, collar: 2, valve: 3, pump: 4, collector: 5, cap: 6, gland: 7, jbox: 8, hub: 9 });
const FIT_PRIO = Object.freeze({ 6: 0, 3: 1, 2: 2, 7: 3, 4: 4, 5: 5, 8: 6, 1: 7, 9: 8 });
/** Materiały rur (ręczne): mieszane, stal, miedź. Kod 3 — kable (sieć zasilania), 4 — rury paliwa. */
export const HD_PIPE_MATS = Object.freeze(['mix', 'steel', 'copper']);
export const HD_PIPE_MAT_CABLE = 3;
/** Kod 4 — rury paliwa sieci (jasna stal i miedź). */
export const HD_PIPE_MAT_FUEL = 4;

const SQ2 = Math.SQRT2;
const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];
const DL = [1, SQ2, 1, SQ2, 1, SQ2, 1, SQ2];

function rng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));
const smooth01 = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };

/** Pole modułu [j.] (koło / prostokąt z obrotem) — obrys przeszkody (obudowy wież sięgają ~1,2 promienia). */
export function pipeModuleSdf(m, x, y) {
  const def = HD_MODULES[m.type];
  if (def.r) {
    const k = m.type.startsWith('turret_') || m.type === 'mount' ? 1.22 : 1.04;
    return Math.hypot(x - m.x, y - m.y) - (m.r || def.r) * k;
  }
  let dx = x - m.x, dy = y - m.y;
  if (m.rot) {
    const c = Math.cos(m.rot), s = Math.sin(m.rot);
    const lx = dx * c + dy * s, ly = -dx * s + dy * c;
    dx = lx; dy = ly;
  }
  const qx = Math.abs(dx) - m.w, qy = Math.abs(dy) - m.h;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
}
function moduleBox(m) {
  const def = HD_MODULES[m.type];
  const R = def.r ? (m.r || def.r) * 1.25 : Math.hypot(m.w, m.h);
  return [m.x - R, m.y - R, m.x + R, m.y + R];
}
/** Moduł rysowany (przeszkoda dla tras) — reaktor wewnątrz (v ≥ 1) nie ma bryły. */
const isObstacle = (m) => !(m.type === 'reactor' && (m.v || 0) >= 1);

/** Próbnik dwuliniowy pola poziomu (poza siatką — pasmo). */
function fieldSampler(field) {
  const { x0, y0, w, h, res } = field.grid;
  const band = field.band;
  return (arr, x, y) => {
    const fx = (x - x0) * res - 0.5, fy = (y - y0) * res - 0.5;
    const i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i + 1 >= w || j + 1 >= h) return band;
    const tx = fx - i, ty = fy - j;
    const k = j * w + i;
    const a = arr[k], b = arr[k + 1], c = arr[k + w], d = arr[k + w + 1];
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  };
}

/** Kopiec binarny (klucz float, wartość int) na tablicach typowanych. */
class Heap {
  constructor(cap) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.n = 0; this.top = 0; }
  clear() { this.n = 0; }
  push(key, val) {
    if (this.n >= this.k.length) {
      const k2 = new Float64Array(this.k.length * 2); k2.set(this.k); this.k = k2;
      const v2 = new Int32Array(this.v.length * 2); v2.set(this.v); this.v = v2;
    }
    const K = this.k, V = this.v;
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= key) break;
      K[i] = K[p]; V[i] = V[p]; i = p;
    }
    K[i] = key; V[i] = val;
  }
  pop() {
    const K = this.k, V = this.v;
    const out = V[0];
    this.top = K[0];
    const n = --this.n;
    if (n > 0) {
      const key = K[n], val = V[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && K[c + 1] < K[c]) c++;
        if (K[c] >= key) break;
        K[i] = K[c]; V[i] = V[c]; i = c;
      }
      K[i] = key; V[i] = val;
    }
    return out;
  }
}

/** Łamana otwarta z zaokrąglonymi kolanami (promień R, łuk ≤ stepDeg); końce bez zmian. */
export function filletPolyline(pts, R, stepDeg = 15) {
  if (pts.length < 3 || !(R > 0)) return pts.map((p) => [p[0], p[1]]);
  const out = [[pts[0][0], pts[0][1]]];
  const n = pts.length;
  for (let i = 1; i < n - 1; i++) {
    const P = pts[i - 1], V = pts[i], N = pts[i + 1];
    const lp = Math.hypot(V[0] - P[0], V[1] - P[1]), ln = Math.hypot(N[0] - V[0], N[1] - V[1]);
    if (lp < 1e-6 || ln < 1e-6) continue;
    const ix = (V[0] - P[0]) / lp, iy = (V[1] - P[1]) / lp, ox = (N[0] - V[0]) / ln, oy = (N[1] - V[1]) / ln;
    const cosA = clamp(ix * ox + iy * oy, -1, 1);
    const alpha = Math.acos(cosA);
    if (alpha < 1e-3) { out.push([V[0], V[1]]); continue; }
    const tanHalf = Math.tan((Math.PI - alpha) * 0.5);
    let t = R / Math.max(tanHalf, 1e-6);
    const tMax = Math.min(i === 1 ? lp * 0.9 : lp * 0.5, i === n - 2 ? ln * 0.9 : ln * 0.5);
    if (t > tMax) t = tMax;
    const r = t * tanHalf;
    if (r < 1e-3) { out.push([V[0], V[1]]); continue; }
    const side = ix * oy - iy * ox > 0 ? 1 : -1;
    const T1x = V[0] - ix * t, T1y = V[1] - iy * t;
    const cx = T1x - iy * r * side, cy = T1y + ix * r * side;
    const a0 = Math.atan2(T1y - cy, T1x - cx);
    const steps = Math.max(1, Math.ceil(alpha / (stepDeg * Math.PI / 180)));
    for (let k = 0; k <= steps; k++) {
      const a = a0 + side * alpha * (k / steps);
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  out.push([pts[n - 1][0], pts[n - 1][1]]);
  // bez punktów prawie pokrywających się (styk łuku z sąsiednim łukiem / końcem odcinka)
  const eps = R * 0.02;
  const clean = [out[0]];
  for (let i = 1; i < out.length; i++) {
    const q = clean[clean.length - 1];
    if (Math.hypot(out[i][0] - q[0], out[i][1] - q[1]) > eps || i === out.length - 1) clean.push(out[i]);
  }
  if (clean.length > 2) {
    const q = clean[clean.length - 2], e = clean[clean.length - 1];
    if (Math.hypot(e[0] - q[0], e[1] - q[1]) <= eps) clean.splice(clean.length - 2, 1);
  }
  return clean;
}

/** Promienie rur wiązki (jd) z ziarna: grube stalowe i cieńsze; najgrubsza zwykle na brzegu. */
function pipeRadii(seedRand, n, scale = 1) {
  const T = HD_PIPE_TUNE;
  const out = [];
  const thick = n >= 2 && seedRand() < T.thickP;
  const thickAt = thick ? (seedRand() < 0.6 ? 0 : Math.min(n - 1, 1 + Math.floor(seedRand() * 2))) : -1;
  const thick2 = n >= 5 && seedRand() < 0.45 ? Math.min(n - 1, thickAt + 3) : -1;
  for (let k = 0; k < n; k++) {
    const big = k === thickAt || k === thick2;
    const [lo, hi] = big ? T.rThick : T.rThin;
    out.push((lo + (hi - lo) * seedRand()) * scale);
  }
  return out;
}

/** Promienie kabli wiązki (jd): pierwszy — gruby kabel zasilający, reszta cienkie w korytku. */
function cableRadii(seedRand, n) {
  const T = HD_PIPE_TUNE;
  const out = [];
  for (let k = 0; k < n; k++) {
    const [lo, hi] = k === 0 ? T.rCableMain : T.rCable;
    out.push(lo + (hi - lo) * seedRand());
  }
  return out;
}

const bundleHalfW = (radii, gap) => (radii.reduce((a, r) => a + 2 * r, 0) + gap * (radii.length - 1)) * 0.5;

/**
 * Pole pancerza z KANAŁAMI SERWISOWYMI (`chanOf(m)` — serviceChannel: dysze SIDE, zbiorniki, gondole bez rowu przy
 * szyjce): w kanale płyty zdjęte, więc wartość = max(pole pancerza, głębokość w kanale) — dodatnie = rów maszynowni.
 * Zwraca próbnik (x, y) → [j.].
 */
function armorGapSampler(field, S, modules, chanOf) {
  const L1 = field.levels[1];
  const chans = [];
  for (const m of modules) {
    const ch = chanOf(m);
    if (!ch) continue;
    const R = Math.hypot(ch.w, ch.h);
    chans.push({ ch, x0: ch.x - R, x1: ch.x + R, y0: ch.y - R, y1: ch.y + R });
  }
  if (!chans.length) return (x, y) => S(L1, x, y);
  return (x, y) => {
    let v = S(L1, x, y);
    for (const c of chans) {
      if (x < c.x0 || x > c.x1 || y < c.y0 || y > c.y1) continue;
      const d = -serviceChannelSdf(c.ch, x, y);
      if (d > v) v = d;
    }
    return v;
  };
}

/**
 * Gondole MAIN z kanałem serwisowym: w pasie startu trasy przy gondoli (do 1,6 komórki od obrysu, połowa od szyjki —
 * jak startsOf) nie ma ani jednego miejsca w głębi rowu maszynowni (≥ 0,45 komórki od płyt, ≥ edgeDu od sylwetki) —
 * kadłuby z klocków: płyta rufy dochodzi do gondoli; rura paliwa wchodzi wtedy kanałem. Gondole z rowem przy sobie
 * (flota TN) kanału nie dostają.
 */
function engineChannels(field, S, modules, T) {
  const D = field.expanded.design.detail;
  const L0 = field.levels[0], L1 = field.levels[1];
  const c = T.cellDu * D, pad = 1.6 * c, st = 0.5 * c;
  const out = new Set();
  for (const m of modules) {
    if (m.type !== 'engine') continue;
    const b = moduleBox(m);
    const cr = Math.cos(m.rot || 0), sr = Math.sin(m.rot || 0);
    let groove = false;
    for (let x = b[0] - pad; x <= b[2] + pad && !groove; x += st) {
      for (let y = b[1] - pad; y <= b[3] + pad; y += st) {
        const sd = pipeModuleSdf(m, x, y);
        if (sd <= 0 || sd > pad || (x - m.x) * cr + (y - m.y) * sr < -0.25 * m.w) continue;
        if (S(L0, x, y) <= -T.edgeDu * D && S(L1, x, y) >= 0.45 * c) { groove = true; break; }
      }
    }
    if (!groove) out.add(m);
  }
  return out;
}

/**
 * Przyłącze rury paliwa WIDAĆ: za obrysem urządzenia (od strony urządzenia na łamanej `poly`, koniec `end`) pierwsze
 * 3 jd leżą w rowie maszynowni (kolektor / kołnierz przy wejściu widać) i co najmniej 60% z 12 jd — oś wiązki i jej
 * brzegi na pół szerokości (`hwJ` [j.]; wiązka w rowie węższym od siebie leży głównie pod płytą). Zwraca { ok, seen, of }.
 */
function fuelEndVisible(poly, end, m, D, visAt, hwJ = 0) {
  const pw = polyWalker(poly);
  let s0 = -1;
  for (let s = 0; s <= pw.L; s += 0.4 * D) {
    const a = pw.at(end ? pw.L - s : s);
    if (pipeModuleSdf(m, a.x, a.y) > 0.4 * D) { s0 = s; break; }
  }
  let nv = 0, nt = 0, near = true;
  for (let s = 1; s0 >= 0 && s <= 12 && s0 + s * D <= pw.L; s++) {
    const a = pw.at(end ? pw.L - s0 - s * D : s0 + s * D);
    const nx = -Math.sin(a.rot) * 0.5 * hwJ, ny = Math.cos(a.rot) * 0.5 * hwJ;
    // punkt w obrysie samego urządzenia (brzeg wiązki przy skośnym wyjściu) przykrywa rysunek modułu — liczy się jako widoczny
    const vis = (x, y) => pipeModuleSdf(m, x, y) <= 0 || visAt(x, y);
    const v = vis(a.x, a.y) && vis(a.x + nx, a.y + ny) && vis(a.x - nx, a.y - ny);
    nt++;
    if (v) nv++;
    else if (s <= 3) near = false;
  }
  return { ok: nt > 0 && near && nv >= 0.6 * nt, seen: nv, of: nt };
}

/** Każdy moduł poza osią (|y| > 0,5) ma bliźniaka tego samego typu w odbiciu (tolerancja 0,01 j. — obrót części). */
function modulesMirrored(modules) {
  for (const m of modules) {
    if (Math.abs(m.y) <= 0.5) continue;
    if (!modules.some((q) => q !== m && q.type === m.type && Math.abs(q.x - m.x) < 0.01 && Math.abs(q.y + m.y) < 0.01)) return false;
  }
  return true;
}

/**
 * Głębokość w sylwetce [j.] (próbnik): max(−pole ramy, odległość do zewnętrza). Pole ramy to suma brył przez min —
 * wewnątrz NIEDOSZACOWUJE głębokości przy szwach stykających się brył (części, kasztele przy burcie: szew czyta się
 * jak krawędź), więc obok liczy się transformata odległości (fazowa 1 / √2, siatka ~1 jd) od komórek zewnętrza —
 * szew wewnątrz nie jest burtą. Lustro: tylko burta y ≤ 0 (najbliższe zewnętrze ma odbicie po tej stronie). `slack` —
 * dodatkowy zapas w komórkach (generator: 1 — kontrola na siatce o innym przesunięciu nie wyjdzie mniejsza).
 */
function insideDepthSampler(field, S, mirror, pre = null, slack = 0) {
  const L0 = field.levels[0];
  const D = field.expanded.design.detail;
  const b = field.bounds;
  const BIG = 1e9;
  let x0, y0, cw, W, H, d;
  if (pre) {
    // próbki pola ramy już policzone (siatka pola wolnego miejsca generatora)
    ({ x0, y0, cw, W, H } = pre);
    d = new Float32Array(W * H);
    for (let k = 0; k < d.length; k++) d[k] = pre.l0[k] > 0 ? 0 : BIG;
  } else {
    cw = HD_PIPE_TUNE.freeDu * D;                 // ta sama siatka co pole wolnego miejsca generatora
    x0 = b.minX - 2 * cw; y0 = b.minY - 2 * cw;
    W = Math.ceil((b.maxX - x0) / cw) + 3; H = Math.ceil(((mirror ? 0 : b.maxY) - y0) / cw) + 3;
    d = new Float32Array(W * H);
    for (let j = 0; j < H; j++) {
      const y = y0 + j * cw;
      for (let i = 0; i < W; i++) d[j * W + i] = S(L0, x0 + i * cw, y) > 0 ? 0 : BIG;
    }
  }
  const s2 = Math.SQRT2;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    let v = d[k];
    if (v === 0) continue;
    if (i > 0) v = Math.min(v, d[k - 1] + 1);
    if (j > 0) {
      v = Math.min(v, d[k - W] + 1);
      if (i > 0) v = Math.min(v, d[k - W - 1] + s2);
      if (i + 1 < W) v = Math.min(v, d[k - W + 1] + s2);
    }
    d[k] = v;
  }
  for (let j = H - 1; j >= 0; j--) for (let i = W - 1; i >= 0; i--) {
    const k = j * W + i;
    let v = d[k];
    if (v === 0) continue;
    if (i + 1 < W) v = Math.min(v, d[k + 1] + 1);
    if (j + 1 < H) {
      v = Math.min(v, d[k + W] + 1);
      if (i + 1 < W) v = Math.min(v, d[k + W + 1] + s2);
      if (i > 0) v = Math.min(v, d[k + W - 1] + s2);
    }
    d[k] = v;
  }
  // fazowa transformata zawyża odległość euklidesową najwyżej o ~8% — z zapasem w dół (i o komórkę; próbki w węzłach)
  for (let k = 0; k < d.length; k++) d[k] = d[k] >= BIG ? 1e4 : Math.max(0, d[k] * 0.92 - 1 - slack) * cw;
  return (x, y) => {
    const raw = -S(L0, x, y);
    if (raw <= 0) return raw;
    const yy = mirror && y > 0 ? -y : y;
    const fx = (x - x0) / cw, fy = (yy - y0) / cw;
    const i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i + 1 >= W || j + 1 >= H) return raw;
    const tx = fx - i, ty = fy - j, k = j * W + i;
    const v = (d[k] + (d[k + 1] - d[k]) * tx) * (1 - ty) + (d[k + W] + (d[k + W + 1] - d[k + W]) * tx) * ty;
    return v > raw ? v : raw;
  };
}

/**
 * Sieć rur i kabli projektu (null, gdy gęstość 0 i brak rur ręcznych). `field` — buildHullField (pola poziomów,
 * moduły rozwinięte, projekt). Zwraca { runs: [{ net ('feed' | 'supply' | 'power' | 'manual'), radii [jd], halfW [jd],
 * gap, rMax, mat (0 mix, 1 stal, 2 miedź, 3 kable), over, phase [j.], count, n, polys: [[[x, y], …], …] (kopia lustra
 * w tym samym biegu), ends: [[węzeł A, węzeł B], …] (na łamaną) }], fits: [{ type, x, y, rot, hw, hh [jd], p1, p2 }],
 * graph: { nodes: [{ x, y, dev (indeks modułu w field.expanded.modules przy przyłączu; −1 — węzeł), net }] }, mirror
 * (sieć liczona na burcie y < 0 i odbita — każdy moduł poza osią ma bliźniaka),
 * channels (indeksy gondol MAIN z kanałem serwisowym — kompozytor rysuje kanał), clampJ [j.], stats }.
 */
export function buildPipeNetwork(field, tuneIn = {}) {
  const T = { ...HD_PIPE_TUNE, ...tuneIn, cost: { ...HD_PIPE_TUNE.cost, ...(tuneIn.cost || {}) } };
  const { design, modules } = field.expanded;
  const manual = field.expanded.pipes || [];
  const density = design.pipeNet?.density || 0;
  if (!(density > 0) && !manual.length) return null;
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const D = design.detail;
  const S = fieldSampler(field);
  const L0 = field.levels[0], L1 = field.levels[1];
  // lustro sieci (trasy na burcie y < 0 i ich odbicie) — tylko gdy każdy moduł poza osią ma bliźniaka po drugiej burcie
  // (część na osi bywa niesymetryczna: odbita trasa skończyłaby się bez urządzenia); inaczej sieć na całym kadłubie
  const mirror = design.mirror && modulesMirrored(modules);
  const rand = rng(((design.seed || 7) * 7919 + (design.pipeNet?.seed || 0) * 104729 + 17) >>> 0);
  const runs = [];
  const fits = [];
  const graph = { nodes: [] };
  const obstacles = modules.filter(isObstacle);
  const bnd = field.bounds;
  const stats = { cells: 0, routes: 0, searches: 0, expanded: 0, unrouted: 0, shrunk: 0, outside: 0 };

  // kanały serwisowe: SIDE i zbiorniki zawsze, gondole MAIN — gdy przy szyjce nie ma rowu (tylko przy włączonej sieci)
  const engChan = tuneIn._engChan || (density > 0 ? engineChannels(field, S, modules, T) : new Set());
  let hiddenMain = null;     // gondole MAIN bez widocznego wejścia rury (drugi przebieg: z kanałem)
  const chanOf = (m) => serviceChannel(m, D, engChan.has(m));
  const gapAt = armorGapSampler(field, S, modules, chanOf);   // pancerz z kanałami serwisowymi (rów > 0)
  // ── pole wolnego miejsca (komórka freeDu jd): min(odległość od płyt, od sylwetki, od modułów, od osi lustra) [j.] ──
  // fs — geometria (widoczność rowu), fo — wiązki wcześniejszych sieci (przeszkoda dla następnych)
  const cf = T.freeDu * D;
  const fx0 = Math.floor(bnd.minX / cf) - 1, fy0 = Math.floor(bnd.minY / cf) - 1;
  const FW = Math.ceil(bnd.maxX / cf) + 2 - fx0, FH = Math.ceil((mirror ? cf : bnd.maxY) / cf) + 2 - fy0;   // lustro: burta y < 0
  // pola niezależne od kanałów serwisowych — przy drugim przebiegu (kanał gondoli) z pamięci pierwszego (`_cache`)
  const cache = tuneIn._cache || null;
  const fo = new Float32Array(FW * FH).fill(1e4);
  const fsMod = cache ? cache.fsMod : new Float32Array(FW * FH).fill(1e4);
  const modReach = 24 * D;
  for (const m of cache ? [] : obstacles) {
    const b = moduleBox(m);
    const i0 = Math.max(0, Math.floor((b[0] - modReach) / cf) - fx0), i1 = Math.min(FW - 1, Math.ceil((b[2] + modReach) / cf) - fx0);
    const j0 = Math.max(0, Math.floor((b[1] - modReach) / cf) - fy0), j1 = Math.min(FH - 1, Math.ceil((b[3] + modReach) / cf) - fy0);
    for (let j = j0; j <= j1; j++) {
      const y = (fy0 + j) * cf;
      for (let i = i0; i <= i1; i++) {
        const v = pipeModuleSdf(m, (fx0 + i) * cf, y);
        const k = j * FW + i;
        if (v < fsMod[k]) fsMod[k] = v;
      }
    }
  }
  const l0 = cache ? cache.l0 : new Float32Array(FW * FH);
  const fsBase = cache ? cache.fsBase : new Float32Array(FW * FH);
  for (let j = 0; !cache && j < FH; j++) {
    const y = (fy0 + j) * cf;
    for (let i = 0; i < FW; i++) {
      const x = (fx0 + i) * cf;
      const k = j * FW + i;
      const d0 = S(L0, x, y);
      l0[k] = d0;
      let v = Math.min(S(L1, x, y), -d0, fsMod[k]);
      if (mirror) v = Math.min(v, Math.abs(y));
      fsBase[k] = v;
    }
  }
  const fs = fsBase.slice();
  const bil = (arr, x, y) => {
    const fx = x / cf - fx0, fy = y / cf - fy0;
    const i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i + 1 >= FW || j + 1 >= FH) return -1e3;
    const tx = fx - i, ty = fy - j, k = j * FW + i;
    return (arr[k] + (arr[k + 1] - arr[k]) * tx) * (1 - ty) + (arr[k + FW] + (arr[k + FW + 1] - arr[k + FW]) * tx) * ty;
  };
  // kanały serwisowe w polu wolnego miejsca: tylko w ich pudłach
  for (const ch of modules.map(chanOf).filter(Boolean)) {
    const R = Math.hypot(ch.w, ch.h) + cf;
    const i0 = Math.max(0, Math.floor((ch.x - R) / cf) - fx0), i1 = Math.min(FW - 1, Math.ceil((ch.x + R) / cf) - fx0);
    const j0 = Math.max(0, Math.floor((ch.y - R) / cf) - fy0), j1 = Math.min(FH - 1, Math.ceil((ch.y + R) / cf) - fy0);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = (fx0 + i) * cf, y = (fy0 + j) * cf, k = j * FW + i;
      let v = Math.min(gapAt(x, y), -l0[k], fsMod[k]);
      if (mirror) v = Math.min(v, Math.abs(y));
      fs[k] = v;
    }
  }
  const fsAt = (x, y) => bil(fs, x, y);
  /** Wolne miejsce wiązki: geometria i wiązki wcześniejszych sieci [j.]. */
  const clrAt = (x, y) => Math.min(bil(fs, x, y), bil(fo, x, y));
  const modMin = (x, y) => {
    const fx = x / cf - fx0, fy = y / cf - fy0;
    const i = Math.round(fx), j = Math.round(fy);
    if (i < 0 || j < 0 || i >= FW || j >= FH) return 1e4;
    return fsMod[j * FW + i];
  };
  /** Widoczne miejsce rury z ziemi (rów maszynowni, nie moduł, nie pod płytą, wewnątrz sylwetki). */
  const visAt = (x, y) => gapAt(x, y) >= 0 && S(L0, x, y) < 0 && modMin(x, y) > 0;
  const inAt = cache ? cache.inAt : insideDepthSampler(field, S, mirror, { x0: fx0 * cf, y0: fy0 * cf, cw: cf, W: FW, H: FH, l0 }, 1);
  const now = () => (typeof performance !== 'undefined' ? performance.now() : 0);
  const tm = stats.t = { pola: now() - t0 };

  // ── sieć systemów ──
  if (density > 0) {
    const systems = hullDesignSystems(modules);
    const c = T.cellDu * D;
    const gx0 = Math.floor(bnd.minX / c), gx1 = Math.ceil(bnd.maxX / c);
    const gy0 = Math.floor(bnd.minY / c), gy1 = mirror ? 0 : Math.ceil(bnd.maxY / c);
    const GW = gx1 - gx0, GH = Math.max(1, gy1 - gy0), N = GW * GH;
    stats.cells = N;
    const cxOf = (k) => (gx0 + (k % GW) + 0.5) * c, cyOf = (k) => (gy0 + ((k / GW) | 0) + 0.5) * c;
    const cellAt = (x, y) => {
      const i = Math.floor(x / c) - gx0, j = Math.floor(y / c) - gy0;
      return i < 0 || j < 0 || i >= GW || j >= GH ? -1 : j * GW + i;
    };
    const kind = new Uint8Array(N);       // 0 zakaz, 1 rów, 2 płyta, 3 moduł
    const cost = new Float32Array(N);
    const pen = new Float32Array(N);      // ślady wiązek wcześniejszych sieci
    const C = T.cost;
    const edge = T.edgeDu * D, edgeNear = T.edgeNearDu * D;
    for (let k = 0; k < N; k++) {
      const x = cxOf(k), y = cyOf(k);
      const dIn = inAt(x, y), d1 = gapAt(x, y);
      if (dIn < edge) { kind[k] = 0; cost[k] = Infinity; continue; }
      if (d1 < 0) { kind[k] = 2; cost[k] = C.plate; } else {
        kind[k] = 1;
        cost[k] = C.gap + C.wall * smooth01((d1 - 7 * D) / (16 * D));
      }
      // z dala od burty: kara rośnie ku sylwetce (trasy nie schodzą „w dół do burty” bez potrzeby)
      if (dIn < edgeNear) cost[k] += C.edge * (1 - (dIn - edge) / (edgeNear - edge));
      if (mirror && Math.abs(y) < 10 * D) cost[k] += C.axis;
    }
    for (const m of obstacles) {
      const b = moduleBox(m);
      const i0 = Math.max(0, Math.floor(b[0] / c) - gx0), i1 = Math.min(GW - 1, Math.ceil(b[2] / c) - gx0);
      const j0 = Math.max(0, Math.floor(b[1] / c) - gy0), j1 = Math.min(GH - 1, Math.ceil(b[3] / c) - gy0);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * GW + i;
        if (!kind[k]) continue;
        if (pipeModuleSdf(m, cxOf(k), cyOf(k)) < c * 0.35) { kind[k] = 3; cost[k] = C.module + (mirror && Math.abs(cyOf(k)) < 10 * D ? C.axis : 0); }
      }
    }
    tm.siatka = now() - t0 - tm.pola;
    // stan A*: komórka (kierunek wejścia najlepszej drogi w din) — bufory wspólne dla sieci
    const g = new Float32Array(N).fill(Infinity);
    const prev = new Int32Array(N);
    const din = new Uint8Array(N);
    const closed = new Uint8Array(N);
    const touched = [];
    const heap = new Heap(4096);
    // kolejka kubełkowa heurystyki (relax)
    const buckets = [];
    let bucketTop = 0;
    const bucketPush = (v, k) => {
      (buckets[v] || (buckets[v] = [])).push(k);
      if (v + 1 > bucketTop) bucketTop = v + 1;
    };
    const di5 = new Int32Array(N);
    const costN = new Float32Array(N);
    const termPen = new Float32Array(N);   // kara płyt przy przyłączu urządzenia (rury paliwa) — na czas jednej trasy
    const termList = [];
    let portBase = null;
    const TP = [0, C.turn45, C.turn90, C.turn135];
    const dirOf = (a, b) => {
      const dx = (b % GW) - (a % GW), dy = ((b / GW) | 0) - ((a / GW) | 0);
      for (let d = 0; d < 8; d++) if (DX[d] === dx && DY[d] === dy) return d;
      return -1;
    };
    const inHalf = (m) => !mirror || m.y <= 0.5;
    /** Kopia lustra urządzenia (indeks w modules); urządzenie na osi — ono samo. */
    const mirrorIdx = (i) => {
      const m = modules[i];
      if (!mirror || Math.abs(m.y) <= 0.5) return i;
      for (let j = 0; j < modules.length; j++) {
        const q = modules[j];
        if (j !== i && q.type === m.type && Math.abs(q.x - m.x) < 0.01 && Math.abs(q.y + m.y) < 0.01) return j;     // części: obrót gubi bity
      }
      return i;
    };
    /** Komórki przyłącza przy module: obrys + pas; side +1 — tylko połowa ku +x modułu (szyjka gondoli MAIN), −1 — ku −x
     *  (dysza SIDE od strony kadłuba). */
    const startsOf = (m, side = 0) => {
      const out = [];
      const b = moduleBox(m);
      const pad = c * 1.6;
      const i0 = Math.max(0, Math.floor((b[0] - pad) / c) - gx0), i1 = Math.min(GW - 1, Math.ceil((b[2] + pad) / c) - gx0);
      const j0 = Math.max(0, Math.floor((b[1] - pad) / c) - gy0), j1 = Math.min(GH - 1, Math.ceil((b[3] + pad) / c) - gy0);
      const cr = Math.cos(m.rot || 0), sr = Math.sin(m.rot || 0);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * GW + i;
        if (!kind[k]) continue;
        const x = cxOf(k), y = cyOf(k);
        if (pipeModuleSdf(m, x, y) > pad) continue;
        const lx = (x - m.x) * cr + (y - m.y) * sr;
        if (side > 0 && lx < -0.25 * (m.w || 0)) continue;
        if (side < 0 && lx > 0.25 * (m.w || 0)) continue;
        out.push(k);
      }
      return out;
    };
    const sideOf = (m) => (m.type === 'engine' ? 1 : (m.type === 'thruster_side' ? -1 : 0));
    const coresHalf = systems.cores.filter((i) => inHalf(modules[i]));
    const itemsOf = (net) => {
      const list = net === 'feed' ? [...systems.mains, ...systems.sides] : (net === 'supply' ? systems.tanks : systems.consumers);
      return list.filter((i) => inHalf(modules[i])).map((i) => ({ dev: i, load: net === 'power' ? powerLoad(modules[i]) : fuelLoad(modules[i]) }));
    };

    /** Drzewo sieci `id` od przyłączy reaktorów: trasy urządzeń (najbliższe sieci pierwsze), obciążenie krawędzi. */
    const routeNet = (id, items) => {
      const tree = new Uint8Array(N), goal = new Uint8Array(N), block = new Uint8Array(N), near = new Uint8Array(N);
      const links = new Uint8Array(N), par = new Int32Array(N).fill(-1), term = new Int32Array(N).fill(-1);
      const portOf = new Int32Array(N).fill(-1);
      const dt = new Float32Array(N).fill(1e9);
      const cnt = new Float32Array(N * 8);
      // odległość do sieci (heurystyka A*, w komórkach): Dijkstra od nowych komórek na kolejce kubełkowej — wagi
      // całkowite 5 (prosto) i 7 (ukos ≈ 5 · √2), każda komórka zdejmowana raz; nowa gałąź poprawia heurystykę w promieniu
      // relaxCells komórek (dalej zostaje starsza — większa — wartość: A* i tak jest ważone)
      const relax = (seeds, rMax5 = T.relaxCells * 5) => {
        let lo = Infinity;
        for (const k of seeds) { dt[k] = 0; di5[k] = 0; bucketPush(0, k); lo = 0; }
        for (let b = lo; b < bucketTop; b++) {
          const list = buckets[b];
          if (!list) continue;
          for (let q = 0; q < list.length; q++) {
            const k = list[q];
            if (di5[k] !== b) continue;
            const i = k % GW, j = (k / GW) | 0;
            for (let d = 0; d < 8; d++) {
              const ni = i + DX[d], nj = j + DY[d];
              if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
              const nk = nj * GW + ni, v = b + ((d & 1) ? 7 : 5);
              if (v < di5[nk] && v <= rMax5) { di5[nk] = v; dt[nk] = v * 0.2; bucketPush(v, nk); }
            }
          }
          list.length = 0;
        }
        bucketTop = 0;
      };
      // przyłącza reaktorów i odległość od nich — te same dla każdej sieci (liczone raz)
      if (!portBase) {
        di5.fill(0x3fffffff);
        portBase = { portOf: new Int32Array(N).fill(-1), dt: new Float32Array(N).fill(1e9), di5: null, cells: [] };
        for (const ci of coresHalf) for (const k of startsOf(modules[ci])) if (portBase.portOf[k] < 0) { portBase.portOf[k] = ci; portBase.cells.push(k); }
        if (portBase.cells.length) relax(portBase.cells, Infinity);
        portBase.dt.set(dt);
        portBase.di5 = di5.slice();
      } else { dt.set(portBase.dt); di5.set(portBase.di5); }
      portOf.set(portBase.portOf);
      for (const k of portBase.cells) goal[k] = 1;
      // koszt wejścia w komórkę dla tej sieci: podłoże + ślady wcześniejszych sieci
      for (let k = 0; k < N; k++) costN[k] = cost[k] + pen[k];
      const HK = id === 'power' ? T.heurKCable : T.heurK;
      const markTree = (cells) => {
        const fresh = [];
        for (const k of cells) if (!tree[k]) { tree[k] = 1; goal[k] = 1; fresh.push(k); }
        const hr = T.haloCells;
        for (const k of fresh) {
          const i = k % GW, j = (k / GW) | 0;
          for (let dj = -hr; dj <= hr; dj++) for (let di = -hr; di <= hr; di++) {
            const ni = i + di, nj = j + dj;
            if (ni >= 0 && nj >= 0 && ni < GW && nj < GH) near[nj * GW + ni] = 1;
          }
        }
        if (fresh.length) relax(fresh);
      };
      /**
       * A* od komórek startu do najbliższej komórki celu (drzewo albo wolne przyłącze reaktora): stan = komórka
       * (zamknięta raz), kara za skręt względem kierunku wejścia najlepszej drogi do komórki — kilka razy mniej
       * rozwinięć niż stany komórka × kierunek, schodki i tak prostuje straightenOctilinear.
       */
      const search = (starts) => {
        for (const k of touched) { g[k] = Infinity; closed[k] = 0; }
        touched.length = 0;
        heap.clear();
        stats.searches++;
        for (const k of starts) {
          if (g[k] === Infinity) touched.push(k);
          g[k] = 0; prev[k] = -1; din[k] = 8;
          heap.push(HK * dt[k], k);
        }
        while (heap.n) {
          const k = heap.pop();
          if (closed[k]) continue;
          closed[k] = 1;
          const gs = g[k], d = din[k];
          stats.expanded++;
          if (goal[k] && d < 8) {
            const out = [];
            for (let q = k; q >= 0; q = prev[q]) out.push(q);
            return out.reverse();
          }
          const i = k % GW, j = (k / GW) | 0;
          const ck = costN[k];
          for (let nd = 0; nd < 8; nd++) {
            let tp = 0;
            if (d < 8) { let t = nd > d ? nd - d : d - nd; if (t > 4) t = 8 - t; if (t === 4) continue; tp = TP[t]; }
            const ni = i + DX[nd], nj = j + DY[nd];
            if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
            const nk = nj * GW + ni;
            if (closed[nk]) continue;
            const cn = costN[nk];
            if (cn === Infinity || block[nk]) continue;
            if (nd & 1) {
              const ka = j * GW + ni, kb = nj * GW + i;
              if (cost[ka] === Infinity || cost[kb] === Infinity) continue;
              if ((tree[ka] || tree[kb] || block[ka] || block[kb]) && !goal[nk]) continue;     // bez przecinania sieci po przekątnej
            }
            const ng = gs + DL[nd] * 0.5 * (ck + cn) + tp + (near[nk] && !tree[nk] ? C.halo : 0) + termPen[nk];
            if (ng < g[nk]) {
              if (g[nk] === Infinity) touched.push(nk);
              g[nk] = ng; prev[nk] = k; din[nk] = nd;
              heap.push(ng + HK * dt[nk], nk);
            }
          }
        }
        return null;
      };
      const pending = items.map((it) => ({ ...it, starts: startsOf(modules[it.dev], sideOf(modules[it.dev])) }));
      let routed = 0;
      while (pending.length) {
        let bi = 0, bv = Infinity;
        pending.forEach((t, i) => {
          let v = Infinity;
          for (const k of t.starts) if (!goal[k] && !block[k] && dt[k] < v) v = dt[k];
          if (v < bv) { bv = v; bi = i; }
        });
        const it = pending.splice(bi, 1)[0];
        const starts = it.starts.filter((k) => !goal[k] && !block[k]);
        // RURY PALIWA: ostatni odcinek do silnika, dyszy i zbiornika ma być widać — płyty przy urządzeniu drożej, start
        // w rowie przy urządzeniu (gdy jest); pod płyty trasa schodzi dalej od przyłącza
        let path = null;
        if (id !== 'power') {
          const m = modules[it.dev], b = moduleBox(m), pad = T.termCells * c;
          const i0 = Math.max(0, Math.floor((b[0] - pad) / c) - gx0), i1 = Math.min(GW - 1, Math.ceil((b[2] + pad) / c) - gx0);
          const j0 = Math.max(0, Math.floor((b[1] - pad) / c) - gy0), j1 = Math.min(GH - 1, Math.ceil((b[3] + pad) / c) - gy0);
          for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
            const k = j * GW + i;
            if (kind[k] === 2) { termPen[k] = C.termPlate; termList.push(k); }
          }
          // kanał serwisowy (SIDE, zbiornik, gondola bez rowu): start na DRUGIM końcu kanału — ostatni odcinek przechodzi
          // całym kanałem prosto do urządzenia; inaczej start w głębi rowu (wiązka biegnie środkiem, nie skrajem płyty)
          const ch = chanOf(m);
          if (ch) {
            const cc = Math.cos(ch.rot), sc = Math.sin(ch.rot);
            const farS = [];
            for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
              const k = j * GW + i;
              if (!kind[k] || goal[k] || block[k]) continue;
              const x = cxOf(k), y = cyOf(k);
              if (-serviceChannelSdf(ch, x, y) < 0.3 * c) continue;
              if (ch.dir * ((x - ch.x) * cc + (y - ch.y) * sc) < Math.max(0, ch.w - 1.6 * c)) continue;    // dalsza połowa kanału
              farS.push(k);
            }
            if (farS.length) path = search(farS);
          }
          const deepS = path ? [] : starts.filter((k) => kind[k] === 1 && gapAt(cxOf(k), cyOf(k)) >= 0.45 * c);
          if (deepS.length) path = search(deepS);
          if (!path) {
            const gs0 = starts.filter((k) => kind[k] === 1);
            if (gs0.length) path = search(gs0);
          }
        }
        if (!path) path = starts.length ? search(starts) : null;
        // przyłącze bez głębokiego wejścia w urządzenie (róg gondoli przy burcie) — trasa jeszcze raz, tylko z komórek,
        // z których wejście jest głębokie
        if (path && path.length >= 2 && !anchorFor(it.dev, path[0], path[1]).ok) {
          const good = starts.filter((k) => anchorFor(it.dev, k, -1).ok);
          const p2 = good.length ? search(good) : null;
          if (p2 && p2.length >= 2) path = p2;
        }
        for (const k of termList) termPen[k] = 0;
        termList.length = 0;
        if (!path || path.length < 2) { stats.unrouted++; continue; }
        stats.routes++;
        routed++;
        const last = path.length - 1, end = path[last];
        for (let q = 0; q < last; q++) {
          const a = path[q], b = path[q + 1], dd = dirOf(a, b);
          links[a] |= 1 << dd;
          links[b] |= 1 << ((dd + 4) & 7);
          par[a] = b;
        }
        term[path[0]] = it.dev;
        block[path[0]] = 1;
        if (!tree[end]) {
          // nowy pień do reaktora: koniec to przyłącze rdzenia; przyłącza obok odpadają (pnie co portGapCells)
          term[end] = portOf[end];
          block[end] = 1;
          goal[end] = 0;
          const ei = end % GW, ej = (end / GW) | 0, r = T.portGapCells;
          for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
            const ni = ei + di, nj = ej + dj;
            if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
            const kk = nj * GW + ni;
            if (portOf[kk] >= 0 && !tree[kk]) goal[kk] = 0;
          }
        }
        markTree(path.slice(1, last));
        // obciążenie: od urządzenia po drzewie do przyłącza reaktora
        for (let k = path[0], guard = 0; par[k] >= 0 && guard < N; k = par[k], guard++) {
          const p = par[k], dd = dirOf(k, p);
          cnt[k * 8 + dd] += it.load;
          cnt[p * 8 + ((dd + 4) & 7)] += it.load;
        }
      }
      return { id, links, cnt, term, routed };
    };

    /** Promienie: jedna sekwencja na sieć (gruba rura ciągnie się przez rozgałęzienia). */
    const seqOf = (id) => {
      const r = rng((design.seed || 7) * 31 + (HD_NETS.indexOf(id) + 1) * 977 + (design.pipeNet?.seed || 0));
      if (id === 'power') return { radii: cableRadii(r, T.maxPipes), gap: T.gapCable[0] + (T.gapCable[1] - T.gapCable[0]) * r(), mat: HD_PIPE_MAT_CABLE };
      return { radii: pipeRadii(r, T.maxPipes), gap: T.gap[0] + (T.gap[1] - T.gap[0]) * r(), mat: HD_PIPE_MAT_FUEL };
    };
    const pathCost = (poly) => {
      let sum = 0;
      for (let q = 0; q + 1 < poly.length; q++) {
        const a = poly[q], b = poly[q + 1];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const n = Math.max(1, Math.ceil(L / (0.5 * c)));
        for (let t = 0; t < n; t++) {
          const kk = cellAt(a[0] + (b[0] - a[0]) * (t + 0.5) / n, a[1] + (b[1] - a[1]) * (t + 0.5) / n);
          const v = kk < 0 ? Infinity : cost[kk] + pen[kk];
          if (v === Infinity) return Infinity;
          sum += v * L / n;
        }
      }
      return sum;
    };
    /**
     * Przyłącze w urządzeniu: od środka komórki odcinkiem co 45° (najpierw „prosto dalej”) na anchorDu jd w moduł —
     * w punkt, który leży też głęboko w sylwetce (anchorInDu jd; róg gondoli przy burcie się nie nadaje), a cały odcinek
     * z zapasem (marginDu + 2 jd — przewężenie między bryłą gondoli a kadłubem odpada); bez takiego — pierwszy punkt
     * w module.
     */
    const anchorFor = (dev, k, nextK) => {
      const m = modules[dev];
      const x0 = cxOf(k), y0 = cyOf(k);
      const inset = T.anchorDu * D, deep = T.anchorInDu * D, stub = (T.marginDu + 2) * D;
      if (pipeModuleSdf(m, x0, y0) <= -inset && inAt(x0, y0) >= deep) return { p: [x0, y0], ok: true };
      const dOut = nextK >= 0 ? dirOf(k, nextK) : -1;
      const straight = dOut >= 0 ? (dOut + 4) & 7 : -1;
      let best = null, bestS = null, shallow = null;
      for (let d = 0; d < 8; d++) {
        if (d === dOut) continue;
        const ux = DX[d] / DL[d], uy = DY[d] / DL[d];
        let narrow = false;
        for (let s = 0.25 * D; s <= 8 * c; s += 0.25 * D) {
          const x = x0 + ux * s, y = y0 + uy * s;
          if (mirror && y > -0.5 * D) break;
          const dIn = inAt(x, y);
          if (dIn < stub) narrow = true;
          if (pipeModuleSdf(m, x, y) > -inset) continue;
          if (!shallow || s < shallow.s) shallow = { s, x, y };
          if (narrow) break;
          if (dIn < deep) continue;
          if (!best || s < best.s - 1e-9) best = { s, x, y };
          if (d === straight) bestS = { s, x, y };
          break;
        }
      }
      if (bestS && best && bestS.s <= best.s * 1.35 + D) best = bestS;
      if (best) return { p: [best.x, best.y], ok: true };
      if (shallow) return { p: [shallow.x, shallow.y], ok: false };
      return { p: [m.x, mirror ? Math.min(m.y, -0.5 * D) : m.y], ok: false };
    };
    // cała szerokość wiązki w sylwetce (próbki co 1 jd — zapas głębokości generatora to komórka pola, 2 jd)
    /**
     * Rogi łamanej przy urządzeniu (od urządzenia): przyłącze; urządzenie z KANAŁEM SERWISOWYM — przyłącze na osi kanału
     * i koniec kanału (ostatni odcinek biegnie całym kanałem, prosto do urządzenia), róg komórki startu przy końcu
     * kanału odpada (`drop`).
     */
    const terminalCorners = (dev, k, nextK, cellCorner) => {
      const m = modules[dev];
      const ch = chanOf(m);
      if (!ch) return { pts: [anchorFor(dev, k, nextK).p], drop: false };
      const cr = Math.cos(m.rot || 0), sr = Math.sin(m.rot || 0);
      const at = (lx) => [m.x + lx * cr, m.y + lx * sr];
      const A = at(ch.dir * (m.w - T.anchorDu * D));
      const lc = (ch.x - m.x) * cr + (ch.y - m.y) * sr;                       // środek kanału na osi modułu
      const F = at(lc + ch.dir * (ch.w - Math.min(0.5 * c, 0.4 * ch.w)));     // tuż przed dalszym końcem kanału
      const drop = cellCorner && Math.hypot(cellCorner[0] - F[0], cellCorner[1] - F[1]) < 1.5 * c;
      return { pts: [A, F], drop };
    };
    const fitsHull = (poly, hwJ) => {
      const need = hwJ + T.marginDu * D;
      for (let q = 0; q + 1 < poly.length; q++) {
        const a = poly[q], b = poly[q + 1];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const n = Math.max(1, Math.ceil(L / D));
        for (let t = 0; t <= n; t++) if (inAt(a[0] + (b[0] - a[0]) * t / n, a[1] + (b[1] - a[1]) * t / n) < need) return false;
      }
      return true;
    };
    /** Ślad wiązki w polu wolnego miejsca (fo) i w koszcie tras następnych sieci (pen). */
    const stamp = (polyIn, hwJ) => {
      const reach = hwJ + 6 * D;
      // długie odcinki w kawałkach ≤ 16 jd (pudło kawałka, nie całego odcinka)
      const poly = [polyIn[0]];
      for (let q = 1; q < polyIn.length; q++) {
        const a = polyIn[q - 1], b = polyIn[q];
        const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (16 * D)));
        for (let t = 1; t <= n; t++) poly.push([a[0] + (b[0] - a[0]) * t / n, a[1] + (b[1] - a[1]) * t / n]);
      }
      for (let q = 0; q + 1 < poly.length; q++) {
        const a = poly[q], b = poly[q + 1];
        const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
        const seg = (x, y) => {
          const t = L2 > 1e-12 ? clamp(((x - a[0]) * vx + (y - a[1]) * vy) / L2, 0, 1) : 0;
          const ex = x - a[0] - vx * t, ey = y - a[1] - vy * t;
          return Math.sqrt(ex * ex + ey * ey);
        };
        const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - reach) / cf) - fx0), i1 = Math.min(FW - 1, Math.ceil((Math.max(a[0], b[0]) + reach) / cf) - fx0);
        const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - reach) / cf) - fy0), j1 = Math.min(FH - 1, Math.ceil((Math.max(a[1], b[1]) + reach) / cf) - fy0);
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const v = seg((fx0 + i) * cf, (fy0 + j) * cf) - hwJ;
          const k = j * FW + i;
          if (v < fo[k]) fo[k] = v;
        }
        const ci0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - reach) / c) - gx0), ci1 = Math.min(GW - 1, Math.ceil((Math.max(a[0], b[0]) + reach) / c) - gx0);
        const cj0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - reach) / c) - gy0), cj1 = Math.min(GH - 1, Math.ceil((Math.max(a[1], b[1]) + reach) / c) - gy0);
        for (let j = cj0; j <= cj1; j++) for (let i = ci0; i <= ci1; i++) {
          const k = j * GW + i;
          if (seg(cxOf(k), cyOf(k)) < hwJ + 0.45 * c) pen[k] = Math.max(pen[k], C.occ);
        }
      }
    };

    // węzły grafu (lustro: osobne węzły), przyłącza z urządzeniem
    const nodeIds = new Map();
    const addNode = (key, x, y, dev, net) => {
      let id = nodeIds.get(key);
      if (id === undefined) { id = graph.nodes.length; graph.nodes.push({ x, y, dev, net }); nodeIds.set(key, id); }
      return id;
    };

    for (const id of HD_NETS) {
      const items = itemsOf(id);
      if (!coresHalf.length || !items.length) continue;
      let tq = now();
      const R = routeNet(id, items);
      tm[`trasy_${id}`] = now() - tq; tq = now();
      if (!R.routed) continue;
      const { links, cnt, term } = R;
      // ── biegi: odcinki drzewa między węzłami (stopień ≠ 2, przyłącze albo zmiana obciążenia) ──
      const deg = (k) => { let n = 0, l = links[k]; while (l) { n += l & 1; l >>= 1; } return n; };
      const isNode = (k) => {
        if (term[k] >= 0 || deg(k) !== 2) return true;
        let a = -1;
        for (let d = 0; d < 8; d++) if (links[k] & (1 << d)) { const v = cnt[k * 8 + d]; if (a < 0) a = v; else if (Math.abs(v - a) > 1e-6) return true; }
        return false;
      };
      const seen = new Uint8Array(N * 8);
      const rawRuns = [];
      for (let k = 0; k < N; k++) {
        if (!links[k] || !isNode(k)) continue;
        for (let d = 0; d < 8; d++) {
          if (!(links[k] & (1 << d)) || seen[k * 8 + d]) continue;
          const cells = [k];
          let cur = k, dir = d, count = 0;
          for (let guard = 0; guard < N; guard++) {
            const nk = cur + DY[dir] * GW + DX[dir];
            seen[cur * 8 + dir] = 1;
            seen[nk * 8 + ((dir + 4) & 7)] = 1;
            count = Math.max(count, cnt[cur * 8 + dir]);
            cells.push(nk);
            cur = nk;
            if (isNode(cur)) break;
            let nd = -1;
            for (let e = 0; e < 8; e++) if ((links[cur] & (1 << e)) && e !== ((dir + 4) & 7)) { nd = e; break; }
            if (nd < 0) break;
            dir = nd;
          }
          rawRuns.push({ cells, count: Math.max(1, count) });
        }
      }
      const sq = seqOf(id);
      const kScale = 0.5 + 0.5 * Math.min(2, density);
      const setN = (rr, n) => {
        rr.n = n;
        rr.radii = sq.radii.slice(0, n);
        rr.halfW = bundleHalfW(rr.radii, sq.gap);
        rr.rMax = Math.max(...rr.radii);
      };
      const nodeInfo = new Map();     // komórka węzła (nie przyłącza) → { halfW, x, y, deg, runs }
      for (const rr of rawRuns) {
        setN(rr, clamp(Math.round((1 + T.pipesK * Math.log2(1 + rr.count)) * kScale), 1, T.maxPipes));
        rr.nBase = rr.n;
        for (const e of [rr.cells[0], rr.cells[rr.cells.length - 1]]) {
          if (term[e] >= 0) continue;
          const ni = nodeInfo.get(e) || { halfW: 0, runs: [] };
          ni.halfW = Math.max(ni.halfW, rr.halfW);
          ni.runs.push(rr);
          nodeInfo.set(e, ni);
        }
      }
      // węzły: przesunięte w stronę wolnego miejsca (wiązka mieści się w rowie, obok wcześniejszych sieci)
      for (const [k, ni] of nodeInfo) {
        let x = cxOf(k), y = cyOf(k);
        const need = (ni.halfW + T.clearDu) * D;
        const x0 = x, y0 = y;
        if (clrAt(x, y) > -2 * D) {
          for (let it = 0; it < 14; it++) {
            const v = clrAt(x, y);
            if (v >= need) break;
            const h = D;
            let gxv = clrAt(x + h, y) - clrAt(x - h, y), gyv = clrAt(x, y + h) - clrAt(x, y - h);
            const gl = Math.hypot(gxv, gyv);
            if (gl < 1e-6) break;
            gxv /= gl; gyv /= gl;
            const st = Math.min(need - v, 1.5 * D);
            x += gxv * st; y += gyv * st;
            const dd = Math.hypot(x - x0, y - y0), lim = T.shiftDu * D;
            if (dd > lim) { x = x0 + (x - x0) * lim / dd; y = y0 + (y - y0) * lim / dd; break; }
          }
        }
        // oś wiązki w sylwetce z zapasem całej szerokości (węzeł przy burcie — w głąb)
        for (let it = 0; it < 10 && inAt(x, y) < (ni.halfW + T.marginDu) * D; it++) {
          let gxv = inAt(x + D, y) - inAt(x - D, y), gyv = inAt(x, y + D) - inAt(x, y - D);
          const gl = Math.hypot(gxv, gyv);
          if (gl < 1e-6) break;
          x += gxv / gl * D; y += gyv / gl * D;
        }
        if (mirror && y > -0.2 * D) y = -0.2 * D;
        ni.x = x; ni.y = y;
        ni.deg = deg(k);
        ni.cell = k;
      }
      const netRuns = [];
      for (const rr of rawRuns) {
        const cells = rr.cells, last = cells.length - 1;
        // rogi trasy na środkach komórek (zmiany kierunku) → schodki wyprostowane → przyłącza urządzeń na końcach
        const pts = [];
        for (let q = 0; q <= last; q++) {
          const k = cells[q];
          if (q > 0 && q < last && dirOf(cells[q - 1], k) === dirOf(k, cells[q + 1])) continue;
          pts.push([cxOf(k), cyOf(k)]);
        }
        let corners = straightenOctilinear(pts, pathCost);
        const kA = cells[0], kB = cells[last];
        const devA = term[kA], devB = term[kB];
        let A, B;
        if (devA >= 0) {
          const tc = terminalCorners(devA, kA, cells[1], corners[0]);
          if (tc.drop) corners.shift();
          A = tc.pts[0]; corners.unshift(...tc.pts);
        } else { const n0 = nodeInfo.get(kA); A = [n0.x, n0.y]; }
        if (devB >= 0) {
          const tc = terminalCorners(devB, kB, cells[last - 1], corners[corners.length - 1]);
          if (tc.drop) corners.pop();
          B = tc.pts[0]; corners.push(...tc.pts.slice().reverse());
        } else { const n1 = nodeInfo.get(kB); B = [n1.x, n1.y]; }
        corners = dropCollinear(corners);
        rr.corners = corners;
        rr.A = A; rr.B = B; rr.devA = devA; rr.devB = devB;
        rr.nodeA = devA >= 0 ? null : nodeInfo.get(kA);
        rr.nodeB = devB >= 0 ? null : nodeInfo.get(kB);
        const place = () => {
          rr.pts = offsetRun(rr.corners, A, B, rr.halfW, D, T, clrAt, fsAt, inAt, mirror);
          rr.poly = filletPolyline(rr.pts, Math.max(T.filletK * (rr.halfW + rr.rMax), 2.2) * D);
        };
        place();
        // pojemność rowu (tylko rury): wiązka nie szersza niż rów i wypełnia co najmniej fillShare jego szerokości —
        // najwyżej fillExtra rur ponad obciążenie (grubość dalej z liczby tras)
        if (id !== 'power') {
          const capW = runGapWidth(rr.pts, D, clrAt);
          if (capW > 0) {
            let w = 0, nCap = 0;
            for (let k2 = 0; k2 < T.maxPipes; k2++) {
              const add = 2 * sq.radii[k2] + (k2 ? sq.gap : 0);
              if (w + add > capW - 2 * T.clearDu) break;
              w += add; nCap++;
            }
            nCap = Math.max(1, nCap);
            const nMin = Math.min(nCap, rr.nBase + T.fillExtra, Math.max(1, Math.round(T.fillShare * nCap)));
            const n2 = clamp(rr.n, nMin, Math.max(nCap, 1));
            if (n2 !== rr.n) { setN(rr, n2); place(); }
          }
        }
        // cała szerokość wiązki w sylwetce z zapasem — inaczej cieńsza wiązka, potem cieńsze rury
        while (!fitsHull(rr.poly, rr.halfW * D) && rr.n > 1) { setN(rr, rr.n - 1); place(); stats.shrunk++; }
        for (let sc = 0.7; sc > 0.3 && !fitsHull(rr.poly, rr.halfW * D); sc -= 0.2) {
          rr.radii = rr.radii.map((r) => r * sc); rr.halfW = bundleHalfW(rr.radii, sq.gap * sc); rr.rMax = Math.max(...rr.radii);
          place(); stats.shrunk++;
        }
        if (!fitsHull(rr.poly, rr.halfW * D)) stats.outside++;
        netRuns.push(rr);
      }
      // biegi do wyjścia (przy nadmiarze odpadają najmniej obciążone) — węzły grafu na końcach łamanych
      netRuns.sort((a, b) => b.count - a.count || a.cells[0] - b.cells[0]);
      const room = T.maxRuns - Math.min(T.maxRuns - 1, manual.length) - runs.length;
      const keep = netRuns.slice(0, Math.max(0, room));
      const out = [];
      for (const rr of keep) {
        const polys = [rr.poly];
        const endIds = (mir) => [[rr.devA, rr.cells[0], rr.A], [rr.devB, rr.cells[rr.cells.length - 1], rr.B]].map(([dev, cell, P]) => {
          const y = mir ? -P[1] : P[1];
          if (dev >= 0) return addNode(`${id}:t:${mir ? 1 : 0}:${dev}:${cell}`, P[0], y, mir ? mirrorIdx(dev) : dev, id);
          return addNode(`${id}:n:${mir ? 1 : 0}:${cell}`, P[0], y, -1, id);
        });
        const ends = [endIds(false)];
        if (mirror) { polys.push(rr.poly.map(([x, y]) => [x, -y])); ends.push(endIds(true)); }
        const run = {
          net: id, radii: rr.radii, halfW: rr.halfW, gap: sq.gap, rMax: rr.rMax, mat: sq.mat, over: false,
          phase: rand() * T.clampDu * D, count: rr.count, n: rr.n, polys, ends, auto: true
        };
        runs.push(run);
        out.push({ run, rr });
        stamp(rr.poly, rr.halfW * D);
      }
      // ── osprzęt sieci ──
      // wejście rury do każdej gondoli MAIN ma być widać — gondola bez widocznego wejścia (np. szyjka za wąskim pasem
      // płyty) dostaje kanał serwisowy (z kopią lustra), a sieć liczy się od nowa (od razu po rurach do silników)
      if (id === 'feed' && !tuneIn._engChan) {
        for (const { run: r } of out) {
          r.ends[0].forEach((nid, end) => {
            const dev = graph.nodes[nid].dev;
            if (!(dev >= 0) || modules[dev].type !== 'engine' || engChan.has(modules[dev])) return;
            if (fuelEndVisible(r.polys[0], end, modules[dev], D, visAt, r.halfW * D).ok) return;
            (hiddenMain || (hiddenMain = new Set())).add(modules[dev]).add(modules[mirrorIdx(dev)]);
          });
        }
        if (hiddenMain) break;
      }
      autoFittings(id, out, fits, { D, T, rand, visAt, clrAt, mirror, modules });
      tm[`biegi_${id}`] = now() - tq;
    }
    stats.systems = { cores: systems.cores.length, tanks: systems.tanks.length, mains: systems.mains.length, sides: systems.sides.length, consumers: systems.consumers.length };
  }

  // ── rury ręczne: bieg na rurę (kopia lustra w tym samym biegu); domyślnie leżą też na płytach ──
  const bySrc = new Map();
  for (const p of manual) {
    const key = p.src ?? p;
    if (!bySrc.has(key)) bySrc.set(key, []);
    bySrc.get(key).push(p);
  }
  let mi = 0;
  for (const list of bySrc.values()) {
    if (runs.length >= T.maxRuns) break;
    const p = list[0];
    const r = rng((design.seed || 7) * 131 + (++mi) * 7177);
    const n = clamp(p.n || 3, 1, 8);
    const scale = p.r || 1;
    let radii = pipeRadii(r, n, scale);
    const mat = Math.max(0, HD_PIPE_MATS.indexOf(p.mat || 'mix'));
    const gap = (T.gap[0] + (T.gap[1] - T.gap[0]) * r()) * scale;
    const halfW = (radii.reduce((a, v) => a + 2 * v, 0) + gap * (n - 1)) * 0.5;
    const rMax = Math.max(...radii);
    const R = Math.max(T.filletK * (halfW + rMax), 2.2) * D;
    const polys = list.map((q) => filletPolyline(q.pts, R));
    radii = radii.slice(0, 8);
    runs.push({ net: 'manual', radii, halfW, gap, rMax, mat, over: p.over !== false, phase: r() * T.clampDu * D, count: n, n, polys, auto: false });
    // zaślepki na końcach (widocznych)
    for (const poly of polys) {
      for (const end of [0, 1]) {
        const a = end ? poly[poly.length - 1] : poly[0], b = end ? poly[poly.length - 2] : poly[1];
        if (!b) continue;
        const rot = Math.atan2(a[1] - b[1], a[0] - b[0]);
        fits.push({ type: HD_PIPE_FIT.cap, x: a[0] - Math.cos(rot) * 0.6 * D, y: a[1] - Math.sin(rot) * 0.6 * D, rot, hw: 0.9, hh: halfW + 0.6, p1: 0, p2: rMax + 0.5, over: p.over !== false });
      }
    }
  }
  // osprzęt: pierwszeństwo przy nakładaniu (później zapisany przykrywa wcześniejszy), limit
  // (sortowanie stabilne: kopia lustra zostaje tuż za oryginałem — przycięcie usuwa całe pary)
  fits.sort((a, b) => FIT_PRIO[a.type] - FIT_PRIO[b.type]);
  while (fits.length > T.maxFits || fits[0]?.mirrorOf) fits.shift();
  stats.runs = runs.length;
  stats.fits = fits.length;
  stats.ms = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  if (hiddenMain) {
    const again = buildPipeNetwork(field, { ...tuneIn, _engChan: new Set([...engChan, ...hiddenMain]), _cache: { fsMod, l0, fsBase, inAt } });
    again.stats.passes = 2;
    again.stats.ms += stats.ms;
    return again;
  }
  const channels = [];
  modules.forEach((m, i) => { if (engChan.has(m)) channels.push(i); });
  return { runs, fits, graph, channels, mirror, clampJ: T.clampDu * D, detail: D, stats };
}

/**
 * Kontrola sieci (testy, panel dema): wolne końce (koniec łamanej poza przyłączem urządzenia, który nie styka się
 * z innym biegiem), wiązki poza sylwetką (oś ± pół-szerokość bliżej krawędzi niż `marginDu` jd — próbki co pół jd,
 * próbka za płytka w próbniku siatki sprawdzana dokładnie pierścieniami w polu ramy),
 * urządzenia bez drogi do reaktora (kable) i silniki bez drogi paliwa ze zbiornika przez reaktor. `field` —
 * buildHullField z tą siecią. Zwraca { freeEnds, outside, unpowered: [indeksy modułów], unfueled: [...], runs }.
 */
export function pipeNetworkCheck(net, field, marginDu = 0.5) {
  const out = { freeEnds: 0, outside: 0, unpowered: [], unfueled: [], runs: 0, fuelEnds: { main: [0, 0], side: [0, 0], tank: [0, 0] }, fuelHidden: [] };
  if (!net) return out;
  const modules = field.expanded.modules;
  const D = net.detail;
  const S = fieldSampler(field);
  const obstacles = modules.filter(isObstacle);
  // widać z ziemi: rów maszynowni (nie płyta, nie moduł), wewnątrz sylwetki
  const engChan = new Set((net.channels || []).map((i) => modules[i]));
  const gapAt = armorGapSampler(field, S, modules, (m) => serviceChannel(m, D, engChan.has(m)));
  const visAt = (x, y) => gapAt(x, y) >= 0 && S(field.levels[0], x, y) < 0 && obstacles.every((m) => pipeModuleSdf(m, x, y) > 0);
  const inAt = insideDepthSampler(field, S, false);
  // próbnik siatki jest ostrożny (na szwie sumy brył pole ramy zaniża głębokość, transformata odejmuje komórkę) —
  // próbka za płytka sprawdzana dokładnie: w promieniu `need` żadnego punktu poza sylwetką (pierścienie co ¼ jd od
  // głębokości z pola ramy, które jej nie zawyża)
  const L0 = field.levels[0];
  const deepEnough = (x, y, need) => {
    if (inAt(x, y) >= need) return true;
    const raw = -S(L0, x, y);
    if (raw <= 0) return false;
    const st = 0.25 * D;
    for (let r = Math.max(st, raw - D); ; r += st) {
      const rr = Math.min(r, need);
      const n = Math.max(8, Math.ceil(2 * Math.PI * rr / st));
      for (let a = 0; a < n; a++) {
        const th = a * 2 * Math.PI / n;
        if (S(L0, x + Math.cos(th) * rr, y + Math.sin(th) * rr) > 0) return false;
      }
      if (rr >= need) return true;
    }
  };
  const deg = new Map();
  const adj = new Map();
  const edge = (net2, a, b) => {
    for (const [p, q] of [[a, b], [b, a]]) {
      const key = `${net2}:${p}`;
      if (!adj.has(key)) adj.set(key, []);
      adj.get(key).push(q);
    }
    deg.set(a, (deg.get(a) || 0) + 1);
    deg.set(b, (deg.get(b) || 0) + 1);
  };
  for (const r of net.runs) {
    if (!r.auto) continue;
    out.runs++;
    r.polys.forEach((poly, pi) => {
      const [a, b] = r.ends[pi];
      edge(r.net, a, b);
      // cała szerokość wiązki z zapasem wewnątrz sylwetki
      const need = (r.halfW + marginDu) * D;
      let bad = false;
      for (let q = 0; q + 1 < poly.length && !bad; q++) {
        const p0 = poly[q], p1 = poly[q + 1];
        const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        const n = Math.max(1, Math.ceil(L / (0.5 * D)));
        for (let t = 0; t <= n; t++) if (!deepEnough(p0[0] + (p1[0] - p0[0]) * t / n, p0[1] + (p1[1] - p0[1]) * t / n, need)) { bad = true; break; }
      }
      if (bad) out.outside++;
    });
  }
  const nodes = net.graph?.nodes || [];
  for (const [id, d] of deg) if (d === 1 && !(nodes[id]?.dev >= 0)) out.freeEnds++;
  // przyłącza rur paliwa (gondola MAIN, dysza SIDE, zbiornik): widoczne wg fuelEndVisible (licznik [widoczne,
  // wszystkie] — łamane po burcie y ≤ 0 i bez lustra)
  for (const r of net.runs) {
    if (!r.auto || r.net === 'power') continue;
    r.polys.forEach((poly, pi) => {
      if (pi > 0) return;
      r.ends[pi].forEach((id, end) => {
        const dev = nodes[id]?.dev;
        if (!(dev >= 0)) return;
        const m = modules[dev];
        const key = m.type === 'engine' ? 'main' : (m.type === 'thruster_side' ? 'side' : (m.type === 'fuel_tank' ? 'tank' : null));
        if (!key) return;
        const v = fuelEndVisible(poly, end, m, D, visAt, r.halfW * D);
        out.fuelEnds[key][1]++;
        if (v.ok) out.fuelEnds[key][0]++;
        else out.fuelHidden.push({ dev, type: m.type, net: r.net, seen: v.seen, of: v.of });
      });
    });
  }
  // drogi: urządzenie → reaktor (kable), silnik → reaktor (rury do silników) i reaktor → zbiornik (dopływ)
  const reach = (netId, from, ok) => {
    const seenN = new Set([from]);
    const q = [from];
    for (let i = 0; i < q.length; i++) {
      const v = q[i];
      if (i > 0 && nodes[v].dev >= 0 && ok(modules[nodes[v].dev])) return true;
      if (i > 0 && nodes[v].dev >= 0) continue;     // przez urządzenie trasa nie przechodzi
      for (const w of adj.get(`${netId}:${v}`) || []) if (!seenN.has(w)) { seenN.add(w); q.push(w); }
    }
    return false;
  };
  const termsOf = (netId, dev) => nodes.map((n, i) => (n.net === netId && n.dev === dev ? i : -1)).filter((i) => i >= 0);
  const sys = hullDesignSystems(modules);
  if (!sys.cores.length) return out;
  const isCore = (m) => m.type === 'reactor';
  for (const i of sys.consumers) if (!termsOf('power', i).some((t) => reach('power', t, isCore))) out.unpowered.push(i);
  const tankReachesCore = sys.cores.some((ci) => termsOf('supply', ci).some((t) => reach('supply', t, (m) => m.type === 'fuel_tank')));
  for (const i of [...sys.mains, ...sys.sides]) {
    if (!tankReachesCore || !termsOf('feed', i).some((t) => reach('feed', t, isCore))) out.unfueled.push(i);
  }
  return out;
}

/**
 * Schodki trasy A* → odcinki ośmiokierunkowe (proste i 45°): od każdego rogu najdalszy róg, do którego da się dojść
 * jednym odcinkiem albo dwoma (ukośny + prosty, w dowolnej kolejności) nie drożej niż trasą A* (× 1,08) — jak wiązki
 * w czystych sprite'ach TN (Bellator): długa prosta, kolano 45°, prosta. Trasa A* po siatce komórek ma schodek przy
 * każdym ząbku ściany rowu (obrys z zaszumionego sprite'a), stąd dawny zygzak.
 */
function straightenOctilinear(pts, pathCost) {
  const n = pts.length;
  if (n <= 2) return pts.map((p) => [p[0], p[1]]);
  // koszt trasy A* między rogami: sumy prefiksowe odcinków (odcinki zakazane liczone osobno)
  const pre = new Float64Array(n), inf = new Int32Array(n);
  for (let q = 1; q < n; q++) {
    const v = pathCost([pts[q - 1], pts[q]]);
    pre[q] = pre[q - 1] + (v < Infinity ? v : 0);
    inf[q] = inf[q - 1] + (v < Infinity ? 0 : 1);
  }
  const octi = (a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (ax < 1e-6 || ay < 1e-6 || Math.abs(ax - ay) < 1e-6) return [[a, b]];
    const sx = Math.sign(dx), sy = Math.sign(dy), dg = Math.min(ax, ay);
    return [[a, [a[0] + sx * dg, a[1] + sy * dg], b], [a, [b[0] - sx * dg, b[1] - sy * dg], b]];
  };
  const out = [[pts[0][0], pts[0][1]]];
  let i = 0;
  while (i < n - 1) {
    let next = i + 1, chosen = null;
    for (let j = n - 1; j >= i + 2 && !chosen; j--) {
      if (inf[j] - inf[i] > 0) continue;
      const base = pre[j] - pre[i];
      let bestV = Infinity;
      for (const cand of octi(pts[i], pts[j])) {
        const v = pathCost(cand);
        if (v <= base * 1.08 + 1e-6 && v < bestV) { bestV = v; chosen = cand; next = j; }
      }
    }
    if (chosen) for (let q = 1; q < chosen.length; q++) out.push([chosen[q][0], chosen[q][1]]);
    else out.push([pts[next][0], pts[next][1]]);
    i = next;
  }
  return dropCollinear(out);
}

/** Łamana bez zerowych odcinków i punktów współliniowych (także zawrotów w miejscu); końce zostają. */
function dropCollinear(pts) {
  const out = [pts[0]];
  for (let q = 1; q < pts.length; q++) {
    const p = pts[q], a = out[out.length - 1];
    const la = Math.hypot(p[0] - a[0], p[1] - a[1]);
    if (la < 1e-6) { if (q === pts.length - 1) out[out.length - 1] = p; continue; }
    if (q < pts.length - 1) {
      const b = pts[q + 1];
      const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
      const cr = (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]);
      if (lb > 1e-6 && Math.abs(cr) <= 1e-9 * la * lb) continue;
    }
    out.push(p);
  }
  return out;
}

/** Bez zawrotów: punkt, w którym łamana zawraca (> ~155°), wypada (zabezpieczenie po przesunięciach). */
function dropFolds(pts) {
  let out = pts;
  for (let guard = 0; guard < pts.length; guard++) {
    let hit = -1;
    for (let q = 1; q + 1 < out.length && hit < 0; q++) {
      const a = out[q - 1], p = out[q], b = out[q + 1];
      const ux = p[0] - a[0], uy = p[1] - a[1], vx = b[0] - p[0], vy = b[1] - p[1];
      const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
      if (lu < 1e-6 || lv < 1e-6 || ux * vx + uy * vy < -0.9 * lu * lv) hit = q;
    }
    if (hit < 0) break;
    out = out.filter((_, q) => q !== hit);
  }
  return out;
}

/**
 * Wiązka w rowie: STAŁE przesunięcie w poprzek na każdy prosty odcinek trasy, rogi = przecięcia przesuniętych prostych
 * (kolana zostają 45° / 90°, wiązka biegnie równolegle do ściany — bez falowania za ząbkami obrysu). Przesunięcie
 * odcinka: najmniejsze, przy którym wiązka ma luz od ścian i od wcześniejszych sieci (`clrAt`) na całej widocznej
 * długości odcinka (`geoAt` — pole geometrii; pod płytą — bez wymagań), a CAŁA szerokość na całej długości leży
 * w sylwetce z zapasem; bez takiego — najlepszy luz. Odcinek końcowy biegnie przez swój węzeł (węzeł przesunięty
 * w wolne miejsce, wspólny dla biegów rozgałęzienia; przyłącze urządzenia), a gdy tam nie ma luzu — wchodzi na swoją
 * prostą kolanem 45° tuż za węzłem. Odcinek odwrócony przez przesunięcia: kolano przy węźle znika, odcinek końcowy za
 * węzłem odpada, środkowy — sąsiad przesunięty tak, by odcinek miał długość zero.
 */
function offsetRun(corners, A, B, halfW, D, T, clrAt, geoAt, inAt, mirror) {
  const m = corners.length;
  if (m < 2) return [[A[0], A[1]], [B[0], B[1]]];
  const segs = [];
  for (let s = 0; s + 1 < m; s++) {
    const a = corners[s], b = corners[s + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
    segs.push({ a, L, ux, uy, nx: -uy, ny: ux, o: 0 });
  }
  const ns = segs.length;
  const clear = T.clearDu * D, maxS = T.shiftDu * D, hw = halfW * D, jogMin = 0.25 * D;
  const inNeed = hw + (T.marginDu ?? 0.6) * D;
  const S0 = segs[0], S1 = segs[ns - 1];
  // węzły względem prostych odcinków końcowych: przesunięcie w poprzek (o) i położenie wzdłuż (t)
  const oA = (A[0] - S0.a[0]) * S0.nx + (A[1] - S0.a[1]) * S0.ny;
  const tA = (A[0] - S0.a[0]) * S0.ux + (A[1] - S0.a[1]) * S0.uy;
  const oB = (B[0] - S1.a[0]) * S1.nx + (B[1] - S1.a[1]) * S1.ny;
  const tB = (B[0] - S1.a[0]) * S1.ux + (B[1] - S1.a[1]) * S1.uy;
  const fit = (g, pref, t0, t1) => {
    const lo = clamp(t0, 0, g.L), hi = clamp(t1, lo, g.L);
    const n = Math.max(2, Math.round((hi - lo) / (2 * D)));
    const all = [], vis = [];
    for (let q = 0; q <= n; q++) {
      const t = lo + (hi - lo) * q / n;
      const x = g.a[0] + g.ux * t, y = g.a[1] + g.uy * t;
      all.push(x, y);
      if (geoAt(x, y) >= -1.5 * D) vis.push(x, y);
    }
    const score = (o) => {
      for (let q = 0; q < all.length; q += 2) if (inAt(all[q] + g.nx * o, all[q + 1] + g.ny * o) < inNeed) return -Infinity;
      let v = Infinity;
      for (let q = 0; q < vis.length; q += 2) {
        const cx = vis[q] + g.nx * o, cy = vis[q + 1] + g.ny * o;
        const cl = Math.min(clrAt(cx + g.nx * hw, cy + g.ny * hw), clrAt(cx - g.nx * hw, cy - g.ny * hw), clrAt(cx, cy) - hw);
        if (cl < v) v = cl;
      }
      return v;
    };
    let bestO = pref.length ? pref[0] : 0, bestV = -Infinity;
    const ok = (o) => {
      const v = score(o);
      if (v >= clear) return true;
      if (v > bestV + 1e-6) { bestV = v; bestO = o; }
      return false;
    };
    for (const o of pref) if (ok(o)) return o;
    for (let k = 0; k * 0.5 * D <= maxS + 1e-6; k++) {
      const o = k * 0.5 * D;
      if (ok(o)) return o;
      if (k && ok(-o)) return -o;
    }
    return bestO;
  };
  if (ns === 1) S0.o = fit(S0, [oA, oB, (oA + oB) * 0.5], tA, tB);
  else {
    S0.o = fit(S0, [oA], tA, S0.L);
    S1.o = fit(S1, [oB], 0, tB);
    for (let s = 1; s < ns - 1; s++) segs[s].o = fit(segs[s], [], 0, segs[s].L);
  }
  let jogA = true, jogB = true;
  const meet = (g, h) => {
    const px = g.a[0] + g.nx * g.o, py = g.a[1] + g.ny * g.o;
    const qx = h.a[0] + h.nx * h.o, qy = h.a[1] + h.ny * h.o;
    const den = g.ux * h.uy - g.uy * h.ux;
    const t = ((qx - px) * h.uy - (qy - py) * h.ux) / den;
    return [px + g.ux * t, py + g.uy * t];
  };
  const along = (g, p) => (p[0] - g.a[0]) * g.ux + (p[1] - g.a[1]) * g.uy;
  const jA = () => (jogA && Math.abs(S0.o - oA) > jogMin ? Math.abs(S0.o - oA) : 0);
  const jB = () => (jogB && Math.abs(S1.o - oB) > jogMin ? Math.abs(S1.o - oB) : 0);
  /** Długość odcinka s wzdłuż jego kierunku (z kolanami przy węzłach). */
  const span = (s) => {
    const g = segs[s];
    const t0 = s === 0 ? tA + jA() : along(g, meet(segs[s - 1], g));
    const t1 = s === ns - 1 ? tB - jB() : along(g, meet(g, segs[s + 1]));
    return t1 - t0;
  };
  for (let guard = 0; guard < 3 * ns + 4; guard++) {
    let bad = -1;
    for (let s = 0; s < ns && bad < 0; s++) if (span(s) < -1e-6) bad = s;
    if (bad < 0) break;
    const end0 = bad === 0, end1 = bad === ns - 1;
    if (end0 && jA() > 0) { jogA = false; S0.o = oA; continue; }
    if (end1 && jB() > 0) { jogB = false; S1.o = oB; continue; }
    if (ns === 1) return [[A[0], A[1]], [B[0], B[1]]];
    if (end0) return offsetRun(corners.slice(1), A, B, halfW, D, T, clrAt, geoAt, inAt, mirror);
    if (end1) return offsetRun(corners.slice(0, -1), A, B, halfW, D, T, clrAt, geoAt, inAt, mirror);
    // środkowy: przesunięcie sąsiada (najpierw nie-końcowego) tak, by odcinek miał długość zero (długość liniowa w o)
    const fixWith = (h) => {
      const o0 = h.o, v0 = span(bad);
      h.o = o0 + D;
      const k = span(bad) - v0;
      h.o = Math.abs(k) > 1e-9 ? o0 - v0 / k * D : o0;
      if (span(bad) < -1e-6) { h.o = o0; return false; }
      return true;
    };
    const left = segs[bad - 1], right = segs[bad + 1];
    const order = bad - 1 === 0 ? [right, left] : [left, right];
    if (!fixWith(order[0]) && !fixWith(order[1])) break;
  }
  const pts = [[A[0], A[1]]];
  const dA = S0.o - oA, dB = S1.o - oB;
  if (jA() > 0) pts.push([A[0] + S0.ux * Math.abs(dA) + S0.nx * dA, A[1] + S0.uy * Math.abs(dA) + S0.ny * dA]);
  for (let s = 0; s + 1 < ns; s++) pts.push(meet(segs[s], segs[s + 1]));
  if (jB() > 0) pts.push([B[0] - S1.ux * Math.abs(dB) + S1.nx * dB, B[1] - S1.uy * Math.abs(dB) + S1.ny * dB]);
  pts.push([B[0], B[1]]);
  if (mirror) for (const p of pts) if (p[1] > -0.2 * D) p[1] = -0.2 * D;
  // AGENT: bieg zerowej długości (A ≈ B) zwija się w dropCollinear do jednego punktu — osprzęt i rysunek potrzebują
  // co najmniej dwóch (bieg o długości zero niczego nie rysuje, ale końce zostają w grafie)
  const out = dropFolds(dropCollinear(pts));
  return out.length >= 2 ? out : [[A[0], A[1]], [B[0], B[1]]];
}

/**
 * Szerokość rowu wzdłuż łamanej [jd]: mediana (w poprzek: od ściany do ściany pola wolnego miejsca) w punktach
 * widocznych co 2 jd; 0, gdy widoczna jest mniej niż ćwierć długości.
 */
function runGapWidth(pts, D, fsAt) {
  const ws = [];
  let total = 0;
  for (let s = 0; s + 1 < pts.length; s++) {
    const a = pts[s], b = pts[s + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) continue;
    const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
    const n = Math.max(1, Math.round(L / (2 * D)));
    for (let q = 0; q < n; q++) {
      total++;
      const t = (q + 0.5) / n;
      const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      if (fsAt(x, y) < 0.3 * D) continue;
      let wp = 0, wm = 0;
      while (wp < 40 * D && fsAt(x + nx * wp, y + ny * wp) > 0) wp += 0.5 * D;
      while (wm < 40 * D && fsAt(x - nx * wm, y - ny * wm) > 0) wm += 0.5 * D;
      ws.push((wp + wm) / D);
    }
  }
  if (ws.length < total * 0.25 || ws.length < 3) return 0;
  ws.sort((p, q) => p - q);
  return ws[ws.length >> 1];
}

/** Próbnik łamanej po długości łuku (sumy prefiksowe, wyszukiwanie binarne): at(s) → { x, y, rot }, L. */
function polyWalker(poly) {
  const n = poly.length;
  const acc = new Float64Array(n);
  for (let i = 1; i < n; i++) acc[i] = acc[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]);
  const L = acc[n - 1];
  const at = (s) => {
    if (n < 2) return { x: poly[0][0], y: poly[0][1], rot: 0 };
    let lo = 0, hi = n - 2;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (acc[mid] <= s) lo = mid; else hi = mid - 1; }
    const a = poly[lo], b = poly[lo + 1];
    const len = acc[lo + 1] - acc[lo];
    const t = len > 0 ? clamp((s - acc[lo]) / len, 0, 1) : 0;
    return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, rot: Math.atan2(b[1] - a[1], b[0] - a[0]) };
  };
  return { at, L };
}

/**
 * Osprzęt sieci `net` (tylko burta y ≤ 0 przy lustrze — kopia lustra na końcu): rozgałęzienia (rury — skrzynka
 * rozdzielcza albo obejma-trójnik, kable — puszka), przejścia rów ↔ płyta (rury — kołnierz, kable — przepust), zawory
 * i pompy na długich odcinkach rur, puszki na długich odcinkach kabli, PRZYŁĄCZA przy urządzeniach (rury — kołnierz,
 * przy zbiorniku pompa, przy gondoli kolektor; kable — dławnica; reaktor bez bryły — rozdzielnia na końcu pnia).
 */
function autoFittings(net, list, fits, ctx) {
  const { D, T, rand, visAt, clrAt, mirror, modules } = ctx;
  const cable = net === 'power';
  const own = [];
  const free = (x, y, r) => own.every((f) => Math.hypot(f.x - x, f.y - y) > (r + Math.max(f.hw, f.hh) * D) * 0.8);
  const put = (f) => { own.push(f); };
  // rozgałęzienia (stopień ≥ 3), oś = bieg o największym obciążeniu
  const nodes = new Map();
  for (const { run, rr } of list) {
    const poly = run.polys[0];
    for (const [nd, end] of [[rr.nodeA, 0], [rr.nodeB, 1]]) {
      if (!nd || nd.deg < 3) continue;
      if (!nodes.has(nd)) nodes.set(nd, []);
      nodes.get(nd).push({ run, poly, end });
    }
  }
  for (const [nd, items] of nodes) {
    if (!visAt(nd.x, nd.y)) continue;
    items.sort((a, b) => b.run.count - a.run.count);
    const main = items.find((e) => e.poly.length >= 2);     // oś z biegu, który ma odcinek
    if (!main) continue;
    const p = main.end ? main.poly[main.poly.length - 2] : main.poly[1];
    const rot = Math.atan2(p[1] - nd.y, p[0] - nd.x);
    let side = 0, total = 0;
    for (const e of items.slice(1)) side = Math.max(side, e.run.halfW);
    for (const e of items) total += e.run.n;
    if (cable) {
      // puszka kablowa: płaska skrzynka z pokrywą i dławnicami po bokach
      put({ type: HD_PIPE_FIT.jbox, x: nd.x, y: nd.y, rot, hw: Math.max(side + 1.2, 2.2), hh: main.run.halfW + 1.3, p1: 0, p2: main.run.rMax + 1.1 });
    } else if (total >= 6 || nd.deg >= 4) {
      const hw = Math.max(side + 1.4, 2.6), hh = main.run.halfW + 1.5;
      put({ type: HD_PIPE_FIT.box, x: nd.x, y: nd.y, rot, hw, hh, p1: total >= 9 && rand() < 0.4 ? 1 : 0, p2: main.run.rMax + 1.4 });
    } else {
      put({ type: HD_PIPE_FIT.collar, x: nd.x, y: nd.y, rot, hw: Math.max(1.3, side + 0.6), hh: main.run.halfW + 0.9, p1: 0, p2: main.run.rMax + 0.6 });
    }
  }
  // wzdłuż biegów: przejścia rów ↔ przykryte, zawory, pompy, puszki
  for (const { run: r } of list) {
    const pw = polyWalker(r.polys[0]);
    const L = pw.L;
    const st = 0.7 * D;
    let prevVis = null;
    let visRun = 0, nextValve = (cable ? T.boxDu : T.valveDu) * D * (0.45 + 0.6 * rand());
    for (let s = 0; s <= L; s += st) {
      const a = pw.at(s);
      const v = visAt(a.x, a.y);
      if (prevVis !== null && v !== prevVis) {
        // kołnierz / przepust po stronie widocznej, ~1 jd od przejścia
        const sv = v ? s + 0.9 * D : s - st - 0.9 * D;
        const b = pw.at(clamp(sv, 0, L));
        if (visAt(b.x, b.y) && free(b.x, b.y, (r.halfW + 0.8) * D)) put({ type: HD_PIPE_FIT.collar, x: b.x, y: b.y, rot: b.rot, hw: 1.1, hh: r.halfW + 0.75, p1: cable ? 2 : 0, p2: r.rMax + 0.55 });
      }
      visRun = v ? visRun + st : 0;
      if (v && visRun > 10 * D && s > nextValve && s < L - 8 * D && (cable || r.n >= 2)) {
        const b = pw.at(s - 4 * D);
        if (free(b.x, b.y, (r.halfW + 2) * D)) {
          const kindV = rand();
          if (cable) {
            if (kindV < 0.5) put({ type: HD_PIPE_FIT.jbox, x: b.x, y: b.y, rot: b.rot, hw: 1.8, hh: r.halfW + 1.2, p1: 1, p2: r.rMax + 1.0 });
          } else if (kindV < 0.45) put({ type: HD_PIPE_FIT.valve, x: b.x, y: b.y, rot: b.rot, hw: 2.0, hh: r.halfW + 1.2, p1: Math.min(1.8, r.halfW * 0.5 + 0.7), p2: r.rMax + 1.5 });
          else if (kindV < 0.8 || r.count < 4) put({ type: HD_PIPE_FIT.collar, x: b.x, y: b.y, rot: b.rot, hw: 1.6, hh: r.halfW + 0.8, p1: 1, p2: r.rMax + 0.6 });
          else put({ type: HD_PIPE_FIT.pump, x: b.x, y: b.y, rot: b.rot, hw: 2.6, hh: r.halfW + 2.0, p1: 0, p2: r.rMax + 2.0 });
        }
        nextValve = s + (cable ? T.boxDu : T.valveDu) * D * (0.7 + 0.6 * rand());
      }
      prevVis = v;
    }
  }
  // przyłącza urządzeń: miejsce, gdzie łamana wychodzi z obrysu modułu (widoczne) — od strony urządzenia
  for (const { run: r, rr } of list) {
    const poly = r.polys[0];
    const pw = polyWalker(poly);
    const L = pw.L;
    for (const [dev, end] of [[rr.devA, 0], [rr.devB, 1]]) {
      if (dev < 0) continue;
      const m = modules[dev];
      let hit = null;
      for (let s = 0; s <= L; s += 0.4 * D) {
        const a = pw.at(end ? L - s : s);
        if (pipeModuleSdf(m, a.x, a.y) > 0.4 * D) { hit = { ...a, s }; break; }
      }
      const drawn = isObstacle(m);
      if (!drawn) {
        // reaktor bez bryły (wewnątrz kadłuba): na końcu pnia rozdzielnia, gdy widać ją z rowu
        const P = end ? poly[poly.length - 1] : poly[0], Q = end ? poly[poly.length - 2] : poly[1];
        if (Q && visAt(P[0], P[1])) {
          const rot = Math.atan2(Q[1] - P[1], Q[0] - P[0]);
          put({ type: HD_PIPE_FIT.hub, x: P[0], y: P[1], rot, hw: r.halfW + 1.6, hh: r.halfW + 1.6, p1: cable ? 1 : 0, p2: r.rMax + 1.6 });
        }
        continue;
      }
      if (!hit) continue;
      // gondola MAIN: KOLEKTOR na wejściu wiązki (blok z krótkimi rurami wzdłuż wiązki, kołnierze na końcach) — tuż za
      // obrysem gondoli; inne urządzenia — kołnierz / dławnica / pompa przy zbiorniku
      const coll = !cable && m.type === 'engine';
      const cw = coll ? clamp(r.halfW * 0.6 + 1.6, 2.6, 4.5) : 0;
      const sb = hit.s + (coll ? cw + 0.3 : 0.5) * D;
      const b = pw.at(end ? L - sb : sb);
      if (!visAt(b.x, b.y)) continue;
      const rot = b.rot;
      if (cable) put({ type: HD_PIPE_FIT.gland, x: b.x, y: b.y, rot, hw: 1.5, hh: r.halfW + 1.0, p1: r.n, p2: r.rMax + 0.9 });
      else if (m.type === 'fuel_tank') put({ type: HD_PIPE_FIT.pump, x: b.x, y: b.y, rot, hw: 2.6, hh: r.halfW + 2.0, p1: 0, p2: r.rMax + 2.0 });
      else if (coll) put({ type: HD_PIPE_FIT.collector, x: b.x, y: b.y, rot, hw: cw, hh: r.halfW + 1.2, p1: clamp(r.n, 2, 8), p2: r.rMax + 1.2 });
      else put({ type: HD_PIPE_FIT.collar, x: b.x, y: b.y, rot, hw: 1.3, hh: r.halfW + 0.9, p1: 1, p2: r.rMax + 0.7 });
    }
  }
  for (const f of own) {
    fits.push(f);
    if (mirror && Math.abs(f.y) > 0.5 * D) fits.push({ ...f, y: -f.y, rot: -f.rot, mirrorOf: true });
  }
}

/**
 * MARTWE KABLE (etap 2 — bilans mocy rdzenia, src/game/hullDesign/hullDesignClass.js): sieć z biegami kabli bez prądu
 * oznaczonymi `dead: true` (kompozytor rysuje je szare, bez opasek). `dead` — zbiór indeksów modułów
 * (field.expanded.modules) bez prądu. Drzewo sieci zasilania od przyłączy reaktorów (węzły z `dev` = reaktor): bieg jest
 * martwy, gdy za nim (w stronę urządzeń) nie ma żadnego urządzenia z prądem. Bieg z kopią lustra, którego burty różnią
 * się stanem, dzieli się na dwa biegi (te same parametry, łamane i końce rozdzielone) — raster czyta numer biegu, więc po
 * zmianie trzeba go policzyć od nowa (rasterPipeNetwork). Nie zmienia `net`: zwraca nową sieć (ta sama geometria, graf
 * i osprzęt; `base` — sieć bez oznaczeń). Pusty `dead` — `net` bez zmian.
 */
export function markPipeNetPower(net, modules, dead) {
  const base = net?.base || net;
  if (!base || !dead || !dead.size) return base;
  const nodes = base.graph.nodes;
  const adj = nodes.map(() => []);
  base.runs.forEach((r, ri) => {
    if (r.net !== 'power') return;
    r.ends.forEach(([a, b], pi) => { adj[a]?.push({ ri, pi, o: b }); adj[b]?.push({ ri, pi, o: a }); });
  });
  const isCore = (n) => n.dev >= 0 && modules[n.dev]?.type === 'reactor';
  // BFS od przyłączy reaktorów: krawędź rodzica każdego węzła
  const parent = new Int32Array(nodes.length).fill(-2);   // −2 — nieosiągalny, −1 — korzeń
  const order = [];
  nodes.forEach((n, i) => { if (n.net === 'power' && isCore(n)) { parent[i] = -1; order.push(i); } });
  for (let q = 0; q < order.length; q++) {
    for (const e of adj[order[q]]) if (parent[e.o] === -2) { parent[e.o] = order[q]; order.push(e.o); }
  }
  // żywe poddrzewo: urządzenie z prądem w węźle albo dalej
  const live = new Uint8Array(nodes.length);
  for (let q = order.length - 1; q >= 0; q--) {
    const i = order[q], n = nodes[i];
    if (n.dev >= 0 && !isCore(n) && !dead.has(n.dev)) live[i] = 1;
    if (live[i] && parent[i] >= 0) live[parent[i]] = 1;
  }
  const polyLive = (a, b) => {
    if (parent[a] === -2 || parent[b] === -2) return true;   // poza drzewem (nie powinno być) — bez oznaczenia
    if (parent[b] === a) return !!live[b];
    if (parent[a] === b) return !!live[a];
    return !!(live[a] || live[b]);
  };
  const runs = [];
  let split = 0;
  for (const r of base.runs) {
    if (r.net !== 'power') { runs.push(r); continue; }
    const st = r.ends.map(([a, b]) => polyLive(a, b));
    if (st.every((v) => v)) runs.push(r);
    else if (st.every((v) => !v)) runs.push({ ...r, dead: true });
    else if (base.runs.length + split + 1 < 255) {
      split++;
      const pick = (want) => ({ polys: r.polys.filter((_, i) => st[i] === want), ends: r.ends.filter((_, i) => st[i] === want) });
      runs.push({ ...r, ...pick(true) }, { ...r, ...pick(false), dead: true });
    } else runs.push(r);
  }
  return { ...base, runs, base, deadDevices: dead.size };
}

/**
 * Raster sieci na siatce pola `grid` { x0, y0, w, h, res }: A (Float32 × 4 na teksel) — przesunięcie w poprzek od
 * osi biegu ze znakiem [j.], cos φ, sin φ (φ = 2π · s / okres obejm), numer odcinka między obejmami (s / okres mod 8);
 * B (Uint8 × 4) — numer biegu (1…255, 0 — brak), numer elementu osprzętu (1…255); mask — teksele zapisane.
 * Wiązka należy do biegu, którego brzeg jest najbliżej (|t| − pół-szerokość najmniejsze); końce biegów płaskie.
 */
export function rasterPipeNetwork(net, grid) {
  const { x0, y0, w, h, res } = grid;
  const n = w * h;
  const A = new Float32Array(n * 4);
  const B = new Uint8Array(n * 4);
  const mask = new Uint8Array(n);
  if (!net) return { a: A, b: B, mask, count: 0 };
  const best = new Float32Array(n).fill(Infinity);
  const inv = 1 / res;
  const pad = 2.6 * inv;
  const P = net.clampJ;
  const iP = 1 / P;
  const D = net.detail;
  const TAU = Math.PI * 2;
  for (let ri = 0; ri < net.runs.length && ri < 255; ri++) {
    const run = net.runs[ri];
    const hw = run.halfW * D;
    const reach = hw + pad, reach2 = reach * reach;
    for (const poly of run.polys) {
      let s0 = run.phase;
      const last = poly.length - 2;
      for (let q = 0; q + 1 < poly.length; q++) {
        const a = poly[q], b = poly[q + 1];
        const vx = b[0] - a[0], vy = b[1] - a[1];
        const L2 = vx * vx + vy * vy, L = Math.sqrt(L2);
        if (L < 1e-9) continue;
        const ix0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - reach - x0) * res));
        const ix1 = Math.min(w - 1, Math.ceil((Math.max(a[0], b[0]) + reach - x0) * res));
        const iy0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - reach - y0) * res));
        const iy1 = Math.min(h - 1, Math.ceil((Math.max(a[1], b[1]) + reach - y0) * res));
        for (let j = iy0; j <= iy1; j++) {
          const py = y0 + (j + 0.5) * inv;
          for (let i = ix0; i <= ix1; i++) {
            const px = x0 + (i + 0.5) * inv;
            const wx = px - a[0], wy = py - a[1];
            let t = (wx * vx + wy * vy) / L2;
            if (t < 0) { if (q === 0) continue; t = 0; }
            if (t > 1) { if (q === last) continue; t = 1; }
            const dx = wx - vx * t, dy = wy - vy * t;
            const d2 = dx * dx + dy * dy;
            if (d2 > reach2) continue;
            const k = j * w + i;
            const dist = Math.sqrt(d2);
            const sdf = dist - hw;
            if (sdf >= best[k]) continue;
            best[k] = sdf;
            const sign = vx * wy - vy * wx >= 0 ? 1 : -1;
            const ph = (s0 + t * L) * iP;
            A[k * 4] = sign * dist;
            A[k * 4 + 1] = Math.cos(TAU * ph);
            A[k * 4 + 2] = Math.sin(TAU * ph);
            A[k * 4 + 3] = ph - 8 * Math.floor(ph / 8);
            B[k * 4] = ri + 1;
            mask[k] = 1;
          }
        }
        s0 += L;
      }
    }
  }
  const fits = net.fits;
  for (let fi = 0; fi < fits.length && fi < 255; fi++) {
    const f = fits[fi];
    const c = Math.cos(f.rot), s = Math.sin(f.rot);
    const hx = f.hw * D + 2 * inv, hy = f.hh * D + 2 * inv;
    const ex = Math.abs(c) * hx + Math.abs(s) * hy, ey = Math.abs(s) * hx + Math.abs(c) * hy;
    const ix0 = Math.max(0, Math.floor((f.x - ex - x0) * res)), ix1 = Math.min(w - 1, Math.ceil((f.x + ex - x0) * res));
    const iy0 = Math.max(0, Math.floor((f.y - ey - y0) * res)), iy1 = Math.min(h - 1, Math.ceil((f.y + ey - y0) * res));
    for (let j = iy0; j <= iy1; j++) {
      const py = y0 + (j + 0.5) * inv - f.y;
      for (let i = ix0; i <= ix1; i++) {
        const px = x0 + (i + 0.5) * inv - f.x;
        const lx = px * c + py * s, ly = -px * s + py * c;
        if (Math.abs(lx) > hx || Math.abs(ly) > hy) continue;
        const k = j * w + i;
        B[k * 4 + 1] = fi + 1;
        mask[k] = 1;
      }
    }
  }
  return { a: A, b: B, mask, count: Math.min(255, net.runs.length) };
}

/** Rury na tercję długości (rufa, środek, dziób): Σ liczba rur × długość biegów generowanych [j.] (`net` — tylko ta sieć). */
export function pipeTercileLoad(net, bounds, onlyNet = null) {
  const out = [0, 0, 0];
  if (!net) return out;
  const L = bounds.maxX - bounds.minX;
  for (const r of net.runs) {
    if (onlyNet && r.net !== onlyNet) continue;
    for (const poly of r.polys) {
      for (let i = 0; i + 1 < poly.length; i++) {
        const a = poly[i], b = poly[i + 1];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const u = ((a[0] + b[0]) * 0.5 - bounds.minX) / L;
        out[clamp(Math.floor(u * 3), 0, 2)] += len * r.n;
      }
    }
  }
  return out;
}
