// dema/wybuchy-webgpu.js
//
// Demo WYBUCHÓW WebGPU w warunkach gry (plan docs/PLAN-zniszczenia-swiata-3d.md § 12): ten sam moduł co gra —
// src/3d/explosions/explosionFx.js (kula ognia i dym z gazu na siatce 3D w compute, żar porywany przez gaz,
// błysk, iskry i odłamki gry, smugi dymu płonących odłamków, światła w siatce Core3D, fala jako sama refrakcja,
// gorące powietrze, wybuchy wtórne) na prawdziwym Core3D (passy, bloom i ACES gry). Tło: suchy dok piratów z misji 1
// (te same bryły co w grze) i okręty na parkingu — skala i kontekst wybuchów, które gra pokazuje najczęściej
// (progi punktów i łańcuch rozpadu doku).
//
// Serwowanie: `npm run dev` → /dema/wybuchy-webgpu.html (?shot=1 — bez paneli, do zrzutów).
// Harness: node scripts/webgpu/wybuchy-demo.mjs (zrzuty, ruch dymu, koszt). Konsola: window.__demo.

import * as THREE from 'three';
import { Core3D } from '../src/3d/core3d.js';
import { drawHexShips3D, initHexShips3D, resizeHexShips3D, updateHexShips3D } from '../src/3d/hexShips3D.js';
import { Fx3D } from '../src/3d/fxParticles3D.js';
import { ShipProxyBatch3D } from '../src/3d/shipProxyBatch3D.js';
import { trafficHullRenderSize } from '../src/data/trafficHulls.js';
import { portHeadingToGame, portHubToGame, portModuleFrame } from '../src/3d/portBuildings/portModuleTraffic.js';
import { PirateDryDock3D } from '../src/3d/portBuildings/pirateDryDock3D.js';
import { createPirateDryDockLayout, dryDockShipPose, planDryDockChain } from '../src/3d/portBuildings/pirateDryDockLayout.js';
import { SHIPYARD_TUNE } from '../src/game/story/shipyardLayout.js';
import { SparkSystem3D } from '../src/3d/sparkSystem3D.js';
import { createRocketFx } from '../src/3d/rockets/rocketFx.js';
import { initRocketSystem3D } from '../src/effects3d/rocketSystem3D.js';
import { WeaponFx } from '../src/3d/weapons/weaponFx.js';
import { SimClock } from '../src/game/simClock.js';
import { createExplosionFactory, EXPLOSION_TUNE } from '../src/3d/explosions/explosionFx.js';

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
addEventListener('resize', () => {
  W = canvas2d.width = innerWidth;
  H = canvas2d.height = innerHeight;
  resizeHexShips3D(W, H);
});

// Dok daleko od zera (precyzja float32 jak w grze — obrzeża układu to 5–10 mln j.).
const P0 = Object.freeze({ x: 8_640_000, y: -3_910_000 });
window.SUN = { x: P0.x - 2_400_000, y: P0.y + 1_300_000, r: 2600 };
// Kamera gry (wstrząs wybuchów — camera.addShake jak w index.html).
const shake = { mag: 0, t: 0, dur: 0 };
window.camera = {
  get x() { return state.cam.x; }, get y() { return state.cam.y; }, get zoom() { return state.cam.zoom; },
  get shakeMag() { return shake.mag; }, get shakeDur() { return shake.dur; }, get shakeTime() { return shake.t; },
  addShake(mag, dur) { if (mag > shake.mag * (shake.dur > 0 ? shake.t / shake.dur : 0)) { shake.mag = mag; shake.dur = dur; shake.t = dur; } }
};

(function addStars() {
  const n = 2800;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let seed = 9091;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = P0.x + (rnd() - 0.5) * 600000;
    pos[i * 3 + 1] = -P0.y + (rnd() - 0.5) * 400000;
    pos[i * 3 + 2] = -90000 - rnd() * 40000;
    const b = Math.pow(rnd(), 6) * 1.3 + 0.07;
    const tint = rnd();
    col[i * 3] = b * (0.9 + 0.1 * tint);
    col[i * 3 + 1] = b * 0.9;
    col[i * 3 + 2] = b * (1.05 - 0.15 * tint);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false }));
  pts.frustumCulled = false;
  pts.layers.set(1);
  Core3D.scene.add(pts);
})();

