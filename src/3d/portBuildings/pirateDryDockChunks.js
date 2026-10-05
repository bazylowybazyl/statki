// Kawałki suchego doku jako bryły silnika zniszczeń (docs/PLAN-zniszczenia-swiata-3d.md § 4.3, F2): z danych
// instancji sceny (pirateDryDockScene.js — te same bryły, które rysuje render) wybiera bryły kawałków (grupy)
// i oddaje trójkąty do wokselizacji (voxelizeTriangles → buildBeamStructure), listę brył do modelu Three
// (demo destruktor3d.html) albo rzut z góry do płaskiej kratownicy (destruktor2d.html).
// Czysta matematyka, bez Three — działa w node (testy) i w workerze.
//
// Układ: x wzdłuż trzonu, y — wysokość ŚWIATA (z gry; nad płaszczyzną już ściśnięta ×0,42 jak w renderze),
// z w poprzek trzonu (+z parking). Pominięte: światła (materiały emisyjne 14–19 — w ciele zostałyby kropkami
// węzłów) i torusy (pierścienie dekoracyjne, cieńsze od komórki). Kolce (stożki) — ostrosłupy.
import { PB_STRIDE } from './portBuildingScene.js';

const EMISSIVE_MIN = 13.5;
const EMISSIVE_MAX = 19.5;
const KINDS = Object.freeze(['box', 'cyl', 'cone']);

function qrot(q, v, out) {
  // v' = v + 2·q.w·(q.xyz × v) + 2·q.xyz × (q.xyz × v)
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  out[0] = v[0] + qw * tx + (qy * tz - qz * ty);
  out[1] = v[1] + qw * ty + (qz * tx - qx * tz);
  out[2] = v[2] + qw * tz + (qx * ty - qy * tx);
  return out;
}

/**
 * Bryły kawałków: [{ kind: 'box' | 'cyl' | 'cone', chunk, mat, center: [x, y, z], size: [sx, sy, sz], vs, q }]
 * w układzie budowli (kawałki na miejscu — macierze grup tożsame).
 */
export function dryDockChunkSolids(layout, scene, chunkIds, { emissive = false } = {}) {
  const wanted = new Map();
  for (const id of chunkIds) {
    const c = layout.chunkById.get(id);
    if (c) wanted.set(c.group, c.id);
  }
  const out = [];
  for (const set of Object.values(scene.sets)) {
    for (const kind of KINDS) {
      const a = set[kind];
      if (!a) continue;
      for (let i = 0; i < a.length; i += PB_STRIDE) {
        const g = a[i + 12];
        const chunk = wanted.get(g);
        if (!chunk) continue;
        const mat = a[i + 7];
        if (!emissive && mat > EMISSIVE_MIN && mat < EMISSIVE_MAX) continue;
        out.push({
          kind, chunk, mat,
          center: [a[i], a[i + 1], a[i + 2]],
          size: [a[i + 4], a[i + 5], a[i + 6]],
          vs: a[i + 3],
          q: [a[i + 8], a[i + 9], a[i + 10], a[i + 11]]
        });
      }
    }
  }
  return out;
}

// Wierzchołek bryły jednostkowej (−0,5…0,5) → układ budowli (jak shader instancji: skala, obrót, ścisk pionowy).
function place(s, lx, ly, lz, out) {
  const v = [lx * s.size[0], ly * s.size[1], lz * s.size[2]];
  qrot(s.q, v, out);
  out[0] = s.center[0] + out[0];
  out[1] = s.center[1] + out[1] * s.vs;
  out[2] = s.center[2] + out[2];
  return out;
}

const BOX_QUADS = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]];
const BOX_CORNERS = [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]];
// walec / stożek jednostkowy (promień 1): narożniki obejmującego pudła; stożek — podstawa i szpic
const ROUND_CORNERS = BOX_CORNERS.map((k) => [k[0] * 2, k[1], k[2] * 2]);
const CONE_CORNERS = [[-1, -0.5, -1], [1, -0.5, -1], [1, -0.5, 1], [-1, -0.5, 1], [0, 0.5, 0]];

function cornersOf(s) {
  return s.kind === 'box' ? BOX_CORNERS : s.kind === 'cone' ? CONE_CORNERS : ROUND_CORNERS;
}

/**
 * Trójkąty brył (Float32Array po 9 liczb) i barwy na trójkąt (paleta stylu, liniowo → sRGB do wokselizacji).
 * opts: { sides (walce i stożki, 8), map(p) — przekształcenie punktu (np. obrót do układu dema), palette }.
 */
