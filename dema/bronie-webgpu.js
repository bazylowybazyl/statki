// dema/bronie-webgpu.js — demo WebGPU: działa, obrona punktowa i lasery z gry.
//
// Atlas (sprite gry, gniazda z ATLAS_EDITOR_DEFAULTS, wieżyczki z atlasów gry)
// strzela do pirackiego okrętu (i do dronów-celów przy broniach PD). Wszystko
// na WebGPURenderer + TSL:
//   • cząstki GPU (compute): paczki z CPU rozwijane w kernelu, pule: blask /
//     ogień / opary, iskry (odbicie od kadłubów), dym (oświetlany siatką świateł),
//     odłamki i łuski, łuki elektryczne, zniekształcenie powietrza;
//   • smugi pocisków w świecie (port SlugTrail), pociski i wiązki w shaderach;
//   • światła efektów w siatce świateł (lightGrid.js, kopia z dema asteroid) — błyski luf
//     i trafień oświetlają kadłuby, wieżyczki, dym i odłamki;
//   • rany na kadłubie celu: żar stygnący z bieli w czerwień, osmalenia,
//     przestrzeliny (compute na mapie uszkodzeń);
//   • post: zniekształcenie z aberracją (fale = sama refrakcja), bloom z
//     bloomConfig.js, ACES gry, sRGB.
//
// Konsola: window.__demo (select, setCam, setTime, fire, step, stats).

import * as THREE from 'three/webgpu';
import { pass, float, vec2, vec3, vec4, uniform, screenUV, screenSize } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { BLOOM_DEFAULTS } from '../src/3d/bloomConfig.js';
import atlasUrl from '../assets/capital_ship_rect_v1.png';
import targetUrl from '../src/assets/ships/piratecapital.png';
import fighterUrl from '../assets/fighter-combat-v1.png';
import { LightGrid, GridLighting } from './bronie-webgpu/lightGrid.js';
import { acesGame } from './bronie-webgpu/surfaceLighting.js';
import { createNoiseTexture } from './bronie-webgpu/noise.js';
import { GpuFx } from './bronie-webgpu/gpuFx.js';
import { FxHull, createSurfaceShared } from './bronie-webgpu/hull.js';
import { TurretLayer } from './bronie-webgpu/turrets.js';
import { TrailSystem } from './bronie-webgpu/trails.js';
import { ProjectileSystem } from './bronie-webgpu/projectiles.js';
import { BeamSystem } from './bronie-webgpu/beams.js';
import { FxLights } from './bronie-webgpu/fxLights.js';
import { Sky } from './bronie-webgpu/sky.js';
import { DroneField } from './bronie-webgpu/drones.js';
import { Gunnery } from './bronie-webgpu/gunnery.js';
import { GROUPS, WEAPONS, WEAPON_BY_ID } from './bronie-webgpu/arsenal.js';

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

const ZOOM_MIN = 0.12;
const ZOOM_MAX = 4.0;
const SHOWCASE_SEC = 7.5;

// Ustawienie sceny (świat gry): Atlas dziobem do celu, cel burtą do Atlasa.
const ATLAS_POSE = { x: 0, y: 0, angle: 0 };
const TARGET_POSE = { x: 2450, y: 40, angle: Math.PI / 2 - 0.1 };

// ---------------------------------------------------------------------------
// Stan

const S = {
  cam: { x: 1700, y: 0, zoom: 0.55 },
  camMode: params.get('kam') || 'auto',
  userZoom: 1,
  timeScale: Number(params.get('tempo')) || 1,
  paused: false,
  autoFire: params.get('ogien') !== '0',
  showcase: params.get('pokaz') !== '0' && !params.has('bron'),
  showcaseT: 0,
  // pokaz steruje kamerą (całość → wylot → cel), dopóki użytkownik nie wybierze jej sam
  showcaseCam: !params.has('kam'),
  shakeOn: true,
  shake: { mag: 0, t: 0, dur: 0.001 },
  weapon: null,
  mouse: { x: 0, y: 0, down: false, button: -1, dragX: 0, dragY: 0 },
  aim: null,
  time: 0,
  realTime: 0,
  frame: 0,
  fps: 60,
  cpuMs: 0,
  gpuRenderMs: 0,
  gpuComputeMs: 0,
  hideUi: false,
  ready: false,
  spawnRate: {},
  _lastSpawn: {},
  _rateT: 0
};

