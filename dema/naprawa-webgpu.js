// Demo ROJU DRONÓW NAPRAWCZYCH na WebGPU — wszystko jak w grze: Core3D (WebGPU, TSL, bloom, ACES), kadłub Atlasa na
// silniku belek (HullBodies + skóra hexShips3D, mapa ran), rig dronów (src/game/repairRig.js — plan, lokalne
// prostowanie, odrost komórek z materiału z ładowni, łaty, trafienia), obraz dronów (src/3d/repair/repairDrones3D.js —
// jedna partia, iskry i łuk spawania z pul gry, wybuch zestrzelonego drona z pul broni).
// Po otwarciu od razu: Atlas z kraterami i odciętą rufą, drony startują z doku na grzbiecie i naprawiają.
//
// Serwowanie: `npm run dev` → /dema/naprawa-webgpu.html   ?clean=1 (bez paneli)   ?test=1 (klatki z __naprawa.runFrames)
import { Core3D } from '../src/3d/core3d.js';
import { initHexShips3D, updateHexShips3D, drawHexShips3D, resizeHexShips3D, prewarmHexShips3D } from '../src/3d/hexShips3D.js';
import { HULL_PATCH } from '../src/3d/hexShips3D.tsl.js';
import { HULL_LACQUER_DEFAULTS } from '../src/3d/hullLacquer.js';
import { SparkSystem3D } from '../src/3d/sparkSystem3D.js';
import { WeaponFx } from '../src/3d/weapons/weaponFx.js';
import { HullDamageMap } from '../src/3d/hullDamageMap.js';
import { syncRepairDrones3D, repairDronesView } from '../src/3d/repair/repairDrones3D.js';
import { HullBodies } from '../src/game/hullBodies.js';
import { raiseHullHpForRegrowth } from '../src/game/hullIntegrity.js';
import { SimClock } from '../src/game/simClock.js';
import { RepairSwarm } from '../src/game/repairSwarm.js';
import { DRONE_STATE, REPAIR_MSG } from '../src/game/repairRig.js';
import { REPAIR_TUNE, repairDroneCountFor } from '../src/data/repairDrones.js';
import { World, loadHullAssets } from './mostki-webgpu/swiat.js';
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

const S = {
  paused: false, timeScale: 1, acc: 0, frame: 0,
  cam: { x: 0, y: 0, zoom: 0.5 }, camTo: null, follow: null,
  mouse: { x: 0, y: 0, wx: 0, wy: 0, pan: false, lastX: 0, lastY: 0 },
  moving: false, firing: false, fireT: 0, tracers: [],
  frameMs: 16, cpuMs: 0, rigMs: 0, log: []
};
window.camera = {
  get x() { return S.cam.x; }, get y() { return S.cam.y; }, get zoom() { return S.cam.zoom; },
  shakeMag: 0, shakeDur: 0, addShake() {}
};

function log(text, cls = '') {
  const t = world ? world.time.toFixed(2).padStart(6) : '  0.00';
  S.log.push({ text: `${t}s  ${text}`, cls });
  if (S.log.length > 9) S.log.shift();
  $('log').innerHTML = S.log.map((l) => `<div style="color:${l.cls === 'bad' ? '#ff9a90' : (l.cls === 'warn' ? '#f0c080' : (l.cls === 'good' ? '#9ff0b8' : '#c9d6dd'))}">${l.text.replace(/</g, '&lt;')}</div>`).join('');
}

// ---------------------------------------------------------------------------
// Render: Core3D + hexShips3D, efekty gry
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
// Jak w grze (index.html): mapa ran z kraterów i rzazów, punkty kadłuba rosną z odrostem.
HullBodies.onImpact = HullDamageMap.onHullImpact;
HullBodies.onRepair = HullDamageMap.onHullRepair;
HullBodies.onNodeLost = HullDamageMap.onHullNodeLost;
HullBodies.onRegrow = raiseHullHpForRegrowth;

