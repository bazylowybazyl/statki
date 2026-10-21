// src/game/hullDesign/hullDesignSchema.js
//
// KREATOR KADŁUBÓW — format projektu (czysty: bez three i DOM; demo dema/kreator-kadluba-webgpu.html, testy
// tests/hullDesign.test.mjs). Projekt to mały JSON, z którego kreator liczy ten sam pakiet co sprite okrętu:
// alfa (→ belki silnika, src/game/beamSprite2D.js), albedo, mapa powierzchni (format HullSurface), emisja,
// mocowania (gniazda wież, dysze MAIN, lampy pozycyjne). Gra jeszcze go nie przyjmuje — lista zmian:
// docs/KREATOR-KADLUBA.md.
//
// Układ projektu = układ sprite'a gry: jednostki świata (1 j. = 1 px kanwy fizyki przy spriteScale 1), x ku
// DZIOBOWI, y w dół obrazu (wiersz 0 obrazu = najmniejsze y), oś okrętu y = 0. Lustro: y → −y.
//
// POZIOMY (v2, 2026-10-14 — wzór: okręty Terra Novy): 0 RAMA — maszynownia (ciemna: rury wzdłuż krawędzi
// pancerza, żebra, skrzynki) widoczna tam, gdzie nie leży pancerz; 1 PANCERZ — płyty (biała blacha, fazy, linie
// paneli, nity); 2 NADBUDÓWKA; 3 MOSTEK. Wyższy poziom leży na niższym (blok poziomu L wypełnia też niższe).
// Projekt v1 (3 poziomy: kadłub / nadbudówka / mostek) przechodzi na v2 przesunięciem poziomów o 1 (kadłub =
// pancerz) — bez maszynowni, wygląd jak dawniej.
//
//   blocks  [[bx, by, poziom], …] — bloki siatki: blok = 4 × 4 komórki belek (komórka 15 j. = HULL_BODY_CONFIG.cellPx),
//           blok (bx, by) zajmuje x ∈ [bx·60, bx·60 + 60], y ∈ [by·60, by·60 + 60]. Oś lustra leży na krawędzi
//           bloków (by → −1 − by).
//   shapes  bryły w kolejności: { kind: 'circle', op: 'add' | 'cut', x, y, r, level }, { kind: 'rect', op, x, y,
//           w, h (pół-wymiary), r (zaokrąglenie), ch (faza rogów), rot, level }, { kind: 'poly', op, pts: [[x, y], …],
//           holes?: [[[x, y], …], …], sym, ch, r, level } — wielokąt (z otworami: wypełnienie parzysto-nieparzyste);
//           sym: true = symetryczny względem osi (pts — połowa od osi do osi, pierwszy i ostatni punkt na y = 0;
//           lustro go nie powiela). `clip: C` (każda bryła dodająca) — przycięta do poziomu C (część wspólna):
//           zgrubny obrys wystarczy, krawędzie zewnętrzne biorą się z płyt poziomu C (podniesienie wybranych płyt
//           o piętro). Dodanie na poziomie L wypełnia poziomy ≤ L,
//           wycięcie na poziomie L usuwa poziomy ≥ L (np. pierścień nadbudówki: koło + mniejsze wycięcie).
//           KLOCKI — { kind: 'block', shape: 'rect' | 'trap' | 'tri' | 'arc', x, y, w, h (pełne wymiary), rot (co 45°), flip,
//           level, op, gap, … } (src/game/hullDesign/hullDesignBlocks.js): paleta prostych kształtów na siatce `grid`;
//           rozwinięcie zamienia wszystkie klocki projektu na wielokąty ramy (suma pełnych obrysów), płyt (z rowem
//           maszynowni `gap` [jd] od sąsiednich płyt) i wycięć — w miejscu PIERWSZEGO klocka na liście brył.
//   modules gniazda i urządzenia: { type, x, y, rot?, … } — typy w HD_MODULES (gondola silnika i mostek dokładają
//           własną bryłę).
//   parts   GOTOWE CZĘŚCI (src/game/hullDesign/hullDesignParts.js — wieża mostka, dziób, blok silników, sponson,
//           hangary, blok wieży, grzbiet, port): { id, x, y, s (skala), rot, dl (przesunięcie poziomów) } — rozwijane
//           na bryły, moduły i naklejki.
//   grooves ROWKI — linie podziału płyt pancerza (łamane): { pts: [[x, y], …], w (szerokość [jd], domyślnie 1,4) }.
//           Płyta między rowkami ma własną fazę („poduszkę”) — tak sprite'y TN dzielą pancerz na bloki.
//   pipes   RURY ręczne — wiązki wzdłuż łamanej: { pts: [[x, y], …], n (rur w wiązce 1–8, domyślnie 3), mat ('mix' |
//           'steel' | 'copper'), r (skala średnicy, domyślnie 1), over (false — tylko w rowach maszynowni; domyślnie
//           leżą też na płytach) }.
//   pipeNet SIEĆ SYSTEMÓW generowana (src/game/hullDesign/hullDesignSystems.js — kto z kim, hullDesignPipes.js —
//           trasy): { density (0 — brak, domyślnie; 1 — jak sprite'y TN; do 2 — grubsze wiązki), seed }. Rury paliwa
//           zbiornik → reaktor → każda gondola MAIN i dysza SIDE, kable zasilania reaktor → każde urządzenie; trasy
//           rowami maszynowni, wiązki z liczby tras, bez wolnych końców.
//   castles KASZTELE — schodkowe nadbudówki TN (src/game/hullDesign/hullDesignCastles.js): bloki-trapezy z fazą od
//           burty, drugim węższym piętrem, kratką-radiatorem, iluminatorem i klapami: { x, y, w, h, rot, tiers, taper,
//           taperIn, level, clip, vent, port, hatches } — rozwijane na wielokąty pięter i moduły.
//   panels  widoczność losowego podziału płyt na panele (0 — brak, 1 — pełny; projekty z rowkami ~0,35).
//   decals  naklejki: pasy ('stripe' — odcinek, 'contour' — pas wzdłuż konturu poziomu), emblematy wektorowe
//           ('emblem', src/game/hullDesign/hullEmblems.js), napisy ('text'); położenie, obrót, skala, kolor, lustro.
//   mirror  lustro wzdłuż osi (wszystko bez pola mirror: false ma kopię po drugiej burcie).
//   style   'chamfer' (fazy 45°, domyślny) | 'rounded' (łuki) | 'sharp'.
//   bevel   skala fazy krawędzi płyt (1 — 2 jd nad stromą ścianą; Terra Nova ~1,9), round — profil fazy: 0 prosty,
//           1 zaokrąglony (wypukły, „poduszka” jak w sprite'ach TN); domyślnie z stylu (zaokrąglony → 1).
//   detail  skala detalu [j. na jednostkę detalu „jd”]: płyty, szwy, nity, rury, kratki i wysokości tarasów są w jd,
//           więc mała fregata ma tyle samo detalu na swoją długość co lotniskowiec (jak sprite'y: ~1700 px na okręt
//           → detail ≈ długość / 1700). Pancerz stoi 7 jd nad ramą, nadbudówka 12, mostek 15.
//   grid    krok siatki klocków [j.]: ustalany RAZ przy tworzeniu projektu (brak pola — z detalu: hullDesignGridStep,
//           ~4 jd, potęga dwójki), potem stały — zmiana detalu nie rusza klocków ani rozmiaru okrętu.
//   bridgeLevel / coreLevel  KLASA okrętu (etap 2, src/data/shipClasses.js): poziom mostka I–VI (twarde limity:
//           powierzchnia, gniazda, rozmiar broni) i rdzenia R1–R6 (moc); 0 — z powierzchni i gniazd (stare projekty).
//   powerPriority  kolejność kategorii urządzeń w kolejce mocy (POWER_CATEGORIES; brak — POWER_PRIORITY_DEFAULT).
//
// GNIAZDA BRONI (etap 2): moduł `mount` { slot: main | aux | missile | special | builtin, size: S | M | L | Capital,
// weapon?: id z MASTER_WEAPONS | '' (puste) — brak pola = typowa broń gniazda }; wieże turret_s / m / l to gniazda
// główne S / M / L (te same pola), wrota hangaru (`hangar`) — gniazda hangarowe. hullDesignMountOf(m) daje typ i rozmiar.