let W = innerWidth;
let H = innerHeight;

// ---------------------------------------------------------------------------
// Renderer, sceny, potok

let renderer = null;
let pipeline = null;
let bloomNode = null;
const scene = new THREE.Scene();
const distScene = new THREE.Scene();
scene.name = 'gra';
distScene.name = 'zniekształcenia';
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 60000);
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.color.setRGB(1.0, 0.95, 0.88, THREE.LinearSRGBColorSpace);
scene.add(sun);
scene.add(sun.target);
const SUN_BASE = 1.9;
const U = { distOn: uniform(1), exposure: uniform(1) };

const grid = new LightGrid();
const fxLights = new FxLights();
const shared = createSurfaceShared();
let noise = null;
let fx = null;
let atlas = null;
let target = null;
let turrets = null;
let trails = null;
let projectiles = null;
let beams = null;
let sky = null;
let drones = null;
let gun = null;

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
  renderer.setClearColor(0x000000, 1);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.lighting = new GridLighting(grid);
  $('root').appendChild(renderer.domElement);
  renderer.domElement.tabIndex = 0;
  await renderer.init();
  if (!renderer.backend?.isWebGPUBackend) {
    throw new Error('WebGPURenderer uruchomił się na zapasowym backendzie WebGL — demo wymaga WebGPU.');
  }
}

function buildPipeline() {
  pipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, cam, { samples: 4 });
  const distPass = pass(distScene, cam);
  const sceneTex = scenePass.getTextureNode('output');
  const distTex = distPass.getTextureNode('output');
  // Zniekształcenie: przesunięcie w px → uv; lekka aberracja wzdłuż przesunięcia.
  const o = distTex.rg.mul(U.distOn).div(screenSize);
  const r = sceneTex.sample(screenUV.sub(o.mul(1.12))).r;
  const g = sceneTex.sample(screenUV.sub(o)).g;
  const b = sceneTex.sample(screenUV.sub(o.mul(0.88))).b;
  const col = vec3(r, g, b).mul(U.exposure);
  bloomNode = bloom(vec4(col, 1.0), BLOOM_DEFAULTS.strength, BLOOM_DEFAULTS.radius, BLOOM_DEFAULTS.threshold);
  pipeline.outputNode = vec4(acesGame(col.add(bloomNode.rgb)), 1.0);
  pipeline.outputColorTransform = true;
}

function resize() {
  W = innerWidth;
  H = innerHeight;
  renderer?.setSize(W, H);
}
addEventListener('resize', resize);

// ---------------------------------------------------------------------------
// Kamera: kadrowanie z trybu + zoom użytkownika + wstrząs

const _frame = { x: 0, y: 0, zoom: 1 };
function framing(out) {
  const mode = S.camMode;
  const ts = turrets?.turrets || [];
  const m0 = ts.length ? turrets.muzzle(ts[0], 0, { x: 0, y: 0 }) : { x: ATLAS_POSE.x, y: 0, angle: 0 };
  if (gun?.weapon?.mount === 'builtin') gun._builtinMuzzle(m0);
  if (mode === 'free') { out.x = S.cam.x; out.y = S.cam.y; out.zoom = S.cam.zoom / S.userZoom; return out; }
  if (mode === 'muzzle') {
    const sc = gun?.weapon?.mount === 'builtin' ? 3 : (turrets?.scale || 1);
    out.x = m0.x + Math.cos(m0.angle) * 90 * Math.max(1, sc);
    out.y = m0.y + Math.sin(m0.angle) * 90 * Math.max(1, sc);
    out.zoom = Math.min(3.0, Math.max(0.5, 1.9 / Math.max(0.5, sc)));
    out.x += panelWidth() * 0.5 / out.zoom;
    return out;
  }
  if (mode === 'target') {
    const hit = gun?.lastImpact || { x: TARGET_POSE.x - 300, y: TARGET_POSE.y };
    out.zoom = gun?.weapon?.pd ? 1.2 : 1.1;
    out.x = hit.x - 120 + panelWidth() * 0.5 / out.zoom; out.y = hit.y;
    return out;
  }
  if (mode === 'follow') {
    const p = gun?.lastProjectile && projectiles.list.includes(gun.lastProjectile) ? gun.lastProjectile : null;
    if (p) { out.x = p.x; out.y = p.y; out.zoom = 1.0; return out; }
    out.x = m0.x; out.y = m0.y; out.zoom = 1.0;
    return out;
  }
  // auto: wyloty + strefa trafień (cel albo drony)
  let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
  const addP = (x, y) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
  for (const t of ts) { const p = turrets.muzzle(t, 0, { x: 0, y: 0 }); addP(p.x, p.y); }
  if (!ts.length || gun?.weapon?.mount === 'builtin') addP(m0.x, m0.y);
  if (gun?.weapon?.pd) {
    const z = drones.zone;
    addP(z.x - z.rx * 0.9, z.y - z.ry * 0.9); addP(z.x + z.rx * 0.9, z.y + z.ry * 0.9);
  } else {
    addP(TARGET_POSE.x - 420, TARGET_POSE.y - 420);
    addP(TARGET_POSE.x - 220, TARGET_POSE.y + 420);
  }
  const pad = 1.25;
  const freeW = W - panelWidth();
  out.zoom = Math.min(freeW / ((x1 - x0) * pad + 160), H / ((y1 - y0) * pad + 160), 1.4);
  // środek wolnej części ekranu (bez panelu)
  out.x = (x0 + x1) * 0.5 + panelWidth() * 0.5 / out.zoom;
  out.y = (y0 + y1) * 0.5;
  return out;
}

