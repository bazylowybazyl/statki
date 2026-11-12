// dema/autostrada.js
//
// DEMO AUTOSTRADY WOKÓŁ ZIEMI (2026-11-06). Host na prawdziwych modułach gry: Core3D (WebGPU, TSL, bloom, ACES), Ziemia gry
// (planet3d.assets.js), ring „Halo” z halami K-7 (HaloRingWorld + HaloRingGame), proxy statków ruchu (ShipProxyBatch3D) i kadłub
// Atlasa na belkach. Jeden świat, kilka sposobów rysowania: ruch i sygnalizacja (dema/autostrada/ruch.js) są wspólne, a style wyglądu
// (dema/autostrada/styl-*.js) przełącza się na żywo w tej samej chwili sekwencji. Zasada: nic z tego nie jest wpięte do gry.
//
// Serwowanie: `npm run dev` → /dema/autostrada.html   ?styl=klisza   ?clean=1 (bez paneli)   ?ring=0 (bez ringu — szybkie strojenie)
//   ?test=1 (klatki tylko z __autostrada.klatki — harness: scripts/webgpu/autostrada-demo.mjs)
import * as THREE from 'three/webgpu';
import { Core3D } from '../src/3d/core3d.js';
import { initHexShips3D, updateHexShips3D, drawHexShips3D, resizeHexShips3D, prewarmHexShips3D } from '../src/3d/hexShips3D.js';
import { HULL_LACQUER_DEFAULTS } from '../src/3d/hullLacquer.js';
import { Fx3D } from '../src/3d/fxParticles3D.js';
import { ShipProxyBatch3D } from '../src/3d/shipProxyBatch3D.js';
import '../src/3d/planet3d.assets.js';
import { SimClock } from '../src/game/simClock.js';
import { buildSystemMap, SYSTEM_MAP_CONSTANTS } from '../src/data/systemMap.js';
import { BELT_DEFINITIONS, getOutermostBeltEdgeAu } from '../src/data/asteroidTypes.js';
import { DEFAULT_PLANET_SCALE } from '../src/config/constants.js';
import { World, loadHullAssets } from './mostki-webgpu/swiat.js';
import { HaloRingWorld } from '../src/game/haloRingWorld.js';
import { HaloRingGame } from '../src/3d/haloRing/haloRingGame.js';
import { utworzRuch, KLASY } from './autostrada/ruch.js';
import { zbudujSiec, hubToWorld, HW, DEG } from './autostrada/siec.js';
import { U, zapiszSygnaly } from './autostrada/wspolne.tsl.js';
import { STYLE } from './autostrada/style.js';
import { utworzBaze } from './autostrada/baza3d.js';
import { utworzCiagniki } from './autostrada/ciagniki3d.js';