import { HD_PARTS, expandHullPart } from './hullDesignParts.js';
import { MASTER_WEAPONS } from '../../data/weapons.js';
import { MOUNT_SIZES, POWER_CATEGORIES, SHIP_CLASS_MAX } from '../../data/shipClasses.js';
import { expandHullBlocks, hullDesignGridStep, normalizeBlock } from './hullDesignBlocks.js';
import { expandCastle, normalizeCastle } from './hullDesignCastles.js';

export const HD_VERSION = 2;
/** Bok komórki siatki belek [j.] — HULL_BODY_CONFIG.cellPx przy spriteScale 1. */
export const HD_CELL = 15;
/** Komórek belek na bok bloku. */
export const HD_BLOCK_CELLS = 4;
/** Bok bloku [j.]. */
export const HD_BLOCK = HD_CELL * HD_BLOCK_CELLS;
export const HD_LEVELS = 4;
export const HD_LEVEL_NAMES = Object.freeze(['rama', 'pancerz', 'nadbudówka', 'mostek']);
export const HD_STYLES = Object.freeze(['chamfer', 'rounded', 'sharp']);
export const HD_STYLE_NAMES = Object.freeze({ chamfer: 'fazowany', rounded: 'zaokrąglony', sharp: 'ostry' });
/** Skala detalu: domyślna i zakres [j./jd]. */
export const HD_DETAIL = Object.freeze({ def: 0.6, min: 0.04, max: 2 });
/** Punktów wielokąta najwyżej. */
export const HD_POLY_MAX = 1024;