function panelWidth() {
  if (S.hideUi) return 0;
  const el = document.getElementById('panel');
  return el ? el.offsetWidth + 16 : 0;
}

function stepCamera(realDt) {
  const f = framing(_frame);
  if (S.camMode !== 'free') {
    const k = 1 - Math.exp(-4 * realDt);
    S.cam.x += (f.x - S.cam.x) * k;
    S.cam.y += (f.y - S.cam.y) * k;
    const lz = Math.log(S.cam.zoom);
    const lt = Math.log(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, f.zoom * S.userZoom)));
    S.cam.zoom = Math.exp(lz + (lt - lz) * (1 - Math.exp(-4 * realDt)));
  }
  // wstrząs: gładki szum w px ekranu, z sufitem
  const req = gun.takeShake();
  if (S.shakeOn && req.mag > 0) {
    const left = S.shake.t < S.shake.dur ? S.shake.mag * (1 - S.shake.t / S.shake.dur) : 0;
    if (req.mag > left) { S.shake.mag = Math.min(22, req.mag); S.shake.t = 0; S.shake.dur = Math.max(0.05, req.dur); }
  }
  S.shake.t += realDt;
  let sx = 0; let sy = 0;
  if (S.shakeOn && S.shake.t < S.shake.dur) {
    const a = S.shake.mag * Math.pow(1 - S.shake.t / S.shake.dur, 1.5);
    const t = S.realTime;
    sx = a * (Math.sin(t * 47.3) * 0.6 + Math.sin(t * 29.1 + 1.7) * 0.4);
    sy = a * (Math.sin(t * 41.9 + 0.6) * 0.6 + Math.sin(t * 23.3 + 2.9) * 0.4);
  }
  const zoom = S.cam.zoom;
  const cx = S.cam.x + sx / zoom;
  const cy = S.cam.y + sy / zoom;
  const hw = W * 0.5 / zoom;
  const hh = H * 0.5 / zoom;
  cam.left = -hw; cam.right = hw; cam.top = hh; cam.bottom = -hh;
  cam.near = 1; cam.far = 60000;
  cam.position.set(cx, -cy, 20000);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return { cx, cy, hw, hh };
}

function updateSun() {
  const e = 32 * Math.PI / 180;
  const a = -2.3;
  const d = new THREE.Vector3(Math.cos(a) * Math.cos(e), Math.sin(a) * Math.cos(e), Math.sin(e));
  sun.target.position.set(S.cam.x, -S.cam.y, 0);
  sun.position.set(S.cam.x + d.x * 1000, -S.cam.y + d.y * 1000, d.z * 1000);
  sun.target.updateMatrixWorld(true);
  sun.updateMatrixWorld(true);
  fx.U.sunDir.value.copy(d);
}

// ---------------------------------------------------------------------------
// Klatka

