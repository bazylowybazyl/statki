// Demo MOSTKÓW na WebGPU — nowa wersja dema mostków (stare: dema/mostki-demo.html, kadłuby
// heksowe destruktora, którego gra od zadania 21 nie używa). Wszystko jak w grze: Core3D (WebGPU,
// TSL, bloom, ACES), kadłuby na silniku belek (HullBodies + skóra hexShips3D z dyszami i światłami
// pozycyjnymi z edytora), mapa ran, efekty broni (WeaponFx), iskry (SparkSystem3D), siatka świateł.
// Mostki: logika na komórkach siatki belek (src/game/shipBridgeBeams.js), model 3D nadbudówki
// z wyrwami po komórkach (bridge3D.js, tryb siatki kwadratowej), wyrzut atmosfery, przepięcia
// i osmalenie wyrwy (bridgeFx3D.js), agonia hulka → wrak (jak finishBridgeKill w grze).
//
// Serwowanie: `npm run dev` → /dema/mostki-webgpu.html
//   ?scene=kill|atlas|sever|fleet|close|range   ?hull=<klucz kadłuba>
//   ?test=1 (klatki tylko z __mostki2.runFrames — harness)   ?clean=1 (bez paneli)
import { Core3D } from '../src/3d/core3d.js';
import { initHexShips3D, updateHexShips3D, drawHexShips3D, resizeHexShips3D, prewarmHexShips3D } from '../src/3d/hexShips3D.js';
import { HULL_LACQUER_DEFAULTS } from '../src/3d/hullLacquer.js';
import { SparkSystem3D } from '../src/3d/sparkSystem3D.js';
import { WeaponFx } from '../src/3d/weapons/weaponFx.js';
import { HullDamageMap } from '../src/3d/hullDamageMap.js';
import { Bridge3D, BRIDGE3D_TUNE } from '../src/3d/bridge3D.js';
import { BridgeFx3D, BRIDGE_FX_TUNE } from '../src/3d/bridgeFx3D.js';
import { HullBodies } from '../src/game/hullBodies.js';
import { SimClock } from '../src/game/simClock.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';
import {
  BRIDGE_HULK_SEC,
  applyBridgeHulkVisuals,
  bridgePngToWorld,
  getBridgeAimPoint,
  isBridgeHulk,
  noteBridgeHit
} from '../src/game/shipBridgeRuntime.js';
import { bridgeZoneCorners, commandLossAge, getShipBridgeSummary } from '../src/game/shipBridge.js';
import { World, loadHullAssets } from './mostki-webgpu/swiat.js';
import { Gun, DEMO_WEAPONS } from './mostki-webgpu/bron.js';
import { SCENES } from './mostki-webgpu/sceny.js';
import { BRIDGE_DEMO_HULLS, BRIDGE_DEMO_ORDER } from './mostki-webgpu/kadluby.js';
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

// ---------------------------------------------------------------------------
// Stan
const S = {
  sceneId: SCENES[params.get('scene')] ? params.get('scene') : 'kill',
  sceneT: 0,
  sceneRun: 0,
  sceneOnce: new Set(),
  paused: false,
  timeScale: 1,
  acc: 0,
  frame: 0,
  cam: { x: 0, y: 0, zoom: 0.5 },
  camTo: null,
  shake: 0,
  shakeT: 0,
  mouse: { x: 0, y: 0, wx: 0, wy: 0, pan: false, lastX: 0, lastY: 0 },
  firing: false,
  autofire: false,
  lock: true,
  zones: false,
  frameMs: 16,
  cpuMs: 0,
  log: [],
  aimMemory: {},
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
  $('log').innerHTML = S.log.map((l) => `<div style="color:${l.cls === 'bad' ? '#ff9a90' : (l.cls === 'warn' ? '#f0c080' : '#c9d6dd')}">${l.text.replace(/</g, '&lt;')}</div>`).join('');
}

// ---------------------------------------------------------------------------
// Render: Core3D + hexShips3D (skóra kadłubów belkowych, dysze, światła), efekty gry
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
let backdrop = null;

