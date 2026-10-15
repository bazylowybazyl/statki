// Rdzeń WYPIEKU SKÓRY kawałka budowli (opis wypieku i geometrie three: portBuildingSkin3D.js). Bez three i DOM — ten sam
// kod liczy w wątku głównym (zapas, testy) i w workerze portBuildingSkinWorker.js (gra: wypiek poza klatką).
//
// 2026-10-15 (optymalizacja przestojów — wypiek kawałka bazy piratów w klatce trwał 40–210 ms): pula wierzchołków to
// JEDNA Float64Array (17 liczb na wierzchołek — te same podwójne precyzje co dawne tablice JS), trójkąty to indeksy
// puli (podział rekurencyjny w tej samej kolejności), geometria Z INDEKSEM (wierzchołek puli dzielony przez trójkąty
// podziału — dawniej każdy trójkąt miał własne 3 kopie: pomost NP 252 tys. trójkątów = 72 MB atrybutów wysyłanych na
// GPU w klatce pojawienia się skóry; z indeksem ~4× mniej), kotwica kratownicy liczona raz na wierzchołek puli, sfera
// ograniczająca tym samym algorytmem co BufferGeometry.computeBoundingSphere three (pudło z float32, środek, największa
// odległość). Trójkąty i atrybuty ich wierzchołków BIT W BIT jak dawny wypiek na tablicach tablic (dawna geometria =
// rozwinięcie indeksu) — strażnik: tests/portBuildingSkinBake.test.mjs (wzorzec dawnego kodu:
// tests/helpers/portBuildingSkinReference.mjs). Zmiana wypieku = zmiana wzorca świadomie.

/** Rodzaje brył budowli w kolejności zestawów sceny (portBuildingScene.js). */
export const SKIN_KINDS = Object.freeze(['box', 'cyl', 'torus', 'cone']);
/** Przeplot atrybutów skóry: aPbA(4) aPbN(4) aPbFx(4) aLat(3) aOwn(3). */
export const SKIN_INTER_STRIDE = 18;
const K = 17;   // liczby wierzchołka puli: x y z (model ciała), normalna, lx ly lz, materiał, normalna bryły, efekt(4)

/**
 * Mapa „najbliższa zajęta komórka” kratownicy (BFS 8-sąsiedni od komórek konstrukcji): Int32Array nx·ny z indeksem
 * komórki zajętej (x + y·nx). Wierzchołek poza zasięgiem okna kotwicy hullSkin3D (2 komórki) dostaje komórkę
 * z tej mapy.
 */
export function nearestOccupied(lattice) {
  const nx = lattice.dims.x, ny = lattice.dims.y, occ = lattice.occ;
  const near = new Int32Array(nx * ny).fill(-1);
  const q = new Int32Array(nx * ny);
  let head = 0, tail = 0;
  for (let i = 0; i < nx * ny; i++) if (occ[i]) { near[i] = i; q[tail++] = i; }
  while (head < tail) {
    const i = q[head++];
    const x = i % nx, y = (i / nx) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= nx || Y >= ny) continue;
        const j = X + Y * nx;
        if (near[j] >= 0) continue;
        near[j] = near[i];
        q[tail++] = j;
      }
    }
  }
  return near;
}

/** To samo dla kratownicy 3D (bryły budowli — wieża habitatu, dysk): Int32Array nx·ny·nz (BFS 26-sąsiedni). */
export function nearestOccupied3D(lattice) {
  const nx = lattice.dims.x, ny = lattice.dims.y, nz = lattice.dims.z, occ = lattice.occ;
  const n = nx * ny * nz, sxy = nx * ny;
  const near = new Int32Array(n).fill(-1);
  const q = new Int32Array(n);
  let head = 0, tail = 0;
  for (let i = 0; i < n; i++) if (occ[i]) { near[i] = i; q[tail++] = i; }
  while (head < tail) {
    const i = q[head++];
    const z = (i / sxy) | 0, rem = i - z * sxy, y = (rem / nx) | 0, x = rem - y * nx;
    for (let dz = -1; dz <= 1; dz++) {
      const Z = z + dz;
      if (Z < 0 || Z >= nz) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const Y = y + dy;
        if (Y < 0 || Y >= ny) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const X = x + dx;
          if (X < 0 || X >= nx || (!dx && !dy && !dz)) continue;
          const j = X + Y * nx + Z * sxy;
          if (near[j] >= 0) continue;
          near[j] = near[i];
          q[tail++] = j;
        }
      }
    }
  }
  return near;
}