let lastT = 0;
function frame(nowMs, forcedDt = null) {
  const t0 = performance.now();
  const realDt = forcedDt ?? Math.min(0.1, Math.max(0, (nowMs - (lastT || nowMs)) / 1000));
  lastT = nowMs;
  S.frame++;
  S.realTime += realDt;
  if (realDt > 0) S.fps = S.fps * 0.94 + (1 / realDt) * 0.06;
  const dt = S.paused ? 0 : realDt * S.timeScale;
  S.time += dt;

  // pokaz: kolejne bronie
  if (S.showcase && !S.paused) {
    S.showcaseT += realDt;
    const w = S.weapon;
    const dur = SHOWCASE_SEC + (w.charge || 0) * 1.5;
    if (S.showcaseT > dur) {
      const i = WEAPONS.indexOf(w);
      selectWeapon(WEAPONS[(i + 1) % WEAPONS.length], true);
    }
    if (S.showcaseCam) {
      const u = S.showcaseT / dur;
      const want = S.weapon.pd ? (u < 0.55 ? 'auto' : 'target') : (u < 0.38 ? 'auto' : u < 0.66 ? 'muzzle' : 'target');
      if (want !== S.camMode) setCam(want, true);
    }
  }

  // wejście: ogień w kursor
  if (S.mouse.down && S.mouse.button === 0) {
    S.aim = screenToWorld(S.mouse.x, S.mouse.y, S.aim || { x: 0, y: 0 });
  } else S.aim = null;

  drones.update(dt);
  fxLights.update(dt);
  gun.update(dt, { aim: S.aim, fire: S.autoFire || !!S.aim });
  turrets.update(dt);
  turrets.commit();
  drones.commit();

  const view = stepCamera(realDt);
  updateSun();
  shared.time.value = S.time;

  // GPU: kadłuby (pola SDF dla iskier), stygnięcie ran, cząstki
  fx.setHullPose(0, target.x, -target.y, -target.angle, target.sdf.width, target.sdf.height, true);
  fx.setHullPose(1, atlas.x, -atlas.y, -atlas.angle, atlas.sdf.width, atlas.sdf.height, true);
  target.update(dt);
  fx.update(dt, S.cam.zoom);
  trails.update(dt);
  projectiles.commit(S.cam.zoom);
  beams.commit(gun.time, S.cam.zoom);

  // światła: efekty → siatka nad kadrem → dym i odłamki
  grid.begin();
  fxLights.commit(grid, S.time);
  const mx = view.hw * 1.3 + 600;
  const my = view.hh * 1.3 + 600;
  grid.build(view.cx - mx, -view.cy - my, view.cx + mx, -view.cy + my);
  fx.light();

  sky.update(S.cam.x, -S.cam.y, S.cam.zoom, W, H, S.realTime);
  pipeline.render();

  S.cpuMs = S.cpuMs * 0.9 + (performance.now() - t0) * 0.1;
  resolveGpuTimes();
  S._rateT += realDt;
  if (S._rateT >= 0.5) {
    for (const [k, p] of Object.entries(fx.pools)) {
      const prev = S._lastSpawn[k] || 0;
      S.spawnRate[k] = (p.spawnedTotal - prev) / S._rateT;
      S._lastSpawn[k] = p.spawnedTotal;
    }
    S._rateT = 0;
  }
  if (S.frame % 6 === 0) updateHud();
}

