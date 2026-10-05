// Demo: suchy dok piratów (misja 1 „Cicha stocznia”) — szkic użytkownika 2026-10-05 i poprawka tego dnia:
// trzon (suchy dok), po jednej stronie PARKING zamknięty w prostokącie (10 okrętów burta w burtę, cienkie bramy
// do taranowania, reflektory), po drugiej hala jak K-7 wpięta w trzon, brama od kosmosu. Styl piratów „Iron
// Skull” ze sprite'ów (bez czaszek).
// Serwowanie: `npm run dev`, potem /dema/suchy-dok-piratow.html
// (?view=1…9, ?t=sekundy, ?shot=1 — bez panelu, do zrzutów: node dema/suchy-dok-piratow-shots.js).
//
// Prawdziwy potok renderu gry: Core3D (BG persp → świat ortho → FG persp, bloom, ACES) przez
// initHexShips3D / updateHexShips3D / drawHexShips3D. Dok = PirateDryDock3D (budowle Z7, ten sam shader),
// okręty = proxy ruchu v2 (ShipProxyBatch3D) z dyszami MAIN. W grze okręty na parkingu i eskorta to pełni
// NPC na kadłubach belkowych (misja 1, storyGame.js), taran liczy fizyka belek — tu tylko obraz.
import * as THREE from 'three';
import { Core3D } from '../src/3d/core3d.js';
import { drawHexShips3D, initHexShips3D, resizeHexShips3D, updateHexShips3D } from '../src/3d/hexShips3D.js';
import { Fx3D } from '../src/3d/fxParticles3D.js';
import { ShipProxyBatch3D } from '../src/3d/shipProxyBatch3D.js';
import { trafficHullRenderSize } from '../src/data/trafficHulls.js';
import { portHeadingToGame, portHubToGame, portModuleFrame } from '../src/3d/portBuildings/portModuleTraffic.js';
import { PirateDryDock3D } from '../src/3d/portBuildings/pirateDryDock3D.js';
import { createPirateDryDockLayout, dryDockShipPose, planDryDockChain } from '../src/3d/portBuildings/pirateDryDockLayout.js';
import { createReactorBlowFactory } from '../src/effects3d/reactorblow.js';
import { k7HeightToZ } from '../src/3d/haloRing/haloPortK7Layout.js';
import { SHIPYARD_TUNE, dryDockRamOverlap } from '../src/game/story/shipyardLayout.js';

const params = new URLSearchParams(location.search);
const shotMode = params.get('shot') === '1';
if (shotMode) document.body.classList.add('shot');
const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Błędy na ekranie (shadery, wyjątki) — demo ma je pokazywać, nie połykać.
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
addEventListener('resize', () => {
  W = canvas2d.width = innerWidth;
  H = canvas2d.height = innerHeight;
  resizeHexShips3D(W, H);
});

// Dok daleko od zera (precyzja float32 jak w grze — obrzeża układu to 5–10 mln j.).
const P0 = Object.freeze({ x: 8_640_000, y: -3_910_000 });
// Słońce gry: daleko w lewo-dół (obrzeża układu — słońce nisko nad płaszczyzną jak w grze).
window.SUN = { x: P0.x - 2_400_000, y: P0.y + 1_300_000, r: 2600 };

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
host.name = 'Suchy dok piratów (gospodarz)';
host.position.set(P0.x, -P0.y, 0);
Core3D.scene.add(host);
const LAYER_BG = 1;
const LAYER_FG = 2;

// Ramka: kąt 0 — trzon pionowo na ekranie (x układu w górę), parking w prawo, hala w lewo (jak szkic).
const FRAME = portModuleFrame(0, 0, 0);
const layout = createPirateDryDockLayout({ id: 'PD-1' });
const hubToGame = (x, z, out = {}) => portHubToGame(FRAME, P0, x, z, out);
const headingToGame = (h) => portHeadingToGame(FRAME, h);

