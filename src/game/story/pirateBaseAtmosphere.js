/**
 * POWIETRZE budowli bazy piratów (misja 1) — ROZSZCZELNIENIE, DEKOMPRESJA, WYLOT POWIETRZA i POŻARY (prośba użytkownika
 * 2026-10-19: „pożary / rozszczelnienie / dekompresja i wylot powietrza z budowli”). Czysty moduł gry (bez three, DOM
 * i `window` poza rejestracją w konsoli): decyzje (czy i gdzie wieje, jak mocno, czy płonie) zapadają tu, obraz
 * (src/3d/pirateBaseVents3D.js) dostaje stan klatki wyrw (blok migawki src/render/blocks/pirateVentsBlock.js).
 *
 * MODEL (jednostki gry, czas gry — pauza stoi):
 *  • MODUŁY CIŚNIENIOWE z układu bazy (pirateBaseLayout): ćwiartki bębna H-E/S/W/N, szyb H-C, wieża z głową H-T, sektory
 *    dysku mieszkalnego D-1…8, magazyn M-1 — objętość z wymiarów brył (PIRATE_BASE_SPEC), gaz znormalizowany
 *    (ρ = T = p = 1 na starcie, tlen 21%). Pomosty, plac kontenerów i zbiorniki paliwa nie mają powietrza.
 *  • WYPŁYW DO PRÓŻNI przez wyrwę jest DŁAWIONY (prędkość dźwięku w przewężeniu): ṁ = A·cd·c·ρ·√T, a gaz w module
 *    rozpręża się adiabatycznie (T ∝ ρ^(γ−1)) — ciśnienie p = ρ·T spada najpierw gwałtownie, potem coraz wolniej
 *    (p = (1 + 0,2·t/τ)^−7), strumień słabnie i stygnie; poniżej `endRho` moduł jest pusty (nie wieje i nie płonie).
 *    Czas τ = V / (A·cd·c) ściśnięty do [tauMin, tauMax] — całe zdarzenie trwa kilka–kilkanaście sekund (gra).
 *  • KAJUTY: mała wyrwa (krater broni, drobny zgniot — promień < `mainSize`) nie sięga głównej objętości (przegrody
 *    awaryjne trzymają): wieje tylko lokalna kajuta (V ∝ promień³ — krótki syk). Kajuta już opróżniona (krater obok
 *    wcześniejszego) nie wieje drugi raz. Duża wyrwa (pęknięcie kawałka, taran, zerwanie szyi) — główna objętość.
 *  • GRODZIE: moduły połączone przejściami (bęben ↔ szyb, szyb ↔ wieża, szyb ↔ dysk, sektory dysku między sobą). Przy
 *    PĘKNIĘCIU modułu (rodzaj 'break') przejścia do sąsiadów puszczają — sąsiad uchodzi przez rozerwany moduł (kaskada).
 *  • POŻAR tylko póki jest tlen: zapłon (zwarcia przy rozszczelnieniu, wybuch w module, paliwo z rur, uderzenie)
 *    rozpala moduł z palnym wnętrzem, ogień zużywa tlen i paliwo, grzeje gaz (szybszy, mniej biały strumień),
 *    a w wylatującym tlenie przy wyrwie daje KRÓTKIE JĘZORY OGNIA; poniżej `pO2Min` ogień gaśnie → ŻARZENIE brzegów
 *    i dym (gaśnie z τ smolderTau). Moduł bez powietrza nie płonie i nie wieje.
 *  • WYRWA przyczepiona do CIAŁA (encja kawałka / odłamu / spadającej bryły — także 3D: wieża, dysk): punkt i normalna
 *    w układzie ciała, pozycja z pozy ciała co krok (wieża dalej wypuszcza powietrze i płonie, spadając). Ciało znikło —
 *    wyrwa dryfuje z ostatnią prędkością.
 *
 * KONTRAKT (fizyka upadku wieży — sesja „Zniszczenie bazy piratów”, skrypty, konsola):
 *   breach({ module, x, y, z, nx, ny, nz, size, entity, kind })  — wyrwa: module = id kawałka ('H-T', 'D-3', 'H-E', …),
 *     x, y — GRA, z — wysokość świata (NaN — środek modułu), normalna na zewnątrz (gra: y w dół, z w górę; brak —
 *     od środka modułu), size — promień wyrwy [j.], entity — ciało, do którego wyrwa jest przyczepiona, albo null,
 *     kind — 'break' (pęknięcie: grodzie puszczają), 'main' albo 'cabin' (domyślnie z rozmiaru). → id wyrwy | −1.
 *   ignite({ module, x, y, z, size, entity })  — źródło ognia w module (przebicie dysku wieżą, uderzenie w skałę). → bool.
 *   stepPirateBaseAtmosphere(dt) — krok z kroku fizyki gry.
 *   pirateBaseVentFrame(lag, frameDt) — stan klatki dla obrazu (pozycje dosunięte o `lag` = SimClock.render − sim).
 * Dev: window.PirateBaseAtmosphere.test({ module, size, fire, kind }).
 */

import { k7HeightToZ } from '../../3d/haloRing/haloPortK7Layout.js';
import { createPirateVentsFrame, VENT_KIND, VENT_MAX, VENT_REC } from '../../render/blocks/pirateVentsBlock.js';

