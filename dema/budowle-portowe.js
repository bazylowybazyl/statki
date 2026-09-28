// Demo Z7: budowle portowe jako moduły (docs/PLAN-ruch-v2-w-grze.md, zadanie Z7).
// Serwowanie: `npm run dev`, potem /dema/budowle-portowe.html
// (?view=1…9, ?style=earth|mars|jupiter, ?t=sekundy, ?shot=1 — bez panelu, do zrzutów).
//
// Prawdziwy potok renderu gry: Core3D (BG persp → świat ortho → FG persp,
// bloom, ACES) przez initHexShips3D / updateHexShips3D / drawHexShips3D, statki
// jako proxy ruchu v2 (ShipProxyBatch3D, Z4) z dyszami MAIN, kontenery i drony
// renderami Z5 (CargoContainers3D, CargoDrones3D). Na scenie:
//  - stocznia wg szkicu użytkownika (2026-09-27): taśma z kontenerami wzdłuż
//    ringu i trzonem do piasty, dwie pochylnie (kadłub buduje rój dronów, jeden
//    dźwig przenosi bloki), piasta z placami postoju / refitu — Ziemia: okrąg
//    z wypustkami, Mars i Jowisz: litera U; gotowy okręt zjeżdża pasem na plac,
//    Atlas przechodzi refit (drony ze składu przy rdzeniu);
//  - hangar postojowy (bębny w dachu, bramy IN/OUT, kolejka, statki znikają pod dachem);
//  - etapy budowy (4 pochylnie: stępka, wręgi, poszycie, wyposażenie);
//  - stocznie trzech frakcji (Ziemia, Mars, Jowisz);
//  - reda Ziemi: boje stref z portParking.js (Z2) i statki na slotach.
// Budowle stoją na zastępczym pasie „ringu” — na prawdziwym ringu staną dopiero
// po uzgodnieniu z użytkownikiem. Statki tu to tylko ruch dema: w grze przyjdą
// z ruchu v2 (ring i porty nie udają życia).
import * as THREE from 'three';
import { Core3D } from '../src/3d/core3d.js';
import { drawHexShips3D, initHexShips3D, resizeHexShips3D, updateHexShips3D } from '../src/3d/hexShips3D.js';
import { Fx3D } from '../src/3d/fxParticles3D.js';
import { ShipProxyBatch3D } from '../src/3d/shipProxyBatch3D.js';
import { CargoContainers3D } from '../src/3d/cargoContainers3D.js';
import { CargoDrones3D } from '../src/3d/cargoDrones3D.js';
import { WARSHIP_CLASSES } from '../src/game/traffic/shipyards.js';
import { hullFootprint } from '../src/game/traffic/dockLayout.js';
import { buildPortParking, createParkingRegistry, syncParking } from '../src/game/traffic/portParking.js';
import { buildHaloPortTrafficLayout } from '../src/3d/haloRing/haloPortTraffic.js';
import { createHaloRingLayout } from '../src/3d/haloRing/haloRingLayout.js';
import { resolvePortBuildingStyle } from '../src/3d/portBuildings/portBuildingStyle.js';
import { HULL_BUILD_STAGE_LABELS, SHIPYARD_ATLAS, createShipyardLayout, hullBuildStage, shipyardHullFits, shipyardPads } from '../src/3d/portBuildings/portShipyardLayout.js';
import { createHangarLayout } from '../src/3d/portBuildings/portHangarLayout.js';
import { portHeadingToGame, portHubToGame, portModuleCargoPose, portModuleFrame, portModuleTraffic, portRingModuleFrame } from '../src/3d/portBuildings/portModuleTraffic.js';
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
const DEG = Math.PI / 180;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

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
// Kontenery i drony (Z5): świat (warstwa 0, paralaksa) + światła dronów w FG.
CargoContainers3D.attach(Core3D.scene);
CargoDrones3D.attach(Core3D.scene);

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
// napisy czytelne). Ramka → gra: (P0.x + X, P0.y − Y). Pas „ringu” nad budowlami.
const FRONT_DOWN = -Math.PI / 2;
const PLACE = {
  yard: portModuleFrame(-7000, 0, FRONT_DOWN),
  hangar: portModuleFrame(4000, 0, FRONT_DOWN),
  base: portModuleFrame(0, 0, FRONT_DOWN),
  stages: portModuleFrame(0, -15000, FRONT_DOWN),
  stylesRow: portModuleFrame(0, -31000, FRONT_DOWN),
  styles: [-8400, 0, 8400].map((x) => portModuleFrame(x, -31000, FRONT_DOWN))
};
const EARTH = Object.freeze({ x: P0.x, y: P0.y + 190_000 });
const POSE = {
  yard: portModuleCargoPose(PLACE.yard, P0),
  stages: portModuleCargoPose(PLACE.stages, P0),
  styles: PLACE.styles.map((f) => portModuleCargoPose(f, P0))
};