const state = {
  T: Number(params.get('t')) || 0,
  speed: 1,
  paused: false,
  cam: { x: P0.x, y: P0.y, zoom: 0.09 },
  mode: 'game',
  view: 1,
  fps: 60,
  alarm: false,
  roofOpen: false,
  launchAt: -1,
  destroyAt: -1
};

// ---------------------------------------------------------------------------
// Okręty: rząd na parkingu (skład misji 1) i eskorta na polach hali
const HULL_OF = (key) => (String(key).includes('battleship') ? 'pirate_battleship' : String(key).includes('destroyer') ? 'pirate_destroyer' : 'pirate_frigate');
const parked = layout.berths.map((b, i) => {
  const key = SHIPYARD_TUNE.parked[i] ?? 'destroyer';
  const hullId = HULL_OF(key);
  const size = trafficHullRenderSize(hullId);
  const pose = dryDockShipPose(b, size.w);
  const g = hubToGame(pose.x, pose.z);
  return { id: `p${i}`, hullId, x: g.x, y: g.y, angle: headingToGame(pose.angle), berth: i, slot: b.slot, size: size.w, alive: true };
});
const escortKeys = SHIPYARD_TUNE.defenders;
const escortPads = ['H-M1', 'H-M3', 'H-M4', 'H-M2', 'H-M5'];
const escorts = escortKeys.map((key, i) => {
  const pad = layout.hall.pads.find((p) => p.id === escortPads[i]);
  const hullId = HULL_OF(key);
  const g = hubToGame(pad.x, pad.z);
  return {
    id: `e${i}`, hullId, pad, x: g.x, y: g.y, angle: headingToGame(pad.angle), vx: 0, vy: 0,
    home: { x: g.x, y: g.y, angle: headingToGame(pad.angle) },
    path: pad.launch.path.map((q) => hubToGame(q.x, q.z)), pi: 0, phase: 'docked', t0: 0
  };
});
function resetShips() {
  for (const p of parked) p.alive = true;
  for (const e of escorts) {
    e.x = e.home.x; e.y = e.home.y; e.angle = e.home.angle; e.vx = e.vy = 0;
    e.pi = 0; e.phase = 'docked';
  }
}
function moveTo(ship, tx, ty, speed, dt, turn = 2.0) {
  const dx = tx - ship.x;
  const dy = ty - ship.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-3) { ship.vx = ship.vy = 0; return true; }
  const step = Math.min(d, speed * dt);
  ship.x += dx / d * step;
  ship.y += dy / d * step;
  ship.vx = dt > 0 ? dx / d * speed : 0;
  ship.vy = dt > 0 ? dy / d * speed : 0;
  if (d > 30) {
    const want = Math.atan2(dy, dx);
    const da = Math.atan2(Math.sin(want - ship.angle), Math.cos(want - ship.angle));
    ship.angle += da * Math.min(1, dt * turn);
  }
  return step >= d - 1e-6;
}
// Wylot: kolejno co 1,4 s, przez bramę pola (G-01 albo logistyczne na skosach), przyspieszanie w hali.
function stepEscorts(dt) {
  if (state.launchAt < 0) return;
  escorts.forEach((e, i) => {
    const start = state.launchAt + 1.2 + i * 1.4;
    if (e.phase === 'docked' && state.T >= start) { e.phase = 'launch'; e.t0 = state.T; }
    if (e.phase !== 'launch') return;
    const speed = Math.min(620, 40 + 160 * (state.T - e.t0));
    const tgt = e.path[e.pi];
    if (moveTo(e, tgt.x, tgt.y, speed, dt, 2.4)) {
      e.pi++;
      if (e.pi >= e.path.length) { e.phase = 'out'; e.vx = e.vy = 0; }
    }
  });
}
function launchGates() {
  const out = [0, 0, 0];
  for (const e of escorts) {
    if (e.phase !== 'launch') continue;
    const g = e.pad.launch.gate === 'G-01' ? 0 : e.pad.launch.gate === 'G-02' ? 1 : 2;
    out[g] = 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dok
const dock = new PirateDryDock3D({ layout, frame: FRAME, name: 'Suchy dok PD-1' });
host.add(dock.root);
function applyLayers() {
  const cine = state.mode === 'cine';
  dock.setLayers(LAYER_BG, cine ? LAYER_BG : LAYER_FG);
}

// Wybuchy przy odpadaniu kawałków (ten sam wybuch reaktora co w grze — krok klatki efektów Core3D).
let reactorBlow = null;
// Ten sam łańcuch rozpadu co misja (planDryDockChain: kawałki po kotwicach od trafienia, wybuchy przy dużych).
const destroyQueue = [];
function startDestruction(start = 'R-2') {
  dock.resetChunks();
  destroyQueue.length = 0;
  for (const ch of planDryDockChain(layout, start)) destroyQueue.push({ ...ch, t: state.T + 0.4 + ch.t });
  destroyQueue.sort((x, y) => x.t - y.t);
  const hc = layout.hall.center;
  destroyQueue.push({ id: null, kind: 'final', size: 520, at: { x: hc.x, z: hc.z + 600 }, t: (destroyQueue.at(-1)?.t ?? state.T) + 0.6 });
  state.destroyAt = state.T;
}
const _c = new THREE.Vector3();
function stepDestruction() {
  while (destroyQueue.length && destroyQueue[0].t <= state.T) {
    const ch = destroyQueue.shift();
    if (ch.kind === 'final') {
      const g = hubToGame(ch.at.x, ch.at.z);
      reactorBlow?.({ x: g.x, y: g.y, size: ch.size });
      continue;
    }
    const c = layout.chunkById.get(ch.id);
    dock.breakChunk(ch.id, { speed: c.kind === 'spine' ? 55 : 95, spin: c.kind === 'spine' ? 0.05 : 0.14, life: 40 });
    dock.chunkCenter(ch.id, _c);
    const g = hubToGame(_c.x, _c.z);
    if (reactorBlow && ch.size > 0) reactorBlow({ x: g.x, y: g.y, size: ch.size });
    // okręty stanowisk przy zniszczonym odcinku trzonu idą z nim (w grze: łańcuch wybuchów reaktorów)
    if (c.kind === 'spine') for (const p of parked) if (p.alive && layout.berths[p.berth].segment === ch.id) p.alive = false;
  }
}

// ---------------------------------------------------------------------------
// Taran (podgląd): zastępczy kadłub (lotniskowiec Terra Novy — proxy ruchu nie ma Atlasa) jedzie torem taranu,
// rozbija bramę G-W tym samym testem co gra (dryDockRamOverlap — prostokąt kadłuba × bryły bram), okręty
// na torze wybuchają po kolei (w grze miażdży je fizyka belek), na końcu brama G-E.
const RAMMABLE = new Set(['gate', 'fence', 'frame']);
const ramShapes = layout.hitSolids.filter((h) => RAMMABLE.has(layout.chunkById.get(h.chunk)?.kind)).map((h) => {
  const pts = h.poly.map((p) => hubToGame(p.x, p.z));
  return {
    chunk: h.chunk, pts,
    x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)),
    y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y))
  };
});
const RAMMER = trafficHullRenderSize('terran_carrier');
const ram = { active: false, s: 0, speed: 650, x: 0, y: 0, vx: 0, vy: 0, angle: headingToGame(0), gone: new Set(), hits: [] };
function startRam() {
  calm();
  ram.active = true;
  ram.s = layout.parking.x0 - 2400;
  ram.gone.clear();
  stepRam(0);
  syncActions();
}
function stepRam(dt) {
  if (!ram.active) return;
  ram.s += ram.speed * dt;
  const g = hubToGame(ram.s, layout.parking.laneZ);
  ram.vx = dt > 0 ? (g.x - ram.x) / dt : 0;
  ram.vy = dt > 0 ? (g.y - ram.y) / dt : 0;
  ram.x = g.x;
  ram.y = g.y;
  const n = dryDockRamOverlap(ramShapes, ram.x, ram.y, ram.angle, RAMMER.w * 0.48, RAMMER.h * 0.42, ram.gone, ram.hits);
  for (let i = 0; i < n; i++) {
    const id = ram.hits[i];
    if (dock.ramChunk(id, { x: 1, z: 0 }, ram.speed)) ram.gone.add(id);
  }
  // okręty: dziób kadłuba wchodzi w stanowisko → okręt wybucha
  const bow = ram.s + RAMMER.w * 0.48;
  for (const p of parked) {
    if (!p.alive || bow < p.slot.x0 + 25) continue;
    p.alive = false;
    reactorBlow?.({ x: p.x, y: p.y, size: p.hullId === 'pirate_battleship' ? 240 : p.hullId === 'pirate_destroyer' ? 170 : 120 });
  }
  if (ram.s > layout.parking.x1 + 2600) { ram.active = false; syncActions(); }
}