export const ATMO_TUNE = {
  enabled: true,
  gamma: 1.4,
  // Wypływ: c [j/s] w τ = V / (A·cd·c). Rozerwana ćwiartka bębna (wyrwa r ≈ 240 j.) — τ ≈ 1,6 s: połowa ciśnienia
  // w ~0,8 s, koniec (ρ < endRho) po ~9 s; wieża przez szyję (r 150 j.) i magazyn — ściśnięte do tauMax.
  flowSpeed: 1000,
  cd: 0.7,
  tauMin: 0.35, tauMax: 3.5,
  endRho: 0.04,               // gęstość, poniżej której moduł / kajuta jest pusta (strumień ~4% — nie widać go)
  // Kajuta za małą wyrwą: V = cabinK · promień³ (τ ∝ promień: krater r 20 j. — τ 0,3 s, syk ~2 s), τ w [cabinTauMin, cabinTauMax].
  cabinK: 33, cabinTauMin: 0.12, cabinTauMax: 1.4,
  cabinSpentR: 2.2,           // kajuta opróżniona: nowa mała wyrwa bliżej niż tyle × promień kajuty nie wieje
  cabinMinR: 45,              // promień kajuty [j.] (najmniej)
  mainSize: 70,               // wyrwa ≥ tyle j. promienia — główna objętość modułu (grodzie nie trzymają)
  // Grodzie (przejścia między modułami): pole przejścia × ułamek otwarcia przy pęknięciu sąsiada (ułamek na parę —
  // pirateBaseAtmoModules; między sektorami dysku drzwi grodzi trzymają lepiej).
  linkOpen: 0.55,
  // Koniec wyrwy: strumień poniżej flowEnd (nie widać go) — wyrwa przestaje się liczyć (resztka powietrza zostaje w module
  // na następną wyrwę); najdłużej ventMaxAge s (ostatnie ventFadeAge s — gaśnie).
  flowEnd: 0.05, ventMaxAge: 24, ventFadeAge: 4,
  wallTau: 25,                // [s] ściany oddają ciepło gazowi (T → 1)
  // Tlen i ogień (ciśnienie cząstkowe w jednostkach p0): zapłon i palenie tylko powyżej pO2Min, pełny ogień od pO2Full.
  o2: 0.21, pO2Min: 0.05, pO2Full: 0.15,
  fireGrow: 1.6,              // [1/s] narastanie (rozgorzenie — zasilane powietrzem rozszczelnienia)
  fireDecay: 3.0,             // [1/s] gaśnięcie bez tlenu
  fireO2Use: 0.012,           // tlen zużyty przez pełny ogień [ρ·x na s]
  fireFuelUse: 0.025,         // palne wnętrze zużyte przez pełny ogień [1/s]
  fireHeat: 0.25,             // grzanie gazu przez pełny ogień [T na s przy ρ = 1]
  fireTMax: 2.4,
  igniteKick: 0.18,           // ogień na starcie zapłonu
  smolderFromFire: 0.85,      // żarzenie po pożarze ∝ największy ogień
  smolderTau: 5,              // [s] gaśnięcie żarzenia
  smolderEnd: 0.03,
  ventFireFlow: 0.12,         // języki ognia przy wyrwie potrzebują strumienia (FLOW) — pełne od tyle
  sparkTau: 1.1,              // [s] gaśnięcie zwarć
  burstSize: 250,             // gwałtowność rozszczelnienia: promień wyrwy, przy którym BURST = 1
  // Wyrwy: łączenie bliskich (ten sam moduł, ta sama encja) — odległość względem promieni
  mergeK: 1.4, mergeMin: 60,
  // Zgniot (straty węzłów poza bronią): węzły zebrane w oknie `tearWindow` s w module dają wyrwę o polu
  // n · komórka² · tearArea (promień √(A/π)); bliżej niż `tearJoin` j. od wyrwy zgniotu w tym module — dokłada się do niej.
  tearWindow: 0.12, tearArea: 0.7, tearJoin: 260, tearMinNodes: 2,
  // Zwarcia przy rozszczelnieniu: szansa zapłonu przy pęknięciu wg rodzaju (× gwałtowność), opóźnienie zapłonu [s].
  shortChance: { drum: 0.55, core: 0.6, tech: 0.75, disc: 0.6, warehouse: 0.45 },
  igniteDelay: [0.08, 0.7],
  blastIgnite: 0.85,          // szansa zapłonu modułu od wybuchu w nim (paliwo z rur, reaktor, wybuchy rozpadu)
  // Miganie świateł budowli (zasilanie w obrazie): głębokość przy świeżej wyrwie, zanik [s].
  flickerDepth: 0.55, flickerTau: 2.2,
  maxVents: VENT_MAX
};

