// dema/render-worker-proto.js — prototyp RW-02 (docs/PLAN-render-worker.md § 3.8, § 4): wątek główny.
//
// Symulacja jak w pętli gry (`loop()` w index.html): stały krok 120 Hz, klatka obcięta do 33 ms, najwyżej 10 kroków,
// każdy krok zajmuje CPU na S ms (sztuczny koszt fizyki). Kamera jedzie za flotą po krzywej Lissajous (do ~1500 j/s
// przy zoomie 0,21 — ~5 px na klatkę przy 60 Hz) ze wstrząsem w px ekranu (16 px, 11–12 Hz, serie co 1,7 s — jak
// cameraRig.js). Nakładka 2D: wieżyczki w gniazdach kadłubów 3D (atlas 64 kątów, drawImage z prostokątem źródła —
// jak atlasy Turret2D), klamry zaznaczenia, HUD, numer klatki migawki (kod paskowy w wierszu 14–25 px + napis).
// `?core3d=1` — zamiast prototypu próba prawdziwego Core3D w workerze (raport w window.__rw.core3d).
//
// Warianty (przełączane w biegu, bez przeładowania — ten sam stan GPU i tło maszyny dla wszystkich):
//   0   — bez workera, jak dziś: scena na wątku głównym (urządzenie WebGPU strony), drawImage kanwy WebGPU na kanwę 2D
//         i nakładki w tym samym zadaniu; koszt aktualizacji modułów 3D (D) też na wątku głównym;
//   A   — kanwa workera w DOM (transferControlToOffscreen) pod przezroczystą kanwą 2D z nakładkami bieżącego stanu;
//   B1  — bitmapa z workera (transferToImageBitmap → postMessage), przy przyjściu: transferFromImageBitmap
//         i nakładki z BIEŻĄCEGO stanu gry;
//   B2  — bitmapa klatki k + buforowana warstwa nakładek tej samej klatki k (OffscreenCanvas 2D →
//         transferToImageBitmap zaraz po migawce, pierścień po k; przy przyjściu: dwa transferFromImageBitmap);
//   B2p — B2 z przeciwciśnieniem: nowa migawka (i warstwa nakładek) dopiero, gdy worker odebrał poprzednią;
//   B2c — B2 z pierścieniem kanw 2D w DOM zamiast bitmap: nakładka k rysowana wprost do ukrytej kanwy, przy przyjściu
//         klatki k — transferFromImageBitmap 3D i przełączenie widoczności kanw (bez transferToImageBitmap nakładek);
//         kanwa do nadpisania po kolei (pierścień `kanwy`, domyślnie 6);
//   B2cr — B2c z regułą ochrony kanw: nietykalne są kanwa pokazana, kanwy klatek odebranych przez worker, a jeszcze
//         nie złożonych (worker zapisuje 4 ostatnio odebrane k w RET — bitmapa może czekać w kolejce wiadomości; migawek
//         pominiętych przez workera nie chronimy) i kanwa ostatnio opublikowanej migawki (worker może ją właśnie brać);
//         nowa nakładka do najstarszej z pozostałych. Domyślnie 5 kanw (`kanwyR`);
//   B2cp — B2cr z przeciwciśnieniem B2p: migawka i nakładka tylko, gdy worker odebrał poprzednią (nakładka raz na
//         klatkę 3D — mniej rasteryzacji kanw 2D w procesie GPU, starsza migawka przy odbiorze); 5 kanw (`kanwyP`);
//   B3  — nakładka k jako ImageBitmap do workera, złożenie na GPU po poście (copyExternalImageToTexture), kanwa
//         workera w DOM.
// Migawka: SharedArrayBuffer, potrójny bufor na Atomics.exchange (§ 3.2), blok węzłów jak NODES gry (koszt kopii).
// Dziennik (czasy `performance.timeOrigin + now()` po obu stronach, od wspólnej bazy) i podsumowanie okna pomiaru:
// window.__rw (skrypt scripts/webgpu/render-worker-proto.mjs).
import {
  Proto3D, SNAP, SHIP_F, TB, RET, WREC, BARCODE, HARDPOINTS, hardpointCount, snapPageDoubles, retBytes, makeClock, burn
} from './render-worker-proto.worker.js';

const params = new URLSearchParams(location.search);
const num = (key, def) => (params.get(key) != null && params.get(key) !== '' ? Number(params.get(key)) : def);
const W = Math.max(64, Math.round(innerWidth));
const H = Math.max(64, Math.round(innerHeight));
const N = num('n', 600);
const PARTIE = num('partie', 64); // partie kadłubów (rysunki) — stroi koszt CPU renderu
const GPU_ITERS = num('gpu', 40); // oktawy szumu tła — stroi koszt GPU (gra w bitwie: ~1,6 ms GPU na klatkę)
const NODES = num('wezly', 40000);
let HZ = num('hz', 240);
// diagnostyka: osobny limit pętli wątku głównego / workera, nakładki bez wieżyczek (tylko HUD i numer klatki)
let HZ_MAIN = num('hzMain', NaN);
let HZ_WORKER = num('hzWorker', NaN);
const OV_FULL = num('nakladki', 1) !== 0;
const hzMain = () => (Number.isFinite(HZ_MAIN) ? HZ_MAIN : HZ);
// w trybie 'raf' (Electron: prawdziwy vsync) worker bez slotów — jego rAF i tak idzie z odświeżaniem ekranu
const hzWorker = () => (Number.isFinite(HZ_WORKER) ? HZ_WORKER : (params.get('petla') === 'raf' ? 0 : HZ));
let S = num('S', 2.5);
let D = num('D', 8);
const ZOOM = num('zoom', 0.21) * H / 1080;
const PX = H / 1080; // skala px (4K = 2× 1080p: ten sam kadr)
const PHYS_DT = 1 / 120;
const VARIANTS = ['0', 'A', 'B1', 'B2', 'B2p', 'B2c', 'B2cr', 'B2cp', 'B3'];
const IS_B2C = (v) => v === 'B2c' || v === 'B2cr' || v === 'B2cp';
const IS_B = (v) => v === 'B1' || v === 'B2' || v === 'B2p' || IS_B2C(v);
if (params.get('shot') === '1') document.body.classList.add('shot');

const now = makeClock(performance.timeOrigin);
const $ = (id) => document.getElementById(id);
const errors = [];
function reportError(text) {
  errors.push(String(text));
  const el = $('errors');
  if (el) { el.style.display = 'block'; el.textContent += `${text}\n`; }
  console.error(text);
}
addEventListener('error', (e) => reportError(`JS: ${e.message} @ ${e.filename}:${e.lineno}`));
addEventListener('unhandledrejection', (e) => reportError(`Promise: ${e.reason?.stack || e.reason}`));

