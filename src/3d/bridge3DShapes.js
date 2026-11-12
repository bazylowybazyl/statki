// src/3d/bridge3DShapes.js
//
// MODEL 3D MOSTKA — geometria i dane pomocnicze, bez three i bez DOM (testy
// w Node: tests/bridge3D.test.mjs). Rysuje src/3d/bridge3D.js, opis w
// docs/PORT-mostki.md §8 i § 10 (mostki na poziomy klas).
//
// RODZAJE: flota Terra Novy ma mostki NA POZIOMY klas I–VI (tn_1 … tn_6 —
// src/data/bridgeLevels.js: obrys modelu = strefa mostka = gniazdo kreatora;
// strefa wybiera model polem `level`), piraci, Atlas i lokomotywa
// megafrachtowca — modele własnego kadłuba (rodzaj = kadłub + strefa).
//
// PRZESTRZEŃ MODELU (M): środek strefy mostka = (0, 0, 0), +X wzdłuż
// szerokości strefy (przy rot 0 — ku dziobowi), +Y = w górę SCENY (−Y obrazka
// PNG), +Z = wysokość nad kadłubem, ku kamerze. Jednostki = piksele RENDERU
// kadłuba (świat gry przy spriteScale 1). Model jest zaprojektowany na strefę
// z BRIDGE_LAYOUT_PROPOSALS (rozmiar liczy BRIDGE3D_KINDS ze strefy i skali
// render/PNG); inną strefę (edytor) instancja dopasowuje skalą XY.
// Punkt PNG (px, py) strefy (zx, zy) leży w M w ((px − zx)·kx, −(py − zy)·ky).
// Nowy kadłub: docs/BRIEF-mostek-nowego-kadluba.md.
//
// Kamera gry patrzy prosto z góry, a słońce pada prawie poziomo — wysokość
// czyta się tylko przez światło i cień. Dlatego bryły składają się z pochyłych
// płaszczyzn (tarasy, fazy, skośne ściany); okna stoją na skosach, bo
// pionowych ścian z góry nie widać.
//
// MODUŁY: każdy wierzchołek niesie numer modułu (aModule), a model tabelę
// modules (zakres wierzchołków i indeksów, obrys). Przyszły wizualny silnik
// destrukcji 3D może odczepić moduł (skopiować jego zakres jako odłamek)
// i schować go w instancji (maska modułów w bridge3D.js).

import { BRIDGE_LAYOUT_PROPOSALS, bridgeHash01 } from '../game/shipBridge.js';
import { getHullRenderSize } from '../data/ships.js';
import { BRIDGE_LEVELS, bridgeLevel } from '../data/bridgeLevels.js';

/** Materiały (indeks palety w bridge3D.js). */
export const BRIDGE3D_MAT = Object.freeze({
  PAINT: 0,   // główna farba kadłuba
  PANEL: 1,   // ciemniejsze panele, fazy
  DARK: 2,    // metal techniczny: kraty, mechanizmy
  TRIM: 3,    // akcent malowany (Atlas: cyjan, piraci: rdza)
  GLASS: 4,   // szyby okien (ciemne; światło dokłada warstwa FG)
  FRAME: 5,   // pas okien, ramy
  BRIGHT: 6,  // jasne detale: czujniki, maszty
  GRIME: 7    // brud, rdza, łaty
});

/** Rodzaje emiterów światła (okna, lampy, paski akcentu). */
export const BRIDGE3D_EMIT = Object.freeze({ WINDOW: 0, BEACON: 1, STRIP: 2 });

// Rodzaj modelu = kadłub (klucz BRIDGE_LAYOUT_PROPOSALS) + strefa (id)
// + sprite (PNG) i profil renderu kadłuba. Rozmiar projektowy w, h = strefa
// × skala render/PNG (jak __hardpointScaleX/Y w grze) — model stoi dokładnie
// na strefie. `capacity` — instancji naraz, `detail` — skala paneli, brudu
// i AO względem Bellatora (duże nadbudówki mają większe płyty).
function kindSpec(index, o) {
  const entry = BRIDGE_LAYOUT_PROPOSALS[o.hull];
  const list = entry?.variants?.[entry.defaultVariant] || [];
  const zone = list.find((z) => z.id === o.zone) || null;
  if (!zone) throw new Error(`brak strefy ${o.hull}/${o.zone} w BRIDGE_LAYOUT_PROPOSALS`);
  const size = getHullRenderSize(o.profile, o.png[0], o.png[1]);
  const kx = size.w / o.png[0];
  const ky = size.h / o.png[1];
  const w = zone.w * kx;
  const h = zone.h * ky;
  return Object.freeze({
    index,
    label: o.label,
    hull: o.hull,
    zoneId: zone.id,
    role: zone.role || 'primary',
    zoneAspect: zone.w / zone.h,
    png: Object.freeze(o.png.slice()),
    render: Object.freeze([size.w, size.h]),
    capacity: o.capacity ?? 128,
    detail: o.detail ?? Math.max(0.35, Math.min(3, Math.sqrt((w * h) / BELLATOR_AREA))),
    zoneX: zone.x,
    zoneY: zone.y,
    kx,
    ky,
    w,
    h
  });
}

// Rodzaj POZIOMU (tn_1 … tn_6): rozmiar projektowy = obrys poziomu [j. świata],
// bez sprite'a (kx = ky = 1 — model w jednostkach świata, na strefę kadłuba
// pasuje skalą render/PNG strefy, czyli 1 przy strefie = obrys / s).
function levelKindSpec(index, o) {
  const lv = bridgeLevel(o.level);
  return Object.freeze({
    index,
    label: o.label,
    hull: null,
    level: lv.level,
    zoneId: 'mostek',
    role: 'primary',
    zoneAspect: lv.w / lv.h,
    png: null,
    render: null,
    capacity: o.capacity ?? 128,
    detail: o.detail ?? Math.max(0.35, Math.min(3, Math.sqrt((lv.w * lv.h) / BELLATOR_AREA))),
    zoneX: 0,
    zoneY: 0,
    kx: 1,
    ky: 1,
    w: lv.w,
    h: lv.h
  });
}

/**
 * Punkty ze sprite'a do przestrzeni M: P.x(px), P.y(py) — px PNG kadłuba
 * (środek obrazka = 0, +Y w dół obrazka) → M (środek strefy, +Y w górę sceny),
 * P.len(d) — długość w px PNG → jednostki M. Buildery czytają położenia cech
 * wprost z obrazka (edytor hardpointów pokazuje te same współrzędne).
 */
export function bridgePngMap(spec) {
  const kx = spec.kx;
  const ky = spec.ky;
  return {
    x: (px) => (px - spec.zoneX) * kx,
    y: (py) => -(py - spec.zoneY) * ky,
    len: (d) => d * (kx + ky) * 0.5
  };
}

const BELLATOR_AREA = (236 * 624 / 1158) * (92 * 385 / 714);

const LEVEL_CAPACITY = [0, 256, 256, 192, 256, 96, 64];
const KIND_DEFS = [
  ...BRIDGE_LEVELS.map((lv) => [lv.model, { label: `Terra Nova — mostek ${lv.roman}`, level: lv.level, capacity: LEVEL_CAPACITY[lv.level] }]),
  ['ironskull', { label: 'Iron Skull — mostek', hull: 'pirate_battleship', zone: 'mostek', png: [1727, 911], profile: 'pirate_battleship', capacity: 256, detail: 1 }],
  ['atlas_main', { label: 'Atlas — mostek rufowy', hull: 'atlas', zone: 'mostek_rufowy', png: [3747, 1677], profile: 'atlas', capacity: 160, detail: 1 }],
  ['atlas_backup', { label: 'Atlas — mostek zapasowy', hull: 'atlas', zone: 'mostek_zapasowy', png: [3747, 1677], profile: 'atlas', capacity: 160, detail: 1 }],
  ['pirate_frigate', { label: 'Fregata piratów — mostek', hull: 'pirate_frigate', zone: 'mostek', png: [1942, 809], profile: 'pirate_frigate', capacity: 256 }],
  ['pirate_destroyer', { label: 'Niszczyciel piratów — mostek', hull: 'pirate_destroyer', zone: 'mostek', png: [1840, 854], profile: 'pirate_destroyer', capacity: 256 }],
  ['pirate_supercapital', { label: 'Supercapital piratów — mostek', hull: 'pirate_supercapital', zone: 'mostek', png: [1671, 941], profile: 'pirate_supercapital', capacity: 64 }],
  ['megafreighter', { label: 'Megafrachtowiec — mostek lokomotywy', hull: 'megafreighter', zone: 'mostek', png: [1672, 941], profile: 'megafreighter', capacity: 32 }]
];

export const BRIDGE3D_KINDS = Object.freeze(Object.fromEntries(KIND_DEFS.map(([name, o], i) => [name, o.level ? levelKindSpec(i, o) : kindSpec(i, o)])));

export const BRIDGE3D_KIND_ORDER = Object.freeze(KIND_DEFS.map(([name]) => name));

/**
 * Który model stoi na mostku. Strefa z poziomem (`level`, flota TN i projekty
 * kreatora) — model poziomu. Kadłub z jednym rodzajem — ten rodzaj. Atlas
 * ma dwa: długi rufowy (kręgosłup) i krótki zapasowy na dziobie; strefa
 * z propozycji trafia po id, mostek zapasowy po roli, warianty edytora
 * (śródokręcie, dziobowy) — po najbliższych proporcjach strefy.
 */
export function resolveBridgeModelKind(hullKey, def) {
  if (def?.level >= 1) return bridgeLevel(def.level).model;
  let only = null;
  let count = 0;
  for (const name of BRIDGE3D_KIND_ORDER) {
    if (BRIDGE3D_KINDS[name].hull !== hullKey) continue;
    count++;
    if (!only) only = name;
    if (def?.id && BRIDGE3D_KINDS[name].zoneId === def.id) return name;
  }
  if (count <= 1) return only;
  let best = null;
  let bestD = Infinity;
  const aspect = (Number(def?.w) || 1) / (Number(def?.h) || 1);
  for (const name of BRIDGE3D_KIND_ORDER) {
    const k = BRIDGE3D_KINDS[name];
    if (k.hull !== hullKey) continue;
    if (def?.role === 'backup' && k.role === 'backup') return name;
    const d = Math.abs(Math.log(aspect / k.zoneAspect));
    if (d < bestD) { bestD = d; best = name; }
  }
  return best;
}

/**
 * Model mostka na kadłubie modelu 3D okrętu (src/3d/ships3d — tryb „Statki 3D”): nazwa = rodzaj z KIND_DEFS
 * (piraci, Atlas, lokomotywa) albo okręt floty TN (custos, hasta, bellator, citadella, colossus — model poziomu
 * na strefie BRIDGE_LAYOUT_PROPOSALS). Wynik: { kind, png, zoneX, zoneY (środek strefy w px PNG), kx, ky
 * (j. modelu → px PNG: 1 / kx) }.
 */
const TN_BRIDGE_HULLS = Object.freeze({
  custos: ['frigate', 'terran_frigate', [2400, 1792]],
  hasta: ['destroyer', 'terran_destroyer', [768, 573]],
  bellator: ['battleship', 'terran_battleship', [1158, 714]],
  citadella: ['terran_carrier', 'terran_carrier', [1672, 941]],
  colossus: ['terran_supercapital', 'terran_supercapital', [1672, 941]]
});
export function bridgeModelOnHull(name) {
  const tn = TN_BRIDGE_HULLS[name];
  if (!tn) {
    const k = BRIDGE3D_KINDS[name];
    return k ? { kind: name, png: k.png, zoneX: k.zoneX, zoneY: k.zoneY, kx: k.kx, ky: k.ky } : null;
  }
  const [hull, profile, png] = tn;
  const entry = BRIDGE_LAYOUT_PROPOSALS[hull];
  const zone = (entry?.variants?.[entry.defaultVariant] || []).find((z) => z.role !== 'backup');
  if (!zone) return null;
  const size = getHullRenderSize(profile, png[0], png[1]);
  return { kind: resolveBridgeModelKind(hull, zone), png, zoneX: zone.x, zoneY: zone.y, kx: size.w / png[0], ky: size.h / png[1] };
}

// ---------------------------------------------------------------------------
// Budowa siatki
// ---------------------------------------------------------------------------

const M = BRIDGE3D_MAT;

class MeshBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.mat = [];
    this.mod = [];
    this.idx = [];
    this.modules = [];
    this.emitters = [];
    this._module = -1;
  }

  vcount() { return this.pos.length / 3; }

  begin(name, label = name) {
    const id = this.modules.length;
    this.modules.push({
      id, name, label,
      vertexStart: this.vcount(), vertexCount: 0,
      indexStart: this.idx.length, indexCount: 0,
      bbox: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
    });
    this._module = id;
    return id;
  }

  end() {
    const m = this.modules[this._module];
    m.vertexCount = this.vcount() - m.vertexStart;
    m.indexCount = this.idx.length - m.indexStart;
    this._module = -1;
  }

  v(x, y, z, nx, ny, nz, mat) {
    const i = this.vcount();
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.mat.push(mat);
    this.mod.push(this._module);
    const bb = this.modules[this._module].bbox;
    if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y; if (z < bb[2]) bb[2] = z;
    if (x > bb[3]) bb[3] = x; if (y > bb[4]) bb[4] = y; if (z > bb[5]) bb[5] = z;
    return i;
  }

  // Płaski wypukły wielokąt [[x,y,z], ...], wierzchołki CCW oglądane od
  // zewnątrz (normalna Newella). `hint` — kierunek „na zewnątrz”: gdy normalna
  // wyjdzie przeciwna, kolejność jest odwracana.
  face(pts, mat, hint = null) {
    const n = pts.length;
    let nx = 0; let ny = 0; let nz = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) return false;
    nx /= len; ny /= len; nz /= len;
    let list = pts;
    if (hint && nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) {
      list = pts.slice().reverse();
      nx = -nx; ny = -ny; nz = -nz;
    }
    const base = this.vcount();
    for (const p of list) this.v(p[0], p[1], p[2], nx, ny, nz, mat);
    for (let i = 1; i < n - 1; i++) this.idx.push(base, base + i, base + i + 1);
    return true;
  }

  // Czworokąt z normalnymi wierzchołków (gładkie bryły); kolejność sprawdzana
  // względem średniej normalnej.
  quadSmooth(p, nrm, mat) {
    const e1 = sub3(p[1], p[0]);
    const e2 = sub3(p[2], p[0]);
    const fn = cross3(e1, e2);
    const avg = [nrm[0][0] + nrm[1][0] + nrm[2][0] + nrm[3][0], nrm[0][1] + nrm[1][1] + nrm[2][1] + nrm[3][1], nrm[0][2] + nrm[1][2] + nrm[2][2] + nrm[3][2]];
    const flip = dot3(fn, avg) < 0;
    const base = this.vcount();
    for (let i = 0; i < 4; i++) this.v(p[i][0], p[i][1], p[i][2], nrm[i][0], nrm[i][1], nrm[i][2], mat);
    if (flip) this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  triSmooth(p, nrm, mat) {
    const fn = cross3(sub3(p[1], p[0]), sub3(p[2], p[0]));
    const avg = [nrm[0][0] + nrm[1][0] + nrm[2][0], nrm[0][1] + nrm[1][1] + nrm[2][1], nrm[0][2] + nrm[1][2] + nrm[2][2]];
    const base = this.vcount();
    for (let i = 0; i < 3; i++) this.v(p[i][0], p[i][1], p[i][2], nrm[i][0], nrm[i][1], nrm[i][2], mat);
    if (dot3(fn, avg) < 0) this.idx.push(base, base + 2, base + 1);
    else this.idx.push(base, base + 1, base + 2);
  }

  emit(e) {
    e.module = this._module;
    this.emitters.push(e);
    return e;
  }
}