// Rodzaje modułów: palne wnętrze (0…1), zwarcia (iskry w wyrwie), zasilanie budowli w obrazie (pirateBaseBlock).
export const ATMO_KINDS = Object.freeze({
  drum: Object.freeze({ fuel: 0.6, spark: 0.7, power: 'habitat', size: 240 }),
  core: Object.freeze({ fuel: 0.35, spark: 0.9, power: 'habitat', size: 170 }),
  tech: Object.freeze({ fuel: 0.7, spark: 1.0, power: 'habitat', size: 210 }),
  disc: Object.freeze({ fuel: 1.0, spark: 0.8, power: 'disc', size: 280 }),
  warehouse: Object.freeze({ fuel: 1.0, spark: 0.5, power: 'warehouse', size: 260 })
});

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sat = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Deterministyczne losowanie (bez Math.random gry — obraz nie rusza przebiegu rozgrywki): hasz liczb całkowitych.
function hash01(a, b = 0) {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x165667b1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

// ------------------------------------------------------------------ moduły z układu

/** Moduły ciśnieniowe z układu bazy: [{ id, kind, structure, V, hx, hz, z, z0, z1, r, links }] (czysta geometria). */
export function pirateBaseAtmoModules(layout) {
  const H = layout.habitat;
  const z = (y) => k7HeightToZ(y);
  const out = [];
  const add = (id, kind, V, hx, hz, zc, z0, z1, r, extra = {}) => {
    const c = layout.chunkById.get(id);
    if (!c) return;
    out.push({ id, kind, structure: c.structure, V: Math.max(1e5, V), hx, hz, z: zc, z0, z1, r, ...extra });
  };
  // bęben: ćwiartki pierścienia innerR..drumR, od dna do korony ściany
  const dz0 = z(H.floorY), dz1 = z(H.wallTop);
  for (const q of H.quadrants) {
    const a = (q.a0 + q.a1) / 2;
    const rm = (H.innerR + H.drumR) / 2;
    add(q.id, 'drum', (Math.PI / 4) * (H.drumR * H.drumR - H.innerR * H.innerR) * (dz1 - dz0),
      Math.cos(a) * rm, Math.sin(a) * rm, (dz0 + dz1) / 2, dz0, dz1, H.drumR, { a0: q.a0, a1: q.a1 });
  }
  // szyb: kolumna coreR od dysku do szczytu szybu
  const cz0 = z(H.discY1), cz1 = z(H.coreTop);
  add('H-C', 'core', Math.PI * H.coreR * H.coreR * (cz1 - cz0), 0, 0, (cz0 + cz1) / 2, cz0, cz1, H.coreR);
  // wieża: szyja (rura) + talerz głowy + piasta
  const n0 = z(H.neckY0), n1 = z(H.neckY1), r0 = z(H.ringY0), r1 = z(H.ringY1), ht = z(H.headTop);
  const Vt = Math.PI * H.neckR * H.neckR * (n1 - n0) + Math.PI * (H.ringR1 * H.ringR1 - H.ringR0 * H.ringR0) * (r1 - r0)
    + Math.PI * H.headR * H.headR * (ht - r0);
  add('H-T', 'tech', Vt, 0, 0, (r0 + r1) / 2, n0, ht, H.ringR1, { neckZ0: n0, neckZ1: n1 });
  // dysk mieszkalny: sektory (z tarasami)
  const ds = H.discSectors;
  const d0 = z(H.discY0), d1 = z(H.discY1), t1 = z(H.tier1Y), t2 = z(H.tier2Y);
  const Vd = (Math.PI / ds) * (H.discR * H.discR * (d1 - d0) + H.tier1R * H.tier1R * (t1 - d1) + H.tier2R * H.tier2R * (t2 - t1));
  for (let k = 0; k < ds; k++) {
    const a = (k / ds) * TAU;
    add(`D-${k + 1}`, 'disc', Vd, Math.cos(a) * H.discR * 0.55, Math.sin(a) * H.discR * 0.55, (d0 + d1) / 2, d0, t2, H.discR,
      { a0: ((k - 0.5) / ds) * TAU, a1: ((k + 0.5) / ds) * TAU });
  }
  // magazyn
  const W = layout.warehouse;
  const wc = layout.chunkById.get('M-1');
  if (W && wc) {
    const w0 = z(wc.box.y0 + 160), w1 = z(W.wallTop);
    add('M-1', 'warehouse', W.w * W.d * (w1 - w0), W.x, W.z, (w0 + w1) / 2, w0, z(W.roofY), Math.hypot(W.w, W.d) / 2,
      { w: W.w, d: W.d });
  }
  // przejścia (grodzie): bęben ↔ szyb (korytarze pierścienia), szyb ↔ wieża (szyb windy w szyi), szyb ↔ dysk (trzon),
  // sektory dysku między sobą (drzwi w grodziach promieniowych)
  const byId = new Map(out.map((m) => [m.id, m]));
  const link = (a, b, area, openK = 1) => {
    const A = byId.get(a), B = byId.get(b);
    if (!A || !B) return;
    A.links.push({ to: b, area, open: 0, openK });
    B.links.push({ to: a, area, open: 0, openK });
  };
  for (const m of out) m.links = [];
  // Pola przejść [j²] po pęknięciu (× linkOpen): rozerwany moduł zabiera sąsiada w ~3–6 s (τ = V / (A·cd·c)) — dawniej
  // korytarze 9 tys. j² dawały ogon słabego strumienia przez minutę.
  for (const q of H.quadrants) link(q.id, 'H-C', 40000);
  link('H-C', 'H-T', Math.PI * H.neckR * H.neckR * 0.35);
  for (let k = 0; k < ds; k++) {
    link(`D-${k + 1}`, 'H-C', 25000);
    link(`D-${k + 1}`, `D-${((k + 1) % ds) + 1}`, 20000, 0.55);
  }
  return out;
}

// ------------------------------------------------------------------ stan

const S = {
  place: null,
  modules: [],
  byId: new Map(),
  vents: [],
  nextId: 1,
  time: 0,
  frame: createPirateVentsFrame(),
  // zgniot: wyrwy zebrane w oknie (moduł → { n, x, y, z, ent, t })
  tears: new Map(),
  stats: { breaches: 0, cabins: 0, mains: 0, merged: 0, refused: 0, ignitions: 0, fires: 0, dropped: 0, tears: 0 },
  flicker: { habitat: 1, disc: 1, fuel: 1, warehouse: 1 }
};

function makeModule(def, i, place) {
  const k = ATMO_KINDS[def.kind];
  const g = place ? place.toGame(def.hx, def.hz) : { x: def.hx, y: def.hz };
  return {
    ...def, index: i, kindIndex: VENT_KIND[def.kind] ?? 0,
    gx: g.x, gy: g.y,
    rho: 1, T: 1, x: ATMO_TUNE.o2,
    fire: 0, firePeak: 0, burning: false, fuel: k ? k.fuel : 0.5, smolder: 0,
    ignAt: -1, ignN: 0, breached: false, broken: false, spent: false,
    cabins: [], cabinN: 0,
    flick: 0, flickT: -1e9,
    outA: 0
  };
}

/** Atmosfera bazy w miejscu z planu misji (placePirateBase). Zwraca stan (diagnostyka). */
export function attachPirateBaseAtmosphere(place) {
  S.place = place || null;
  S.modules = [];
  S.byId.clear();
  S.vents.length = 0;
  S.tears.clear();
  S.time = 0;
  S.frame.has = false;
  S.frame.n = 0;
  for (const k in S.stats) S.stats[k] = 0;
  if (!place?.layout) return null;
  const defs = pirateBaseAtmoModules(place.layout);
  defs.forEach((d, i) => {
    const m = makeModule(d, i, place);
    S.modules.push(m);
    S.byId.set(m.id, m);
  });
  return S;
}

export function detachPirateBaseAtmosphere() {
  S.place = null;
  S.modules = [];
  S.byId.clear();
  S.vents.length = 0;
  S.tears.clear();
  S.frame.has = false;
  S.frame.n = 0;
}

/** Stan (diagnostyka, testy, narzędzia). */
export function pirateBaseAtmosphereState() { return S; }

// ------------------------------------------------------------------ ciała (przyczepienie wyrwy)

function bodyOf(e) {
  const h = e?.beamHull;
  const b = h && h.entity === e ? h.body : null;
  return b && !b.dead ? b : null;
}

function entityAlive(e) {
  if (!e || e.dead || e.destroyed || e._inPool) return false;
  if (e.beamHull && e.beamHull.entity !== e) return false;
  const b = e.beamHull?.body;
  if (b && b.dead) return false;
  return true;
}

// Ciało 3D (bryła silnika belek): pos (świat silnika: x, −y gry, z), quat; obrót wektora v przez q (świat ← ciało).
function qrot(q, x, y, z, out) {
  const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  out[0] = x + qw * tx + (qy * tz - qz * ty);
  out[1] = y + qw * ty + (qz * tx - qx * tz);
  out[2] = z + qw * tz + (qx * ty - qy * tx);
  return out;
}
function qrotInv(q, x, y, z, out) {
  const qx = -q.x, qy = -q.y, qz = -q.z, qw = q.w;
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  out[0] = x + qw * tx + (qy * tz - qz * ty);
  out[1] = y + qw * ty + (qz * tx - qx * tz);
  out[2] = z + qw * tz + (qx * ty - qy * tx);
  return out;
}
const _v3 = [0, 0, 0];
const _w3 = [0, 0, 0];

function isSolidEntity(e) {
  const b = bodyOf(e);
  return !!(b && (b.planar === false || e.beamHull?.solid3D || e.solid3D) && b.quat);
}

// Wyrwa przyczepiona do encji: punkt i normalna w układzie ciała.
function anchor(v, e) {
  v.ent = null;
  v.solid = false;
  if (!e || !entityAlive(e)) return;
  const b = bodyOf(e);
  if (isSolidEntity(e)) {
    qrotInv(b.quat, v.wx - b.pos.x, -v.wy - b.pos.y, v.wz - b.pos.z, _v3);
    v.lx = _v3[0]; v.ly = _v3[1]; v.lz = _v3[2];
    qrotInv(b.quat, v.nx, -v.ny, v.nz, _v3);
    v.lnx = _v3[0]; v.lny = _v3[1]; v.lnz = _v3[2];
    v.solid = true;
    v.ent = e;
    return;
  }
  const ex = Number(e.pos ? e.pos.x : e.x), ey = Number(e.pos ? e.pos.y : e.y);
  if (!Number.isFinite(ex) || !Number.isFinite(ey)) return;
  const a = Number(e.angle) || 0;
  const c = Math.cos(a), s = Math.sin(a);
  const dx = v.wx - ex, dy = v.wy - ey;
  v.lx = dx * c + dy * s; v.ly = -dx * s + dy * c; v.lz = v.wz;
  v.lnx = v.nx * c + v.ny * s; v.lny = -v.nx * s + v.ny * c; v.lnz = v.nz;
  v.ent = e;
}

// Poza wyrwy z ciała (krok): pozycja, normalna i prędkość punktu (gra). Ciało znikło — dryf z ostatnią prędkością.
function follow(v, dt) {
  const e = v.ent;
  if (e && !entityAlive(e)) v.ent = null;
  if (!v.ent) {
    v.wx += v.vx * dt; v.wy += v.vy * dt; v.wz += v.vz * dt;
    return;
  }
  if (v.solid) {
    const b = bodyOf(e);
    if (!b) { v.ent = null; return; }
    qrot(b.quat, v.lx, v.ly, v.lz, _v3);
    v.wx = b.pos.x + _v3[0]; v.wy = -(b.pos.y + _v3[1]); v.wz = b.pos.z + _v3[2];
    const w = b.angVel || null;
    const wx = w ? w.x : 0, wy = w ? w.y : 0, wz = w ? w.z : 0;
    // v = vel + ω × r (świat silnika) → gra (y odbite)
    const vx = (b.vel?.x || 0) + wy * _v3[2] - wz * _v3[1];
    const vy = (b.vel?.y || 0) + wz * _v3[0] - wx * _v3[2];
    const vz = (b.vel?.z || 0) + wx * _v3[1] - wy * _v3[0];
    v.vx = vx; v.vy = -vy; v.vz = vz;
    qrot(b.quat, v.lnx, v.lny, v.lnz, _w3);
    v.nx = _w3[0]; v.ny = -_w3[1]; v.nz = _w3[2];
    return;
  }
  const ex = Number(e.pos ? e.pos.x : e.x), ey = Number(e.pos ? e.pos.y : e.y);
  const a = Number(e.angle) || 0;
  const c = Math.cos(a), s = Math.sin(a);
  const rx = v.lx * c - v.ly * s, ry = v.lx * s + v.ly * c;
  v.wx = ex + rx; v.wy = ey + ry; v.wz = v.lz;
  const om = Number(e.angVel) || 0;
  v.vx = (Number(e.vel ? e.vel.x : e.vx) || 0) - om * ry;
  v.vy = (Number(e.vel ? e.vel.y : e.vy) || 0) + om * rx;
  v.vz = 0;
  v.nx = v.lnx * c - v.lny * s; v.ny = v.lnx * s + v.lny * c; v.nz = v.lnz;
}

// ------------------------------------------------------------------ wyrwy

function moduleOf(id) {
  if (!id) return null;
  return S.byId.get(String(id)) || null;
}

function cabinTau(size) {
  const T = ATMO_TUNE;
  return clamp(T.cabinK * size / (Math.PI * T.cd * T.flowSpeed), T.cabinTauMin, T.cabinTauMax);
}

// Normalna na zewnątrz modułu w punkcie (gra) — gdy wołający jej nie podał.
function outwardNormal(m, x, y, z, out) {
  let dx = x - m.gx, dy = y - m.gy;
  let dz = Number.isFinite(z) ? (z - m.z) * 0.6 : 0;
  if (m.kind === 'drum' || m.kind === 'disc' || m.kind === 'core' || m.kind === 'tech') {
    // moduły habitatu: od osi habitatu (bęben, dysk — promieniowo)
    const hc = S.place?.habitat;
    if (hc) { dx = x - hc.x; dy = y - hc.y; }
  }
  const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (l < 1e-6) { out[0] = 0; out[1] = 0; out[2] = 1; return out; }
  out[0] = dx / l; out[1] = dy / l; out[2] = dz / l;
  return out;
}

function sparkFor(m, burst) {
  const k = ATMO_KINDS[m.kind];
  return sat((k ? k.spark : 0.6) * (0.35 + 0.65 * burst));
}

/**
 * Wyrwa w module (KONTRAKT — patrz nagłówek). Zwraca id wyrwy (> 0) albo −1 (moduł nieznany, bez powietrza, kajuta
 * już opróżniona, atmosfera wyłączona).
 */
export function breach(o = {}) {
  const T = ATMO_TUNE;
  if (!T.enabled || !S.place) return -1;
  const m = moduleOf(o.module);
  if (!m) { S.stats.refused++; return -1; }
  const size = Math.max(4, Number(o.size) || 40);
  let kind = o.kind === 'break' || o.kind === 'main' || o.kind === 'cabin' ? o.kind : (size >= T.mainSize ? 'main' : 'cabin');
  const x = Number.isFinite(o.x) ? o.x : m.gx;
  const y = Number.isFinite(o.y) ? o.y : m.gy;
  const z = Number.isFinite(o.z) ? o.z : m.z;
  // Pęknięcie (konstrukcja puszcza) otwiera przejścia do sąsiadów nawet w pustym module — powietrze sąsiada uchodzi przez
  // niego; samo pęknięcie pustego modułu nie wieje.
  if (kind === 'break') openLinks(m);
  if (m.spent || m.rho < T.endRho) { S.stats.refused++; return -1; }
  const isMain = kind !== 'cabin';
  let nx = Number(o.nx), ny = Number(o.ny), nz = Number(o.nz);
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
    outwardNormal(m, x, y, z, _v3);
    nx = _v3[0]; ny = _v3[1]; nz = _v3[2];
  } else if (!Number.isFinite(nz)) nz = 0;
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  const ent = o.entity || null;
  // Łączenie z bliską wyrwą tego samego modułu, rodzaju i ciała.
  for (let i = 0; i < S.vents.length; i++) {
    const v = S.vents[i];
    if (v.dead || v.module !== m || v.main !== isMain || v.ent !== (ent && entityAlive(ent) ? ent : null)) continue;
    const d = Math.hypot(v.wx - x, v.wy - y, v.wz - z);
    if (d > Math.max(T.mergeMin, (v.size + size) * T.mergeK)) continue;
    const A = v.area + Math.PI * size * size * T.cd;
    v.area = A;
    v.size = Math.sqrt(A / (Math.PI * T.cd));
    v.burst = Math.max(v.burst, sat(size / T.burstSize) * (isMain ? 1 : 0.4));
    if (isMain) {
      m.breached = true;
      if (kind === 'break') m.broken = true;
    } else if (v.cabin) {
      // kajuta: większy otwór — szybciej
      v.cabin.tau = cabinTau(v.size);
    }
    S.stats.merged++;
    return v.id;
  }
  // Kajuta: lokalna objętość za przegrodami — już opróżniona (wyrwa obok wcześniejszej) nie wieje.
  let cabin = null;
  if (!isMain) {
    const cr = Math.max(T.cabinMinR, size);
    for (let i = 0; i < m.cabins.length; i++) {
      const c = m.cabins[i];
      if (Math.hypot(c.x - x, c.y - y, c.z - z) < (c.r + cr) * T.cabinSpentR * 0.5) { S.stats.refused++; return -1; }
    }
    cabin = { rho: m.rho, T: m.T, tau: cabinTau(size), x, y, z, r: cr };
    if (m.cabins.length < 24) m.cabins.push(cabin);
    else { m.cabins[m.cabinN % 24] = cabin; m.cabinN++; }
  }
  // numer wyrwy od podpięcia bazy — ziarno decyzji (zapłon, opóźnienie) i obrazu: ten sam przebieg = te same liczby
  // (id rośnie przez całą sesję — obraz nie myli nowej wyrwy ze starą po ponownym podpięciu)
  const serial = S.stats.breaches + 1;
  const v = {
    id: S.nextId++, module: m, main: isMain, cabin, size, area: Math.PI * size * size * T.cd,
    wx: x, wy: y, wz: z, nx, ny, nz, vx: Number(o.vx) || 0, vy: Number(o.vy) || 0, vz: Number(o.vz) || 0,
    lx: 0, ly: 0, lz: 0, lnx: 0, lny: 0, lnz: 0, ent: null, solid: false,
    t0: S.time, age: 0, dead: false,
    flow: 0, speed: 1, fire: 0, smolder: 0, ice: 1,
    burst: sat(size / T.burstSize) * (isMain ? 1 : 0.4),
    spark: 0, host: Number(ent?.beamHull?.dmgKey) || 0,
    seed: hash01(serial, m.index + 7) * 1e6
  };
  v.spark = sparkFor(m, v.burst) * (isMain ? 1 : 0.5);
  anchor(v, ent);
  if (!v.ent && !Number.isFinite(o.vx)) {
    // bez ciała (statyka kawałka pękającego animacją): dryf z kawałkiem — prędkość z opcji (gra: speed pęknięcia)
    const sp = Number(o.drift) || 0;
    v.vx = nx * sp; v.vy = ny * sp; v.vz = 0;
  }
  if (isMain) {
    m.breached = true;
    if (kind === 'break') m.broken = true;
    // zwarcia przy rozszczelnieniu: zapłon z opóźnieniem (wnętrze z elektryką, kable, okna cywilów)
    const ch = (T.shortChance[m.kind] ?? 0.5) * (0.5 + 0.5 * v.burst);
    if (m.ignAt < 0 && !m.burning && hash01(serial, 991) < ch) {
      const d = T.igniteDelay;
      m.ignAt = S.time + d[0] + (d[1] - d[0]) * hash01(serial, 313);
    }
    m.flick = 1;
    m.flickT = S.time;
    S.stats.mains++;
  } else {
    S.stats.cabins++;
    m.flick = Math.max(m.flick, 0.35);
    m.flickT = S.time;
  }
  S.stats.breaches++;
  if (S.vents.length >= T.maxVents) {
    // wyparcie najsłabszej (kajuty najpierw, potem najmniejszy strumień × promień)
    let worst = -1, wv = Infinity;
    for (let i = 0; i < S.vents.length; i++) {
      const u = S.vents[i];
      const w = (u.main ? 1 : 0.2) * (u.flow + u.fire + u.smolder * 0.5 + 0.01) * u.size;
      if (w < wv) { wv = w; worst = i; }
    }
    if (worst >= 0) { S.vents.splice(worst, 1); S.stats.dropped++; }
  }
  S.vents.push(v);
  return v.id;
}