const state = {
  styleKey: ['earth', 'mars', 'jupiter'].includes(params.get('style')) ? params.get('style') : 'earth',
  T: Number(params.get('t')) || 0,
  speed: 1,
  paused: false,
  buildOverride: 0,
  peak: false,
  showShips: true,
  showBuoys: true,
  showSwarm: true,
  cam: { x: P0.x, y: P0.y, zoom: 0.08 },
  mode: 'game',               // game | cine
  view: 1,
  fps: 60
};

const hubToGame = (frame, x, z, out = {}) => portHubToGame(frame, P0, x, z, out);

// ---------------------------------------------------------------------------
// Pas zastępczy „ringu” (lico, do którego wpięta jest galeria stoczni i hangar)
// — ten sam shader co budowle. W grze to podłoga ringu albo korpus megadoku.
function buildBand(style, frame, x0, x1, name) {
  const f = new PortRecorder();
  const M = PB_MAT;
  const plates = [
    { points: [[x0, -1300], [x1, -1300], [x1, 0], [x0, 0]], z0: k7HeightToZ(-444), z1: k7HeightToZ(60), mat: M.dark, set: 'bg' },
    { points: [[x0, -1300], [x1, -1300], [x1, -900], [x0, -900]], z0: k7HeightToZ(60), z1: k7HeightToZ(90), mat: M.steel, set: 'bg' }
  ];
  for (const [z, r] of [[-1080, 30], [-1000, 22]]) f.cyl((x0 + x1) / 2, 84, z, r, x1 - x0 - 200, M.copper, [0, 0, Math.PI / 2]);
  for (let x = x0 + 400; x < x1 - 200; x += 1200) f.box(x, 70, -1040, 30, 40, 200, M.dark);
  for (let x = x0 + 600; x < x1; x += 1800) {
    f.fx(1.6, 1, (x % 7) / 7, 0.5);
    f.box(x, 150, -1250, 14, 10, 14, M.red);
    f.nofx();
  }
  const scene = { sets: f.sets, plates, labels: [], groups: [], lamps: [] };
  const b = new PortBuilding3D({ layout: { id: 'BAND' }, scene, style, frame, name });
  b.setLayers(LAYER_BG, LAYER_FG);
  host.add(b.root);
  return b;
}

// ---------------------------------------------------------------------------
// Budowle (układ stoczni zależy od frakcji: okrąg Ziemi albo U)
const hangarLayout = createHangarLayout({ id: 'H-1', capacity: 300, backZ: 0, rows: 1 });
const hangarTraffic = portModuleTraffic(hangarLayout, { frame: PLACE.hangar, station: P0, stationId: 'demo' }).hangars[0];
const STYLE_KEYS = ['earth', 'mars', 'jupiter'];
const L = { yard: null, stages: null, styles: [], yardTraffic: null, pads: [] };
function makeLayouts(style) {
  L.yard = createShipyardLayout({ id: 'Y-1', backZ: 0, hub: style.shipyardHub });
  L.stages = createShipyardLayout({ id: 'Y-2', backZ: 0, slips: 4, hub: style.shipyardHub });
  L.styles = STYLE_KEYS.map((k, i) => createShipyardLayout({ id: `Y-${i + 3}`, backZ: 0, hub: resolvePortBuildingStyle(k).shipyardHub }));
  L.yardTraffic = portModuleTraffic(L.yard, { frame: PLACE.yard, station: P0, stationId: 'demo' });
  L.pads = shipyardPads(L.yard);
  L.atlasPad = L.pads.find((p) => shipyardHullFits(p, SHIPYARD_ATLAS));
}