let gpuPending = false;
function resolveGpuTimes() {
  if (gpuPending || !renderer) return;
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
// Broń, UI

const FX_NOTE = {
  tempest: 'Działo jonowe: sekwencja cewek wzdłuż lufy, strumień jonów z diamentami uderzeniowymi, igła z helisą łuków, łuki EMP i poświata jonowa na poszyciu.',
  vulcan: 'Rotacyjne działko: migotliwy błysk, smugowce, łuski wyrzucane z zamka, rykoszety przy płaskim kącie.',
  autocannon: 'Ciężki autokanon: hamulec wylotowy, łuski, pociski odłamkowe z dymną smugą.',
  helios: 'Plazma Heliosa: czerwony bolt z białym rdzeniem, rozbryzg stopionego metalu.',
  armata: 'Armata prochowa (receptura z gry): kula ognia, dym oświetlony błyskiem, ciężki wybuch i ogień w wyrwie.',
  goliath: 'Autokanon klasy Capital: podwójne lufy na zmianę, ciężkie łuski, wybuchowe pociski.',
  yamato: 'Bateria Yamato (receptura z gry): trzy lufy w odstępach, kule energii ze smugą, eksplozja z wtórnymi wybuchami.',
  plasmaGatling: 'Plazmowy gatling: wolne globy plazmy z ogonem, rozbryzg z łukami po kadłubie.',
  hexlance: 'Hexlance (receptura z gry): ładowanie szynami, lanca plazmy, płatki sabotu jako bryły, pocisk tnie kadłub na wylot.',
  mjolnir: 'Mjolnir: 3 s ładowania (chargeTime z danych gry), kanał plazmy wiszący kilka sekund, przebicie na wylot.',
  valkyrie: 'Valkyrie: magentowy railgun (barwa z danych gry), krótkie ładowanie, igła ze stożkiem Macha, przebicie.',
  beamC: 'Wiązka ciągła: płynąca plazma, pakiety energii, cięcie burty ze stopionym rowem i strugą iskier.',
  beamP: 'Wiązka pulsacyjna: front impulsu biegnie do celu, trafienie po dojściu.',
  laserPD: 'Laser obrony punktowej: szybkie impulsy do dronów.',
  ciws: 'CIWS: strumień smugowców do dronów-celów.',
  flak: 'Flak: zapalnik czasowy/zbliżeniowy, kula odłamków, czarny kłąb z ognistym jądrem.'
};

function selectWeapon(w, fromShowcase = false) {
  if (!w) return;
  if (S.weapon && S.weapon !== w && S.autoRepair) { target.resetDamage(); gun.clear(); }
  S.weapon = w;
  gun.select(w);
  S.showcaseT = 0;
  if (!fromShowcase) S.showcase = false;
  for (const b of document.querySelectorAll('#gallery button')) b.classList.toggle('on', b.dataset.id === w.id);
  $('b-show').classList.toggle('on', S.showcase);
  updateHud();
}

function buildGallery() {
  const g = $('gallery');
  g.innerHTML = '';
  for (const grp of GROUPS) {
    const div = document.createElement('div');
    div.className = 'grp';
    div.innerHTML = `<div class="lbl">${grp.label}</div>`;
    const row = document.createElement('div');
    row.className = 'gallery';
    for (const w of grp.items) {
      const b = document.createElement('button');
      b.textContent = w.short;
      b.dataset.id = w.id;
      b.title = `${w.def.name} (${w.id})`;
      b.addEventListener('click', () => selectWeapon(w));
      row.appendChild(b);
    }
    div.appendChild(row);
    g.appendChild(div);
  }
}

function fmt(n) { return Math.round(n).toLocaleString('pl-PL'); }
function f2(v) { return v.toFixed(2).replace('.', ','); }

function collectStats() {
  const info = renderer.info;
  const rates = S.spawnRate;
  return {
    fps: +S.fps.toFixed(1),
    cpuMs: +S.cpuMs.toFixed(2),
    gpuRenderMs: +S.gpuRenderMs.toFixed(2),
    gpuComputeMs: +S.gpuComputeMs.toFixed(2),
    drawCalls: info.render.drawCalls,
    computeCalls: info.compute.frameCalls,
    lights: grid.stats.lights,
    fxLights: fxLights.count,
    projectiles: projectiles.list.length,
    trailSegments: trails.stats.segments,
    rates: { ...rates },
    weapon: S.weapon?.id,
    shots: gun.stats.shots,
    hits: gun.stats.hits
  };
}

function updateHud() {
  if (S.hideUi || !S.ready) return;
  const st = collectStats();
  const r = st.rates;
  $('stats').innerHTML = [
    `<b>${st.fps.toFixed(0)} FPS</b> · CPU ${f2(st.cpuMs)} ms · GPU ${f2(st.gpuRenderMs + st.gpuComputeMs)} ms`,
    `GPU: render ${f2(st.gpuRenderMs)} · compute ${f2(st.gpuComputeMs)} ms`,
    `draw calle ${fmt(st.drawCalls)} · compute ${fmt(st.computeCalls)}`,
    `cząstki/s: iskry ${fmt(r.spark || 0)} · blask ${fmt(r.add || 0)}`,
    `  dym ${fmt(r.smoke || 0)} · odłamki ${fmt(r.debris || 0)} · łuki ${fmt(r.arc || 0)} · zniekszt. ${fmt(r.dist || 0)}`,
    `światła ${fmt(st.lights)} (efekty ${fmt(st.fxLights)}) · pociski ${fmt(st.projectiles)}`,
    `strzały ${fmt(st.shots)} · trafienia ${fmt(st.hits)}`
  ].join('\n');
  const w = S.weapon;
  const d = w.def;
  const lines = [];
  lines.push(`<span class="w">${d.name}</span>  <b>${d.size}</b> · ${w.id}`);
  const sp = Number.isFinite(d.baseSpeed) ? `${fmt(d.baseSpeed)} j/s` : 'wiązka';
  lines.push(`pocisk ${sp} · kadencja ${f2(d.cooldown)} s · obrażenia ${fmt(d.baseDamage)}${d.burstCount ? ` · salwa ${d.burstCount}` : ''}${w.charge ? ` · ładowanie ${f2(w.charge)} s` : ''}`);
  lines.push(FX_NOTE[w.fx] || '');
  lines.push(`kamera: ${({ auto: 'całość', muzzle: 'wylot', target: 'cel', follow: 'za pociskiem', free: 'swobodna' })[S.camMode]} · tempo ${f2(S.timeScale)}${S.paused ? ' · PAUZA' : ''}${S.showcase ? ' · POKAZ' : ''}${S.autoFire ? '' : ' · ogień: LPM'}`);
  $('hud').innerHTML = lines.join('\n');
}

// ---------------------------------------------------------------------------
// Wejście

function screenToWorld(px, py, out = { x: 0, y: 0 }) {
  out.x = S.cam.x + (px - W * 0.5) / S.cam.zoom;
  out.y = S.cam.y + (py - H * 0.5) / S.cam.zoom;
  return out;
}

function setCam(mode, fromShowcase = false) {
  if (!fromShowcase) S.showcaseCam = false;
  S.camMode = mode;
  if (mode !== 'free' && !fromShowcase) S.userZoom = 1;
  for (const b of document.querySelectorAll('#cams button')) b.classList.toggle('on', b.dataset.cam === mode);
  updateHud();
}

function setTimeScale(v) {
  S.timeScale = Math.max(0.03, Math.min(1, v));
  const el = $('s-time');
  el.value = String(S.timeScale);
  $('o-time').textContent = f2(S.timeScale);
  $('b-slow').classList.toggle('on', S.timeScale < 0.99);
}

function cycleWeapon(dir) {
  const i = WEAPONS.indexOf(S.weapon);
  selectWeapon(WEAPONS[(i + dir + WEAPONS.length) % WEAPONS.length]);
}

const click = (id) => { const c = $(id); c.checked = !c.checked; c.dispatchEvent(new Event('change')); };
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();
  if (k === 'tab') { e.preventDefault(); cycleWeapon(e.shiftKey ? -1 : 1); }
  if (k === 'g') toggleShowcase();
  if (k === 'f') toggleFire();
  if (k === 't') setTimeScale(S.timeScale < 0.99 ? 1 : 0.2);
  if (k === 'p' || k === ' ') { e.preventDefault(); togglePause(); }
  if (k === 'r') target.resetDamage();
  if (k === 'm') toggleMounts();
  if (k === 'z') setCam('auto');
  if (k === '1') setCam('auto');
  if (k === '2') setCam('muzzle');
  if (k === '3') setCam('target');
  if (k === '4') setCam('follow');
  if (k === 'h') { S.hideUi = !S.hideUi; document.body.classList.toggle('shot', S.hideUi); }
  if (k === 'b') click('t-bloom');
  if (k === 'v') click('t-dist');
  if (k === 'l') click('t-lights');
});