const host = new THREE.Group();
host.name = 'Suchy dok (tło wybuchów)';
host.position.set(P0.x, -P0.y, 0);
Core3D.scene.add(host);
const LAYER_BG = 1;
const LAYER_FG = 2;
const FRAME = portModuleFrame(0, 0, 0);
const layout = createPirateDryDockLayout({ id: 'PD-1' });
const hubToGame = (x, z, out = {}) => portHubToGame(FRAME, P0, x, z, out);
const headingToGame = (h) => portHeadingToGame(FRAME, h);
const dock = new PirateDryDock3D({ layout, frame: FRAME, name: 'Suchy dok PD-1' });
host.add(dock.root);
dock.setLayers(LAYER_BG, LAYER_FG);

// Galeria: pusta przestrzeń obok parkingu, okręty dookoła (skala i światło).
const GAL = hubToGame(0, layout.bounds.z1 + 4200);
const HULL_OF = (key) => (String(key).includes('battleship') ? 'pirate_battleship' : String(key).includes('destroyer') ? 'pirate_destroyer' : 'pirate_frigate');
const parked = layout.berths.map((b, i) => {
  const hullId = HULL_OF(SHIPYARD_TUNE.parked[i] ?? 'destroyer');
  const size = trafficHullRenderSize(hullId);
  const pose = dryDockShipPose(b, size.w);
  const g = hubToGame(pose.x, pose.z);
  return { id: `p${i}`, hullId, x: g.x, y: g.y, angle: headingToGame(pose.angle), berth: i, alive: true };
});
const galleryShips = [
  { id: 'g0', hullId: 'pirate_destroyer', x: GAL.x - 1500, y: GAL.y - 700, angle: 0.3 },
  { id: 'g1', hullId: 'pirate_frigate', x: GAL.x + 1300, y: GAL.y + 900, angle: 2.2 },
  { id: 'g2', hullId: 'pirate_battleship', x: GAL.x + 300, y: GAL.y - 1800, angle: -0.4 }
];

// ---------------------------------------------------------------------------
const state = {
  T: 0,
  speed: 1,
  paused: false,
  cam: { x: GAL.x, y: GAL.y, zoom: 0.3 },
  mode: 'game',
  kind: 'capital',
  size: 300,
  fps: 60,
  view: 'blisko'
};

// ---------------------------------------------------------------------------
// Efekty gry (pule iskier, broni, rakiet) i wybuchy
let explode = null;
let ex = null;
const queue = [];   // zaplanowane wybuchy scen (czas sceny)
function schedule(t, fn) { queue.push({ t: state.T + t, fn }); queue.sort((a, b) => a.t - b.t); }

function boom(profile, x, y, size) {
  if (!explode) return false;
  return explode({ x, y, size, profile });
}

const KINDS = [
  ['fighter', 'Drobny', 'impulsy rozpadu stacji', 40],
  ['escort', 'Fregata', 'mały okręt', 160],
  ['cruiser', 'Niszczyciel', 'średni okręt', 220],
  ['capital', 'Okręt liniowy', 'domyślny — kawałek doku, Atlas', 300],
  ['chain', 'Łańcuch stacji', 'oderwany fragment', 200],
  ['cut', 'Cięcie skorupy', 'pęknięcie stacji', 260],
  ['final', 'Finał stacji', 'stacja ginie', 320]
];

const SCENES = [
  ['showcase', 'Pokaz', 'fregata → okręt → finał', () => showcase()],
  ['threshold', 'Próg punktów doku', 'kawałek odpada z wybuchem', () => threshold()],
  ['chain', 'Łańcuch rozpadu', '~15 wybuchów w ~4 s + finał', () => chain()],
  ['atlas', 'Śmierć Atlasa', 'bez rdzenia (size 282)', () => { setView('blisko'); boom('capital', GAL.x, GAL.y, 282); }],
  ['station', 'Rozpad stacji', 'finał + wtórne jak Destruction3D', () => stationFinal()]
];