// ---------------------------------------------------------------------------
// Widoki
const center = (x, z) => hubToGame(x, z);
function setGame(c, zoom) {
  state.mode = 'game';
  state.cam.x = c.x;
  state.cam.y = c.y;
  state.cam.zoom = zoom;
  applyLayers();
}
const cine = { cam: null, persp: new THREE.PerspectiveCamera(42, 1, 20, 400000), target: new THREE.Vector3(), dist: 9000, az: -0.6, el: 0.55 };
cine.persp.up.set(0, 0, 1);
function setCine(x, z, height, dist, az, el) {
  state.mode = 'cine';
  const c = center(x, z);
  cine.target.set(c.x, -c.y, height);
  cine.dist = dist; cine.az = az; cine.el = el;
  applyLayers();
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
const H_ = layout.hall;
const PK = layout.parking;
const VIEWS = [
  { key: 1, name: 'Cały dok', sub: `trzon ${(layout.width / 1000).toFixed(1)} km, parking ${layout.berths.length} okrętów, hala K-7 piratów`, apply: () => { calm(); setGame(center(0, (layout.bounds.z0 + layout.bounds.z1) / 2 + 300), 0.105); } },
  { key: 2, name: 'Parking', sub: 'okręty burta w burtę, zamknięte ogrodzeniem i bramami', apply: () => { calm(); setGame(center(0, PK.laneZ - 300), 0.24); } },
  { key: 3, name: 'Brama taranowa G-W', sub: 'cienka brama, pylony, reflektory', apply: () => { calm(); setGame(center(PK.x0 + 350, PK.laneZ - 60), 0.62); } },
  { key: 4, name: 'Hala (dach otwarty)', sub: 'eskorta na polach, pas wylotu, łup przy ścianach', apply: () => { calm(); state.roofOpen = true; setGame(center(0, (H_.backZ + H_.frontZ) / 2 - 200), 0.2); } },
  { key: 5, name: 'Alarm: wylot eskorty', sub: 'koguty, dach otwarty, bramy zielone', apply: () => { calm(); alarm(true); launch(); setGame(center(0, H_.frontZ + 300), 0.11); } },
  { key: 6, name: 'Kino: parking z ukosa', sub: 'wolna kamera — bryła 3D', apply: () => { calm(); setCine(-400, PK.laneZ - 200, -60, 6400, 0.35, 0.5); } },
  { key: 7, name: 'Kino: brama G-01', sub: 'hala od strony kosmosu', apply: () => { calm(); alarm(true); setCine(0, H_.frontZ + 700, 40, 6200, Math.PI * 0.86, 0.33); } },
  { key: 8, name: 'Taran (podgląd)', sub: 'kadłub zastępczy rozbija bramę i rząd', apply: () => { startRam(); setGame(center(PK.x0 + 500, PK.laneZ - 100), 0.3); } },
  { key: 9, name: 'Zniszczenie (podgląd)', sub: 'kawałki = przyszłe ciała silnika zniszczeń', apply: () => { calm(); setGame(center(0, (layout.bounds.z0 + layout.bounds.z1) / 2 + 300), 0.095); startDestruction(); } }
];
function calm() {
  state.alarm = false;
  state.roofOpen = false;
  state.launchAt = -1;
  state.destroyAt = -1;
  destroyQueue.length = 0;
  ram.active = false;
  dock.resetChunks();
  resetShips();
  syncActions();
}
function alarm(on) { state.alarm = !!on; state.roofOpen = !!on || state.roofOpen; syncActions(); }
function launch() { resetShips(); state.alarm = true; state.roofOpen = true; state.launchAt = state.T; syncActions(); }
function applyView(i) {
  const v = VIEWS[Math.max(0, Math.min(VIEWS.length - 1, i - 1))];
  state.view = v.key;
  v.apply();
  for (const b of viewButtons) b.classList.toggle('on', Number(b.dataset.view) === v.key);
}

// ---------------------------------------------------------------------------
// UI
const viewButtons = VIEWS.map((v) => {
  const b = document.createElement('button');
  b.dataset.view = String(v.key);
  b.innerHTML = `${v.key} · ${v.name}<small>${v.sub}</small>`;
  b.addEventListener('click', () => applyView(v.key));
  $('views').appendChild(b);
  return b;
});
const ACTIONS = [
  ['alarm', 'Alarm (A)', () => alarm(!state.alarm), () => state.alarm],
  ['roof', 'Dach otwarty', () => { state.roofOpen = !state.roofOpen; syncActions(); }, () => state.roofOpen],
  ['launch', 'Wylot eskorty (L)', () => launch(), () => state.launchAt >= 0],
  ['ram', 'Taran (T)', () => startRam(), () => ram.active],
  ['destroy', 'Zniszczenie (D)', () => startDestruction(), () => state.destroyAt >= 0],
  ['reset', 'Od nowa (R)', () => calm(), () => false]
];
const actionButtons = ACTIONS.map(([key, label, run]) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', run);
  $('actions').appendChild(b);
  return b;
});
function syncActions() {
  ACTIONS.forEach((a, i) => actionButtons[i].classList.toggle('on', !!a[3]()));
}
const SPEEDS = [['pauza', 0], ['1×', 1], ['5×', 5], ['20×', 20]];
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

