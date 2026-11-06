// Demo: ciągniki kosmiczne (małe ciężarówki z 1–5 naczepami na przegubach). Dane: src/data/spaceTrucks.js, kinematyka:
// src/game/spaceTruckTrain.js, obraz: src/3d/spaceTrucks3D.js, opis i decyzje: docs/PROPOZYCJA-ciagniki.md.
//
// Serwowanie: `npm run dev`, potem /dema/ciagniki.html (?view=1…5, ?zoom=…, ?skala=kontener, ?shot=1 — bez panelu i rAF,
// klatki z `__ciagniki.frames(n)`; ?goly=1 — ten sam moduł na gołym WebGPURenderer, bez Core3D i bloomu).
// Domyślnie prawdziwy potok gry: Core3D (bloom, ACES), porównanie skali na proxy ruchu (ShipProxyBatch3D, prawdziwe sprite'y).
import * as THREE from 'three/webgpu';
import { SpaceTrucks3D } from '../src/3d/spaceTrucks3D.js';
import { createTruckTrain, placeTruckTrain, stepTruckTrain, truckTrainHitch } from '../src/game/spaceTruckTrain.js';
import {
  TRUCK_CARGO_IDS, TRUCK_LIVERIES, TRUCK_MODULE, TRUCK_SCALES, TRUCK_TRACTORS, TRUCK_TRAILER, truckMinTurnRadius, truckRigLength,
  truckRigTonnes, truckRigWidth
} from '../src/data/spaceTrucks.js';

const params = new URLSearchParams(location.search);
const shotMode = params.get('shot') === '1';
const bareMode = params.get('goly') === '1';
if (shotMode) document.body.classList.add('shot');
const $ = (id) => document.getElementById(id);

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
// Potok: Core3D jak w grze albo goły renderer (dowód, że moduł obrazu nie wymaga Core3D).
const canvas2d = $('c');
const ctx2d = canvas2d.getContext('2d');
const glCanvas = $('webgl-layer');
let W = canvas2d.width = innerWidth;
let H = canvas2d.height = innerHeight;
glCanvas.width = W;
glCanvas.height = H;

// Daleko od zera: precyzja float32 jak w grze (obrzeża układu to 5–10 mln j.).
const P0 = Object.freeze({ x: 8_640_000, y: -3_910_000 });
window.SUN = { x: P0.x - 2_400_000, y: P0.y - 1_700_000, r: 2600 };

let pipe = null;

async function initCorePipe() {
  const [{ Core3D }, hex, { Fx3D }, { ShipProxyBatch3D }, { SimClock }, { WARIANT_INSTANCJI }] = await Promise.all([
    import('../src/3d/core3d.js'), import('../src/3d/hexShips3D.js'), import('../src/3d/fxParticles3D.js'),
    import('../src/3d/shipProxyBatch3D.js'), import('../src/game/simClock.js'), import('../src/3d/rozgrzewka.js')
  ]);
  hex.initHexShips3D({ canvas: glCanvas });
  if (!(await Core3D.ready)) throw new Error(`WebGPU: ${Core3D.gpuError || 'brak urządzenia'}`);
  addStars(Core3D.scene, 1, 8);
  const cullInfo = { x: 0, y: 0, drawHalfW: 0, drawHalfH: 0, halfW: 0, halfH: 0 };
  const trucks = new SpaceTrucks3D({ scene: Core3D.scene, rigs: 64 });
  await trucks.ready;
  await Core3D.warmup.now(trucks.warmupMeshes(), { name: 'ciągniki', variant: WARIANT_INSTANCJI });
  addEventListener('resize', () => hex.resizeHexShips3D(W, H));
  return {
    trucks,
    proxies: ShipProxyBatch3D,
    ppu: (cam) => Core3D.viewZoom(cam),
    frame(cam, dt, list) {
      SimClock.advance(dt);
      ShipProxyBatch3D.begin(cam);
      for (const p of list) ShipProxyBatch3D.push(p.id, p.hull, p.x, p.y, p.angle);
      ShipProxyBatch3D.end();
      cullInfo.x = cam.x;
      cullInfo.y = cam.y;
      cullInfo.drawHalfW = W * 0.5 / cam.zoom + 600;
      cullInfo.drawHalfH = H * 0.5 / cam.zoom + 600;
      cullInfo.halfW = cullInfo.drawHalfW * 3;
      cullInfo.halfH = cullInfo.drawHalfH * 3;
      Fx3D.update(dt);
      hex.updateHexShips3D(cam, ShipProxyBatch3D.engineEntities, cullInfo);
      hex.drawHexShips3D(ctx2d, W, H);
    },
    waitingImages: () => ShipProxyBatch3D.stats.waitingImage,
    syncPipelines: () => Core3D.warmup?.stats?.ciezkie?.length || 0,
    info: () => { const r = Core3D.lastFrameRenderInfo?.total || Core3D.renderer?.info?.render || {}; return { calls: r.calls || 0, triangles: r.triangles || 0 }; }
  };
}

