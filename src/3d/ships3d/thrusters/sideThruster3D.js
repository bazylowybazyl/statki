// src/3d/ships3d/thrusters/sideThruster3D.js
//
// MODEL 3D DYSZY BOCZNEJ (SIDE) — 2026-10-07. Sprite'y kadłubów nie mają namalowanych dysz manewrowych (płomień SIDE
// bił z gołej burty), modele 3D okrętów miały w ich miejscu nieruchome skrzynki. Dysza SIDE w grze jest WEKTOROWANA:
// kąt `nozzleDeg` w zakresie gimbala ±90° wokół `baseDeg` (wydech na zewnątrz burty) — model ma więc dwie części:
//   BASE   — sponson przykręcony do kadłuba (płyta z fazą, pasek frakcji, obrotnica); obraca się z kadłubem, wzdłuż
//            kierunku wydechu w spoczynku (baseDeg — na zewnątrz burty);
//   SWIVEL — część obrotowa na obrotnicy: platforma, jarzmo (policzki i czop), komora spalania z kopułką, kołnierz
//            gardzieli i dzwon (zewnątrz goły metal z obręczami chłodzenia i jasną wargą, wewnątrz ciemny, żar
//            gardzieli E_ENGINE), siłowniki; obraca się z kierunkiem wydechu (ten sam co płomień SIDE).
// Oś obrotu = marker dyszy z edytora (tam, gdzie gra liczy dyszę), wylot dzwonu SIDE_NOZZLE_MOUTH przed nią — tam
// zaczyna się płomień (engineVfxSystem.js). Rysunek: jedna partia na wszystkie dysze w kadrze (thrusterBatch3D.js).
//
// UKŁAD LOKALNY: +X — kierunek wydechu (BASE: w spoczynku, SWIVEL: teraz), +Y — w lewo, +Z — w górę (ku kamerze gry);
// jednostka = PROMIEŃ WYLOTU dzwonu (świat = lokalne × SIDE_NOZZLE_RADIUS × skala klasy kadłuba, sideNozzleFrame.js).
// Z góry (kamera gry) dysza wygląda jak sponson z obrotową dyszą; część obrotowa spłaszczona w pionie (SWIVEL_SQUASH —
// z góry bez zmian, z boku w kamerach 3D nie przerasta kadłuba).
//
// FARBA: jak kadłub, na którym siedzi (decyzja użytkownika 2026-10-07: „Terra Nova = biel, Atlas i frachtowce =
// szary”) — palety SIDE_THRUSTER_PALETTES (nadpisania SHIP3D_PALETTE: farba, płyty, grafit, goły metal, jasne
// krawędzie, pasek), wybór z profilu kadłuba (sideThrusterPaletteFor). Barwy zmierzone na sprite'ach (średnie
// jasnych / środkowych / ciemnych pikseli kadłuba): Terra Nova kremowa biel, Atlas chłodny grafit, frachtowce szary
// neutralny z bursztynowym akcentem, piraci rdza z czerwonym pasem.
//
// Czysty JS (MeshBuilder3D — w Node też): testy tests/sideThrusters3D.test.mjs.

import { MeshBuilder3D, SHIP3D_MAT as M, octPoly } from '../meshBuilder3D.js';
import { SIDE_NOZZLE_MOUTH } from '../../sideNozzleFrame.js';

/** Część modelu (aThrPart.x). */
export const SIDE_THRUSTER_PART = Object.freeze({ BASE: 0, SWIVEL: 1 });

// Wymiary (j. lokalne — promień wylotu = 1).
const PLATE = Object.freeze({ x0: -1.5, x1: 1.12, hy: 1.2, z1: 0.3 });
const TURN = Object.freeze({ r: 1.0, rIn: 0.78, z0: 0.26, z1: 0.5 });
const ZC = 1.06;              // oś komory i dzwonu
const SWIVEL_SQUASH = 0.72;   // spłaszczenie części obrotowej w pionie (wokół osi dzwonu)