let dragging = 0;
let lastX = 0;
let lastY = 0;
canvas2d.addEventListener('contextmenu', (e) => e.preventDefault());
canvas2d.addEventListener('pointerdown', (e) => { dragging = 1; lastX = e.clientX; lastY = e.clientY; canvas2d.setPointerCapture(e.pointerId); });
canvas2d.addEventListener('pointerup', () => { dragging = 0; });
canvas2d.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  if (state.mode === 'cine') {
    cine.az -= dx * 0.005;
    cine.el = Math.max(0.08, Math.min(1.45, cine.el + dy * 0.004));
    return;
  }
  state.cam.x -= dx / state.cam.zoom;
  state.cam.y -= dy / state.cam.zoom;
});
canvas2d.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (state.mode === 'cine') {
    cine.dist = Math.max(800, Math.min(60000, cine.dist * Math.exp(e.deltaY * 0.001)));
    return;
  }
  const k = Math.exp(-e.deltaY * 0.0012);
  const z0 = state.cam.zoom;
  const z1 = Math.max(0.02, Math.min(3.2, z0 * k));
  const mx = (e.clientX - W / 2);
  const my = (e.clientY - H / 2);
  state.cam.x += mx / z0 - mx / z1;
  state.cam.y += my / z0 - my / z1;
  state.cam.zoom = z1;
}, { passive: false });
addEventListener('keydown', (e) => {
  if (/^Digit[1-9]$/.test(e.code)) applyView(Number(e.code.slice(5)));
  else if (e.code === 'KeyA') alarm(!state.alarm);
  else if (e.code === 'KeyL') launch();
  else if (e.code === 'KeyT') startRam();
  else if (e.code === 'KeyD') startDestruction();
  else if (e.code === 'KeyR') calm();
  else if (e.code === 'Space') { setSpeed(state.speed ? 0 : 1); e.preventDefault(); }
});