// ── Kanwy ──────────────────────────────────────────────────────────────────────────────────────────────────────
const canvases = {};
for (const id of ['c0', 'cA', 'cB', 'ov', 'ovB']) {
  const c = $(id);
  c.width = W;
  c.height = H;
  canvases[id] = c;
}
const ctxOv = canvases.ov.getContext('2d');
const bctx3d = canvases.cB.getContext('bitmaprenderer');
const bctxOv = canvases.ovB.getContext('bitmaprenderer');
const ovOff = new OffscreenCanvas(W, H); // warstwa buforowana B2 / B3
// B2c: pierścień kanw 2D w DOM (ukryte; pokazana ta z nakładką klatki właśnie złożonej)
const RING_DOM = Math.max(2, num('kanwy', 6));
const RING_R = Math.max(3, num('kanwyR', 5));
const RING_P = Math.max(3, num('kanwyP', 5));
const RING_ALL = Math.max(RING_DOM, RING_R, RING_P);
const ringCanvases = [];
const ringCtx = [];
const ringK = new Float64Array(RING_ALL).fill(-1);
for (let i = 0; i < RING_ALL; i++) {
  const c = document.createElement('canvas');
  c.id = `ovR${i}`;
  c.width = W;
  c.height = H;
  c.style.zIndex = '2';
  document.body.insertBefore(c, $('panel'));
  ringCanvases.push(c);
  ringCtx.push(c.getContext('2d'));
}
let ringShown = -1;
let ringNext = 0;
let ringGuardMax = 0; // najwięcej kanw chronionych przy jednym przydziale (B2cr, B2cp)
let ringFull = 0;     // przydziały bez wolnej kanwy
let lastComposedK = -1; // k ostatniej złożonej klatki 3D (B*)
const ctxOff = ovOff.getContext('2d');

// ── Symulacja ──────────────────────────────────────────────────────────────────────────────────────────────────
const SH = SNAP.SHIP;
const ships = new Float64Array(N * SH);
const shipP = new Float64Array(N * 8); // ox, oy, ampX, ampY, wX, wY, faza, L
{
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const cols = Math.ceil(Math.sqrt(N * 1.7));
  for (let i = 0; i < N; i++) {
    const cx = (i % cols) / cols - 0.5;
    const cy = Math.floor(i / cols) / Math.ceil(N / cols) - 0.5;
    const L = i % 23 === 0 ? 480 + rnd() * 160 : 130 + rnd() * 220;
    shipP.set([cx * 12500 + (rnd() - 0.5) * 300, cy * 7200 + (rnd() - 0.5) * 300, 200 + rnd() * 500, 150 + rnd() * 400,
      0.15 + rnd() * 0.35, 0.12 + rnd() * 0.3, rnd() * 6.283, L], i * 8);
    ships[i * SH + SHIP_F.L] = L;
    ships[i * SH + SHIP_F.KIND] = i % 4;
  }
}
const sim = { t: 0, acc: 0, lastT: 0, steps: 0 };
const fleetAt = (t, out) => {
  out[0] = 9000 * Math.cos(0.033 * t);
  out[1] = 6000 * Math.sin(0.05 * t);
  out[2] = -9000 * 0.033 * Math.sin(0.033 * t);
  out[3] = 6000 * 0.05 * Math.cos(0.05 * t);
  return out;
};
const _fl = new Float64Array(4);
function stepSim(dt) {
  sim.t += dt;
  const t = sim.t;
  fleetAt(t, _fl);
  for (let i = 0; i < N; i++) {
    const q = i * 8;
    const ph = shipP[q + 6];
    const wx = shipP[q + 4];
    const wy = shipP[q + 5];
    const ax = shipP[q + 2];
    const ay = shipP[q + 3];
    const o = i * SH;
    ships[o] = _fl[0] + shipP[q] + ax * Math.sin(wx * t + ph);
    ships[o + 1] = _fl[1] + shipP[q + 1] + ay * Math.cos(wy * t + ph);
    const vx = _fl[2] + ax * wx * Math.cos(wx * t + ph) + 60;
    const vy = _fl[3] - ay * wy * Math.sin(wy * t + ph);
    ships[o + SHIP_F.A] = Math.atan2(vy, vx);
    ships[o + SHIP_F.GLOW] = 0.5 + 0.5 * Math.sin(t * 3 + i);
  }
}
// kamera w czasie renderu (interpolowanym, jak poza gracza): flota + Lissajous; wstrząs w px ekranu
const cam = { ex: 0, ey: 0, zoom: ZOOM, sx: 0, sy: 0, tr: 0 };
function updateCamera(tr) {
  fleetAt(tr, _fl);
  const cx = _fl[0] + 2500 * Math.sin(0.6 * tr);
  const cy = _fl[1] + 1500 * Math.sin(0.9 * tr + 0.5);
  const tau = tr % 1.7;
  const A = 16 * PX * Math.exp(-tau / 0.35);
  cam.sx = A * Math.sin(2 * Math.PI * 12 * tr);
  cam.sy = A * Math.sin(2 * Math.PI * 11 * tr + 0.7);
  cam.ex = cx - cam.sx / cam.zoom;
  cam.ey = cy - cam.sy / cam.zoom;
  cam.tr = tr;
}

// ── Migawka (SAB, potrójny bufor) ─────────────────────────────────────────────────────────────────────────────
const pageD = snapPageDoubles(N, NODES);
const snapSab = new SharedArrayBuffer(TB.HEADER_BYTES + 3 * pageD * 8);
const snapI32 = new Int32Array(snapSab, 0, TB.HEADER_BYTES / 4);
const pages = [0, 1, 2].map((p) => new Float64Array(snapSab, TB.HEADER_BYTES + p * pageD * 8, pageD));
let back = 0; // strona pisarza (czytelnik: front = 1, wspólna: mid = 2)
Atomics.store(snapI32, TB.MID, 2);
const retSab = new SharedArrayBuffer(retBytes());
const retI32 = new Int32Array(retSab, 0, RET.HEADER_INTS);
const wlog = new Float64Array(retSab, RET.HEADER_INTS * 4, RET.LOG_CAP * WREC.SIZE);
const nodesSrc = new Float64Array(NODES);
for (let i = 0; i < NODES; i++) nodesSrc[i] = (i * 0.618034) % 1000;
const ovState = new Float64Array(SNAP.HEAD + N * SH); // stan nakładek (kamera + statki) ostatniej migawki
const localPage = new Float64Array(SNAP.HEAD + N * SH); // wariant 0 — bez bloku węzłów (dziś nie ma migawki)
let K = 0; // numer klatki migawki
let lastPubK = -1;
let prevPubK = -1;

