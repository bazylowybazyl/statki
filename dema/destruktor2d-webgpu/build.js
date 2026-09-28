// Kadłub 2D ze sprite'a dla fizyki belek na GPU — ta sama konstrukcja co
// buildSpriteBeamStructure (src/game/beamSprite2D.js → beamBody3D.js), ale od razu
// w tablicach typowanych i w czasie liniowym. Stary budowniczy szuka grodzi,
// sortując cały przekrój dla każdego węzła (O(n² log n) na kolumnę) i trzyma
// klucze belek w Set napisów — przy siatce 3,75 j. to minuty i gigabajty. Tu
// grodzie idą dwoma wskaźnikami po kolumnie, a belki siatki nie potrzebują Set.
//
// Kolejność węzłów i belek jest identyczna z oryginałem (test:
// tests/destruktor2dGpuBuild.test.mjs porównuje obie budowy belka w belkę),
// więc CPU i GPU liczą dokładnie tę samą konstrukcję.
//
// Moduł nie importuje three ani WebGPU — działa też w node.
import { sampleSpriteLattice, SPRITE_2D_DEFAULTS } from '../../src/game/beamSprite2D.js';
import { BEAM_TYPE, BEAM_PRESETS } from '../../src/game/beamBody3D.js';
import { beamConnectivityScratch, findBeamBridgesStore } from '../../src/game/beamConnectivity3D.js';

// NEIGHBOR_DIRS_18 z beamBody3D bez kierunków z (siatka ma jedną warstwę).
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// Kierunek do sąsiada siatki → slot 0..7 w tabeli połączeń skóry (bez środka).
export const LINK_SLOT = (dx, dy) => {
  const d = (dx + 1) + (dy + 1) * 3;
  return d < 4 ? d : d - 1;
};

class BeamList {
  constructor(capacity) {
    this.count = 0;
    this.a = new Int32Array(capacity);
    this.b = new Int32Array(capacity);
    this.rest = new Float64Array(capacity);
    this.type = new Uint8Array(capacity);
  }

  push(a, b, rest, type) {
    if (this.count === this.a.length) this._grow();
    const k = this.count++;
    this.a[k] = a; this.b[k] = b; this.rest[k] = rest; this.type[k] = type;
    return k;
  }

  _grow() {
    const cap = this.a.length * 2 || 1024;
    for (const f of ['a', 'b', 'rest', 'type']) {
      const next = new this[f].constructor(cap);
      next.set(this[f]);
      this[f] = next;
    }
  }
}

/**
 * @param {{width:number,height:number,data:ArrayLike<number>}} image RGBA
 * @param {object} opts jak buildSpriteBeamStructure: worldLength, cellsAlong, frameStride,
 *   bulkheadEvery, maxFrameSpan, cellMassBase, key, textureSource, tint; nodesOnly = bez belek
 *   (ciało statyczne: ściana się nie odkształca, belki byłyby martwym balastem).
 */