// ---------------------------------------------------------------------------
// Klatka
const cullInfo = { x: 0, y: 0, drawHalfW: 0, drawHalfH: 0, halfW: 0, halfH: 0 };
let lastInfo = { calls: 0, triangles: 0 };

function simulate(dt) {
  if (dt <= 0) return;
  state.T += dt;
  stepEscorts(dt);
  stepRam(dt);
  stepDestruction();
}

function render(realDt, simDt) {
  const cam = state.mode === 'cine' ? cineCamera() : state.cam;
  dock.setSun({ sun: window.SUN, at: P0 });
  const launchG = launchGates();
  dock.update(simDt, {
    alarm: state.alarm,
    roofFade: state.roofOpen ? 1 : 0,
    launch: launchG,
    gates: state.alarm ? [1, 1, 1] : [0, 0, 0],
    berths: parked.map((p) => (p.alive ? 1 : 0)),
    daylight: 0.25
  });
  // reflektory w siatce świateł (jak w grze — pirateDryDockGame.js): oświetlają kadłuby okrętów
  dock.pushGridLights(Core3D.fx?.lights, hubToGame);
  ShipProxyBatch3D.begin(cam);
  for (const p of parked) if (p.alive) ShipProxyBatch3D.push(p.id, p.hullId, p.x, p.y, p.angle);
  for (const e of escorts) {
    const moving = Math.hypot(e.vx, e.vy) > 5;
    ShipProxyBatch3D.push(e.id, e.hullId, e.x, e.y, e.angle, { vx: e.vx, vy: e.vy, throttle: moving ? 0.8 : 0 });
  }
  if (ram.active) ShipProxyBatch3D.push('ram', RAMMER.id, ram.x, ram.y, ram.angle, { vx: ram.vx, vy: ram.vy, throttle: 1 });
  ShipProxyBatch3D.end();
  const zoom = state.mode === 'cine' ? 1 : cam.zoom;
  cullInfo.x = cam.x;
  cullInfo.y = cam.y;
  cullInfo.drawHalfW = W * 0.5 / zoom + 600;
  cullInfo.drawHalfH = H * 0.5 / zoom + 600;
  cullInfo.halfW = cullInfo.drawHalfW * 3;
  cullInfo.halfH = cullInfo.drawHalfH * 3;
  Fx3D.update(simDt);
  updateHexShips3D(cam, ShipProxyBatch3D.engineEntities, cullInfo);
  drawHexShips3D(ctx2d, W, H);
  const r = Core3D.lastFrameRenderInfo?.total || Core3D.renderer?.info?.render || {};
  lastInfo = { calls: r.calls || 0, triangles: r.triangles || 0 };
}