async function initBarePipe() {
  const renderer = new THREE.WebGPURenderer({ canvas: glCanvas, antialias: true, alpha: false });
  await renderer.init();
  renderer.highPrecision = true;
  renderer.setSize(W, H, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030406);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
  addStars(scene, 0, 1);
  const trucks = new SpaceTrucks3D({ scene, rigs: 64 });
  await trucks.ready;
  for (const m of trucks.warmupMeshes()) {
    const g = m.geometry;
    const c = g.instanceCount;
    const v = m.visible;
    g.instanceCount = 2;
    m.visible = true;
    await renderer.compileAsync(m, camera, scene);
    g.instanceCount = c;
    m.visible = v;
  }
  addEventListener('resize', () => renderer.setSize(W, H, false));
  return {
    trucks,
    proxies: null,
    ppu: (cam) => cam.zoom,
    frame(cam) {
      camera.left = -W * 0.5 / cam.zoom;
      camera.right = W * 0.5 / cam.zoom;
      camera.top = H * 0.5 / cam.zoom;
      camera.bottom = -H * 0.5 / cam.zoom;
      camera.position.set(cam.x, -cam.y, 2000);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      renderer.render(scene, camera);
      ctx2d.clearRect(0, 0, W, H);
    },
    waitingImages: () => 0,
    syncPipelines: () => 0,
    info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles })
  };
}

function addStars(scene, layer, far) {
  const n = 2600;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let seed = 9091;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const zz = far > 1 ? -90000 : -1500;
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (rnd() - 0.5) * (far > 1 ? 800000 : 60000);
    pos[i * 3 + 1] = (rnd() - 0.5) * (far > 1 ? 500000 : 36000);
    pos[i * 3 + 2] = zz - rnd() * 400;
    const b = Math.pow(rnd(), 6) * 1.3 + 0.06;
    const t = rnd();
    col[i * 3] = b * (0.9 + 0.1 * t);
    col[i * 3 + 1] = b * 0.9;
    col[i * 3 + 2] = b * (1.05 - 0.15 * t);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false }));
  pts.frustumCulled = false;
  pts.position.set(P0.x, -P0.y, 0);
  pts.layers.set(layer);
  scene.add(pts);
}

// ---------------------------------------------------------------------------
// Tory: krzywa zamknięta z tablicy próbek co ~2 j. po długości łuku (lokalnie względem P0).

