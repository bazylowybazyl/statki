// dema/silniki-marki.js — PROPOZYCJA: marki silników frakcji (nowe dysze i nowe efekty strugi) na WebGPU + TSL.
//
// Sześć marek (dema/silniki-marki/marki.js), każda z własnym osprzętem dyszy (dysze.js) i własną strugą w trybach:
// jałowy, normalny, boost, hipercruise (rozruch → zapłon → lot → wyjście), warp (ładowanie → skok → lot → wyjście).
// Wszystkie strugi rysuje JEDEN shader (struga.js) — marka i tryb to wektor liczb mieszany kanałami automatu
// (automat.js). Do tego: żar i lampy osprzętu, blaski i iskry (blaski.js), gorące powietrze dysz i fala skoku jako
// sama refrakcja (post.js), gwiazdy ze smugami prędkości (niebo.js), bloom i ACES gry.
//
// Scena: okręt stoi w kadrze dziobem w prawo, struga leci w lewo; kamera ortho z góry jak w grze (K / PPM — pochylona).
// Adres: ?marka=helios|ares|krios|wulkan|kowal|szakal, ?tryb=jalowy|normalny|boost|hiper|warp, ?widok=galeria,
// ?petla=0, ?test=1 (czas tylko z __silniki.przewin), ?shot=1 (bez paneli).
// Konsola: window.__silniki (ustaw, przewin, stan).

import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { BLOOM_DEFAULTS } from '../src/3d/bloomConfig.js';
import { MARKI, blendPlume, createPlumeState, POLA_LICZB, POLA_BARW } from './silniki-marki/marki.js';
import {
  TRYBY, AUTOMAT, FAZY_PL, createEngine, stepEngine, setEngineMode,
  EV_BOOST, EV_HIPER, EV_WARP, EV_WARP_WYJSCIE
} from './silniki-marki/automat.js';
import { buildShip, animateShip } from './silniki-marki/dysze.js';
import { StrugaBatch } from './silniki-marki/struga.js';
import { Blaski, Iskry, BLASK_KOLO, BLASK_SMUGA } from './silniki-marki/blaski.js';
import { PostSilnikow } from './silniki-marki/post.js';
import { Niebo } from './silniki-marki/niebo.js';

const params = new URLSearchParams(location.search);
if (params.get('shot') === '1') document.body.classList.add('shot');
const TEST = params.get('test') === '1';
const $ = (id) => document.getElementById(id);
const errorsEl = $('errors');
function reportError(text) {
  errorsEl.style.display = 'block';
  errorsEl.textContent += `${text}\n`;
  console.error(text);
}
addEventListener('error', (e) => reportError(`JS: ${e.message} @ ${e.filename}:${e.lineno}`));
addEventListener('unhandledrejection', (e) => reportError(`Promise: ${e.reason?.stack || e.reason}`));

const PANEL_PX = 364;        // szerokość panelu z marginesem — kadr liczony na resztę ekranu
const ROW_DY = 250;          // odstęp wierszy porównania [j.]
const LIP_X = -205;          // typowa warga dyszy w układzie okrętu
const V_WARP_PX = 9000;      // prędkość gwiazd najbliższej warstwy w warpie [px/s]
const SUN_INTENSITY = 2.1;
const LIGHT_K = 13;          // światło strugi na rufie: natężenie na jednostkę (moc × r²)
const NOZZLE_Z = 0;

// Kadr zbliżenia wg fazy: [mnożnik zoomu, miejsce wargi dyszy — ułamek szerokości wolnej od panelu].
const KADR = {
  jalowy: [1, 0.42], normalny: [1, 0.42], boost: [0.75, 0.48],
  'hiper-rozruch': [1, 0.42], hiper: [0.34, 0.7], 'hiper-wyjscie': [0.34, 0.7],
  'warp-ladowanie': [1.05, 0.42], warp: [0.23, 0.76], 'warp-wyjscie': [0.23, 0.76]
};

// Pętla pokazu: tryb i czas [s].
const POKAZ = [['normalny', 4.2], ['boost', 4.2], ['hiper', 7.5], ['warp', 10], ['jalowy', 3]];

const S = {
  marka: Math.max(0, MARKI.findIndex((m) => m.id === params.get('marka'))),
  tryb: TRYBY.includes(params.get('tryb')) ? params.get('tryb') : 'normalny',
  widok: params.get('widok') === 'galeria' ? 'galeria' : 'zblizenie',
  petla: params.get('petla') !== '0' && !params.has('tryb'),
  pokazI: 0,
  pokazT: 0,
  pauza: false,
  wolno: false,
  czas: 1,
  time: 0,
  frame: 0,
  fps: 60,
  cpuMs: 0,
  gimbal: 0,
  gimbalCel: 0,
  kamera3d: false,
  elev: 0,
  azim: 0,
  elevCel: 0,
  azimCel: 0,
  zoomUser: 1,
  czysto: false,
  gain: 1,
  haze: 1,
  warstwy: { struga: true, haze: true, iskry: true, bloom: true, zar: true, gwiazdy: true },
  keys: new Set(),
  cam: { x: 0, y: 0, zoom: 1 },
  ready: false
};

