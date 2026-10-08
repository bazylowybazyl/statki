// src/3d/repair/repairDroneModel.js
//
// BRYŁA DRONA NAPRAWCZEGO (rój dronów naprawczych okrętu — src/game/repairRig.js). Rodzina dronów roju
// (src/3d/swarm/swarmDroneModel.js: kadłub o przekroju sześciokąta, silniki jonowe na rufie, płaskie bloki RCS wtopione
// w barki, wizjer — BEZ wirników, decyzja użytkownika 2026-10-05), wzór wyglądu assets/repair_drone.png: grafitowy
// kadłub z jasną płytą grzbietu i bursztynowymi znakami, dwie gondole silników z kratą osłony na rufie, DWA RAMIONA
// trzymające PŁYTĘ łaty pod dziobem i PALNIK na dziobie.
//
// Układ lokalny: x — dziób, y — lewa burta, z — w górę; początek = środek drona na wysokości lotu. Jednostki: j. świata
// (dron 26 j. — ~1,7 komórki Atlasa). Części (aRdPart.x, poza w etapie wierzchołków — repairDrones3D.js, lustro
// repairDroneVertexCpu):
//   BODY  — sztywna;
//   ARM   — przedramiona z chwytakami: opadają z płytą przy spawaniu (pion przez tuleję łokcia — z góry bez szczeliny);
//   PLATE — płyta łaty: niesiona pod dziobem, przy spawaniu opuszczona na poszycie (REPAIR_DRONE_DIMS.plateDrop);
//           bez płyty (prostowanie, powrót) — zwinięta do punktu;
//   TORCH — końcówka palnika: świeci przy spawaniu (emisja z rekordu instancji, aRdPart.y = waga).
// Materiały: paleta modeli okrętów 3D (SHIP3D_MAT, shipMaterials3D.tsl.js) z nadpisaniami drona (REPAIR_DRONE_PALETTE).
// Czysty JS (MeshBuilder3D — w Node też): testy tests/repairRig.test.mjs.

import { MeshBuilder3D, SHIP3D_MAT as M, octPoly } from '../ships3d/meshBuilder3D.js';

export const REPAIR_DRONE_PART = Object.freeze({ BODY: 0, ARM: 1, PLATE: 2, TORCH: 3 });

/** Wymiary (j. świata) — wspólne z logiką (plateForward) i obrazem (punkt spawania, iskry). */
export const REPAIR_DRONE_DIMS = Object.freeze({
  length: 26,          // od kraty osłony silników do końca palnika
  plateX: 10,          // środek płyty przed środkiem drona (= REPAIR_TUNE.plateForward)
  plateZ: -3.2,        // środek płyty pod dronem (niesiona)
  plateSize: 13.6,     // bok płyty (komórka Atlasa 15 j. minus zakładka)
  plateThick: 0.8,
  plateDrop: 3.2,      // opuszczenie płyty przy spawaniu (dron na workZ 7 → płyta na poszyciu)
  torchX: 13.4,        // końcówka palnika
  torchZ: -1.4
});

/** Nadpisania palety (SHIP3D_MAT → barwa sRGB, szorstkość, metaliczność): grafit, jasna płyta, bursztyn, podkład płyty. */
export const REPAIR_DRONE_PALETTE = Object.freeze({
  [M.PAINT]: { color: '#3b4048', rough: 0.55, metal: 0.45 },    // grafitowy kadłub
  [M.PANEL]: { color: '#2a2e35', rough: 0.62, metal: 0.4 },     // ciemne płyty, boki
  [M.BRIGHT]: { color: '#b9bfc6', rough: 0.4, metal: 0.55 },    // jasna płyta grzbietu
  [M.STEEL]: { color: '#7d858f', rough: 0.45, metal: 0.6 },     // ramiona, palnik
  [M.TRIM]: { color: '#d8962a', rough: 0.5, metal: 0.2 },       // bursztynowe znaki i pasy
  [M.HANGAR]: { color: '#6c6f72', rough: 0.85, metal: 0.25, emissive: '#000000', power: 0, seams: 0.2 } // podkład płyty
});

