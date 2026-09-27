// dema/rakiety-webgpu.js — demo NOWYCH EFEKTÓW RAKIET na WebGPU + TSL.
//
// Rakieta manewrująca (missile_rack), szybka (fast_missile_rack) i specjalna
// Supernowa (supernova_missile) — lot z logiki gry (flight.js, parametry
// z src/data/weapons.js), a efekty od nowa, tak jak pozwala WebGPU:
//   • dym i żar spalin na GPU (compute, 2¹⁹ cząstek): porcje gazu z nośnikiem,
//     turbulencja z pola wirowego, fale wybuchów i ślady rakiet w starym
//     dymie, oświetlenie każdej cząstki słońcem z SAMOCIENIEM (mapa gęstości)
//     i wszystkimi światłami siatki (dysze, błyski, reflektory), cień dymu na
//     kadłubach (smoke.js);
//   • płomienie dysz z dyskami Macha / plazma supernowej (plumes.js);
//   • kule ognia jako objętość (fireballs.js), iskry w wyglądzie iskier broni
//     gry (sparks.js), płonące odłamki z własnymi smugami, przypalenia;
//   • supernowa: implozja → błysk z linią anamorficzną → fala (sama
//     refrakcja) → pozostałość ze 110 tys. cząstek generowanych na GPU
//     (nebula.js), łuki wyładowań w śladzie (arcs.js);
//   • post: refrakcja (post.js) → bloom gry (bloomConfig.js) → ACES gry.
//
// Konwencja sceny jak w grze: świat (x, y) → scena (x − O.x, −(y − O.y), z),
// kamera ortho z góry, z ku kamerze. O = stały początek w środku areny (świat
// przy ~6,7 mln j.; wszystko na GPU względem O — reguła precyzji z agents.md).
//
// Konsola: window.__demo (scenario, step, pause, slow, fire, stats, setZoom).

import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ATLAS_EDITOR_DEFAULTS } from '../src/data/atlasHardpointDefaults.js';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';
import { BLOOM_DEFAULTS } from '../src/3d/bloomConfig.js';
import atlasUrl from '../assets/capital_ship_rect_v1.png';
import carrierUrl from '../src/assets/ships/terrancarrier.png';
import pirateBattleshipUrl from '../src/assets/ships/piratebattleship.png';
import pirateDestroyerUrl from '../src/assets/ships/piratedestroyer.png';
import pirateFrigateUrl from '../src/assets/ships/piratefrigate.png';
import { GlowSprites, Sky } from './rakiety-webgpu/common.js';
import { LightGrid, GridLighting, addShipLights } from './rakiety-webgpu/lights.js';
import { DemoHull, createHullShared } from './rakiety-webgpu/hulls.js';
import { createCurlTexture, createNoise3DTexture, createNoise2DTexture } from './rakiety-webgpu/noiseTex.js';
import { SmokeSystem } from './rakiety-webgpu/smoke.js';
import { SparkSystem } from './rakiety-webgpu/sparks.js';
import { PlumeSystem } from './rakiety-webgpu/plumes.js';
import { FireballSystem } from './rakiety-webgpu/fireballs.js';
import { NebulaSystem } from './rakiety-webgpu/nebula.js';
import { ArcSystem } from './rakiety-webgpu/arcs.js';
import { MissileBodies } from './rakiety-webgpu/missileBodies.js';
import { PostFx } from './rakiety-webgpu/post.js';
import { Effects } from './rakiety-webgpu/effects.js';
import { MissileFlight } from './rakiety-webgpu/flight.js';
import { MISSILE_VFX } from './rakiety-webgpu/palette.js';

const params = new URLSearchParams(location.search);
if (params.get('shot') === '1') document.body.classList.add('shot');
const $ = (id) => document.getElementById(id);
const errorsEl = $('errors');
function reportError(text) {
  errorsEl.style.display = 'block';
  errorsEl.textContent += `${text}\n`;
  console.error(text);
}
addEventListener('error', (e) => reportError(`JS: ${e.message} @ ${e.filename}:${e.lineno}`));
addEventListener('unhandledrejection', (e) => reportError(`Promise: ${e.reason?.stack || e.reason}`));

// Słońce w środku świata gry; arena w prawym dolnym kwadrancie od niego, więc
// światło pada z lewej-góry ekranu (cienie dymu w prawo-dół).
const SUN = Object.freeze({ x: 6000000, y: 6000000 });
const O = Object.freeze({ x: 6700000, y: 6600000 });
const SUN_ELEV_DEG = 30;
const SUN_COLOR = [1.0, 0.95, 0.88];
const SUN_INTENSITY = 1.9;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 3.2;
const SHADOW_LEN = 240;

// ---------------------------------------------------------------------------
// Stan

const S = {
  cam: { x: O.x - 150, y: O.y - 120, zoom: 0.34 },
  camTarget: { x: O.x - 150, y: O.y - 120, zoom: 0.34 },
  manualZoom: false,
  time: 0,
  frame: 0,
  fps: 60,
  cpuMs: 0,
  gpuRenderMs: 0,
  gpuComputeMs: 0,
  paused: false,
  timeScale: 1,
  slow: false,
  loop: true,
  keys: new Set(),
  mouse: { x: 0, y: 0 },
  hideUi: false,
  moveAtlas: false,
  sunOn: true,
  bloomOn: true,
  ready: false
};

let W = innerWidth;
let H = innerHeight;

// ---------------------------------------------------------------------------
// Renderer, scena, kamera

let renderer = null;
let pipeline = null;
let timestampsWanted = false;
let timestampsOn = false;
let stepping = false;
const scene = new THREE.Scene();
scene.name = 'rakiety';
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 80000);
const sunLight = new THREE.DirectionalLight(0xffffff, SUN_INTENSITY);
sunLight.color.setRGB(...SUN_COLOR, THREE.LinearSRGBColorSpace);
scene.add(sunLight);
scene.add(sunLight.target);

