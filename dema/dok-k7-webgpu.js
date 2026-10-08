// dema/dok-k7-webgpu.js
//
// DEMO SAMEGO DOKU K-7 (2026-10-07, prośba użytkownika: „stwórz mi demo, w którym będzie sam dock” — dopracowanie
// dokowania i oddokowania; przewody paliwowe „chodzą twardo i nierealistycznie”, mają „buchać dymem we wszystkie
// strony po obwodzie” przy przypinaniu i odpinaniu; suwnice „nie mają żadnej roli — cargo będą ładowały drony”;
// „brak jest rur”). Te same moduły co gra:
//  • hala K-7 (src/3d/haloRing/haloPortK7.js — bryły, rurociągi i zbiorniki paliwa, ramiona SCARA, złączki, rura
//    przewodu z liny; fizyka ramion i przewodów: haloPortK7Fuel.js) na uniformach ringu Ziemi, bez samego ringu;
//  • pył i para hali (src/3d/gasField/hallDust.js: pole gazu z buchami promieniowymi dookoła złączek + kłęby pary
//    z puli dymu rakiet), światła hali w siatce świateł Core3D;
//  • automat obsługi stanowisk gry swobodnej (src/game/k7BerthService.js), sekwencje podpinania / odpinania
//    (haloPortK7Layout.js — te same co fabuła i automat portu), model lotu K-7 z kolizjami hali;
//  • Atlas na silniku belek (HullBodies, skóra hexShips3D, dysze i światła z edytora), prawdziwe Core3D.
// Pokaz w pętli: przewody podpięte → ODDOKUJ (upust, odryglowanie, złączki w górę, ramiona się składają) → postój →
// podpięcie (zamki, ramiona nad wlewy, złączki na wlewy, rygle) → … Ruszenie statku przerywa pokaz.
//
// Serwowanie: `npm run dev` → /dema/dok-k7-webgpu.html (?shot=1 — bez paneli, ?noc=1, ?widok=3d-ramie, ?pokaz=0).
// Konsola: window.__dok (stan, sekwencje, widoki), window.K7FuelTune (fizyka), window.HallDustTune (gaz).

import * as THREE from 'three';
import { Core3D } from '../src/3d/core3d.js';
import { drawHexShips3D, initHexShips3D, prewarmHexShipVisual, resizeHexShips3D, updateHexShips3D } from '../src/3d/hexShips3D.js';
import { Fx3D } from '../src/3d/fxParticles3D.js';
import { SparkSystem3D } from '../src/3d/sparkSystem3D.js';
import { createRocketFx } from '../src/3d/rockets/rocketFx.js';
import { initRocketSystem3D } from '../src/effects3d/rocketSystem3D.js';
import { WeaponFx } from '../src/3d/weapons/weaponFx.js';
import { SimClock } from '../src/game/simClock.js';
import { HullBodies } from '../src/game/hullBodies.js';
import { getHullRenderSize } from '../src/data/ships.js';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';
import { createNpcHardpointRuntime } from '../src/game/npcHardpointRuntime.js';
import { createHaloRingLayout } from '../src/3d/haloRing/haloRingLayout.js';
import { createHaloUniforms } from '../src/3d/haloRing/haloRingUniforms.js';
import { HaloPortK7 } from '../src/3d/haloRing/haloPortK7.js';
import {
  K7_CONNECTED_POSE, K7_SERVICE_DOCK, K7_SERVICE_RELEASE, K7_SERVICE_UNDOCK, K7_STOWED_POSE, K7FlightModel, K7RoofFade,
  buildK7Collision, createK7Layout, k7Frame, k7HeightToZ, k7ServiceConnectPose, k7ServiceDisconnectPose, k7ServiceStep
} from '../src/3d/haloRing/haloPortK7Layout.js';
import { K7_FUEL_TUNE, K7_HOSE_NODES, wakeK7FuelRig } from '../src/3d/haloRing/haloPortK7Fuel.js';
import { k7BeaconClock } from '../src/3d/haloRing/haloPortK7Lights.js';
import { HallDust, HALL_DUST_TUNE } from '../src/3d/gasField/hallDust.js';
import { hallToGameAffine, packHallDustFrame } from '../src/game/hallDustInput.js';
import { K7_SERVICE_TUNE, createK7BerthService, k7BerthServiceState, stepK7BerthService, syncK7BerthLamps } from '../src/game/k7BerthService.js';
import atlasUrl from '../assets/capital_ship_rect_v1.png';

const params = new URLSearchParams(location.search);
const shotMode = params.get('shot') === '1';
if (shotMode) document.body.classList.add('shot');
const $ = (id) => document.getElementById(id);

