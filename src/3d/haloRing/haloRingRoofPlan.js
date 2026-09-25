// Plan megastruktury dachu i portu (M3) — czysta matematyka, bez Three.
//
// Dach dzieli się w poprzek na pasy (HALO_ROOF, liczone od krawędzi
// habitatu): kratownica przy krawędzi, dwa rzędy działek pod przyszłe
// budynki gracza (brief §5.3), kolej magnetyczna, pas przemysłowy,
// kratownica od strony planety. Wzdłuż: segment konstrukcji (≈ 676 j.)
// = 2 działki = 12 drobnych komórek.
//
// Każda reguła komórki (co stoi, jak duże, gdzie) wynika z haszu
// całkowitego indeksów komórki. Shader dachu liczy TE SAME reguły tym samym
// haszem (odcisk z daleka + pozorne cienie brył), a ten moduł buduje z nich
// instancje brył z bliska — obiekt 3D wyrasta dokładnie z plamy, którą widać
// z daleka, i rzuca cień, który shader dachu i tak już rysuje.
//
// Instancje są przypisane do segmentów (jak pasy konstrukcji), a pozycja to
// (segment, przesunięcie wzdłuż w skali floorMid, dr = r − floorMid, z) —
// shader liczy ją względem kamery (RTE), więc nie drży przy żadnym zoomie.
import { HALO_PORT, HALO_ROOF, HALO_STATION_ANGLE, HALO_TAU, HALO_TRANSIT, haloTransitAngles } from './haloRingConfig.js';
import { HALO_BAY, haloBayLayouts } from './haloPortBays.js';
import { haloLandmarkParts, haloLandmarkSegment } from './haloRingLandmarks.js';
import { haloDomeParts } from './haloRingDomes.js';

// ---- hasz: bit w bit jak haloLowbias/haloHashI w haloRingGLSL.js ----------
export function haloLowbias(x) {
  x >>>= 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}
export function haloHashI(a, b, salt) {
  const h = haloLowbias(((a >>> 0) ^ haloLowbias(((b >>> 0) ^ haloLowbias(salt >>> 0)) >>> 0)) >>> 0);
  return (h >>> 8) / 16777216;
}

export const HALO_PRIM = Object.freeze({ box: 0, cylinder: 1, dome: 2 });
export const HALO_PRIM_NAMES = Object.freeze(['box', 'cylinder', 'dome']);
// Instancja bryły: segment, wzdłuż [j. w skali floorMid], dr, z (podstawa),
// wymiary (x wzdłuż, y promieniowo, z w górę), kod materiału, kwaternion.
export const HALO_INSTANCE_STRIDE = 12;
// Światło pozycyjne: segment, wzdłuż, dr, z, rozmiar [j.], faza, barwa, tryb.
export const HALO_LIGHT_STRIDE = 8;
// Pociąg (wagon): d od krawędzi, s0 [j.], prędkość, długość wagonu, indeks wagonu, szerokość, wysokość, wariant.
export const HALO_TRAIN_STRIDE = 8;

// Materiał = paleta + 32 × rodzaj emisji (dekoduje shader megastruktury).
// 13–23 zajmują miasto i przemysł (haloRingCity.js); 24–28 — megabudowle
// (haloRingLandmarks.js): kamień, mosiądz, pasy świetlne, ramy fasad ciepłej
// i chłodnej (okna ciepłe / chłodne).
export const HALO_MAT = Object.freeze({
  roofLight: 0, roofMid: 1, dark: 2, white: 3, rust: 4, truss: 5, hazard: 6, glass: 7,
  bayFloor: 8, tunnel: 9, containerA: 10, containerB: 11, containerC: 12,
  gardenRoof: 14, stone: 24, brass: 25, lamp: 26, facadeWarm: 27, facadeCool: 28
});
// bay = pokład ze znaczeniami (tunel tranzytu), deck = pokład zatoki bez znaczeń
// (stanowiska rysuje render kompleksu K-7), tylko nocna poświata ścian;
// facade = fasada megabudowli (kondygnacje, szkło w ramach, okna nocą)
export const HALO_EMIT = Object.freeze({ none: 0, windowsWarm: 1, windowsCool: 2, blueStrip: 3, sodium: 4, bay: 5, deck: 6, facade: 7 });
export const HALO_LIGHT_COLOR = Object.freeze({ white: 0, red: 1, blue: 2, warm: 3, green: 4 });
export const HALO_LIGHT_MODE = Object.freeze({ strobe: 0, steady: 1, pulse: 2, chase: 3 });

// Rodzaje komórek przemysłowych i działek (numery wspólne z GLSL).
export const HALO_CELL = Object.freeze({ empty: 0, tank: 1, block: 2, radiator: 3, chimney: 4, dome: 5 });
export const HALO_PLOT = Object.freeze({ pad: 0, tower: 1, hall: 2, cargo: 3, port: 4 });

// Klasa sektora dla dachu: 0 krajobraz, 1 miasto (ogród/szkło), 2 przemysł, 3 port.
export function roofSectorClass(sector) {
  if (sector?.port) return 3;
  if (sector?.type === 'industrial') return 2;
  if (sector?.type === 'garden' || sector?.type === 'glass') return 1;
  return 0;
}

const IND_OCCUPANCY = [0.55, 0.62, 0.9, 0.85];
// wysokość płyty portu nad podłogą bazową (haloRingWorldGen: h = 7 w portPad)
export const PORT_PAD_H = 7;
const PLOT_EMPTY = [0.8, 0.6, 0.32, 0.3];

// Pasy w poprzek dachu (d od krawędzi habitatu). Drugi rząd działek tylko,
// gdy za nim zmieści się kolej, przemysł i kratownica kadłuba.
export function computeRoofLanes(roofWidth) {
  const R = HALO_ROOF;
  const rimEnd = R.rimBand;
  const rowA = [rimEnd + R.road, rimEnd + R.road + R.plotDepth];
  let x = rowA[1];
  let rowB = [x, x];
  if (x + R.road + R.plotDepth + R.maglev + R.minIndustrial + R.hullBand <= roofWidth) {
    rowB = [x + R.road, x + R.road + R.plotDepth];
    x = rowB[1];
  }
  const maglev = [x, x + R.maglev];
  const hull0 = roofWidth - R.hullBand;
  const industrial = [maglev[1], hull0];
  const crossCells = Math.max(0, Math.floor((industrial[1] - industrial[0]) / R.crossCell));
  return { width: roofWidth, rimEnd, rowA, rowB, maglev, industrial, hull0, crossCells };
}

