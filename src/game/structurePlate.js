/**
 * structurePlate — WIĄZANIE GRAFU DYSKU z POLEM PŁYTY silnika belek (docs/PLAN-zawalenia-budowli-3d.md § 3.5 p. 5, § 4.2;
 * synteza dema D20 § 2f; gotowe na E6).
 *
 * Dysk mieszkalny ma dwie prawdy, które muszą się zgadzać:
 *  - POLE PŁYTY silnika (beamPlateField3D.js, engine.addPlateField): grubość u8 na komórkę, styk z węzłami bryły belek (H-T)
 *    i punktami klastrów, nośność σ(utrzymanie) — to, w co uderza spadająca wieża;
 *  - GRAF NOŚNY E1 (structureGraph.js, buildDiscArchetype): bloki wycinków w dwóch warstwach, podpory SUPPORT na trzonie —
 *    to, co trzyma, pęka i odpada (wyspy → klastry przez gospodarza structureCollapse.js).
 * Wiązanie (odpowiednik plateBindGraph / _plateKillBlocks prototypu E1 dla pola silnika: origin / u / v / nu / nv):
 *  - komórka → blok GÓRNEJ warstwy (najbliższy w rzucie) + jego bliźniak w dolnej (ten sam rzut);
 *  - STYK (hak onContact — F._cells / F._nCells ważne w haku): reakcja płyty −n·j rozłożona po blokach komórek styku
 *    (udział = liczba komórek bloku / liczba komórek styku), / massUnit → structureAddImpulse (część zakotwiczona);
 *  - OTWÓR (hak onCellLost): licznik otworów bloku; co killEvery120 kroków 1/120 s plateKillBlocks — blok, którego ≥ killFrac
 *    komórek to otwory, ginie razem z bliźniakiem (structureDestroyBlock, zmiażdżony);
 *  - komórki bloków, które nie należą już do części zakotwiczonej (wyspa → klaster gospodarza, blok martwy), znikają z pola
 *    (plateSync po zmianie S.topoVer, plateClearIsland wprost): grubość 0, F.alive, F.version++ — klastry leżące na tych
 *    komórkach budzi utrata podpory silnika (beamRigid3D.supportLost), obraz wysyła teksturę grubości;
 *  - UTRZYMANIE (D8, plateSetHold): S.hold = h (podpory SUPPORT — supportHoldFloor grafu), a pole dostaje F.hold tak, żeby
 *    LINIOWY wzór silnika σ = σ_free + F.hold · (σ_held − σ_free) dał σ z okna smoothstep plateSigma prototypu E1
 *    (holdFree 0,1 / holdHeld 0,5) — bez przeliczenia opór szyi i upadku przy pośrednim utrzymaniu różniłby się od E1.
 * Jednostki (D5): masa silnika = masa grafu × massUnit (45²), więc σ silnika = σ_E1 × massUnit, impuls do grafu = J / massUnit.
 *
 * Czysty moduł obszaru: bez three, DOM, `window` i Math.random. Haki (gorąca ścieżka silnika) bez alokacji — bufory z
 * createPlateBinding, liczby stanu w tablicach typowanych. Świat silnika (x gry, −y gry, z); archetyp dysku stoi w `origin`
 * z obrotem `yaw` wokół z (jak gospodarz zawalenia).
 */

import { structureAddImpulse, structureDestroyBlock, structureSetHold, plateSigma, PLATE_TUNE, STRUCT_MASS_UNIT } from './structureGraph.js';
import { PIRATE_BASE_SPEC } from '../3d/portBuildings/pirateBaseLayout.js';
import { k7HeightToZ } from '../3d/haloRing/haloPortK7Layout.js';

