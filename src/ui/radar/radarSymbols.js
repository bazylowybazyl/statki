// src/ui/radar/radarSymbols.js
//
// Symbole śladów (jak NTDS / MIL-STD-2525) — wspólne dla tarczy radaru, znaczników skanu X w świecie
// i znaczników krawędzi ekranu. Kształt mówi STRONĘ, wielkość i kropka w środku — KLASĘ:
//   wróg      — romb          sojusznik — koło          nieznany — kwadrat     neutralny — kwadrat bez wypełnienia
//   okręt kapitałowy — kropka w środku, superkapitał — podwójny obrys
//   stacja    — kształt strony z krzyżem w środku       myśliwiec — klin wzdłuż kursu
//   rakieta   — grot wzdłuż lotu                         wrak — ✕       dron / sonda — mały pusty trójkąt
//   ślad bez ustalenia (jedno malowanie) — przerywany kwadrat pozyskiwania (kształt 'acq')
// Bez alokacji na wywołanie: barwy z pamięci podręcznej `radarColor`; seria symboli — stemple (stampRadarSymbol).

import { RADAR_RGB } from './radarConfig.js';
import { StampAtlas } from './stampAtlas.js';

const TAU = Math.PI * 2;
const _colorCache = new Map();

/** 'r, g, b' + alfa → napis rgba (pamięć podręczna, alfa w krokach 1/64). */
export function radarColor(rgb, alpha = 1) {
  const a = alpha <= 0 ? 0 : alpha >= 1 ? 64 : Math.round(alpha * 64);
  let row = _colorCache.get(rgb);
  if (!row) {
    row = new Array(65);
    _colorCache.set(rgb, row);
  }
  let s = row[a];
  if (!s) {
    s = `rgba(${rgb}, ${(a / 64).toFixed(3)})`;
    row[a] = s;
  }
  return s;
}

/** Barwa strony / rodzaju śladu. */
export function radarAffRgb(aff, kind = 'ship') {
  if (kind === 'missile') return aff === 'hostile' ? RADAR_RGB.missileHostile : RADAR_RGB.missileFriendly;
  if (kind === 'wreck') return RADAR_RGB.wreck;
  switch (aff) {
    case 'hostile': return RADAR_RGB.hostile;
    case 'friendly': return RADAR_RGB.friendly;
    case 'neutral': return RADAR_RGB.neutral;
    default: return RADAR_RGB.unknown;
  }
}

/** Półrozmiar symbolu [jednostki projektu] z rodzaju i klasy. */
export function radarSymbolSize(kind, cls, capital) {
  if (kind === 'missile') return 2.3;
  if (kind === 'fighter') return 2.6;
  if (kind === 'drone') return 2.4;
  if (kind === 'wreck') return 2.6;
  if (kind === 'body') return 3.6;
  if (kind === 'station') return 5.4;
  switch (cls) {
    case 'SC': return 6;
    case 'CV': case 'BB': return 5;
    case 'DD': return 4.1;
    case 'FF': return 3.5;
    case 'TR': case 'MN': return 3.4;
    default: return capital ? 5 : 3.6;
  }
}

