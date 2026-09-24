// Cienie kadłubów w passie shadow shafts: pole odległości (SDF) sylwetki.
//
// Wcześniej okluderem statku był łańcuch 4 kapsuł dopasowanych do profilu
// szerokości. Kapsułą nie da się opisać kolców, rozwidlonego dziobu ani
// prostokątnej rufy: krótkie, szerokie pasma zwijały się do okręgów
// wystających poza kadłub (Atlas: 131 j. za rufą), promień pasma brał
// najszerszy punkt razem z kolcami (pas 30–86 j. światła między burtą
// a początkiem cienia), a test „wnętrza” działał per kapsuła, więc każda
// rzucała cień na kadłub pod sąsiednią.
//
// Teraz każdy kształt kadłuba ma warstwę w tablicy tekstur R8 (256×256):
// odległość ze znakiem od sylwetki (alfa sprite'a ∩ aktywne heksy), ujemna
// w środku. Shader passa (HULL_SDF_SHADOW_GLSL) przenosi piksel do układu
// statku (to samo przekształcenie co mesh kadłuba), przycina promień do
// prostokąta warstwy, pomija piksele NA własnym kadłubie i idzie po SDF
// w stronę słońca (sphere tracing). Półcień = najmniejszy stosunek
// odległości do szerokości półcienia, która rośnie z dystansem od statku.
//
// Warstwy:
//  - świeże i tylko draśnięte kadłuby z tym samym obrazem i siatką dzielą
//    jedną warstwę (flota NPC = jedno pieczenie na typ),
//  - poważnie uszkodzone kadłuby, wraki i fragmenty mają własną; po
//    kolejnych trafieniach piecze się ponownie z opóźnieniem (REBAKE_*),
//    a do tego czasu zostaje poprzednia sylwetka,
//  - brak wolnej warstwy = LRU: wypada ta, której nikt nie użył w tej klatce.
// Pieczenie ma budżet na klatkę. hexShips3D woła acquire od największych
// kadłubów, więc duże okręty dostają cień od pierwszej klatki.
import * as THREE from 'three';

export const HULL_SDF_LAYER_SIZE = 256;     // bok warstwy w tekselach
export const HULL_SDF_LAYER_COUNT = 64;     // warstw w tablicy (256² × 64 × 1 B = 4 MB)
export const HULL_SDF_SHAFT_CAP = 32;       // kadłubów naraz w passie shaftów
export const HULL_SDF_OCCLUDER_FLOATS = 12; // A, M, C — patrz packHullShaftOccluder
export const HULL_SDF_MAX_STEPS = 32;       // górna granica kroków marszu (jakość tnie niżej)
// Wolny pas wokół sylwetki. Na brzegu prostokąta SDF ≥ margines, a półcień
// jest węższy (SOFT < MARGIN), więc cień gaśnie do zera jeszcze w środku
// prostokąta — piksele, których promień omija prostokąt, nie tworzą schodka.
export const HULL_SDF_MARGIN_TEXELS = 12;
export const HULL_SDF_SOFT_TEXELS = 10;
// Zakres kodowania: bajt 0..255 = odległość -16..+16 tekseli (krok 0,125).
export const HULL_SDF_RANGE_TEXELS = 16;
// Próg alfy sylwetki. Heks brzegowy wystaje do promienia poza rysowaną
// krawędź, więc sama maska heksów dawała szczelinę światła przy burcie;
// sama alfa nie widziałaby dziur po trafieniach — stąd iloczyn obu.
export const HULL_SDF_ALPHA_INSIDE = 0.5;

const MIN_TEXEL_PX = 1.5;          // małe kadłuby: nie gęściej niż 1,5 px sprite'a na teksel
// Tyle tekseli poza sylwetką piksel liczy się jeszcze jako kadłub. Większy
// próg zostawiał po stronie cienia jasną szczelinę wzdłuż burty (czyta się
// jak obwódka), mniejszy — ciemne ząbki na kadłubie tam, gdzie zero SDF
// z siatki tekseli odjeżdża od krawędzi sprite'a.
const SELF_BIAS_TEXELS = 0.15;
const STEP_FLOOR_TEXELS = 0.75;    // najkrótszy krok marszu
const PENUMBRA_STEP = 0.3;         // krok w półcieniu jako ułamek jego szerokości
// Ponowne pieczenie po trafieniach: po większej stracie (≥ 0,5% heksów, min. 8)
// najczęściej co sekundę, drobne ubytki dopiero po 4 s. Sylwetka z kilkoma
// heksami mniej wygląda tak samo, a pieczenie Atlasa to ~2–4 ms.
const REBAKE_MS = 1000;
const REBAKE_SMALL_MS = 4000;
const REBAKE_MIN_FRACTION = 0.005;
const REBAKE_MIN_HEXES = 8;
const BAKE_BUDGET_MS = 2.5;
const MAX_BAKES_PER_FRAME = 2;
const ALPHA_MAP_MAX_SIDE = 1024;   // ~1,8 px sprite'a Atlasa na teksel alfy — pod pokrycie brzegu