/** Strojenie wiązania (zamrożone; nadpisania — opts.tune). */
export const PLATE_BIND_TUNE = Object.freeze({
  killFrac: 0.6,       // blok ginie, gdy ≥ tyle jego komórek to otwory (jak _plateKillBlocks E1)
  killEvery120: 4,     // przegląd otworów co tyle kroków 1/120 s (E1: co 4 kroki 120 Hz)
  recCap: 2048         // pierścień rekordów utraconych komórek (obraz: gruz i pył otworu)
});

/** Pierścień rekordów utraconych komórek: słowa 0–2 punkt (środek komórki na spodzie), 3–5 prędkość zjedzonej masy,
 *  6 masa (silnik), 7 komórka. */
export const PLATE_REC_STRIDE = 8;

/** Znaczniki komórek (Pb.hole): 0 — materiał, 1 — otwór zgniotu (onCellLost), 2 — reszta bloku zabitego otworami,
 *  3 — blok poza częścią zakotwiczoną (wyspa / zniszczony). */
export const PLATE_HOLE = Object.freeze({ NONE: 0, CRUSH: 1, KILLED: 2, DETACHED: 3 });

// Budżet „na 1/120 s” → na krok dt (60 Hz: ×2 mniej kroków między przeglądami). Przy kroku 1/120 s dokładnie wejście.
function per120(n, dt) {
  if (dt === 1 / 120) return n;
  return Math.max(1, Math.round(n * dt * 120));
}

// ── opisy pól ───────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Opcje engine.addPlateField dla PIERŚCIENIA płyty (rIn…rOut wokół początku układu), siatka jak prototyp E1 (gw =
 * ⌈2·rOut / cell⌉ + 2, narożnik −rOut − cell): grubość komórki = zTop − zBot + tarasy `tiers` [{ r, dz }] (r komórki ≤ t.r),
 * u8 w jednostce maxThickness / 255. opts: origin {x, y, z} (środek pierścienia na ziemi układu; z dodaje się do zBot),
 * yaw [rad], cell (45), rIn, rOut, zBot, zTop, tiers, sigmaHeld / sigmaFree (jednostki E1 — × massUnit), massUnit (45²),
 * massPerCell (silnik; brak — density · grubość średnia / cell · massUnit), density (gęstość grafu), friction, name.
 */
export function annulusPlateOptions(opts = {}) {
  const cell = Number(opts.cell) > 0 ? Number(opts.cell) : 45;
  const massUnit = Number(opts.massUnit) > 0 ? Number(opts.massUnit) : STRUCT_MASS_UNIT;
  const rIn = +opts.rIn || 0, rOut = +opts.rOut, zBot = +opts.zBot, zTop = +opts.zTop;
  const tiers = opts.tiers || [];
  const T = zTop - zBot;
  let maxT = T;
  for (const t of tiers) maxT += t.dz;
  const unit = maxT / 255;
  const n = Math.ceil(2 * rOut / cell) + 2, off = rOut + cell;
  const thick = new Uint8Array(n * n);
  let cells = 0, sumT = 0;
  for (let iv = 0; iv < n; iv++) for (let iu = 0; iu < n; iu++) {
    const x = (iu + 0.5) * cell - off, y = (iv + 0.5) * cell - off, r = Math.sqrt(x * x + y * y);
    if (r < rIn || r > rOut) continue;
    let f = T;
    for (const t of tiers) if (r <= t.r) f += t.dz;
    const v = Math.round(f / unit);
    thick[iu + iv * n] = v < 1 ? 1 : (v > 255 ? 255 : v);
    cells++; sumT += f;
  }
  const yaw = +opts.yaw || 0, c = Math.cos(yaw), s = Math.sin(yaw);
  const O = opts.origin || { x: 0, y: 0, z: 0 };
  const sigmaHeld = Number.isFinite(opts.sigmaHeld) ? opts.sigmaHeld : PLATE_TUNE.sigmaHeld;
  const sigmaFree = Number.isFinite(opts.sigmaFree) ? opts.sigmaFree : PLATE_TUNE.sigmaFree;
  const density = Number(opts.density) > 0 ? Number(opts.density) : 0.6;
  const massPerCell = Number(opts.massPerCell) > 0 ? Number(opts.massPerCell) : density * (cells ? sumT / cells : T) / cell * massUnit;
  return {
    name: opts.name || 'płyta',
    origin: { x: (+O.x || 0) - off * c + off * s, y: (+O.y || 0) - off * s - off * c, z: (+O.z || 0) + zBot },
    u: { x: c, y: s, z: 0 }, v: { x: -s, y: c, z: 0 },
    cell, nu: n, nv: n, thick, maxThickness: maxT, thickness: maxT,
    capacityHeld: sigmaHeld * massUnit, capacityFree: sigmaFree * massUnit, hold: 1,
    massPerCell, friction: Number.isFinite(opts.friction) ? opts.friction : 0.5
  };
}

