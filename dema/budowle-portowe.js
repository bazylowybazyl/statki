// Demo Z7: budowle portowe jako moduły (docs/PLAN-ruch-v2-w-grze.md, zadanie Z7).
// Serwowanie: `npm run dev`, potem /dema/budowle-portowe.html
// (?view=1…9, ?style=earth|mars|jupiter, ?t=sekundy, ?shot=1 — bez panelu, do zrzutów).
//
// Prawdziwy potok renderu gry: Core3D (BG persp → świat ortho → FG persp,
// bloom, ACES) przez initHexShips3D / updateHexShips3D / drawHexShips3D, statki
// jako proxy ruchu v2 (ShipProxyBatch3D, Z4) z dyszami MAIN. Na scenie:
//  - galeria: stocznia (2 pochylnie z kadłubami rosnącymi przez czas budowy
//    WARSHIP_CLASSES, suwnice, żuraw, suchy dok z Atlasem) i hangar postojowy
//    (bębny w dachu, bramy IN/OUT, kolejka przed wejściem, statki znikają pod dachem);
//  - etapy budowy (4 pochylnie: stępka, wręgi, poszycie, wyposażenie);
//  - style trzech ringów (Ziemia, Mars, Jowisz);
//  - reda Ziemi: boje stref z portParking.js (Z2) i statki na slotach.
// Budowle stoją na zastępczej płycie „megadoku” (Z8 zrobi prawdziwe) — na ringu
// staną dopiero po Z6 i po uzgodnieniu z użytkownikiem. Statki tu to tylko ruch
// dema: w grze przyjdą z ruchu v2 (ring i porty nie udają życia).
import * as THREE from 'three';
import { Core3D } from '../src/3d/core3d.js';
import { drawHexShips3D, initHexShips3D, resizeHexShips3D, updateHexShips3D } from '../src/3d/hexShips3D.js';
import { Fx3D } from '../src/3d/fxParticles3D.js';
import { ShipProxyBatch3D } from '../src/3d/shipProxyBatch3D.js';
import { WARSHIP_CLASSES } from '../src/game/traffic/shipyards.js';
import { buildPortParking, createParkingRegistry, syncParking } from '../src/game/traffic/portParking.js';
import { buildHaloPortTrafficLayout } from '../src/3d/haloRing/haloPortTraffic.js';
import { createHaloRingLayout } from '../src/3d/haloRing/haloRingLayout.js';
import { resolvePortBuildingStyle } from '../src/3d/portBuildings/portBuildingStyle.js';
import { HULL_BUILD_STAGE_LABELS, createShipyardLayout, hullBuildStage } from '../src/3d/portBuildings/portShipyardLayout.js';
import { createHangarLayout } from '../src/3d/portBuildings/portHangarLayout.js';
import { portHeadingToGame, portHubToGame, portModuleFrame, portModuleTraffic, portRingModuleFrame } from '../src/3d/portBuildings/portModuleTraffic.js';
import { createHaloUniforms } from '../src/3d/haloRing/haloRingUniforms.js';
import { PortBuilding3D, PortHangar3D, PortShipyard3D } from '../src/3d/portBuildings/portBuildings3D.js';
import { PortRecorder, PB_MAT } from '../src/3d/portBuildings/portBuildingScene.js';
import { k7HeightToZ } from '../src/3d/haloRing/haloPortK7Layout.js';
import { PortBuoys3D } from '../src/3d/portBuildings/portBuoys3D.js';
import { buildPortBuoys } from '../src/3d/portBuildings/portBuoyLayout.js';

const params = new URLSearchParams(location.search);
const shotMode = params.get('shot') === '1';
if (shotMode) document.body.classList.add('shot');
const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (t) => t * t * (3 - 2 * t);

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
// Core3D jak w grze (WebGL w kanwie pod spodem, klatka kopiowana na 2D)
const canvas2d = $('c');
const ctx2d = canvas2d.getContext('2d');
const glCanvas = $('webgl-layer');
let W = canvas2d.width = innerWidth;
let H = canvas2d.height = innerHeight;
glCanvas.width = W;
glCanvas.height = H;
initHexShips3D({ canvas: glCanvas });
Core3D.renderer.debug.onShaderError = (gl, program, vs, fs) => {
  reportError(`SHADER: ${[gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs)].filter(Boolean).join('\n')}`);
};
addEventListener('resize', () => {
  W = canvas2d.width = innerWidth;
  H = canvas2d.height = innerHeight;
  resizeHexShips3D(W, H);
});

// Gospodarz budowli: środek „megadoku” daleko od zera (precyzja float32 jak w grze).
const P0 = Object.freeze({ x: 7_080_000, y: 6_290_000 });
// Słońce gry: w lewo-górę od portu (kierunek światła kadłubów i budowli).
window.SUN = { x: P0.x - 1_150_000, y: P0.y - 820_000, r: 2600 };

