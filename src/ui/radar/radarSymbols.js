// src/ui/radar/radarSymbols.js
//
// Symbole śladów (jak NTDS / MIL-STD-2525) — wspólne dla tarczy radaru, znaczników skanu X w świecie
// i znaczników krawędzi ekranu. Kształt mówi STRONĘ, wielkość i kropka w środku — KLASĘ:
//   wróg      — romb          sojusznik — koło          nieznany — kwadrat     neutralny — kwadrat bez wypełnienia
//   okręt kapitałowy — kropka w środku, superkapitał — podwójny obrys
//   stacja    — kształt strony z krzyżem w środku       myśliwiec — klin wzdłuż kursu
//   rakieta   — grot wzdłuż lotu                         wrak — ✕       dron / sonda — mały pusty trójkąt
// Bez alokacji na wywołanie: barwy z pamięci podręcznej `radarColor`.

import { RADAR_RGB } from './radarConfig.js';

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