function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function add3(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function mul3(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm3(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

// ---------------------------------------------------------------------------
// Wielokąty (XY, wypukłe, CCW oglądane z góry)
// ---------------------------------------------------------------------------

export function rectPoly(x0, y0, x1, y1) {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

// Prostokąt ze ściętymi narożnikami. Krawędzie: 0 dół (−Y), 1 narożnik,
// 2 prawo (+X, dziób), 3, 4 góra (+Y), 5, 6 lewo (−X, rufa), 7.
export function octPoly(x0, y0, x1, y1, c) {
  return [[x0 + c, y0], [x1 - c, y0], [x1, y0 + c], [x1, y1 - c], [x1 - c, y1], [x0 + c, y1], [x0, y1 - c], [x0, y0 + c]];
}

function rotPoly(poly, cx, cy, deg) {
  const r = deg * Math.PI / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return poly.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
}

/**
 * Wielokąt odsunięty do środka o `d` (liczba albo tablica per krawędź;
 * krawędź i = wierzchołek i → i+1). Tylko wypukłe, CCW.
 */
export function insetPolygon(poly, d) {
  const n = poly.length;
  const lines = [];
  const live = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    let ex = b[0] - a[0];
    let ey = b[1] - a[1];
    const len = Math.hypot(ex, ey);
    live.push(len > 1e-6);
    if (len > 1e-6) { ex /= len; ey /= len; }
    const di = Array.isArray(d) ? (Number(d[i]) || 0) : d;
    // Dla CCW wnętrze leży po lewej od kierunku krawędzi.
    lines.push([a[0] - ey * di, a[1] + ex * di, ex, ey]);
  }
  // Krawędź zerowej długości (zwinięty wcześniej narożnik) nie ma kierunku —
  // wierzchołek liczymy z najbliższych krawędzi „żywych” po obu stronach.
  const prevLive = (i) => { for (let k = 0; k < n; k++) { const j = (i - k + n) % n; if (live[j]) return j; } return i; };
  const nextLive = (i) => { for (let k = 0; k < n; k++) { const j = (i + k) % n; if (live[j]) return j; } return i; };
  const cross = (L0, L1, out) => {
    const cr = L0[2] * L1[3] - L0[3] * L1[2];
    if (Math.abs(cr) < 1e-9) { out[0] = L1[0]; out[1] = L1[1]; return out; }
    const t = ((L1[0] - L0[0]) * L1[3] - (L1[1] - L0[1]) * L1[2]) / cr;
    out[0] = L0[0] + L0[2] * t;
    out[1] = L0[1] + L0[3] * t;
    return out;
  };
  const out = [];
  for (let i = 0; i < n; i++) out.push(cross(lines[prevLive((i - 1 + n) % n)], lines[nextLive(i)], [0, 0]));
  // Krótka krawędź (narożnik 45°) między mocniej odsuniętymi sąsiadami potrafi
  // się odwrócić — wielokąt przekręca się w „kokardę”. Zwijamy ją do punktu
  // przecięcia sąsiednich krawędzi (ostry narożnik; liczba wierzchołków
  // zostaje, więc ściany dalej łączą się z dolnym wielokątem).
  for (let pass = 0; pass < 4; pass++) {
    let fixed = false;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ox = poly[j][0] - poly[i][0];
      const oy = poly[j][1] - poly[i][1];
      const nx = out[j][0] - out[i][0];
      const ny = out[j][1] - out[i][1];
      if (ox * nx + oy * ny >= -1e-9) continue;
      const pt = cross(lines[prevLive((i - 1 + n) % n)], lines[nextLive(j)], [0, 0]);
      out[i] = pt;
      out[j] = [pt[0], pt[1]];
      fixed = true;
    }
    if (!fixed) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bryły
// ---------------------------------------------------------------------------

function pick(matOf, i) {
  if (typeof matOf === 'function') return matOf(i);
  if (Array.isArray(matOf)) return matOf[i % matOf.length];
  return matOf;
}

// Ściany między wielokątem dolnym (z0) a górnym (z1). Zwraca ściany
// {bl, br, tr, tl} (do okien) w kolejności krawędzi.
function walls(B, lower, z0, upper, z1, matOf) {
  const faces = [];
  const n = lower.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const bl = [lower[i][0], lower[i][1], z0];
    const br = [lower[j][0], lower[j][1], z0];
    const tr = [upper[j][0], upper[j][1], z1];
    const tl = [upper[i][0], upper[i][1], z1];
    // Kierunek „na zewnątrz” = prawa strona krawędzi (CCW z góry).
    const ex = br[0] - bl[0];
    const ey = br[1] - bl[1];
    B.face([bl, br, tr, tl], pick(matOf, i), [ey, -ex, 0]);
    faces.push({ bl, br, tr, tl, edge: i });
  }
  return faces;
}

function cap(B, poly, z, mat) {
  B.face(poly.map((p) => [p[0], p[1], z]), mat, [0, 0, 1]);
}

/**
 * Blok: korpus o pochyłych ścianach (slope — odsunięcie górnej krawędzi) +
 * faza na górze (chamfer [wysokość, odsunięcie]) + dach.
 */
function block(B, poly, z0, z1, o = {}) {
  const chH = o.chamfer ? o.chamfer[0] : 0;
  const chD = o.chamfer ? o.chamfer[1] : 0;
  const hasChamfer = chH > 0 && (Array.isArray(chD) ? chD.some((v) => v > 0) : chD > 0);
  const zA = hasChamfer ? z1 - chH : z1;
  const top1 = o.slope ? insetPolygon(poly, o.slope) : poly;
  const body = walls(B, poly, z0, top1, zA, o.sideMat ?? o.mat ?? M.PAINT);
  let top = top1;
  let chamfer = null;
  if (zA < z1) {
    top = insetPolygon(top1, chD);
    chamfer = walls(B, top1, zA, top, z1, o.chamferMat ?? o.mat ?? M.PAINT);
  }
  if (o.cap !== false) cap(B, top, z1, o.capMat ?? o.mat ?? M.PAINT);
  return { poly, top, z0, z1, body, chamfer };
}

// Obrócony prostopadłościan (detale, łaty, listwy).
function boxRot(B, cx, cy, z0, w, h, dz, deg, o = {}) {
  const poly = rotPoly(rectPoly(-w / 2, -h / 2, w / 2, h / 2), cx, cy, deg);
  return block(B, poly, z0, z0 + dz, o);
}

// Kopuła (elipsoida) na (cx, cy, z0): promień r, wysokość hz.
function dome(B, cx, cy, z0, r, hz, o = {}) {
  const seg = o.seg || 16;
  const rings = o.rings || 5;
  const mat = o.mat ?? M.PAINT;
  const ry = o.ry ?? r;
  const P = (k, s) => {
    const th = (k / rings) * Math.PI * 0.5;
    const ph = (s / seg) * Math.PI * 2;
    const sr = Math.sin(th);
    return [cx + r * sr * Math.cos(ph), cy + ry * sr * Math.sin(ph), z0 + hz * Math.cos(th)];
  };
  const N = (p) => norm3([(p[0] - cx) / (r * r), (p[1] - cy) / (ry * ry), (p[2] - z0) / (hz * hz)]);
  const apex = [cx, cy, z0 + hz];
  for (let s = 0; s < seg; s++) {
    const a = P(1, s);
    const b = P(1, s + 1);
    B.triSmooth([apex, a, b], [[0, 0, 1], N(a), N(b)], mat);
  }
  for (let k = 1; k < rings; k++) {
    for (let s = 0; s < seg; s++) {
      const p0 = P(k, s); const p1 = P(k + 1, s); const p2 = P(k + 1, s + 1); const p3 = P(k, s + 1);
      B.quadSmooth([p0, p1, p2, p3], [N(p0), N(p1), N(p2), N(p3)], mat);
    }
  }
}

// Rura / stożek z punktu a do b (promienie ra, rb). rb = 0 — kolec.
function tube(B, a, b, ra, rb, o = {}) {
  const seg = o.seg || 10;
  const mat = o.mat ?? M.DARK;
  const d = norm3(sub3(b, a));
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const ref = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm3(cross3(ref, d));
  const v = cross3(d, u);
  const radial = (ph) => add3(mul3(u, Math.cos(ph)), mul3(v, Math.sin(ph)));
  const slope = (ra - rb) / Math.max(1e-6, len);
  for (let s = 0; s < seg; s++) {
    const p0 = (s / seg) * Math.PI * 2;
    const p1 = ((s + 1) / seg) * Math.PI * 2;
    const r0 = radial(p0); const r1 = radial(p1);
    const n0 = norm3(add3(r0, mul3(d, slope)));
    const n1 = norm3(add3(r1, mul3(d, slope)));
    const A0 = add3(a, mul3(r0, ra)); const A1 = add3(a, mul3(r1, ra));
    if (rb > 1e-6) {
      const B0 = add3(b, mul3(r0, rb)); const B1 = add3(b, mul3(r1, rb));
      B.quadSmooth([A0, A1, B1, B0], [n0, n1, n1, n0], mat);
    } else {
      const nt = norm3(add3(n0, n1));
      B.triSmooth([A0, A1, b], [n0, n1, nt], mat);
    }
  }
  if (rb > 1e-6 && o.capB !== false) {
    const ring = [];
    for (let s = 0; s < seg; s++) ring.push(add3(b, mul3(radial((s / seg) * Math.PI * 2), rb)));
    B.face(ring, o.capMat ?? mat, d);
  }
  if (o.capA) {
    const ring = [];
    for (let s = 0; s < seg; s++) ring.push(add3(a, mul3(radial((s / seg) * Math.PI * 2), ra)));
    B.face(ring, o.capMat ?? mat, mul3(d, -1));
  }
}

// Walec pionowy (podstawa kopuły, pierścienie).
function cylinder(B, cx, cy, z0, z1, r0, r1, o = {}) {
  tube(B, [cx, cy, z0], [cx, cy, z1], r0, r1, { seg: o.seg || 16, mat: o.mat ?? M.PAINT, capMat: o.capMat ?? o.mat ?? M.PAINT });
}

// ---------------------------------------------------------------------------
// Okna, lampy, paski
// ---------------------------------------------------------------------------

// Baza ściany: t wzdłuż krawędzi, b w górę skosu, n = t × b (na zewnątrz).
function faceBasis(face) {
  const t = norm3(sub3(face.br, face.bl));
  const h = sub3(face.tl, face.bl);
  const b = norm3(sub3(h, mul3(t, dot3(t, h))));
  return { t, b, n: cross3(t, b) };
}

/**
 * Rząd okien na pochyłej ścianie. `at` — wysokość środka rzędu na ścianie
 * (0 = dół, 1 = góra), `from/to` — zakres wzdłuż krawędzi (0..1). Każde okno
 * to szyba (GLASS) na ciemnym pasie (FRAME); oświetlone „pomieszczenia” (serie
 * 2–5 okien przedzielone 1–3 ciemnymi, jak buildBeamBridgeWindows w
 * shipBridgeBeams.js) dostają emiter.
 */
function windowRow(B, face, o) {
  const { t, b, n } = faceBasis(face);
  const at = o.at ?? 0.5;
  const left = lerp3(face.bl, face.tl, at);
  const right = lerp3(face.br, face.tr, at);
  const rowLen = Math.hypot(right[0] - left[0], right[1] - left[1], right[2] - left[2]);
  const from = (o.from ?? 0) * rowLen + (o.margin ?? 2);
  const to = (o.to ?? 1) * rowLen - (o.margin ?? 2);
  const pitch = o.pitch;
  const count = Math.floor((to - from) / pitch);
  if (count <= 0) return 0;
  const start = from + ((to - from) - count * pitch) * 0.5 + pitch * 0.5;
  const pw = o.paneW * 0.5;
  const ph = o.paneH * 0.5;
  const seedBase = (o.seed | 0) * 977 + B.emitters.length * 13;
  // Pas okien (rama) pod szybami.
  if (o.frame !== false) {
    const fh = ph + (o.frameExtra ?? 0.45);
    const c0 = add3(add3(left, mul3(t, start - pitch * 0.5)), mul3(n, 0.03));
    const c1 = add3(add3(left, mul3(t, start + (count - 0.5) * pitch)), mul3(n, 0.03));
    B.face([add3(c0, mul3(b, -fh)), add3(c1, mul3(b, -fh)), add3(c1, mul3(b, fh)), add3(c0, mul3(b, fh))], M.FRAME, n);
  }
  let run = 2 + Math.floor(bridgeHash01(seedBase, 1) * 4);
  let lit = o.allLit ? true : bridgeHash01(seedBase, 9) < 0.8;
  for (let k = 0; k < count; k++) {
    if (!o.allLit && run <= 0) {
      lit = !lit;
      run = lit ? 2 + Math.floor(bridgeHash01(seedBase + k, 2) * 4) : 1 + Math.floor(bridgeHash01(seedBase + k, 3) * 3);
    }
    run--;
    const c = add3(add3(left, mul3(t, start + k * pitch)), mul3(n, 0.06));
    B.face([
      add3(add3(c, mul3(t, -pw)), mul3(b, -ph)),
      add3(add3(c, mul3(t, pw)), mul3(b, -ph)),
      add3(add3(c, mul3(t, pw)), mul3(b, ph)),
      add3(add3(c, mul3(t, -pw)), mul3(b, ph))
    ], M.GLASS, n);
    const lvlRaw = bridgeHash01(seedBase + k * 13, 23);
    B.emit({
      type: BRIDGE3D_EMIT.WINDOW,
      color: o.color || 'window',
      c, t, b, n,
      w: o.paneW, h: o.paneH,
      lit,
      level: lvlRaw < 0.22 ? 0.35 + lvlRaw : 0.72 + 0.28 * lvlRaw,
      seed: bridgeHash01(seedBase + k * 7, 11)
    });
  }
  return count;
}

// Lampa (światło pozycyjne na maszcie) — sam emiter + drobna oprawa.
function beacon(B, x, y, z, color, o = {}) {
  const s = o.size ?? 0.55;
  block(B, rectPoly(x - s, y - s, x + s, y + s), z - s * 1.2, z, { mat: M.BRIGHT });
  B.emit({
    type: BRIDGE3D_EMIT.BEACON, color,
    c: [x, y, z + 0.05], t: [1, 0, 0], b: [0, 1, 0], n: [0, 0, 1],
    w: o.core ?? 1.1, h: o.core ?? 1.1,
    lit: true, level: 1,
    seed: bridgeHash01(Math.round(x * 10) + 7919, Math.round(y * 10) + 104729),
    period: o.period ?? 1.4, phase: o.phase ?? 0
  });
}

// Pasek akcentu (Atlas: cyjanowa listwa) leżący na płaskiej powierzchni.
function strip(B, x0, x1, y, z, width, o = {}) {
  const hw = width * 0.5;
  B.face([[x0, y - hw, z], [x1, y - hw, z], [x1, y + hw, z], [x0, y + hw, z]], M.TRIM, [0, 0, 1]);
  B.emit({
    type: BRIDGE3D_EMIT.STRIP, color: o.color || 'accent',
    c: [(x0 + x1) * 0.5, y, z + 0.04], t: [1, 0, 0], b: [0, 1, 0], n: [0, 0, 1],
    w: x1 - x0, h: width,
    lit: true, level: o.level ?? 1,
    seed: bridgeHash01(Math.round(x0 * 10) + 31, Math.round(y * 10) + 17)
  });
}

// ---------------------------------------------------------------------------
// Modele
// ---------------------------------------------------------------------------

// IRON SKULL — rdza, nity, łaty, kolce. Na sprite'cie: kwadratowy bunkier
// z najeżoną kopułą, kraty po rufowej stronie, siatka po dziobowej.
function buildIronSkull(B, W, H) {
  const hw = W / 2;
  const hh = H / 2;

  B.begin('plyta', 'Płyta nadbudówki');
  const basePoly = [[-hw, -22], [-44, -hh], [40, -hh], [hw, -18], [hw, 20], [44, hh], [-46, hh], [-hw, 24]];
  block(B, basePoly, 0, 3.5, { chamfer: [1.5, 2.0], mat: M.PANEL, chamferMat: M.GRIME, capMat: M.PANEL });
  B.end();

  B.begin('laty', 'Łaty i blachy');
  boxRot(B, -12, -27.5, 3.5, 16, 6, 0.7, 4, { mat: M.GRIME });
  boxRot(B, 20, 27.2, 3.5, 14, 5, 0.7, -6, { mat: M.TRIM });
  boxRot(B, 41, -23.5, 3.5, 10, 8, 0.8, 10, { mat: M.GRIME });
  boxRot(B, -41, 25.5, 3.5, 12, 7, 0.6, -3, { mat: M.TRIM });
  B.end();

  // Bunkier: pochyłe ściany, pod dachem pas ~40° ze szczelinami strzelnic.
  B.begin('bunkier', 'Bunkier dowodzenia');
  const bunker = block(B, octPoly(-24, -24, 30, 24, 5), 3.5, 13.5, {
    slope: [2.2, 2, 2.6, 2, 2.2, 2, 1.8, 2],
    chamfer: [3.2, [3.6, 3.2, 4.2, 3.2, 3.6, 3.0, 3.0, 3.0]],
    mat: M.PAINT, chamferMat: M.GRIME, capMat: M.PAINT
  });
  windowRow(B, bunker.chamfer[2], { at: 0.5, paneW: 2.6, paneH: 0.9, pitch: 4.4, margin: 2.5, seed: 31 });
  windowRow(B, bunker.chamfer[0], { at: 0.5, paneW: 2.6, paneH: 0.9, pitch: 5.2, margin: 3.0, seed: 32 });
  windowRow(B, bunker.chamfer[4], { at: 0.5, paneW: 2.6, paneH: 0.9, pitch: 5.2, margin: 3.0, seed: 33 });
  B.end();

  B.begin('kopula', 'Najeżona kopuła');
  cylinder(B, 3, 1, 3.5, 14.5, 12, 11.5, { seg: 18, mat: M.DARK });
  dome(B, 3, 1, 14.5, 10.5, 8.5, { seg: 18, rings: 6, mat: M.PAINT });
  B.end();

  B.begin('kolce_kopuly', 'Kolce kopuły');
  for (let k = 0; k < 7; k++) {
    const az = (k / 7) * Math.PI * 2 + 0.35;
    const el = 0.62 + 0.18 * Math.sin(k * 2.1);
    const dir = [Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)];
    const base = [3 + dir[0] * 10.5 * 0.92, 1 + dir[1] * 10.5 * 0.92, 14.5 + dir[2] * 8.5 * 0.92];
    tube(B, base, add3(base, mul3(dir, 7.5 + 2 * bridgeHash01(k, 5))), 1.5, 0, { seg: 6, mat: M.BRIGHT });
  }
  tube(B, [3, 1, 22.4], [3, 1, 30], 1.7, 0, { seg: 7, mat: M.BRIGHT });
  B.end();

  B.begin('kolce', 'Wielkie kolce');
  const spikes = [
    [[-41, 3, 4.2], [-1, 0.06, 0.1], 20, 2.6],
    [[-8, -26, 5], [-0.35, -1, 0.22], 15, 2.4],
    [[12, -27, 5], [0.12, -1, 0.26], 14, 2.2],
    [[25, 20, 11.5], [0.55, 0.62, 0.5], 10, 1.8],
    [[-19, 19, 11.5], [-0.25, 0.35, 1], 12, 1.8]
  ];
  for (const [p, d, len, r] of spikes) {
    const dir = norm3(d);
    tube(B, p, add3(p, mul3(dir, len)), r, 0, { seg: 7, mat: M.BRIGHT });
    cylinder(B, p[0], p[1], Math.max(3.5, p[2] - 1.6), p[2] + 0.4, r * 1.35, r * 1.2, { seg: 8, mat: M.DARK });
  }
  B.end();

  B.begin('kraty', 'Kraty chłodnic');
  block(B, rectPoly(-52, -13, -27, 15), 3.5, 5, { mat: M.DARK });
  for (let k = 0; k < 6; k++) boxRot(B, -39.5, -10 + k * 4.4, 5, 22, 1.6, 1.2, 0, { mat: M.GRIME, chamfer: [0.4, 0.4] });
  block(B, rectPoly(33, -11, 50, 9), 3.5, 4.8, { mat: M.DARK });
  for (let k = 0; k < 5; k++) boxRot(B, 41.5, -8.5 + k * 3.8, 4.8, 15, 1.0, 0.6, 0, { mat: M.PANEL });
  B.end();

  B.begin('rury', 'Rury');
  tube(B, [-20, 27, 5.2], [28, 27, 5.2], 1.8, 1.8, { seg: 10, mat: M.GRIME, capA: true });
  tube(B, [-16, 23, 4.9], [24, 23, 4.9], 1.3, 1.3, { seg: 10, mat: M.DARK, capA: true });
  B.end();

  B.begin('maszt', 'Krzywy maszt');
  tube(B, [-15, -15, 13.5], [-17, -16, 24], 0.5, 0.35, { seg: 6, mat: M.DARK });
  tube(B, [-19, -16, 21], [-15, -16, 21.6], 0.3, 0.3, { seg: 5, mat: M.DARK });
  beacon(B, -17, -16, 24.4, 'beacon_pirate', { period: 0.9, size: 0.5 });
  B.end();
}

// ATLAS — mostek rufowy: długi kręgosłup z tarasami, granat/grafit
// z cyjanowymi akcentami. Okna patrzą ku dziobowi i na burty.
function buildAtlasMain(B, W, H) {
  const hw = W / 2;
  const hh = H / 2;

  B.begin('kregoslup', 'Kręgosłup');
  const spine = [[-hw, -13.5], [-117, -hh], [110, -hh], [hw, -9], [hw, 9], [110, hh], [-117, hh], [-hw, 13.5]];
  block(B, spine, 0, 3.4, { chamfer: [1.4, 1.8], mat: M.PAINT, chamferMat: M.PANEL, capMat: M.PANEL });
  B.end();

  B.begin('poklad', 'Pokład hali');
  const hall = block(B, octPoly(-110, -13.2, 70, 13.2, 3), 3.4, 8.6, {
    slope: [3.4, 2.5, 2.2, 2.5, 3.4, 2.5, 2.0, 2.5], chamfer: [0.8, 0.8],
    mat: M.PAINT, chamferMat: M.PANEL, capMat: M.PAINT
  });
  windowRow(B, hall.body[0], { at: 0.55, paneW: 2.0, paneH: 1.0, pitch: 4.4, margin: 4, seed: 41 });
  windowRow(B, hall.body[4], { at: 0.55, paneW: 2.0, paneH: 1.0, pitch: 4.4, margin: 4, seed: 42 });
  for (const [x, y, w, h, d] of [[-82, 4, 10, 4, 1.0], [-52, -5, 7, 4, 0.9], [-12, 5, 12, 3.5, 1.1], [12, -4, 8, 5, 1.0]]) {
    boxRot(B, x, y, 8.6, w, h, d, 0, { mat: M.DARK, chamfer: [0.35, 0.35] });
  }
  // Cyjanowe listwy u stóp hali (świecą; gasną z oknami).
  for (const y of [-14.3, 14.3]) {
    for (const [x0, x1] of [[-104, -68], [-60, -24], [-16, 22]]) strip(B, x0, x1, y, 3.42, 0.6);
  }
  B.end();

  // Blok mostka: stromy korpus i korona ~45° z oknami (szerszy skos ku dziobowi).
  B.begin('mostek', 'Blok mostka');
  const cmd = block(B, octPoly(30, -11, 100, 11, 2.5), 3.4, 14.6, {
    slope: [1.2, 1.2, 1.6, 1.2, 1.2, 1.0, 1.0, 1.0],
    chamfer: [3.8, [3.4, 3.0, 5.4, 3.0, 3.4, 2.6, 2.4, 2.6]],
    mat: M.PAINT, chamferMat: M.PANEL, capMat: M.PAINT
  });
  windowRow(B, cmd.chamfer[2], { at: 0.5, paneW: 1.7, paneH: 1.5, pitch: 2.4, margin: 1.2, seed: 51, allLit: true });
  windowRow(B, cmd.chamfer[0], { at: 0.5, paneW: 1.8, paneH: 1.3, pitch: 3.2, margin: 2.5, seed: 53 });
  windowRow(B, cmd.chamfer[4], { at: 0.5, paneW: 1.8, paneH: 1.3, pitch: 3.2, margin: 2.5, seed: 54 });
  const upper = block(B, octPoly(44, -5.2, 72, 5.2, 1.5), 14.6, 17.4, {
    slope: [0.6, 0.6, 0.8, 0.6, 0.6, 0.6, 0.5, 0.6], chamfer: [1.6, [1.6, 1.4, 2.4, 1.4, 1.6, 1.2, 1.0, 1.2]],
    mat: M.PANEL, chamferMat: M.TRIM, capMat: M.PAINT
  });
  windowRow(B, upper.chamfer[2], { at: 0.5, paneW: 1.3, paneH: 1.1, pitch: 2.0, margin: 0.6, seed: 55, allLit: true });
  for (const y of [-12.2, 12.2]) strip(B, 72, 96, y, 3.42, 0.5, { level: 0.9 });
  B.end();

  B.begin('tarasy', 'Tarasy dziobowe');
  block(B, octPoly(100, -8.5, 117, 8.5, 2), 3.4, 6.2, { slope: [1.5, 1.5, 3, 1.5, 1.5, 0.5, 0.5, 0.5], chamfer: [0.4, 0.5], mat: M.PANEL, capMat: M.PAINT });
  B.end();

  B.begin('maszty', 'Maszty rufowe');
  block(B, octPoly(-118, -9, -90, 9, 2), 3.4, 11.8, { slope: [2, 1.5, 1.5, 1.5, 2, 1.5, 2.5, 1.5], chamfer: [0.6, 0.6], mat: M.PANEL, capMat: M.PAINT });
  for (const y of [-5.5, 5.5]) {
    block(B, rectPoly(-111.5, y - 0.5, -110.5, y + 0.5), 11.8, 21.5, { mat: M.BRIGHT });
    beacon(B, -111, y, 21.9, 'beacon_white', { period: 2.2, phase: y > 0 ? 0.5 : 0 });
  }
  cylinder(B, -100, 0, 11.8, 12.5, 3.3, 3.0, { seg: 12, mat: M.BRIGHT });
  B.end();

  B.begin('pletwy', 'Płetwy grzbietowe');
  for (const y of [-5.2, 5.2]) {
    const low = rectPoly(-74, y - 0.9, -30, y + 0.9);
    const high = rectPoly(-62, y - 0.3, -38, y + 0.3);
    walls(B, low, 8.6, high, 15.5, M.PANEL);
    cap(B, high, 15.5, M.TRIM);
  }
  B.end();
}

// ATLAS — mostek zapasowy na dziobie: krótki, zwężony ku dziobowi blok.
function buildAtlasBackup(B, W, H) {
  const hw = W / 2;
  const hh = H / 2;

  B.begin('podstawa', 'Płyta dziobowa');
  block(B, [[-hw, -hh], [22, -hh], [hw, -6.5], [hw, 6.5], [22, hh], [-hw, hh]], 0, 3.2, { chamfer: [1.2, 1.5], mat: M.PAINT, chamferMat: M.PANEL, capMat: M.PANEL });
  for (const y of [-13.3, 13.3]) {
    for (const [x0, x1] of [[-52, -20], [-14, 14]]) strip(B, x0, x1, y, 3.22, 0.5);
  }
  B.end();

  B.begin('mostek', 'Blok mostka zapasowego');
  const cmd = block(B, octPoly(-47, -11.5, 14, 11.5, 2.5), 3.2, 9.8, {
    slope: [1.0, 1.0, 1.4, 1.0, 1.0, 0.8, 0.8, 0.8],
    chamfer: [3.2, [3.0, 2.6, 4.6, 2.6, 3.0, 2.2, 2.0, 2.2]],
    mat: M.PAINT, chamferMat: M.PANEL, capMat: M.PAINT
  });
  windowRow(B, cmd.chamfer[2], { at: 0.5, paneW: 1.7, paneH: 1.4, pitch: 2.4, margin: 1.2, seed: 61, allLit: true });
  windowRow(B, cmd.chamfer[0], { at: 0.5, paneW: 1.7, paneH: 1.2, pitch: 3.4, margin: 2.5, seed: 62 });
  windowRow(B, cmd.chamfer[4], { at: 0.5, paneW: 1.7, paneH: 1.2, pitch: 3.4, margin: 2.5, seed: 63 });
  const upper = block(B, octPoly(-38, -5.6, -12, 5.6, 1.5), 9.8, 13.2, {
    slope: [0.6, 0.6, 0.8, 0.6, 0.6, 0.6, 0.5, 0.6], chamfer: [1.6, [1.5, 1.3, 2.4, 1.3, 1.5, 1.2, 1.0, 1.2]],
    mat: M.PANEL, chamferMat: M.TRIM, capMat: M.PAINT
  });
  windowRow(B, upper.chamfer[2], { at: 0.5, paneW: 1.3, paneH: 1.0, pitch: 2.0, margin: 0.6, seed: 64, allLit: true });
  boxRot(B, -25, 0, 13.2, 5, 3.4, 0.9, 0, { mat: M.DARK });
  B.end();

  B.begin('nos', 'Czujnik dziobowy');
  block(B, octPoly(20, -4.6, 52, 4.6, 1.5), 3.2, 5.6, { slope: 1.4, chamfer: [0.4, 0.4], mat: M.PANEL, capMat: M.PAINT });
  dome(B, 45, 0, 5.6, 2.6, 2.0, { seg: 12, rings: 3, mat: M.BRIGHT });
  B.end();

  B.begin('maszt', 'Maszt');
  block(B, rectPoly(-35.45, -0.45, -34.55, 0.45), 13.2, 20.5, { mat: M.BRIGHT });
  beacon(B, -35, 0, 20.9, 'beacon_white', { period: 2.2, phase: 0.25 });
  B.end();
}

// ---------------------------------------------------------------------------
// TERRA NOVA — MOSTKI NA POZIOMY KLAS I–VI (src/data/bridgeLevels.js). Jeden język brył (jak dawne mostki
// floty TN): pokład-ośmiokąt, hala z oknami na burtach, wieża z koroną okien na rufie, kopuła sensorów na
// dziobie, maszty z lampami, kopułki czujników. Z poziomem rośnie rozmiar, piętra, rzędy okien, anteny
// i światła: I — niska hala bez okien, wieża i jeden maszt; II — okna hali, maszt z poprzeczką i antena;
// III — druga kondygnacja wieży i pierścień kopuły; IV — okna z przodu hali, dwa maszty, kratki pokładu;
// V — górna hala, górny mostek nad wieżą, posterunki obserwacyjne, trzy maszty; VI — dwa rzędy okien hali,
// krata na wieży, korona okien na sześciu ścianach, kapsuła czujników przed halą, anteny biczowe.
// Model wypełnia obrys poziomu W × H (pokład = octPoly z fazą `ch` — tę samą fazę ma gniazdo kreatora)
// i nic poza niego nie wystaje: obrys modelu = strefa mostka w rozgrywce (tests/bridge3D.test.mjs).
// Układ w ułamkach pół-wymiarów (u = x / hw, v = y / hh), wysokości w j. świata, `s` — skala detali
// okien i drobnicy (dawny Bellator = 1).
// ---------------------------------------------------------------------------

const TN_LEVEL_LOOK = Object.freeze([
  null,
  Object.freeze({ s: 0.42, deck: 0.9, hall: [-0.25, 0.4, 0.62, 1.6], tower: [-0.88, -0.24, 0.66, 5.8], tier: 0, dome: [0.66, 0.36], hall2: null, top: 0, posts: 0, capsule: false, masts: 1, domelets: 0, hallRows: 0, seed: 200 }),
  Object.freeze({ s: 0.56, deck: 1.2, hall: [-0.28, 0.42, 0.66, 2.4], tower: [-0.88, -0.26, 0.64, 8.0], tier: 0, dome: [0.66, 0.34], hall2: null, top: 0, posts: 0, capsule: false, masts: 1, domelets: 2, hallRows: 1, seed: 210 }),
  Object.freeze({ s: 0.68, deck: 1.5, hall: [-0.3, 0.44, 0.68, 3.0], tower: [-0.88, -0.28, 0.64, 8.6], tier: 11.0, dome: [0.66, 0.32], hall2: null, top: 0, posts: 0, capsule: false, masts: 2, domelets: 3, hallRows: 1, seed: 220 }),
  Object.freeze({ s: 0.82, deck: 2.0, hall: [-0.32, 0.44, 0.7, 4.0], tower: [-0.88, -0.3, 0.62, 11.5], tier: 14.5, dome: [0.66, 0.34], hall2: null, top: 0, posts: 0, capsule: false, masts: 2, domelets: 4, hallRows: 1, front: true, vents: 2, seed: 230 }),
  Object.freeze({ s: 1.0, deck: 2.6, hall: [-0.36, 0.48, 0.72, 4.6], tower: [-0.88, -0.34, 0.6, 16.5], tier: 0, dome: [0.72, 0.3], hall2: [-0.22, 0.3, 0.48, 3.6], top: 20.0, posts: 2, capsule: false, masts: 3, domelets: 4, hallRows: 1, front: true, vents: 2, seed: 240 }),
  Object.freeze({ s: 1.25, deck: 3.2, hall: [-0.4, 0.4, 0.72, 6.0], tower: [-0.9, -0.38, 0.66, 26.0], tier: 0, dome: null, hall2: [-0.3, 0.3, 0.5, 5.0], top: 32.0, posts: 2, capsule: true, masts: 3, domelets: 6, hallRows: 2, front: true, vents: 4, grille: true, whips: 2, seed: 250 })
]);

function polyBox(poly) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [x, y] of poly) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

function buildTerranLevel(B, W, H, lv) {
  const L = TN_LEVEL_LOOK[lv];
  const lvl = bridgeLevel(lv);
  const hw = W / 2;
  const hh = H / 2;
  const s = L.s;
  const ch = lvl.ch;
  const deckZ = L.deck;
  const X = (u) => u * hw;
  const Y = (v) => v * hh;

  B.begin('poklad', 'Pokład mostka');
  block(B, octPoly(-hw, -hh, hw, hh, ch), 0, deckZ, { chamfer: [Math.min(0.8 * s, deckZ * 0.5), 1.0 * s], mat: M.PAINT, chamferMat: M.PANEL, capMat: M.PAINT });
  // Kratki i skrzynki przy burtach pokładu (od IV — kratki wentylacji po obu stronach hali).
  for (const y of [-hh + 2.4 * s, hh - 2.4 * s]) {
    boxRot(B, X(-0.56), y, deckZ, 5 * s, 1.6 * s, 0.6 * s, 0, { mat: M.DARK });
    boxRot(B, X(0.12), y, deckZ, 4.2 * s, 1.8 * s, 0.9 * s, 0, { mat: M.PANEL, chamfer: [0.3 * s, 0.3 * s] });
    for (let k = 0; k < (L.vents || 0); k++) boxRot(B, X(-0.12 + k * 0.2), y, deckZ, 6 * s, 2.0 * s, 0.7 * s, 0, { mat: M.DARK, chamfer: [0.25 * s, 0.25 * s] });
  }
  B.end();

  // HALA: pochyłe ściany, rzędy okien na burtach (od II), z przodu (od IV); VI — dwa rzędy.
  const [hu0, hu1, hv, hdz] = L.hall;
  const hallZ = deckZ + hdz;
  B.begin('hala', 'Hala dowodzenia');
  const hall = block(B, octPoly(X(hu0), -Y(hv), X(hu1), Y(hv), 2.2 * s), deckZ, hallZ, {
    // skosy z oknami (burty, przód) ~50° — z góry kamera widzi szyby tylko na skosach (n.z > 0,5)
    slope: [0.78, 0.6, 0.72, 0.6, 0.78, 0.5, 0.4, 0.5].map((k) => k * hdz), chamfer: [0.5 * s, 0.6 * s],
    mat: M.PAINT, chamferMat: M.PANEL, capMat: M.PAINT
  });
  const hp = { paneW: 1.9 * s, paneH: 1.0 * s, pitch: 3.2 * s, margin: 1.8 * s, frameExtra: 0.35 * s };
  const rows = L.hallRows === 2 ? [0.32, 0.72] : (L.hallRows ? [0.5] : []);
  rows.forEach((at, r) => {
    windowRow(B, hall.body[0], { ...hp, at, seed: L.seed + 1 + r * 10 });
    windowRow(B, hall.body[4], { ...hp, at, seed: L.seed + 2 + r * 10 });
  });
  if (L.front) windowRow(B, hall.body[2], { ...hp, at: 0.55, pitch: 2.8 * s, seed: L.seed + 3 });
  // Właz i skrzynki na dachu hali (bez górnej hali).
  if (!L.hall2) {
    const cx = X((hu0 + hu1) * 0.5);
    block(B, octPoly(cx - 2.2 * s, -Y(hv) * 0.55, cx + 1.4 * s, Y(hv) * 0.55, 0.8 * s), hallZ, hallZ + 1.0 * s, { slope: 0.3 * s, mat: M.PANEL, capMat: M.PAINT });
    boxRot(B, X(hu1) - 3.2 * s, Y(hv) * 0.42, hallZ, 2.6 * s, 2.0 * s, 0.8 * s, 0, { mat: M.DARK });
  }
  B.end();

  // GÓRNA HALA (V, VI): węższa kondygnacja na hali, okna na burtach (VI — też z przodu).
  if (L.hall2) {
    const [gu0, gu1, gv, gdz] = L.hall2;
    B.begin('hala_gorna', 'Górna hala');
    const up = block(B, octPoly(X(gu0), -Y(gv), X(gu1), Y(gv), 1.8 * s), hallZ, hallZ + gdz, {
      slope: [0.78, 0.6, 0.72, 0.6, 0.78, 0.5, 0.4, 0.5].map((k) => k * gdz), chamfer: [0.5 * s, 0.6 * s],
      mat: M.PAINT, chamferMat: M.PANEL, capMat: M.PAINT
    });
    windowRow(B, up.body[0], { ...hp, at: 0.55, seed: L.seed + 4 });
    windowRow(B, up.body[4], { ...hp, at: 0.55, seed: L.seed + 5 });
    if (L.capsule) windowRow(B, up.body[2], { ...hp, at: 0.55, pitch: 2.8 * s, seed: L.seed + 6 });
    for (const [u, v] of [[0.35, 0.45], [0.65, -0.4]]) boxRot(B, X(gu0 + (gu1 - gu0) * u), Y(gv) * v, hallZ + gdz, 5 * s, 2.4 * s, 0.7 * s, 0, { mat: M.DARK, chamfer: [0.25 * s, 0.25 * s] });
    B.end();
  }

  // WIEŻA: stromy korpus, korona ~45° z oknami (przód zawsze zapalony); III–IV — druga kondygnacja z koroną.
  const [tu0, tu1, tv, tz] = L.tower;
  const tx0 = X(tu0); const tx1 = X(tu1); const ty = Y(tv);
  const towerZ = tz;
  const crownH = Math.min(3.8 * s, (towerZ - deckZ) * 0.42);
  B.begin('wieza', 'Wieża dowodzenia');
  const tower = block(B, octPoly(tx0, -ty, tx1, ty, Math.min(ty, tx1 - tx0) * 0.22), deckZ, towerZ, {
    slope: [0.9 * s, 1.0 * s, 1.4 * s, 1.0 * s, 0.9 * s, 0.8 * s, 0.6 * s, 0.8 * s],
    chamfer: [crownH, [crownH * 0.9, crownH * 0.76, crownH * 1.26, crownH * 0.76, crownH * 0.9, crownH * 0.7, crownH * 0.7, crownH * 0.7]],
    mat: M.PAINT, chamferMat: M.PANEL, capMat: M.PAINT
  });
  const tp = { at: 0.5, paneW: 1.6 * s, paneH: 1.4 * s, pitch: 2.4 * s, margin: 1.0 * s, frameExtra: 0.35 * s };
  windowRow(B, tower.chamfer[2], { ...tp, seed: L.seed + 7, allLit: true });
  windowRow(B, tower.chamfer[0], { ...tp, pitch: 2.7 * s, seed: L.seed + 8 });
  windowRow(B, tower.chamfer[4], { ...tp, pitch: 2.7 * s, seed: L.seed + 9 });
  if (lv >= 2) windowRow(B, tower.chamfer[6], { ...tp, paneW: 1.3 * s, pitch: 3.0 * s, seed: L.seed + 10 });
  if (lv >= 6) {
    windowRow(B, tower.chamfer[1], { ...tp, margin: 0.8 * s, seed: L.seed + 11, allLit: true });
    windowRow(B, tower.chamfer[3], { ...tp, margin: 0.8 * s, seed: L.seed + 12, allLit: true });
  }
  let roofZ = towerZ;
  const tb = polyBox(tower.top);
  let R = tb;
  // Druga kondygnacja (III, IV) albo górny mostek (V, VI): węższy blok z koroną okien na dachu wieży (w obrysie dachu).
  const upperZ = L.tier || L.top;
  if (upperZ) {
    const tw = tb.x1 - tb.x0;
    const ux0 = tb.x0 + tw * 0.06;
    const ux1 = tb.x1 - tw * (L.grille ? 0.32 : (L.top ? 0.16 : 0.06));
    const uy = (tb.y1 - tb.y0) * 0.5 * 0.86;
    const uH = Math.min(3.2 * s, (upperZ - towerZ) * 0.5);
    const upper = block(B, octPoly(ux0, -uy, ux1, uy, Math.min(uy, ux1 - ux0) * 0.2), towerZ, upperZ, {
      slope: [0.5 * s, 0.5 * s, 0.7 * s, 0.5 * s, 0.5 * s, 0.5 * s, 0.4 * s, 0.5 * s],
      chamfer: [uH, [uH, uH * 0.85, uH * 1.4, uH * 0.85, uH, uH * 0.75, uH * 0.6, uH * 0.75]],
      mat: M.PANEL, chamferMat: L.top ? M.TRIM : M.PANEL, capMat: M.PAINT
    });
    const up = { ...tp, paneW: 1.4 * s, paneH: 1.2 * s, margin: 0.7 * s };
    windowRow(B, upper.chamfer[2], { ...up, pitch: 2.1 * s, seed: L.seed + 13, allLit: true });
    windowRow(B, upper.chamfer[0], { ...up, pitch: 2.6 * s, seed: L.seed + 14 });
    windowRow(B, upper.chamfer[4], { ...up, pitch: 2.6 * s, seed: L.seed + 15 });
    roofZ = upperZ;
    R = polyBox(upper.top);
  } else {
    boxRot(B, (tb.x0 + tb.x1) * 0.5 + 0.6 * s, (tb.y0 + tb.y1) * 0.1, towerZ, (tb.x1 - tb.x0) * 0.34, (tb.y1 - tb.y0) * 0.3, 0.9 * s, 0, { mat: M.PANEL, chamfer: [0.3 * s, 0.3 * s] });
  }
  // Krata na dachu wieży (VI), przed górnym mostkiem.
  if (L.grille) {
    const gx0 = tb.x1 - (tb.x1 - tb.x0) * 0.27; const gx1 = tb.x1 - (tb.x1 - tb.x0) * 0.04;
    const gy = (tb.y1 - tb.y0) * 0.5 * 0.7;
    block(B, rectPoly(gx0, -gy, gx1, gy), towerZ, towerZ + 0.8 * s, { mat: M.DARK });
    for (let k = 0; k < 7; k++) boxRot(B, (gx0 + gx1) * 0.5, -gy + gy * 2 * (k + 0.5) / 7, towerZ + 0.8 * s, gx1 - gx0 - 2 * s, 1.6 * s, 0.6 * s, 0, { mat: M.PANEL });
  }
  B.end();

  // KOPUŁA SENSORÓW (I–V) albo KAPSUŁA CZUJNIKÓW (VI) na dziobie strefy.
  B.begin('kopula', L.capsule ? 'Kapsuła czujników' : 'Kopuła sensorów');
  if (L.capsule) {
    const cx0 = X(0.5); const cx1 = X(0.9); const cy = Y(0.42);
    block(B, octPoly(cx0, -cy, cx1, cy, cy * 0.5), deckZ, deckZ + 5.5 * s, { slope: 1.3 * s, chamfer: [0.7 * s, 0.7 * s], mat: M.PAINT, chamferMat: M.PANEL, capMat: M.DARK });
    dome(B, (cx0 + cx1) * 0.5, 0, deckZ + 5.5 * s, (cx1 - cx0) * 0.36, 6.2 * s, { seg: 22, rings: 5, mat: M.BRIGHT, ry: cy * 0.62 });
  } else {
    const dx = X(L.dome[0]);
    const dr = L.dome[1] * hh;
    cylinder(B, dx, 0, deckZ, hallZ + 0.8 * s, dr, dr * 0.97, { seg: 20, mat: M.PANEL });
    cylinder(B, dx, 0, hallZ + 0.8 * s, hallZ + 1.4 * s, dr * 0.92, dr * 0.9, { seg: 20, mat: M.DARK });
    if (lv >= 3) cylinder(B, dx, 0, hallZ + 1.4 * s, hallZ + 1.8 * s, dr * 0.88, dr * 0.86, { seg: 20, mat: M.BRIGHT });
    const dz = hallZ + (lv >= 3 ? 1.8 : 1.4) * s;
    dome(B, dx, 0, dz, dr * 0.82, dr * 0.58, { seg: 20, rings: 5, mat: M.BRIGHT });
    if (lv >= 4) cylinder(B, dx, 0, dz + dr * 0.56, dz + dr * 0.56 + 1.4 * s, 0.9 * s, 0.7 * s, { seg: 8, mat: M.DARK });
  }
  B.end();

  // POSTERUNKI OBSERWACYJNE (V, VI): ośmiokątne budki z koroną okien i kopułką przy przednich narożnikach.
  if (L.posts) {
    B.begin('posterunki', 'Posterunki obserwacyjne');
    const r = 0.15 * hh;
    const pu = L.capsule ? 0.62 : 0.6;
    for (const sy of [-1, 1]) {
      const cx = X(pu); const cy = sy * (hh - r - 1.4 * s);
      const post = block(B, octPoly(cx - r, cy - r, cx + r, cy + r, r * 0.42), deckZ, deckZ + 4.6 * s, {
        slope: 0.5 * s, chamfer: [2.0 * s, 1.8 * s], mat: M.PAINT, chamferMat: M.PANEL, capMat: M.PANEL
      });
      windowRow(B, post.chamfer[2], { at: 0.5, paneW: 1.3 * s, paneH: 1.1 * s, pitch: 2.0 * s, margin: 0.6 * s, seed: L.seed + 16 + sy, allLit: true });
      windowRow(B, post.chamfer[sy > 0 ? 4 : 0], { at: 0.5, paneW: 1.3 * s, paneH: 1.1 * s, pitch: 2.1 * s, margin: 0.6 * s, seed: L.seed + 18 + sy });
      cylinder(B, cx, cy, deckZ + 4.6 * s, deckZ + 5.2 * s, r * 0.58, r * 0.56, { seg: 14, mat: M.DARK });
      dome(B, cx, cy, deckZ + 5.2 * s, r * 0.52, r * 0.4, { seg: 14, rings: 4, mat: M.BRIGHT });
    }
    B.end();
  }

  // MASZTY: pierwszy (czerwona lampa) od I, poprzeczka od II, biały od III, trzeci (czerwony) od V; VI — anteny biczowe.
  B.begin('maszt', 'Maszty i anteny');
  const mastH = [0, 3.6, 5.2, 6.6, 8.4, 10.5, 14][lv];
  const ms = 0.45 * s;
  const rw = R.x1 - R.x0; const rh = (R.y1 - R.y0) * 0.5;
  const mx = R.x0 + rw * (L.masts >= 3 ? 0.5 : 0.3);
  const masts = L.masts >= 3
    ? [[mx, -rh * 0.55, mastH, 'beacon_red', 0], [mx, rh * 0.55, mastH, 'beacon_red', 0.5], [mx - rw * 0.25, 0, mastH * 1.35, 'beacon_white', 0.25]]
    : (L.masts === 2 ? [[mx, rh * 0.5, mastH, 'beacon_red', 0], [R.x0 + rw * 0.72, -rh * 0.45, mastH * 0.72, 'beacon_white', 0.4]] : [[mx, rh * 0.45, mastH, 'beacon_red', 0]]);
  for (const [x, y, h, color, ph] of masts) {
    block(B, rectPoly(x - ms, y - ms, x + ms, y + ms), roofZ, roofZ + h, { mat: M.BRIGHT });
    beacon(B, x, y, roofZ + h + 0.4 * s, color, { period: color === 'beacon_white' ? 2.2 : 1.6, phase: ph, size: 0.45 * s + 0.1, core: 1.0 * s + 0.2 });
  }
  if (lv >= 2) {
    // poprzeczka masztu (od V — między masztami burtowymi) i antena na narożniku dachu wieży
    const [x0, y0, h0] = masts[0];
    const yc = L.masts >= 3 ? 0 : y0;
    const span = L.masts >= 3 ? rh * 0.55 : Math.min(2.6 * s, rh * 0.8);
    block(B, rectPoly(x0 - 0.3 * s, yc - span, x0 + 0.3 * s, yc + span), roofZ + h0 * 0.74, roofZ + h0 * 0.74 + 0.6 * s, { mat: M.BRIGHT });
    tube(B, [tb.x1 - 1.6 * s, tb.y0 + 1.4 * s, towerZ], [tb.x1 - 1.8 * s, tb.y0 + 1.2 * s, towerZ + mastH * 0.6], 0.3 * s, 0.16 * s, { seg: 6, mat: M.BRIGHT });
  }
  for (let k = 0; k < (L.whips || 0); k++) {
    const y = (k ? 1 : -1) * rh * 0.75;
    tube(B, [R.x0 + 1.2 * s, y, roofZ], [R.x0 + 0.9 * s, y * 1.02, roofZ + mastH * 0.8], 0.34 * s, 0.14 * s, { seg: 6, mat: M.BRIGHT });
  }
  B.end();

  // KOPUŁKI CZUJNIKÓW przy burtach pokładu (od II: 2 na rufie, III: + dziób, IV: 4, VI: 6).
  if (L.domelets) {
    B.begin('czujniki', 'Kopułki czujników');
    const r = 1.7 * s;
    const xr = -hw + ch + r + 0.6 * s;
    const xf = hw - ch - r - 0.6 * s;
    const yy = hh - r - 0.8 * s;
    const spots = [[xr, yy], [xr, -yy], [xf, yy], [xf, -yy], [X(0.0), yy], [X(0.0), -yy]].slice(0, L.domelets);
    for (const [x, y] of spots) {
      cylinder(B, x, y, deckZ, deckZ + 0.5 * s, r * 1.1, r * 1.05, { seg: 10, mat: M.PANEL });
      dome(B, x, y, deckZ + 0.5 * s, r * 0.94, r * 0.76, { seg: 10, rings: 3, mat: M.BRIGHT });
    }
    B.end();
  }
}

// ---------------------------------------------------------------------------
// Modele floty (piraci, megafrachtowiec). Położenia cech czytane
// ze sprite'ów w px PNG i przeliczane przez P (pngMap): P.x(px), P.y(py) →
// przestrzeń M, P.len(d) → długość. Wysokości w jednostkach renderu.
// ---------------------------------------------------------------------------

// PIRACI — wspólne: najeżona kopuła, krata chłodnic, krzywy maszt
// z pomarańczową lampą.
function spikedDome(B, cx, cy, z0, r, hz, o = {}) {
  cylinder(B, cx, cy, z0, z0 + hz * 0.25, r * 1.08, r * 1.02, { seg: o.seg || 16, mat: M.DARK });
  dome(B, cx, cy, z0 + hz * 0.25, r, hz, { seg: o.seg || 16, rings: 5, mat: M.PAINT });
  const n = o.count ?? 6;
  for (let k = 0; k < n; k++) {
    const az = (k / n) * Math.PI * 2 + (o.twist ?? 0.35);
    const el = 0.55 + 0.2 * Math.sin(k * 2.3);
    const dir = [Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)];
    const base = [cx + dir[0] * r * 0.9, cy + dir[1] * r * 0.9, z0 + hz * 0.25 + dir[2] * hz * 0.9];
    tube(B, base, add3(base, mul3(dir, r * (0.5 + 0.25 * bridgeHash01(k, 7)))), r * 0.13, 0, { seg: 6, mat: M.BRIGHT });
  }
}