class Track {
  constructor(fn, cx = 0, cy = 0) {
    const N = 8192;
    const X = new Float64Array(N + 1);
    const Y = new Float64Array(N + 1);
    let len = 0;
    const L = new Float64Array(N + 1);
    for (let i = 0; i <= N; i++) {
      const t = i / N * Math.PI * 2;
      const p = fn(t);
      X[i] = p[0];
      Y[i] = p[1];
      if (i) len += Math.hypot(X[i] - X[i - 1], Y[i] - Y[i - 1]);
      L[i] = len;
    }
    this.length = len;
    const M = Math.ceil(len / 2);
    this.n = M;
    this.x = new Float64Array(M + 1);
    this.y = new Float64Array(M + 1);
    this.a = new Float64Array(M + 1);
    this.k = new Float64Array(M + 1);
    let j = 0;
    for (let i = 0; i <= M; i++) {
      const s = i / M * len;
      while (j < N && L[j + 1] < s) j++;
      const t = (s - L[j]) / Math.max(1e-6, L[j + 1] - L[j]);
      this.x[i] = X[j] + (X[j + 1] - X[j]) * t + cx;
      this.y[i] = Y[j] + (Y[j + 1] - Y[j]) * t + cy;
    }
    for (let i = 0; i <= M; i++) {
      const a = (i + 1) % M;
      const b = (i - 1 + M) % M;
      this.a[i] = Math.atan2(this.y[a] - this.y[b], this.x[a] - this.x[b]);
    }
    let minR = Infinity;
    for (let i = 0; i <= M; i++) {
      const a = (i + 1) % M;
      const b = (i - 1 + M) % M;
      let d = this.a[a] - this.a[b];
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const kappa = Math.abs(d) / (2 * len / M);
      this.k[i] = kappa;
      if (kappa > 1e-6) minR = Math.min(minR, 1 / kappa);
    }
    this.minR = minR;
  }
  at(s, lane, out) {
    const u = ((s / this.length) % 1 + 1) % 1 * this.n;
    const i = Math.floor(u) % this.n;
    const f = u - Math.floor(u);
    let da = this.a[i + 1] - this.a[i];
    da = Math.atan2(Math.sin(da), Math.cos(da));
    const a = this.a[i] + da * f;
    const x = this.x[i] + (this.x[i + 1] - this.x[i]) * f;
    const y = this.y[i] + (this.y[i + 1] - this.y[i]) * f;
    out.x = x - Math.sin(a) * lane;
    out.y = y + Math.cos(a) * lane;
    out.a = a;
    return out;
  }
  curvature(s) {
    const u = ((s / this.length) % 1 + 1) % 1 * this.n;
    return this.k[Math.floor(u) % this.n];
  }
}

const ROW_TRACK = new Track((t) => [1900 * Math.cos(t) + 300 * Math.cos(3 * t), 1000 * Math.sin(t) + 340 * Math.cos(2 * t)]);
const TIGHT_TRACK = new Track((t) => [480 * Math.cos(t) + 50 * Math.cos(3 * t), 300 * Math.sin(t) + 100 * Math.cos(2 * t)]);
const SCALE_TRACK = new Track((t) => [1300 * Math.cos(t) - 100, 600 * Math.sin(t)]);
const FAR_TRACK = new Track((t) => [6200 * Math.cos(t) + 900 * Math.cos(3 * t), 3000 * Math.sin(t) + 700 * Math.cos(2 * t)]);

// ---------------------------------------------------------------------------
// Stan

const state = {
  view: 1,
  speed: 1,
  paused: false,
  scaleKey: params.get('skala') === 'kontener' ? 'container' : 'module',
  cam: { x: P0.x, y: P0.y, zoom: 1.4 },
  follow: true,
  overlay: false,
  lights: true,
  time: 0,
  accum: 0
};
const PHYS_DT = 1 / 60;
const entries = []; // { train, rig, track, s, lane, speed, cruise, row }
const parked = []; // proxy ruchu: { id, hull, x, y, angle, label }
const labels = [];
const CARGO = TRUCK_CARGO_IDS;

const look = (i, cargos, variant = 0) => ({
  livery: i,
  trailers: cargos.map((c, k) => ({ cargo: c, livery: c === 'standard' ? i + k : i, variant: variant + k }))
});

function addRig(tractorId, n, o) {
  const scale = TRUCK_SCALES[state.scaleKey];
  const train = createTruckTrain(tractorId, n, { scale });
  const rig = pipe.trucks.add(train, o.look);
  const e = {
    train, rig, track: o.track || null, s: o.s || 0, lane: (o.lane || 0), speed: o.cruise || 150, cruise: o.cruise || 150,
    row: !!o.row, x: o.x, y: o.y, a: o.a
  };
  const p = {};
  if (e.track) {
    e.track.at(e.s, e.lane, p);
    placeTruckTrain(train, P0.x + p.x, P0.y + p.y, p.a);
    // Rozbieg po torze: naczepy układają się jak w ruchu, bez ustawiania w linii prostej przy starcie.
    const pre = (truckRigLength(tractorId, n) * 2) * scale;
    let back = e.s - pre;
    e.track.at(back, e.lane, p);
    placeTruckTrain(train, P0.x + p.x, P0.y + p.y, p.a);
    for (; back < e.s; back += 4) {
      e.track.at(back, e.lane, p);
      stepTruckTrain(train, P0.x + p.x, P0.y + p.y, p.a, PHYS_DT);
    }
    e.track.at(e.s, e.lane, p);
    stepTruckTrain(train, P0.x + p.x, P0.y + p.y, p.a, PHYS_DT);
  } else {
    placeTruckTrain(train, P0.x + o.x, P0.y + o.y, o.a || 0);
    rig.throttle = o.throttle ?? 0.25;
  }
  entries.push(e);
  return e;
}