let W = innerWidth;
let H = innerHeight;
let renderer = null;
let pipeline = null;
const scene = new THREE.Scene();
scene.name = 'silniki-marki';
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 20000);
const sun = new THREE.DirectionalLight(0xffffff, SUN_INTENSITY);
sun.color.setRGB(1.0, 0.96, 0.9, THREE.LinearSRGBColorSpace);
sun.position.set(-450, 560, 700);
scene.add(sun);
scene.add(sun.target);
const hemi = new THREE.HemisphereLight(0x8ea2c2, 0x0c1016, 0.55);
scene.add(hemi);
// Światło wypełniające od strony kamery pochylonej (burty nie są czarne w widoku 3D); z góry prawie nie pracuje.
const fill = new THREE.DirectionalLight(0xffffff, 0.55);
fill.color.setRGB(0.7, 0.8, 1.0, THREE.LinearSRGBColorSpace);
scene.add(fill);
scene.add(fill.target);

const post = new PostSilnikow();
let niebo = null;
let strugi = null;
let blaski = null;
const iskry = new Iskry();
const ships = [];
const labels = [];

// ---------------------------------------------------------------------------
// Renderer i post

async function initRenderer() {
  if (!navigator.gpu) throw new Error('Ta przeglądarka nie udostępnia WebGPU (navigator.gpu). Potrzebny Chrome / Edge z WebGPU i adres localhost.');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('Brak adaptera WebGPU (requestAdapter zwrócił null).');
  const requiredLimits = {};
  if (adapter.limits.maxInterStageShaderVariables >= 28) requiredLimits.maxInterStageShaderVariables = 28;
  renderer = new THREE.WebGPURenderer({ antialias: false, alpha: false, requiredLimits });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H);
  renderer.setClearColor(0x000000, 1);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  $('root').appendChild(renderer.domElement);
  renderer.domElement.tabIndex = 0;
  await renderer.init();
  if (!renderer.backend?.isWebGPUBackend) throw new Error('WebGPURenderer uruchomił się na zapasowym backendzie WebGL — demo wymaga WebGPU.');
}

function buildPipeline() {
  pipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera, { samples: 4 });
  const tex = scenePass.getTextureNode('output');
  pipeline.outputNode = post.buildOutput(tex, (n) => bloom(n, BLOOM_DEFAULTS.strength, BLOOM_DEFAULTS.radius, BLOOM_DEFAULTS.threshold));
  pipeline.outputColorTransform = true;
}

// ---------------------------------------------------------------------------
// Okręty

function buildShips() {
  for (const marka of MARKI) {
    const ship = buildShip(marka);
    ship.e = createEngine();
    ship.P = createPlumeState();
    ship.G = createPlumeState();   // nastawy lancy warpa z ostatniej klatki lotu — „duch” przy wyjściu
    ship.ghost = { on: false, t: 0, phase: 0, pPhase: 0 };
    ship.ring = { on: false, t: 0, dur: 0.7, k: 1 };
    ship.phase = marka.dysze[0].seed * 40;
    ship.pPhase = 0;
    ship.chase = 0;
    ship.chargePulse = 0;
    ship.sparkAcc = 0;
    ship.inAcc = 0;
    ship.slot = { x: 0, y: 0 };
    ship.visible = true;
    ship.light = new THREE.PointLight(0xffffff, 0, 460, 2);
    ship.light.color.setRGB(marka.swiatlo[0], marka.swiatlo[1], marka.swiatlo[2], THREE.LinearSRGBColorSpace);
    scene.add(ship.light);
    scene.add(ship.group);
    ships.push(ship);
    const el = document.createElement('div');
    el.innerHTML = `<b>${marka.nazwa}</b><span>${marka.frakcja} · ${marka.typ.split(' — ')[0]}</span>`;
    $('etykiety').appendChild(el);
    labels.push(el);
  }
}

function copyPlume(dst, src) {
  for (let i = 0; i < POLA_LICZB.length; i++) dst[POLA_LICZB[i]] = src[POLA_LICZB[i]];
  for (let i = 0; i < POLA_BARW.length; i++) { const f = POLA_BARW[i]; dst[f][0] = src[f][0]; dst[f][1] = src[f][1]; dst[f][2] = src[f][2]; }
  dst.stretch = src.stretch;
}

// ---------------------------------------------------------------------------
// Układ i kamera

const layout = { cols: 1, rows: 6, zoomG: 0.6, zoomH: 1.4, wav: 1556 };

function computeLayout() {
  const wav = Math.max(480, W - (S.czysto || document.body.classList.contains('shot') ? 0 : PANEL_PX));
  const cols = wav / H > 2.6 ? 2 : 1;
  const rows = Math.ceil(MARKI.length / cols);
  const zoomG = Math.min(H / (rows * ROW_DY + 40), wav / (cols * 1500));
  const colW = wav / zoomG / cols;
  for (let i = 0; i < ships.length; i++) {
    const col = Math.floor(i / rows);
    const row = i % rows;
    const s = ships[i].slot;
    s.x = -wav / zoomG / 2 + (col + 0.74) * colW - LIP_X;
    s.y = ((rows - 1) / 2 - row) * ROW_DY;
    ships[i].group.position.set(s.x, s.y, 0);
    ships[i].group.updateMatrixWorld(true);
  }
  layout.cols = cols; layout.rows = rows; layout.zoomG = zoomG; layout.wav = wav;
  // Zbliżenie: dysze duże (okręt ~0,8 szerokości wolnej od panelu — dziób może wyjść za kadr).
  layout.zoomH = Math.min(0.8 * wav / 400, H / 250);
}