const CODE_SPAN_TEXELS = 2 * HULL_SDF_RANGE_TEXELS;   // teksele na cały zakres kodu 0..1
const SOFT_RATIO = HULL_SDF_SOFT_TEXELS / CODE_SPAN_TEXELS;
const SELF_RATIO = SELF_BIAS_TEXELS / CODE_SPAN_TEXELS;
const STEP_RATIO = STEP_FLOOR_TEXELS / CODE_SPAN_TEXELS;
const UV_MIN = 0.5 / HULL_SDF_LAYER_SIZE;

function glslNum(value) {
  const s = Number(value).toPrecision(8);
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

// Cień kadłubów liczony w passie shadow shafts (core3d.js wstrzykuje ten blok
// przed main). Uniformy wypełnia Core3D z rejestru pushShaftHullSdf.
//   uHullA[i] = (początek prostokąta SDF w three-space xy, świat na jednostkę
//                kodu tekstury, długość kadłuba w świecie)
//   uHullM[i] = macierz: przesunięcie w świecie -> UV warstwy
//   uHullC[i] = (max U, max V prostokąta, warstwa, siła)
// Zmieniając logikę, zmień też traceHullShadowCpu (lustro dla testów).
export const HULL_SDF_SHADOW_GLSL = `
uniform sampler2DArray uHullSdf;
uniform int uHullCount;
uniform int uHullSteps;
uniform float uHullLenMul;
uniform vec4 uHullA[${HULL_SDF_SHAFT_CAP}];
uniform vec4 uHullM[${HULL_SDF_SHAFT_CAP}];
uniform vec4 uHullC[${HULL_SDF_SHAFT_CAP}];

float hullSdfDist(vec2 uv, float layer, float distScale) {
  return (textureLod(uHullSdf, vec3(uv, layer), 0.0).r - 0.5) * distScale;
}

// Najciemniejszy cien kadlubow w worldP (three-space); d = jednostkowy
// kierunek DO slonca. 0 = brak, 1 = pelny (przed sila cienia kadluba).
float hullSdfShadow(vec2 worldP, vec2 d, float sunDist) {
  float shadow = 0.0;
  for (int i = 0; i < ${HULL_SDF_SHAFT_CAP}; i++) {
    if (i >= uHullCount) break;
    vec4 hA = uHullA[i];
    vec4 hM = uHullM[i];
    vec4 hC = uHullC[i];
    float distScale = hA.z;
    float span = hA.w;
    if (distScale <= 0.0 || span <= 0.0) continue;

    // Piksel i promien w UV warstwy — to samo przeksztalcenie co mesh kadluba.
    vec2 rel = worldP - hA.xy;
    vec2 q = vec2(dot(hM.xy, rel), dot(hM.zw, rel));
    vec2 dq = vec2(dot(hM.xy, d), dot(hM.zw, d));
    vec2 safeDq = vec2(
      dq.x >= 0.0 ? max(dq.x, 1e-12) : min(dq.x, -1e-12),
      dq.y >= 0.0 ? max(dq.y, 1e-12) : min(dq.y, -1e-12)
    );
    vec2 tA = (vec2(${glslNum(UV_MIN)}) - q) / safeDq;
    vec2 tB = (hC.xy - q) / safeDq;
    vec2 tNear = min(tA, tB);
    vec2 tFar = max(tA, tB);
    float reach = span * uHullLenMul;
    float t = max(max(tNear.x, tNear.y), 0.0);
    float tEnd = min(min(min(tFar.x, tFar.y), reach), sunDist);
    if (tEnd <= t) continue;

    float layer = hC.z;
    float softMax = distScale * ${glslNum(SOFT_RATIO)};
    float wMin = distScale * ${glslNum(SELF_RATIO)};
    float stepFloor = distScale * ${glslNum(STEP_RATIO)};
    // Piksel na wlasnym kadlubie: bez samocienia — dzien i noc kadluba
    // liczy jego wlasne oswietlenie w shaderze heksow.
    if (t <= 0.0 && hullSdfDist(q, layer, distScale) < wMin) continue;

    float res = 1.0;
    float tRes = t;
    for (int k = 0; k < ${HULL_SDF_MAX_STEPS}; k++) {
      if (k >= uHullSteps || t > tEnd) break;
      float h = hullSdfDist(q + dq * t, layer, distScale);
      // Polcien rosnie z dystansem od statku: ostry przy burcie, miekki dalej.
      float w = max(softMax * clamp(t / span, 0.0, 1.0), wMin);
      float r = h / w;
      if (r < res) { res = r; tRes = t; }
      if (res <= 0.0) break;
      t += max(h, max(stepFloor, w * ${glslNum(PENUMBRA_STEP)}));
    }
    float fall = 1.0 - smoothstep(0.2, 1.0, tRes / max(reach, 1.0));
    shadow = max(shadow, (1.0 - smoothstep(0.0, 1.0, res)) * fall * hC.w);
  }
  return shadow;
}
`;

// ── Pola odległości (czyste funkcje, bez DOM) ──────────────────────────────

const EDT_INF = 1e20;
let _edtF = null;
let _edtD = null;
let _edtV = null;
let _edtZ = null;

function ensureEdtScratch(n) {
  if (_edtF && _edtF.length >= n) return;
  _edtF = new Float64Array(n);
  _edtD = new Float64Array(n);
  _edtV = new Int32Array(n);
  _edtZ = new Float64Array(n + 1);
}

// Dolna obwiednia parabol (Felzenszwalb, Huttenlocher) — 1D, w miejscu.
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -EDT_INF;
  z[1] = EDT_INF;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = EDT_INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

// Kwadrat odległości (w tekselach) każdego teksela do najbliższego teksela
// z mask[i] === target. Brak takiego teksela = ~1e20.
export function squaredDistanceTransform(mask, w, h, target, out = new Float64Array(w * h)) {
  ensureEdtScratch(Math.max(w, h));
  const n = w * h;
  for (let i = 0; i < n; i++) out[i] = mask[i] === target ? 0 : EDT_INF;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) _edtF[y] = out[y * w + x];
    edt1d(_edtF, h, _edtD, _edtV, _edtZ);
    for (let y = 0; y < h; y++) out[y * w + x] = _edtD[y];
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) _edtF[x] = out[row + x];
    edt1d(_edtF, w, _edtD, _edtV, _edtZ);
    for (let x = 0; x < w; x++) out[row + x] = _edtD[x];
  }
  return out;
}