function clearScene() {
  pipe.trucks.clear();
  entries.length = 0;
  parked.length = 0;
  labels.length = 0;
}

const VIEWS = [
  {
    key: 1, name: 'Rząd 1–5 naczep', sub: 'pięć zestawów na równoległych pasach, łuki i zgięcia', zoom: 1.9, follow: true, apply() {
      const lanes = [-96, -48, 0, 48, 96].map((q) => q * TRUCK_SCALES[state.scaleKey]);
      const s = ROW_TRACK.length * 0.08;
      const cruise = 170;
      addRig('light', 1, { track: ROW_TRACK, s, lane: lanes[0], cruise, row: true, look: look(1, ['standard']) });
      addRig('light', 2, { track: ROW_TRACK, s, lane: lanes[1], cruise, row: true, look: look(3, ['standard', 'hopper']) });
      addRig('standard', 3, { track: ROW_TRACK, s, lane: lanes[2], cruise, row: true, look: look(0, ['standard', 'tank', 'standard']) });
      addRig('standard', 4, { track: ROW_TRACK, s, lane: lanes[3], cruise, row: true, look: look(4, ['standard', 'standard', 'hazmat', 'tank']) });
      addRig('heavy', 5, { track: ROW_TRACK, s, lane: lanes[4], cruise, row: true, look: look(2, ['standard', 'standard', 'tank', 'hopper', 'hazmat'], 1) });
    }
  },
  {
    key: 2, name: 'Ciasne łuki', sub: 'łuki do R ~75 j., przeguby blisko ogranicznika', zoom: 1.05, follow: false, center: [40, 0], apply() {
      const L = TIGHT_TRACK.length;
      addRig('heavy', 5, { track: TIGHT_TRACK, s: L * 0.1, cruise: 140, look: look(2, ['standard', 'tank', 'standard', 'hopper', 'hazmat']) });
      addRig('standard', 4, { track: TIGHT_TRACK, s: L * 0.42, cruise: 140, look: look(0, ['standard', 'standard', 'standard', 'standard'], 1) });
      addRig('light', 2, { track: TIGHT_TRACK, s: L * 0.72, cruise: 150, look: look(1, ['tank', 'standard']) });
    }
  },
  {
    key: 3, name: 'Skala: prom, kuter, frachtowce', sub: 'prawdziwe sprite\'y ruchu, zestawy krążą wokół', zoom: 0.47, follow: false, center: [-100, 0], apply() {
      for (const [id, hull, x, y, angle, label] of [
        ['fr', 'heavy_freighter', -320, 0, 0, 'Ciężki frachtowiec 1800 j.'],
        ['kont', 'container_ship', 780, -300, 0, 'Kontenerowiec 312 j.'],
        ['kuter', 'police_cutter', 780, 0, 0, 'Kuter policji 180 j.'],
        ['prom', 'inter_station_shuttle', 780, 240, 0, 'Prom 120 j.']
      ]) {
        parked.push({ id, hull, x: P0.x + x, y: P0.y + y, angle });
        labels.push({ x: P0.x + x, y: P0.y + y + (id === 'fr' ? 480 : 110), text: label });
      }
      const L = SCALE_TRACK.length;
      [['light', 1], ['light', 2], ['standard', 3], ['standard', 4], ['heavy', 5]].forEach(([id, n], i) => {
        const trailers = Array.from({ length: n }, (_, k) => CARGO[(i + k) % CARGO.length]);
        addRig(id, n, { track: SCALE_TRACK, s: L * (0.1 + i * 0.18), cruise: 130, look: look(i * 2, trailers) });
      });
    }
  },
  {
    key: 4, name: 'Konwoje z daleka', sub: 'zoom 0,1: czy widać sylwetkę, światła i linię', zoom: 0.1, follow: false, center: [800, 0], apply() {
      const L = FAR_TRACK.length;
      const kinds = [['light', 1], ['standard', 3], ['heavy', 5], ['light', 2], ['standard', 4], ['heavy', 4]];
      for (let i = 0; i < 26; i++) {
        const [id, n] = kinds[i % kinds.length];
        const trailers = Array.from({ length: n }, (_, k) => CARGO[(i + k) % CARGO.length]);
        addRig(id, n, { track: FAR_TRACK, s: L * (i / 26 + (i % 3) * 0.004), lane: ((i % 4) - 1.5) * 90, cruise: 170 + (i % 5) * 18, look: look(i, trailers, i) });
      }
    }
  },
  {
    key: 5, name: 'Galeria', sub: 'ciągniki i naczepy każdej rodziny, stoją', zoom: 3.2, follow: false, center: [0, 0], gallery: true, apply() {
      const sc = TRUCK_SCALES[state.scaleKey];
      const row = (y, list) => {
        let x = list.startX;
        for (const it of list) {
          addRig(it.t, it.n, { x: x * sc, y: y * sc, a: 0, look: it.look, throttle: 0.45 });
          labels.push({ x: P0.x + (x - it.lx) * sc, y: P0.y + (y + 22) * sc, text: it.label });
          x += it.dx;
        }
      };
      const r1 = [
        { t: 'light', n: 0, look: look(1, []), label: 'Lekki', dx: 90, lx: 0 },
        { t: 'standard', n: 0, look: look(0, []), label: 'Szosowy', dx: 105, lx: 0 },
        { t: 'heavy', n: 0, look: look(2, []), label: 'Ciężki', dx: 0, lx: 0 }
      ];
      r1.startX = -105;
      row(-52, r1);
      const r2 = [
        { t: 'light', n: 1, look: look(3, ['standard']), label: 'Standard', dx: 100, lx: 22 },
        { t: 'light', n: 1, look: look(4, ['hazmat']), label: 'Hazmat', dx: 100, lx: 22 },
        { t: 'light', n: 1, look: look(5, ['tank']), label: 'Zbiornik', dx: 0, lx: 22 }
      ];
      r2.startX = -102;
      row(12, r2);
      const r3 = [
        { t: 'light', n: 1, look: look(2, ['hopper']), label: 'Zsyp (ruda)', dx: 100, lx: 22 },
        { t: 'light', n: 1, look: { livery: 6, trailers: [{ cargo: 'hopper', livery: 5, load: 'ice' }] }, label: 'Zsyp (lód)', dx: 100, lx: 22 },
        { t: 'light', n: 1, look: { livery: 0, trailers: [{ cargo: null }] }, label: 'Pusta rama', dx: 0, lx: 22 }
      ];
      r3.startX = -102;
      row(72, r3);
    }
  }
];

