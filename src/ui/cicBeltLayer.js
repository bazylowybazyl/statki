// =============================================================================
// CIC — WARSTWA PASÓW ASTEROID (2026-10-18, prośba użytkownika: „dodaj info, gdzie są pasy asteroid; uważaj na
// wydajność”)
// =============================================================================
// Źródło prawdy = pole pasa GRY (AsteroidBeltField.sampleMacro — ta sama gęstość, z której rodzą się skały):
// obwiednia regionów (pas główny, Hungarie, NEA, Hildy, Trojańczycy, Kuiper z plutonkami), gęste pola i obrzeża.
//
// KOSZT: gęstość liczy się RAZ, w kaflach mapy (piramida jak w mapach kafelkowych): kafel = 128 × 128 komórek
// (+ 1 komórka zapasu z każdej strony — dwuliniowe łączenie i kontury bez szwów), komórka poziomu k =
// CIC_BELT_CELL0 · 2^k j. Poziom dobiera zoom (komórka ≈ `cellPx` px ekranu), więc w kadrze jest kilka kafli
// przy każdym zoomie. Kafel pieczony w budżecie czasu klatki (`bakeMs`, wiersz po wierszu), wynik = ImageBitmap
// (gęstość, kolor regionu) + kontury (marching squares, linie łączone w łańcuchy → Path2D) — w klatce tylko
// drawImage i stroke na kafel. Pole jest stałe w całej grze (planety-kotwice zamrożone przy budowie regionów),
// więc kafle żyją do końca gry (LRU, korzeń całego układu przypięty — zawsze jest czym zastąpić kafel w wypieku).
// Kafel poza wszystkimi regionami (rectTouchesBelt) — pusty, bez próbkowania.
//
// LUKI KIRKWOODA rysowane wektorowo (pas o prawdziwej szerokości z BELT_FIELD_CONFIG): w rastrze grubszych
// poziomów luka 0,24–0,5 AU dawałaby mory — raster bierze obwiednię i pola BEZ luk (gap odjęty).
//
// Moduł czysty względem gry: pole podaje `getField()` (w grze window.__beltWorld.field), bez DOM poza kanwami
// (OffscreenCanvas; w Node — same dane, testy tests/cicBeltLayer.test.mjs).
import { REGION_FAMILIES } from '../data/asteroidFamilies.js';

export const CIC_BELT_N = 128;
const PAD = 1;
export const CIC_BELT_TEX = CIC_BELT_N + PAD * 2;
// Najmniejsza komórka [j.]: cechy pola ≥ ~5 tys. j. (najwyższa oktawa szumu pól ~30 tys., krawędź wewnętrzna pasa
// głównego ~20 tys.), więc drobniejszy raster nic nie dodaje.
export const CIC_BELT_CELL0 = 2048;
// Najgrubszy poziom: komórka 2048 · 2^6 = 131 tys. j., kafel 16,8 mln j. — cały układ (świat 12 mln j., Słońce
// w środku, Kuiper 140 AU ≈ 5,9 mln j.); przy najdalszym zoomie CIC (~6·10⁻⁵) komórka ≈ 8 px.
export const CIC_BELT_KMAX = 6;

export const CIC_BELT_TUNE = {
  on: true,
  cellPx: 6,          // docelowy bok komórki kafla na ekranie [px]
  bakeMs: 2,          // budżet wypieku kafli na klatkę [ms]
  maxTiles: 96,       // kafli w pamięci (LRU; ~67 kB na kafel)
  fill: true,         // obraz gęstości (kafle)
  cache: true,        // pamięć kadru (kanwa pomocnicza) — A/B: false = rysunek wprost co klatkę
  contours: true,
  beltIso: 0.2,       // kontur pasa (obwiednia × gęstość regionu)
  fieldIso: 0.16,     // kontur gęstego pola
  lanes: true,        // luki Kirkwooda
  labels: true,
  giants: true,
  families: true
};

// Nazwy regionów dla gracza (beltId z src/data/asteroidTypes.js: BELT_DEFINITIONS).
export const CIC_BELT_NAMES = Object.freeze({
  main: 'PAS GŁÓWNY',
  hungarias: 'HUNGARIE',
  nea: 'NEA · BLISKIE ZIEMI',
  hildas: 'HILDY',
  greeks: 'TROJAŃCZYCY L4 · GRECY',
  trojans: 'TROJAŃCZYCY L5',
  kuiper: 'PAS KUIPERA',
  plutinos: 'PLUTONKI',
  kuiper_cold: 'ZIMNY PAS KLASYCZNY'
});

// Barwy regionów: rzadki pas → gęste pole. Pas główny — piasek (krzem, węgiel, metal), roje przy Jowiszu — rdza
// (D / P), Kuiper — lód; NEA i Hungarie — szarość (rzadkie populacje).
const PAL_MAIN = 0, PAL_DTYPE = 1, PAL_ICE = 2, PAL_GREY = 3, PAL_PALE = 4;
export const CIC_BELT_PALETTES = Object.freeze([
  Object.freeze({ base: [196, 160, 106], field: [255, 212, 136], line: '232, 196, 128' }),
  Object.freeze({ base: [190, 110, 82], field: [255, 158, 116], line: '238, 150, 112' }),
  Object.freeze({ base: [104, 168, 210], field: [172, 226, 255], line: '150, 210, 245' }),
  Object.freeze({ base: [140, 150, 164], field: [186, 196, 210], line: '170, 182, 198' }),
  Object.freeze({ base: [168, 176, 198], field: [206, 214, 234], line: '196, 204, 226' })
]);
const PAL_BY_BELT = Object.freeze({
  main: PAL_MAIN, hildas: PAL_DTYPE, greeks: PAL_DTYPE, trojans: PAL_DTYPE,
  kuiper: PAL_ICE, plutinos: PAL_ICE, kuiper_cold: PAL_ICE, nea: PAL_GREY, hungarias: PAL_PALE
});
export function cicBeltPaletteIndex(beltId) {
  const p = PAL_BY_BELT[beltId];
  return p === undefined ? PAL_GREY : p;
}

/**
 * Poziom piramidy dla zoomu (komórka ≈ cellPx px) z histerezą: poprzedni poziom zostaje, dopóki idealny (ciągły)
 * nie odjedzie o > 0,75 (bez przeskoków tam i z powrotem przy powolnym zoomie).
 */
export function cicBeltLevelFor(zoom, prevK = -1, cellPx = CIC_BELT_TUNE.cellPx) {
  if (!(zoom > 0)) return CIC_BELT_KMAX;
  const ideal = Math.log2(cellPx / (zoom * CIC_BELT_CELL0));
  if (prevK >= 0 && Math.abs(ideal - prevK) < 0.75) return prevK;
  return Math.max(0, Math.min(CIC_BELT_KMAX, Math.round(ideal)));
}

/**
 * Próbka pola → wartości komórki: w — obwiednia (gęstość regionu), f — gęste pole, rim — obrzeże pola (oba bez luk
 * Kirkwooda i wygaszone przy krawędzi pasa). Wynik w `out` (bez alokacji).
 */