const grid = new LightGrid();
const hullShared = createHullShared();
const post = new PostFx();
let sky = null;
let glow = null;
let smoke = null;
let sparks = null;
let plumes = null;
let fireballs = null;
let nebula = null;
let arcs = null;
let bodies = null;
let fx = null;
let flight = null;

const hulls = { atlas: null, escort: null, pirates: [] };
const targets = [];

async function initRenderer() {
  if (!navigator.gpu) throw new Error('Ta przeglądarka nie udostępnia WebGPU (navigator.gpu). Potrzebny Chrome/Edge z WebGPU i kontekst bezpieczny (localhost).');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('Brak adaptera WebGPU (requestAdapter zwrócił null).');
  const requiredLimits = {};
  const want = { maxInterStageShaderVariables: 28, maxStorageBuffersPerShaderStage: 10 };
  for (const [k, v] of Object.entries(want)) if (adapter.limits[k] >= v) requiredLimits[k] = v;
  renderer = new THREE.WebGPURenderer({ antialias: false, alpha: false, trackTimestamp: true, requiredLimits });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.lighting = new GridLighting(grid);
  $('root').appendChild(renderer.domElement);
  renderer.domElement.tabIndex = 0;
  await renderer.init();
  renderer.highPrecision = true;
  // Znaczniki czasu GPU włączane dopiero po rozgrzewce (frame 90): przy starcie
  // kompilacja wstrzymuje odczyty, a pula (1024 pary) zdążyłaby się zapełnić.
  timestampsWanted = !!renderer.backend.trackTimestamp;
  renderer.backend.trackTimestamp = false;
  if (!renderer.backend?.isWebGPUBackend) throw new Error('WebGPURenderer uruchomił się na zapasowym backendzie WebGL — demo wymaga WebGPU.');
}

function buildPipeline() {
  pipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera, { samples: 4 });
  const tex = scenePass.getTextureNode('output');
  pipeline.outputNode = post.buildOutput(tex, (n) => bloom(n, BLOOM_DEFAULTS.strength, BLOOM_DEFAULTS.radius, BLOOM_DEFAULTS.threshold));
  pipeline.outputColorTransform = true;
}

function resize() {
  W = innerWidth;
  H = innerHeight;
  renderer?.setSize(W, H);
}
addEventListener('resize', resize);

const sx = (x) => x - O.x;
const sy = (y) => -(y - O.y);

const _shake = { x: 0, y: 0 };
/**
 * Kamera w czasie SYMULACJI (dt = 0 w pauzie): w zwolnieniu zwalnia razem
 * z akcją, w pauzie stoi (cel ma wyprzedzenie prędkością — w czasie
 * rzeczywistym kamera odjeżdżałaby od zatrzymanej rakiety).
 */
function updateCamera(dt) {
  const t = S.camTarget;
  // Kamera jedzie z flotą (bez tego sprężyna zostawałaby w tyle o v/k).
  if (S.moveAtlas) { S.cam.x += fleetVx() * dt; S.cam.y += fleetVy() * dt; }
  const k = 1 - Math.exp(-CAM_K * dt);
  S.cam.x += (t.x - S.cam.x) * k;
  S.cam.y += (t.y - S.cam.y) * k;
  if (!S.manualZoom) {
    const lz = Math.log(S.cam.zoom);
    const lt = Math.log(t.zoom);
    S.cam.zoom = Math.exp(lz + (lt - lz) * (1 - Math.exp(-2.4 * dt)));
  }
  // Wstrząs: gładki szum w px ekranu (czas symulacji — w pauzie stoi).
  const mag = fx ? fx.shake : 0;
  const tt = S.time;
  _shake.x = (Math.sin(tt * 47.3) * 0.6 + Math.sin(tt * 91.7 + 1.3) * 0.4) * mag;
  _shake.y = (Math.sin(tt * 53.1 + 2.1) * 0.6 + Math.sin(tt * 83.9 + 0.7) * 0.4) * mag;
  const zoom = S.cam.zoom;
  const shift = S.hideUi ? 0 : PANEL_SHIFT_PX;
  const cx = sx(S.cam.x) + (_shake.x + shift) / zoom;
  const cy = sy(S.cam.y) + _shake.y / zoom;
  const hw = W * 0.5 / zoom;
  const hh = H * 0.5 / zoom;
  camera.left = -hw; camera.right = hw; camera.top = hh; camera.bottom = -hh;
  camera.position.set(cx, cy, 30000);
  camera.near = 1;
  camera.far = 60000;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return { cx, cy, hw, hh };
}

// Kierunek DO słońca (scena), podniesiony o kąt nad płaszczyzną.
const sunDir = new THREE.Vector3();
function updateSun() {
  const dx = SUN.x - S.cam.x;
  const dy = -(SUN.y - S.cam.y);
  const l = Math.hypot(dx, dy) || 1;
  const e = SUN_ELEV_DEG * Math.PI / 180;
  sunDir.set(dx / l * Math.cos(e), dy / l * Math.cos(e), Math.sin(e)).normalize();
  const cx = sx(S.cam.x);
  const cy = sy(S.cam.y);
  sunLight.target.position.set(cx, cy, 0);
  sunLight.position.set(cx + sunDir.x * 1000, cy + sunDir.y * 1000, sunDir.z * 1000);
  sunLight.target.updateMatrixWorld(true);
  sunLight.updateMatrixWorld(true);
  sunLight.intensity = S.sunOn ? SUN_INTENSITY : 0;
  for (const sys of [smoke, fireballs]) {
    if (!sys) continue;
    sys.U.sunDir.value.copy(sunDir);
    sys.U.sunGain.value = S.sunOn ? 0.5 : 0;
  }
}

// ---------------------------------------------------------------------------
// Okręty: Atlas (wyrzutnie), eskorta, piraci (cele)

