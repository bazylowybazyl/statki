// Demo: HUTA — STANOWISKO RUDY (element 1 huty: fizyczna ruda od ładowni statku przez „odkurzacz” do kopca i na taśmę).
//   /dema/huta-ruda.html   (?ruda=0…4, ?view=1…4, ?tempo=0.25|1|2|4, ?shot=1 — bez panelu i pętli: klatki z API,
//                           ?worker=0 — symulacja na wątku strony)
// Symulacja: `dema/ring-dzielnice/huta/ruda/` (czysty JS) w Web Workerze — migawki tablicami typowanymi; obraz:
// `obraz.js` (ziarna, podkład, taśma), `pyl.js`, bryły stałe z zestawu portowego: `scena.js`. Potok renderu gry (Core3D).
// Pętla idzie od razu: przy starcie kopiec leży (rozbieg trybem szybkim w workerze), statek pełny stoi przy pirsie.
// Widok 1 (z góry) ma kadr obrócony o −90° — stanowisko leży wzdłuż szerokiego ekranu: statek z lewej, piec z prawej.
// Ładownia rysuje się w „strefie ładowni”: wysokości 1:1 względem pokładu (ziarna, zrębnica, dzwon) i jest otworem
// w pokładzie statku (dno 50 j. pod pokładem) — patrz `obraz.js`.
// Każda zmiana rudy = NOWY worker (jedno stanowisko na izolat V8: krok pierwszego stanowiska nie alokuje).
import * as THREE from 'three';
import { Core3D } from '../src/3d/core3d.js';
import { drawHexShips3D, initHexShips3D, resizeHexShips3D, updateHexShips3D } from '../src/3d/hexShips3D.js';
import { Fx3D } from '../src/3d/fxParticles3D.js';
import { ShipProxyBatch3D } from '../src/3d/shipProxyBatch3D.js';
import { SimClock } from '../src/game/simClock.js';
import { rollToScreen, rollToWorld, rolledHalfExtents } from '../src/3d/viewRoll.js';
import { WARIANT_INSTANCJI } from '../src/3d/rozgrzewka.js';
import { resolvePortBuildingStyle } from '../src/3d/portBuildings/portBuildingStyle.js';
import { portHubMatrixElements, portModuleFrame } from '../src/3d/portBuildings/portModuleTraffic.js';
import { PORT_SPACE_LIGHT, PortBuilding3D } from '../src/3d/portBuildings/portBuildings3D.js';
import { k7HeightToZ } from '../src/3d/haloRing/haloPortK7Layout.js';
import { GRAIN, ORES } from './ring-dzielnice/huta/ruda/rudy.js';
import { createStationGeometry } from './ring-dzielnice/huta/ruda/geometria.js';
import { COUNTER, SHIP_STATES, STATE, TUNE } from './ring-dzielnice/huta/ruda/stanowisko.js';
import { SNAP, createRudaHost, snapViews } from './ring-dzielnice/huta/ruda/ruda.worker.js';
import { RudaObraz } from './ring-dzielnice/huta/ruda/obraz.js';
import { RudaPyl } from './ring-dzielnice/huta/ruda/pyl.js';
import { bellSceneZ, buildOrePierScene, buildOreVacScene, buildOreYardScene } from './ring-dzielnice/huta/ruda/scena.js';

const params = new URLSearchParams(location.search);
const shotMode = params.get('shot') === '1';
const useWorker = params.get('worker') !== '0';
if (shotMode) document.body.classList.add('shot');
const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------------------
// Błędy na ekranie
const errors = [];
function reportError(text) {
  errors.push(String(text).slice(0, 2000));
  const el = $('errors');
  el.style.display = 'block';
  el.textContent = errors.join('\n\n');
  console.error(text);
}
addEventListener('error', (e) => reportError(`JS: ${e.message} @ ${e.filename}:${e.lineno}`));
addEventListener('unhandledrejection', (e) => reportError(`Promise: ${e.reason?.stack || e.reason}`));

// ---------------------------------------------------------------------------
// Core3D jak w grze (kanwa WebGPU pod spodem, klatka kopiowana na 2D)
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

// Początek układu daleko od zera (precyzja float32 jak w grze); Słońce gry z lewej, lekko od dołu kadru.
const P0 = Object.freeze({ x: 7_080_000, y: 6_290_000 });
window.SUN = { x: P0.x - 1_150_000, y: P0.y + 420_000, r: 2600 };
const SUN_OPTS = { sun: window.SUN, at: P0 };
const TICK = { daylight: 0.35, lampPower: 1.15 };

(function addStars() {
  const n = 3200;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let seed = 5151;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (rnd() - 0.5) * 900000;
    pos[i * 3 + 1] = (rnd() - 0.5) * 620000;
    pos[i * 3 + 2] = -90000 - rnd() * 40000;
    const b = Math.pow(rnd(), 6) * 1.2 + 0.05;
    const tint = rnd();
    col[i * 3] = b * (0.85 + 0.15 * tint);
    col[i * 3 + 1] = b * 0.92;
    col[i * 3 + 2] = b * (1.05 - 0.15 * tint);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false }));
  pts.frustumCulled = false;
  pts.position.set(P0.x, -P0.y, 0);
  pts.layers.set(1);
  Core3D.scene.add(pts);
})();