/**
 * Opcje pola płyty DYSKU MIESZKALNEGO z archetypu buildDiscArchetype (A.disc: rIn, rOut, zBot, zTop; tarasy z
 * PIRATE_BASE_SPEC.habitat jak w archetypie), masa komórki = masa grafu dysku / liczba komórek × massUnit. opts jak
 * annulusPlateOptions (origin, yaw, cell, sigmaHeld, sigmaFree, massUnit, friction, name).
 */
export function discPlateOptions(A, opts = {}) {
  const D = A.disc;
  if (!D) throw new TypeError('discPlateOptions: archetyp bez A.disc (buildDiscArchetype)');
  const Hs = PIRATE_BASE_SPEC.habitat;
  const tiers = opts.tiers || [
    { r: Hs.tier1R, dz: k7HeightToZ(Hs.tier1Y) - D.zTop },
    { r: Hs.tier2R, dz: k7HeightToZ(Hs.tier2Y) - k7HeightToZ(Hs.tier1Y) }
  ];
  const o = annulusPlateOptions({ ...opts, rIn: D.rIn, rOut: D.rOut, zBot: D.zBot, zTop: D.zTop, tiers, name: opts.name || 'dysk' });
  if (!(Number(opts.massPerCell) > 0)) {
    let cells = 0;
    for (let c = 0; c < o.thick.length; c++) if (o.thick[c] > 0) cells++;
    const massUnit = Number(opts.massUnit) > 0 ? Number(opts.massUnit) : STRUCT_MASS_UNIT;
    if (cells) o.massPerCell = A.totalMass * massUnit / cells;
  }
  return o;
}

// ── wiązanie ────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Wiązanie pola płyty silnika `F` (engine.addPlateField) z egzemplarzem grafu dysku `S` (createStructure / gospodarz
 * zawalenia — H.S). opts: massUnit (45²), origin {x, y, z} + yaw — poza archetypu w świecie silnika (jak gospodarz),
 * sigmaHeld / sigmaFree (jednostki E1; brak — z pola: capacity / massUnit), holdFree / holdHeld (okno plateSigma,
 * PLATE_TUNE), tune (PLATE_BIND_TUNE), hooks (false — bez instalacji haków F.onContact / F.onCellLost; wołający woła
 * plateOnContact / plateOnCellLost sam). Alokuje (raz). Zwraca Pb.
 */
