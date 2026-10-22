// Obrys pancerza ze sprite'a okrętu — POMIAR płyt i rowów maszynowni sprite'a (wzór przy układaniu presetów
// z klocków; presety obrysu nie używają — scripts/kreator-tn-ab.mjs: IoU i podkład). Jasne, mało nasycone piksele = płyty pancerza (poziom 1), ciemne
// wnętrze sylwetki = rama z maszynownią (poziom 0). Maska jest symetryzowana względem osi okrętu (szukanej po
// alfie), domykana (szwy płyt), małe dziury (kratki, nity, napisy) zalane, drobne wyspy usunięte; z górnej połowy
// kontury (traceBlockContours), uproszczone Douglasem–Peuckerem. Kontur na osi → wielokąt `sym` (połowa od osi do
// osi), reszta — zwykłe wielokąty (lustro dopisuje drugą burtę). Jednostki: j. świata gry (getHullRenderSize: dłuższy
// bok płótna = length × 0,6), x ku dziobowi od środka pudła kadłuba, y w dół od osi.
//
//   node scripts/kreator-obrys-tn.mjs --kadlub terran_carrier [--prog 128] [--komorka 2] [--eps 1.2]
//        [--out .tmp/kreator/obrys]   → <kadlub>.json (wielokąty, skala, oś) + <kadlub>.png (podgląd na sprite'cie)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPng, writePng } from './webgpu/png.mjs';
import { traceBlockContours } from '../src/game/hullDesign/hullDesignGeometry.js';
import { HULL_RENDER_PROFILES, HULL_RENDER_WORLD_SCALE } from '../src/data/ships.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1']);
  return acc;
}, []));

const SPRITES = {
  terran_frigate: 'src/assets/ships/terranfrigate.png',
  terran_destroyer: 'src/assets/ships/terrandestroyer.png',
  terran_battleship: 'src/assets/ships/terranbattleship.png',
  terran_carrier: 'src/assets/ships/terrancarrier.png',
  terran_supercapital: 'src/assets/ships/terransupercapital.png'
};
const key = args.kadlub || 'terran_carrier';
const out = resolve(repo, args.out || '.tmp/kreator/obrys');
mkdirSync(out, { recursive: true });
const png = readPng(join(repo, SPRITES[key]));
const { width: W, height: H, data } = png;
const worldScale = HULL_RENDER_PROFILES[key].length * HULL_RENDER_WORLD_SCALE / Math.max(W, H);

// Pudło alfy i oś symetrii (najmniejsza różnica alfy z odbiciem).
let bx0 = W, by0 = H, bx1 = 0, by1 = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (data[(y * W + x) * 4 + 3] > 8) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
}
const alphaAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : data[(y * W + x) * 4 + 3]);
let axis = (by0 + by1) / 2, bestErr = Infinity;
for (let k = -120; k <= 120; k++) {
  const a = (by0 + by1) / 2 + k * 0.5;
  let err = 0, n = 0;
  for (let y = by0; y <= by1; y += 2) {
    const my = Math.round(2 * a - y);
    for (let x = bx0; x <= bx1; x += 4) { err += Math.abs(alphaAt(x, y) - alphaAt(x, my)); n++; }
  }
  if (err / n < bestErr) { bestErr = err / n; axis = a; }
}
if (args.os) axis = Number(args.os);
const cx = (bx0 + bx1) / 2;
const du = (bx1 - bx0) / 1700;                          // px sprite'a na jd (detail = długość / 1700)
const cell = Math.max(1, Number(args.komorka) || Math.round((bx1 - bx0) / 900));
const T = Number(args.prog) || 128;