const host = new THREE.Group();
host.name = 'Stanowisko rudy (gospodarz)';
host.position.set(P0.x, -P0.y, 0);
Core3D.scene.add(host);
const LAYER_BG = 1;
const LAYER_FG = 2;
// Ramka: x stanowiska = +X sceny, z stanowiska = −Y sceny (= +y gry, w dół ekranu).
const FRAME = portModuleFrame(0, 0, -Math.PI / 2);
const geo = createStationGeometry();
const style = resolvePortBuildingStyle('earth');

// ---------------------------------------------------------------------------
// Stan strony
// Kadr z góry OBRÓCONY o −90° (cam.roll, src/render/viewRoll.js): stanowisko ma 3 830 × 2 060 j. — na szerokim
// ekranie leży wzdłuż kadru (statek z lewej, zasiek i galeria pieca z prawej) i ziarno ma ~2,5 px już przy 1600 × 900.
const TOP_ROLL = -Math.PI / 2;
const state = {
  view: 1,
  mode: 'top',                  // top | cine
  cam: { x: P0.x, y: P0.y + 11500, zoom: 0.25, roll: TOP_ROLL },
  ore: clamp(Number(params.get('ruda')) | 0, 0, ORES.length - 1),
  speed: Number(params.get('tempo')) > 0 ? Number(params.get('tempo')) : 1,
  paused: false,
  fps: 60
};

// ---------------------------------------------------------------------------
// Symulacja: worker (albo ten sam gospodarz na wątku strony) i kolejka migawek
let layout = null;
let gen = 0;
let obraz = null;
let pyl = null;
const queue = [];               // migawki czekające: { v, t1, dt }
const cur = { has: false, t0: 0, t1: 0, dt: 0 };
let tau = 0;                    // czas symulacji klatki (między t0 a t1 bieżącej migawki)
let alpha = 1;
const prevS = new Float64Array(32);
const curS = new Float64Array(32);
const lerpS = new Float64Array(32);
const counters = new Float64Array(16);
const jet = [0, 0, -1];
const sim = { stepMs: 0, stepMax: 0, snapMs: 0, applyMs: 0, snaps: 0, moving: 0, cols: 0, initMs: 0, lastSeq: -1, lost: 0 };
const pendingAdvance = new Map();
let advanceId = 0;
let readyResolve = null;
let live = !shotMode;

let post;
let worker = null;
/** Świeży worker dla nowego stanowiska (stary kończy pracę razem ze swoją pulą buforów migawek). */
function spawnWorker() {
  if (worker) worker.terminate();
  const w = new Worker(new URL('./ring-dzielnice/huta/ruda/ruda.worker.js', import.meta.url), { type: 'module' });
  w.onmessage = (e) => { if (w === worker) onHost(e.data); };
  w.onerror = (e) => reportError(`Worker rudy: ${e.message || e}`);
  worker = w;
}
if (useWorker) {
  post = (m, transfer) => worker.postMessage(m, transfer || []);
} else {
  const local = createRudaHost((m) => onHost(m));
  post = (m) => local.handle(m);
}
const recycle = (buf) => post({ type: 'recycle', buf }, [buf]);

function onHost(m) {
  if (m.type === 'snap') {
    if (m.gen !== gen || !layout) { if (!useWorker) recycle(m.buf); return; }
    const v = snapViews(m.buf, layout);
    const t1 = v.state[STATE.time];
    const dt = v.extra[SNAP.stepSim];
    queue.push({ v, t1, dt });
    if (!live && obraz) while (queue.length) take();
  } else if (m.type === 'ready') {
    if (m.gen !== gen) return;
    layout = m.layout;
    sim.initMs = m.initMs;
    if (readyResolve) { const r = readyResolve; readyResolve = null; r(); }
  } else if (m.type === 'advanced') {
    const r = pendingAdvance.get(m.id);
    pendingAdvance.delete(m.id);
    if (r) r(m);
  } else if (m.type === 'error') {
    reportError(`Symulacja rudy: ${m.text}`);
  }
}

/** Następna migawka z kolejki → bufory obrazu, pył, stan maszyn; bufor wraca do workera. */
function take() {
  const q = queue.shift();
  const v = q.v;
  const t0 = performance.now();
  if (!cur.has) prevS.set(v.state); else prevS.set(curS);
  curS.set(v.state);
  counters.set(v.counters);
  const x = v.extra;
  if (obraz) obraz.applySnapshot(v);
  jet[0] = v.state[STATE.jetX]; jet[1] = v.state[STATE.jetY]; jet[2] = v.state[STATE.jetZ];
  if (pyl && x[SNAP.nEvents] > 0) pyl.spawn(v.events, x[SNAP.nEvents], q.t1, jet, q.dt);
  const seq = x[SNAP.seq];
  if (sim.lastSeq >= 0 && seq !== sim.lastSeq + 1) sim.lost++;
  sim.lastSeq = seq;
  const ms = x[SNAP.stepMs];
  sim.stepMs += (ms - sim.stepMs) * 0.05;
  sim.stepMax = Math.max(sim.stepMax * 0.995, ms);
  sim.snapMs += (x[SNAP.snapMs] - sim.snapMs) * 0.05;
  sim.moving = x[SNAP.nHold] + x[SNAP.nBunker] + x[SNAP.nPipe] + x[SNAP.nBelt];
  sim.cols = x[SNAP.holdCount] + x[SNAP.bunkerCount];
  sim.snaps++;
  cur.has = true;
  cur.t1 = q.t1;
  cur.dt = q.dt;
  cur.t0 = q.t1 - q.dt;
  recycle(v.buf);
  sim.applyMs += (performance.now() - t0 - sim.applyMs) * 0.05;
}