/**
 * Wejście wypieku z zestawów sceny budowli (scene.sets): rekordy instancji GRUPY kawałka w kolejności dawnego wypieku
 * (bg: bg × rodzaje; fg: fg × rodzaje, potem roof × rodzaje — dach jedzie skórą FG). Rekordy kopiowane do tablicy tego
 * samego typu co źródło (bez zaokrągleń). Zwraca { bg: [{ kind, inst }], fg: [...] }.
 */
export function skinBakeParts(sets, group, stride) {
  const parts = { bg: [], fg: [] };
  for (const set of ['bg', 'fg']) {
    for (const src of set === 'fg' ? ['fg', 'roof'] : ['bg']) {
      const S = sets[src];
      if (!S) continue;
      for (const kind of SKIN_KINDS) {
        const a = S[kind];
        if (!a || !a.length) continue;
        let n = 0;
        for (let i = 0; i < a.length; i += stride) if (a[i + 12] === group) n++;
        if (!n) continue;
        const Ctor = ArrayBuffer.isView(a) ? a.constructor : Float64Array;
        const inst = new Ctor(n * stride);
        let o = 0;
        for (let i = 0; i < a.length; i += stride) {
          if (a[i + 12] !== group) continue;
          for (let k = 0; k < stride; k++) inst[o + k] = a[i + k];
          o += stride;
        }
        parts[set].push({ kind, inst });
      }
    }
  }
  return parts;
}

/**
 * Wypiek W KROKACH (generator: yield co porcję pracy; wynik w `value` po `done`). input:
 *   bases  — { box|cyl|torus|cone: { pos, nor (Float32Array xyz bryły bazowej bez indeksu), count } },
 *   parts  — skinBakeParts(...), stride — PB_STRIDE,
 *   cx, cz — środek rastra ciała w układzie budowli, lattice — { cs, dims: { x, y, z }, occ, ax, ay, az },
 *   maxEdgeCells — najdłuższa krawędź trójkąta po podziale [komórki].
 * Wynik: { bg, fg, triangles }, zestaw = { pos, nor, inter (Float32Array; inter — SKIN_INTER_STRIDE; wierzchołki
 * puli), index (Uint32Array — trójkąty), sphere: [x, y, z, r] } albo null.
 */