// ---- reguły komórek (lustro GLSL w haloRingStructure.js) -----------------
// Komórka przemysłowa (i wzdłuż, j w poprzek). Wymiary w j.; środek względem
// środka komórki. cellS = długość komórki wzdłuż (skala floorMid).
export function industrialCellRule(i, j, cls, cellS) {
  if (haloHashI(i, j, 11) >= IND_OCCUPANCY[cls]) return null;
  const k = haloHashI(i, j, 12);
  const s = haloHashI(i, j, 13);
  const hgt = haloHashI(i, j, 14);
  const jx = haloHashI(i, j, 15) - 0.5;
  const jy = haloHashI(i, j, 16) - 0.5;
  const cellD = HALO_ROOF.crossCell;
  if (k < 0.34) {
    const radius = 12 + 12 * s;
    return { kind: HALO_CELL.tank, a: radius, b: radius, h: 18 + 70 * hgt,
      ox: jx * Math.max(0, cellS - 2 * radius - 8), oy: jy * Math.max(0, cellD - 2 * radius - 8) };
  }
  if (k < 0.62) {
    const sx = 22 + 24 * s;
    const sy = 22 + 24 * haloHashI(i, j, 17);
    return { kind: HALO_CELL.block, a: sx, b: sy, h: 10 + 60 * hgt,
      ox: jx * Math.max(0, cellS - sx - 8), oy: jy * Math.max(0, cellD - sy - 8) };
  }
  if (k < 0.8) {
    const along = haloHashI(i, j, 18) < 0.5;
    return { kind: HALO_CELL.radiator, a: along ? 44 : 40, b: along ? 40 : 44, h: 26 + 50 * hgt, along, ox: 0, oy: 0 };
  }
  if (k < 0.9) {
    return { kind: HALO_CELL.chimney, a: 5 + 4 * s, b: 22, h: 60 + 36 * hgt,
      ox: jx * Math.max(0, cellS - 30), oy: jy * Math.max(0, cellD - 30) };
  }
  const radius = 14 + 10 * s;
  return { kind: HALO_CELL.dome, a: radius, b: radius, h: radius,
    ox: jx * Math.max(0, cellS - 2 * radius - 8), oy: jy * Math.max(0, cellD - 2 * radius - 8) };
}

// Działka (L = indeks działki wzdłuż, row = 0/1). Wymiary w j.; środek
// względem środka działki (wzdłuż, w poprzek).
export function plotRule(L, row, cls) {
  if (haloHashI(L, row, 21) < PLOT_EMPTY[cls]) return { kind: HALO_PLOT.pad };
  const k = haloHashI(L, row, 22);
  const a = haloHashI(L, row, 23);
  const b = haloHashI(L, row, 24);
  const c = haloHashI(L, row, 25);
  let kind;
  if (cls >= 2) kind = k < 0.45 ? HALO_PLOT.cargo : (k < 0.75 ? HALO_PLOT.hall : HALO_PLOT.tower);
  else kind = k < 0.6 ? HALO_PLOT.tower : HALO_PLOT.hall;
  if (kind === HALO_PLOT.tower) {
    const pa = 150 + 120 * a;
    const pb = 220 + 200 * b;
    const ph = 18 + 16 * c;
    const ta = 60 + 50 * haloHashI(L, row, 26);
    const tb = 60 + 50 * haloHashI(L, row, 27);
    const th = 40 + 56 * haloHashI(L, row, 28);
    return { kind, a: pa, b: pb, h: ph, ta, tb, th,
      tox: (haloHashI(L, row, 29) - 0.5) * (pa - ta), toy: (haloHashI(L, row, 30) - 0.5) * (pb - tb) };
  }
  if (kind === HALO_PLOT.hall) return { kind, a: 200 + 90 * a, b: 280 + 170 * b, h: 24 + 22 * c };
  return { kind, a: 240, b: 288, h: 12 };
}

// ---- budowa planu --------------------------------------------------------
class InstanceList {
  constructor(stride) {
    this.stride = stride;
    this.data = [];
  }
  get count() { return this.data.length / this.stride; }
}

function quatMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
  ];
}
const Q_ID = [0, 0, 0, 1];
// obrót wektora kwaternionem (jak qrot w shaderze megastruktury)
function qrot(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
// obrót z bazy: lokalne x → xAxis, lokalne z → zAxis (y = z × x); osie
// w układzie ramy (x wzdłuż, y promieniowo, z), xAxis rzutowana prostopadle do z
function quatFromBasis(xAxis, zAxis) {
  const zl = Math.hypot(zAxis[0], zAxis[1], zAxis[2]) || 1;
  const Z = [zAxis[0] / zl, zAxis[1] / zl, zAxis[2] / zl];
  const d = xAxis[0] * Z[0] + xAxis[1] * Z[1] + xAxis[2] * Z[2];
  const xr = [xAxis[0] - d * Z[0], xAxis[1] - d * Z[1], xAxis[2] - d * Z[2]];
  const xl = Math.hypot(xr[0], xr[1], xr[2]) || 1;
  const X = [xr[0] / xl, xr[1] / xl, xr[2] / xl];
  const Y = [Z[1] * X[2] - Z[2] * X[1], Z[2] * X[0] - Z[0] * X[2], Z[0] * X[1] - Z[1] * X[0]];
  // macierz o kolumnach X, Y, Z → kwaternion (x, y, z, w)
  const m00 = X[0], m11 = Y[1], m22 = Z[2];
  const tr = m00 + m11 + m22;
  let q;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(Y[2] - Z[1]) / s, (Z[0] - X[2]) / s, (X[1] - Y[0]) / s, 0.25 * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [0.25 * s, (Y[0] + X[1]) / s, (Z[0] + X[2]) / s, (Y[2] - Z[1]) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(Y[0] + X[1]) / s, 0.25 * s, (Z[1] + Y[2]) / s, (Z[0] - X[2]) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(Z[0] + X[2]) / s, (Z[1] + Y[2]) / s, 0.25 * s, (X[1] - Y[0]) / s];
  }
  const ql = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / ql, q[1] / ql, q[2] / ql, q[3] / ql];
}
// oś cylindra/tuby (lokalnie Z) w kierunek (dx wzdłuż, dy promieniowo, dz)
function quatAxis(dx, dy, dz) {
  const len = Math.hypot(dx, dy, dz) || 1;
  const x = dx / len;
  const y = dy / len;
  const z = dz / len;
  // obrót (0,0,1) → (x,y,z)
  const d = z;
  if (d > 0.999999) return [0, 0, 0, 1];
  if (d < -0.999999) return [1, 0, 0, 0];
  const ax = -y;
  const ay = x;
  const s = Math.sqrt((1 + d) * 2);
  return [ax / s, ay / s, 0, s * 0.5];
}