/** Zegar obrazu: `tau` goni najnowszą migawkę z opóźnieniem ~1,4 kroku; `alpha` — postęp w bieżącym kroku. */
function pump(realDt) {
  if (!obraz) return;
  if (!cur.has) {
    if (!queue.length) return;
    take();
    tau = cur.t0;
  }
  if (live && !state.paused) {
    const newest = queue.length ? queue[queue.length - 1].t1 : cur.t1;
    const lat = cur.dt > 0 ? (newest - tau) / cur.dt : 0;
    const rate = clamp(1 + 0.2 * (lat - 1.4), 0.85, 1.25);
    tau += realDt * state.speed * rate;
    while (queue.length && tau >= cur.t1) take();
    if (queue.length > 2) { while (queue.length > 1) take(); tau = cur.t0; }      // zaległość (karta była w tle)
  } else {
    while (queue.length) take();
    tau = cur.t1;
  }
  if (tau > cur.t1) tau = cur.t1;
  if (tau < cur.t0) tau = cur.t0;
  alpha = cur.dt > 0 ? (tau - cur.t0) / cur.dt : 1;
  for (let i = 0; i < 32; i++) lerpS[i] = prevS[i] + (curS[i] - prevS[i]) * alpha;
}

function sunStation() {
  // kierunek ku słońcu w układzie stanowiska (x, y w górę, z) — ten sam co budowle (azymut ze Słońca gry, 49° nad horyzontem)
  const az = Math.atan2(-(window.SUN.y - P0.y), window.SUN.x - P0.x);
  const el = PORT_SPACE_LIGHT.sunElevationDeg * DEG;
  return [Math.cos(el) * Math.cos(az), Math.sin(el), -Math.cos(el) * Math.sin(az)];
}

/** Nowe stanowisko dla rudy `i` (rozbieg w workerze ~1 s); obietnica po pierwszej migawce. */
function startOre(i) {
  state.ore = clamp(i | 0, 0, ORES.length - 1);
  gen++;
  if (useWorker) { queue.length = 0; spawnWorker(); } else while (queue.length) recycle(queue.shift().v.buf);
  for (const r of pendingAdvance.values()) r({ steps: 0, ms: 0, stepMs: 0, stepMax: 0, cancelled: true });
  pendingAdvance.clear();
  cur.has = false;
  sim.lastSeq = -1;
  sim.stepMax = 0;
  const ready = new Promise((ok) => { readyResolve = ok; });
  post({ type: 'init', gen, ore: state.ore, seed: 7, sun: sunStation(), speed: state.paused ? 0 : state.speed, live });
  return ready.then(() => new Promise((ok) => {
    const wait = () => { if (queue.length || cur.has) { ok(); } else setTimeout(wait, 8); };
    wait();
  })).then(() => {
    if (obraz) obraz.setOre(ORES[state.ore]);
    if (pyl) { pyl.setOre(ORES[state.ore]); pyl.reset(); }
    syncUi();
  });
}

// ---------------------------------------------------------------------------
// Budowle (zestaw portowy) i grupy ruchome
const B = { list: [] };
function mk(scene, name) {
  const b = new PortBuilding3D({ layout: { id: name }, scene, style, frame: FRAME, name });
  for (const set of Object.values(b.meshes)) for (const m of set) m.frustumCulled = false;
  host.add(b.root);
  B.list.push(b);
  return b;
}
let yard = null;
let vac = null;
const _m4 = new THREE.Matrix4();
const _m4b = new THREE.Matrix4();

