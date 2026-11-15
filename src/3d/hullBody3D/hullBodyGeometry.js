// src/3d/hullBody3D/hullBodyGeometry.js
//
// BRYŁA KADŁUBA pod wierzchem z kreatora (docs/OPIS-miasto-3d.md § 11; demo dema/miasto-3d.html i generator
// dema/kreator-kadluba-webgpu.html). Wierzch zostaje obrazem kompozytora na skórze kadłuba (z = 0); ten moduł liczy
// to, co pod nim: BURTĘ (pierścienie przesunięte do środka sylwetki: faza, ściana, rów ze światłami, dolna faza, okap)
// i SPÓD (siatka wysokości z odległości od burty — odwrócony daszek z grzbietem wzdłuż osi, jak spód klina).
// Czysty JS na budowniczym modeli gry (src/3d/ships3d/meshBuilder3D.js — pozycja, normalna, uv, numer materiału
// palety SHIP3D_MAT), więc bryłę rysuje ten sam materiał co modele floty (createShipMaterial) i da się ją wpiąć do
// „Statków 3D” jak inne modele. Działa w Node (test).
//
// Układ: scena — x jak projekt, y sceny = −y projektu (jak miasto 3D), z w górę; środek okrętu = (0, 0). Cała bryła
// leży POD płaszczyzną (z ≤ 0) i W sylwetce: z góry (kamera gry) zasłania ją skóra kadłuba — obraz bez zmian.

import { MeshBuilder3D, SHIP3D_MAT as M, ensureCCW, polyArea, pointInPoly } from '../ships3d/meshBuilder3D.js';

/**
 * Strojenie bryły (j. przy szerokości odniesienia `refWidth`; mniejszy okręt — proporcjonalnie cieńszy).
 * `profile` — pierścienie burty od krawędzi wierzchu w dół: [przesunięcie do środka, z, materiał ściany POWYŻEJ
 * pierścienia (od poprzedniego)]. Rów: sufit, tylna ściana ze światłami, dolna warga.
 */
export const HULL_BODY_TUNE = Object.freeze({
  refWidth: 3816,
  profile: Object.freeze([
    [0, 0, null],
    [3, -3, M.BRIGHT],      // faza krawędzi wierzchu (łapie światło)
    [5, -34, M.PAINT],      // górna ściana burty
    [17, -38, M.PANEL],     // sufit rowu
    [17, -62, M.DARK],      // tylna ściana rowu (światła)
    [6, -66, M.PANEL],      // dolna warga rowu
    [12, -92, M.PAINT],     // dolna ściana
    [40, -112, M.PANEL],    // dolna faza
    [130, -116, M.PAINT]    // okap spodu (pod nim brzeg siatki spodu)
  ]),
  grooveRing: 4,            // pierścień tylnej ściany rowu (światła)
  lights: Object.freeze({ step: 9, w: 4, h: 3, z: -50, z2: -43, group: 12, groupOn: 0.34, slotOn: 0.62, blue: 0.3, row2: 0.18 }),
  bottom: Object.freeze({ cell: 24, dMin: 60, dFlat: 100, zFlat: -110, slope: 0.28, depth: 560 }),
  miterMax: 8,              // najdłuższe przesunięcie narożnika (× przesunięcie)
  reachK: 0.48              // pierścień nie przechodzi dalej niż ten ułamek drogi do przeciwnej burty (wąskie zęby)
});