const B = { bands: [], yard: null, hangar: null, stages: null, styles: [] };
const allModules = () => [B.yard, B.hangar, B.stages, ...B.styles].filter(Boolean);
function buildModules() {
  for (const b of [...B.bands, ...allModules()]) b.dispose();
  const style = resolvePortBuildingStyle(state.styleKey);
  makeLayouts(style);
  B.bands = [
    buildBand(style, PLACE.base, -12400, 11000, 'Pas ringu (galeria)'),
    buildBand(style, PLACE.stages, -4600, 4600, 'Pas ringu (etapy)'),
    buildBand(style, PLACE.stylesRow, -12400, 12400, 'Pas ringu (frakcje)')
  ];
  B.yard = new PortShipyard3D({ layout: L.yard, style, frame: PLACE.yard });
  B.hangar = new PortHangar3D({ layout: hangarLayout, style, frame: PLACE.hangar });
  B.stages = new PortShipyard3D({ layout: L.stages, style, frame: PLACE.stages, seed: 11 });
  B.styles = L.styles.map((l, i) => new PortShipyard3D({ layout: l, style: STYLE_KEYS[i], frame: PLACE.styles[i], seed: 20 + i }));
  for (const b of allModules()) host.add(b.root);
  resetYard();
  applyLayers();
}
function applyLayers() {
  const cine = state.mode === 'cine';
  const fg = cine ? LAYER_BG : LAYER_FG;
  for (const b of [...B.bands, ...allModules()]) b.setLayers(LAYER_BG, fg);
  // wolna kamera: kontenery i drony z budowlami na jednej warstwie (wspólna głębia)
  CargoContainers3D.setLayer(cine ? LAYER_BG : 0);
  CargoDrones3D.setLayers(cine ? LAYER_BG : 0, cine ? LAYER_BG : LAYER_FG);
}

// Boje redy Ziemi (portParking.js, Z2) i statki na slotach.
const ringLayout = createHaloRingLayout({});
const earthPort = buildHaloPortTrafficLayout(ringLayout, { id: 'earth', x: EARTH.x, y: EARTH.y });
const earthPlan = buildPortParking(earthPort, null, {});
const buoySet = buildPortBuoys(earthPlan);
const buoysRef = { current: null };

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
// Ruch dema: pochylnie galerii (budowa w czasie), zejście okrętu pasem na plac
// piasty, postój, odlot; Atlas w reficie na placu capital; hangar (kolejka).
const EARTH_YARD_WEIGHT = 1.2 * Math.sqrt(60);   // SHIPYARD_WEIGHT.earth × √60 (trafficWorld.js)
const SLIP_SEQ = [
  ['carrier', 'frigate', 'cruiser', 'frigate', 'destroyer', 'frigate'],
  ['destroyer', 'frigate', 'frigate', 'cruiser', 'frigate', 'destroyer']
];
const slips = SLIP_SEQ.map((seq, i) => ({ seq, k: 0, classId: seq[0], progress: i === 0 ? 0.62 : 0.3, idleUntil: 0 }));
const PARK_SECONDS = 90;
const YARD = { ships: [], seq: 0 };