const HOME = {
  atlas: { x: -1950, y: 250, a: 0 },
  escort: { x: -2450, y: -1300, a: 0 },
  battleship: { x: 1950, y: -150, a: Math.PI },
  destroyerA: { x: 1300, y: 950, a: Math.PI + 0.2 },
  destroyerB: { x: 1550, y: -1250, a: Math.PI - 0.15 },
  frigates: [
    { x: 700, y: 250, a: Math.PI + 0.3 },
    { x: 950, y: -550, a: Math.PI - 0.2 },
    { x: 500, y: 1250, a: Math.PI + 0.5 },
    { x: 750, y: -1050, a: Math.PI - 0.4 }
  ]
};

// BITWA W RUCHU: cała flota (Atlas, eskorta, piraci) leci wspólnie z prędkością
// FLEET_V, kamera za nią. Rakiety, dym i wybuchy dziedziczą 100% pędu nośnika
// (reguła gry, src/game/carrierVelocity.js) — poprawny port wygląda wtedy
// dokładnie jak bitwa stojąca; każdy błąd to smugi „zostające w tyle”.
const FLEET_V = Object.freeze({ x: 0, y: -700 });
const fleet = { x: 0, y: 0 };
const fleetVx = () => (S.moveAtlas ? FLEET_V.x : 0);
const fleetVy = () => (S.moveAtlas ? FLEET_V.y : 0);

function place(hull, home, time, weave = 0) {
  const wx = O.x + home.x + fleet.x;
  const wy = O.y + home.y + fleet.y;
  // Dryf i uniki (fregaty) — cele w ruchu sprawdzają wyprzedzenie rakiet.
  const w = weave ? Math.sin(time * 0.9 + home.x * 0.001) * weave : 0;
  const vw = weave ? Math.cos(time * 0.9 + home.x * 0.001) * weave * 0.9 : 0;
  const c = Math.cos(home.a);
  const s = Math.sin(home.a);
  const x = wx - s * w + c * Math.sin(time * 0.2) * 40;
  const y = wy + c * w + s * Math.sin(time * 0.2) * 40;
  hull.setPose(x, y, home.a + Math.sin(time * 0.5 + home.y) * 0.03,
    -s * vw + c * Math.cos(time * 0.2) * 8 + fleetVx(), c * vw + s * Math.cos(time * 0.2) * 8 + fleetVy(), 0);
  hull.thrust = S.moveAtlas ? 0.9 : 0.25;
}

const atlasState = { x: O.x + HOME.atlas.x, y: O.y + HOME.atlas.y, a: 0, vx: 0, vy: 0, orbit: 0 };
// Panel po prawej zasłania ~360 px: środek kadru przesunięty w lewo o połowę.
const PANEL_SHIFT_PX = 180;
// Sztywność sprężyny pozycji kamery [1/s].
const CAM_K = 3.2;
function stepAtlas(dt) {
  const st = atlasState;
  const k = S.keys;
  {
    // Ruch własny Atlasa (W/S/A/D) w układzie floty.
    const fwd = k.has('w') ? 1 : 0;
    const back = k.has('s') ? 1 : 0;
    const turn = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0);
    st.a += turn * 0.6 * dt;
    st.vx += Math.cos(st.a) * (fwd - back * 0.6) * 700 * dt;
    st.vy += Math.sin(st.a) * (fwd - back * 0.6) * 700 * dt;
    const drag = Math.exp(-0.6 * dt);
    st.vx *= drag; st.vy *= drag;
    st.x += st.vx * dt;
    st.y += st.vy * dt;
  }
  if (hulls.atlas) {
    hulls.atlas.setPose(st.x + fleet.x, st.y + fleet.y, st.a, st.vx + fleetVx(), st.vy + fleetVy(), 0);
    hulls.atlas.thrust = S.moveAtlas || k.has('w') ? 1 : 0.15;
  }
}

function stepFleet(time, dt) {
  fleet.x += fleetVx() * dt;
  fleet.y += fleetVy() * dt;
  stepAtlas(dt);
  if (hulls.escort) place(hulls.escort, HOME.escort, time);
  const P = hulls.pirates;
  if (P[0]) place(P[0], HOME.battleship, time);
  if (P[1]) place(P[1], HOME.destroyerA, time, 140);
  if (P[2]) place(P[2], HOME.destroyerB, time, 120);
  for (let i = 0; i < 4; i++) if (P[3 + i]) place(P[3 + i], HOME.frigates[i], time, 380);
  for (const h of allHulls()) h.syncMesh(O.x, O.y);
}

function allHulls() {
  const list = [];
  if (hulls.atlas) list.push(hulls.atlas);
  if (hulls.escort) list.push(hulls.escort);
  for (const p of hulls.pirates) list.push(p);
  return list;
}

// Cel rakiety = kadłub (radius, prędkość, zapalnik kontaktowy) albo punkt.
function hullTarget(h) {
  if (!h._target) {
    h._target = {
      get x() { return h.x; }, get y() { return h.y; }, get vx() { return h.vx; }, get vy() { return h.vy; },
      radius: h.radius, dead: false, hull: h
    };
  }
  return h._target;
}

// ---------------------------------------------------------------------------
// Odpalanie

const _mp = { x: 0, y: 0 };
let mountTick = 0;
/** Wyrzutnia: gniazdo rakiet Atlasa (special = gniazdo supernowej). */
function atlasMount(special) {
  const a = hulls.atlas;
  const mounts = a.missileMounts.filter((m) => !!m.special === !!special);
  const m = mounts.length ? mounts[mountTick++ % mounts.length] : { x: 0, y: 0 };
  a.localToWorld(m.x, m.y, _mp);
  return { x: _mp.x, y: _mp.y };
}