function grille(B, x0, y0, x1, y1, z0, dz, bars, s) {
  block(B, rectPoly(x0, y0, x1, y1), z0, z0 + dz, { mat: M.DARK });
  const h = (y1 - y0) / bars;
  for (let k = 0; k < bars; k++) {
    boxRot(B, (x0 + x1) * 0.5, y0 + h * (k + 0.5), z0 + dz, x1 - x0 - 1.0 * s, h * 0.45, 0.45 * s, 0, { mat: M.GRIME, chamfer: [0.16 * s, 0.16 * s] });
  }
}

function crookedMast(B, x, y, z, h, s) {
  const tip = [x - h * 0.05, y - h * 0.02, z + h];
  tube(B, [x, y, z], tip, 0.34 * s, 0.22 * s, { seg: 6, mat: M.DARK });
  tube(B, [x - 1.5 * s, y - 0.1 * s, z + h * 0.72], [x + 1.3 * s, y - 0.1 * s, z + h * 0.78], 0.2 * s, 0.2 * s, { seg: 5, mat: M.DARK });
  beacon(B, tip[0], tip[1], tip[2] + 0.3 * s, 'beacon_pirate', { period: 0.9, size: 0.45 * s, core: 1.0 * s });
}

// FREGATA PIRATÓW — na sprite'cie: najeżona kula na kwadratowym bloku,
// dwa wielkie rogi ku rufie, budka z oknem przed kulą (od góry obrazka)
// i krata chłodnic ku dziobowi.
function buildPirateFrigate(B, W, H, P) {
  const hw = W / 2;
  const hh = H / 2;
  const s = 0.42;
  const plateZ = 0.8;
  const bunkerZ = 2.9;

  B.begin('plyta', 'Płyta nadbudówki');
  const base = [[-hw, -hh * 0.62], [-hw * 0.62, -hh], [hw * 0.72, -hh], [hw, -hh * 0.5], [hw, hh * 0.5], [hw * 0.72, hh], [-hw * 0.62, hh], [-hw, hh * 0.62]];
  block(B, base, 0, plateZ, { chamfer: [0.3, 0.4], mat: M.PANEL, chamferMat: M.GRIME, capMat: M.PANEL });
  boxRot(B, 1, -hh * 0.8, plateZ, 5, 1.8, 0.3, 5, { mat: M.GRIME });
  boxRot(B, -hw * 0.5, hh * 0.75, plateZ, 4, 2.0, 0.3, -4, { mat: M.TRIM });
  B.end();

  B.begin('bunkier', 'Blok kuli');
  const bunker = block(B, octPoly(P.x(-527), P.y(82), P.x(-392), P.y(-52), 1.4), plateZ, bunkerZ, {
    slope: 0.4, chamfer: [0.9, [0.95, 0.85, 1.05, 0.85, 0.95, 0.8, 0.8, 0.8]],
    mat: M.PAINT, chamferMat: M.GRIME, capMat: M.PAINT
  });
  const slit = { at: 0.5, paneW: 0.85, paneH: 0.3, margin: 0.35, frameExtra: 0.12 };
  windowRow(B, bunker.chamfer[2], { ...slit, pitch: 1.25, seed: 121, allLit: true });
  windowRow(B, bunker.chamfer[0], { ...slit, pitch: 1.4, seed: 122 });
  windowRow(B, bunker.chamfer[6], { ...slit, pitch: 1.5, seed: 124 });
  B.end();

  B.begin('budka', 'Budka z oknem');
  const cab = block(B, octPoly(P.x(-456), P.y(-55), P.x(-391), P.y(-92), 0.7), plateZ, bunkerZ + 0.3, {
    slope: 0.3, chamfer: [0.8, [0.8, 0.7, 0.9, 0.7, 0.9, 0.6, 0.6, 0.6]],
    mat: M.PAINT, chamferMat: M.GRIME, capMat: M.PAINT
  });
  windowRow(B, cab.chamfer[4], { ...slit, paneW: 0.9, pitch: 1.2, seed: 125, allLit: true });
  windowRow(B, cab.chamfer[2], { ...slit, paneW: 0.6, pitch: 0.9, margin: 0.2, seed: 126, allLit: true });
  B.end();

  const dx = P.x(-471); const dy = P.y(19); const dr = P.len(41);
  B.begin('kopula', 'Najeżona kula');
  spikedDome(B, dx, dy, bunkerZ, dr * 0.92, 3.0, { count: 6 });
  B.end();

  B.begin('rogi', 'Rogi kuli');
  // Dwa wielkie rogi ku rufie — jak na sprite'cie (od kuli do grotów).
  for (const [from, to] of [[[-505, -10], [-555, -40]], [[-507, 50], [-557, 82]]]) {
    const a = [P.x(from[0]), P.y(from[1]), bunkerZ + 1.1];
    const b = [P.x(to[0]), P.y(to[1]), bunkerZ + 2.4];
    tube(B, a, b, 0.62, 0, { seg: 6, mat: M.BRIGHT });
    cylinder(B, a[0], a[1], bunkerZ + 0.5, bunkerZ + 1.5, 0.8, 0.72, { seg: 7, mat: M.GRIME });
  }
  B.end();

  B.begin('kraty', 'Krata chłodnic');
  grille(B, P.x(-360), P.y(59), P.x(-325), P.y(-21), plateZ, 0.8, 5, s);
  B.end();

  B.begin('rury', 'Rury');
  tube(B, [-hw + 1.4, -hh + 1.8, plateZ + 0.4], [hw - 2.8, -hh + 1.8, plateZ + 0.4], 0.4, 0.4, { seg: 8, mat: M.GRIME, capA: true });
  tube(B, [P.x(-380), hh - 1.8, plateZ + 0.35], [hw - 2.4, hh - 1.8, plateZ + 0.35], 0.34, 0.34, { seg: 8, mat: M.DARK, capA: true });
  B.end();

  B.begin('maszt', 'Krzywy maszt');
  crookedMast(B, P.x(-405), P.y(-40), bunkerZ, 5.0, s);
  B.end();
}