let lastMs = performance.now();
let hudAt = 0;
function frame(now) {
  const realDt = Math.min(0.1, Math.max(0, (now - lastMs) / 1000));
  lastMs = now;
  state.fps = state.fps * 0.93 + (realDt > 0 ? 1 / realDt : 60) * 0.07;
  const simDt = state.paused ? 0 : realDt * state.speed;
  simulate(simDt);
  render(realDt, simDt);
  if (now - hudAt > 250) { hudAt = now; updateHud(); }
}
function loop(now) {
  try { frame(now); } catch (err) { reportError(err.stack || String(err)); }
  if (!shotMode) requestAnimationFrame(loop);
}

function updateHud() {
  const broken = dock.chunkState.filter((s) => s.broken || s.hidden).length;
  const lines = [
    `<b>FPS</b> ${state.fps.toFixed(0).padStart(4)}   <b>draw</b> ${lastInfo.calls}   <b>tri</b> ${(lastInfo.triangles / 1000).toFixed(0)}k`,
    `<b>dok</b> ${dock.scene.instances} brył · siatek ${dock.drawCalls} · ${Math.round(layout.width)} × ${Math.round(layout.depth)} j.`,
    `<b>kawałki</b> ${layout.chunks.length} (odpadłe ${broken}) · grupy ${layout.chunks.length + 1}/48`,
    `<b>czas</b> ${state.T.toFixed(1)} s (${state.paused ? 'pauza' : state.speed + '×'})   <b>zoom</b> ${state.cam.zoom.toFixed(3)}`,
    `<b>alarm</b> ${state.alarm ? 'TAK' : 'nie'} · dach ${Math.round(dock.roofFade * 100)}% · eskorta ${escorts.map((e) => e.phase[0]).join('')} · okręty ${parked.filter((p) => p.alive).length}/${parked.length}`,
    `<b>proxy</b> ${ShipProxyBatch3D.stats.drawn} rys. · czeka na obraz ${ShipProxyBatch3D.stats.waitingImage}`
  ];
  $('hud').innerHTML = lines.join('\n');
  const v = VIEWS[state.view - 1];
  $('caption').textContent = `${v.key} · ${v.name} — ${v.sub}`;
}