function fire(kind, target, opts = {}) {
  if (!hulls.atlas || !flight) return null;
  const vfx = MISSILE_VFX[kind];
  let from = opts.from;
  if (!from) from = atlasMount(kind === 'supernova');
  const src = opts.launcher || hulls.atlas;
  const tgt = target && target.isHull ? hullTarget(target.hull) : target;
  const m = flight.fire(kind, vfx.weaponId, from.x, from.y, tgt, {
    frameVx: src.vx || 0, frameVy: src.vy || 0, heading: src.angle, headingOffset: opts.headingOffset
  });
  if (opts.inFlight && m) {
    // Wlot w kadr: rakieta już leci (bez wyrzutu i zapłonu).
    m.state = 'POWERED';
    m.phase = 'intercept';
    m.t = Math.max(m.p.homingDelay, 0.4);
    m.speed = m.p.desiredSpeed * 0.85;
    m.vx = Math.cos(m.heading) * m.speed;
    m.vy = Math.sin(m.heading) * m.speed;
    m.vz = 0;
    m.throttle = 0.6;
    m.travel = 400;
    fx.onIgnite(m);
  }
  return m;
}

function hullAt(wx, wy, pad = 30) {
  let best = null;
  let bd = pad;
  for (const h of hulls.pirates) {
    const d = h.sdfAt(wx, wy);
    if (d < bd) { bd = d; best = h; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Scenariusze pokazu (czas symulacji — w zwolnieniu wszystko zwalnia razem)

const pirate = (i) => hulls.pirates[i];
const asTarget = (h) => ({ isHull: true, hull: h });

const SCENARIOS = {
  salwa: {
    label: 'Salwa rakiet manewrujących — dym oświetlony dyszami, samocień chmur, kule ognia, płonące odłamki',
    duration: 8.5, zoom: 0.3, cam: { x: -300, y: -100 },
    start(sc) {
      for (let i = 0; i < 12; i++) sc.at(0.25 + i * 0.14, () => fire('cruise', asTarget(pirate([0, 1, 2][i % 3]))));
    }
  },
  szybkie: {
    label: 'Szybkie rakiety — rój na fregaty w unikach (wyprzedzenie celu jak w grze)',
    duration: 6.5, zoom: 0.42, cam: { x: -550, y: 100 },
    start(sc) {
      for (let i = 0; i < 16; i++) sc.at(0.2 + i * 0.085, () => fire('fast', asTarget(pirate(3 + (i % 4)))));
    }
  },
  supernowa: {
    label: 'Supernowa — plazma i dym chemiczny, łuki wyładowań, implozja → błysk → fala → pozostałość',
    duration: 8.8, zoom: 0.5, follow: true, zoomAfter: 0.22,
    start(sc) {
      sc.at(0.3, () => { sc.missile = fire('supernova', asTarget(pirate(0))); });
    }
  },
  deszcz: {
    label: 'Deszcz rakiet — 96 rakiet w łukach (tryb kinowy: skręt 240°/s), wszystkie smugi w jednej puli GPU',
    duration: 11, zoom: 0.3, cam: { x: -250, y: -100 }, cinematic: true,
    start(sc) {
      for (let i = 0; i < 96; i++) {
        const t = 0.2 + i * 0.032;
        sc.at(t, () => {
          const fromEscort = i % 3 === 2 && hulls.escort;
          const launcher = fromEscort ? hulls.escort : hulls.atlas;
          const along = (Math.random() - 0.5) * launcher.length * 0.6;
          const from = launcher.localToWorld(along, (Math.random() - 0.5) * 60, { x: 0, y: 0 });
          fire(i % 4 === 3 ? 'fast' : 'cruise', asTarget(pirate(i % hulls.pirates.length)), { from, launcher });
        });
      }
    }
  },
  zblizenie: {
    label: 'Zbliżenie trafienia (×0,3) — dyski Macha, żar spalin, kontakt z poszyciem, przypalenie',
    duration: 3.6, zoom: 1.35, timeScale: 0.3, focus: () => pirate(1),
    start(sc) {
      for (let i = 0; i < 3; i++) {
        sc.at(0.1 + i * 0.28, () => {
          const h = pirate(1);
          const a = Math.PI + 0.25 * (i - 1);
          const from = { x: h.x + Math.cos(a) * 1300, y: h.y + Math.sin(a) * 1300 - 150 };
          fire('cruise', asTarget(h), { from, inFlight: true });
        });
      }
    }
  },
  poscig: {
    label: 'Za rakietą — kamera jedzie za rakietą manewrującą: dyski Macha, żar spalin, smuga rośnie i kłębi się',
    duration: 5.2, zoom: 1.6, follow: true, zoomAfter: 0.75,
    start(sc) {
      sc.at(0.2, () => { sc.missile = fire('cruise', asTarget(pirate(0))); });
      sc.at(0.6, () => fire('cruise', asTarget(pirate(1))));
      sc.at(0.9, () => fire('cruise', asTarget(pirate(2))));
    }
  },
  novaZoom: {
    label: 'Supernowa z bliska (×0,4) — implozja wsysa dym, fala go wymiata, włókna pozostałości',
    duration: 5.4, zoom: 0.55, zoomAfter: 0.3, timeScale: 0.4, focus: () => pirate(0),
    start(sc) {
      // Stary dym wokół celu: kilka rakiet chwilę wcześniej.
      for (let i = 0; i < 6; i++) {
        sc.at(0.05 + i * 0.05, () => {
          const h = pirate(0);
          const a = Math.PI * 0.5 + (i - 2.5) * 0.35;
          fire('cruise', { x: h.x + Math.cos(a) * 700, y: h.y + Math.sin(a) * 700, point: true },
            { from: { x: h.x - 1500, y: h.y + (i - 2.5) * 260 }, inFlight: true });
        });
      }
      sc.at(0.9, () => {
        const h = pirate(0);
        sc.missile = fire('supernova', asTarget(h), { from: { x: h.x - 1900, y: h.y - 420 }, inFlight: true });
      });
    }
  }
};
const ORDER = ['salwa', 'szybkie', 'supernowa', 'deszcz', 'zblizenie', 'novaZoom', 'poscig'];

const scen = {
  name: null,
  def: null,
  t: 0,
  queue: [],
  missile: null,
  lastNova: null,
  at(t, fn) { this.queue.push({ t, fn }); }
};

function startScenario(name) {
  const def = SCENARIOS[name];
  if (!def) return;
  scen.name = name;
  scen.def = def;
  scen.t = 0;
  scen.queue = [];
  scen.missile = null;
  scen.lastNova = null;
  S.manualZoom = false;
  S.timeScale = def.timeScale ?? (S.slow ? 0.25 : Number($('s-time').value));
  flight.cinematic = def.cinematic || $('t-cine').checked ? { turnRateDeg: 240, spreadDeg: 70 } : null;
  S.camTarget.zoom = def.zoom;
  // Daleko odjechana flota (tryb „bitwa w ruchu”): powrót układu do O przy
  // zmianie scenariusza (precyzja float32 przy setkach tysięcy j.).
  if (Math.hypot(fleet.x, fleet.y) > 60000) { clearAll(); fleet.x = 0; fleet.y = 0; }
  scen.cam = def.cam || null;
  if (def.cam) { S.camTarget.x = O.x + def.cam.x + fleet.x; S.camTarget.y = O.y + def.cam.y + fleet.y; }
  def.start(scen);
  $('caption').textContent = def.label;
  $('caption').style.opacity = '1';
  for (const b of document.querySelectorAll('[data-sc]')) b.classList.toggle('on', b.dataset.sc === name);
}

function stepScenario(dt) {
  const def = scen.def;
  if (!def) return;
  scen.t += dt;
  for (let i = 0; i < scen.queue.length; i++) {
    const q = scen.queue[i];
    if (q.t <= scen.t) {
      scen.queue.splice(i--, 1);
      try { q.fn(); } catch (err) { reportError(err.stack || String(err)); }
    }
  }
  // Kamera: śledzenie supernowej i odjazd po wybuchu.
  if (def.follow && scen.missile) {
    if (scen.missile.alive) {
      // Wyprzedzenie ~250 px ekranu przed rakietą (przy każdym zoomie).
      // + prędkość / sztywność sprężyny kamery: bez tego kamera zostaje
      // za rakietą o v/k (przy 1800 j./s to ~560 j.).
      const m = scen.missile;
      const lead = Math.min(500, 250 / S.cam.zoom);
      S.camTarget.x = m.x + Math.cos(m.heading) * lead + (m.vx + m.fx) / CAM_K;
      S.camTarget.y = m.y + Math.sin(m.heading) * lead + (m.vy + m.fy) / CAM_K;
    } else {
      if (!scen.lastNova) scen.lastNova = { x: scen.missile.x, y: scen.missile.y, t: scen.t };
      S.camTarget.x = scen.lastNova.x;
      S.camTarget.y = scen.lastNova.y;
      if (scen.t - scen.lastNova.t > 0.6) S.camTarget.zoom = def.zoomAfter || def.zoom;
    }
  } else if (def.focus) {
    const h = def.focus();
    if (h) {
      S.camTarget.x = h.x - 250;
      S.camTarget.y = h.y;
    }
    if (def.zoomAfter && scen.missile && !scen.missile.alive) {
      if (!scen.lastNova) scen.lastNova = { x: scen.missile.x, y: scen.missile.y, t: scen.t };
      if (scen.t - scen.lastNova.t > 0.6) S.camTarget.zoom = def.zoomAfter;
    }
  }
  if (scen.cam && !def.follow && !def.focus) {
    S.camTarget.x = O.x + scen.cam.x + fleet.x;
    S.camTarget.y = O.y + scen.cam.y + fleet.y;
  }
  if (scen.t > def.duration && S.loop) {
    const i = ORDER.indexOf(scen.name);
    startScenario(ORDER[(i + 1) % ORDER.length]);
  }
}

// ---------------------------------------------------------------------------
// Klatka

let lastT = 0;
function frame(nowMs, forcedDt = null) {
  const t0 = performance.now();
  const realDt = forcedDt ?? Math.min(0.05, Math.max(0, (nowMs - (lastT || nowMs)) / 1000));
  lastT = nowMs;
  S.frame++;
  if (realDt > 0 && forcedDt === null) S.fps = S.fps * 0.94 + (1 / realDt) * 0.06;
  // step() z konsoli (forcedDt) przesuwa symulację także w pauzie.
  const dt = forcedDt !== null ? forcedDt * S.timeScale : (S.paused ? 0 : realDt * S.timeScale);
  S.time += dt;
  const time = S.time;

  if (dt > 0) {
    stepScenario(dt);
    stepFleet(time, dt);
    flight.update(dt);
    fx.update(dt, time);
  } else {
    for (const h of allHulls()) h.syncMesh(O.x, O.y);
  }
  const view = updateCamera(dt);
  updateSun();

  // Światła siatki: statki + efekty.
  grid.begin();
  if (hulls.atlas) addShipLights(grid, hulls.atlas.entity, hulls.atlas.length, O.x, O.y, { time, owner: 1 });
  if (hulls.escort) addShipLights(grid, hulls.escort.entity, hulls.escort.length, O.x, O.y, { time, owner: 2, floods: false, strength: 0.7 });
  hulls.pirates.forEach((p, i) => addShipLights(grid, p.entity, p.length, O.x, O.y, { time, owner: 10 + i, floods: false, strength: 0.45 }));
  fx.addLights(grid, flight.list, time);
  const mx = view.hw * 1.35 + 700;
  const my = view.hh * 1.35 + 700;
  grid.build(view.cx - mx, view.cy - my, view.cx + mx, view.cy + my);

  // Dym: siły, krok, emisja, mapa gęstości, światło.
  if (dt > 0) {
    fx.fillForces(smoke, flight.list, time, S.cam.x, S.cam.y);
    smoke.step(dt, time);
  }
  smoke.emit(time);
  const dx = view.hw * 1.3 + SHADOW_LEN;
  const dy = view.hh * 1.3 + SHADOW_LEN;
  smoke.renderDensity(view.cx - dx, view.cy - dy, view.cx + dx, view.cy + dy, sunDir, SHADOW_LEN);
  smoke.light(view.cx - view.hw * 1.1 - 400, view.cy - view.hh * 1.1 - 400, view.cx + view.hw * 1.1 + 400, view.cy + view.hh * 1.1 + 400);

  // Instancje na tę klatkę.
  bodies.begin();
  plumes.begin();
  fx.addMissiles(flight.list, time);
  bodies.commit();
  plumes.commit(time, S.cam.zoom);
  glow.begin();
  for (const h of allHulls()) h.addGlows(glow, O.x, O.y, time);
  fx.addGlows(glow, flight.list, time);
  glow.commit();
  sparks.update(time, S.cam.zoom);
  arcs.update(time, S.cam.zoom);
  fireballs.update(time);
  nebula.update(time, S.cam.zoom);
  sky.u.offset.value.set(((S.cam.x * 0.002) % 7000 + 7000) % 7000, ((S.cam.y * 0.002) % 7000 + 7000) % 7000);

  post.begin();
  fx.fillDistortion(post, time);
  post.commit(view.cx, view.cy, S.cam.zoom, W, H, time);
  post.U.exposure.value = fx.exposure;
  if (post.bloomNode) post.bloomNode.strength.value = S.bloomOn ? BLOOM_DEFAULTS.strength + fx.bloomBoost : 0;

  pipeline.render();
  S.cpuMs = S.cpuMs * 0.9 + (performance.now() - t0) * 0.1;
  resolveGpuTimes();
  if (S.frame % 6 === 0) updateHud();
}

let gpuPending = false;
function resolveGpuTimes() {
  if (!renderer || stepping) return;
  if (!timestampsOn && timestampsWanted && S.frame >= 90) {
    timestampsOn = true;
    renderer.backend.trackTimestamp = true;
  }
  if (gpuPending || !timestampsOn) return;
  gpuPending = true;
  Promise.all([renderer.resolveTimestampsAsync('render'), renderer.resolveTimestampsAsync('compute')])
    .then(([r, c]) => {
      if (Number.isFinite(r)) S.gpuRenderMs = S.gpuRenderMs * 0.8 + r * 0.2;
      if (Number.isFinite(c)) S.gpuComputeMs = S.gpuComputeMs * 0.8 + c * 0.2;
    })
    .catch(() => {})
    .finally(() => { gpuPending = false; });
}

// ---------------------------------------------------------------------------
// HUD

function fmt(n) { return Math.round(n).toLocaleString('pl-PL'); }
function f2(v) { return v.toFixed(2).replace('.', ','); }

function collectStats() {
  const info = renderer.info;
  return {
    fps: +S.fps.toFixed(1),
    cpuMs: +S.cpuMs.toFixed(2),
    gpuRenderMs: +S.gpuRenderMs.toFixed(2),
    gpuComputeMs: +S.gpuComputeMs.toFixed(2),
    drawCalls: info.render.drawCalls,
    triangles: info.render.triangles,
    computeCalls: info.compute.frameCalls,
    missiles: flight.count,
    smoke: smoke.highWater,
    smokeSpawned: smoke.stats.spawned,
    sparks: sparks.highWater,
    nebula: nebula.highWater,
    fireballs: fireballs.items.length,
    fragments: fx.stats.fragments,
    lights: grid.stats.lights,
    fxLights: fx.stats.lights,
    time: +S.time.toFixed(2),
    scenario: scen.name
  };
}

function updateHud() {
  if (S.hideUi) return;
  const st = collectStats();
  $('stats').innerHTML = [
    `<b>${st.fps.toFixed(0)} FPS</b> · CPU ${f2(st.cpuMs)} ms · GPU ${f2(st.gpuRenderMs + st.gpuComputeMs)} ms`,
    `GPU: render ${f2(st.gpuRenderMs)} ms · compute ${f2(st.gpuComputeMs)} ms`,
    `rakiety w locie ${fmt(st.missiles)} · kule ognia ${st.fireballs} · odłamki ${st.fragments}`,
    `dym: pula ${fmt(st.smoke)} / 524 288 · iskry ${fmt(st.sparks)}`,
    `mgławica ${fmt(st.nebula)} · światła ${fmt(st.lights)} (efekty ${st.fxLights})`,
    `draw calle ${fmt(st.drawCalls)} · compute ${fmt(st.computeCalls)} · trójkąty ${fmt(st.triangles / 1000)} tys.`
  ].join('\n');
  const lines = [];
  lines.push(`<b>RAKIETY WebGPU</b> · ${scen.def ? scen.name : '—'} · zoom ${S.cam.zoom.toFixed(2).replace('.', ',')}`);
  lines.push(`tempo ${f2(S.timeScale)}${S.paused ? ' · PAUZA' : ''}${S.loop ? ' · pętla' : ''} · czas ${S.time.toFixed(1).replace('.', ',')} s`);
  const zAtlas = hulls.atlas ? Math.hypot(hulls.atlas.vx, hulls.atlas.vy) : 0;
  lines.push(`Atlas ${fmt(zAtlas)} j./s${S.moveAtlas ? ' · bitwa w ruchu: rakiety, dym i wybuchy z pędem nośnika' : ''}`);
  $('hud').innerHTML = lines.join('\n');
}

// ---------------------------------------------------------------------------
// Wejście

function screenToWorld(px, py, out = { x: 0, y: 0 }) {
  out.x = S.cam.x + (px - W * 0.5 + (S.hideUi ? 0 : PANEL_SHIFT_PX)) / S.cam.zoom;
  out.y = S.cam.y + (py - H * 0.5) / S.cam.zoom;
  return out;
}

const click = (id) => { const c = $(id); c.checked = !c.checked; c.dispatchEvent(new Event('change')); };
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();
  S.keys.add(k);
  const n = Number(k);
  if (n >= 1 && n <= ORDER.length) startScenario(ORDER[n - 1]);
  if (k === ' ') { e.preventDefault(); setPause(!S.paused); }
  if (k === 't') setSlow(!S.slow);
  if (k === 'l') setLoop(!S.loop);
  if (k === 'c') clearAll();
  if (k === 'b') click('t-bloom');
  if (k === 'z') { S.manualZoom = true; S.cam.zoom = 1; }
  if (k === 'h') { S.hideUi = !S.hideUi; document.body.classList.toggle('shot', S.hideUi); }
});
addEventListener('keyup', (e) => S.keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => S.keys.clear());

function bindCanvasInput(canvas) {
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    S.manualZoom = true;
    S.cam.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, S.cam.zoom * Math.exp(-e.deltaY * 0.0015)));
  }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointermove', (e) => { S.mouse.x = e.clientX; S.mouse.y = e.clientY; });
  canvas.addEventListener('pointerdown', (e) => {
    canvas.focus();
    const p = screenToWorld(e.clientX, e.clientY);
    const h = hullAt(p.x, p.y);
    const target = h ? asTarget(h) : { x: p.x, y: p.y, point: true };
    if (e.button === 0) {
      const kind = e.shiftKey ? 'fast' : 'cruise';
      const n = e.shiftKey ? 6 : 4;
      for (let i = 0; i < n; i++) scen.at(scen.t + i * 0.12, () => fire(kind, target));
    }
    if (e.button === 2) fire('supernova', target);
  });
}