const camTarget = { x: 0, y: 0, zoom: 1 };
function computeCamTarget() {
  const shift = (W - layout.wav) / 2; // panel po prawej — środek wolnej części kadru leży w lewo od środka ekranu
  if (S.widok === 'galeria') {
    camTarget.zoom = layout.zoomG * S.zoomUser;
    camTarget.x = shift / camTarget.zoom;
    camTarget.y = 0;
    return;
  }
  const ship = ships[S.marka];
  const k = KADR[ship.e.phase] || KADR.normalny;
  const zoom = layout.zoomH * k[0] * S.zoomUser;
  camTarget.zoom = zoom;
  camTarget.x = ship.slot.x + LIP_X - (k[1] - 0.5) * layout.wav / zoom + shift / zoom;
  camTarget.y = ship.slot.y;
}

const _focus = new THREE.Vector3();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const viewDir = new THREE.Vector3(0, 0, -1);

function updateCamera(dt, snap = false) {
  computeCamTarget();
  const c = S.cam;
  if (snap) { c.x = camTarget.x; c.y = camTarget.y; c.zoom = camTarget.zoom; }
  else {
    const kp = 1 - Math.exp(-3.2 * dt);
    const kz = 1 - Math.exp(-2.4 * dt);
    c.x += (camTarget.x - c.x) * kp;
    c.y += (camTarget.y - c.y) * kp;
    c.zoom = Math.exp(Math.log(c.zoom) + (Math.log(camTarget.zoom) - Math.log(c.zoom)) * kz);
    const ka = 1 - Math.exp(-5 * dt);
    S.elev += (S.elevCel - S.elev) * ka;
    S.azim += (S.azimCel - S.azim) * ka;
  }
  const hw = W * 0.5 / c.zoom;
  const hh = H * 0.5 / c.zoom;
  camera.left = -hw; camera.right = hw; camera.top = hh; camera.bottom = -hh;
  camera.near = 1; camera.far = 12000;
  const e = S.elev;
  const a = S.azim;
  _focus.set(c.x, c.y, 0);
  const D = 6000;
  camera.position.set(c.x + D * Math.sin(e) * Math.sin(a), c.y - D * Math.sin(e) * Math.cos(a), D * Math.cos(e));
  camera.up.set(-Math.cos(e) * Math.sin(a), Math.cos(e) * Math.cos(a), Math.sin(e));
  camera.lookAt(_focus);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const m = camera.matrixWorld.elements;
  viewDir.set(-m[8], -m[9], -m[10]);
  sun.position.set(c.x - 450, c.y + 560, 700);
  sun.target.position.set(c.x, c.y, 0);
  sun.target.updateMatrixWorld(true);
  sun.updateMatrixWorld(true);
  fill.position.set(c.x + 500, c.y - 800, 160);
  fill.target.position.set(c.x, c.y, 0);
  fill.target.updateMatrixWorld(true);
  fill.updateMatrixWorld(true);
}

/** Punkt sceny → piksel ekranu (y w dół). */
function toPx(x, y, z, out) {
  _v.set(x, y, z).project(camera);
  out.x = (_v.x * 0.5 + 0.5) * W;
  out.y = (1 - (_v.y * 0.5 + 0.5)) * H;
  return out;
}

// ---------------------------------------------------------------------------
// Symulacja

function flicker(t, seed, sputter) {
  if (!(sputter > 0)) return 1;
  const a = Math.sin(t * 31.7 + seed * 40) * Math.sin(t * 17.3 + seed * 12.9);
  const b = Math.sin(t * 7.1 + seed * 5.3) * Math.sin(t * 3.7 + seed * 9.1);
  const dip = b > 0.55 ? (b - 0.55) / 0.45 : 0;
  return Math.max(0.15, 1 - sputter * (0.22 * (0.5 + 0.5 * a) + 0.75 * dip));
}

const _lip = { x: 0, y: 0, dx: -1, dy: 0 };
/** Warga dyszy i kierunek wydechu w scenie. */
function lipOf(ship, n) {
  const px = ship.slot.x + n.baseX + (n.recoil || 0);
  const py = ship.slot.y + n.mount.y;
  const ah = n.hardAngle || 0;
  _lip.x = px - n.plen * Math.cos(ah);
  _lip.y = py - n.plen * Math.sin(ah);
  const a = n.angle || 0;
  _lip.dx = -Math.cos(a);
  _lip.dy = -Math.sin(a);
  return _lip;
}

function burst(ship, count, speedK, color) {
  if (!S.warstwy.iskry) return;
  for (const n of ship.nozzles) {
    const L = lipOf(ship, n);
    const r = n.mount.r;
    const nx = -L.dy;
    const ny = L.dx;
    for (let i = 0; i < count; i++) {
      const sp = r * (9 + 26 * iskry.rnd()) * speedK;
      const lat = (iskry.rnd() - 0.5) * 2;
      const off = lat * n.mount.rw * 0.7;
      iskry.emit(L.x + nx * off, L.y + ny * off, NOZZLE_Z + 0.5,
        L.dx * sp + nx * lat * sp * 0.28, L.dy * sp + ny * lat * sp * 0.28,
        0.35 + 0.6 * iskry.rnd(), 1.1 + 1.3 * iskry.rnd(),
        color[0] * (1.2 + 1.6 * iskry.rnd()), color[1] * (1.2 + 1.6 * iskry.rnd()), color[2] * (1.2 + 1.6 * iskry.rnd()));
    }
  }
}