// NISZCZYCIEL PIRATÓW — na sprite'cie: wysoki bunkier z namalowaną czaszką
// i piszczelami, płyty po obu stronach i krata chłodnic ku dziobowi.
// Czaszka jest w modelu płaskorzeźbą (czerep ku górze obrazka = +Y).
function buildPirateDestroyer(B, W, H, P) {
  const hw = W / 2;
  const hh = H / 2;
  const s = 0.62;
  const plateZ = 1.3;
  const bunkerZ = 6.4;

  B.begin('plyta', 'Płyta nadbudówki');
  const base = [[-hw, -hh * 0.55], [-hw * 0.72, -hh], [hw * 0.6, -hh], [hw, -hh * 0.45], [hw, hh * 0.5], [hw * 0.62, hh], [-hw * 0.72, hh], [-hw, hh * 0.6]];
  block(B, base, 0, plateZ, { chamfer: [0.5, 0.65], mat: M.PANEL, chamferMat: M.GRIME, capMat: M.PANEL });
  boxRot(B, -6, -hh * 0.8, plateZ, 9, 3, 0.45, 4, { mat: M.GRIME });
  boxRot(B, 10, hh * 0.8, plateZ, 8, 2.8, 0.45, -5, { mat: M.TRIM });
  B.end();

  B.begin('plyty', 'Płyty boczne');
  block(B, octPoly(P.x(-539), P.y(43), P.x(-489), P.y(-58), 1.4), plateZ, plateZ + 2.2, { slope: 0.5, chamfer: [0.4, 0.5], mat: M.PAINT, chamferMat: M.GRIME, capMat: M.PANEL });
  block(B, octPoly(P.x(-386), P.y(41), P.x(-343), P.y(-54), 1.4), plateZ, plateZ + 2.6, { slope: 0.5, chamfer: [0.4, 0.5], mat: M.PAINT, chamferMat: M.GRIME, capMat: M.PANEL });
  B.end();

  const bx0 = P.x(-478); const bx1 = P.x(-388);
  const by0 = P.y(70); const by1 = P.y(-89);
  B.begin('bunkier', 'Bunkier dowodzenia');
  const bunker = block(B, octPoly(bx0, by0, bx1, by1, 2.8), plateZ, bunkerZ, {
    slope: [1.1, 1.0, 1.3, 1.0, 1.1, 0.9, 0.8, 0.9],
    chamfer: [1.9, [2.0, 1.7, 2.3, 1.7, 2.0, 1.5, 1.5, 1.5]],
    mat: M.PAINT, chamferMat: M.GRIME, capMat: M.DARK
  });
  const slit = { at: 0.5, paneW: 1.5, paneH: 0.5, margin: 1.0, frameExtra: 0.2 };
  windowRow(B, bunker.chamfer[2], { ...slit, pitch: 2.3, seed: 131, allLit: true });
  windowRow(B, bunker.chamfer[0], { ...slit, pitch: 2.8, seed: 132 });
  windowRow(B, bunker.chamfer[4], { ...slit, pitch: 2.8, seed: 133 });
  windowRow(B, bunker.chamfer[6], { ...slit, pitch: 3.0, seed: 134 });
  B.end();

  B.begin('czaszka', 'Czaszka i piszczele');
  const cx = P.x(-432.5); const cy = P.y(-15);
  dome(B, cx, cy + 1.2, bunkerZ, 3.6, 1.8, { seg: 14, rings: 4, mat: M.BRIGHT, ry: 3.2 });
  for (const ox of [-1.35, 1.35]) boxRot(B, cx + ox, cy + 0.9, bunkerZ + 1.25, 1.3, 1.1, 0.5, 0, { mat: M.DARK });
  boxRot(B, cx, cy - 2.3, bunkerZ, 3.4, 1.5, 0.9, 0, { mat: M.BRIGHT, chamfer: [0.25, 0.25] });
  for (const d of [-1, 1]) boxRot(B, cx, cy - 4.4, bunkerZ, 11, 0.95, 0.5, 32 * d, { mat: M.BRIGHT });
  B.end();

  B.begin('kraty', 'Krata chłodnic');
  grille(B, P.x(-309), P.y(39), P.x(-274), P.y(-49), plateZ, 1.2, 6, s);
  B.end();

  B.begin('kolce', 'Kolce');
  const spikes = [
    [[bx0 + 1, by0 + 2, plateZ + 1.4], [-0.55, -0.8, 0.28], 6.5, 0.95],
    [[bx0 + 1, by1 - 2, plateZ + 1.4], [-0.55, 0.8, 0.28], 6.5, 0.95],
    [[bx1 - 2, by1 - 1.2, bunkerZ - 0.9], [0.35, 0.75, 0.75], 4.2, 0.75],
    [[bx1 - 2, by0 + 1.2, bunkerZ - 0.9], [0.35, -0.75, 0.75], 4.2, 0.75]
  ];
  for (const [p, d, len, r] of spikes) {
    const dir = norm3(d);
    tube(B, p, add3(p, mul3(dir, len)), r, 0, { seg: 6, mat: M.BRIGHT });
    cylinder(B, p[0], p[1], Math.max(plateZ, p[2] - 0.8), p[2] + 0.2, r * 1.35, r * 1.2, { seg: 7, mat: M.DARK });
  }
  B.end();

  B.begin('rury', 'Rury');
  tube(B, [P.x(-386), hh - 2.2, plateZ + 0.7], [hw - 1.6, hh - 2.2, plateZ + 0.7], 0.7, 0.7, { seg: 8, mat: M.GRIME, capA: true });
  tube(B, [P.x(-386), -hh + 2.2, plateZ + 0.6], [hw - 2.0, -hh + 2.2, plateZ + 0.6], 0.58, 0.58, { seg: 8, mat: M.DARK, capA: true });
  B.end();

  B.begin('maszt', 'Krzywy maszt');
  crookedMast(B, bx1 - 3.5, by1 - 3.0, bunkerZ, 8.0, s);
  B.end();
}