function updateMachines() {
  const s = lerpS;
  const gz = s[STATE.gantryZ];
  const tx = s[STATE.trolleyX];
  const bellY = s[STATE.bellY];
  const R = vac.scene.rig;
  const G = vac.uniforms.uGroup.value;
  G[R.gantry].makeTranslation(0, 0, gz - R.ref.gantryZ);
  G[R.trolley].makeTranslation(tx - R.ref.trolleyX, 0, gz - R.ref.gantryZ);
  // dzwon w strefie ładowni (wysokość 1:1 nad pokładem jak ziarna ładowni); wąż: walec jednostkowy × 0,42 w dół
  const bellZ = bellSceneZ(bellY);
  G[R.bell].makeTranslation(tx - R.ref.trolleyX, bellZ, gz - R.ref.gantryZ);
  const hoseTopZ = k7HeightToZ(R.ref.hoseTop);
  const len = Math.max(4, hoseTopZ - (bellZ + R.ref.hoseEnd));
  G[R.hose].makeScale(1, len / 0.42, 1).setPosition(tx, hoseTopZ, gz);
  const pipeLen = R.ref.pipeEndX - (tx + 14);
  G[R.boomPipe].makeScale(Math.max(1e-3, pipeLen), 1, 1).setPosition(tx + 14, 0, gz - R.ref.gantryZ);
  if (pipeLen < 2) G[R.boomPipe].elements[15] = 0;
  // zrębnica jedzie ze statkiem; gdy statku nie ma w kadrze świata (stan „w drodze”), grupa jest zwinięta do zera
  if ((curS[STATE.ship] | 0) === 0) G[R.ship].makeScale(0, 0, 0); else G[R.ship].makeTranslation(0, 0, s[STATE.shipOff]);
  const Y = yard.scene.rig;
  const Gy = yard.uniforms.uGroup.value;
  for (let k = 0; k < Y.gates.length; k++) Gy[Y.gates[k]].makeTranslation(0, 0, s[STATE.gate0 + k] * Y.gateTravel);
  const sp = Y.spout;
  _m4.makeTranslation(sp[0], 0, sp[2]);
  _m4b.makeRotationY(-s[STATE.spoutYaw]);
  _m4.multiply(_m4b);
  _m4b.makeTranslation(-sp[0], 0, -sp[2]);
  Gy[Y.flap].copy(_m4).multiply(_m4b);
  // lampy stanu: dmuchawa pracuje, taśma jedzie
  yard._setChan(0, curS[STATE.spoutFlow] > 40 ? 1 : 0);
  yard._setChan(1, curS[STATE.beltRun] > 0.5 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Widoki
const VIEWS = [
  { key: 1, name: 'Z góry', sub: 'całe stanowisko jak w grze', top: [-1030, 9640, 1030, 13470] },
  { key: 2, name: 'Ładownia i ssawa', sub: 'dzwon kopie lej, ziarna jadą po zboczu pod krawędź', cine: { follow: true, y: 106, az: 2.45, el: 0.8, dist: 185 } },
  { key: 3, name: 'Kopiec z ukosa', sub: 'struga, osypania, krater nad zasuwami', cine: { at: [50, -70, 10550], az: 2.5, el: 0.24, dist: 640 } },
  { key: 4, name: 'Wylot i lądowanie', sub: 'łuk ziaren z wylotu, odbicia, pył', cine: { at: [170, 40, 10700], az: 2.75, el: 0.3, dist: 640 } }
];
// kino: kamera wokół punktu stanowiska; `az` — kąt od +x ku +z (skąd patrzy kamera), `el` — nad poziomem
const cine = { cam: null, persp: new THREE.PerspectiveCamera(42, 1, 5, 400000), target: new THREE.Vector3(), at: [0, 0, 11000], az: 2, el: 0.5, dist: 1500, follow: false, followY: 150 };
cine.persp.up.set(0, 0, 1);

function frameTop(x0, z0, x1, z1) {
  const panel = shotMode ? 0 : 284;
  const rolled = Math.abs(Math.sin(TOP_ROLL)) > 0.5;
  const spanW = rolled ? z1 - z0 : x1 - x0;         // rozpiętość stanowiska wzdłuż szerokości ekranu
  const spanH = rolled ? x1 - x0 : z1 - z0;
  const zoom = Math.min((Math.max(W, 640) - panel) / spanW, Math.max(H, 360) / spanH);
  state.cam.zoom = zoom;
  state.cam.roll = TOP_ROLL;
  // środek stanowiska pół panelu w lewo od środka ekranu: świat = kamera + R(roll) · ekran / zoom
  const off = panel / 2 / zoom;
  state.cam.x = P0.x + (x0 + x1) / 2 + Math.cos(TOP_ROLL) * off;
  state.cam.y = P0.y + (z0 + z1) / 2 + Math.sin(TOP_ROLL) * off;
}
const _fp = [0, 0];
/** Punkt, za którym jedzie kamera widoku 2: oś dzwonu, a gdy statku nie ma przy pirsie — środek pierwszego pola ładowni. */
function followPoint(S) {
  const shipSt = curS[STATE.ship] | 0;
  const atShip = cur.has && (shipSt === 1 || shipSt === 2);
  _fp[0] = atShip ? S[STATE.trolleyX] : geo.hold.fields[0].x;
  _fp[1] = atShip ? S[STATE.gantryZ] : geo.hold.fields[0].z;
}
function applyView(key) {
  const v = VIEWS.find((q) => q.key === key) || VIEWS[0];
  state.view = v.key;
  if (v.top) {
    state.mode = 'top';
    frameTop(...v.top);
  } else {
    state.mode = 'cine';
    cine.az = v.cine.az;
    cine.el = v.cine.el;
    cine.dist = v.cine.dist;
    cine.follow = !!v.cine.follow;
    cine.followY = v.cine.y || 0;
    if (v.cine.at) cine.at = v.cine.at.slice();
    else { followPoint(curS); cine.at = [_fp[0], cine.followY, _fp[1]]; }
  }
  for (const b of viewButtons) b.classList.toggle('on', Number(b.dataset.view) === v.key);
}
function cineCamera(realDt) {
  if (cine.follow && cur.has) {
    // kamera jedzie za dzwonem (wygładzona — dzwon przeskakuje między polami); gdy statku nie ma przy pirsie, dzwon
    // wraca na postój nad pirs — kamera zostaje nad pierwszym polem ładowni i czeka na następny statek
    const k = realDt > 0 ? 1 - Math.exp(-4 * realDt) : 1;
    followPoint(lerpS);
    cine.at[0] += (_fp[0] - cine.at[0]) * k;
    cine.at[2] += (_fp[1] - cine.at[2]) * k;
    cine.at[1] = cine.followY;
  }
  const p = cine.persp;
  const ce = Math.cos(cine.el);
  // cel przy jeździe za dzwonem leży w strefie ładowni (wysokość 1:1 nad pokładem, jak ziarna ładowni)
  cine.target.set(P0.x + cine.at[0], -(P0.y + cine.at[2]), cine.follow ? cine.at[1] - 116 : k7HeightToZ(cine.at[1]));
  p.aspect = W / Math.max(1, H);
  p.near = Math.max(5, cine.dist * 0.04);
  p.updateProjectionMatrix();
  p.position.set(cine.target.x + Math.cos(cine.az) * ce * cine.dist, cine.target.y - Math.sin(cine.az) * ce * cine.dist, cine.target.z + Math.sin(cine.el) * cine.dist);
  p.lookAt(cine.target);
  p.updateMatrixWorld();
  if (!cine.cam) cine.cam = { mode: 'free3d', position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), fov: 42, near: 5, far: 400000, zoom: 1 };
  cine.cam.near = p.near;
  cine.cam.position.copy(p.position);
  cine.cam.quaternion.copy(p.quaternion);
  cine.cam.x = p.position.x;
  cine.cam.y = -p.position.y;
  return cine.cam;
}

// ---------------------------------------------------------------------------
// UI
const viewButtons = VIEWS.map((v) => {
  const b = document.createElement('button');
  b.dataset.view = String(v.key);
  b.innerHTML = `${v.key} · ${v.name}<small>${v.sub}</small>`;
  b.addEventListener('click', () => { applyView(v.key); canvas2d.focus(); });
  $('views').appendChild(b);
  return b;
});
const css = (c) => `rgb(${c.map((q) => Math.round(255 * Math.pow(clamp(q, 0, 1), 1 / 2.2))).join(',')})`;
const oreButtons = ORES.map((o) => {
  const b = document.createElement('button');
  b.className = 'ore';
  b.innerHTML = `<i style="background:${css(o.shades[2])}"></i>${o.name.replace('RUDA ', '').toLowerCase()}`;
  b.title = `${o.name}: kąt usypu ${o.angle}°`;
  b.addEventListener('click', () => { startOre(o.index); canvas2d.focus(); });
  $('ores').appendChild(b);
  return b;
});
const SPEEDS = [['pauza', 0], ['×¼', 0.25], ['×1', 1], ['×2', 2], ['×4', 4]];
const speedButtons = SPEEDS.map(([label, s]) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', () => { setSpeed(s); canvas2d.focus(); });
  $('speeds').appendChild(b);
  return b;
});
function setSpeed(s) {
  state.paused = s === 0;
  if (s > 0) state.speed = s;
  post({ type: 'speed', value: state.paused ? 0 : state.speed });
  syncUi();
}
function syncUi() {
  speedButtons.forEach((b, i) => b.classList.toggle('on', state.paused ? SPEEDS[i][1] === 0 : SPEEDS[i][1] === state.speed));
  oreButtons.forEach((b, i) => b.classList.toggle('on', i === state.ore));
}
const tons = (n) => (n / GRAIN.perTon).toFixed(1).padStart(7);
const SHIP_PL = { away: 'w drodze', approach: 'podchodzi', dock: 'przy pirsie', depart: 'odpływa' };
function updateHud() {
  if (shotMode || !cur.has) return;
  const c = counters;
  const bal = c[COUNTER.loaded] - (c[COUNTER.hold] + c[COUNTER.suction] + c[COUNTER.pipe] + c[COUNTER.air] + c[COUNTER.bunker] + c[COUNTER.belt] + c[COUNTER.furnace] + c[COUNTER.taken]);
  const o = ORES[state.ore];
  $('counters').innerHTML = [
    `<b>${o.name}</b>  <span class="dim">kąt usypu ${o.angle}°</span>`,
    `ładownia   <b>${tons(c[COUNTER.hold] + c[COUNTER.suction])}</b> t`,
    `rura       <b>${tons(c[COUNTER.pipe])}</b> t`,
    `w locie    <b>${tons(c[COUNTER.air])}</b> t`,
    `zasiek     <b>${tons(c[COUNTER.bunker])}</b> t`,
    `<span class="dim">  dostępne ${tons(c[COUNTER.live])} t · martwy ${tons(c[COUNTER.bunker] - c[COUNTER.live]).trim()} t</span>`,
    `taśma      <b>${tons(c[COUNTER.belt])}</b> t`,
    `do pieca   <b>${tons(c[COUNTER.furnace] + c[COUNTER.taken])}</b> t`,
    `<span class="dim">bilans ziaren ${bal === 0 ? '0' : bal}   statek ${SHIP_PL[SHIP_STATES[curS[STATE.ship] | 0]] || ''}</span>`,
    `ruchome    <b>${String(c[COUNTER.suction] + c[COUNTER.air]).padStart(7)}</b> ziaren`,
    `<span class="dim">krok ${sim.stepMs.toFixed(2)} ms (szczyt ${sim.stepMax.toFixed(1)})  ${state.fps.toFixed(0)} kl/s</span>`
  ].join('\n');
}