const _sparkCol = [1, 1, 1];
function sparkColor(P) {
  const c = P.core;
  const m = Math.max(c[0], c[1], c[2], 1e-3);
  _sparkCol[0] = c[0] / m; _sparkCol[1] = c[1] / m * 0.85; _sparkCol[2] = c[2] / m * 0.6;
  return _sparkCol;
}

function stepShip(ship, dt) {
  const e = ship.e;
  const marka = ship.marka;
  setEngineMode(e, S.tryb);
  stepEngine(e, dt);
  const P = blendPlume(marka, e, ship.P);
  ship.phase += P.flow / P.stretch * dt;
  ship.pPhase += P.pFreq * dt;
  ship.chase = (ship.chase + dt * (0.7 + 2.8 * e.charge + (e.phase === 'hiper-rozruch' ? 1.6 : 0))) % 1;
  ship.chargePulse += dt * (3 + 13 * e.charge);
  ship.U.chase.value = ship.chase;
  animateShip(ship, e, S.time, S.gimbal, ship.pPhase);
  if (!S.warstwy.zar) { ship.U.heat.value = 0; ship.U.lamp.value = 0; }

  if (e.phase === 'warp') copyPlume(ship.G, P);
  if (e.ev & EV_WARP_WYJSCIE) {
    ship.ghost.on = true; ship.ghost.t = 0; ship.ghost.phase = ship.phase; ship.ghost.pPhase = ship.pPhase;
    ship.ring.on = true; ship.ring.t = 0; ship.ring.dur = 0.5; ship.ring.k = 0.5;
  }
  if (ship.ghost.on) {
    ship.ghost.t += dt;
    ship.ghost.phase += ship.G.flow / ship.G.stretch * dt;
    ship.ghost.pPhase += ship.G.pFreq * dt;
    if (ship.ghost.t >= AUTOMAT.warpExit) ship.ghost.on = false;
  }
  if (e.ev & EV_WARP) { ship.ring.on = true; ship.ring.t = 0; ship.ring.dur = 0.7; ship.ring.k = 1; }
  if (ship.ring.on) { ship.ring.t += dt; if (ship.ring.t >= ship.ring.dur) ship.ring.on = false; }

  if (!ship.visible) return;
  const col = sparkColor(P);
  if (e.ev & EV_BOOST) burst(ship, 14, 0.8, col);
  if (e.ev & EV_HIPER) burst(ship, 30, 1.3, col);
  if (e.ev & EV_WARP) burst(ship, 70, 2.2, col);
  if (!S.warstwy.iskry) return;

  // Iskry ciągłe ze strugi (marki „brudne”) i zbiegające się do dyszy przy ładowaniu warpa.
  ship.sparkAcc += P.sparks * dt;
  while (ship.sparkAcc >= 1) {
    ship.sparkAcc -= 1;
    const n = ship.nozzles[Math.floor(iskry.rnd() * ship.nozzles.length) % ship.nozzles.length];
    const L = lipOf(ship, n);
    const r = n.mount.r;
    const nx = -L.dy;
    const ny = L.dx;
    const lat = (iskry.rnd() - 0.5) * 2;
    const sp = r * Math.abs(P.flow) * (0.22 + 0.4 * iskry.rnd());
    iskry.emit(L.x + nx * lat * n.mount.rw * 0.6, L.y + ny * lat * n.mount.rw * 0.6, NOZZLE_Z + 0.5,
      L.dx * sp + nx * lat * sp * 0.2, L.dy * sp + ny * lat * sp * 0.2,
      0.3 + 0.7 * iskry.rnd(), 0.9 + 1.2 * iskry.rnd(),
      col[0] * (1 + 1.5 * iskry.rnd()), col[1] * (1 + 1.5 * iskry.rnd()), col[2] * (1 + 1.5 * iskry.rnd()));
  }
  if (e.charge > 0.02) {
    const lamp = marka.lampa;
    ship.inAcc += (30 + 170 * e.charge) * ship.nozzles.length * dt;
    while (ship.inAcc >= 1) {
      ship.inAcc -= 1;
      const n = ship.nozzles[Math.floor(iskry.rnd() * ship.nozzles.length) % ship.nozzles.length];
      const L = lipOf(ship, n);
      const r = n.mount.r;
      const nx = -L.dy;
      const ny = L.dx;
      const d = r * (4 + 9 * iskry.rnd());
      const lat = (iskry.rnd() - 0.5) * 2 * (n.mount.rw + d * 0.42);
      const x = L.x + L.dx * d + nx * lat;
      const y = L.y + L.dy * d + ny * lat;
      const life = 0.28 + 0.34 * iskry.rnd();
      const tx = L.x + nx * (iskry.rnd() - 0.5) * n.mount.rw;
      const ty = L.y + ny * (iskry.rnd() - 0.5) * n.mount.rw;
      iskry.emit(x, y, NOZZLE_Z + 0.5, (tx - x) / life, (ty - y) / life, life, 0.9 + 1.1 * iskry.rnd(),
        lamp[0] * 1.6 + 0.5, lamp[1] * 1.6 + 0.5, lamp[2] * 1.6 + 0.5, 1);
    }
  }
}

