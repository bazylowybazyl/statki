/**
 * beamBody3D — konstrukcja WĘZŁÓW i TYPOWANYCH BELEK z wokselizacji modelu.
 *
 * Zastępuje model „komórka z punktami HP i sześcioma sąsiadami" modelem rodem
 * z BeamNG: masy punktowe połączone belkami, z których każda ma własną sztywność,
 * próg odkształcenia plastycznego i próg zerwania.
 *
 * Dwa powody, dla których stara kratownica źle się miażdżyła:
 *  1. Sprężyny szły wyłącznie wzdłuż osi — sześcian ośmiu węzłów mógł złożyć się
 *     w romb bez żadnego oporu (zerowa sztywność na ścinanie). Tu każdy węzeł
 *     dostaje też przekątne ścienne, więc powłoka jest TRIANGULOWANA.
 *  2. Nie było hierarchii: poszycie i konstrukcja nośna miały tę samą wytrzymałość.
 *     Tu mamy poszycie, wręgi i grodzie z różnymi progami — i to grodzie decydują,
 *     że kadłub pęka na SEKCJE, a nie na okruchy.
 *
 * Wokselizacja zostaje jako źródło kształtu — z niej wynika, gdzie postawić węzły.
 * Nie zostaje jako sposób renderowania ani jako model zniszczeń.
 */

import { packKey, invertSymmetric3, bindSkinToLattice } from './voxelBody3D.js';

export const BEAM_TYPE = Object.freeze({
  PLATING: 0,   // poszycie: powłoka zewnętrzna, pęka pierwsza
  INTERIOR: 1,  // wypełnienie/konstrukcja wewnętrzna tam, gdzie bryła jest gruba
  FRAME: 2,     // wręg: strut łączący przeciwległe ściany, trzyma przekrój
  BULKHEAD: 3   // gródź: usztywniona przegroda, granica sekcji kadłuba
});

export const BEAM_PRESETS = Object.freeze({
  [BEAM_TYPE.PLATING]: { stiffness: 0.55, deform: 0.09, break: 0.34, mass: 1.0 },
  [BEAM_TYPE.INTERIOR]: { stiffness: 0.62, deform: 0.11, break: 0.42, mass: 1.0 },
  [BEAM_TYPE.FRAME]: { stiffness: 0.86, deform: 0.05, break: 0.58, mass: 1.4 },
  [BEAM_TYPE.BULKHEAD]: { stiffness: 0.94, deform: 0.04, break: 0.78, mass: 1.8 }
});

// 6 osi + 12 przekątnych ściennych. Przekątne to cała różnica między powłoką,
// która trzyma kształt, a workiem, który składa się przy pierwszym dotknięciu.
const NEIGHBOR_DIRS_18 = Object.freeze([
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  [1, 1, 0], [1, -1, 0], [-1, 1, 0], [-1, -1, 0],
  [1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1],
  [0, 1, 1], [0, 1, -1], [0, -1, 1], [0, -1, -1]
]);

const AXIS_DIRS_6 = Object.freeze([
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]
]);

function makeNode(cell, index, cellMassBase) {
  const mass = cellMassBase * cell.coverage;
  return {
    id: index,
    ix: cell.ix, iy: cell.iy, iz: cell.iz,
    // Pozycja SPOCZYNKOWA i BIEŻĄCA — to jest cały stan węzła. Nie ma osobnej
    // „deformacji wizualnej" ani „zapieczonego przesunięcia": plastyczność siedzi
    // w długościach spoczynkowych belek, a nie w dodatkowych polach węzła.
    ox: cell.x, oy: cell.y, oz: cell.z,
    x: cell.x, y: cell.y, z: cell.z,
    px: cell.x, py: cell.y, pz: cell.z,   // pozycja z poprzedniego kroku (prędkość PBD)
    vx: 0, vy: 0, vz: 0,
    mass,
    invMass: mass > 0 ? 1 / mass : 0,
    hp: 80 * cell.coverage,
    maxHp: 80 * cell.coverage,
    surface: !!cell.surface,
    depth: cell.depth,
    coverage: cell.coverage,
    r: cell.r, g: cell.g, b: cell.b,
    beams: [],
    beamCount: 0,       // ile belek miał węzeł w nietkniętej konstrukcji
    platingCount: 0,    // ile z nich to poszycie (do progu „dziura w kadłubie")
    active: true,
    __islandStamp: 0
  };
}

function beamKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Buduje konstrukcję nośną z wyniku voxelizeTriangles.
 *
 * Kolejność ma znaczenie: najpierw powłoka (poszycie + wnętrze), potem wręgi
 * łączące przeciwległe ściany, na końcu grodzie usztywniające wybrane przekroje.
 */
export function buildBeamStructure(vox, opts = {}) {
  const cellMassBase = Number.isFinite(opts.cellMassBase) ? opts.cellMassBase : 10;
  const frameStride = Math.max(1, opts.frameStride === undefined ? 2 : (opts.frameStride | 0));
  const bulkheadEvery = Math.max(0, opts.bulkheadEvery === undefined ? 8 : (opts.bulkheadEvery | 0));
  const maxFrameSpan = Math.max(2, opts.maxFrameSpan === undefined ? 14 : (opts.maxFrameSpan | 0));

  const cells = vox.cells;
  if (!Array.isArray(cells) || cells.length === 0) throw new Error('buildBeamStructure: brak komórek');

  const nodes = cells.map((c, i) => makeNode(c, i, cellMassBase));
  const lattice = new Map();
  for (const n of nodes) lattice.set(packKey(n.ix, n.iy, n.iz), n);

  const beams = [];
  const seen = new Set();

  const addBeam = (a, b, type) => {
    if (a === b) return null;
    const key = beamKey(a.id, b.id);
    if (seen.has(key)) return null;
    seen.add(key);
    const dx = b.ox - a.ox, dy = b.oy - a.oy, dz = b.oz - a.oz;
    const rest = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (rest < 1e-6) return null;
    const preset = BEAM_PRESETS[type];
    const beam = {
      a: a.id,
      b: b.id,
      rest,
      restBase: rest,
      type,
      stiffness: preset.stiffness,
      deform: preset.deform,
      break: preset.break,
      broken: false,
      strain: 0
    };
    const index = beams.length;
    beams.push(beam);
    a.beams.push(index);
    b.beams.push(index);
    if (type === BEAM_TYPE.PLATING) {
      a.platingCount++;
      b.platingCount++;
    }
    return beam;
  };

  // --- 1) POWŁOKA: sąsiedztwo 18-kierunkowe (osie + przekątne ścienne) ---
  for (const node of nodes) {
    for (const dir of NEIGHBOR_DIRS_18) {
      const other = lattice.get(packKey(node.ix + dir[0], node.iy + dir[1], node.iz + dir[2]));
      if (!other) continue;
      const type = (node.surface && other.surface) ? BEAM_TYPE.PLATING : BEAM_TYPE.INTERIOR;
      addBeam(node, other, type);
    }
  }

  // --- 2) WRĘGI: struty przez wnętrze, od ściany do ściany przeciwległej ---
  // Dla cienkościennej bryły (a taka jest większość statków i stacji) to JEDYNA
  // rzecz, która nie pozwala spłaszczyć przekroju. Bez nich rura zgniata się
  // jak kartka, bo poszycie samo w sobie nie ma o co się oprzeć.
  let frameCount = 0;
  for (const node of nodes) {
    if (!node.surface) continue;
    if ((node.id % frameStride) !== 0) continue;

    // normalna zewnętrzna = suma kierunków, w których brakuje sąsiada
    let ox = 0, oy = 0, oz = 0;
    for (const dir of AXIS_DIRS_6) {
      if (!lattice.get(packKey(node.ix + dir[0], node.iy + dir[1], node.iz + dir[2]))) {
        ox += dir[0]; oy += dir[1]; oz += dir[2];
      }
    }
    const len = Math.sqrt(ox * ox + oy * oy + oz * oz);
    if (len < 1e-6) continue;
    const inx = -ox / len, iny = -oy / len, inz = -oz / len;

    // marsz do wnętrza aż do pierwszej ściany po drugiej stronie
    for (let step = 2; step <= maxFrameSpan; step++) {
      const tx = Math.round(node.ix + inx * step);
      const ty = Math.round(node.iy + iny * step);
      const tz = Math.round(node.iz + inz * step);
      const target = lattice.get(packKey(tx, ty, tz));
      if (!target || !target.surface) continue;
      if (addBeam(node, target, BEAM_TYPE.FRAME)) frameCount++;
      break;
    }
  }

  // --- 3) GRODZIE: usztywnione przekroje wzdłuż najdłuższej osi ---
  // Gródź to granica sekcji. Cięcie MIĘDZY grodziami odrywa segment; cięcie
  // PRZEZ gródź wymaga znacznie więcej energii. Stąd bierze się przecinanie
  // kadłuba na połowy zamiast rozsypywania go na okruchy.
  let minI = Infinity, maxI = -Infinity, minJ = Infinity, maxJ = -Infinity, minK = Infinity, maxK = -Infinity;
  for (const n of nodes) {
    if (n.ix < minI) minI = n.ix; if (n.ix > maxI) maxI = n.ix;
    if (n.iy < minJ) minJ = n.iy; if (n.iy > maxJ) maxJ = n.iy;
    if (n.iz < minK) minK = n.iz; if (n.iz > maxK) maxK = n.iz;
  }
  const spans = [maxI - minI, maxJ - minJ, maxK - minK];
  const axis = spans.indexOf(Math.max(...spans));
  const axisMin = [minI, minJ, minK][axis];
  const axisOf = (n) => (axis === 0 ? n.ix : axis === 1 ? n.iy : n.iz);

  let bulkheadCount = 0;
  if (bulkheadEvery > 0) {
    const slabs = new Map();
    for (const n of nodes) {
      const station = axisOf(n) - axisMin;
      if (station % bulkheadEvery !== 0) continue;
      let list = slabs.get(station);
      if (!list) { list = []; slabs.set(station, list); }
      list.push(n);
    }
    // W obrębie przekroju łączymy każdy węzeł z kilkoma najbliższymi — powstaje
    // sztywna tarcza zamiast luźnego pierścienia.
    for (const [, list] of slabs) {
      if (list.length < 3) continue;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        const cand = [];
        for (let j = 0; j < list.length; j++) {
          if (i === j) continue;
          const b = list[j];
          const dx = b.ox - a.ox, dy = b.oy - a.oy, dz = b.oz - a.oz;
          cand.push([dx * dx + dy * dy + dz * dz, j]);
        }
        cand.sort((p, q) => p[0] - q[0]);
        for (let c = 0; c < Math.min(4, cand.length); c++) {
          if (addBeam(a, list[cand[c][1]], BEAM_TYPE.BULKHEAD)) bulkheadCount++;
        }
      }
    }
  }

  for (const node of nodes) node.beamCount = node.beams.length;

  // --- 4) Środek masy, tensor, promień ---
  let comX = 0, comY = 0, comZ = 0, mSum = 0;
  for (const n of nodes) {
    comX += n.ox * n.mass; comY += n.oy * n.mass; comZ += n.oz * n.mass;
    mSum += n.mass;
  }
  comX /= mSum; comY /= mSum; comZ /= mSum;

  for (const n of nodes) {
    n.ox -= comX; n.oy -= comY; n.oz -= comZ;
    n.x -= comX; n.y -= comY; n.z -= comZ;
    n.px = n.x; n.py = n.y; n.pz = n.z;
  }

  const cs = vox.cellSize;
  const cubeTerm = (cs * cs) / 6;
  let ixx = 0, iyy = 0, izz = 0, ixy = 0, ixz = 0, iyz = 0;
  let radius = 0;
  for (const n of nodes) {
    const m = n.mass;
    ixx += m * (n.oy * n.oy + n.oz * n.oz + cubeTerm);
    iyy += m * (n.ox * n.ox + n.oz * n.oz + cubeTerm);
    izz += m * (n.ox * n.ox + n.oy * n.oy + cubeTerm);
    ixy -= m * n.ox * n.oy;
    ixz -= m * n.ox * n.oz;
    iyz -= m * n.oy * n.oz;
    const d = Math.sqrt(n.ox * n.ox + n.oy * n.oy + n.oz * n.oz);
    if (d > radius) radius = d;
  }
  const inertia = [ixx, ixy, ixz, ixy, iyy, iyz, ixz, iyz, izz];

  // --- 5) Skóra ---
  // Wiązanie wierzchołek → komórka liczymy w przestrzeni SPRZED recentrowania
  // (tam żyje vox.origin), a potem przesuwamy wierzchołki o ten sam wektor co węzły.
  // Węzły zachowują indeksy kratownicy, więc mapowanie działa też po rozłamie.
  let skin = null;
  const skinParts = opts.skinParts;
  if (Array.isArray(skinParts) && skinParts.length > 0) {
    const bindInfo = bindSkinToLattice(skinParts, cells, {
      nx: vox.nx, ny: vox.ny, nz: vox.nz, cellSize: cs, origin: vox.origin
    });

    const shifted = new Set();
    for (const part of skinParts) {
      if (shifted.has(part.positions)) continue;
      shifted.add(part.positions);
      const p = part.positions;
      for (let i = 0; i < p.length; i += 3) {
        p[i] -= comX; p[i + 1] -= comY; p[i + 2] -= comZ;
      }
    }

    let vertexCount = 0;
    let triangleCount = 0;
    const counted = new Set();
    for (const part of skinParts) {
      triangleCount += part.indices.length / 3;
      if (counted.has(part.positions)) continue;
      counted.add(part.positions);
      vertexCount += part.positions.length / 3;
    }

    // Trzy stany maski dziur — bez „komórki tu nigdy nie było" wrak nie odróżnia
    // własnej krawędzi rozłamu od pustki poza kadłubem.
    const occupancy = new Uint8Array(vox.nx * vox.ny * vox.nz);
    for (const c of cells) occupancy[c.ix + c.iy * vox.nx + c.iz * vox.nx * vox.ny] = 1;

    skin = {
      parts: skinParts,
      occupancy,
      dims: { x: vox.nx, y: vox.ny, z: vox.nz },
      vertexCount,
      triangleCount,
      unbound: bindInfo.unbound
    };
  }

  return {
    nodes,
    beams,
    lattice,
    dims: { x: vox.nx, y: vox.ny, z: vox.nz },
    cellSize: cs,
    latticeMin: { x: vox.origin.x - comX, y: vox.origin.y - comY, z: vox.origin.z - comZ },
    com: { x: comX, y: comY, z: comZ },
    mass: mSum,
    inertia,
    invInertia: invertSymmetric3(inertia),
    radius: radius + cs,
    skin,
    stats: {
      nodes: nodes.length,
      beams: beams.length,
      plating: beams.filter((b) => b.type === BEAM_TYPE.PLATING).length,
      interior: beams.filter((b) => b.type === BEAM_TYPE.INTERIOR).length,
      frames: frameCount,
      bulkheads: bulkheadCount
    }
  };
}