function packHead(p, k) {
  p[SNAP.K] = k;
  p[SNAP.SIM] = sim.t;
  p[SNAP.EX] = cam.ex; p[SNAP.EY] = cam.ey; p[SNAP.ZOOM] = cam.zoom;
  p[SNAP.W] = W; p[SNAP.H] = H; p[SNAP.N] = N;
  p[SNAP.VFX] = cam.tr;
}
function packPage(p, k, withNodes) {
  packHead(p, k);
  p.set(ships, SNAP.HEAD);
  if (withNodes && NODES > 0) {
    // „węzły”: kilka tysięcy zmian na klatkę, kopia całego bloku przez TypedArray.set (jak migawka NODES gry)
    const n0 = (k * 1543) % NODES;
    for (let i = 0; i < 2000; i++) nodesSrc[(n0 + i * 17) % NODES] += 0.25;
    const off = SNAP.HEAD + N * SH;
    p.set(nodesSrc, off);
    let sum = 0;
    for (let i = 0; i < NODES; i += 97) sum += nodesSrc[i];
    p[SNAP.SUM] = sum;
    p[SNAP.NODES] = NODES;
  } else {
    p[SNAP.SUM] = 0;
    p[SNAP.NODES] = 0;
  }
}
function publish(p) {
  p[SNAP.TPUB] = now();
  const prev = Atomics.exchange(snapI32, TB.MID, back | TB.NEW);
  back = prev & 3;
}

// Historia klatek: kamera i 16 statków-sond → rozjazd px pary (nakładka k2, obraz 3D k3).
const HIST = 8192;
const PROBES = 16;
const HREC = 4 + PROBES * 2;
const hist = new Float64Array(HIST * HREC).fill(-1);
const probeIdx = Array.from({ length: PROBES }, (_, i) => Math.floor((i + 0.5) * N / PROBES));
function histPut(k, p) {
  const o = (k % HIST) * HREC;
  hist[o] = k; hist[o + 1] = p[SNAP.EX]; hist[o + 2] = p[SNAP.EY]; hist[o + 3] = p[SNAP.ZOOM];
  for (let j = 0; j < PROBES; j++) {
    const s = SNAP.HEAD + probeIdx[j] * SH;
    hist[o + 4 + j * 2] = p[s];
    hist[o + 5 + j * 2] = p[s + 1];
  }
}
const _pe = { mean: 0, max: 0 };
function pairError(k2, k3) {
  if (k2 === k3) { _pe.mean = 0; _pe.max = 0; return _pe; }
  const o2 = (k2 % HIST) * HREC;
  const o3 = (k3 % HIST) * HREC;
  if (k2 < 0 || k3 < 0 || hist[o2] !== k2 || hist[o3] !== k3) { _pe.mean = NaN; _pe.max = NaN; return _pe; }
  let sum = 0;
  let mx = 0;
  for (let j = 0; j < PROBES; j++) {
    const x2 = (hist[o2 + 4 + j * 2] - hist[o2 + 1]) * hist[o2 + 3];
    const y2 = (hist[o2 + 5 + j * 2] - hist[o2 + 2]) * hist[o2 + 3];
    const x3 = (hist[o3 + 4 + j * 2] - hist[o3 + 1]) * hist[o3 + 3];
    const y3 = (hist[o3 + 5 + j * 2] - hist[o3 + 2]) * hist[o3 + 3];
    const d = Math.sqrt((x2 - x3) * (x2 - x3) + (y2 - y3) * (y2 - y3));
    sum += d;
    if (d > mx) mx = d;
  }
  _pe.mean = sum / PROBES;
  _pe.max = mx;
  return _pe;
}