function openLinks(m) {
  for (const l of m.links) {
    const f = ATMO_TUNE.linkOpen * (l.openK ?? 1);
    l.open = Math.max(l.open, f);
    const o = S.byId.get(l.to);
    if (o) for (const k of o.links) if (k.to === m.id) k.open = Math.max(k.open, f);
  }
}

/** Źródło ognia w module (KONTRAKT). Zwraca true, gdy moduł może zapłonąć (ma tlen i palne wnętrze). */
export function ignite(o = {}) {
  if (!ATMO_TUNE.enabled || !S.place) return false;
  const m = moduleOf(o.module);
  if (!m) return false;
  S.stats.ignitions++;
  const T = ATMO_TUNE;
  if (m.rho * m.T * m.x < T.pO2Min || m.fuel < 0.04) {
    // bez tlenu: gorące szczątki tylko się żarzą (wnętrze palne)
    if (m.fuel > 0.04) m.smolder = Math.max(m.smolder, 0.35);
    return false;
  }
  if (!m.burning) { m.ignAt = S.time; }
  else m.fire = Math.max(m.fire, Math.min(1, m.fire + 0.25));
  return true;
}

// ------------------------------------------------------------------ zdarzenia gry (klej — index.html)

const _n = [0, 0, 0];

/**
 * Kawałek bazy pęka (storyBaseBreak: próg punktów, rozpad finału, reakcja w rurach, rozpad budowli): pęknięcie modułu
 * (grodzie puszczają) z wyrwą po stronie punktu `at` (gra; null — środek), przyczepioną do encji `entity` (największy
 * odłam przy punkcie albo ciało kawałka; null — statyka dryfuje z prędkością `drift`). Moduł bez powietrza — nic.
 */