let _sqOut = null;
let _sqIn = null;

// Odległość ze znakiem w tekselach, ujemna w środku. Granica leży w połowie
// między tekselem pełnym a pustym — stąd 0,5 (interpolacja dwuliniowa
// przechodzi przez zero dokładnie tam).
export function signedDistanceField(inside, w, h, out = new Float32Array(w * h)) {
  const n = w * h;
  if (!_sqOut || _sqOut.length < n) {
    _sqOut = new Float64Array(n);
    _sqIn = new Float64Array(n);
  }
  squaredDistanceTransform(inside, w, h, 1, _sqOut);
  squaredDistanceTransform(inside, w, h, 0, _sqIn);
  for (let i = 0; i < n; i++) {
    out[i] = inside[i] ? 0.5 - Math.sqrt(_sqIn[i]) : Math.sqrt(_sqOut[i]) - 0.5;
  }
  return out;
}

function gridLocalOffset(grid) {
  return {
    x: (Number(grid.srcWidth) || 0) * 0.5 + (Number(grid?.pivot?.x) || 0),
    y: (Number(grid.srcHeight) || 0) * 0.5 + (Number(grid?.pivot?.y) || 0)
  };
}

function isShardSolid(s) {
  return !!s && s.active !== false && s.isDebris !== true;
}

function hexRadiusOf(grid) {
  const shards = grid?.shards;
  for (let i = 0; shards && i < shards.length; i++) {
    const r = Number(shards[i]?.radius);
    if (r > 0) return r;
  }
  return 5;
}

// Zasięg aktywnych heksów w układzie lokalnym mesha (px sprite'a względem
// pozycji encji — ta sama klatka co translacje instancji w hexShips3D).
export function measureHullExtent(grid, out = {}) {
  const shards = grid?.shards;
  const off = gridLocalOffset(grid);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, count = 0;
  for (let i = 0; shards && i < shards.length; i++) {
    const s = shards[i];
    if (!isShardSolid(s)) continue;
    const x = (Number(s.gridX) || 0) - off.x;
    const y = (Number(s.gridY) || 0) - off.y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    count++;
  }
  out.minX = minX; out.maxX = maxX; out.minY = minY; out.maxY = maxY; out.count = count;
  return out;
}

// Rozkład siatki SDF: teksel (i, j) ma środek w lokalnym
// (originX + (i + 0,5)·texel, originY + (j + 0,5)·texel).
export function planHullSdfLayout(extent, hexR, out = {}) {
  if (!extent || !(extent.count > 0)) return null;
  const L = HULL_SDF_LAYER_SIZE;
  const M = HULL_SDF_MARGIN_TEXELS;
  const w = extent.maxX - extent.minX + 2 * hexR;
  const h = extent.maxY - extent.minY + 2 * hexR;
  const texel = Math.max(MIN_TEXEL_PX, Math.max(w, h) / (L - 2 * M - 1));
  const gw = Math.min(L, Math.ceil(w / texel) + 2 * M + 1);
  const gh = Math.min(L, Math.ceil(h / texel) + 2 * M + 1);
  out.texel = texel;
  out.gw = gw;
  out.gh = gh;
  out.originX = (extent.minX + extent.maxX) * 0.5 - gw * texel * 0.5;
  out.originY = (extent.minY + extent.maxY) * 0.5 - gh * texel * 0.5;
  out.spanPx = Math.max(w, h);
  return out;
}