export function createPlateBinding(F, S, opts = {}) {
  const A = S.arch, n = A.n, N = F.nu * F.nv;
  const massUnit = Number(opts.massUnit) > 0 ? Number(opts.massUnit) : STRUCT_MASS_UNIT;
  const T = Object.freeze({ ...PLATE_BIND_TUNE, ...(opts.tune || {}) });
  const O = opts.origin || { x: 0, y: 0, z: 0 };
  const yaw = +opts.yaw || 0, cy = Math.cos(yaw), sy = Math.sin(yaw);
  const ox = +O.x || 0, oy = +O.y || 0;
  // warstwy: górna = bloki ponad środkiem wysokości bloków grafu (jak plateBindGraph)
  let z0 = Infinity, z1 = -Infinity;
  for (let b = 0; b < n; b++) { if (A.anchor[b]) continue; if (A.z[b] < z0) z0 = A.z[b]; if (A.z[b] > z1) z1 = A.z[b]; }
  const zMid = 0.5 * (z0 + z1);
  const upper = [];
  for (let b = 0; b < n; b++) if (!A.anchor[b] && A.z[b] >= zMid) upper.push(b);
  // bliźniak dolnej warstwy: ten sam rzut (± 1 j.) i poziom
  const twin = new Int32Array(n).fill(-1);
  for (const b of upper) {
    let best = -1, bd = Infinity;
    for (let j = 0; j < n; j++) {
      if (j === b || A.anchor[j] || A.z[j] >= zMid || A.level[j] !== A.level[b]) continue;
      const dx = A.x[j] - A.x[b], dy = A.y[j] - A.y[b], d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = j; }
    }
    if (best >= 0 && bd < 1) twin[b] = best;
  }
  const cellUp = new Int32Array(N).fill(-1), cellLo = new Int32Array(N).fill(-1), blockCells = new Int32Array(n);
  for (let c = 0; c < N; c++) {
    if (!(F.thick0[c] > 0)) continue;
    const iu = c % F.nu, iv = (c - iu) / F.nu;
    const a = (iu + 0.5) * F.cell, bb = (iv + 0.5) * F.cell;
    const wx = F.ox + F.ux * a + F.vx * bb - ox, wy = F.oy + F.uy * a + F.vy * bb - oy;
    const lx = cy * wx + sy * wy, ly = -sy * wx + cy * wy;
    let best = -1, bd = Infinity;
    for (const b of upper) {
      const dx = A.x[b] - lx, dy = A.y[b] - ly, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = b; }
    }
    cellUp[c] = best;
    cellLo[c] = best >= 0 ? twin[best] : -1;
    if (best >= 0) blockCells[best]++;
  }
  // normalna pola w układzie archetypu (reakcja płyty na blok: −n·j)
  const nx = cy * F.nx + sy * F.ny, ny = -sy * F.nx + cy * F.ny, nz = F.nz;
  const Pb = {
    F, S, A, T, massUnit, n, N,
    cellUp, cellLo, twin, blockCells,
    blockHoles: new Int32Array(n), killed: new Uint8Array(n), hole: new Uint8Array(N),
    stamp: new Int32Array(n), bList: new Int32Array(n), bCnt: new Int32Array(n),
    nL: Float64Array.of(nx, ny, nz),
    // okno smoothstep prototypu E1 (plateSigma czyta te pola) — σ w jednostkach E1
    sig: {
      hold: 1,
      holdFree: Number.isFinite(opts.holdFree) ? opts.holdFree : PLATE_TUNE.holdFree,
      holdHeld: Number.isFinite(opts.holdHeld) ? opts.holdHeld : PLATE_TUNE.holdHeld,
      sigmaFree: Number.isFinite(opts.sigmaFree) ? opts.sigmaFree : F.capacityFree / massUnit,
      sigmaHeld: Number.isFinite(opts.sigmaHeld) ? opts.sigmaHeld : F.capacityHeld / massUnit
    },
    // iv: 0 topoVer uzgodniony, 1 pokolenie stempla, 2 otwory zgniotu, 3 komórki zdjęte (wyspy / bloki martwe), 4 bloki
    //     zabite otworami, 5 wywołania styku, 6 nowe otwory od ostatniego przeglądu, 7 kroki, 8 pierwszy krok ze stykiem (−1),
    //     9 pierwszy krok z otworem (−1), 10 rekordy klastrów gospodarza już przejrzane (plateStep z H)
    iv: new Int32Array(12),
    // fv: 0 Σ |impuls| do grafu (jednostka grafu), 1 Σ j styku (silnik), 2 utrzymanie
    fv: new Float64Array(4),
    rec: { buf: new Float64Array(T.recCap * PLATE_REC_STRIDE), cap: T.recCap, stride: PLATE_REC_STRIDE, head: 0 }
  };
  Pb.iv[0] = S.topoVer; Pb.iv[8] = -1; Pb.iv[9] = -1;
  if (opts.hooks !== false) {
    F.onContact = function plateBindContact(f, body, info) { plateOnContact(Pb, f, body, info); };
    F.onCellLost = function plateBindCellLost(f, c, x, y, z, vx, vy, vz, m) { plateOnCellLost(Pb, f, c, x, y, z, vx, vy, vz, m); };
  }
  plateSetHold(Pb, S.hold);
  return Pb;
}