/** Uproszczenie łamanej otwartej (Douglas–Peucker, tolerancja tol [j.]). */
function simplifyOpen(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const a = pts[i0], b = pts[i1];
    const ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey) || 1;
    let best = -1, bi = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const d = Math.abs((pts[i][0] - a[0]) * ey - (pts[i][1] - a[1]) * ex) / l;
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; stack.push([i0, bi], [bi, i1]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * Obrys ramy z POLA kreatora: izolinia 0 pola poziomu 0 (`field.levels[0]`, ujemne wewnątrz — ta sama sylwetka co
 * alfa kadłuba i kompozytor; rama drednota to suma brył, więc `field.loops[0]` bywa puste). Marching squares co
 * `step` j. (interpolacja liniowa — boki proste dokładnie, narożniki do kroku), uproszczenie `tol` j. Zwraca łamane
 * w układzie projektu (jak `field.loops`).
 */
export function hullBodyLoopsFromField(field, { step = 4, tol = 0.6 } = {}) {
  const L0 = field?.levels?.[0], G = field?.grid;
  if (!L0 || !G) return [];
  const s = Math.max(1, Math.round(step * G.res));
  const nx = Math.floor((G.w - 1) / s) + 1, ny = Math.floor((G.h - 1) / s) + 1;
  const v = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? 1 : L0[(j * s) * G.w + i * s]);
  const inv = 1 / G.res;
  const px = (i) => G.x0 + (i * s + 0.5) * inv, py = (j) => G.y0 + (j * s + 0.5) * inv;
  // punkty na krawędziach siatki: id = 2 · (j · (nx + 1) + i) (+1 — pionowa), siatka rozszerzona o 1 (poza = na zewnątrz)
  const W1 = nx + 2;
  const eid = (i, j, vert) => 2 * ((j + 1) * W1 + (i + 1)) + (vert ? 1 : 0);
  const pt = new Map();
  const edgePoint = (i, j, vert) => {
    const id = eid(i, j, vert);
    if (!pt.has(id)) {
      const a = v(i, j), b = vert ? v(i, j + 1) : v(i + 1, j);
      const t = Math.max(0, Math.min(1, a / (a - b)));
      pt.set(id, vert ? [px(i), py(j) + t * s * inv] : [px(i) + t * s * inv, py(j)]);
    }
    return id;
  };
  const adj = new Map();
  const link = (e0, e1) => {
    (adj.get(e0) || adj.set(e0, []).get(e0)).push(e1);
    (adj.get(e1) || adj.set(e1, []).get(e1)).push(e0);
  };
  for (let j = -1; j < ny; j++) {
    for (let i = -1; i < nx; i++) {
      const a = v(i, j), b = v(i + 1, j), c = v(i + 1, j + 1), d = v(i, j + 1);
      const ca = a < 0, cb = b < 0, cc = c < 0, cd = d < 0;
      if (ca === cb && cb === cc && cc === cd) continue;
      const E = [];
      if (ca !== cb) E.push(['B', edgePoint(i, j, false)]);
      if (cb !== cc) E.push(['R', edgePoint(i + 1, j, true)]);
      if (cd !== cc) E.push(['T', edgePoint(i, j + 1, false)]);
      if (ca !== cd) E.push(['L', edgePoint(i, j, true)]);
      if (E.length === 2) { link(E[0][1], E[1][1]); continue; }
      const e = Object.fromEntries(E);
      const centerIn = (a + b + c + d) < 0;
      // siodło: a i c po jednej stronie, b i d po drugiej
      const acIn = ca;
      if (acIn === centerIn) { link(e.B, e.R); link(e.T, e.L); } else { link(e.B, e.L); link(e.R, e.T); }
    }
  }
  const loops = [];
  const seen = new Set();
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const chain = [];
    let prev = -1, cur = start;
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur);
      chain.push(pt.get(cur));
      const nb = adj.get(cur) || [];
      const next = nb[0] !== prev ? nb[0] : nb[1];
      prev = cur; cur = next;
    }
    if (chain.length < 3) continue;
    // zamknięta: uproszczenie w dwóch połowach (od punktu 0 do najdalszego od niego)
    let far = 0, fd = -1;
    for (let k = 1; k < chain.length; k++) {
      const d = Math.hypot(chain[k][0] - chain[0][0], chain[k][1] - chain[0][1]);
      if (d > fd) { fd = d; far = k; }
    }
    const h1 = simplifyOpen(chain.slice(0, far + 1), tol);
    const h2 = simplifyOpen(chain.slice(far).concat([chain[0]]), tol);
    const loop = h1.concat(h2.slice(1, -1));
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/** Obrys bryły: największa łamana poziomu 0 (rama) w układzie sceny (y → −y), przeciwnie do zegara. */
export function hullBodyOutline(loops0) {
  let best = null, bestA = 0;
  for (const l of loops0 || []) {
    if (!l || l.length < 3) continue;
    const a = Math.abs(polyArea(l));
    if (a > bestA) { bestA = a; best = l; }
  }
  if (!best) return null;
  return ensureCCW(best.map(([x, y]) => [x, -y]));
}

function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Przecięcie promienia p + t·d (t > eps) z bokami wielokąta — najmniejsze t (Infinity, gdy brak). */
function rayHit(poly, px, py, dx, dy, skipA, skipB) {
  let best = Infinity;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    if (i === skipA || i === skipB) continue;
    const a = poly[i], b = poly[(i + 1) % n];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const wx = a[0] - px, wy = a[1] - py;
    const t = (wx * ey - wy * ex) / den;
    const u = (wx * dy - wy * dx) / den;
    if (t > 1e-6 && u >= -1e-9 && u <= 1 + 1e-9 && t < best) best = t;
  }
  return best;
}

/**
 * Pierścienie: dla każdego wierzchołka dwusieczna do środka, mnożnik narożnika (1 / cos ½ kąta normalnych) i zasięg
 * (ułamek drogi do przeciwnej burty) — przesunięcie o `o` = min(o · k, zasięg, o · miterMax).
 */