/**
 * Strojenie kształtu (j. świata). Fazy: róg bloku ścięty o `chamfer` (schodki pojedynczych bloków → prosta 45°),
 * łuki: promień `radius` ograniczony długością sąsiednich krawędzi, styk brył (koło ↔ bloki): `blend`.
 * `insetDu` — poziom L leży co najmniej tyle jd wewnątrz poziomu L − 1 (tarasy; pancerz sięga sylwetki).
 * Pasmo dokładnej odległości od krawędzi: `bandDu` jd, w granicach [bandMin, bandMax] j.
 */
export const HD_SHAPE_TUNE = Object.freeze({
  chamfer: 30,         // = pół bloku: tak tnie marching squares na środkach bloków
  radius: 110,         // promień łuku stylu zaokrąglonego
  shortMerge: 50,      // [j.] krótka faza między dwiema dłuższymi krawędziami → jeden róg (przed łukiem)
  blendRounded: 34,    // łuk na styku brył (gładka suma) — styl zaokrąglony
  blendChamfer: 22,    // faza na styku brył — styl fazowany
  insetDu: [0, 0, 5, 4],
  bandDu: 56,          // pasmo dokładnej odległości [jd]
  bandMin: 6,          // [j.]
  bandMax: 48,         // [j.]
  fieldTexPerDu: 0.7,  // teksele pola na jd (pole ~1100–1200 tekseli na długość okrętu przy detail = długość / 1700)
  fieldResMin: 0.25,   // [teksele / j.]
  fieldResMax: 9,
  domeSigma: 0.09,     // kopuła (jak HullSurface sprite'ów): rozmycie sylwetki — ułamek krótszego boku
  pad: 14              // margines obrazu wokół kadłuba [j.]
});

/**
 * Moduły: r — promień (gniazda okrągłe), w / h — pół-wymiary (prostokątne), level — poziom bryły modułu
 * (gondola, mostek), parts — komponenty receptury (src/data/resources.js), v — wariant wyglądu (wieże: 0 ośmiokątna
 * obudowa Terra Novy, 1 okrągła z rowkiem), n — liczba dysz gondoli (mocowania MAIN), doors — skrzydła wrót.
 */
export const HD_MODULES = Object.freeze({
  turret_s: Object.freeze({ code: 1, label: 'Wieża S', r: 11, size: 'S', parts: { weapon_mount: 1 } }),
  turret_m: Object.freeze({ code: 2, label: 'Wieża M', r: 17, size: 'M', parts: { weapon_mount: 1, avionics: 0.5 } }),
  turret_l: Object.freeze({ code: 3, label: 'Wieża L', r: 26, size: 'L', parts: { weapon_mount: 2, avionics: 1 } }),
  engine: Object.freeze({ code: 4, label: 'Gondola MAIN', w: 48, h: 22, level: 0, parts: { thruster: 2 } }),
  hatch: Object.freeze({ code: 5, label: 'Luk', w: 26, h: 15, parts: { hull_plate: 1 } }),
  // reaktor: v 0 — pancerna pokrywa z wentylami (rysunek kompozytora), 1 — wewnątrz kadłuba (bez pokrywy), 2 — GNIAZDO
  // OBUDOWY Terra Novy (domyślny, `v` wpisu): ośmiokąt o apotemie r = obrys kołnierza obudowy 3D, w której gra rysuje
  // reaktor (src/3d/reactor3D.js; marker gry: hr = r w px PNG — src/data/reactorCores.js); sieć jak przy v 1
  reactor: Object.freeze({ code: 6, label: 'Reaktor', r: 24, v: 2, parts: { reactor_core: 1 } }),
  bridge: Object.freeze({ code: 7, label: 'Mostek', w: 26, h: 19, level: 3, parts: { avionics: 2, life_support: 1 } }),
  vent: Object.freeze({ code: 8, label: 'Kratka', w: 14, h: 6, parts: {} }),
  hangar: Object.freeze({ code: 9, label: 'Wrota hangaru', w: 38, h: 32, parts: { hull_plate: 1 } }),
  well: Object.freeze({ code: 10, label: 'Pierścień', r: 20, parts: { hull_plate: 0.5 } }),
  // SYSTEMY (sieć systemów: src/game/hullDesign/hullDesignSystems.js): zbiornik paliwa (v 0 — walec poziomy we wnęce
  // maszynowni, wzdłuż osi modułu; 1 — kula), dysza boczna SIDE (gniazdo w poszyciu przy burcie: wydech wzdłuż +x
  // modułu, dzwon rysuje gra w 3D), ładownia (v 0 — wrota rozsuwane wzdłuż osi modułu, 1 — klapa)
  fuel_tank: Object.freeze({ code: 11, label: 'Zbiornik paliwa', w: 26, h: 11, parts: { hull_plate: 1 } }),
  thruster_side: Object.freeze({ code: 12, label: 'Dysza SIDE', w: 9, h: 7, parts: { thruster: 1 } }),
  cargo: Object.freeze({ code: 13, label: 'Ładownia', w: 44, h: 22, parts: { hull_plate: 1 } }),
  // GNIAZDO BRONI (etap 2): podstawa w stylu TN pod wieżę gry (wieżę rysuje gra) — kompozytor rysuje ją jak kapsułę
  // wieży (główne, specjalne, wbudowane), okrągłą płytę (pomocnicze) albo pokrywę wyrzutni (rakietowe)
  mount: Object.freeze({ code: 14, label: 'Gniazdo broni', r: 14, parts: { weapon_mount: 1 } })
});
export const HD_MODULE_TYPES = Object.freeze(Object.keys(HD_MODULES));