// Alfa z mapy (u, v w [0, 1] obrazu), dwuliniowo, 0..1.
function sampleAlphaMap(map, u, v) {
  const x = u * map.w - 0.5;
  const y = v * map.h - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const xa = x0 < 0 ? 0 : (x0 >= map.w ? map.w - 1 : x0);
  const xb = x0 + 1 < 0 ? 0 : (x0 + 1 >= map.w ? map.w - 1 : x0 + 1);
  const ya = y0 < 0 ? 0 : (y0 >= map.h ? map.h - 1 : y0);
  const yb = y0 + 1 < 0 ? 0 : (y0 + 1 >= map.h ? map.h - 1 : y0 + 1);
  const d = map.data;
  const top = d[ya * map.w + xa] * (1 - tx) + d[ya * map.w + xb] * tx;
  const bot = d[yb * map.w + xa] * (1 - tx) + d[yb * map.w + xb] * tx;
  return (top * (1 - ty) + bot * ty) / 255;
}

// Maska sylwetki: środek teksela leży w którymś aktywnym heksie (koło
// opisane — koła opisane na siatce heksów pokrywają płaszczyznę bez dziur),
// a jeśli jest mapa alfy, alfa sprite'a ≥ HULL_SDF_ALPHA_INSIDE. hexOut
// (opcjonalnie) dostaje samo pokrycie heksami — refineSdfEdges nie
// doprecyzowuje brzegów wyrw, tylko krawędź narysowaną alfą.
export function rasterizeHullMask(grid, layout, alphaMap, out, hexOut = null) {
  const { texel, gw, gh, originX, originY } = layout;
  out.fill(0, 0, gw * gh);
  const shards = grid.shards;
  const off = gridLocalOffset(grid);
  for (let i = 0; i < shards.length; i++) {
    const s = shards[i];
    if (!isShardSolid(s)) continue;
    const r = (Number(s.radius) || 5) / texel;
    const r2 = r * r;
    const fx = ((Number(s.gridX) || 0) - off.x - originX) / texel - 0.5;
    const fy = ((Number(s.gridY) || 0) - off.y - originY) / texel - 0.5;
    const x0 = Math.max(0, Math.ceil(fx - r));
    const x1 = Math.min(gw - 1, Math.floor(fx + r));
    const y0 = Math.max(0, Math.ceil(fy - r));
    const y1 = Math.min(gh - 1, Math.floor(fy + r));
    for (let y = y0; y <= y1; y++) {
      const dy = y - fy;
      const row = y * gw;
      for (let x = x0; x <= x1; x++) {
        const dx = x - fx;
        if (dx * dx + dy * dy <= r2) out[row + x] = 1;
      }
    }
  }
  if (hexOut) hexOut.set(out.subarray(0, gw * gh));
  if (alphaMap?.data && alphaMap.w > 0 && alphaMap.h > 0) {
    const invW = 1 / (Number(grid.srcWidth) || 1);
    const invH = 1 / (Number(grid.srcHeight) || 1);
    for (let y = 0; y < gh; y++) {
      const sy = originY + (y + 0.5) * texel + off.y;
      const row = y * gw;
      for (let x = 0; x < gw; x++) {
        if (!out[row + x]) continue;
        const sx = originX + (x + 0.5) * texel + off.x;
        if (sampleAlphaMap(alphaMap, sx * invW, sy * invH) < HULL_SDF_ALPHA_INSIDE) out[row + x] = 0;
      }
    }
  }
  return out;
}

// Krawędź sylwetki z dokładnością poniżej teksela. Maska binarna (środek
// teksela w/poza sylwetką) kładzie zero SDF w połowie między tekselami, więc
// krawędź pływała o ±0,5 teksela (Atlas: ±3,7 j.) — z bliska cień na
// przemian odklejał się od burty i wchodził na nią ząbkami. Na tekselach
// brzegowych (|sdf| < 1) szukamy więc, gdzie alfa przechodzi przez próg
// wzdłuż normalnej (gradient SDF) — bisekcja w ±1,5 teksela — i to jest
// odległość ze znakiem. Brzegi wyrw (pokrycie heksami) zostają binarne,
// i tak są poszarpane; bez przejścia alfy w przedziale (róg, cienki
// element) też zostaje wartość binarna.
const REFINE_REACH = 1.5;
const REFINE_STEPS = 10;