/** Wysokość osi dzwonu nad spodem sponsonu (j. lokalne) — na modelu 3D oś idzie w połowę burty. */
export const SIDE_THRUSTER_AXIS_Z = ZC;
/** Pół szerokości sponsonu (j. lokalne) — LOD: dysza mniejsza na ekranie nie ma modelu. */
export const SIDE_THRUSTER_HALF_WIDTH = PLATE.hy;
const BELL_X0 = 0.5;          // gardziel (początek dzwonu)
const BELL_LEN = SIDE_NOZZLE_MOUTH - BELL_X0;

/** Żar dzwonu: waga wierzchołka (1 przy gardzieli → 0,1 przy wylocie); tylko metal dzwonu i kołnierza. */
const HEAT_MATS = new Set([M.METAL, M.BRIGHT, M.DARK, M.E_ENGINE]);
const HEAT_X0 = 0.32;

// ---------------------------------------------------------------------------
// Palety frakcji (nadpisania SHIP3D_PALETTE; reszta materiałów — wspólna paleta modeli).
// ---------------------------------------------------------------------------
const PAL_TERRAN = {
  [M.PAINT]: { color: '#d3d0c6', rough: 0.5, metal: 0.16 },
  [M.PANEL]: { color: '#a6a399', rough: 0.58, metal: 0.2 },
  [M.DARK]: { color: '#2e2d2a', rough: 0.6, metal: 0.4 },
  [M.STEEL]: { color: '#8c8a84', rough: 0.5, metal: 0.45 },
  [M.METAL]: { color: '#9b968d', rough: 0.34, metal: 0.75 },
  [M.BRIGHT]: { color: '#ebe9e1', rough: 0.42, metal: 0.32 },
  [M.TRIM]: { color: '#34322f', rough: 0.52, metal: 0.3 }
};
const PAL_ATLAS = {
  [M.PAINT]: { color: '#5d646f', rough: 0.58, metal: 0.38 },
  [M.PANEL]: { color: '#40464f', rough: 0.64, metal: 0.34 },
  [M.DARK]: { color: '#1c2026', rough: 0.56, metal: 0.45 },
  [M.STEEL]: { color: '#5f6772', rough: 0.55, metal: 0.4 },
  [M.METAL]: { color: '#6e7682', rough: 0.3, metal: 0.85 },
  [M.BRIGHT]: { color: '#a3acb8', rough: 0.42, metal: 0.5 },
  [M.TRIM]: { color: '#5c6878', rough: 0.5, metal: 0.3 }
};
const PAL_CIVIL = {
  [M.PAINT]: { color: '#5c5d60', rough: 0.62, metal: 0.4 },
  [M.PANEL]: { color: '#3f4043', rough: 0.68, metal: 0.35 },
  [M.DARK]: { color: '#1d1e20', rough: 0.6, metal: 0.45 },
  [M.STEEL]: { color: '#606266', rough: 0.56, metal: 0.42 },
  [M.METAL]: { color: '#6b6d71', rough: 0.32, metal: 0.82 },
  [M.BRIGHT]: { color: '#a5a7ab', rough: 0.44, metal: 0.48 },
  [M.TRIM]: { color: '#c4802c', rough: 0.5, metal: 0.25 }
};
const PAL_PIRATE = {
  [M.PAINT]: { color: '#5b473d', rough: 0.74, metal: 0.42 },
  [M.PANEL]: { color: '#47382f', rough: 0.78, metal: 0.35 },
  [M.DARK]: { color: '#1e1916', rough: 0.7, metal: 0.45 },
  [M.STEEL]: { color: '#57504a', rough: 0.66, metal: 0.5 },
  [M.METAL]: { color: '#5e544c', rough: 0.45, metal: 0.7 },
  [M.BRIGHT]: { color: '#86705f', rough: 0.5, metal: 0.45 },
  [M.TRIM]: { color: '#8a2f1d', rough: 0.7, metal: 0.25 }
};