/** Typy gniazd modułu `mount` (gniazda hangarowe to wrota `hangar`). */
export const HD_MOUNT_SLOTS = Object.freeze(['main', 'aux', 'missile', 'special', 'builtin']);
/** Moduły-gniazda: typ gniazda i rozmiar domyślny (wieże S / M / L — gniazda główne). */
export const HD_MOUNT_MODULES = Object.freeze({
  turret_s: Object.freeze({ slot: 'main', size: 'S' }), turret_m: Object.freeze({ slot: 'main', size: 'M' }),
  turret_l: Object.freeze({ slot: 'main', size: 'L' }), mount: Object.freeze({ slot: 'main', size: 'M' }),
  hangar: Object.freeze({ slot: 'hangar', size: 'S' })
});
/** Promień podstawy gniazda `mount` [jd] na typ (× detal projektu) — tak stawia je plik slotów i edytor. */
export const HD_MOUNT_RADIUS_DU = Object.freeze({ main: 22, special: 26, builtin: 30, aux: 13, missile: 15 });

/** Gniazdo modułu: { slot, size, weapon (undefined — typowa broń, '' — puste) } albo null (moduł nie jest gniazdem). */
export function hullDesignMountOf(m) {
  const def = HD_MOUNT_MODULES[m?.type];
  if (!def) return null;
  const slot = m.type === 'mount' && HD_MOUNT_SLOTS.includes(m.slot) ? m.slot : def.slot;
  const size = MOUNT_SIZES.includes(m.size) ? m.size : def.size;
  return { slot, size, weapon: m.weapon };
}

/**
 * Barwy frakcji (sRGB): pancerz, nadbudówka, linie paneli, akcent (pasy), maszynownia, ostrzegawcze, okna, rury
 * (miedź), silniki, wrota, brud, stal (jasne rury sieci). Terra Nova — z median sprite'ów (płyty #c8c5be…#dcd9d1, maszynownia #2c2a26, rury
 * miedziane #75604a, wrota #4f5155).
 */
export const HD_PALETTES = Object.freeze({
  terra: Object.freeze({
    label: 'Terra Nova', hull: '#d0ccc4', upper: '#d8d5ce', trim: '#4f4c46', accent: '#2f2e2b', metal: '#302d28',
    hazard: '#c99a2e', window: '#bfefff', pipe: '#6f5642', engine: '#5c5a56', door: '#62666a', grime: '#6a5d4c', steel: '#a29d93'
  }),
  atlas: Object.freeze({
    label: 'Atlas', hull: '#5b636b', upper: '#6f7780', trim: '#2c3238', accent: '#d06a22', metal: '#2b3035',
    hazard: '#e2a226', window: '#c8f2ff', pipe: '#6b5038', engine: '#3e4246', door: '#2e3439', grime: '#3a3630', steel: '#7e848a'
  }),
  pirate: Object.freeze({
    label: 'Piraci', hull: '#5d4136', upper: '#6f5446', trim: '#262220', accent: '#b8342a', metal: '#28241f',
    hazard: '#d3a02e', window: '#ffc890', pipe: '#7a4a2c', engine: '#3a3430', door: '#2e2a26', grime: '#3a2a20', steel: '#7b6c60'
  }),
  civil: Object.freeze({
    label: 'Cywilny', hull: '#a99d82', upper: '#cfc8b8', trim: '#45525a', accent: '#d8b83a', metal: '#343a3e',
    hazard: '#d8b83a', window: '#d8f4ff', pipe: '#7a6040', engine: '#4a4d50', door: '#3e464c', grime: '#5a5040', steel: '#8e8d87'
  })
});
export const HD_PALETTE_KEYS = Object.freeze(Object.keys(HD_PALETTES));
/** Kolejność barw palety w kompozytorze (wiersze tablicy uniformów). */
export const HD_PALETTE_ROWS = Object.freeze(['hull', 'upper', 'trim', 'accent', 'metal', 'hazard', 'window', 'pipe', 'engine', 'door', 'grime', 'steel']);

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(num(v, lo))));
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const color = (v, d) => (typeof v === 'string' && COLOR_RE.test(v) ? v.toLowerCase() : d);