// Siatka komórek: pokrycie i jasność (ważona alfą), symetryzowana.
const gw = Math.ceil(W / cell);
const halfRows = Math.ceil((axis - by0 + 2) / cell);    // wiersze w górę od osi
const cov = new Float32Array(gw * halfRows), lum = new Float32Array(gw * halfRows), sat = new Float32Array(gw * halfRows);
function sample(px0, py0) {
  let a = 0, l = 0, s = 0, n = 0;
  for (let yy = 0; yy < cell; yy++) for (let xx = 0; xx < cell; xx++) {
    const x = px0 + xx, y = Math.round(py0 + yy);
    n++;
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const o = (y * W + x) * 4;
    const al = data[o + 3] / 255;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    a += al; l += (0.2126 * r + 0.7152 * g + 0.0722 * b) * al; s += (Math.max(r, g, b) - Math.min(r, g, b)) * al;
  }
  return [a / n, a > 1e-6 ? l / a : 0, a > 1e-6 ? s / a : 0];
}
// wiersz j (0 = tuż nad osią) = pasek y ∈ [axis − (j + 1)·cell, axis − j·cell]
for (let j = 0; j < halfRows; j++) {
  for (let i = 0; i < gw; i++) {
    const [a1, l1, s1] = sample(i * cell, axis - (j + 1) * cell);
    const [a2, l2, s2] = sample(i * cell, axis + j * cell);
    const k = j * gw + i;
    cov[k] = (a1 + a2) * 0.5;
    const wsum = a1 + a2;
    lum[k] = wsum > 1e-6 ? (l1 * a1 + l2 * a2) / wsum : 0;
    sat[k] = wsum > 1e-6 ? (s1 * a1 + s2 * a2) / wsum : 0;
  }
}
const N = gw * halfRows;
let armor = new Uint8Array(N);
for (let k = 0; k < N; k++) armor[k] = cov[k] > 0.5 && lum[k] > T && sat[k] < 60 ? 1 : 0;
const hull = new Uint8Array(N);
for (let k = 0; k < N; k++) hull[k] = cov[k] > 0.5 ? 1 : 0;

function morph(src, r, dilate) {
  const dst = new Uint8Array(N);
  for (let j = 0; j < halfRows; j++) for (let i = 0; i < gw; i++) {
    let v = dilate ? 0 : 1;
    for (let dj = -r; dj <= r && (dilate ? !v : v); dj++) for (let di = -r; di <= r; di++) {
      const jj = j + dj, ii = i + di;
      // oś (j < 0) — lustro: wiersz −1 = wiersz 0
      const jm = jj < 0 ? -1 - jj : jj;
      const s = jm >= halfRows || ii < 0 || ii >= gw ? 0 : src[jm * gw + ii];
      if (dilate && s) { v = 1; break; }
      if (!dilate && !s) { v = 0; break; }
    }
    dst[j * gw + i] = v;
  }
  return dst;
}
const close = Number(args.domkniecie ?? 1), open = Number(args.otwarcie ?? 1);
if (close > 0) armor = morph(morph(armor, close, true), close, false);
for (let k = 0; k < N; k++) armor[k] &= hull[k];
if (open > 0) armor = morph(morph(armor, open, false), open, true);

function components(mask, val) {
  const lab = new Int32Array(N).fill(-1);
  const comps = [];
  const st = [];
  for (let k = 0; k < N; k++) {
    if (mask[k] !== val || lab[k] >= 0) continue;
    const id = comps.length;
    const cells = [];
    let touchesEdge = false;
    st.push(k); lab[k] = id;
    while (st.length) {
      const q = st.pop();
      cells.push(q);
      const i = q % gw, j = (q / gw) | 0;
      if (i === 0 || i === gw - 1 || j === halfRows - 1) touchesEdge = true;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || ii >= gw || jj < 0 || jj >= halfRows) continue;
        const n = jj * gw + ii;
        if (mask[n] === val && lab[n] < 0) { lab[n] = id; st.push(n); }
      }
    }
    comps.push({ cells, touchesEdge });
  }
  return comps;
}
// zalej małe dziury (kratki, napisy, nity) i otwory całkowicie w pancerzu
const duCells = du / cell;                              // jd na komórkę ⁻¹
const holeMax = Number(args.dziury || 900) * duCells * duCells;
for (const c of components(armor, 0)) {
  if (c.touchesEdge) continue;
  const inHull = c.cells.every((q) => hull[q]);
  if (c.cells.length <= holeMax && inHull) for (const q of c.cells) armor[q] = 1;
}
const islandMin = Number(args.wyspy || 120) * duCells * duCells;
for (const c of components(armor, 1)) if (c.cells.length < islandMin) for (const q of c.cells) armor[q] = 0;