function applyView(i) {
  const v = VIEWS[Math.max(0, Math.min(VIEWS.length - 1, i - 1))];
  state.view = v.key;
  clearScene();
  v.apply();
  state.cam.zoom = Number(params.get('zoom')) && !state._zoomUsed ? Number(params.get('zoom')) : v.zoom;
  state._zoomUsed = true;
  state.follow = !!v.follow;
  if (!state.follow) {
    // Panel z prawej: środek kadru lekko w prawo od środka sceny.
    state.cam.x = P0.x + (v.center?.[0] || 0) + 136 / state.cam.zoom;
    state.cam.y = P0.y + (v.center?.[1] || 0);
  } else {
    followCamera(1);
  }
  for (const b of viewButtons) b.classList.toggle('on', Number(b.dataset.view) === v.key);
  $('gallery').classList.toggle('on', v.key === 5);
  syncUi();
  writeInfo();
}

// ---------------------------------------------------------------------------
// Krok fizyki: czoło po torze, naczepy z kinematyki

const _p = {};
function physicsStep(dt) {
  state.time += dt;
  for (const e of entries) {
    if (!e.track) {
      stepTruckTrain(e.train, e.train.x[0], e.train.y[0], e.train.a[0], dt);
      continue;
    }
    // Tempo: rząd — stałe (równo na pasach), reszta — hamowanie przed łukiem (stop i ciąg widać na światłach).
    let target = e.cruise * TRUCK_SCALES[state.scaleKey];
    if (!e.row) {
      const lookAhead = Math.max(e.track.curvature(e.s + 40), e.track.curvature(e.s + 90), e.track.curvature(e.s));
      if (lookAhead > 1e-5) target = Math.min(target, Math.sqrt(170 / lookAhead) * Math.sqrt(TRUCK_SCALES[state.scaleKey]));
    }
    const dv = target - e.speed;
    const rate = dv > 0 ? 45 : 70;
    const step = Math.max(-rate * dt, Math.min(rate * dt, dv));
    e.speed += step;
    e.s += e.speed * dt;
    e.track.at(e.s, e.lane, _p);
    stepTruckTrain(e.train, P0.x + _p.x, P0.y + _p.y, _p.a, dt);
    e.rig.brake = dv < -6;
    const want = dv > 3 ? 1 : (dv < -3 ? 0.12 : 0.55);
    e.rig.throttle += (want - e.rig.throttle) * Math.min(1, dt * 3);
  }
}