function setPause(v) { S.paused = v; $('b-pause').classList.toggle('on', v); }
function setSlow(v) {
  S.slow = v;
  $('b-slow').classList.toggle('on', v);
  S.timeScale = v ? 0.25 : Number($('s-time').value);
}
function setLoop(v) { S.loop = v; $('b-loop').classList.toggle('on', v); }
function clearAll() {
  flight.clear(false);
  fx.clear();
  fireballs.items.length = 0;
  smoke.highWater = 0; smoke.head = 0; smoke.spawnCount = 0;
}

function bindRange(id, outId, fmtFn, apply) {
  const el = $(id);
  const out = $(outId);
  const run = () => { const v = Number(el.value); out.textContent = fmtFn(v); apply(v); };
  el.addEventListener('input', run);
  run();
  return (v) => { el.value = String(v); run(); };
}

function bindControls() {
  const toggle = (id, fn) => { const el = $(id); el.addEventListener('change', () => fn(el.checked)); fn(el.checked); };
  toggle('t-lit', (v) => { smoke.U.litOn.value = v ? 1 : 0; });
  toggle('t-shadow', (v) => { smoke.U.shadowOn.value = v ? 1 : 0; });
  toggle('t-hullshadow', (v) => { hullShared.smokeShadow.value = v ? 1 : 0; });
  toggle('t-trails', (v) => { fx.opts.trails = v; });
  toggle('t-wakes', (v) => { fx.opts.wakes = v; });
  toggle('t-frag', (v) => { fx.opts.fragments = v; });
  toggle('t-distort', (v) => { post.U.on.value = v ? 1 : 0; });
  toggle('t-bloom', (v) => { S.bloomOn = v; });
  toggle('t-arcs', (v) => { fx.opts.arcs = v; arcs.mesh.visible = v; });
  toggle('t-cine', (v) => { flight.cinematic = v || scen.def?.cinematic ? { turnRateDeg: 240, spreadDeg: 70 } : null; });
  toggle('t-move', (v) => { S.moveAtlas = v; });
  toggle('t-sun', (v) => { S.sunOn = v; });
  bindRange('s-time', 'o-time', f2, (v) => { if (!S.slow && !scen.def?.timeScale) S.timeScale = v; });
  bindRange('s-dens', 'o-dens', f2, (v) => { fx.opts.trailDensity = v; });
  bindRange('s-opac', 'o-opac', f2, (v) => { smoke.U.opacityGain.value = v; });
  bindRange('s-turb', 'o-turb', f2, (v) => { smoke.U.turbGain.value = v; });
  bindRange('s-point', 'o-point', f2, (v) => { smoke.U.pointGain.value = v; });
  bindRange('s-emit', 'o-emit', f2, (v) => { smoke.U.emitGain.value = v; });
  bindRange('s-plume', 'o-plume', f2, (v) => { plumes.U.gain.value = v; });
  bindRange('s-blast', 'o-blast', f2, (v) => { fx.opts.blastGain = v; });
  for (const b of document.querySelectorAll('[data-sc]')) b.addEventListener('click', () => startScenario(b.dataset.sc));
  $('b-loop').addEventListener('click', () => setLoop(!S.loop));
  $('b-pause').addEventListener('click', () => setPause(!S.paused));
  $('b-slow').addEventListener('click', () => setSlow(!S.slow));
  $('b-clear').addEventListener('click', clearAll);
}