// sylwetka (rama): małe dziury zalane, drobne wyspy usunięte
let hullM = morph(morph(hull, 1, true), 1, false);
for (const c of components(hullM, 0)) if (!c.touchesEdge) for (const q of c.cells) hullM[q] = 1;
for (const c of components(hullM, 1)) if (c.cells.length < islandMin) for (const q of c.cells) hullM[q] = 0;
for (let k = 0; k < N; k++) armor[k] &= hullM[k];

// Wnęki w pancerzu: ciemne plamy (po rozcięciu cienkich połączeń erozją) mniejsze niż --wneki jd² → zalane
// pancerzem i zapisane jako kandydaci na moduły (kratka — wydłużona, gniazdo — krępa).
const dark = new Uint8Array(N);
for (let k = 0; k < N; k++) dark[k] = hullM[k] && !armor[k] ? 1 : 0;
const darkCore = morph(dark, 1, false);
const recessMax = Number(args.wneki || 1400) * duCells * duCells;
const recesses = [];
for (const c of components(darkCore, 1)) {
  if (c.touchesEdge || c.cells.length > recessMax || c.cells.length < 6) continue;
  let i0 = gw, i1 = 0, j0 = halfRows, j1 = 0;
  for (const q of c.cells) { const i = q % gw, j = (q / gw) | 0; if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; }
  // pierścień wokół wnęki musi być pancerzem (wnęka W płycie, nie szczelina przy krawędzi)
  let ring = 0, ringArmor = 0;
  for (let j = j0 - 2; j <= j1 + 2; j++) for (let i = i0 - 2; i <= i1 + 2; i++) {
    if (i >= i0 - 1 && i <= i1 + 1 && j >= j0 - 1 && j <= j1 + 1) continue;
    const jm = j < 0 ? -1 - j : j;
    if (i < 0 || i >= gw || jm >= halfRows) { ring++; continue; }
    ring++; if (armor[jm * gw + i]) ringArmor++;
  }
  if (ringArmor < ring * 0.6) continue;
  for (let j = Math.max(0, j0 - 1); j <= Math.min(halfRows - 1, j1 + 1); j++) for (let i = Math.max(0, i0 - 1); i <= Math.min(gw - 1, i1 + 1); i++) {
    if (dark[j * gw + i]) armor[j * gw + i] = 1;
  }
  const wx0 = (i0 * cell - cx) * worldScale, wx1 = ((i1 + 1) * cell - cx) * worldScale;
  // wiersz j: y ∈ [−(j + 1)·cell, −j·cell] (górna połowa)
  const wy0 = -(j1 + 1) * cell * worldScale, wy1 = -j0 * cell * worldScale;
  const onAxis = j0 === 0;
  recesses.push({
    x: (wx0 + wx1) / 2, y: onAxis ? 0 : (wy0 + wy1) / 2,
    w: (wx1 - wx0) / 2, h: onAxis ? -wy0 : (wy1 - wy0) / 2,
    fill: c.cells.length / ((i1 - i0 + 1) * (j1 - j0 + 1))
  });
}

const toWorld = ([i, jy]) => [((i * cell) - cx) * worldScale, jy * cell * worldScale];
// kontury CAŁEJ (symetrycznej) maski: komórka górnej połowy (i, j) → bloki (i, −1 − j) i (i, j) (y w dół, oś y = 0).
// Pętle zewnętrzne i otwory razem — wielokąt projektu z otworami (wypełnienie parzysto-nieparzyste), bez lustra.
function traceMask(mask) {
  const set = new Set();
  for (let j = 0; j < halfRows; j++) for (let i = 0; i < gw; i++) if (mask[j * gw + i]) { set.add(`${i},${-1 - j}`); set.add(`${i},${j}`); }
  return traceBlockContours(set);
}