function followCamera(k) {
  if (!entries.length) return;
  let x = 0;
  let y = 0;
  let w = 0;
  for (const e of entries) {
    if (!e.train) continue;
    const mid = e.train.count >> 1;
    x += e.train.x[mid];
    y += e.train.y[mid];
    w++;
  }
  if (!w) return;
  // Środek rzędu; panel z prawej przesuwa środek kadru.
  const tx = x / w + 136 / state.cam.zoom;
  const ty = y / w;
  state.cam.x += (tx - state.cam.x) * k;
  state.cam.y += (ty - state.cam.y) * k;
}

// ---------------------------------------------------------------------------
// UI

const viewButtons = VIEWS.filter((v) => !v.gallery).map((v) => {
  const b = document.createElement('button');
  b.dataset.view = String(v.key);
  b.innerHTML = `${v.key} · ${v.name}<small>${v.sub}</small>`;
  b.addEventListener('click', () => applyView(v.key));
  $('views').appendChild(b);
  return b;
});
$('gallery').addEventListener('click', () => applyView(5));

const ZOOMS = [0.035, 0.1, 0.3, 1, 3.2];
const zoomButtons = ZOOMS.map((z) => {
  const b = document.createElement('button');
  b.textContent = String(z).replace('.', ',');
  b.addEventListener('click', () => setZoom(z));
  $('zooms').appendChild(b);
  return b;
});
function setZoom(z) {
  // Zoom kolejno wokół punktu pod środkiem kadru — w widokach z kamerą śledzącą zawsze na środku rzędu.
  const cx = state.cam.x - 136 / state.cam.zoom;
  state.cam.zoom = Math.max(0.035, Math.min(3.2, z));
  state.cam.x = cx + 136 / state.cam.zoom;
  syncUi();
}
const scaleButtons = [
  ['module', 'Moduł 2 × 2 (32 × 16 j.)'],
  ['container', 'Kontener 1 × 1 (16 × 8 j.)']
].map(([key, label]) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', () => { state.scaleKey = key; applyView(state.view); });
  $('scales').appendChild(b);
  return b;
});
const SPEEDS = [['pauza', 0], ['1×', 1], ['2×', 2], ['5×', 5]];
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
const toggles = [
  ['Światła', () => { state.lights = !state.lights; for (const e of entries) e.rig.lights = state.lights; }, () => state.lights],
  ['Nakładki (D)', () => { state.overlay = !state.overlay; }, () => state.overlay]
].map(([label, run, on]) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', () => { run(); syncUi(); });
  $('toggles').appendChild(b);
  return { b, on };
});
function syncUi() {
  zoomButtons.forEach((b, i) => b.classList.toggle('on', Math.abs(ZOOMS[i] - state.cam.zoom) < ZOOMS[i] * 0.04));
  scaleButtons[0].classList.toggle('on', state.scaleKey === 'module');
  scaleButtons[1].classList.toggle('on', state.scaleKey === 'container');
  toggles.forEach(({ b, on }) => b.classList.toggle('on', !!on()));
}