function stepPokaz(dt) {
  if (!S.petla) return;
  S.pokazT += dt;
  if (S.pokazT >= POKAZ[S.pokazI][1]) {
    S.pokazT = 0;
    S.pokazI++;
    if (S.pokazI >= POKAZ.length) {
      S.pokazI = 0;
      if (S.widok === 'zblizenie') setMarka((S.marka + 1) % MARKI.length, true);
    }
  }
  if (S.tryb !== POKAZ[S.pokazI][0]) { S.tryb = POKAZ[S.pokazI][0]; syncUi(); }
}

function simulate(dt) {
  S.time += dt;
  stepPokaz(dt);
  S.gimbalCel = (S.keys.has('a') ? 1 : 0) - (S.keys.has('d') ? 1 : 0);
  S.gimbal += (S.gimbalCel - S.gimbal) * (1 - Math.exp(-7 * dt));
  for (let i = 0; i < ships.length; i++) {
    ships[i].visible = S.widok === 'galeria' || i === S.marka;
    stepShip(ships[i], dt);
  }
  iskry.update(dt);
  const lead = ships[S.marka].e;
  niebo.update(dt, S.warstwy.gwiazdy ? lead.speed * V_WARP_PX : 0, lead.warp);
}

// ---------------------------------------------------------------------------
// Rysunek klatki

const _p0 = { x: 0, y: 0 };
const _p1 = { x: 0, y: 0 };

function drawShip(ship) {
  const e = ship.e;
  const P = ship.P;
  const marka = ship.marka;
  const zoom = S.cam.zoom;
  let sumR2 = 0;
  let lx = 0;
  let ly = 0;
  let ldx = 0;
  let ldy = 0;
  for (let i = 0; i < ship.nozzles.length; i++) {
    const n = ship.nozzles[i];
    const d = n.mount;
    const L = lipOf(ship, n);
    const fl = flicker(S.time, d.seed, P.sputter);
    const power = P.gain * d.kGain * fl;
    const kLen = d.kLen * (0.82 + 0.18 * fl);
    sumR2 += d.r * d.rw;
    lx += L.x; ly += L.y; ldx += L.dx; ldy += L.dy;
    if (S.warstwy.struga) {
      strugi.add(L.x, L.y, NOZZLE_Z, L.dx, L.dy, d.r, d.rw, P, power, ship.phase + d.seed * 17, ship.pPhase + d.ph, d.seed, 0, kLen);
      if (ship.ghost.on) {
        const k = ship.ghost.t / AUTOMAT.warpExit;
        strugi.add(L.x, L.y, NOZZLE_Z, L.dx, L.dy, d.r, d.rw, ship.G, ship.G.gain * d.kGain * Math.pow(1 - k, 0.7),
          ship.ghost.phase + d.seed * 17, ship.ghost.pPhase + d.ph, d.seed, Math.pow(k, 0.8), d.kLen);
      }
    }
    const nx = -L.dy;
    const ny = L.dx;
    if (S.warstwy.iskry) {
      // Poświata wylotu: dysza szeroka dostaje kilka mniejszych plam w poprzek.
      const cnt = Math.max(1, Math.round(d.rw / d.r));
      const b = P.body;
      const sh = P.sheath;
      const g = power * P.glow * 0.4;
      for (let j = 0; j < cnt; j++) {
        const off = cnt > 1 ? ((j + 0.5) / cnt * 2 - 1) * d.rw * 0.85 : 0;
        blaski.add(L.x + nx * off + L.dx * d.r * 0.3, L.y + ny * off + L.dy * d.r * 0.3, NOZZLE_Z + 0.2, d.r * (3.2 + 0.8 * e.boost + 1.6 * e.warp),
          (b[0] * 0.7 + sh[0] * 0.5) * g, (b[1] * 0.7 + sh[1] * 0.5) * g, (b[2] * 0.7 + sh[2] * 0.5) * g, BLASK_KOLO);
      }
      // Błysk zapłonu / skoku.
      if (e.flash > 0.01) {
        const lamp = marka.lampa;
        const f = e.flash;
        blaski.add(L.x, L.y, NOZZLE_Z + 0.4, d.rw * (5 + 15 * f), (lamp[0] * 0.5 + 0.6) * f * 3.2, (lamp[1] * 0.5 + 0.6) * f * 3.2, (lamp[2] * 0.5 + 0.6) * f * 3.2, BLASK_KOLO);
        if (e.phase === 'warp') {
          // Linia błysku w poprzek osi (jak odblask obiektywu) — tylko przy skoku warpa.
          const half = d.rw * (5 + 14 * f);
          const wd = d.r * 1.3;
          for (const s of [1, -1]) {
            blaski.add(L.x - nx * s * half * 0.5, L.y - ny * s * half * 0.5, NOZZLE_Z + 0.4, wd, f * 2.4, f * 2.4, f * 2.6, BLASK_SMUGA, nx * s, ny * s, half / wd);
          }
        }
      }
      // Kula ładowania warpa: rośnie i pulsuje coraz szybciej.
      if (e.charge > 0.01) {
        const lamp = marka.lampa;
        const c = e.charge;
        const pul = 1 + 0.14 * Math.sin(ship.chargePulse * 6.2831853);
        const g2 = (0.5 + 2.4 * c * c) * pul;
        for (let j = 0; j < cnt; j++) {
          const off = cnt > 1 ? ((j + 0.5) / cnt * 2 - 1) * d.rw * 0.85 : 0;
          blaski.add(L.x + nx * off + L.dx * d.r * 0.5, L.y + ny * off + L.dy * d.r * 0.5, NOZZLE_Z + 0.4, d.r * (2.4 + 5.5 * c) * pul,
            (lamp[0] * 0.7 + 0.35) * g2, (lamp[1] * 0.7 + 0.35) * g2, (lamp[2] * 0.7 + 0.35) * g2, BLASK_KOLO);
        }
      }
    }
    if (S.warstwy.haze && S.haze > 0) {
      toPx(L.x, L.y, NOZZLE_Z, _p0);
      toPx(L.x + L.dx * 100, L.y + L.dy * 100, NOZZLE_Z, _p1);
      const ddx = _p1.x - _p0.x;
      const ddy = _p1.y - _p0.y;
      const pxPer = Math.sqrt(ddx * ddx + ddy * ddy) / 100;
      const r0 = d.rw * zoom * 1.05;
      post.cone(_p0.x, _p0.y, ddx, ddy, r0, P.hazeLen * d.r * pxPer, P.haze * S.haze * power * Math.min(d.r * zoom * 0.2, 9), ship.phase * 0.35 + d.seed * 9);
    }
  }
  const nN = ship.nozzles.length;
  lx /= nN; ly /= nN; ldx /= nN; ldy /= nN;
  // Fala skoku: sama refrakcja, od dysz na zewnątrz.
  if (ship.ring.on && S.warstwy.haze && S.haze > 0) {
    const k = ship.ring.t / ship.ring.dur;
    const R1 = Math.sqrt(sumR2) * 15 * ship.ring.k * zoom;
    toPx(lx, ly, NOZZLE_Z, _p0);
    post.ring(_p0.x, _p0.y, R1 * (1 - (1 - k) * (1 - k)), 8 + 34 * k * ship.ring.k, 15 * ship.ring.k * (1 - k) * (1 - k) * S.haze, 1);
  }
  // Światło strugi na rufie.
  const r0 = Math.sqrt(sumR2 / nN);
  ship.light.position.set(lx + ldx * r0 * 2.4, ly + ldy * r0 * 2.4, 24);
  const sw = marka.swiatlo;
  const fw = Math.min(1, e.flash * 0.8 + e.charge * 0.4);
  ship.light.color.setRGB(sw[0] + (1 - sw[0]) * fw, sw[1] + (1 - sw[1]) * fw, sw[2] + (1 - sw[2]) * fw, THREE.LinearSRGBColorSpace);
  ship.light.intensity = LIGHT_K * sumR2 * (P.gain * (0.35 + 0.65 * Math.min(1.5, P.len / 14)) + 2.5 * e.flash + 1.2 * e.charge * e.charge);
}