// ── Nakładka 2D ────────────────────────────────────────────────────────────────────────────────────────────────
// Atlas wieżyczki: 64 kąty po 16 × 16 px (jak atlasy Turret2D) — drawImage z prostokątem źródła, bez setTransform.
const TUR_ANG = 64;
let turretAtlas = null;
{
  const c = new OffscreenCanvas(16 * TUR_ANG, 16);
  const g = c.getContext('2d');
  for (let i = 0; i < TUR_ANG; i++) {
    g.setTransform(1, 0, 0, 1, i * 16 + 8, 8);
    g.rotate(i / TUR_ANG * Math.PI * 2);
    g.fillStyle = '#c9d4dc'; g.beginPath(); g.arc(0, 0, 5, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#1d2a33'; g.lineWidth = 1.4; g.stroke();
    g.fillStyle = '#f0f6fa'; g.fillRect(0, -1.2, 8, 2.4);
    g.fillStyle = '#ff5a3c'; g.fillRect(-1.5, -1.5, 3, 3);
  }
  turretAtlas = c.transferToImageBitmap();
}
const hud = { lines: ['…'], at: 0 };
const CORNER_W = 300;
const CORNER_H = 34;
function drawBarcode(ctx, k, y) {
  const B = BARCODE;
  for (let i = 0; i < B.BITS; i++) {
    ctx.fillStyle = (k >> i) & 1 ? '#fff' : '#000';
    ctx.fillRect(B.X0 + i * B.CELL_W, y, B.CELL_W - 1, B.CELL_H);
  }
}
function drawOverlay(ctx, st, k, clear) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (clear) ctx.clearRect(0, 0, W, H);
  const ex = st[SNAP.EX];
  const ey = st[SNAP.EY];
  const z = st[SNAP.ZOOM];
  const hw = W / 2;
  const hh = H / 2;
  const simT = st[SNAP.SIM];
  for (let i = 0; i < (OV_FULL ? N : 0); i++) {
    const o = SNAP.HEAD + i * SH;
    const x = st[o];
    const y = st[o + 1];
    const a = st[o + SHIP_F.A];
    const L = st[o + SHIP_F.L];
    const sx = (x - ex) * z + hw;
    const sy = (y - ey) * z + hh;
    const r = L * z * 0.6;
    if (sx < -r || sx > W + r || sy < -r || sy > H + r) continue;
    const c = Math.cos(a);
    const s = Math.sin(a);
    // obrót o −a w scenie 3D (wyznacznik +1) odbija lokalne +y kadłuba — gniazda liczone tak samo jak bryła
    const n = hardpointCount(i);
    const ts = Math.max(5 * PX, L * z * 0.12) / 16;
    for (let j = 0; j < n; j++) {
      const hx = HARDPOINTS[j][0] * L;
      const hy = HARDPOINTS[j][1] * L;
      const px = sx + (c * hx + s * hy) * z;
      const py = sy + (s * hx - c * hy) * z;
      const ta = a + 0.9 * Math.sin(simT * 0.8 + i * 1.37 + j * 2.1);
      if (py < CORNER_H && px < CORNER_W) continue; // róg z numerami klatek zostaje czysty (odczyt zrzutem)
      const ai = ((Math.round(ta / (Math.PI * 2) * TUR_ANG) % TUR_ANG) + TUR_ANG) % TUR_ANG;
      ctx.drawImage(turretAtlas, ai * 16, 0, 16, 16, px - ts * 8, py - ts * 8, ts * 16, ts * 16);
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // klamry zaznaczenia (co 40. statek)
  ctx.strokeStyle = 'rgba(120,255,170,0.95)';
  ctx.lineWidth = 1.5 * PX;
  ctx.beginPath();
  for (let i = 0; i < N; i += 40) {
    const o = SNAP.HEAD + i * SH;
    const sx = (st[o] - ex) * z + hw;
    const sy = (st[o + 1] - ey) * z + hh;
    const r = st[o + SHIP_F.L] * z * 0.62 + 4 * PX;
    if (sx < -r || sx > W + r || sy < -r || sy > H + r) continue;
    if (sy - r < CORNER_H && sx - r < CORNER_W) continue;
    const q = r * 0.35;
    ctx.moveTo(sx - r, sy - r + q); ctx.lineTo(sx - r, sy - r); ctx.lineTo(sx - r + q, sy - r);
    ctx.moveTo(sx + r - q, sy - r); ctx.lineTo(sx + r, sy - r); ctx.lineTo(sx + r, sy - r + q);
    ctx.moveTo(sx + r, sy + r - q); ctx.lineTo(sx + r, sy + r); ctx.lineTo(sx + r - q, sy + r);
    ctx.moveTo(sx - r + q, sy + r); ctx.lineTo(sx - r, sy + r); ctx.lineTo(sx - r, sy + r - q);
  }
  ctx.stroke();
  // HUD (tekst odświeżany 4× na sekundę, rysowany co klatkę)
  ctx.fillStyle = 'rgba(4,10,16,0.72)';
  ctx.fillRect(8, 40, 430 * Math.min(1.6, PX), (hud.lines.length * 15 + 10) * Math.min(1.6, PX));
  ctx.font = `${Math.round(12 * Math.min(1.6, PX))}px ui-monospace, Consolas, monospace`;
  ctx.fillStyle = '#d6e2e8';
  for (let i = 0; i < hud.lines.length; i++) ctx.fillText(hud.lines[i], 16, (58 + i * 15) * Math.min(1.6, PX));
  // numer klatki migawki nakładki: kod paskowy (wiersz 14–25) i cyfry
  drawBarcode(ctx, k, BARCODE.Y_OV);
  ctx.fillStyle = '#7cffb0';
  ctx.font = 'bold 12px ui-monospace, Consolas, monospace';
  ctx.fillText(`nakładka k=${k}`, 250, 25);
}

// ── Worker i wariant 0 ─────────────────────────────────────────────────────────────────────────────────────────
const worker = new Worker(new URL('./render-worker-proto.worker.js', import.meta.url), { type: 'module' });
const offA = canvases.cA.transferControlToOffscreen();
let workerCaps = null;
let workerReadyResolve;
const workerReady = new Promise((ok) => { workerReadyResolve = ok; });
let modeSeq = 0;
let proto0 = null;

const state = { variant: null, switching: false };
const ring = new Map(); // B2: k → ImageBitmap nakładki
const RING_CAP = num('pierscien', 12);
let shownOvK = -1;
let lastLatestK = -1;

// dzienniki okna pomiaru
const MREC = 16;
const MCAP = 40000;
const mlog = new Float64Array(MCAP * MREC);
let mlogN = 0;
const M = Object.freeze({ T0: 0, TPHYS: 1, STEPS: 2, TPACK: 3, TOV: 4, TEND: 5, K: 6, R0: 7, DI: 8, D0: 9, K3: 10, OVT: 11, ERR: 12, ERRMAX: 13, TPUB: 14, GPU: 15 });
const CREC = 12;
let ringOcc = 0;
const clog = new Float64Array(MCAP * CREC);
let clogN = 0;
const C = Object.freeze({ T0: 0, T1: 1, K3: 2, K2: 3, TPUB: 4, TREADY: 5, ERR: 6, ERRMAX: 7, MISS: 8, TFROM: 9, RING: 10 });
let win = null;

worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'ready') { workerCaps = m.caps; workerReadyResolve(); return; }
  if (m.type === 'core3d') {
    window.__rw.core3d = m.report;
    const ld = $('loading');
    if (ld) ld.textContent = m.report.steps.map((s) => `${s.ok ? '✓' : '✗'} ${s.name}`).join('\n');
    if (ld) ld.style.whiteSpace = 'pre';
    return;
  }
  if (m.type === 'error') { reportError(`worker: ${m.msg}`); return; }
  if (m.type === 'stats') { state.workerStats = m; return; }
  if (m.type !== 'frame') return;
  const v = state.variant;
  if (!IS_B(v)) { m.bmp.close(); return; }
  const t0 = now();
  bctx3d.transferFromImageBitmap(m.bmp);
  const tFrom = now();
  let k2 = -1;
  let miss = 0;
  if (v === 'B1') {
    // nakładki z bieżącego stanu gry (ostatnia migawka)
    k2 = lastLatestK;
    drawOverlay(ctxOv, ovState, k2, true);
  } else if (IS_B2C(v)) {
    let slot = -1;
    for (let i = 0; i < RING_ALL; i++) if (ringK[i] === m.k) { slot = i; break; }
    if (slot >= 0) {
      if (ringShown >= 0 && ringShown !== slot) ringCanvases[ringShown].style.visibility = 'hidden';
      ringCanvases[slot].style.visibility = 'visible';
      ringShown = slot;
      shownOvK = m.k;
    } else {
      miss = 1;
    }
    k2 = shownOvK;
    ringOcc = 0;
    for (let i = 0; i < RING_ALL; i++) if (ringK[i] > m.k) ringOcc++;
  } else {
    const bmp = ring.get(m.k);
    if (bmp) {
      bctxOv.transferFromImageBitmap(bmp);
      ring.delete(m.k);
      shownOvK = m.k;
    } else {
      miss = 1;
    }
    k2 = shownOvK;
    for (const [key, b] of ring) if (key < m.k) { b.close(); ring.delete(key); }
    ringOcc = ring.size;
  }
  lastComposedK = m.k;
  const t1 = now();
  if (win && clogN < MCAP) {
    const pe = pairError(k2, m.k);
    const o = clogN++ * CREC;
    clog[o + C.T0] = t0; clog[o + C.T1] = t1; clog[o + C.K3] = m.k; clog[o + C.K2] = k2; clog[o + C.TPUB] = m.tPub;
    clog[o + C.TREADY] = m.tReady; clog[o + C.ERR] = pe.mean; clog[o + C.ERRMAX] = pe.max; clog[o + C.MISS] = miss;
    clog[o + C.TFROM] = tFrom - t0;
    clog[o + C.RING] = ringOcc;
  }
};
worker.onerror = (e) => reportError(`worker onerror: ${e.message}`);
// ?core3d=1 — zamiast prototypu: próba prawdziwego Core3D w workerze (kanwa #cA, podkładki window / innerWidth / rIC)
const CORE3D_PROBE = params.get('core3d') === '1';
if (CORE3D_PROBE) {
  canvases.cA.style.visibility = 'visible';
  worker.postMessage({ type: 'core3d', canvas: offA, W, H, dpr: devicePixelRatio, docShim: params.get('dok') === '1' }, [offA]);
} else {
  worker.postMessage({ type: 'init', canvas: offA, snapSab, retSab, W, H, N, nodes: NODES, partie: PARTIE, gpuIters: GPU_ITERS, baseOrigin: performance.timeOrigin, hz: hzWorker() }, [offA]);
}