// Przekrój kadłuba (sześciokąt w płaszczyźnie y, z): półszerokość w, wysokość h, środek zc.
function hexSection(w, h, zc) {
  const top = zc + h / 2, bot = zc - h / 2, mid = zc + 0.1 * h;
  return [[0.62 * w, top], [w, mid], [0.8 * w, bot], [-0.8 * w, bot], [-w, mid], [-0.62 * w, top]];
}

function loft(mb, sections, matOf, capMats) {
  for (let i = 0; i < sections.length - 1; i++) {
    const a = sections[i], b = sections[i + 1];
    mb.push();
    mb.translate(a.x, 0, 0).rotateY(Math.PI / 2);
    const ring = (sec) => sec.map(([y, z]) => [-z, y]);
    mb.walls(ring(hexSection(a.w, a.h, a.zc)), 0, ring(hexSection(b.w, b.h, b.zc)), b.x - a.x, (edge) => matOf(edge, i));
    mb.pop();
  }
  const cap = (s, mat, out) => mb.face(hexSection(s.w, s.h, s.zc).map(([y, z]) => [s.x, y, z]), mat, [out, 0, 0]);
  cap(sections[0], capMats[0], -1);
  cap(sections[sections.length - 1], capMats[1], 1);
}

function buildBody(mb, hi) {
  const sections = [
    { x: -9.5, w: 4.2, h: 3.6, zc: 0.2 },
    { x: -5.0, w: 5.3, h: 4.4, zc: 0.3 },
    { x: 3.5, w: 5.0, h: 4.2, zc: 0.3 },
    { x: 8.6, w: 2.8, h: 2.6, zc: 0.0 }
  ];
  // Krawędzie przekroju: 0 górna-prawa, 1 dolna-prawa, 2 spód, 3 dolna-lewa, 4 górna-lewa, 5 grzbiet.
  loft(mb, sections, (edge) => (edge === 2 ? M.DARK : (edge === 1 || edge === 3 ? M.PANEL : M.PAINT)), [M.DARK, M.DARK]);
  // Jasna płyta grzbietu (jak środek sprite'a) z bursztynowymi znakami.
  mb.box(-1.0, 0, 2.62, 8.4, 5.2, 0.32, { mat: M.BRIGHT, bevel: [0.1, 0.5] });
  if (hi) {
    for (const s of [1, -1]) {
      mb.box(-1.0, s * 1.6, 2.82, 3.2, 0.5, 0.12, { mat: M.E_AMBER });
      mb.box(4.4, s * 2.6, 2.3, 1.4, 0.32, 0.1, { mat: M.TRIM });
    }
    // Wizjer czujników na dziobie.
    mb.box(8.3, 0, 0.4, 0.5, 2.6, 0.5, { mat: M.E_CYAN });
  }
  // Gondole silników jonowych na rufie (walce wzdłuż x) i świecące wyloty.
  for (const s of [1, -1]) {
    mb.cylinder([-13.2, s * 3.4, 0.2], [-7.6, s * 3.4, 0.2], 1.75, 1.75, { mat: M.DARK, seg: hi ? 12 : 6 });
    if (hi) {
      mb.cylinder([-12.4, s * 3.4, 0.2], [-11.0, s * 3.4, 0.2], 1.86, 1.86, { mat: M.TRIM, seg: 12 });
      mb.cylinder([-8.6, s * 3.4, 0.2], [-7.9, s * 3.4, 0.2], 1.86, 1.86, { mat: M.STEEL, seg: 12 });
    }
    mb.cylinder([-13.35, s * 3.4, 0.2], [-13.2, s * 3.4, 0.2], 1.25, 1.25, { mat: M.E_ENGINE, seg: hi ? 12 : 6, capA: true, capB: false });
  }
  // Krata osłony silników (rama za rufą) — stal z bursztynowym pasem.
  mb.box(-14.1, 0, 0.2, 0.45, 9.6, 0.5, { mat: M.STEEL });
  for (const s of [1, -1]) mb.box(-13.7, s * 4.8, 0.2, 1.2, 0.45, 0.5, { mat: M.STEEL });
  if (hi) mb.box(-14.15, 0, 0.5, 0.5, 4.0, 0.12, { mat: M.TRIM });
  // Płaskie bloki RCS wtopione w barki (bez okrągłych gondoli — z góry nie wyglądają jak wirniki).
  for (const [x, s] of [[-6.2, 1], [-6.2, -1], [4.4, 1], [4.4, -1]]) {
    mb.box(x, s * 5.15, 0.3, 1.8, 0.7, 1.6, { mat: M.PANEL, bevel: [0.15, 0.15] });
    if (hi) mb.box(x, s * 5.52, 0.3, 1.1, 0.06, 0.7, { mat: M.DARK });
  }
  // Barki ramion: piasta (walec wzdłuż y) i ramię do tulei łokcia nad płytą.
  for (const s of [1, -1]) {
    mb.cylinder([2.2, s * 4.4, 0.6], [2.2, s * 5.8, 0.6], 0.95, 0.95, { mat: M.DARK, seg: hi ? 10 : 6 });
    mb.box(4.8, s * 6.6, 0.6, 5.4, 1.0, 1.0, { mat: M.STEEL, bevel: [0.15, 0.15] });
    // Tuleja łokcia (pion) — przedramię wsuwa się w nią przy opuszczaniu płyty.
    mb.cylinder([7.6, s * 7.2, 1.4], [7.6, s * 7.2, -1.8], 0.85, 0.85, { mat: M.DARK, seg: hi ? 10 : 6 });
    if (hi) mb.box(4.8, s * 6.6, 1.15, 2.4, 0.5, 0.1, { mat: M.TRIM });
  }
  // Palnik: obudowa na dziobie skierowana w dół ku krawędzi płyty.
  mb.push();
  mb.translate(9.0, 0, 0.0).rotateY(0.55);
  mb.cylinder([0, 0, 0], [4.0, 0, 0], 0.9, 0.6, { mat: M.STEEL, seg: hi ? 10 : 6 });
  if (hi) mb.cylinder([1.1, 0, 0], [1.7, 0, 0], 1.0, 1.0, { mat: M.TRIM, seg: 10 });
  mb.pop();
}