export function cicBeltCellValues(m, out) {
  const w = m.weight > 0 ? m.weight : 0;
  if (w <= 0) { out.w = 0; out.f = 0; out.rim = 0; return out; }
  const g = m.gap > 1e-3 ? m.gap : 1e-3;
  const fade = w * 2 < 1 ? w * 2 : 1;
  const f = (m.cluster / g) * fade;
  const rim = (m.rim / g) * fade;
  out.w = w;
  out.f = f < 1 ? f : 1;
  out.rim = rim < 1 ? rim : 1;
  return out;
}

/** Kolor komórki (RGBA bajty, alfa nieprzemnożona) → data[o..o+3]. */
export function cicBeltColor(w, f, rim, pal, data, o) {
  if (w <= 0) { data[o] = 0; data[o + 1] = 0; data[o + 2] = 0; data[o + 3] = 0; return; }
  const P = CIC_BELT_PALETTES[pal] || CIC_BELT_PALETTES[PAL_GREY];
  const t = f * 1.4 < 1 ? f * 1.4 : 1;
  const a = 0.15 * Math.sqrt(w) + 0.1 * rim + 0.32 * f;
  data[o] = P.base[0] + (P.field[0] - P.base[0]) * t;
  data[o + 1] = P.base[1] + (P.field[1] - P.base[1]) * t;
  data[o + 2] = P.base[2] + (P.field[2] - P.base[2]) * t;
  data[o + 3] = (a < 0.62 ? a : 0.62) * 255;
}

// ---------------------------------------------------------------------------
// Kontury: marching squares na siatce próbek (współrzędne = indeksy próbek), odcinki łączone w łańcuchy
// (linie z łączeniami zamiast tysięcy osobnych odcinków — mniej pracy przy stroke i bez dziur na załamaniach).

// Odcinki przypadków (krawędzie komórki: 0 góra, 1 prawo, 2 dół, 3 lewo); siodła (5, 10) — z wartości środka.
const MS_SEGS = [
  null, [3, 0], [0, 1], [3, 1], [1, 2], null, [0, 2], [3, 2],
  [2, 3], [0, 2], null, [1, 2], [3, 1], [0, 1], [3, 0], null
];

function makeContourScratch(nx, ny) {
  const nEdges = nx * ny * 2;
  return {
    nx, ny,
    first: new Int32Array(nEdges).fill(-1),
    second: new Int32Array(nEdges).fill(-1),
    segA: new Int32Array(nx * ny * 2),
    segB: new Int32Array(nx * ny * 2),
    used: new Uint8Array(nx * ny * 2)
  };
}

/**
 * Kontury wartości `iso` w komórkach [ci0, ci1) × [cj0, cj1) siatki nx × ny (vals[j·nx + i]).
 * Zwraca tablicę łańcuchów (Float32Array x, y, … w indeksach próbek; łańcuch zamknięty powtarza pierwszy punkt).
 */
export function traceCicBeltContours(vals, nx, ny, iso, ci0, ci1, cj0, cj1, scratch = null) {
  const S = scratch && scratch.nx === nx && scratch.ny === ny ? scratch : makeContourScratch(nx, ny);
  const { first, second, segA, segB, used } = S;
  let nSeg = 0;
  const edgeOf = (i, j, side) => {
    if (side === 0) return (j * nx + i) * 2;
    if (side === 1) return (j * nx + i + 1) * 2 + 1;
    if (side === 2) return ((j + 1) * nx + i) * 2;
    return (j * nx + i) * 2 + 1;
  };
  const addSeg = (ea, eb) => {
    segA[nSeg] = ea; segB[nSeg] = eb; used[nSeg] = 0;
    if (first[ea] < 0) first[ea] = nSeg; else second[ea] = nSeg;
    if (first[eb] < 0) first[eb] = nSeg; else second[eb] = nSeg;
    nSeg++;
  };
  for (let j = cj0; j < cj1; j++) {
    const r0 = j * nx;
    const r1 = r0 + nx;
    for (let i = ci0; i < ci1; i++) {
      const a = vals[r0 + i], b = vals[r0 + i + 1], c = vals[r1 + i + 1], d = vals[r1 + i];
      const cs = (a >= iso ? 1 : 0) | (b >= iso ? 2 : 0) | (c >= iso ? 4 : 0) | (d >= iso ? 8 : 0);
      if (cs === 0 || cs === 15) continue;
      if (cs === 5 || cs === 10) {
        const centerIn = (a + b + c + d) * 0.25 >= iso;
        // 5 (a, c w środku): środek łączy a z c → odcięte b i d; 10 (b, d): środek łączy b z d → odcięte a i c.
        const isoA = cs === 5 ? centerIn : !centerIn;
        if (isoA) { addSeg(edgeOf(i, j, 0), edgeOf(i, j, 1)); addSeg(edgeOf(i, j, 2), edgeOf(i, j, 3)); }
        else { addSeg(edgeOf(i, j, 3), edgeOf(i, j, 0)); addSeg(edgeOf(i, j, 1), edgeOf(i, j, 2)); }
        continue;
      }
      const s = MS_SEGS[cs];
      addSeg(edgeOf(i, j, s[0]), edgeOf(i, j, s[1]));
    }
  }
  const px = (e) => {
    const k = e >> 1;
    const i = k % nx;
    const j = (k - i) / nx;
    const v0 = vals[k];
    if (e & 1) { const v1 = vals[k + nx]; const t = v1 !== v0 ? (iso - v0) / (v1 - v0) : 0.5; return [i, j + t]; }
    const v1 = vals[k + 1]; const t = v1 !== v0 ? (iso - v0) / (v1 - v0) : 0.5; return [i + t, j];
  };
  const nextSeg = (e, cur) => {
    const s1 = first[e], s2 = second[e];
    const n = s1 === cur ? s2 : s1;
    return n >= 0 && !used[n] ? n : -1;
  };
  const chains = [];
  for (let s0 = 0; s0 < nSeg; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const fwd = [segB[s0]];
    let e = segB[s0];
    let cur = s0;
    for (;;) {
      const n = nextSeg(e, cur);
      if (n < 0) break;
      used[n] = 1;
      e = segA[n] === e ? segB[n] : segA[n];
      fwd.push(e);
      cur = n;
    }
    const back = [];
    e = segA[s0];
    cur = s0;
    for (;;) {
      const n = nextSeg(e, cur);
      if (n < 0) break;
      used[n] = 1;
      e = segA[n] === e ? segB[n] : segA[n];
      back.push(e);
      cur = n;
    }
    const len = back.length + 1 + fwd.length;
    const pts = new Float32Array(len * 2);
    let o = 0;
    for (let q = back.length - 1; q >= 0; q--) { const p = px(back[q]); pts[o++] = p[0]; pts[o++] = p[1]; }
    { const p = px(segA[s0]); pts[o++] = p[0]; pts[o++] = p[1]; }
    for (let q = 0; q < fwd.length; q++) { const p = px(fwd[q]); pts[o++] = p[0]; pts[o++] = p[1]; }
    chains.push(pts);
  }
  // sprzątanie tablicy krawędzi (tylko dotknięte wpisy)
  for (let s = 0; s < nSeg; s++) {
    first[segA[s]] = -1; second[segA[s]] = -1;
    first[segB[s]] = -1; second[segB[s]] = -1;
  }
  return chains;
}