let world = null;
let atlas = null;
let rig = null;
let backdrop = null;
const cargo = { scrap: 4, steel: 14 };
const cullInfo = { x: 0, y: 0, halfW: 1e5, halfH: 1e5, drawHalfW: 1e5, drawHalfH: 1e5 };
const renderList = [];

function setupFx() {
  backdrop = createBackdrop(Core3D);
  SparkSystem3D.init(Core3D.scene);
  window.SparkSystem3D = SparkSystem3D;
  WeaponFx.ensure();
  repairDronesView();
}

// ---------------------------------------------------------------------------
// Scena: Atlas, kratery i rzaz przez rufę (wrak odsunięty — nie stoi w miejscu odrostu)
function hullLength(e) {
  const h = e?.beamHull;
  return h ? Math.max(h.srcWidth, h.srcHeight) * h.scale : 1800;
}

function damage(first = false) {
  if (!atlas || !HullBodies.hasHull(atlas)) return;
  const a = atlas.angle || 0, c = Math.cos(a), s = Math.sin(a);
  const hit = (along, side, dmg, weapon, craterR) => {
    const nx = -s * side, ny = c * side, px = atlas.x + c * along, py = atlas.y + s * along, L = 1200;
    const sw = HullBodies.sweep(atlas, px + nx * L, py + ny * L, px - nx * L, py - ny * L, 0);
    if (!sw) return 0;
    HullDamageMap.setSource(weapon);
    try { HullBodies.impact(atlas, sw.worldX, sw.worldY, dmg, { x: -nx * 2600, y: -ny * 2600 }, { craterRadius: craterR }); }
    finally { HullDamageMap.clearSource(); }
    atlas.hp = Math.max(1, atlas.hp - dmg);
    return 1;
  };
  const j = first ? 0 : (world.time * 97) % 1;
  hit(-430 + j * 120, 1, 1400, 'special_yamato_cannon', 60);
  hit(-150 - j * 90, -1, 1400, 'special_yamato_cannon', 55);
  hit(160 + j * 60, 1, 300, 'armata_mk1', 30);
  hit(380, -1, 300, 'armata_mk1', 34);
  hit(600 - j * 200, 1, 900, 'special_goliath_autocannon', 42);
  if (first) {
    const tail = -(atlas.beamHull.radius || 900) * 0.7;
    const tx = atlas.x + c * tail, ty = atlas.y + s * tail;
    // Rzaz z pędem (jak Hexlance w grze): odłamki i odcięta rufa odlatują, zamiast wisieć przy brzegu.
    HullBodies.cutSegment(atlas, tx - s * 1200, ty + c * 1200, tx + s * 1200, ty - c * 1200, 22, { push: true });
  }
  log(first ? 'Kratery (Yamato, armata, Goliath) i rzaz przez rufę' : 'Nowe trafienia w kadłub', 'warn');
}

function pushWrecksAway() {
  for (const w of world.wrecks) {
    if (!w || w.dead || w.__pushed) continue;
    w.__pushed = true;
    // odcięta sekcja odpływa (pomału — widać, że nie stoi w miejscu odrostu)
    const dx = w.x - atlas.x, dy = w.y - atlas.y, L = Math.hypot(dx, dy) || 1;
    w.vx = (atlas.vx || 0) + dx / L * 160; w.vy = (atlas.vy || 0) + dy / L * 160; w.angVel = 0.12;
  }
}