// blok w części zakotwiczonej grafu (stoi z płytą)
function _stump(S, b) {
  return b >= 0 && S.dead[b] === 0 && S.island[b] === -1;
}

/**
 * Styk ciała z polem (hak F.onContact w pierwszej iteracji kolizji; F._cells / F._nCells — komórki tego styku). Reakcja
 * płyty −n·j (j — impuls podpory na ciało: sprężysty albo opór zgniotu) rozdzielona po blokach części zakotwiczonej
 * w komórkach styku (górna warstwa, gdy jej nie ma — bliźniak), / massUnit → structureAddImpulse. Bez alokacji.
 */
export function plateOnContact(Pb, F, body, info) {
  const nc = F._nCells, j = info.impulse;
  if (!(j > 0) || nc <= 0) return;
  const S = Pb.S, cellUp = Pb.cellUp, cellLo = Pb.cellLo, stamp = Pb.stamp, list = Pb.bList, cnt = Pb.bCnt, cells = F._cells;
  const iv = Pb.iv;
  iv[5]++;
  if (iv[8] < 0) iv[8] = iv[7];
  let gen = iv[1] + 1;
  if (gen > 0x3fffffff) { stamp.fill(0); gen = 1; }
  iv[1] = gen;
  let nb = 0, used = 0;
  for (let q = 0; q < nc; q++) {
    const c = cells[q];
    let b = cellUp[c];
    if (!_stump(S, b)) { b = cellLo[c]; if (!_stump(S, b)) continue; }
    if (stamp[b] !== gen) { stamp[b] = gen; cnt[b] = 0; list[nb++] = b; }
    cnt[b]++; used++;
  }
  if (!nb) return;
  const k = -j / (nc * Pb.massUnit), nL = Pb.nL;
  for (let t = 0; t < nb; t++) {
    const b = list[t], w = k * cnt[b];
    structureAddImpulse(S, b, nL[0] * w, nL[1] * w, nL[2] * w);
  }
  Pb.fv[0] += j * used / (nc * Pb.massUnit);
  Pb.fv[1] += j;
}

/**
 * Komórka c zgnieciona do zera (hak F.onCellLost): otwór bloku górnej warstwy (przegląd plateKillBlocks) i rekord obrazu
 * (punkt, prędkość zjedzonej masy, masa). Bez alokacji.
 */
export function plateOnCellLost(Pb, F, c, x, y, z, vx, vy, vz, m) {
  if (Pb.hole[c]) return;
  Pb.hole[c] = PLATE_HOLE.CRUSH;
  const iv = Pb.iv;
  iv[2]++; iv[6] = 1;
  if (iv[9] < 0) iv[9] = iv[7];
  const b = Pb.cellUp[c];
  if (b >= 0) Pb.blockHoles[b]++;
  const R = Pb.rec, o = (R.head % R.cap) * R.stride, buf = R.buf;
  buf[o] = x; buf[o + 1] = y; buf[o + 2] = z; buf[o + 3] = vx; buf[o + 4] = vy; buf[o + 5] = vz; buf[o + 6] = m; buf[o + 7] = c;
  R.head++;
}