export function dryDockSolidsToTriangles(solids, opts = {}) {
  const sides = Math.max(3, opts.sides | 0 || 8);
  const map = typeof opts.map === 'function' ? opts.map : null;
  const pal = opts.palette || null;
  let tris = 0;
  for (const s of solids) tris += s.kind === 'box' ? 12 : s.kind === 'cone' ? sides * 2 : sides * 4;
  const pos = new Float32Array(tris * 9);
  const col = new Float32Array(tris * 3);
  let po = 0;
  let co = 0;
  const push = (a, b, c, rgb) => {
    for (const v of [a, b, c]) {
      const w = map ? map(v) : v;
      pos[po++] = w[0]; pos[po++] = w[1]; pos[po++] = w[2];
    }
    col[co++] = rgb[0]; col[co++] = rgb[1]; col[co++] = rgb[2];
  };
  for (const s of solids) {
    const rgb = colorOf(pal, s.mat);
    if (s.kind === 'box') {
      const c = BOX_CORNERS.map((k) => place(s, k[0], k[1], k[2], [0, 0, 0]));
      for (const q of BOX_QUADS) {
        push(c[q[0]], c[q[1]], c[q[2]], rgb);
        push(c[q[0]], c[q[2]], c[q[3]], rgb);
      }
      continue;
    }
    // walec jednostkowy (promień 1, wysokość 1 wzdłuż y) jako graniastosłup, stożek — ostrosłup
    const ring = (y) => Array.from({ length: sides }, (_, k) => {
      const a = (k / sides) * Math.PI * 2;
      return place(s, Math.cos(a), y, Math.sin(a), [0, 0, 0]);
    });
    const bot = ring(-0.5);
    const cb = place(s, 0, -0.5, 0, [0, 0, 0]);
    const ct = place(s, 0, 0.5, 0, [0, 0, 0]);
    if (s.kind === 'cone') {
      for (let k = 0; k < sides; k++) {
        const k1 = (k + 1) % sides;
        push(bot[k], ct, bot[k1], rgb);
        push(cb, bot[k], bot[k1], rgb);
      }
      continue;
    }
    const top = ring(0.5);
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides;
      push(bot[k], top[k], top[k1], rgb);
      push(bot[k], top[k1], bot[k1], rgb);
      push(ct, top[k1], top[k], rgb);
      push(cb, bot[k], bot[k1], rgb);
    }
  }
  return { positions: pos, colors: col, count: tris };
}

function colorOf(pal, mat) {
  const m = Math.max(0, Math.min(13, Math.round(mat)));
  const c = pal?.[m];
  if (!c) return [0.55, 0.57, 0.6];
  // paleta stylu jest liniowa — do wokselizacji (barwa węzłów) sRGB
  const s = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  return [s(c[0]), s(c[1]), s(c[2])];
}

/** Obwiednia brył: { x0, x1, y0, y1, z0, z1 } (narożniki pudeł, walców i stożków). */
export function dryDockSolidsBounds(solids) {
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
  const p = [0, 0, 0];
  for (const s of solids) {
    for (const k of cornersOf(s)) {
      place(s, k[0], k[1], k[2], p);
      if (p[0] < b.x0) b.x0 = p[0]; if (p[0] > b.x1) b.x1 = p[0];
      if (p[1] < b.y0) b.y0 = p[1]; if (p[1] > b.y1) b.y1 = p[1];
      if (p[2] < b.z0) b.z0 = p[2]; if (p[2] > b.z1) b.z1 = p[2];
    }
  }
  return b;
}

// Moduł do prób w destruktorze: koniec parkingu od strony wjazdu — odcinek trzonu strefy wjazdu, rama z pylonami,
// brama taranowa (cienka), sekcja ogrodzenia z bramami pierwszych stanowisk. Atlas taranuje bramę G-W wzdłuż +x.
export const DRYDOCK_TEST_MODULE = Object.freeze(['S-1', 'Q-W', 'G-W', 'P-1', 'B-01', 'B-02', 'B-03']);

// Wypukła otoczka punktów 2D (monotoniczny łańcuch) — rzut bryły na płaszczyznę (x, z).
function hull2(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  const up = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  up.pop();
  lo.pop();
  return lo.concat(up);
}