/** Ścieżka kształtu wokół (0, 0), półrozmiar s. */
export function pathRadarShape(ctx, shape, s) {
  switch (shape) {
    case 'diamond':
      ctx.moveTo(0, -s * 1.18);
      ctx.lineTo(s * 1.18, 0);
      ctx.lineTo(0, s * 1.18);
      ctx.lineTo(-s * 1.18, 0);
      ctx.closePath();
      break;
    case 'circle':
      ctx.moveTo(s, 0);
      ctx.arc(0, 0, s, 0, TAU);
      break;
    case 'wedge':   // klin wzdłuż +x (myśliwiec), obrót robi wołający
      ctx.moveTo(s * 1.35, 0);
      ctx.lineTo(-s * 0.9, s * 0.9);
      ctx.lineTo(-s * 0.45, 0);
      ctx.lineTo(-s * 0.9, -s * 0.9);
      ctx.closePath();
      break;
    case 'dart':    // grot rakiety wzdłuż +x
      ctx.moveTo(s * 1.6, 0);
      ctx.lineTo(-s * 0.9, s * 0.62);
      ctx.lineTo(-s * 0.9, -s * 0.62);
      ctx.closePath();
      break;
    case 'triangle':
      ctx.moveTo(0, -s * 1.15);
      ctx.lineTo(s * 1.05, s * 0.8);
      ctx.lineTo(-s * 1.05, s * 0.8);
      ctx.closePath();
      break;
    case 'cross':
      ctx.moveTo(-s, -s); ctx.lineTo(s, s);
      ctx.moveTo(s, -s); ctx.lineTo(-s, s);
      break;
    case 'rock':    // ciało naturalne (planetoida, kometa): nieregularny siedmiokąt
      ctx.moveTo(s * 1.05, -s * 0.2);
      ctx.lineTo(s * 0.55, s * 0.85);
      ctx.lineTo(-s * 0.3, s * 1.0);
      ctx.lineTo(-s * 1.05, s * 0.4);
      ctx.lineTo(-s * 0.9, -s * 0.55);
      ctx.lineTo(-s * 0.15, -s * 1.05);
      ctx.lineTo(s * 0.7, -s * 0.85);
      ctx.closePath();
      break;
    default:        // square
      ctx.rect(-s, -s, s * 2, s * 2);
      break;
  }
}

/** Kształt z rodzaju i strony. */
export function radarShapeOf(kind, aff) {
  if (kind === 'missile') return 'dart';
  if (kind === 'fighter') return 'wedge';
  if (kind === 'drone') return 'triangle';
  if (kind === 'wreck') return 'cross';
  if (kind === 'body') return 'rock';
  if (aff === 'hostile') return 'diamond';
  if (aff === 'friendly') return 'circle';
  return 'square';
}

/**
 * Symbol śladu w (x, y) [px]. o: { kind, aff, cls, capital, s (półrozmiar px), alpha, rotation (rad — klin,
 * grot), lw, fill (0..1 alfy wypełnienia), dashed, rgb (nadpisanie barwy), halo (poświata 0..1) }.
 */
