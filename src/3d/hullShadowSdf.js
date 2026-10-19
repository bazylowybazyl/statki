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
// odległość ze znakiem od sylwetki (alfa sprite'a ∩ żywe komórki kadłuba), ujemna
// w środku. Pass maski (hullSdfShadow — TSL) przenosi piksel do układu
// statku (to samo przekształcenie co mesh kadłuba), przycina promień do
// prostokąta warstwy, w kanale powierzchni pomija piksele NA własnym kadłubie
// (tło idzie dalej — przez dziury) i idzie po SDF w stronę słońca (sphere tracing). Półcień = najmniejszy stosunek
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
import { createCanvas2D, imageSize, isImageReady } from './canvas2d.js';
import { Break, Continue, If, Loop, clamp, dot, float, int, max, min, select, smoothstep, texture, vec2 } from 'three/tsl';

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
// Próg alfy sylwetki. Komórka brzegowa wystaje do promienia poza rysowaną
// krawędź, więc sama maska komórek dawała szczelinę światła przy burcie;
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
// Ponowne pieczenie po trafieniach: po większej stracie (≥ 0,5% komórek, min. 8)
// najczęściej co sekundę, drobne ubytki dopiero po 4 s. Sylwetka z kilkoma
// komórkami mniej wygląda tak samo, a pieczenie Atlasa to ~2–4 ms.
const REBAKE_MS = 1000;
const REBAKE_SMALL_MS = 4000;
const REBAKE_MIN_FRACTION = 0.005;
const REBAKE_MIN_CELLS = 8;
const BAKE_BUDGET_MS = 2.5;
const MAX_BAKES_PER_FRAME = 2;
const ALPHA_MAP_MAX_SIDE = 1024;   // ~1,8 px sprite'a Atlasa na teksel alfy — pod pokrycie brzegu

const CODE_SPAN_TEXELS = 2 * HULL_SDF_RANGE_TEXELS;   // teksele na cały zakres kodu 0..1
const SOFT_RATIO = HULL_SDF_SOFT_TEXELS / CODE_SPAN_TEXELS;
const SELF_RATIO = SELF_BIAS_TEXELS / CODE_SPAN_TEXELS;
const STEP_RATIO = STEP_FLOOR_TEXELS / CODE_SPAN_TEXELS;
const UV_MIN = 0.5 / HULL_SDF_LAYER_SIZE;

// Stałe marszu dla testów i narzędzi (lustro CPU i TSL liczą z tych samych liczb).
export const HULL_SDF_TRACE_CONSTANTS = Object.freeze({
  uvMin: UV_MIN, softRatio: SOFT_RATIO, selfRatio: SELF_RATIO, stepRatio: STEP_RATIO, penumbraStep: PENUMBRA_STEP
});

