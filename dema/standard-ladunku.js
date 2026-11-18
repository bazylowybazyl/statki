// dema/standard-ladunku.js
//
// PLANSZA STANDARDU ŁADUNKU (propozycja do decyzji użytkownika, 2026-11-16) — wszystko w JEDNEJ skali: kontener, moduł,
// sekcja w odmianach, kruszarka, zestawy ciągników, kopacze z sekcjami, kontenerowiec i Atlas. Liczby z danych
// (`src/data/cargoStandard.js`, `spaceTrucks.js`, `cargoBays.js`, `trafficHulls.js`) — plansza niczego nie wymyśla sama,
// poza rysunkiem brył proponowanych (sekcja, kruszarka, ciągnik sekcyjny, platforma), których w grze jeszcze nie ma.
// To plansza wymiarów na kanwie 2D (tekst i linie wymiarowe), nie scena gry: bez three, bez shaderów.
//
// Sterowanie: kółko — zoom, przeciągnięcie — przesuw, klawisze 0–5 — widoki. Harness: `window.__standard`
// (`ready`, `errors`, `views()`, `view(i)`, `stats()`), `?shot=1` — bez paska, kamera bez animacji.
import {
  CARGO_LEVELS, CARGO_SECTION, CARGO_COUPLER, CARGO_SOCKET, CARGO_SECTION_TRACTOR, CARGO_TRAILER, CARGO_TONNES_PER_CONTAINER,
  cargoBreakdown, cargoSectionRigLength, cargoRigTonnes, cargoMaxPiece, cargoSectionsInArea
} from '../src/data/cargoStandard.js';
import { TRUCK_TRACTORS, TRUCK_TRAILER, TRUCK_SPRITE_PNG, TRUCK_SPRITE_BOUNDS, truckRigLength } from '../src/data/spaceTrucks.js';
import { TRAFFIC_HULLS, trafficHullRenderSize } from '../src/data/trafficHulls.js';
import { CARGO_BAY_HULLS, cargoBayScale } from '../src/data/cargoBays.js';
import { CARGO_HOLD_LAYOUTS, STANDARD_PAINTS, TANK_SHELLS } from '../src/data/cargoContainers.js';
import { VAN_CLASSES } from '../src/game/traffic/shipmentOrders.js';

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const params = new URLSearchParams(location.search);
const SHOT = params.has('shot');
if (SHOT) document.body.classList.add('shot');

const api = window.__standard = { ready: false, errors: [] };
const fail = (msg) => {
  api.errors.push(String(msg));
  const el = document.getElementById('errors');
  el.style.display = 'block';
  el.textContent = api.errors.join('\n');
};
window.addEventListener('error', (e) => fail(e.message || e.error));
window.addEventListener('unhandledrejection', (e) => fail(e.reason && e.reason.stack ? e.reason.stack : e.reason));

// ---------------------------------------------------------------------------------------------------------------
// Barwy i układ planszy [j. świata, y w dół]

const C = {
  bg: '#080b0f', zone: '#0e141b', zoneLine: '#22303d', ink: '#e4ebf0', muted: '#8c9ca8', faint: '#5d6c78',
  exist: '#b9c8d3',     // istnieje w grze / demach
  prop: '#f0a020',      // propozycja standardu
  ghost: '#e8695b',     // dziś w demie huty — poza standardem
  dim: '#7f95a5',
  frame: '#2a3037', casting: '#d19a1f', deck: '#3a424b', ore: '#8a5a3c', steel: '#c2ccd3'
};

const Z = {
  A: { x: 20, y: 20, w: 640, h: 404 },
  C: { x: 20, y: 440, w: 640, h: 456 },
  B: { x: 680, y: 20, w: 560, h: 346 },
  E: { x: 680, y: 382, w: 560, h: 514 },
  D: { x: 1260, y: 20, w: 1800, h: 876 }
};
const POSTER = { x: 0, y: 0, w: 3080, h: 916 };
const VIEWS = [
  { id: 'calosc', name: 'Całość', key: '0', rect: POSTER },
  { id: 'ladunek', name: '1 Ładunek', key: '1', rect: Z.A },
  { id: 'zestawy', name: '2 Zestawy', key: '2', rect: Z.B },
  { id: 'statki', name: '3 Statki', key: '3', rect: Z.C },
  { id: 'huta', name: '4 Dziś w hucie', key: '4', rect: Z.E },
  { id: 'atlas', name: '5 Atlas', key: '5', rect: Z.D }
];

// Dzisiejsze wymiary z dema huty (pliki sesji produkcji — tylko odczytane): ciężarówka w dzielnicy huty
// (dema/ring-dzielnice/huta/index.js: kabina 96 × 104, naczepa 336 × 112, kabina 215 j. przed środkiem naczepy),
// krąg 120 j., ładownia statku z dema rudy 468 × 252 j. (geometria.js: 4 × 2 pola), 360 t (stanowisko.js).
const HUTA_DZIS = { cab: { L: 96, W: 104 }, trailer: { L: 336, W: 112 }, cabAhead: 215, coil: 120, hold: { L: 468, W: 252, tonnes: 360, fieldsL: 4, fieldsW: 2 } };

// Progi widoczności podpisów [px na j.] — z daleka zostają tytuły, z bliska dochodzą szczegóły.
const TIER = [0, 0.7, 0.95, 2.1];

const S = { W: 0, H: 0, dpr: 1, ui: 1, top: 64, cam: { x: POSTER.w / 2, y: POSTER.h / 2, ppu: 1 }, to: null, view: 0, dirty: true, drag: null, drawn: { labels: 0, dims: 0 } };
const IMG = {};
const HB = {};          // obrys alfy sprite'a statku [j. od środka płótna]: { x0, x1, y0, y1, w, h }
const SHAPES = [];
const LABELS = [];
const DIMS = [];

// ---------------------------------------------------------------------------------------------------------------
// Pomocniki

const num = (n) => (Number.isInteger(+n) ? String(+n) : (+n).toFixed(1).replace('.', ','));
const px = (n) => n / S.cam.ppu;
const ol = () => Math.max(0.16, 0.8 / S.cam.ppu);
const sx = (x) => (x - S.cam.x) * S.cam.ppu + S.W / 2;
const sy = (y) => (y - S.cam.y) * S.cam.ppu + S.H / 2;

function rgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function shade(hex, f) {
  const c = rgb(hex).map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function alpha(hex, a) {
  const c = rgb(hex);
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}
function rnd(seed) {
  let t = (seed | 0) + 0x6d2b79f5;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2)); }
function seg(x0, y0, x1, y1) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); }
function outline(color = '#05070a') { ctx.lineWidth = ol(); ctx.strokeStyle = color; ctx.stroke(); }

function loadImage(name, url) {
  return new Promise((done) => {
    const im = new Image();
    im.onload = () => { IMG[name] = im; done(); };
    im.onerror = () => { fail(`nie wczytano obrazu: ${url}`); done(); };
    im.src = url;
  });
}

/** Obrys alfy sprite'a w j. od środka płótna (płótno `w` × `h` j.). */
function alphaBounds(name, w, h) {
  const im = IMG[name];
  const out = { x0: -w / 2, x1: w / 2, y0: -h / 2, y1: h / 2, w, h };
  if (!im) return out;
  const cw = 444;
  const ch = Math.max(1, Math.round(cw * im.height / im.width));
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const c2 = cv.getContext('2d', { willReadFrequently: true });
  c2.drawImage(im, 0, 0, cw, ch);
  const d = c2.getImageData(0, 0, cw, ch).data;
  let x0 = cw, x1 = -1, y0 = ch, y1 = -1;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (d[(y * cw + x) * 4 + 3] > 48) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  if (x1 < 0) return out;
  out.x0 = (x0 / cw - 0.5) * w; out.x1 = ((x1 + 1) / cw - 0.5) * w;
  out.y0 = (y0 / ch - 0.5) * h; out.y1 = ((y1 + 1) / ch - 0.5) * h;
  return out;
}

function sprite(name, cx, cy, w, h, shadow = true) {
  const im = IMG[name];
  if (!im) return;
  if (shadow) shadowOn(0.9);
  ctx.drawImage(im, cx - w / 2, cy - h / 2, w, h);
  if (shadow) shadowOff();
}

/** Część zestawu ciągnika (sprite z obrysem w układzie lokalnym, kotwica = środek bryły, dziób +x). */
function part(name, ax, ay) {
  const im = IMG[name];
  const b = TRUCK_SPRITE_BOUNDS[name];
  if (!im || !b) return;
  shadowOn(0.9);
  ctx.drawImage(im, ax + b[0], ay + b[2], b[1] - b[0], b[3] - b[2]);
  shadowOff();
}

// ---------------------------------------------------------------------------------------------------------------
// Podpisy, wymiary, strefy (zapisywane przy budowie planszy, rysowane w pikselach ekranu)

function label(x, y, lines, o = {}) {
  LABELS.push({
    x, y, lines: (Array.isArray(lines) ? lines : [lines]).map((q) => (typeof q === 'string' ? { t: q } : q)), align: o.align || 'center', tier: o.tier ?? 1,
    color: o.color || C.ink, sub: o.sub || C.muted, size: o.size || 12.5, subSize: o.subSize || 11.5,
    dx: o.dx || 0, dy: o.dy || 0, keep: !!o.keep, plate: !!o.plate, bold: o.bold !== false, fitW: o.fitW || 0, alt: o.alt || null
  });
}
function dimH(x0, x1, y, text, o = {}) { DIMS.push({ x0, y0: y, x1, y1: y, text, tier: o.tier ?? 2, color: o.color || C.dim, off: o.off ?? 8, above: !!o.above }); }
function dimV(x, y0, y1, text, o = {}) { DIMS.push({ x0: x, y0, x1: x, y1, text, tier: o.tier ?? 2, color: o.color || C.dim, off: o.off ?? 8, right: !!o.right, vertical: true }); }
function shape(fn) { SHAPES.push(fn); }

function zone(z, title, short, sub) {
  shape(() => {
    rr(z.x, z.y, z.w, z.h, 8);
    ctx.fillStyle = C.zone; ctx.fill();
    ctx.lineWidth = px(1); ctx.strokeStyle = C.zoneLine; ctx.stroke();
  });
  label(z.x + 14, z.y + 10, [title], { align: 'left', tier: 0, size: 14.5, keep: true, fitW: z.w - 28, alt: short });
  label(z.x + 14, z.y + 10, [sub], { align: 'left', tier: 1, dy: 25, bold: false, color: C.muted, size: 12, fitW: z.w - 28 });
}