// ---------------------------------------------------------------------------
// API zrzutów (dema/suchy-dok-piratow-shots.js)
window.__dock = {
  ready: false,
  get errors() { return errors.slice(); },
  view(i) { applyView(i); return VIEWS[i - 1]?.name; },
  setSpeed(s) { setSpeed(s); },
  alarm(on = true) { alarm(on); },
  roof(open = true) { state.roofOpen = !!open; },
  launch() { launch(); },
  ram() { startRam(); },
  destroy() { startDestruction(); },
  calm() { calm(); },
  simulate(seconds, step = 1 / 30) {
    const n = Math.round(seconds / step);
    for (let i = 0; i < n; i++) { simulate(step); render(step, step); }
    updateHud();
  },
  renderFrames(n = 1, dt = 1 / 60) {
    for (let i = 0; i < n; i++) { simulate(state.paused ? 0 : dt * (state.speed || 1)); render(dt, state.paused ? 0 : dt); }
    updateHud();
    return { ...lastInfo };
  },
  cine(x, z, h, dist, az, el) { setCine(x, z, h, dist, az, el); },
  hub(x, z, zoom) { setGame(center(x, z), zoom); },
  stats() {
    return {
      ...lastInfo,
      instances: dock.scene.instances,
      drawCalls: dock.drawCalls,
      proxies: { ...ShipProxyBatch3D.stats },
      broken: dock.chunkState.filter((s) => s.broken || s.hidden).map((s) => s.id),
      roofFade: dock.roofFade,
      escorts: escorts.map((e) => e.phase),
      parkedAlive: parked.filter((p) => p.alive).length,
      errors: errors.slice()
    };
  },
  dock, layout
};

// ---------------------------------------------------------------------------
// Start
if (!(await Core3D.ready)) {
  reportError(`WebGPU: ${Core3D.gpuError || 'brak urządzenia — demo wymaga przeglądarki z WebGPU'}`);
  throw new Error('WebGPU niedostępne');
}
try { reactorBlow = createReactorBlowFactory(Core3D); } catch (err) { reportError(`wybuchy: ${err.message}`); }
applyLayers();
setSpeed(1);
syncActions();
applyView(Math.max(1, Math.min(VIEWS.length, Number(params.get('view')) || 1)));
if (params.has('zoom')) state.cam.zoom = Number(params.get('zoom'));
if (shotMode) {
  setSpeed(0);
  const wait = () => {
    render(1 / 60, 0);
    if (ShipProxyBatch3D.stats.waitingImage === 0 && dock.hulls.every((h) => h.mesh.visible)) {
      window.__dock.renderFrames(3);
      window.__dock.ready = true;
    } else setTimeout(wait, 60);
  };
  wait();
} else {
  window.__dock.ready = true;
  requestAnimationFrame(loop);
}
// k7HeightToZ — wysokości układu (dla konsoli: __dock.layout + k7HeightToZ)
window.k7HeightToZ = k7HeightToZ;