function setupScene() {
  world = new World({ onLog: log });
  atlas = world.add('atlas', { x: 0, y: 0, angle: -0.18, label: 'Atlas' });
  atlas.hp = atlas.maxHp = 12000;
  for (const t of atlas.visual?.mainThrusters || []) t.__throttle = 0;
  damage(true);
  rig = RepairSwarm.create({
    carrier: atlas, cargo, drones: repairDroneCountFor('atlas'),
    env: {
      friendly: () => true,
      // Wrak odciętej sekcji w miejscu komórki — dron czeka (jak w grze: repairCellBlocked).
      cellBlocked: (target, x, y) => {
        for (const w of world.wrecks) if (w && !w.dead && HullBodies.hasHull(w) && HullBodies.probe(w, x, y)) return true;
        return false;
      },
      onCellRegrown: (e, ix, iy) => HullDamageMap.patchCell(e, ix, iy)
    }
  });
  rig.onMessage = (text, kind) => log(text, kind === REPAIR_MSG.LOST || kind === REPAIR_MSG.NO_MATERIAL ? 'bad' : (kind === REPAIR_MSG.DONE ? 'good' : ''));
  fit();
}

function fit() {
  const free = W > 900 ? W - 320 : W;
  S.follow = null;
  S.camTo = { x: atlas.x, y: atlas.y, zoom: Math.min(2, Math.max(0.06, free * 0.62 / hullLength(atlas))), rate: 0 };
  S.cam.x = S.camTo.x; S.cam.y = S.camTo.y; S.cam.zoom = S.camTo.zoom; S.camTo = null;
}

function closeOnDrone() {
  const d = rig.drones.find((x) => x.state === DRONE_STATE.WORK) || rig.drones.find((x) => x.state === DRONE_STATE.FLY);
  if (!d) return;
  S.follow = d;
  S.cam.zoom = 2.6;
}

// ---------------------------------------------------------------------------
// Ostrzał dronów: działo wroga obok kadłuba strzela w drony (trafienia jak w grze — RepairSwarm.hitSegment, strona
// przeciwna), smugowiec na nakładce 2D, trafienie — efekt WeaponFx.
const gun = { x: 0, y: 0 };
function placeGun() {
  const a = atlas.angle || 0;
  gun.x = atlas.x - Math.sin(a) * 900 + Math.cos(a) * 200;
  gun.y = atlas.y + Math.cos(a) * 900 + Math.sin(a) * 200;
}
function shootAt(tx, ty, dmg = 30) {
  const dx = tx - gun.x, dy = ty - gun.y, L = Math.hypot(dx, dy) || 1;
  const ex = gun.x + dx / L * (L + 200), ey = gun.y + dy / L * (L + 200);
  const hit = RepairSwarm.hitSegment(gun.x, gun.y, ex, ey, 3, false);
  const hx = hit ? hit.x : ex, hy = hit ? hit.y : ey;
  if (hit) {
    RepairSwarm.damage(hit, dmg);
    SparkSystem3D.burst(hx, hy, 8, 220, 0.3, 0.5, '#ffd080');
  }
  S.tracers.push({ x0: gun.x, y0: gun.y, x1: hx, y1: hy, t: 0.12 });
}
function stepGun(dt) {
  if (!S.firing) return;
  S.fireT -= dt;
  if (S.fireT > 0) return;
  S.fireT = 0.22;
  placeGun();
  let best = null, bd = Infinity;
  for (const d of rig.drones) {
    if (d.state === DRONE_STATE.DOCKED || d.state === DRONE_STATE.DEAD) continue;
    const dd = Math.hypot(d.wx - gun.x, d.wy - gun.y);
    if (dd < bd) { bd = dd; best = d; }
  }
  if (best) shootAt(best.wx, best.wy, 30);
}

// ---------------------------------------------------------------------------
// Klatka
function physicsStep(dt) {
  if (S.moving) {
    atlas.vx = Math.cos(atlas.angle) * 220;
    atlas.vy = Math.sin(atlas.angle) * 220;
    atlas.angVel = 0.06;
  } else {
    atlas.vx *= Math.exp(-2 * dt); atlas.vy *= Math.exp(-2 * dt); atlas.angVel *= Math.exp(-2 * dt);
  }
  world.step(dt);
  pushWrecksAway();
  const t0 = performance.now();
  RepairSwarm.step(dt);
  S.rigMs = S.rigMs * 0.98 + (performance.now() - t0) * 0.02;
  stepGun(dt);
}

let lastT = performance.now();
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