// MEGAFRACHTOWIEC — lokomotywa. Na sprite'cie za dziobem: ciemna ośmiokątna
// płyta z jasnym „C” wokół modułu z okrągłym włazem, przed nią sterówka,
// po bokach kapsuły; pomarańczowe znaczniki. Przemysłowa stal, ciepłe okna.
function buildMegafreighter(B, W, H, P) {
  const hw = W / 2;
  const hh = H / 2;
  const deckZ = 4;
  const plateZ = 7;
  const ringZ = 16;
  const podZ = 19;
  const cabZ = 33;
  const cab2Z = 44;

  B.begin('poklad', 'Pokład dowodzenia');
  block(B, octPoly(-hw, -hh, hw, hh, 32), 0, deckZ, { chamfer: [1.4, 2.0], mat: M.PANEL, chamferMat: M.PANEL, capMat: M.PANEL });
  for (const [x, y, w, h] of [[-110, hh - 9, 24, 3], [-50, hh - 9, 24, 3], [-110, -hh + 9, 24, 3], [-50, -hh + 9, 24, 3], [hw - 12, 70, 3, 22], [hw - 12, -70, 3, 22]]) {
    boxRot(B, x, y, deckZ, w, h, 0.5, 0, { mat: M.TRIM });
  }
  B.end();

  const lx0 = P.x(352); const lx1 = P.x(482);
  const ly0 = P.y(90); const ly1 = P.y(-105);
  B.begin('plyta', 'Płyta modułu');
  block(B, octPoly(lx0, ly0, lx1, ly1, 30), deckZ, plateZ, { slope: 1.5, chamfer: [0.8, 1.0], mat: M.DARK, chamferMat: M.PANEL, capMat: M.DARK });
  // Detal płyty jak na sprite'cie: rury wzdłuż burt, skrzynki i znaczniki.
  for (const y of [ly0 + 10, ly1 - 10]) {
    tube(B, [lx0 + 34, y, plateZ + 1.6], [lx1 - 34, y, plateZ + 1.6], 1.6, 1.6, { seg: 8, mat: M.PANEL, capA: true });
    for (const x of [lx0 + 52, lx0 + 110, lx0 + 168]) boxRot(B, x, y + (y < 0 ? 7 : -7), plateZ, 14, 6, 1.4, 0, { mat: M.PANEL, chamfer: [0.4, 0.4] });
  }
  for (const [x, y] of [[lx1 - 16, ly0 + 40], [lx1 - 16, ly1 - 40], [lx0 + 18, 0]]) boxRot(B, x, y, plateZ, 4, 16, 0.5, 0, { mat: M.TRIM });
  B.end();

  const cx0 = P.x(371); const cx1 = P.x(457);
  const cy0 = P.y(61); const cy1 = P.y(-77);
  const band = P.len(19);
  const cc = 9;
  B.begin('obrecz', 'Obręcz „C”');
  // Grzbiet „C” ze ściętymi narożnikami zewnętrznymi; ramiona wchodzą w niego
  // prostym końcem — bez szczelin w narożnikach.
  const ring = { slope: 2.0, chamfer: [1.8, 2.2], mat: M.BRIGHT, chamferMat: M.PAINT, capMat: M.BRIGHT };
  const armX = cx0 + band - 1;
  block(B, [[cx0 + cc, cy0], [cx0 + band, cy0], [cx0 + band, cy1], [cx0 + cc, cy1], [cx0, cy1 - cc], [cx0, cy0 + cc]], plateZ, ringZ, ring);
  block(B, [[armX, cy1 - band], [cx1 - cc, cy1 - band], [cx1, cy1 - band + cc], [cx1, cy1 - cc], [cx1 - cc, cy1], [armX, cy1]], plateZ, ringZ, ring);
  block(B, [[armX, cy0], [cx1 - cc, cy0], [cx1, cy0 + cc], [cx1, cy0 + band - cc], [cx1 - cc, cy0 + band], [armX, cy0 + band]], plateZ, ringZ, ring);
  B.end();

  B.begin('modul', 'Moduł włazu');
  block(B, octPoly(P.x(400), P.y(29), P.x(460), P.y(-44), 9), plateZ, podZ, { slope: 2.2, chamfer: [2.4, 2.8], mat: M.PAINT, chamferMat: M.PANEL, capMat: M.PANEL });
  const hx = P.x(430); const hy = P.y(-8.5); const hr = P.len(21);
  cylinder(B, hx, hy, podZ, podZ + 2.0, hr, hr * 0.96, { seg: 24, mat: M.DARK });
  const hatch = block(B, octPoly(hx - hr * 0.82, hy - hr * 0.82, hx + hr * 0.82, hy + hr * 0.82, hr * 0.32), podZ + 2.0, podZ + 6.2, {
    slope: 0.8, chamfer: [2.4, 2.8], mat: M.PANEL, chamferMat: M.FRAME, capMat: M.PANEL
  });
  windowRow(B, hatch.chamfer[2], { at: 0.5, paneW: 3.0, paneH: 1.7, pitch: 4.4, margin: 1.4, seed: 141, allLit: true });
  windowRow(B, hatch.chamfer[0], { at: 0.5, paneW: 3.0, paneH: 1.7, pitch: 4.4, margin: 1.4, seed: 142 });
  windowRow(B, hatch.chamfer[4], { at: 0.5, paneW: 3.0, paneH: 1.7, pitch: 4.4, margin: 1.4, seed: 143 });
  dome(B, hx, hy, podZ + 6.2, hr * 0.5, 6.5, { seg: 24, rings: 4, mat: M.BRIGHT });
  B.end();

  B.begin('sterowka', 'Sterówka');
  const sx0 = P.x(482); const sx1 = P.x(562);
  const sy0 = P.y(26); const sy1 = P.y(-42);
  const cab = block(B, octPoly(sx0, sy0, sx1, sy1, 12), deckZ, cabZ, {
    slope: [2.6, 2.8, 4.4, 2.8, 2.6, 2.4, 2.0, 2.4],
    chamfer: [7.5, [7.0, 6.0, 10.5, 6.0, 7.0, 5.4, 5.0, 5.4]],
    mat: M.PAINT, chamferMat: M.PANEL, capMat: M.PAINT
  });
  const pane = { paneW: 4.0, paneH: 3.2, pitch: 5.8, margin: 2.8 };
  windowRow(B, cab.chamfer[2], { at: 0.5, ...pane, seed: 144, allLit: true });
  windowRow(B, cab.chamfer[1], { at: 0.5, ...pane, margin: 1.8, seed: 145, allLit: true });
  windowRow(B, cab.chamfer[3], { at: 0.5, ...pane, margin: 1.8, seed: 146, allLit: true });
  windowRow(B, cab.chamfer[0], { at: 0.5, ...pane, pitch: 6.6, seed: 147 });
  windowRow(B, cab.chamfer[4], { at: 0.5, ...pane, pitch: 6.6, seed: 148 });
  windowRow(B, cab.chamfer[6], { at: 0.5, ...pane, pitch: 7.2, seed: 149 });
  const top = block(B, octPoly(sx0 + 20, sy0 + 20, sx1 - 28, sy1 - 20, 7), cabZ, cab2Z, {
    slope: [1.4, 1.4, 2.0, 1.4, 1.4, 1.2, 1.0, 1.2],
    chamfer: [4.0, [3.8, 3.2, 5.8, 3.2, 3.8, 2.8, 2.6, 2.8]],
    mat: M.PANEL, chamferMat: M.TRIM, capMat: M.PAINT
  });
  windowRow(B, top.chamfer[2], { at: 0.5, paneW: 3.0, paneH: 2.2, pitch: 4.2, margin: 1.5, seed: 150, allLit: true });
  windowRow(B, top.chamfer[0], { at: 0.5, paneW: 2.8, paneH: 2.0, pitch: 4.8, margin: 1.8, seed: 151 });
  windowRow(B, top.chamfer[4], { at: 0.5, paneW: 2.8, paneH: 2.0, pitch: 4.8, margin: 1.8, seed: 152 });
  B.end();

  B.begin('kapsuly', 'Kapsuły burtowe');
  for (const [px, py, pw, ph, sgn] of [[516, -95, 48, 30, 1], [516, 82, 48, 31, -1]]) {
    const kx = P.x(px); const ky = P.y(py);
    const kw = P.len(pw) * 0.5; const kh = P.len(ph) * 0.5;
    block(B, octPoly(kx - kw, ky - kh, kx + kw, ky + kh, 8), deckZ, deckZ + 9, { slope: 2.0, chamfer: [1.4, 1.6], mat: M.PAINT, chamferMat: M.PANEL, capMat: M.PANEL });
    boxRot(B, kx - kw * 0.45, ky, deckZ + 9, kw * 0.4, kh * 1.1, 0.7, 0, { mat: M.TRIM });
    const bx = kx + kw * 0.5;
    const by = ky - sgn * kh * 0.2;
    block(B, rectPoly(bx - 0.9, by - 0.9, bx + 0.9, by + 0.9), deckZ + 9, deckZ + 21, { mat: M.BRIGHT });
    beacon(B, bx, by, deckZ + 21.6, 'beacon_amber', { period: 2.4, phase: sgn > 0 ? 0 : 0.5, size: 1.1, core: 2.2 });
  }
  B.end();

  B.begin('anteny', 'Anteny');
  const ax = (sx0 + sx1) * 0.5 - 8;
  for (const [y, h, color, ph] of [[-8, 24, 'beacon_white', 0], [16, 18, 'beacon_red', 0.3]]) {
    block(B, rectPoly(ax - 1.0, y - 1.0, ax + 1.0, y + 1.0), cab2Z, cab2Z + h, { mat: M.BRIGHT });
    beacon(B, ax, y, cab2Z + h + 0.8, color, { period: 2.2, phase: ph, size: 1.1, core: 2.2 });
  }
  block(B, rectPoly(ax - 0.6, -20, ax + 0.6, 26), cab2Z + 14, cab2Z + 15.1, { mat: M.BRIGHT });
  cylinder(B, sx0 + 12, sy1 - 14, cabZ, cabZ + 1.5, 7, 6.4, { seg: 16, mat: M.BRIGHT });
  B.end();
}