// ---------------------------------------------------------------------------------------------------------------
// Bryły ładunku (rysunek z góry; x, y = środek, L wzdłuż osi x)

const PAINTS = STANDARD_PAINTS.filter((p, i, a) => a.indexOf(p) === i);

/** Miękki cień pod bryłą: bryły odstają od tła pola (wartości w pikselach kanwy, niezależne od przekształcenia). */
function shadowOn(strength = 1) {
  ctx.save();
  const k = S.cam.ppu * S.dpr;
  ctx.shadowColor = `rgba(0,0,0,${0.62 * strength})`;
  ctx.shadowBlur = Math.max(3, Math.min(18, 3.4 * k));
  ctx.shadowOffsetX = Math.max(0.6, Math.min(5, 0.9 * k));
  ctx.shadowOffsetY = Math.max(1, Math.min(8, 1.6 * k));
}
function shadowOff() { ctx.restore(); }

/** Światło z góry obrazka: jaśniejszy górny brzeg, ciemniejszy dolny (nakładka na prostokąt). */
function lightOverlay(x, y, w, h, top = 0.22, bottom = 0.3) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, `rgba(255,255,255,${top})`); g.addColorStop(0.36, 'rgba(255,255,255,0.03)');
  g.addColorStop(0.7, 'rgba(0,0,0,0.05)'); g.addColorStop(1, `rgba(0,0,0,${bottom})`);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

function castings(x0, y0, L, W, q) {
  ctx.fillStyle = '#0c0f13';
  for (const cx of [x0, x0 + L - q]) for (const cy of [y0, y0 + W - q]) ctx.fillRect(cx, cy, q, q);
  if (q * S.cam.ppu >= 3.5) {
    ctx.fillStyle = '#7d8790';
    for (const cx of [x0, x0 + L - q]) for (const cy of [y0, y0 + W - q]) ctx.fillRect(cx + q * 0.3, cy + q * 0.3, q * 0.4, q * 0.4);
  }
}

function drawBox(x, y, L, W, paint) {
  const x0 = x - L / 2;
  const y0 = y - W / 2;
  shadowOn();
  rr(x0, y0, L, W, 0.45);
  ctx.fillStyle = '#161b21'; ctx.fill();
  shadowOff();
  const f = Math.min(0.5, W * 0.06);
  const bx = x0 + f;
  const by = y0 + f;
  const bw = L - 2 * f;
  const bh = W - 2 * f;
  ctx.fillStyle = paint;
  ctx.fillRect(bx, by, bw, bh);
  // żebrowanie dachu
  const p = S.cam.ppu;
  if (p >= 1.3) {
    const step = p >= 2.4 ? 1 : 2;
    ctx.save();
    ctx.globalAlpha = Math.min(1, (p - 1.1) / 1.2) * 0.9;
    ctx.lineWidth = step * 0.34; ctx.strokeStyle = shade(paint, 0.78);
    ctx.beginPath();
    for (let i = step * 0.75; i < bw - 0.3; i += step) { ctx.moveTo(bx + i, by + 0.25); ctx.lineTo(bx + i, by + bh - 0.25); }
    ctx.stroke();
    ctx.restore();
  }
  // pas armatora przy końcu drzwiowym i światło z góry
  ctx.fillStyle = 'rgba(255,255,255,0.46)';
  ctx.fillRect(bx + bw * 0.13, by, Math.max(0.55, bw * 0.05), bh);
  lightOverlay(bx, by, bw, bh);
  if (p >= 3) {
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fillRect(bx + 0.5, by + 0.5, 0.22, bh - 1); ctx.fillRect(bx + 1.05, by + 0.5, 0.22, bh - 1);
  }
  castings(x0, y0, L, W, Math.min(1.1, W * 0.14));
  rr(x0, y0, L, W, 0.45); outline();
}

function drawTank(x, y, L, W, shell, band) {
  const x0 = x - L / 2;
  const y0 = y - W / 2;
  shadowOn();
  rr(x0, y0, L, W, 0.4);
  ctx.fillStyle = '#1b2127'; ctx.fill();
  shadowOff();
  // siodła ramy
  ctx.fillStyle = '#39424b';
  for (const fq of [0.16, 0.5, 0.84]) ctx.fillRect(x0 + fq * L - Math.max(0.5, L * 0.012), y0 + 0.2, Math.max(1, L * 0.024), W - 0.4);
  const m = 0.55;
  const cw = W - 2 * m;
  const g = ctx.createLinearGradient(0, y - cw / 2, 0, y + cw / 2);
  g.addColorStop(0, shade(shell, 0.5)); g.addColorStop(0.28, shade(shell, 0.98)); g.addColorStop(0.42, '#ffffff');
  g.addColorStop(0.62, shade(shell, 0.88)); g.addColorStop(1, shade(shell, 0.38));
  rr(x0 + m, y - cw / 2, L - 2 * m, cw, cw / 2);
  ctx.fillStyle = g; ctx.fill();
  ctx.fillStyle = band;
  const bw = Math.max(0.7, L * 0.022);
  for (const fq of [-0.27, 0.27]) ctx.fillRect(x + fq * L - bw / 2, y - cw / 2 + 0.22, bw, cw - 0.44);
  if (S.cam.ppu >= 2.2) {
    // pomost i włazy na grzbiecie
    ctx.fillStyle = 'rgba(40,48,56,0.55)';
    ctx.fillRect(x - L * 0.2, y - cw * 0.07, L * 0.4, cw * 0.14);
    for (const fq of [-0.12, 0.12]) {
      circle(x + fq * L, y, Math.min(1.1, cw * 0.17)); ctx.fillStyle = '#4b555e'; ctx.fill();
      circle(x + fq * L, y, Math.min(0.55, cw * 0.085)); ctx.fillStyle = '#aab3ba'; ctx.fill();
    }
  }
  castings(x0, y0, L, W, Math.min(0.9, W * 0.11));
  rr(x0, y0, L, W, 0.4); outline();
}

function drawHopper(x, y, L, W, body, load, seed, cells) {
  const x0 = x - L / 2;
  const y0 = y - W / 2;
  shadowOn();
  rr(x0, y0, L, W, 0.5);
  ctx.fillStyle = body; ctx.fill();
  shadowOff();
  // obrzeże skrzyni i wnętrze z urobkiem (jaśniejszy grzbiet pryzmy, cień pod obrzeżem)
  const m = Math.max(0.9, Math.min(2.2, W * 0.07));
  const ix = x0 + m;
  const iy = y0 + m;
  const iw = L - 2 * m;
  const ih = W - 2 * m;
  const g = ctx.createLinearGradient(0, iy, 0, iy + ih);
  g.addColorStop(0, shade(load, 0.5)); g.addColorStop(0.2, shade(load, 0.92)); g.addColorStop(0.5, shade(load, 1.3));
  g.addColorStop(0.8, shade(load, 0.95)); g.addColorStop(1, shade(load, 0.62));
  ctx.fillStyle = g;
  ctx.fillRect(ix, iy, iw, ih);
  if (S.cam.ppu >= 2.2) {
    const r = rnd(seed * 977 + 13);
    const n = Math.min(900, Math.round(L * W / 5));
    for (let i = 0; i < n; i++) {
      const gx = ix + r() * iw;
      const gy = iy + r() * ih;
      const q = 0.35 + r() * 0.75;
      ctx.fillStyle = shade(load, 0.5 + r() * 0.95);
      ctx.fillRect(gx - q / 2, gy - q / 2, q, q * (0.7 + r() * 0.5));
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(ix, iy, iw, Math.min(1.2, ih * 0.1));
  ctx.fillRect(ix, iy, Math.min(1.2, iw * 0.05), ih);
  // ściągi nad wsadem na granicach kontenerów
  const tie = Math.max(0.5, Math.min(1.3, W * 0.035));
  ctx.fillStyle = shade(body, 1.55);
  for (let i = 1; i < cells; i++) ctx.fillRect(x0 + i * L / cells - tie / 2, y0 + m * 0.4, tie, W - m * 0.8);
  // jasna krawędź obrzeża i naroża
  ctx.lineWidth = Math.max(0.22, px(0.9)); ctx.strokeStyle = shade(body, 1.7);
  ctx.strokeRect(ix, iy, iw, ih);
  ctx.fillStyle = shade(body, 1.9);
  const q = Math.max(0.9, m * 0.9);
  for (const cx of [x0 + 0.15, x0 + L - q - 0.15]) for (const cy of [y0 + 0.15, y0 + W - q - 0.15]) ctx.fillRect(cx, cy, q, q);
  rr(x0, y0, L, W, 0.5); outline();
}

function drawCoil(cx, cy, d) {
  const r = d / 2;
  shadowOn(0.8);
  circle(cx, cy, r); ctx.fillStyle = '#5d6870'; ctx.fill();
  shadowOff();
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.08, cx, cy, r);
  g.addColorStop(0, '#f4f6f8'); g.addColorStop(0.55, '#aeb8c0'); g.addColorStop(1, '#5b666e');
  circle(cx, cy, r); ctx.fillStyle = g; ctx.fill();
  if (r * S.cam.ppu >= 9) {
    ctx.lineWidth = Math.max(0.08, px(0.6)); ctx.strokeStyle = 'rgba(20,26,32,0.3)';
    const step = Math.max(r * 0.085, px(2.2));
    for (let q = r * 0.5; q < r - step * 0.5; q += step) { circle(cx, cy, q); ctx.stroke(); }
  }
  const e = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r * 0.42);
  e.addColorStop(0, '#07090c'); e.addColorStop(1, '#1b2128');
  circle(cx, cy, r * 0.42); ctx.fillStyle = e; ctx.fill();
  ctx.lineWidth = Math.max(0.12, r * 0.03); ctx.strokeStyle = '#8f9aa3';
  circle(cx, cy, r * 0.42); ctx.stroke();
  // opaski spinające
  ctx.lineWidth = Math.max(0.25, r * 0.075); ctx.strokeStyle = '#262c33';
  seg(cx - r, cy, cx - r * 0.42, cy); seg(cx + r * 0.42, cy, cx + r, cy);
  circle(cx, cy, r); outline();
}

