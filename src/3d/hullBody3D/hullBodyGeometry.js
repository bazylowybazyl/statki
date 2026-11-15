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
  // SPÓD (etap 2): WCIĘCIA w lustrze — w ułamkach pudła sylwetki (u = 0 rufa … 1 dziób, v = |y| / pół szerokości):
  // [u0, u1, v wewnętrzne, v zewnętrzne przy u0, przy u1]; głębokość (w górę, w kadłub), rampa ściany, odstęp od burty;
  // ZABUDOWA we wcięciach (bryły podwieszone pod stropem, rzadkie światła na ścianach)
  recess: Object.freeze({
    shapes: Object.freeze([
      [0.07, 0.31, 0, 0.44, 0.30],     // niecka rufowa
      [0.40, 0.80, 0, 0.15, 0.04],     // rów wzdłuż kila (przednia połowa)
      [0.21, 0.40, 0.50, 0.70, 0.62]   // para wcięć w skrzydłach
    ]),
    depth: 90, ramp: 26, edgeIn: 150, edgeRamp: 90
  }),
  district: Object.freeze({ cell: 30, fill: 0.82, foot: [0.5, 0.92], h: [10, 70], tower: 0.05, towerH: 1.15, lights: 0.16, light: [3, 2.2] }),
  // SILNIKI (etap 3): promień dużej dyszy = h gondoli × r, długość dyszy, głębokość bloku, środek dysz pod krawędzią
  // wierzchu, blok poniżej dysz (× R), małe dysze (× R) wyżej o smallUp × R
  engines: Object.freeze({ r: 0.92, length: 1.15, blockDepth: 1.2, drop: 1.35, below: 0.45, small: 0.36, smallUp: 0.62, seg: 20 }),
  // WIERZCH jako płytki dach (etap 1b — „góra kompletnie płaska, musi opuścić górę w dół”): spadek przy burcie [j.],
  // plateau (z = 0) od tej odległości od burty w głąb, pas pierścieni przy krawędzi, siatka dalej (brzeg pod pasem,
  // uniesiona o lift), cokoły pod modelami gry (mostki, rdzenie): z = 0 do r + pinIn, potem zbocze pinSlope
  top: Object.freeze({ drop: 225, plateau: 900, cell: 24, strip: Object.freeze([0, 30, 60]), gridMin: 20, resample: 40, pinIn: 24, pinSlope: 1.1, lift: 0.3 }),
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
 * Pierścień ścian wewnątrz dyszy: od c0 (promień r0) do c1 (r1) wzdłuż osi `ax` (bazy `u`, `v`), ściany zwrócone DO osi
 * (widać je od wylotu, patrząc w dyszę).
 */