/**
 * Przegląd otworów: blok górnej warstwy, którego ≥ killFrac komórek to otwory zgniotu, ginie (zmiażdżony) razem z
 * bliźniakiem dolnej warstwy — otwór na wylot w grafie (E1 _plateKillBlocks). Zwraca liczbę zabitych bloków.
 */
export function plateKillBlocks(Pb) {
  const S = Pb.S, n = Pb.n, tot = Pb.blockCells, holes = Pb.blockHoles, killed = Pb.killed, frac = Pb.T.killFrac;
  let k = 0;
  for (let b = 0; b < n; b++) {
    const t = tot[b];
    if (!t || killed[b] || S.dead[b]) continue;
    if (holes[b] < frac * t) continue;
    killed[b] = 1;
    structureDestroyBlock(S, b, true);
    const tw = Pb.twin[b];
    if (tw >= 0) structureDestroyBlock(S, tw, true);
    k++;
  }
  Pb.iv[4] += k;
  Pb.iv[6] = 0;
  return k;
}

// komórka c znika z pola (znacznik powodu); bez sprawdzeń
function _clearCell(Pb, c, why) {
  const F = Pb.F;
  F.thick[c] = 0;
  F.alive--;
  if (!Pb.hole[c]) Pb.hole[c] = why;
  Pb.iv[3]++;
}

/**
 * Komórki wyspy `islandId` grafu znikają z pola (wyspa jest klastrem gospodarza): blok górny albo dolny komórki w wyspie,
 * a żaden w części zakotwiczonej. F.version++ (utrata podpory silnika, obraz). Zwraca liczbę komórek.
 */
export function plateClearIsland(Pb, islandId) {
  const F = Pb.F, S = Pb.S, th = F.thick, up = Pb.cellUp, lo = Pb.cellLo, N = Pb.N;
  let c0 = 0;
  for (let c = 0; c < N; c++) {
    if (!th[c]) continue;
    const b = up[c], l = lo[c];
    if (_stump(S, b) || _stump(S, l)) continue;
    const inI = (b >= 0 && !S.dead[b] && S.island[b] === islandId) || (l >= 0 && !S.dead[l] && S.island[l] === islandId);
    if (!inI) continue;
    _clearCell(Pb, c, PLATE_HOLE.DETACHED);
    c0++;
  }
  if (c0) F.version++;
  return c0;
}

/**
 * Komórki pod punktami styku NOWEGO klastra wyspy (ciało `rigid` silnika w pozie narodzin, w warstwie płyty) znikają z
 * pola: materiał przeszedł do klastra. Komórka należy do bloku najbliższego w rzucie, a punkt styku do prostopadłościanu
 * bloku — na granicy wycinków (≤ 1 komórka) punkty wyspy leżą nad komórkami sąsiada i spadająca wyspa zgniatała je
 * (otwory, których nie zrobiło żadne uderzenie). Gospodarz woła to dla każdego nowego klastra wyspy tego grafu. Zwraca
 * liczbę zdjętych komórek. Bez alokacji.
 */
