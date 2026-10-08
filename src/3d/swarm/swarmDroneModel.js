// src/3d/swarm/swarmDroneModel.js
//
// BRYŁA DRONA ROJU (klasy S / M / L / Capital z src/data/swarmDrones.js) — geometria w JS
// (MeshBuilder3D z modeli okrętów), działa w przeglądarce i w Node (testy).
//
// Wygląd (decyzja użytkownika 2026-10-05: „w kosmosie wirników nie ma”): wydłużony kadłub
// o przekroju sześciokąta (rufa z blokiem silników, dziób zwężony z wizjerem czujników),
// grzbiet z listwą stanu, dwa / cztery silniki jonowe na rufie, płaskie bloki RCS wtopione
// w barki kadłuba (bez okrągłych gondoli w narożach — z góry nie wyglądają jak wirniki),
// pod spodem płyta złącza. RAMIONA (S, M — 4, L — 6, Capital — 10; 2026-10-06: chwyt płaski,
// ramiona WYSUWANE): wysięgnik barku nad linią gniazd kontenerów, piasta barku, ramię z
// siłownikiem, łokieć, przedramię = tuleja z pasem ostrzegawczym + dwa człony teleskopu,
// słupek chwytaka ze stopką (zamek pojedynczy w narożniku albo belka z dwoma zamkami na styku
// kontenerów) i dwie szczęki.
//
// Wierzchołek niesie aMat (materiał palety, SWARM_DRONE_MAT) i aRig = (ramię, część):
//   część 0 — kadłub (sztywny); 1 — ramię (układ barku: x wzdłuż odcinka, y = oś boczna,
//   z = normalna); 2 — tuleja przedramienia (układ łokcia); 6 / 7 — człony teleskopu (układ
//   łokcia, przesunięte o pół / cały wysuw); 3 — słupek chwytaka (układ nadgarstka w osiach
//   drona: x = dziób, y = lewa burta, z w górę); 4 / 5 — szczęki (układ nadgarstka, zawias na
//   osi x — szczęka obraca się wokół niej o kąt rozwarcia).
// Pozę liczy shader (swarmDrones.tsl.js) z rozłożenia e i zacisku g instancji — lustro CPU:
// swarmArmPose w swarmDrones.js. Geometria ramienia ma PRAWDZIWE długości ramienia (l1) i tulei.
//
// LOD: 'hi' (pełna) i 'lo' (kadłub z kilku płyt + ramiona jako belki — gdy dron ma kilka px).
import { MeshBuilder3D } from '../ships3d/meshBuilder3D.js';
import { SWARM_DRONE_CLASS_LIST } from '../../data/swarmDrones.js';

/** Materiały palety drona (indeks = aMat; barwy i emisja: swarmDrones.tsl.js). */
export const SWARM_DRONE_MAT = Object.freeze({
  HULL: 0,      // ceramika kadłuba (biel)
  FRAME: 1,     // grafit konstrukcji
  DARK: 2,      // czerń dysz i szczelin
  TRIM: 3,      // bursztyn oznaczeń klasy
  STEEL: 4,     // stal ramion i siłowników
  GLASS: 5,     // szkło czujników
  E_STATUS: 6,  // listwa stanu (barwa z fazy lotu)
  E_ENGINE: 7,  // wnętrze dyszy jonowej (moc z ciągu)
  E_VISOR: 8,   // wizjer czujników (cyjan)
  E_WINDOW: 9,  // okna mostka (Capital)
  PANEL: 10,    // jasnoszare płyty
  E_CLAW: 11    // lampki szczęk (bursztyn otwarte / zieleń zamknięte)
});
export const SWARM_DRONE_MAT_COUNT = 12;

export const SWARM_RIG_PART = Object.freeze({ BODY: 0, UPPER: 1, FORE: 2, CLAW: 3, JAW_A: 4, JAW_B: 5, TELE_A: 6, TELE_B: 7 });

const M = SWARM_DRONE_MAT;

// Przekrój kadłuba (sześciokąt w płaszczyźnie y, z): półszerokość w, wysokość h, środek zc.
function hexSection(w, h, zc) {
  const top = zc + h / 2;
  const bot = zc - h / 2;
  const mid = zc + 0.1 * h;
  return [[0.6 * w, top], [w, mid], [0.78 * w, bot], [-0.78 * w, bot], [-w, mid], [-0.6 * w, top]];
}

// Pierścień przekroju w układzie lokalnym alongX (lx = −z, ly = y; lokalne z = x świata).
const ring = (sec) => sec.map(([y, z]) => [-z, y]);