const _sync = { poseOf: null, dt: 0, zoom: 1, time: 0 };
function render(realDt, simDt) {
  if (S.follow) {
    const d = S.follow;
    if (d.state === DRONE_STATE.DOCKED || d.state === DRONE_STATE.DEAD) S.follow = null;
    else { const k = 1 - Math.exp(-6 * realDt); S.cam.x += (d.wx - S.cam.x) * k; S.cam.y += (d.wy - S.cam.y) * k; }
  } else if (S.moving) {
    const k = 1 - Math.exp(-4 * realDt);
    S.cam.x += (atlas.x - S.cam.x) * k; S.cam.y += (atlas.y - S.cam.y) * k;
  }
  S.mouse.wx = S.cam.x + (S.mouse.x - W * 0.5) / S.cam.zoom;
  S.mouse.wy = S.cam.y + (S.mouse.y - H * 0.5) / S.cam.zoom;
  Core3D.beginPlanetLayerFrame?.();
  SimClock.beginRender(1, PHYS_DT, S.paused || simDt <= 0);
  const cam = { x: S.cam.x, y: S.cam.y, zoom: S.cam.zoom };
  cullInfo.x = cam.x; cullInfo.y = cam.y;
  cullInfo.drawHalfW = W * 0.5 / cam.zoom + 600; cullInfo.drawHalfH = H * 0.5 / cam.zoom + 600;
  cullInfo.halfW = cullInfo.drawHalfW * 3; cullInfo.halfH = cullInfo.drawHalfH * 3;
  renderList.length = 0;
  for (const e of world.entities()) renderList.push(e);
  backdrop.sync(cam, W, H);
  updateHexShips3D(cam, renderList, cullInfo);
  _sync.dt = simDt; _sync.zoom = cam.zoom; _sync.time = world.time;
  syncRepairDrones3D(_sync);
  drawHexShips3D(ctx2d, W, H);
  drawOverlay(cam, realDt);
  updateHud();
}

function drawOverlay(cam, dt) {
  const toS = (x, y) => ({ x: (x - cam.x) * cam.zoom + W * 0.5, y: (y - cam.y) * cam.zoom + H * 0.5 });
  ctx2d.save();
  for (let i = S.tracers.length - 1; i >= 0; i--) {
    const t = S.tracers[i];
    t.t -= dt;
    if (t.t <= 0) { S.tracers.splice(i, 1); continue; }
    const a = toS(t.x0, t.y0), b = toS(t.x1, t.y1);
    ctx2d.strokeStyle = `rgba(255,140,90,${Math.min(1, t.t * 10)})`;
    ctx2d.lineWidth = 1.6;
    ctx2d.beginPath(); ctx2d.moveTo(a.x, a.y); ctx2d.lineTo(b.x, b.y); ctx2d.stroke();
  }
  if (S.firing && !document.body.classList.contains('clean')) {
    const g = toS(gun.x, gun.y);
    ctx2d.strokeStyle = '#ff7a5a';
    ctx2d.lineWidth = 1.5;
    ctx2d.beginPath(); ctx2d.arc(g.x, g.y, 8, 0, Math.PI * 2); ctx2d.stroke();
  }
  ctx2d.restore();
}