const params = new URLSearchParams(location.search);
const TEST = params.get('test') === '1';
const BEZ_RINGU = params.get('ring') === '0';
if (params.get('clean') === '1') document.body.classList.add('clean');
const $ = (id) => document.getElementById(id);
function zglosBlad(text) {
  const el = $('errors');
  el.style.display = 'block';
  el.textContent += `${text}\n`;
  console.error(text);
}
window.addEventListener('error', (e) => zglosBlad(`JS: ${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => zglosBlad(`Promise: ${e.reason?.stack || e.reason}`));

// ---------------------------------------------------------------------------
// Świat: Ziemia z mapy układu gry (promień i ziarno ringu jak w grze), Słońce jak w grze. Kąt orbity dobrany tak, żeby
// hala K-7 nr 0 (315° sceny, prawy dół) stała w świetle bocznym, a część drogi szła nocą (?orbita= [rad] — inna pora).

const SUN = {
  x: 6_000_000, y: 6_000_000, r: SYSTEM_MAP_CONSTANTS.sunRadius,
  color: { core: '#ffe88a', mid: '#ffbe3b', rim: '#ff8c1a' },
  corona: { rays: 72, jitter: 0.35, length: 0.85, pulse: 0.22, haze: 2.8 },
  seed: 93731
};
window.SUN = SUN;
const KAT_ORBITY = Number(params.get('orbita')) || -2.45;

function zbudujZiemie() {
  const belt = getOutermostBeltEdgeAu(BELT_DEFINITIONS);
  const opts = { planetScale: DEFAULT_PLANET_SCALE, sunRadius: SUN.r };
  const { planets, auInWorldUnits } = buildSystemMap(belt, { ...opts, angleFor: (def) => (def.id === 'earth' ? KAT_ORBITY : 0) });
  window.WORLD_UNITS_PER_AU = auInWorldUnits;
  window.AU_IN_WORLD_UNITS = auInWorldUnits;
  const p = planets.find((q) => q.id === 'earth');
  if (p.baseR == null) p.baseR = p.r;
  p.x = SUN.x + Math.cos(p.angle) * p.orbitRadius;
  p.y = SUN.y + Math.sin(p.angle) * p.orbitRadius;
  p.label = 'Ziemia';
  return p;
}

// ---------------------------------------------------------------------------
// Render: Core3D + hexShips3D

const canvas2d = $('c');
const ctx2d = canvas2d.getContext('2d');
let W = innerWidth;
let H = innerHeight;
canvas2d.width = W; canvas2d.height = H;
const glCanvas = $('webgl-layer');
glCanvas.width = W; glCanvas.height = H;
window.__hullLacquerTune = { ...HULL_LACQUER_DEFAULTS, skyUrl: 'assets/reflections/lacquer-sky.png' };   // <base href="/">
initHexShips3D({ canvas: glCanvas });
window.Core3D = Core3D;

window.warp = { state: 'idle', isBusy() { return false; } };
const ZOOM_MIN = 0.006;
const ZOOM_MAX = 3.2;
const S = {
  paused: false, tempo: 1, czasSym: 0, akum: 0, styl: null, frameMs: 16, cpuMs: 0, simMs: 0,
  zoomBaza: 0.06, tryb: 'gra', sledz: null, sledzKlasa: null, autoAtlas: params.get('atlas') !== '0', tAtlas: 18, klatka: 0,
  kino: { az: -0.9, el: 0.32, dist: 170000, cel: { x: 0, y: 0, z: 0 } }
};
const cam = { x: 0, y: 0, zoom: 0.06 };
const camGra = cam;
const camKino = { mode: 'free3d', position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), fov: 40, near: 200, far: 900000, zoom: 1, x: 0, y: 0 };
window.camera = { x: 0, y: 0, zoom: 0.06, targetZoom: 0.06, minZoom: ZOOM_MIN, maxZoom: ZOOM_MAX, mode: 'ship', addShake() {} };
const cullInfo = { x: 0, y: 0, halfW: 1e5, halfH: 1e5, drawHalfW: 1e5, drawHalfH: 1e5 };
const lista3d = [];

let ziemia = null;
let swiat = null;
let atlasEnt = null;
let haloWorld = null;
let haloRings = null;
let ruch = null;
let siec = null;
let grupa = null;
let baza = null;
let ciagniki = null;
const style = new Map();
// Ślady pojazdów (decyzja użytkownika w toku: „czy te ślady są w ogóle potrzebne”): przełącznik do oceny na żywo.
const TRYBY_SLADOW = Object.freeze(['daleko', 'pelne', 'brak']);
const kontekst = {
  slady: TRYBY_SLADOW.includes(params.get('slady')) ? params.get('slady') : 'daleko',
  barwySladow: params.get('barwy') === 'kierunek' ? 'kierunek' : 'jednostka'
};
const shipView = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, angle: 0, w: 650, h: 1800, dead: false };

// Scena (lokalnie: Ziemia w 0, y w górę) → gra.
const graX = (sx) => ziemia.x + sx;
const graY = (sy) => ziemia.y - sy;

// ---------------------------------------------------------------------------
// Ruch: krok stały 0,1 s, pozy w chwili klatki

function krokRuchu(dt) {
  S.akum += dt;
  const t0 = performance.now();
  let n = 0;
  while (S.akum >= ruch.dt && n < 6) {
    ruch.step();
    S.akum -= ruch.dt;
    n++;
  }
  if (S.akum > ruch.dt * 2) S.akum = ruch.dt;
  ruch.odswiezPozy(S.akum);
  S.simMs = S.simMs * 0.9 + (performance.now() - t0) * 0.1;
  S.czasSym += dt;
  if (S.autoAtlas) {
    S.tAtlas -= dt;
    if (S.tAtlas <= 0 && ruch.atlas.stan === 'dok') { ruch.atlasStart(); S.tAtlas = 75; }
  }
}

// ---------------------------------------------------------------------------
// Klatka

const HULL_MIN_PX = 1.4;
function wyslijProxy(kam) {
  // Kadr gry: tylko w widoku; kamera kinowa — wszystko w zasięgu (proxy sam obcina).
  const gra = S.tryb === 'gra';
  const hw = gra ? W * 0.5 / kam.zoom + 1500 : Infinity;
  const hh = gra ? H * 0.5 / kam.zoom + 1500 : Infinity;
  const zoom = gra ? kam.zoom : 0.1;
  ShipProxyBatch3D.begin(kam);
  const lista = ruch.pojazdy;
  for (let i = 0; i < lista.length; i++) {
    const v = lista[i];
    const hull = v.k.hull;
    if (!hull) continue;
    const gx = graX(v.x);
    const gy = graY(v.y);
    if (Math.abs(gx - kam.x) > hw || Math.abs(gy - kam.y) > hh) continue;
    if (v.L * zoom < HULL_MIN_PX) continue;
    const c = Math.cos(v.h) * v.vel;
    const s = Math.sin(v.h) * v.vel;
    ShipProxyBatch3D.push(v.id, hull, gx, gy, -v.h, { vx: c, vy: -s, throttle: v.vel > 8 ? (v.hamuje ? 0.15 : 0.75) : 0, opacity: v.alfa });
  }
  ShipProxyBatch3D.end();
}

function pozaAtlasa() {
  const a = ruch.atlas;
  if (!atlasEnt) return;
  const gx = graX(a.xs);
  const gy = graY(a.ys);
  atlasEnt.x = gx;
  atlasEnt.y = gy;
  atlasEnt.angle = -a.kat;
  const v = a.stan === 'lot' ? a.v : 0;
  atlasEnt.vx = Math.cos(-a.kat) * v;
  atlasEnt.vy = Math.sin(-a.kat) * v;
  for (const t of atlasEnt.visual?.mainThrusters || []) t.__throttle = a.stan === 'lot' ? 0.8 : 0;
  shipView.pos.x = gx; shipView.pos.y = gy; shipView.vel.x = atlasEnt.vx; shipView.vel.y = atlasEnt.vy; shipView.angle = atlasEnt.angle;
}

function aktualnaKamera() {
  if (S.tryb === 'gra') {
    cam.zoom = S.zoomBaza;
    const c = window.camera;
    c.x = cam.x; c.y = cam.y; c.zoom = cam.zoom; c.targetZoom = cam.zoom;
    return camGra;
  }
  const k = S.kino;
  const ce = Math.cos(k.el);
  const px = k.cel.x + Math.cos(k.az) * ce * k.dist;
  const py = k.cel.y + Math.sin(k.az) * ce * k.dist;
  const pz = k.cel.z + Math.sin(k.el) * k.dist;
  // Układ sceny Core3D: x, −y gry, z. Cel kamery kinowej w scenie drogi → Core3D: dodać środek Ziemi.
  const ox = ziemia.x; const oy = -ziemia.y;
  _kamPom.position.set(ox + px, oy + py, pz);
  _kamPom.up.set(0, 0, 1);
  _kamPom.lookAt(ox + k.cel.x, oy + k.cel.y, k.cel.z);
  camKino.position.copy(_kamPom.position);
  camKino.quaternion.copy(_kamPom.quaternion);
  camKino.x = ox + px;
  camKino.y = -(oy + py);
  camKino.zoom = 1;
  return camKino;
}
const _kamPom = new THREE.PerspectiveCamera();

function ustawUniformy(kam) {
  const pxScale = Core3D.pxScale || 1;
  U.czas.value = S.czasSym;
  if (S.tryb === 'gra') {
    U.persp.value = 0;
    U.jPxNaW.value = 1 / (kam.zoom * pxScale);
    U.zoom.value = kam.zoom;
  } else {
    U.persp.value = 1;
    const h = Core3D.height || H;
    U.jPxNaW.value = 2 * Math.tan(camKino.fov * 0.5 * DEG) / (h * pxScale);
    U.zoom.value = Math.max(0.006, (h * 0.5) / (S.kino.dist * Math.tan(camKino.fov * 0.5 * DEG)));
  }
  zapiszSygnaly(ruch.K7);
  // Słońce w układzie sceny drogi: y sceny = −y gry.
  const sx = SUN.x - ziemia.x;
  const sy = -(SUN.y - ziemia.y);
  const l = Math.hypot(sx, sy) || 1;
  U.slonce.value.set(sx / l, sy / l, 0.25);
}

function klatka(realDt) {
  const t0 = performance.now();
  const dt = S.paused ? 0 : realDt * S.tempo;
  if (dt > 0) krokRuchu(dt);
  else ruch.odswiezPozy(S.akum);
  sledzenie(realDt);
  sterowanieKlawiszami(realDt);
  const kam = aktualnaKamera();
  pozaAtlasa();
  ustawUniformy(kam);
  if (S.tryb !== 'gra') Core3D.syncCamera(kam);
  SimClock.advance(dt);
  SimClock.beginRender(1, 1 / 60, S.paused);
  window.updatePlanets3D(dt, kam);
  if (haloWorld) haloWorld.frame({ nowMs: performance.now(), gameDt: dt, ship: shipView, sun: SUN });
  if (haloRings) haloRings.update(realDt, kam, { sun: SUN, ship: shipView, gameDt: dt, quality: params.get('jakosc') || 'high', splitScreen: false });
  grupa.position.set(ziemia.x, -ziemia.y, -30);
  grupa.updateMatrixWorld(true);
  const kl = { dt, realDt, tau: S.akum, zoom: U.zoom.value, kam, tryb: S.tryb, W, H, gra: S.tryb === 'gra' };
  S.styl?.aktualizuj(kl);
  baza?.aktualizuj(kl);
  ciagniki?.aktualizuj(kl);
  wyslijProxy(kam);
  Fx3D.update(dt);
  const z = S.tryb === 'gra' ? kam.zoom : 0.1;
  cullInfo.x = kam.x; cullInfo.y = kam.y;
  cullInfo.drawHalfW = W * 0.5 / z + 900;
  cullInfo.drawHalfH = H * 0.5 / z + 900;
  cullInfo.halfW = cullInfo.drawHalfW * 3;
  cullInfo.halfH = cullInfo.drawHalfH * 3;
  lista3d.length = 0;
  if (ruch.atlas.widoczny && swiat) for (const e of swiat.entities()) lista3d.push(e);
  const silniki = ShipProxyBatch3D.engineEntities;
  for (let i = 0; i < silniki.length; i++) lista3d.push(silniki[i]);
  updateHexShips3D(kam, lista3d, S.tryb === 'gra' ? cullInfo : null);
  drawHexShips3D(ctx2d, W, H);
  S.cpuMs = S.cpuMs * 0.9 + (performance.now() - t0) * 0.1;
  S.klatka++;
  pokazHud();
}

// ---------------------------------------------------------------------------
// Style, kamera, galeria

function ustawStyl(id) {
  const st = style.get(id);
  if (!st) return false;
  for (const q of style.values()) for (const m of q.siatki) m.visible = q === st;
  S.styl = st;
  kontekst.silaPodkladu = st.podklad ?? 0.55;
  kontekst.silaRamp = st.podkladRamp ?? 0.75;
  kontekst.silaRozdzial = st.podkladRozdzial ?? 1;
  kontekst.silaTorow = st.tory ?? 1;
  kontekst.silaBaru = st.barBazy ?? 1;
  kontekst.promienZiemi = st.promienZiemi ?? 0;
  $('styl-k').textContent = st.nazwa;
  $('styl-d').textContent = st.opis;
  for (const b of document.querySelectorAll('#style button')) b.classList.toggle('on', b.dataset.id === id);
  return true;
}

function naKat(aDeg, r) { return { x: Math.cos(aDeg * DEG) * r, y: Math.sin(aDeg * DEG) * r }; }
function patrzNa(sx, sy, zoom) {
  S.tryb = 'gra';
  S.sledz = null;
  S.sledzKlasa = null;
  cam.x = graX(sx);
  cam.y = graY(sy);
  S.zoomBaza = zoom;
  odswiezPrzyciski();
}
const skala = (z) => z * Math.max(0.6, H / 1080);

const GALERIA = [
  { id: 'wezel', tytul: 'Skrzyżowanie z K-7', ustaw: () => { const p = naKat(315, 58500); patrzNa(p.x, p.y, skala(0.06)); } },
  { id: 'kolejka', tytul: 'Linia stopu, kolejka', ustaw: () => { const p = naKat(315 + 5.5, HW.iL3); patrzNa(p.x, p.y, skala(0.3)); } },
  { id: 'zatoka', tytul: 'Zatoka: wjazd i zjazd', ustaw: () => { const p = naKat(301.846, 56500); patrzNa(p.x, p.y, skala(0.11)); } },
  { id: 'wrota', tytul: 'Wrota: dolot z kosmosu', ustaw: () => { const p = naKat(329, 69000); patrzNa(p.x, p.y, skala(0.06)); } },
  { id: 'zawrotka', tytul: 'Zawrotka w pasie rozdziału', ustaw: () => { const p = naKat(343, HW.median); patrzNa(p.x, p.y, skala(0.3)); } },
  { id: 'tranzyt', tytul: 'Tranzyt: zjazd ku Ziemi', ustaw: () => { const p = naKat(0, 52500); patrzNa(p.x, p.y, skala(0.07)); } },
  { id: 'bramownica', tytul: 'Bramownica z bliska', ustaw: () => { const p = naKat(315 + 3.92, HW.iL2); patrzNa(p.x, p.y, skala(0.8)); } },
  { id: 'luk', tytul: 'Łuk wokół Ziemi', ustaw: () => { const p = naKat(270, 52000); patrzNa(p.x, p.y, skala(0.03)); } },
  { id: 'calosc', tytul: 'Cały pierścień z góry', ustaw: () => patrzNa(0, 0, H / (2.25 * HW.edgeOut)) },
  { id: 'kino', tytul: 'Kamera kinowa', ustaw: () => { S.tryb = 'kino'; S.sledz = null; S.kino.az = -0.9; S.kino.el = 0.32; S.kino.dist = 175000; S.kino.cel = { x: 0, y: 0, z: 0 }; odswiezPrzyciski(); } },
  { id: 'kinoBlisko', tytul: 'Kino: nad węzłem K-7', ustaw: () => { const p = naKat(315, 62000); S.tryb = 'kino'; S.sledz = null; S.kino.az = -1.35; S.kino.el = 0.22; S.kino.dist = 22000; S.kino.cel = { x: p.x, y: p.y, z: 0 }; odswiezPrzyciski(); } }
];

const JEDNOSTKI = [
  { id: 'ciezarowka', tytul: 'Ciężarówka', z: 1.1 },
  { id: 'policja', tytul: 'Policja', z: 0.9 },
  { id: 'prom', tytul: 'Workforce', z: 1.0 },
  { id: 'turysta', tytul: 'Turystyka', z: 0.8 },
  { id: 'kontenerowiec', tytul: 'Frachtowiec', z: 0.6 },
  { id: 'ciezki', tytul: 'Ciężki przez K-7', z: 0.14 }
];

function sledzKlase(id, zoom) {
  S.tryb = 'gra';
  S.sledzKlasa = id;
  S.sledz = null;
  S.zoomBaza = skala(zoom);
  odswiezPrzyciski();
}
function sledzenie(realDt) {
  if (!S.sledzKlasa) return;
  if (!S.sledz || S.sledz.alfa <= 0.05 || !ruch.pojazdy.includes(S.sledz)) {
    // Najbliższy pojazd klasy w kadrze, a poza nim — dowolny; najchętniej na pasie głównym.
    let naj = null;
    let d = Infinity;
    for (const v of ruch.pojazdy) {
      if (v.k.id !== S.sledzKlasa || v.alfa < 0.8) continue;
      if (S.sledzKlasa !== 'ciezki' && v.tryb !== 0) continue;
      const q = Math.hypot(graX(v.x) - cam.x, graY(v.y) - cam.y);
      if (q < d) { d = q; naj = v; }
    }
    S.sledz = naj;
  }
  const v = S.sledz;
  if (!v) return;
  const k = Math.min(1, realDt * 6);
  cam.x += (graX(v.x) - cam.x) * k;
  cam.y += (graY(v.y) - cam.y) * k;
}

// ---------------------------------------------------------------------------
// UI

const klawisze = new Set();
function sterowanieKlawiszami(realDt) {
  if (S.tryb !== 'gra') return;
  const sp = 900 / cam.zoom * realDt * (klawisze.has('shift') ? 3 : 1);
  if (klawisze.has('w')) { cam.y -= sp; S.sledzKlasa = null; }
  if (klawisze.has('s')) { cam.y += sp; S.sledzKlasa = null; }
  if (klawisze.has('a') && !klawisze.has('shift')) { cam.x -= sp; S.sledzKlasa = null; }
  if (klawisze.has('d')) { cam.x += sp; S.sledzKlasa = null; }
}

function odswiezPrzyciski() {
  for (const b of document.querySelectorAll('#jednostki button')) b.classList.toggle('on', b.dataset.id === S.sledzKlasa);
}

function zbudujPanel() {
  const boxS = $('style');
  let i = 1;
  for (const st of style.values()) {
    const b = document.createElement('button');
    b.dataset.id = st.id;
    b.innerHTML = `${st.nazwa}<kbd>${i}</kbd><small>${st.opis}</small>`;
    b.addEventListener('click', () => ustawStyl(st.id));
    boxS.appendChild(b);
    i++;
  }
  const boxG = $('galeria');
  GALERIA.forEach((g) => {
    const b = document.createElement('button');
    b.textContent = g.tytul;
    b.addEventListener('click', g.ustaw);
    boxG.appendChild(b);
  });
  const boxJ = $('jednostki');
  JEDNOSTKI.forEach((j) => {
    const b = document.createElement('button');
    b.dataset.id = j.id;
    b.textContent = j.tytul;
    b.addEventListener('click', () => sledzKlase(j.id, j.z));
    boxJ.appendChild(b);
  });
  for (const b of document.querySelectorAll('#slady button')) b.addEventListener('click', () => ustawSlady(b.dataset.id));
  for (const b of document.querySelectorAll('#barwy button')) b.addEventListener('click', () => ustawBarwy(b.dataset.id));
  ustawSlady(kontekst.slady);
  ustawBarwy(kontekst.barwySladow);
  $('btn-atlas').addEventListener('click', () => { startAtlasa(false); });
  $('btn-dopalacz').addEventListener('click', () => { startAtlasa(true); });
  $('btn-pauza').addEventListener('click', () => { S.paused = !S.paused; $('btn-pauza').classList.toggle('on', S.paused); });
  $('btn-czysto').addEventListener('click', () => document.body.classList.toggle('clean'));
  const gest = $('gestosc');
  const tempo = $('tempo');
  const sync = () => {
    ruch.cfg.gestosc = Number(gest.value);
    S.tempo = Number(tempo.value);
    $('gestosc-v').textContent = `×${Number(gest.value).toFixed(2)}`;
    $('tempo-v').textContent = `×${Number(tempo.value).toFixed(2)}`;
  };
  gest.addEventListener('input', sync);
  tempo.addEventListener('input', sync);
  sync();
}

function ustawSlady(id) {
  if (!TRYBY_SLADOW.includes(id)) return false;
  kontekst.slady = id;
  for (const b of document.querySelectorAll('#slady button')) b.classList.toggle('on', b.dataset.id === id);
  return true;
}
function ustawBarwy(id) {
  kontekst.barwySladow = id === 'kierunek' ? 'kierunek' : 'jednostka';
  for (const b of document.querySelectorAll('#barwy button')) b.classList.toggle('on', b.dataset.id === kontekst.barwySladow);
}

function startAtlasa(dopalacz) {
  S.autoAtlas = false;
  if (!ruch.atlasStart({ dopalacz })) return false;
  const p = naKat(315, 58500);
  patrzNa(p.x, p.y, skala(0.06));
  return true;
}

function podepnijWejscie() {
  addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT')) return;
    const k = e.key.toLowerCase();
    if (k === 'shift') klawisze.add('shift');
    if (['w', 'a', 's', 'd'].includes(k)) klawisze.add(k);
    if (e.repeat) return;
    if (/^[1-9]$/.test(k)) {
      const lista = [...style.values()];
      const st = lista[Number(k) - 1];
      if (st) ustawStyl(st.id);
    }
    if (k === 'a' && e.shiftKey) { startAtlasa(true); return; }
    if (k === 'a' && !klawisze.has('w') && !klawisze.has('s') && !klawisze.has('d')) { if (ruch.atlas.stan === 'dok') startAtlasa(false); }
    if (k === ' ') { e.preventDefault(); S.paused = !S.paused; $('btn-pauza').classList.toggle('on', S.paused); }
    if (k === 'h') document.body.classList.toggle('clean');
    if (k === 't') ustawSlady(TRYBY_SLADOW[(TRYBY_SLADOW.indexOf(kontekst.slady) + 1) % TRYBY_SLADOW.length]);
    if (k === 'k') ustawBarwy(kontekst.barwySladow === 'jednostka' ? 'kierunek' : 'jednostka');
  });
  addEventListener('keyup', (e) => klawisze.delete(e.key.toLowerCase()));
  addEventListener('blur', () => klawisze.clear());
  let ciag = 0;
  let lx = 0;
  let ly = 0;
  canvas2d.addEventListener('pointerdown', (e) => { ciag = 1; lx = e.clientX; ly = e.clientY; canvas2d.setPointerCapture(e.pointerId); });
  canvas2d.addEventListener('pointerup', () => { ciag = 0; });
  canvas2d.addEventListener('pointermove', (e) => {
    if (!ciag) return;
    const dx = e.clientX - lx;
    const dy = e.clientY - ly;
    lx = e.clientX;
    ly = e.clientY;
    if (S.tryb === 'gra') {
      cam.x -= dx / cam.zoom;
      cam.y -= dy / cam.zoom;
      S.sledzKlasa = null;
      odswiezPrzyciski();
    } else {
      S.kino.az -= dx * 0.004;
      S.kino.el = Math.max(0.03, Math.min(1.5, S.kino.el + dy * 0.004));
    }
  });
  canvas2d.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (S.tryb === 'gra') S.zoomBaza = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, S.zoomBaza * Math.exp(-e.deltaY * 0.0012)));
    else S.kino.dist = Math.max(2000, Math.min(400000, S.kino.dist * Math.exp(e.deltaY * 0.0012)));
  }, { passive: false });
  addEventListener('resize', () => {
    W = innerWidth;
    H = innerHeight;
    canvas2d.width = W;
    canvas2d.height = H;
    glCanvas.width = W;
    glCanvas.height = H;
    Core3D.resize(W, H);
    resizeHexShips3D?.(W, H);
  });
}

let hudN = 0;
const NAZWY_FAZ = ['ZIELONE', 'ŻÓŁTE', 'CZERWONE · czyszczenie', 'CZERWONE · przejazd', 'CZERWONE · zwolnienie'];
function pokazHud() {
  if (++hudN % 12) return;
  const info = Core3D.lastFrameRenderInfo?.total || Core3D.renderer?.info?.render || {};
  const w = ruch.K7[ruch.atlas.K];
  const kl = w.stan === 2 ? 'r' : w.stan === 1 ? 'y' : 'g';
  const L = ruch.licznik;
  const linie = [
    `<b>${(1000 / Math.max(1, S.frameMs)).toFixed(0)} kl./s</b> · CPU ${S.cpuMs.toFixed(1)} ms · ruch ${S.simMs.toFixed(2)} ms · GPU ${(Number(Core3D.gpuFrameMs) || 0).toFixed(1)} ms · rysunki ${info.drawCalls ?? info.calls ?? 0}`,
    `na drodze ${ruch.pojazdy.length}: ciężarówki ${L.ciezarowka}, workforce ${L.prom}, frachtowce ${L.kontenerowiec + L.dalekobiezny + L.tankowiec}, turyści ${L.turysta}, policja ${L.policja}, ciężkie ${L.ciezki + L.mega}`,
    `K-7 Atlasa <span class="${kl}">${NAZWY_FAZ[w.faza]}</span> · stoi ${w.stoi[0]} + ${w.stoi[1]}, ogon ${(w.kolejka[0] / 1000).toFixed(1)} / ${(w.kolejka[1] / 1000).toFixed(1)} km · Atlas: ${ruch.atlas.stan}`,
    S.tryb === 'gra' ? `kamera gry · zoom ${cam.zoom.toFixed(3)}` : `kamera kinowa · ${(S.kino.dist / 1000).toFixed(0)} km od celu`
  ];
  $('hud').innerHTML = linie.join('\n');
}

// ---------------------------------------------------------------------------
// Pętla, API harnessu, start

let ostatni = 0;
function petla(now) {
  const dt = ostatni ? Math.min(0.1, (now - ostatni) / 1000) : 1 / 60;
  ostatni = now;
  S.frameMs = S.frameMs * 0.9 + dt * 1000 * 0.1;
  klatka(dt);
  if (!TEST) requestAnimationFrame(petla);
}

window.__autostrada = {
  gotowe: false, S, cam,
  get ruch() { return ruch; },
  get siec() { return siec; },
  ustawStyl, ustawSlady, ustawBarwy,
  galeria(id) { const g = GALERIA.find((q) => q.id === id); if (g) g.ustaw(); return !!g; },
  patrz(sx, sy, zoom) { patrzNa(sx, sy, zoom); },
  kino(k) { S.tryb = 'kino'; Object.assign(S.kino, k); },
  sledz(id, z) { sledzKlase(id, z); },
  atlas(o) { S.autoAtlas = false; return ruch.atlasStart(o); },
  auto(on) { S.autoAtlas = !!on; },
  /** n klatek po 1/fps s; harness zrzutów. */
  async klatki(n = 1, fps = 60) {
    for (let i = 0; i < n; i++) {
      klatka(1 / fps);
      if ((i % 6) === 5) await new Promise((ok) => requestAnimationFrame(() => ok()));
    }
    return true;
  },
  /** Szybki przewin ruchu bez obrazu [s] (scena Atlasa: sekundy po starcie). */
  przewin(s) {
    const n = Math.round(s / ruch.dt);
    for (let i = 0; i < n; i++) ruch.step();
    ruch.odswiezPozy(0);
    S.czasSym += s;
  },
  stan() {
    const w = ruch.K7[ruch.atlas.K];
    return {
      czas: +ruch.czas.toFixed(1), n: ruch.pojazdy.length, faza: w.faza, stoi: [...w.stoi], ogon: w.kolejka.map((x) => x | 0), atlas: ruch.atlas.stan, z: ruch.atlas.z | 0,
      styl: S.styl?.id, cpu: +S.cpuMs.toFixed(2), gpu: +(Number(Core3D.gpuFrameMs) || 0).toFixed(2), stat: { ...ruch.stat }
    };
  }
};

(async () => {
  try {
    await loadHullAssets(['atlas']);
    if (!(await Core3D.ready)) {
      $('nogpu').style.display = 'flex';
      $('nogpu-detail').textContent = Core3D.gpuError || 'brak adaptera WebGPU';
      $('loading').style.display = 'none';
      window.__autostrada.blad = 'webgpu';
      return;
    }
    ziemia = zbudujZiemie();
    window.planets = [ziemia];
    window.initPlanets3D([ziemia], SUN);
    await Core3D.warmup.run('kadłuby (hexShips3D)', () => prewarmHexShips3D({ canvas: glCanvas }));
    if (!BEZ_RINGU) {
      haloWorld = new HaloRingWorld({ planets: [ziemia] });
      haloRings = new HaloRingGame({ world: haloWorld, quality: params.get('jakosc') || 'high' });
      window.__haloRings = haloRings;
      window.__haloWorld = haloWorld;
      haloRings.showcaseRing('earth');
    }
    swiat = new World();
    atlasEnt = swiat.add('atlas', { x: ziemia.x + 40000, y: ziemia.y + 40000, angle: 0, throttle: 0 });
    window.ship = atlasEnt;

    siec = zbudujSiec();
    ruch = utworzRuch({ siec, gestosc: Number(params.get('gestosc')) || 1 });
    ruch.rozruch();
    for (let i = 0; i < 300; i++) ruch.step();    // 30 s rozruchu: zgęstnienie przy zjazdach, zanim ktoś spojrzy
    ruch.odswiezPozy(0);

    grupa = new THREE.Group();
    grupa.name = 'Autostrada';
    grupa.position.set(ziemia.x, -ziemia.y, -30);
    Core3D.scene.add(grupa);
    Object.assign(kontekst, { grupa, ruch, siec, Core3D, ziemia });
    baza = utworzBaze(kontekst);
    ciagniki = utworzCiagniki(kontekst);
    for (const utworz of STYLE) {
      const st = utworz(kontekst);
      style.set(st.id, st);
      Core3D.warmup.add({ name: `autostrada: ${st.id}`, objects: () => st.siatki, phase: 'loading' });
    }
    Core3D.warmup.add({ name: 'autostrada: baza', objects: () => baza.siatki, phase: 'loading' });
    Core3D.warmup.add({ name: 'autostrada: ciągniki', objects: () => ciagniki.siatki, phase: 'loading' });
    zbudujPanel();
    podepnijWejscie();
    GALERIA[0].ustaw();
    const wybrany = params.get('styl');
    ustawStyl(style.has(wybrany) ? wybrany : style.keys().next().value);
    klatka(1 / 60);
    await Core3D.warmup.flush?.({ timeoutMs: 8000 });
    $('loading').style.display = 'none';
    window.__autostrada.gotowe = true;
    if (!TEST) requestAnimationFrame(petla);
  } catch (err) {
    zglosBlad(err.stack || String(err));
  }
})();
void hubToWorld; void KLASY;