/**
 * Loft kadłuba wzdłuż x: sekcje [{ x, w, h, zc }] od rufy do dziobu, materiały ścian per
 * krawędź przekroju (funkcja indeksu krawędzi), denka na końcach.
 */
function loftHull(mb, sections, matOf, capMats) {
  for (let i = 0; i < sections.length - 1; i++) {
    const a = sections[i];
    const b = sections[i + 1];
    mb.push();
    mb.translate(a.x, 0, 0).rotateY(Math.PI / 2);
    const lower = ring(hexSection(a.w, a.h, a.zc));
    const upper = ring(hexSection(b.w, b.h, b.zc));
    mb.walls(lower, 0, upper, b.x - a.x, (edge) => matOf(edge, i));
    mb.pop();
  }
  // Denka (płaskie wielokąty w płaszczyźnie x = const).
  const capAt = (s, mat, outward) => {
    const pts = hexSection(s.w, s.h, s.zc).map(([y, z]) => [s.x, y, z]);
    mb.face(pts, mat, [outward, 0, 0]);
  };
  capAt(sections[0], capMats[0], -1);
  capAt(sections[sections.length - 1], capMats[1], 1);
}

/** Kadłub (część 0) pełnej szczegółowości. */
function buildBodyHi(mb, cls) {
  const b = cls.body;
  const L = b.L;
  const W = b.W;
  const H = b.H;
  const z0 = b.gap;
  const zc = z0 + 0.5 * H;
  const cap = cls.id === 'C';
  const sections = [
    { x: -0.5 * L, w: 0.4 * W, h: 0.8 * H, zc: z0 + 0.48 * H },
    { x: -0.36 * L, w: 0.5 * W, h: 1.0 * H, zc },
    { x: 0.16 * L, w: 0.48 * W, h: 0.96 * H, zc: z0 + 0.49 * H },
    { x: 0.37 * L, w: 0.36 * W, h: 0.72 * H, zc: z0 + 0.42 * H },
    { x: 0.5 * L, w: 0.2 * W, h: 0.4 * H, zc: z0 + 0.36 * H }
  ];
  // Krawędzie przekroju: 0 górna-prawa burta, 1 dolna-prawa, 2 spód, 3 dolna-lewa, 4 górna-lewa, 5 grzbiet.
  const hullMat = (edge, seg) => {
    if (edge === 2) return M.FRAME;
    if (edge === 1 || edge === 3) return seg === 0 ? M.FRAME : M.PANEL;
    return M.HULL;
  };
  loftHull(mb, sections, hullMat, [M.FRAME, M.FRAME]);

  const top = z0 + H;
  // Grzbiet z listwą stanu.
  mb.box(-0.06 * L, 0, top + 0.05 * H, 0.58 * L, 0.32 * W, 0.12 * H, { mat: M.FRAME, bevel: [0.04 * H, 0.03 * W] });
  mb.box(-0.06 * L, 0, top + 0.115 * H, 0.46 * L, 0.08 * W, 0.022 * H, { mat: M.E_STATUS });
  // Płyty pancerza po bokach grzbietu (jaśniejsze) i bursztynowe znaki klasy przy dziobie.
  for (const s of [1, -1]) {
    mb.box(0.02 * L, s * 0.28 * W, top - 0.005 * H, 0.34 * L, 0.16 * W, 0.05 * H, { mat: M.PANEL });
  }
  const marks = { S: 1, M: 2, L: 3, C: 4 }[cls.id] || 1;
  for (let k = 0; k < marks; k++) {
    const x = 0.27 * L - k * 0.045 * L;
    mb.box(x, 0, top - 0.02 * H, 0.022 * L, 0.36 * W, 0.04 * H, { mat: M.TRIM });
  }
  // Dziób: wizjer czujników (pas cyjanu w czole) i ciemne szkło nad nim.
  mb.box(0.47 * L, 0, z0 + 0.4 * H, 0.05 * L, 0.3 * W, 0.08 * H, { mat: M.E_VISOR });
  mb.box(0.43 * L, 0, z0 + 0.66 * H, 0.08 * L, 0.34 * W, 0.12 * H, { mat: M.GLASS, bevel: [0.03 * H, 0.02 * W] });
  // Rufa: blok silników jonowych (dysze prostokątne, wnętrze świeci przy ciągu).
  const eys = cls.engineCount === 4 ? [0.36, 0.12, -0.12, -0.36] : [0.24, -0.24];
  const ew = cls.engineCount === 4 ? 0.2 * W : 0.3 * W;
  const eh = 0.42 * H;
  const ez = z0 + 0.46 * H;
  for (const y of eys) {
    const yc = y * W;
    // Obudowa dyszy (grafit), wystaje za rufę.
    mb.box(-0.5 * L - 0.02 * L, yc, ez, 0.1 * L, ew, eh, { mat: M.FRAME, bevel: [0.03 * H, 0.02 * W] });
    // Wnętrze (czerń) i płyta emisji w głębi.
    mb.box(-0.5 * L - 0.071 * L, yc, ez, 0.006 * L, ew * 0.78, eh * 0.74, { mat: M.DARK });
    mb.box(-0.5 * L - 0.075 * L, yc, ez, 0.004 * L, ew * 0.62, eh * 0.56, { mat: M.E_ENGINE });
  }
  // Bloki RCS wtopione w barki: płaskie, kanciaste, dysze jako ciemne szczeliny.
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const x = sx * 0.36 * L;
    const y = sy * 0.47 * W;
    mb.box(x, y, z0 + 0.5 * H, 0.1 * L, 0.11 * W, 0.26 * H, { mat: M.FRAME, bevel: [0.03 * H, 0.015 * L] });
    mb.box(x, y + sy * 0.057 * W, z0 + 0.5 * H, 0.06 * L, 0.004 * W, 0.12 * H, { mat: M.DARK });
    mb.box(x + sx * 0.051 * L, y, z0 + 0.5 * H, 0.004 * L, 0.06 * W, 0.12 * H, { mat: M.DARK });
  }
  // Spód: płyta złącza i zaczep haka.
  mb.box(0, 0, z0 - 0.03 * H, 0.5 * L, 0.42 * W, 0.06 * H, { mat: M.FRAME });
  mb.box(0, 0, z0 - 0.1 * H, 0.12 * L, 0.16 * W, 0.1 * H, { mat: M.STEEL });
  // Maszt anteny nad rufą.
  mb.box(-0.42 * L, 0, top + 0.12 * H, 0.012 * L, 0.012 * L, 0.24 * H, { mat: M.STEEL });
  // Obudowy barków (zawiasy ramion) — na wysięgnikach nad linią gniazd kontenerów.
  for (const a of cls.arms) addShoulderMount(mb, cls, a, true);
  if (cap) {
    // Capital: nadbudówka dowodzenia z oknami i dwa dodatkowe pasy świateł wzdłuż grzbietu.
    mb.box(0.22 * L, 0, top + 0.13 * H, 0.16 * L, 0.36 * W, 0.24 * H, { mat: M.HULL, bevel: [0.06 * H, 0.03 * W] });
    mb.box(0.3 * L, 0, top + 0.17 * H, 0.006 * L, 0.26 * W, 0.07 * H, { mat: M.E_WINDOW });
    for (const s of [1, -1]) {
      mb.box(0.22 * L, s * 0.181 * W, top + 0.17 * H, 0.1 * L, 0.004 * W, 0.06 * H, { mat: M.E_WINDOW });
      mb.box(-0.12 * L, s * 0.2 * W, top + 0.03 * H, 0.36 * L, 0.03 * W, 0.04 * H, { mat: M.E_STATUS });
    }
  }
}