export function buildSpriteHullGpu(image, opts = {}) {
  const lattice = sampleSpriteLattice(image, opts);
  const cells = lattice.cells;
  const N = cells.length;
  if (N === 0) throw new Error('buildSpriteHullGpu: sprite nie ma kryjących komórek');
  const nx = lattice.nx, ny = lattice.ny, cs = lattice.cellSize;
  const cellMassBase = Number.isFinite(opts.cellMassBase) ? opts.cellMassBase : 10;
  const frameStrideOpt = opts.frameStride === undefined ? SPRITE_2D_DEFAULTS.frameStride : opts.frameStride;
  const frameStride = frameStrideOpt === 0 ? 0 : Math.max(1, frameStrideOpt | 0);
  const bulkOpt = opts.bulkheadEvery === undefined ? SPRITE_2D_DEFAULTS.bulkheadEvery : opts.bulkheadEvery;
  const bulkheadEvery = Math.max(0, bulkOpt | 0);
  const maxFrameSpan = Math.max(2, Number.isFinite(opts.maxFrameSpan) ? opts.maxFrameSpan | 0 : ny + 2);
  const solidMask = lattice.solidMask;

  // --- węzły ---
  const ox = new Float64Array(N), oy = new Float64Array(N);
  const mass = new Float64Array(N), hp = new Float64Array(N), coverage = new Float64Array(N);
  const r = new Float32Array(N), g = new Float32Array(N), bl = new Float32Array(N);
  const ix = new Int32Array(N), iy = new Int32Array(N);
  const surface = new Uint8Array(N);
  const cellIndex = new Int32Array(nx * ny).fill(-1);
  for (let i = 0; i < N; i++) {
    const c = cells[i];
    ox[i] = c.x; oy[i] = c.y;
    mass[i] = cellMassBase * c.coverage;
    hp[i] = 80 * c.coverage;
    coverage[i] = c.coverage;
    r[i] = c.r; g[i] = c.g; bl[i] = c.b;
    ix[i] = c.ix; iy[i] = c.iy;
    surface[i] = c.surface ? 1 : 0;
    cellIndex[c.ix + c.iy * nx] = i;
  }
  const at = (x, y) => (x < 0 || y < 0 || x >= nx || y >= ny) ? -1 : cellIndex[x + y * nx];
  const solid = (x, y) => x >= 0 && y >= 0 && x < nx && y < ny && solidMask[x + y * nx] !== 0;

  const beams = new BeamList(opts.nodesOnly ? 16 : N * 5);
  const beamCount = new Int32Array(N), localBeamCount = new Int32Array(N), platingCount = new Int32Array(N);
  let frames = 0, bulkheads = 0;

  if (!opts.nodesOnly) {
    // Wręgi i grodzie: pary już połączone (klucz liczbowy; tylko te belki, jest ich mało).
    const extra = new Set();
    const pairKey = (a, b) => (a < b ? a * N + b : b * N + a);
    // staysInsideHull z beamBody3D (DDA środek–środek), iz = 0.
    const staysInside = (a, b) => {
      let x = ix[a], y = iy[a];
      const bx = ix[b], by = iy[b];
      const dx = bx - x, dy = by - y;
      const sx = Math.sign(dx), sy = Math.sign(dy);
      const dtX = dx === 0 ? Infinity : 1 / Math.abs(dx);
      const dtY = dy === 0 ? Infinity : 1 / Math.abs(dy);
      let tx = dtX * 0.5, ty = dtY * 0.5;
      while (x !== bx || y !== by) {
        const t = Math.min(tx, ty, Infinity) + 1e-10;
        if (tx <= t) { x += sx; tx += dtX; }
        if (ty <= t) { y += sy; ty += dtY; }
        if (!solid(x, y)) return false;
      }
      return true;
    };
    const add = (a, b, type) => {
      const dx = ox[b] - ox[a], dy = oy[b] - oy[a];
      const rest = Math.sqrt(dx * dx + dy * dy + 0);
      if (rest < 1e-6) return false;
      beams.push(a, b, rest, type);
      beamCount[a]++; beamCount[b]++;
      if (type < BEAM_TYPE.FRAME) { localBeamCount[a]++; localBeamCount[b]++; }
      if (type === BEAM_TYPE.PLATING) { platingCount[a]++; platingCount[b]++; }
      return true;
    };
    const addChecked = (a, b, type) => {
      if (a === b) return false;
      const key = pairKey(a, b);
      if (extra.has(key)) return false;
      // Para z siatki (sąsiad w 8 kierunkach) ma już belkę poszycia/wnętrza.
      if (Math.abs(ix[a] - ix[b]) <= 1 && Math.abs(iy[a] - iy[b]) <= 1) return false;
      if (!staysInside(a, b)) return false;
      extra.add(key);
      return add(a, b, type);
    };

    // 1) powłoka: 8 sąsiadów; belkę tworzy węzeł o mniejszym indeksie (jak Set kluczy w oryginale)
    for (let i = 0; i < N; i++) {
      for (let d = 0; d < 8; d++) {
        const o = at(ix[i] + DIRS8[d][0], iy[i] + DIRS8[d][1]);
        if (o < 0 || o < i) continue;
        add(i, o, surface[i] && surface[o] ? BEAM_TYPE.PLATING : BEAM_TYPE.INTERIOR);
      }
    }

    // 2) wręgi w poprzek (oś Y), od burty do przeciwległej burty
    for (let i = 0; frameStride && i < N; i++) {
      if (!surface[i] || (i % frameStride) !== 0) continue;
      let oyN = 0;
      if (at(ix[i], iy[i] + 1) < 0) oyN += 1;
      if (at(ix[i], iy[i] - 1) < 0) oyN -= 1;
      if (oyN === 0) continue;
      const iny = -oyN;          // |oy| = 1
      for (let step = 2; step <= maxFrameSpan; step++) {
        const target = at(ix[i], iy[i] + iny * step);
        if (target < 0 || !surface[target]) continue;
        if (at(ix[i], iy[i] + iny * (step + 1)) >= 0) continue;
        if (addChecked(i, target, BEAM_TYPE.FRAME)) frames++;
        break;
      }
    }

    // 3) grodzie: co N-ty przekrój wzdłuż najdłuższej osi, każdy węzeł z 4 najbliższymi w przekroju
    if (bulkheadEvery > 0) {
      let minI = Infinity, maxI = -Infinity, minJ = Infinity, maxJ = -Infinity;
      for (let i = 0; i < N; i++) {
        if (ix[i] < minI) minI = ix[i]; if (ix[i] > maxI) maxI = ix[i];
        if (iy[i] < minJ) minJ = iy[i]; if (iy[i] > maxJ) maxJ = iy[i];
      }
      const alongX = (maxI - minI) >= (maxJ - minJ);   // spans.indexOf(max) — remis = X
      const axisMin = alongX ? minI : minJ;
      // Przekroje w kolejności pierwszego wystąpienia (jak Map w oryginale); węzły w kolejności indeksów.
      const slabs = new Map();
      for (let i = 0; i < N; i++) {
        const station = (alongX ? ix[i] : iy[i]) - axisMin;
        if (station % bulkheadEvery !== 0) continue;
        let list = slabs.get(station);
        if (!list) { list = []; slabs.set(station, list); }
        list.push(i);
      }
      for (const [, list] of slabs) {
        if (list.length < 3) continue;
        // Przekrój 2D to jedna kolumna (albo wiersz) — lista rośnie wzdłuż drugiej osi, więc
        // 4 najbliższe to scalanie dwóch kierunków; remis wygrywa wcześniejszy na liście
        // (stabilne sortowanie oryginału). Odległości z pozycji float, jak w oryginale.
        const dist2 = (a, b) => {
          const dx = ox[b] - ox[a], dy = oy[b] - oy[a];
          return dx * dx + dy * dy + 0;
        };
        for (let k = 0; k < list.length; k++) {
          const a = list[k];
          let lo = k - 1, hi = k + 1, taken = 0;
          while (taken < 4 && (lo >= 0 || hi < list.length)) {
            let pick;
            if (lo < 0) pick = hi++;
            else if (hi >= list.length) pick = lo--;
            else {
              const dl = dist2(a, list[lo]), dh = dist2(a, list[hi]);
              pick = dl <= dh ? lo-- : hi++;
            }
            taken++;
            if (addChecked(a, list[pick], BEAM_TYPE.BULKHEAD)) bulkheads++;
          }
        }
      }
    }
  }

  // --- CSR (kolejność buildAdjacency: po belkach, koniec a, potem b) ---
  const B = beams.count;
  const adjStart = new Int32Array(N + 1);
  for (let e = 0; e < B; e++) { adjStart[beams.a[e] + 1]++; adjStart[beams.b[e] + 1]++; }
  for (let i = 0; i < N; i++) adjStart[i + 1] += adjStart[i];
  const fill = adjStart.slice(0, N);
  const adj = new Int32Array(adjStart[N]);
  for (let e = 0; e < B; e++) {
    adj[fill[beams.a[e]]++] = e;
    adj[fill[beams.b[e]]++] = e;
  }

  // --- mosty pierwotnej konstrukcji (restBridge) ---
  const restBridge = new Uint8Array(B);
  if (B > 0) {
    const nodeView = { count: N, active: new Uint8Array(N).fill(1), adjStart, adj };
    const beamView = { a: beams.a, b: beams.b, broken: new Uint8Array(B) };
    const bridges = findBeamBridgesStore(nodeView, beamView, beamConnectivityScratch(N, B));
    for (let e = 0; e < B; e++) restBridge[e] = bridges[e];
  }

  // --- środek masy, bezwładność (oś z), promień ---
  let comX = 0, comY = 0, mSum = 0;
  for (let i = 0; i < N; i++) { comX += ox[i] * mass[i]; comY += oy[i] * mass[i]; mSum += mass[i]; }
  comX /= mSum; comY /= mSum;
  const cubeTerm = (cs * cs) / 6;
  let izz = 0, radius = 0;
  for (let i = 0; i < N; i++) {
    ox[i] -= comX; oy[i] -= comY;
    izz += mass[i] * (ox[i] * ox[i] + oy[i] * oy[i] + cubeTerm);
    const d = Math.sqrt(ox[i] * ox[i] + oy[i] * oy[i]);
    if (d > radius) radius = d;
  }

  // --- skóra: belka do każdego z 8 sąsiadów siatki (−1 = brak) ---
  const links = new Int32Array(N * 8).fill(-1);
  for (let e = 0; e < B; e++) {
    const a = beams.a[e], b = beams.b[e];
    const dx = ix[b] - ix[a], dy = iy[b] - iy[a];
    if ((dx === 0 && dy === 0) || Math.abs(dx) > 1 || Math.abs(dy) > 1) continue;
    links[a * 8 + LINK_SLOT(dx, dy)] = e;
    links[b * 8 + LINK_SLOT(-dx, -dy)] = e;
  }

  const stiffness = new Float32Array(B), deform = new Float32Array(B), brk = new Float32Array(B);
  let plating = 0, interior = 0;
  for (let e = 0; e < B; e++) {
    const p = BEAM_PRESETS[beams.type[e]];
    stiffness[e] = p.stiffness; deform[e] = p.deform; brk[e] = p.break;
    if (beams.type[e] === BEAM_TYPE.PLATING) plating++;
    else if (beams.type[e] === BEAM_TYPE.INTERIOR) interior++;
  }

  return {
    cellSize: cs, nx, ny, nodeCount: N, beamCount: B,
    ox, oy, mass, hp, coverage, r, g, b: bl, ix, iy, surface,
    beamCountPerNode: beamCount, localBeamCount, platingCount,
    beamA: beams.a.subarray(0, B), beamB: beams.b.subarray(0, B), rest: beams.rest.subarray(0, B),
    type: beams.type.subarray(0, B), restBridge, stiffness, deform, brk,
    adjStart, adj, links,
    totalMass: mSum, com: { x: comX, y: comY }, izz, invIzz: izz > 1e-9 ? 1 / izz : 0,
    radius: radius + cs,
    latticeMin: { x: lattice.origin.x - comX, y: lattice.origin.y - comY },
    spriteSkin: {
      key: opts.key || null, image: opts.textureSource || null, tint: opts.tint || null,
      width: lattice.width, height: lattice.height, pixelPitch: lattice.pixelPitch,
      nx, ny, cellSize: cs
    },
    stats: { nodes: N, beams: B, plating, interior, frames, bulkheads }
  };
}