/** Klucze palet (indeks = aThrState.z instancji). */
export const SIDE_THRUSTER_PALETTE_KEYS = Object.freeze(['terran', 'atlas', 'civil', 'pirate']);
export const SIDE_THRUSTER_PALETTE = Object.freeze({ TERRAN: 0, ATLAS: 1, CIVIL: 2, PIRATE: 3 });
/** Palety w kolejności kluczy — createShipMaterial({ palettes }). */
export const SIDE_THRUSTER_PALETTES = Object.freeze([PAL_TERRAN, PAL_ATLAS, PAL_CIVIL, PAL_PIRATE]);

/**
 * Farba dyszy z profilu kadłuba (HULL_RENDER_PROFILES — resolveEntityHullProfileId): Atlas — szary Atlasa,
 * Terra Nova (terran_*, Colossus `supercapital`, dawny lotniskowiec, Corvus) — biel, piraci (pirate_*, przemytnik)
 * — rdza, reszta (frachtowce, megafrachtowiec, kadłuby ruchu v2) — szary cywilny.
 */
export function sideThrusterPaletteFor(profileId) {
  const id = String(profileId || '').toLowerCase();
  if (!id || id === 'atlas' || id === 'player') return SIDE_THRUSTER_PALETTE.ATLAS;
  if (id.startsWith('pirate_') || id === 'smuggler') return SIDE_THRUSTER_PALETTE.PIRATE;
  if (id.startsWith('terran_') || id === 'supercapital' || id === 'capital_carrier' || id === 'corvus'
    || id === 'frigate' || id === 'destroyer' || id === 'battleship' || id === 'carrier') return SIDE_THRUSTER_PALETTE.TERRAN;
  return SIDE_THRUSTER_PALETTE.CIVIL;
}

// ---------------------------------------------------------------------------
// Bryły
// ---------------------------------------------------------------------------

function buildBase(B) {
  // Sponson: płyta z fazą (ciemniejsza krawędź — z góry bez jasnej ramki), dłuższa w głąb kadłuba (−X), grafitowy spód.
  B.prism(octPoly(PLATE.x0, -PLATE.hy, PLATE.x1, PLATE.hy, [0.36, 0.45, 0.45, 0.36]), 0, PLATE.z1, {
    bevel: [0.08, 0.08], wallMat: M.PANEL, bevelMat: M.PANEL, capMat: M.PAINT, bottom: true, bottomMat: M.DARK
  });
  // Pasek frakcji przy kadłubie i dwie pokrywy serwisowe po bokach obrotnicy.
  B.box(-1.28, 0, PLATE.z1 + 0.02, 0.16, 1.6, 0.04, { mat: M.TRIM, bottom: false });
  B.mirrorY(() => {
    B.box(-0.95, 0.92, PLATE.z1 + 0.03, 0.42, 0.3, 0.06, { mat: M.PANEL, bevel: [0.02, 0.02], bottom: false });
    // śruby w narożnikach płyty (wewnątrz faz narożników)
    B.box(0.72, 0.98, PLATE.z1 + 0.03, 0.12, 0.12, 0.06, { mat: M.DARK, bottom: false });
    B.box(-1.25, 0.92, PLATE.z1 + 0.03, 0.12, 0.12, 0.06, { mat: M.DARK, bottom: false });
  });
  // Obrotnica: pierścień (płyty, cienka metalowa faza — z góry bez jasnych półksiężyców), ciemny uskok, wnętrze.
  B.lathe([
    [TURN.r, TURN.z0], [TURN.r, TURN.z1 - 0.08], [TURN.r - 0.08, TURN.z1], [TURN.rIn, TURN.z1], [TURN.rIn, TURN.z1 - 0.04], [0, TURN.z1 - 0.04]
  ], { seg: 28, mats: [M.PANEL, M.METAL, M.PANEL, M.DARK, M.DARK] });
}

