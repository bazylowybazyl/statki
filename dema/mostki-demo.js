// Demo mostków — host dema: prawdziwy Core3D + hexShips3D + DestructorSystem.
// Serwowanie: `npm run dev`, potem /dema/mostki-demo.html
// Parametry adresu: ?hull=battleship|pirate_battleship|atlas|all|frigate|destroyer|
// terran_carrier|terran_supercapital|pirate_frigate|pirate_destroyer|megafreighter
//   &weapon=<id z weapons.js>&variant=<wariant mostka Atlasa>&shot=1 (bez panelu)
//
// Kolejność klatki jak render() gry: symulacja 120 Hz (update destruktora,
// pociski, integralność co 3. podkrok), raz na klatkę updateVisuals, potem
// efekty mostków, updateHexShips3D i drawHexShips3D, na końcu HUD 2D.

import * as THREE from 'three';
import { Core3D } from '../src/3d/core3d.js';
import { drawHexShips3D, initHexShips3D, prewarmHexShipVisual, updateHexShips3D } from '../src/3d/hexShips3D.js';
import { HULL_LACQUER_DEFAULTS } from '../src/3d/hullLacquer.js';
import { Fx3D, FX_PLANE_Z, sp } from '../src/3d/fxParticles3D.js';
import { BridgeFx3D, BRIDGE_FX_TUNE } from '../src/3d/bridgeFx3D.js';
import { Bridge3D, BRIDGE3D_TUNE } from '../src/3d/bridge3D.js';
import { DestructorSystem, disposeHexBody, getHexStructuralState, setHexShips3DActive } from '../src/game/destructor.js';
import { DestructorGpuSoftBody } from '../src/game/destructorGpuSoftBody.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { describeSalvage, ensureSalvageManifest, transferSalvageToWreck } from '../src/game/salvage.js';
import {
  BRIDGE_DEFAULTS,
  BRIDGE_KILL_TIMELINE,
  BRIDGE_LAYOUT_PROPOSALS,
  applyCommandLossVisuals,
  bridgeGridToWorld,
  bridgeShardIsAlive,
  bridgeWorldToGrid,
  bridgeZoneContains,
  evaluateShipBridges,
  formatBridgesJson,
  getBridgeAimPoint,
  hexCellCenter,
  noteBridgeHit,
  normalizeBridgeDef,
  releaseShipBridges,
  sampleEngineGlow,
  validateBridgeLayout
} from '../src/game/shipBridge.js';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';
import {
  HULLS,
  attachHullBridges,
  bridgeVariants,
  buildHullEntity,
  defaultBridgeVariant,
  hullRenderSize
} from './mostki-hulls.js';
import {
  DEMO_WEAPONS,
  PHYS_DT,
  addCombatTarget,
  createCombatSim,
  fireInstant,
  fireWeapon,
  reactorBlowChance,
  resolveWeapon,
  stepVisuals,
  stepWorld
} from './mostki-sim.js';
import {
  BENCH_DIRECTIONS,
  BENCH_WEAPONS,
  formatBenchMarkdown,
  runBenchPlan,
  standardPlan
} from './mostki-bench.js';
import {
  drawBridgeHexes,
  drawEditorGizmo,
  drawGrid,
  drawGunAndAim,
  drawHardpoints,
  drawInfo,
  drawMessages,
  drawZones,
  makeView
} from './mostki-hud.js';
import { createZoneEditor, formatZonesExport } from './mostki-editor.js';

const DEG = Math.PI / 180;
const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
if (params.get('shot') === '1') document.body.classList.add('shot');

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
// Zegar dema. Pauza i zwolnienie czasu muszą objąć WSZYSTKO — shadery,
// cząstki Fx3D, dysze, fizykę — a te moduły liczą czas z performance.now().
// Podmieniamy go na zegar wirtualny (tylko w demie).
const realNow = performance.now.bind(performance);
const clock = { virtual: realNow(), lastReal: realNow(), scale: 1, paused: false };
performance.now = () => clock.virtual;
function tickClock() {
  const r = realNow();
  const d = Math.min(100, Math.max(0, r - clock.lastReal));
  clock.lastReal = r;
  if (!clock.paused) clock.virtual += d * clock.scale;
  return d;
}

// ---------------------------------------------------------------------------
// Kanwy i Core3D (jak w grze: WebGL w ukrytej kanwie, klatka kopiowana na 2D).
const canvas = $('c');
const ctx = canvas.getContext('2d');
const glCanvas = $('webgl-layer');
let W = canvas.width = innerWidth;
let H = canvas.height = innerHeight;
glCanvas.width = W;
glCanvas.height = H;

// Lakier kadłubów: ścieżka obłoków jest względna do index.html — z /dema/ trzeba wyżej.
window.__hullLacquerTune = { ...HULL_LACQUER_DEFAULTS, skyUrl: '../assets/reflections/lacquer-sky.png' };
initHexShips3D({ canvas: glCanvas });
setHexShips3DActive(true);
// Jak index.html:816 — ścieżka rwania GPU soft body woła destroyShard przez window.
window.DestructorSystem = DestructorSystem;
Core3D.renderer.debug.onShaderError = (gl, program, vs, fs) => {
  reportError(`SHADER: ${[gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs)].filter(Boolean).join('\n')}`);
};
BridgeFx3D.attach(Core3D.scene);
// Model 3D mostka (src/3d/bridge3D.js) — w grze ten sam hak obok BridgeFx3D.
Bridge3D.attach(Core3D.scene);
if (params.get('model') === '0') BRIDGE3D_TUNE.enabled = false;

const cam = { x: 0, y: 0, zoom: 0.8 };
window.camera = cam;
// Słońce daleko w lewo-górę — kadłuby dostają światło boczne jak w układzie gry.
window.SUN = { x: -52000, y: -38000, r: 2600 };
window.bullets = [];

// Tło: gwiazdy na warstwie 1 (pass BG, kamera perspektywiczna).
(function addStars() {
  const n = 2600;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (rnd() - 0.5) * 160000;
    pos[i * 3 + 1] = (rnd() - 0.5) * 100000;
    pos[i * 3 + 2] = -60000 - rnd() * 40000;
    const b = Math.pow(rnd(), 6) * 1.4 + 0.08;
    const tint = rnd();
    col[i * 3] = b * (0.85 + 0.15 * tint);
    col[i * 3 + 1] = b * 0.92;
    col[i * 3 + 2] = b * (1.05 - 0.15 * tint);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.layers.set(1);
  Core3D.scene.add(pts);
})();

// ---------------------------------------------------------------------------
// Stan dema (+ zapis ustawień i stref w localStorage — tylko wygoda).
const SAVE_KEY = 'mostkiDemo.v2';
function loadSaved() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null') || {}; } catch { return {}; }
}
function saveState() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      zones: state.zones, armorMul: state.armorMul, killFrac: state.killFrac, weaponId: state.weaponId,
      overlays: state.overlays, atlasVariant: state.atlasVariant
    }));
  } catch { /* prywatne okno / zablokowane dane — bez zapisu */ }
}

function proposalZones() {
  const out = {};
  for (const key of Object.keys(HULLS)) {
    out[key] = {};
    for (const [variant, list] of Object.entries(bridgeVariants(key))) out[key][variant] = list.map((d) => ({ ...d }));
  }
  return out;
}

const saved = loadSaved();
const state = {
  hull: params.get('hull') || 'battleship',
  focus: 'battleship',
  atlasVariant: params.get('variant') || saved.atlasVariant || defaultBridgeVariant('atlas'),
  armorMul: Number(params.get('armor')) || saved.armorMul || BRIDGE_DEFAULTS.armorMul,
  killFrac: Number(params.get('kill')) || saved.killFrac || BRIDGE_DEFAULTS.killFrac,
  weaponId: params.get('weapon') || saved.weaponId || 'heavy_autocannon',
  gunDir: params.get('gun') || 'burta',
  lock: params.get('lock') === '1',
  autoFire: false,
  spinDeg: 0,
  drift: 0,
  shield: false,
  returnFire: true,
  timeScale: 1,
  overlays: { grid: false, zone: true, bridgeHexes: false, hardpoints: false, info: true, aim: true, ...(saved.overlays || {}) },
  fixProbe: params.get('nofix') !== '1',
  // Hulk → wrak po BRIDGE_KILL_TIMELINE.sequenceEnd (jak finishBridgeKill w grze).
  hulkToWreck: params.get('wreck') !== '0',
  // Gra: ×1. `?pool=0.5` — eksperyment balansu z raportu (mostek staje się
  // realną alternatywą dla puli HP).
  poolMul: Math.min(1, Math.max(0.1, Number(params.get('pool')) || 1)),
  zones: saved.zones && typeof saved.zones === 'object' ? { ...proposalZones(), ...saved.zones } : proposalZones(),
  editBridge: 0
};
if (!MASTER_WEAPONS[state.weaponId]) state.weaponId = 'heavy_autocannon';
state.focus = state.hull === 'all' ? 'battleship' : state.hull;

function variantOf(key) {
  return key === 'atlas' ? state.atlasVariant : defaultBridgeVariant(key);
}
function zonesOf(key) {
  const byVariant = state.zones[key] || {};
  return byVariant[variantOf(key)] || bridgeVariants(key)[variantOf(key)] || [];
}

// ---------------------------------------------------------------------------
// Kadłuby: obraz renderu jak getNpcHexInitSource w grze.
const hullImages = {};
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`nie wczytano ${url}`));
    img.src = url;
  });
}
async function loadHullImages() {
  await Promise.all(Object.keys(HULLS).map(async (key) => {
    const img = await loadImage(HULLS[key].png);
    const size = hullRenderSize(key);
    const c = document.createElement('canvas');
    c.width = size.w;
    c.height = size.h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = true;
    g.drawImage(img, 0, 0, size.w, size.h);
    hullImages[key] = { img, canvas: c };
    prewarmHexShipVisual(img);
  }));
}