function draw() {
  strugi.begin();
  blaski.begin();
  post.begin();
  for (const ship of ships) {
    ship.group.visible = ship.visible;
    if (ship.visible) drawShip(ship);
    else ship.light.intensity = 0;
  }
  if (S.warstwy.iskry) iskry.draw(blaski);
  strugi.U.gain.value = S.gain;
  strugi.commit(viewDir);
  blaski.commit(camera);
  post.commit(W, H);
  if (post.bloomNode) post.bloomNode.strength.value = S.warstwy.bloom ? BLOOM_DEFAULTS.strength : 0;
  niebo.u.gain.value = S.warstwy.gwiazdy ? 1 : 0.35;
}

// ---------------------------------------------------------------------------
// Podpisy i HUD

function updateLabels() {
  const gal = S.widok === 'galeria';
  for (let i = 0; i < ships.length; i++) {
    const el = labels[i];
    if (!gal) { el.style.display = 'none'; continue; }
    toPx(ships[i].slot.x - 150, ships[i].slot.y + 96, 0, _p0);
    el.style.display = '';
    el.style.left = `${_p0.x.toFixed(1)}px`;
    el.style.top = `${_p0.y.toFixed(1)}px`;
    el.style.opacity = i === S.marka ? '1' : '0.8';
  }
  $('tytul').style.display = gal ? 'none' : '';
}

let hudT = 0;
function updateHud(realDt) {
  hudT += realDt;
  if (hudT < 0.2) return;
  hudT = 0;
  const e = ships[S.marka].e;
  const f2 = (v) => v.toFixed(2);
  $('hud').innerHTML = [
    `<b>${S.fps.toFixed(0)} kl/s</b> · CPU ${S.cpuMs.toFixed(2)} ms · strugi ${strugi.count} · blaski ${blaski.count}`,
    `marka <b>${MARKI[S.marka].nazwa}</b> · faza <b>${FAZY_PL[e.phase]}</b>`,
    `ciąg ${f2(e.thr)}  boost ${f2(e.boost)}  hiper ${f2(e.hyper)}  warp ${f2(e.warp)}`,
    `ładowanie ${f2(e.charge)}  żar ${f2(e.heat)}  lampy ${f2(e.lamp)}  prędkość ${f2(e.speed)}`
  ].join('\n');
  $('tryb').textContent = FAZY_PL[e.phase];
}

function syncUi() {
  for (const b of document.querySelectorAll('#tryby button[data-tryb]')) b.classList.toggle('on', b.dataset.tryb === S.tryb);
  for (const b of document.querySelectorAll('#marki button')) b.classList.toggle('on', Number(b.dataset.i) === S.marka);
  $('b-petla').classList.toggle('on', S.petla);
  $('b-zblizenie').classList.toggle('on', S.widok === 'zblizenie');
  $('b-galeria').classList.toggle('on', S.widok === 'galeria');
  $('b-pauza').classList.toggle('on', S.pauza);
  $('b-wolno').classList.toggle('on', S.wolno);
  $('b-kamera').classList.toggle('on', S.kamera3d);
  const m = MARKI[S.marka];
  $('t-nazwa').textContent = m.nazwa;
  $('t-frakcja').textContent = `${m.frakcja} · ${m.typ}`;
  $('t-typ').textContent = m.opis;
}