function setupFx() {
  backdrop = createBackdrop(Core3D);
  SparkSystem3D.init(Core3D.scene);
  window.SparkSystem3D = SparkSystem3D;
  WeaponFx.ensure();
  // Jak w grze (index.html): wyrzut atmosfery i łuki przepięć (pula ARC broni), model 3D mostka.
  BridgeFx3D.attach(Core3D.scene, { weaponFx: WeaponFx });
  Bridge3D.attach(Core3D.scene);
  Core3D.warmup.add({ name: 'mostki 3D (bridge3D, szczeliny)', objects: () => [...Bridge3D.warmupMeshes(), BridgeFx3D.mesh].filter(Boolean), phase: 'loading' });
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
function hullLength(e) {
  const h = e?.beamHull;
  return h ? Math.max(h.srcWidth, h.srcHeight) * h.scale : 600;
}
function fitOn(e, zoom = 'auto', rate = 0) {
  if (!e) return;
  // Kadr: kadłub na ~¾ szerokości wolnej od panelu (wąskie okno — całej szerokości).
  const free = W > 900 ? W - 330 : W;
  const z = zoom === 'auto' || !Number.isFinite(zoom) ? Math.min(2.2, Math.max(0.06, free * 0.62 / hullLength(e))) : zoom;
  if (rate > 0) flyTo(e.x, e.y, z, rate);
  else setCamera(e.x, e.y, z);
}
function bridgeCenter(e, idx = 0, out = {}) {
  const st = e?.bridgeState;
  const def = st?.bridges?.[idx]?.def;
  if (!def) { out.x = e?.x || 0; out.y = e?.y || 0; return out; }
  return bridgePngToWorld(e, def.x, def.y, out);
}
function focusBridge(e, zoom = null, rate = 0) {
  if (!e?.bridgeState) return fitOn(e, 'auto', rate);
  const p = bridgeCenter(e, 0);
  const def = e.bridgeState.bridges[0].def;
  const zoneW = Math.max(def.w * e.bridgeState.scaleX, def.h * e.bridgeState.scaleY) * (e.beamHull?.scale || 1);
  const z = Number.isFinite(zoom) ? zoom : Math.min(1.8, Math.max(0.3, W * 0.16 / Math.max(20, zoneW)));
  if (rate > 0) flyTo(p.x, p.y, z, rate);
  else setCamera(p.x, p.y, z);
}
function screenToWorld(sx, sy) {
  return { x: S.cam.x + (sx - W * 0.5) / S.cam.zoom, y: S.cam.y + (sy - H * 0.5) / S.cam.zoom };
}

// ---------------------------------------------------------------------------
// Akcje
function hullPick() {
  return $('hull').value || null;
}

function fireAtBridge(e, bridgeId = null, mode = 'breach') {
  if (!e || !e.bridgeState || e.dead) return false;
  const p = getBridgeAimPoint(e, {}, { mode, fromX: gun.x, fromY: gun.y, memory: S.aimMemory, bridgeId });
  if (!p) return false;
  return gun.fire(p.x, p.y) > 0;
}

// Hexlance w poprzek kadłuba tuż przed nadbudówką (od dziobu): odłam z mostkiem odlatuje.
function severBridge(e) {
  const st = e?.bridgeState;
  if (!st) return;
  const def = st.bridges[0].def;
  const xCut = def.x + def.w * 0.5 + Math.max(24, def.w * 0.12);
  const span = (BRIDGE_DEMO_HULLS[e.__hullKey] ? e.beamHull.srcHeight / st.scaleY : 900) * 0.8;
  const a = bridgePngToWorld(e, xCut, -span, {});
  const b = bridgePngToWorld(e, xCut, span, {});
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = Math.hypot(dx, dy) || 1;
  const reach = 260;
  gun.lance(a.x - dx / L * reach, a.y - dy / L * reach, b.x + dx / L * reach, b.y + dy / L * reach, 9000,
    Math.max(14, e.beamHull.cellSize * 1.25));
}

// Kanał od burty do nadbudówki (rzaz jak rozdarcie — ciemny, poszarpany brzeg): strzały w odsłonięty
// mostek od razu robią wyrwy w modelu (scena zbliżenia). side: +1 / −1 — burta (y obrazka).
function openToBridge(e, side = -1) {
  const st = e?.bridgeState;
  if (!st) return;
  const def = st.bridges[0].def;
  const edge = def.y + side * def.h * 0.5;
  const out = side * (e.beamHull.srcHeight / st.scaleY) * 0.75;
  const a = bridgePngToWorld(e, def.x + def.w * 0.1, out, {});
  const b = bridgePngToWorld(e, def.x + def.w * 0.1, edge - side * def.h * 0.08, {});
  HullDamageMap.setSource('tear', 'impact');
  try {
    HullBodies.cutSegment(e, a.x, a.y, b.x, b.y, Math.max(e.beamHull.cellSize * 1.4, def.w * st.scaleX * 0.09), { push: true });
  } finally {
    HullDamageMap.clearSource();
  }
  // Oś kanału (wylot → dno) — działo strzela wzdłuż niej.
  return { ax: a.x, ay: a.y, bx: b.x, by: b.y };
}

// Mały krater (scena zbliżenia): wzdłuż osi kanału (pierwsza blacha na linii — dno kanału, potem
// coraz głębiej w nadbudówkę), bez kanału — w komórce mostka najbliższej działu.
function drillBridge(e, channel = null) {
  let p = null;
  if (channel) {
    p = { x: channel.bx + (channel.bx - channel.ax) * 0.8, y: channel.by + (channel.by - channel.ay) * 0.8 };
    // lekki rozrzut wzdłuż nadbudówki — wyrwa rośnie wachlarzem, nie jednym otworem
    const L = Math.hypot(channel.bx - channel.ax, channel.by - channel.ay) || 1;
    const nx = -(channel.by - channel.ay) / L, ny = (channel.bx - channel.ax) / L;
    const j = (Math.random() - 0.5) * e.beamHull.cellSize * 3;
    p.x += nx * j; p.y += ny * j;
  } else {
    p = getBridgeAimPoint(e, {}, { mode: 'exposed', fromX: gun.x, fromY: gun.y });
  }
  if (!p) return false;
  return gun.drill(e, p.x, p.y, e.beamHull.cellSize * 0.75);
}

// Mostek pada od razu (scena floty): krater na miarę strefy w środku mostka, gaz ucieka „w górę”.
function killBridge(e) {
  const st = e?.bridgeState;
  if (!st || st.commandLost) return;
  for (let b = 0; b < st.bridges.length; b++) {
    const bridge = st.bridges[b];
    if (bridge.dead || bridge.missing) continue;
    const p = bridgeCenter(e, b);
    const r = Math.max(bridge.def.w * st.scaleX, bridge.def.h * st.scaleY) * 0.42 * e.beamHull.scale;
    noteBridgeHit(e, p.x, p.y, 0, 2000, world.time);
    HullDamageMap.setSource('special_yamato_cannon', 'impact');
    try {
      HullBodies.impact(e, p.x, p.y, 4000, { x: 0, y: 2000 }, { craterRadius: Math.max(e.beamHull.cellSize * 0.8, r) });
    } finally {
      HullDamageMap.clearSource();
    }
  }
}

function targetShip() {
  const t = S.state.target;
  if (t && !t.dead && world.ships.includes(t)) return t;
  return world.ships.find((s) => s.bridgeState && !s.dead) || null;
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
  fitOn, focusBridge, setCamera, flyTo, hullPick, bridgeCenter, hullLength, fireAtBridge, severBridge, killBridge, openToBridge, drillBridge,
  setTimeScale(v) { S.timeScale = v; $('btn-slow').classList.toggle('on', v !== 1); },
  setSceneTitle(text) { $('scene-name').textContent = text; },
  nextRun() { S.sceneRun++; startScene(S.sceneId, true); }
};

function startScene(id = S.sceneId, keepRun = false) {
  const prev = SCENES[S.sceneId];
  prev?.end?.(D);
  const sc = SCENES[id] || SCENES.kill;
  S.sceneId = id;
  if (!keepRun) S.sceneRun = 0;
  S.sceneT = 0;
  S.sceneOnce.clear();
  S.aimMemory = {};
  for (const k of Object.keys(S.state)) delete S.state[k];
  world.clear();
  gun.bullets.length = 0;
  gun.lances.length = 0;
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
}

// ---------------------------------------------------------------------------
// Klatka
const cullInfo = { x: 0, y: 0, halfW: 1e5, halfH: 1e5, drawHalfW: 1e5, drawHalfH: 1e5 };
let lastT = performance.now();
const renderList = [];

function physicsStep(dt) {
  if ((S.firing || S.autofire) && S.sceneId === 'range') {
    const t = targetShip();
    if (S.lock && t) fireAtBridge(t);
    else gun.fire(S.mouse.wx, S.mouse.wy);
  }
  world.step(dt, gun);
  tickScene(dt);
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
  if (S.camTo) {
    const k = 1 - Math.exp(-S.camTo.rate * realDt);
    S.cam.x += (S.camTo.x - S.cam.x) * k;
    S.cam.y += (S.camTo.y - S.cam.y) * k;
    S.cam.zoom = Math.exp(Math.log(S.cam.zoom) + (Math.log(S.camTo.zoom) - Math.log(S.cam.zoom)) * k);
    if (Math.abs(S.camTo.zoom - S.cam.zoom) < 1e-3 && Math.hypot(S.camTo.x - S.cam.x, S.camTo.y - S.cam.y) < 1) S.camTo = null;
  }
  S.mouse.wx = S.cam.x + (S.mouse.x - W * 0.5) / S.cam.zoom;
  S.mouse.wy = S.cam.y + (S.mouse.y - H * 0.5) / S.cam.zoom;
  Core3D.beginPlanetLayerFrame?.();
  SimClock.beginRender(1, PHYS_DT, S.paused || simDt <= 0);
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
  // Kolejność jak render() gry: hulki (dysze, światła) → model mostka → wyrzut i szczeliny → kadłuby.
  applyBridgeHulkVisuals(renderList, world.time);
  Bridge3D.update(renderList, { nowSec: world.time, dt: simDt, zoom: cam.zoom, cull: cullInfo, camera: cam });
  BridgeFx3D.update(renderList, { nowSec: world.time, dt: simDt, zoom: cam.zoom, camera: cam });
  backdrop.sync(cam, W, H);
  updateHexShips3D(cam, renderList, cullInfo);
  drawHexShips3D(ctx2d, W, H);
  drawOverlay(cam);
  updateHud();
  updateBanner();
}

function drawOverlay(cam) {
  if (document.body.classList.contains('clean')) return;
  const toS = (x, y) => ({ x: (x - cam.x) * cam.zoom + W * 0.5, y: (y - cam.y) * cam.zoom + H * 0.5 });
  ctx2d.save();
  if (S.sceneId === 'range' || S.sceneId === 'close' || S.sceneId === 'kill' || S.sceneId === 'atlas') {
    const g = toS(gun.x, gun.y);
    ctx2d.strokeStyle = '#7cc9ff';
    ctx2d.lineWidth = 1.5;
    ctx2d.beginPath(); ctx2d.arc(g.x, g.y, 7, 0, Math.PI * 2); ctx2d.stroke();
  }
  // Strefy mostków (PNG → świat): zielone żywe, czerwone martwe; etykieta z integralnością.
  if (S.zones) {
    const corners = [];
    const w = {};
    ctx2d.font = '11px ui-monospace, Consolas, monospace';
    for (const e of world.ships) {
      const st = e.bridgeState;
      if (!st) continue;
      for (const b of st.bridges) {
        bridgeZoneCorners(b.def, corners);
        ctx2d.strokeStyle = b.dead ? '#ff6a5a' : '#7be0a0';
        ctx2d.setLineDash([5, 4]);
        ctx2d.beginPath();
        for (let k = 0; k < corners.length; k += 2) {
          bridgePngToWorld(e, corners[k], corners[k + 1], w);
          const p = toS(w.x, w.y);
          if (k === 0) ctx2d.moveTo(p.x, p.y); else ctx2d.lineTo(p.x, p.y);
        }
        ctx2d.closePath();
        ctx2d.stroke();
        ctx2d.setLineDash([]);
        bridgePngToWorld(e, b.def.x, b.def.y, w);
        const p = toS(w.x, w.y);
        ctx2d.fillStyle = ctx2d.strokeStyle;
        ctx2d.fillText(`${b.def.label} ${Math.round(b.integrity * 100)}%`, p.x + 6, p.y - 6);
      }
    }
  }
  // Namiar na mostek (strzelnica).
  const t = targetShip();
  if (S.sceneId === 'range' && S.lock && t?.bridgeState && !t.bridgeState.commandLost) {
    const p0 = getBridgeAimPoint(t, {}, { mode: 'breach', fromX: gun.x, fromY: gun.y });
    if (p0) {
      const p = toS(p0.x, p0.y);
      ctx2d.strokeStyle = '#ffcc66';
      ctx2d.setLineDash([4, 4]);
      ctx2d.beginPath(); ctx2d.arc(p.x, p.y, 12, 0, Math.PI * 2); ctx2d.stroke();
      ctx2d.setLineDash([]);
    }
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
  const t = targetShip() || S.state.target;
  if (t?.bridgeState) {
    const bst = t.bridgeState;
    const cls = bst.commandLost ? 'bad' : 'good';
    const age = commandLossAge(t, world.time);
    lines.push(`${t.__label}: <span class="${cls}">${bst.commandLost ? `UTRATA DOWODZENIA — agonia ${age.toFixed(1)} / ${BRIDGE_HULK_SEC.toFixed(0)} s` : 'dowodzenie sprawne'}</span>`);
  } else if (t) {
    lines.push(`${t.__label}: ${t.dead ? 'wrak' : 'bez mostka'}`);
  }
  const B = Bridge3D.stats;
  lines.push(`modele ${B.visible} / rekordy ${B.records} · okna ${B.emitters} · draw mostków ${B.drawCalls} · CPU ${(B.cpuMs || 0).toFixed(3)} ms`);
  const F = BridgeFx3D.stats;
  lines.push(`wyrzuty ${F.vents} · łuki ${F.arcs} · światła ${F.lights} · błyski pomieszczeń ${F.flashes}`);
  lines.push(`okręty ${world.ships.length} · wraki ${world.wrecks.length} · utrat dowodzenia ${world.kills}`);
  if (S.sceneId === 'range') lines.push(`broń: ${MASTER_WEAPONS[gun.weaponId]?.name || gun.weaponId}${S.lock ? ' · namiar na mostek' : ''}${S.autofire ? ' · ogień ciągły' : ''} · strzałów ${gun.shots}`);
  $('hud').innerHTML = lines.join('\n');
  // Paski mostków celu (panel).
  const sum = t?.bridgeState ? getShipBridgeSummary(t) : [];
  $('bridges').innerHTML = sum.map((b) => `<div class="b">${b.label}${b.role === 'backup' ? ' (zapasowy)' : ''} — ${b.dead ? '<span style="color:#ff5a52">ZNISZCZONY</span>' : `${b.alive}/${b.total} komórek`}
    <div class="bar"><i style="width:${(b.integrity * 100).toFixed(1)}%;background:${b.dead ? '#ff5a52' : '#7be0a0'}"></i><s style="left:${(b.threshold * 100).toFixed(1)}%"></s></div></div>`).join('');
}

function updateBanner() {
  const el = $('banner');
  let worst = null;
  for (const e of world.ships) {
    if (!isBridgeHulk(e)) continue;
    if (!worst || e.bridgeState.commandLostAt > worst.bridgeState.commandLostAt) worst = e;
  }
  if (!worst || document.body.classList.contains('clean')) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  const age = commandLossAge(worst, world.time);
  $('banner-text').textContent = `${worst.__label.toUpperCase()}: UTRATA DOWODZENIA`;
  $('banner-bar').style.width = `${Math.min(100, age / BRIDGE_HULK_SEC * 100).toFixed(1)}%`;
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
  const hullSel = $('hull');
  hullSel.innerHTML = '<option value="">kolejno (scena)</option>'
    + BRIDGE_DEMO_ORDER.map((k) => `<option value="${k}">${BRIDGE_DEMO_HULLS[k].label}</option>`).join('');
  const hull = params.get('hull');
  if (hull && BRIDGE_DEMO_HULLS[hull]) hullSel.value = hull;
  hullSel.addEventListener('change', () => startScene(S.sceneId));
  $('btn-kill').addEventListener('click', () => killBridge(targetShip()));
  $('btn-sever').addEventListener('click', () => severBridge(targetShip()));
  $('btn-reset').addEventListener('click', () => startScene(S.sceneId));
  $('btn-pause').addEventListener('click', () => togglePause());
  $('btn-slow').addEventListener('click', () => D.setTimeScale(S.timeScale === 1 ? 0.25 : 1));
  $('btn-fit').addEventListener('click', () => fitOn(targetShip() || S.state.target, 'auto'));
  $('btn-zoom').addEventListener('click', () => focusBridge(targetShip(), null));
  $('btn-clean').addEventListener('click', () => document.body.classList.toggle('clean'));
  const sel = $('weapon');
  sel.innerHTML = DEMO_WEAPONS.map((id, i) => `<option value="${id}">${i + 1}. ${MASTER_WEAPONS[id]?.name || id}</option>`).join('');
  sel.addEventListener('change', () => { gun.weaponId = sel.value; });
  $('lock').addEventListener('change', () => { S.lock = $('lock').checked; });
  $('autofire').addEventListener('change', () => { S.autofire = $('autofire').checked; });
  $('o-model').addEventListener('change', () => { BRIDGE3D_TUNE.enabled = $('o-model').checked; });
  $('o-zones').addEventListener('change', () => { S.zones = $('o-zones').checked; });
  $('o-receiver').addEventListener('change', () => { BRIDGE3D_TUNE.receiver = $('o-receiver').checked; });
  $('o-arcs').addEventListener('change', () => { BRIDGE_FX_TUNE.arcRate = $('o-arcs').checked ? 7 : 0; });
  $('o-lights').addEventListener('change', () => { BRIDGE_FX_TUNE.lightGain = $('o-lights').checked ? 1 : 0; });
  $('o-scorch').addEventListener('change', () => { BRIDGE_FX_TUNE.scorch = $('o-scorch').checked ? 1 : 0; });
}

function togglePause() {
  S.paused = !S.paused;
  $('btn-pause').classList.toggle('on', S.paused);
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
  canvas2d.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas2d.addEventListener('mousedown', (e) => {
    const m = S.mouse;
    m.lastX = e.clientX; m.lastY = e.clientY;
    if (e.button === 1 || (e.button === 0 && e.altKey)) { m.pan = true; e.preventDefault(); return; }
    if (e.button === 2) { const p = screenToWorld(e.clientX, e.clientY); gun.place(p.x, p.y); return; }
    if (e.button === 0) {
      if (S.sceneId === 'range') S.firing = true;
      else m.pan = true;
    }
  });
  window.addEventListener('mouseup', () => { S.firing = false; S.mouse.pan = false; });
  canvas2d.addEventListener('wheel', (e) => {
    e.preventDefault();
    const before = screenToWorld(e.clientX, e.clientY);
    const z = Math.min(8, Math.max(0.04, S.cam.zoom * Math.exp(-e.deltaY * 0.0012)));
    S.cam.zoom = z;
    const after = screenToWorld(e.clientX, e.clientY);
    S.cam.x += before.x - after.x;
    S.cam.y += before.y - after.y;
    S.camTo = null;
  }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT')) return;
    const k = e.key.toLowerCase();
    const sceneKeys = { 1: 'kill', 2: 'atlas', 3: 'sever', 4: 'fleet', 5: 'close', 6: 'range' };
    if (S.sceneId === 'range' && /^[1-5]$/.test(k)) {
      const id = DEMO_WEAPONS[Number(k) - 1];
      if (id) { gun.weaponId = id; $('weapon').value = id; }
      return;
    }
    if (sceneKeys[k]) { startScene(sceneKeys[k]); return; }
    if (k === ' ') { togglePause(); e.preventDefault(); }
    else if (k === 't') D.setTimeScale(S.timeScale === 1 ? 0.25 : 1);
    else if (k === 'r') startScene(S.sceneId);
    else if (k === 'k') killBridge(targetShip());
    else if (k === 'x') {
      if (S.sceneId === 'range') {
        const dx = S.mouse.wx - gun.x, dy = S.mouse.wy - gun.y, L = Math.hypot(dx, dy) || 1;
        gun.lance(gun.x, gun.y, gun.x + dx / L * (L + 1500), gun.y + dy / L * (L + 1500), 9000, 20);
      } else severBridge(targetShip());
    } else if (k === 'f') fitOn(targetShip() || S.state.target, 'auto');
    else if (k === 'z') focusBridge(targetShip(), null);
    else if (k === 'h') document.body.classList.toggle('clean');
    else if (k === 'l') { S.lock = !S.lock; $('lock').checked = S.lock; }
    else if (k === 'g') { S.autofire = !S.autofire; $('autofire').checked = S.autofire; }
    else if (k === 's') { S.zones = !S.zones; $('o-zones').checked = S.zones; }
    else if (k === 'm') { BRIDGE3D_TUNE.enabled = !BRIDGE3D_TUNE.enabled; $('o-model').checked = BRIDGE3D_TUNE.enabled; }
    else if (k === 'escape' && S.sceneId === 'range') startScene('kill');
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
window.__mostki2 = {
  ready: false,
  S,
  get world() { return world; },
  get gun() { return gun; },
  scene(id, hull = null) { if (hull != null) $('hull').value = hull; startScene(id); return true; },
  setCamera(x, y, zoom) { setCamera(x, y, zoom); return true; },
  focus(zoom = null) { focusBridge(targetShip(), zoom); return true; },
  fit(zoom = 'auto') { fitOn(targetShip() || S.state.target, zoom); return true; },
  pause(b = true) { S.paused = !!b; return true; },
  setTimeScale(v) { D.setTimeScale(Number(v) || 1); return true; },
  zones(on = true) { S.zones = !!on; return true; },
  model(on = true) { BRIDGE3D_TUNE.enabled = !!on; return true; },
  kill() { killBridge(targetShip()); return true; },
  sever() { severBridge(targetShip()); return true; },
  sceneTime() { return S.sceneT; },
  /** Ta sama klatka jeszcze raz (dt = 0) z ukrytymi siatkami o podanych nazwach — A/B warstw na zrzucie. */
  still(hide = null) {
    const hideSet = Array.isArray(hide) && hide.length ? new Set(hide) : null;
    const hidden = [];
    const hook = hideSet ? () => {
      Core3D.scene.traverse((o) => { if (o.isMesh && hideSet.has(o.name) && o.visible) { o.visible = false; hidden.push(o); } });
    } : null;
    if (hook) for (const p of ['ortho', 'shields', 'fg']) Core3D.addPassHook(p, hook);
    try {
      render(0, 0);
    } finally {
      if (hook) for (const p of ['ortho', 'shields', 'fg']) Core3D.removePassHook(p, hook);
      for (const o of hidden) o.visible = true;
    }
    return true;
  },
  meshNames() {
    const out = {};
    Core3D.scene.traverse((o) => { if (o.isMesh && o.visible) out[o.name || '?'] = (out[o.name || '?'] || 0) + 1; });
    return out;
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
    const t = targetShip() || S.state.target;
    return {
      scene: S.sceneId, t: S.sceneT, time: world.time, cam: { ...S.cam }, W, H, hullLen: t ? hullLength(t) : 0,
      ships: world.ships.length, wrecks: world.wrecks.length, kills: world.kills,
      target: t ? { label: t.__label, dead: !!t.dead, hulk: isBridgeHulk(t), bridges: t.bridgeState ? getShipBridgeSummary(t) : [] } : null,
      bridge3D: { ...Bridge3D.stats, instances: [...Bridge3D.stats.instances] },
      bridgeFx: { ...BridgeFx3D.stats },
      render: renderStats(),
      warmup: Core3D.warmup?.stats ? { ...Core3D.warmup.stats } : null
    };
  }
};

// ---------------------------------------------------------------------------
(async () => {
  try {
    await loadHullAssets(BRIDGE_DEMO_ORDER);
    if (!(await Core3D.ready)) {
      $('nogpu').style.display = 'flex';
      $('nogpu-detail').textContent = Core3D.gpuError || 'brak adaptera WebGPU';
      $('loading').style.display = 'none';
      window.__mostki2.error = 'webgpu';
      return;
    }
    await Core3D.warmup.run('kadłuby, mapa ran, broń (hexShips3D)', () => prewarmHexShips3D({ canvas: glCanvas }));
    setupFx();
    world = new World({ onLog: log });
    gun = new Gun(world);
    bindPanel();
    bindInput();
    startScene(S.sceneId);
    await Core3D.warmup.flush?.({ timeoutMs: 6000 });
    $('loading').style.display = 'none';
    window.__mostki2.ready = true;
    requestAnimationFrame(loop);
  } catch (err) {
    reportError(err.stack || String(err));
  }
})();