export function drawRadarSymbol(ctx, x, y, o) {
  const kind = o.kind || 'ship';
  const aff = o.aff || 'unknown';
  const rgb = o.rgb || radarAffRgb(aff, kind);
  const s = Math.max(1, o.s || 4);
  const alpha = o.alpha == null ? 1 : o.alpha;
  if (alpha <= 0.01) return;
  const shape = o.shape || radarShapeOf(kind, aff);
  const lw = Math.max(0.75, o.lw || 1.2);
  const rot = (shape === 'wedge' || shape === 'dart') ? (o.rotation || 0) : 0;
  ctx.save();
  ctx.translate(x, y);
  if (shape === 'acq') {
    // kwadrat pozyskiwania: sam przerywany obrys, kreska ~2,2 grubości linii
    ctx.setLineDash([lw * 2.22, lw * 2.22]);
    ctx.strokeStyle = radarColor(rgb, alpha);
    ctx.lineWidth = lw;
    ctx.strokeRect(-s, -s, s * 2, s * 2);
    ctx.setLineDash([]);
    ctx.restore();
    return;
  }
  if (rot) ctx.rotate(rot);
  // Poświata: szersza, przezroczysta linia (bez shadowBlur — dziesiątki symboli w klatce).
  if (o.halo > 0) {
    ctx.beginPath();
    pathRadarShape(ctx, shape, s);
    ctx.lineWidth = lw * 3.2;
    ctx.strokeStyle = radarColor(rgb, alpha * 0.22 * o.halo);
    ctx.stroke();
  }
  ctx.beginPath();
  pathRadarShape(ctx, shape, s);
  const fill = o.fill == null ? (shape === 'cross' ? 0 : 0.22) : o.fill;
  if (fill > 0 && shape !== 'cross') {
    ctx.fillStyle = radarColor(rgb, alpha * fill);
    ctx.fill();
  }
  if (o.dashed) ctx.setLineDash([Math.max(1.5, s * 0.55), Math.max(1.2, s * 0.42)]);
  // Ciemny podkład pod obrysem — symbol czytelny na lądzie i na smudze przemiatania.
  ctx.lineWidth = lw + 1.4;
  ctx.strokeStyle = radarColor(RADAR_RGB.outline, alpha * 0.55);
  ctx.stroke();
  ctx.lineWidth = lw;
  ctx.strokeStyle = radarColor(rgb, alpha);
  ctx.stroke();
  if (o.dashed) ctx.setLineDash([]);
  // Superkapitał: drugi obrys; kapitałowy: kropka w środku; stacja: krzyż.
  if (kind === 'station') {
    const c = s * 0.55;
    ctx.beginPath();
    ctx.moveTo(-c, 0); ctx.lineTo(c, 0);
    ctx.moveTo(0, -c); ctx.lineTo(0, c);
    ctx.lineWidth = Math.max(0.75, lw * 0.85);
    ctx.stroke();
  } else if (kind === 'ship') {
    if (o.cls === 'SC') {
      ctx.beginPath();
      pathRadarShape(ctx, shape, s + Math.max(1.6, lw * 1.6));
      ctx.lineWidth = Math.max(0.7, lw * 0.7);
      ctx.strokeStyle = radarColor(rgb, alpha * 0.7);
      ctx.stroke();
    }
    if (o.capital || o.cls === 'SC' || o.cls === 'BB' || o.cls === 'CV') {
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(0.9, s * 0.24), 0, TAU);
      ctx.fillStyle = radarColor(rgb, alpha);
      ctx.fill();
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------- stemple symboli
// Symbol rysowany RAZ do małego płótna i stawiany jednym drawImage z globalAlpha (2026-10-08). W dużej bitwie
// tarcza stawia ~240 symboli 30 razy na sekundę, a znaczniki krawędzi do 24 w każdej klatce; ścieżki symbolu
// (poświata, wypełnienie, podkład, obrys, kropka) z save / restore kosztowały wielokrotnie więcej niż drawImage.
// Klucz liczbowy z wyglądu (kształt, barwa, wariant, rozmiar co 1/4 px, grubość, poświata, wypełnienie, kreski);
// alfa, obrót i położenie — przy stawianiu.
const STAMP_CAP = 400;
const SHAPE_IDS = Object.freeze({ square: 0, diamond: 1, circle: 2, wedge: 3, dart: 4, triangle: 5, cross: 6, acq: 7, rock: 8 });
const _stamps = new Map();
const _rgbIds = new Map();
const _stampOpts = { kind: 'ship', aff: 'unknown', cls: '', capital: false, s: 4, alpha: 1, rotation: 0, lw: 1.2, fill: null, dashed: false, rgb: null, halo: 0, shape: null };

function makeStampCanvas() {
  if (typeof document !== 'undefined') return document.createElement('canvas');
  return null;
}

/** Stempel symbolu { canvas, half } (środek płótna = punkt symbolu, kształt skierowany wzdłuż +x) albo null. */
export function radarSymbolStamp(o) {
  const kind = o.kind || 'ship';
  const aff = o.aff || 'unknown';
  const rgb = o.rgb || radarAffRgb(aff, kind);
  const shape = o.shape || radarShapeOf(kind, aff);
  const s = Math.max(1, o.s || 4);
  const lw = Math.max(0.75, o.lw || 1.2);
  const fill = o.fill == null ? (shape === 'cross' ? 0 : 0.22) : o.fill;
  const halo = o.halo > 0 ? o.halo : 0;
  const variant = kind === 'station' ? 3 : kind === 'ship'
    ? (o.cls === 'SC' ? 2 : (o.capital || o.cls === 'BB' || o.cls === 'CV') ? 1 : 0) : 0;
  let rgbId = _rgbIds.get(rgb);
  if (rgbId === undefined) { rgbId = _rgbIds.size; _rgbIds.set(rgb, rgbId); }
  const sQ = Math.round(s * 4);
  const lwQ = Math.round(lw * 4);
  const key = ((((((rgbId * 16 + (SHAPE_IDS[shape] ?? 0)) * 4 + variant) * 512 + sQ) * 64 + lwQ) * 16
    + Math.round(halo * 10)) * 32 + Math.round(fill * 20)) * 2 + (o.dashed ? 1 : 0);
  let st = _stamps.get(key);
  if (st !== undefined) return st;
  const qs = sQ / 4;
  const qlw = lwQ / 4;
  // zasięg kształtu: grot rakiety 1,6 s, superkapitał — drugi obrys, poświata 3,2 lw
  const ext = (qs + Math.max(1.6, qlw * 1.6)) * 1.6 + qlw * 1.7 + 1;
  const half = Math.ceil(ext) + 1;
  const canvas = makeStampCanvas();
  const g = canvas ? canvas.getContext('2d') : null;
  if (!g) return null;
  if (_stamps.size >= STAMP_CAP) _stamps.clear();
  canvas.width = half * 2;
  canvas.height = half * 2;
  const so = _stampOpts;
  so.kind = kind; so.aff = aff; so.cls = o.cls || ''; so.capital = !!o.capital; so.s = qs; so.alpha = 1; so.rotation = 0;
  so.lw = qlw; so.fill = fill; so.dashed = !!o.dashed; so.rgb = rgb; so.halo = halo; so.shape = shape;
  drawRadarSymbol(g, half, half, so);
  st = { canvas, half, rotates: shape === 'wedge' || shape === 'dart' };
  _stamps.set(key, st);
  return st;
}

/**
 * Symbol ze stempla w (x, y) — te same opcje co drawRadarSymbol (alpha i rotation przy stawianiu). Bez płótna
 * (Node) rysuje ścieżkami. Kształty bez obrotu stoją na całym pikselu (ostry stempel).
 */
export function stampRadarSymbol(ctx, x, y, o) {
  const alpha = o.alpha == null ? 1 : o.alpha;
  if (alpha <= 0.01) return;
  const st = radarSymbolStamp(o);
  if (!st || typeof ctx.drawImage !== 'function') { drawRadarSymbol(ctx, x, y, o); return; }
  const prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = prevAlpha * Math.min(1, alpha);
  const rot = st.rotates ? (o.rotation || 0) : 0;
  if (rot) {
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.drawImage(st.canvas, -st.half, -st.half);
    ctx.rotate(-rot);
    ctx.translate(-x, -y);
  } else {
    ctx.drawImage(st.canvas, Math.round(x) - st.half, Math.round(y) - st.half);
  }
  ctx.globalAlpha = prevAlpha;
}

// ---------------------------------------------------------------- stemple napisów
// Napis z obrysem (drawRadarText) wypieczony do miejsca w atlasie stempli; stempel `st` należy do wołającego (np. jeden
// na kontakt i rodzaj odczytu) i jest pieczony od nowa tylko po zmianie napisu albo wyglądu. strokeText z obrysem
// to najdroższa operacja znaczników krawędzi — rysowanych w każdej klatce, z napisami, które prawie stoją.
// ATLAS (2026-10-17, stampAtlas.js): dawniej każdy stempel miał własne płótno — w rastrze procesu GPU osobny obraz
// na stempel (~47 na klatkę w bitwie, ~0,4 ms CrGpuMain). Napis pieczony w miejscu atlasu w tym samym położeniu
// względem prostokąta stempla, przycięty do niego — piksele stempla jak z osobnego płótna. Za duży napis albo pełny
// atlas — osobne płótno jak dawniej. A/B: window.RadarTextAtlas.enabled = false (nowe stemple na osobnych płótnach).
// Strony atlasu: zwykłe płótna (raster kanw jak małe płótna stempli — piksele te same; płótno programowe
// `willReadFrequently` rasteryzuje napis inaczej, do 15/255). Przepieczenia klatki przed jej rysunkami
// (prepareRadarText) — strona zmieniona po rysunku w tej samej klatce to kopia strony w rastrze procesu GPU.
export const RADAR_TEXT_ATLAS = {
  enabled: true,
  pageW: 512,
  pageH: 256,
  maxPages: 8,
  atlas: null,
  stats: { bakes: 0, atlasBakes: 0, standalone: 0 }
};
if (typeof window !== 'undefined') window.RadarTextAtlas = RADAR_TEXT_ATLAS;

let _measureCtx = null;
function measureCtx() {
  if (_measureCtx) return _measureCtx;
  const c = makeStampCanvas();
  _measureCtx = c ? c.getContext('2d') : null;
  return _measureCtx;
}

function textAtlas() {
  const A = RADAR_TEXT_ATLAS;
  if (!A.atlas) {
    A.atlas = new StampAtlas({ pageW: A.pageW, pageH: A.pageH, maxPages: A.maxPages, makePage: (w, h) => {
      const c = makeStampCanvas();
      if (!c) return null;
      c.width = w; c.height = h;
      return c;
    } });
  }
  return A.atlas;
}

function bakeTextStamp(st, text, font, rgb, aQ, align, baseline, outline) {
  const A = RADAR_TEXT_ATLAS;
  A.stats.bakes++;
  const mg = (st && st.slot ? st.slot.page.canvas.getContext('2d') : null) || (st && st.canvas ? st.canvas.getContext('2d') : null) || measureCtx();
  if (!mg) return null;
  mg.font = font;
  mg.textAlign = align;
  mg.textBaseline = baseline;
  const m = mg.measureText(text);
  const pad = Math.ceil(outline / 2) + 2;
  const left = Math.ceil(m.actualBoundingBoxLeft || 0) + pad;
  const right = Math.ceil(m.actualBoundingBoxRight || m.width) + pad;
  const up = Math.ceil(m.actualBoundingBoxAscent || 0) + pad;
  const down = Math.ceil(m.actualBoundingBoxDescent || 0) + pad;
  const w = Math.max(1, left + right);
  const h = Math.max(1, up + down);
  if (!st) st = { canvas: null, slot: null, big: false, text: '', font: '', rgb: '', aQ: 0, align: '', baseline: '', outline: 0, w: 0, h: 0, ax: 0, ay: 0 };
  // miejsce w atlasie: dotychczasowe, gdy napis się mieści, inaczej nowe (stare wraca do wolnych)
  let slot = null;
  if (A.enabled) {
    const atlas = textAtlas();
    if (st.slot && w <= st.slot.cw && h <= st.slot.ch) slot = st.slot;
    else {
      if (st.slot) { atlas.release(st.slot); st.slot = null; }
      slot = atlas.alloc(w, h, st);
      if (slot && !slot.page.canvas) { atlas.release(slot); slot = null; }
    }
  } else if (st.slot) {
    textAtlas().release(st.slot);
    st.slot = null;
  }
  if (slot) {
    const g = slot.page.canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(slot.x - 1, slot.y - 1, slot.cw + 2, slot.ch + 2);
    // przycięcie do prostokąta stempla (margines miejsca zostaje pusty). Stemple stawiane są w całych pikselach bez
    // obrotu i skali (znaczniki krawędzi, duchy tarczy radaru — kontekst tożsamościowy): piksele jak z osobnego
    // płótna. Pod obrotem filtr próbkuje inaczej (współrzędne tekstury innego rozmiaru: do ~10/255 na brzegach).
    g.save();
    g.beginPath();
    g.rect(slot.x, slot.y, w, h);
    g.clip();
    g.font = font;
    drawRadarText(g, text, slot.x + left, slot.y + up, rgb, aQ / 64, align, baseline, outline);
    g.restore();
    st.slot = slot;
    st.canvas = null;
    st.big = false;
    A.stats.atlasBakes++;
  } else {
    // osobne płótno (jak przed atlasem): rośnie, nie maleje (zmiana rozmiaru = nowy bufor); rysujemy wycinek w×h
    const canvas = st.canvas || makeStampCanvas();
    const g = canvas ? canvas.getContext('2d') : null;
    if (!g) return null;
    if (canvas.width < w || canvas.height < h) {
      canvas.width = Math.max(canvas.width, w + 8);
      canvas.height = Math.max(canvas.height, h + 4);
    } else {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
    }
    g.font = font;
    drawRadarText(g, text, left, up, rgb, aQ / 64, align, baseline, outline);
    st.canvas = canvas;
    st.big = A.enabled;   // atlas bez miejsca (za duży napis / pełny) — bez prób co klatkę
    A.stats.standalone++;
  }
  st.text = text; st.font = font; st.rgb = rgb; st.aQ = aQ; st.align = align; st.baseline = baseline; st.outline = outline;
  st.w = w; st.h = h; st.ax = left; st.ay = up;
  return st;
}

/**
 * Stempel napisu gotowy do rysunku: przepieczony, gdy zmienił się napis, wygląd albo miejsce (wyparte z atlasu,
 * przełączony atlas). Zwraca stempel (null — bez płótna). Wołający, który rysuje wiele stempli w klatce, przepieka
 * WSZYSTKIE przed pierwszym rysunkiem (znaczniki krawędzi) — strona atlasu zmieniona po rysunku w tej samej klatce
 * to kopia całej strony w rastrze; potem stampRadarText z tymi samymi parametrami tylko rysuje.
 */
export function prepareRadarText(st, text, font, rgb, alpha = 1, align = 'left', baseline = 'middle', outline = 3) {
  if (!text || alpha <= 0.01 || typeof document === 'undefined') return st;
  const aQ = alpha >= 1 ? 64 : Math.round(alpha * 64);
  // stempel bez miejsca i bez płótna (miejsce wyparte z atlasu) albo atlas przełączony — piecze się od nowa
  if (!st || st.text !== text || st.font !== font || st.rgb !== rgb || st.aQ !== aQ || st.align !== align
    || st.baseline !== baseline || st.outline !== outline || (!st.slot && !st.canvas)
    || (st.slot && !RADAR_TEXT_ATLAS.enabled) || (st.canvas && RADAR_TEXT_ATLAS.enabled && !st.big)) {
    return bakeTextStamp(st, text, font, rgb, aQ, align, baseline, outline);
  }
  return st;
}

/**
 * Napis jak drawRadarText (font podany wprost), ze stempla `st` (null — nowy). Zwraca stempel do zachowania
 * u wołającego. Bez płótna (Node) albo przy kontekście bez drawImage — zwykły drawRadarText.
 */
export function stampRadarText(ctx, st, text, font, x, y, rgb, alpha = 1, align = 'left', baseline = 'middle', outline = 3) {
  if (!text || alpha <= 0.01) return st;
  if (typeof ctx.drawImage !== 'function' || typeof document === 'undefined') {
    ctx.font = font;
    drawRadarText(ctx, text, x, y, rgb, alpha, align, baseline, outline);
    return st;
  }
  st = prepareRadarText(st, text, font, rgb, alpha, align, baseline, outline);
  if (!st) { ctx.font = font; drawRadarText(ctx, text, x, y, rgb, alpha, align, baseline, outline); return null; }
  const dx = Math.round(x) - st.ax;
  const dy = Math.round(y) - st.ay;
  const slot = st.slot;
  if (slot) {
    RADAR_TEXT_ATLAS.atlas.touch(slot);
    ctx.drawImage(slot.page.canvas, slot.x, slot.y, st.w, st.h, dx, dy, st.w, st.h);
  } else {
    ctx.drawImage(st.canvas, 0, 0, st.w, st.h, dx, dy, st.w, st.h);
  }
  return st;
}

/** Narożniki namiaru (kwadrat 2r, ramię arm) wokół (x, y), opcjonalny obrót. */
export function strokeRadarBrackets(ctx, x, y, r, arm, rotation = 0) {
  ctx.save();
  ctx.translate(x, y);
  if (rotation) ctx.rotate(rotation);
  ctx.beginPath();
  for (let q = 0; q < 4; q++) {
    const sx = q === 0 || q === 3 ? -1 : 1;
    const sy = q < 2 ? -1 : 1;
    ctx.moveTo(sx * r, sy * (r - arm));
    ctx.lineTo(sx * r, sy * r);
    ctx.lineTo(sx * (r - arm), sy * r);
  }
  ctx.stroke();
  ctx.restore();
}

/** Tekst z ciemnym obrysem (odczyt jak w kokpicie: cień zamiast płytki). */
export function drawRadarText(ctx, text, x, y, rgb, alpha = 1, align = 'left', baseline = 'middle', outline = 3) {
  if (!text || alpha <= 0.01) return;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.lineJoin = 'round';
  ctx.lineWidth = outline;
  ctx.strokeStyle = radarColor(RADAR_RGB.outline, Math.min(1, alpha * 0.85));
  ctx.strokeText(text, x, y);
  ctx.fillStyle = radarColor(rgb, alpha);
  ctx.fillText(text, x, y);
}