function showcase() {
  setView('srednio');
  schedule(0.1, () => boom('escort', GAL.x - 1600, GAL.y + 300, 160));
  schedule(1.2, () => boom('cruiser', GAL.x + 1500, GAL.y - 400, 220));
  schedule(2.6, () => boom('capital', GAL.x, GAL.y + 200, 300));
  schedule(5.0, () => boom('final', GAL.x - 300, GAL.y - 600, 320));
}

function chunkGame(id) {
  const c = layout.chunkById.get(id);
  return hubToGame((c.box.x0 + c.box.x1) / 2, (c.box.z0 + c.box.z1) / 2);
}

function threshold() {
  setView('dok-blisko');
  const ids = ['S-2', 'R-2', 'P-2'].filter((id) => layout.chunkById.has(id));
  ids.forEach((id, i) => schedule(0.2 + i * 1.6, () => {
    const c = layout.chunkById.get(id);
    dock.breakChunk(id, { speed: 70, spin: 0.08, life: 45 });
    const p = chunkGame(id);
    boom('capital', p.x, p.y, c.kind === 'spine' ? 520 : 380);
    window.camera.addShake(12, 0.5);
  }));
}

function chain(start = 'R-2') {
  setView('dok');
  dock.resetChunks();
  const plan = planDryDockChain(layout, start);
  let tLast = 0;
  for (const ch of plan) {
    tLast = Math.max(tLast, ch.t);
    schedule(0.3 + ch.t, () => {
      const c = layout.chunkById.get(ch.id);
      dock.breakChunk(ch.id, { speed: c.kind === 'spine' ? 55 : 95, spin: c.kind === 'spine' ? 0.05 : 0.14, life: 40 });
      const p = chunkGame(ch.id);
      if (ch.size > 0) boom('capital', p.x, p.y, ch.size);
      if (c.kind === 'spine') for (const s of parked) if (s.alive && layout.berths[s.berth].segment === ch.id) s.alive = false;
    });
  }
  const hc = layout.hall.center;
  schedule(0.3 + tLast + 0.8, () => {
    const p = hubToGame(hc.x, hc.z + 600);
    boom('capital', p.x, p.y, 520);
    window.camera.addShake(30, 0.9);
  });
}

function stationFinal() {
  setView('blisko');
  const size = 306;
  boom('final', GAL.x, GAL.y, size);
  const n = 5;
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n + 0.2;
    const r = 220 * (0.72 + 0.4 * ((i * 0.37) % 1));
    schedule(0.06 + i * 0.05, () => boom('chain', GAL.x + Math.cos(a) * r, GAL.y + Math.sin(a) * r, size * 0.22));
  }
}

// ---------------------------------------------------------------------------
// Widoki
const cine = { cam: null, persp: new THREE.PerspectiveCamera(42, 1, 20, 400000), target: new THREE.Vector3(), dist: 5200, az: -0.7, el: 0.62 };
cine.persp.up.set(0, 0, 1);
const VIEWS = {
  blisko: { label: 'Blisko', apply: () => setGame(GAL.x, GAL.y, 0.3) },
  srednio: { label: 'Średnio', apply: () => setGame(GAL.x, GAL.y, 0.14) },
  'dok-blisko': { label: 'Dok — trzon', apply: () => { const p = hubToGame(0, layout.parking.laneZ - 800); setGame(p.x, p.y, 0.14); } },
  dok: { label: 'Cały dok', apply: () => { const p = hubToGame(0, (layout.bounds.z0 + layout.bounds.z1) / 2 + 300); setGame(p.x, p.y, 0.095); } },
  kino: { label: 'Kamera 3D', apply: () => setCine(GAL.x, GAL.y, 4200, -0.7, 0.62) }
};
function setGame(x, y, zoom) {
  state.mode = 'game';
  state.cam.x = x; state.cam.y = y; state.cam.zoom = zoom;
}
function setCine(x, y, dist, az, el) {
  state.mode = 'cine';
  cine.target.set(x, -y, 0);
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
  if (!cine.cam) cine.cam = { mode: 'free3d', position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), fov: 42, near: 20, far: 400000, zoom: 1 };
  cine.cam.position.copy(p.position);
  cine.cam.quaternion.copy(p.quaternion);
  cine.cam.x = p.position.x;
  cine.cam.y = -p.position.y;
  return cine.cam;
}