function ringFrames(poly, T) {
  const n = poly.length;
  const fr = [];
  for (let i = 0; i < n; i++) {
    const p = poly[(i - 1 + n) % n], v = poly[i], q = poly[(i + 1) % n];
    let ax = v[0] - p[0], ay = v[1] - p[1];
    let bx = q[0] - v[0], by = q[1] - v[1];
    const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1;
    ax /= la; ay /= la; bx /= lb; by /= lb;
    // normalne do środka (CCW: lewa strona krawędzi)
    const n0x = -ay, n0y = ax, n1x = -by, n1y = bx;
    let mx = n0x + n1x, my = n0y + n1y;
    let ml = Math.hypot(mx, my);
    if (ml < 1e-6) { mx = -ax; my = -ay; ml = 1; }
    mx /= ml; my /= ml;
    const c = mx * n0x + my * n0y;
    const k = c > 1e-3 ? 1 / c : T.miterMax;
    const hit = rayHit(poly, v[0], v[1], mx, my, (i - 1 + n) % n, i);
    fr.push({ x: v[0], y: v[1], mx, my, k: Math.min(k, T.miterMax), reach: Number.isFinite(hit) ? hit * T.reachK : 1e9 });
  }
  return fr;
}

function ringAt(fr, o) {
  return fr.map((f) => {
    const s = Math.min(o * f.k, f.reach);
    return [f.x + f.mx * s, f.y + f.my * s];
  });
}