function innerCone(B, c0, c1, r0, r1, u, v, seg, mat) {
  for (let s = 0; s < seg; s++) {
    const a0 = (s / seg) * Math.PI * 2, a1 = ((s + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
    const P = (c, r, a) => [c[0] + r * (u[0] * Math.cos(a) + v[0] * Math.sin(a)), c[1] + r * (u[1] * Math.cos(a) + v[1] * Math.sin(a)), c[2] + r * (u[2] * Math.cos(a) + v[2] * Math.sin(a))];
    const hint = [-(u[0] * Math.cos(am) + v[0] * Math.sin(am)), -(u[1] * Math.cos(am) + v[1] * Math.sin(am)), -(u[2] * Math.cos(am) + v[2] * Math.sin(am))];
    B.face([P(c0, r0, a0), P(c0, r0, a1), P(c1, r1, a1), P(c1, r1, a0)], mat, hint);
  }
}
/** Płaski pierścień (r0 … r1) w punkcie c, zwrócony w stronę `n`; r0 = 0 — tarcza. */
function annulus(B, c, r0, r1, u, v, n, seg, mat) {
  const P = (r, a) => [c[0] + r * (u[0] * Math.cos(a) + v[0] * Math.sin(a)), c[1] + r * (u[1] * Math.cos(a) + v[1] * Math.sin(a)), c[2] + r * (u[2] * Math.cos(a) + v[2] * Math.sin(a))];
  if (r0 <= 1e-6) {
    const ring = [];
    for (let s = 0; s < seg; s++) ring.push(P(r1, (s / seg) * Math.PI * 2));
    B.face(ring, mat, n);
    return;
  }
  for (let s = 0; s < seg; s++) {
    const a0 = (s / seg) * Math.PI * 2, a1 = ((s + 1) / seg) * Math.PI * 2;
    B.face([P(r0, a0), P(r1, a0), P(r1, a1), P(r0, a1)], mat, n);
  }
}
/**
 * Dysza MAIN osadzona w bloku: oś od c (tylna ściana bloku) w kierunku d (na zewnątrz), promień R, długość L —
 * obudowa (METAL), kołnierz wylotu (BRIGHT), ciemny stożek, żarzący się pas przy gardzieli (E_ENGINE), gorący rdzeń
 * (E_WHITE — barwy z palety strugi MAIN gry, HULL_BODY_PALETTE).
 */
function nozzle(B, c, d, R, L, seg) {
  const ref = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = [d[1] * ref[2] - d[2] * ref[1], d[2] * ref[0] - d[0] * ref[2], d[0] * ref[1] - d[1] * ref[0]];
  const ul = Math.hypot(u[0], u[1], u[2]) || 1;
  u[0] /= ul; u[1] /= ul; u[2] /= ul;
  const v = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
  const at = (t) => [c[0] + d[0] * t, c[1] + d[1] * t, c[2] + d[2] * t];
  B.cylinder(at(-2), at(L), R, R * 1.04, { seg, mat: M.METAL, capA: false, capB: false });
  annulus(B, at(L), R * 0.86, R * 1.04, u, v, d, seg, M.BRIGHT);
  innerCone(B, at(L * 0.42), at(L), R * 0.6, R * 0.86, u, v, seg, M.DARK);
  innerCone(B, at(6), at(L * 0.42), R * 0.36, R * 0.6, u, v, seg, M.E_ENGINE);
  annulus(B, at(6), 0, R * 0.36, u, v, d, seg, M.E_WHITE);
}

/**
 * BANK SILNIKÓW na rufie (etap 3): gondole MAIN projektu (`engines`: { x, y, w, h, rot } w układzie sceny) — za każdą
 * promień w stronę wylotu do burty; gondole na jednym odcinku burty dzielą BLOK (wystaje z rufy, sięga trochę poniżej
 * burty), w nim duże dysze w osiach gondol, małe dysze między nimi, żebra i otwory na tylnej ścianie bloku.
 */
function buildEngineBank(B, engines, poly, zEdgeAt, k, T) {
  const E = T.engines;
  const exits = [];
  for (const e of engines) {
    const dx = -Math.cos(e.rot || 0), dy = -Math.sin(e.rot || 0);
    const t = rayHit(poly, e.x, e.y, dx, dy, -1, -1);
    if (!Number.isFinite(t)) continue;
    exits.push({ x: e.x + dx * t, y: e.y + dy * t, dx, dy, R: Math.max(8 * k, (e.h || 40) * E.r), z: zEdgeAt(e.x + dx * t, e.y + dy * t) });
  }
  // bloki: wyloty o tym samym kierunku na jednej linii, blisko siebie
  exits.sort((a, b) => (a.dx - b.dx) || (a.dy - b.dy) || ((a.x * -a.dy + a.y * a.dx) - (b.x * -b.dy + b.y * b.dx)));
  const blocks = [];
  for (const ex of exits) {
    const b = blocks[blocks.length - 1];
    const along = ex.x * -ex.dy + ex.y * ex.dx;
    const depth = ex.x * ex.dx + ex.y * ex.dy;
    if (b && Math.abs(b.dx - ex.dx) < 1e-3 && Math.abs(b.dy - ex.dy) < 1e-3 && Math.abs(b.depth - depth) < 4 * k && along - b.a1 < ex.R * 3.2) {
      b.list.push(ex); b.a1 = along; b.R = Math.max(b.R, ex.R); b.z = Math.max(b.z, ex.z);
    } else blocks.push({ dx: ex.dx, dy: ex.dy, depth, a0: along, a1: along, R: ex.R, z: ex.z, list: [ex] });
  }
  let nNoz = 0;
  for (const b of blocks) {
    const R = b.R, D = E.blockDepth * R, L = E.length * R;
    const zTopB = b.z - 4 * k, zc = b.z - E.drop * R, zBot = zc - R - E.below * R;
    const pad = R * 1.25;
    // blok: w lokalnym układzie (x — na zewnątrz, y — wzdłuż burty)
    const e0 = b.list[0];
    const ang = Math.atan2(b.dy, b.dx);
    const cAlong = (b.a0 + b.a1) / 2, half = (b.a1 - b.a0) / 2 + pad;
    // środek bloku na burcie
    const bx = b.dx * b.depth + -b.dy * cAlong, by = b.dy * b.depth + b.dx * cAlong;
    B.push(); B.translate(bx, by, 0); B.rotateZ(ang);
    B.box(D / 2 - 3 * k, 0, (zTopB + zBot) / 2, D + 6 * k, half * 2, zTopB - zBot, { mat: M.PANEL });
    // żebra między dyszami i na końcach, otwory u dołu tylnej ściany
    const locs = b.list.map((ex) => (ex.x * -b.dy + ex.y * b.dx) - cAlong);
    const ribs = [-half + R * 0.25, half - R * 0.25];
    for (let i = 0; i < locs.length - 1; i++) ribs.push((locs[i] + locs[i + 1]) / 2);
    for (const ry of ribs) B.box(D + 3 * k, ry, (zTopB + zBot) / 2, 6 * k, 5 * k, zTopB - zBot - 4 * k, { mat: M.STEEL });
    for (let vy = -half + 14 * k; vy < half - 14 * k; vy += 22 * k) B.box(D + 1.5 * k, vy, zBot + 9 * k, 3 * k, 12 * k, 8 * k, { mat: M.DARK });
    B.pop();
    // dysze: duże w osiach gondol, małe między nimi (wyżej)
    const seg = E.seg;
    for (const ex of b.list) {
      const ox = ex.x + ex.dx * D, oy = ex.y + ex.dy * D;
      nozzle(B, [ox, oy, zc], [ex.dx, ex.dy, 0], ex.R, L, seg);
      nNoz++;
    }
    for (let i = 0; i < b.list.length - 1; i++) {
      const p = b.list[i], q = b.list[i + 1];
      const mx = (p.x + q.x) / 2 + p.dx * D, my = (p.y + q.y) / 2 + p.dy * D;
      nozzle(B, [mx, my, zc + R * E.smallUp], [p.dx, p.dy, 0], R * E.small, L * 0.6, 12);
      nNoz++;
    }
  }
  return nNoz;
}

/** Zagęszczenie łamanej zamkniętej: boki dłuższe niż `step` dzielone równo (wysokość wierzchu zmienia się wzdłuż burty). */
function densify(poly, step) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let s = 0; s < n; s++) out.push([a[0] + (b[0] - a[0]) * s / n, a[1] + (b[1] - a[1]) * s / n]);
  }
  return out;
}