export function noteBaseChunkBreak(id, at, { entity = null, drift = 0, dir = 'out', power = 1.6 } = {}) {
  const m = moduleOf(id);
  const place = S.place;
  if (!m || !place) return -1;
  const H = place.layout.habitat;
  const hc = place.habitat;
  const k = ATMO_KINDS[m.kind];
  let size = (k ? k.size : 220) * clamp(0.75 + 0.18 * (Number(power) || 1.6), 0.8, 1.3);
  let x = m.gx, y = m.gy, z = m.z;
  let nx = 0, ny = 0, nz = 0;
  const ax = at && Number.isFinite(at.x) ? at.x : m.gx, ay = at && Number.isFinite(at.y) ? at.y : m.gy;
  if (m.kind === 'drum' || m.kind === 'disc') {
    // ściana zewnętrzna po stronie punktu (kąt w obrębie modułu)
    const h = place.toHub(ax, ay);
    let a = Math.atan2(h.z, h.x);
    const mid = (m.a0 + m.a1) / 2;
    const da = Math.atan2(Math.sin(a - mid), Math.cos(a - mid));
    const half = (m.a1 - m.a0) / 2 * 0.8;
    a = mid + clamp(da, -half, half);
    const r = m.kind === 'drum' ? H.drumR : H.discR * 0.92;
    const g = place.toGame(Math.cos(a) * r, Math.sin(a) * r);
    x = g.x; y = g.y;
    const dx = x - hc.x, dy = y - hc.y, l = Math.hypot(dx, dy) || 1;
    nx = dx / l; ny = dy / l;
    nz = m.kind === 'disc' ? -0.35 : 0.12;
    if (dir === 'in') { nx *= 0.6; ny *= 0.6; nz = m.kind === 'disc' ? -0.8 : 0.7; }
  } else if (m.kind === 'core') {
    // szyb pęka u szczytu (rura szyi) — powietrze w górę
    x = hc.x; y = hc.y; z = m.z1;
    nz = 1;
    const dx = ax - hc.x, dy = ay - hc.y, l = Math.hypot(dx, dy);
    if (l > 1) { nx = dx / l * 0.35; ny = dy / l * 0.35; }
  } else if (m.kind === 'tech') {
    // głowa: krawędź talerza ku punktowi (albo deterministycznie z modułu)
    let dx = ax - hc.x, dy = ay - hc.y, l = Math.hypot(dx, dy);
    if (l < 1) { const a = hash01(m.index, S.stats.breaches) * TAU; dx = Math.cos(a); dy = Math.sin(a); l = 1; }
    dx /= l; dy /= l;
    x = hc.x + dx * H.ringR1 * 0.9; y = hc.y + dy * H.ringR1 * 0.9; z = m.z;
    nx = dx; ny = dy; nz = 0.2;
  } else {
    // magazyn: ściana po stronie punktu
    const dx = ax - m.gx, dy = ay - m.gy, l = Math.hypot(dx, dy);
    const ux = l > 1 ? dx / l : 1, uy = l > 1 ? dy / l : 0;
    const r = Math.min(m.w || 1500, m.d || 950) * 0.5;
    x = m.gx + ux * r; y = m.gy + uy * r;
    nx = ux; ny = uy; nz = 0.15;
  }
  size = Math.min(size, m.r * 0.6);
  return breach({ module: id, x, y, z, nx, ny, nz, size, entity, kind: 'break', drift });
}