function writeInfo() {
  const sc = TRUCK_SCALES[state.scaleKey];
  const fmt = (v) => Math.round(v * sc);
  const lines = [
    `naczepa: ${state.scaleKey === 'module' ? `moduł ${TRUCK_MODULE.containers} kont. ${TRUCK_MODULE.L} × ${TRUCK_MODULE.W} j.` : 'kontener 16 × 8 j.'}`,
    `zestaw   dł. [j.] @0,1 [px]  t`
  ];
  for (const [id, n] of [['light', 1], ['light', 2], ['standard', 3], ['standard', 4], ['heavy', 5]]) {
    const L = truckRigLength(id, n);
    lines.push(`${TRUCK_TRACTORS[id].label.padEnd(8)}${n} ${String(fmt(L)).padStart(5)} ${String(Math.round(L * sc * 0.1)).padStart(5)} ${String(truckRigTonnes(n)).padStart(5)}`);
  }
  lines.push(`szer. ${fmt(truckRigWidth('light'))}–${fmt(truckRigWidth('heavy'))} j., najciaśniej R ${fmt(truckMinTurnRadius('heavy', 5))} j.`);
  $('info').textContent = lines.join('\n');
}

let dragging = false;
let lastX = 0;
let lastY = 0;
canvas2d.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas2d.setPointerCapture(e.pointerId); });
canvas2d.addEventListener('pointerup', () => { dragging = false; });
canvas2d.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  state.follow = false;
  state.cam.x -= (e.clientX - lastX) / state.cam.zoom;
  state.cam.y -= (e.clientY - lastY) / state.cam.zoom;
  lastX = e.clientX;
  lastY = e.clientY;
});
canvas2d.addEventListener('wheel', (e) => {
  e.preventDefault();
  const k = Math.exp(-e.deltaY * 0.0012);
  const z0 = state.cam.zoom;
  const z1 = Math.max(0.035, Math.min(3.2, z0 * k));
  const mx = e.clientX - W / 2;
  const my = e.clientY - H / 2;
  state.cam.x += mx / z0 - mx / z1;
  state.cam.y += my / z0 - my / z1;
  state.cam.zoom = z1;
  syncUi();
}, { passive: false });
addEventListener('keydown', (e) => {
  if (/^Digit[1-5]$/.test(e.code)) applyView(Number(e.code.slice(5)));
  else if (e.code === 'KeyG') applyView(5);
  else if (e.code === 'KeyD') { state.overlay = !state.overlay; syncUi(); }
  else if (e.code === 'Space') { setSpeed(state.speed ? 0 : 1); e.preventDefault(); }
});
addEventListener('resize', () => {
  W = canvas2d.width = innerWidth;
  H = canvas2d.height = innerHeight;
});

// ---------------------------------------------------------------------------
// Klatka

const toScreen = (x, y) => [W / 2 + (x - state.cam.x) * state.cam.zoom, H / 2 + (y - state.cam.y) * state.cam.zoom];

function drawOverlays() {
  ctx2d.save();
  ctx2d.textAlign = 'center';
  ctx2d.font = '12px "Segoe UI", system-ui, sans-serif';
  // Podpisy galerii i skali (nie debug).
  if (labels.length) {
    ctx2d.fillStyle = 'rgba(223,230,234,.75)';
    for (const l of labels) {
      const [sx, sy] = toScreen(l.x, l.y);
      ctx2d.fillText(l.text, sx, sy);
    }
  }
  if (state.overlay) {
    const h = {};
    const seen = new Set();
    for (const e of entries) {
      if (e.track && !seen.has(e.track)) {
        seen.add(e.track);
        ctx2d.strokeStyle = 'rgba(120,200,255,.25)';
        ctx2d.lineWidth = 1;
        ctx2d.beginPath();
        for (let i = 0; i <= e.track.n; i += 8) {
          const [sx, sy] = toScreen(P0.x + e.track.x[i], P0.y + e.track.y[i]);
          if (i) ctx2d.lineTo(sx, sy); else ctx2d.moveTo(sx, sy);
        }
        ctx2d.stroke();
      }
      const t = e.train;
      for (let i = 1; i < t.count; i++) {
        truckTrainHitch(t, i, h);
        const [sx, sy] = toScreen(h.x, h.y);
        const bend = Math.abs(t.bend[i]) / t.maxBend;
        ctx2d.strokeStyle = bend > 0.97 ? '#ff5040' : '#60e0ff';
        ctx2d.beginPath();
        ctx2d.arc(sx, sy, 5, 0, Math.PI * 2);
        ctx2d.stroke();
      }
    }
  }
  ctx2d.restore();
}