function moveTo(ship, tx, ty, speed, dt, turn = 2.2) {
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
const turnTo = (ship, angle, dt, rate = 1.6) => {
  const da = Math.atan2(Math.sin(angle - ship.angle), Math.cos(angle - ship.angle));
  ship.angle += da * Math.min(1, dt * rate);
};

// Plac dla kadłuba: wolny, pasujący, najmniejszy (Atlas trzyma plac capital).
function freePad(hullId) {
  const fp = hullFootprint(hullId);
  let best = null;
  for (const p of L.pads) {
    if (p === L.atlasPad || YARD.ships.some((s) => s.pad === p)) continue;
    if (!shipyardHullFits(p, { length: fp.length, beam: fp.width })) continue;
    if (!best || p.maxBeam * p.maxLength < best.maxBeam * best.maxLength) best = p;
  }
  return best;
}
function padGame(p) {
  const c = hubToGame(PLACE.yard, p.x, p.z);
  const a = hubToGame(PLACE.yard, p.approach.from.x, p.approach.from.z);
  return { x: c.x, y: c.y, ax: a.x, ay: a.y, angle: portHeadingToGame(PLACE.yard, p.angle) };
}
function resetYard() {
  YARD.ships.length = 0;
  // okręty po produkcji już na placach (flota czeka na przydział)
  for (const [classId, dt] of [['carrier', 0], ['cruiser', 40], ['destroyer', 80], ['frigate', 120]]) {
    const hullId = WARSHIP_CLASSES[classId].hull;
    const pad = freePad(hullId);
    if (!pad) continue;
    const g = padGame(pad);
    YARD.ships.push({ id: `p${YARD.seq++}`, hullId, pad, x: g.x, y: g.y, angle: g.angle, vx: 0, vy: 0, phase: 'parked', until: state.T + 150 + dt, path: null, pi: 0 });
  }
}
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
      const b = L.yardTraffic.yards[i];
      const pad = freePad(cls.hull);
      YARD.ships.push({ id: `y${YARD.seq++}`, hullId: cls.hull, pad, slip: i, x: b.x, y: b.y, angle: b.angle, vx: 0, vy: 0, phase: 'launch', t0: state.T, path: [[b.launchX, b.launchY]], pi: 0 });
      s.classId = null;
      s.progress = 0;
      s.idleUntil = state.T + 9;
    }
  });
  for (const sh of YARD.ships) {
    if (sh.phase === 'launch') {
      // zejście dziobem ku piaście, prosto wzdłuż pasa, z rozpędem
      const speed = Math.min(170, 25 + 30 * (state.T - sh.t0));
      if (moveTo(sh, sh.path[0][0], sh.path[0][1], speed, dt, 0)) {
        if (sh.pad) {
          const g = padGame(sh.pad);
          sh.phase = 'transit';
          sh.path = [[g.ax, g.ay], [g.x, g.y]];
          sh.pi = 0;
        } else {
          sh.phase = 'depart';
          sh.path = [[sh.x + Math.cos(sh.angle) * 9000, sh.y + Math.sin(sh.angle) * 9000]];
          sh.pi = 0;
        }
      }
    } else if (sh.phase === 'transit') {
      const tgt = sh.path[sh.pi];
      const last = sh.pi === sh.path.length - 1;
      const g = padGame(sh.pad);
      if (last) turnTo(sh, g.angle, dt);
      if (moveTo(sh, tgt[0], tgt[1], last ? 90 : 240, dt, last ? 0 : 2.2)) {
        sh.pi++;
        if (sh.pi >= sh.path.length) { sh.phase = 'parked'; sh.until = state.T + PARK_SECONDS; }
      }
    } else if (sh.phase === 'parked') {
      sh.vx = sh.vy = 0;
      if (sh.pad) turnTo(sh, padGame(sh.pad).angle, dt);
      if (state.T >= sh.until) {
        const g = padGame(sh.pad);
        sh.phase = 'depart';
        const ox = g.ax - g.x;
        const oy = g.ay - g.y;
        sh.path = [[g.ax, g.ay], [g.ax + ox * 6, g.ay + oy * 6]];
        sh.pi = 0;
        sh.pad = null;
      }
    } else if (sh.phase === 'depart') {
      const tgt = sh.path[sh.pi];
      if (moveTo(sh, tgt[0], tgt[1], sh.pi === 0 ? 120 : 320, dt, 1.4)) {
        sh.pi++;
        if (sh.pi >= sh.path.length) sh.phase = 'gone';
      }
    }
  }
  for (let i = YARD.ships.length - 1; i >= 0; i--) if (YARD.ships[i].phase === 'gone') YARD.ships.splice(i, 1);
}
function slipStates() {
  return slips.map((s) => {
    if (!s.classId) return null;
    const cls = WARSHIP_CLASSES[s.classId];
    const p = state.buildOverride > 0 ? state.buildOverride : s.progress;
    return { classId: cls.id, hullId: cls.hull, progress: clamp01(p) };
  });
}
function padMap() {
  const out = {};
  for (const s of YARD.ships) if (s.pad && s.phase === 'parked') out[s.pad.id] = 1;
  if (L.atlasPad) out[L.atlasPad.id] = 2;
  return out;
}
function atlasRefit() {
  return L.atlasPad ? [{ pad: L.atlasPad, length: SHIPYARD_ATLAS.length, beam: SHIPYARD_ATLAS.beam, work: 1 }] : [];
}

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
function stepHangar(dt) {
  const Hs = HANGAR;
  const gap = state.peak ? 2.2 : 11;
  if (state.T >= Hs.nextArrival) {
    const p = hangarSpawnPoint(Hs.seq);
    const ship = { id: `h${Hs.seq++}`, hullId: pick(CIVIL_MIX.slice(0, 3)), x: p.x, y: p.y, angle: Math.atan2(-qDir.y, -qDir.x), vx: 0, vy: 0, phase: 'approach', path: null, pi: 0 };
    Hs.ships.push(ship);
    Hs.queue.push(ship);
    Hs.nextArrival = state.T + gap * (0.7 + 0.6 * rnd());
  }
  if (state.T >= Hs.nextDeparture && Hs.ships.filter((s) => s.phase === 'exit').length < 2) {
    const e = hangarTraffic.exit;
    Hs.ships.push({ id: `o${Hs.seq++}`, hullId: pick(CIVIL_MIX.slice(0, 3)), x: e.x, y: e.y, angle: e.angle, vx: 0, vy: 0, phase: 'exit', path: [[e.toX, e.toY], [e.toX + Math.cos(e.angle) * 5000, e.toY + Math.sin(e.angle) * 5000]], pi: 0 });
    Hs.nextDeparture = state.T + (state.peak ? 7 : 12) * (0.7 + 0.6 * rnd());
    const d = Math.floor(rnd() * hangarLayout.drums.length);
    Hs.events.push({ drum: d, dir: -1 });
    Hs.fill[d] = Math.max(0.2, Hs.fill[d] - 1 / (hangarLayout.drums[d].slots));
  }
  // kolejka: statek k celuje w miejsce k (pas przed bramą IN)
  Hs.queue = Hs.queue.filter((s) => s.phase === 'approach' || s.phase === 'queued');
  Hs.queue.forEach((s, k) => {
    const slot = hq[Math.min(k, hq.length - 1)];
    const extra = Math.max(0, k - (hq.length - 1)) * 650;
    const tx = slot.x + qDir.x * extra;
    const ty = slot.y + qDir.y * extra;
    const arrived = moveTo(s, tx, ty, s.phase === 'approach' && Math.hypot(tx - s.x, ty - s.y) > 1500 ? 520 : 170, dt);
    if (arrived) {
      s.phase = 'queued';
      turnTo(s, slot.angle, dt, 1.5);
    }
  });
  const head = Hs.queue[0];
  const gateFree = state.T >= Hs.gateBusyUntil;
  if (head && head.phase === 'queued' && gateFree) {
    const e = hangarTraffic.entry;
    head.phase = 'enter';
    head.path = [[e.fromX, e.fromY], [e.x, e.y]];
    head.pi = 0;
    Hs.gateBusyUntil = state.T + GATE_CYCLE;
  }
  for (const s of Hs.ships) {
    if (s.phase !== 'enter' && s.phase !== 'exit') continue;
    const tgt = s.path[s.pi];
    const speed = s.phase === 'enter' ? 210 : 260;
    if (moveTo(s, tgt[0], tgt[1], speed, dt)) {
      s.pi++;
      if (s.pi >= s.path.length) {
        if (s.phase === 'enter') {
          // pod dachem: zdjęty z renderu, bęben obraca się o gniazdo
          const d = Math.floor(rnd() * hangarLayout.drums.length);
          Hs.events.push({ drum: d, dir: 1 });
          Hs.fill[d] = Math.min(0.97, Hs.fill[d] + 1 / hangarLayout.drums[d].slots);
        }
        s.phase = 'gone';
      }
    }
  }
  Hs.ships = Hs.ships.filter((s) => s.phase !== 'gone');
  Hs.gateOut = Hs.ships.some((s) => s.phase === 'exit' && Math.hypot(s.x - hangarTraffic.exit.x, s.y - hangarTraffic.exit.y) < 2600) ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Atlas (sprite gracza) na placu capital w reficie — oświetlony jak kadłub gry.
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
function placeAtlas() {
  const p = L.atlasPad;
  atlas.visible = !!p && state.showShips;
  if (!p) return;
  const g = padGame(p);
  atlas.position.set(g.x, -g.y, 0);
  atlas.rotation.set(0, 0, -g.angle);
  atlas.material.uniforms.uLight.value.set(window.SUN.x - g.x, -(window.SUN.y - g.y), 600).normalize();
  atlas.material.uniforms.uRot.value = -g.angle;
}

// ---------------------------------------------------------------------------
// Widoki
const hubCenter = (frame, x, z) => hubToGame(frame, x, z);
const civilZone = earthPlan.zones.find((z) => z.role === 'civil');
function hubFocus(l) {
  return l.hub.kind === 'radial' ? { x: 0, z: l.hub.z + 1300 } : { x: 0, z: (l.hub.base.z0 + l.hub.arms[0].z1) / 2 };
}
const VIEWS = [
  { key: 1, name: 'Galeria: stocznia + hangar', sub: 'ring → taśma → trzon → pochylnie → piasta', apply: () => setGame(hubCenter(PLACE.base, -1600, 4700), 0.068) },
  { key: 2, name: 'Pochylnie: rój dronów i dźwig', sub: 'moduły z taśmy, jeden dźwig na pochylnię', apply: () => setGame(hubCenter(PLACE.yard, 0, (L.yard.slips[0].z0 + L.yard.slips[0].apronZ1) / 2), 0.3) },
  { key: 3, name: 'Etapy budowy', sub: 'stępka · wręgi · poszycie · wyposażenie', apply: () => setGame(hubCenter(PLACE.stages, 0, (L.stages.slips[0].z0 + L.stages.slips[3].apronZ1) / 2), 0.19) },
  { key: 4, name: 'Piasta: postój i refit', sub: 'okręty po produkcji na placach, Atlas w reficie', apply: () => { const f = hubFocus(L.yard); setGame(hubCenter(PLACE.yard, f.x, f.z), 0.14); } },
  { key: 5, name: 'Hangar: brama i kolejka', sub: 'szczyt ruchu — statki czekają na zielone', apply: () => { state.peak = true; syncToggles(); setGame(hubCenter(PLACE.hangar, hangarLayout.gates[0].x - 800, hangarLayout.frontZ + 2600), 0.14); } },
  { key: 6, name: 'Hangar: bębny w dachu', sub: 'obrót o gniazdo przy każdym statku', apply: () => setGame(hubCenter(PLACE.hangar, 0, hangarLayout.frontZ * 0.45), 0.13) },
  { key: 7, name: 'Stocznie frakcji', sub: 'Ziemia: okrąg z wypustkami · Mars, Jowisz: litera U', apply: () => setGame(hubCenter(PLACE.styles[1], 0, 4900), 0.062) },
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
  const c = hubCenter(PLACE.yard, -300, 3300);
  cine.target.set(c.x, -c.y, -60);
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
function applyView(i) {
  const v = VIEWS[Math.max(0, Math.min(VIEWS.length - 1, i - 1))];
  state.view = v.key;
  if (v.key !== 5) { state.peak = false; syncToggles(); }
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
const STYLES = [['earth', 'Ziemia'], ['mars', 'Mars'], ['jupiter', 'Jowisz']];
const styleButtons = STYLES.map(([key, label]) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', () => setStyle(key));
  $('styles').appendChild(b);
  return b;
});
function makeBuoys(key) {
  buoysRef.current?.dispose();
  buoysRef.current = new PortBuoys3D({ buoys: buoySet, style: key });
  buoysRef.current.setLayers(LAYER_BG, LAYER_FG);
  Core3D.scene.add(buoysRef.current.group);
}
function setStyle(key) {
  state.styleKey = key;
  buildModules();
  makeBuoys(key);
  styleButtons.forEach((b, i) => b.classList.toggle('on', STYLES[i][0] === key));
  applyView(state.view);
}
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
  ['rój i kontenery', () => state.showSwarm, (v) => { state.showSwarm = v; }],
  ['boje redy', () => state.showBuoys, (v) => { state.showBuoys = v; }],
  ['szczyt ruchu (hangar)', () => state.peak, (v) => { state.peak = v; }]
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
const portSun = { dir: null, daylight: 1 };

function simulate(dt) {
  if (dt <= 0) return;
  state.T += dt;
  stepYard(dt);
  stepHangar(dt);
}

function pushCargo(cam) {
  // kontenery i drony tej klatki (Z5): paralaksa jak pass ortho gry
  portSun.dir = B.yard.uniforms.uSunDirW.value;
  if (state.mode === 'cine') {
    const p = cine.persp.position;
    const d = p.distanceTo(cine.target);
    CargoContainers3D.begin({
      camera: { x: p.x, y: -p.y, zoom: 1 },
      origin: { x: p.x, y: p.y },
      perspective: true,
      pxPerUnit: (H * 0.5) / Math.tan(21 * DEG) / Math.max(1, d),
      sun: window.SUN, portSun, time: state.T
    });
  } else {
    CargoContainers3D.begin({
      camera: cam,
      cameraHeight: (H / 2) / Math.tan(Core3D.cameraPersp.fov * 0.5 * DEG) / cam.zoom,
      pxPerUnit: cam.zoom,
      viewHalfW: (W / 2) / cam.zoom,
      viewHalfH: (H / 2) / cam.zoom,
      sun: window.SUN, portSun, time: state.T
    });
  }
  CargoDrones3D.begin({ camera3: state.mode === 'cine' ? cine.persp : Core3D.cameraPersp });
  if (state.showSwarm) {
    B.yard.pushCargo(CargoContainers3D, CargoDrones3D, POSE.yard);
    B.stages.pushCargo(CargoContainers3D, CargoDrones3D, POSE.stages);
    B.styles.forEach((b, i) => b.pushCargo(CargoContainers3D, CargoDrones3D, POSE.styles[i]));
  }
  CargoContainers3D.end();
  CargoDrones3D.end();
}

function render(realDt, simDt) {
  const cam = state.mode === 'cine' ? cineCamera() : state.cam;
  const sunOpts = { sun: window.SUN, at: P0 };
  for (const b of [...B.bands, ...allModules()]) b.setSun(sunOpts);
  for (const b of B.bands) b.tick(simDt, {});
  const launch = [0, 0];
  for (const s of YARD.ships) if (s.phase === 'launch' && s.slip !== undefined) launch[s.slip] = 1;
  B.yard.update(simDt, { slips: slipStates(), launch, pads: padMap(), refit: atlasRefit() });
  B.stages.update(simDt, { slips: STAGE_STATES });
  for (const b of B.styles) b.update(simDt, { slips: STYLE_SLIPS });
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
    for (const s of YARD.ships) {
      const moving = Math.hypot(s.vx, s.vy) > 5;
      ShipProxyBatch3D.push(s.id, s.hullId, s.x, s.y, s.angle, { vx: s.vx, vy: s.vy, throttle: moving ? 0.7 : 0 });
    }
    for (const s of HANGAR.ships) {
      ShipProxyBatch3D.push(s.id, s.hullId, s.x, s.y, s.angle, { vx: s.vx, vy: s.vy, throttle: Math.hypot(s.vx, s.vy) > 20 ? 0.6 : 0 });
    }
    for (const p of parked) ShipProxyBatch3D.push(p.shipId, p.hullId, p.x, p.y, p.angle);
  }
  ShipProxyBatch3D.end();
  placeAtlas();
  pushCargo(cam);

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
  const mods = allModules();
  const drawCalls = mods.reduce((a, b) => a + b.drawCalls, 0);
  const sw = B.yard.swarm;
  const parkedPads = YARD.ships.filter((s) => s.phase === 'parked').length;
  const lines = [
    `<b>FPS</b> ${state.fps.toFixed(0).padStart(4)}   <b>draw</b> ${lastInfo.calls}   <b>tri</b> ${(lastInfo.triangles / 1000).toFixed(0)}k`,
    `<b>budowle</b> siatek ${drawCalls} · instancji stocznia ${B.yard.scene.instances}, hangar ${B.hangar.scene.instances}`,
    `<b>czas</b> ${state.T.toFixed(1)} s (${state.paused ? 'pauza' : state.speed + '×'})   <b>zoom</b> ${state.cam.zoom.toFixed(3)}`,
    `<b>stocznia</b> ${slipText(0)}`,
    `         ${slipText(1)}`,
    `<b>rój</b> w pracy ${sw.stats.active}/${sw.droneCount} · niesie ${sw.carriedCount} · kontenerów ${sw.crateCount} · dźwigi ${sw.cranes.map((c) => (c.carrying ? 'blok' : '—')).join(' / ')}`,
    `<b>piasta</b> ${L.yard.hub.kind === 'radial' ? 'okrąg z wypustkami' : 'litera U'} · placów ${L.pads.length} · zajęte ${parkedPads} + Atlas (refit)`,
    `<b>Z5</b> drony ${CargoDrones3D.stats.drones} · światła ${CargoDrones3D.stats.lights} · kontenery ${CargoContainers3D.count ?? '?'}`,
    `<b>hangar</b> ${hangarLayout.capacity.total} miejsc · kolejka ${HANGAR.queue.length}`,
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
  if (key === 4) return `${L.pads.length} placów (capital / nosiciel / L / M) · okręty po produkcji czekają na przydział · Atlas: refit dronami ze składu`;
  if (key === 5) return `kolejka ${HANGAR.queue.length} · brama IN ${state.T >= HANGAR.gateBusyUntil ? 'zielona' : 'czerwona'} · statek znika pod dachem`;
  if (key === 6) return hangarLayout.drums.map((d) => `${d.id.split('-').pop()}: ${d.slots} × ${d.levels}`).join(' · ') + ` · windy ${hangarLayout.heavy ? hangarLayout.heavy.capacity : 0}`;
  if (key === 7) return 'ten sam trzon i pochylnie; piasta i styl z profilu frakcji: K-7 okrąg / Mars U, sklepienia / Jowisz U, radiatory';
  if (key === 8) return `${earthPlan.zones.length} stref (cywilne ciepłe, wojskowe czerwone) · ${buoySet.count} boi`;
  if (key === 9) return 'przeciąganie = orbita, kółko = odległość';
  return `stocznia ${Math.round(L.yard.width)} × ${Math.round(L.yard.depth)} j. · hangar ${Math.round(2 * hangarLayout.halfWidth)} × ${Math.round(hangarLayout.depth)} j., ${hangarLayout.capacity.total} miejsc`;
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
  // Kompilacja shaderów budowli w trybie światła ringu (PB_LIGHT_HALO) na
  // uniformach ringu Ziemi — bez rysowania ringu (wpięcie w ring po uzgodnieniu).
  checkHaloShaders() {
    const before = errors.length;
    const layout = createHaloRingLayout({});
    const uniforms = createHaloUniforms(layout);
    const frame = portRingModuleFrame(layout, 0.5);
    const yard = new PortShipyard3D({ layout: createShipyardLayout({ id: 'HALO-TEST' }), style: 'earth', frame, light: 'halo', haloUniforms: uniforms });
    const yardU = new PortShipyard3D({ layout: createShipyardLayout({ id: 'HALO-U', hub: 'u' }), style: 'mars', frame, light: 'halo', haloUniforms: uniforms });
    const hangar = new PortHangar3D({ layout: createHangarLayout({ id: 'HALO-H', capacity: 120 }), style: 'jupiter', frame, light: 'halo', haloUniforms: uniforms });
    const g = new THREE.Group();
    g.add(yard.root, yardU.root, hangar.root);
    yard.update(0, { slips: STYLE_SLIPS });
    yardU.update(0, { slips: STYLE_SLIPS });
    hangar.update(0, {});
    for (const b of [yard, yardU, hangar]) b.setLayers(LAYER_BG, LAYER_FG);
    Core3D.scene.add(g);
    Core3D.renderer.compile(Core3D.scene, Core3D.cameraPersp);
    Core3D.scene.remove(g);
    const programs = [yard, yardU, hangar].flatMap((b) => b.materials.map((m) => m.name));
    yard.dispose();
    yardU.dispose();
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
  // krok budowli i roju bez ruchu dema (czas roju idzie, pochylnie stoją)
  advance(seconds, step = 1 / 30) {
    const n = Math.round(seconds / step);
    for (let i = 0; i < n; i++) render(step, step);
    updateHud();
  },
  stats() {
    return {
      ...lastInfo,
      proxies: { ...ShipProxyBatch3D.stats },
      buoys: { ...buoysRef.current.stats },
      queue: HANGAR.queue.length,
      swarm: { ...B.yard.swarm.stats },
      cargo: { drones: CargoDrones3D.stats.drones, lights: CargoDrones3D.stats.lights },
      yardShips: YARD.ships.map((s) => `${s.hullId}:${s.phase}`),
      modules: allModules().map((b) => ({ name: b.root.name, drawCalls: b.drawCalls, instances: b.scene.instances })),
      errors: errors.slice()
    };
  },
  cine(az, el, dist) { setCine(); if (Number.isFinite(az)) cine.az = az; if (Number.isFinite(el)) cine.el = el; if (Number.isFinite(dist)) cine.dist = dist; },
  center(x, y, zoom) { setGame({ x, y }, zoom); },
  hub(frameKey, x, z, zoom) { setGame(hubCenter(PLACE[frameKey], x, z), zoom); },
  B, L, hangarLayout, hangarTraffic, earthPlan, hangarState: HANGAR, yardState: YARD
};

// ---------------------------------------------------------------------------
// Start
buildModules();
makeBuoys(state.styleKey);
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