function normPts(pts) {
  if (!Array.isArray(pts)) return [];
  const out = [];
  for (const p of pts) {
    if (out.length >= HD_POLY_MAX) break;
    if (!Array.isArray(p) || p.length < 2) continue;
    const x = num(p[0], NaN), y = num(p[1], NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - x) < 1e-6 && Math.abs(last[1] - y) < 1e-6) continue;
    out.push([x, y]);
  }
  return out;
}

function normShape(s, levelShift = 0) {
  if (s?.kind === 'block') return normalizeBlock(s, HD_LEVELS, levelShift);
  if (!s || (s.kind !== 'circle' && s.kind !== 'rect' && s.kind !== 'poly')) return null;
  const out = {
    kind: s.kind, op: s.op === 'cut' ? 'cut' : 'add',
    level: clampInt(num(s.level) + levelShift, 0, HD_LEVELS - 1)
  };
  if (s.kind === 'poly') {
    out.pts = normPts(s.pts);
    if (s.sym === true) out.sym = true;
    if (out.pts.length < (out.sym ? 2 : 3)) return null;
    if (Array.isArray(s.holes)) {
      const holes = s.holes.map(normPts).filter((h) => h.length >= 3);
      if (holes.length) out.holes = holes;
    }
    out.ch = Math.max(0, num(s.ch, 0));
    out.r = Math.max(0, num(s.r, 0));
    // standaryzacja obrysu: krok siatki linii [j.] (0 — bez); hullDesignRegularize.js
    if (num(s.reg, 0) > 0) {
      out.reg = num(s.reg);
      if (s.regDrop === true) out.regDrop = true;     // okruch, którego nie da się ustandaryzować — znika
      if (out.regDrop && num(s.regThin, 0) > 0) out.regThin = num(s.regThin);   // … i cieńszy niż regThin [j.]
    }
  } else {
    out.x = num(s.x); out.y = num(s.y);
    if (s.kind === 'circle') out.r = Math.max(1, num(s.r, 60));
    else {
      out.w = Math.max(1, num(s.w, 40)); out.h = Math.max(1, num(s.h, 20));
      out.r = Math.max(0, Math.min(Math.min(out.w, out.h), num(s.r, 0)));
      out.ch = Math.max(0, Math.min(Math.min(out.w, out.h) * 1.9, num(s.ch, 0)));
      out.rot = num(s.rot);
    }
  }
  if (s.clip !== undefined && out.op === 'add') {
    out.clip = clampInt(num(s.clip) + levelShift, 0, HD_LEVELS - 1);
    // przycięcie z odsunięciem [j.]: bryła co najmniej clipIn wewnątrz poziomu C (płyty klocków — brzeg ramy przy burcie)
    if (num(s.clipIn) > 0) out.clipIn = num(s.clipIn);
  }
  if (s.mirror === false) out.mirror = false;
  return out;
}

function normModule(m) {
  const def = HD_MODULES[m?.type];
  if (!def) return null;
  const out = { type: m.type, x: num(m.x), y: num(m.y), rot: num(m.rot) };
  if (def.r) out.r = Math.max(2, num(m.r, def.r));
  if (def.w) { out.w = Math.max(2, num(m.w, def.w)); out.h = Math.max(2, num(m.h, def.h)); }
  if (m.v !== undefined) out.v = clampInt(m.v, 0, 3);
  if (m.n !== undefined) out.n = clampInt(m.n, 1, 8);
  if (m.doors !== undefined) out.doors = clampInt(m.doors, 1, 6);
  if (m.mirror === false) out.mirror = false;
  // system na stałym miejscu klasy i kadłuba (sloty presetów: hullDesignSystemSlots.js) — edytor go nie przesuwa
  if (m.lock === true) out.lock = true;
  // gniazdo broni: typ (tylko `mount`), rozmiar, broń ('' — puste; nieznana — typowa)
  const md = HD_MOUNT_MODULES[m.type];
  if (md) {
    if (m.type === 'mount') out.slot = HD_MOUNT_SLOTS.includes(m.slot) ? m.slot : md.slot;
    if (MOUNT_SIZES.includes(m.size)) out.size = m.size;
    else if (m.type === 'mount') out.size = md.size;
    if (m.weapon === '' || (typeof m.weapon === 'string' && MASTER_WEAPONS[m.weapon])) out.weapon = m.weapon;
  }
  return out;
}