// Tablica warstw zastępcza (1×1×1, 255 = „daleko”), dopóki hexShips3D nie poda tablicy
// HullShadowSdf: węzeł tekstury potrzebuje przy budowie tekstury tego samego rodzaju
// (texture_2d_array, R8, filtr liniowy), a przy uHullCount = 0 i tak nic jej nie czyta.
export function createHullSdfPlaceholderTexture() {
  const t = new THREE.DataArrayTexture(new Uint8Array([255]), 1, 1, 1);
  t.name = 'hullShadowSdf:zastepcza';
  t.format = THREE.RedFormat;
  t.type = THREE.UnsignedByteType;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

// Cień kadłubów w passie maski słońca (core3d.js) — TSL, port dawnego HULL_SDF_SHADOW_GLSL
// 1:1 (te same wzory w tej samej kolejności). Wklejana, bez setLayout: czyta tablice
// uniformów i teksturę warstw (funkcja z layoutem i uniformem w domknięciu jest w three r183
// buforowana globalnie — PLAN §3). Uniformy wypełnia Core3D z rejestru pushShaftHullSdf:
//   u.uHullA[i] = (początek prostokąta SDF w three-space xy, świat na jednostkę
//                  kodu tekstury, długość kadłuba w świecie)
//   u.uHullM[i] = macierz: przesunięcie w świecie -> UV warstwy
//   u.uHullC[i] = (max U, max V prostokąta, warstwa, siła)
//   u.uHullSdf  = węzeł bazowy tablicy warstw (z uv-atrapą), u.uHullCount / uHullSteps (int),
//   u.uHullLenMul (float). Węzły, nie wpisy adaptera (dla uniformArray — `.node`).
// worldP (vec2, three-space), d = jednostkowy kierunek DO słońca, sunDist — węzły float.
// Wynik: vec2 najciemniejszego cienia kadłubów, 0 = brak, 1 = pełny (przed siłą cienia kadłuba):
//   x — POWIERZCHNIA (kanał R maski): piksel na własnym kadłubie bez samocienia,
//   y — TŁO (kanał G): bez tego pominięcia. Sylwetka SDF jest szersza od rysowanej skóry przy
//       dziurach (koła opisane na komórkach, poszarpany brzeg hullTearFray wycina do ~¾ komórki),
//       więc z pominięciem tło w pasie przy brzegu każdej wyrwy wychodziło oświetlone, a głębiej
//       w cieniu — jasna, ziarnista obwódka wyglądała jak przezroczysty kadłub (2026-10-07).
//       Pod blachą tło i tak jest zasłonięte; marsz od SDF < 0 kończy się na pierwszej próbce.
// Próbki warstw z jawnym poziomem 0 (textureSampleLevel) — w pętli zależnej od piksela
// WGSL nie pozwala na próbkowanie z pochodnymi.
// Zmieniając logikę, zmień też traceHullShadowCpu (lustro dla testów).
export function hullSdfShadow(u, worldP, d, sunDist) {
  const shadow = float(0.0).toVar('hullShadow');
  const backdrop = float(0.0).toVar('hullBackdrop');
  Loop({ start: int(0), end: u.uHullCount, type: 'int', condition: '<', name: 'hullIdx' }, ({ hullIdx }) => {
    // Pudło cienia kadłuba w świecie (u.uHullB[i] = minX, minY, maxX, maxY — Core3D liczy je na CPU z prostokąta SDF
    // przesuniętego od słońca o zasięg cienia, z zapasem na kierunek do słońca w kadrze; hullShadowAabb): piksel poza
    // nim nie może dostać cienia tego kadłuba (promień ku słońcu nie trafia prostokąta SDF w zasięgu) — bez
    // przekształceń i odczytów A / M / C (2026-10-17: przy 5120×1440 pętla po 32 kadłubach na każdym pikselu
    // kosztowała ~0,6–0,75 ms GPU maski).
    if (u.uHullB) {
      const hB = u.uHullB.element(hullIdx);
      If(worldP.x.lessThan(hB.x).or(worldP.y.lessThan(hB.y)).or(worldP.x.greaterThan(hB.z)).or(worldP.y.greaterThan(hB.w)), () => { Continue(); });
    }
    const hA = u.uHullA.element(hullIdx).toVar();
    const hM = u.uHullM.element(hullIdx).toVar();
    const hC = u.uHullC.element(hullIdx).toVar();
    const distScale = hA.z.toVar();
    const span = hA.w.toVar();
    If(distScale.lessThanEqual(0.0).or(span.lessThanEqual(0.0)), () => { Continue(); });

    // Piksel i promień w UV warstwy — to samo przekształcenie co mesh kadłuba.
    const rel = worldP.sub(hA.xy).toVar();
    const q = vec2(dot(hM.xy, rel), dot(hM.zw, rel)).toVar();
    const dq = vec2(dot(hM.xy, d), dot(hM.zw, d)).toVar();
    const safeDq = vec2(
      select(dq.x.greaterThanEqual(0.0), max(dq.x, 1e-12), min(dq.x, -1e-12)),
      select(dq.y.greaterThanEqual(0.0), max(dq.y, 1e-12), min(dq.y, -1e-12))
    ).toVar();
    const tA = vec2(UV_MIN).sub(q).div(safeDq).toVar();
    const tB = hC.xy.sub(q).div(safeDq).toVar();
    const tNear = min(tA, tB).toVar();
    const tFar = max(tA, tB).toVar();
    const reach = span.mul(u.uHullLenMul).toVar();
    const t = max(max(tNear.x, tNear.y), 0.0).toVar();
    const tEnd = min(min(min(tFar.x, tFar.y), reach), sunDist).toVar();
    If(tEnd.lessThanEqual(t), () => { Continue(); });

    const layer = hC.z.toVar();
    const softMax = distScale.mul(SOFT_RATIO).toVar();
    const wMin = distScale.mul(SELF_RATIO).toVar();
    const stepFloor = distScale.mul(STEP_RATIO).toVar();
    const hullSdfDist = (uvNode) => texture(u.uHullSdf, uvNode, float(0)).depth(layer).r.sub(0.5).mul(distScale);
    // Piksel na własnym kadłubie: powierzchnia bez samocienia — dzień i noc kadłuba
    // liczy jego własne oświetlenie w materiale kadłuba; tło idzie marszem dalej (opis funkcji).
    // (Próbka tylko przy t <= 0, jak skrócone && w GLSL — TSL wyciąga odczyt przed warunek złożony.)
    const onHull = float(0.0).toVar();
    If(t.lessThanEqual(0.0), () => {
      If(hullSdfDist(q).lessThan(wMin), () => { onHull.assign(1.0); });
    });

    const res = float(1.0).toVar();
    const tRes = float(t).toVar();
    Loop({ start: int(0), end: u.uHullSteps, type: 'int', condition: '<', name: 'hullStep' }, () => {
      If(t.greaterThan(tEnd), () => { Break(); });
      const h = hullSdfDist(q.add(dq.mul(t))).toVar();
      // Półcień rośnie z dystansem od statku: ostry przy burcie, miękki dalej.
      const w = max(softMax.mul(clamp(t.div(span), 0.0, 1.0)), wMin).toVar();
      const r = h.div(w).toVar();
      If(r.lessThan(res), () => {
        res.assign(r);
        tRes.assign(t);
      });
      If(res.lessThanEqual(0.0), () => { Break(); });
      t.addAssign(max(h, max(stepFloor, w.mul(PENUMBRA_STEP))));
    });
    const fall = float(1.0).sub(smoothstep(0.2, 1.0, tRes.div(max(reach, 1.0))));
    const hullShade = float(1.0).sub(smoothstep(0.0, 1.0, res)).mul(fall).mul(hC.w).toVar();
    shadow.assign(max(shadow, hullShade.mul(float(1.0).sub(onHull))));
    backdrop.assign(max(backdrop, hullShade));
  });
  return vec2(shadow, backdrop);
}

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

// Siatka komórek kadłuba na belkach (hexShips3D → beamShadowGrid): tablice typowane — cellX/cellY (piksel
// sprite'a od lewego górnego rogu), cellActive (żywe), cellCount, cellRadius (koło opisane komórki).
// Liczba komórek — mianownik utraty i klucz szablonu; 0 = siatka bez komórek.
function cellCountOf(grid) {
  return grid?.cellX instanceof Float32Array ? grid.cellCount | 0 : 0;
}

// Zasięg żywych komórek w układzie lokalnym mesha (px sprite'a względem
// pozycji encji — ta sama klatka co skóra kadłuba w hexShips3D).
export function measureHullExtent(grid, out = {}) {
  const off = gridLocalOffset(grid);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, count = 0;
  const cx = grid.cellX, cy = grid.cellY, alive = grid.cellActive, n = cellCountOf(grid);
  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    const x = cx[i] - off.x;
    const y = cy[i] - off.y;
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
export function planHullSdfLayout(extent, cellR, out = {}) {
  if (!extent || !(extent.count > 0)) return null;
  const L = HULL_SDF_LAYER_SIZE;
  const M = HULL_SDF_MARGIN_TEXELS;
  const w = extent.maxX - extent.minX + 2 * cellR;
  const h = extent.maxY - extent.minY + 2 * cellR;
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

// Maska sylwetki: środek teksela leży w którejś żywej komórce (koło
// opisane — koła opisane na siatce komórek pokrywają płaszczyznę bez dziur),
// a jeśli jest mapa alfy, alfa sprite'a ≥ HULL_SDF_ALPHA_INSIDE. cellOut
// (opcjonalnie) dostaje samo pokrycie komórkami — refineSdfEdges nie
// doprecyzowuje brzegów wyrw, tylko krawędź narysowaną alfą.
export function rasterizeHullMask(grid, layout, alphaMap, out, cellOut = null) {
  const { texel, gw, gh, originX, originY } = layout;
  out.fill(0, 0, gw * gh);
  const off = gridLocalOffset(grid);
  const total = cellCountOf(grid);
  const r = (grid.cellRadius || 5) / texel;
  const r2 = r * r;
  for (let i = 0; i < total; i++) {
    if (!grid.cellActive[i]) continue;
    const fx = (grid.cellX[i] - off.x - originX) / texel - 0.5;
    const fy = (grid.cellY[i] - off.y - originY) / texel - 0.5;
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
  if (cellOut) cellOut.set(out.subarray(0, gw * gh));
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
// odległość ze znakiem. Brzegi wyrw (pokrycie komórkami) zostają binarne,
// i tak są poszarpane; bez przejścia alfy w przedziale (róg, cienki
// element) też zostaje wartość binarna.
const REFINE_REACH = 1.5;
const REFINE_STEPS = 10;

export function refineSdfEdges(sdf, cellMask, grid, layout, alphaMap) {
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
      // Brzeg z alfy tylko wtedy, gdy całe otoczenie leży na komórkach.
      if (!cellMask[i] || !cellMask[i - 1] || !cellMask[i + 1] || !cellMask[i - gw] || !cellMask[i + gw] ||
          !cellMask[i - gw - 1] || !cellMask[i - gw + 1] || !cellMask[i + gw - 1] || !cellMask[i + gw + 1]) continue;
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
let _cellScratch = null;
let _sdfScratch = null;
const _extentScratch = {};

// Pieczenie jednej warstwy: maska -> SDF -> bajty w dst[dstOffset..]. Zwraca
// rozkład siatki (wypełniony w layoutOut) albo null, gdy nie ma żywych komórek.
export function bakeHullSdfLayer(grid, alphaMap, dst, dstOffset = 0, layoutOut = {}) {
  if (!grid || cellCountOf(grid) === 0) return null;
  const layout = planHullSdfLayout(measureHullExtent(grid, _extentScratch), grid.cellRadius || 5, layoutOut);
  if (!layout) return null;
  const n = HULL_SDF_LAYER_SIZE * HULL_SDF_LAYER_SIZE;
  if (!_maskScratch) {
    _maskScratch = new Uint8Array(n);
    _cellScratch = new Uint8Array(n);
    _sdfScratch = new Float32Array(n);
  }
  rasterizeHullMask(grid, layout, alphaMap, _maskScratch, _cellScratch);
  signedDistanceField(_maskScratch, layout.gw, layout.gh, _sdfScratch);
  refineSdfEdges(_sdfScratch, _cellScratch, grid, layout, alphaMap);
  encodeSdfLayer(_sdfScratch, layout.gw, layout.gh, dst, dstOffset);
  return layout;
}

// 12 floatów okludera dla passa maski (układ A, M, C jak w hullSdfShadow).
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

/**
 * Pudło cienia kadłuba w świecie (three-space) do uHullB maski słońca: prostokąt SDF (UV [UV_MIN, C]) z wpisu
 * packHullShaftOccluder (A, M, C od `offset`) i ten sam prostokąt cofnięty od słońca o zasięg cienia (`reach` =
 * długość kadłuba × uHullLenMul). Kierunek do słońca liczy shader per piksel — zapas na jego zmianę w obrębie
 * cienia; słońce bliżej niż zasięg — pudło „wszędzie”. Wynik do `out[o..o+3]` = minX, minY, maxX, maxY.
 */
export function hullShadowAabb(out, o, packed, offset, sunX, sunY, lenMul) {
  const ax = packed[offset], ay = packed[offset + 1];
  const reach = Math.max(0, packed[offset + 3] * lenMul);
  const m0 = packed[offset + 4], m1 = packed[offset + 5], m2 = packed[offset + 6], m3 = packed[offset + 7];
  const cu = packed[offset + 8], cv = packed[offset + 9];
  const det = m0 * m3 - m1 * m2;
  if (!(Math.abs(det) > 1e-30) || !Number.isFinite(det)) { out[o] = -1e30; out[o + 1] = -1e30; out[o + 2] = 1e30; out[o + 3] = 1e30; return out; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, cx = 0, cy = 0;
  for (let k = 0; k < 4; k++) {
    const qu = (k & 1) ? cu : UV_MIN, qv = (k & 2) ? cv : UV_MIN;
    const wx = ax + (m3 * qu - m1 * qv) / det;
    const wy = ay + (-m2 * qu + m0 * qv) / det;
    cx += wx * 0.25; cy += wy * 0.25;
    if (wx < x0) x0 = wx; if (wx > x1) x1 = wx; if (wy < y0) y0 = wy; if (wy > y1) y1 = wy;
  }
  const sx = sunX - cx, sy = sunY - cy;
  const sunD = Math.sqrt(sx * sx + sy * sy);
  const diag = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
  const far = diag + reach;
  if (!(sunD > far * 2 + 1)) { out[o] = -1e30; out[o + 1] = -1e30; out[o + 2] = 1e30; out[o + 3] = 1e30; return out; }
  const dx = sx / sunD, dy = sy / sunD;
  // przesunięcie od słońca: P = punkt prostokąta − d · t, t ∈ [0, reach]
  const bx0 = Math.min(x0, x0 - dx * reach), bx1 = Math.max(x1, x1 - dx * reach);
  const by0 = Math.min(y0, y0 - dy * reach), by1 = Math.max(y1, y1 - dy * reach);
  // kierunek ku słońcu z piksela P odchyla się od kierunku ze środka o ≤ |P − środek| / (|słońce − środek| − |P − środek|)
  const pad = reach * (far / (sunD - far)) + 2 + 0.01 * far;
  out[o] = bx0 - pad; out[o + 1] = by0 - pad; out[o + 2] = bx1 + pad; out[o + 3] = by1 + pad;
  return out;
}

function smoothstepCpu(e0, e1, x) {
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

// Lustro CPU hullSdfShadow (TSL) dla JEDNEGO kadłuba — do testów i podglądu
// offline (scripts/podglad-cieni.mjs). worldX/Y i kierunek d w three-space.
// Domyślnie kanał powierzchni (x), options.backdrop = true — kanał tła (y, bez pominięcia
// własnego kadłuba).
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
  if (t <= 0 && dist(qx, qy) < wMin && options.backdrop !== true) return 0;
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
  const fall = 1 - smoothstepCpu(0.2, 1.0, tRes / Math.max(reach, 1));
  return (1 - smoothstepCpu(0, 1, res)) * fall * strength;
}

// ── Runtime: tablica warstw w przeglądarce ─────────────────────────────────

const makeCanvas = createCanvas2D;

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
    map = null;   // np. obraz z innej domeny — wtedy sama maska komórek
  }
  _alphaMaps.set(image, map || NO_ALPHA);
  return map;
}

function activeCountOf(grid) {
  const n = Number(grid.activeStructuralCount);
  return Number.isFinite(n) ? n : cellCountOf(grid);
}

// Ile komórek musi ubyć, żeby sylwetka zasłużyła na własne pieczenie.
function significantLoss(grid) {
  return Math.max(REBAKE_MIN_CELLS, cellCountOf(grid) * REBAKE_MIN_FRACTION);
}

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function newEntry() {
  return {
    layer: -1,
    layout: { texel: 1, gw: 0, gh: 0, originX: 0, originY: 0, spanPx: 0 },
    cellsRef: null,
    pivotX: 0,
    pivotY: 0,
    activeCount: -1,
    bakedAt: -Infinity,
    empty: false       // ostatnie pieczenie nie znalazło żywej komórki
  };
}

// Siatka ta sama, którą entry ostatnio piekło. Ten sam obiekt siatki dostaje
// nowe tablice komórek (zagęszczenie magazynu ciała po rozpadzie) i pivot —
// stara warstwa należy wtedy do innego kształtu.
function sameGridAs(entry, grid) {
  return entry.cellsRef === grid.cellX &&
    entry.pivotX === (Number(grid.pivot?.x) || 0) && entry.pivotY === (Number(grid.pivot?.y) || 0);
}

export const HullShadowSdf = {
  texture: null,
  data: null,
  layers: null,
  // Wgranie JEDNEJ warstwy po pieczeniu: (texture, layer) => true, gdy warstwa poszła na GPU.
  // Ustawia Core3D (uploadTextureLayer): three r183 w WebGPU ignoruje texture.layerUpdates
  // i na needsUpdate wgrywa całą tablicę — 64 × 256² = 4 MB, ~3 ms CPU na KAŻDE pieczenie
  // (zmierzone, zadanie 03); jedna warstwa to 64 KB. Bez haka albo zanim tablica jest na GPU
  // (false) — needsUpdate jak dotąd.
  layerUploader: null,
  _perGrid: new WeakMap(),
  _templates: new WeakMap(),
  _frame: 0,
  _bakesLeft: MAX_BAKES_PER_FRAME,
  _bakeMs: 0,
  stats: { bakes: 0, bakeMs: 0, evictions: 0, layerUploads: 0 },

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
    // Cała tablica („daleko”) na GPU przy pierwszym użyciu — potem pieczenia wgrywają
    // pojedyncze warstwy (layerUploader).
    texture.needsUpdate = true;
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
    this.stats.layerUploads = 0;
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
  // jeszcze nie ma czym rzucić cienia (brak budżetu na pieczenie w tej
  // klatce) albo kadłub nie ma już żadnej żywej komórki.
  acquire(grid, frameNowMs = nowMs()) {
    const total = cellCountOf(grid);
    if (!(total > 0)) return null;
    if (!(Number(grid.srcWidth) > 0) || !(Number(grid.srcHeight) > 0)) return null;
    this.ensureTexture();
    const image = grid.armorImage || grid.visualImage || null;
    const active = activeCountOf(grid);
    const minLoss = significantLoss(grid);

    // Świeży albo tylko draśnięty kadłub (nie fragment): warstwa wspólna dla
    // obrazu i siatki — cała flota jednego typu to jedno pieczenie, a w bitwie
    // draśnięte okręty nie wyczerpują warstw. Szablon piecze się WYŁĄCZNIE ze
    // świeżej siatki, żeby dziury jednego statku nie trafiły do wszystkich.
    if (image && grid.isFragment !== true && total - active < minLoss) {
      const pristine = active >= total;
      const tpl = this._templateEntry(image, grid, pristine);
      if (tpl && tpl.layer >= 0) return this._touch(tpl);
      if (pristine) return this._bake(tpl, grid, image, frameNowMs) ? this._touch(tpl) : null;
    }

    let entry = this._perGrid.get(grid);
    if (!entry) {
      entry = newEntry();
      this._perGrid.set(grid, entry);
    }
    // Kadłub bez żywej komórki (hulk po mostku, pocięty wrak) nie rzuca
    // cienia — także z szablonu — i nie piecze się co klatkę, dopóki siatka
    // albo liczba komórek się nie zmieni.
    if (entry.empty && entry.activeCount === active && sameGridAs(entry, grid)) return null;
    const sameShape = entry.layer >= 0 && sameGridAs(entry, grid);
    const lost = sameShape ? Math.abs(entry.activeCount - active) : 0;
    const age = frameNowMs - entry.bakedAt;
    const stale = lost > 0 && (age >= REBAKE_SMALL_MS || (age >= REBAKE_MS && lost >= minLoss));
    if (!sameShape || stale) {
      if (this._bake(entry, grid, image, frameNowMs)) return this._touch(entry);
      // Pieczenie nie znalazło komórek i oddało warstwę: sameShape jest już
      // nieaktualne, a _touch(entry) sięgnąłby po layers[-1].
      if (entry.empty) return null;
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
    // Liczbowy klucz bez alokacji: wymiary siatki i liczba komórek.
    const key = ((Number(grid.srcWidth) | 0) * 16384 + (Number(grid.srcHeight) | 0)) * 1048576 + cellCountOf(grid);
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

  // false: brak budżetu albo warstwy (entry bez zmian, stara sylwetka zostaje)
  // albo kadłub bez żywej komórki (entry.empty, warstwa oddana).
  _bake(entry, grid, image, frameNowMs) {
    entry.empty = false;
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
    entry.cellsRef = grid.cellX;
    entry.pivotX = Number(grid.pivot?.x) || 0;
    entry.pivotY = Number(grid.pivot?.y) || 0;
    entry.activeCount = activeCountOf(grid);
    entry.bakedAt = frameNowMs;
    if (!layout) {
      // Brak żywych komórek: warstwa wraca do puli, kadłub nie rzuca cienia.
      this.layers[layer].owner = null;
      this.layers[layer].usedFrame = -1;
      entry.layer = -1;
      entry.empty = true;
      return false;
    }
    entry.layer = layer;
    if (typeof this.layerUploader === 'function' && this.layerUploader(this.texture, layer) === true) {
      this.stats.layerUploads++;
    } else {
      this.texture.addLayerUpdate(layer);
      this.texture.needsUpdate = true;
    }
    const ms = nowMs() - t0;
    this._bakesLeft--;
    this._bakeMs += ms;
    this.stats.bakes++;
    this.stats.bakeMs += ms;
    return true;
  }
};