// ---------------------------------------------------------------------------
// Scena walki
let sim = createCombatSim({ seed: 1 });
const extraHud = new Map();
const messages = [];
const lockMemory = { shard: null };
const gun = { x: 0, y: 0, offX: 0, offY: 0, cd: 0 };
const input = { fire: false, mx: W / 2, my: H / 2, panning: false, dragGun: false, lastX: 0, lastY: 0 };
const editor = createZoneEditor();
let lastAim = null;
let lockPoint = null;

function pushMessage(text, color = '#ffd08a', life = 3.2) {
  messages.push({ text, color, t: realNow() / 1000, life });
  if (messages.length > 6) messages.shift();
}

function layoutFor(hull) {
  if (hull === 'all') {
    return [['atlas', 0, -760], ['battleship', -560, 560], ['pirate_battleship', 560, 560]];
  }
  return [[hull, 0, 0]];
}

function focusTarget() {
  return sim.targets.find((t) => t.hullKey === state.focus) || sim.targets[0] || null;
}

function attachBridgesFor(t) {
  return attachHullBridges(t, zonesOf(t.hullKey), {
    overrides: { armorMul: state.armorMul, killFrac: state.killFrac }
  });
}

function buildScene() {
  for (const e of sim.entities) { try { disposeHexBody(e); } catch { /* */ } }
  sim.entities.length = 0;
  sim = createCombatSim({ seed: 1 });
  sim.fixHitProbe = state.fixProbe;
  sim.poolHitMul = state.poolMul;
  installSimHooks();
  DestructorSystem.splitQueue = [];
  extraHud.clear();
  messages.length = 0;
  lockMemory.shard = null;
  for (const [key, x, y] of layoutFor(state.hull)) {
    const img = hullImages[key];
    const e = buildHullEntity(key, { renderImage: img.canvas, visualImage: img.img, x, y, angle: 0 });
    addCombatTarget(sim, e, { hullKey: key, shield: state.shield });
    attachBridgesFor(e);
    ensureSalvageManifest(e);
    for (const t of e.visual?.mainThrusters || []) t.__throttle = 0.2;
  }
  if (!sim.targets.some((t) => t.hullKey === state.focus)) state.focus = sim.targets[0]?.hullKey;
  placeGun(state.gunDir);
  fitCamera();
  window.bullets = [];
  refreshEditorUi();
}

function placeGun(dir) {
  const t = focusTarget();
  if (!t) return;
  state.gunDir = dir;
  const a = (BENCH_DIRECTIONS[dir] ?? Math.PI / 2) + t.angle;
  const dist = t.radius + 650;
  gun.offX = Math.cos(a) * dist;
  gun.offY = Math.sin(a) * dist;
  lockMemory.shard = null;
  document.querySelectorAll('#gun-btns button').forEach((b) => b.classList.toggle('on', b.dataset.dir === dir));
}

function fitCamera() {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const t of sim.targets) {
    x0 = Math.min(x0, t.x - t.w / 2); x1 = Math.max(x1, t.x + t.w / 2);
    y0 = Math.min(y0, t.y - t.h / 2); y1 = Math.max(y1, t.y + t.h / 2);
  }
  const f = focusTarget();
  x0 = Math.min(x0, f.x + gun.offX); x1 = Math.max(x1, f.x + gun.offX);
  y0 = Math.min(y0, f.y + gun.offY); y1 = Math.max(y1, f.y + gun.offY);
  cam.x = (x0 + x1) / 2;
  cam.y = (y0 + y1) / 2;
  const panelW = document.body.classList.contains('shot') ? 0 : 340;
  cam.zoom = Math.min((W - panelW - 80) / Math.max(200, x1 - x0), (H - 120) / Math.max(200, y1 - y0));
  cam.x += panelW * 0.5 / cam.zoom;
}

// ---------------------------------------------------------------------------
// Haki symulacji → efekty i komunikaty
const _sp = new THREE.Vector3();
const _sv = new THREE.Vector3();

function hitSparks(x, y, vx, vy, dmg, ok) {
  if (!Fx3D.ensure()) return;
  const n = Math.min(10, 2 + Math.round(Math.sqrt(dmg) * 0.6));
  const sp0 = Math.hypot(vx, vy) || 1;
  const dx = -vx / sp0;
  const dy = vy / sp0;
  _sp.set(x, -y, FX_PLANE_Z);
  for (let i = 0; i < n; i++) {
    const a = Math.atan2(dy, dx) + (Math.random() - 0.5) * 1.6;
    const v = 60 + Math.random() * 220;
    _sv.set(Math.cos(a) * v, Math.sin(a) * v, 0);
    Fx3D.spark.spawn(_sp, _sv, 0.18 + Math.random() * 0.3, 1.6, 3 + Math.random() * 4, ok ? [3.2, 2.2, 1.1] : [1.6, 1.6, 1.8], 0.3, 0.06);
  }
}

function shieldFlash(x, y) {
  if (!Fx3D.ensure()) return;
  const o = sp();
  o.x = x; o.y = -y; o.z = FX_PLANE_Z;
  o.life = 0.22; o.drag = 3;
  o.s0 = 10; o.s1 = 38;
  o.r0 = 0.5; o.g0 = 1.4; o.b0 = 2.6;
  o.r1 = 0.05; o.g1 = 0.2; o.b1 = 0.5; o.mix = 6;
  o.alpha = 0.7; o.fadeIn = 0.01; o.fadeOut = 1.6; o.grow = 0.5;
  Fx3D.glow.spawn(o);
}

function lootLine(t) {
  const g = t.hexGrid;
  const alive = g.shards.filter((s) => s.active && !s.isDebris);
  const cells = new Set(alive.map((s) => `${s.c},${s.r}`));
  const stub = {};
  transferSalvageToWreck(t, stub, (cell) => cells.has(cell), alive.length);
  const d = describeSalvage(stub);
  if (!d) return 'łup: —';
  return `łup (holowanie): ${d.materials.map((m) => `${m.label} ${m.amount}`).join(', ')}`;
}

function installSimHooks() {
  sim.hooks.onHullHit = (t, x, y, vx, vy, dmg, ok) => hitSparks(x, y, vx, vy, dmg, ok);
  sim.hooks.onShieldHit = (t, x, y) => shieldFlash(x, y);
  sim.hooks.onBeam = (w, sx, sy, ex, ey) => {
    window.dispatchEvent(new CustomEvent('game_weapon_fired', {
      detail: {
        weaponId: w.id, shooter: null, x: sx, y: sy, isBeam: true, beamMode: w.def.beamMode || 'pulse',
        beam: { startX: sx, startY: sy, endX: ex, endY: ey, width: w.size === 'L' ? 12 : 5, mode: w.def.beamMode || 'pulse', emitterUid: 'mostki-gun' }
      }
    }));
  };
  sim.hooks.onBridgeLost = (t) => {
    const st = t.bridgeState;
    if (st && !st.commandLost) pushMessage(`${t.displayName}: mostek główny zniszczony — dowodzenie przejmuje zapasowy`, '#f0b060');
  };
  sim.hooks.onKill = (t, cause) => {
    const c = t.combat;
    const lines = [];
    const alivePct = Math.round(c.aliveAtKill * 100);
    if (cause === 'bridge') {
      pushMessage(`${t.displayName}: UTRATA DOWODZENIA — czysty kill (${alivePct}% kadłuba)`, '#ff9d4a', 4.5);
      lines.push({ text: `Kill: mostek po ${c.killShot} pociskach, ${alivePct}% heksów żywych`, color: '#ff9d4a' });
      lines.push({ text: `Bez poprawki w grze: losowy wybuch reaktora ${Math.round(c.critChanceWithoutFix * 100)}%`, color: '#f0b060' });
    } else {
      pushMessage(`${t.displayName}: zniszczony (${cause === 'pool' ? 'pula HP' : cause}) — gra losuje wybuch reaktora ${Math.round(c.critChanceWithoutFix * 100)}%`, '#ff6b5e', 4.5);
      lines.push({ text: `Kill: ${cause} po ${c.killShot} pociskach, ${alivePct}% heksów żywych`, color: '#ff6b5e' });
      lines.push({ text: `Gra: szansa wybuchu reaktora ${Math.round(c.critChanceWithoutFix * 100)}% (wrak rozpada się)`, color: '#f0b060' });
    }
    try { lines.push({ text: lootLine(t), color: '#9fdcb0' }); } catch { /* manifest */ }
    extraHud.set(t, lines);
  };
}

// ---------------------------------------------------------------------------
// Krok fizyki 120 Hz
let returnFireTimer = 0;
const _aim = { x: 0, y: 0 };
const _lock = { x: 0, y: 0 };

function currentAim() {
  const f = focusTarget();
  lockPoint = null;
  if (state.lock && f && f.bridgeState && !f.bridgeState.commandLost) {
    const p = getBridgeAimPoint(f, _lock, { mode: 'breach', fromX: gun.x, fromY: gun.y, memory: lockMemory });
    if (p) { lockPoint = p; return p; }
  }
  const v = makeView(cam, W, H);
  return v.toWorld(input.mx, input.my, _aim);
}