function setVisible(id, on) {
  canvases[id].style.visibility = on ? 'visible' : 'hidden';
}

async function waitAck(seq) {
  for (let i = 0; i < 400; i++) {
    if (Atomics.load(retI32, RET.MODE_ACK) === seq) return true;
    await new Promise((ok) => setTimeout(ok, 5));
  }
  return false;
}

async function setVariant(v) {
  if (!VARIANTS.includes(v)) throw new Error(`nieznany wariant ${v}`);
  await workerReady;
  state.switching = true;
  try {
    if (v === '0' && !proto0) proto0 = await Proto3D.create(canvases.c0, { W, H, N, partie: PARTIE, gpuIters: GPU_ITERS });
    const mode = v === 'A' ? 'A' : v === 'B3' ? 'B3' : IS_B(v) ? 'B' : 'idle';
    const seq = ++modeSeq;
    worker.postMessage({ type: 'mode', mode, D, hz: hzWorker(), seq });
    await waitAck(seq);
    for (const b of ring.values()) b.close();
    ring.clear();
    shownOvK = -1;
    lastPubK = -1;
    setVisible('c0', v === '0');
    setVisible('cA', v === 'A' || v === 'B3');
    setVisible('cB', IS_B(v));
    setVisible('ov', v === '0' || v === 'A' || v === 'B1');
    setVisible('ovB', v === 'B2' || v === 'B2p');
    for (const c of ringCanvases) c.style.visibility = 'hidden';
    ringK.fill(-1);
    ringShown = -1;
    lastComposedK = -1;
    ctxOv.setTransform(1, 0, 0, 1, 0, 0);
    ctxOv.clearRect(0, 0, W, H);
    state.variant = v;
    document.querySelectorAll('[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  } finally {
    state.switching = false;
  }
  return v;
}

function setLoad(s, d) {
  if (Number.isFinite(s)) S = s;
  if (Number.isFinite(d)) D = d;
  worker.postMessage({ type: 'load', D });
  document.querySelectorAll('[data-s]').forEach((b) => b.classList.toggle('on', Number(b.dataset.s) === S));
  document.querySelectorAll('[data-d]').forEach((b) => b.classList.toggle('on', Number(b.dataset.d) === D));
}

// ── Pętla wątku głównego ──────────────────────────────────────────────────────────────────────────────────────
// Takt pętli (`petla`): 'zegar' (domyślnie) — sloty co 1000 / hz ms na wspólnym zegarze, jak vsync: takty wysyła mały
// worker zegara (jego rAF w headless bez limitu klatek strzela ~1000×/s), praca zaczyna się na granicy slotu, a klatka
// spóźniona — zaraz po zwolnieniu wątku (jak BeginMainFrame po vblanku); zaległe takty się zlewają. hz = 0 — bez limitu
// (MessageChannel). 'raf' — requestAnimationFrame jak gra (w Electronie prawdziwy vsync). Dlaczego nie rAF / setTimeout
// w headless: rAF wątku głównego bez zmian na ekranie przychodzi co ~20 ms, a setTimeout trafia w takt 15,6 ms zegara
// Windows (przestoje 16 / 32 / 48 / 62 ms).
const LOOP_MODE = params.get('petla') || 'zegar';
const live = { frames: 0, mainAcc: 0 };
let lastFrameStart = -1e9;
const loopChannel = new MessageChannel();
loopChannel.port1.onmessage = () => loop(now());
const CLOCK_SRC = `
let hz = 0, base = 0, next = 0;
const now = () => performance.timeOrigin - base + performance.now();
onmessage = (e) => { hz = e.data.hz; base = e.data.base; next = 0; };
function f() {
  requestAnimationFrame(f);
  if (!(hz > 0)) return;
  const t = now();
  if (t < next) return;
  const P = 1000 / hz;
  next = (Math.floor(t / P) + 1) * P;
  postMessage(t);
}
requestAnimationFrame(f);
`;
const clock = new Worker(URL.createObjectURL(new Blob([CLOCK_SRC], { type: 'text/javascript' })));
clock.onmessage = (e) => {
  if (LOOP_MODE !== 'zegar' || !(hzMain() > 0)) return;
  if (e.data <= lastFrameStart) return; // takt zaległy (klatka już poszła po nim)
  loop(now());
};
function syncClock() {
  clock.postMessage({ hz: LOOP_MODE === 'zegar' ? hzMain() : 0, base: performance.timeOrigin });
}
function scheduleLoop() {
  if (LOOP_MODE === 'raf') { requestAnimationFrame(() => loop(now())); return; }
  if (!(hzMain() > 0)) loopChannel.port2.postMessage(0);
  // hz > 0: następny takt przyśle worker zegara
}

function loop(t0) {
  lastFrameStart = t0;
  try {
    loopBody(t0);
  } finally {
    scheduleLoop();
  }
}

function loopBody(t0) {
  const v = state.variant;
  if (!v || state.switching) { sim.lastT = t0; return; }
  // fizyka: krok 120 Hz × S ms (pętla gry: klatka ≤ 33 ms, ≤ 10 kroków)
  if (!sim.lastT) sim.lastT = t0;
  const frame = Math.min(0.033, (t0 - sim.lastT) / 1000);
  sim.lastT = t0;
  sim.acc += frame;
  let steps = 0;
  while (sim.acc >= PHYS_DT && steps < 10) {
    stepSim(PHYS_DT);
    burn(S);
    sim.acc -= PHYS_DT;
    steps++;
  }
  sim.steps += steps;
  const tPhys = now();
  updateCamera(sim.t - PHYS_DT + (sim.acc / PHYS_DT) * PHYS_DT);
  let k = -1;
  let tPack = tPhys;
  let tOv = tPhys;
  let r0 = 0;
  let di = 0;
  let d0 = 0;
  let ovt = 0;
  let k3 = -1;
  let err = 0;
  let errMax = 0;
  let tPub = 0;
  if (v === '0') {
    // jak dziś: brak migawki (stan czytany wprost — tu z lokalnej tablicy), D i render na wątku głównym
    k = K++;
    packPage(localPage, k, false);
    localPage[SNAP.TPUB] = now();
    tPub = localPage[SNAP.TPUB];
    histPut(k, localPage);
    tPack = now();
    burn(D);
    const tD = now();
    d0 = tD - tPack;
    proto0.update(localPage);
    proto0.render(k);
    const tR = now();
    r0 = tR - tD;
    ctxOv.setTransform(1, 0, 0, 1, 0, 0);
    ctxOv.drawImage(canvases.c0, 0, 0, W, H);
    di = now() - tR;
    drawOverlay(ctxOv, localPage, k, false);
    tOv = now();
    k3 = k;
  } else {
    const backPressure = v === 'B2p' || v === 'B2cp';
    const canPublish = !backPressure || lastPubK < 0 || Atomics.load(retI32, RET.LAST_CONSUMED) >= lastPubK;
    if (canPublish) {
      prevPubK = lastPubK;
      k = K++;
      const p = pages[back];
      packPage(p, k, true);
      ovState.set(p.subarray(0, ovState.length));
      histPut(k, p);
      if (v === 'B3') {
        // nakładka przed publikacją migawki — bitmapa k w kolejce workera, zanim worker zobaczy stronę k
        drawOverlay(ctxOff, ovState, k, true);
        const tt = now();
        const bmp = ovOff.transferToImageBitmap();
        ovt = now() - tt;
        worker.postMessage({ type: 'ov', k, bmp }, [bmp]);
        tOv = now();
        publish(p);
        tPub = p[SNAP.TPUB];
        tPack = tOv;
      } else {
        publish(p);
        tPub = p[SNAP.TPUB];
        tPack = now();
        tOv = tPack;
      }
      lastPubK = k;
      lastLatestK = k;
      if (v === 'A') {
        drawOverlay(ctxOv, ovState, k, true);
        Atomics.store(retI32, RET.MAIN_OVK, k);
        tOv = now();
        // para na ekranie z perspektywy wątku głównego: ta nakładka + ostatnio pokazana klatka workera
        k3 = Atomics.load(retI32, RET.LAST_PRESENTED);
        const pe = pairError(k, k3);
        err = pe.mean;
        errMax = pe.max;
      } else if (v === 'B2cr' || v === 'B2cp') {
        // wolna kanwa: nie pokazana, nie z klatką odebraną przez worker i jeszcze nie złożoną, nie z poprzednią publikacją
        const c0 = Atomics.load(retI32, RET.CONS0);
        const c1 = Atomics.load(retI32, RET.CONS0 + 1);
        const c2 = Atomics.load(retI32, RET.CONS0 + 2);
        const c3 = Atomics.load(retI32, RET.CONS0 + 3);
        const n = v === 'B2cp' ? RING_P : RING_R;
        let slot = -1;
        let oldest = Infinity;
        let guarded = 0;
        for (let i = 0; i < n; i++) {
          const kk = ringK[i];
          const inFlight = kk > lastComposedK && (kk === c0 || kk === c1 || kk === c2 || kk === c3);
          if (i === ringShown || inFlight || kk === prevPubK) { guarded++; continue; }
          if (kk < oldest) { oldest = kk; slot = i; }
        }
        if (guarded > ringGuardMax) ringGuardMax = guarded;
        if (slot < 0) { ringFull++; slot = (ringShown + 1) % n; } // pierścień za mały — nadpisanie (licznik)
        ringK[slot] = k;
        drawOverlay(ringCtx[slot], ovState, k, true);
        tOv = now();
      } else if (v === 'B2c') {
        let slot = ringNext;
        if (slot === ringShown) slot = (slot + 1) % RING_DOM;
        ringNext = (slot + 1) % RING_DOM;
        ringK[slot] = k;
        drawOverlay(ringCtx[slot], ovState, k, true);
        tOv = now();
      } else if (v === 'B2' || v === 'B2p') {
        drawOverlay(ctxOff, ovState, k, true);
        const tt = now();
        const bmp = ovOff.transferToImageBitmap();
        ovt = now() - tt;
        ring.set(k, bmp);
        if (ring.size > RING_CAP) {
          let oldest = Infinity;
          for (const key of ring.keys()) if (key < oldest) oldest = key;
          ring.get(oldest).close();
          ring.delete(oldest);
        }
        tOv = now();
      }
    }
  }
  const tEnd = now();
  live.frames++;
  live.mainAcc += tEnd - tPhys;
  if (win && mlogN < MCAP) {
    const o = mlogN++ * MREC;
    mlog[o + M.T0] = t0; mlog[o + M.TPHYS] = tPhys; mlog[o + M.STEPS] = steps; mlog[o + M.TPACK] = tPack;
    mlog[o + M.TOV] = tOv; mlog[o + M.TEND] = tEnd; mlog[o + M.K] = k; mlog[o + M.R0] = r0; mlog[o + M.DI] = di;
    mlog[o + M.D0] = d0; mlog[o + M.K3] = k3; mlog[o + M.OVT] = ovt; mlog[o + M.ERR] = err; mlog[o + M.ERRMAX] = errMax;
    mlog[o + M.TPUB] = tPub;
    mlog[o + M.GPU] = v === '0' && proto0 && proto0.gpuRenderMs >= 0 ? proto0.gpuRenderMs + proto0.gpuComputeMs : -1;
  }
  if (tEnd - hud.at > 250) updateHud(tEnd);
}

let hudPrev = { t: 0, frames: 0, w: 0, c: 0 };
function updateHud(t) {
  const dt = (t - hudPrev.t) / 1000;
  const wN = Atomics.load(retI32, RET.COUNT);
  const mainFps = (live.frames - hudPrev.frames) / dt;
  const v = state.variant;
  let fps3d = mainFps;
  if (v === 'A' || v === 'B3' || IS_B(v)) fps3d = (wN - hudPrev.w) / dt;
  const mainMs = live.frames > hudPrev.frames ? live.mainAcc / (live.frames - hudPrev.frames) : 0;
  hud.lines = [
    `RW-02 prototyp — wariant ${v}  (${W}×${H}, ${N} statków, ${HZ > 0 ? HZ + ' Hz' : 'bez limitu'})`,
    `obciążenie: S = ${S} ms × 120 Hz (wątek główny), D = ${D} ms / klatkę (${v === '0' ? 'wątek główny' : 'worker'})`,
    `wątek główny: ${mainFps.toFixed(0)} kl/s, poza fizyką ${mainMs.toFixed(2)} ms/kl`,
    `obraz 3D: ${fps3d.toFixed(0)} kl/s`,
    `migawka k=${K - 1}, worker: odebrana ${Atomics.load(retI32, RET.LAST_CONSUMED)}, pokazana ${Atomics.load(retI32, RET.LAST_PRESENTED)}`,
    `rozdarte strony: ${Atomics.load(retI32, RET.TORN)}`
  ];
  hud.at = t;
  hudPrev = { t, frames: live.frames, w: wN, c: 0 };
  live.mainAcc = 0;
}

// ── Okno pomiaru i podsumowanie ───────────────────────────────────────────────────────────────────────────────
function pct(arr, p) {
  if (!arr.length) return NaN;
  const s = Float64Array.from(arr).sort();
  const i = Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)));
  return s[i];
}
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN);
const stats = (arr) => ({ n: arr.length, mean: mean(arr), p50: pct(arr, 0.5), p95: pct(arr, 0.95), p99: pct(arr, 0.99), max: arr.length ? Math.max(...arr) : NaN });