// Tło: gwiazdy na warstwie 1 (pass BG).
(function addStars() {
  const n = 2600;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let seed = 7771;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = P0.x + (rnd() - 0.5) * 600000;
    pos[i * 3 + 1] = -P0.y + (rnd() - 0.5) * 400000;
    pos[i * 3 + 2] = -90000 - rnd() * 40000;
    const b = Math.pow(rnd(), 6) * 1.3 + 0.07;
    const tint = rnd();
    col[i * 3] = b * (0.85 + 0.15 * tint);
    col[i * 3 + 1] = b * 0.92;
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
host.name = 'BudowlePortowe (gospodarz)';
host.position.set(P0.x, -P0.y, 0);
Core3D.scene.add(host);
const LAYER_BG = 1;
const LAYER_FG = 2;

// ---------------------------------------------------------------------------
// Rozstawienie (układ sceny gospodarza; kąt −π/2: przód budowli w dół ekranu,
// napisy czytelne). Ramka → gra: (P0.x + X, P0.y − Y).
const FRONT_DOWN = -Math.PI / 2;
const PLACE = {
  yard: portModuleFrame(-9000, 0, FRONT_DOWN),
  hangar: portModuleFrame(4200, 0, FRONT_DOWN),
  base: portModuleFrame(0, 0, FRONT_DOWN),
  stages: portModuleFrame(-1500, -16000, FRONT_DOWN),
  styles: [-6400, 0, 6400].map((x) => portModuleFrame(x, -27000, FRONT_DOWN))
};
const EARTH = Object.freeze({ x: P0.x, y: P0.y + 190_000 });

const state = {
  styleKey: ['earth', 'mars', 'jupiter'].includes(params.get('style')) ? params.get('style') : 'earth',
  T: Number(params.get('t')) || 0,
  speed: 1,
  paused: false,
  buildOverride: 0,
  roofMode: 'auto',           // auto | closed | open
  peak: false,
  showShips: true,
  showBuoys: true,
  cam: { x: P0.x, y: P0.y, zoom: 0.08 },
  mode: 'game',               // game | cine
  view: 1,
  fps: 60
};

const hubToGame = (frame, x, z, out = {}) => portHubToGame(frame, P0, x, z, out);

// ---------------------------------------------------------------------------
// Płyta zastępcza „megadoku” pod galerią (ten sam shader co budowle).
function buildBase(style) {
  const f = new PortRecorder();
  const M = PB_MAT;
  const x0 = -12400;
  const x1 = 11000;
  // płyty: wysokości K-7 (y) → z świata; wierzch płyty pod płaszczyzną gry
  const plates = [
    { points: [[x0, -1300], [x1, -1300], [x1, 0], [x0, 0]], z0: k7HeightToZ(-444), z1: k7HeightToZ(60), mat: M.dark, set: 'bg' },
    { points: [[x0, -1300], [x1, -1300], [x1, -900], [x0, -900]], z0: k7HeightToZ(60), z1: k7HeightToZ(90), mat: M.steel, set: 'bg' }
  ];
  // rurociąg wzdłuż płyty i wsporniki (bez „zębów” — to tylko tło dla budowli)
  for (const [z, r] of [[-1080, 30], [-1000, 22]]) f.cyl((x0 + x1) / 2, 84, z, r, x1 - x0 - 200, M.copper, [0, 0, Math.PI / 2]);
  for (let x = x0 + 400; x < x1 - 200; x += 1200) f.box(x, 70, -1040, 30, 40, 200, M.dark);
  f.fx(1, 0);
  f.box((x0 + x1) / 2, 30, -6, x1 - x0 - 100, 6, 6, M.cyan);
  f.nofx();
  for (let x = x0 + 600; x < x1; x += 1800) {
    f.fx(1.6, 1, (x % 7) / 7, 0.5);
    f.box(x, 150, -1250, 14, 10, 14, M.red);
    f.nofx();
  }
  const scene = { sets: f.sets, plates, labels: [], groups: [], lamps: [] };
  const b = new PortBuilding3D({ layout: { id: 'BASE' }, scene, style, frame: PLACE.base, name: 'Płyta megadoku (demo)' });
  b.setLayers(LAYER_BG, LAYER_FG);
  host.add(b.root);
  return b;
}

// ---------------------------------------------------------------------------
// Budowle
const yardLayout = createShipyardLayout({ id: 'Y-1', backZ: 0 });
const hangarLayout = createHangarLayout({ id: 'H-1', capacity: 300, backZ: 0, rows: 1 });
const stagesLayout = createShipyardLayout({ id: 'Y-2', backZ: 0, slips: 4, drydock: false });
const styleLayouts = ['earth', 'mars', 'jupiter'].map((k, i) => createShipyardLayout({ id: `Y-${i + 3}`, backZ: 0 }));
const yardTraffic = portModuleTraffic(yardLayout, { frame: PLACE.yard, station: P0, stationId: 'demo' });
const hangarTraffic = portModuleTraffic(hangarLayout, { frame: PLACE.hangar, station: P0, stationId: 'demo' }).hangars[0];

const B = { base: null, yard: null, hangar: null, stages: null, styles: [] };
function buildModules() {
  for (const b of [B.base, B.yard, B.hangar, B.stages, ...B.styles]) b?.dispose();
  const style = resolvePortBuildingStyle(state.styleKey);
  B.base = buildBase(style);
  B.yard = new PortShipyard3D({ layout: yardLayout, style, frame: PLACE.yard });
  B.hangar = new PortHangar3D({ layout: hangarLayout, style, frame: PLACE.hangar });
  B.stages = new PortShipyard3D({ layout: stagesLayout, style, frame: PLACE.stages });
  B.styles = styleLayouts.map((l, i) => new PortShipyard3D({ layout: l, style: ['earth', 'mars', 'jupiter'][i], frame: PLACE.styles[i] }));
  for (const b of [B.yard, B.hangar, B.stages, ...B.styles]) {
    b.setLayers(LAYER_BG, state.mode === 'cine' ? LAYER_BG : LAYER_FG);
    host.add(b.root);
  }
  applyLayers();
}
function applyLayers() {
  const fg = state.mode === 'cine' ? LAYER_BG : LAYER_FG;
  for (const b of [B.base, B.yard, B.hangar, B.stages, ...B.styles]) b?.setLayers(LAYER_BG, fg);
}

// Boje redy Ziemi (portParking.js, Z2) i statki na slotach.
const ringLayout = createHaloRingLayout({});
const earthPort = buildHaloPortTrafficLayout(ringLayout, { id: 'earth', x: EARTH.x, y: EARTH.y });
const earthPlan = buildPortParking(earthPort, null, {});
const buoySet = buildPortBuoys(earthPlan);
const buoys = new PortBuoys3D({ buoys: buoySet, style: state.styleKey });
buoys.setLayers(LAYER_BG, LAYER_FG);
Core3D.scene.add(buoys.group);

let seed = 20260927;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (mix) => {
  const r = rnd();
  let acc = 0;
  for (const [id, w] of mix) { acc += w; if (r < acc) return id; }
  return mix[mix.length - 1][0];
};
const CIVIL_MIX = [['inter_station_shuttle', 0.44], ['container_ship', 0.43], ['long_haul_freighter', 0.1], ['heavy_freighter', 0.02], ['megafreighter', 0.01]];
const WAR_MIX = [['terran_frigate', 0.6], ['terran_destroyer', 0.24], ['terran_battleship', 0.13], ['terran_carrier', 0.03]];
const civilReg = createParkingRegistry(earthPlan, { role: 'civil', mode: 'reda' });
const warReg = createParkingRegistry(earthPlan, { role: 'military', mode: 'reda' });
syncParking(civilReg, Array.from({ length: 390 }, (_, i) => ({ id: `c${i}`, hullId: pick(CIVIL_MIX), idleSince: i })));
syncParking(warReg, Array.from({ length: 170 }, (_, i) => ({ id: `w${i}`, hullId: pick(WAR_MIX), idleSince: i })));
const parked = [...civilReg.byShip.values(), ...warReg.byShip.values()].filter((s) => s.kind === 'reda');

// ---------------------------------------------------------------------------
// Ruch dema: pochylnie galerii (budowa w czasie), zejście okrętów, suchy dok z
// Atlasem, hangar (przyloty, kolejka, wlot pod dach, wyloty).
const EARTH_YARD_WEIGHT = 1.2 * Math.sqrt(60);   // SHIPYARD_WEIGHT.earth × √60 (trafficWorld.js)
const SLIP_SEQ = [
  ['carrier', 'frigate', 'cruiser', 'frigate', 'destroyer', 'frigate'],
  ['destroyer', 'frigate', 'frigate', 'cruiser', 'frigate', 'destroyer']
];
const slips = SLIP_SEQ.map((seq, i) => ({ seq, k: 0, classId: seq[0], progress: i === 0 ? 0.62 : 0.2, idleUntil: 0 }));
const launches = [];
function stepYard(dt) {
  slips.forEach((s, i) => {
    if (!s.classId) {
      if (state.T >= s.idleUntil) {
        s.k = (s.k + 1) % s.seq.length;
        s.classId = s.seq[s.k];
        s.progress = 0;
      }
      return;
    }
    const cls = WARSHIP_CLASSES[s.classId];
    s.progress += dt * EARTH_YARD_WEIGHT / cls.seconds;
    if (s.progress >= 1) {
      const b = yardTraffic.yards[i];
      launches.push({ key: `launch-${i}-${state.T.toFixed(2)}`, hullId: cls.hull, x0: b.x, y0: b.y, angle: b.angle, t0: state.T });
      s.classId = null;
      s.progress = 0;
      s.idleUntil = state.T + 9;
    }
  });
  for (let i = launches.length - 1; i >= 0; i--) if (state.T - launches[i].t0 > 22) launches.splice(i, 1);
}
function slipStates() {
  return slips.map((s) => {
    if (!s.classId) return null;
    const cls = WARSHIP_CLASSES[s.classId];
    const p = state.buildOverride > 0 ? state.buildOverride : s.progress;
    return { classId: cls.id, hullId: cls.hull, progress: clamp01(p) };
  });
}
function launchPose(l) {
  // zejście dziobem w kosmos: rozpęd 40 j./s² przez 22 s
  const tau = Math.max(0, state.T - l.t0);
  const s = 0.5 * 40 * tau * tau;
  const v = 40 * tau;
  return { x: l.x0 + Math.cos(l.angle) * s, y: l.y0 + Math.sin(l.angle) * s, angle: l.angle, vx: Math.cos(l.angle) * v, vy: Math.sin(l.angle) * v, throttle: 1 };
}

// Suchy dok: pętla 72 s — drzwi, wjazd dziobem, remont, wyjazd tyłem.
const dockBerth = yardLayout.berths.find((b) => b.kind === 'drydock');
const dockApproach = dockBerth.approach.from;
const DOCK_LOOP = 72;
function dockPhase(T) {
  const t = ((T % DOCK_LOOP) + DOCK_LOOP) % DOCK_LOOP;
  let u = 0;          // 0 przed dokiem, 1 na polu
  let doors = 0;
  let work = 0;
  if (t < 5) { doors = t / 5; u = 0; }
  else if (t < 20) { doors = 1; u = smooth((t - 5) / 15); }
  else if (t < 25) { doors = 1 - (t - 20) / 5; u = 1; }
  else if (t < 50) { doors = 0; u = 1; work = clamp01(Math.min((t - 25) / 2, (50 - t) / 2)); }
  else if (t < 55) { doors = (t - 50) / 5; u = 1; }
  else if (t < 69) { doors = 1; u = 1 - smooth((t - 55) / 14); }
  else { doors = 1 - (t - 69) / 3; u = 0; }
  const z = dockApproach.z + (dockBerth.z - dockApproach.z) * u;
  const pos = hubToGame(PLACE.yard, dockBerth.x, z);
  const inside = z < yardLayout.drydock.z1 + 200 ? 1 : 0;
  return { doors, work, pos, angle: portHeadingToGame(PLACE.yard, dockBerth.angle), inside, moving: u > 0.001 && u < 0.999 };
}
let dockRoof = 0;
let snapRoof = true;   // po zmianie widoku/stanu dach od razu w docelowym stanie

// Hangar: przyloty do kolejki, brama IN co cykl bębna, znikanie pod dachem, wyloty.
const HANGAR = {
  ships: [],
  queue: [],
  gateBusyUntil: 0,
  nextArrival: 2,
  nextDeparture: 5,
  seq: 0,
  events: [],
  fill: hangarLayout.drums.map((d, i) => 0.55 + 0.1 * i),
  gateOut: 0
};
const GATE_CYCLE = 6;
const hq = hangarTraffic.queue;
const qDir = { x: hq[1].x - hq[0].x, y: hq[1].y - hq[0].y };
const qLen = Math.hypot(qDir.x, qDir.y) || 1;
qDir.x /= qLen;
qDir.y /= qLen;
const qTail = hq[hq.length - 1];
function hangarSpawnPoint(k) {
  const d = 2600 + 900 * (k % 3);
  return { x: qTail.x + qDir.x * d + (rnd() - 0.5) * 1400, y: qTail.y + qDir.y * d };
}
function moveTo(ship, tx, ty, speed, dt) {
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
    ship.angle += da * Math.min(1, dt * 2.2);
  }
  return step >= d - 1e-6;
}
function stepHangar(dt) {
  const H = HANGAR;
  const gap = state.peak ? 2.2 : 11;
  if (state.T >= H.nextArrival) {
    const p = hangarSpawnPoint(H.seq);
    const ship = { id: `h${H.seq++}`, hullId: pick(CIVIL_MIX.slice(0, 3)), x: p.x, y: p.y, angle: Math.atan2(-qDir.y, -qDir.x), vx: 0, vy: 0, phase: 'approach', path: null, pi: 0 };
    H.ships.push(ship);
    H.queue.push(ship);
    H.nextArrival = state.T + gap * (0.7 + 0.6 * rnd());
  }
  if (state.T >= H.nextDeparture && H.ships.filter((s) => s.phase === 'exit').length < 2) {
    const e = hangarTraffic.exit;
    H.ships.push({ id: `o${H.seq++}`, hullId: pick(CIVIL_MIX.slice(0, 3)), x: e.x, y: e.y, angle: e.angle, vx: 0, vy: 0, phase: 'exit', path: [[e.toX, e.toY], [e.toX + Math.cos(e.angle) * 5000, e.toY + Math.sin(e.angle) * 5000]], pi: 0 });
    H.nextDeparture = state.T + (state.peak ? 7 : 12) * (0.7 + 0.6 * rnd());
    const d = Math.floor(rnd() * hangarLayout.drums.length);
    H.events.push({ drum: d, dir: -1 });
    H.fill[d] = Math.max(0.2, H.fill[d] - 1 / (hangarLayout.drums[d].slots));
  }
  // kolejka: statek k celuje w miejsce k (pas przed bramą IN)
  H.queue = H.queue.filter((s) => s.phase === 'approach' || s.phase === 'queued');
  H.queue.forEach((s, k) => {
    const slot = hq[Math.min(k, hq.length - 1)];
    const extra = Math.max(0, k - (hq.length - 1)) * 650;
    const tx = slot.x + qDir.x * extra;
    const ty = slot.y + qDir.y * extra;
    const arrived = moveTo(s, tx, ty, s.phase === 'approach' && Math.hypot(tx - s.x, ty - s.y) > 1500 ? 520 : 170, dt);
    if (arrived) {
      s.phase = 'queued';
      const da = Math.atan2(Math.sin(slot.angle - s.angle), Math.cos(slot.angle - s.angle));
      s.angle += da * Math.min(1, dt * 1.5);
    }
  });
  const head = H.queue[0];
  const gateFree = state.T >= H.gateBusyUntil;
  if (head && head.phase === 'queued' && gateFree) {
    const e = hangarTraffic.entry;
    head.phase = 'enter';
    head.path = [[e.fromX, e.fromY], [e.x, e.y]];
    head.pi = 0;
    H.gateBusyUntil = state.T + GATE_CYCLE;
  }
  for (const s of H.ships) {
    if (s.phase !== 'enter' && s.phase !== 'exit') continue;
    const tgt = s.path[s.pi];
    const speed = s.phase === 'enter' ? 210 : 260;
    if (moveTo(s, tgt[0], tgt[1], speed, dt)) {
      s.pi++;
      if (s.pi >= s.path.length) {
        if (s.phase === 'enter') {
          // pod dachem: zdjęty z renderu, bęben obraca się o gniazdo
          const d = Math.floor(rnd() * hangarLayout.drums.length);
          H.events.push({ drum: d, dir: 1 });
          H.fill[d] = Math.min(0.97, H.fill[d] + 1 / hangarLayout.drums[d].slots);
        }
        s.phase = 'gone';
      }
    }
  }
  H.ships = H.ships.filter((s) => s.phase !== 'gone');
  H.gateOut = H.ships.some((s) => s.phase === 'exit' && Math.hypot(s.x - hangarTraffic.exit.x, s.y - hangarTraffic.exit.y) < 2600) ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Atlas (sprite gracza) w suchym doku — oświetlony jak kadłub gry (lustro proxy).
const atlasTex = new THREE.TextureLoader().load('assets/capital_ship_rect_v1.png');
atlasTex.colorSpace = THREE.SRGBColorSpace;
atlasTex.anisotropy = 8;
const atlas = new THREE.Mesh(new THREE.PlaneGeometry(1800, 806), new THREE.ShaderMaterial({
  uniforms: { uMap: { value: atlasTex }, uLight: { value: new THREE.Vector3(0, 0, 1) }, uRot: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D uMap; uniform vec3 uLight; uniform float uRot;
    varying vec2 vUv;
    void main() {
      vec4 t = texture2D(uMap, vUv);
      if (t.a < 0.45) discard;
      vec2 p = vUv * 2.0 - 1.0;
      vec3 n = normalize(vec3(p.x * 0.45, p.y * 0.45, 1.0));
      float c = cos(uRot); float s = sin(uRot);
      n = normalize(vec3(n.x * c - n.y * s, n.x * s + n.y * c, n.z));
      float d = max(0.0, dot(n, uLight));
      vec3 col = t.rgb * (0.24 + 1.18 * d);
      vec3 h = normalize(uLight + vec3(0.0, 0.0, 1.0));
      col += vec3(pow(max(dot(n, h), 0.0), 32.0) * 0.3 * smoothstep(-0.02, 0.08, dot(n, uLight)));
      gl_FragColor = vec4(col, 1.0);
    }`
}));
atlas.name = 'Atlas (demo)';
atlas.layers.set(0);
atlas.renderOrder = 10;
atlas.frustumCulled = false;
Core3D.scene.add(atlas);
function placeAtlas(pose) {
  atlas.position.set(pose.pos.x, -pose.pos.y, 0);
  atlas.rotation.set(0, 0, -pose.angle);
  const L = atlas.material.uniforms.uLight.value.set(window.SUN.x - pose.pos.x, -(window.SUN.y - pose.pos.y), 600).normalize();
  void L;
  atlas.material.uniforms.uRot.value = -pose.angle;
}

// ---------------------------------------------------------------------------
// Widoki
const hubCenter = (frame, x, z) => hubToGame(frame, x, z);
const civilZone = earthPlan.zones.find((z) => z.role === 'civil');
const VIEWS = [
  { key: 1, name: 'Galeria: stocznia + hangar', sub: 'całość na płycie megadoku', apply: () => setGame(hubCenter(PLACE.base, -700, 2500), 0.066) },
  { key: 2, name: 'Pochylnie z bliska', sub: 'kadłuby rosnące, suwnice, żuraw', apply: () => setGame(hubCenter(PLACE.yard, -1490, 1650), 0.4) },
  { key: 3, name: 'Etapy budowy', sub: 'stępka · wręgi · poszycie · wyposażenie', apply: () => setGame(hubCenter(PLACE.stages, 0, 1700), 0.25) },
  { key: 4, name: 'Suchy dok: remont Atlasa', sub: 'dach znika, gdy Atlas w środku', apply: () => setGame(hubCenter(PLACE.yard, yardLayout.drydock.x, 1900), 0.34) },
  { key: 5, name: 'Hangar: brama i kolejka', sub: 'szczyt ruchu — statki czekają na zielone', apply: () => { state.peak = true; syncToggles(); setGame(hubCenter(PLACE.hangar, hangarLayout.gates[0].x - 800, hangarLayout.frontZ + 2600), 0.14); } },
  { key: 6, name: 'Hangar: bębny w dachu', sub: 'obrót o gniazdo przy każdym statku', apply: () => setGame(hubCenter(PLACE.hangar, 0, hangarLayout.frontZ * 0.45), 0.13) },
  { key: 7, name: 'Style ringów', sub: 'Ziemia · Mars · Jowisz', apply: () => setGame(hubCenter(PLACE.styles[1], 0, 1900), 0.078) },
  { key: 8, name: 'Reda Ziemi: boje stref', sub: 'strefy portParking (Z2), statki na slotach', apply: () => { const c = zoneCenter(civilZone); setGame(c, 0.055); } },
  { key: 9, name: 'Kino: stocznia z ukosa', sub: 'wolna kamera (budowle na jednej warstwie)', apply: () => setCine() }
];
function zoneCenter(z) {
  const a = (z.a0 + z.a1) / 2;
  const r = (z.r0 + z.r1) / 2;
  return { x: z.cx + Math.cos(a) * r, y: z.cy + Math.sin(a) * r };
}
function setGame(c, zoom) {
  state.mode = 'game';
  state.cam.x = c.x;
  state.cam.y = c.y;
  state.cam.zoom = zoom;
  applyLayers();
}
const cine = { cam: null, persp: new THREE.PerspectiveCamera(42, 1, 20, 400000), target: new THREE.Vector3(), dist: 7200, az: -0.7, el: 0.62 };
cine.persp.up.set(0, 0, 1);
function setCine() {
  state.mode = 'cine';
  const c = hubCenter(PLACE.yard, -600, 1600);
  cine.target.set(c.x, -c.y, -60);
  applyLayers();
}
function cineCamera() {
  const p = cine.persp;
  const ce = Math.cos(cine.el);
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
function applyView(i) {
  const v = VIEWS[Math.max(0, Math.min(VIEWS.length - 1, i - 1))];
  state.view = v.key;
  if (v.key !== 5) { state.peak = false; syncToggles(); }
  v.apply();
  snapRoof = true;
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
const STYLES = [['earth', 'Ziemia'], ['mars', 'Mars'], ['jupiter', 'Jowisz']];
const styleButtons = STYLES.map(([key, label]) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', () => setStyle(key));
  $('styles').appendChild(b);
  return b;
});
function setStyle(key) {
  state.styleKey = key;
  buildModules();
  buoysRef.current.dispose();
  buoysRef.current = new PortBuoys3D({ buoys: buoySet, style: key });
  buoysRef.current.setLayers(LAYER_BG, LAYER_FG);
  Core3D.scene.add(buoysRef.current.group);
  styleButtons.forEach((b, i) => b.classList.toggle('on', STYLES[i][0] === key));
}
const buoysRef = { current: buoys };
const SPEEDS = [['pauza', 0], ['1×', 1], ['10×', 10], ['60×', 60]];
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
$('build').addEventListener('input', (e) => {
  state.buildOverride = Number(e.target.value);
  $('build-out').textContent = state.buildOverride > 0 ? `${Math.round(state.buildOverride * 100)}%` : 'auto';
});
const TOGGLES = [
  ['statki (proxy)', () => state.showShips, (v) => { state.showShips = v; }],
  ['boje redy', () => state.showBuoys, (v) => { state.showBuoys = v; }],
  ['szczyt ruchu (hangar)', () => state.peak, (v) => { state.peak = v; }],
  ['dach doku zamknięty', () => state.roofMode === 'closed', (v) => { state.roofMode = v ? 'closed' : 'auto'; }]
];
const toggleInputs = TOGGLES.map(([label, get, set]) => {
  const l = document.createElement('label');
  const c = document.createElement('input');
  c.type = 'checkbox';
  c.checked = get();
  c.addEventListener('change', () => set(c.checked));
  l.append(c, label);
  $('toggles').appendChild(l);
  return { c, get };
});
function syncToggles() {
  for (const t of toggleInputs) t.c.checked = t.get();
}

// Sterowanie kamerą
let dragging = 0;
let lastX = 0;
let lastY = 0;
canvas2d.addEventListener('contextmenu', (e) => e.preventDefault());
canvas2d.addEventListener('pointerdown', (e) => { dragging = e.button === 2 ? 2 : 1; lastX = e.clientX; lastY = e.clientY; canvas2d.setPointerCapture(e.pointerId); });
canvas2d.addEventListener('pointerup', () => { dragging = 0; });
canvas2d.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  if (state.mode === 'cine') {
    cine.az -= dx * 0.005;
    cine.el = Math.max(0.12, Math.min(1.45, cine.el + dy * 0.004));
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
  // zoom do kursora (jak RTS)
  const k = Math.exp(-e.deltaY * 0.0012);
  const z0 = state.cam.zoom;
  const z1 = Math.max(0.01, Math.min(3.2, z0 * k));
  const mx = (e.clientX - W / 2);
  const my = (e.clientY - H / 2);
  state.cam.x += mx / z0 - mx / z1;
  state.cam.y += my / z0 - my / z1;
  state.cam.zoom = z1;
}, { passive: false });
addEventListener('keydown', (e) => {
  if (/^Digit[1-9]$/.test(e.code)) applyView(Number(e.code.slice(5)));
  if (e.code === 'Space') { setSpeed(state.speed ? 0 : 1); e.preventDefault(); }
  if (e.code === 'KeyR') state.roofMode = state.roofMode === 'auto' ? 'closed' : state.roofMode === 'closed' ? 'open' : 'auto';
});

// ---------------------------------------------------------------------------
// Klatka
const cullInfo = { x: 0, y: 0, drawHalfW: 0, drawHalfH: 0, halfW: 0, halfH: 0 };
const STAGE_STATES = [
  { classId: 'frigate', hullId: 'terran_frigate', progress: 0.05 },
  { classId: 'destroyer', hullId: 'terran_destroyer', progress: 0.22 },
  { classId: 'cruiser', hullId: 'terran_battleship', progress: 0.6 },
  { classId: 'carrier', hullId: 'terran_carrier', progress: 0.93 }
];
const STYLE_SLIPS = [
  { classId: 'cruiser', hullId: 'terran_battleship', progress: 0.55 },
  { classId: 'destroyer', hullId: 'terran_destroyer', progress: 0.3 }
];
let lastInfo = { calls: 0, triangles: 0 };

function simulate(dt) {
  if (dt <= 0) return;
  state.T += dt;
  stepYard(dt);
  stepHangar(dt);
}

function render(realDt, simDt) {
  const cam = state.mode === 'cine' ? cineCamera() : state.cam;
  const dock = dockPhase(state.T);
  const inside = dock.inside;
  const roofTarget = state.roofMode === 'closed' ? 0 : state.roofMode === 'open' ? 1 : inside;
  dockRoof = snapRoof ? roofTarget : dockRoof + (roofTarget - dockRoof) * (1 - Math.exp(-4 * Math.max(realDt, 1 / 60)));
  snapRoof = false;
  const sunOpts = { sun: window.SUN, at: P0 };
  for (const b of [B.base, B.yard, B.hangar, B.stages, ...B.styles]) b.setSun(sunOpts);
  B.base.tick(simDt, {});
  B.yard.update(simDt, { slips: slipStates(), drydock: { doors: dock.doors, work: dock.work, roofFade: dockRoof, service: dock.work > 0.1 ? 1 : 0 } });
  B.stages.update(simDt, { slips: STAGE_STATES });
  for (const b of B.styles) b.update(simDt, { slips: STYLE_SLIPS, drydock: { doors: 0, work: 0, roofFade: 0 } });
  const events = HANGAR.events.splice(0);
  B.hangar.update(simDt, {
    fill: HANGAR.fill,
    events,
    queue: HANGAR.queue.filter((s) => s.phase === 'queued').length,
    gateIn: state.T >= HANGAR.gateBusyUntil ? 1 : 0,
    gateOut: HANGAR.gateOut,
    heavy: 0.5
  });
  const bu = buoysRef.current;
  bu.group.visible = state.showBuoys;
  bu.update(cam, { time: state.T, viewW: W, viewH: H, sunAzimuth: B.yard.sunAzimuth });

  // statki (proxy ruchu v2)
  ShipProxyBatch3D.begin(cam);
  if (state.showShips) {
    for (const l of launches) {
      const p = launchPose(l);
      ShipProxyBatch3D.push(l.key, l.hullId, p.x, p.y, p.angle, { vx: p.vx, vy: p.vy, throttle: p.throttle });
    }
    for (const s of HANGAR.ships) {
      ShipProxyBatch3D.push(s.id, s.hullId, s.x, s.y, s.angle, { vx: s.vx, vy: s.vy, throttle: Math.hypot(s.vx, s.vy) > 20 ? 0.6 : 0 });
    }
    for (const p of parked) ShipProxyBatch3D.push(p.shipId, p.hullId, p.x, p.y, p.angle);
  }
  ShipProxyBatch3D.end();
  atlas.visible = state.showShips;
  placeAtlas(dock);

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

function slipText(i) {
  const s = slipStates()[i];
  if (!s) return `pochylnia ${i + 1}: zejście okrętu / pusta`;
  const cls = WARSHIP_CLASSES[s.classId];
  const stage = hullBuildStage(s.progress);
  return `pochylnia ${i + 1}: ${cls.label} · ${HULL_BUILD_STAGE_LABELS[stage]} ${Math.round(s.progress * 100)}%`;
}
function updateHud() {
  const P = ShipProxyBatch3D.stats;
  const mods = [B.yard, B.hangar, B.stages, ...B.styles];
  const drawCalls = mods.reduce((a, b) => a + b.drawCalls, 0);
  const dock = dockPhase(state.T);
  const lines = [
    `<b>FPS</b> ${state.fps.toFixed(0).padStart(4)}   <b>draw</b> ${lastInfo.calls}   <b>tri</b> ${(lastInfo.triangles / 1000).toFixed(0)}k`,
    `<b>budowle</b> siatek ${drawCalls} · instancji stocznia ${B.yard.scene.instances}, hangar ${B.hangar.scene.instances}`,
    `<b>czas</b> ${state.T.toFixed(1)} s (${state.paused ? 'pauza' : state.speed + '×'})   <b>zoom</b> ${state.cam.zoom.toFixed(3)}`,
    `<b>stocznia</b> ${slipText(0)}`,
    `         ${slipText(1)}`,
    `<b>suchy dok</b> drzwi ${Math.round(dock.doors * 100)}% · praca ${Math.round(dock.work * 100)}% · dach ${Math.round((1 - dockRoof) * 100)}%`,
    `<b>hangar</b> ${hangarLayout.capacity.total} miejsc · kolejka ${HANGAR.queue.length} · bębny ${hangarLayout.drums.map((d, i) => `${d.id.split('-').pop()} ${Math.round(HANGAR.fill[i] * 100)}%`).join(' ')}`,
    `<b>reda Ziemi</b> boje ${buoysRef.current.stats.drawn}/${buoySet.count} · statków na redzie ${parked.length}`,
    `<b>proxy</b> ${P.drawn} rys. · ${P.drawCalls} draw · dysze ${P.engines}`
  ];
  $('hud').innerHTML = lines.join('\n');
  const v = VIEWS[state.view - 1];
  $('caption').textContent = `${v.key} · ${v.name} — ${captionFor(v.key)}`;
}
function captionFor(key) {
  if (key === 2) return `${slipText(0)} | ${slipText(1)}`;
  if (key === 3) return STAGE_STATES.map((s) => `${WARSHIP_CLASSES[s.classId].label}: ${HULL_BUILD_STAGE_LABELS[hullBuildStage(s.progress)]}`).join(' · ');
  if (key === 4) return 'pole capital K-7 (Atlas 1800 × 806), drzwi teleskopowe, suwnice i ramiona remontowe';
  if (key === 5) return `kolejka ${HANGAR.queue.length} · brama IN ${state.T >= HANGAR.gateBusyUntil ? 'zielona' : 'czerwona'} · statek znika pod dachem`;
  if (key === 6) return hangarLayout.drums.map((d) => `${d.id.split('-').pop()}: ${d.slots} × ${d.levels}`).join(' · ') + ` · windy ${hangarLayout.heavy ? hangarLayout.heavy.capacity : 0}`;
  if (key === 7) return 'ten sam układ, styl z profilu ringu: K-7 / sklepienia z regolitem / radiatory i rury';
  if (key === 8) return `${earthPlan.zones.length} stref (cywilne ciepłe, wojskowe czerwone) · ${buoySet.count} boi`;
  if (key === 9) return 'przeciąganie = orbita, kółko = odległość';
  return `stocznia ${yardLayout.width} × ${Math.round(yardLayout.depth)} j. · hangar ${Math.round(2 * hangarLayout.halfWidth)} × ${Math.round(hangarLayout.depth)} j., ${hangarLayout.capacity.total} miejsc`;
}

// ---------------------------------------------------------------------------
// API zrzutów (dema/budowle-portowe-shots.js)
window.__port = {
  ready: false,
  get errors() { return errors.slice(); },
  view(i) { applyView(i); return VIEWS[i - 1]?.name; },
  setTime(T) { state.T = T; },
  setSpeed(s) { setSpeed(s); },
  setStyle(k) { setStyle(k); return state.styleKey; },
  setPeak(v) { state.peak = !!v; syncToggles(); },
  setRoof(mode) { state.roofMode = mode; snapRoof = true; },
  // Kompilacja shaderów budowli w trybie światła ringu (PB_LIGHT_HALO) na
  // uniformach ringu Ziemi — bez rysowania ringu (wpięcie w ring po Z6).
  checkHaloShaders() {
    const before = errors.length;
    const layout = createHaloRingLayout({});
    const uniforms = createHaloUniforms(layout);
    const frame = portRingModuleFrame(layout, 0.5);
    const yard = new PortShipyard3D({ layout: createShipyardLayout({ id: 'HALO-TEST' }), style: 'earth', frame, light: 'halo', haloUniforms: uniforms });
    const hangar = new PortHangar3D({ layout: createHangarLayout({ id: 'HALO-H', capacity: 120 }), style: 'jupiter', frame, light: 'halo', haloUniforms: uniforms });
    const g = new THREE.Group();
    g.add(yard.root, hangar.root);
    yard.update(0, { slips: STYLE_SLIPS });
    hangar.update(0, {});
    for (const b of [yard, hangar]) b.setLayers(LAYER_BG, LAYER_FG);
    Core3D.scene.add(g);
    Core3D.renderer.compile(Core3D.scene, Core3D.cameraPersp);
    Core3D.scene.remove(g);
    const programs = [yard, hangar].flatMap((b) => b.materials.map((m) => m.name));
    yard.dispose();
    hangar.dispose();
    return { ok: errors.length === before, newErrors: errors.slice(before), programs };
  },
  setBuild(p) { state.buildOverride = p; },
  simulate(seconds, step = 1 / 30) {
    const n = Math.round(seconds / step);
    for (let i = 0; i < n; i++) simulate(step);
  },
  renderFrames(n = 1, dt = 1 / 60) {
    for (let i = 0; i < n; i++) { simulate(state.paused ? 0 : dt * (state.speed || 1)); render(dt, state.paused ? 0 : dt); }
    updateHud();
    return { ...lastInfo };
  },
  stats() {
    return {
      ...lastInfo,
      proxies: { ...ShipProxyBatch3D.stats },
      buoys: { ...buoysRef.current.stats },
      queue: HANGAR.queue.length,
      modules: [B.yard, B.hangar, B.stages, ...B.styles].map((b) => ({ name: b.root.name, drawCalls: b.drawCalls, instances: b.scene.instances })),
      errors: errors.slice()
    };
  },
  cine(az, el, dist) { setCine(); if (Number.isFinite(az)) cine.az = az; if (Number.isFinite(el)) cine.el = el; if (Number.isFinite(dist)) cine.dist = dist; },
  center(x, y, zoom) { setGame({ x, y }, zoom); },
  B, yardLayout, hangarLayout, yardTraffic, hangarTraffic, earthPlan, hangarState: HANGAR
};

// ---------------------------------------------------------------------------
// Start
buildModules();
styleButtons.forEach((b, i) => b.classList.toggle('on', STYLES[i][0] === state.styleKey));
setSpeed(1);
applyView(Math.max(1, Math.min(VIEWS.length, Number(params.get('view')) || 1)));
if (params.has('zoom')) state.cam.zoom = Number(params.get('zoom'));
// sprite'y kadłubów w tle (proxy i pochylnie ładują je same) — zrzut czeka na nie
function texturesReady() {
  return !!atlasTex.image && atlasTex.image.complete !== false && (atlasTex.image.width || atlasTex.image.naturalWidth);
}
if (shotMode) {
  setSpeed(0);
  const wait = () => {
    render(1 / 60, 0);
    if (texturesReady() && ShipProxyBatch3D.stats.waitingImage === 0) {
      window.__port.renderFrames(3);
      window.__port.ready = true;
    } else setTimeout(wait, 60);
  };
  wait();
} else {
  window.__port.ready = true;
  requestAnimationFrame(loop);
}
