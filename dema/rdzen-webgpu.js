// Demo RDZENIA REAKTORA na WebGPU — nowa wersja dema rdzenia (stare: dema/rdzen-demo.html, kadłuby
// heksowe). Wszystko jak w grze: Core3D (WebGPU, TSL, bloom, ACES), kadłuby na silniku belek
// (HullBodies + skóra hexShips3D), mapa ran, efekty broni (WeaponFx), rakiet (dym compute, łuki,
// iskry), światła i zniekształcenia Core3D. Nowe: rdzeń na belkach (src/game/reactorCore.js),
// model reaktora w wyrwie (reactor3D.js — rama z logiki belek) i reżyser wybuchu
// (src/3d/reactorBlast/ — kula plazmy z objętości, strumień, receptury stopienia i detonacji).
//
// Serwowanie: `npm run dev` → /dema/rdzen-webgpu.html
//   ?scene=gallery|meltdown|chain|jet|orb|range   ?variant=<wariant>   ?hull=<kadłub>
//   ?test=1 (klatki tylko z __rdzen2.runFrames — harness)   ?clean=1 (bez paneli)
import { Core3D } from '../src/3d/core3d.js';
import { initHexShips3D, updateHexShips3D, drawHexShips3D, resizeHexShips3D, prewarmHexShips3D } from '../src/3d/hexShips3D.js';
import { HULL_LACQUER_DEFAULTS } from '../src/3d/hullLacquer.js';
import { SparkSystem3D } from '../src/3d/sparkSystem3D.js';
import { createRocketFx } from '../src/3d/rockets/rocketFx.js';
import { initRocketSystem3D } from '../src/effects3d/rocketSystem3D.js';
import { WeaponFx } from '../src/3d/weapons/weaponFx.js';
import { HullDamageMap } from '../src/3d/hullDamageMap.js';
import { HullBodies } from '../src/game/hullBodies.js';
import { createReactor3D } from '../src/3d/reactor3D.js';
import { createReactorBlastFx } from '../src/3d/reactorBlast/reactorBlastFx.js';
import { SimClock } from '../src/game/simClock.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';
import * as RC from '../src/game/reactorCore.js';
import { World, loadHullAssets } from './rdzen-webgpu/swiat.js';
import { Gun, DEMO_WEAPONS } from './rdzen-webgpu/bron.js';
import { SCENES, VARIANT_LABEL } from './rdzen-webgpu/sceny.js';
import { createBackdrop } from './rdzen-webgpu/tlo.js';