/**
 * Węzeł kawałka bazy stracony poza bronią (zgniot taranem, rozpad — HullBodies.onNodeLost / onSolidNodeLost): straty
 * w oknie `tearWindow` sumują się w wyrwę zgniotu (pole z liczby węzłów); bliska wyrwa zgniotu tego modułu rośnie.
 */
export function noteBaseNodeLost(id, entity, x, y, z = NaN, cell = 15) {
  const m = moduleOf(id);
  if (!m || !S.place || m.spent) return;
  let t = S.tears.get(m);
  if (!t) { t = { n: 0, x: 0, y: 0, z: 0, nz: 0, ent: null, t: S.time, cell }; S.tears.set(m, t); }
  if (t.n === 0) t.t = S.time;
  t.n++;
  t.x += x; t.y += y;
  if (Number.isFinite(z)) { t.z += z; t.nz++; }
  t.ent = entity || t.ent;
  t.cell = cell;
}

/** Krater broni w kawałku bazy (HullBodies.onImpact): mała wyrwa (kajuta — krótki syk) albo duża przy wielkim kraterze. */
export function noteBaseCrater(id, entity, x, y, z = NaN, radius = 20) {
  const m = moduleOf(id);
  if (!m || !S.place || m.spent) return -1;
  return breach({ module: id, x, y, z: Number.isFinite(z) ? z : m.z, size: Math.max(8, radius * 0.8), entity });
}

/**
 * Wybuch w punkcie (gra; size — rozmiar wybuchu): zapłon modułów, w których leży (paliwo z rur, reaktor, wybuchy
 * rozpadu, uderzenie). Zwraca liczbę modułów, które zapłonęły.
 */
export function noteBaseBlast(x, y, size = 300) {
  if (!S.place || !ATMO_TUNE.enabled) return 0;
  let n = 0;
  const r = Math.max(60, Number(size) || 300) * 0.9;
  for (const m of S.modules) {
    if (m.spent || m.burning) continue;
    const d = distToModule(m, x, y);
    if (d > r) continue;
    if (hash01(m.index + 31 * S.stats.ignitions, Math.floor(S.time * 10)) > ATMO_TUNE.blastIgnite) continue;
    if (ignite({ module: m.id, x, y })) n++;
  }
  return n;
}

// Odległość punktu gry od modułu w płaszczyźnie (0 w środku) — ćwiartki i sektory jako wycinki pierścienia.
function distToModule(m, x, y) {
  const place = S.place;
  const H = place.layout.habitat;
  const hc = place.habitat;
  if (m.kind === 'drum' || m.kind === 'disc') {
    const h = place.toHub(x, y);
    const r = Math.hypot(h.x, h.z);
    const a = Math.atan2(h.z, h.x);
    const mid = (m.a0 + m.a1) / 2;
    const da = Math.abs(Math.atan2(Math.sin(a - mid), Math.cos(a - mid)));
    const half = (m.a1 - m.a0) / 2;
    const r0 = m.kind === 'drum' ? H.innerR : 0, r1 = m.kind === 'drum' ? H.drumR : H.discR;
    const dr = r < r0 ? r0 - r : (r > r1 ? r - r1 : 0);
    const darc = da > half ? (da - half) * Math.max(r, 1) : 0;
    return Math.hypot(dr, darc);
  }
  if (m.kind === 'core' || m.kind === 'tech') return Math.max(0, Math.hypot(x - hc.x, y - hc.y) - (m.kind === 'core' ? H.innerR : H.ringR1));
  return Math.max(0, Math.hypot(x - m.gx, y - m.gy) - m.r);
}

/**
 * Zerwanie szyi habitatu (pirateBaseNeck onSnap): rura szyi pęka — powietrze z wieży uchodzi kikutem u spodu wieży
 * (wyrwa przyczepiona do bryły wieży, normalna w dół wieży), szyb — u szczytu (w górę).
 */
export function noteBaseNeckSnap(tower) {
  const place = S.place;
  if (!place) return 0;
  const H = place.layout.habitat;
  const hc = place.habitat;
  const t = moduleOf('H-T');
  const c = moduleOf('H-C');
  let n = 0;
  if (t) {
    const b = bodyOf(tower);
    let x = hc.x, y = hc.y, z = t.neckZ0, nx = 0, ny = 0, nz = -1;
    if (b && isSolidEntity(tower)) {
      // spód wieży: oś bryły (z ciała) w dół od środka masy do nasady szyi
      qrot(b.quat, 0, 0, -1, _v3);
      nx = _v3[0]; ny = -_v3[1]; nz = _v3[2];
      const down = Math.max(10, b.pos.z - t.neckZ0);
      x = b.pos.x + _v3[0] * down; y = -(b.pos.y + _v3[1] * down); z = b.pos.z + _v3[2] * down;
    }
    if (breach({ module: 'H-T', x, y, z, nx, ny, nz, size: H.neckR, entity: tower || null, kind: 'break' }) > 0) n++;
  }
  if (c && breach({ module: 'H-C', x: hc.x, y: hc.y, z: c.z1, nx: 0, ny: 0, nz: 1, size: H.neckR * 0.8, kind: 'break' }) > 0) n++;
  return n;
}

// ------------------------------------------------------------------ krok