function physicsStep(dt) {
  const f = focusTarget();
  for (const t of sim.targets) {
    const c = t.combat;
    if (c.powered && !c.dead) {
      c.cmdVx = Math.cos(t.angle) * state.drift;
      c.cmdVy = Math.sin(t.angle) * state.drift;
      c.cmdAngVel = state.spinDeg * DEG;
    }
  }
  if (f) { gun.x = f.x + gun.offX; gun.y = f.y + gun.offY; }
  const w = resolveWeapon(state.weaponId);
  gun.cd -= dt;
  const firing = (input.fire || state.autoFire) && !editor.active;
  if (firing && w && gun.cd <= 0) {
    const aim = currentAim();
    fireWeapon(sim, w, { x: gun.x, y: gun.y, vx: 0, vy: 0 }, aim, { barrels: true, target: f });
    gun.cd = Math.max(0, gun.cd) + w.cooldown;
  }
  if (gun.cd < 0) gun.cd = 0;

  // Ogień zwrotny (wizualny): milknie razem z dowodzeniem.
  returnFireTimer -= dt;
  if (state.returnFire && returnFireTimer <= 0) {
    returnFireTimer = 0.28 + sim.rng() * 0.25;
    for (const t of sim.targets) {
      if (t.combat.dead || t.bridgeState?.commandLost) continue;
      const hps = (t.editorHardpoints || []).filter((h) => !h.destroyed && (h.type === 'main' || h.type === 'special'));
      if (!hps.length || sim.rng() < 0.4) continue;
      const hp = hps[Math.floor(sim.rng() * hps.length)];
      const a = t.angle;
      const hx = t.x + hp.x * t.__hardpointScaleX * Math.cos(a) - hp.y * t.__hardpointScaleY * Math.sin(a);
      const hy = t.y + hp.x * t.__hardpointScaleX * Math.sin(a) + hp.y * t.__hardpointScaleY * Math.cos(a);
      const weaponId = t.isPirate ? 'heavy_autocannon' : 'railgun_mk1';
      fireWeapon(sim, weaponId, { x: hx, y: hy, vx: t.vx, vy: t.vy }, { x: gun.x + (sim.rng() - 0.5) * 120, y: gun.y + (sim.rng() - 0.5) * 120 }, { noHit: true, source: t });
      sim.stats.shots--;   // ogień zwrotny nie liczy się do statystyk działa
    }
  }
  stepWorld(sim, dt);
  if (state.hulkToWreck) finishHulks();
}

// Koniec agonii hulka jak finishBridgeKill (index.html): wrak z żywych heksów
// (te same obiekty heksów — spawnWreckEntity), mostki zwolnione, ciało hulka
// oddane. Model 3D mostka przechodzi na wrak sam (bridge3D.js).
function finishHulks() {
  for (const t of sim.targets) {
    const st = t.bridgeState;
    if (!st || !st.commandLost || t.__wrecked) continue;
    if (sim.time - st.commandLostAt < BRIDGE_KILL_TIMELINE.sequenceEnd) continue;
    t.__wrecked = true;
    const shards = t.hexGrid?.shards || [];
    const surviving = shards.filter((s) => s.active && !s.isDebris && s.hp > 0);
    const wreck = surviving.length > 3 ? DestructorSystem.spawnWreckEntity(t, surviving, sim.entities) : null;
    releaseShipBridges(t);
    const i = sim.entities.indexOf(t);
    if (i >= 0) sim.entities.splice(i, 1);
    t.hideHexVisual = true;
    t.dead = true;
    if (t.combat) t.combat.wreck = wreck;
    try { disposeHexBody(t); } catch { /* ciało już oddane */ }
    pushMessage(`${t.displayName}: koniec agonii — wrak (${surviving.length} heksów)`, '#9fdcb0', 3);
  }
}

// ---------------------------------------------------------------------------
// Render klatki
const cull = { x: 0, y: 0, halfW: 0, halfH: 0, drawHalfW: 0, drawHalfH: 0 };
// Pomiar kosztu modelu 3D (zegar rzeczywisty — demo podmienia performance.now).
const bench3D = { lastUpdateMs: 0 };
const renderBullets = [];

// Dysza bez kadłuba gaśnie. EngineExhaustBatch rysuje płomyk postojowy także
// przy ciągu 0 (pod kadłubem, Z −5), więc po zestrzeleniu heksów wokół dyszy
// w próżni wisiałaby jasna kula. W grze silniki są dziś niezniszczalne — to
// tylko demo (docs/PORT-mostki.md, „Otwarte kwestie”).
const NOZZLE_PROBE_PX = 12;
const NOZZLE_ALIVE_FRAC = 0.34;
const _nozzleGrid = { x: 0, y: 0 };
const _nozzleCell = { x: 0, y: 0 };

// Heksy pod dyszą: raz, z pierwszej siatki (tożsamość komórek (c, r) się nie
// zmienia; żywotność sprawdza przynależność do BIEŻĄCEJ siatki).
function nozzleShards(t, thruster) {
  if (thruster.__nozzleShards) return thruster.__nozzleShards;
  const grid = t.hexGrid;
  const list = [];
  thruster.__nozzleShards = list;
  if (!grid?.shards || !thruster.offset) return list;
  const a = t.angle || 0;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const ox = thruster.offset.x;
  const oy = thruster.offset.y;
  bridgeWorldToGrid(t, t.x + ox * c - oy * s, t.y + ox * s + oy * c, _nozzleGrid);
  const r2 = NOZZLE_PROBE_PX * NOZZLE_PROBE_PX;
  for (const sh of grid.shards) {
    if (!sh) continue;
    hexCellCenter(sh.c, sh.r, sh.radius, _nozzleCell);
    const dx = _nozzleCell.x - _nozzleGrid.x;
    const dy = _nozzleCell.y - _nozzleGrid.y;
    if (dx * dx + dy * dy <= r2) list.push(sh);
  }
  return list;
}

function nozzleAlive(t, thruster) {
  const list = nozzleShards(t, thruster);
  if (!list.length) return true; // dysza poza siatką — nie ma czego sprawdzać
  let alive = 0;
  for (const sh of list) if (bridgeShardIsAlive(t.hexGrid, sh)) alive++;
  return alive >= list.length * NOZZLE_ALIVE_FRAC;
}

// Skala z poprzedniej klatki nie może przeciec do migawki bazowej mostka.
function restoreNozzleScale(list) {
  for (const th of list) {
    if (th.__demoVfxBase === undefined) continue;
    if (th.__demoVfxBase === null) delete th.vfxScale;
    else th.vfxScale = th.__demoVfxBase;
    delete th.__demoVfxBase;
  }
}

function dimNozzles(t, list, k) {
  for (const th of list) {
    const kk = nozzleAlive(t, th) ? k : 0;
    if (kk >= 1) continue;
    const cur = Number(th.vfxScale);
    th.__demoVfxBase = Number.isFinite(cur) && cur > 0 ? cur : null;
    th.vfxScale = Math.max(1e-3, (th.__demoVfxBase ?? 1) * kk);
    if (kk <= 0) th.__throttle = 0;
  }
}

function applyTargetVisuals() {
  for (const t of sim.targets) {
    const main = t.visual?.mainThrusters || [];
    const side = t.visual?.torqueThrusters || [];
    restoreNozzleScale(main);
    restoreNozzleScale(side);
    let glow = 1;
    if (t.bridgeState?.commandLost) {
      applyCommandLossVisuals(t, sim.time, { baseThrottle: t.__baseThrottle ?? 0.3 });
    } else if (t.combat.dead) {
      // Śmierć z puli: w grze wybuch reaktora (nie ten moduł) — tu dysze gasną.
      for (const s of main) s.__throttle = 0;
      for (const s of side) s.__throttle = 0;
      glow = sampleEngineGlow(sim.time - (t.combat.deathAt ?? sim.time), 0.5);
    } else {
      const thr = 0.2 + 0.65 * Math.min(1, state.drift / 300);
      t.__baseThrottle = thr;
      for (const s of main) s.__throttle = thr;
      const turn = Math.min(1, Math.abs(state.spinDeg) / 12) * 0.55;
      for (const s of side) s.__throttle = turn;
    }
    dimNozzles(t, main, glow);
    dimNozzles(t, side, glow);
  }
}

function renderFrame(simDt) {
  const ft = focusTarget();
  // Po końcu agonii kamera jedzie za wrakiem (hulk zniknął jak w grze).
  const f = ft?.combat?.wreck && !ft.combat.wreck.dead ? ft.combat.wreck : ft;
  if (f) {
    // Kamera jedzie za wybranym celem (dryf), przesunięcie ustawia gracz.
    if (renderFrame.lastFocus === f) { cam.x += f.x - renderFrame.fx; cam.y += f.y - renderFrame.fy; }
    renderFrame.lastFocus = f; renderFrame.fx = f.x; renderFrame.fy = f.y;
  }
  applyTargetVisuals();
  const halfW0 = (W * 0.5) / cam.zoom;
  const halfH0 = (H * 0.5) / cam.zoom;
  cull.x = cam.x; cull.y = cam.y;
  cull.drawHalfW = halfW0; cull.drawHalfH = halfH0;
  cull.halfW = halfW0 * 3; cull.halfH = halfH0 * 3;
  // Kolejność jak w grze: model 3D (ustawia bridgeState.model3D) → okna/wyrzut.
  const tb3 = realNow();
  Bridge3D.update(sim.entities, { nowSec: sim.time, dt: simDt, zoom: cam.zoom, cull, camera: cam });
  bench3D.lastUpdateMs = realNow() - tb3;
  BridgeFx3D.update(sim.targets, { nowSec: sim.time, dt: simDt, zoom: cam.zoom });

  renderBullets.length = 0;
  for (const b of sim.bullets) renderBullets.push(b);
  for (const r of sim.rockets) {
    r.type = 'rocket'; r.vfxKey = r.weapon.id; r.weaponSize = r.weapon.size; r.color = r.weapon.vfxColor; r.r = 5; r.owner = 'player';
    renderBullets.push(r);
  }
  window.bullets = renderBullets;

  Core3D.beginPlanetLayerFrame();
  Core3D.setShieldLayerActive(false);
  const th = realNow();
  updateHexShips3D(cam, sim.entities, cull);
  const td = realNow();
  drawHexShips3D(ctx, W, H);
  const te = realNow();
  bench3D.hexMs = td - th;
  bench3D.drawMs = te - td;
  drawOverlay();
}
renderFrame.lastFocus = null;