// Boje pasa w widoku rzędu: stała rama odniesienia (kamera jedzie z zestawami, gwiazdy stoją daleko).
function drawBuoys() {
  if (state.view !== 1 && state.view !== 2) return;
  const tr = state.view === 1 ? ROW_TRACK : TIGHT_TRACK;
  const off = state.view === 1 ? [-130, 130] : [-52, 52];
  const step = 18;
  ctx2d.save();
  ctx2d.fillStyle = 'rgba(160,190,210,.20)';
  const sc = TRUCK_SCALES[state.scaleKey];
  const q = {};
  const r = Math.max(0.8, Math.min(1.8, state.cam.zoom * 1.2));
  for (let i = 0; i < tr.n; i += step) {
    tr.at(i * 2, 0, q);
    for (const lane of off) {
      const x = P0.x + q.x - Math.sin(q.a) * lane * sc;
      const y = P0.y + q.y + Math.cos(q.a) * lane * sc;
      const [sx, sy] = toScreen(x, y);
      if (sx < -4 || sy < -4 || sx > W + 4 || sy > H + 4) continue;
      ctx2d.beginPath();
      ctx2d.arc(sx, sy, r, 0, Math.PI * 2);
      ctx2d.fill();
    }
  }
  ctx2d.restore();
}

function render(frameDt) {
  const cam = state.cam;
  const alpha = state.accum / PHYS_DT;
  pipe.trucks.update({
    x: cam.x, y: cam.y, ppu: pipe.ppu(cam), viewW: W, viewH: H, time: state.time + state.accum, alpha: Math.min(1, alpha), sun: window.SUN
  });
  pipe.frame(cam, frameDt, parked);
  drawBuoys();
  drawOverlays();
}

function advance(dt) {
  if (state.paused) return;
  state.accum += dt * state.speed;
  let guard = 0;
  while (state.accum >= PHYS_DT && guard++ < 16) {
    physicsStep(PHYS_DT);
    state.accum -= PHYS_DT;
  }
}

let lastMs = performance.now();
function loop(now) {
  const dt = Math.min(0.1, Math.max(0, (now - lastMs) / 1000));
  lastMs = now;
  try {
    advance(dt);
    if (state.follow) followCamera(Math.min(1, dt * 3));
    render(dt);
  } catch (err) {
    reportError(err.stack || String(err));
    return;
  }
  if (!shotMode) requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// API zrzutów (scripts/webgpu/ciagniki-demo.mjs)
window.__ciagniki = {
  ready: false,
  get errors() { return errors.slice(); },
  view(i) { applyView(i); },
  zoom(z) { setZoom(z); },
  camera(x, y, z) { state.follow = false; state.cam.x = P0.x + x; state.cam.y = P0.y + y; state.cam.zoom = z; },
  scale(key) { state.scaleKey = key; applyView(state.view); },
  overlay(on) { state.overlay = !!on; },
  frames(n = 1, dt = PHYS_DT) {
    for (let i = 0; i < n; i++) {
      advance(dt);
      if (state.follow) followCamera(Math.min(1, dt * 3));
      render(dt);
    }
  },
  stats() {
    return {
      trucks: { ...pipe.trucks.stats }, render: pipe.info(), waiting: pipe.waitingImages(), sync: pipe.syncPipelines(),
      bendMax: entries.reduce((m, e) => { for (let i = 1; i < e.train.count; i++) m = Math.max(m, Math.abs(e.train.bend[i])); return m; }, 0),
      limited: entries.reduce((m, e) => m + e.train.limited, 0),
      minR: [ROW_TRACK.minR, TIGHT_TRACK.minR, SCALE_TRACK.minR, FAR_TRACK.minR],
      trailerBody: TRUCK_TRAILER.body, liveries: TRUCK_LIVERIES.length, zoom: state.cam.zoom, errors: errors.slice()
    };
  }
};

// ---------------------------------------------------------------------------
// Start
try {
  pipe = bareMode ? await initBarePipe() : await initCorePipe();
  setSpeed(1);
  applyView(Math.max(1, Math.min(VIEWS.length, Number(params.get('view')) || 1)));
  syncUi();
  if (shotMode) setSpeed(1);
  window.__ciagniki.ready = true;
  if (!shotMode) requestAnimationFrame(loop);
} catch (err) {
  reportError(err.stack || String(err));
}