// options.landmarks — megabudowle (buildHaloLandmarkPlan): bryły w zestawie
// punktów orientacyjnych (BG, bez zaniku z odległością), jak doki.
export function buildHaloRoofPlan(layout, domain, options = {}) {
  const R = HALO_ROOF;
  const sigma = layout.sigma;
  const floorMid = layout.radii.floorMid;
  const rim = layout.radii.rim;
  const back = layout.radii.back;
  const roofWidth = Math.abs(rim - back);
  const zRoof = layout.z.roof;
  const lanes = computeRoofLanes(roofWidth);
  const segCount = domain.segCount;
  const segAngle = HALO_TAU / segCount;
  const segLen = segAngle * floorMid;                       // skala floorMid
  const cellsPerSeg = R.cellsPerSegment;
  const cellS = segLen / cellsPerSeg;
  const lotS = segLen / R.lotsPerSegment;
  const totalCells = segCount * cellsPerSeg;

  // sektor komórki: kąt środka komórki → indeks sektora (jak shader)
  const sectorCount = layout.sectors.length;
  const sectorSpan = HALO_TAU / sectorCount;
  const sectorStart = HALO_STATION_ANGLE - sectorSpan * 0.5;
  const cellsPerSector = totalCells / sectorCount;
  let cell0 = (((sectorStart % HALO_TAU) + HALO_TAU) % HALO_TAU) / HALO_TAU * totalCells;
  const classes = layout.sectors.map(roofSectorClass);
  const sectorOfCell = (i) => {
    let x = (i + 0.5 - cell0) % totalCells;
    if (x < 0) x += totalCells;
    return Math.min(sectorCount - 1, Math.floor(x / cellsPerSector));
  };
  const classOfCell = (i) => classes[sectorOfCell(i)];

  const radiusAtD = (d) => rim - sigma * d;                 // d od krawędzi habitatu
  const detail = Array.from({ length: segCount }, () => HALO_PRIM_NAMES.map(() => new InstanceList(HALO_INSTANCE_STRIDE)));
  const landmark = Array.from({ length: segCount }, () => HALO_PRIM_NAMES.map(() => new InstanceList(HALO_INSTANCE_STRIDE)));
  const lights = Array.from({ length: segCount }, () => new InstanceList(HALO_LIGHT_STRIDE));
  // światła doków (warstwa BG, jak bryły doków) osobno od świateł dachu (FG)
  const landmarkLights = Array.from({ length: segCount }, () => new InstanceList(HALO_LIGHT_STRIDE));
  // szkło kopuł (osobna siatka przezroczysta; granice jak punkty orientacyjne)
  const glass = Array.from({ length: segCount }, () => new InstanceList(HALO_INSTANCE_STRIDE));
  const bounds = Array.from({ length: 2 * segCount }, () => ({ rMin: Infinity, rMax: -Infinity, zMin: Infinity, zMax: -Infinity }));

  // Wstaw bryłę w układzie lokalnym ramy (kąt thF, promień rF): x wzdłuż
  // stycznej, y promieniowo, z — sztywno (bez gięcia po łuku ringu).
  function push(set, prim, seg, thF, rF, x, y, z, sx, sy, sz, mat, q = Q_ID) {
    const rr = rF + y;
    const r = Math.hypot(rr, x);
    const dth = Math.atan2(x, rr);
    // układ lokalny (x = θ̂, y = r̂, z) jest lewoskrętny: wektor ramy wyrażony
    // w układzie kotwicy przesuniętej o +dth obraca się o +dth w (x, y)
    const qq = Math.abs(dth) > 1e-9 ? quatMul([0, 0, Math.sin(dth * 0.5), Math.cos(dth * 0.5)], q) : q;
    const segStart = seg * segAngle;
    let along = (thF + dth - segStart);
    along -= HALO_TAU * Math.round(along / HALO_TAU);
    const lm = set !== 'detail';
    const list = set === 'glass' ? glass[seg] : (lm ? landmark : detail)[seg][prim];
    // +256: punkt orientacyjny (dok, budowla, kopuła) — shader nie wygasza go z odległością
    list.data.push(seg, along * floorMid, r - floorMid, z, sx, sy, sz, mat + (lm ? 256 : 0), qq[0], qq[1], qq[2], qq[3]);
    const b = bounds[(lm ? segCount : 0) + seg];
    const ext = 0.5 * Math.hypot(sx, sy, sz);
    b.rMin = Math.min(b.rMin, r - ext);
    b.rMax = Math.max(b.rMax, r + ext);
    b.zMin = Math.min(b.zMin, z - ext);
    b.zMax = Math.max(b.zMax, z + 2 * ext);
    if (q !== Q_ID) {
      // bryła obrócona (np. budynek stojący na podłodze, góra = promień):
      // wysoka wieża sięga dalej niż pół przekątnej od podstawy — narożniki
      for (const cx of [-0.5, 0.5]) {
        for (const cy of [-0.5, 0.5]) {
          for (const cz of [0, 1]) {
            const v = qrot(q, [cx * sx, cy * sy, cz * sz]);
            const rc = Math.hypot(rr + v[1], x + v[0]);
            b.rMin = Math.min(b.rMin, rc);
            b.rMax = Math.max(b.rMax, rc);
            b.zMin = Math.min(b.zMin, z + v[2]);
            b.zMax = Math.max(b.zMax, z + v[2]);
          }
        }
      }
    }
  }
  function light(seg, thF, rF, x, y, z, size, phase, color, mode, set = 'detail') {
    const rr = rF + y;
    const r = Math.hypot(rr, x);
    const dth = Math.atan2(x, rr);
    let along = thF + dth - seg * segAngle;
    along -= HALO_TAU * Math.round(along / HALO_TAU);
    (set === 'landmark' ? landmarkLights : lights)[seg].data.push(seg, along * floorMid, r - floorMid, z, size, phase, color, mode);
  }

  // Otwarte zatoki (decyzja 2026-09-23): wpięte w podłogę na środku wstęgi,
  // w płaszczyźnie gry — nie dotykają dachu ani krawędzi ścian. Stanowiska
  // w standardzie K-7 (haloPortBays.js) rysuje render kompleksu K-7; tu bryła
  // zatoki. lanes / spines — pasy MEGA i grzbiety (światła, suwnice).
  const docks = [];
  const portOn = sigma > 0 && layout.flightLevel !== 'roof';
  if (portOn) {
    const P = HALO_PORT;
    for (const bay of haloBayLayouts(layout)) {
      const mega = bay.berths[0];
      const dock = {
        index: bay.index, complex: bay.complex, id: bay.id, theta: bay.theta, frameR: floorMid + PORT_PAD_H,
        depth: bay.depth, length: P.dockLength, hallSide: bay.hallSide,
        lanes: bay.lanes.map((v) => v.x), berthIds: bay.lanes.map((v) => v.berthId), spines: bay.spines.map((v) => v.x),
        berthY: mega.z - bay.floorZ
      };
      docks.push(dock);
    }
  }

  for (let seg = 0; seg < segCount; seg++) {
    const th0 = seg * segAngle;
    // ---- kratownice brzegowe ---------------------------------------------
    for (const band of [{ d0: 0, d1: lanes.rimEnd, rim: true }, { d0: lanes.hull0, d1: roofWidth, rim: false }]) {
      const dA = band.rim ? band.d0 + 30 : band.d0 + 20;
      const dB = band.rim ? band.d1 - 30 : band.d1 - 20;
      const hT = R.trussHeight;
      for (let c = 0; c < cellsPerSeg; c++) {
        const thC = th0 + (c + 0.5) * cellS / floorMid;
        const i = seg * cellsPerSeg + c;
        for (const d of [dA, dB]) {
          const rF = radiusAtD(d);
          push('detail', HALO_PRIM.box, seg, thC, rF, -cellS * 0.5, 0, zRoof, 6, 6, hT, HALO_MAT.truss);
          // przekątna w płaszczyźnie kratownicy, na przemian (belka od podstawy wzdłuż osi)
          const dx = (i & 1) ? cellS : -cellS;
          push('detail', HALO_PRIM.box, seg, thC, rF, -dx * 0.5, 0, zRoof, 4, 4, Math.hypot(cellS, hT), HALO_MAT.truss,
            quatAxis(dx, 0, hT));
        }
        // poprzeczka górą w poprzek pasa
        const rMid = radiusAtD((dA + dB) * 0.5);
        push('detail', HALO_PRIM.box, seg, thC, rMid, -cellS * 0.5, 0, zRoof + hT - 6, 6, Math.abs(dB - dA), 6, HALO_MAT.truss);
        // światła: krawędź habitatu biały „bieg”, kadłub czerwony puls
        if (band.rim && (c & 1) === 0) {
          light(seg, thC, radiusAtD(dA), 0, 0, zRoof + hT + 3, 3.2, (i * 0.0125) % 1, HALO_LIGHT_COLOR.white, HALO_LIGHT_MODE.chase);
        } else if (!band.rim && (c & 3) === 0) {
          light(seg, thC, radiusAtD(dB), 0, 0, zRoof + hT + 3, 2.8, haloHashI(i, 7, 33), HALO_LIGHT_COLOR.red, HALO_LIGHT_MODE.pulse);
        }
      }
      // pasy górne (dwa na kratownicę) jako jedna belka na segment
      const thS = th0 + segAngle * 0.5;
      for (const d of [dA, dB]) {
        push('detail', HALO_PRIM.box, seg, thS, radiusAtD(d), 0, 0, zRoof + hT - 8, segLen * radiusAtD(d) / floorMid + 0.5, 8, 8, HALO_MAT.truss);
      }
    }

    // ---- kolej magnetyczna: dwie estakady -------------------------------
    {
      const thS = th0 + segAngle * 0.5;
      for (const d of [lanes.maglev[0] + 30, lanes.maglev[1] - 30]) {
        const rF = radiusAtD(d);
        push('detail', HALO_PRIM.box, seg, thS, rF, 0, 0, zRoof, segLen * rF / floorMid + 0.5, 26, 12, HALO_MAT.roofMid);
      }
    }

    // ---- pas przemysłowy -----------------------------------------------
    for (let c = 0; c < cellsPerSeg; c++) {
      const i = seg * cellsPerSeg + c;
      const cls = classOfCell(i);
      const thC = th0 + (c + 0.5) * cellS / floorMid;
      for (let j = 0; j < lanes.crossCells; j++) {
        const rule = industrialCellRule(i, j, cls, cellS);
        if (!rule) continue;
        const dC = lanes.industrial[0] + (j + 0.5) * R.crossCell;
        const rF = radiusAtD(dC);
        // oy w poprzek rośnie z d (od krawędzi ku kadłubowi) = −σ·r̂
        const x = rule.ox;
        const y = -sigma * rule.oy;
        const mat = cls >= 2 ? HALO_MAT.rust : HALO_MAT.roofLight;
        switch (rule.kind) {
          case HALO_CELL.tank:
            push('detail', HALO_PRIM.cylinder, seg, thC, rF, x, y, zRoof, rule.a * 2, rule.a * 2, rule.h,
              (haloHashI(i, j, 19) < 0.5 ? HALO_MAT.white : HALO_MAT.roofLight) + 32 * (cls >= 2 ? HALO_EMIT.sodium : 0));
            break;
          case HALO_CELL.block:
            push('detail', HALO_PRIM.box, seg, thC, rF, x, y, zRoof, rule.a, rule.b, rule.h,
              mat + 32 * (rule.h > 40 ? (cls >= 2 ? HALO_EMIT.windowsWarm : HALO_EMIT.windowsCool) : HALO_EMIT.none));
            break;
          case HALO_CELL.radiator: {
            for (let f = -2; f <= 2; f++) {
              if (rule.along) push('detail', HALO_PRIM.box, seg, thC, rF, 0, -sigma * f * 9, zRoof, 44, 3, rule.h, HALO_MAT.white);
              else push('detail', HALO_PRIM.box, seg, thC, rF, f * 9, 0, zRoof, 3, 44, rule.h, HALO_MAT.white);
            }
            break;
          }
          case HALO_CELL.chimney:
            push('detail', HALO_PRIM.box, seg, thC, rF, x, y, zRoof, 22, 22, 14, HALO_MAT.dark);
            push('detail', HALO_PRIM.cylinder, seg, thC, rF, x, y, zRoof, rule.a * 2, rule.a * 2, rule.h, HALO_MAT.roofMid + 32 * HALO_EMIT.sodium);
            light(seg, thC, rF, x, y, zRoof + rule.h + 2, 2.2, haloHashI(i, j, 34), HALO_LIGHT_COLOR.red, HALO_LIGHT_MODE.steady);
            break;
          default:
            push('detail', HALO_PRIM.dome, seg, thC, rF, x, y, zRoof, rule.a * 2, rule.a * 2, rule.a, HALO_MAT.white);
        }
      }
    }

    // ---- działki -------------------------------------------------------
    for (let lot = 0; lot < R.lotsPerSegment; lot++) {
      const L = seg * R.lotsPerSegment + lot;
      const thL = th0 + (lot + 0.5) * lotS / floorMid;
      const cls = classOfCell(seg * cellsPerSeg + lot * (cellsPerSeg / R.lotsPerSegment) + 2);
      const rows = lanes.rowB[1] > lanes.rowB[0] ? [lanes.rowA, lanes.rowB] : [lanes.rowA];
      rows.forEach((row, rowIdx) => {
        const dC = (row[0] + row[1]) * 0.5;
        const rF = radiusAtD(dC);
        const rule = plotRule(L, rowIdx, cls);
        const padA = lotS - 2 * HALO_ROOF.road * 0.5;
        const padB = row[1] - row[0] - 20;
        if (rule.kind === HALO_PLOT.pad) {
          // narożne znaczniki działki (błękitne, stałe)
          for (const sx of [-1, 1]) {
            for (const sy of [-1, 1]) {
              light(seg, thL, rF, sx * (padA * 0.5 - 6), sy * (padB * 0.5 - 6), zRoof + 2, 1.6, 0, HALO_LIGHT_COLOR.blue, HALO_LIGHT_MODE.steady);
            }
          }
          return;
        }
        if (rule.kind === HALO_PLOT.tower) {
          push('detail', HALO_PRIM.box, seg, thL, rF, 0, 0, zRoof, rule.a, rule.b, rule.h, HALO_MAT.roofLight);
          const emit = cls >= 2 ? HALO_EMIT.windowsWarm : HALO_EMIT.windowsCool;
          push('detail', HALO_PRIM.box, seg, thL, rF, rule.tox, -sigma * rule.toy, zRoof, rule.ta, rule.tb, rule.th,
            (cls === 1 ? HALO_MAT.glass : HALO_MAT.white) + 32 * emit);
          light(seg, thL, rF, rule.tox, -sigma * rule.toy, zRoof + rule.th + 2, 2.4, haloHashI(L, rowIdx, 35), HALO_LIGHT_COLOR.red, HALO_LIGHT_MODE.pulse);
        } else if (rule.kind === HALO_PLOT.hall) {
          push('detail', HALO_PRIM.box, seg, thL, rF, 0, 0, zRoof, rule.a, rule.b, rule.h, HALO_MAT.roofMid + 32 * HALO_EMIT.sodium);
        } else {
          // kontenery: siatka 5 × 16, stosy 1–3
          for (let a = 0; a < 5; a++) {
            for (let b = 0; b < 16; b++) {
              const stack = 1 + Math.floor(haloHashI(L * 5 + a, rowIdx * 16 + b, 36) * 3);
              if (haloHashI(L * 5 + a, rowIdx * 16 + b, 37) < 0.12) continue;
              const pal = [HALO_MAT.containerA, HALO_MAT.containerB, HALO_MAT.containerC, HALO_MAT.white][Math.floor(haloHashI(L * 5 + a, rowIdx * 16 + b, 38) * 4)];
              push('detail', HALO_PRIM.box, seg, thL, rF, (a - 2) * 48, -sigma * (b - 7.5) * 18, zRoof, 40, 12, 12 * stack, pal);
            }
          }
        }
      });
    }
  }

  // ---- port: zatoki wpięte w podłogę habitatu --------------------------
  // Układ zatoki: x wzdłuż ringu, y od podłogi (promieniowo na zewnątrz),
  // z świata (płaszczyzna gry z = 0 na środku wstęgi). Tył zatoki w kołnierzu
  // na podłodze (terminal z oknami), pokład od ściany tylnej do wylotu poza
  // krawędzią ścian (widać go z kamery gry). Pokład bez znaczeń: stanowiska
  // K-7 (pas MEGA i grzebień L/M/S) rysuje render kompleksu.
  for (const dock of docks) {
    const P = HALO_PORT;
    const seg = Math.floor(dock.theta / segAngle) % segCount;
    const th = dock.theta;
    const rF = dock.frameR;
    const L = 'landmark';
    const len = dock.length;
    const D = dock.depth;
    const zD = P.deckTop;                     // wierzch pokładu
    const zB = zD - 60;                       // spód pokładu
    const zW = P.wallTop;
    const cW = P.collar;
    const cD = P.collarDepth;
    const zBase = Math.round(P.plugZMin * 0.75);
    const box = (x, y0, y1, z0, z1, sx, mat) => push(L, HALO_PRIM.box, seg, th, rF, x, (y0 + y1) * 0.5, z0, sx, y1 - y0, z1 - z0, mat);
    // bryły prostopadłe do promienia na środku zatoki, a podłoga pod ich końcami
    // opada (krzywizna ringu: x²/2R — przy zatoce 6 800 j. ~140 j.): części
    // stykające się z podłogą sięgają głębiej, żeby końce nie wisiały nad terenem
    const sink = (x) => (x * x) / (2 * rF) + 20;
    const sinkAll = sink(len * 0.5 + cW);
    // pokład zatoki (tylko nocna poświata ścian) i ściany
    box(0, P.backWall, D, zB, zD, len - 2 * P.sideWall, HALO_MAT.bayFloor + 32 * HALO_EMIT.deck);
    box(0, -sinkAll, P.backWall, zB, zW, len, HALO_MAT.roofLight + 32 * HALO_EMIT.windowsCool);
    for (const sd of [-1, 1]) {
      box(sd * (len - P.sideWall) * 0.5, -sink(len * 0.5), D, zB, zW, P.sideWall, HALO_MAT.roofLight + 32 * HALO_EMIT.windowsCool);
      // listwy: górą ściany od strony zatoki i przy wylocie (błękit)
      box(sd * (len * 0.5 - P.sideWall - 3), P.backWall, D, zW - 30, zW - 22, 6, HALO_MAT.dark + 32 * HALO_EMIT.blueStrip);
      box(sd * (len * 0.5 - P.sideWall - 6), D - 60, D, zW - 8, zW, 12, HALO_MAT.dark + 32 * HALO_EMIT.blueStrip);
      // bieżnia suwnic na ścianie
      box(sd * (len - P.sideWall) * 0.5, 700, D - 40, zW, zW + 12, 40, HALO_MAT.truss);
    }
    box(0, P.backWall + 3, P.backWall + 9, zW - 30, zW - 22, len - 2 * P.sideWall, HALO_MAT.dark + 32 * HALO_EMIT.blueStrip);
    // próg wylotu pod poziomem pokładu (bez stropu — okręt wchodzi płaszczyzną gry)
    box(0, D - 40, D, zB - 70, zB, len, HALO_MAT.dark + 32 * HALO_EMIT.blueStrip);
    // suwnice pasów MEGA (jak suwnice stanowisk capital K-7): most nad pasem
    // od bieżni na ścianie bocznej do nogi na grzbiecie serwisowym, nad
    // płaszczyzną gry, profil ≤ 1/20 rozpiętości; wózek zaparkowany przy
    // ścianie. Grzebień pośrodku bez mostów (czytelny w kamerze gry).
    dock.lanes.forEach((lx, k) => {
      const sdl = Math.sign(lx) || 1;
      const xWall = sdl * (len * 0.5 - P.sideWall * 0.5);
      const xSpine = dock.spines[k];
      const span = Math.abs(xWall - xSpine);
      for (const yb of HALO_BAY.gantryAt) {
        const y = D * yb;
        box((xWall + xSpine) * 0.5, y - P.gantryProfile * 0.5, y + P.gantryProfile * 0.5, zW + 12, zW + 12 + P.gantryProfile, span, HALO_MAT.hazard);
        box(xSpine, y - 40, y + 40, zD, zW + 12 + P.gantryProfile, 60, HALO_MAT.dark);
        box(xWall - sdl * 70, y - 60, y + 60, zW - 20, zW + 12, 90, HALO_MAT.dark);
      }
    });
    // sterownia na ścianie tylnej (przeszklenie ku zatoce)
    box(0, P.backWall - 20, P.backWall + 60, zW - 10, zW + 90, 520, HALO_MAT.glass + 32 * HALO_EMIT.windowsCool);
    // kołnierz na podłodze: słupy, nadproże i podstawa-terminal z pasami okien
    const cx = len * 0.5 + cW * 0.5;
    for (const sd of [-1, 1]) {
      box(sd * cx, -60 - sink(len * 0.5 + cW), cD, zBase, zW + 80, cW, HALO_MAT.roofMid);
      box(sd * (len * 0.5 + 8), cD - 4, cD + 4, zBase + 60, zW + 60, 10, HALO_MAT.dark + 32 * HALO_EMIT.blueStrip);
    }
    box(0, -60, cD, zW, zW + 80, len, HALO_MAT.roofMid);
    box(0, -60 - sink(len * 0.5), cD, zBase, zB, len, HALO_MAT.dark);
    for (let row = 0; row < 5; row++) {
      const zr = zB - 110 - row * 115;
      if (zr < zBase + 60) break;
      box(0, cD, cD + 6, zr, zr + 20, len - 240, HALO_MAT.glass + 32 * HALO_EMIT.windowsWarm);
    }
    // klin nośny pod pokładem: schodkami od podłogi ku wylotowi zatoki
    const steps = [[-sink(len * 0.5 - 150), 900, zBase], [900, 1800, Math.round(zBase * 0.66)], [1800, 2700, Math.round(zBase * 0.38)]];
    for (const [y0, y1, z0] of steps) {
      box(0, y0, y1, z0, zB, len - 300, HALO_MAT.roofMid);
      for (const sd of [-1, 1]) box(sd * (len * 0.5 - 150 - 3), y0, y1 - 20, z0 + 30, z0 + 38, 6, HALO_MAT.dark + 32 * HALO_EMIT.blueStrip);
    }
    // światła: stroboskopy przy wylocie, czerwone na kołnierzu, reflektory na
    // ścianach, nawigacja wylotu (zielone po prawej +x, czerwone po lewej) i
    // biały bieg wzdłuż krawędzi pasa MEGA na progu
    for (const sd of [-1, 1]) {
      light(seg, th, rF, sd * len * 0.5, D, zW + 6, 3.4, 0.25 * (sd + 1), HALO_LIGHT_COLOR.white, HALO_LIGHT_MODE.strobe, L);
      light(seg, th, rF, sd * (len * 0.5 + cW), cD, zW + 86, 3.0, 0.3, HALO_LIGHT_COLOR.red, HALO_LIGHT_MODE.pulse, L);
      for (let k = 1; k <= 3; k++) {
        light(seg, th, rF, sd * (len * 0.5 - P.sideWall * 0.5), D * k / 4, zW + 6, 2.6, 0, HALO_LIGHT_COLOR.warm, HALO_LIGHT_MODE.steady, L);
      }
      light(seg, th, rF, sd * (len * 0.5 - P.sideWall * 0.5), D - 20, zW + 20, 3.0, 0, sd > 0 ? HALO_LIGHT_COLOR.green : HALO_LIGHT_COLOR.red, HALO_LIGHT_MODE.steady, L);
      for (const lx of dock.lanes) {
        for (let k = 0; k < 4; k++) {
          light(seg, th, rF, lx + sd * 600, D - 30 - k * 260, zD + 4, 2.2, k * 0.14, HALO_LIGHT_COLOR.white, HALO_LIGHT_MODE.chase, L);
        }
      }
    }
  }

  // ---- tranzyty przez ring (jak w K-7 z ECUMENE: 4 osie co 90°) ---------
  // Tunel w płycie podłogi: od wylotu na habitat (podłoga) do wylotu na
  // planetę (kadłub). Układ: x wzdłuż ringu, y od płyty portu na zewnątrz
  // (tunel w y ∈ [−płyta, 0]), z świata. Otwór w terenie i kadłubie wycinają
  // shadery (haloInTransitCut) — tu wyściółka, portale i światła.
  const transits = [];
  if (portOn) {
    const T = HALO_TRANSIT;
    const frameR = floorMid + PORT_PAD_H;
    const slab = frameR - layout.radii.back;
    haloTransitAngles().forEach((theta, index) => transits.push({ index, id: 'T-' + String(index + 1).padStart(2, '0'), theta, frameR, slab, halfWidth: T.halfWidth }));
    for (const tr of transits) {
      const seg = Math.floor(tr.theta / segAngle) % segCount;
      const th = tr.theta;
      const rF = tr.frameR;
      const L = 'landmark';
      const hw = T.halfWidth;
      const W = T.wall;
      const ya = -tr.slab - 40;                 // za kadłubem
      const yb = 30;                            // nad płytą portu
      const [zc0, zc1] = T.cutZ;
      const [pz0, pz1] = T.portalZ;
      const outer = hw + W + T.frame;
      const box = (x, y0, y1, z0, z1, sx, mat) => push(L, HALO_PRIM.box, seg, th, rF, x, (y0 + y1) * 0.5, z0, sx, y1 - y0, z1 - z0, mat);
      // wyściółka: podłoga ze znaczeniami, strop, ściany z listwami
      box(0, ya, yb, zc0, T.deckTop, 2 * (hw + W), HALO_MAT.bayFloor + 32 * HALO_EMIT.bay);
      box(0, ya, yb, T.ceiling, zc1, 2 * (hw + W), HALO_MAT.roofMid);
      for (const sd of [-1, 1]) {
        box(sd * (hw + W * 0.5), ya, yb, zc0, zc1, W, HALO_MAT.roofLight);
        box(sd * (hw + 2), ya + 20, yb - 20, -46, -38, 4, HALO_MAT.dark + 32 * HALO_EMIT.blueStrip);
        box(sd * (hw + 2), ya + 20, yb - 20, T.ceiling - 30, T.ceiling - 22, 4, HALO_MAT.white + 32 * HALO_EMIT.windowsCool);
      }
      // portale na obu wylotach (habitat: y ≥ 0, planeta: y ≤ −płyta)
      for (const side of [1, -1]) {
        const y0 = side > 0 ? -60 : -tr.slab - 150;
        const y1 = side > 0 ? 150 : -tr.slab + 60;
        const face = side > 0 ? y1 : y0;       // lico od strony wylotu
        const fy0 = side > 0 ? face : face - 6;
        const fy1 = side > 0 ? face + 6 : face;
        for (const sd of [-1, 1]) {
          box(sd * (hw + W + T.frame * 0.5), y0, y1, pz0, pz1, T.frame, HALO_MAT.roofMid);
          // pasy ostrzegawcze przy prześwicie i ciemna krawędź zewnętrzna
          box(sd * (hw + W + 24), fy0, fy1, pz0 + 60, pz1 - 60, 36, HALO_MAT.hazard);
          box(sd * (outer - 20), fy0, fy1, pz0 + 40, pz1 - 40, 30, HALO_MAT.dark);
        }
        box(0, y0, y1, zc1, pz1, 2 * outer, HALO_MAT.roofMid);
        box(0, y0, y1, pz0, zc0, 2 * outer, HALO_MAT.dark);
        box(0, fy0, fy1, zc1 + 36, zc1 + 60, 2 * hw, HALO_MAT.dark + 32 * HALO_EMIT.blueStrip);
        box(0, fy0, fy1, zc0 - 110, zc0 - 80, 2 * hw, HALO_MAT.dark + 32 * HALO_EMIT.blueStrip);
        const ly = face + side * 8;
        // nawigacja: zielone po prawej (+x), czerwone po lewej, stroboskopy w narożnikach
        for (const z of [-260, 0, 260]) {
          light(seg, th, rF, outer - 60, ly, z, 3.0, 0, HALO_LIGHT_COLOR.green, HALO_LIGHT_MODE.steady, L);
          light(seg, th, rF, -(outer - 60), ly, z, 3.0, 0, HALO_LIGHT_COLOR.red, HALO_LIGHT_MODE.steady, L);
        }
        for (const sd of [-1, 1]) {
          light(seg, th, rF, sd * outer, ly, pz1, 3.6, 0.25 * (sd + 1) + (side > 0 ? 0 : 0.5), HALO_LIGHT_COLOR.white, HALO_LIGHT_MODE.strobe, L);
        }
      }
      // światła krawędzi na płycie portu po obu stronach wylotu (jak pas startowy)
      for (let k = 0; k < 6; k++) {
        for (const sd of [-1, 1]) light(seg, th, rF, sd * (outer + 160 + k * 230), 12, 0, 2.2, k * 0.12, HALO_LIGHT_COLOR.blue, HALO_LIGHT_MODE.chase, L);
      }
      // znacznik na dachu nad tranzytem (widać go z kamery gry nad pokrywą):
      // dwie linie zielonych świateł w poprzek dachu + stroboskopy na końcach
      for (let d = 40; d < roofWidth - 20; d += 90) {
        for (const sd of [-1, 1]) light(seg, th, radiusAtD(d), sd * hw, 0, layout.z.top + 4, 3.0, d / roofWidth, HALO_LIGHT_COLOR.green, HALO_LIGHT_MODE.chase);
      }
      for (const sd of [-1, 1]) {
        for (const d of [20, roofWidth - 20]) light(seg, th, radiusAtD(d), sd * hw, 0, layout.z.top + 6, 4.0, 0.5 * (sd + 1), HALO_LIGHT_COLOR.white, HALO_LIGHT_MODE.strobe);
      }
    }
  }

  // ---- megabudowle i kopuły (haloRingLandmarks.js, haloRingDomes.js) -------
  // Obiekt stoi na placu w podłodze habitatu: góra = normalna podłogi (ku
  // powietrzu), w poprzek = styczna podłogi (ku górnej ścianie, front).
  // Prymityw ma z w górę, więc kwaternion stawia go na podłodze — okna, dach
  // i fazki w shaderze liczą się w jego osiach. Bryły budowli skręcone o yaw
  // wokół góry; bryły „fixed” (płyta placu, park, kopuła) w osiach ringu —
  // przesunięcie liczone wprost z wektorów ramy, kierunek bryły z `dir`.
  const landmarks = Array.isArray(options.landmarks) ? options.landmarks : [];
  const domes = Array.isArray(options.domes) ? options.domes : [];
  if (landmarks.length || domes.length) {
    const LM_MAT = { stone: HALO_MAT.stone, brass: HALO_MAT.brass, lamp: HALO_MAT.lamp, dark: HALO_MAT.roofMid, garden: HALO_MAT.gardenRoof };
    const LM_COLOR = { white: HALO_LIGHT_COLOR.white, red: HALO_LIGHT_COLOR.red, blue: HALO_LIGHT_COLOR.blue, warm: HALO_LIGHT_COLOR.warm, green: HALO_LIGHT_COLOR.green };
    const LM_MODE = { strobe: HALO_LIGHT_MODE.strobe, steady: HALO_LIGHT_MODE.steady, pulse: HALO_LIGHT_MODE.pulse, chase: HALO_LIGHT_MODE.chase };
    const n = layout.floor.normal;
    const tg = layout.floor.tangent;
    const N = [0, n.r, n.z];
    const qUp = quatFromBasis([1, 0, 0], N);
    // wektor ramy z (a wzdłuż, q w poprzek, u w górę)
    const frameVec = (a, q, u) => [a, q * tg.r + u * n.r, q * tg.z + u * n.z];
    const emit = (seg, theta, t, baseH, yaw, parts, warm) => {
      const rF = layout.floorRadiusAtT(t) + n.r * baseH;
      const zF = layout.floorZAtT(t) + n.z * baseH;
      // wariant Halo (góra ku osi): obrót właściwy odwróciłby front ku −z —
      // dodatkowe pół obrotu wokół góry trzyma front po stronie górnej ściany
      const yw = yaw + (layout.sigma < 0 ? Math.PI : 0);
      const sh = Math.sin(yw * 0.5);
      const q = quatMul([0, n.r * sh, n.z * sh, Math.cos(yw * 0.5)], qUp);
      const facade = (warm ? HALO_MAT.facadeWarm : HALO_MAT.facadeCool) + 32 * HALO_EMIT.facade;
      for (const b of parts.boxes) {
        let off;
        let qb;
        if (b.fixed) {
          off = frameVec(b.a, b.q, b.u0);
          qb = Number.isFinite(b.dir) ? quatFromBasis(frameVec(Math.cos(b.dir), Math.sin(b.dir), 0), N) : qUp;
        } else {
          // lokalnie prymitywu: x wzdłuż, −y w poprzek (y → −styczna), z w górę
          off = qrot(q, [b.a, -b.q, b.u0]);
          qb = q;
        }
        push('landmark', HALO_PRIM.box, seg, theta, rF, off[0], off[1], zF + off[2], b.sa, b.sq, b.su,
          b.mat === 'facade' ? facade : (LM_MAT[b.mat] ?? HALO_MAT.stone), qb);
      }
      for (const l of parts.lights) {
        const off = l.fixed ? frameVec(l.a, l.q, l.u) : qrot(q, [l.a, -l.q, l.u]);
        light(seg, theta, rF, off[0], off[1], zF + off[2], l.size, l.phase,
          LM_COLOR[l.color] ?? HALO_LIGHT_COLOR.warm, LM_MODE[l.mode] ?? HALO_LIGHT_MODE.steady, 'landmark');
      }
      // szkło kopuły: półkula (x, y promień, z wysokość), paleta = typ wnętrza,
      // emisja 1 = ciepłe wnętrze nocą (ogród, krajobraz), 0 = chłodne (szkło)
      if (parts.glass) {
        push('glass', 0, seg, theta, rF, 0, 0, zF, 2 * parts.glass.r, 2 * parts.glass.r, parts.glass.h,
          (parts.glass.type || 0) + 32 * (warm ? 1 : 0), qUp);
      }
    };
    for (const lm of landmarks) {
      emit(haloLandmarkSegment(lm, segCount), lm.theta, lm.t, lm.plazaH, lm.yaw, haloLandmarkParts(lm), lm.warm);
    }
    for (const dm of domes) {
      const parts = haloDomeParts(dm);
      parts.glass.type = dm.typeIndex;
      emit(haloLandmarkSegment(dm, segCount), dm.theta, dm.t, dm.floorH, 0, parts, dm.warm);
    }
  }

  // ---- kolej: pociągi (bez segmentów — jeżdżą dookoła) ------------------
  const trains = [];
  const L = layout.circumference;
  for (const [track, dir] of [[0, 1], [1, -1]]) {
    const d = track === 0 ? lanes.maglev[0] + 30 : lanes.maglev[1] - 30;
    for (let k = 0; k < R.trainsPerTrack; k++) {
      const s0 = (k + haloHashI(k, track, 51) * 0.6) * L / R.trainsPerTrack;
      const speed = dir * R.trainSpeed * (0.85 + 0.3 * haloHashI(k, track, 52));
      for (let c = 0; c < R.trainCars; c++) {
        trains.push(d, s0, speed, 70, c, 18, 14, haloHashI(k, track, 53) < 0.5 ? 0 : 1);
      }
    }
  }

  // spakowanie: jedna tablica na rodzaj bryły, zakresy per segment
  const pack = (lists, stride) => {
    const offsets = new Int32Array(segCount);
    const counts = new Int32Array(segCount);
    let total = 0;
    for (let s = 0; s < segCount; s++) total += lists[s].count;
    const data = new Float32Array(total * stride);
    let o = 0;
    for (let s = 0; s < segCount; s++) {
      offsets[s] = o;
      counts[s] = lists[s].count;
      data.set(lists[s].data, o * stride);
      o += lists[s].count;
    }
    let maxPerSeg = 0;
    for (let s = 0; s < segCount; s++) maxPerSeg = Math.max(maxPerSeg, counts[s]);
    return { data, offsets, counts, total, stride, maxPerSeg };
  };
  const prims = HALO_PRIM_NAMES.map((name, p) => ({
    name,
    detail: pack(detail.map((l) => l[p]), HALO_INSTANCE_STRIDE),
    landmark: pack(landmark.map((l) => l[p]), HALO_INSTANCE_STRIDE)
  }));
  const segBounds = bounds.map((b) => (Number.isFinite(b.rMin) ? b : null));
  return {
    lanes,
    segCount,
    segAngle,
    segLen,
    cellS,
    lotS,
    totalCells,
    cell0,
    cellsPerSector,
    classes,
    prims,
    lights: pack(lights, HALO_LIGHT_STRIDE),
    landmarkLights: pack(landmarkLights, HALO_LIGHT_STRIDE),
    trains: new Float32Array(trains),
    trainCount: trains.length / HALO_TRAIN_STRIDE,
    docks,
    transits,
    landmarks,
    domes,
    glass: pack(glass, HALO_INSTANCE_STRIDE),
    detailBounds: segBounds.slice(0, segCount),
    landmarkBounds: segBounds.slice(segCount)
  };
}