function beginWindow() {
  mlogN = 0;
  clogN = 0;
  ringGuardMax = 0;
  ringFull = 0;
  win = { t0: now(), w0: Atomics.load(retI32, RET.COUNT), torn0: Atomics.load(retI32, RET.TORN), k0: K, steps0: sim.steps };
  return win.t0;
}

function endWindow() {
  const t1 = now();
  const w = win;
  win = null;
  const v = state.variant;
  const dur = t1 - w.t0;
  const wN = Atomics.load(retI32, RET.COUNT);
  const wrecs = [];
  for (let n = Math.max(w.w0, wN - RET.LOG_CAP); n < wN; n++) {
    const o = (n % RET.LOG_CAP) * WREC.SIZE;
    const r = wlog.subarray(o, o + WREC.SIZE);
    if (r[WREC.TRAF] >= w.t0 && r[WREC.TPRES] <= t1) wrecs.push(Float64Array.from(r));
  }
  const mainRows = [];
  for (let i = 0; i < mlogN; i++) mainRows.push(mlog.subarray(i * MREC, (i + 1) * MREC));
  const compRows = [];
  for (let i = 0; i < clogN; i++) compRows.push(clog.subarray(i * CREC, (i + 1) * CREC));
  const published = mainRows.filter((r) => r[M.K] >= 0).length;
  const out = {
    variant: v, W, H, N, nodes: NODES, hz: HZ, S, D, durMs: dur,
    mainFrames: mainRows.length,
    mainFps: mainRows.length / dur * 1000,
    physStepsPerSec: (sim.steps - w.steps0) / dur * 1000,
    published, publishedPerSec: published / dur * 1000,
    torn: Atomics.load(retI32, RET.TORN) - w.torn0
  };
  // koszt wątku głównego poza fizyką (pakowanie, nakładki, warstwa B2, w wariancie 0 także D + render + kopia)
  const mainCost = mainRows.map((r) => r[M.TEND] - r[M.TPHYS]);
  const packCost = mainRows.filter((r) => r[M.K] >= 0).map((r) => r[M.TPACK] - r[M.TPHYS]);
  const ovCost = mainRows.filter((r) => r[M.K] >= 0).map((r) => r[M.TOV] - r[M.TPACK]);
  const ovt = mainRows.filter((r) => r[M.K] >= 0).map((r) => r[M.OVT]);
  const physCost = mainRows.map((r) => r[M.TPHYS] - r[M.T0]);
  const compCost = compRows.map((r) => r[C.T1] - r[C.T0]);
  const fromCost = compRows.map((r) => r[C.TFROM]);
  out.main = {
    perFrame: stats(mainCost), pack: stats(packCost), overlay: stats(ovCost), overlayBitmap: stats(ovt),
    phys: stats(physCost), compose: stats(compCost), composeFrom: stats(fromCost),
    busyMsPerSec: (mainCost.reduce((a, b) => a + b, 0) + compCost.reduce((a, b) => a + b, 0)) / dur * 1000
  };
  if (v === '0') {
    out.main.render0 = stats(mainRows.map((r) => r[M.R0]));
    out.main.drawImage0 = stats(mainRows.map((r) => r[M.DI]));
    out.main.D0 = stats(mainRows.map((r) => r[M.D0]));
    out.main.drawCalls0 = proto0 ? proto0.drawCalls : 0;
    out.main.gpu0 = stats(mainRows.map((r) => r[M.GPU]).filter((x) => x >= 0));
  }
  // obraz na ekranie: chwile prezentacji, opóźnienia, rozjazd
  let present = [];
  let latReady = [];
  let latComposed = [];
  let errs = [];
  let errsMax = [];
  let pairsMismatch = 0;
  let pairsTotal = 0;
  if (v === '0') {
    present = mainRows.map((r) => r[M.TEND]);
    latReady = mainRows.map((r) => r[M.TPACK] + r[M.D0] + r[M.R0] - r[M.TPUB]);
    latComposed = mainRows.map((r) => r[M.TEND] - r[M.TPUB]);
    errs = mainRows.map(() => 0);
    errsMax = errs;
    pairsTotal = mainRows.length;
  } else if (v === 'A' || v === 'B3') {
    present = wrecs.map((r) => r[WREC.TPRES]);
    latReady = wrecs.map((r) => r[WREC.TREND] - r[WREC.TPUB]);
    latComposed = wrecs.map((r) => r[WREC.TPRES] - r[WREC.TPUB]);
    if (v === 'A') {
      // pary z obu stron: (nakładka k, ostatnia klatka workera) przy każdej nakładce + (ostatnia nakładka, k) przy każdej
      // klatce workera
      for (const r of mainRows) {
        if (r[M.K] < 0) continue;
        pairsTotal++;
        if (r[M.K] !== r[M.K3]) pairsMismatch++;
        if (Number.isFinite(r[M.ERR])) { errs.push(r[M.ERR]); errsMax.push(r[M.ERRMAX]); }
      }
      for (const r of wrecs) {
        pairsTotal++;
        if (r[WREC.OVK] !== r[WREC.K]) pairsMismatch++;
        const pe = pairError(r[WREC.OVK], r[WREC.K]);
        if (Number.isFinite(pe.mean)) { errs.push(pe.mean); errsMax.push(pe.max); }
      }
    } else {
      for (const r of wrecs) {
        pairsTotal++;
        if (r[WREC.OVUSED] !== r[WREC.K]) pairsMismatch++;
        const pe = pairError(r[WREC.OVUSED], r[WREC.K]);
        if (Number.isFinite(pe.mean)) { errs.push(pe.mean); errsMax.push(pe.max); }
      }
    }
  } else {
    present = compRows.map((r) => r[C.T1]);
    latReady = compRows.map((r) => r[C.TREADY] - r[C.TPUB]);
    latComposed = compRows.map((r) => r[C.T1] - r[C.TPUB]);
    for (const r of compRows) {
      pairsTotal++;
      if (r[C.K2] !== r[C.K3]) pairsMismatch++;
      if (Number.isFinite(r[C.ERR])) { errs.push(r[C.ERR]); errsMax.push(r[C.ERRMAX]); }
    }
    out.ringMiss = compRows.reduce((a, r) => a + r[C.MISS], 0);
    out.ringOcc = stats(compRows.map((r) => r[C.RING]));
    out.ringGuardMax = ringGuardMax;
    out.ringFull = ringFull;
  }
  const intervals = [];
  for (let i = 1; i < present.length; i++) intervals.push(present[i] - present[i - 1]);
  out.display = {
    frames: present.length, fps: present.length / dur * 1000, interval: stats(intervals),
    latReady: stats(latReady), latComposed: stats(latComposed),
    err: stats(errs), errMax: stats(errsMax), pairsTotal, pairsMismatch
  };
  if (v !== '0') {
    const g = (f) => wrecs.map(f);
    out.worker = {
      frames: wrecs.length, fps: wrecs.length / dur * 1000,
      D: stats(g((r) => r[WREC.TD] - r[WREC.TCONS])),
      update: stats(g((r) => r[WREC.TUPD] - r[WREC.TD])),
      render: stats(g((r) => r[WREC.TREND] - r[WREC.TUPD])),
      ttib: stats(g((r) => r[WREC.TTIB])),
      post: stats(g((r) => r[WREC.TPOST] - r[WREC.TREND] - r[WREC.TTIB])),
      total: stats(g((r) => r[WREC.TPRES] - r[WREC.TRAF])),
      consumeAge: stats(g((r) => r[WREC.TCONS] - r[WREC.TPUB])),
      skipped: g((r) => r[WREC.SKIP]).reduce((a, b) => a + b, 0),
      gpu: stats(g((r) => r[WREC.GPU]).filter((x) => x >= 0)),
      // przerwa workera między końcem klatki a startem następnej (czeka na rAF / slot / nową migawkę)
      gap: stats(wrecs.slice(1).map((r, i) => r[WREC.TRAF] - wrecs[i][WREC.TPRES])),
      drawCalls: stats(g((r) => r[WREC.DC]))
    };
  }
  return out;
}