function buildSwivel(S) {
  const z0 = TURN.z1;
  // Platforma obrotowa (wydłużona wzdłuż wydechu — z góry widać kierunek dyszy).
  S.prism(octPoly(-0.95, -0.7, 0.45, 0.7, 0.25), z0, z0 + 0.12, {
    bevel: [0.04, 0.04], wallMat: M.PANEL, bevelMat: M.BRIGHT, capMat: M.PANEL, bottom: false
  });
  // Jarzmo: policzki i czop.
  S.mirrorY(() => S.box(-0.2, 0.6, (z0 + 0.12 + ZC + 0.3) / 2, 1.0, 0.16, ZC + 0.3 - z0 - 0.12, { mat: M.PAINT, bevel: [0.04, 0.04] }));
  S.cylinder([0, -0.72, ZC], [0, 0.72, ZC], 0.15, 0.15, { seg: 10, mat: M.METAL, capMat: M.BRIGHT });
  // Siłowniki: od policzków do obręczy dzwonu (stal — bez żaru).
  S.mirrorY(() => S.cylinder([0.18, 0.6, ZC + 0.22], [1.12, 0.5, ZC + 0.36], 0.05, 0.05, { seg: 6, mat: M.STEEL }));
  // Komora spalania z obręczą chłodzenia i kopułką (spłaszczone wokół osi).
  S.push().translate(0, 0, ZC).scale(1, 1, SWIVEL_SQUASH);
  S.cylinder([-0.9, 0, 0], [0.38, 0, 0], 0.44, 0.44, { seg: 16, mat: M.PANEL, capA: false, capB: false });
  S.cylinder([-0.5, 0, 0], [-0.36, 0, 0], 0.47, 0.47, { seg: 16, flat: true, mat: M.DARK });
  S.push().translate(-0.9, 0, 0).rotateY(-Math.PI / 2);
  S.dome(0, 0, 0, 0.44, 0.28, { seg: 16, rings: 4, mat: M.PANEL });
  S.pop();
  // Kołnierz gardzieli.
  S.cylinder([0.34, 0, 0], [0.52, 0, 0], 0.55, 0.55, { seg: 18, flat: true, mat: M.BRIGHT, capMat: M.BRIGHT });
  S.pop();
  // Dzwon wzdłuż +X: zewnątrz goły metal z obręczami, jasna warga; wewnątrz ciemny, gardziel świeci (E_ENGINE).
  S.push().translate(BELL_X0, 0, ZC).scale(1, 1, SWIVEL_SQUASH).rotateY(Math.PI / 2);
  const L = BELL_LEN;
  S.lathe([
    [0.47, 0], [0.56, 0.12 * L], [0.65, 0.28 * L], [0.69, 0.29 * L], [0.70, 0.35 * L], [0.68, 0.36 * L],
    [0.84, 0.62 * L], [0.88, 0.63 * L], [0.89, 0.69 * L], [0.87, 0.70 * L], [0.99, 0.92 * L], [1.05, 0.93 * L], [1.05, L]
  ], { seg: 24, mats: [M.METAL, M.METAL, M.BRIGHT, M.BRIGHT, M.BRIGHT, M.METAL, M.BRIGHT, M.BRIGHT, M.BRIGHT, M.METAL, M.BRIGHT, M.BRIGHT] });
  S.lathe([[1.05, L], [0.95, L]], { seg: 24, mats: [M.BRIGHT] });
  // wnętrze: profil od gardzieli do wylotu (inside — normalne ku osi)
  S.lathe([[0.4, 0.08 * L], [0.5, 0.24 * L], [0.69, 0.55 * L], [0.88, 0.87 * L], [0.95, L]], { seg: 24, mats: [M.E_ENGINE, M.DARK, M.DARK, M.DARK], inside: true });
  S.lathe([[0, 0.08 * L], [0.4, 0.08 * L]], { seg: 24, mats: [M.E_ENGINE], inside: true });
  S.pop();
}

const CACHE = new Map();

/**
 * Model dyszy SIDE (wspólny — cache): { parts: { base, swivel } (MeshBuilder3D), mouth, height, plate }.
 * Jednostki lokalne (promień wylotu = 1); mouth — wylot dzwonu od osi obrotu (= SIDE_NOZZLE_MOUTH).
 */