function dp(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const vx = bx - ax, vy = by - ay, L = Math.hypot(vx, vy) || 1e-9;
    let md = -1, mi = -1;
    for (let k = a + 1; k < b; k++) {
      const d = Math.abs((pts[k][0] - ax) * vy - (pts[k][1] - ay) * vx) / L;
      if (d > md) { md = d; mi = k; }
    }
    if (md > eps) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, k) => keep[k]);
}
const eps = Number(args.eps || 1.2) * cell * worldScale;
const r1 = (v) => Math.round(v * 10) / 10;
/** Pętla zamknięta uproszczona DP — punkt startowy na najbardziej odległym od pierwszego (stabilniej). */
function simplifyLoop(w) {
  let far = 0, fd = -1;
  for (let k = 0; k < w.length; k++) { const d = (w[k][0] - w[0][0]) ** 2 + (w[k][1] - w[0][1]) ** 2; if (d > fd) { fd = d; far = k; } }
  const a = dp(w.slice(0, far + 1), eps), b = dp([...w.slice(far), w[0]], eps);
  return [...a, ...b.slice(1, -1)];
}
// Pętle → PŁYTY: pętla zewnętrzna (obieg z wnętrzem po prawej — pole ze znakiem > 0 przy y w dół) + jej otwory
// (najmniejsza pętla zewnętrzna, która zawiera otwór). Rama = jedna płyta (sylwetka), pancerz = lista płyt (presety
// wybierają piętro płyty punktem w jej wnętrzu).
function pointInLoop(loop, x, y) {
  let inside = false;
  for (let s = 0, k = loop.length - 1; s < loop.length; k = s++) {
    const a = loop[k], b = loop[s];
    if ((a[1] <= y) !== (b[1] <= y) && x < a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0])) inside = !inside;
  }
  return inside;
}
// Rozcięcie pancerza na PŁYTY: erozja o --rozciecie jd rozcina cienkie mostki między płytami, składowe (drobne
// odrzucone) wracają do pełnego pancerza (BFS: każda komórka pancerza do najbliższej płyty).
const plateMasks = [];
{
  const er = Math.max(1, Math.round(Number(args.rozciecie || 5) * du / cell));
  const core = morph(armor, er, false);
  const lab = new Int32Array(N).fill(-1);
  const minPlate = Number(args.plytaMin || 120) * duCells * duCells;
  let nl = 0;
  for (const c of components(core, 1)) {
    if (c.cells.length < minPlate) continue;
    for (const q of c.cells) lab[q] = nl;
    nl++;
  }
  const queue = new Int32Array(N);
  let qh = 0, qt = 0;
  for (let k = 0; k < N; k++) if (lab[k] >= 0) queue[qt++] = k;
  while (qh < qt) {
    const q = queue[qh++];
    const i = q % gw, j = (q / gw) | 0, L = lab[q];
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || ii >= gw || jj < 0 || jj >= halfRows) continue;
      const n = jj * gw + ii;
      if (armor[n] && lab[n] < 0) { lab[n] = L; queue[qt++] = n; }
    }
  }
  for (let L = 0; L < nl; L++) {
    const m = new Uint8Array(N);
    for (let k = 0; k < N; k++) m[k] = lab[k] === L ? 1 : 0;
    plateMasks.push(m);
  }
  // reszta pancerza bez etykiety (drobne płytki) — razem jako jedna maska
  const rest = new Uint8Array(N);
  let any = 0;
  for (let k = 0; k < N; k++) if (armor[k] && lab[k] < 0) { rest[k] = 1; any = 1; }
  if (any) plateMasks.push(rest);
}
const polys = [];
for (const [level, mask] of [[0, hullM], ...plateMasks.map((m) => [1, m])]) {
  const loops = [];
  for (const loop of traceMask(mask)) {
    const w = loop.map(toWorld);
    let area = 0;
    for (let k = 0; k < w.length; k++) { const a = w[k], b = w[(k + 1) % w.length]; area += a[0] * b[1] - b[0] * a[1]; }
    const minArea = Number(args.petla || 60) * (du * worldScale) ** 2;
    if (Math.abs(area) < minArea) continue;
    const simp = simplifyLoop(w);
    if (simp.length >= 3) loops.push({ area, raw: w, pts: simp.map(([x, y]) => [r1(x), r1(y)]) });
  }
  if (!loops.length) continue;
  const outers = loops.filter((l) => l.area > 0).sort((a, b) => a.area - b.area);
  const plates = outers.map((o) => ({ level, pts: o.pts, holes: [], area: o.area, loop: o.raw }));
  for (const h of loops.filter((l) => l.area <= 0)) {
    const [hx, hy] = h.raw[0];
    const owner = plates.find((p) => pointInLoop(p.loop, hx + 1e-3, hy + 1e-3)) || plates[plates.length - 1];
    owner?.holes.push(h.pts);
  }
  plates.sort((a, b) => b.area - a.area);
  for (const p of plates) { delete p.loop; polys.push(p); }
}