const _rw = { x: 0, y: 0 };
const _rh = { hw: 0, hh: 0 };
let dragging = false;
let lastX = 0;
let lastY = 0;
canvas2d.addEventListener('contextmenu', (e) => e.preventDefault());
canvas2d.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas2d.setPointerCapture(e.pointerId); canvas2d.focus(); });
canvas2d.addEventListener('pointerup', () => { dragging = false; });
canvas2d.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  if (state.mode === 'cine') {
    cine.az += dx * 0.005;
    cine.el = clamp(cine.el + dy * 0.004, 0.08, 1.5);
    return;
  }
  rollToWorld(dx, dy, state.cam.roll, _rw);
  state.cam.x -= _rw.x / state.cam.zoom;
  state.cam.y -= _rw.y / state.cam.zoom;
});
canvas2d.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (state.mode === 'cine') {
    cine.dist = clamp(cine.dist * Math.exp(e.deltaY * 0.001), 90, 9000);
    return;
  }
  const k = Math.exp(-e.deltaY * 0.0012);
  const z0 = state.cam.zoom;
  const z1 = clamp(z0 * k, 0.05, 6);
  rollToWorld(e.clientX - W / 2, e.clientY - H / 2, state.cam.roll, _rw);
  state.cam.x += _rw.x / z0 - _rw.x / z1;
  state.cam.y += _rw.y / z0 - _rw.y / z1;
  state.cam.zoom = z1;
}, { passive: false });
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (/^Digit[1-4]$/.test(e.code)) applyView(Number(e.code.slice(5)));
  else if (e.code === 'Space') { setSpeed(state.paused ? state.speed : 0); e.preventDefault(); }
});
document.addEventListener('visibilitychange', () => {
  if (!live) return;
  post({ type: 'speed', value: document.hidden || state.paused ? 0 : state.speed });
});