/** Siatka wysokości (z, normalne, wierzchołki wspólne) w pudle; `zAt(x, y, d)`, `inc(d)` — czy wierzchołek należy. */
function heightGrid(box, cell, segs, poly, inc, zAt, down, matAt = null) {
  const [x0, y0, x1, y1] = box;
  const nx = Math.max(2, Math.ceil((x1 - x0) / cell) + 1), ny = Math.max(2, Math.ceil((y1 - y0) / cell) + 1);
  const D = new Float32Array(nx * ny).fill(-1);
  const Z = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * cell, y = y0 + j * cell;
      if (!pointInPoly(x, y, poly)) continue;
      const d = edgeDistance(segs, x, y);
      D[j * nx + i] = d;
      Z[j * nx + i] = zAt(x, y, d);
    }
  }
  const pos = [], nrm = [], idx = [], mats = [], bands = [];
  const vid = new Int32Array(nx * ny).fill(-1);
  const ok = (q) => D[q] >= 0 && inc(D[q]);
  const vertex = (i, j) => {
    const q = j * nx + i;
    if (vid[q] >= 0) return vid[q];
    const x = x0 + i * cell, y = y0 + j * cell, z = Z[q];
    const zl = i > 0 && ok(q - 1) ? Z[q - 1] : z, zr = i < nx - 1 && ok(q + 1) ? Z[q + 1] : z;
    const zd = j > 0 && ok(q - nx) ? Z[q - nx] : z, zu = j < ny - 1 && ok(q + nx) ? Z[q + nx] : z;
    const fx = (zr - zl) / (2 * cell), fy = (zu - zd) / (2 * cell);
    const l = Math.hypot(fx, fy, 1);
    vid[q] = pos.length / 3;
    pos.push(x, y, z);
    if (down) nrm.push(fx / l, fy / l, -1 / l); else nrm.push(-fx / l, -fy / l, 1 / l);
    if (matAt) mats.push(matAt(x, y, D[q]));
    bands.push(D[q]);
    return vid[q];
  };
  let cells = 0;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const q = j * nx + i;
      if (!ok(q) || !ok(q + 1) || !ok(q + nx) || !ok(q + nx + 1)) continue;
      const a = vertex(i, j), b = vertex(i + 1, j), c = vertex(i + 1, j + 1), d = vertex(i, j + 1);
      // w dół: zgodnie z ruchem wskazówek widziane z góry; w górę — przeciwnie
      if (down) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d);
      cells++;
    }
  }
  return { pos, nrm, idx, mats: matAt ? mats : null, bands, cells, grid: { x0, y0, cell, nx, ny, D, Z } };
}