function setMarka(i, zPokazu = false) {
  S.marka = ((i % MARKI.length) + MARKI.length) % MARKI.length;
  if (!zPokazu && S.petla) { S.pokazI = 0; S.pokazT = 0; }
  syncUi();
}

function setTryb(tryb) {
  if (!TRYBY.includes(tryb)) return;
  S.petla = false;
  S.tryb = tryb;
  syncUi();
}

function setWidok(w) {
  const nowy = w === 'galeria' ? 'galeria' : 'zblizenie';
  if (nowy !== S.widok) S.zoomUser = 1;
  S.widok = nowy;
  syncUi();
}

function setKamera3d(on) {
  S.kamera3d = !!on;
  S.elevCel = S.kamera3d ? 0.95 : 0;
  S.azimCel = S.kamera3d ? -0.5 : 0;
  syncUi();
}

function bindControls() {
  const marki = $('marki');
  MARKI.forEach((m, i) => {
    const b = document.createElement('button');
    b.dataset.i = String(i);
    b.innerHTML = `${m.nazwa} — ${m.frakcja}<small>${m.typ}</small>`;
    b.addEventListener('click', () => { setMarka(i); if (S.widok === 'galeria') setWidok('zblizenie'); });
    marki.appendChild(b);
  });
  for (const b of document.querySelectorAll('#tryby button[data-tryb]')) b.addEventListener('click', () => setTryb(b.dataset.tryb));
  $('b-petla').addEventListener('click', () => { S.petla = !S.petla; S.pokazT = 0; syncUi(); });
  $('b-zblizenie').addEventListener('click', () => setWidok('zblizenie'));
  $('b-galeria').addEventListener('click', () => setWidok('galeria'));
  $('b-pauza').addEventListener('click', () => { S.pauza = !S.pauza; syncUi(); });
  $('b-wolno').addEventListener('click', () => { S.wolno = !S.wolno; syncUi(); });
  $('b-kamera').addEventListener('click', () => setKamera3d(!S.kamera3d));
  $('b-czysto').addEventListener('click', () => toggleCzysto());
  const warstwy = { 'w-struga': 'struga', 'w-haze': 'haze', 'w-iskry': 'iskry', 'w-bloom': 'bloom', 'w-zar': 'zar', 'w-gwiazdy': 'gwiazdy' };
  for (const [id, key] of Object.entries(warstwy)) $(id).addEventListener('change', (ev) => { S.warstwy[key] = ev.target.checked; });
  const suwak = (id, out, set, fmt) => {
    const el = $(id);
    const upd = () => { set(Number(el.value)); $(out).textContent = fmt(Number(el.value)); };
    el.addEventListener('input', upd);
    upd();
  };
  suwak('s-gain', 'o-gain', (v) => { S.gain = v; }, (v) => `×${v.toFixed(2)}`);
  suwak('s-haze', 'o-haze', (v) => { S.haze = v; }, (v) => `×${v.toFixed(2)}`);
  suwak('s-czas', 'o-czas', (v) => { S.czas = v; }, (v) => `×${v.toFixed(2)}`);

  addEventListener('keydown', (ev) => {
    if (ev.target instanceof HTMLInputElement && ev.target.type !== 'range' && ev.target.type !== 'checkbox') return;
    const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    if (k === 'w' && !ev.repeat) { S.keys.add('w'); setTryb(ev.shiftKey ? 'boost' : 'normalny'); return; }
    if (k === 'Shift' && S.keys.has('w')) { setTryb('boost'); return; }
    if (k === 'a' || k === 'd') { S.keys.add(k); return; }
    if (ev.repeat) return;
    if (k === '1') setTryb('normalny');
    else if (k === '2') setTryb('boost');
    else if (k === '3') setTryb('hiper');
    else if (k === '4') setTryb('warp');
    else if (k === '0') setTryb('jalowy');
    else if (k === 'ArrowRight') setMarka(S.marka + 1);
    else if (k === 'ArrowLeft') setMarka(S.marka - 1);
    else if (k === 'g') setWidok(S.widok === 'galeria' ? 'zblizenie' : 'galeria');
    else if (k === 'l') { S.petla = !S.petla; S.pokazT = 0; syncUi(); }
    else if (k === ' ') { ev.preventDefault(); S.pauza = !S.pauza; syncUi(); }
    else if (k === 't') { S.wolno = !S.wolno; syncUi(); }
    else if (k === 'k') setKamera3d(!S.kamera3d);
    else if (k === 'h') toggleCzysto();
    else if (k === 'z') { S.zoomUser = 1; }
  });
  addEventListener('keyup', (ev) => {
    const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    if (k === 'w') { S.keys.delete('w'); setTryb('jalowy'); }
    else if (k === 'Shift' && S.keys.has('w')) setTryb('normalny');
    else S.keys.delete(k);
  });
  addEventListener('blur', () => S.keys.clear());
  const cv = renderer.domElement;
  cv.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    S.zoomUser = Math.min(5, Math.max(0.25, S.zoomUser * Math.exp(-ev.deltaY * 0.0012)));
  }, { passive: false });
  let drag = null;
  cv.addEventListener('contextmenu', (ev) => ev.preventDefault());
  cv.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 2) return;
    drag = { x: ev.clientX, y: ev.clientY, e: S.elevCel, a: S.azimCel };
    cv.setPointerCapture(ev.pointerId);
  });
  cv.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    S.azimCel = drag.a - (ev.clientX - drag.x) * 0.006;
    S.elevCel = Math.min(1.4, Math.max(0, drag.e - (ev.clientY - drag.y) * 0.006));
    S.kamera3d = S.elevCel > 0.02;
    syncUi();
  });
  cv.addEventListener('pointerup', () => { drag = null; });
}