const params = new URLSearchParams(location.search);
const TEST = params.get('test') === '1';
if (params.get('clean') === '1') document.body.classList.add('clean');
const $ = (id) => document.getElementById(id);
function reportError(text) {
  const el = $('errors');
  el.style.display = 'block';
  el.textContent += `${text}\n`;
  console.error(text);
}
window.addEventListener('error', (e) => reportError(`JS: ${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => reportError(`Promise: ${e.reason?.stack || e.reason}`));

const PHYS_DT = 1 / 120;
const HULL_IDS = ['battleship', 'pirate_battleship', 'atlas'];

// ---------------------------------------------------------------------------
// Stan
const S = {
  sceneId: SCENES[params.get('scene')] ? params.get('scene') : 'gallery',
  sceneT: 0,
  sceneRun: 0,
  sceneOnce: new Set(),
  paused: false,
  timeScale: 1,
  acc: 0,
  frame: 0,
  cam: { x: 0, y: 0, zoom: 0.5 },
  camTo: null,           // { x, y, zoom, rate } — płynny przelot
  shake: 0,
  shakeT: 0,
  mouse: { x: 0, y: 0, wx: 0, wy: 0, down: false, pan: false, lastX: 0, lastY: 0 },
  firing: false,
  autofire: false,
  lock: true,
  frameMs: 16,
  cpuMs: 0,
  log: [],
  state: {}
};
window.camera = {
  get x() { return S.cam.x; },
  get y() { return S.cam.y; },
  get zoom() { return S.cam.zoom; },
  shakeMag: 0, shakeDur: 0,
  addShake(mag, dur) { S.shake = Math.max(S.shake, Number(mag) || 0); S.shakeT = Math.max(S.shakeT, Number(dur) || 0.3); }
};

function log(text, cls = '') {
  const t = world ? world.time.toFixed(2).padStart(6) : '  0.00';
  S.log.push({ text: `${t}s  ${text}`, cls });
  if (S.log.length > 9) S.log.shift();
  $('log').innerHTML = S.log.map((l) => `<div class="${l.cls}" style="color:${l.cls === 'bad' ? '#ff9a90' : (l.cls === 'warn' ? '#f0c080' : '#c9d6dd')}">${l.text.replace(/</g, '&lt;')}</div>`).join('');
}

// ---------------------------------------------------------------------------
// Render: Core3D + hexShips3D (skóra kadłubów belkowych), efekty gry
const canvas2d = $('c');
const ctx2d = canvas2d.getContext('2d');
let W = innerWidth, H = innerHeight;
canvas2d.width = W; canvas2d.height = H;
const glCanvas = $('webgl-layer');
glCanvas.width = W; glCanvas.height = H;
window.__hullLacquerTune = { ...HULL_LACQUER_DEFAULTS, skyUrl: '../assets/reflections/lacquer-sky.png' };
initHexShips3D({ canvas: glCanvas });
window.Core3D = Core3D;
window.SUN = { x: -52000, y: -30000, r: 823 };
// Mapa ran jak w grze (index.html): stempel z każdego krateru i rzazu, rozdarcia poza bronią.
HullBodies.onImpact = HullDamageMap.onHullImpact;
HullBodies.onRepair = HullDamageMap.onHullRepair;
HullBodies.onNodeLost = HullDamageMap.onHullNodeLost;

let world = null;
let gun = null;
let fx = null;
let reactor3D = null;
let rocketFx = null;
let backdrop = null;
const cores = [];

function setupFx() {
  backdrop = createBackdrop(Core3D);
  SparkSystem3D.init(Core3D.scene);
  window.SparkSystem3D = SparkSystem3D;
  rocketFx = createRocketFx(Core3D);
  initRocketSystem3D(Core3D.scene, { effects: rocketFx });
  WeaponFx.ensure();
  fx = createReactorBlastFx(Core3D, { rocketFx, weaponFx: WeaponFx });
  fx.onShake = (mag, dur) => window.camera.addShake(mag, dur);
  const KIND_BY_HULL = { battleship: 'terran', pirate_battleship: 'pirate', atlas: 'atlas' };
  reactor3D = createReactor3D({
    scene: Core3D.scene,
    markLayerActive: () => Core3D.setShieldLayerActive(true),
    kindFor: (core) => KIND_BY_HULL[core?.origin?.__hullId] || 'terran',
    colorFor: (core) => core.color || [0.3, 0.7, 1.0],
    frameOf: RC.reactorCoreFrame,
    hostReady: (h) => !!RC.reactorHull(h)
  });
}

// ---------------------------------------------------------------------------
// Kamera
function setCamera(x, y, zoom) {
  S.cam.x = x; S.cam.y = y; S.cam.zoom = zoom;
  S.camTo = null;
}
function flyTo(x, y, zoom, rate = 3) {
  S.camTo = { x, y, zoom, rate };
}
function fitOn(e, zoom = 0.5, rate = 0) {
  if (!e) return;
  if (rate > 0) flyTo(e.x, e.y, zoom, rate);
  else setCamera(e.x, e.y, zoom);
}
function coreOf(e) {
  const list = e?.reactorCores;
  return Array.isArray(list) && list.length ? list[0] : null;
}
function focusCore(e, zoom = 1.3) {
  const c = coreOf(e);
  if (!c) return fitOn(e, zoom);
  const w = RC.reactorCoreWorld(c, {});
  setCamera(w.x, w.y, zoom);
}
function screenToWorld(sx, sy) {
  return { x: S.cam.x + (sx - W * 0.5) / S.cam.zoom, y: S.cam.y + (sy - H * 0.5) / S.cam.zoom };
}

// ---------------------------------------------------------------------------
// Sceny
function variantPick() {
  return $('variant').value || null;
}
function hullPick() {
  return $('hull').value || 'battleship';
}

// Kanał od burty do komory (rzaz + mały krater) — reaktor widać w wyrwie; osłona zostaje nad
// progiem stopienia, stan ODSŁONIĘTY / KRYTYCZNY.
function openChamber(e) {
  const core = coreOf(e);
  if (!core || !RC.reactorHull(e)) return;
  const w = RC.reactorCoreWorld(core, {});
  const side = -Math.PI / 2;
  const a = (e.angle || 0) + side;
  const dx = Math.cos(a), dy = Math.sin(a);
  const reach = (e.radius || 300) + 60;
  // rana jak rozdarcie (ciemny, poszarpany brzeg) — nie biały rzaz Hexlance'a
  HullDamageMap.setSource('tear', 'impact');
  try {
    HullBodies.cutSegment(e, w.x + dx * reach, w.y + dy * reach, w.x + dx * core.gridR * 0.2, w.y + dy * core.gridR * 0.2, core.gridR * 0.42, { push: true });
    HullBodies.impact(e, w.x, w.y, 1, null, { craterRadius: core.gridR * 0.5 });
  } finally {
    HullDamageMap.clearSource();
  }
}

function meltdown(e, sec, variant) {
  const core = coreOf(e);
  if (!core) return;
  world.forceMeltdown(core, sec, variant);
}

const D = {
  get world() { return world; },
  get gun() { return gun; },
  state: S.state,
  once(key, cond) {
    if (!cond || S.sceneOnce.has(key)) return false;
    S.sceneOnce.add(key);
    return true;
  },
  openChamber, meltdown, fitOn, focusCore, setCamera, flyTo, variantPick, hullPick,
  setSceneTitle(text) { $('scene-name').textContent = text; }
};

function startScene(id = S.sceneId, keepRun = false) {
  const sc = SCENES[id] || SCENES.gallery;
  S.sceneId = id;
  if (!keepRun) S.sceneRun = 0;
  S.sceneT = 0;
  S.sceneOnce.clear();
  for (const k of Object.keys(S.state)) delete S.state[k];
  world.clear();
  world.variantOverride = variantPick();
  gun.bullets.length = 0;
  $('scene-name').textContent = sc.title;
  $('scene-hint').textContent = sc.hint;
  document.querySelectorAll('[data-scene]').forEach((b) => b.classList.toggle('on', b.dataset.scene === id));
  sc.start(D, S.sceneRun);
}

function tickScene(dt) {
  const sc = SCENES[S.sceneId];
  if (!sc) return;
  S.sceneT += dt;
  sc.tick(D, S.sceneT, dt);
  if (sc.loop > 0 && S.sceneT >= sc.loop) {
    S.sceneRun++;
    startScene(S.sceneId, true);
  }
}

// ---------------------------------------------------------------------------
// Klatka
const cullInfo = { x: 0, y: 0, halfW: 1e5, halfH: 1e5, drawHalfW: 1e5, drawHalfH: 1e5 };
let lastT = performance.now();
const renderList = [];

function physicsStep(dt) {
  // ogień z broni (strzelnica)
  if ((S.firing || S.autofire) && S.sceneId === 'range') {
    const tgt = aimPoint();
    if (tgt) gun.fire(tgt.x, tgt.y);
  }
  world.step(dt, gun);
  tickScene(dt);
}

function aimPoint() {
  if (S.lock) {
    const t = S.state.target;
    if (t && RC.reactorHull(t)) {
      const p = RC.getReactorLockPoint(t, {}, Math.random);
      if (p) return p;
    }
  }
  return { x: S.mouse.wx, y: S.mouse.wy };
}

function frame(realDt) {
  const t0 = performance.now();
  S.frame++;
  const simDt = S.paused ? 0 : realDt * S.timeScale;
  S.acc += simDt;
  let steps = 0;
  while (S.acc >= PHYS_DT && steps < 16) {
    physicsStep(PHYS_DT);
    S.acc -= PHYS_DT;
    steps++;
  }
  if (steps >= 16) S.acc = 0;
  render(realDt, simDt);
  S.cpuMs = S.cpuMs * 0.9 + (performance.now() - t0) * 0.1;
}

function render(realDt, simDt) {
  // kamera: przelot
  if (S.camTo) {
    const k = 1 - Math.exp(-S.camTo.rate * realDt);
    S.cam.x += (S.camTo.x - S.cam.x) * k;
    S.cam.y += (S.camTo.y - S.cam.y) * k;
    S.cam.zoom = Math.exp(Math.log(S.cam.zoom) + (Math.log(S.camTo.zoom) - Math.log(S.cam.zoom)) * k);
    if (Math.abs(S.camTo.zoom - S.cam.zoom) < 1e-3 && Math.hypot(S.camTo.x - S.cam.x, S.camTo.y - S.cam.y) < 1) S.camTo = null;
  }
  S.mouse.wx = S.cam.x + (S.mouse.x - W * 0.5) / S.cam.zoom;
  S.mouse.wy = S.cam.y + (S.mouse.y - H * 0.5) / S.cam.zoom;
  // zegar reżysera rakiet (dym, łuki) i reżysera wybuchu — czas symulacji tej klatki
  if (simDt > 0) window.rocketSystem3D?.update(simDt);
  fx.advance(simDt);
  world.cores(cores);
  Core3D.beginPlanetLayerFrame?.();
  Core3D.setShieldLayerActive(false);
  fx.syncCores(cores, simDt);
  fx.syncHazards(simDt);
  if ($('o-model').checked) reactor3D.sync(cores, performance.now() * 0.001, simDt, { origin: S.cam });
  else reactor3D.sync([], 0, simDt, { origin: S.cam });
  SimClock.beginRender(1, PHYS_DT, S.paused || simDt <= 0);
  // wstrząs kamery (px ekranu, gasnący)
  S.shakeT = Math.max(0, S.shakeT - realDt);
  if (S.shakeT <= 0) S.shake *= Math.exp(-10 * realDt);
  const sh = S.shake * (S.shakeT > 0 ? 1 : 0.5);
  const cam = {
    x: S.cam.x + (Math.random() - 0.5) * sh / S.cam.zoom,
    y: S.cam.y + (Math.random() - 0.5) * sh / S.cam.zoom,
    zoom: S.cam.zoom
  };
  cullInfo.x = cam.x; cullInfo.y = cam.y;
  cullInfo.drawHalfW = W * 0.5 / cam.zoom + 600; cullInfo.drawHalfH = H * 0.5 / cam.zoom + 600;
  cullInfo.halfW = cullInfo.drawHalfW * 3; cullInfo.halfH = cullInfo.drawHalfH * 3;
  renderList.length = 0;
  for (const e of world.entities()) renderList.push(e);
  backdrop.sync(cam, W, H);
  updateHexShips3D(cam, renderList, cullInfo);
  drawHexShips3D(ctx2d, W, H);
  drawOverlay(cam);
  updateHud();
  updateAlarm();
}

function drawOverlay(cam) {
  if (S.sceneId !== 'range' || document.body.classList.contains('clean')) return;
  const toS = (x, y) => ({ x: (x - cam.x) * cam.zoom + W * 0.5, y: (y - cam.y) * cam.zoom + H * 0.5 });
  ctx2d.save();
  // działo
  const g = toS(gun.x, gun.y);
  ctx2d.strokeStyle = '#7cc9ff';
  ctx2d.lineWidth = 1.5;
  ctx2d.beginPath(); ctx2d.arc(g.x, g.y, 7, 0, Math.PI * 2); ctx2d.stroke();
  // lock na rdzeń
  const t = S.state.target;
  const core = coreOf(t);
  if (S.lock && core && core.state !== RC.CORE_STATE.DETONATED && RC.reactorHull(core.host)) {
    const w = RC.reactorCoreWorld(core, {});
    const p = toS(w.x, w.y);
    const r = Math.max(10, core.gridR * cam.zoom * 1.25);
    ctx2d.strokeStyle = core.state === RC.CORE_STATE.MELTDOWN ? '#ff6a5a' : '#ffcc66';
    ctx2d.setLineDash([4, 4]);
    ctx2d.beginPath(); ctx2d.arc(p.x, p.y, r, 0, Math.PI * 2); ctx2d.stroke();
    ctx2d.setLineDash([]);
    ctx2d.font = '11px ui-monospace, Consolas, monospace';
    ctx2d.fillStyle = ctx2d.strokeStyle;
    ctx2d.fillText(`RDZEŃ ${Math.round(core.integrity * 100)}%`, p.x + r + 6, p.y - 4);
  }
  ctx2d.restore();
}

function renderStats() {
  const r = Core3D.lastFrameRenderInfo?.total || Core3D.renderer?.info?.render || {};
  return { calls: r.drawCalls ?? r.calls ?? 0, gpu: Number(Core3D.gpuFrameMs) || 0 };
}

let hudAcc = 0;
function updateHud() {
  if (++hudAcc % 6) return;
  const st = renderStats();
  const fps = 1000 / Math.max(1, S.frameMs);
  const lines = [];
  lines.push(`<b>${fps.toFixed(0)} FPS</b> · CPU ${S.cpuMs.toFixed(1)} ms · GPU ${st.gpu.toFixed(1)} ms · draw ${st.calls}${S.paused ? ' · <span class="warn">PAUZA</span>' : ''}${S.timeScale !== 1 ? ` · czas ×${S.timeScale}` : ''}`);
  const t = S.state.target;
  const core = coreOf(t) || cores.find((c) => c.state !== RC.CORE_STATE.DETONATED) || null;
  if (core) {
    const s = RC.summarizeReactorCore(core);
    const cls = s.state === RC.CORE_STATE.MELTDOWN ? 'bad' : (s.state === RC.CORE_STATE.CRITICAL ? 'warn' : (s.state === RC.CORE_STATE.NOMINAL ? 'good' : ''));
    lines.push(`Rdzeń ${core.origin?.__label || ''} [${s.classId}] <span class="${cls}">${s.label}</span>`);
    lines.push(`osłona ${(s.integrity * 100).toFixed(0)}% · komora ${s.alive}/${s.chamber} (martwe ${s.dead}${s.elsewhere ? `, na odłamie ${s.elsewhere}` : ''})`);
    if (s.state === RC.CORE_STATE.MELTDOWN) lines.push(`<span class="bad">odliczanie ${s.meltdownRemaining.toFixed(2)} / ${s.meltdownDuration.toFixed(1)} s · ${VARIANT_LABEL[s.variant] || s.variant}</span>`);
  } else {
    lines.push('Rdzeń: —');
  }
  const L = fx.stats.live || {};
  const sm = rocketFx?.smoke?.stats?.alive || 0;
  lines.push(`kule ${L.fireballs || 0} · błyski ${L.flashes || 0} · odłamki ${L.frags || 0} · strumienie ${L.jets || 0} · kule plazmy ${L.orbs || 0}`);
  lines.push(`dym ${sm} · wraki ${world.wrecks.length} · detonacji ${world.detonations} · fx CPU ${fx.stats.cpuMs.toFixed(2)} ms`);
  if (S.sceneId === 'range') lines.push(`broń: ${MASTER_WEAPONS[gun.weaponId]?.name || gun.weaponId}${S.lock ? ' · lock' : ''}${S.autofire ? ' · ogień ciągły' : ''}`);
  $('hud').innerHTML = lines.join('\n');
}

function updateAlarm() {
  let worst = null;
  for (const c of cores) {
    if (c.state !== RC.CORE_STATE.MELTDOWN) continue;
    if (!worst || c.meltdownRemaining < worst.meltdownRemaining) worst = c;
  }
  const el = $('alarm');
  if (!worst || document.body.classList.contains('clean')) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  const prog = RC.reactorMeltdownProgress(worst);
  const blink = (Math.sin(world.time * (6 + 18 * prog)) > 0) ? '#ff5a52' : '#8a2a24';
  el.style.borderColor = blink;
  $('alarm-text').textContent = `STOPIENIE REAKTORA — ${worst.origin?.__label || ''} — ${worst.meltdownRemaining.toFixed(1)} s`;
  $('alarm-bar').style.width = `${(prog * 100).toFixed(1)}%`;
}

function loop(nowMs) {
  const realDt = Math.min(0.1, Math.max(0, (nowMs - lastT) / 1000));
  lastT = nowMs;
  S.frameMs = S.frameMs * 0.9 + realDt * 1000 * 0.1;
  if (!TEST) frame(realDt);
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Wejście i panel
function bindPanel() {
  document.querySelectorAll('[data-scene]').forEach((b) => b.addEventListener('click', () => startScene(b.dataset.scene)));
  const variant = params.get('variant');
  if (variant) $('variant').value = variant;
  const hull = params.get('hull');
  if (hull && HULL_IDS.includes(hull)) $('hull').value = hull;
  $('variant').addEventListener('change', () => { world.variantOverride = variantPick(); });
  $('hull').addEventListener('change', () => startScene(S.sceneId));
  $('btn-melt').addEventListener('click', () => meltdownTarget());
  $('btn-blow').addEventListener('click', () => detonateTarget());
  $('btn-reset').addEventListener('click', () => startScene(S.sceneId));
  $('btn-pause').addEventListener('click', () => togglePause());
  $('btn-slow').addEventListener('click', () => toggleSlow());
  $('btn-fit').addEventListener('click', () => fitTarget());
  $('btn-clean').addEventListener('click', () => document.body.classList.toggle('clean'));
  $('btn-cut').addEventListener('click', () => openChamber(S.state.target));
  const ms = $('melt-sec');
  const msOut = $('melt-sec-out');
  const upd = () => { msOut.textContent = `${Number(ms.value).toFixed(2).replace('.', ',').replace(/0$/, '')} s`; };
  ms.addEventListener('input', upd); upd();
  const sel = $('weapon');
  sel.innerHTML = DEMO_WEAPONS.map((id, i) => `<option value="${id}">${i + 1}. ${MASTER_WEAPONS[id]?.name || id}</option>`).join('');
  sel.addEventListener('change', () => { gun.weaponId = sel.value; });
  $('lock').addEventListener('change', () => { S.lock = $('lock').checked; });
  $('autofire').addEventListener('change', () => { S.autofire = $('autofire').checked; });
  const optMap = {
    'o-fireball': 'fireball', 'o-smoke': 'smoke', 'o-sparks': 'sparks', 'o-debris': 'debris', 'o-frags': 'frags',
    'o-lights': 'lights', 'o-arcs': 'arcs', 'o-heat': 'heat', 'o-vents': 'vents', 'o-implosion': 'implosion',
    'o-shock': 'shock', 'o-haze': 'haze', 'o-post': 'post'
  };
  for (const [id, key] of Object.entries(optMap)) {
    $(id).addEventListener('change', () => { fx.opts[key] = $(id).checked; });
  }
}

function targetCore() {
  return coreOf(S.state.target) || cores.find((c) => c.state !== RC.CORE_STATE.DETONATED && RC.reactorHull(c.host)) || null;
}
function meltdownTarget() {
  const c = targetCore();
  if (c) world.forceMeltdown(c, Number($('melt-sec').value) || 3.5, variantPick());
}
function detonateTarget() {
  const c = targetCore();
  if (c) world.detonateNow(c, variantPick());
}
function togglePause() {
  S.paused = !S.paused;
  $('btn-pause').classList.toggle('on', S.paused);
}
function toggleSlow() {
  S.timeScale = S.timeScale === 1 ? 0.25 : 1;
  $('btn-slow').classList.toggle('on', S.timeScale !== 1);
}
function fitTarget() {
  const t = S.state.target;
  if (t && RC.reactorHull(t)) fitOn(t, 0.5);
  else setCamera(S.cam.x, S.cam.y, 0.35);
}

function bindInput() {
  canvas2d.addEventListener('mousemove', (e) => {
    const m = S.mouse;
    if (m.pan) {
      S.cam.x -= (e.clientX - m.lastX) / S.cam.zoom;
      S.cam.y -= (e.clientY - m.lastY) / S.cam.zoom;
      S.camTo = null;
    }
    m.x = e.clientX; m.y = e.clientY; m.lastX = e.clientX; m.lastY = e.clientY;
  });
  canvas2d.addEventListener('mousedown', (e) => {
    const m = S.mouse;
    m.lastX = e.clientX; m.lastY = e.clientY;
    if (e.button === 1 || (e.button === 0 && e.altKey)) { m.pan = true; e.preventDefault(); return; }
    if (e.button === 0) {
      S.firing = true;
      if (S.sceneId !== 'range') m.pan = true;
    }
  });
  window.addEventListener('mouseup', () => { S.firing = false; S.mouse.pan = false; });
  canvas2d.addEventListener('wheel', (e) => {
    e.preventDefault();
    const before = screenToWorld(e.clientX, e.clientY);
    const z = Math.min(8, Math.max(0.05, S.cam.zoom * Math.exp(-e.deltaY * 0.0012)));
    S.cam.zoom = z;
    const after = screenToWorld(e.clientX, e.clientY);
    S.cam.x += before.x - after.x;
    S.cam.y += before.y - after.y;
    S.camTo = null;
  }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT')) return;
    const k = e.key.toLowerCase();
    const sceneKeys = { 1: 'gallery', 2: 'meltdown', 3: 'chain', 4: 'jet', 5: 'orb', 6: 'range' };
    if (sceneKeys[k] && S.sceneId !== 'range') { startScene(sceneKeys[k]); return; }
    if (S.sceneId === 'range' && /^[1-5]$/.test(k)) {
      const idx = Number(k) - 1;
      if (DEMO_WEAPONS[idx]) { gun.weaponId = DEMO_WEAPONS[idx]; $('weapon').value = gun.weaponId; }
      return;
    }
    if (k === ' ') { togglePause(); e.preventDefault(); }
    else if (k === 't') toggleSlow();
    else if (k === 'r') startScene(S.sceneId);
    else if (k === 'm') meltdownTarget();
    else if (k === 'd') detonateTarget();
    else if (k === 'f') fitTarget();
    else if (k === 'h') document.body.classList.toggle('clean');
    else if (k === 'z') focusCore(S.state.target, 1.4);
    else if (k === 'k') openChamber(S.state.target);
    else if (k === 'l') { S.lock = !S.lock; $('lock').checked = S.lock; }
    else if (k === 'g') { S.autofire = !S.autofire; $('autofire').checked = S.autofire; }
    else if (k === 'w') { fx.opts.shock = !fx.opts.shock; $('o-shock').checked = fx.opts.shock; }
    else if (k === 'v') {
      const sel = $('variant');
      sel.selectedIndex = (sel.selectedIndex + 1) % sel.options.length;
      world.variantOverride = variantPick();
      log(`wariant: ${sel.options[sel.selectedIndex].text}`);
    } else if (k === 'escape' && S.sceneId === 'range') startScene('gallery');
    else if (k === 'arrowup' || k === 'arrowdown' || k === 'arrowleft' || k === 'arrowright') {
      const step = 120 / S.cam.zoom;
      if (k === 'arrowup') S.cam.y -= step; else if (k === 'arrowdown') S.cam.y += step;
      else if (k === 'arrowleft') S.cam.x -= step; else S.cam.x += step;
      S.camTo = null;
      e.preventDefault();
    }
  });
  window.addEventListener('resize', () => {
    W = innerWidth; H = innerHeight;
    canvas2d.width = W; canvas2d.height = H;
    glCanvas.width = W; glCanvas.height = H;
    resizeHexShips3D(W, H);
  });
}

// ---------------------------------------------------------------------------
// API konsoli / harnessu
window.__rdzen2 = {
  ready: false,
  S,
  RC,
  get world() { return world; },
  get fx() { return fx; },
  get reactor3D() { return reactor3D; },
  scene(id) { startScene(id); return true; },
  setVariant(v) { $('variant').value = v || ''; world.variantOverride = variantPick(); return true; },
  setCamera(x, y, zoom) { setCamera(x, y, zoom); return true; },
  focus(zoom = 1.3) { focusCore(S.state.target, zoom); return true; },
  fit(zoom = 0.5) { fitOn(S.state.target, zoom); return true; },
  pause(b = true) { S.paused = !!b; return true; },
  setTimeScale(v) { S.timeScale = Number(v) || 1; return true; },
  opt(key, v) { fx.opts[key] = !!v; const el = document.querySelector(`[id="o-${key}"]`); if (el) el.checked = !!v; return true; },
  meltdown(sec = 3.5, variant = null) { const c = targetCore(); if (c) world.forceMeltdown(c, sec, variant); return !!c; },
  detonate(variant = null) { const c = targetCore(); if (c) world.detonateNow(c, variant); return !!c; },
  openChamber() { openChamber(S.state.target); return true; },
  sceneTime() { return S.sceneT; },
  /**
   * Histogram luminancji bufora sceny (HalfFloat, PRZED bloomem i ACES) w prostokącie ekranu —
   * plan pasm HDR: ile pikseli ponad próg bloomu 0,9, ile w paśmie barwy 0,4–1,3, ile bieli ≥ 6.
   * Bez kroku czasu (klatka renderu z dt = 0, bloom wyłączony na czas pomiaru).
   */
  /** Ta sama klatka jeszcze raz (dt = 0, z bloomem) z ukrytymi siatkami — A/B warstw na zrzucie. */
  still(hide = null) {
    const hideSet = Array.isArray(hide) && hide.length ? new Set(hide) : null;
    const hook = hideSet ? () => { Core3D.scene.traverse((o) => { if (o.isMesh && hideSet.has(o.name)) o.visible = false; }); } : null;
    if (hook) { Core3D.addPassHook('ortho', hook); Core3D.addPassHook('shields', hook); }
    try {
      render(0, 0);
    } finally {
      if (hook) { Core3D.removePassHook('ortho', hook); Core3D.removePassHook('shields', hook); }
    }
    return true;
  },
  meshNames() {
    const out = {};
    Core3D.scene.traverse((o) => { if (o.isMesh) out[o.name || '?'] = (out[o.name || '?'] || 0) + 1; });
    return out;
  },
  async hdr(x0 = 0, y0 = 0, w = W, h = H, hide = null) {
    const renderer = Core3D.renderer;
    const rt = Core3D.composerTarget;
    const bloomWas = Core3D.perfToggles.bloom;
    Core3D.setPerfToggles({ bloom: false });
    // A/B warstw: siatki o podanych nazwach ukryte tuż przed passem ortho (commit pul ustawia
    // widoczność co klatkę — hak passa jest po nim).
    const hideSet = Array.isArray(hide) && hide.length ? new Set(hide) : null;
    const hook = hideSet ? () => { Core3D.scene.traverse((o) => { if (o.isMesh && hideSet.has(o.name)) o.visible = false; }); } : null;
    if (hook) { Core3D.addPassHook('ortho', hook); Core3D.addPassHook('shields', hook); }
    try {
      render(0, 0);
    } finally {
      if (hook) { Core3D.removePassHook('ortho', hook); Core3D.removePassHook('shields', hook); }
    }
    const pr = Core3D.pixelRatio || 1;
    const x = Math.max(0, Math.min(rt.width - 1, Math.floor(x0 * pr)));
    const y = Math.max(0, Math.min(rt.height - 1, Math.floor(y0 * pr)));
    const px = Math.max(1, Math.min(rt.width - x, Math.floor(w * pr)));
    const py = Math.max(1, Math.min(rt.height - y, Math.floor(h * pr)));
    const buf = await renderer.readRenderTargetPixelsAsync(rt, x, y, px, py);
    Core3D.setPerfToggles({ bloom: bloomWas });
    const isHalf = buf instanceof Uint16Array;
    const rowElems = Math.ceil((px * 4 * buf.BYTES_PER_ELEMENT) / 256) * 256 / buf.BYTES_PER_ELEMENT;
    const half = (v) => {
      const s = (v & 0x8000) ? -1 : 1;
      const e = (v >> 10) & 0x1f;
      const f = v & 0x3ff;
      if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
      if (e === 31) return f ? NaN : s * Infinity;
      return s * Math.pow(2, e - 15) * (1 + f / 1024);
    };
    const ch = (o) => (isHalf ? half(buf[o]) : buf[o]);
    let n = 0, nan = 0, over09 = 0, band = 0, white = 0, max = 0, sum = 0;
    const edges = [0.1, 0.4, 0.9, 1.3, 2, 4, 8, 12, Infinity];
    const hist = new Array(edges.length).fill(0);
    for (let i = 0; i < px * py; i++) {
      const o = Math.floor(i / px) * rowElems + (i % px) * 4;
      const L = 0.2126 * ch(o) + 0.7152 * ch(o + 1) + 0.0722 * ch(o + 2);
      if (!Number.isFinite(L)) { nan++; continue; }
      n++; sum += L;
      if (L > max) max = L;
      if (L > 0.9) over09++;
      if (L >= 0.4 && L <= 1.3) band++;
      if (L >= 6) white++;
      let k = 0;
      while (L >= edges[k]) k++;
      hist[k]++;
    }
    return { pixels: n, nan, max, mean: n ? sum / n : 0, over09: n ? over09 / n : 0, band: n ? band / n : 0, white: n ? white / n : 0, hist };
  },
  /** Klatki z zegarem ręcznym (harness): n klatek po 1/fps; realtime — czeka na rAF (GPU nadąża). */
  async runFrames(n = 1, fps = 60, o = {}) {
    for (let i = 0; i < n; i++) {
      frame(1 / fps);
      if (o.realtime || (i % 8) === 7) await new Promise((ok) => requestAnimationFrame(() => ok()));
    }
    return true;
  },
  stats() {
    return {
      scene: S.sceneId, t: S.sceneT, time: world.time, fx: { ...fx.stats, live: { ...(fx.stats.live || {}) } },
      reactor: { ...reactor3D.stats }, cores: cores.map((c) => RC.summarizeReactorCore(c)),
      ships: world.ships.length, wrecks: world.wrecks.length, detonations: world.detonations, render: renderStats(),
      smoke: rocketFx?.smoke?.stats?.alive || 0
    };
  }
};

// ---------------------------------------------------------------------------
(async () => {
  try {
    await loadHullAssets();
    if (!(await Core3D.ready)) {
      $('nogpu').style.display = 'flex';
      $('nogpu-detail').textContent = Core3D.gpuError || 'brak adaptera WebGPU';
      $('loading').style.display = 'none';
      window.__rdzen2.error = 'webgpu';
      return;
    }
    await Core3D.warmup.run('kadłuby, mapa ran, broń (hexShips3D)', () => prewarmHexShips3D({ canvas: glCanvas }));
    setupFx();
    world = new World({ fx, onLog: log });
    gun = new Gun();
    bindPanel();
    bindInput();
    startScene(S.sceneId);
    await Core3D.warmup.flush?.({ timeoutMs: 6000 });
    $('loading').style.display = 'none';
    window.__rdzen2.ready = true;
    requestAnimationFrame(loop);
  } catch (err) {
    reportError(err.stack || String(err));
  }
})();