/** Kolejka mocy projektu: permutacja POWER_CATEGORIES albo null (domyślna). */
function normPriority(p) {
  if (!Array.isArray(p)) return null;
  const out = [];
  for (const c of p) if (POWER_CATEGORIES.includes(c) && !out.includes(c)) out.push(c);
  if (!out.length) return null;
  for (const c of POWER_CATEGORIES) if (!out.includes(c)) out.push(c);
  return out;
}

function normDecal(d, levelShift = 0) {
  if (!d || typeof d !== 'object') return null;
  const base = { kind: d.kind, color: color(d.color, '#d06a22'), opacity: Math.max(0, Math.min(1, num(d.opacity, 0.92))) };
  if (d.mirror === false) base.mirror = false;
  if (d.kind === 'stripe') {
    return { ...base, x0: num(d.x0), y0: num(d.y0), x1: num(d.x1, 100), y1: num(d.y1), w: Math.max(0.2, num(d.w, 10)) };
  }
  if (d.kind === 'contour') {
    return {
      ...base, level: clampInt(num(d.level) + levelShift, 0, HD_LEVELS - 1), inset: Math.max(0, num(d.inset, 10)), w: Math.max(0.2, num(d.w, 5)),
      xMin: num(d.xMin, -1e5), xMax: num(d.xMax, 1e5), side: d.side === 'port' || d.side === 'stbd' ? d.side : 'both'
    };
  }
  if (d.kind === 'emblem' || d.kind === 'text') {
    const out = {
      ...base, x: num(d.x), y: num(d.y), rot: num(d.rot), w: Math.max(1, num(d.w, 40)), h: Math.max(1, num(d.h, 40)),
      flip: d.flip === true
    };
    if (d.kind === 'emblem') out.id = String(d.id || 'wing');
    else {
      out.text = String(d.text || 'HF').slice(0, 24);
      if (d.weight !== undefined) out.weight = clampInt(d.weight, 300, 900);
    }
    return out;
  }
  return null;
}

function normGroove(g) {
  const pts = normPts(g?.pts);
  if (pts.length < 2) return null;
  const out = { pts, w: Math.max(0.3, Math.min(8, num(g.w, 1.4))) };
  if (g.mirror === false) out.mirror = false;
  return out;
}

const PIPE_MATS = ['mix', 'steel', 'copper'];
function normPipe(p) {
  const pts = normPts(p?.pts);
  if (pts.length < 2) return null;
  const out = { pts, n: clampInt(num(p.n, 3), 1, 8), mat: PIPE_MATS.includes(p.mat) ? p.mat : 'mix' };
  if (p.r !== undefined) out.r = Math.max(0.4, Math.min(3, num(p.r, 1)));
  if (p.over === false) out.over = false;
  if (p.mirror === false) out.mirror = false;
  return out;
}

function normPart(p) {
  if (!p || !HD_PARTS[p.id]) return null;
  const out = { id: p.id, x: num(p.x), y: num(p.y), s: Math.max(0.02, Math.min(20, num(p.s, 1))), rot: num(p.rot) };
  if (p.dl) out.dl = clampInt(p.dl, -3, 3);
  if (p.mirror === false) out.mirror = false;
  return out;
}