function drawOverlay() {
  const view = makeView(cam, W, H);
  for (const t of sim.targets) {
    if (state.overlays.grid) drawGrid(ctx, view, t);
    if (state.overlays.hardpoints) drawHardpoints(ctx, view, t);
    if (state.overlays.bridgeHexes) drawBridgeHexes(ctx, view, t);
    if (state.overlays.zone || editor.active) drawZones(ctx, view, t, { labels: state.overlays.info });
  }
  const f = focusTarget();
  if (editor.active && f) {
    const def = zonesOf(f.hullKey)[state.editBridge];
    drawEditorGizmo(ctx, view, editor.handles(f, def));
  }
  lastAim = editor.active ? null : currentAim();
  drawGunAndAim(ctx, view, gun, lastAim, lockPoint, { showAim: state.overlays.aim });
  if (state.overlays.info) {
    const w = resolveWeapon(state.weaponId);
    drawInfo(ctx, view, sim, {
      extra: extraHud,
      weaponLine: `Broń: ${w?.name} — ${w?.damage} obr./pocisk, ${w?.kind === 'rocket3d' ? 'rakieta 3D (w grze NIE rusza heksów, tylko pulę)' : `${w?.kind === 'beam' ? 'wiązka' : 'pocisk'} ${w?.speed === Infinity ? '' : `${w?.speed} j./s`}`} · odstęp ${w?.cooldown}s${state.lock ? ' · LOCK' : ''}${state.autoFire ? ' · OGIEŃ CIĄGŁY' : ''}`,
      simLine: `Czas symulacji ${sim.time.toFixed(1)} s · ${clock.paused ? 'PAUZA' : `${clock.scale}×`} · pociski ${sim.stats.shots} · w kadłub ${sim.stats.hullHits} · w tarczę ${sim.stats.shieldHits} · pudła ${sim.stats.misses}`,
      probeLine: `Sonda applyImpact: ${sim.stats.probeMisses} trafień bez heksa${sim.fixHitProbe ? ` (poprawka uratowała ${sim.stats.probeRescued})` : ' — w grze przepadają'} · pula × ${sim.poolHitMul}`
    });
  }
  drawMessages(ctx, view, messages, realNow() / 1000);
}

// ---------------------------------------------------------------------------
// Pętla
let acc = 0;
let running = true;
function loop() {
  requestAnimationFrame(loop);
  const realMs = tickClock();
  if (!running || !sim.targets.length) return;
  const simDt = clock.paused ? 0 : Math.min(0.1, (realMs / 1000) * clock.scale);
  acc += simDt;
  let steps = 0;
  while (acc >= PHYS_DT && steps < 14) {
    physicsStep(PHYS_DT);
    acc -= PHYS_DT;
    steps++;
  }
  if (steps >= 14) acc = 0;
  if (simDt > 0) stepVisuals(sim, simDt);
  renderFrame(simDt);
}

// ---------------------------------------------------------------------------
// Wejście
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  input.mx = e.offsetX; input.my = e.offsetY;
  input.lastX = e.offsetX; input.lastY = e.offsetY;
  const view = makeView(cam, W, H);
  if (e.button === 1) { input.panning = true; return; }
  if (e.button === 2) { input.dragGun = true; return; }
  if (e.button === 0) {
    const f = focusTarget();
    if (editor.active && f) {
      const def = zonesOf(f.hullKey)[state.editBridge];
      const h = def ? editor.pick(f, def, view, e.offsetX, e.offsetY) : null;
      if (h) {
        const wpt = view.toWorld(e.offsetX, e.offsetY);
        editor.begin(f, def, h, wpt.x, wpt.y);
      }
      return;
    }
    input.fire = true;
  }
});
canvas.addEventListener('pointermove', (e) => {
  const view = makeView(cam, W, H);
  const dx = e.offsetX - input.lastX;
  const dy = e.offsetY - input.lastY;
  input.mx = e.offsetX; input.my = e.offsetY;
  input.lastX = e.offsetX; input.lastY = e.offsetY;
  if (input.panning) { cam.x -= dx / cam.zoom; cam.y -= dy / cam.zoom; return; }
  const f = focusTarget();
  if (input.dragGun && f) {
    const wpt = view.toWorld(e.offsetX, e.offsetY);
    gun.offX = wpt.x - f.x; gun.offY = wpt.y - f.y;
    gun.x = wpt.x; gun.y = wpt.y;
    lockMemory.shard = null;
    document.querySelectorAll('#gun-btns button').forEach((b) => b.classList.remove('on'));
    return;
  }
  if (editor.drag && f) {
    const wpt = view.toWorld(e.offsetX, e.offsetY);
    const next = editor.move(f, wpt.x, wpt.y);
    if (next) setEditedZone(f.hullKey, next, false);
  }
});
canvas.addEventListener('pointerup', (e) => {
  if (e.button === 0) {
    input.fire = false;
    if (editor.drag) { editor.end(); commitZones(); }
  }
  if (e.button === 1) input.panning = false;
  if (e.button === 2) input.dragGun = false;
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const view = makeView(cam, W, H);
  const before = view.toWorld(e.offsetX, e.offsetY);
  cam.zoom = Math.max(0.03, Math.min(12, cam.zoom * Math.exp(-e.deltaY * 0.0012)));
  const after = makeView(cam, W, H).toWorld(e.offsetX, e.offsetY);
  cam.x += before.x - after.x;
  cam.y += before.y - after.y;
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); setPaused(!clock.paused); }
  else if (k === 'r') buildScene();
  else if (k === 't') setLock(!state.lock);
  else if (k === 'f') setAuto(!state.autoFire);
  else if (k === 'e') setEditing(!editor.active);
  else if (k === '1') chooseHull('atlas');
  else if (k === '2') chooseHull('battleship');
  else if (k === '3') chooseHull('pirate_battleship');
  else if (k === '4') chooseHull('all');
  else if (k === '[' || k === ']') cycleWeapon(k === ']' ? 1 : -1);
  else if (k === 'g') toggleOverlay('grid');
  else if (k === 'z') toggleOverlay('zone');
  else if (k === 'b') toggleOverlay('bridgeHexes');
  else if (k === 'h') toggleOverlay('hardpoints');
  else if (k === 'm') setModel3D(!BRIDGE3D_TUNE.enabled);
});

function setModel3D(on) {
  BRIDGE3D_TUNE.enabled = !!on;
  const el = $('model3d');
  if (el) el.checked = BRIDGE3D_TUNE.enabled;
}

window.addEventListener('resize', () => {
  W = canvas.width = innerWidth;
  H = canvas.height = innerHeight;
  glCanvas.width = W;
  glCanvas.height = H;
  Core3D.resize(W, H);
});

// ---------------------------------------------------------------------------
// UI
function setPaused(p) {
  clock.paused = p;
  $('pause-btn').classList.toggle('on', p);
}
function setScale(s) {
  clock.scale = s;
  state.timeScale = s;
  document.querySelectorAll('#time-btns button[data-scale]').forEach((b) => b.classList.toggle('on', Number(b.dataset.scale) === s));
}
function setLock(v) { state.lock = v; lockMemory.shard = null; $('lock-btn').classList.toggle('on', v); }
function setAuto(v) { state.autoFire = v; $('auto-btn').classList.toggle('on', v); }
function toggleOverlay(key) {
  state.overlays[key] = !state.overlays[key];
  const el = document.querySelector(`#overlay-checks input[data-ov="${key}"]`);
  if (el) el.checked = state.overlays[key];
  saveState();
}
function chooseHull(key) {
  if (key === 'all') {
    state.hull = 'all';
  } else if (state.hull === 'all') {
    state.focus = key;   // w układzie „wszystkie” 1–3 wybiera cel działa
    placeGun(state.gunDir);
    refreshEditorUi();
    markHullButtons();
    return;
  } else {
    state.hull = key;
    state.focus = key;
  }
  markHullButtons();
  buildScene();
}
function markHullButtons() {
  document.querySelectorAll('#hull-btns button, #hull-btns-fleet button').forEach((b) => {
    const h = b.dataset.hull;
    b.classList.toggle('on', h === state.hull || (state.hull === 'all' && h === state.focus));
  });
}
function cycleWeapon(d) {
  const i = DEMO_WEAPONS.indexOf(state.weaponId);
  state.weaponId = DEMO_WEAPONS[(i + d + DEMO_WEAPONS.length) % DEMO_WEAPONS.length];
  $('weapon').value = state.weaponId;
  saveState();
}
function setEditing(v) {
  editor.active = v;
  $('edit-btn').classList.toggle('on', v);
  if (v) { setAuto(false); state.overlays.zone = true; }
  refreshEditorUi();
}

function currentZoneList(key) {
  const byVariant = state.zones[key] || (state.zones[key] = {});
  const v = variantOf(key);
  if (!byVariant[v]) byVariant[v] = (bridgeVariants(key)[v] || []).map((d) => ({ ...d }));
  return byVariant[v];
}

// Edycja strefy: od razu przeznaczamy heksy na żywej siatce (bez resetu),
// żeby było widać, które heksy wpadają do strefy.
function setEditedZone(key, def, commit) {
  const list = currentZoneList(key);
  const i = Math.min(state.editBridge, list.length - 1);
  list[i] = { ...list[i], x: def.x, y: def.y, w: def.w, h: def.h, rot: def.rot };
  const t = sim.targets.find((e) => e.hullKey === key);
  if (t) attachBridgesFor(t);
  refreshEditorFields();
  if (commit) commitZones();
}
function commitZones() {
  saveState();
  refreshEditorUi();
}

function refreshEditorFields() {
  const f = focusTarget();
  if (!f) return;
  const list = currentZoneList(f.hullKey);
  const def = list[Math.min(state.editBridge, list.length - 1)];
  if (!def) return;
  const n = normalizeBridgeDef(def);
  $('ed-x').value = Math.round(n.x);
  $('ed-y').value = Math.round(n.y);
  $('ed-rot').value = Math.round(n.rot);
  $('ed-w').value = Math.round(n.w);
  $('ed-h').value = Math.round(n.h);
  const b = f.bridgeState?.bridges[Math.min(state.editBridge, (f.bridgeState?.bridges.length || 1) - 1)];
  $('ed-count').value = b ? `${b.total}` : '—';
  const margin = 14 / (f.__hardpointScale || 1);
  const issues = validateBridgeLayout(list, SHIP_EDITOR_DEFAULTS.ships[f.hullKey] || {}, { margin });
  $('issues').innerHTML = issues.length
    ? `<span class="warn">Kolizje (${issues.length}): ${issues.slice(0, 6).map((i) => `${i.kind}${i.type ? ` ${i.type}` : ''} (${Math.round(i.x)}, ${Math.round(i.y)})`).join('; ')}</span>`
    : '<span style="color:#7be3a0">Brak kolizji z hardpointami, silnikami i rdzeniami.</span>';
}