export function buildSideThruster3D(o = {}) {
  const key = `${o.uvScale ?? 1}`;
  let m = CACHE.get(key);
  if (m) return m;
  const mk = () => new MeshBuilder3D({ uvScale: o.uvScale ?? 1 });
  const B = mk();
  const S = mk();
  buildBase(B);
  buildSwivel(S);
  m = Object.freeze({
    parts: Object.freeze({ base: B, swivel: S }),
    mouth: SIDE_NOZZLE_MOUTH,
    height: ZC + 1.05 * SWIVEL_SQUASH,
    plate: PLATE
  });
  CACHE.set(key, m);
  return m;
}

let _arrays = null;

/**
 * Scalona geometria (BASE + SWIVEL) dla partii: { position, normal, uv, mat, part (vec2: część, waga żaru), index,
 * vertexCount, height, pieces: [{ part, first, count }] }. Waga żaru: metal dzwonu i kołnierza gardzieli (x ≥ 0,32),
 * 1 przy gardzieli → 0,1 przy wylocie — świeci po dłuższym ciągu (thrusterBatch3D.js).
 */
export function buildSideThrusterArrays() {
  if (_arrays) return _arrays;
  const model = buildSideThruster3D();
  const base = model.parts.base.build();
  const swivel = model.parts.swivel.build();
  const pieces = [
    { src: base, part: SIDE_THRUSTER_PART.BASE },
    { src: swivel, part: SIDE_THRUSTER_PART.SWIVEL }
  ];
  let nv = 0, ni = 0;
  for (const p of pieces) { nv += p.src.vertexCount; ni += p.src.index.length; }
  const position = new Float32Array(nv * 3), normal = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const mat = new Float32Array(nv), part = new Float32Array(nv * 2);
  const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let v = 0, k = 0;
  for (const p of pieces) {
    const s = p.src;
    position.set(s.position, v * 3);
    normal.set(s.normal, v * 3);
    uv.set(s.uv, v * 2);
    mat.set(s.mat, v);
    for (let i = 0; i < s.vertexCount; i++) {
      const o = (v + i) * 2;
      part[o] = p.part;
      let w = 0;
      if (p.part === SIDE_THRUSTER_PART.SWIVEL && HEAT_MATS.has(s.mat[i])) {
        const x = s.position[i * 3];
        if (x >= HEAT_X0) w = 1 - 0.9 * Math.max(0, Math.min(1, (x - 0.45) / (SIDE_NOZZLE_MOUTH - 0.45)));
      }
      part[o + 1] = w;
    }
    for (let i = 0; i < s.index.length; i++) index[k + i] = s.index[i] + v;
    p.first = v;
    p.count = s.vertexCount;
    v += s.vertexCount;
    k += s.index.length;
  }
  _arrays = Object.freeze({
    position, normal, uv, mat, part, index, vertexCount: nv, height: model.height, mouth: model.mouth,
    pieces: Object.freeze(pieces.map(({ part: pp, first, count }) => Object.freeze({ part: pp, first, count })))
  });
  return _arrays;
}

/**
 * Lustro CPU etapu wierzchołków (ThrusterBatchNodeMaterial): wierzchołek v (j. lokalne) części `part` z rekordem
 * `r` (SIDE_THRUSTER_INST_STRIDE liczb od `o`, thrusterBatch3D.js) → pozycja względem początku partii; `n`
 * (opcjonalnie) — normalna. BASE obraca kierunek podstawy (iThrRot.xy), SWIVEL — kierunek wydechu (iThrRot.zw).
 */
export function sideThrusterVertexCpu(r, o, part, v, n, out) {
  const sw = part > 0.5;
  const c = sw ? r[o + 6] : r[o + 4], s = sw ? r[o + 7] : r[o + 5];
  const K = r[o + 3];
  out.x = (v[0] * c - v[1] * s) * K + r[o];
  out.y = (v[0] * s + v[1] * c) * K + r[o + 1];
  out.z = v[2] * K + r[o + 2];
  if (n) { out.nx = n[0] * c - n[1] * s; out.ny = n[0] * s + n[1] * c; out.nz = n[2]; }
  return out;
}