const result = {
  kadlub: key, sprite: SPRITES[key], plotno: [W, H], skala: worldScale, os: axis, srodekX: cx,
  dlugosc: r1((bx1 - bx0) * worldScale), szerokosc: r1((by1 - by0) * worldScale),
  detail: Math.round(du * worldScale * 10000) / 10000, komorka: cell, prog: T,
  wielokaty: polys.map(({ area, ...p }) => p),
  wneki: recesses.map((r) => ({ x: r1(r.x), y: r1(r.y), w: r1(r.w), h: r1(r.h), fill: Math.round(r.fill * 100) / 100 }))
};
writeFileSync(join(out, `${key}.json`), JSON.stringify(result, null, 1) + '\n');

// Podgląd: sprite (przygaszony) + maska pancerza (cyjan) + kontury (pomarańcz).
const img = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) {
  const a = data[i * 4 + 3] / 255;
  for (let c = 0; c < 3; c++) img[i * 4 + c] = Math.round(data[i * 4 + c] * a * 0.55 + 18 * (1 - a));
  img[i * 4 + 3] = 255;
}
for (let j = 0; j < halfRows; j++) for (let i = 0; i < gw; i++) {
  if (!armor[j * gw + i]) continue;
  for (const sy of [-1, 1]) for (let yy = 0; yy < cell; yy++) for (let xx = 0; xx < cell; xx++) {
    const x = i * cell + xx, y = Math.round(sy < 0 ? axis - (j + 1) * cell + yy : axis + j * cell + yy);
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const o = (y * W + x) * 4;
    img[o] = Math.round(img[o] * 0.6); img[o + 1] = Math.round(img[o + 1] * 0.6 + 70); img[o + 2] = Math.round(img[o + 2] * 0.6 + 80);
  }
}
function line(x0, y0, x1, y1, col) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) + 1;
  for (let k = 0; k <= n; k++) {
    const x = Math.round(x0 + (x1 - x0) * k / n), y = Math.round(y0 + (y1 - y0) * k / n);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const o = (yy * W + xx) * 4;
      img[o] = col[0]; img[o + 1] = col[1]; img[o + 2] = col[2];
    }
  }
}
const toPx = ([x, y]) => [x / worldScale + cx, y / worldScale + axis];
for (const p of polys) {
  for (const loop of [p.pts, ...p.holes]) {
    const q = loop.map(toPx);
    for (let k = 0; k < q.length; k++) line(...q[k], ...q[(k + 1) % q.length], p.level === 0 ? [120, 255, 120] : [255, 180, 50]);
  }
}
for (const r of recesses) for (const sg of r.y === 0 ? [1] : [1, -1]) {
  const [ax, ay] = toPx([r.x - r.w, (r.y - r.h) * sg]), [bx, by] = toPx([r.x + r.w, (r.y + r.h) * sg]);
  const col = Math.max(r.w, r.h) / Math.min(r.w, r.h) > 1.8 ? [255, 60, 220] : [60, 220, 255];
  line(ax, ay, bx, ay, col); line(bx, ay, bx, by, col); line(bx, by, ax, by, col); line(ax, by, ax, ay, col);
}
line(0, axis, W, axis, [90, 90, 255]);
writePng(join(out, `${key}.png`), { width: W, height: H, data: img });
console.log(`${key}: płótno ${W}×${H}, skala ${worldScale.toFixed(4)} j./px, oś y=${axis} (błąd ${bestErr.toFixed(1)}), kadłub ${result.dlugosc}×${result.szerokosc} j., detail ${result.detail}, komórka ${cell} px, ${polys.map((p) => `poziom ${p.level}: pętli ${1 + p.holes.length}, punktów ${p.pts.length + p.holes.reduce((s, h) => s + h.length, 0)}`).join(' · ')}, wnęki ${recesses.length}`);