// ---------------------------------------------------------------------------
// Panel
const kindButtons = KINDS.map(([key, label, sub, size], i) => {
  const b = document.createElement('button');
  b.dataset.kind = key;
  b.innerHTML = `${i + 1} · ${label}<small>${sub} (size ${size})</small>`;
  b.addEventListener('click', () => setKind(key));
  $('kinds').appendChild(b);
  return b;
});
function setKind(key) {
  state.kind = key;
  state.size = KINDS.find((k) => k[0] === key)?.[3] ?? 300;
  for (const b of kindButtons) b.classList.toggle('on', b.dataset.kind === key);
}
for (const [key, label, sub, run] of SCENES) {
  const b = document.createElement('button');
  b.innerHTML = `${label}<small>${sub}</small>`;
  b.addEventListener('click', () => { clearAll(); run(); });
  b.dataset.scene = key;
  $('scenes').appendChild(b);
}
const viewButtons = Object.entries(VIEWS).map(([key, v]) => {
  const b = document.createElement('button');
  b.dataset.view = key;
  b.textContent = v.label;
  b.addEventListener('click', () => setView(key));
  $('views').appendChild(b);
  return b;
});
const LAYERS = [
  ['gas', 'Gaz (kula, dym)'], ['embers', 'Żar'], ['sparks', 'Iskry'], ['chunks', 'Odłamki'], ['trails', 'Smugi odłamków'],
  ['flash', 'Błysk'], ['lights', 'Światła'], ['shock', 'Fala (refrakcja)'], ['haze', 'Gorące powietrze'], ['secondaries', 'Wtórne']
];
for (const [key, label] of LAYERS) {
  const l = document.createElement('label');
  l.innerHTML = `<input type="checkbox"> ${label}`;
  const cb = l.querySelector('input');
  cb.checked = EXPLOSION_TUNE[key] !== false;
  cb.addEventListener('change', () => { EXPLOSION_TUNE[key] = cb.checked; });
  $('layers').appendChild(l);
}
{
  const l = document.createElement('label');
  l.innerHTML = '<input type="checkbox" checked> Bloom';
  const cb = l.querySelector('input');
  cb.addEventListener('change', () => Core3D.setPerfToggles?.({ bloom: cb.checked }));
  $('layers').appendChild(l);
}
const SPEEDS = [['pauza', 0], ['×0,25', 0.25], ['×1', 1]];
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
function clearAll() {
  queue.length = 0;
  ex?.clear();
  dock.resetChunks();
  for (const s of parked) s.alive = true;
}