function stepTears() {
  const T = ATMO_TUNE;
  for (const [m, t] of S.tears) {
    if (t.n <= 0) continue;
    if (S.time - t.t < T.tearWindow) continue;
    const n = t.n;
    const x = t.x / n, y = t.y / n, z = t.nz > 0 ? t.z / t.nz : m.z;
    const ent = t.ent;
    t.n = 0; t.x = 0; t.y = 0; t.z = 0; t.nz = 0; t.ent = null;
    if (n < T.tearMinNodes || m.spent) continue;
    const A = n * t.cell * t.cell * T.tearArea;
    // dołożenie do bliskiej wyrwy zgniotu (ta sama encja albo bez) — rośnie jej pole
    let best = null, bd = T.tearJoin;
    for (const v of S.vents) {
      if (v.dead || v.module !== m || !v.tear) continue;
      const d = Math.hypot(v.wx - x, v.wy - y);
      if (d < bd) { bd = d; best = v; }
    }
    if (best) {
      best.area += A;
      best.size = Math.sqrt(best.area / (Math.PI * T.cd));
      if (!best.main && best.size >= T.mainSize) {
        // zgniot przebił przegrody — wyrwa sięga głównej objętości
        best.main = true; best.cabin = null; m.breached = true;
      } else if (best.cabin) best.cabin.tau = cabinTau(best.size);
      S.stats.tears++;
      continue;
    }
    const size = Math.sqrt(A / (Math.PI * T.cd));
    const id = breach({ module: m.id, x, y, z, size, entity: ent });
    const v = id > 0 ? S.vents[S.vents.length - 1] : null;
    if (v && v.id === id) v.tear = true;
    if (id > 0) S.stats.tears++;
  }
}

function stepModules(dt) {
  const T = ATMO_TUNE;
  const g1 = T.gamma - 1;
  const c = T.flowSpeed;
  for (const m of S.modules) m.outA = 0;
  // wyrwa skończona (strumień niewidoczny) nie wypuszcza dalej — resztka powietrza zostaje na następną wyrwę
  for (const v of S.vents) if (!v.dead && v.main && !v.ended) v.module.outA += v.area;
  // przejścia między modułami (z wyższego ciśnienia do niższego; bez przeskoku ciśnień)
  for (const m of S.modules) {
    for (const l of m.links) {
      if (!(l.open > 0)) continue;
      const o = S.byId.get(l.to);
      if (!o || m.index > o.index) continue;   // para raz
      // moduł wypalony (pusty albo jego wyrwy się skończyły) nie przyjmuje i nie oddaje powietrza — resztka sąsiada
      // uchodziłaby przez niego niewidocznie
      if (m.spent || o.spent) continue;
      const pm = m.rho * m.T, po = o.rho * o.T;
      if (Math.abs(pm - po) < 1e-5) continue;
      const hi = pm > po ? m : o, lo = pm > po ? o : m;
      const ph = Math.max(pm, po), pl = Math.min(pm, po);
      const r = pl / ph;
      const psi = r < 0.528 ? 1 : Math.sqrt(Math.max(0, 1 - ((r - 0.528) / 0.472) ** 2));
      let dM = l.area * l.open * T.cd * c * hi.rho * Math.sqrt(hi.T) * psi * dt;   // masa [ρ0 · j³]
      // bez przeskoku: najwyżej połowa różnicy mas przy wyrównaniu
      const eq = (hi.rho * hi.V * lo.V - lo.rho * lo.V * hi.V) / (hi.V + lo.V);
      if (dM > eq * 0.5) dM = Math.max(0, eq * 0.5);
      if (!(dM > 0)) continue;
      const before = lo.rho * lo.V;
      hi.rho -= dM / hi.V;
      lo.rho += dM / lo.V;
      // mieszanie: tlen i temperatura
      lo.x = (lo.x * before + hi.x * dM) / (before + dM);
      lo.T = (lo.T * before + hi.T * dM) / (before + dM);
      hi.T *= Math.pow(Math.max(1e-4, hi.rho / (hi.rho + dM / hi.V)), g1);
    }
  }
  for (const m of S.modules) {
    // wypływ do próżni (dławiony), rozprężanie adiabatyczne
    if (m.outA > 0 && m.rho > 0) {
      const k = clamp(m.outA * T.cd * c / m.V, 1 / T.tauMax, 1 / T.tauMin);
      const r0 = m.rho;
      const dr = Math.min(r0 * 0.5, k * r0 * Math.sqrt(m.T) * dt);
      m.rho = r0 - dr;
      m.T *= Math.pow(m.rho / r0, g1);
    }
    // ściany oddają ciepło (powoli)
    m.T += (1 - m.T) * (1 - Math.exp(-dt / T.wallTau)) * (m.rho > T.endRho ? 1 : 0);
    // ogień
    const pO2 = m.rho * m.T * m.x;
    if (m.ignAt >= 0 && S.time >= m.ignAt) {
      m.ignAt = -1;
      if (pO2 > T.pO2Min && m.fuel > 0.04) {
        m.burning = true;
        m.fire = Math.max(m.fire, T.igniteKick);
        S.stats.fires++;
      } else if (m.fuel > 0.04) m.smolder = Math.max(m.smolder, 0.3);
    }
    if (m.burning) {
      const target = sat((pO2 - T.pO2Min) / (T.pO2Full - T.pO2Min)) * sat(m.fuel / 0.12);
      const rate = target > m.fire ? T.fireGrow : T.fireDecay;
      m.fire += (target - m.fire) * (1 - Math.exp(-rate * dt));
      if (m.fire > m.firePeak) m.firePeak = m.fire;
      m.fuel = Math.max(0, m.fuel - T.fireFuelUse * m.fire * dt);
      const rho = Math.max(0.03, m.rho);
      m.x = Math.max(0, m.x - T.fireO2Use * m.fire * dt / rho);
      m.T = Math.min(T.fireTMax, m.T + T.fireHeat * m.fire * dt / Math.max(0.15, m.rho));
      m.smolder = Math.max(m.smolder, m.fire * T.smolderFromFire);
      if (target <= 0.001 && m.fire < 0.02) { m.burning = false; m.fire = 0; }
    } else {
      m.smolder *= Math.exp(-dt / T.smolderTau);
      if (m.smolder < T.smolderEnd * 0.5) m.smolder = 0;
    }
    if (m.rho < T.endRho && !m.spent) { m.spent = true; m.rho = Math.max(0, m.rho); }
    // miganie zasilania (gaśnie)
    if (m.flick > 0) m.flick *= Math.exp(-dt / T.flickerTau);
  }
}