let hudAcc = 0;
function updateHud() {
  if (++hudAcc % 6) return;
  const r = rig.stats;
  const st = HullBodies.structuralState(atlas) || { ratio: 0 };
  const info = Core3D.lastFrameRenderInfo?.total || Core3D.renderer?.info?.render || {};
  const view = repairDronesView();
  const lines = [];
  lines.push(`<b>${(1000 / Math.max(1, S.frameMs)).toFixed(0)} FPS</b> · CPU ${S.cpuMs.toFixed(1)} ms · rig ${S.rigMs.toFixed(3)} ms/krok · GPU ${(Number(Core3D.gpuFrameMs) || 0).toFixed(1)} ms · draw ${info.drawCalls ?? info.calls ?? 0}${S.paused ? ' · <span class="warn">PAUZA</span>' : ''}`);
  lines.push(`drony <b>${r.alive}/${r.total}</b> · w powietrzu ${r.out} · przy pracy ${r.working}${rig.launched ? (rig.recalling ? ' · <span class="warn">POWRÓT</span>' : ' · <span class="good">PRACUJĄ</span>') : ' · w doku'}`);
  lines.push(`kadłub: węzły ${(st.ratio * 100).toFixed(1)}% · punkty ${Math.round(atlas.hp)} / ${atlas.maxHp} · łaty ${HullBodies.patchedCount(atlas)}`);
  lines.push(`materiał: ${r.materialCells} komórek (złom ${cargo.scrap || 0} t · stal ${cargo.steel || 0} t · płyty ${cargo.hull_plate || 0})`);
  lines.push(`odbudowane ${r.cellsRegrown} · prostowania ${r.straightenJobs} · zestrzelone ${r.dronesLost} · iskry ${view?.stats.sparks ?? 0} · światła ${view?.stats.lights ?? 0}`);
  $('hud').innerHTML = lines.join('\n');
  $('progress').style.width = `${(r.progress * 100).toFixed(1)}%`;
  $('progress-label').textContent = rig.launched ? `postęp naprawy ${(r.progress * 100).toFixed(0)}%` : 'drony w doku — R wypuszcza';
  $('btn-r').classList.toggle('on', rig.launched);
  $('btn-move').classList.toggle('on', S.moving);
  $('btn-patch').classList.toggle('on', HULL_PATCH.uOn.value < 0.5);
  $('btn-fire').classList.toggle('on', S.firing);
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
const ACTIONS = {
  r: () => { rig.toggle(); },
  d: () => damage(false),
  m: () => { S.moving = !S.moving; log(S.moving ? 'Atlas w ruchu (220 j/s, skręt) — drony dopasowują ruch i obrót kadłuba' : 'Atlas hamuje'); },
  p: () => { HULL_PATCH.uOn.value = HULL_PATCH.uOn.value > 0.5 ? 0 : 1; log(HULL_PATCH.uOn.value > 0.5 ? 'Łata: podkład ze spawami' : 'A/B: łata farbą sprite’a'); },
  f: () => { S.firing = !S.firing; placeGun(); log(S.firing ? 'Ostrzał dronów (działo wroga obok kadłuba)' : 'Koniec ostrzału', S.firing ? 'warn' : ''); },
  u: () => { const n = rig.refill(); log(n ? `Dok: uzupełniono ${n} dronów (${n * REPAIR_TUNE.refillPrice} CR)` : 'Wszystkie drony sprawne', 'good'); },
  s: () => { cargo.steel = (cargo.steel || 0) + 10; log('Ładownia: +10 t stali (400 komórek)', 'good'); },
  o: () => { rig.dockAll(); HullBodies.restoreHull(atlas); atlas.hp = atlas.maxHp; log('Remont w doku: kadłub = szablon, łaty wymienione na blachę z farbą', 'good'); },
  ' ': () => { S.paused = !S.paused; $('btn-pause').classList.toggle('on', S.paused); },
  t: () => { S.timeScale = S.timeScale === 1 ? 0.25 : 1; $('btn-slow').classList.toggle('on', S.timeScale !== 1); },
  1: () => fit(),
  2: () => closeOnDrone(),
  h: () => document.body.classList.toggle('clean')
};
function bindPanel() {
  const map = { 'btn-r': 'r', 'btn-damage': 'd', 'btn-move': 'm', 'btn-patch': 'p', 'btn-fire': 'f', 'btn-refill': 'u', 'btn-steel': 's',
    'btn-dock': 'o', 'btn-pause': ' ', 'btn-slow': 't', 'btn-fit': '1', 'btn-close': '2', 'btn-clean': 'h' };
  for (const [id, k] of Object.entries(map)) $(id)?.addEventListener('click', () => ACTIONS[k]());
}
function bindInput() {
  canvas2d.addEventListener('mousemove', (e) => {
    const m = S.mouse;
    if (m.pan) {
      S.cam.x -= (e.clientX - m.lastX) / S.cam.zoom;
      S.cam.y -= (e.clientY - m.lastY) / S.cam.zoom;
      S.follow = null;
    }
    m.x = e.clientX; m.y = e.clientY; m.lastX = e.clientX; m.lastY = e.clientY;
  });
  canvas2d.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas2d.addEventListener('mousedown', (e) => {
    const m = S.mouse;
    m.lastX = e.clientX; m.lastY = e.clientY;
    if (e.button === 1 || (e.button === 0 && e.altKey)) { m.pan = true; e.preventDefault(); return; }
    if (e.button === 0) { placeGun(); shootAt(m.wx, m.wy, 45); }
  });
  window.addEventListener('mouseup', () => { S.mouse.pan = false; });
  canvas2d.addEventListener('wheel', (e) => {
    e.preventDefault();
    const bx = S.cam.x + (e.clientX - W * 0.5) / S.cam.zoom, by = S.cam.y + (e.clientY - H * 0.5) / S.cam.zoom;
    S.cam.zoom = Math.min(8, Math.max(0.04, S.cam.zoom * Math.exp(-e.deltaY * 0.0012)));
    S.cam.x = bx - (e.clientX - W * 0.5) / S.cam.zoom;
    S.cam.y = by - (e.clientY - H * 0.5) / S.cam.zoom;
  }, { passive: false });
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (ACTIONS[k]) { ACTIONS[k](); e.preventDefault(); }
  });
  window.addEventListener('resize', () => {
    W = innerWidth; H = innerHeight;
    canvas2d.width = W; canvas2d.height = H;
    glCanvas.width = W; glCanvas.height = H;
    resizeHexShips3D(W, H);
  });
}