function drawBeams(x, y, L, W) {
  const n = Math.max(3, Math.round(W / 1.7));
  const bw = W / n;
  shadowOn(0.8);
  ctx.fillStyle = '#8e99a1';
  ctx.fillRect(x - L / 2, y - W / 2, L, W);
  shadowOff();
  for (let i = 0; i < n; i++) {
    const by = y - W / 2 + i * bw;
    ctx.fillStyle = i % 2 ? '#8b969e' : '#a9b3ba';
    ctx.fillRect(x - L / 2, by, L, bw);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(x - L / 2, by, L, bw * 0.26);
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.fillRect(x - L / 2, by + bw * 0.8, L, bw * 0.2);
  }
  // czoła belek i opaski
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  const cap = Math.max(0.4, L * 0.012);
  ctx.fillRect(x - L / 2, y - W / 2, cap, W); ctx.fillRect(x + L / 2 - cap, y - W / 2, cap, W);
  ctx.fillStyle = '#20262c';
  const sw = Math.max(0.6, L * 0.02);
  for (const f of [-0.33, 0, 0.33]) ctx.fillRect(x + f * L - sw / 2, y - W / 2 - 0.2, sw, W + 0.4);
  ctx.beginPath(); ctx.rect(x - L / 2, y - W / 2, L, W); outline();
}

function drawFlat(x, y, L, W, kind) {
  const x0 = x - L / 2;
  const y0 = y - W / 2;
  shadowOn();
  rr(x0, y0, L, W, 0.4);
  ctx.fillStyle = C.deck; ctx.fill();
  shadowOff();
  lightOverlay(x0, y0, L, W, 0.1, 0.22);
  if (S.cam.ppu >= 3.2) {
    ctx.lineWidth = 0.12; ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    for (let i = 2; i < L; i += 2) seg(x0 + i, y0 + 0.4, x0 + i, y0 + W - 0.4);
  }
  // kłonice wzdłuż burt
  ctx.fillStyle = C.casting;
  const posts = Math.max(2, Math.round(L / 10) + 1);
  const ps = Math.max(0.7, W * 0.045);
  for (let i = 0; i < posts; i++) {
    const qx = x0 + 0.5 + i * (L - 1 - ps) / (posts - 1);
    ctx.fillRect(qx, y0 + 0.15, ps, ps);
    ctx.fillRect(qx, y0 + W - 0.15 - ps, ps, ps);
  }
  if (kind === 'coil') {
    const d = Math.min(W - 1, L / 2 - 0.5);
    // łoża pod kręgami
    ctx.fillStyle = '#7c6a22';
    const cw = Math.max(0.5, d * 0.05);
    for (const c of [x - d / 2 - 0.3, x + d / 2 + 0.3]) for (const s of [-1, 1]) ctx.fillRect(c + s * d * 0.46 - cw / 2, y0 + W * 0.12, cw, W * 0.76);
    drawCoil(x - d / 2 - 0.3, y, d);
    drawCoil(x + d / 2 + 0.3, y, d);
  } else drawBeams(x, y, L - Math.max(1.5, L * 0.06), W - Math.max(2, W * 0.2));
  rr(x0, y0, L, W, 0.4); outline();
}

/** Nośnik stopnia `levelId` w odmianie `kind` (box | tank | hopper | coil | beam), środek (x, y). */
function drawCarrier(kind, levelId, x, y, seed = 0) {
  const lv = CARGO_LEVELS[levelId];
  const c = CARGO_LEVELS.container;
  const gx = (lv.L - lv.nx * c.L) / Math.max(1, lv.nx - 1) || 0;
  const gy = (lv.W - lv.ny * c.W) / Math.max(1, lv.ny - 1) || 0;
  if (kind === 'box') {
    for (let i = 0; i < lv.nx; i++) {
      for (let j = 0; j < lv.ny; j++) {
        const paint = PAINTS[(seed * 3 + i * 2 + j * 5 + ((i * j) % 3)) % PAINTS.length];
        drawBox(x - lv.L / 2 + c.L / 2 + i * (c.L + gx), y - lv.W / 2 + c.W / 2 + j * (c.W + gy), c.L, c.W, paint);
      }
    }
  } else if (kind === 'tank') {
    for (let j = 0; j < lv.ny; j++) {
      drawTank(x, y - lv.W / 2 + c.W / 2 + j * (c.W + gy), lv.L, c.W, TANK_SHELLS[(seed + j) % TANK_SHELLS.length], j % 2 ? '#8e3a2e' : '#2f5f8f');
    }
  } else if (kind === 'hopper') drawHopper(x, y, lv.L, lv.W, '#454e58', C.ore, seed + lv.nx, lv.nx);
  else drawFlat(x, y, lv.L, lv.W, kind);
}

/** Ucho sprzęgu na osi: płyta i pierścień, `dir` = +1 ku dziobowi, −1 ku rufie. */
function drawLug(x, y, dir) {
  const r = CARGO_COUPLER.reach;
  ctx.fillStyle = '#6a747d';
  ctx.beginPath();
  ctx.moveTo(x, y - 2.4); ctx.lineTo(x + dir * r * 0.55, y - 1.5); ctx.lineTo(x + dir * r * 0.55, y + 1.5); ctx.lineTo(x, y + 2.4); ctx.closePath();
  ctx.fill();
  circle(x + dir * r * 0.62, y, 1.55); ctx.fill(); outline();
  circle(x + dir * r * 0.62, y, 0.7); ctx.fillStyle = '#0d1014'; ctx.fill();
}

/** Rama sekcji 68 × 36 j. ze sprzęgami na osi (`lugs`: 0 — bez, 1 — oba końce). */
function drawSectionFrame(x, y, lugs = 1) {
  const { L, W } = CARGO_SECTION.outer;
  const x0 = x - L / 2;
  const y0 = y - W / 2;
  if (lugs) { drawLug(x0, y, -1); drawLug(x0 + L, y, 1); }
  shadowOn();
  rr(x0, y0, L, W, 1.2);
  ctx.fillStyle = C.frame; ctx.fill();
  shadowOff();
  lightOverlay(x0, y0, L, W, 0.16, 0.3);
  // podłużnice i poprzeczki widoczne między ładunkiem a ramą
  ctx.lineWidth = Math.max(0.2, px(0.7)); ctx.strokeStyle = 'rgba(255,255,255,0.13)';
  ctx.strokeRect(x0 + 0.55, y0 + 0.55, L - 1.1, W - 1.1);
  // odlewy naroży i uchwyty burtowe
  ctx.fillStyle = C.casting;
  const q = 2.7;
  for (const cx of [x0, x0 + L - q]) for (const cy of [y0, y0 + W - q]) { rr(cx, cy, q, q, 0.5); ctx.fill(); }
  ctx.fillStyle = '#515b64';
  for (const f of [-0.25, 0, 0.25]) for (const s of [-1, 1]) ctx.fillRect(x + f * L - 1.3, y + s * W / 2 - (s > 0 ? 1.25 : 0), 2.6, 1.25);
  if (S.cam.ppu >= 1.6) {
    // światła obrysowe: bursztyn przy dziobie, czerwień przy rufie
    for (const s of [-1, 1]) {
      ctx.fillStyle = '#ffb347'; circle(x0 + L - 0.9, y + s * (W / 2 - 4.3), 0.5); ctx.fill();
      ctx.fillStyle = '#ff4b3a'; circle(x0 + 0.9, y + s * (W / 2 - 4.3), 0.5); ctx.fill();
    }
  }
  rr(x0, y0, L, W, 1.2); outline();
}

/** Sekcja ładunkowa w ramie. */
function drawSection(kind, x, y, seed = 0, lugs = 1) {
  drawSectionFrame(x, y, lugs);
  drawCarrier(kind, 'section', x, y, seed);
}