// Mysz: LPM — wybuch pod kursorem (widok z góry), PPM / przeciąganie — przesuw, kółko — zoom.
let drag = 0, lastX = 0, lastY = 0, downX = 0, downY = 0;
canvas2d.addEventListener('contextmenu', (e) => e.preventDefault());
canvas2d.addEventListener('pointerdown', (e) => { drag = 1; lastX = downX = e.clientX; lastY = downY = e.clientY; canvas2d.setPointerCapture(e.pointerId); });
canvas2d.addEventListener('pointerup', (e) => {
  drag = 0;
  if (e.button === 0 && Math.hypot(e.clientX - downX, e.clientY - downY) < 4 && state.mode === 'game') {
    const x = state.cam.x + (e.clientX - W / 2) / state.cam.zoom;
    const y = state.cam.y + (e.clientY - H / 2) / state.cam.zoom;
    boom(state.kind, x, y, state.size);
  }
});
canvas2d.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  if (state.mode === 'cine') {
    cine.az -= dx * 0.005;
    cine.el = Math.max(0.08, Math.min(1.5, cine.el + dy * 0.004));
    return;
  }
  state.cam.x -= dx / state.cam.zoom;
  state.cam.y -= dy / state.cam.zoom;
});
canvas2d.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (state.mode === 'cine') { cine.dist = Math.max(600, Math.min(60000, cine.dist * Math.exp(e.deltaY * 0.001))); return; }
  const k = Math.exp(-e.deltaY * 0.0012);
  const z0 = state.cam.zoom, z1 = Math.max(0.03, Math.min(3, z0 * k));
  const mx = e.clientX - W / 2, my = e.clientY - H / 2;
  state.cam.x += mx / z0 - mx / z1;
  state.cam.y += my / z0 - my / z1;
  state.cam.zoom = z1;
}, { passive: false });
addEventListener('keydown', (e) => {
  if (/^Digit[1-7]$/.test(e.code)) setKind(KINDS[Number(e.code.slice(5)) - 1][0]);
  else if (e.code === 'Space') { setSpeed(state.speed ? 0 : 1); e.preventDefault(); }
  else if (e.code === 'KeyS') setSpeed(state.speed === 0.25 ? 1 : 0.25);
  else if (e.code === 'KeyC') clearAll();
  else if (e.code === 'KeyH') $('panel').style.display = $('panel').style.display === 'none' ? '' : 'none';
});

// ---------------------------------------------------------------------------
// Klatka
const cullInfo = { x: 0, y: 0, drawHalfW: 0, drawHalfH: 0, halfW: 0, halfH: 0 };
let lastInfo = { calls: 0 };

function simulate(dt) {
  if (!(dt > 0)) return;
  state.T += dt;
  SimClock.advance(dt);
  while (queue.length && queue[0].t <= state.T) queue.shift().fn();
  window.rocketSystem3D?.update(dt);
}

function render(simDt) {
  SimClock.beginRender(1, 1 / 120, simDt <= 0);
  if (shake.t > 0) shake.t = Math.max(0, shake.t - simDt);
  const cam0 = state.mode === 'cine' ? cineCamera() : state.cam;
  let cam = cam0;
  if (state.mode === 'game' && shake.t > 0) {
    const a = shake.mag * (shake.t / Math.max(1e-3, shake.dur));
    cam = { x: cam0.x + Math.sin(state.T * 71) * a / cam0.zoom * 0.5, y: cam0.y + Math.cos(state.T * 57) * a / cam0.zoom * 0.5, zoom: cam0.zoom };
  }
  dock.setSun({ sun: window.SUN, at: P0 });
  dock.update(simDt, { alarm: false, roofFade: 0, launch: [0, 0, 0], gates: [0, 0, 0], berths: parked.map((p) => (p.alive ? 1 : 0)), daylight: 0.25 });
  dock.pushGridLights(Core3D.fx?.lights, hubToGame);
  ShipProxyBatch3D.begin(cam);
  for (const p of parked) if (p.alive) ShipProxyBatch3D.push(p.id, p.hullId, p.x, p.y, p.angle);
  for (const s of galleryShips) ShipProxyBatch3D.push(s.id, s.hullId, s.x, s.y, s.angle);
  ShipProxyBatch3D.end();
  const zoom = state.mode === 'cine' ? 1 : cam.zoom;
  cullInfo.x = cam.x; cullInfo.y = cam.y;
  cullInfo.drawHalfW = W * 0.5 / zoom + 600; cullInfo.drawHalfH = H * 0.5 / zoom + 600;
  cullInfo.halfW = cullInfo.drawHalfW * 3; cullInfo.halfH = cullInfo.drawHalfH * 3;
  Fx3D.update(simDt);
  updateHexShips3D(cam, ShipProxyBatch3D.engineEntities, cullInfo);
  drawHexShips3D(ctx2d, W, H);
  const r = Core3D.lastFrameRenderInfo?.total || Core3D.renderer?.info?.render || {};
  lastInfo = { calls: r.calls || 0 };
}