export function refineSdfEdges(sdf, hexMask, grid, layout, alphaMap) {
  if (!alphaMap?.data || !(alphaMap.w > 0) || !(alphaMap.h > 0)) return sdf;
  const { texel, gw, gh, originX, originY } = layout;
  const off = gridLocalOffset(grid);
  const invW = 1 / (Number(grid.srcWidth) || 1);
  const invH = 1 / (Number(grid.srcHeight) || 1);
  const edge = HULL_SDF_ALPHA_INSIDE;
  for (let y = 1; y < gh - 1; y++) {
    const cy = originY + (y + 0.5) * texel + off.y;
    const row = y * gw;
    for (let x = 1; x < gw - 1; x++) {
      const i = row + x;
      const d0 = sdf[i];
      if (!(d0 > -1 && d0 < 1)) continue;
      // Brzeg z alfy tylko wtedy, gdy całe otoczenie leży na heksach.
      if (!hexMask[i] || !hexMask[i - 1] || !hexMask[i + 1] || !hexMask[i - gw] || !hexMask[i + gw] ||
          !hexMask[i - gw - 1] || !hexMask[i - gw + 1] || !hexMask[i + gw - 1] || !hexMask[i + gw + 1]) continue;
      let nx = sdf[i + 1] - sdf[i - 1];
      let ny = sdf[i + gw] - sdf[i - gw];
      const len = Math.hypot(nx, ny);
      if (len < 1e-6) continue;
      nx /= len;                 // na zewnątrz (SDF rośnie)
      ny /= len;
      const cx = originX + (x + 0.5) * texel + off.x;
      const alphaAt = (s) => sampleAlphaMap(alphaMap, (cx + nx * s * texel) * invW, (cy + ny * s * texel) * invH);
      let lo = -REFINE_REACH;    // w stronę środka: alfa ≥ progu
      let hi = REFINE_REACH;     // na zewnątrz: alfa < progu
      if (alphaAt(lo) < edge || alphaAt(hi) >= edge) continue;
      for (let k = 0; k < REFINE_STEPS; k++) {
        const mid = (lo + hi) * 0.5;
        if (alphaAt(mid) >= edge) lo = mid; else hi = mid;
      }
      // Krawędź w s* wzdłuż normalnej na zewnątrz: środek teksela jest o s*
      // PRZED nią, więc odległość ze znakiem (dodatnia na zewnątrz) = -s*.
      sdf[i] = -(lo + hi) * 0.5;
    }
  }
  return sdf;
}

// SDF (teksele) -> bajty warstwy. Poza siatką kadłuba: „daleko” (255).
export function encodeSdfLayer(sdf, gw, gh, dst, dstOffset = 0) {
  const L = HULL_SDF_LAYER_SIZE;
  const k = 127.5 / HULL_SDF_RANGE_TEXELS;
  for (let y = 0; y < L; y++) {
    const rowDst = dstOffset + y * L;
    if (y >= gh) {
      dst.fill(255, rowDst, rowDst + L);
      continue;
    }
    const rowSrc = y * gw;
    for (let x = 0; x < gw; x++) {
      const v = Math.round(127.5 + sdf[rowSrc + x] * k);
      dst[rowDst + x] = v < 0 ? 0 : (v > 255 ? 255 : v);
    }
    if (gw < L) dst.fill(255, rowDst + gw, rowDst + L);
  }
  return dst;
}

let _maskScratch = null;
let _hexScratch = null;
let _sdfScratch = null;
const _extentScratch = {};

// Pieczenie jednej warstwy: maska -> SDF -> bajty w dst[dstOffset..]. Zwraca
// rozkład siatki (wypełniony w layoutOut) albo null, gdy nie ma aktywnych heksów.
export function bakeHullSdfLayer(grid, alphaMap, dst, dstOffset = 0, layoutOut = {}) {
  if (!grid || !Array.isArray(grid.shards) || grid.shards.length === 0) return null;
  const layout = planHullSdfLayout(measureHullExtent(grid, _extentScratch), hexRadiusOf(grid), layoutOut);
  if (!layout) return null;
  const n = HULL_SDF_LAYER_SIZE * HULL_SDF_LAYER_SIZE;
  if (!_maskScratch) {
    _maskScratch = new Uint8Array(n);
    _hexScratch = new Uint8Array(n);
    _sdfScratch = new Float32Array(n);
  }
  rasterizeHullMask(grid, layout, alphaMap, _maskScratch, _hexScratch);
  signedDistanceField(_maskScratch, layout.gw, layout.gh, _sdfScratch);
  refineSdfEdges(_sdfScratch, _hexScratch, grid, layout, alphaMap);
  encodeSdfLayer(_sdfScratch, layout.gw, layout.gh, dst, dstOffset);
  return layout;
}