// ── Panel, start ──────────────────────────────────────────────────────────────────────────────────────────────
function buildPanel() {
  const el = $('panel');
  if (!el) return;
  const row = (label, items, attr, fn) => {
    const r = document.createElement('div');
    r.className = 'row';
    r.innerHTML = `<span>${label}</span>`;
    for (const it of items) {
      const b = document.createElement('button');
      b.textContent = it;
      b.dataset[attr] = it;
      b.onclick = () => fn(it);
      r.appendChild(b);
    }
    el.appendChild(r);
  };
  row('wariant', VARIANTS, 'v', (v) => setVariant(v));
  row('S [ms]', [0, 2.5, 3.5, 4.5], 's', (s) => setLoad(Number(s), NaN));
  row('D [ms]', [0, 4, 8, 12], 'd', (d) => setLoad(NaN, Number(d)));
}

window.__rw = {
  ready: false, errors, W, H, N, NODES, HZ, VARIANTS,
  get caps() {
    return {
      main: { gpu: !!navigator.gpu, crossOriginIsolated: self.crossOriginIsolated === true,
        bitmaprenderer: !!bctx3d && typeof bctx3d.transferFromImageBitmap === 'function',
        offscreenTransfer: typeof canvases.cA.transferControlToOffscreen === 'function', userAgent: navigator.userAgent },
      worker: workerCaps
    };
  },
  get variant() { return state.variant; },
  get k() { return K; },
  setVariant, setLoad, beginWindow, endWindow,
  pairError: (k2, k3) => ({ ...pairError(k2, k3) }),
  setHz(hz, hzM = NaN, hzW = NaN) {
    HZ = hz; HZ_MAIN = hzM; HZ_WORKER = hzW;
    syncClock();
    if (!(hzMain() > 0)) scheduleLoop();
    worker.postMessage({ type: 'mode', mode: { 0: 'idle', A: 'A', B3: 'B3' }[state.variant] || 'B', hz: hzWorker(), D, seq: ++modeSeq });
  },
  workerStats() { worker.postMessage({ type: 'stats' }); },
  // surowe wiersze okna (diagnostyka): ostatnie okno zostaje w dziennikach do następnego beginWindow
  raw() {
    const rows = [];
    for (let i = 0; i < mlogN; i++) rows.push(Array.from(mlog.subarray(i * MREC, (i + 1) * MREC)));
    const comp = [];
    for (let i = 0; i < clogN; i++) comp.push(Array.from(clog.subarray(i * CREC, (i + 1) * CREC)));
    return { M, C, rows, comp };
  },
  ret: () => ({ count: Atomics.load(retI32, RET.COUNT), consumed: Atomics.load(retI32, RET.LAST_CONSUMED), presented: Atomics.load(retI32, RET.LAST_PRESENTED), torn: Atomics.load(retI32, RET.TORN) })
};

if (!CORE3D_PROBE) {
buildPanel();
setLoad(S, D);
syncClock();
scheduleLoop();
setVariant(params.get('wariant') || 'B2').then(() => {
  window.__rw.ready = true;
  const ld = $('loading');
  if (ld) ld.style.display = 'none';
}).catch((err) => reportError(err?.stack || err));
} else {
  const ld = $('loading');
  if (ld) ld.textContent = 'Próba Core3D w workerze…';
}