// Rufowy blok dowodzenia supercapitala: wysoki bunkier, boczna krata i warstwowe płyty.
function buildPirateSupercapital(B, W, H, P) {
  const plateZ = 2;
  const bunkerZ = 11;
  B.begin('plyta', 'Płyta nadbudówki');
  block(B, octPoly(-W / 2, -H / 2, W / 2, H / 2, 3), 0, plateZ,
    { chamfer: [0.7, 0.8], mat: M.PANEL, chamferMat: M.GRIME, capMat: M.PANEL });
  B.end();

  B.begin('bunkier', 'Bunkier dowodzenia');
  const bunker = block(B, octPoly(P.x(-405), P.y(120), P.x(-311), P.y(-100), 3), plateZ, bunkerZ,
    { slope: 1.5, chamfer: [2, 2.5], mat: M.PAINT, chamferMat: M.GRIME, capMat: M.PANEL });
  for (const side of [0, 2, 4, 6]) {
    windowRow(B, bunker.chamfer[side], { at: 0.5, paneW: 2.8, paneH: 0.8,
      margin: 1.4, frameExtra: 0.3, pitch: 4.4, seed: 140 + side, allLit: side === 2 });
  }
  boxRot(B, P.x(-355), P.y(12), bunkerZ, 28, 48, 1.2, 0, { mat: M.DARK });
  B.end();

  B.begin('kraty', 'Krata chłodnic');
  grille(B, P.x(-303), P.y(100), P.x(-259), P.y(-92), plateZ, 2, 9, 1);
  B.end();

  B.begin('plyty', 'Płyty pancerza');
  for (const y of [-94, 111]) {
    boxRot(B, P.x(-354), P.y(y), plateZ, W * 0.6, 8, 2, 0, { mat: M.TRIM, chamfer: [0.5, 0.8] });
  }
  B.end();
  B.begin('latarnia', 'Latarnia dowodzenia');
  cylinder(B, P.x(-355), P.y(-38), bunkerZ + 1.2, bunkerZ + 10.2, 1.3, 1.1, { seg: 8, mat: M.DARK });
  beacon(B, P.x(-355), P.y(-38), bunkerZ + 10.4, 'beacon_pirate', { period: 0.9, size: 0.8, core: 1.4 });
  B.end();
}