// ---------------------------------------------------------------------------
// Klatka
const cullInfo = { x: 0, y: 0, drawHalfW: 0, drawHalfH: 0, halfW: 0, halfH: 0 };
const lastInfo = { calls: 0, triangles: 0 };
const frameArgs = { alpha: 1, pxK: 1, shipOff: 0, beltTravel: 0, minPx: 1.5, shipVisible: true, bellX: 0, bellSurf: 0, bellZ: 0, bellOn: 0 };
let bellShade = 0;              // krycie cienia dzwonu (narasta, gdy dzwon ssie)
const _sv = new THREE.Vector3();
let lastOff = 0;
// Klatki rozgrzewki statku (przed startem pętli): proxy z ciągiem, żeby materiały gry tworzone przy pierwszym użyciu
// (cień kadłuba, światła nawigacyjne, strugi dysz) skompilowały się pod ekranem startu, nie przy pierwszym podejściu.
let warmShip = 0;

function render(realDt) {
  pump(realDt);
  const cam = state.mode === 'cine' ? cineCamera(realDt) : state.cam;
  const simDt = live && !state.paused ? realDt * state.speed : 0;
  for (const b of B.list) {
    b.setSun(SUN_OPTS);
    b.tick(simDt, TICK);
  }
  if (cur.has) updateMachines();

  // ziarna: piksele na jednostkę × odległość (perspektywa) i szczegółowość bryłki z wielkości ziarna na ekranie
  const fov = state.mode === 'cine' ? 42 : (Core3D.cameraPersp?.fov || 35);
  const pxScale = Core3D.pxScale || 1;
  const pxK = (H * pxScale * 0.5) / Math.tan(fov * 0.5 * DEG);
  const ppu = state.mode === 'cine' ? pxK / Math.max(1, cine.dist) : state.cam.zoom * pxScale;
  if (obraz) {
    const far = ppu < 0.75;
    if (far !== obraz.lodFar) obraz.setLod(far);
    const sucking = cur.has && curS[STATE.vacOn] > 0.5 && (curS[STATE.ship] | 0) === 2;
    bellShade += ((sucking ? 1 : 0) - bellShade) * (realDt > 0 ? 1 - Math.exp(-8 * realDt) : 1);
    frameArgs.alpha = alpha;
    frameArgs.pxK = pxK;
    frameArgs.shipOff = lerpS[STATE.shipOff];
    frameArgs.beltTravel = lerpS[STATE.beltTravel];
    frameArgs.minPx = 1.5 * pxScale;
    frameArgs.shipVisible = cur.has && (curS[STATE.ship] | 0) !== 0;
    frameArgs.bellX = lerpS[STATE.trolleyX];
    frameArgs.bellZ = lerpS[STATE.gantryZ];
    frameArgs.bellSurf = lerpS[STATE.bellY] - TUNE.bellClear;       // dzwon trzyma się `bellClear` nad ładunkiem
    frameArgs.bellOn = bellShade;
    obraz.frame(frameArgs);
  }
  if (pyl) {
    const sd = yard.uniforms.uSunDirW.value;
    if (state.mode === 'cine') _sv.copy(sd).transformDirection(cine.persp.matrixWorldInverse);
    else {
      // kadr z góry obrócony: kierunek sceny (y w górę) → osie gry (y w dół) → ekran → z powrotem y w górę
      rollToScreen(sd.x, -sd.y, state.cam.roll, _rw);
      _sv.set(_rw.x, -_rw.y, 0);
    }
    const l = Math.sqrt(_sv.x * _sv.x + _sv.y * _sv.y) || 1;
    pyl.frame(tau, _sv.x / l, _sv.y / l);
  }

  // statek: proxy ruchu (prawdziwy sprite), jedzie po z z przesunięciem ze stanu symulacji
  const ship = curS[STATE.ship] | 0;
  const off = lerpS[STATE.shipOff];
  ShipProxyBatch3D.begin(cam);
  if (warmShip > 0) {
    ShipProxyBatch3D.push('rudowiec', 'heavy_freighter', P0.x + geo.ship.x, P0.y + geo.ship.z + off, geo.ship.heading, { opacity: 1, vx: 0, vy: -300, throttle: 0.6 });
  } else if (cur.has && ship !== 0) {
    const v = simDt > 0 ? (off - lastOff) / simDt : 0;
    const moving = ship === 1 || ship === 3;
    ShipProxyBatch3D.push('rudowiec', 'heavy_freighter', P0.x + geo.ship.x, P0.y + geo.ship.z + off, geo.ship.heading,
      moving ? { opacity: 1, vx: 0, vy: clamp(v, -600, 600), throttle: ship === 1 ? 0.14 : 0.06 } : null);
  }
  lastOff = off;
  ShipProxyBatch3D.end();

  const zoom = state.mode === 'cine' ? 1 : cam.zoom;
  cullInfo.x = cam.x;
  cullInfo.y = cam.y;
  rolledHalfExtents(W * 0.5 / zoom, H * 0.5 / zoom, state.mode === 'cine' ? 0 : state.cam.roll, _rh);
  cullInfo.drawHalfW = _rh.hw + 600;
  cullInfo.drawHalfH = _rh.hh + 600;
  cullInfo.halfW = cullInfo.drawHalfW * 3;
  cullInfo.halfH = cullInfo.drawHalfH * 3;
  SimClock.advance(realDt);
  Fx3D.update(simDt);
  updateHexShips3D(cam, ShipProxyBatch3D.engineEntities, cullInfo);
  drawHexShips3D(ctx2d, W, H);
  const r = Core3D.lastFrameRenderInfo?.total || Core3D.renderer?.info?.render || null;
  lastInfo.calls = r ? r.calls || 0 : 0;
  lastInfo.triangles = r ? r.triangles || 0 : 0;
}