export function plateClearUnder(Pb, body) {
  const F = Pb.F, g = body && body.rg;
  if (!g || body.dead) return 0;
  const q = body.quat, x = q.x, y = q.y, z = q.z, w = q.w;
  const m0 = 1 - 2 * (y * y + z * z), m1 = 2 * (x * y - w * z), m2 = 2 * (x * z + w * y);
  const m3 = 2 * (x * y + w * z), m4 = 1 - 2 * (x * x + z * z), m5 = 2 * (y * z - w * x);
  const m6 = 2 * (x * z - w * y), m7 = 2 * (y * z + w * x), m8 = 1 - 2 * (x * x + y * y);
  const th = F.thick, cell = F.cell, Tmax = 255 * F.unit;
  let c0 = 0;
  for (let i = 0; i < g.n; i++) {
    const lx = g.lx[i], ly = g.ly[i], lz = g.lz[i], r = g.r[i];
    const px = body.pos.x + m0 * lx + m1 * ly + m2 * lz - F.ox;
    const py = body.pos.y + m3 * lx + m4 * ly + m5 * lz - F.oy;
    const pz = body.pos.z + m6 * lx + m7 * ly + m8 * lz - F.oz;
    const h = px * F.nx + py * F.ny + pz * F.nz;
    if (h - r > Tmax || h + r < 0) continue;
    const a = px * F.ux + py * F.uy + pz * F.uz, b = px * F.vx + py * F.vy + pz * F.vz;
    if (a < 0 || b < 0) continue;
    const iu = Math.floor(a / cell), iv = Math.floor(b / cell);
    if (iu >= F.nu || iv >= F.nv) continue;
    const c = iu + iv * F.nu;
    if (!th[c]) continue;
    _clearCell(Pb, c, PLATE_HOLE.DETACHED);
    c0++;
  }
  if (c0) F.version++;
  return c0;
}

/**
 * Uzgodnienie pola z grafem (po zmianie S.topoVer): komórka zostaje, póki jej blok górny albo dolny należy do części
 * zakotwiczonej; inaczej znika (reszta bloku zabitego otworami — KILLED, wyspa / blok zniszczony — DETACHED). Zwraca
 * liczbę zdjętych komórek. Bez alokacji.
 */
export function plateSync(Pb) {
  const F = Pb.F, S = Pb.S, th = F.thick, up = Pb.cellUp, lo = Pb.cellLo, N = Pb.N, killed = Pb.killed;
  let c0 = 0;
  for (let c = 0; c < N; c++) {
    if (!th[c]) continue;
    const b = up[c];
    if (_stump(S, b) || _stump(S, lo[c])) continue;
    _clearCell(Pb, c, b >= 0 && killed[b] ? PLATE_HOLE.KILLED : PLATE_HOLE.DETACHED);
    c0++;
  }
  if (c0) F.version++;
  Pb.iv[0] = S.topoVer;
  return c0;
}

/**
 * Krok wiązania PO kroku gospodarza (collapseStep — uzgodnienie wysp i narodziny klastrów): przegląd otworów co
 * killEvery120 kroków 1/120 s (tick — całkowity licznik kroków), uzgodnienie pola po zmianie topologii grafu, komórki pod
 * nowymi klastrami wysp gospodarza `H` (structureCollapse — rekordy H.cls od ostatniego kroku; null — bez gospodarza).
 * Kolejność kroku sceny: plateSetHold → collapsePreStep → HullBodies.step (haki pola) → collapseStep → plateStep.
 */
export function plateStep(Pb, dt, tick, H = null) {
  const iv = Pb.iv;
  iv[7]++;
  if (iv[6] && (tick % per120(Pb.T.killEvery120, dt)) === 0) plateKillBlocks(Pb);
  if (Pb.S.topoVer !== iv[0]) plateSync(Pb);
  if (H !== null) {
    const cls = H.cls;
    let k = iv[10];
    if (k > cls.length) k = 0;   // gospodarz od nowa (collapseReset)
    for (; k < cls.length; k++) {
      const r = cls[k];
      if (r.alive && r.kind === 0) plateClearUnder(Pb, r.body);
    }
    iv[10] = cls.length;
  }
}

/**
 * Utrzymanie habitatu h ∈ [0, 1] (zegar D8): graf (structureSetHold — podpory SUPPORT) i pole — F.hold przeliczone tak,
 * żeby liniowa nośność silnika równała się σ z okna smoothstep prototypu E1 (plateSigma × massUnit przy capacity
 * pola = σ_E1 × massUnit). Zwraca F.hold.
 */