/** Projekt po walidacji: brakujące pola z domyślnych, bloki bez powtórzeń (najwyższy poziom komórki), v1 → v2. */
export function normalizeHullDesign(design = {}) {
  // v1 (bez pola v albo v < 2): poziomy kadłub / nadbudówka / mostek → pancerz / nadbudówka / mostek.
  const shift = num(design.v, 1) >= 2 ? 0 : 1;
  const blocks = new Map();
  for (const b of Array.isArray(design.blocks) ? design.blocks : []) {
    if (!Array.isArray(b) || b.length < 2) continue;
    const bx = Math.round(num(b[0])), by = Math.round(num(b[1])), l = clampInt(num(b[2]) + shift, 0, HD_LEVELS - 1);
    const k = `${bx},${by}`;
    if (!blocks.has(k) || blocks.get(k)[2] < l) blocks.set(k, [bx, by, l]);
  }
  const detail = Math.max(HD_DETAIL.min, Math.min(HD_DETAIL.max, num(design.detail, HD_DETAIL.def)));
  const style = HD_STYLES.includes(design.style) ? design.style : 'chamfer';
  return {
    v: HD_VERSION,
    name: String(design.name || 'Projekt'),
    style,
    mirror: design.mirror !== false,
    palette: HD_PALETTES[design.palette] ? design.palette : 'terra',
    // Odcień farby (dowolny kolor zamiast palety) — opcjonalny.
    paint: design.paint && typeof design.paint === 'object' ? { ...design.paint } : null,
    seed: clampInt(design.seed, 0, 1e6) || 7,
    detail,
    // siatka klocków [j.]: z projektu (stała), dla projektu bez niej — z detalu
    grid: num(design.grid, 0) > 0 ? Math.max(0.01, Math.min(64, num(design.grid))) : hullDesignGridStep(detail),
    bevel: Math.max(0.3, Math.min(4, num(design.bevel, 1))),
    round: Math.max(0, Math.min(1, num(design.round, style === 'rounded' ? 1 : 0))),
    // Okna tarasów (rząd świateł za krawędzią nadbudówki): 0 — brak (Terra Nova), 1 — pełne.
    windows: Math.max(0, Math.min(1, num(design.windows, 1))),
    // klasa okrętu (src/data/shipClasses.js): mostek I–VI, rdzeń R1–R6; 0 — z powierzchni i gniazd
    bridgeLevel: clampInt(num(design.bridgeLevel, 0), 0, SHIP_CLASS_MAX),
    coreLevel: clampInt(num(design.coreLevel, 0), 0, SHIP_CLASS_MAX),
    powerPriority: normPriority(design.powerPriority),
    blocks: [...blocks.values()],
    shapes: (design.shapes || []).map((s) => normShape(s, shift)).filter(Boolean),
    modules: (design.modules || []).map(normModule).filter(Boolean),
    decals: (design.decals || []).map((d) => normDecal(d, shift)).filter(Boolean),
    parts: (design.parts || []).map(normPart).filter(Boolean),
    grooves: (design.grooves || []).map(normGroove).filter(Boolean),
    pipes: (design.pipes || []).map(normPipe).filter(Boolean),
    castles: (design.castles || []).map((c) => normalizeCastle(c, HD_LEVELS)).filter(Boolean),
    // sieć rur: brak pola = gęstość 0 (stare projekty wyglądają jak dawniej)
    pipeNet: {
      density: Math.max(0, Math.min(2, num(design.pipeNet?.density, 0))),
      seed: clampInt(design.pipeNet?.seed, 0, 1e6)
    },
    panels: Math.max(0, Math.min(1, num(design.panels, 1)))
  };
}

/** Paleta projektu: barwy palety frakcji nadpisane polami `paint`. */
export function hullDesignPalette(design) {
  const p = { ...HD_PALETTES[design.palette] || HD_PALETTES.terra };
  if (design.paint) for (const k of Object.keys(p)) if (COLOR_RE.test(design.paint[k] || '')) p[k] = design.paint[k];
  return p;
}

const MIRROR_EPS = 0.5;

/** Wielokąt sym (połowa od osi do osi) → pełny zamknięty wielokąt. */
export function symPolyPoints(pts) {
  const out = pts.map(([x, y]) => [x, y]);
  for (let i = pts.length - 2; i >= 1; i--) out.push([pts[i][0], -pts[i][1]]);
  return out;
}

/**
 * Projekt rozwinięty: lustro zastosowane (bloki, bryły, moduły, naklejki, rowki, rury), bryły modułów (gondole, mostki)
 * dopisane po bryłach projektu. Zwraca { design, blocks: Map 'bx,by' → poziom, shapes, modules, decals, grooves, pipes }.
 */