function toggleShowcase() {
  S.showcase = !S.showcase;
  S.showcaseT = 0;
  if (S.showcase) S.showcaseCam = true;
  $('b-show').classList.toggle('on', S.showcase);
  updateHud();
}
function toggleFire() { S.autoFire = !S.autoFire; $('b-fire').classList.toggle('on', S.autoFire); updateHud(); }
function togglePause() { S.paused = !S.paused; $('b-pause').classList.toggle('on', S.paused); updateHud(); }
const MOUNT_MODES = ['pair', 'one', 'all'];
const MOUNT_LABEL = { pair: 'para', one: 'jedno', all: 'wszystkie' };
function setMounts(mode) {
  gun.select(S.weapon, mode);
  $('b-mounts').textContent = `Gniazda: ${MOUNT_LABEL[mode]} (M)`;
  $('b-mounts').classList.toggle('on', mode !== 'pair');
}
function toggleMounts() {
  setMounts(MOUNT_MODES[(MOUNT_MODES.indexOf(gun.mountMode) + 1) % MOUNT_MODES.length]);
}

function bindCanvasInput(canvas) {
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const k = Math.exp(-e.deltaY * 0.0015);
    if (S.camMode === 'free') S.cam.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, S.cam.zoom * k));
    else S.userZoom = Math.min(8, Math.max(0.15, S.userZoom * k));
  }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.focus();
    canvas.setPointerCapture(e.pointerId);
    S.mouse.down = true;
    S.mouse.button = e.button;
    S.mouse.x = e.clientX; S.mouse.y = e.clientY;
    S.mouse.dragX = e.clientX; S.mouse.dragY = e.clientY;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (S.mouse.down && S.mouse.button !== 0) {
      if (S.camMode !== 'free') { S.cam.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, S.cam.zoom)); setCam('free'); }
      S.cam.x -= (e.clientX - S.mouse.dragX) / S.cam.zoom;
      S.cam.y -= (e.clientY - S.mouse.dragY) / S.cam.zoom;
      S.mouse.dragX = e.clientX; S.mouse.dragY = e.clientY;
    }
    S.mouse.x = e.clientX; S.mouse.y = e.clientY;
  });
  const up = () => { S.mouse.down = false; S.mouse.button = -1; };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
}