// 12 floatów okludera dla shadera (układ jak w HULL_SDF_SHADOW_GLSL).
// Przekształcenie = mesh kadłuba w hexShips3D: T(ex, -ey) · Rz(rot) · S(sx, -sy),
// rot = rotation.z mesha (-kąt, a dla orientacji billboardu +kąt), sx/sy ze znakiem.
export function packHullShaftOccluder(out, offset, ex, ey, rot, sx, sy, layout, layer, strength = 1) {
  const L = HULL_SDF_LAYER_SIZE;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const sxs = Number(sx) || 1;
  const sys = Number(sy) || 1;
  const k = layout.texel * L;
  const ox = layout.originX;
  const oy = layout.originY;
  const minScale = Math.min(Math.abs(sxs), Math.abs(sys));
  const maxScale = Math.max(Math.abs(sxs), Math.abs(sys));
  // A: róg (ox, oy) prostokąta SDF w three-space, świat/jednostkę kodu, długość kadłuba
  out[offset] = ex + c * sxs * ox + s * sys * oy;
  out[offset + 1] = -ey + s * sxs * ox - c * sys * oy;
  out[offset + 2] = CODE_SPAN_TEXELS * layout.texel * minScale;
  out[offset + 3] = layout.spanPx * maxScale;
  // M: przesunięcie w świecie -> UV warstwy (odwrotność obrotu i skali mesha)
  out[offset + 4] = c / (sxs * k);
  out[offset + 5] = s / (sxs * k);
  out[offset + 6] = s / (sys * k);
  out[offset + 7] = -c / (sys * k);
  // C: górny róg prostokąta w UV (dolny = pół teksela), warstwa, siła
  out[offset + 8] = (layout.gw - 0.5) / L;
  out[offset + 9] = (layout.gh - 0.5) / L;
  out[offset + 10] = layer;
  out[offset + 11] = strength;
  return out;
}

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// Próbka warstwy jak LinearFilter + ClampToEdge na R8 (0..1).
export function sampleSdfLayer(layerData, layerOffset, u, v) {
  const L = HULL_SDF_LAYER_SIZE;
  const x = u * L - 0.5;
  const y = v * L - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const xa = x0 < 0 ? 0 : (x0 >= L ? L - 1 : x0);
  const xb = x0 + 1 < 0 ? 0 : (x0 + 1 >= L ? L - 1 : x0 + 1);
  const ya = y0 < 0 ? 0 : (y0 >= L ? L - 1 : y0);
  const yb = y0 + 1 < 0 ? 0 : (y0 + 1 >= L ? L - 1 : y0 + 1);
  const d = layerData;
  const o = layerOffset;
  const top = d[o + ya * L + xa] * (1 - tx) + d[o + ya * L + xb] * tx;
  const bot = d[o + yb * L + xa] * (1 - tx) + d[o + yb * L + xb] * tx;
  return (top * (1 - ty) + bot * ty) / 255;
}

// Lustro GLSL (hullSdfShadow dla JEDNEGO kadłuba) — do testów i podglądu
// offline (scripts/podglad-cieni.mjs). worldX/Y i kierunek d w three-space.
export function traceHullShadowCpu(worldX, worldY, dx, dy, sunDist, packed, offset, layerData, options = {}) {
  const steps = Math.min(HULL_SDF_MAX_STEPS, Math.max(1, options.steps ?? 24));
  const lenMul = options.lenMul ?? 3;
  const ax = packed[offset], ay = packed[offset + 1];
  const distScale = packed[offset + 2];
  const span = packed[offset + 3];
  if (!(distScale > 0) || !(span > 0)) return 0;
  const m00 = packed[offset + 4], m01 = packed[offset + 5], m10 = packed[offset + 6], m11 = packed[offset + 7];
  const uMax = packed[offset + 8], vMax = packed[offset + 9];
  const layerOffset = packed[offset + 10] * HULL_SDF_LAYER_SIZE * HULL_SDF_LAYER_SIZE;
  const strength = packed[offset + 11];
  const rx = worldX - ax, ry = worldY - ay;
  const qx = m00 * rx + m01 * ry, qy = m10 * rx + m11 * ry;
  const dqx = m00 * dx + m01 * dy, dqy = m10 * dx + m11 * dy;
  const sdx = dqx >= 0 ? Math.max(dqx, 1e-12) : Math.min(dqx, -1e-12);
  const sdy = dqy >= 0 ? Math.max(dqy, 1e-12) : Math.min(dqy, -1e-12);
  const tAx = (UV_MIN - qx) / sdx, tAy = (UV_MIN - qy) / sdy;
  const tBx = (uMax - qx) / sdx, tBy = (vMax - qy) / sdy;
  const reach = span * lenMul;
  let t = Math.max(Math.max(Math.min(tAx, tBx), Math.min(tAy, tBy)), 0);
  const tEnd = Math.min(Math.min(Math.max(tAx, tBx), Math.max(tAy, tBy)), reach, sunDist);
  if (tEnd <= t) return 0;
  const dist = (u, v) => (sampleSdfLayer(layerData, layerOffset, u, v) - 0.5) * distScale;
  const softMax = distScale * SOFT_RATIO;
  const wMin = distScale * SELF_RATIO;
  const stepFloor = distScale * STEP_RATIO;
  if (t <= 0 && dist(qx, qy) < wMin) return 0;
  let res = 1;
  let tRes = t;
  for (let k = 0; k < HULL_SDF_MAX_STEPS; k++) {
    if (k >= steps || t > tEnd) break;
    const h = dist(qx + dqx * t, qy + dqy * t);
    const w = Math.max(softMax * Math.min(1, Math.max(0, t / span)), wMin);
    const r = h / w;
    if (r < res) { res = r; tRes = t; }
    if (res <= 0) break;
    t += Math.max(h, Math.max(stepFloor, w * PENUMBRA_STEP));
  }
  const fall = 1 - smoothstep(0.2, 1.0, tRes / Math.max(reach, 1));
  return (1 - smoothstep(0, 1, res)) * fall * strength;
}