const BUILDERS = {
  ...Object.fromEntries(BRIDGE_LEVELS.map((lv) => [lv.model, (B, W, H) => buildTerranLevel(B, W, H, lv.level)])),
  ironskull: buildIronSkull,
  atlas_main: buildAtlasMain,
  atlas_backup: buildAtlasBackup,
  pirate_frigate: buildPirateFrigate,
  pirate_destroyer: buildPirateDestroyer,
  pirate_supercapital: buildPirateSupercapital,
  megafreighter: buildMegafreighter
};

/**
 * Buduje model danego rodzaju. Wynik (tablice typowane w przestrzeni M):
 *   positions, normals (Float32Array xyz), mat, module (Float32Array),
 *   index (Uint16Array/Uint32Array), modules (tabela), emitters (okna,
 *   lampy, paski), bounds {x0,y0,x1,y1,zMax}, design {w,h}.
 * Emitery, które coś zasłania z góry (okno pod wyższą bryłą), są odrzucane.
 */
export function buildBridgeModel(kind) {
  const spec = BRIDGE3D_KINDS[kind];
  const builder = BUILDERS[kind];
  if (!spec || !builder) throw new Error(`nieznany model mostka: ${kind}`);
  const B = new MeshBuilder();
  builder(B, spec.w, spec.h, bridgePngMap(spec));
  const vcount = B.vcount();
  const positions = Float32Array.from(B.pos);
  const normals = Float32Array.from(B.nrm);
  const mat = Float32Array.from(B.mat);
  const module = Float32Array.from(B.mod);
  const index = vcount > 65535 ? Uint32Array.from(B.idx) : Uint16Array.from(B.idx);
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity; let zMax = 0;
  for (let i = 0; i < vcount; i++) {
    const x = positions[i * 3]; const y = positions[i * 3 + 1]; const z = positions[i * 3 + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z > zMax) zMax = z;
  }
  const model = {
    kind,
    label: spec.label,
    design: { w: spec.w, h: spec.h },
    positions, normals, mat, module, index,
    vertexCount: vcount,
    triangleCount: index.length / 3,
    modules: B.modules,
    emitters: B.emitters,
    bounds: { x0, y0, x1, y1, zMax }
  };
  // Emitery zasłonięte z góry (np. okno hali pod wieżą) — bez światła,
  // inaczej świeciłyby przez bryłę na warstwie FG.
  const texel = Math.max(0.5, Math.min(2, Math.max(spec.w, spec.h) / 400));
  const field = bakeBridgeHeightField(model, texel);
  model.emitters = model.emitters.filter((e) => sampleHeightField(field, e.c[0], e.c[1]) <= e.c[2] + Math.max(0.45, texel - 0.05));
  model.heightField = field;
  return model;
}

// ---------------------------------------------------------------------------
// Mapa wysokości (cienie, AO, testy)
// ---------------------------------------------------------------------------

/**
 * Wysokość modelu z góry: max z trójkątów nad środkiem każdego teksela.
 * Rzutujemy każdy trójkąt na XY i rasteryzujemy barycentrycznie.
 */
export function bakeBridgeHeightField(model, texel = 0.5) {
  const b = model.bounds;
  const pad = texel * 2;
  const x0 = b.x0 - pad;
  const y0 = b.y0 - pad;
  const width = Math.ceil((b.x1 + pad - x0) / texel) + 1;
  const height = Math.ceil((b.y1 + pad - y0) / texel) + 1;
  const heights = new Float32Array(width * height);
  const P = model.positions;
  const I = model.index;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3; const bb = I[t + 1] * 3; const c = I[t + 2] * 3;
    const ax = P[a]; const ay = P[a + 1]; const az = P[a + 2];
    const bx = P[bb]; const by = P[bb + 1]; const bz = P[bb + 2];
    const cx = P[c]; const cy = P[c + 1]; const cz = P[c + 2];
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-9) continue; // pionowa ściana — z góry niewidoczna
    const minX = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / texel));
    const maxX = Math.min(width - 1, Math.ceil((Math.max(ax, bx, cx) - x0) / texel));
    const minY = Math.max(0, Math.floor((Math.min(ay, by, cy) - y0) / texel));
    const maxY = Math.min(height - 1, Math.ceil((Math.max(ay, by, cy) - y0) / texel));
    for (let j = minY; j <= maxY; j++) {
      const py = y0 + j * texel;
      for (let i = minX; i <= maxX; i++) {
        const px = x0 + i * texel;
        const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det;
        const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
        const z = l1 * az + l2 * bz + l3 * cz;
        const k = i + j * width;
        if (z > heights[k]) heights[k] = z;
      }
    }
  }
  return { width, height, x0, y0, texel, heights };
}

/** Wysokość w punkcie (M-space XY), dwuliniowo — jak próbkowanie w shaderze. */
export function sampleHeightField(field, x, y) {
  const fx = (x - field.x0) / field.texel;
  const fy = (y - field.y0) / field.texel;
  if (fx < 0 || fy < 0 || fx > field.width - 1 || fy > field.height - 1) return 0;
  const i = Math.floor(fx); const j = Math.floor(fy);
  const i1 = Math.min(field.width - 1, i + 1); const j1 = Math.min(field.height - 1, j + 1);
  const tx = fx - i; const ty = fy - j;
  const H = field.heights; const w = field.width;
  const a = H[i + j * w] * (1 - tx) + H[i1 + j * w] * tx;
  const b = H[i + j1 * w] * (1 - tx) + H[i1 + j1 * w] * tx;
  return a * (1 - ty) + b * ty;
}