function bindRange(id, outId, fmtFn, apply) {
  const el = $(id);
  const out = $(outId);
  const run = () => { const v = Number(el.value); out.textContent = fmtFn(v); apply(v); };
  el.addEventListener('input', run);
  run();
}

function bindControls() {
  const toggle = (id, fn) => { const el = $(id); el.addEventListener('change', () => fn(el.checked)); fn(el.checked); };
  toggle('t-bloom', (v) => { S.bloomOn = v; applyBloom(); });
  toggle('t-dist', (v) => { U.distOn.value = v ? 1 : 0; });
  toggle('t-lights', (v) => { fxLights.enabled = v; });
  toggle('t-smokelight', (v) => { fx.U.smokeLight.value = v ? 1 : 0; });
  toggle('t-damage', (v) => { gun.damageOn = v; shared.damageOn.value = v ? 1 : 0; });
  toggle('t-shake', (v) => { S.shakeOn = v; });
  toggle('t-trails', (v) => { trails.mesh.visible = v; });
  toggle('t-sky', (v) => { sky.mesh.visible = v; });
  toggle('t-repair', (v) => { S.autoRepair = v; });
  $('s-time').value = String(S.timeScale);
  bindRange('s-time', 'o-time', f2, (v) => { S.timeScale = v; $('b-slow').classList.toggle('on', v < 0.99); });
  bindRange('s-bloom', 'o-bloom', f2, (v) => { S.bloomK = v; applyBloom(); });
  bindRange('s-sun', 'o-sun', f2, (v) => { sun.intensity = SUN_BASE * v; fx.U.sunCol.value.set(0.6, 0.58, 0.55).multiplyScalar(v); });
  bindRange('s-lights', 'o-lights', f2, (v) => { fxLights.gain = v; });
  $('b-show').addEventListener('click', toggleShowcase);
  $('b-fire').addEventListener('click', toggleFire);
  $('b-slow').addEventListener('click', () => setTimeScale(S.timeScale < 0.99 ? 1 : 0.2));
  $('b-pause').addEventListener('click', togglePause);
  $('b-repair').addEventListener('click', () => target.resetDamage());
  $('b-mounts').addEventListener('click', toggleMounts);
  for (const b of document.querySelectorAll('#cams button')) b.addEventListener('click', () => setCam(b.dataset.cam));
  $('b-fire').classList.toggle('on', S.autoFire);
  $('b-show').classList.toggle('on', S.showcase);
  setTimeScale(S.timeScale);
  setCam(S.camMode, true);
}