function buildArms(mb, hi) {
  const D = REPAIR_DRONE_DIMS;
  const edge = D.plateSize / 2;
  for (const s of [1, -1]) {
    // Przedramię z tulei łokcia do chwytaka przy krawędzi płyty.
    mb.box(7.6, s * 7.2, -2.4, 0.9, 0.9, 2.2, { mat: M.STEEL });
    mb.box(8.9, s * (edge + 0.5), -2.9, 3.0, 0.8, 0.8, { mat: M.STEEL, bevel: [0.12, 0.12] });
    // Szczęki chwytaka nad i pod krawędzią płyty.
    mb.box(D.plateX, s * (edge + 0.15), D.plateZ + 0.75, 2.6, 1.1, 0.35, { mat: M.DARK });
    mb.box(D.plateX, s * (edge + 0.15), D.plateZ - 0.75, 2.6, 1.1, 0.35, { mat: M.DARK });
    if (hi) mb.box(D.plateX, s * (edge + 0.7), D.plateZ, 0.9, 0.12, 0.9, { mat: M.E_AMBER });
  }
}

function buildPlate(mb, hi) {
  const D = REPAIR_DRONE_DIMS;
  const h = D.plateSize / 2, t = D.plateThick / 2;
  mb.prism(octPoly(D.plateX - h, -h, D.plateX + h, h, 0.9), D.plateZ - t, D.plateZ + t, { mat: M.HANGAR, bottom: true });
  if (hi) {
    // Faza krawędzi (ciemniejsza) i znaki montażowe w narożnikach.
    for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      mb.box(D.plateX + dx * (h - 1.4), dy * (h - 1.4), D.plateZ + t + 0.04, 0.9, 0.9, 0.08, { mat: M.DARK });
    }
  }
}