export function plateSetHold(Pb, h) {
  const hh = h > 1 ? 1 : (h > 0 ? h : 0);
  structureSetHold(Pb.S, hh);
  const sg = Pb.sig;
  sg.hold = hh;
  const s = plateSigma(sg), den = sg.sigmaHeld - sg.sigmaFree;
  let fh = den > 0 ? (s - sg.sigmaFree) / den : 1;
  fh = fh > 1 ? 1 : (fh > 0 ? fh : 0);
  Pb.F.hold = fh;
  Pb.fv[2] = hh;
  return fh;
}

// ── odczyty ─────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Statystyki wiązania (nowy obiekt): komórki pola na starcie, żywe, otwory zgniotu (holes), reszty bloków zabitych
 * (killedCells), komórki zdjęte z wyspami / blokami martwymi (detached), rów (komórki cieńsze niż na starcie, > 0),
 * bloki zabite otworami, utracone bloki grafu (martwe albo w wyspach) i ich ułamek, wywołania styku, impuls do grafu,
 * pierwszy krok styku i otworu (licznik kroków wiązania, −1 — nie było).
 */
export function plateStats(Pb) {
  const F = Pb.F, N = Pb.N, A = Pb.A, S = Pb.S;
  let cells = 0, alive = 0, holes = 0, killedCells = 0, detached = 0, trench = 0;
  for (let c = 0; c < N; c++) {
    if (!(F.thick0[c] > 0)) continue;
    cells++;
    const t = F.thick[c], h = Pb.hole[c];
    if (t > 0) { alive++; if (t < F.thick0[c]) trench++; }
    if (h === PLATE_HOLE.CRUSH) holes++; else if (h === PLATE_HOLE.KILLED) killedCells++; else if (h === PLATE_HOLE.DETACHED) detached++;
  }
  let blocks = 0, lost = 0;
  for (let b = 0; b < A.n; b++) { if (A.anchor[b]) continue; blocks++; if (S.dead[b] || S.island[b] >= 0) lost++; }
  return {
    cells, alive, holes, killedCells, detached, trench, killedBlocks: Pb.iv[4], blocks, lostBlocks: lost, lostFrac: blocks ? lost / blocks : 0,
    contacts: Pb.iv[5], impulse: Pb.fv[0], impulseEngine: Pb.fv[1], hold: Pb.fv[2], fieldHold: F.hold,
    firstContactStep: Pb.iv[8], firstHoleStep: Pb.iv[9]
  };
}

/**
 * IoU OTWORU z kołem promienia r wokół (x, y) świata silnika, przyciętym do płyty (komórki z grubością na starcie — dla
 * dysku: pierścień rIn…r). Otwór = komórki zgniecione do zera i reszty bloków zabitych otworami (mode 'przebicie' —
 * domyślnie; bez komórek zdjętych z wyspami) albo każda komórka z grubością 0 (mode 'wszystko').
 */
export function plateHoleIoU(Pb, x, y, r, mode = 'przebicie') {
  const F = Pb.F, N = Pb.N, all = mode === 'wszystko', r2 = r * r;
  let inter = 0, uni = 0;
  for (let c = 0; c < N; c++) {
    if (!(F.thick0[c] > 0)) continue;
    const iu = c % F.nu, iv = (c - iu) / F.nu;
    const a = (iu + 0.5) * F.cell, b = (iv + 0.5) * F.cell;
    const dx = F.ox + F.ux * a + F.vx * b - x, dy = F.oy + F.uy * a + F.vy * b - y;
    const inS = dx * dx + dy * dy <= r2;
    const h = Pb.hole[c];
    const hole = all ? F.thick[c] === 0 : (h === PLATE_HOLE.CRUSH || h === PLATE_HOLE.KILLED);
    if (inS && hole) inter++;
    if (inS || hole) uni++;
  }
  return uni ? inter / uni : 0;
}

/** Rekordy utraconych komórek (pierścień { buf, cap, stride, head } — czytelnik trzyma własny kursor). */
export function plateRecords(Pb) { return Pb.rec; }