function applyBloom() {
  if (!bloomNode) return;
  const k = (S.bloomOn === false ? 0 : 1) * (S.bloomK ?? 1);
  bloomNode.strength.value = BLOOM_DEFAULTS.strength * k;
}

// ---------------------------------------------------------------------------
// Start

async function loadImage(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

async function start() {
  const loading = $('loading');
  await initRenderer();
  bindCanvasInput(renderer.domElement);
  loading.textContent = 'Tekstury i kadłuby…';
  noise = createNoiseTexture(256);
  sky = new Sky({ scene, noise });
  fx = new GpuFx({ renderer, scene, distScene, noise, grid });
  atlas = await FxHull.load({ id: 'atlas', url: atlasUrl, scene, shared, noise, renderer, renderOrder: 5 });
  target = await FxHull.load({ id: 'supercapital', url: targetUrl, scene, shared, noise, renderer, renderOrder: 5 });
  atlas.setPose(ATLAS_POSE.x, ATLAS_POSE.y, ATLAS_POSE.angle);
  target.setPose(TARGET_POSE.x, TARGET_POSE.y, TARGET_POSE.angle);
  fx.setHullSdf(0, target.sdf.texture);
  fx.setHullSdf(1, atlas.sdf.texture);
  fx.build();
  trails = new TrailSystem({ scene, noise });
  projectiles = new ProjectileSystem({ scene, noise, trails });
  beams = new BeamSystem({ scene, noise });
  turrets = new TurretLayer({ scene, shared });
  const fighter = await loadImage(fighterUrl);
  drones = new DroneField({ scene, shared, image: fighter });
  drones.setZone(1480, 0, 430, 430);
  gun = new Gunnery({ fx, lights: fxLights, trails, projectiles, beams, turrets, atlas, target, drones });
  buildPipeline();
  buildGallery();
  bindControls();
  const first = WEAPON_BY_ID[params.get('bron')] || WEAPON_BY_ID.railgun_mk1;
  if (MOUNT_MODES.includes(params.get('gniazda'))) gun.mountMode = params.get('gniazda');
  selectWeapon(first, true);
  setMounts(gun.mountMode);
  // kamera od razu w kadrze
  framing(_frame);
  S.cam.x = _frame.x; S.cam.y = _frame.y; S.cam.zoom = _frame.zoom;
  loading.textContent = 'Kompilacja shaderów…';
  await new Promise((r) => setTimeout(r, 20));
  loading.style.display = 'none';
  S.ready = true;
  window.__demo = {
    S, renderer, fx, gun, atlas, target, turrets, projectiles, trails, grid,
    select: (id) => selectWeapon(WEAPON_BY_ID[id]),
    weapons: () => WEAPONS.map((w) => w.id),
    setCam,
    setTime: (v) => setTimeScale(v),
    fire: (on = true) => { S.autoFire = !!on; $('b-fire').classList.toggle('on', S.autoFire); },
    showcase: (on = true) => { S.showcase = !!on; S.showcaseT = 0; },
    step: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) frame(performance.now(), dt); },
    // Test: czeka na następny strzał, potem simDelay sekund czasu symulacji, i pauzuje.
    waitShot: async (simDelay = 0.05, timeoutMs = 20000) => {
      const raf = () => new Promise((r) => requestAnimationFrame(r));
      const t0 = performance.now();
      const n0 = gun.stats.shots;
      while (gun.stats.shots === n0 && performance.now() - t0 < timeoutMs) await raf();
      const ts = gun.time;
      while (gun.time < ts + simDelay && performance.now() - t0 < timeoutMs) await raf();
      S.paused = true;
      return gun.stats.shots > n0;
    },
    resume: () => { S.paused = false; },
    // Test: czeka na sekwencję przed strzałem (cewki Tempesta), potem simDelay i pauza.
    waitPre: async (simDelay = 0.0, timeoutMs = 20000) => {
      const raf = () => new Promise((r) => requestAnimationFrame(r));
      const t0 = performance.now();
      const n0 = gun.stats.pre;
      while (gun.stats.pre === n0 && performance.now() - t0 < timeoutMs) await raf();
      const ts = gun.time;
      while (gun.time < ts + simDelay && performance.now() - t0 < timeoutMs) await raf();
      S.paused = true;
      return gun.stats.pre > n0;
    },
    mounts: (mode) => setMounts(mode),
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