// ---------------------------------------------------------------------------
// Rozgrzewka potoków: jedna klatka przez RenderPipeline z włączonymi, pustymi
// warstwami efektów (klucz potoku zależy od celu passu — MSAA 4, HalfFloat —
// więc compileAsync na kanwie by nie wystarczył; obiekty niewidoczne compile
// pomija) i puste dispatche compute. Bez tego pierwszy wybuch i pierwsza
// supernowa kompilowały shadery w trakcie pokazu (skok ~40 ms).

function warmUp() {
  const meshes = [smoke.mesh, smoke.densityMesh, sparks.mesh, plumes.mesh, fireballs.mesh, nebula.mesh, arcs.mesh, bodies.mesh, glow.mesh];
  const saved = meshes.map((m) => ({ m, visible: m.visible, count: m.count, ic: m.geometry.instanceCount }));
  for (const m of meshes) {
    m.visible = true;
    if (m.count !== undefined) m.count = Math.max(2, m.count || 0);
    if (m.geometry.isInstancedBufferGeometry) m.geometry.instanceCount = Math.max(1, m.geometry.instanceCount || 0);
  }
  smoke.U.spawnCount.value = 0;
  smoke.U.count.value = 0;
  renderer.compute(smoke.emitNode, 1);
  renderer.compute(smoke.stepNode, 1);
  renderer.compute(smoke.lightNode, 1);
  nebula.U.count.value = 0;
  renderer.compute(nebula.initNode, 1);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(smoke.densityRT);
  renderer.render(smoke.densityScene, smoke.densityCam);
  renderer.setRenderTarget(prev);
  pipeline.render();
  for (const s of saved) {
    s.m.visible = s.visible;
    if (s.count !== undefined) s.m.count = s.count;
    if (s.m.geometry.isInstancedBufferGeometry) s.m.geometry.instanceCount = s.ic;
  }
}