/**
 * Rzut brył z góry jako obraz RGBA — PŁASKA kratownica silnika belek (ocena F0 użytkownika 2026-10-05: ciała
 * świata w grze są płaskie jak kadłuby, bryła 3D jedzie po kratownicy skórą FFD): alfa = bryła, barwa = paleta
 * stylu rozjaśniana wysokością (wyższe bryły przykrywają niższe). Ten sam kształt wejścia co sprite kadłuba
 * (`sampleSpriteLattice` / `buildSpriteBeamStructure` w beamSprite2D.js) — obraz jest i maską, i skórą.
 * Obraz: x układu w prawo, +z układu w GÓRĘ (wiersz 0 = największe z). opts: { unitsPerPx (4), palette }.
 * Wynik: { width, height, data, unitsPerPx, x0, z1, worldW, worldH }.
 */
export function dryDockTopRaster(solids, opts = {}) {
  const upp = Math.max(0.5, Number(opts.unitsPerPx) || 4);
  const b = dryDockSolidsBounds(solids);
  const W = Math.max(1, Math.ceil((b.x1 - b.x0) / upp));
  const H = Math.max(1, Math.ceil((b.z1 - b.z0) / upp));
  const data = new Uint8ClampedArray(W * H * 4);
  const topAt = new Float32Array(W * H).fill(-Infinity);
  const pal = opts.palette || null;
  const span = Math.max(1, b.y1 - b.y0);
  const p = [0, 0, 0];
  for (const s of solids) {
    const pts = [];
    let top = -Infinity;
    for (const k of cornersOf(s)) {
      place(s, k[0], k[1], k[2], p);
      pts.push([p[0], p[2]]);
      if (p[1] > top) top = p[1];
    }
    const poly = hull2(pts);
    if (poly.length < 3) continue;
    const rgb = colorOf(pal, s.mat);
    const shade = 0.72 + 0.4 * Math.max(0, Math.min(1, (top - b.y0) / span));
    let px0 = Infinity; let px1 = -Infinity; let pz0 = Infinity; let pz1 = -Infinity;
    for (const q of poly) {
      if (q[0] < px0) px0 = q[0]; if (q[0] > px1) px1 = q[0];
      if (q[1] < pz0) pz0 = q[1]; if (q[1] > pz1) pz1 = q[1];
    }
    const c0 = Math.max(0, Math.floor((px0 - b.x0) / upp));
    const c1 = Math.min(W - 1, Math.ceil((px1 - b.x0) / upp));
    const r0 = Math.max(0, Math.floor((b.z1 - pz1) / upp));
    const r1 = Math.min(H - 1, Math.ceil((b.z1 - pz0) / upp));
    for (let r = r0; r <= r1; r++) {
      const z = b.z1 - (r + 0.5) * upp;
      for (let c = c0; c <= c1; c++) {
        const x = b.x0 + (c + 0.5) * upp;
        let inside = true;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const ex = poly[i][0] - poly[j][0];
          const ez = poly[i][1] - poly[j][1];
          if (ex * (z - poly[j][1]) - ez * (x - poly[j][0]) < 0) { inside = false; break; }
        }
        if (!inside) continue;
        const id = r * W + c;
        if (top < topAt[id]) continue;
        topAt[id] = top;
        data[id * 4] = Math.round(255 * Math.min(1, rgb[0] * shade));
        data[id * 4 + 1] = Math.round(255 * Math.min(1, rgb[1] * shade));
        data[id * 4 + 2] = Math.round(255 * Math.min(1, rgb[2] * shade));
        data[id * 4 + 3] = 255;
      }
    }
  }
  return { width: W, height: H, data, unitsPerPx: upp, x0: b.x0, z1: b.z1, worldW: W * upp, worldH: H * upp };
}

/**
 * Bryły modułu do płaskiej kratownicy: tylko te, które przecinają płaszczyznę gry (wysokość świata 0 ± `band`)
 * — trzon, nabrzeże, ogrodzenie, bramy, pylony; bez rękawów, kołysek i szponów pod płaszczyzną, bez dachu.
 */
export function dryDockPlanarSolids(layout, scene, chunkIds, { band = 25 } = {}) {
  const p = [0, 0, 0];
  return dryDockChunkSolids(layout, scene, chunkIds).filter((s) => {
    if (layout.chunkById.get(s.chunk)?.kind === 'roof') return false;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const k of cornersOf(s)) {
      place(s, k[0], k[1], k[2], p);
      if (p[1] < y0) y0 = p[1];
      if (p[1] > y1) y1 = p[1];
    }
    return y1 >= -band && y0 <= band;
  });
}