/** Kadłub LOD 'lo': loft trzech sekcji + listwa stanu. */
function buildBodyLo(mb, cls) {
  const b = cls.body;
  const z0 = b.gap;
  const sections = [
    { x: -0.5 * b.L, w: 0.42 * b.W, h: 0.85 * b.H, zc: z0 + 0.48 * b.H },
    { x: 0.2 * b.L, w: 0.5 * b.W, h: b.H, zc: z0 + 0.5 * b.H },
    { x: 0.5 * b.L, w: 0.22 * b.W, h: 0.45 * b.H, zc: z0 + 0.38 * b.H }
  ];
  loftHull(mb, sections, (edge) => (edge === 2 ? M.FRAME : M.HULL), [M.E_ENGINE, M.E_VISOR]);
  mb.box(-0.06 * b.L, 0, z0 + b.H + 0.04 * b.H, 0.46 * b.L, 0.1 * b.W, 0.06 * b.H, { mat: M.E_STATUS });
  for (const a of cls.arms) addShoulderMount(mb, cls, a, false);
}

/** Wysięgnik barku (od burty kadłuba do linii gniazd) i obudowa zawiasu. */
function addShoulderMount(mb, cls, a, hi) {
  const b = cls.body;
  const beam = cls.armBeam;
  const [x, y, z] = a.shoulder;
  const sy = Math.sign(y) || 1;
  const half = 0.5 * b.W;
  const out = Math.abs(y) - half;
  if (out > 0.05) {
    // Belka wysięgnika z kadłuba (wchodzi w burtę), grafit; na wierzchu bursztynowy znak.
    mb.box(x, sy * (half + out / 2 - 0.15 * half), z, 1.5 * beam, out + 0.3 * half, 1.1 * beam, { mat: M.FRAME, bevel: hi ? [0.15 * beam, 0.1 * beam] : 0 });
    if (hi) mb.box(x, sy * (half + out * 0.55), z + 0.56 * beam, 0.9 * beam, out * 0.5, 0.04 * beam, { mat: M.TRIM });
  }
  mb.box(x, y, z, 2.2 * beam, 1.2 * beam, 2.0 * beam, { mat: M.FRAME, bevel: hi ? [0.25 * beam, 0.2 * beam] : 0 });
}