/** Kruszarka: rama sekcji, wlot od dziobu (+x), dwa walce z zębami, zsyp w osi ku rufie. */
function drawCrusher(x, y) {
  drawSectionFrame(x, y, 1);
  const L = CARGO_SECTION.load.L;
  const W = CARGO_SECTION.load.W;
  const x0 = x - L / 2;
  const y0 = y - W / 2;
  rr(x0, y0, L, W, 0.6);
  ctx.fillStyle = '#31373e'; ctx.fill();
  lightOverlay(x0, y0, L, W, 0.1, 0.25);
  // wlot: lej zwężający się ku walcom
  ctx.beginPath();
  ctx.moveTo(x0 + L, y0 + 0.8); ctx.lineTo(x0 + L, y0 + W - 0.8); ctx.lineTo(x0 + L - 15, y0 + W - 4.2); ctx.lineTo(x0 + L - 15, y0 + 4.2); ctx.closePath();
  ctx.fillStyle = '#c9a227'; ctx.fill();
  ctx.save(); ctx.clip();
  ctx.fillStyle = '#16191d';
  for (let i = -4; i < 14; i++) {
    ctx.beginPath();
    const sx0 = x0 + L - 3.2;
    ctx.moveTo(sx0, y0 + i * 3.4); ctx.lineTo(sx0 + 3.2, y0 + i * 3.4 + 3.2); ctx.lineTo(sx0 + 3.2, y0 + i * 3.4 + 4.9); ctx.lineTo(sx0, y0 + i * 3.4 + 1.7); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  const tg = ctx.createLinearGradient(x0 + L - 14, 0, x0 + L - 4.2, 0);
  tg.addColorStop(0, '#0c0e11'); tg.addColorStop(1, '#262b31');
  ctx.fillStyle = tg;
  ctx.beginPath();
  ctx.moveTo(x0 + L - 4.2, y0 + 3); ctx.lineTo(x0 + L - 4.2, y0 + W - 3); ctx.lineTo(x0 + L - 14, y0 + W - 5.2); ctx.lineTo(x0 + L - 14, y0 + 5.2); ctx.closePath(); ctx.fill();
  // komora walców
  ctx.fillStyle = '#0f1215';
  ctx.fillRect(x0 + L - 45, y - (W - 8.6) / 2, 31, W - 8.6);
  const dl = W - 9.5;
  for (const dx of [x0 + L - 22.5, x0 + L - 35.5]) {
    const g = ctx.createLinearGradient(dx - 5.4, 0, dx + 5.4, 0);
    g.addColorStop(0, '#454e56'); g.addColorStop(0.42, '#dfe5e9'); g.addColorStop(1, '#353d44');
    rr(dx - 5.4, y - dl / 2, 10.8, dl, 1);
    ctx.fillStyle = g; ctx.fill();
    if (S.cam.ppu >= 1.5) {
      ctx.fillStyle = '#14181c';
      for (let k = 0; k < 8; k++) {
        const ty = y - dl / 2 + 1.5 + k * (dl - 3) / 7;
        ctx.fillRect(dx - 4.2 + (k % 2) * 4.2, ty - 0.75, 3.6, 1.5);
      }
    }
    rr(dx - 5.4, y - dl / 2, 10.8, dl, 1); outline();
  }
  // przekładnie na końcach walców
  for (const s of [-1, 1]) {
    rr(x0 + L - 46, y + s * (W / 2 - 2.4) - 2, 33, 4, 0.9);
    ctx.fillStyle = '#c9a227'; ctx.fill(); outline();
    if (S.cam.ppu >= 2.4) {
      ctx.fillStyle = '#3b3208';
      for (let k = 0; k < 5; k++) { circle(x0 + L - 43 + k * 6.6, y + s * (W / 2 - 2.4), 0.45); ctx.fill(); }
    }
  }
  // zsyp ku rufie
  ctx.fillStyle = '#101317';
  ctx.fillRect(x0 + 1, y - 5.2, L - 47, 10.4);
  ctx.fillStyle = '#c9a227';
  for (let k = 0; k < 3; k++) {
    const ax = x0 + 15.5 - k * 5.2;
    ctx.beginPath(); ctx.moveTo(ax, y - 3.3); ctx.lineTo(ax - 3, y); ctx.lineTo(ax, y + 3.3); ctx.lineTo(ax + 1.4, y + 3.3); ctx.lineTo(ax - 1.6, y); ctx.lineTo(ax + 1.4, y - 3.3); ctx.closePath(); ctx.fill();
  }
  // silniki z wentylatorami
  for (const s of [-1, 1]) {
    rr(x0 + 2.2, y + s * 10.6 - 4.1, 15, 8.2, 1);
    ctx.fillStyle = '#75818b'; ctx.fill(); outline();
    circle(x0 + 9.7, y + s * 10.6, 2.9); ctx.fillStyle = '#1d2329'; ctx.fill();
    circle(x0 + 9.7, y + s * 10.6, 0.9); ctx.fillStyle = '#8a959e'; ctx.fill();
  }
  rr(x0, y0, L, W, 0.6); outline();
}

/** Ciągnik sekcyjny 52 × 34 j. (propozycja): środek bryły (x, y), dziób +x. */
function drawSectionTractor(x, y) {
  const L = CARGO_SECTION_TRACTOR.body.L;
  const W = CARGO_SECTION_TRACTOR.body.W;
  const x0 = x - L / 2;
  // gondole silników po burtach
  for (const s of [-1, 1]) {
    const gy = y + s * (W / 2 - 4);
    shadowOn();
    rr(x0 + 2.5, gy - 4, 31, 8, 4);
    ctx.fillStyle = '#8d979f'; ctx.fill();
    shadowOff();
    const g = ctx.createLinearGradient(0, gy - 4, 0, gy + 4);
    g.addColorStop(0, '#8b959d'); g.addColorStop(0.4, '#f6f8f9'); g.addColorStop(1, '#6f7981');
    rr(x0 + 2.5, gy - 4, 31, 8, 4);
    ctx.fillStyle = g; ctx.fill(); outline();
    ctx.fillStyle = '#1a1f25';
    ctx.fillRect(x0 + 10, gy - 3.9, 5.2, 7.8); ctx.fillRect(x0 + 22.5, gy - 3.9, 3, 7.8);
    rr(x0 + 0.2, gy - 3, 3.4, 6, 0.8); ctx.fillStyle = '#2a3037'; ctx.fill(); outline();
    ctx.fillStyle = s < 0 ? '#ff4b3a' : '#3fe07a';
    circle(x0 + 18.5, gy + s * 3.4, 0.55); ctx.fill();
  }
  // rama i pokład
  shadowOn();
  ctx.beginPath();
  ctx.moveTo(x0 + 6.5, y - 9.4); ctx.lineTo(x0 + 33, y - 10.6); ctx.lineTo(x0 + 33, y + 10.6); ctx.lineTo(x0 + 6.5, y + 9.4); ctx.lineTo(x0 + 1.2, y + 5.2); ctx.lineTo(x0 + 1.2, y - 5.2); ctx.closePath();
  ctx.fillStyle = '#262b32'; ctx.fill();
  shadowOff();
  outline();
  ctx.lineWidth = Math.max(0.2, px(0.7)); ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  for (const s of [-1, 1]) seg(x0 + 4, y + s * 3.6, x0 + 30, y + s * 3.6);
  // zbiorniki przy kabinie
  for (const s of [-1, 1]) {
    const ty = y + s * 6.9;
    const g = ctx.createLinearGradient(0, ty - 1.9, 0, ty + 1.9);
    g.addColorStop(0, '#77818a'); g.addColorStop(0.4, '#e9edf0'); g.addColorStop(1, '#5d676f');
    rr(x0 + 17, ty - 1.9, 11, 3.8, 1.9);
    ctx.fillStyle = g; ctx.fill(); outline();
  }
  // siodło ze szczeliną
  circle(x0 + 10.5, y, 6.3);
  const sg = ctx.createRadialGradient(x0 + 9, y - 2, 1, x0 + 10.5, y, 6.3);
  sg.addColorStop(0, '#a7b1b9'); sg.addColorStop(1, '#5f6971');
  ctx.fillStyle = sg; ctx.fill(); outline();
  ctx.fillStyle = '#15191e';
  ctx.beginPath(); ctx.moveTo(x0 + 3.6, y - 2.3); ctx.lineTo(x0 + 10.5, y - 1.2); ctx.lineTo(x0 + 10.5, y + 1.2); ctx.lineTo(x0 + 3.6, y + 2.3); ctx.closePath(); ctx.fill();
  circle(x0 + 10.5, y, 2.1); ctx.fill();
  if (S.cam.ppu >= 2.4) {
    ctx.fillStyle = '#2d343b';
    for (let k = 0; k < 8; k++) { const a = Math.PI * 0.25 * k + 0.4; circle(x0 + 10.5 + Math.cos(a) * 5, y + Math.sin(a) * 5, 0.38); ctx.fill(); }
  }
  ctx.fillStyle = '#a8301f';
  for (const s of [-1, 1]) ctx.fillRect(x0 + 1.2, y + s * 6.8 - 1.3, 1.7, 2.6);
  // kabina
  shadowOn();
  rr(x0 + 27.5, y - 13.6, 21.5, 27.2, 2.6);
  ctx.fillStyle = '#1f5fa8'; ctx.fill();
  shadowOff();
  lightOverlay(x0 + 27.5, y - 13.6, 21.5, 27.2, 0.2, 0.28);
  rr(x0 + 27.5, y - 13.6, 21.5, 27.2, 2.6); outline();
  ctx.fillStyle = '#e8edf0';
  for (const s of [-1, 1]) ctx.fillRect(x0 + 28.6, y + s * 8.4 - 1.25, 11.6, 2.5);
  rr(x0 + 30.6, y - 4.4, 7.4, 8.8, 1.1); ctx.fillStyle = '#2b3743'; ctx.fill(); outline();
  // szyba
  ctx.beginPath();
  ctx.moveTo(x0 + 41.6, y - 11.2); ctx.lineTo(x0 + 47.6, y - 9.4); ctx.lineTo(x0 + 47.6, y + 9.4); ctx.lineTo(x0 + 41.6, y + 11.2); ctx.closePath();
  const wg = ctx.createLinearGradient(0, y - 11, 0, y + 11);
  wg.addColorStop(0, '#2f5d86'); wg.addColorStop(0.3, '#12283f'); wg.addColorStop(1, '#0a1522');
  ctx.fillStyle = wg; ctx.fill(); outline();
  ctx.fillStyle = '#ffb347';
  for (let k = -2; k <= 2; k++) { circle(x0 + 39.9, y + k * 2.7, 0.6); ctx.fill(); }
  // lusterka i zderzak z reflektorami
  ctx.strokeStyle = '#59636c'; ctx.lineWidth = 0.5;
  for (const s of [-1, 1]) { seg(x0 + 44, y + s * 13.4, x0 + 46.5, y + s * 16.2); ctx.fillStyle = '#39424b'; ctx.fillRect(x0 + 45.6, y + s * 16.2 - 0.9, 2.2, 1.8); }
  rr(x0 + 49, y - 12.6, 3, 25.2, 1);
  ctx.fillStyle = '#b9c2c9'; ctx.fill(); outline();
  ctx.fillStyle = '#fff4d6';
  for (const s of [-1, 1]) { ctx.fillRect(x0 + 50.6, y + s * 9.4 - 1.5, 1.2, 3); ctx.fillRect(x0 + 50.6, y + s * 5 - 1.1, 1.2, 2.2); }
}

/** Dyszel między sekcjami zestawu drogowego: od czoła sekcji (xf) do przegubu `len` j. dalej ku dziobowi. */
function drawDrawbar(xf, y, len) {
  ctx.fillStyle = '#59636c';
  ctx.beginPath();
  ctx.moveTo(xf, y - 6.5); ctx.lineTo(xf + len - 2.4, y - 1.3); ctx.lineTo(xf + len - 2.4, y + 1.3); ctx.lineTo(xf, y + 6.5); ctx.lineTo(xf, y + 4.2); ctx.lineTo(xf + len - 5.4, y); ctx.lineTo(xf, y - 4.2); ctx.closePath();
  ctx.fill(); outline();
  circle(xf + len - 1.3, y, 2.2); ctx.fill(); outline();
  circle(xf + len - 1.3, y, 0.9); ctx.fillStyle = '#0d1014'; ctx.fill();
}

function dashRect(x, y, w, h, color, fillA = 0) {
  ctx.save();
  if (fillA > 0) { ctx.fillStyle = alpha(color, fillA); ctx.fillRect(x, y, w, h); }
  ctx.lineWidth = px(1.4); ctx.strokeStyle = color; ctx.setLineDash([px(6), px(4)]);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------------------------
// Zestawy

/** Zestaw ciągnika z naczepami w linii prostej, rufa ostatniej naczepy w `tailX`. Zwraca { noseX, len }. */
function truckRig(tractorId, cargos, tailX, y) {
  const t = TRUCK_TRACTORS[tractorId];
  const n = cargos.length;
  const len = truckRigLength(tractorId, n);
  const noseX = tailX + len;
  const tx = noseX - t.body[1];
  const anchors = [];
  let ax = tx + t.hitchX - TRUCK_TRAILER.kingpinX;
  for (let i = 0; i < n; i++) { anchors.push(ax); ax += TRUCK_TRAILER.rearHitchX - TRUCK_TRAILER.kingpinX; }
  shape(() => {
    part(`tractor_${tractorId}`, tx, y);
    for (let i = 0; i < n; i++) {
      part('trailer_chassis', anchors[i], y);
      const k = cargos[i];
      if (k === 'coil' || k === 'beam') drawCarrier(k, 'module', anchors[i], y, i);
      else part(k, anchors[i], y);
    }
  });
  return { noseX, len, tailX };
}

/** Zestaw ciągnika sekcyjnego: sekcje na dyszlach. */
function sectionRig(kinds, tailX, y) {
  const n = kinds.length;
  const len = cargoSectionRigLength(n);
  const noseX = tailX + len;
  const TL = CARGO_SECTION_TRACTOR.body.L;
  const SL = CARGO_SECTION.outer.L;
  const bar = CARGO_COUPLER.towPitch - SL;
  shape(() => {
    for (let i = n - 1; i >= 0; i--) {
      const front = noseX - TL - bar - i * CARGO_COUPLER.towPitch;
      drawDrawbar(front, y, bar);
      const k = kinds[i];
      if (k === 'crusher') drawCrusher(front - SL / 2, y);
      else drawSection(k, front - SL / 2, y, i + 1, 0);
    }
    drawSectionTractor(noseX - TL / 2, y);
  });
  return { noseX, len, tailX };
}

// ---------------------------------------------------------------------------------------------------------------
// Budowa planszy

function buildZoneA() {
  const z = Z.A;
  zone(z, '1 · ŁADUNEK: KONTENER → MODUŁ → SEKCJA', '1 · ŁADUNEK', 'każdy stopień to 2 × 2 poprzedniego: 2 × dłuższy, 2 × szerszy, 4 × cięższy');
  const c = CARGO_LEVELS.container;
  const m = CARGO_LEVELS.module;
  const s = CARGO_LEVELS.section;
  const yL = z.y + 90;
  const X = [z.x + 52, z.x + 152, z.x + 276, z.x + 420, z.x + 566];
  shape(() => {
    drawCarrier('box', 'container', X[0], yL, 0);
    drawCarrier('box', 'module', X[1], yL, 1);
    drawCarrier('box', 'section', X[2], yL, 2);
    part('trailer_chassis', X[3], yL); part('cargo_std_a', X[3], yL);
    dashRect(X[4] - CARGO_SOCKET.L / 2, yL - CARGO_SOCKET.W / 2, CARGO_SOCKET.L, CARGO_SOCKET.W, C.prop, 0.07);
    drawSection('box', X[4], yL, 4);
    // strzałki „× 4”
    ctx.strokeStyle = C.faint; ctx.fillStyle = C.faint; ctx.lineWidth = px(1.5);
    for (const [a, b] of [[X[0] + c.L / 2 + 8, X[1] - m.L / 2 - 8], [X[1] + m.L / 2 + 10, X[2] - s.L / 2 - 10]]) {
      seg(a, yL, b, yL);
      ctx.beginPath(); ctx.moveTo(b + px(1), yL); ctx.lineTo(b - px(7), yL - px(4)); ctx.lineTo(b - px(7), yL + px(4)); ctx.closePath(); ctx.fill();
    }
  });
  label((X[0] + X[1]) / 2 - 4, yL, ['× 4'], { tier: 2, dy: -20, bold: false, color: C.muted, size: 12 });
  label((X[1] + X[2]) / 2 - 2, yL, ['× 4'], { tier: 2, dy: -20, bold: false, color: C.muted, size: 12 });
  label(X[4], yL - CARGO_SOCKET.W / 2, [`gniazdo ${CARGO_SOCKET.L} × ${CARGO_SOCKET.W} j.`], { tier: 2, dy: -19, bold: false, color: C.prop, size: 11.5 });
  const yT = yL + CARGO_SOCKET.W / 2 + 2;
  label(X[0], yT, ['Kontener', { t: `${num(c.tonnes)} t`, size: 17, bold: true, color: C.ink }, `${c.L} × ${c.W} j.`], { tier: 1, dy: 3, color: C.exist });
  label(X[1], yT, ['Moduł', { t: `${num(m.tonnes)} t`, size: 17, bold: true, color: C.ink }, `${Math.round(m.L)} × ${Math.round(m.W)} j.`], { tier: 1, dy: 3, color: C.exist });
  label(X[2], yT, ['Sekcja', { t: `${num(s.tonnes)} t`, size: 17, bold: true, color: C.ink }, `${Math.round(s.L)} × ${Math.round(s.W)} j.`], { tier: 1, dy: 3, color: C.prop });
  label(X[3] + 1, yT, ['Naczepa', { t: `${num(CARGO_TRAILER.tonnes)} t`, size: 17, bold: true, color: C.ink }, `rama ${CARGO_TRAILER.body.L} × ${Math.round(CARGO_TRAILER.body.W)} j.`], { tier: 1, dy: 3, color: C.exist });
  label(X[4], yT, ['Sekcja w ramie', { t: `${num(CARGO_SECTION.tonnes)} t`, size: 17, bold: true, color: C.ink }, `${CARGO_SECTION.outer.L} × ${CARGO_SECTION.outer.W} j.`], { tier: 1, dy: 3, color: C.prop });

  // tabela odmian nośnika
  const cols = [
    ['box', 'Skrzynia', 'sztuki, podzespoły', C.exist], ['tank', 'Zbiornik', 'gazy, ciecze', C.exist], ['hopper', 'Zasobnik', 'ruda, urobek, złom', C.exist],
    ['coil', 'Platforma', 'kręgi blachy', C.prop], ['beam', 'Platforma', 'belki', C.prop]
  ];
  const cx = (i) => z.x + 170 + i * 106;
  const rows = [['container', z.y + 224], ['module', z.y + 248], ['section', z.y + 288]];
  shape(() => {
    ctx.fillStyle = C.zoneLine;
    ctx.fillRect(z.x + 14, z.y + 170, z.w - 28, px(1));
    cols.forEach(([kind], i) => rows.forEach(([lv, y], r) => drawCarrier(kind, lv, cx(i), y, i + r)));
    ctx.fillRect(z.x + 14, z.y + 316, z.w - 28, px(1));
  });
  cols.forEach(([, name, note, col], i) => {
    label(cx(i), z.y + 178, [name], { tier: 1, color: col, size: 12.5 });
    label(cx(i), z.y + 178, [note], { tier: 2, dy: 20, bold: false, color: C.muted, size: 11 });
  });
  rows.forEach(([lv, y]) => label(z.x + 112, y, [`${CARGO_LEVELS[lv].label} · ${num(CARGO_LEVELS[lv].tonnes)} t`], { tier: 2, align: 'right', dy: -8, color: C.ink, size: 12 }));
  label(z.x + 16, z.y + 178, ['ODMIANY', 'NOŚNIKA'], { tier: 3, align: 'left', bold: false, color: C.faint, size: 11, subSize: 11 });

  // kruszarka
  const yK = z.y + 350;
  const xH = z.x + 56;
  const xK = xH + CARGO_COUPLER.rigidPitch;
  shape(() => { drawSection('hopper', xH, yK, 2); drawCrusher(xK, yK); });
  dimH(xH, xK, yK + CARGO_SECTION.outer.W / 2 + 6, `rozstaw ${CARGO_COUPLER.rigidPitch} j.`, { tier: 2 });
  label(xK + CARGO_SECTION.outer.L / 2 + 14, yK, ['Sekcja narzędziowa: kruszarka', `${CARGO_SECTION.outer.L} × ${CARGO_SECTION.outer.W} j. — ten sam obrys, sprzęg i gniazdo co sekcja ładunkowa`, 'kruszy skałę i podaje urobek do sekcji-zasobnika za sobą; sama nie wozi ładunku'], { tier: 1, align: 'left', dy: -25, color: C.prop });
}

function buildZoneB() {
  const z = Z.B;
  zone(z, '2 · ZESTAWY NA RINGU', '2 · ZESTAWY', 'ciągnik + naczepy (moduły) z dema ciągników · większy ciągnik + sekcje');
  const x0 = z.x + 30;
  const cap = Object.fromEntries(VAN_CLASSES.map((v) => [v.id, v.capacity]));
  const rigs = [
    ['light', ['cargo_std_a', 'cargo_tank'], z.y + 92, 'Lekki + 2 naczepy', `= prom, klasa van`],
    ['standard', ['cargo_std_b', 'cargo_hopper', 'cargo_hazmat', 'coil'], z.y + 154, 'Szosowy + 4 naczepy', '= 1 sekcja'],
    ['heavy', ['cargo_std_a', 'cargo_tank', 'beam', 'cargo_hopper', 'cargo_std_b'], z.y + 218, 'Ciężki + 5 naczep', `≈ kontenerowiec (${cap.hauler} t)`]
  ];
  for (const [id, cargos, y, name, note] of rigs) {
    const r = truckRig(id, cargos, x0, y);
    const t = cargoRigTonnes({ trailers: cargos.length });
    dimH(x0, r.noseX, y + 21, `${Math.round(r.len)} j.`, { tier: 2 });
    label(r.noseX + 16, y, [name, { t: `${num(t)} t`, size: 16, bold: true, color: C.ink }, `${Math.round(r.len)} j. · ${note}`], { tier: 1, align: 'left', dy: -27, color: C.exist });
  }
  const yS = z.y + 290;
  const r = sectionRig(['box', 'hopper', 'coil'], x0, yS);
  dimH(x0, r.noseX, yS + 24, `${Math.round(r.len)} j.`, { tier: 2 });
  label(r.noseX + 16, yS, ['Sekcyjny + 3 sekcje', { t: `${num(cargoRigTonnes({ sections: 3 }))} t`, size: 16, bold: true, color: C.ink }, `${Math.round(r.len)} j. · ≈ frachtowiec klasy bulk (${cap.bulk} t)`], { tier: 1, align: 'left', dy: -27, color: C.prop });
}

function shipRow(name, hullId, cx, cy) {
  const size = trafficHullRenderSize(hullId);
  shape(() => sprite(name, cx, cy, size.w, size.h));
  const b = HB[name];
  return { stern: cx + b.x0, bow: cx + b.x1, top: cy + b.y0, bottom: cy + b.y1, axis: cy + (b.y0 + b.y1) / 2, len: b.x1 - b.x0, beam: b.y1 - b.y0 };
}

function buildZoneC() {
  const z = Z.C;
  zone(z, '3 · STATKI Z SEKCJAMI', '3 · STATKI', 'statków nie wymieniamy: dostają sprzęg na osi albo gniazdo w kadłubie');
  const SL = CARGO_SECTION.outer.L;
  const SW = CARGO_SECTION.outer.W;
  const reach = CARGO_COUPLER.reach * 2;

  // kopacz mały: belter ciągnie sekcję
  {
    const b = HB.belter;
    const y = z.y + 96;
    const tail = z.x + 30;
    const stern = tail + SL + reach;
    const cx = stern - b.x0;
    const cy = y - (b.y0 + b.y1) / 2;
    const h = shipRow('belter', 'belter', cx, cy);
    shape(() => drawSection('hopper', tail + SL / 2, h.axis, 1));
    label(h.bow + 16, h.axis, [`Kopacz mały (belter ${Math.round(h.len)} × ${Math.round(h.beam)} j.)`, 'własne wiertła + 1 sekcja-zasobnik na sprzęgu', `${num(CARGO_LEVELS.section.tonnes)} t = jedna wyprawa górnicza ruchu v2`], { tier: 1, align: 'left', dy: -25, color: C.exist });
    dimH(tail, h.bow, h.axis + Math.max(SW, h.beam) / 2 + 6, `${Math.round(h.bow - tail)} j.`, { tier: 2 });
  }
  // kopacz duży: kombajn z kruszarką, gniazdem i sekcją na sprzęgu
  {
    const b = HB.heavy_harvester;
    const y = z.y + 210;
    const tail = z.x + 30;
    const stern = tail + SL + reach;
    const cx = stern - b.x0;
    const cy = y - (b.y0 + b.y1) / 2;
    const h = shipRow('heavy_harvester', 'heavy_harvester', cx, cy);
    const sock = { x: h.stern + h.len * 0.33, y: h.axis };
    const xCr = h.bow + reach + SL / 2;
    shape(() => {
      drawSection('hopper', tail + SL / 2, h.axis, 3);
      ctx.fillStyle = '#0a0d10';
      ctx.fillRect(sock.x - CARGO_SOCKET.L / 2, sock.y - CARGO_SOCKET.W / 2, CARGO_SOCKET.L, CARGO_SOCKET.W);
      drawSection('hopper', sock.x, sock.y, 2, 0);
      dashRect(sock.x - CARGO_SOCKET.L / 2, sock.y - CARGO_SOCKET.W / 2, CARGO_SOCKET.L, CARGO_SOCKET.W, C.prop);
      drawCrusher(xCr, h.axis);
    });
    label(xCr, h.axis - SW / 2, ['kruszarka'], { tier: 2, dy: -20, color: C.prop, size: 12 });
    label(sock.x, sock.y - CARGO_SOCKET.W / 2, [`gniazdo ${CARGO_SOCKET.L} × ${CARGO_SOCKET.W} j.`], { tier: 2, dy: -24, color: C.prop, size: 12, plate: true });
    label(tail + SL / 2, h.axis - SW / 2, ['na sprzęgu'], { tier: 2, dy: -20, color: C.prop, size: 12 });
    dimH(tail, xCr + SL / 2, h.bottom + 5, `${Math.round(xCr + SL / 2 - tail)} j.`, { tier: 2 });
    label(z.x + 30, h.bottom + 5, [`Kopacz duży (kombajn ${Math.round(h.len)} × ${Math.round(h.beam)} j.) · ${num(2 * CARGO_LEVELS.section.tonnes)} t`, 'kruszarka → sekcja w gnieździe → sekcja na sprzęgu; pełne odstawia przy hucie, bierze puste'], { tier: 1, align: 'left', dy: 22, color: C.exist });
  }
  // kontenerowiec dla odniesienia: pokład w jednostkach standardu
  {
    const b = HB.container_ship;
    const y = z.y + 388;
    const cx = z.x + 30 - b.x0;
    const cy = y - (b.y0 + b.y1) / 2;
    const h = shipRow('container_ship', 'container_ship', cx, cy);
    const lay = CARGO_HOLD_LAYOUTS.container_ship;
    const k = lay.renderLength / lay.png.w;
    const dx0 = cx + (lay.grid.x[0] - lay.png.w / 2) * k;
    const dx1 = cx + (lay.grid.x[lay.grid.x.length - 1] + lay.grid.w - lay.png.w / 2) * k;
    const dy0 = cy + (lay.grid.y[0] - lay.png.h / 2) * k;
    const dy1 = cy + (lay.grid.y[lay.grid.y.length - 1] + lay.grid.h - lay.png.h / 2) * k;
    const cap = VAN_CLASSES.find((v) => v.id === 'hauler').capacity;
    const br = cargoBreakdown(cap);
    shape(() => {
      const yc = (dy0 + dy1) / 2;
      ctx.lineWidth = px(1.6); ctx.strokeStyle = C.prop; ctx.fillStyle = alpha(C.prop, 0.22);
      const boxes = [[dx0 + 3, SL, SW], [dx0 + 3 + SL + 5, CARGO_LEVELS.module.L, CARGO_LEVELS.module.W]];
      for (const [bx, L, W] of boxes) { ctx.fillRect(bx, yc - W / 2, L, W); ctx.strokeRect(bx, yc - W / 2, L, W); }
      dashRect(dx0, dy0, dx1 - dx0, dy1 - dy0, C.prop);
    });
    label(h.bow + 14, h.axis, [`Kontenerowiec ${Math.round(h.len)} × ${Math.round(h.beam)} j. · ${cap} t`, `pokład ${Math.round(dx1 - dx0)} × ${Math.round(dy1 - dy0)} j. mieści w standardzie`, `${br.sections} sekcję + ${br.modules} moduł + ${br.containers} kontener`], { tier: 1, align: 'left', dy: -25, color: C.exist });
    dimH(h.stern, h.bow, h.bottom + 5, `${Math.round(h.len)} j.`, { tier: 2 });
    const yc = (dy0 + dy1) / 2;
    label(dx0 + 3 + SL / 2, yc, ['sekcja'], { tier: 3, dy: -8, color: C.prop, size: 11.5, plate: true });
    label(dx0 + 3 + SL + 5 + CARGO_LEVELS.module.L / 2, yc, ['moduł'], { tier: 3, dy: -8, color: C.prop, size: 11.5, plate: true });
  }
}

function buildZoneE() {
  const z = Z.E;
  zone(z, '4 · DZIŚ W DEMIE HUTY — POZA STANDARDEM', '4 · DZIŚ W HUCIE', 'huta jest narysowana ok. 6 × większa niż kontener gry — do rozstrzygnięcia');
  const H = HUTA_DZIS;
  const x0 = z.x + 46;
  const yT = z.y + 116;
  const tcx = x0 + H.trailer.L / 2;
  const ccx = tcx + H.cabAhead;
  const total = ccx + H.cab.L / 2 - x0;
  shape(() => {
    ctx.save();
    ctx.lineWidth = px(1.5); ctx.strokeStyle = C.ghost; ctx.fillStyle = alpha(C.ghost, 0.07); ctx.setLineDash([px(6), px(4)]);
    ctx.fillRect(x0, yT - H.trailer.W / 2, H.trailer.L, H.trailer.W); ctx.strokeRect(x0, yT - H.trailer.W / 2, H.trailer.L, H.trailer.W);
    ctx.fillRect(ccx - H.cab.L / 2, yT - H.cab.W / 2, H.cab.L, H.cab.W); ctx.strokeRect(ccx - H.cab.L / 2, yT - H.cab.W / 2, H.cab.L, H.cab.W);
    ctx.fillRect(x0 + H.trailer.L, yT - 14, ccx - H.cab.L / 2 - x0 - H.trailer.L, 28);
    for (let i = 0; i < 3; i++) {
      circle(x0 + 58 + i * 110, yT, H.coil / 2 - 8); ctx.fill(); ctx.stroke();
      circle(x0 + 58 + i * 110, yT, H.coil * 0.18); ctx.stroke();
    }
    ctx.restore();
  });
  dimH(x0, x0 + total, yT + H.trailer.W / 2 + 6, `${Math.round(total)} j.`, { tier: 1, color: C.ghost });
  dimV(x0 - 8, yT - H.trailer.W / 2, yT + H.trailer.W / 2, `${H.trailer.W} j.`, { tier: 2, color: C.ghost });
  const mp = cargoMaxPiece('section');
  label(x0, yT + H.trailer.W / 2 + 6, [`Ciężarówka z dzielnicy huty: ${Math.round(total)} × ${H.trailer.W} j., kręgi ø ${H.coil} j.`, `dłuższa niż kontenerowiec; na sekcję standardu wchodzi sztuka do ${mp.L} × ${mp.W} j.`], { tier: 1, align: 'left', dy: 22, color: C.ghost });

  // ładownia statku z dema rudy
  const hx = x0;
  const hy = z.y + 236;
  const SL = CARGO_SECTION.outer.L;
  const SW = CARGO_SECTION.outer.W;
  const br = cargoBreakdown(H.hold.tonnes);
  const share = Math.round(100 * br.sections * SL * SW / (H.hold.L * H.hold.W));
  shape(() => {
    ctx.save();
    ctx.fillStyle = alpha(C.ghost, 0.06); ctx.fillRect(hx, hy, H.hold.L, H.hold.W);
    ctx.lineWidth = px(1); ctx.strokeStyle = alpha(C.ghost, 0.35);
    for (let i = 1; i < H.hold.fieldsL; i++) seg(hx + i * H.hold.L / H.hold.fieldsL, hy, hx + i * H.hold.L / H.hold.fieldsL, hy + H.hold.W);
    seg(hx, hy + H.hold.W / 2, hx + H.hold.L, hy + H.hold.W / 2);
    ctx.lineWidth = px(1.5); ctx.strokeStyle = C.ghost; ctx.setLineDash([px(6), px(4)]);
    ctx.strokeRect(hx, hy, H.hold.L, H.hold.W);
    ctx.restore();
    for (let i = 0; i < br.sections; i++) drawSection('hopper', hx + 16 + SL / 2 + i * (SL + 8), hy + H.hold.W - 14 - SW / 2, i, 0);
  });
  dimH(hx, hx + H.hold.L, hy + H.hold.W + 6, `${H.hold.L} j.`, { tier: 2, color: C.ghost });
  dimV(hx - 8, hy, hy + H.hold.W, `${H.hold.W} j.`, { tier: 2, color: C.ghost });
  label(hx + 12, hy + 10, [`Ładownia statku z dema rudy: ${H.hold.L} × ${H.hold.W} j. · ${H.hold.tonnes} t`, `te same ${H.hold.tonnes} t w standardzie = ${br.sections} sekcje — zajmują ${share}% tego pola`], { tier: 1, align: 'left', color: C.ghost });
  label(hx + 16, hy + H.hold.W - 14 - SW, [`${br.sections} sekcje-zasobniki · ${H.hold.tonnes} t`], { tier: 2, align: 'left', dy: -20, color: C.prop, size: 12 });
}

function buildZoneD() {
  const z = Z.D;
  const A = CARGO_BAY_HULLS.atlas;
  const k = cargoBayScale(A);
  const w = A.renderLength;
  const h = w * A.png.h / A.png.w;
  const b = HB.atlas;
  const cx = z.x + 50 - b.x0;
  const cy = z.y + 70 - b.y0;
  zone(z, '5 · ODNIESIENIE: ATLAS', '5 · ATLAS', `okręt gracza — sylwetka ${Math.round(b.x1 - b.x0)} × ${Math.round(b.y1 - b.y0)} j., ładowność ${A.cargoToday} t`);
  const bay = A.bays[0];
  const lw = bay.w * k;
  const lh = bay.h * k;
  const lx = cx + bay.x * k - lw / 2;
  const ly = cy + bay.y * k - lh / 2;
  const fit = cargoSectionsInArea(lw, lh);
  const br = cargoBreakdown(A.cargoToday);
  const gx = lx + (lw - fit.nx * CARGO_SOCKET.L) / 2;
  const gy = ly + (lh - fit.ny * CARGO_SOCKET.W) / 2;
  shape(() => {
    sprite('atlas', cx, cy, w, h, false);
    ctx.fillStyle = 'rgba(6,9,12,0.8)'; ctx.fillRect(lx, ly, lw, lh);
    ctx.lineWidth = px(1); ctx.strokeStyle = alpha(C.prop, 0.3);
    for (let i = 0; i < fit.nx; i++) for (let j = 0; j < fit.ny; j++) ctx.strokeRect(gx + i * CARGO_SOCKET.L, gy + j * CARGO_SOCKET.W, CARGO_SOCKET.L, CARGO_SOCKET.W);
    const cell = (i, j) => [gx + (i + 0.5) * CARGO_SOCKET.L, gy + (j + 0.5) * CARGO_SOCKET.W];
    const kinds = ['box', 'hopper', 'coil'];
    for (let n = 0; n < br.sections; n++) { const [qx, qy] = cell(0, n); drawSection(kinds[n % 3], qx, qy, n + 1, 0); }
    const [mx, my] = cell(0, br.sections);
    if (br.modules) drawCarrier('box', 'module', mx - CARGO_SOCKET.L / 2 + 4 + CARGO_LEVELS.module.L / 2, my, 5);
    if (br.containers) drawCarrier('box', 'container', mx - CARGO_SOCKET.L / 2 + 4 + CARGO_LEVELS.module.L + 6 + CARGO_LEVELS.container.L / 2, my, 6);
    dashRect(lx, ly, lw, lh, C.prop);
  });
  label(lx + lw / 2, ly, [`Luk ${Math.round(lw)} × ${Math.round(lh)} j. — mieści ${fit.count} sekcje w jednej warstwie`, `${A.cargoToday} t Atlasa = ${br.sections} sekcje + ${br.modules} moduł + ${br.containers} kontener (zajęty róg luku)`], { tier: 1, dy: -50, color: C.prop, plate: true });
  const hullBottom = cy + b.y1;
  dimH(cx + b.x0, cx + b.x1, hullBottom + 10, `${Math.round(b.x1 - b.x0)} j.`, { tier: 0 });
  dimV(cx + b.x0 - 16, cy + b.y0, cy + b.y1, `${Math.round(b.y1 - b.y0)} j.`, { tier: 1 });

  // pod kadłubem, dla skali: zestawy i statki z pól 2 i 3
  const yR = hullBottom + 84;
  let x = z.x + 70;
  const r1 = truckRig('heavy', ['cargo_std_a', 'cargo_tank', 'beam', 'cargo_hopper', 'cargo_std_b'], x, yR);
  label((x + r1.noseX) / 2, yR + 26, ['Ciężki + 5 naczep', `${Math.round(r1.len)} j. · 150 t`], { tier: 1, color: C.exist });
  x = r1.noseX + 80;
  const r2 = sectionRig(['box', 'hopper', 'coil'], x, yR);
  label((x + r2.noseX) / 2, yR + 26, ['Sekcyjny + 3 sekcje', `${Math.round(r2.len)} j. · 360 t`], { tier: 1, color: C.prop });
  x = r2.noseX + 80;
  for (const [name, text, note] of [['container_ship', 'Kontenerowiec', '160 t'], ['heavy_harvester', 'Kombajn górniczy', '2 sekcje w standardzie']]) {
    const hb = HB[name];
    const hs = shipRow(name, name, x - hb.x0, yR - (hb.y0 + hb.y1) / 2);
    label((hs.stern + hs.bow) / 2, hs.bottom + 6, [text, `${Math.round(hs.len)} j. · ${note}`], { tier: 1, color: C.exist });
    x = hs.bow + 80;
  }
  {
    const hb = HB.belter;
    const hs = shipRow('belter', 'belter', x - hb.x0, yR - (hb.y0 + hb.y1) / 2);
    label((hs.stern + hs.bow) / 2, yR + 26, ['Belter', `${Math.round(hs.len)} j.`], { tier: 1, color: C.exist });
  }
}

function build() {
  SHAPES.length = 0; LABELS.length = 0; DIMS.length = 0;
  buildZoneA(); buildZoneB(); buildZoneC(); buildZoneE(); buildZoneD();
}

// ---------------------------------------------------------------------------------------------------------------
// Rysunek

function font(size, bold) { return `${bold ? 600 : 400} ${Math.round(size * S.ui * 10) / 10}px "Segoe UI", system-ui, sans-serif`; }

function drawText(text, x, y, color, align) {
  ctx.textAlign = align;
  ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(8,11,15,0.86)'; ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function overlaps(box, placed) {
  for (const p of placed) if (box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1]) return true;
  return false;
}

function drawDims(placed) {
  let n = 0;
  ctx.textBaseline = 'top';
  for (const d of DIMS) {
    if (S.cam.ppu < TIER[d.tier]) continue;
    const ax = Math.round(sx(d.x0)) + 0.5;
    const ay = Math.round(sy(d.y0)) + 0.5;
    const bx = Math.round(sx(d.x1)) + 0.5;
    const by = Math.round(sy(d.y1)) + 0.5;
    const len = Math.abs(bx - ax) + Math.abs(by - ay);
    if (len < 44) continue;
    ctx.strokeStyle = d.color; ctx.lineWidth = 1;
    seg(ax, ay, bx, by);
    if (d.vertical) { seg(ax - 4, ay, ax + 4, ay); seg(bx - 4, by, bx + 4, by); } else { seg(ax, ay - 4, ax, ay + 4); seg(bx, by - 4, bx, by + 4); }
    ctx.font = font(11.5, false);
    const tw = ctx.measureText(d.text).width;
    const th = 12 * S.ui;
    let tx, ty, align;
    if (d.vertical) { align = d.right ? 'left' : 'right'; tx = ax + (d.right ? 8 : -8); ty = (ay + by) / 2 - th / 2; } else { align = 'center'; tx = (ax + bx) / 2; ty = d.above ? ay - th - 5 : ay + 5; }
    const x0 = align === 'center' ? tx - tw / 2 : align === 'left' ? tx : tx - tw;
    const box = [x0 - 3, ty - 2, x0 + tw + 3, ty + th + 2];
    if (overlaps(box, placed)) continue;
    placed.push(box);
    drawText(d.text, tx, ty, d.color, align);
    n++;
  }
  return n;
}

function drawLabels(placed) {
  let n = 0;
  ctx.textBaseline = 'top';
  const order = LABELS.map((l, i) => i).sort((a, b) => (LABELS[b].keep - LABELS[a].keep) || (LABELS[a].tier - LABELS[b].tier) || (a - b));
  for (const i of order) {
    const l = LABELS[i];
    if (S.cam.ppu < TIER[l.tier]) continue;
    const x = sx(l.x) + l.dx * S.ui;
    let y = sy(l.y) + l.dy * S.ui;
    let w = 0;
    let h = 0;
    let lines = l.lines;
    if (l.fitW) {
      ctx.font = font(l.size, l.bold);
      if (ctx.measureText(lines[0].t).width > l.fitW * S.cam.ppu) {
        if (!l.alt) continue;
        lines = [{ t: l.alt }];
      }
    }
    const rows = lines.map((q, k) => {
      const size = q.size || (k === 0 ? l.size : l.subSize);
      const bold = q.bold !== undefined ? q.bold : (k === 0 && l.bold);
      ctx.font = font(size, bold);
      const tw = ctx.measureText(q.t).width;
      w = Math.max(w, tw);
      const row = { text: q.t, size, bold, color: q.color || (k === 0 ? l.color : l.sub), y: h };
      h += size * S.ui * 1.3;
      return row;
    });
    const x0 = l.align === 'center' ? x - w / 2 : l.align === 'left' ? x : x - w;
    if (x0 + w < -20 || x0 > S.W + 20 || y + h < -20 || y > S.H + 20) continue;
    const box = [x0 - 4, y - 2, x0 + w + 4, y + h];
    if (!l.keep && overlaps(box, placed)) continue;
    placed.push(box);
    if (l.plate) {
      ctx.beginPath(); ctx.roundRect(x0 - 7, y - 5, w + 14, h + 7, 4);
      ctx.fillStyle = 'rgba(8,11,15,0.84)'; ctx.fill();
    }
    for (const r of rows) {
      ctx.font = font(r.size, r.bold);
      drawText(r.text, x, y + r.y, r.color, l.align);
    }
    n++;
  }
  return n;
}

/** Stały pas u góry ekranu: tytuł, legenda i podziałka dla bieżącego powiększenia. */
function drawHud() {
  const u = S.ui;
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(8,11,15,0.93)';
  ctx.fillRect(0, 0, S.W, S.top);
  ctx.fillStyle = C.zoneLine;
  ctx.fillRect(0, S.top - 1, S.W, 1);
  ctx.textAlign = 'left';
  ctx.font = font(21, true);
  ctx.fillStyle = C.ink;
  ctx.fillText('STANDARD ŁADUNKU', 20, 10 * u);
  const tw = ctx.measureText('STANDARD ŁADUNKU').width;
  ctx.font = font(12.5, false);
  ctx.fillStyle = C.muted;
  const subText = 'materiał wstępny · wymiary i tony robocze, do przeliczenia po wyrobach zakładów · wszystko w jednej skali (j. — jednostka świata gry)';
  ctx.fillText(ctx.measureText(subText).width < S.W - 60 ? subText : 'materiał wstępny · wymiary i tony robocze', 20, 38 * u);

  // podziałka: okrągła długość, która ma na ekranie co najmniej 90 px
  let bar = 100;
  for (const v of [5, 10, 20, 50, 100, 200, 500, 1000, 2000]) { bar = v; if (v * S.cam.ppu >= 90) break; }
  const bw = bar * S.cam.ppu;
  const bx = S.W - 24 - bw;
  const by = 36 * u;
  ctx.fillStyle = C.ink;
  ctx.fillRect(bx, by, bw, 2);
  ctx.fillRect(bx, by - 6, 2, 8); ctx.fillRect(bx + bw - 2, by - 6, 2, 8); ctx.fillRect(bx + bw / 2 - 1, by - 4, 2, 6);
  ctx.font = font(12, false); ctx.fillStyle = C.muted; ctx.textAlign = 'right';
  ctx.fillText(`${bar} j.`, bx + bw, by - 24 * u);
  ctx.textAlign = 'left';
  ctx.fillText('0', bx, by - 24 * u);

  // legenda: w wierszu tytułu, między tytułem a podziałką (w wąskim oknie jej nie ma)
  const items = [[C.exist, 'istnieje w grze / demach', false], [C.prop, 'propozycja standardu', false], [C.ghost, 'dziś w demie huty — poza standardem', true]];
  ctx.font = font(12.5, false);
  const sw = 34 * u;
  const widths = items.map(([, t]) => sw + 10 + ctx.measureText(t).width);
  const total = widths.reduce((a, b) => a + b, 0) + 28 * (items.length - 1);
  const left = 20 + tw + 40;
  const right = bx - 40;
  if (right - left < total) return;
  let x = Math.max(left, Math.min(right - total, S.W * 0.4));
  const y = 13 * u;
  items.forEach(([col, text, dashed], i) => {
    ctx.save();
    ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.fillStyle = alpha(col, 0.14);
    if (dashed) ctx.setLineDash([6, 4]);
    ctx.fillRect(x, y, sw, 17 * u); ctx.strokeRect(x + 0.5, y + 0.5, sw, 17 * u);
    ctx.restore();
    ctx.fillStyle = col;
    ctx.fillText(text, x + sw + 10, y + 1 * u);
    x += widths[i] + 28;
  });
}

function draw() {
  const k = S.cam.ppu * S.dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(k, 0, 0, k, (S.W / 2 - S.cam.x * S.cam.ppu) * S.dpr, (S.H / 2 - S.cam.y * S.cam.ppu) * S.dpr);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  for (const fn of SHAPES) fn();
  ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
  const placed = [];
  placed.push([0, 0, S.W, S.top]);
  S.drawn.labels = drawLabels(placed);
  S.drawn.dims = drawDims(placed);
  drawHud();
}

// ---------------------------------------------------------------------------------------------------------------
// Kamera i wejście

function fitRect(r, pad = 18) {
  const bottom = SHOT ? 0 : 44;
  const ppu = Math.min((S.W - 2 * pad) / r.w, (S.H - S.top - bottom - 2 * pad) / r.h);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 - (S.top - bottom) / 2 / ppu, ppu };
}