export function* bakeSkinCoreSteps({ bases, parts, stride, cx, cz, lattice, maxEdgeCells = 2 }) {
  const out = { bg: null, fg: null, triangles: 0 };
  if (!lattice || !parts || !bases) return out;
  const cs = lattice.cs, nx = lattice.dims.x, ny = lattice.dims.y, occ = lattice.occ;
  const nzL = Math.max(1, lattice.dims.z | 0), solid = nzL > 1, sxy = nx * ny;
  const ox = lattice.ax, oy = lattice.ay;     // środek rastra względem latticeMin
  const oz = Number(lattice.az) || 0;         // bryła 3D: początek układu bryły względem latticeMin w z
  const near = solid ? nearestOccupied3D(lattice) : nearestOccupied(lattice);
  const maxEdge2 = (maxEdgeCells * cs) ** 2;
  for (const set of ['bg', 'fg']) {
    const list = parts[set] || [];
    // --- wierzchołki instancji w układzie ciała (pula: K liczb na wierzchołek) ---
    let nIn = 0;
    for (const p of list) { const b = bases[p.kind]; if (b) nIn += Math.floor(p.inst.length / stride) * b.count; }
    if (!nIn) continue;
    let V = new Float64Array((nIn + (nIn >> 1) + 64) * K);
    let nv = 0, work = 0;
    for (const p of list) {
      const b = bases[p.kind];
      if (!b) continue;
      const a = p.inst, P = b.pos, N = b.nor, cnt = b.count;
      for (let i = 0; i + stride <= a.length; i += stride) {
        const c0 = a[i], c1 = a[i + 1], c2 = a[i + 2], vs = a[i + 3];
        const sx = a[i + 4], sy = a[i + 5], sz = a[i + 6], mat = a[i + 7];
        const qx = a[i + 8], qy = a[i + 9], qz = a[i + 10], qw = a[i + 11];
        const f0 = a[i + 16], f1 = a[i + 17], f2 = a[i + 18], f3 = a[i + 19];
        const isx = Math.max(1e-3, sx), isy = Math.max(1e-3, sy), isz = Math.max(1e-3, sz), ivs = Math.max(1e-3, vs);
        for (let v = 0; v < cnt; v++) {
          const v3 = v * 3;
          const px = P[v3], py = P[v3 + 1], pz = P[v3 + 2];
          const bnx = N[v3], bny = N[v3 + 1], bnz = N[v3 + 2];
          const l0 = px * sx, l1 = py * sy, l2 = pz * sz;
          // obrót kwaternionem (dawne qrot: t = 2·q × v; v + w·t + q × t)
          let tx = 2 * (qy * l2 - qz * l1);
          let ty = 2 * (qz * l0 - qx * l2);
          let tz = 2 * (qx * l1 - qy * l0);
          const r0 = l0 + qw * tx + (qy * tz - qz * ty);
          const r1 = l1 + qw * ty + (qz * tx - qx * tz);
          const r2 = l2 + qw * tz + (qx * ty - qy * tx);
          const hx = c0 + r0, hy = c1 + r1 * vs, hz = c2 + r2;
          let nnx = bnx / isx, nny = bny / isy, nnz = bnz / isz;
          let nlen = Math.hypot(nnx, nny, nnz) || 1;
          const ux = nnx / nlen, uy = nny / nlen, uz = nnz / nlen;
          tx = 2 * (qy * uz - qz * uy);
          ty = 2 * (qz * ux - qx * uz);
          tz = 2 * (qx * uy - qy * ux);
          nnx = ux + qw * tx + (qy * tz - qz * ty);
          nny = (uy + qw * ty + (qz * tx - qx * tz)) / ivs;
          nnz = uz + qw * tz + (qx * ty - qy * tx);
          nlen = Math.hypot(nnx, nny, nnz) || 1;
          // układ budowli (x, wysokość, z) → model ciała (x − cx, cz − z, wysokość)
          const o = nv * K;
          V[o] = hx - cx; V[o + 1] = cz - hz; V[o + 2] = hy;
          V[o + 3] = nnx / nlen; V[o + 4] = -nnz / nlen; V[o + 5] = nny / nlen;
          V[o + 6] = l0; V[o + 7] = l1; V[o + 8] = l2; V[o + 9] = mat;
          V[o + 10] = bnx; V[o + 11] = bny; V[o + 12] = bnz;
          V[o + 13] = f0; V[o + 14] = f1; V[o + 15] = f2; V[o + 16] = f3;
          nv++;
        }
        work += cnt;
        if (work >= 16384) { work = 0; yield; }
      }
    }
    // --- podział trójkątów (ciało płaskie: w rzucie x, y; bryła 3D: w przestrzeni) wzdłuż najdłuższej krawędzi ---
    let T = new Uint32Array(Math.max(48, nIn * 2));
    let nt = 0;
    const tri = (a, b, c) => {
      if (nt + 3 > T.length) { const g = new Uint32Array(T.length * 2); g.set(T); T = g; }
      T[nt] = a; T[nt + 1] = b; T[nt + 2] = c;
      nt += 3;
    };
    const mid = (a, b) => {
      if ((nv + 1) * K > V.length) { const g = new Float64Array(V.length * 2); g.set(V); V = g; }
      const o = nv * K, oa = a * K, ob = b * K;
      for (let k = 0; k < K; k++) V[o + k] = (V[oa + k] + V[ob + k]) * 0.5;
      const l = Math.hypot(V[o + 3], V[o + 4], V[o + 5]) || 1;
      V[o + 3] /= l; V[o + 4] /= l; V[o + 5] /= l;
      V[o + 9] = V[oa + 9];
      V[o + 13] = V[oa + 13]; V[o + 14] = V[oa + 14]; V[o + 15] = V[oa + 15]; V[o + 16] = V[oa + 16];
      return nv++;
    };
    const e2 = solid
      ? (a, b) => { const oa = a * K, ob = b * K; return (V[oa] - V[ob]) ** 2 + (V[oa + 1] - V[ob + 1]) ** 2 + (V[oa + 2] - V[ob + 2]) ** 2; }
      : (a, b) => { const oa = a * K, ob = b * K; return (V[oa] - V[ob]) ** 2 + (V[oa + 1] - V[ob + 1]) ** 2; };
    const split = (a, b, c, depth) => {
      const ab = e2(a, b), bc = e2(b, c), ca = e2(c, a);
      const m = Math.max(ab, bc, ca);
      if (depth >= 14 || m <= maxEdge2) { tri(a, b, c); return; }
      if (m === ab) { const M = mid(a, b); split(a, M, c, depth + 1); split(M, b, c, depth + 1); }
      else if (m === bc) { const M = mid(b, c); split(a, b, M, depth + 1); split(a, M, c, depth + 1); }
      else { const M = mid(c, a); split(a, b, M, depth + 1); split(M, b, c, depth + 1); }
    };
    let lastNt = 0;
    for (let j = 0; j + 2 < nIn; j += 3) {
      split(j, j + 1, j + 2, 0);
      if (nt - lastNt >= 24576) { lastNt = nt; yield; }
    }
    yield;
    // --- atrybuty wierzchołków PULI (geometria z indeksem: wierzchołek dzielony przez trójkąty podziału — te same
    // trójkąty i atrybuty co dawna geometria bez indeksu, 3–5× mniej danych), kotwica kratownicy raz na wierzchołek ---
    const n = nt;
    const index = T.length === n ? T : T.slice(0, n);
    const pos = new Float32Array(nv * 3);
    const nor = new Float32Array(nv * 3);
    const STR = SKIN_INTER_STRIDE;
    const inter = new Float32Array(nv * STR);
    for (let vi = 0; vi < nv; vi++) {
      if ((vi & 16383) === 16383) yield;
      const ov = vi * K;
      const vx = V[ov], vy = V[ov + 1], vz = V[ov + 2];
      const j3 = vi * 3;
      pos[j3] = vx; pos[j3 + 1] = vy; pos[j3 + 2] = vz;
      nor[j3] = V[ov + 3]; nor[j3 + 1] = V[ov + 4]; nor[j3 + 2] = V[ov + 5];
      const o = vi * STR;
      inter[o] = V[ov + 6]; inter[o + 1] = V[ov + 7]; inter[o + 2] = V[ov + 8]; inter[o + 3] = V[ov + 9];
      inter[o + 4] = V[ov + 10]; inter[o + 5] = V[ov + 11]; inter[o + 6] = V[ov + 12]; inter[o + 7] = 0;
      inter[o + 8] = V[ov + 13]; inter[o + 9] = V[ov + 14]; inter[o + 10] = V[ov + 15]; inter[o + 11] = V[ov + 16];
      // kratownica: komórki od latticeMin (środek komórki i = (i + ½)·cs)
      const fx = (vx + ox) / cs - 0.5, fy = (vy + oy) / cs - 0.5;
      if (solid) {
        const fz = (vz + oz) / cs - 0.5;
        inter[o + 12] = fx; inter[o + 13] = fy; inter[o + 14] = fz;
        {
          const rx = Math.round(fx), ry = Math.round(fy), rz = Math.round(fz);
          let bx = -1, by = -1, bz = -1, best = Infinity;
          for (let R = 1; R <= 2 && bx < 0; R++) {
            for (let z = rz - R; z <= rz + R; z++) {
              if (z < 0 || z >= nzL) continue;
              for (let y = ry - R; y <= ry + R; y++) {
                if (y < 0 || y >= ny) continue;
                for (let x = rx - R; x <= rx + R; x++) {
                  if (x < 0 || x >= nx || !occ[x + y * nx + z * sxy]) continue;
                  const dd = (x - fx) ** 2 + (y - fy) ** 2 + (z - fz) ** 2;
                  if (dd < best) { best = dd; bx = x; by = y; bz = z; }
                }
              }
            }
          }
          if (bx < 0) {
            const cxl = Math.max(0, Math.min(nx - 1, rx)), cyl = Math.max(0, Math.min(ny - 1, ry)), czl = Math.max(0, Math.min(nzL - 1, rz));
            const k = near[cxl + cyl * nx + czl * sxy];
            if (k >= 0) { bz = (k / sxy) | 0; const rem = k - bz * sxy; by = (rem / nx) | 0; bx = rem - by * nx; }
            else { bx = cxl; by = cyl; bz = czl; }
          }
          inter[o + 15] = bx; inter[o + 16] = by; inter[o + 17] = bz;
        }
        continue;
      }
      inter[o + 12] = fx; inter[o + 13] = fy; inter[o + 14] = 0;
      // kotwica widoczności: najbliższa zajęta komórka w oknie 3×3 / 5×5, dalej — mapa najbliższej komórki
      const rx = Math.round(fx), ry = Math.round(fy);
      let bx = -1, by = -1, best = Infinity;
      for (let R = 1; R <= 2 && bx < 0; R++) {
        for (let y = ry - R; y <= ry + R; y++) {
          if (y < 0 || y >= ny) continue;
          for (let x = rx - R; x <= rx + R; x++) {
            if (x < 0 || x >= nx || !occ[x + y * nx]) continue;
            const dd = (x - fx) ** 2 + (y - fy) ** 2;
            if (dd < best) { best = dd; bx = x; by = y; }
          }
        }
      }
      if (bx < 0) {
        const cxl = Math.max(0, Math.min(nx - 1, rx)), cyl = Math.max(0, Math.min(ny - 1, ry));
        const k = near[cxl + cyl * nx];
        if (k >= 0) { bx = k % nx; by = (k / nx) | 0; } else { bx = cxl; by = cyl; }
      }
      inter[o + 15] = bx; inter[o + 16] = by; inter[o + 17] = 0;
    }
    // sfera ograniczająca — algorytm BufferGeometry.computeBoundingSphere three r183 (Box3 z float32, środek pudła,
    // największy kwadrat odległości) po wierzchołkach TRÓJKĄTÓW (indeks; ten sam zbiór co dawna geometria bez indeksu)
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let j = 0; j < n; j++) {
      const p = index[j] * 3;
      const x = pos[p], y = pos[p + 1], z = pos[p + 2];
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); z0 = Math.min(z0, z);
      x1 = Math.max(x1, x); y1 = Math.max(y1, y); z1 = Math.max(z1, z);
    }
    let scx = 0, scy = 0, scz = 0;
    if (!(x1 < x0 || y1 < y0 || z1 < z0)) { scx = (x0 + x1) * 0.5; scy = (y0 + y1) * 0.5; scz = (z0 + z1) * 0.5; }
    let r2 = 0;
    for (let j = 0; j < n; j++) {
      const p = index[j] * 3;
      const dx = scx - pos[p], dy = scy - pos[p + 1], dz = scz - pos[p + 2];
      r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
    }
    out[set] = { pos, nor, inter, index, sphere: [scx, scy, scz, Math.sqrt(r2)] };
    out.triangles += n / 3;
  }
  return out;
}

/** bakeSkinCoreSteps do końca (worker, testy). */
export function bakeSkinCore(input) {
  const it = bakeSkinCoreSteps(input);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}