/** Odległość punktu od boków wielokąta (bez znaku). */
function edgeDistance(segs, px, py) {
  let best = Infinity;
  for (let i = 0; i < segs.length; i += 6) {
    const ax = segs[i], ay = segs[i + 1], ex = segs[i + 2], ey = segs[i + 3], il = segs[i + 4];
    let t = ((px - ax) * ex + (py - ay) * ey) * il;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = px - (ax + ex * t), dy = py - (ay + ey * t);
    const d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/**
 * Bryła pod wierzchem: `loops0` — łamane poziomu 0 z pola kreatora (`field.loops[0]`, układ projektu). Opcje:
 * `scale` (domyślnie z szerokości sylwetki / refWidth, ≤ 1), `bottom: false` — bez spodu, `lights: false` — bez świateł.
 * Zwraca dane budowniczego ({ position, normal, uv, mat, index (Uint32), vertexCount, triangleCount }) + `stats`
 * albo null (brak obrysu).
 */
export function buildHullBodyGeometry(loops0, opts = {}) {
  const T = HULL_BODY_TUNE;
  const poly = hullBodyOutline(loops0);
  if (!poly) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const k = opts.scale ?? Math.max(0.05, Math.min(1, (y1 - y0) / T.refWidth));
  const B = new MeshBuilder3D();
  const fr = ringFrames(poly, T);
  // ── BURTA: ściany między kolejnymi pierścieniami profilu ──────────────────────────────────────────────────────
  const rings = T.profile.map(([o, z]) => ({ pts: ringAt(fr, o * k), z: z * k }));
  for (let r = 1; r < rings.length; r++) {
    const up = rings[r - 1], lo = rings[r];
    B.walls(lo.pts, lo.z, up.pts, up.z, T.profile[r][2]);
  }
  // ── ŚWIATŁA w rowie: rzadkie grupy na tylnej ścianie (krótkie kwadraty lekko przed ścianą) ─────────────────────
  let nLights = 0;
  if (opts.lights !== false) {
    const L = T.lights;
    const g = rings[T.grooveRing].pts;
    const zA = L.z * k, zB = L.z2 * k, hh = L.h * k * 0.5, hw = L.w * k * 0.5, stepL = L.step * k;
    let slot = 0;
    for (let i = 0; i < g.length; i++) {
      const a = g[i], b = g[(i + 1) % g.length];
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const len = Math.hypot(ex, ey);
      if (len < stepL * 1.5) continue;
      const ux = ex / len, uy = ey / len;
      // na zewnątrz (CCW: prawa strona) — kwadrat 0,4 j. przed ścianą
      const ox = uy * 0.4 * k, oy = -ux * 0.4 * k;
      for (let s = stepL; s < len - stepL * 0.5; s += stepL, slot++) {
        const grp = Math.floor(slot / L.group);
        if (hash1(grp * 3.1) > L.groupOn) continue;
        if (hash1(slot * 1.7 + 0.3) > L.slotOn) continue;
        const mat = hash1(grp * 5.3 + 1.1) < L.blue ? M.E_ICE : M.E_WINDOW;
        const cx = a[0] + ux * s + ox, cy = a[1] + uy * s + oy;
        for (const [zc, on] of [[zA, true], [zB, hash1(slot * 2.9) < L.row2]]) {
          if (!on) continue;
          B.face([
            [cx - ux * hw, cy - uy * hw, zc - hh], [cx + ux * hw, cy + uy * hw, zc - hh],
            [cx + ux * hw, cy + uy * hw, zc + hh], [cx - ux * hw, cy - uy * hw, zc + hh]
          ], mat, [uy, -ux, 0]);
          nLights++;
        }
      }
    }
  }
  const side = B.build();
  // ── SPÓD: siatka wysokości z odległości od burty (płaski pod okapem, dalej w dół ku osi do `depth`) ─────────────
  const pos = [], nrm = [], uvs = [], mats = [], idx = [];
  let cells = 0, deepest = 0;
  if (opts.bottom !== false) {
    const Bt = T.bottom;
    const cell = Bt.cell * k, dMin = Bt.dMin * k, dFlat = Bt.dFlat * k, zFlat = Bt.zFlat * k, depth = Bt.depth * k;
    const segs = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const l2 = ex * ex + ey * ey;
      segs.push(a[0], a[1], ex, ey, l2 > 0 ? 1 / l2 : 0, 0);
    }
    const nx = Math.max(2, Math.ceil((x1 - x0) / cell) + 1), ny = Math.max(2, Math.ceil((y1 - y0) / cell) + 1);
    const D = new Float32Array(nx * ny).fill(-1);
    const Z = new Float32Array(nx * ny);
    const zOf = (d) => (d < dFlat ? zFlat : Math.max(-depth, zFlat - Bt.slope * (d - dFlat)));
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = x0 + i * cell, y = y0 + j * cell;
        if (!pointInPoly(x, y, poly)) continue;
        const d = edgeDistance(segs, x, y);
        D[j * nx + i] = d;
        Z[j * nx + i] = zOf(d);
      }
    }
    const vid = new Int32Array(nx * ny).fill(-1);
    const vertex = (i, j) => {
      const q = j * nx + i;
      if (vid[q] >= 0) return vid[q];
      const x = x0 + i * cell, y = y0 + j * cell, z = Z[q];
      // normalna spodu (w dół) z różnic wysokości sąsiadów w środku
      const zl = D[q - 1] >= 0 && i > 0 ? Z[q - 1] : z, zr = i < nx - 1 && D[q + 1] >= 0 ? Z[q + 1] : z;
      const zd = j > 0 && D[q - nx] >= 0 ? Z[q - nx] : z, zu = j < ny - 1 && D[q + nx] >= 0 ? Z[q + nx] : z;
      const fx = (zr - zl) / (2 * cell), fy = (zu - zd) / (2 * cell);
      const l = Math.hypot(fx, fy, 1);
      vid[q] = pos.length / 3;
      pos.push(x, y, z);
      nrm.push(fx / l, fy / l, -1 / l);
      uvs.push(x, y);
      mats.push(M.PAINT);
      if (z < deepest) deepest = z;
      return vid[q];
    };
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const q = j * nx + i;
        if (D[q] < dMin || D[q + 1] < dMin || D[q + nx] < dMin || D[q + nx + 1] < dMin) continue;
        const a = vertex(i, j), b = vertex(i + 1, j), c = vertex(i + 1, j + 1), d = vertex(i, j + 1);
        // ściana w dół: kolejność zgodna z ruchem wskazówek widziana z góry
        idx.push(a, c, b, a, d, c);
        cells++;
      }
    }
  }
  // ── złożenie ─────────────────────────────────────────────────────────────────────────────────────────────────
  const vs = side.vertexCount, vb = pos.length / 3;
  const out = {
    position: new Float32Array((vs + vb) * 3),
    normal: new Float32Array((vs + vb) * 3),
    uv: new Float32Array((vs + vb) * 2),
    mat: new Float32Array(vs + vb),
    index: new Uint32Array(side.index.length + idx.length)
  };
  out.position.set(side.position); out.position.set(pos, vs * 3);
  out.normal.set(side.normal); out.normal.set(nrm, vs * 3);
  out.uv.set(side.uv); out.uv.set(uvs, vs * 2);
  out.mat.set(side.mat); out.mat.set(mats, vs);
  out.index.set(side.index);
  for (let i = 0; i < idx.length; i++) out.index[side.index.length + i] = idx[i] + vs;
  out.vertexCount = vs + vb;
  out.triangleCount = out.index.length / 3;
  out.stats = {
    scale: Math.round(k * 1000) / 1000, outline: poly.length, rings: rings.length, lights: nLights, bottomCells: cells,
    edgeDepth: Math.round(-rings[rings.length - 1].z), depth: Math.round(-deepest), triangles: out.triangleCount,
    box: [Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)]
  };
  return out;
}