/**
 * Ramię (części 1–7) w układach lokalnych przegubów; prawdziwe długości ramienia (l1) i tulei.
 * Teleskop (tylko ramiona z wysuwem): dwa człony długości ~0,55 wysuwu + zakładka, przy e = 0 schowane
 * w tulei (kończą się na jej końcu); shader przesuwa pierwszy o pół wysuwu, drugi o cały.
 */
function buildArm(mb, cls, arm, hi) {
  const beam = cls.armBeam;
  const claw = cls.clawLen;
  const parts = [];
  const part = (id, fn) => {
    const sub = new MeshBuilder3D();
    fn(sub);
    parts.push({ id, sub });
  };
  // 1 — ramię: piasta barku (oś y), belka, siłownik nad belką, piasta łokcia.
  part(1, (m) => {
    m.box(arm.l1 * 0.5, 0, 0, arm.l1 + 0.3 * beam, beam * 0.82, beam, { mat: M.HULL, bevel: hi ? [0.12 * beam, 0.1 * beam] : 0 });
    if (hi) {
      m.cylinder([0, -0.55 * beam, 0], [0, 0.55 * beam, 0], 0.62 * beam, 0.62 * beam, { mat: M.FRAME, seg: 8 });
      m.cylinder([0.12 * arm.l1, 0, 0.7 * beam], [0.78 * arm.l1, 0, 0.62 * beam], 0.2 * beam, 0.2 * beam, { mat: M.STEEL, seg: 6 });
      m.box(0.5 * arm.l1, 0, -0.52 * beam, 0.5 * arm.l1, 0.5 * beam, 0.06 * beam, { mat: M.FRAME });
    }
  });
  const sleeve = arm.sleeve;
  const tele = arm.ext > 1e-3;
  // 2 — tuleja przedramienia: piasta łokcia, belka, pas ostrzegawczy przy wylocie (teleskop) albo
  // przy nadgarstku (ramię bez wysuwu).
  part(2, (m) => {
    m.box(sleeve * 0.5, 0, 0, sleeve + 0.2 * beam, beam * 0.78, beam * 0.86, { mat: M.STEEL, bevel: hi ? [0.1 * beam, 0.08 * beam] : 0 });
    if (hi) {
      m.cylinder([0, -0.5 * beam, 0], [0, 0.5 * beam, 0], 0.52 * beam, 0.52 * beam, { mat: M.FRAME, seg: 8 });
      m.box(sleeve * 0.9, 0, 0, 0.12 * sleeve, beam * 0.84, beam * 0.92, { mat: M.TRIM });
    }
  });
  if (tele) {
    // 6 / 7 — człony teleskopu (cieńsze, jaśniejsze): koniec drugiego = nadgarstek przy pełnym wysuwie.
    const stage = Math.min(0.96 * sleeve, 0.55 * arm.ext + 0.6 * beam);
    part(6, (m) => {
      m.box(sleeve - stage / 2, 0, 0, stage, beam * 0.6, beam * 0.66, { mat: M.PANEL, bevel: hi ? [0.06 * beam, 0.05 * beam] : 0 });
      if (hi) m.box(sleeve - 0.04 * stage, 0, 0, 0.08 * stage, beam * 0.66, beam * 0.72, { mat: M.FRAME });
    });
    part(7, (m) => {
      m.box(sleeve - stage / 2, 0, 0, stage, beam * 0.44, beam * 0.5, { mat: M.STEEL, bevel: hi ? [0.05 * beam, 0.04 * beam] : 0 });
      if (hi) m.box(sleeve - 0.06 * stage, 0, 0, 0.12 * stage, beam * 0.5, beam * 0.56, { mat: M.TRIM });
    });
  }
  // 3 — słupek chwytaka ze stopką: zamek pojedynczy (narożnik) albo belka z dwoma zamkami (styk
  // dwóch kontenerów — gniazda obu po bokach szczeliny), lampka na zewnętrznej burcie.
  const twin = arm.twin;
  const footL = twin > 0 ? twin + 1.1 * beam : 1.25 * beam;
  const out = Math.sign(arm.shoulder[1]) || 1;
  part(3, (m) => {
    m.box(0, 0, -0.42 * claw, 0.85 * beam, 0.85 * beam, 0.84 * claw, { mat: M.FRAME });
    m.box(0, 0, -claw + 0.06 * beam, footL, 1.25 * beam, 0.16 * beam, { mat: M.STEEL });
    if (hi) {
      // Czopy zamków (obrotowe) pod stopką.
      const pins = twin > 0 ? [-twin / 2, twin / 2] : [0];
      for (const px of pins) m.box(px, 0, -claw - 0.05 * beam, 0.36 * beam, 0.36 * beam, 0.1 * beam, { mat: M.DARK });
      m.box(0, out * 0.44 * beam, -0.18 * claw, 0.5 * beam, 0.04 * beam, 0.16 * claw, { mat: M.E_CLAW });
    }
  });
  // 4 / 5 — szczęki po obu stronach (oś y drona), zawias na wysokości −0,47 claw; długie na belce podwójnej.
  for (const [id, s] of [[4, 1], [5, -1]]) {
    part(id, (m) => {
      m.box(0, s * 0.62 * beam, -0.78 * claw, footL * 0.92, 0.18 * beam, 0.62 * claw, { mat: M.STEEL });
      if (hi) m.box(0, s * 0.62 * beam, -1.06 * claw, footL * 0.92, 0.34 * beam, 0.08 * claw, { mat: M.DARK });
    });
  }
  for (const { id, sub } of parts) mb.parts.push({ arm: arm.index, part: id, build: sub.build() });
}