// ---------------------------------------------------------------------------
// Łuk wokół Słońca na ekranie: pełny okrąg, gdy mały; dla promieni ≫ ekran tylko widoczny wycinek jako łamana
// (arc o promieniu setek tysięcy px Skia dzieli na krzywe — kosztowne i niedokładne).
// Zwraca false, gdy okrąg nie przecina prostokąta kadru (z zapasem pad).
export function cicSunArcPath(ctx, sx, sy, r, W, H, pad = 4) {
  if (!(r > 0)) return false;
  const nx = sx < 0 ? 0 : sx > W ? W : sx;
  const ny = sy < 0 ? 0 : sy > H ? H : sy;
  const dMin = Math.hypot(sx - nx, sy - ny);
  const fx = sx < W * 0.5 ? W : 0;
  const fy = sy < H * 0.5 ? H : 0;
  const dMax = Math.hypot(sx - fx, sy - fy);
  if (r < dMin - pad || r > dMax + pad) return false;
  if (r < 3000) {
    ctx.moveTo(sx + r, sy);
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    return true;
  }
  const cx = W * 0.5, cy = H * 0.5;
  const ac = Math.atan2(cy - sy, cx - sx);
  const half = Math.hypot(W, H) * 0.5 + pad;
  const span = Math.min(Math.PI, Math.asin(Math.min(1, half / r)) * 1.15 + 0.002);
  const n = Math.max(6, Math.min(256, Math.ceil(span * 2 * r / 24)));
  for (let i = 0; i <= n; i++) {
    const a = ac - span + (2 * span * i) / n;
    const x = sx + Math.cos(a) * r;
    const y = sy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  return true;
}

/**
 * Pas [r0, r1] wokół Słońca jako wypełniany wielokąt (łuk zewnętrzny, potem wewnętrzny wstecz) — tylko widoczny
 * wycinek. false, gdy pas nie przecina kadru.
 */
export function cicSunBandPath(ctx, sx, sy, r0, r1, W, H) {
  if (!(r1 > r0 && r0 >= 0)) return false;
  const nx = sx < 0 ? 0 : sx > W ? W : sx;
  const ny = sy < 0 ? 0 : sy > H ? H : sy;
  const dMin = Math.hypot(sx - nx, sy - ny);
  const fx = sx < W * 0.5 ? W : 0;
  const fy = sy < H * 0.5 ? H : 0;
  const dMax = Math.hypot(sx - fx, sy - fy);
  if (r1 < dMin - 2 || r0 > dMax + 2) return false;
  let a0 = 0;
  let span = Math.PI;
  if (r0 >= 3000) {
    const ac = Math.atan2(H * 0.5 - sy, W * 0.5 - sx);
    span = Math.min(Math.PI, Math.asin(Math.min(1, (Math.hypot(W, H) * 0.5 + 4) / r0)) * 1.15 + 0.002);
    a0 = ac - span;
  }
  const n = Math.max(12, Math.min(256, Math.ceil(span * 2 * r1 / 24)));
  for (let i = 0; i <= n; i++) {
    const a = a0 + (2 * span * i) / n;
    const x = sx + Math.cos(a) * r1;
    const y = sy + Math.sin(a) * r1;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  for (let i = n; i >= 0; i--) {
    const a = a0 + (2 * span * i) / n;
    ctx.lineTo(sx + Math.cos(a) * r0, sy + Math.sin(a) * r0);
  }
  ctx.closePath();
  return true;
}

/**
 * Punkt podpisu na okręgu wokół Słońca: przy Słońcu w kadrze — stały kąt `pref`, inaczej punkt okręgu najbliższy
 * środka kadru (przesunięty wzdłuż łuku o offsetPx). null, gdy punkt poza kadrem (margines m).
 */
export function cicSunArcAnchor(sx, sy, r, W, H, pref, m = 40, offsetPx = 0) {
  const inView = sx > -m && sx < W + m && sy > -m && sy < H + m;
  // poza Słońcem w kadrze: punkt najbliższy środka kadru przesunięty wzdłuż łuku o offsetPx (środek = statek)
  const a = inView ? pref : Math.atan2(H * 0.5 - sy, W * 0.5 - sx) + (r > 1 ? offsetPx / r : 0);
  const x = sx + Math.cos(a) * r;
  const y = sy + Math.sin(a) * r;
  if (x < m || x > W - m || y < m || y > H - m) return null;
  return { x, y, a };
}

function drawTangentLabel(ctx, text, x, y, angle, color, size, bold = false) {
  let rot = angle + Math.PI / 2;
  rot = Math.atan2(Math.sin(rot), Math.cos(rot));
  if (rot > Math.PI / 2) rot -= Math.PI;
  else if (rot < -Math.PI / 2) rot += Math.PI;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.font = `${bold ? 'bold ' : ''}${size}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(3, 10, 20, 0.85)';
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

// Kąty podpisów regionów-pierścieni przy Słońcu w kadrze (rozrzucone — bez stosu napisów w jednej linii).
const RING_LABEL_ANGLE = Object.freeze({
  main: -Math.PI * 0.62, hungarias: -Math.PI * 0.8, nea: Math.PI * 0.72, kuiper: -Math.PI * 0.42
});

// ---------------------------------------------------------------------------

const _cell = { w: 0, f: 0, rim: 0 };
// Zapas kanwy pamięci kadru z każdej strony [px] — przesunięcie widoku do tylu px bez przerysowania.
const CACHE_MARGIN = 160;
// Tyle klatek bez unieważnienia, zanim pamięć kadru zostanie przerysowana (wcześniej — rysunek wprost).
const CACHE_SETTLE = 6;
// Pustych kafli (bez obrazu) w pamięci — wpis to kilkadziesiąt bajtów.
const EMPTY_KEEP = 2048;

function tileKey(k, tx, ty) {
  return k * 1099511627776 + (ty + 524288) * 1048576 + (tx + 524288);
}

export class CicBeltLayer {
  /**
   * @param {object} [o]
   * @param {() => object|null} [o.getField] pole pasa (AsteroidBeltField)
   * @param {object} [o.tune] nadpisania CIC_BELT_TUNE
   * @param {boolean} [o.keepLines] trzymaj łańcuchy konturów (testy — w Node bez Path2D)
   */
  constructor(o = {}) {
    this.getField = o.getField || (() => null);
    this.tune = o.tune || CIC_BELT_TUNE;
    this.keepLines = !!o.keepLines;
    this.field = null;
    this.tiles = new Map();
    this.k = -1;
    this.job = null;
    this.frame = 0;
    this._regionPal = new Map();
    this._W = new Float32Array(CIC_BELT_TEX * CIC_BELT_TEX);
    this._F = new Float32Array(CIC_BELT_TEX * CIC_BELT_TEX);
    this._R = new Float32Array(CIC_BELT_TEX * CIC_BELT_TEX);
    this._P = new Uint8Array(CIC_BELT_TEX * CIC_BELT_TEX);
    this._contour = makeContourScratch(CIC_BELT_TEX, CIC_BELT_TEX);
    this._canvas = null;
    this._cctx = null;
    this._img = null;
    this._need = [];
    this._draws = [];
    this._placed = [];
    this._visible = new Set();
    this._prevZoom = -1;
    this._evictAt = 0;
    this._cache = { canvas: null, ctx: null, cw: 0, ch: 0, renderFrame: -1e9, zoom: -1, version: -1, tkey: -1, field: null, W: 0, H: 0, viewX: 0, viewY: 0 };
    this._renderView = { W: 0, H: 0, cx: 0, cy: 0, viewX: 0, viewY: 0, zoom: 1, blend: 0 };
    this.stats = { tiles: 0, ready: 0, empty: 0, baked: 0, bakeMs: 0, lastBakeMs: 0, drawn: 0, fallback: 0, level: -1, samples: 0, cacheRenders: 0, direct: 0, maxRenderMs: 0, maxBlitMs: 0, maxBakeMs: 0 };
  }

  _attach(field) {
    this.field = field;
    for (const t of this.tiles.values()) t.bitmap?.close?.();
    this.tiles.clear();
    this.job = null;
    this._regionPal.clear();
    for (const reg of field?.regions || []) this._regionPal.set(reg, cicBeltPaletteIndex(reg.beltId));
  }

  _tile(k, tx, ty) {
    const key = tileKey(k, tx, ty);
    let t = this.tiles.get(key);
    if (!t) {
      const cell = CIC_BELT_CELL0 * 2 ** k;
      const size = cell * CIC_BELT_N;
      t = {
        key, k, tx, ty, cell, size, x0: tx * size, y0: ty * size,
        state: 0, // 0 — czeka, 2 — gotowy, 3 — pusty
        bitmap: null, canvas: null, belt: null, fieldLines: null, beltPath: null, fieldPath: null,
        used: this.frame, pinned: k === CIC_BELT_KMAX
      };
      this.tiles.set(key, t);
    }
    return t;
  }

  /** Najbliższy gotowy przodek kafla (grubszy poziom) albo null. */
  _readyAncestor(t) {
    for (let k = t.k + 1; k <= CIC_BELT_KMAX; k++) {
      const size = CIC_BELT_CELL0 * 2 ** k * CIC_BELT_N;
      const a = this.tiles.get(tileKey(k, Math.floor((t.x0 + t.size * 0.5) / size), Math.floor((t.y0 + t.size * 0.5) / size)));
      if (a && a.state >= 2) return a;
    }
    return null;
  }

  _rootOf(t) {
    const size = CIC_BELT_CELL0 * 2 ** CIC_BELT_KMAX * CIC_BELT_N;
    return this._tile(CIC_BELT_KMAX, Math.floor((t.x0 + t.size * 0.5) / size), Math.floor((t.y0 + t.size * 0.5) / size));
  }

  _startJob(t) {
    const f = this.field;
    const pad = t.cell * 2;
    if (!f.rectTouchesBelt(t.x0 - pad, t.y0 - pad, t.x0 + t.size + pad, t.y0 + t.size + pad)) {
      t.state = 3;
      this.stats.empty++;
      return null;
    }
    return { t, row: 0, ms: 0 };
  }

  /** Krok wypieku: wiersze do terminu `deadline` (performance.now()); true — kafel gotowy. */
  _bakeStep(job, deadline) {
    const f = this.field;
    const t = job.t;
    const c = t.cell;
    const TEX = CIC_BELT_TEX;
    const Wv = this._W, Fv = this._F, Rv = this._R, Pv = this._P;
    const t0 = performance.now();
    while (job.row < TEX) {
      const j = job.row;
      const y = t.y0 + (j - PAD + 0.5) * c;
      const r0 = j * TEX;
      for (let i = 0; i < TEX; i++) {
        const m = f.sampleMacro(t.x0 + (i - PAD + 0.5) * c, y);
        cicBeltCellValues(m, _cell);
        const o = r0 + i;
        Wv[o] = _cell.w; Fv[o] = _cell.f; Rv[o] = _cell.rim;
        Pv[o] = _cell.w > 0 ? (this._regionPal.get(m.region) ?? PAL_GREY) : 0;
      }
      job.row++;
      this.stats.samples += TEX;
      if (performance.now() > deadline) break;
    }
    job.ms += performance.now() - t0;
    if (job.row < TEX) return false;
    // domknięcie (barwy, ImageBitmap, kontury ~0,2–0,4 ms) — tylko z zapasem budżetu, inaczej w następnej klatce
    if (performance.now() + 0.6 > deadline) return false;
    const t1 = performance.now();
    this._finishTile(t);
    job.ms += performance.now() - t1;
    this.stats.baked++;
    this.stats.lastBakeMs = job.ms;
    return true;
  }

  _finishTile(t) {
    const TEX = CIC_BELT_TEX;
    const n = TEX * TEX;
    const Wv = this._W, Fv = this._F, Rv = this._R, Pv = this._P;
    let any = false;
    for (let i = 0; i < n; i++) if (Wv[i] > 0) { any = true; break; }
    if (!any) { t.state = 3; this.stats.empty++; return; }
    // obraz
    if (!this._img) this._initCanvas();
    if (this._img) {
      const data = this._img.data;
      for (let i = 0; i < n; i++) cicBeltColor(Wv[i], Fv[i], Rv[i], Pv[i], data, i * 4);
      this._cctx.putImageData(this._img, 0, 0);
      if (typeof this._canvas.transferToImageBitmap === 'function') {
        t.bitmap = this._canvas.transferToImageBitmap();
      } else {
        // zwykła kanwa (bez OffscreenCanvas): osobna kanwa na kafel
        const cv = this._canvas;
        t.canvas = cv;
        this._canvas = null; this._cctx = null; this._img = null;
      }
    }
    // kontury: komórki [0, N) × [0, N) — prawą / dolną komórkę zapasu bierze sąsiad (bez dubli na szwie);
    // barwa łańcucha z regionu przy nim (kafel grubego poziomu obejmuje kilka regionów)
    if (this.tune.contours) {
      const N = CIC_BELT_N;
      t.belt = groupChainsByPalette(traceCicBeltContours(Wv, TEX, TEX, this.tune.beltIso, 0, N, 0, N, this._contour), Wv, Pv);
      t.fieldLines = groupChainsByPalette(traceCicBeltContours(Fv, TEX, TEX, this.tune.fieldIso, 0, N, 0, N, this._contour), Wv, Pv);
    }
    t.state = 2;
  }

  _initCanvas() {
    const TEX = CIC_BELT_TEX;
    let cv = null;
    if (typeof OffscreenCanvas !== 'undefined') cv = new OffscreenCanvas(TEX, TEX);
    else if (typeof document !== 'undefined' && document.createElement) {
      cv = document.createElement('canvas');
      cv.width = TEX; cv.height = TEX;
    }
    const cctx = cv?.getContext?.('2d');
    if (!cctx) return;
    this._canvas = cv;
    this._cctx = cctx;
    this._img = cctx.createImageData(TEX, TEX);
  }

  /**
   * Pamięć kafli: limit `maxTiles` liczy tylko kafle z obrazem (LRU); kafle czekające bez obrazu spoza kadru
   * wypadają od razu (w ruchu zoomu powstają dziesiątkami i wypychały upieczone), puste — do EMPTY_KEEP
   * (pamięć „tu nic nie ma” bez ponownego sprawdzania regionów). Pełny przegląd tylko przy przyroście wpisów.
   */
  _evict() {
    const size = this.tiles.size;
    if (size <= this._evictAt && (this.frame & 31) !== 0) return;
    const max = Math.max(8, this.tune.maxTiles | 0);
    const vis = this._visible;
    const jobTile = this.job?.t || null;
    let ready = 0;
    let empty = 0;
    for (const t of this.tiles.values()) {
      if (t.pinned || t === jobTile) continue;
      if (t.state === 0) { if (!vis.has(t.key)) this.tiles.delete(t.key); continue; }
      if (t.state === 2) ready++;
      else empty++;
    }
    if (ready > max || empty > EMPTY_KEEP) {
      const list = [];
      for (const t of this.tiles.values()) if (!t.pinned && t !== jobTile && !vis.has(t.key) && t.state !== 0) list.push(t);
      list.sort((a, b) => a.used - b.used);
      for (let i = 0; i < list.length && (ready > max || empty > EMPTY_KEEP); i++) {
        const t = list[i];
        if (t.state === 2) { if (ready <= max) continue; ready--; } else { if (empty <= EMPTY_KEEP) continue; empty--; }
        t.bitmap?.close?.();
        t.bitmap = null;
        t.state = 0;
        this.tiles.delete(t.key);
      }
    }
    this._evictAt = this.tiles.size + 16;
  }

  /**
   * Wypiek w budżecie: kafle w kadrze, korzenie (cały układ) pierwsze — zawsze jest czym zastąpić kafel w wypieku.
   * @param {number} budgetMs
   */
  bake(budgetMs = this.tune.bakeMs) {
    if (!this.field || !(budgetMs > 0)) return;
    const deadline = performance.now() + budgetMs;
    let guard = 0;
    while (performance.now() < deadline && guard++ < 64) {
      if (!this.job) {
        const t = this._need.length ? this._need.shift() : null;
        if (!t) break;
        if (t.state !== 0) continue;
        this.job = this._startJob(t);
        if (!this.job) continue;
      }
      const t0 = performance.now();
      const done = this._bakeStep(this.job, deadline);
      const db = performance.now() - t0;
      this.stats.bakeMs += db;
      if (db > this.stats.maxBakeMs) this.stats.maxBakeMs = db;
      if (done) this.job = null;
      else break;
    }
  }

  /**
   * Rysunek warstwy (obraz i kontury kafli, luki Kirkwooda) + wypiek w budżecie. Podpisy — drawLabels.
   * v: { W, H, cx, cy, viewX, viewY, zoom, blend }; ekran = (cx + (x − viewX) · zoom, cy + (y − viewY) · zoom).
   *
   * PAMIĘĆ KADRU: kafle, kontury i luki są nieruchome względem świata, więc idą do kanwy pomocniczej (kadr
   * + CACHE_MARGIN px z każdej strony) przerysowywanej tylko przy zmianie zoomu, rozmiaru, nowym kaflu albo
   * przesunięciu widoku poza zapas; w spoczynku i przy locie statku (widok jedzie za nim) — jeden drawImage
   * z przesunięciem o całe piksele. A/B 2026-10-18 (pas, zoom 0,0004): warstwa rysowana wprost +1,3 ms klatki.
   */
  draw(ctx, v) {
    const tune = this.tune;
    if (!tune.on) return;
    const field = this.getField();
    if (!field || typeof field.sampleMacro !== 'function') return;
    if (field !== this.field) this._attach(field);
    this.frame++;
    const { W, H, viewX, viewY, zoom } = v;
    if (!(zoom > 0)) return;
    const cache = this._cache;
    const useCache = tune.cache !== false && this._ensureCache(W, H);
    const m = useCache ? CACHE_MARGIN : 0;
    // widok renderu: kadr + zapas (tu też kafle do wypieku — przesuwanie trafia w gotowe)
    const rv = this._renderView;
    rv.W = W + 2 * m; rv.H = H + 2 * m; rv.cx = v.cx + m; rv.cy = v.cy + m;
    rv.viewX = viewX; rv.viewY = viewY; rv.zoom = zoom; rv.blend = v.blend;
    const draws = this._collectTiles(rv);
    // Zoom w ruchu: kafle poziomów mijanych po drodze są potrzebne przez ułamek sekundy — bez wypieku (kadr
    // rysują gotowi przodkowie, korzeń zawsze); wypiek rusza, gdy zoom stanie. Przesuwanie przy stałym zoomie piecze.
    const zoomMoving = this._prevZoom > 0 && Math.abs(zoom / this._prevZoom - 1) > 1e-6;
    this.bake(zoomMoving ? (this._need[0]?.pinned && this._need[0].state === 0 ? tune.bakeMs : 0) : tune.bakeMs);
    this._evict();
    const version = this.stats.baked + this.stats.empty * 65536;
    const tkey = (tune.fill ? 1 : 0) | (tune.contours ? 2 : 0) | (tune.lanes ? 4 : 0) | (tune.labels ? 8 : 0);
    if (!useCache) {
      this._render(ctx, rv, draws, field);
    } else {
      let dx = 0, dy = 0;
      let valid = cache.zoom === zoom && cache.version === version && cache.tkey === tkey && cache.field === field
        && cache.W === W && cache.H === H;
      if (valid) {
        dx = Math.round((cache.viewX - viewX) * zoom);
        dy = Math.round((cache.viewY - viewY) * zoom);
        if (Math.abs(dx) > m - 2 || Math.abs(dy) > m - 2) valid = false;
      }
      // W ruchu (zoom zmienia się z klatki na klatkę, kafle dopiekają się, widok co chwilę poza zapasem) — rysunek
      // wprost: przerysowanie kanwy pomocniczej co klatkę to wysyłka obrazu wielkości ekranu (w A/B zdarzała się
      // klatka 93 ms na drawImage kanwy). Pamięć kadru odświeża się, gdy widok stoi ≥ CACHE_SETTLE klatek.
      const moving = zoom !== this._prevZoom || this.frame - cache.renderFrame < CACHE_SETTLE;
      this._prevZoom = zoom;
      if (!valid && moving) {
        this._render(ctx, v.cx === rv.cx ? rv : this._directView(v), draws, field);
        this.stats.direct++;
      } else if (!valid) {
        const g = cache.ctx;
        const tr = performance.now();
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, cache.cw, cache.ch);
        this._render(g, rv, draws, field);
        const dr = performance.now() - tr;
        if (dr > this.stats.maxRenderMs) this.stats.maxRenderMs = dr;
        cache.zoom = zoom; cache.version = version; cache.tkey = tkey; cache.field = field;
        cache.W = W; cache.H = H; cache.viewX = viewX; cache.viewY = viewY;
        cache.renderFrame = this.frame;
        dx = 0; dy = 0;
        this.stats.cacheRenders++;
        valid = true;
      }
      if (valid) {
        const ti = performance.now();
        ctx.drawImage(cache.canvas, dx - m, dy - m);
        const di = performance.now() - ti;
        if (di > this.stats.maxBlitMs) this.stats.maxBlitMs = di;
      }
    }
    this.stats.tiles = this.tiles.size;
    let ready = 0;
    for (const t of this.tiles.values()) if (t.state === 2) ready++;
    this.stats.ready = ready;
  }

  /** Widok rysunku wprost na ekran (bez zapasu kanwy pomocniczej) — kafle z rv obejmują go z naddatkiem. */
  _directView(v) {
    const d = this._dv || (this._dv = { W: 0, H: 0, cx: 0, cy: 0, viewX: 0, viewY: 0, zoom: 1, blend: 0 });
    d.W = v.W; d.H = v.H; d.cx = v.cx; d.cy = v.cy; d.viewX = v.viewX; d.viewY = v.viewY; d.zoom = v.zoom; d.blend = v.blend;
    return d;
  }

  /** Zwolnienie kanwy pamięci kadru (CIC zamknięte); kafle zostają. */
  releaseCache() {
    const c = this._cache;
    c.canvas = null; c.ctx = null; c.zoom = -1; c.cw = 0; c.ch = 0;
  }

  _ensureCache(W, H) {
    const c = this._cache;
    const cw = Math.ceil(W) + 2 * CACHE_MARGIN;
    const ch = Math.ceil(H) + 2 * CACHE_MARGIN;
    if (c.canvas && c.cw === cw && c.ch === ch) return true;
    let cv = null;
    if (typeof OffscreenCanvas !== 'undefined') cv = new OffscreenCanvas(cw, ch);
    else if (typeof document !== 'undefined' && document.createElement) {
      cv = document.createElement('canvas');
      cv.width = cw; cv.height = ch;
    }
    const g = cv?.getContext?.('2d');
    if (!g) { c.canvas = null; c.ctx = null; return false; }
    c.canvas = cv; c.ctx = g; c.cw = cw; c.ch = ch; c.zoom = -1;
    return true;
  }

  /** Kafle w widoku rv: lista do rysunku (gotowe albo przodek w zastępstwie), kolejka wypieku. */
  _collectTiles(rv) {
    const { W, H, cx, cy, viewX, viewY, zoom } = rv;
    const k = this.k = cicBeltLevelFor(zoom, this.k, this.tune.cellPx);
    this.stats.level = k;
    const size = CIC_BELT_CELL0 * 2 ** k * CIC_BELT_N;
    const wx0 = viewX - cx / zoom, wx1 = viewX + (W - cx) / zoom;
    const wy0 = viewY - cy / zoom, wy1 = viewY + (H - cy) / zoom;
    const tx0 = Math.floor(wx0 / size), tx1 = Math.floor(wx1 / size);
    const ty0 = Math.floor(wy0 / size), ty1 = Math.floor(wy1 / size);
    const vis = this._visible;
    vis.clear();
    const need = this._need;
    need.length = 0;
    const draws = this._draws;
    draws.length = 0;
    if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) <= 64) {
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const t = this._tile(k, tx, ty);
          t.used = this.frame;
          vis.add(t.key);
          if (t.state === 3) continue;
          if (t.state === 2) { draws.push(t); continue; }
          const root = this._rootOf(t);
          root.used = this.frame;
          vis.add(root.key);
          if (root.state === 0 && !need.includes(root)) need.unshift(root);
          need.push(t);
          const anc = this._readyAncestor(t);
          if (anc && anc.state === 2) {
            // przodek w zastępstwie jest w użyciu — LRU go nie zwolni (zamknięta bitmapa = wyjątek drawImage)
            anc.used = this.frame;
            vis.add(anc.key);
            draws.push({ fallback: anc, t });
          }
        }
      }
    }
    // kolejność wypieku: korzenie, potem od środka kadru
    if (need.length > 1) {
      const mx = (wx0 + wx1) * 0.5, my = (wy0 + wy1) * 0.5;
      need.sort((a, b) => (b.pinned - a.pinned)
        || (Math.hypot(a.x0 + a.size * 0.5 - mx, a.y0 + a.size * 0.5 - my) - Math.hypot(b.x0 + b.size * 0.5 - mx, b.y0 + b.size * 0.5 - my)));
    }
    if (this.job && !vis.has(this.job.t.key)) this.job = null; // kafel wyszedł z kadru (zoom, przesunięcie)
    if (this.job) need.unshift(this.job.t);
    return draws;
  }

  /** Obraz kafli, kontury, luki — do kontekstu g w widoku rv. */
  _render(g, rv, draws, field) {
    const tune = this.tune;
    const { cx, cy, viewX, viewY, zoom } = rv;
    g.save();
    try {
      this._renderTiles(g, rv, draws, field, tune);
    } finally {
      g.restore();
    }
    this._drawLanes(g, rv, field);
  }

  _renderTiles(g, rv, draws, field, tune) {
    const { cx, cy, viewX, viewY, zoom } = rv;
    g.imageSmoothingEnabled = true;
    // z bliska (cały kadr w pasie) wypełnienie słabiej — tło dla kontaktów, nie zasłona; 1 do zoomu 0,002
    g.globalAlpha = zoom <= 0.002 ? 1 : Math.max(0.5, 1 - 0.5 * Math.log10(zoom / 0.002));
    let drawn = 0, fb = 0;
    for (const d of draws) {
      if (!tune.fill) break;
      if (d.fallback) {
        const a = d.fallback;
        const src = a.bitmap || a.canvas;
        if (!src || !src.width) continue; // ImageBitmap po close() ma wymiary 0
        const t = d.t;
        const sx0 = PAD + (t.x0 - a.x0) / a.cell;
        const sy0 = PAD + (t.y0 - a.y0) / a.cell;
        const sw = t.size / a.cell;
        g.drawImage(src, sx0, sy0, sw, sw,
          cx + (t.x0 - viewX) * zoom, cy + (t.y0 - viewY) * zoom, t.size * zoom, t.size * zoom);
        fb++;
        continue;
      }
      const src = d.bitmap || d.canvas;
      if (!src || !src.width) continue;
      g.drawImage(src, PAD, PAD, CIC_BELT_N, CIC_BELT_N,
        cx + (d.x0 - viewX) * zoom, cy + (d.y0 - viewY) * zoom, d.size * zoom, d.size * zoom);
      drawn++;
    }
    this.stats.drawn = drawn;
    this.stats.fallback = fb;
    // --- kontury (Path2D w indeksach próbek, transformacja kafla) ---
    if (tune.contours && typeof Path2D !== 'undefined') {
      // Szerokość na ekranie DOKŁADNIE 1 px: Skia rysuje wtedy kontur jako hairline (GPU); grubsza linia pod
      // transformacją kafla szła przez maskę rastrową ścieżki — w A/B 2,4–3,5 ms klatki na kilka tys. wierzchołków.
      const fieldScalePx = (field.config?.clusterScale || 240000) * zoom;
      for (const d of draws) {
        if (d.fallback) continue;
        if (!d.beltPath && (d.belt || d.fieldLines)) {
          d.beltPath = groupsToPaths(d.belt);
          d.fieldPath = groupsToPaths(d.fieldLines);
          if (!this.keepLines) { d.belt = null; d.fieldLines = null; }
        }
        if (!d.beltPath) continue;
        const sc = d.cell * zoom;
        g.setTransform(sc, 0, 0, sc, cx + (d.x0 - viewX) * zoom - (PAD - 0.5) * sc, cy + (d.y0 - viewY) * zoom - (PAD - 0.5) * sc);
        g.globalAlpha = 1;
        g.lineWidth = 1 / sc;
        for (let pi = 0; pi < d.beltPath.length; pi++) {
          const path = d.beltPath[pi];
          if (!path) continue;
          g.strokeStyle = CONTOUR_BELT[pi];
          g.stroke(path);
        }
        // pola (szum ~240 tys. j.) dopiero, gdy są na ekranie plamami, nie ziarnem (widok układu: ~14 px)
        if (fieldScalePx < 60) continue;
        for (let pi = 0; pi < d.fieldPath.length; pi++) {
          const path = d.fieldPath[pi];
          if (!path) continue;
          g.strokeStyle = CONTOUR_FIELD[pi];
          g.stroke(path);
        }
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
  }

  /**
   * Luki Kirkwooda (wektorowo, prawdziwa szerokość), podpisy luk przy średnim zoomie. Pas luki = WYPEŁNIONY
   * wielokąt (łuk zewnętrzny tam, wewnętrzny z powrotem), brzegi — linie 1 px bez przerywania: gruby obrys
   * i przerywane brzegi kosztowały w A/B ~1,2 ms klatki (maska rastrowa ścieżki, kreski liczone na CPU).
   */
  _drawLanes(ctx, v, field) {
    if (!this.tune.lanes) return;
    const gaps = field.config?.kirkwoodGaps;
    if (!Array.isArray(gaps) || !gaps.length) return;
    const { W, H, cx, cy, viewX, viewY, zoom } = v;
    const au = field.auToWorld;
    const sx = cx + (field.sunX - viewX) * zoom;
    const sy = cy + (field.sunY - viewY) * zoom;
    ctx.save();
    for (const g of gaps) {
      const r = g.au * au * zoom;
      const wpx = g.width * au * zoom;
      if (wpx < 0.6) continue;
      const r0 = r - wpx * 0.5;
      const r1 = r + wpx * 0.5;
      if (wpx < 2.5) {
        // cienka luka: jedna linia ~1 px, przezroczystość z szerokości
        ctx.beginPath();
        if (!cicSunArcPath(ctx, sx, sy, r, W, H, 2)) continue;
        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(4, 12, 24, ${Math.min(0.75, 0.3 * wpx).toFixed(3)})`;
        ctx.stroke();
      } else {
        ctx.beginPath();
        if (!cicSunBandPath(ctx, sx, sy, r0, r1, W, H)) continue;
        ctx.fillStyle = 'rgba(4, 12, 24, 0.6)';
        ctx.fill();
        if (wpx > 5) {
          ctx.lineWidth = 1;
          ctx.strokeStyle = 'rgba(232, 196, 128, 0.26)';
          ctx.beginPath();
          cicSunArcPath(ctx, sx, sy, r0, W, H, 2);
          cicSunArcPath(ctx, sx, sy, r1, W, H, 2);
          ctx.stroke();
        }
      }
      // podpis luki: gdy sąsiednie luki są na ekranie dość daleko od siebie (≥ 0,6 AU ≈ 26 tys. j.)
      if (this.tune.labels && 0.6 * au * zoom > 30) {
        const p = cicSunArcAnchor(sx, sy, r, W, H, -Math.PI * 0.55, 60, -170);
        if (p) drawTangentLabel(ctx, `LUKA ${g.id}`, p.x, p.y, p.a, 'rgba(232, 196, 128, 0.78)', 9);
      }
    }
    ctx.restore();
  }

  /**
   * Podpisy regionów, rodzin (szczyty pól) i olbrzymy — po planetach (napisy nad orbitami).
   * @param {Array} [giants] window.__beltWorld.giants.entries
   */
  drawLabels(ctx, v, giants = null) {
    const tune = this.tune;
    if (!tune.on || !this.field) return;
    const field = this.field;
    const { W, H, cx, cy, viewX, viewY, zoom, blend } = v;
    const sx = cx + (field.sunX - viewX) * zoom;
    const sy = cy + (field.sunY - viewY) * zoom;
    ctx.save();
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    if (tune.labels) {
      // podpisy regionów: pas na ekranie ≥ 10 px (pierścienie) / 12 px (roje), bez nakładania (w widoku układu
      // Hildy, Trojańczycy i pas główny leżą o kilkanaście px od siebie)
      const placed = this._placed;
      placed.length = 0;
      const free = (x, y) => {
        for (let i = 0; i < placed.length; i += 2) if (Math.abs(placed[i] - x) < 110 && Math.abs(placed[i + 1] - y) < 26) return false;
        placed.push(x, y);
        return true;
      };
      for (const reg of field.regions) {
        if (reg.overlay) continue;
        const name = CIC_BELT_NAMES[reg.beltId];
        if (!name) continue;
        const P = CIC_BELT_PALETTES[cicBeltPaletteIndex(reg.beltId)];
        if (reg.kind === 'ring') {
          const band = (reg.rOuter - reg.rInner) * zoom;
          if (band < 10 || band > Math.max(W, H) * 0.8) continue;
          const r = (reg.rInner + reg.rOuter) * 0.5 * zoom;
          const p = cicSunArcAnchor(sx, sy, r, W, H, RING_LABEL_ANGLE[reg.beltId] ?? -Math.PI * 0.5, 50, 210);
          if (!p || !free(p.x, p.y)) continue;
          drawTangentLabel(ctx, name, p.x, p.y, p.a, `rgba(${P.line}, ${reg.beltId === 'nea' ? 0.6 : 0.9})`, Math.round(9 + blend * 2), reg.beltId === 'main' || reg.beltId === 'kuiper');
        } else {
          const band = reg.rHalf * 2 * zoom;
          if (band < 12 || band > Math.max(W, H) * 0.8) continue;
          const a = reg.angMid + ((reg.angLo ?? -reg.angHalf) + (reg.angHi ?? reg.angHalf)) * 0.5;
          const x = sx + Math.cos(a) * reg.rMid * zoom;
          const y = sy + Math.sin(a) * reg.rMid * zoom;
          if (x < 40 || x > W - 40 || y < 30 || y > H - 30 || !free(x, y)) continue;
          drawTangentLabel(ctx, name, x, y, a, `rgba(${P.line}, 0.9)`, Math.round(9 + blend * 2), false);
        }
      }
    }
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    // Rodziny kolizyjne na szczytach gęstych pól (pola widać jako plamy: 240 tys. j. ≈ 50–1000 px)
    const peaks = tune.families ? field._famPeaks : null;
    const famScale = (field.config?.clusterScale || 240000) * zoom;
    if (Array.isArray(peaks) && famScale > 50 && famScale < 1400) {
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let placed = 0;
      const boxes = [];
      for (const p of peaks) {
        if (!(p.fam >= 0)) continue;
        const fam = field.families?.[p.fam];
        if (!fam) continue;
        const x = cx + (p.x - viewX) * zoom;
        const y = cy + (p.y - viewY) * zoom;
        if (x < 40 || x > W - 40 || y < 30 || y > H - 30) continue;
        // szczyty z zapasu skanu (pole tuż za krawędzią pasa) — bez podpisu nad pustką
        if (!(field.sampleMacro(p.x, p.y).weight > 0.3)) continue;
        let clash = false;
        for (let i = 0; i < boxes.length && !clash; i++) clash = Math.abs(boxes[i].x - x) < 90 && Math.abs(boxes[i].y - y) < 16;
        if (clash) continue;
        boxes.push({ x, y });
        const text = String(fam.label).toUpperCase();
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(3, 10, 20, 0.8)';
        ctx.strokeText(text, x, y);
        ctx.fillStyle = 'rgba(255, 222, 160, 0.82)';
        ctx.fillText(text, x, y);
        if (++placed >= 24) break;
      }
    }
    // Olbrzymy pasa (przeszkody — kolizje): trójkąt ostrzegawczy, obrys z daleka, nazwa
    if (tune.giants && Array.isArray(giants) && zoom > 0.00018) {
      for (const g of giants) {
        if (!g || !Number.isFinite(g.x)) continue;
        const x = cx + (g.x - viewX) * zoom;
        const y = cy + (g.y - viewY) * zoom;
        const rx = (g.halfX || 0) * zoom, ry = (g.halfY || 0) * zoom;
        const rr = Math.max(rx, ry);
        if (x < -rr - 60 || x > W + rr + 60 || y < -rr - 60 || y > H + rr + 60) continue;
        ctx.strokeStyle = 'rgba(255, 170, 90, 0.85)';
        ctx.fillStyle = 'rgba(255, 150, 70, 0.14)';
        ctx.lineWidth = 1.4;
        if (rr > 7) {
          ctx.beginPath();
          ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.setLineDash([5, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        const s = 6;
        const ty = rr > 7 ? y - ry - 10 : y;
        ctx.beginPath();
        ctx.moveTo(x, ty - s); ctx.lineTo(x + s * 0.95, ty + s * 0.7); ctx.lineTo(x - s * 0.95, ty + s * 0.7); ctx.closePath();
        ctx.fillStyle = 'rgba(255, 170, 90, 0.9)';
        ctx.fill();
        ctx.fillStyle = 'rgba(8, 14, 24, 0.95)';
        ctx.fillRect(x - 0.6, ty - s * 0.45, 1.2, s * 0.6);
        ctx.font = '8px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const label = `OLBRZYM · ${String(g.site?.preset?.label || g.id || '').toUpperCase()}`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(3, 10, 20, 0.8)';
        ctx.strokeText(label, x, ty + s + 3);
        ctx.fillStyle = 'rgba(255, 190, 120, 0.92)';
        ctx.fillText(label, x, ty + s + 3);
      }
    }
    ctx.restore();
  }
}

const CONTOUR_BELT = CIC_BELT_PALETTES.map((P) => `rgba(${P.line}, 0.45)`);
const CONTOUR_FIELD = CIC_BELT_PALETTES.map((P) => `rgba(${P.line}, 0.78)`);

/** Łańcuchy → grupy wg palety regionu przy łańcuchu (próbka o największej obwiedni w komórce środka łańcucha). */
export function groupChainsByPalette(chains, Wv, Pv, nx = CIC_BELT_TEX) {
  const groups = [];
  for (const c of chains) {
    const mid = (c.length >> 2) << 1;
    const i0 = Math.floor(c[mid]);
    const j0 = Math.floor(c[mid + 1]);
    let pal = 0;
    let bw = -1;
    for (let dj = 0; dj <= 1; dj++) {
      for (let di = 0; di <= 1; di++) {
        const i = Math.min(nx - 1, Math.max(0, i0 + di));
        const j = Math.min(nx - 1, Math.max(0, j0 + dj));
        const o = j * nx + i;
        if (Wv[o] > bw) { bw = Wv[o]; pal = Pv[o]; }
      }
    }
    (groups[pal] || (groups[pal] = [])).push(c);
  }
  return groups;
}

function groupsToPaths(groups) {
  const out = [];
  if (!groups) return out;
  for (let pi = 0; pi < groups.length; pi++) {
    const chains = groups[pi];
    if (!chains || !chains.length) continue;
    const p = new Path2D();
    for (const c of chains) {
      p.moveTo(c[0], c[1]);
      for (let i = 2; i < c.length; i += 2) p.lineTo(c[i], c[i + 1]);
    }
    out[pi] = p;
  }
  return out;
}

/**
 * Opis miejsca dla HUD-u CIC (kursor, statek): „PAS GŁÓWNY · RODZINA THEMIS · GĘSTE POLE” albo null poza pasem.
 * Jedna próbka pola + rodzina — ~2 µs.
 */
export function describeCicBeltAt(field, x, y) {
  if (!field || typeof field.sampleMacro !== 'function') return null;
  const m = field.sampleMacro(x, y);
  const w = m.weight;
  if (!(w > 0.03) || !m.region) return null;
  const beltId = m.region.beltId;
  const gap = m.gap;
  const cv = cicBeltCellValues(m, _cell);
  const f = cv.f, rim = cv.rim;
  let name = CIC_BELT_NAMES[beltId] || String(beltId).toUpperCase();
  if (beltId === 'plutinos' || beltId === 'kuiper_cold') name = `PAS KUIPERA · ${name}`;
  let density;
  let gapId = null;
  if (gap < 0.6) {
    const rAu = Math.hypot(x - field.sunX, y - field.sunY) / field.auToWorld;
    let best = Infinity;
    for (const g of field.config?.kirkwoodGaps || []) {
      const d = Math.abs(rAu - g.au);
      if (d < best) { best = d; gapId = g.id; }
    }
  }
  if (gapId) density = `LUKA KIRKWOODA ${gapId}`;
  else if (f >= 0.3) density = 'GĘSTE POLE';
  else if (f > 0.05 || rim > 0.3) density = 'OBRZEŻE POLA';
  else if (w < 0.25) density = 'SKRAJ PASA';
  else density = 'RZADKO';
  let fam = null;
  if (REGION_FAMILIES[beltId]) fam = null; // nazwa regionu = rodzina
  else if (typeof field.familyAt === 'function') {
    const fa = field.familyAt(x, y);
    if (fa && fa.label && !REGION_FAMILIES[fa.id]) fam = `RODZINA ${String(fa.label).toUpperCase()}`;
  }
  return fam ? `${name} · ${fam} · ${density}` : `${name} · ${density}`;
}