let lastMs = performance.now();
let hudAt = 0;
function loop(now) {
  const realDt = Math.min(0.1, Math.max(0, (now - lastMs) / 1000));
  lastMs = now;
  state.fps = state.fps * 0.95 + (realDt > 0 ? 1 / realDt : 60) * 0.05;
  try { render(realDt); } catch (err) { reportError(err.stack || String(err)); return; }
  if (now - hudAt > 150) { hudAt = now; updateHud(); }
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Pipeline'y: licznik tworzonych synchronicznie (rysunek bez rozgrzewki) — ma być 0 po starcie
const pipes = { list: [], atReady: 0 };
function hookPipelines() {
  const pu = Core3D.renderer?.backend?.pipelineUtils;
  if (!pu || pu.__rudaHook) return;
  pu.__rudaHook = true;
  const orig = pu.createRenderPipeline;
  pu.createRenderPipeline = function (ro, promises) {
    if (pipes.list.length < 2048) pipes.list.push({ sync: !promises, name: `${ro?.material?.name || ro?.material?.type || '?'} @ ${ro?.object?.name || ro?.object?.type || '?'}` });
    return orig.call(this, ro, promises);
  };
}

// ---------------------------------------------------------------------------
// API zrzutów (scripts/webgpu/huta-ruda-demo.mjs)
const nextTask = () => new Promise((ok) => setTimeout(ok, 0));
window.__ruda = {
  ready: false,
  get errors() { return errors.slice(); },
  view(i) { applyView(i); return VIEWS.find((q) => q.key === state.view)?.name; },
  /** Kamera z góry: środek (x, z) stanowiska i zoom [px / j.]; `roll` — obrót kadru (domyślnie jak widok 1). */
  camera(x, z, zoom, roll = TOP_ROLL) { state.mode = 'top'; state.cam.x = P0.x + x; state.cam.y = P0.y + z; state.cam.zoom = zoom; state.cam.roll = roll; },
  /** Kamera z ukosa wokół punktu stanowiska (x, y, z); `follow` — za dzwonem. */
  cine(az, el, dist, x, y, z, follow = false) {
    state.mode = 'cine';
    if (Number.isFinite(az)) cine.az = az;
    if (Number.isFinite(el)) cine.el = el;
    if (Number.isFinite(dist)) cine.dist = dist;
    cine.follow = !!follow;
    if (Number.isFinite(x)) cine.at = [x, y, z];
    if (follow) { cine.followY = Number.isFinite(y) ? y : 150; followPoint(curS); cine.at = [_fp[0], cine.followY, _fp[1]]; }
  },
  /** Nowa ruda (0…4): obietnica po rozbiegu stanowiska i pierwszej migawce. */
  ore(i) { return startOre(i); },
  speed(k) { setSpeed(k); },
  /**
   * `seconds` symulacji bez czekania na zegar ściany (tryb zrzutów); migawki z ostatnich `tail` kroków trafiają do
   * obrazu (pył). Obietnica: { steps, ms, stepMs, stepMax }.
   */
  simulate(seconds, tail = 120) {
    if (live) { live = false; post({ type: 'live', on: false }); }
    const id = ++advanceId;
    return new Promise((ok) => { pendingAdvance.set(id, ok); post({ type: 'advance', id, seconds, tail }); });
  },
  /** Powrót do kroków w czasie rzeczywistym (po `simulate`). */
  resume() { live = true; post({ type: 'live', on: true }); },
  /** `n` klatek obrazu bez kroku symulacji (każda w osobnym zadaniu JS). */
  async renderFrames(n = 1, dt = 1 / 60) {
    for (let i = 0; i < n; i++) {
      render(dt);
      if (i + 1 < n) await nextTask();
    }
    updateHud();
    return { ...lastInfo };
  },
  snapshot(type = 'image/jpeg', quality = 0.9) { render(0); return canvas2d.toDataURL(type, quality); },
  stats() {
    const c = counters;
    const t = (i) => c[i] / GRAIN.perTon;
    const sync = pipes.list.filter((p) => p.sync);
    return {
      ...lastInfo,
      ore: ORES[state.ore].id, view: state.view, mode: state.mode, speed: state.speed, live, worker: useWorker,
      time: cur.has ? curS[STATE.time] : 0, ship: SHIP_STATES[curS[STATE.ship] | 0], shipOff: curS[STATE.shipOff], trips: curS[STATE.trips],
      unloadTime: curS[STATE.unloadTime], gantryZ: curS[STATE.gantryZ], trolleyX: curS[STATE.trolleyX], bellY: curS[STATE.bellY],
      tons: { hold: t(COUNTER.hold) + t(COUNTER.suction), pipe: t(COUNTER.pipe), air: t(COUNTER.air), bunker: t(COUNTER.bunker), live: t(COUNTER.live), belt: t(COUNTER.belt), furnace: t(COUNTER.furnace) + t(COUNTER.taken) },
      grains: { hold: c[COUNTER.hold], suction: c[COUNTER.suction], pipe: c[COUNTER.pipe], air: c[COUNTER.air], bunker: c[COUNTER.bunker], belt: c[COUNTER.belt], furnace: c[COUNTER.furnace], taken: c[COUNTER.taken], loaded: c[COUNTER.loaded] },
      balance: c[COUNTER.loaded] - (c[COUNTER.hold] + c[COUNTER.suction] + c[COUNTER.pipe] + c[COUNTER.air] + c[COUNTER.bunker] + c[COUNTER.belt] + c[COUNTER.furnace] + c[COUNTER.taken]),
      sim: { ...sim, queue: queue.length },
      image: obraz ? { ...obraz.counts, lodFar: obraz.lodFar, columnsBunker: obraz.bunker.N, columnsHold: obraz.hold.N } : null,
      dust: pyl ? pyl.spawned : 0,
      // `sync` — utworzone synchronicznie od startu strony (pod ekranem startu: materiały gry tworzone przy pierwszym
      // użyciu statku), `syncAfterReady` — po starcie pętli: ma być 0
      pipelines: {
        total: pipes.list.length, sync: sync.length, syncList: sync.slice(0, 12).map((p) => p.name),
        syncAfterReady: pipes.list.slice(pipes.atReady).filter((p) => p.sync).length,
        syncAfterReadyList: pipes.list.slice(pipes.atReady).filter((p) => p.sync).slice(0, 12).map((p) => p.name)
      },
      gpuMs: Core3D.gpuFrameMs || 0,
      waiting: ShipProxyBatch3D.stats.waitingImage,
      errors: errors.slice()
    };
  },
  /** Zegar obrazu: czas klatki między początkiem a końcem kroku symulacji, postęp, kolejka migawek. */
  clock() { return { tau, alpha, t0: cur.t0, t1: cur.t1, dt: cur.dt, queue: queue.length }; },
  get state() { return state; },
  get cineState() { return cine; },
  get obraz() { return obraz; }
};

// ---------------------------------------------------------------------------
// Start
try {
  if (!(await Core3D.ready)) throw new Error(`WebGPU: ${Core3D.gpuError || 'brak urządzenia — demo wymaga przeglądarki z WebGPU'}`);
  hookPipelines();
  // symulacja startuje równolegle z budową sceny (rozbieg stanowiska ~1 s w workerze)
  const firstOre = startOre(state.ore);
  yard = mk(buildOreYardScene(geo, style), 'Zasiek i nabrzeże');
  mk(buildOrePierScene(geo), 'Pirs rudy');
  vac = mk(buildOreVacScene(geo), 'Odkurzacz');
  for (const b of B.list) b.setLayers(LAYER_BG, LAYER_FG);
  for (const b of B.list) b.setSun(SUN_OPTS);
  await new Promise((ok) => { const w = () => (layout ? ok() : setTimeout(w, 8)); w(); });
  const root = new THREE.Group();
  root.name = 'Ruda';
  root.matrixAutoUpdate = false;
  root.matrix.fromArray(portHubMatrixElements(FRAME));
  host.add(root);
  host.updateMatrixWorld(true);
  obraz = new RudaObraz({ root, geo, tune: TUNE, sunDir: yard.uniforms.uSunDirW.value, layout });
  obraz.setSun(...sunStation());
  pyl = new RudaPyl({ bgGroup: obraz.bgGroup, fgGroup: obraz.fgGroup });
  obraz.setLayers(LAYER_BG, LAYER_FG);
  pyl.setLayers(LAYER_BG, LAYER_FG);
  obraz.setOre(ORES[state.ore]);
  pyl.setOre(ORES[state.ore]);
  // rozgrzewka: budowle, ziarna (oba warianty szczegółowości), podkład, taśma, pył — pierwsza klatka bez kompilacji
  const buildingMeshes = [];
  for (const b of B.list) for (const set of Object.values(b.meshes)) buildingMeshes.push(...set);
  await Core3D.warmup.now(buildingMeshes, { name: 'ruda: budowle' });
  await Core3D.warmup.now([...obraz.warmupMeshes(), ...pyl.warmupMeshes()], { name: 'ruda: ziarna', variant: WARIANT_INSTANCJI });
  await firstOre;
  setSpeed(state.speed);
  applyView(clamp(Number(params.get('view')) || 1, 1, VIEWS.length));
  syncUi();
  // proxy statku: obraz kadłuba wczytuje się w tle — klatki rozgrzewki (statek z ciągiem), aż nic nie czeka
  warmShip = 1;
  for (let k = 0; k < 160; k++) {
    render(0);
    if (ShipProxyBatch3D.stats.waitingImage === 0 && k > 3) break;
    await new Promise((ok) => setTimeout(ok, 50));
  }
  warmShip = 0;
  render(0);
  pipes.atReady = pipes.list.length;
  window.__ruda.ready = true;
  if (!shotMode) {
    lastMs = performance.now();
    requestAnimationFrame(loop);
  }
} catch (err) {
  reportError(err.stack || String(err));
}