function stepVents(dt) {
  const T = ATMO_TUNE;
  const g1 = T.gamma - 1;
  for (let i = S.vents.length - 1; i >= 0; i--) {
    const v = S.vents[i];
    v.age = S.time - v.t0;
    follow(v, dt);
    const m = v.module;
    let rho, Tg;
    if (v.main) {
      rho = m.spent ? 0 : m.rho;
      Tg = m.T;
    } else {
      const c = v.cabin;
      if (c && c.rho > 0) {
        const k = 1 / c.tau;
        const r0 = c.rho;
        const dr = Math.min(r0 * 0.5, k * r0 * Math.sqrt(c.T) * dt);
        c.rho = r0 - dr;
        c.T *= Math.pow(Math.max(1e-6, c.rho / r0), g1);
        if (c.rho < T.endRho) c.rho = 0;
      }
      rho = c ? c.rho : 0;
      Tg = c ? c.T : 1;
    }
    v.flow = rho > 0 ? rho * Math.sqrt(Tg) : 0;
    // sufit wieku: ostatnie ventFadeAge s strumień gaśnie (kaskada przez grodzie nie wisi minutami)
    if (v.age > T.ventMaxAge - T.ventFadeAge) v.flow *= sat((T.ventMaxAge - v.age) / T.ventFadeAge);
    if (v.flow < T.flowEnd && !v.ended) v.ended = true;
    if (v.ended) v.flow = 0;
    v.speed = Math.sqrt(Math.max(0.05, Tg));
    // języki ognia w wylatującym tlenie: ogień modułu przy strumieniu (główna objętość) albo kajuty płonącego modułu
    v.fire = m.fire * sat(v.flow / T.ventFireFlow) * (v.main ? 1 : 0.6);
    v.smolder = m.smolder * (v.main ? 1 : 0.5);
    v.ice = sat(1 - 0.65 * v.fire) * sat(v.flow * 4);
    v.spark *= Math.exp(-dt / T.sparkTau);
    // moduł bez czynnej wyrwy głównej objętości po rozszczelnieniu — wypalony (nie wieje drugi raz)
    if (v.main && v.ended && !m.spent && !mainVentLive(m)) m.spent = true;
    // koniec: nic nie wieje, nie płonie i nie żarzy się (albo minął sufit wieku)
    if ((v.flow <= 0 && v.fire < 0.01 && v.smolder < T.smolderEnd && v.age > 0.5) || v.age >= T.ventMaxAge) {
      S.vents.splice(i, 1);
    }
  }
}

function mainVentLive(m) {
  for (const v of S.vents) if (v.module === m && v.main && !v.ended) return true;
  return false;
}

function stepFlicker() {
  const f = S.flicker;
  f.habitat = 1; f.disc = 1; f.fuel = 1; f.warehouse = 1;
  const T = ATMO_TUNE;
  const tq = Math.floor(S.time * 14);
  for (const m of S.modules) {
    const k = ATMO_KINDS[m.kind];
    if (!k || !(m.flick > 0.01)) continue;
    // migotanie: przerywane spadki zasilania (hasz czasu — bez Math.random), głębokość gaśnie
    const n = hash01(m.index * 131 + 17, tq);
    const dip = n < 0.35 ? 1 : (n < 0.55 ? 0.5 : 0);
    const v = 1 - T.flickerDepth * m.flick * dip;
    if (v < f[k.power]) f[k.power] = v;
  }
}

/** Krok atmosfery (krok fizyki gry). dt — czas gry (pauza = 0). */
export function stepPirateBaseAtmosphere(dt) {
  if (!S.place || !ATMO_TUNE.enabled) return;
  const step = Math.max(0, Math.min(0.1, Number(dt) || 0));
  if (!(step > 0)) return;
  S.time += step;
  stepTears();
  stepModules(step);
  stepVents(step);
  stepFlicker();
}

/**
 * Stan klatki wyrw dla obrazu (blok migawki / render wprost). lag — SimClock.render − SimClock.sim (pozy dosunięte
 * do czasu renderu: ciało jedzie dalej z prędkością punktu), frameDt — dt gry klatki (0 w pauzie). Bez alokacji.
 */
export function pirateBaseVentFrame(lag = 0, frameDt = 0) {
  const F = S.frame;
  F.has = !!S.place && ATMO_TUNE.enabled;
  F.time = S.time;
  F.dt = Math.max(0, Number(frameDt) || 0);
  if (!F.has) { F.n = 0; return F; }
  const R = VENT_REC, st = R.STRIDE, rec = F.rec;
  const L = Number.isFinite(lag) ? lag : 0;
  let n = 0;
  for (let i = 0; i < S.vents.length && n < VENT_MAX; i++) {
    const v = S.vents[i];
    const o = n * st;
    rec[o + R.ID] = v.id;
    rec[o + R.X] = v.wx + v.vx * L; rec[o + R.Y] = v.wy + v.vy * L; rec[o + R.Z] = v.wz + v.vz * L;
    rec[o + R.NX] = v.nx; rec[o + R.NY] = v.ny; rec[o + R.NZ] = v.nz;
    rec[o + R.VX] = v.vx; rec[o + R.VY] = v.vy; rec[o + R.VZ] = v.vz;
    rec[o + R.R] = v.size;
    rec[o + R.FLOW] = v.flow; rec[o + R.SPEED] = v.speed; rec[o + R.FIRE] = v.fire; rec[o + R.SMOLDER] = v.smolder;
    rec[o + R.ICE] = v.ice; rec[o + R.AGE] = v.age; rec[o + R.KIND] = v.module.kindIndex;
    rec[o + R.HOST] = v.ent ? (Number(v.ent.beamHull?.dmgKey) || 0) : 0;
    rec[o + R.SEED] = v.seed; rec[o + R.MAIN] = v.main ? 1 : 0; rec[o + R.MODULE] = v.module.index;
    rec[o + R.BURST] = v.burst; rec[o + R.SPARK] = v.spark;
    n++;
  }
  F.n = n;
  return F;
}

/** Miganie zasilania budowli (obraz: okna i lampy) — mnożnik 0…1 na kanał (habitat, disc, fuel, warehouse). */
export function pirateBaseAtmoFlicker() { return S.flicker; }

// ------------------------------------------------------------------ dev

const _testAt = { x: 0, y: 0 };
/**
 * Sztuczna wyrwa / pożar (konsola, narzędzia): module — id modułu (domyślnie 'H-E'), size — promień wyrwy, fire — zapłon
 * od razu, kind — rodzaj wyrwy (domyślnie 'break' dla dużych), at — punkt gry (domyślnie ściana zewnętrzna modułu).
 */
function devTest({ module = 'H-E', size = 0, fire = false, kind = null, at = null, entity = null } = {}) {
  const m = moduleOf(module);
  if (!m || !S.place) return -1;
  let id;
  if (!size || kind === 'break') {
    _testAt.x = at ? at.x : m.gx + (m.gx - S.place.habitat.x) * 0.5;
    _testAt.y = at ? at.y : m.gy + (m.gy - S.place.habitat.y) * 0.5;
    id = noteBaseChunkBreak(module, _testAt, { entity });
  } else {
    const n = outwardNormal(m, m.gx, m.gy, m.z, _n);
    const px = at ? at.x : m.gx + n[0] * m.r * 0.3, py = at ? at.y : m.gy + n[1] * m.r * 0.3;
    id = breach({ module, x: px, y: py, z: m.z, size, kind: kind || undefined, entity });
  }
  if (fire) ignite({ module });
  return id;
}

export const PirateBaseAtmosphere = {
  tune: ATMO_TUNE,
  kinds: ATMO_KINDS,
  state: () => S,
  modules: () => S.modules,
  vents: () => S.vents,
  breach, ignite,
  test: devTest,
  reset: () => { if (S.place) attachPirateBaseAtmosphere(S.place); }
};