const errors = [];
function reportError(text) {
  errors.push(String(text).slice(0, 2000));
  const el = $('errors');
  el.style.display = 'block';
  el.textContent = errors.join('\n\n');
  console.error(text);
}
window.addEventListener('error', (e) => reportError(`JS: ${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => reportError(`Promise: ${e.reason?.stack || e.reason}`));

// ---------------------------------------------------------------------------
// Core3D jak w grze
const canvas2d = $('c');
const ctx2d = canvas2d.getContext('2d');
const glCanvas = $('webgl-layer');
let W = canvas2d.width = innerWidth;
let H = canvas2d.height = innerHeight;
glCanvas.width = W;
glCanvas.height = H;
initHexShips3D({ canvas: glCanvas });
window.Core3D = Core3D;
window.K7FuelTune = K7_FUEL_TUNE;
window.HallDustTune = HALL_DUST_TUNE;
window.K7ServiceTune = K7_SERVICE_TUNE;
if (!Array.isArray(window.wrecks)) window.wrecks = [];
addEventListener('resize', () => {
  W = canvas2d.width = innerWidth;
  H = canvas2d.height = innerHeight;
  resizeHexShips3D(W, H);
});

// ---------------------------------------------------------------------------
// Hala K-7 na uniformach ringu Ziemi (bez ringu). Umieszczenie: oś x huba → +x gry (w prawo), oś z huba (ku bramie
// G-01) → +y gry (w dół ekranu), hala daleko od zera (precyzja float32 jak w grze — Ziemia leży przy ~6 mln j.).
const P0 = Object.freeze({ x: 6_123_456.7, y: 4_234_567.8 });
const ringLayout = createHaloRingLayout({ seed: 1337, profile: 'earth' });
const ringUniforms = createHaloUniforms(ringLayout);
const layout = createK7Layout();
const frame = k7Frame(ringLayout);
const place = (() => {
  const rot = -Math.PI / 2 - frame.angle;
  const p = { key: 'earth', rot, cos: Math.cos(rot), sin: Math.sin(rot), x: 0, y: 0 };
  const a = hallToGameAffine(p, frame, {});
  const gx = a.p0x + 3200 * a.bx;
  const gy = a.p0y + 3200 * a.by;
  p.x = P0.x - gx;
  p.y = P0.y - gy;
  return p;
})();
const AFF = hallToGameAffine(place, frame, {});
const hubToGame = (x, z, out = {}) => { out.x = AFF.p0x + x * AFF.ax + z * AFF.bx; out.y = AFF.p0y + x * AFF.ay + z * AFF.by; return out; };
const gameToHub = (gx, gy, out = {}) => {
  const dx = gx - AFF.p0x;
  const dy = gy - AFF.p0y;
  const det = AFF.ax * AFF.by - AFF.bx * AFF.ay;
  out.x = (AFF.by * dx - AFF.bx * dy) / det;
  out.z = (AFF.ax * dy - AFF.ay * dx) / det;
  return out;
};
const hubVecToGame = (vx, vz, out = {}) => { out.x = vx * AFF.ax + vz * AFF.bx; out.y = vx * AFF.ay + vz * AFF.by; return out; };

const ringGroup = new THREE.Group();
ringGroup.name = 'Demo: ring (tylko hala K-7)';
ringGroup.rotation.z = place.rot;
ringGroup.position.set(place.x, -place.y, 0);
const hall = new HaloPortK7({ ringLayout, uniforms: ringUniforms, layout, angle: frame.angle, index: 0, bays: [], style: ringLayout.planetProfile.port });
hall.setLayers(1, 2);
for (const b of layout.berths) { b.occupied = null; b.reserved = null; }
hall.setBerthLamps();

// Rejestr hali jak w koliderze gry (pozy obsługi stanowisk capital = stan gry; z nich rysuje hala i biorą się
// źródła gazu), automat obsługi stanowisk gry swobodnej.
const poses = new Map(layout.berths.filter((b) => b.size === 'CAPITAL').map((b) => [b.id, { ...K7_STOWED_POSE, owner: null }]));
const owner = { kind: 'k7', index: 0, complex: 0, layout, frame, poses, lampLevel: 0.22 };
const registry = { halls: [owner], bays: [] };
const collider = { registry, place };
const service = createK7BerthService(registry);
const C01 = layout.berths.find((b) => b.id === 'C-01');
const footprint = layout.footprint.map(([x, z]) => ({ x, z }));
const roof = new K7RoofFade(footprint);

// ---------------------------------------------------------------------------
// Atlas: kadłub na silniku belek (jak gracz — skóra hexShips3D, dysze i światła z edytora), ruch z modelu lotu K-7
const col = buildK7Collision(layout);
const flight = new K7FlightModel(col, { x: C01.x, z: C01.z, angle: C01.angle + Math.PI });
flight.locked = true;
let atlas = null;

async function createAtlas() {
  const img = new Image();
  img.src = atlasUrl;
  await img.decode();
  const size = getHullRenderSize('atlas', img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(64, Math.round(size.w));
  canvas.height = Math.max(64, Math.round(size.h));
  const cx = canvas.getContext('2d', { willReadFrequently: true });
  cx.imageSmoothingEnabled = true;
  cx.drawImage(img, 0, 0, canvas.width, canvas.height);
  prewarmHexShipVisual(img);
  const kx = canvas.width / img.naturalWidth;
  const ky = canvas.height / img.naturalHeight;
  const e = {
    id: 'dok_atlas', x: 0, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0,
    mass: 800000, hp: 12000, maxHp: 12000, type: 'atlas', isPirate: false, shipFrame: 'atlas', isCapitalShip: true,
    faction: 'atlas', __hardpointScaleX: kx, __hardpointScaleY: ky, __hardpointScale: (kx + ky) * 0.5,
    __hullKey: 'atlas', __label: 'Atlas', displayName: 'Atlas', visual: { spriteScale: 1 },
    w: size.w, h: size.h
  };
  const rt = createNpcHardpointRuntime({ defaultShips: SHIP_EDITOR_DEFAULTS.ships, storageKey: 'dokK7Webgpu.noEditorSave' });
  rt.refreshCache(true);
  rt.applyLayoutToNpc(e);
  HullBodies.createHull(e, canvas, { visualImage: img, hullProfileId: 'atlas' });
  if (!e.beamHull) throw new Error('createHull: Atlas bez kadłuba');
  e.pos = { x: 0, y: 0 };
  e.vel = { x: 0, y: 0 };
  return e;
}

const _g = {};
const _v = {};
function syncAtlas(dt) {
  if (!atlas) return;
  hubToGame(flight.x, flight.z, _g);
  hubVecToGame(Math.cos(flight.angle), Math.sin(flight.angle), _v);
  atlas.x = _g.x; atlas.y = _g.y;
  atlas.pos.x = _g.x; atlas.pos.y = _g.y;
  atlas.angle = Math.atan2(_v.y, _v.x);
  hubVecToGame(flight.vx, flight.vz, _v);
  atlas.vx = _v.x; atlas.vy = _v.y;
  atlas.vel.x = _v.x; atlas.vel.y = _v.y;
  atlas.angVel = flight.angVel;
  atlas.dead = !state.showShip;
  const thrust = Math.min(1, Math.max(0, flight.thrust));
  for (const t of atlas.visual?.mainThrusters || []) t.__throttle = thrust;
  if (dt > 0) HullBodies.step(dt, [atlas]);
}

// ---------------------------------------------------------------------------
// Stan dema
const state = {
  T: 0,
  speed: 1,
  paused: false,
  fps: 60,
  view: params.get('widok') || 'stanowisko',
  mode: 'game',
  cam: { x: 0, y: 0, zoom: 0.4 },
  follow: false,
  night: params.get('noc') === '1',
  roofClosed: false,
  showShip: true,
  nodes: false,
  // pokaz / sekwencje obsługi stanowiska C-01 (właściciel pozy 'demo' — automat stanowisk jej nie dotyka)
  loop: params.get('pokaz') !== '0',
  seq: { kind: 'connected', t: 0, hold: 2.5 },
  lastInfo: { calls: 0 }
};

const DEMO_OWNER = 'demo';
const SEQ_LABEL = { connected: 'PODŁĄCZONY', undock: 'ODDOKUJ', stowed: 'ZŁOŻONY', dock: 'PODŁĄCZANIE', release: 'AWARYJNE ODPIĘCIE', auto: 'AUTOMAT STANOWISK' };

function c01Pose() { return poses.get('C-01'); }

function startSeq(kind) {
  const pose = c01Pose();
  // sekwencja odpinania startuje od bieżącej pozy (przerwane podpinanie bez skoku)
  state.seq = { kind, t: 0, hold: kind === 'connected' ? 3 : kind === 'stowed' ? 2.5 : 0, from: { ...pose } };
  pose.owner = DEMO_OWNER;
  flight.locked = kind !== 'auto';
  flight.vx = flight.vz = flight.angVel = 0;
  updateSeqButtons();
}

function stopSeqToAutomat() {
  // stery u gracza: pozę przejmuje automat stanowisk (podpięta → awaryjne odpięcie, gdy statek ruszy)
  state.seq = { kind: 'auto', t: 0, hold: 0 };
  state.loop = false;
  c01Pose().owner = null;
  flight.locked = false;
  updateSeqButtons();
}

function stepSeq(dt) {
  const s = state.seq;
  if (s.kind === 'auto') return;
  const pose = c01Pose();
  pose.owner = DEMO_OWNER;
  s.t += dt;
  if (s.kind === 'connected') {
    Object.assign(pose, K7_CONNECTED_POSE);
    if (state.loop && s.t >= s.hold) startSeq('undock');
  } else if (s.kind === 'stowed') {
    Object.assign(pose, K7_STOWED_POSE);
    if (state.loop && s.t >= s.hold) startSeq('dock');
  } else if (s.kind === 'undock') {
    k7ServiceDisconnectPose(K7_SERVICE_UNDOCK, s.t, s.from, pose);
    if (s.t >= K7_SERVICE_UNDOCK.end) startSeq('stowed');
  } else if (s.kind === 'release') {
    k7ServiceDisconnectPose(K7_SERVICE_RELEASE, s.t, s.from, pose);
    if (s.t >= K7_SERVICE_RELEASE.end) startSeq('stowed');
  } else if (s.kind === 'dock') {
    k7ServiceConnectPose(K7_SERVICE_DOCK, s.t, s.from, pose);
    if (s.t >= K7_SERVICE_DOCK.end) startSeq('connected');
  }
}

function seqStepText() {
  const s = state.seq;
  if (s.kind === 'undock') return k7ServiceStep(K7_SERVICE_UNDOCK, s.t);
  if (s.kind === 'dock') return k7ServiceStep(K7_SERVICE_DOCK, s.t);
  if (s.kind === 'release') return s.t < 0.45 ? 'ODCIĘCIE I ODRYGLOWANIE' : 'SKŁADANIE RAMION';
  if (s.kind === 'connected') return 'PRZEPŁYW PALIWA';
  if (s.kind === 'stowed') return 'RAMIONA ZŁOŻONE';
  const st = k7BerthServiceState(service, 0, 'C-01');
  return st ? `automat C-01: ${st.state}` : '';
}

function resetShip() {
  flight.x = C01.x; flight.z = C01.z; flight.angle = C01.angle + Math.PI;
  flight.vx = flight.vz = flight.angVel = 0;
  flight.thrust = 0;
}

// ---------------------------------------------------------------------------
// Kamera: widok gry (z góry, perspektywa jak Core3D) i kamera 3D (orbita, tryb free3d)
const cine = { persp: new THREE.PerspectiveCamera(45, 1, 10, 600000), target: new THREE.Vector3(), dist: 1600, az: -2.2, el: 0.5, cam: null };
cine.persp.up.set(0, 0, 1);
const VIEWS = {
  stanowisko: { key: '1', label: 'Stanowisko C-01', sub: 'z góry, oba słupki', apply: () => gameAtHub(C01.x, C01.z + 420, 0.36) },
  zblizenie: { key: '2', label: 'Zbliżenie: przewód', sub: 'słupek zachodni i wlew', apply: () => gameAtHub(C01.x - 420, C01.z + 760, 0.95) },
  hala: { key: '3', label: 'Cała hala', sub: 'rurociągi, zbiorniki', apply: () => gameAtHub(0, 3500, 0.085) },
  zbiorniki: { key: '4', label: 'Magazyn paliwa', sub: 'ściana tylna', apply: () => gameAtHub(C01.x + 400, 700, 0.42) },
  '3d-ramie': { key: '5', label: 'Kamera 3D: ramię', sub: 'słupek, ramię, przewód', apply: () => cineAtHub(C01.x - 600, C01.z + 720, 190, 1500, -2.35, 0.42) },
  '3d-stanowisko': { key: '6', label: 'Kamera 3D: stanowisko', sub: 'oba ramiona i Atlas', apply: () => cineAtHub(C01.x, C01.z + 500, 120, 3600, -1.9, 0.62) }
};
function gameAtHub(x, z, zoom) {
  hubToGame(x, z, _g);
  state.mode = 'game';
  state.follow = false;
  state.cam.x = _g.x; state.cam.y = _g.y; state.cam.zoom = zoom;
}
function cineAtHub(x, z, y, dist, az, el) {
  hubToGame(x, z, _g);
  state.mode = 'cine';
  cine.target.set(_g.x, -_g.y, k7HeightToZ(y));
  cine.dist = dist; cine.az = az; cine.el = el;
}
function setView(name) {
  const v = VIEWS[name];
  if (!v) return;
  state.view = name;
  v.apply();
  for (const b of viewButtons) b.classList.toggle('on', b.dataset.view === name);
}
function cineCamera() {
  const p = cine.persp;
  const ce = Math.cos(cine.el);
  p.aspect = W / Math.max(1, H);
  p.updateProjectionMatrix();
  p.position.set(cine.target.x + Math.cos(cine.az) * ce * cine.dist, cine.target.y + Math.sin(cine.az) * ce * cine.dist, cine.target.z + Math.sin(cine.el) * cine.dist);
  p.lookAt(cine.target);
  p.updateMatrixWorld();
  if (!cine.cam) cine.cam = { mode: 'free3d', position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), fov: 45, near: 10, far: 600000, zoom: 1, x: 0, y: 0 };
  cine.cam.position.copy(p.position);
  cine.cam.quaternion.copy(p.quaternion);
  cine.cam.x = p.position.x;
  cine.cam.y = -p.position.y;
  return cine.cam;
}

// Kamera ringu (uCamLocal): replika kamery perspektywy passów Core3D w układzie lokalnym ringu.
const _camWorld = new THREE.Vector3();
const _inv = new THREE.Matrix4();
function syncRingCamera(cam) {
  if (state.mode === 'cine') {
    _camWorld.copy(cine.persp.position);
  } else {
    const vh = Core3D.composerTarget?.height || H;
    const fov = Core3D.cameraPersp?.fov || 35;
    const h = (vh * 0.5) / Math.tan(THREE.MathUtils.degToRad(fov * 0.5)) / Math.max(1e-4, cam.zoom);
    _camWorld.set(cam.x, -cam.y, h);
  }
  ringGroup.updateMatrixWorld(true);
  _inv.copy(ringGroup.matrixWorld).invert();
  ringUniforms.uCamLocal.value.copy(_camWorld).applyMatrix4(_inv);
}

// Słońce ringu (układ lokalny ringu) od strony hali — dzień; po drugiej stronie planety — noc (lampy hali).
function applySun() {
  const az = frame.angle + (state.night ? Math.PI : 0.42);
  const el = 49 * Math.PI / 180;
  const ce = Math.cos(el);
  ringUniforms.uSunDir.value.set(ce * Math.cos(az), ce * Math.sin(az), Math.sin(el)).normalize();
  // Słońce gry (oświetlenie kadłubów, dym): w tym samym kierunku, daleko
  const dx = Math.cos(az) * place.cos - Math.sin(az) * place.sin;
  const dy = -(Math.cos(az) * place.sin + Math.sin(az) * place.cos);
  window.SUN = { x: P0.x + dx * 2_000_000, y: P0.y + dy * 2_000_000, r: 2600 };
}

// ---------------------------------------------------------------------------
// Panel
const SEQ_BUTTONS = [
  ['loop', 'Pokaz w pętli', 'podłączony → ODDOKUJ → złożony → podłączanie', () => { state.loop = !state.loop; if (state.loop && state.seq.kind === 'auto') { resetShip(); startSeq('connected'); } updateSeqButtons(); }],
  ['undock', 'ODDOKUJ', 'upust, odryglowanie, ramiona się składają', () => { resetShipIfAway(); state.loop = false; startSeq('undock'); }],
  ['dock', 'Podłącz', 'zamki, ramiona nad wlewy, rygle', () => { resetShipIfAway(); state.loop = false; startSeq('dock'); }],
  ['release', 'Awaryjne odpięcie', 'statek rusza ze stanowiska', () => { resetShipIfAway(); state.loop = false; startSeq('release'); }],
  ['fly', 'Lot (W / S / A / D)', 'stery u gracza, automat stanowisk', () => stopSeqToAutomat()],
  ['reset', 'Statek na C-01', 'dziobem ku bramie, jak w kampanii', () => { resetShip(); state.loop = false; startSeq('stowed'); }]
];
const seqButtons = SEQ_BUTTONS.map(([key, label, sub, run]) => {
  const b = document.createElement('button');
  b.dataset.seq = key;
  b.className = key === 'loop' || key === 'undock' ? 'big' : '';
  b.innerHTML = `${label}<small>${sub}</small>`;
  b.addEventListener('click', run);
  $('seq').appendChild(b);
  return b;
});
function resetShipIfAway() {
  if (Math.hypot(flight.x - C01.x, flight.z - C01.z) > 30 || state.seq.kind === 'auto') resetShip();
}
function updateSeqButtons() {
  for (const b of seqButtons) {
    const k = b.dataset.seq;
    b.classList.toggle('on', (k === 'loop' && state.loop) || (k === 'fly' && state.seq.kind === 'auto') || (k === state.seq.kind && !state.loop));
  }
}
const viewButtons = Object.entries(VIEWS).map(([key, v]) => {
  const b = document.createElement('button');
  b.dataset.view = key;
  b.innerHTML = `${v.key} · ${v.label}<small>${v.sub}</small>`;
  b.addEventListener('click', () => setView(key));
  $('views').appendChild(b);
  return b;
});
{
  const b = document.createElement('button');
  b.dataset.view = 'statek';
  b.innerHTML = 'Za statkiem<small>kamera gry nad Atlasem</small>';
  b.addEventListener('click', () => { state.mode = 'game'; state.follow = true; state.cam.zoom = 0.3; state.view = 'statek'; for (const v of viewButtons) v.classList.remove('on'); });
  $('views').appendChild(b);
}
const SPEEDS = [['pauza', 0], ['×0,25', 0.25], ['×0,5', 0.5], ['×1', 1]];
const speedButtons = SPEEDS.map(([label, s]) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', () => setSpeed(s));
  $('speeds').appendChild(b);
  return b;
});
function setSpeed(s) {
  state.speed = s;
  state.paused = s === 0;
  speedButtons.forEach((b, i) => b.classList.toggle('on', SPEEDS[i][1] === s));
}
const TOGGLES = [
  ['gas', 'Pył i para hali', () => HALL_DUST_TUNE.enabled, (v) => { HALL_DUST_TUNE.enabled = v; }],
  ['puffs', 'Kłęby pary (buchy)', () => HALL_DUST_TUNE.puffs, (v) => { HALL_DUST_TUNE.puffs = v; }],
  ['night', 'Noc (lampy hali)', () => state.night, (v) => { state.night = v; applySun(); }],
  ['roof', 'Dach zamknięty', () => state.roofClosed, (v) => { state.roofClosed = v; }],
  ['ship', 'Atlas', () => state.showShip, (v) => { state.showShip = v; }],
  ['nodes', 'Węzły liny (debug)', () => state.nodes, (v) => { state.nodes = v; }],
  ['lights', 'Światła hali w siatce', () => HALL_DUST_TUNE.hallLights, (v) => { HALL_DUST_TUNE.hallLights = v; }],
  ['bloom', 'Bloom', () => true, (v) => Core3D.setPerfToggles?.({ bloom: v })]
];
for (const [key, label, get, set] of TOGGLES) {
  const l = document.createElement('label');
  l.innerHTML = `<input type="checkbox"> ${label}`;
  const cb = l.querySelector('input');
  cb.checked = !!get();
  cb.dataset.key = key;
  cb.addEventListener('change', () => set(cb.checked));
  $('toggles').appendChild(l);
}

// Mysz: przeciąganie — przesuw (kamera 3D — obrót), kółko — zoom (kamera 3D — odległość)
let drag = 0;
let lastX = 0;
let lastY = 0;
canvas2d.addEventListener('contextmenu', (e) => e.preventDefault());
canvas2d.addEventListener('pointerdown', (e) => { drag = 1; lastX = e.clientX; lastY = e.clientY; canvas2d.setPointerCapture(e.pointerId); canvas2d.classList.add('drag'); });
canvas2d.addEventListener('pointerup', () => { drag = 0; canvas2d.classList.remove('drag'); });
canvas2d.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  if (state.mode === 'cine') {
    cine.az -= dx * 0.005;
    cine.el = Math.max(0.06, Math.min(1.5, cine.el + dy * 0.004));
    return;
  }
  state.follow = false;
  state.cam.x -= dx / state.cam.zoom;
  state.cam.y -= dy / state.cam.zoom;
});
canvas2d.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (state.mode === 'cine') { cine.dist = Math.max(250, Math.min(40000, cine.dist * Math.exp(e.deltaY * 0.001))); return; }
  const k = Math.exp(-e.deltaY * 0.0012);
  const z0 = state.cam.zoom;
  const z1 = Math.max(0.03, Math.min(3.2, z0 * k));
  const mx = e.clientX - W / 2;
  const my = e.clientY - H / 2;
  if (!state.follow) {
    state.cam.x += mx / z0 - mx / z1;
    state.cam.y += my / z0 - my / z1;
  }
  state.cam.zoom = z1;
}, { passive: false });

const keys = new Set();
const FLY_KEYS = new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD']);
addEventListener('keydown', (e) => {
  if (e.repeat && !FLY_KEYS.has(e.code)) return;
  if (FLY_KEYS.has(e.code) && state.seq.kind !== 'auto') stopSeqToAutomat();
  keys.add(e.code);
  const v = Object.entries(VIEWS).find(([, x]) => e.code === `Digit${x.key}`);
  if (v) setView(v[0]);
  else if (e.code === 'KeyE') { resetShipIfAway(); state.loop = false; startSeq(c01Pose().lock > 0.5 ? 'undock' : 'dock'); }
  else if (e.code === 'KeyR') { resetShipIfAway(); state.loop = false; startSeq('release'); }
  else if (e.code === 'KeyP') setSpeed(state.speed ? 0 : 1);
  else if (e.code === 'KeyT') setSpeed(state.speed === 0.25 ? 1 : 0.25);
  else if (e.code === 'KeyL') seqButtons[0].click();
  else if (e.code === 'KeyH') $('panel').style.display = $('panel').style.display === 'none' ? '' : 'none';
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// ---------------------------------------------------------------------------
// Klatka
const STEP = 1 / 120;
let acc = 0;
const shipList = [null];
const cullInfo = { x: 0, y: 0, drawHalfW: 0, drawHalfH: 0, halfW: 0, halfH: 0 };
const renderList = [];
const hallOpts = { poses, roofFade: 0, daylight: 1, clock: 0, gameDt: 0, hull: null };

function simulate(dt) {
  state.T += dt;
  SimClock.advance(dt);
  // model lotu (120 Hz) — wejście tylko przy sterach u gracza
  const inp = flight.input;
  const manual = state.seq.kind === 'auto';
  inp.main = manual && keys.has('KeyW') ? 1 : 0;
  inp.retro = manual && keys.has('KeyS') ? 1 : 0;
  inp.torque = manual ? (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) : 0;
  inp.brake = manual && keys.has('Space') ? 1 : 0;
  inp.boost = manual && (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? 1 : 0;
  acc += dt;
  let n = 0;
  while (acc >= STEP && n < 12) {
    acc -= STEP;
    n++;
    flight.step(STEP, roof.fade > 0.5 ? 1 : 0);
  }
  if (n >= 12) acc = 0;
  roof.update(flight.polygon(), dt);
  stepSeq(dt);
  // automat obsługi stanowisk gry swobodnej (stanowiska poza pokazem; C-01 po oddaniu sterów)
  shipList[0] = atlas;
  stepK7BerthService(service, dt, place, shipList, atlas ? 1 : 0);
  if (syncK7BerthLamps(service, 0, layout.berths)) hall.setBerthLamps();
  syncAtlas(dt);
  window.rocketSystem3D?.update(dt);
}

function render(simDt) {
  SimClock.beginRender(1, STEP, simDt <= 0);
  if (state.follow) { state.cam.x = atlas?.x ?? state.cam.x; state.cam.y = atlas?.y ?? state.cam.y; }
  const cam = state.mode === 'cine' ? cineCamera() : state.cam;
  syncRingCamera(cam);
  ringUniforms.uTime.value += simDt;
  // hala: pozy obsługi, ramiona i przewody (czas gry), dach, lampy, zegar migania świateł
  const clock = k7BeaconClock(performance.now());
  hallOpts.roofFade = state.roofClosed ? 0 : 1;
  hallOpts.daylight = state.night ? 0 : 1;
  hallOpts.clock = clock;
  hallOpts.gameDt = simDt;
  hallOpts.hull = state.showShip ? flight.polygon() : null;
  hall.update(simDt, hallOpts);
  owner.lampLevel = hall.k7Uniforms.uHallLights.value.x;
  // pył i para hali: wejście klatki jak w grze (hala przy kamerze, okręty, pozy obsługi)
  const camGame = state.mode === 'cine' ? { x: cine.target.x, y: -cine.target.y, zoom: 0.3 } : cam;
  packHallDustFrame(HallDust.input, {
    dt: simDt, camX: camGame.x, camY: camGame.y,
    viewHalf: state.mode === 'cine' ? 6000 : Math.hypot(W, H) * 0.5 / Math.max(1e-4, camGame.zoom),
    rings: [{ collider }], ship: state.showShip ? atlas : null, npcs: null, sun: window.SUN, clock
  });
  HallDust.submit(HallDust.input);
  // statek i render Core3D (hexShips3D woła Core3D.render)
  renderList.length = 0;
  if (atlas && state.showShip) renderList.push(atlas);
  const zoom = state.mode === 'cine' ? 1 : cam.zoom;
  cullInfo.x = state.mode === 'cine' ? camGame.x : cam.x;
  cullInfo.y = state.mode === 'cine' ? camGame.y : cam.y;
  cullInfo.drawHalfW = W * 0.5 / zoom + 2000;
  cullInfo.drawHalfH = H * 0.5 / zoom + 2000;
  cullInfo.halfW = cullInfo.drawHalfW * 3;
  cullInfo.halfH = cullInfo.drawHalfH * 3;
  Fx3D.update(simDt);
  updateHexShips3D(cam, renderList, cullInfo);
  drawHexShips3D(ctx2d, W, H);
  if (state.nodes && state.mode === 'game') drawRopeNodes(cam);
  const r = Core3D.lastFrameRenderInfo?.total || Core3D.renderer?.info?.render || {};
  state.lastInfo = { calls: r.calls || r.drawCalls || 0 };
}

// Debug: węzły liny przewodów (rzut z góry, wysokość pominięta) i przeguby ramion.
function drawRopeNodes(cam) {
  const ctx = ctx2d;
  const z = cam.zoom;
  ctx.save();
  for (const h of hall.fuelRig.hoses) {
    const P = h.pos;
    ctx.fillStyle = h.asleep ? 'rgba(140,160,180,0.7)' : 'rgba(255,214,90,0.95)';
    for (let i = h.k0; i < K7_HOSE_NODES; i++) {
      hubToGame(P[i * 3], P[i * 3 + 2], _g);
      const sx = (_g.x - cam.x) * z + W / 2;
      const sy = (_g.y - cam.y) * z + H / 2;
      const r = i === K7_HOSE_NODES - 1 ? 4 : 2;
      ctx.fillRect(sx - r, sy - r, 2 * r, 2 * r);
    }
    hubToGame(h.wrist.x, h.wrist.z, _g);
    ctx.strokeStyle = 'rgba(111,211,255,0.9)';
    ctx.strokeRect((_g.x - cam.x) * z + W / 2 - 5, (_g.y - cam.y) * z + H / 2 - 5, 10, 10);
  }
  ctx.restore();
}

let lastMs = performance.now();
let hudAt = 0;
function frameTick(now) {
  const realDt = Math.min(0.1, Math.max(0, (now - lastMs) / 1000));
  lastMs = now;
  state.fps = state.fps * 0.93 + (realDt > 0 ? 1 / realDt : 60) * 0.07;
  const simDt = state.paused ? 0 : realDt * state.speed;
  if (simDt > 0) simulate(simDt); else syncAtlas(0);
  render(simDt);
  if (now - hudAt > 200) { hudAt = now; updateHud(); }
}
function loop(now) {
  try { frameTick(now); } catch (err) { reportError(err.stack || String(err)); }
  requestAnimationFrame(loop);
}

const f2 = (x) => (Number(x) || 0).toFixed(2);
function updateHud() {
  const pose = c01Pose();
  const rig = hall.fuelRig;
  const rs = rig.stats;
  const hs = rig.hoses.filter((h) => h.berthId === 'C-01');
  const gs = HallDust.stats;
  const gpu = Number.isFinite(Core3D.gpuFrameMs) ? Core3D.gpuFrameMs.toFixed(2) : '—';
  const speed = Math.hypot(flight.vx, flight.vz);
  const auto = k7BerthServiceState(service, 0, 'C-01');
  $('hud').innerHTML = [
    `<b>Dok K-7 · WebGPU</b>  ${state.fps.toFixed(0)} FPS  draw ${state.lastInfo.calls}  GPU klatki ${gpu} ms`,
    `<b>C-01</b>  ${SEQ_LABEL[state.seq.kind] || state.seq.kind}${state.loop ? ' (pętla)' : ''} · <i>${seqStepText()}</i>`,
    `<b>poza</b>  zamki ${f2(pose.clamp)}  ramię ${f2(pose.extension)}  złączka ${f2(pose.seat)}  rygle ${f2(pose.lock)}  przepływ ${f2(pose.flow)}  upust ${f2(pose.vent)}`,
    `<b>przewody</b>  ${hs.map((h) => `${h.side < 0 ? 'W' : 'E'}: ${h.length.toFixed(0)} j. ${h.latched ? 'zaryglowany' : h.asleep ? 'spoczynek' : 'w ruchu'}`).join('  ')}`,
    `<b>fizyka</b>  aktywne ${rs.awake}/${rig.hoses.length}  węzły ${rs.nodes}  podkroki ${rs.substeps}  CPU ${f2(rs.cpuMs)} ms`,
    `<b>gaz</b>  ${gs.active ? 'aktywny' : 'stoi'}  źródła ${gs.sources}  buchy ${gs.bursts}  upust ${gs.venting}  światła ${gs.lights}  CPU ${f2(gs.cpuMs)} ms`,
    `<b>Atlas</b>  ${speed.toFixed(0)} j/s  ${roof.fade > 0.5 ? 'w hali' : 'poza halą'}  napęd ${flight.locked ? 'ZABLOKOWANY' : 'ręczny'}  automat ${auto ? auto.state : '—'}`,
    `<b>czas</b>  ${state.T.toFixed(1)} s ${state.paused ? '(pauza)' : state.speed !== 1 ? `(×${state.speed})` : ''}  <b>widok</b> ${state.mode === 'cine' ? '3D' : `z góry ${state.cam.zoom.toFixed(2)}`}`
  ].join('\n');
  $('caption').textContent = state.seq.kind === 'auto'
    ? 'Lot ręczny: stań na polu stanowiska capital na 2 s — automat podepnie przewody; ruszenie — awaryjne odpięcie'
    : `${SEQ_LABEL[state.seq.kind]} — ${seqStepText()}`;
}

// ---------------------------------------------------------------------------
// API (harness: scripts/webgpu/dok-k7-demo.mjs)
window.__dok = {
  ready: false,
  get errors() { return errors.slice(); },
  state, hall, layout, poses, service, flight, place, frame,
  get rig() { return hall.fuelRig; },
  get atlas() { return atlas; },
  hubToGame, gameToHub,
  view: (name) => setView(name),
  setSpeed: (s) => setSpeed(s),
  seq: (kind) => { resetShipIfAway(); state.loop = false; startSeq(kind); },
  loop: (on) => { state.loop = !!on; if (on) { resetShip(); startSeq('connected'); } updateSeqButtons(); },
  fly: () => stopSeqToAutomat(),
  cam: (x, z, zoom) => gameAtHub(x, z, zoom),
  cine: (x, z, y, dist, az, el) => cineAtHub(x, z, y, dist, az, el),
  toggle: (key, value) => {
    const t = TOGGLES.find((v) => v[0] === key);
    if (!t) return false;
    t[3](!!value);
    const cb = document.querySelector(`#toggles input[data-key="${key}"]`);
    if (cb) cb.checked = !!value;
    return true;
  },
  wake: () => wakeK7FuelRig(hall.fuelRig),
  stats: () => ({ rig: { ...hall.fuelRig.stats }, gas: { ...HallDust.stats }, seq: state.seq.kind, t: state.T, errors: errors.slice() })
};