function toggleCzysto() {
  S.czysto = !S.czysto;
  document.body.classList.toggle('czysto', S.czysto);
  computeLayout();
}

function resize() {
  W = innerWidth;
  H = innerHeight;
  renderer?.setSize(W, H);
  if (ships.length) computeLayout();
}
addEventListener('resize', resize);

// ---------------------------------------------------------------------------
// Pętla

let lastT = 0;
function frame(nowMs) {
  const t0 = performance.now();
  const realDt = Math.min(0.05, Math.max(0, (nowMs - (lastT || nowMs)) / 1000));
  lastT = nowMs;
  S.frame++;
  if (realDt > 0) S.fps = S.fps * 0.94 + (1 / realDt) * 0.06;
  const dt = TEST || S.pauza ? 0 : realDt * S.czas * (S.wolno ? 0.25 : 1);
  if (dt > 0) simulate(dt);
  updateCamera(realDt);
  draw();
  updateLabels();
  pipeline.render();
  S.cpuMs = S.cpuMs * 0.9 + (performance.now() - t0) * 0.1;
  updateHud(realDt);
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

async function start() {
  await initRenderer();
  niebo = new Niebo(scene);
  buildShips();
  strugi = new StrugaBatch({ scene });
  blaski = new Blaski({ scene });
  buildPipeline();
  bindControls();
  computeLayout();
  syncUi();
  // Pierwsza klatka od razu z pracującym silnikiem (bez dojazdu kanałów od zera).
  for (let i = 0; i < 90; i++) simulate(1 / 60);
  S.time = 0;
  updateCamera(0, true);
  $('loading').textContent = 'Kompilacja shaderów…';
  await new Promise((r) => setTimeout(r, 20));
  draw();
  // Kompilacja przed pierwszym renderem zostawiłaby węzły „raz na render” oznaczone jako aktualne (pułapka 45).
  if (renderer.info.calls === 0) renderer.info.calls = 1;
  try { await renderer.compileAsync(scene, camera); } catch (err) { console.warn('compileAsync', err); }
  $('loading').style.display = 'none';
  S.ready = true;
  window.__silniki = {
    S, ships, MARKI, renderer,
    gotowe: true,
    /** { marka: 'ares' | indeks, tryb, widok: 'galeria' | 'zblizenie', petla, kamera3d, czysto } */
    ustaw(o = {}) {
      if (o.petla !== undefined) S.petla = !!o.petla;
      if (o.marka !== undefined) setMarka(typeof o.marka === 'number' ? o.marka : Math.max(0, MARKI.findIndex((m) => m.id === o.marka)));
      if (o.tryb !== undefined) { S.petla = false; S.tryb = o.tryb; syncUi(); }
      if (o.widok !== undefined) setWidok(o.widok);
      if (o.kamera3d !== undefined) setKamera3d(o.kamera3d);
      if (o.czysto !== undefined && !!o.czysto !== S.czysto) toggleCzysto();
      if (o.zoom !== undefined) S.zoomUser = o.zoom;
      if (o.gimbal !== undefined) { if (o.gimbal > 0) { S.keys.add('a'); S.keys.delete('d'); } else if (o.gimbal < 0) { S.keys.add('d'); S.keys.delete('a'); } else { S.keys.delete('a'); S.keys.delete('d'); } }
    },
    /** Przewija symulację o `sek` (kroki 1/60 s) i czeka na narysowanie klatki. */
    async przewin(sek = 1) {
      const n = Math.max(0, Math.round(sek * 60));
      for (let i = 0; i < n; i++) { simulate(1 / 60); updateCamera(1 / 60); }
      await nextFrame();
      await nextFrame();
      return this.stan();
    },
    stan() {
      const e = ships[S.marka].e;
      return {
        marka: MARKI[S.marka].id, tryb: S.tryb, faza: e.phase, widok: S.widok, fps: +S.fps.toFixed(1), cpuMs: +S.cpuMs.toFixed(2),
        strugi: strugi.count, blaski: blaski.count, iskry: iskry.alive, zrodla: post.n,
        kanaly: { thr: +e.thr.toFixed(3), boost: +e.boost.toFixed(3), hyper: +e.hyper.toFixed(3), warp: +e.warp.toFixed(3), charge: +e.charge.toFixed(3), heat: +e.heat.toFixed(3) },
        bledy: errorsEl.textContent
      };
    }
  };
  renderer.setAnimationLoop((t) => {
    try { frame(t); } catch (err) { reportError(err.stack || String(err)); renderer.setAnimationLoop(null); }
  });
}

start().catch((err) => {
  $('loading').textContent = `Błąd: ${err.message || err}`;
  reportError(err.stack || String(err));
  window.__silniki = { gotowe: false, blad: String(err.stack || err) };
});