/** Scala części w jedną geometrię z atrybutami position, normal, aMat, aRig (THREE wstrzykiwany). */
function mergeParts(THREE, parts) {
  let vc = 0;
  let ic = 0;
  for (const p of parts) { vc += p.build.vertexCount; ic += p.build.index.length; }
  const pos = new Float32Array(vc * 3);
  const nrm = new Float32Array(vc * 3);
  const mat = new Float32Array(vc);
  const rig = new Float32Array(vc * 2);
  const idx = vc > 65535 ? new Uint32Array(ic) : new Uint16Array(ic);
  let vo = 0;
  let io = 0;
  for (const p of parts) {
    const d = p.build;
    pos.set(d.position, vo * 3);
    nrm.set(d.normal, vo * 3);
    mat.set(d.mat, vo);
    for (let i = 0; i < d.vertexCount; i++) { rig[(vo + i) * 2] = p.arm; rig[(vo + i) * 2 + 1] = p.part; }
    for (let i = 0; i < d.index.length; i++) idx[io + i] = d.index[i] + vo;
    vo += d.vertexCount;
    io += d.index.length;
  }
  if (!THREE) return { position: pos, normal: nrm, mat, rig, index: idx, vertexCount: vc, triangleCount: ic / 3 };
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('aMat', new THREE.BufferAttribute(mat, 1));
  g.setAttribute('aRig', new THREE.BufferAttribute(rig, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.userData.vertexCount = vc;
  g.userData.triangleCount = ic / 3;
  return g;
}

/**
 * Geometria drona klasy (obiekt z swarmDroneClass): lod 'hi' albo 'lo'. Bez THREE zwraca
 * surowe tablice (testy w Node), z THREE — BufferGeometry.
 */
export function buildSwarmDroneGeometry(cls, lod = 'hi', THREE = null) {
  const hi = lod !== 'lo';
  const body = new MeshBuilder3D();
  if (hi) buildBodyHi(body, cls);
  else buildBodyLo(body, cls);
  const acc = { parts: [{ arm: 0, part: 0, build: body.build() }] };
  for (const arm of cls.arms) buildArm(acc, cls, arm, hi);
  return mergeParts(THREE, acc.parts);
}

/** Geometrie wszystkich klas: { S: { hi, lo }, M: …, L: …, C: … } (BufferGeometry). */
export function buildSwarmDroneGeometries(THREE) {
  const out = {};
  for (const cls of SWARM_DRONE_CLASS_LIST) {
    out[cls.id] = { hi: buildSwarmDroneGeometry(cls, 'hi', THREE), lo: buildSwarmDroneGeometry(cls, 'lo', THREE) };
  }
  return out;
}