function setView(i, instant = false) {
  S.view = Math.max(0, Math.min(VIEWS.length - 1, i | 0));
  const t = fitRect(VIEWS[S.view].rect);
  if (instant || SHOT) { S.cam = t; S.to = null; } else S.to = t;
  S.dirty = true;
  for (const b of document.querySelectorAll('#bar button')) b.classList.toggle('on', +b.dataset.view === S.view);
}

function resize() {
  S.dpr = Math.min(2, window.devicePixelRatio || 1);
  S.W = window.innerWidth;
  S.H = window.innerHeight;
  S.ui = Math.max(1, Math.min(1.3, Math.min(S.W / 1900, S.H / 950)));
  S.top = Math.round(64 * S.ui);
  canvas.width = Math.round(S.W * S.dpr);
  canvas.height = Math.round(S.H * S.dpr);
  setView(S.view, true);
}

function frame() {
  if (S.to) {
    const a = 0.2;
    S.cam.x += (S.to.x - S.cam.x) * a;
    S.cam.y += (S.to.y - S.cam.y) * a;
    S.cam.ppu *= Math.pow(S.to.ppu / S.cam.ppu, a);
    if (Math.abs(S.to.ppu / S.cam.ppu - 1) < 0.002 && Math.abs(S.to.x - S.cam.x) * S.cam.ppu < 0.5 && Math.abs(S.to.y - S.cam.y) * S.cam.ppu < 0.5) { S.cam = S.to; S.to = null; }
    S.dirty = true;
  }
  if (S.dirty) { S.dirty = false; try { draw(); } catch (err) { fail(err && err.stack ? err.stack : err); } }
  requestAnimationFrame(frame);
}

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const f = Math.exp(-e.deltaY * 0.0014);
  const ppu = Math.max(0.12, Math.min(40, S.cam.ppu * f));
  const wx = S.cam.x + (e.clientX - S.W / 2) / S.cam.ppu;
  const wy = S.cam.y + (e.clientY - S.H / 2) / S.cam.ppu;
  S.cam = { x: wx - (e.clientX - S.W / 2) / ppu, y: wy - (e.clientY - S.H / 2) / ppu, ppu };
  S.to = null; S.dirty = true;
}, { passive: false });
canvas.addEventListener('pointerdown', (e) => { S.drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); canvas.classList.add('drag'); });
canvas.addEventListener('pointermove', (e) => {
  if (!S.drag) return;
  S.cam.x -= (e.clientX - S.drag.x) / S.cam.ppu;
  S.cam.y -= (e.clientY - S.drag.y) / S.cam.ppu;
  S.drag = { x: e.clientX, y: e.clientY };
  S.to = null; S.dirty = true;
});
const endDrag = () => { S.drag = null; canvas.classList.remove('drag'); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('dblclick', () => setView(0));
window.addEventListener('keydown', (e) => {
  const i = VIEWS.findIndex((v) => v.key === e.key);
  if (i >= 0) setView(i);
  else if (e.key === 'Home' || e.key === 'Escape') setView(0);
});
window.addEventListener('resize', resize);

function buildBar() {
  const bar = document.getElementById('bar');
  VIEWS.forEach((v, i) => {
    const b = document.createElement('button');
    b.textContent = v.name;
    b.dataset.view = String(i);
    b.addEventListener('click', () => setView(i));
    bar.appendChild(b);
  });
  const hint = document.createElement('span');
  hint.className = 'hint';
  hint.textContent = 'kółko — zoom · przeciągnij — przesuw · 0–5 — widoki';
  bar.appendChild(hint);
}

// ---------------------------------------------------------------------------------------------------------------
// Start

async function start() {
  buildBar();
  const jobs = [];
  for (const [name, url] of Object.entries(TRUCK_SPRITE_PNG)) jobs.push(loadImage(name, url));
  for (const id of ['belter', 'heavy_harvester', 'container_ship']) jobs.push(loadImage(id, TRAFFIC_HULLS[id].sprite));
  jobs.push(loadImage('atlas', new URL('../assets/capital_ship_rect_v1.png', import.meta.url).href));
  await Promise.all(jobs);
  for (const id of ['belter', 'heavy_harvester', 'container_ship']) {
    const s = trafficHullRenderSize(id);
    HB[id] = alphaBounds(id, s.w, s.h);
  }
  const A = CARGO_BAY_HULLS.atlas;
  HB.atlas = alphaBounds('atlas', A.renderLength, A.renderLength * A.png.h / A.png.w);
  build();
  resize();
  draw();
  S.dirty = false;
  requestAnimationFrame(frame);
  api.views = () => VIEWS.map((v) => v.id);
  api.rects = () => VIEWS.map((v) => ({ id: v.id, w: v.rect.w, h: v.rect.h }));
  api.view = (i) => { setView(i, true); draw(); S.dirty = false; return VIEWS[S.view].id; };
  api.stats = () => ({
    view: VIEWS[S.view].id, ppu: +S.cam.ppu.toFixed(3), ui: +S.ui.toFixed(2), size: [S.W, S.H], shapes: SHAPES.length, labels: LABELS.length,
    labelsDrawn: S.drawn.labels, dims: DIMS.length, dimsDrawn: S.drawn.dims, images: Object.keys(IMG).length,
    hulls: Object.fromEntries(Object.entries(HB).map(([id, b]) => [id, { len: +(b.x1 - b.x0).toFixed(1), beam: +(b.y1 - b.y0).toFixed(1) }])),
    tonnesPerContainer: CARGO_TONNES_PER_CONTAINER, errors: api.errors.slice()
  });
  api.ready = true;
}

start().catch((err) => fail(err && err.stack ? err.stack : err));