// ---------------------------------------------------------------------------
// Start
if (!(await Core3D.ready)) {
  reportError(`WebGPU: ${Core3D.gpuError || 'brak urządzenia — demo wymaga przeglądarki z WebGPU'}`);
  throw new Error('WebGPU niedostępne');
}
SparkSystem3D.init(Core3D.scene);
window.SparkSystem3D = SparkSystem3D;
const rocketFx = createRocketFx(Core3D);
initRocketSystem3D(Core3D.scene, { effects: rocketFx });
WeaponFx.ensure();
HallDust.setVaporSmoke(rocketFx.smoke);
applySun();
// bryły hali: pipeline'y w tle przed podpięciem (jak bryły ringu w grze — hak prewarm), potem do sceny
try {
  await Core3D.warmup.now([hall.root], { name: 'demo: hala K-7', layer: 'all' });
  const v = hall.roofWarmVariant();
  if (v.meshes.length) await Core3D.warmup.now(v.meshes, { name: 'demo: dach K-7 przezroczysty', variant: v, layer: 'all' });
} catch (err) { console.warn('[dok K-7] rozgrzewka hali', err); }
ringGroup.add(hall.root);
Core3D.scene.add(ringGroup);
try { atlas = await createAtlas(); } catch (err) { reportError(`Atlas: ${err.stack || err.message}`); }
resetShip();
syncAtlas(0);
startSeq('connected');
if (!state.loop) updateSeqButtons();
setSpeed(1);
setView(VIEWS[state.view] ? state.view : 'stanowisko');
updateSeqButtons();
window.__dok.ready = true;
requestAnimationFrame(loop);