/**
 * Bryła pod wierzchem i (z `opts.top`) sam WIERZCH. `loops0` — łamane poziomu 0 z pola kreatora (układ projektu).
 * Opcje: `scale` (domyślnie z szerokości sylwetki / refWidth, ≤ 1), `bottom: false`, `lights: false`,
 * `top: { drop, plateau, pins: [{ x, y, r }] (układ sceny), image: { minX, minY, w, h } (układ projektu) }` — wierzch jako
 * PŁYTKI DACH: najwyżej (z = 0) od `plateau` j. w głąb od burty, w dół liniowo do −`drop` przy burcie (j. przy szerokości
 * odniesienia); pod modelami gry (mostki, rdzenie — `pins`) cokół na z = 0 ze zboczem `pinSlope`. Burta, światła i spód
 * zaczynają się od obniżonej krawędzi. Wierzch ma materiał DECK z uv obrazu kompozytora (pudło `image`).
 * Zwraca dane budowniczego ({ position, normal, uv, mat, index (Uint32), vertexCount, triangleCount }) + `stats`
 * + `topGrid` (wysokość wierzchu na siatce — dla miasta) albo null (brak obrysu).
 */
export function buildHullBodyGeometry(loops0, opts = {}) {
  const T = HULL_BODY_TUNE, TT = T.top;
  const poly0 = hullBodyOutline(loops0);
  if (!poly0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly0) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const k = opts.scale ?? Math.max(0.05, Math.min(1, (y1 - y0) / T.refWidth));
  const top = opts.top || null;
  const drop = top ? Math.max(0, top.drop ?? TT.drop) * k : 0;
  const plateau = Math.max(1, (top?.plateau ?? TT.plateau) * k);
  const pins = top?.pins || [];
  const segs = [];
  for (let i = 0; i < poly0.length; i++) {
    const a = poly0[i], b = poly0[(i + 1) % poly0.length];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const l2 = ex * ex + ey * ey;
    segs.push(a[0], a[1], ex, ey, l2 > 0 ? 1 / l2 : 0, 0);
  }
  // wysokość wierzchu: dach od burty (−drop) do plateau (0), cokoły pod modelami gry
  const zTop = (x, y, d) => {
    if (drop <= 0) return 0;
    let z = -drop * Math.max(0, 1 - d / plateau);
    for (const p of pins) {
      const allow = Math.max(0, Math.hypot(x - p.x, y - p.y) - p.r - TT.pinIn * k) * TT.pinSlope;
      if (-allow > z) z = -allow;
    }
    return z;
  };
  const poly = top ? densify(poly0, TT.resample * k) : poly0;
  const B = new MeshBuilder3D();
  const fr = ringFrames(poly, T);
  const zEdge = fr.map((f) => zTop(f.x, f.y, 0));
  // pierścień o przesunięciu o: [x, y, osiągnięta odległość od burty, indeks wierzchołka]
  const ring = (o) => fr.map((f, i) => { const s = Math.min(o * f.k, f.reach); return [f.x + f.mx * s, f.y + f.my * s, s / f.k, i]; });
  const quads = (up, lo, zu, zl, mat, hintUp) => {
    const n = up.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const pts = [[lo[i][0], lo[i][1], zl(lo[i])], [lo[j][0], lo[j][1], zl(lo[j])], [up[j][0], up[j][1], zu(up[j])], [up[i][0], up[i][1], zu(up[i])]]
        .filter((p, q, arr) => { const r = arr[(q + 3) % 4]; return Math.hypot(p[0] - r[0], p[1] - r[1], p[2] - r[2]) > 1e-7; });
      if (pts.length < 3) continue;
      let ex = lo[j][0] - lo[i][0], ey = lo[j][1] - lo[i][1];
      if (Math.hypot(ex, ey) < 1e-9) { ex = up[j][0] - up[i][0]; ey = up[j][1] - up[i][1]; }
      B.face(pts, mat, hintUp ? [0, 0, 1] : [ey, -ex, 0]);
    }
  };
  // ── BURTA: od obniżonej krawędzi wierzchu w dół ───────────────────────────────────────────────────────────────
  const rings = T.profile.map(([o, z]) => ({ pts: ring(o * k), z: z * k }));
  for (let r = 1; r < rings.length; r++) {
    const up = rings[r - 1], lo = rings[r];
    quads(up.pts, lo.pts, (p) => zEdge[p[3]] + up.z, (p) => zEdge[p[3]] + lo.z, T.profile[r][2], false);
  }
  // ── ŚWIATŁA w rowie ───────────────────────────────────────────────────────────────────────────────────────────
  let nLights = 0;
  if (opts.lights !== false) {
    const L = T.lights;
    const g = rings[T.grooveRing].pts;
    const zA = L.z * k, zB = L.z2 * k, hh = L.h * k * 0.5, hw = L.w * k * 0.5, stepL = L.step * k;
    // światła liczone po bokach obrysu bez zagęszczenia (ten sam rytm co dawniej), wysokość z krawędzi w tym miejscu
    let slot = 0, carry = 0;   // droga od ostatniego miejsca na światło
    for (let i = 0; i < g.length; i++) {
      const a = g[i], b = g[(i + 1) % g.length];
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const len = Math.hypot(ex, ey);
      if (len < 1e-6) continue;
      const ux = ex / len, uy = ey / len;
      const ox = uy * 0.4 * k, oy = -ux * 0.4 * k;
      const za = zEdge[a[3]], zb = zEdge[b[3]];
      let s = stepL - carry;
      if (s >= len) { carry += len; continue; }
      for (; s < len; s += stepL, slot++) {
        const grp = Math.floor(slot / L.group);
        if (hash1(grp * 3.1) > L.groupOn) continue;
        if (hash1(slot * 1.7 + 0.3) > L.slotOn) continue;
        const mat = hash1(grp * 5.3 + 1.1) < L.blue ? M.E_ICE : M.E_WINDOW;
        const cx = a[0] + ux * s + ox, cy = a[1] + uy * s + oy, ze = za + (zb - za) * (s / len);
        for (const [zc, on] of [[zA, true], [zB, hash1(slot * 2.9) < L.row2]]) {
          if (!on) continue;
          B.face([
            [cx - ux * hw, cy - uy * hw, ze + zc - hh], [cx + ux * hw, cy + uy * hw, ze + zc - hh],
            [cx + ux * hw, cy + uy * hw, ze + zc + hh], [cx - ux * hw, cy - uy * hw, ze + zc + hh]
          ], mat, [uy, -ux, 0]);
          nLights++;
        }
      }
      carry = len - (s - stepL);
    }
  }
  // ── WIERZCH: pas pierścieni przy burcie (dokładna krawędź) + siatka wysokości dalej (jej brzeg pod pasem) ─────
  let topGrid = null, topCells = 0;
  const extra = [];   // { pos, nrm, idx, mat }
  if (top) {
    const strip = TT.strip.map((o) => ring(o * k));
    for (let r = 1; r < strip.length; r++) {
      quads(strip[r - 1], strip[r], (p) => zTop(p[0], p[1], p[2]), (p) => zTop(p[0], p[1], p[2]), M.DECK, true);
    }
    const lift = TT.lift;
    const tg = heightGrid([x0, y0, x1, y1], TT.cell * k, segs, poly0, (d) => d >= TT.gridMin * k, (x, y, d) => zTop(x, y, d) + lift, false);
    topCells = tg.cells;
    extra.push({ pos: tg.pos, nrm: tg.nrm, idx: tg.idx, mat: M.DECK });
    // dla miasta: wysokość wierzchu na siatce (poza sylwetką — wysokość krawędzi)
    const G = tg.grid;
    const H = new Float32Array(G.nx * G.ny);
    for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) {
      const q = j * G.nx + i;
      H[q] = G.D[q] >= 0 ? G.Z[q] - lift : zTop(G.x0 + i * G.cell, G.y0 + j * G.cell, 0);
    }
    topGrid = { x0: G.x0, y0: G.y0, cell: G.cell, nx: G.nx, ny: G.ny, data: H, drop: Math.round(drop) };
  }
  // ── SILNIKI: bank dysz na rufie za gondolami MAIN ─────────────────────────────────────────────────────────────
  let nNozzles = 0;
  if (opts.engines?.length) nNozzles = buildEngineBank(B, opts.engines, poly0, (x, y) => zTop(x, y, 0), k, T);
  const side = B.build();
  // ── SPÓD: siatka wysokości z odległości od burty, od poziomu krawędzi ─────────────────────────────────────────
  let cells = 0, deepest = 0, nBlocks = 0, nBlockLights = 0;
  if (opts.bottom !== false) {
    const Bt = T.bottom, R = T.recess, Dt = T.district;
    const dFlat = Bt.dFlat * k, zFlat = Bt.zFlat * k, depth = Bt.depth * k;
    // poziom odniesienia spodu: krawędź wierzchu (z cokołami) tylko przy burcie — dalej stały spadek (cokoły pod
    // mostkami i rdzeniami nie mogą unosić spodu kopułą)
    const edgeRef = (x, y, d) => {
      const t = Math.max(0, Math.min(1, (d - 160 * k) / (200 * k)));
      return zTop(x, y, 0) * (1 - t) - drop * t;
    };
    const zBase = (x, y, d) => edgeRef(x, y, d) + (d < dFlat ? zFlat : Math.max(-depth, zFlat - Bt.slope * (d - dFlat)));
    // wcięcia: 1 w środku, 0 poza; zbocze `ramp` j., z dala od burty
    const L = x1 - x0, hw = (y1 - y0) / 2, ramp = R.ramp * k;
    const recessAt = (x, y, d) => {
      if (opts.recess === false) return 0;
      const u = (x - x0) / L, v = Math.abs(y) / hw;
      let m = 0;
      for (const [u0, u1, vi, va, vb] of R.shapes) {
        const t = Math.max(0, Math.min(1, (u - u0) / (u1 - u0)));
        const vo = va + (vb - va) * t;
        // odległość ze znakiem [j.] od brzegu kształtu (wnętrze < 0)
        const sd = Math.max((u0 - u) * L, (u - u1) * L, (v - vo) * hw, vi > 0 ? (vi - v) * hw : -1e9);
        m = Math.max(m, Math.max(0, Math.min(1, -sd / ramp)));
      }
      return m * Math.max(0, Math.min(1, (d - R.edgeIn * k) / (R.edgeRamp * k)));
    };
    const zOf = (x, y, d) => zBase(x, y, d) + R.depth * k * recessAt(x, y, d);
    const matOf = (x, y, d) => (recessAt(x, y, d) > 0.5 ? M.DARK : M.PAINT);
    const bg = heightGrid([x0, y0, x1, y1], Bt.cell * k, segs, poly0, (d) => d >= Bt.dMin * k, zOf, true, matOf);
    cells = bg.cells;
    for (let i = 2; i < bg.pos.length; i += 3) if (bg.pos[i] < deepest) deepest = bg.pos[i];
    extra.push({ pos: bg.pos, nrm: bg.nrm, idx: bg.idx, mats: bg.mats, bands: bg.bands });
    // ZABUDOWA we wcięciach: bryły podwieszone pod stropem wcięcia (z sufitu w dół), rzadkie światła na ścianach
    if (opts.district !== false && opts.recess !== false) {
      const Bd = new MeshBuilder3D();
      const cellD = Dt.cell * k;
      let n = 0;
      for (let y = 0; y <= hw; y += cellD) {
        for (let x = x0; x <= x1; x += cellD) {
          const cx = x + cellD / 2, cy = y + cellD / 2;
          if (!pointInPoly(cx, cy, poly0)) continue;
          const d = edgeDistance(segs, cx, cy);
          if (recessAt(cx, cy, d) < 0.97) continue;
          const h0 = hash1(Math.floor(cx / cellD) * 7.13 + Math.floor(cy / cellD) * 3.71);
          if (h0 > Dt.fill) continue;
          const fx = cellD * (Dt.foot[0] + (Dt.foot[1] - Dt.foot[0]) * hash1(h0 * 91.7));
          const fy = cellD * (Dt.foot[0] + (Dt.foot[1] - Dt.foot[0]) * hash1(h0 * 53.3));
          const tower = hash1(h0 * 17.9) < Dt.tower;
          const hb = tower ? R.depth * Dt.towerH * k * (0.85 + 0.15 * hash1(h0 * 29.1))
            : (Dt.h[0] + (Dt.h[1] - Dt.h[0]) * hash1(h0 * 29.1) ** 1.6) * k;
          const ceil = zOf(cx, cy, d);
          // zabudowa ciemna (wcięcia mają czytać się z daleka jako ciemne), rzadkie jaśniejsze bryły
          const mat = [M.DARK, M.DARK, M.DARK, M.PANEL][Math.floor(hash1(h0 * 7.7) * 4)];
          for (const sy of cy > cellD * 0.5 ? [1, -1] : [1]) {
            // pudło: od sufitu (+2 j. w strop) w dół o wysokość bryły
            Bd.box(cx, cy * sy, ceil + 2 - hb / 2, fx, fy, hb + 2, { mat });
            n++;
            if (hash1(h0 * 61.3 + sy) < Dt.lights) {
              // światło na ścianie zwróconej ku osi wcięcia (+x lub −x), niżej połowy wysokości
              const lw = Dt.light[0] * k, lh = Dt.light[1] * k, side = hash1(h0 * 3.3) < 0.5 ? 1 : -1;
              const lx = cx + side * (fx / 2 + 0.3 * k), lz = ceil - hb * (0.35 + 0.4 * hash1(h0 * 8.1));
              const lmat = hash1(h0 * 4.4) < 0.35 ? M.E_ICE : M.E_WINDOW;
              for (let q = -1; q <= 1; q += 2) {
                const ly = cy * sy + q * fy * 0.22;
                Bd.face([[lx, ly - lw / 2, lz - lh / 2], [lx, ly + lw / 2, lz - lh / 2], [lx, ly + lw / 2, lz + lh / 2], [lx, ly - lw / 2, lz + lh / 2]], lmat, [side, 0, 0]);
                nBlockLights++;
              }
            }
          }
        }
      }
      nBlocks = n;
      const bd = Bd.build();
      extra.push({ pos: Array.from(bd.position), nrm: Array.from(bd.normal), idx: Array.from(bd.index), mats: Array.from(bd.mat), uvs: Array.from(bd.uv) });
    }
  }
  // ── złożenie ─────────────────────────────────────────────────────────────────────────────────────────────────
  let nv = side.vertexCount, ni = side.index.length;
  for (const e of extra) { nv += e.pos.length / 3; ni += e.idx.length; }
  const out = {
    position: new Float32Array(nv * 3), normal: new Float32Array(nv * 3), uv: new Float32Array(nv * 2),
    mat: new Float32Array(nv), band: new Float32Array(nv), index: new Uint32Array(ni)
  };
  out.position.set(side.position); out.normal.set(side.normal); out.uv.set(side.uv); out.mat.set(side.mat);
  out.index.set(side.index);
  let vo = side.vertexCount, io = side.index.length;
  for (const e of extra) {
    const n = e.pos.length / 3;
    out.position.set(e.pos, vo * 3); out.normal.set(e.nrm, vo * 3);
    for (let i = 0; i < n; i++) {
      out.mat[vo + i] = e.mats ? e.mats[i] : e.mat;
      out.band[vo + i] = e.bands ? e.bands[i] : 0;
      out.uv[(vo + i) * 2] = e.uvs ? e.uvs[i * 2] : e.pos[i * 3];
      out.uv[(vo + i) * 2 + 1] = e.uvs ? e.uvs[i * 2 + 1] : e.pos[i * 3 + 1];
    }
    for (let i = 0; i < e.idx.length; i++) out.index[io + i] = e.idx[i] + vo;
    vo += n; io += e.idx.length;
  }
  // uv pokładu (DECK) = obraz kompozytora: u = (x − x0) / w, v = (y projektu − y0) / h (tekstura skóry: flipY = false)
  // (pudło obrazu pola: { minX, minY, w, h } — `field.image`)
  const im = top?.image;
  if (im) {
    const ix0 = im.minX ?? im.x0, iy0 = im.minY ?? im.y0;
    for (let i = 0; i < nv; i++) {
      if (out.mat[i] !== M.DECK) continue;
      out.uv[i * 2] = (out.position[i * 3] - ix0) / im.w;
      out.uv[i * 2 + 1] = (-out.position[i * 3 + 1] - iy0) / im.h;
    }
  }
  out.vertexCount = nv;
  out.triangleCount = ni / 3;
  out.topGrid = topGrid;
  out.stats = {
    scale: Math.round(k * 1000) / 1000, outline: poly.length, rings: rings.length, lights: nLights, bottomCells: cells,
    topCells, drop: Math.round(drop), plateau: Math.round(plateau), pins: pins.length, blocks: nBlocks, blockLights: nBlockLights,
    nozzles: nNozzles,
    edgeDepth: Math.round(-(rings[rings.length - 1].z - drop)), depth: Math.round(-deepest), triangles: out.triangleCount,
    box: [Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)]
  };
  return out;
}