// ── Runtime: tablica warstw w przeglądarce ─────────────────────────────────

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function imageSize(image) {
  const w = Number(image?.naturalWidth || image?.videoWidth || image?.width) || 0;
  const h = Number(image?.naturalHeight || image?.videoHeight || image?.height) || 0;
  return { w, h };
}

function isImageReady(image) {
  if (!image) return false;
  if (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement && !image.complete) return false;
  const { w, h } = imageSize(image);
  return w > 0 && h > 0;
}

// Mapa alfy obrazu kadłuba, pomniejszona (≤ ALPHA_MAP_MAX_SIDE) i trzymana raz na obraz.
const _alphaMaps = new WeakMap();
const NO_ALPHA = Object.freeze({ data: null, w: 0, h: 0 });

function getAlphaMap(image) {
  if (!image || typeof image !== 'object') return null;
  const cached = _alphaMaps.get(image);
  if (cached) return cached === NO_ALPHA ? null : cached;
  if (!isImageReady(image)) return null;   // bez zapisu — spróbujemy, gdy się wczyta
  let map = null;
  try {
    const { w: iw, h: ih } = imageSize(image);
    const scale = Math.min(1, ALPHA_MAP_MAX_SIDE / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * scale));
    const h = Math.max(1, Math.round(ih * scale));
    const ctx = makeCanvas(w, h)?.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(image, 0, 0, w, h);
      const rgba = ctx.getImageData(0, 0, w, h).data;
      const data = new Uint8Array(w * h);
      for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4 + 3];
      map = { data, w, h };
    }
  } catch {
    map = null;   // np. obraz z innej domeny — wtedy sama maska heksów
  }
  _alphaMaps.set(image, map || NO_ALPHA);
  return map;
}

function activeCountOf(grid) {
  const n = Number(grid.activeStructuralCount);
  return Number.isFinite(n) ? n : grid.shards.length;
}

// Ile heksów musi ubyć, żeby sylwetka zasłużyła na własne pieczenie.
function significantLoss(grid) {
  return Math.max(REBAKE_MIN_HEXES, grid.shards.length * REBAKE_MIN_FRACTION);
}

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function newEntry() {
  return {
    layer: -1,
    layout: { texel: 1, gw: 0, gh: 0, originX: 0, originY: 0, spanPx: 0 },
    shardsRef: null,
    pivotX: 0,
    pivotY: 0,
    activeCount: -1,
    bakedAt: -Infinity
  };
}