/**
 * Przelicza tensor bezwładności i masę dla podzbioru węzłów (po rozłamie).
 * Zwraca też środek masy w układzie rodzica.
 */
export function computeNodeSetInertia(nodes, cellSize) {
  let comX = 0, comY = 0, comZ = 0, mSum = 0;
  for (const n of nodes) {
    comX += n.ox * n.mass; comY += n.oy * n.mass; comZ += n.oz * n.mass;
    mSum += n.mass;
  }
  if (mSum <= 0) return null;
  comX /= mSum; comY /= mSum; comZ /= mSum;

  const cubeTerm = (cellSize * cellSize) / 6;
  let ixx = 0, iyy = 0, izz = 0, ixy = 0, ixz = 0, iyz = 0;
  for (const n of nodes) {
    const m = n.mass;
    const px = n.ox - comX, py = n.oy - comY, pz = n.oz - comZ;
    ixx += m * (py * py + pz * pz + cubeTerm);
    iyy += m * (px * px + pz * pz + cubeTerm);
    izz += m * (px * px + py * py + cubeTerm);
    ixy -= m * px * py;
    ixz -= m * px * pz;
    iyz -= m * py * pz;
  }
  const inertia = [ixx, ixy, ixz, ixy, iyy, iyz, ixz, iyz, izz];
  return { com: { x: comX, y: comY, z: comZ }, mass: mSum, inertia, invInertia: invertSymmetric3(inertia) };
}