// API konsoli / harnessu.
window.__naprawa = {
  ready: false, S, cargo,
  get world() { return world; }, get atlas() { return atlas; }, get rig() { return rig; },
  act(k) { ACTIONS[k]?.(); return true; },
  async runFrames(n = 1, fps = 60) {
    for (let i = 0; i < n; i++) {
      frame(1 / fps);
      if ((i % 8) === 7) await new Promise((ok) => requestAnimationFrame(() => ok()));
    }
    return true;
  },
  setCamera(x, y, zoom) { S.follow = null; S.cam.x = x; S.cam.y = y; S.cam.zoom = zoom; return true; },
  stats() {
    const st = HullBodies.structuralState(atlas) || {};
    return { time: world.time, ratio: st.ratio, hp: atlas.hp, patched: HullBodies.patchedCount(atlas), ...rig.stats, launched: rig.launched,
      warmup: Core3D.warmup?.stats ? { ...Core3D.warmup.stats } : null };
  }
};

(async () => {
  try {
    await loadHullAssets(['atlas']);
    if (!(await Core3D.ready)) {
      $('nogpu').style.display = 'flex';
      $('nogpu-detail').textContent = Core3D.gpuError || 'brak adaptera WebGPU';
      $('loading').style.display = 'none';
      window.__naprawa.error = 'webgpu';
      return;
    }
    await Core3D.warmup.run('kadłuby, mapa ran, broń (hexShips3D)', () => prewarmHexShips3D({ canvas: glCanvas }));
    setupFx();
    setupScene();
    bindPanel();
    bindInput();
    await Core3D.warmup.flush?.({ timeoutMs: 6000 });
    $('loading').style.display = 'none';
    // Od razu po otwarciu: drony startują (rozpad rzazu i kraterów w pierwszych krokach — potem plan).
    for (let k = 0; k < 40; k++) physicsStep(PHYS_DT);
    rig.launch();
    window.__naprawa.ready = true;
    requestAnimationFrame(loop);
  } catch (err) {
    reportError(err.stack || String(err));
  }
})();