function buildTorchTip(mb, hi) {
  // Dysza palnika (świeci przy spawaniu — emisja z rekordu instancji).
  mb.push();
  mb.translate(9.0, 0, 0.0).rotateY(0.55);
  mb.cylinder([4.0, 0, 0], [5.2, 0, 0], 0.5, 0.18, { mat: M.BRIGHT, seg: hi ? 8 : 5 });
  mb.pop();
}

let _arrays = null;

/**
 * Scalone części (BODY, ARM, PLATE, TORCH) z atrybutem aRdPart = (część, waga emisji palnika) — partia rysuje je
 * jedną geometrią. Wynik zapamiętany (jeden na grę).
 */
export function buildRepairDroneArrays() {
  if (_arrays) return _arrays;
  const hi = true;
  const parts = [];
  const add = (part, fn, weight = 0) => {
    const mb = new MeshBuilder3D({ uvScale: 4 });
    fn(mb, hi);
    parts.push({ part, weight, src: mb.build() });
  };
  add(REPAIR_DRONE_PART.BODY, buildBody);
  add(REPAIR_DRONE_PART.ARM, buildArms);
  add(REPAIR_DRONE_PART.PLATE, buildPlate);
  add(REPAIR_DRONE_PART.TORCH, buildTorchTip, 1);
  let nv = 0, ni = 0;
  for (const p of parts) { nv += p.src.vertexCount; ni += p.src.index.length; }
  const position = new Float32Array(nv * 3), normal = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const mat = new Float32Array(nv), part = new Float32Array(nv * 2);
  const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let v = 0, k = 0;
  let minZ = Infinity, maxZ = -Infinity;
  for (const p of parts) {
    const s = p.src;
    position.set(s.position, v * 3);
    normal.set(s.normal, v * 3);
    uv.set(s.uv, v * 2);
    mat.set(s.mat, v);
    for (let i = 0; i < s.vertexCount; i++) {
      part[(v + i) * 2] = p.part;
      part[(v + i) * 2 + 1] = p.weight;
      const z = s.position[i * 3 + 2];
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    for (let i = 0; i < s.index.length; i++) index[k + i] = s.index[i] + v;
    v += s.vertexCount;
    k += s.index.length;
  }
  _arrays = Object.freeze({
    position, normal, uv, mat, part, index, vertexCount: nv, triangleCount: ni / 3,
    minZ: minZ - REPAIR_DRONE_DIMS.plateDrop, maxZ
  });
  return _arrays;
}

/**
 * Lustro CPU etapu wierzchołków (RepairDroneNodeMaterial): wierzchołek `v` (j. lokalne) części `part` z rekordem
 * instancji `r` od `o` (REPAIR_DRONE_INST_STRIDE liczb, repairDrones3D.js) → pozycja względem początku partii.
 * Rekord: [x, y, z, kurs sceny, skala, ramiona (0..1), płyta (0/1), spaw, …].
 */
export function repairDroneVertexCpu(r, o, part, v, out) {
  const D = REPAIR_DRONE_DIMS;
  const arm = r[o + 5], plate = r[o + 6];
  let x = v[0], y = v[1], z = v[2];
  if (part === REPAIR_DRONE_PART.ARM) z -= arm * D.plateDrop;
  else if (part === REPAIR_DRONE_PART.PLATE) {
    if (plate < 0.5) { x = D.plateX; y = 0; z = D.plateZ; }
    else z -= arm * D.plateDrop;
  }
  const c = Math.cos(r[o + 3]), s = Math.sin(r[o + 3]), K = r[o + 4];
  out.x = (x * c - y * s) * K + r[o];
  out.y = (x * s + y * c) * K + r[o + 1];
  out.z = z * K + r[o + 2];
  return out;
}
