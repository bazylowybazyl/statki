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
import { markOriginalBeamBridges } from './beamConnectivity3D.js';
import { packBeamStructure, defineLazyViews } from './beamStore3D.js';

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
    localBeamCount: 0,  // pierwotne mocowanie do poszycia; nie resetować po podziale
    platingCount: 0,    // ile z nich to poszycie (do progu „dziura w kadłubie")
    active: true,
    __islandStamp: 0,
    // Wszystkie pola gorącej ścieżki powstają od razu, bez zmiany układu
    // obiektu podczas pierwszego kontaktu, hashowania lub zgniotu.
    _hashNext: null,
    _massStamp: 0,
    _crushStamp: 0,
    _crushDepth: 0,
    // Obszar aktywny solvera lokalnego (beamActiveRegion3D): w ruchu / kroki spokoju / stemple.
    _act: 0,
    _quiet: 0,
    _solveStamp: 0,
    _outerStamp: 0,
    _skinDirty: 0
  };
}

// Keep an explicit, consistent numeric layout for all cloned nodes and beams,
// including fragments created after the first collision.
export function cloneBeamNode(n) {
  return {
    id: n.id, ix: n.ix, iy: n.iy, iz: n.iz,
    ox: n.ox, oy: n.oy, oz: n.oz,
    x: n.x, y: n.y, z: n.z, px: n.px, py: n.py, pz: n.pz,
    vx: n.vx, vy: n.vy, vz: n.vz,
    mass: n.mass, invMass: n.invMass, hp: n.hp, maxHp: n.maxHp,
    surface: n.surface, depth: n.depth, coverage: n.coverage,
    r: n.r, g: n.g, b: n.b, beams: n.beams.slice(),
    beamCount: n.beamCount, localBeamCount: n.localBeamCount, platingCount: n.platingCount, active: n.active,
    __islandStamp: 0, _hashNext: null, _massStamp: 0, _crushStamp: 0, _crushDepth: 0,
    _act: n._act || 0, _quiet: n._quiet || 0, _solveStamp: 0, _outerStamp: 0, _skinDirty: 0
  };
}

export function cloneBeam(beam, a = beam.a, b = beam.b) {
  return {
    a, b, rest: beam.rest, restBase: beam.restBase, type: beam.type,
    stiffness: beam.stiffness, deform: beam.deform, break: beam.break,
    broken: beam.broken, strain: beam.strain, fatigue: beam.fatigue || 0, restBridge: beam.restBridge,
    _stamp: 0
  };
}

function beamKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// DDA od środka do środka komórki: sprawdza każdą komórkę przeciętą przez belkę.
// Próbkowanie co jedną komórkę potrafi przeskoczyć wąską szczelinę po skosie.
// Przy przejściu przez samą krawędź/narożnik przesuwamy wszystkie osie naraz.
function staysInsideHull(a, b, isSolid) {
  let x = a.ix, y = a.iy, z = a.iz;
  const dx = b.ix - x, dy = b.iy - y, dz = b.iz - z;
  const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
  const dtX = dx === 0 ? Infinity : 1 / Math.abs(dx);
  const dtY = dy === 0 ? Infinity : 1 / Math.abs(dy);
  const dtZ = dz === 0 ? Infinity : 1 / Math.abs(dz);
  let tx = dtX * 0.5, ty = dtY * 0.5, tz = dtZ * 0.5;
  while (x !== b.ix || y !== b.iy || z !== b.iz) {
    const t = Math.min(tx, ty, tz) + 1e-10;
    if (tx <= t) { x += sx; tx += dtX; }
    if (ty <= t) { y += sy; ty += dtY; }
    if (tz <= t) { z += sz; tz += dtZ; }
    if (!isSolid(x, y, z)) return false;
  }
  return true;
}

/**
 * Buduje konstrukcję nośną z wyniku voxelizeTriangles.
 *
 * Kolejność ma znaczenie: najpierw powłoka (poszycie + wnętrze), potem wręgi
 * łączące przeciwległe ściany, na końcu grodzie usztywniające wybrane przekroje.
 */