function refreshEditorUi() {
  const f = focusTarget();
  const sel = $('edit-bridge');
  sel.innerHTML = '';
  if (!f) return;
  const list = currentZoneList(f.hullKey);
  list.forEach((d, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = `${HULLS[f.hullKey].label}: ${d.label || d.id}`;
    sel.appendChild(o);
  });
  state.editBridge = Math.min(state.editBridge, list.length - 1);
  sel.value = String(state.editBridge);
  refreshEditorFields();
}

function exportText() {
  const byHull = {};
  for (const key of Object.keys(HULLS)) {
    const list = key === 'atlas' ? currentZoneList('atlas') : currentZoneList(key);
    byHull[key] = list.map((d) => ({ ...d, armorMul: state.armorMul, killFrac: state.killFrac }));
  }
  return formatZonesExport(byHull, formatBridgesJson) + `\n// Atlas: wariant „${state.atlasVariant}”`;
}

function wireUi() {
  document.querySelectorAll('#hull-btns button, #hull-btns-fleet button').forEach((b) => b.addEventListener('click', () => chooseHull(b.dataset.hull)));
  const av = $('atlas-variant');
  const labels = { rufowy: 'A: kręgosłup rufowy', srodokrecie: 'B: szyja śródokręcia', dziobowy: 'C: nadbudówka dziobowa', rufowy_z_zapasowym: 'A + C zapasowy (kill po obu)' };
  for (const v of Object.keys(bridgeVariants('atlas'))) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = labels[v] || v;
    av.appendChild(o);
  }
  av.value = state.atlasVariant;
  av.addEventListener('change', () => { state.atlasVariant = av.value; saveState(); buildScene(); });

  const armor = $('armor');
  const kill = $('killfrac');
  armor.value = state.armorMul;
  kill.value = state.killFrac;
  const showParams = () => { $('armor-out').textContent = `×${Number(armor.value).toFixed(2)}`; $('killfrac-out').textContent = Number(kill.value).toFixed(2); };
  showParams();
  armor.addEventListener('input', showParams);
  kill.addEventListener('input', showParams);
  armor.addEventListener('change', () => { state.armorMul = Number(armor.value); saveState(); buildScene(); });
  kill.addEventListener('change', () => { state.killFrac = Number(kill.value); saveState(); buildScene(); });

  const ws = $('weapon');
  for (const id of DEMO_WEAPONS) {
    const o = document.createElement('option');
    o.value = id;
    const w = MASTER_WEAPONS[id];
    o.textContent = `${w.name} (${w.baseDamage}${w.category === 'rocket' && !w.forceCanvas ? ', tylko pula' : ''})`;
    ws.appendChild(o);
  }
  ws.value = state.weaponId;
  ws.addEventListener('change', () => { state.weaponId = ws.value; saveState(); });
  document.querySelectorAll('#gun-btns button').forEach((b) => b.addEventListener('click', () => placeGun(b.dataset.dir)));
  $('lock-btn').addEventListener('click', () => setLock(!state.lock));
  $('auto-btn').addEventListener('click', () => setAuto(!state.autoFire));

  const spin = $('spin');
  const drift = $('drift');
  spin.value = state.spinDeg;
  drift.value = state.drift;
  const showMove = () => { $('spin-out').textContent = `${Number(spin.value).toFixed(1)}°`; $('drift-out').textContent = `${drift.value}`; };
  showMove();
  spin.addEventListener('input', () => { state.spinDeg = Number(spin.value); showMove(); });
  drift.addEventListener('input', () => { state.drift = Number(drift.value); showMove(); });
  $('shield').addEventListener('change', (e) => {
    state.shield = e.target.checked;
    for (const t of sim.targets) {
      t.shield.enabled = state.shield;
      t.shield.val = state.shield ? t.shield.max : 0;
    }
  });
  $('returnfire').addEventListener('change', (e) => { state.returnFire = e.target.checked; });

  $('pause-btn').addEventListener('click', () => setPaused(!clock.paused));
  document.querySelectorAll('#time-btns button[data-scale]').forEach((b) => b.addEventListener('click', () => setScale(Number(b.dataset.scale))));
  $('reset-btn').addEventListener('click', () => buildScene());

  document.querySelectorAll('#overlay-checks input').forEach((el) => {
    el.checked = !!state.overlays[el.dataset.ov];
    el.addEventListener('change', () => { state.overlays[el.dataset.ov] = el.checked; saveState(); });
  });

  const m3 = $('model3d');
  if (m3) {
    m3.checked = BRIDGE3D_TUNE.enabled;
    m3.addEventListener('change', () => setModel3D(m3.checked));
  }
  const hw = $('hulkwreck');
  if (hw) {
    hw.checked = state.hulkToWreck;
    hw.addEventListener('change', () => { state.hulkToWreck = hw.checked; });
  }
  $('fixprobe').checked = state.fixProbe;
  $('fixprobe').addEventListener('change', (e) => { state.fixProbe = e.target.checked; sim.fixHitProbe = state.fixProbe; });
  const pm = $('poolmul');
  pm.value = state.poolMul;
  const showPool = () => { $('poolmul-out').textContent = `×${Number(pm.value).toFixed(2)}`; };
  showPool();
  pm.addEventListener('input', () => { state.poolMul = Number(pm.value); sim.poolHitMul = state.poolMul; showPool(); });

  $('edit-btn').addEventListener('click', () => setEditing(!editor.active));
  $('edit-bridge').addEventListener('change', (e) => { state.editBridge = Number(e.target.value) || 0; refreshEditorFields(); });
  for (const id of ['ed-x', 'ed-y', 'ed-rot', 'ed-w', 'ed-h']) {
    $(id).addEventListener('change', () => {
      const f = focusTarget();
      if (!f) return;
      setEditedZone(f.hullKey, normalizeBridgeDef({ x: Number($('ed-x').value), y: Number($('ed-y').value), rot: Number($('ed-rot').value), w: Number($('ed-w').value), h: Number($('ed-h').value) }), true);
    });
  }
  $('export-btn').addEventListener('click', () => { $('export-out').value = exportText(); });
  $('copy-btn').addEventListener('click', async () => {
    const text = exportText();
    $('export-out').value = text;
    try { await navigator.clipboard.writeText(text); pushMessage('Skopiowano JSON stref (przestrzeń PNG)', '#7be3a0'); } catch { $('export-out').select(); }
  });
  $('proposal-btn').addEventListener('click', () => { state.zones = proposalZones(); saveState(); buildScene(); pushMessage('Przywrócono propozycje stref', '#7be3a0'); });

  $('bench-quick').addEventListener('click', () => runBenchUi(true));
  $('bench-full').addEventListener('click', () => runBenchUi(false));
  $('bench-save').addEventListener('click', () => {
    if (!lastBench) return;
    const blob = new Blob([JSON.stringify(lastBench, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mostki-benchmark.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  markHullButtons();
  setScale(1);
}

// ---------------------------------------------------------------------------
// Benchmark w przeglądarce (ten sam kod co w Node). Symulacja na żywo stoi.
let lastBench = null;
function benchEnv() {
  return { makeHull: (key) => buildHullEntity(key, { renderImage: hullImages[key].canvas }) };
}

async function runBenchUi(quick) {
  const out = $('bench-out');
  out.style.display = 'block';
  out.textContent = 'liczę…';
  running = false;
  const f = focusTarget();
  const plan = quick
    ? standardPlan({ hulls: [f?.hullKey || 'battleship'], weapons: [state.weaponId], armorMul: state.armorMul, killFrac: state.killFrac, maxShots: 3000,
      atlasVariants: f?.hullKey === 'atlas' ? [state.atlasVariant] : undefined })
    : standardPlan({ weapons: BENCH_WEAPONS, armorMul: state.armorMul, killFrac: state.killFrac, maxShots: 3000 });
  const bar = $('bench-progress').firstElementChild;
  const names = Object.fromEntries(Object.entries(MASTER_WEAPONS).map(([k, v]) => [k, v.name]));
  try {
    const rows = await runBenchPlan(benchEnv(), plan, {
      onProgress: (i, n) => { bar.style.width = `${(i / n) * 100}%`; },
      pause: () => new Promise((r) => setTimeout(r, 0))
    });
    lastBench = rows;
    out.textContent = formatBenchMarkdown(rows, { weaponNames: names, title: quick ? 'Benchmark (szybki)' : 'Benchmark (pełny)' });
  } catch (err) {
    reportError(err.stack || err);
  } finally {
    running = true;
    buildScene();
  }
}

// ---------------------------------------------------------------------------
// API dla automatycznych zrzutów (dema/mostki-shots.js) i konsoli.
const api = {
  ready: false,
  get sim() { return sim; },
  get state() { return state; },
  cam,
  clock,
  setup(opts = {}) {
    if (opts.hull) { state.hull = opts.hull; state.focus = opts.hull === 'all' ? (opts.focus || 'battleship') : opts.hull; }
    if (opts.variant) state.atlasVariant = opts.variant;
    if (Number.isFinite(opts.armorMul)) state.armorMul = opts.armorMul;
    if (Number.isFinite(opts.killFrac)) state.killFrac = opts.killFrac;
    if (opts.weapon) state.weaponId = opts.weapon;
    if (typeof opts.shield === 'boolean') state.shield = opts.shield;
    if (Number.isFinite(opts.spin)) state.spinDeg = opts.spin;
    if (Number.isFinite(opts.drift)) state.drift = opts.drift;
    if (opts.overlays) Object.assign(state.overlays, opts.overlays);
    if (typeof opts.returnFire === 'boolean') state.returnFire = opts.returnFire;
    if (typeof opts.lock === 'boolean') state.lock = opts.lock;
    if (opts.gun) state.gunDir = opts.gun;
    buildScene();
    if (Number.isFinite(opts.zoom)) cam.zoom = opts.zoom;
    if (Number.isFinite(opts.camX)) cam.x = opts.camX;
    if (Number.isFinite(opts.camY)) cam.y = opts.camY;
    return this.stats();
  },
  // Symulacja „na sucho” w tempie 60 klatek/s czasu wirtualnego.
  advance(seconds, opts = {}) {
    const frames = Math.max(1, Math.round(seconds * 60));
    if (typeof opts.fire === 'boolean') input.fire = opts.fire;
    for (let i = 0; i < frames; i++) {
      clock.virtual += 1000 / 60;
      clock.lastReal = realNow();
      acc += 1 / 60;
      while (acc >= PHYS_DT) { physicsStep(PHYS_DT); acc -= PHYS_DT; }
      stepVisuals(sim, 1 / 60);
      if (opts.render !== false || i === frames - 1) renderFrame(1 / 60);
    }
    input.fire = false;
    return this.stats();
  },
  // Utrata mostka na życzenie (do zrzutów sekwencji): heksy strefy od strony
  // działa, jak po tunelu ostrzału. `index` — tylko ten mostek (Atlas: zapasowy).
  killBridge(targetKey = state.focus, index = null) {
    const t = sim.targets.find((e) => e.hullKey === targetKey);
    const st = t?.bridgeState;
    if (!st) return false;
    const dx = t.x - gun.x;
    const dy = t.y - gun.y;
    const g = t.hexGrid;
    const c = Math.cos(t.angle);
    const sn = Math.sin(t.angle);
    // Działo w układzie siatki kadłuba.
    const gx = ((gun.x - t.x) * c + (gun.y - t.y) * sn) + g.srcWidth / 2;
    const gy = (-(gun.x - t.x) * sn + (gun.y - t.y) * c) + g.srcHeight / 2;
    st.bridges.forEach((b, bi) => {
      if (index != null && bi !== index) return;
      const need = Math.ceil(b.total * b.def.killFrac) + 1;
      const order = b.shards.slice().sort((p, q) => Math.hypot(p.gridX - gx, p.gridY - gy) - Math.hypot(q.gridX - gx, q.gridY - gy));
      const first = order[0];
      if (first) {
        const lx = first.gridX - g.srcWidth / 2;
        const ly = first.gridY - g.srcHeight / 2;
        noteBridgeHit(t, t.x + lx * c - ly * sn, t.y + lx * sn + ly * c, dx, dy, sim.time);
      }
      for (let i = 0; i < need && i < order.length; i++) if (order[i].active) DestructorSystem.destroyShard(t, order[i]);
    });
    st.probeTimer = 0;
    // Sonda integralności biegnie co integrityEverySubsteps (3) kroki fizyki —
    // 3/60 s to 6 kroków, więc zwracany stan zawiera już utratę mostka.
    return this.advance(3 / 60).targets;
  },
  freeze(v = true) { running = !v; return running; },
  // Utrata dowodzenia PRAWDZIWYM ostrzałem (lock na mostek, pociski
  // natychmiastowe) — tunel i odłamki jak w walce. Pula HP na czas strzelania
  // wyłączona, żeby cel nie zginął z puli przed mostkiem (to demo sekwencji).
  shootBridge(targetKey = state.focus, weaponId = 'special_valkyrie_railgun', maxShots = 600, index = null) {
    const t = sim.targets.find((e) => e.hullKey === targetKey);
    const st = t?.bridgeState;
    if (!st) return false;
    const w = resolveWeapon(weaponId);
    const prevPool = sim.poolHitMul;
    sim.poolHitMul = 0;
    const mem = { shard: null };
    const aim = { x: 0, y: 0 };
    const until = () => (index == null ? st.commandLost : (st.bridges[index]?.dead || st.commandLost));
    let n = 0;
    try {
      while (!until() && n < maxShots) {
        const bridge = index == null ? null : st.bridges[index];
        const p = getBridgeAimPoint(t, aim, { mode: 'breach', fromX: gun.x, fromY: gun.y, memory: mem, bridgeId: bridge?.id });
        if (!p) break;
        fireInstant(sim, w, { x: gun.x, y: gun.y }, p, null);
        n++;
        for (let k = 0; k < 2; k++) physicsStep(PHYS_DT);
        clock.virtual += 1000 / 60;
        stepVisuals(sim, 1 / 60);
        if (n % 3 === 0) renderFrame(1 / 60);
        evaluateShipBridges(t, sim.time);
        if (st.commandLost && !t.combat.dead) {
          // Ta sama droga co kadencja w runIntegrity.
          t.bridgeState.probeTimer = 0;
          physicsStep(PHYS_DT);
        }
      }
    } finally {
      sim.poolHitMul = prevPool;
    }
    renderFrame(1 / 60);
    return { shots: n, commandLost: st.commandLost, bridgeDead: index == null ? st.commandLost : !!st.bridges[index]?.dead };
  },
  // Pasma HDR samych okien: ten sam kadr z oknami i bez (różnica pikseli).
  measureWindows(targetKey = state.focus, pad = 8) {
    const rect = this.bridgeRect(targetKey, pad);
    if (!rect) return null;
    const readLum = () => {
      renderFrame(0);
      const rt = Core3D.postTarget;
      const pr = Core3D.pixelRatio || 1;
      const x = Math.max(0, Math.floor(rect.x * pr));
      const w = Math.max(1, Math.min(rt.width - x, Math.floor(rect.w * pr)));
      const h = Math.max(1, Math.floor(rect.h * pr));
      const y = Math.max(0, rt.height - Math.floor(rect.y * pr) - h);
      const buf = new Uint16Array(w * h * 4);
      Core3D.renderer.readRenderTargetPixels(rt, x, y, w, h, buf);
      const lum = new Float32Array(w * h);
      for (let i = 0, j = 0; i < buf.length; i += 4, j++) {
        lum[j] = 0.2126 * THREE.DataUtils.fromHalfFloat(buf[i]) + 0.7152 * THREE.DataUtils.fromHalfFloat(buf[i + 1]) + 0.0722 * THREE.DataUtils.fromHalfFloat(buf[i + 2]);
      }
      return lum;
    };
    const prevBloom = Core3D.perfToggles.bloom !== false;
    Core3D.setPerfToggles({ bloom: false });
    const core = BRIDGE_FX_TUNE.coreGain;
    const halo = BRIDGE_FX_TUNE.haloGain;
    const on = readLum();
    BRIDGE_FX_TUNE.coreGain = 0;
    BRIDGE_FX_TUNE.haloGain = 0;
    const off = readLum();
    BRIDGE_FX_TUNE.coreGain = core;
    BRIDGE_FX_TUNE.haloGain = halo;
    Core3D.setPerfToggles({ bloom: prevBloom });
    renderFrame(0);
    const delta = [];
    let over = 0;
    let lit = 0;
    let max = 0;
    let hullOver = 0;
    for (let i = 0; i < on.length; i++) {
      const d = on[i] - off[i];
      if (off[i] > 0.9) hullOver++;
      if (d <= 0.02) continue;
      lit++;
      delta.push(on[i]);
      if (on[i] > 0.9) over++;
      if (on[i] > max) max = on[i];
    }
    delta.sort((a, b) => a - b);
    const pct = (p) => delta[Math.min(delta.length - 1, Math.floor(delta.length * p))] || 0;
    return {
      rect, pixels: on.length, windowPixels: lit, windowPixelsOver09: over, maxWithWindows: max,
      p50: pct(0.5), p90: pct(0.9), p99: pct(0.99), hullPixelsOver09WithoutWindows: hullOver
    };
  },
  zoomShip(targetKey = state.focus, zoom = 1, offsetX = 0) {
    const t = sim.targets.find((e) => e.hullKey === targetKey);
    if (!t) return false;
    cam.x = t.x + offsetX;
    cam.y = t.y;
    cam.zoom = zoom;
    renderFrame.lastFocus = null;
    return true;
  },
  zoomBridge(targetKey = state.focus, zoom = 2) {
    const t = sim.targets.find((e) => e.hullKey === targetKey);
    const b = t?.bridgeState?.bridges.find((x) => !x.dead) || t?.bridgeState?.bridges[0];
    if (!t || !b) return false;
    const c = Math.cos(t.angle);
    const sn = Math.sin(t.angle);
    const lx = b.def.x * t.__hardpointScaleX;
    const ly = b.def.y * t.__hardpointScaleY;
    cam.x = t.x + lx * c - ly * sn;
    cam.y = t.y + lx * sn + ly * c;
    cam.zoom = zoom;
    renderFrame.lastFocus = null;
    return true;
  },
  // --- Model 3D mostka (src/3d/bridge3D.js) ---------------------------------
  model3d(on = true) { setModel3D(on); return BRIDGE3D_TUNE.enabled; },
  bridge3D() {
    return {
      stats: { ...Bridge3D.stats, instances: Bridge3D.stats.instances.slice() },
      records: Bridge3D.records.map((r) => ({
        kind: r.kind.name, host: r.host?.displayName || (r.host?.isWreck ? 'wrak' : '?'), isWreck: !!r.host?.isWreck,
        row: r.row, cells: r.cellCount, block: [r.blockW, r.blockH], anyDead: r.anyDead, moved: r.moved,
        powerLostAt: r.powerLostAt, emitters: r.kind.emit.count
      }))
    };
  },
  // Ostrzał mostka (lock, pociski natychmiastowe) do zadanej integralności —
  // „uszkodzony”, ale jeszcze dowodzący. Pula HP wyłączona na czas ostrzału.
  damageBridge(targetKey = state.focus, { weapon = 'heavy_autocannon', integrity = 0.8, maxShots = 800, index = 0 } = {}) {
    const t = sim.targets.find((e) => e.hullKey === targetKey);
    const st = t?.bridgeState;
    if (!st) return false;
    const w = resolveWeapon(weapon);
    const prevPool = sim.poolHitMul;
    sim.poolHitMul = 0;
    const mem = { shard: null };
    const aim = { x: 0, y: 0 };
    const bridge = st.bridges[index];
    let n = 0;
    try {
      while (n < maxShots && bridge && !bridge.dead && !st.commandLost) {
        evaluateShipBridges(t, sim.time);
        if (bridge.integrity <= integrity) break;
        const p = getBridgeAimPoint(t, aim, { mode: 'breach', fromX: gun.x, fromY: gun.y, memory: mem, bridgeId: bridge.id });
        if (!p) break;
        fireInstant(sim, w, { x: gun.x, y: gun.y }, p, null);
        n++;
        for (let k = 0; k < 2; k++) physicsStep(PHYS_DT);
        clock.virtual += 1000 / 60;
        stepVisuals(sim, 1 / 60);
        if (n % 3 === 0) renderFrame(1 / 60);
      }
    } finally {
      sim.poolHitMul = prevPool;
    }
    renderFrame(1 / 60);
    return { shots: n, integrity: bridge ? +bridge.integrity.toFixed(3) : null, dead: !!bridge?.dead, commandLost: st.commandLost };
  },
  // Środek modelu (świat) — działa też po przejściu modelu na wrak.
  modelCenter(targetKey = state.focus, index = 0) {
    const t = sim.targets.find((e) => e.hullKey === targetKey);
    if (!t) return null;
    const hosts = [t, t.combat?.wreck].filter(Boolean);
    for (const h of hosts) {
      const recs = (h.__bridge3D || []).filter((r) => r.bridgeIndex === index);
      const r = recs[0];
      if (!r) continue;
      const out = { x: 0, y: 0 };
      bridgeGridToWorld(h, r.map.zgx, r.map.zgy, out);
      return { x: out.x, y: out.y, host: h === t ? 'kadłub' : 'wrak' };
    }
    return null;
  },
  zoomModel(targetKey = state.focus, zoom = 3, index = 0, offX = 0, offY = 0) {
    const c = this.modelCenter(targetKey, index);
    if (!c) return false;
    cam.x = c.x + offX;
    cam.y = c.y + offY;
    cam.zoom = zoom;
    renderFrame.lastFocus = null;
    return c;
  },
  // Wolna kamera perspektywiczna (tryb free3d gry, np. lot nad Ring City):
  // widać wysokość modelu. elevDeg — wysokość nad płaszczyzną, azDeg — azymut
  // w scenie (0 = od dziobu, 90 = od lewej burty).
  freeCam(targetKey = state.focus, { dist = 160, elevDeg = 35, azDeg = 200, fov = 50, index = 0 } = {}) {
    const c = this.modelCenter(targetKey, index);
    if (!c) return false;
    const target = new THREE.Vector3(c.x, -c.y, 8);
    const e = elevDeg * DEG;
    const a = azDeg * DEG;
    // Kamera (nie Object3D): lookAt kieruje na cel oś −Z, jak patrzy kamera.
    const o = new THREE.PerspectiveCamera();
    o.up.set(0, 0, 1);
    o.position.set(target.x + dist * Math.cos(e) * Math.cos(a), target.y + dist * Math.cos(e) * Math.sin(a), target.z + dist * Math.sin(e));
    o.lookAt(target);
    cam.mode = 'free3d';
    cam.position = o.position.clone();
    cam.quaternion = o.quaternion.clone();
    cam.fov = fov;
    cam.near = 1;
    cam.far = 400000;
    cam.x = c.x; cam.y = c.y;
    cam.zoom = 0.12;
    renderFrame.lastFocus = null;
    return true;
  },
  orthoCam() {
    delete cam.mode;
    delete cam.position;
    delete cam.quaternion;
    return true;
  },
  // Bitwa 174 okrętów (80 Bellatorów, 80 Iron Skulli, 14 Atlasów): klony
  // dzielące siatki heksów trzech prototypów (koszt modelu nie zależy od tego,
  // czy siatki są wspólne — każdy klon ma własne rekordy i wiersze obrażeń).
  // Mierzy: CPU Bridge3D.update, wywołania rysowania (ortho/FG), czas GPU
  // klatki (EXT_disjoint_timer_query), z modelem i bez.
  async bench174({ counts = { battleship: 80, pirate_battleship: 80, atlas: 14 }, views = [0.12, 0.22, 0.6], frames = 90, hulls = true, variants = [] } = {}) {
    running = false;
    this.orthoCam();
    state.hull = 'all';
    state.focus = 'battleship';
    buildScene();
    const protos = {};
    for (const t of sim.targets) { protos[t.hullKey] = t; t.hideHexVisual = true; }
    // Kadłuby spoza sceny „wszystkie” (reszta floty z mostkami): prototyp tutaj.
    const keys = Object.keys(counts).filter((k) => (counts[k] || 0) > 0 && HULLS[k]);
    for (const key of keys) {
      if (protos[key]) continue;
      const img = hullImages[key];
      const p = buildHullEntity(key, { renderImage: img.canvas, visualImage: img.img, x: 0, y: 0, angle: 0 });
      attachBridgesFor(p);
      p.hideHexVisual = true;
      protos[key] = p;
    }
    const clones = [];
    // Blok rzędów na typ; rozstaw z rozmiaru renderu kadłuba, flota ~12,4 tys. j. szeroka.
    let y0 = -3300;
    for (const key of keys) {
      const n = counts[key] || 0;
      const p = protos[key];
      const size = hullRenderSize(key);
      const sx = Math.max(260, size.w * 1.25);
      const sy = Math.max(200, size.h * 1.25);
      const perRow = Math.max(1, Math.floor(12400 / sx));
      let row = 0;
      let col = 0;
      for (let i = 0; i < n; i++) {
        const c = Object.assign({}, p);
        c.id = `${p.id}_k${i}`;
        c.visual = { ...p.visual, mainThrusters: [], torqueThrusters: [] };
        c.editorLights = null;
        c.__bridge3D = undefined;
        c.__bridge3DState = undefined;
        c.__bridge3DFull = undefined;
        c.hideHexVisual = !hulls;
        c.x = -6200 + col * sx + sx * 0.5;
        c.y = y0 + row * sy;
        c.angle = ((i * 37) % 360) * DEG * 0.05;
        c.vx = 0; c.vy = 0; c.angVel = 0;
        clones.push(c);
        if (++col >= perRow) { col = 0; row++; }
      }
      y0 += (row + (col > 0 ? 1 : 0)) * sy + 200;
    }
    sim.entities.length = 0;
    for (const c of clones) sim.entities.push(c);
    const out = { ships: clones.length, records: 0, views: [] };
    const pause = () => new Promise((r) => setTimeout(r, 4));
    const measure = async (on) => {
      setModel3D(on);
      const acc = { update: [], frame: [], draw: [], hex: [], gpu: [], ortho: 0, fg: 0, emitters: 0, visible: 0 };
      let lastGpu = -1;
      for (let f = 0; f < frames; f++) {
        clock.virtual += 1000 / 60;
        sim.time += 1 / 60;
        const t0 = realNow();
        renderFrame(1 / 60);
        const ft = realNow() - t0;
        // Oddaj wątek: zapytania timera GPU muszą się zakończyć (Core3D._gpuTimerPoll).
        await pause();
        if (f < 12) continue;
        acc.frame.push(ft);
        acc.update.push(bench3D.lastUpdateMs);
        acc.draw.push(bench3D.drawMs);
        acc.hex.push(bench3D.hexMs);
        const g = Number(Core3D.gpuFrameMs);
        if (Number.isFinite(g) && g > 0 && g !== lastGpu) { acc.gpu.push(g); lastGpu = g; }
        const info = Core3D.lastFrameRenderInfo || {};
        acc.ortho = info.ortho?.calls ?? null;
        acc.fg = info.fg?.calls ?? null;
        acc.emitters = Bridge3D.stats.emitters;
        acc.visible = Bridge3D.stats.visible;
      }
      const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? +b[Math.floor(b.length / 2)].toFixed(3) : null; };
      const p90 = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? +b[Math.floor(b.length * 0.9)].toFixed(3) : null; };
      return { updateMs: med(acc.update), updateP90: p90(acc.update), frameMs: med(acc.frame), drawMs: med(acc.draw), hexMs: med(acc.hex), gpuMs: med(acc.gpu), gpuSamples: acc.gpu.length, orthoCalls: acc.ortho, fgCalls: acc.fg, instances: acc.visible, emitters: acc.emitters, drawCalls: on ? Bridge3D.stats.drawCalls : 0 };
    };
    // Koszt podpięcia: pierwsza klatka tworzy rekordy wszystkich okrętów naraz.
    setModel3D(true);
    cam.x = 0; cam.y = -1200; cam.zoom = views[0];
    renderFrame(1 / 60);
    out.adoptMs = +bench3D.lastUpdateMs.toFixed(3);
    out.adoptRecords = Bridge3D.stats.records;
    try {
      for (const z of views) {
        cam.x = 0; cam.y = -1200; cam.zoom = z;
        renderFrame.lastFocus = null;
        // Na zmianę, żeby dryf zegarów/temperatury nie faworyzował żadnej strony.
        const on = await measure(true);
        const off = await measure(false);
        const on2 = await measure(true);
        const off2 = await measure(false);
        const avg = (a, b) => { const o = {}; for (const k of Object.keys(a)) o[k] = typeof a[k] === 'number' && typeof b[k] === 'number' ? +((a[k] + b[k]) / 2).toFixed(3) : a[k]; return o; };
        const row = { zoom: z, on: avg(on, on2), off: avg(off, off2), variants: {} };
        // Warianty diagnostyczne (np. bez brył / bez cienia) w tej samej scenie.
        for (const v of variants) {
          const keep = {};
          for (const k of Object.keys(v.tune)) { keep[k] = BRIDGE3D_TUNE[k]; BRIDGE3D_TUNE[k] = v.tune[k]; }
          const a = await measure(true);
          const b = await measure(false);
          for (const k of Object.keys(keep)) BRIDGE3D_TUNE[k] = keep[k];
          row.variants[v.label] = { on: a, off: b };
        }
        out.views.push(row);
      }
      out.records = Bridge3D.stats.records;
      setModel3D(true);
      cam.x = 0; cam.y = -1200; cam.zoom = views[0];
      renderFrame(1 / 60);
    } finally {
      running = true;
    }
    return out;
  },
  // Pasma HDR okien modelu: kadr z emiterami i bez (różnica pikseli), bez bloomu.
  measureWindows3D(rect = null) {
    const r = rect || { x: W * 0.25, y: H * 0.25, w: W * 0.5, h: H * 0.5 };
    const readLum = () => {
      renderFrame(0);
      const rt = Core3D.postTarget;
      const pr = Core3D.pixelRatio || 1;
      const x = Math.max(0, Math.floor(r.x * pr));
      const w = Math.max(1, Math.min(rt.width - x, Math.floor(r.w * pr)));
      const h = Math.max(1, Math.floor(r.h * pr));
      const y = Math.max(0, rt.height - Math.floor(r.y * pr) - h);
      const buf = new Uint16Array(w * h * 4);
      Core3D.renderer.readRenderTargetPixels(rt, x, y, w, h, buf);
      const lum = new Float32Array(w * h);
      for (let i = 0, j = 0; i < buf.length; i += 4, j++) {
        lum[j] = 0.2126 * THREE.DataUtils.fromHalfFloat(buf[i]) + 0.7152 * THREE.DataUtils.fromHalfFloat(buf[i + 1]) + 0.0722 * THREE.DataUtils.fromHalfFloat(buf[i + 2]);
      }
      return lum;
    };
    const prevBloom = Core3D.perfToggles.bloom !== false;
    Core3D.setPerfToggles({ bloom: false });
    const T = BRIDGE3D_TUNE;
    const keep = [T.winCoreGain, T.winHaloGain, T.beaconCoreGain, T.beaconHaloGain, T.accentCoreGain, T.accentHaloGain];
    const on = readLum();
    T.winCoreGain = T.winHaloGain = T.beaconCoreGain = T.beaconHaloGain = T.accentCoreGain = T.accentHaloGain = 0;
    const off = readLum();
    [T.winCoreGain, T.winHaloGain, T.beaconCoreGain, T.beaconHaloGain, T.accentCoreGain, T.accentHaloGain] = keep;
    Core3D.setPerfToggles({ bloom: prevBloom });
    renderFrame(0);
    const lit = [];
    let over = 0; let max = 0; let hullOver = 0; let offMax = 0;
    for (let i = 0; i < on.length; i++) {
      if (off[i] > 0.9) hullOver++;
      if (off[i] > offMax) offMax = off[i];
      if (on[i] - off[i] <= 0.02) continue;
      lit.push(on[i]);
      if (on[i] > 0.9) over++;
      if (on[i] > max) max = on[i];
    }
    lit.sort((a, b) => a - b);
    const pct = (p) => lit[Math.min(lit.length - 1, Math.floor(lit.length * p))] || 0;
    return { rect: r, pixels: on.length, windowPixels: lit.length, windowPixelsOver09: over, maxWithWindows: max,
      p50: pct(0.5), p90: pct(0.9), p99: pct(0.99), surfacePixelsOver09: hullOver, surfaceMax: offMax };
  },
  renderFrames(n = 1) {
    for (let i = 0; i < n; i++) renderFrame(0);
    return window.__rendererInfo || null;
  },
  stats() {
    return {
      time: sim.time,
      shots: sim.stats.shots,
      hullHits: sim.stats.hullHits,
      probeMisses: sim.stats.probeMisses,
      windows: BridgeFx3D.count,
      calls: window.__rendererInfo?.calls ?? null,
      errors: errors.slice(),
      targets: sim.targets.map((t) => ({
        key: t.hullKey,
        hp: Math.round(t.hp),
        hexes: getHexStructuralState(t),
        dead: t.combat.dead,
        cause: t.combat.deathCause,
        commandLost: !!t.bridgeState?.commandLost,
        bridges: (t.bridgeState?.bridges || []).map((b) => ({ id: b.id, total: b.total, alive: b.alive, integrity: +b.integrity.toFixed(3), dead: b.dead }))
      }))
    };
  },
  // Histogram luminancji HDR sceny (przed ACES) w prostokącie ekranu (px CSS).
  measureHDR(rect = null, { bloom = false } = {}) {
    const prev = Core3D.perfToggles.bloom !== false;
    Core3D.setPerfToggles({ bloom });
    renderFrame(0);
    const rt = Core3D.postTarget;
    const pr = Core3D.pixelRatio || 1;
    const r = rect || { x: 0, y: 0, w: W, h: H };
    const x = Math.max(0, Math.floor(r.x * pr));
    const w = Math.max(1, Math.min(rt.width - x, Math.floor(r.w * pr)));
    const hgt = Math.max(1, Math.floor(r.h * pr));
    const y = Math.max(0, rt.height - Math.floor((r.y) * pr) - hgt);
    const buf = new Uint16Array(w * hgt * 4);
    Core3D.renderer.readRenderTargetPixels(rt, x, y, w, hgt, buf);
    Core3D.setPerfToggles({ bloom: prev });
    const lum = [];
    let nan = 0;
    let over = 0;
    let max = 0;
    for (let i = 0; i < buf.length; i += 4) {
      const R = THREE.DataUtils.fromHalfFloat(buf[i]);
      const G = THREE.DataUtils.fromHalfFloat(buf[i + 1]);
      const B = THREE.DataUtils.fromHalfFloat(buf[i + 2]);
      if (!Number.isFinite(R) || !Number.isFinite(G) || !Number.isFinite(B)) { nan++; continue; }
      const l = 0.2126 * R + 0.7152 * G + 0.0722 * B;
      lum.push(l);
      if (l > 0.9) over++;
      if (l > max) max = l;
    }
    lum.sort((a, b) => a - b);
    const pct = (p) => lum[Math.min(lum.length - 1, Math.floor(lum.length * p))] || 0;
    const bins = [0.05, 0.2, 0.4, 0.9, 1.3, 2, 4, 8, 12, Infinity];
    const hist = bins.map(() => 0);
    for (const l of lum) { for (let k = 0; k < bins.length; k++) if (l <= bins[k]) { hist[k]++; break; } }
    return {
      rect: r, pixels: lum.length, nanOrInf: nan, over09: over, overFraction: over / Math.max(1, lum.length),
      p50: pct(0.5), p90: pct(0.9), p99: pct(0.99), p999: pct(0.999), max,
      histogram: Object.fromEntries(bins.map((b, k) => [`<=${b}`, hist[k]]))
    };
  },
  // Prostokąt ekranu (px CSS) obejmujący strefy mostków celu.
  bridgeRect(targetKey = state.focus, pad = 12) {
    const t = sim.targets.find((e) => e.hullKey === targetKey);
    if (!t?.bridgeState) return null;
    const view = makeView(cam, W, H);
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const b of t.bridgeState.bridges) {
      for (const s of b.shards) {
        const lx = s.gridX - t.hexGrid.srcWidth / 2;
        const ly = s.gridY - t.hexGrid.srcHeight / 2;
        const c = Math.cos(t.angle);
        const sn = Math.sin(t.angle);
        const q = view.toScreen(t.x + lx * c - ly * sn, t.y + lx * sn + ly * c);
        x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y);
      }
    }
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
  },
  zoneContainsWorld(targetKey, wx, wy) {
    const t = sim.targets.find((e) => e.hullKey === targetKey);
    if (!t?.bridgeState) return false;
    return t.bridgeState.bridges.some((b) => bridgeZoneContains(b.def, wx, wy));
  },
  runBench: async (planOpts) => {
    running = false;
    try { return await runBenchPlan(benchEnv(), standardPlan(planOpts)); } finally { running = true; buildScene(); }
  },
  exportText,
  gpuSoftBody: () => ({ active: !!DestructorGpuSoftBody.active, ready: !!DestructorGpuSoftBody.ready }),
  // Średnie i maksymalne przesunięcie heksów względem ich komórek (duchy).
  drift(targetKey = state.focus) {
    const t = sim.targets.find((e) => e.hullKey === targetKey);
    if (!t) return null;
    let max = 0; let sum = 0; let n = 0; let far = 0;
    const R = 5; const hexH = Math.sqrt(3) * R;
    for (const s of t.hexGrid.shards) {
      if (!s.active || s.isDebris) continue;
      const cx = s.c * R * 1.5;
      const cy = s.r * hexH + ((s.c & 1) ? hexH / 2 : 0);
      const d = Math.hypot(s.gridX + s.deformation.x * 1.15 - cx, s.gridY + s.deformation.y * 1.15 - cy);
      sum += d; n++; if (d > max) max = d; if (d > 22) far++;
    }
    return { mean: sum / Math.max(1, n), max, beyondProbeWindow: far };
  },
  timeline: BRIDGE_KILL_TIMELINE,
  fxTune: BRIDGE_FX_TUNE,
  proposals: BRIDGE_LAYOUT_PROPOSALS,
  reactorBlowChance,
  evaluate: (key = state.focus) => evaluateShipBridges(sim.targets.find((e) => e.hullKey === key), sim.time)
};
window.__mostki = api;

// ---------------------------------------------------------------------------
(async function start() {
  try {
    await loadHullImages();
    wireUi();
    buildScene();
    if (params.get('lock') === '1') setLock(true);
    $('loading').style.display = 'none';
    api.ready = true;
    requestAnimationFrame(loop);
  } catch (err) {
    reportError(err.stack || err);
  }
})();