// ---------------------------------------------------------------------------
// Start

async function start() {
  const loading = $('loading');
  await initRenderer();
  bindCanvasInput(renderer.domElement);
  loading.textContent = 'Pieczenie szumu (pole wirowe dymu, szum 3D)…';
  await new Promise((r) => setTimeout(r, 20));
  const curlTex = createCurlTexture(64);
  const noise3D = createNoise3DTexture(64);
  const noise2D = createNoise2DTexture(256);
  loading.textContent = 'Kadłuby…';
  sky = new Sky(scene);
  glow = new GlowSprites({ scene, capacity: 8192, renderOrder: 90 });
  const ed = SHIP_EDITOR_DEFAULTS.ships || {};
  const load = async (id, url, editor, owner) => {
    try { return await DemoHull.load({ id, url, editor, scene, shared: hullShared, owner }); } catch (err) { reportError(`${id}: ${err.stack || err}`); return null; }
  };
  hulls.atlas = await load('atlas', atlasUrl, ATLAS_EDITOR_DEFAULTS, 1);
  hulls.escort = await load('terran_carrier', carrierUrl, ed.terran_carrier || null, 2);
  const pirates = [
    ['pirate_battleship', pirateBattleshipUrl], ['pirate_destroyer', pirateDestroyerUrl], ['pirate_destroyer', pirateDestroyerUrl],
    ['pirate_frigate', pirateFrigateUrl], ['pirate_frigate', pirateFrigateUrl], ['pirate_frigate', pirateFrigateUrl], ['pirate_frigate', pirateFrigateUrl]
  ];
  let owner = 10;
  for (const [id, url] of pirates) {
    const h = await load(id, url, ed[id] || null, owner++);
    if (h) hulls.pirates.push(h);
  }
  for (const h of hulls.pirates) targets.push(hullTarget(h));
  loading.textContent = 'Systemy efektów (compute)…';
  smoke = new SmokeSystem({ renderer, scene, grid, curlTex, noise2D });
  hullShared.smoke = { tex: smoke.densityRT.texture, dRect: smoke.U.dRect, dStep: smoke.U.dStep, kappa: smoke.U.kappa };
  sparks = new SparkSystem({ scene });
  plumes = new PlumeSystem({ scene });
  fireballs = new FireballSystem({ scene, noise3D });
  nebula = new NebulaSystem({ renderer, scene, noise3D });
  arcs = new ArcSystem({ scene });
  bodies = new MissileBodies({ scene });
  fx = new Effects({ smoke, sparks, plumes, fireballs, nebula, arcs, glow, post, bodies, origin: O });
  flight = new MissileFlight({
    onLaunch: (m) => fx.onLaunch(m),
    onIgnite: (m) => fx.onIgnite(m),
    onFly: (m, dt, x0, y0) => fx.onFly(m, dt, x0, y0),
    onDetonate: (m, x, y, hull, nx, ny) => fx.onDetonate(m, x, y, hull, nx, ny)
  });
  stepFleet(0, 0);
  buildPipeline();
  bindControls();
  updateCamera(0);
  loading.textContent = 'Kompilacja shaderów…';
  await new Promise((r) => setTimeout(r, 20));
  warmUp();
  loading.style.display = 'none';
  S.ready = true;
  const first = params.get('scenario') || 'salwa';
  if (params.get('loop') === '0') setLoop(false);
  startScenario(SCENARIOS[first] ? first : 'salwa');
  if (params.has('zoom')) { S.manualZoom = true; S.cam.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(params.get('zoom')) || 1)); }
  window.__demo = {
    S, scen, fx, flight, smoke, sparks, nebula, fireballs, renderer, hulls,
    scenario: (name) => startScenario(name),
    step: (n = 1, dt = 1 / 60) => {
      // Krokowanie synchroniczne: bez znaczników czasu GPU (zapytania nie
      // zdążyłyby się rozwiązać — pula by się przepełniła).
      const b = renderer.backend;
      stepping = true;
      b.trackTimestamp = false;
      try { for (let i = 0; i < n; i++) frame(performance.now(), dt); } finally { stepping = false; b.trackTimestamp = timestampsOn; }
    },
    pause: (v = true) => setPause(!!v),
    slow: (v = true) => setSlow(!!v),
    loop: (v = true) => setLoop(!!v),
    fire: (kind = 'cruise', i = 0) => fire(kind, asTarget(hulls.pirates[i] || hulls.pirates[0])),
    setZoom: (z) => { S.manualZoom = true; S.cam.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(z) || 1)); },
    camTo: (x, y) => { S.camTarget.x = x; S.camTarget.y = y; S.cam.x = x; S.cam.y = y; },
    clear: clearAll,
    stats: () => collectStats()
  };
  renderer.setAnimationLoop((t) => {
    try { frame(t); } catch (err) { reportError(err.stack || String(err)); renderer.setAnimationLoop(null); }
  });
}

start().catch((err) => {
  $('loading').textContent = `Błąd: ${err.message || err}`;
  reportError(err.stack || String(err));
});