export function expandHullDesign(input) {
  const design = normalizeHullDesign(input);
  const blocks = new Map();
  const put = (bx, by, l) => {
    const k = `${bx},${by}`;
    const o = blocks.get(k);
    if (o === undefined || l > o) blocks.set(k, l);
  };
  for (const [bx, by, l] of design.blocks) {
    put(bx, by, l);
    if (design.mirror) put(bx, -1 - by, l);
  }
  const mirrorOf = (o) => design.mirror && o.mirror !== false;
  const shapes = [];
  // klocki: wszystkie naraz (sumy geometryczne ramy, płyt i wycięć) w miejscu pierwszego klocka
  const blockList = design.shapes.filter((s) => s.kind === 'block');
  let blocksDone = false;
  for (const s of design.shapes) {
    if (s.kind === 'block') {
      if (blocksDone) continue;
      blocksDone = true;
      for (const sh of expandHullBlocks(blockList, { detail: design.detail, mirror: mirrorOf, levels: HD_LEVELS })) shapes.push(sh);
      continue;
    }
    if (s.kind === 'poly') {
      const pts = s.sym ? symPolyPoints(s.pts) : s.pts;
      shapes.push({ ...s, pts });
      if (!s.sym && mirrorOf(s) && pts.some(([, y]) => Math.abs(y) > MIRROR_EPS)) {
        const flip = (l) => l.map(([x, y]) => [x, -y]);
        shapes.push({ ...s, pts: flip(pts), holes: s.holes ? s.holes.map(flip) : undefined, mirrorOf: true });
      }
      continue;
    }
    shapes.push(s);
    if (mirrorOf(s) && Math.abs(s.y) > MIRROR_EPS) shapes.push({ ...s, y: -s.y, rot: s.rot ? -s.rot : s.rot, mirrorOf: true });
  }
  const modules = [];
  for (const m of design.modules) {
    modules.push(m);
    if (mirrorOf(m) && Math.abs(m.y) > MIRROR_EPS) modules.push({ ...m, y: -m.y, rot: -m.rot, mirrorOf: true });
  }
  // Gotowe części: rozwinięte na bryły, moduły i naklejki (kopia lustra — odbita część).
  const partDecals = [];
  for (const p of design.parts) {
    const copies = [false];
    if (mirrorOf(p) && Math.abs(p.y) > MIRROR_EPS) copies.push(true);
    for (const flip of copies) {
      const ex = expandHullPart(p, flip, HD_LEVELS);
      for (const sh of ex.shapes) shapes.push({ ...normShape(sh), part: p, mirrorOf: flip || undefined });
      for (const m of ex.modules) { const nm = normModule(m); if (nm) modules.push({ ...nm, part: p, mirrorOf: flip || undefined }); }
      for (const d of ex.decals) { const nd = normDecal(d); if (nd) partDecals.push({ ...nd, part: p, mirrorOf: flip || undefined }); }
    }
  }
  // Kasztele: wielokąty pięter i moduły (kratka, iluminator, klapy); kopia lustra odbita, kasztel na osi — bez kopii.
  for (const c of design.castles) {
    const copies = [false];
    if (mirrorOf(c) && Math.abs(c.y) >= c.h * 0.35) copies.push(true);
    for (const flip of copies) {
      const ex = expandCastle(c, flip, design.detail, HD_LEVELS);
      for (const sh of ex.shapes) { const ns = normShape(sh); if (ns) shapes.push({ ...ns, castle: c, mirrorOf: flip || undefined }); }
      for (const m of ex.modules) { const nm = normModule(m); if (nm) modules.push({ ...nm, castle: c, mirrorOf: flip || undefined }); }
    }
  }
  // Bryły modułów: gondola silnika (rama) i mostek — po bryłach projektu.
  for (const m of modules) {
    const def = HD_MODULES[m.type];
    if (def.level === undefined) continue;
    const r = m.type === 'engine' ? Math.min(m.h * 0.35, 16) : Math.min(m.h * 0.55, 12);
    shapes.push({ kind: 'rect', op: 'add', x: m.x, y: m.y, w: m.w, h: m.h, r, ch: 0, rot: m.rot, level: def.level, module: m.type });
  }
  const decals = [...partDecals];
  for (const d of design.decals) {
    decals.push(d);
    if (!mirrorOf(d) || d.kind === 'contour') continue;
    if (d.kind === 'stripe') {
      if (Math.abs(d.y0) > MIRROR_EPS || Math.abs(d.y1) > MIRROR_EPS) decals.push({ ...d, y0: -d.y0, y1: -d.y1, mirrorOf: true });
    } else if (Math.abs(d.y) > MIRROR_EPS) {
      // Emblemat po drugiej burcie odbity (jak lustro), napis czytelny (bez odbicia obrazu).
      decals.push({ ...d, y: -d.y, rot: -d.rot, flip: d.kind === 'emblem' ? !d.flip : d.flip, mirrorOf: true });
    }
  }
  const grooves = [];
  for (const g of design.grooves) {
    grooves.push(g);
    if (mirrorOf(g) && g.pts.some(([, y]) => Math.abs(y) > MIRROR_EPS)) grooves.push({ ...g, pts: g.pts.map(([x, y]) => [x, -y]), mirrorOf: true });
  }
  // rury ręczne: kopia lustra odbita, `src` — numer rury projektu (kopia dzieli wiązkę z oryginałem)
  const pipes = [];
  design.pipes.forEach((q, i) => {
    pipes.push({ ...q, src: i });
    if (mirrorOf(q) && q.pts.some(([, y]) => Math.abs(y) > MIRROR_EPS)) pipes.push({ ...q, pts: q.pts.map(([x, y]) => [x, -y]), src: i, mirrorOf: true });
  });
  return { design, blocks, shapes, modules, decals, grooves, pipes };
}

/** Bloki z poziomem ≥ L (zbiór kluczy 'bx,by'). */
export function blocksAtLevel(blocks, level) {
  const out = new Set();
  for (const [k, l] of blocks) if (l >= level) out.add(k);
  return out;
}