let lastMs = performance.now();
let hudAt = 0;
function frame(now) {
  const realDt = Math.min(0.1, Math.max(0, (now - lastMs) / 1000));
  lastMs = now;
  state.fps = state.fps * 0.93 + (realDt > 0 ? 1 / realDt : 60) * 0.07;
  const simDt = state.paused ? 0 : realDt * state.speed;
  simulate(simDt);
  render(simDt);
  if (now - hudAt > 250) { hudAt = now; updateHud(); }
}
function loop(now) {
  try { frame(now); } catch (err) { reportError(err.stack || String(err)); }
  requestAnimationFrame(loop);
}

function updateHud() {
  if (!ex) return;
  const g = ex.grid.stats;
  const s = ex.stats;
  const gpu = Number.isFinite(Core3D.gpuFrameMs) ? Core3D.gpuFrameMs.toFixed(2) : '—';
  $('hud').innerHTML = [
    `<b>Wybuchy · WebGPU</b>  ${state.fps.toFixed(0)} FPS  draw ${lastInfo.calls}  GPU klatki ${gpu} ms`,
    `<b>gaz</b> domeny ${g.active}/${ex.grid.S} (${ex.grid.N}×${ex.grid.N}×${ex.grid.NZ})  podkroki ${g.substeps}  źródła ${g.sources}`,
    `<b>wybuchy</b> ${s.spawned} (gaz ${s.gas}, cząstki ${s.particles}, poza ${s.off}, scalone ${s.merged}, bez domeny ${s.noSlot})`,
    `<b>żar</b> ${ex.embers.stats.alive}  <b>błyski</b> ${ex.flashes.count}  <b>światła</b> ${s.lights}  <b>odłamki</b> ${ex.fN}`,
    `<b>CPU</b> kroku ${s.cpuMs.toFixed(2)} ms  <b>czas</b> ${state.T.toFixed(1)} s ${state.paused ? '(pauza)' : state.speed !== 1 ? `(×${state.speed})` : ''}  <b>zoom</b> ${state.mode === 'cine' ? '3D' : state.cam.zoom.toFixed(3)}`
  ].join('\n');
  $('caption').textContent = `${KINDS.find((k) => k[0] === state.kind)?.[1] || state.kind} · size ${state.size} — kliknij, żeby wysadzić`;
}

// ---------------------------------------------------------------------------
// API (harness: scripts/webgpu/wybuchy-demo.mjs)
window.__demo = {
  ready: false,
  get errors() { return errors.slice(); },
  get fx() { return ex; },
  tune: EXPLOSION_TUNE,
  gallery: GAL,
  boom: (profile, x, y, size) => boom(profile, x, y, size),
  boomAt: (profile, dx, dy, size) => boom(profile, GAL.x + dx, GAL.y + dy, size),
  scene: (key) => { clearAll(); SCENES.find((s) => s[0] === key)?.[3](); },
  view: (name) => setView(name),
  cam: (x, y, zoom) => setGame(x, y, zoom),
  cine: (dist, az, el, dx = 0, dy = 0) => setCine(GAL.x + dx, GAL.y + dy, dist, az, el),
  setSpeed: (s) => setSpeed(s),
  clear: () => clearAll(),
  stats: () => ({ ...ex.stats, grid: { ...ex.grid.stats }, embers: ex.embers.stats.alive, flashes: ex.flashes.count, frags: ex.fN, errors: errors.slice() }),
  proxiesReady: () => ShipProxyBatch3D.stats.waitingImage === 0 && dock.hulls.every((h) => h.mesh.visible),
  dock, layout, hubToGame
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
try {
  explode = createExplosionFactory(Core3D, { rocketFx, weaponFx: WeaponFx, clock: () => state.T });
  ex = explode.system;
} catch (err) { reportError(`wybuchy: ${err.stack || err.message}`); }
setKind('capital');
setSpeed(1);
setView('blisko');
window.__demo.ready = true;
requestAnimationFrame(loop);