export function buildBeamStructure(vox, opts = {}) {
  const cellMassBase = Number.isFinite(opts.cellMassBase) ? opts.cellMassBase : 10;
  // 0 = bez wręgów (porównanie w demie 2D); domyślnie co drugi węzeł poszycia.
  const frameStride = opts.frameStride === 0 ? 0 : Math.max(1, opts.frameStride === undefined ? 2 : (opts.frameStride | 0));
  const bulkheadEvery = Math.max(0, opts.bulkheadEvery === undefined ? 8 : (opts.bulkheadEvery | 0));
  const maxFrameSpan = Math.max(2, opts.maxFrameSpan === undefined ? 14 : (opts.maxFrameSpan | 0));
  // Osie, wzdłuż których wolno prowadzić wręgi (maska x, y, z). Kadłub 2D ma wręgi
  // tylko w poprzek (oś Y) — z narożnika obrysu szłyby ukośnie przez cały kadłub.
  const frameAxes = Array.isArray(opts.frameAxes) ? opts.frameAxes : [1, 1, 1];
  // Wręg kończy się dopiero na przeciwległej ścianie (za celem już pusto) —
  // w pełnej płycie 2D obrys dziobu leży w tej samej kolumnie co burta.
  const frameToOppositeWall = !!opts.frameToOppositeWall;

  const cells = vox.cells;
  if (!Array.isArray(cells) || cells.length === 0) throw new Error('buildBeamStructure: brak komórek');

  const nodes = cells.map((c, i) => makeNode(c, i, cellMassBase));
  const lattice = new Map();
  for (const n of nodes) lattice.set(packKey(n.ix, n.iy, n.iz), n);
  const isSolid = (x, y, z) => {
    if (x < 0 || x >= vox.nx || y < 0 || y >= vox.ny || z < 0 || z >= vox.nz) return false;
    // Starsze/ręczne wejście bez maski: nie wymyślaj wnętrza w brakujących komórkach.
    return vox.solidMask ? vox.solidMask[x + y * vox.nx + z * vox.nx * vox.ny] !== 0
      : lattice.has(packKey(x, y, z));
  };

  const beams = [];
  const seen = new Set();

  const addBeam = (a, b, type) => {
    if (a === b) return null;
    const key = beamKey(a.id, b.id);
    if (seen.has(key)) return null;
    // Wręgi i grodzie wzmacniają bryłę, ale nie mogą tworzyć niewidocznych
    // mostów między pokładami przez otwartą przestrzeń. Tylko podczas budowy.
    if (type >= BEAM_TYPE.FRAME && !staysInsideHull(a, b, isSolid)) return null;
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
      strain: 0,
      fatigue: 0,
      restBridge: false,
      _stamp: 0
    };
    const index = beams.length;
    beams.push(beam);
    a.beams.push(index);
    b.beams.push(index);
    if (type < BEAM_TYPE.FRAME) { a.localBeamCount++; b.localBeamCount++; }
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
    if (!frameStride || !node.surface) continue;
    if ((node.id % frameStride) !== 0) continue;

    // normalna zewnętrzna = suma kierunków, w których brakuje sąsiada
    let ox = 0, oy = 0, oz = 0;
    for (const dir of AXIS_DIRS_6) {
      if (!lattice.get(packKey(node.ix + dir[0], node.iy + dir[1], node.iz + dir[2]))) {
        ox += dir[0]; oy += dir[1]; oz += dir[2];
      }
    }
    ox *= frameAxes[0]; oy *= frameAxes[1]; oz *= frameAxes[2];
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
      if (frameToOppositeWall && lattice.get(packKey(
        Math.round(node.ix + inx * (step + 1)), Math.round(node.iy + iny * (step + 1)), Math.round(node.iz + inz * (step + 1))))) continue;
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
  markOriginalBeamBridges(nodes, beams);

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
      cellSize: cs,
      latticeMin: { x: vox.origin.x - comX, y: vox.origin.y - comY, z: vox.origin.z - comZ },
      supportEdges: new Uint32Array(beams.length * 2),
      dims: { x: vox.nx, y: vox.ny, z: vox.nz },
      vertexCount,
      triangleCount,
      unbound: bindInfo.unbound
    };
    for (let i = 0; i < beams.length; i++) {
      const a = nodes[beams[i].a], b = nodes[beams[i].b];
      skin.supportEdges[i * 2] = a.ix + a.iy * vox.nx + a.iz * vox.nx * vox.ny;
      skin.supportEdges[i * 2 + 1] = b.ix + b.iy * vox.nx + b.iz * vox.nx * vox.ny;
    }
  }

  // Budowa idzie na obiektach (raz na model); ciało dostaje magazyny SoA, a `nodes` /
  // `beams` to widoki na żądanie (defineLazyViews) — widoki węzłów już są, bo trzyma je kratownica.
  const packed = packBeamStructure(nodes, beams);
  for (const [key, n] of lattice) lattice.set(key, packed.nodes[n.id]);

  return defineLazyViews({
    nodeStore: packed.nodeStore,
    beamStore: packed.beamStore,
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
  }, packed.nodes);
}

/**
 * computeNodeSetInertia dla wszystkich węzłów magazynu SoA (sekcja po rozłamie) —
 * te same działania w tej samej kolejności, więc wynik bit w bit jak na obiektach.
 */
export function computeStoreInertia(store, cellSize) {
  const count = store.count, ox = store.ox, oy = store.oy, oz = store.oz, mass = store.mass;
  let comX = 0, comY = 0, comZ = 0, mSum = 0;
  for (let i = 0; i < count; i++) {
    comX += ox[i] * mass[i]; comY += oy[i] * mass[i]; comZ += oz[i] * mass[i];
    mSum += mass[i];
  }
  if (mSum <= 0) return null;
  comX /= mSum; comY /= mSum; comZ /= mSum;

  const cubeTerm = (cellSize * cellSize) / 6;
  let ixx = 0, iyy = 0, izz = 0, ixy = 0, ixz = 0, iyz = 0;
  for (let i = 0; i < count; i++) {
    const m = mass[i];
    const px = ox[i] - comX, py = oy[i] - comY, pz = oz[i] - comZ;
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