/**
 * Kolorowanie krawędzi pod Gaussa-Seidla na GPU: belki jednego koloru nie dzielą węzłów,
 * więc wątki rzutują je naraz bez wyścigów. Zachłannie, ale w kolejności klas (poziome,
 * pionowe, dwie przekątne, potem długie) — wtedy siatka wychodzi w 8 kolorach (kierunek ×
 * parzystość), a wręgi i grodzie dokładają kilka. Zwraca kolory belek i ich liczbę.
 */
export function colorBeams(nodeCount, beamA, beamB, ix, iy, maxColors = 64) {
  const B = beamA.length;
  const order = new Int32Array(B);
  const classOf = new Uint8Array(B);
  for (let e = 0; e < B; e++) {
    const a = beamA[e], b = beamB[e];
    const dx = ix[b] - ix[a], dy = iy[b] - iy[a];
    let c = 4;
    if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
      if (dy === 0) c = 0;
      else if (dx === 0) c = 1;
      else if (dx === dy) c = 2;
      else c = 3;
    }
    classOf[e] = c;
  }
  let k = 0;
  for (let c = 0; c <= 4; c++) for (let e = 0; e < B; e++) if (classOf[e] === c) order[k++] = e;
  const lo = new Uint32Array(nodeCount), hi = new Uint32Array(nodeCount);
  const color = new Uint8Array(B);
  let colors = 0;
  for (let n = 0; n < B; n++) {
    const e = order[n], a = beamA[e], b = beamB[e];
    const usedLo = lo[a] | lo[b], usedHi = hi[a] | hi[b];
    let c = 0;
    if (usedLo !== 0xffffffff) c = Math.clz32(~usedLo & (usedLo + 1)) ^ 31;
    else if (usedHi !== 0xffffffff) c = 32 + (Math.clz32(~usedHi & (usedHi + 1)) ^ 31);
    else throw new Error(`colorBeams: ponad ${maxColors} kolorów`);
    if (c >= maxColors) throw new Error(`colorBeams: ponad ${maxColors} kolorów`);
    color[e] = c;
    if (c < 32) { lo[a] |= 1 << c; lo[b] |= 1 << c; } else { hi[a] |= 1 << (c - 32); hi[b] |= 1 << (c - 32); }
    if (c + 1 > colors) colors = c + 1;
  }
  return { color, colors };
}