export const HullShadowSdf = {
  texture: null,
  data: null,
  layers: null,
  _perGrid: new WeakMap(),
  _templates: new WeakMap(),
  _frame: 0,
  _bakesLeft: MAX_BAKES_PER_FRAME,
  _bakeMs: 0,
  stats: { bakes: 0, bakeMs: 0, evictions: 0 },

  ensureTexture() {
    if (this.texture) return this.texture;
    const L = HULL_SDF_LAYER_SIZE;
    // 255 = „daleko”: warstwa, której nikt nie upiekł, nie rzuca cienia.
    this.data = new Uint8Array(L * L * HULL_SDF_LAYER_COUNT).fill(255);
    const texture = new THREE.DataArrayTexture(this.data, L, L, HULL_SDF_LAYER_COUNT);
    texture.format = THREE.RedFormat;
    texture.type = THREE.UnsignedByteType;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.NoColorSpace;
    texture.unpackAlignment = 1;
    this.texture = texture;
    this.layers = Array.from({ length: HULL_SDF_LAYER_COUNT }, () => ({ owner: null, usedFrame: -1 }));
    return texture;
  },

  // Raz na klatkę, przed zgłaszaniem okluderów: numer klatki (LRU) i budżet pieczenia.
  beginFrame(frameId) {
    const frame = frameId | 0;
    // Licznik klatek wrócił do zera (reset hexShips3D): stare znaczniki LRU
    // byłyby „z przyszłości” i żadnej warstwy nie dałoby się zwolnić.
    if (frame < this._frame && this.layers) {
      for (const layer of this.layers) layer.usedFrame = -1;
    }
    this._frame = frame;
    this._bakesLeft = MAX_BAKES_PER_FRAME;
    this._bakeMs = 0;
    this.stats.bakes = 0;
    this.stats.bakeMs = 0;
  },

  // Po disposeHexShips3D: wszystkie warstwy wolne, sylwetki pieką się od nowa.
  reset() {
    if (this.layers) {
      for (const layer of this.layers) {
        if (layer.owner) layer.owner.layer = -1;
        layer.owner = null;
        layer.usedFrame = -1;
      }
    }
    this._perGrid = new WeakMap();
    this._templates = new WeakMap();
    this._frame = 0;
  },

  // Warstwa z sylwetką kadłuba (entry.layer, entry.layout) albo null, gdy
  // jeszcze nie ma czym rzucić cienia (brak budżetu na pieczenie w tej klatce).
  acquire(grid, frameNowMs = nowMs()) {
    const shards = grid?.shards;
    if (!Array.isArray(shards) || shards.length === 0) return null;
    if (!(Number(grid.srcWidth) > 0) || !(Number(grid.srcHeight) > 0)) return null;
    this.ensureTexture();
    const image = grid.armorImage || grid.visualImage || null;
    const active = activeCountOf(grid);
    const minLoss = significantLoss(grid);

    // Świeży albo tylko draśnięty kadłub (nie fragment): warstwa wspólna dla
    // obrazu i siatki — cała flota jednego typu to jedno pieczenie, a w bitwie
    // draśnięte okręty nie wyczerpują warstw. Szablon piecze się WYŁĄCZNIE ze
    // świeżej siatki, żeby dziury jednego statku nie trafiły do wszystkich.
    if (image && grid.isFragment !== true && shards.length - active < minLoss) {
      const pristine = active >= shards.length;
      const tpl = this._templateEntry(image, grid, pristine);
      if (tpl && tpl.layer >= 0) return this._touch(tpl);
      if (pristine) return this._bake(tpl, grid, image, frameNowMs) ? this._touch(tpl) : null;
    }

    let entry = this._perGrid.get(grid);
    if (!entry) {
      entry = newEntry();
      this._perGrid.set(grid, entry);
    }
    // Wraki idą z puli: ten sam obiekt siatki dostaje nową tablicę heksów
    // (i pivot), więc stara warstwa należy do innego kadłuba.
    const sameShape = entry.layer >= 0 && entry.shardsRef === shards &&
      entry.pivotX === (Number(grid.pivot?.x) || 0) && entry.pivotY === (Number(grid.pivot?.y) || 0);
    const lost = sameShape ? Math.abs(entry.activeCount - active) : 0;
    const age = frameNowMs - entry.bakedAt;
    const stale = lost > 0 && (age >= REBAKE_SMALL_MS || (age >= REBAKE_MS && lost >= minLoss));
    if (!sameShape || stale) {
      if (this._bake(entry, grid, image, frameNowMs)) return this._touch(entry);
    }
    if (sameShape) return this._touch(entry);
    // Uszkodzony kadłub do pierwszego własnego pieczenia: sylwetka szablonu.
    if (image && grid.isFragment !== true) {
      const tpl = this._templateEntry(image, grid, false);
      if (tpl && tpl.layer >= 0) return this._touch(tpl);
    }
    return null;
  },

  _templateEntry(image, grid, create) {
    let byKey = this._templates.get(image);
    if (!byKey) {
      if (!create) return null;
      byKey = new Map();
      this._templates.set(image, byKey);
    }
    // Liczbowy klucz bez alokacji: wymiary siatki i liczba heksów.
    const key = ((Number(grid.srcWidth) | 0) * 16384 + (Number(grid.srcHeight) | 0)) * 1048576 + grid.shards.length;
    let entry = byKey.get(key);
    if (!entry && create) {
      entry = newEntry();
      byKey.set(key, entry);
    }
    return entry || null;
  },

  _touch(entry) {
    this.layers[entry.layer].usedFrame = this._frame;
    return entry;
  },

  _allocLayer(entry) {
    const layers = this.layers;
    for (let i = 0; i < layers.length; i++) {
      if (!layers[i].owner) {
        layers[i].owner = entry;
        return i;
      }
    }
    let best = -1;
    let bestFrame = Infinity;
    for (let i = 0; i < layers.length; i++) {
      const used = layers[i].usedFrame;
      if (used < this._frame && used < bestFrame) {
        best = i;
        bestFrame = used;
      }
    }
    if (best < 0) return -1;
    const prev = layers[best].owner;
    if (prev) prev.layer = -1;
    layers[best].owner = entry;
    this.stats.evictions++;
    return best;
  },

  _bake(entry, grid, image, frameNowMs) {
    if (this._bakesLeft <= 0) return false;
    if (this._bakesLeft < MAX_BAKES_PER_FRAME && this._bakeMs >= BAKE_BUDGET_MS) return false;
    const t0 = nowMs();
    let layer = entry.layer;
    if (layer < 0 || this.layers[layer].owner !== entry) {
      layer = this._allocLayer(entry);
      if (layer < 0) return false;
    }
    const L = HULL_SDF_LAYER_SIZE;
    const layout = bakeHullSdfLayer(grid, getAlphaMap(image), this.data, layer * L * L, entry.layout);
    if (!layout) {
      // Brak aktywnych heksów: warstwa wraca do puli, kadłub nie rzuca cienia.
      this.layers[layer].owner = null;
      this.layers[layer].usedFrame = -1;
      entry.layer = -1;
      return false;
    }
    entry.layer = layer;
    entry.shardsRef = grid.shards;
    entry.pivotX = Number(grid.pivot?.x) || 0;
    entry.pivotY = Number(grid.pivot?.y) || 0;
    entry.activeCount = activeCountOf(grid);
    entry.bakedAt = frameNowMs;
    this.texture.addLayerUpdate(layer);
    this.texture.needsUpdate = true;
    const ms = nowMs() - t0;
    this._bakesLeft--;
    this._bakeMs += ms;
    this.stats.bakes++;
    this.stats.bakeMs += ms;
    return true;
  }
};
