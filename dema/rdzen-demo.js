// Demo RDZENIA statku (reaktor) — Atlas, Bellator, Iron Skull.
// Serwowanie: `npm run dev`, potem /dema/rdzen-demo.html
//   ?scene=battleship|pirate_battleship|atlas|trio|formation  ?weapon=railgun_mk2
//   ?shot=1 (bez paneli, do zrzutów)  ?cpuSoft=1 (lustro solvera zamiast WebGPU)
//
// Stos renderu jak w grze: fizyka 2D (destruktor, 120 Hz) → updateHexShips3D →
// drawHexShips3D (Core3D: bloom, ACES, pasma HDR 1:1) → overlay3D z prawdziwą
// fabryką reactorblow.js (tak jak triggerReactorBlow3D w index.html) → HUD 2D.
// Rdzenie: src/game/shipCore.js (logika), src/3d/coreFx3D.js (żar i wyrzuty).
import { Core3D } from '../src/3d/core3d.js';
import { initHexShips3D, updateHexShips3D, drawHexShips3D, resizeHexShips3D } from '../src/3d/hexShips3D.js';
import { DestructorSystem, DESTRUCTOR_CONFIG, setHexShips3DActive, disposeHexBody } from '../src/game/destructor.js';
import { DestructorGpuSoftBody } from '../src/game/destructorGpuSoftBody.js';
import { initOverlay } from '../src/effects3d/overlay.js';
import { createReactorBlowFactory } from '../src/effects3d/reactorblow.js';
import { createCoreFx3D } from '../src/3d/coreFx3D.js';
import { createReactor3D } from '../src/3d/reactor3D.js';
import { Fx3D } from '../src/3d/fxParticles3D.js';
import { MuzzleFX3D } from '../src/3d/muzzleFx3D.js';
import { SparkSystem3D } from '../src/3d/sparkSystem3D.js';
import { HULL_LACQUER_DEFAULTS } from '../src/3d/hullLacquer.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { stepDecay120 } from '../src/game/stepDecay.js';
import * as SC from '../src/game/shipCore.js';
import * as Combat from './rdzen-combat.js';
import { HULLS, expandCandidate } from './rdzen-hulls-data.js';
import { loadHullAssets, createShip, SCENES, sceneBounds, buildBrowserHull } from './rdzen-scene.js';
import { drawOverlays2D, screenToWorld } from './rdzen-overlay2d.js';
import { createCpuSoftBody } from './rdzen-softbody-cpu.js';
import { runCoreBenchmarkCase, BENCH_DIRECTIONS, formatBenchRow, BENCH_TABLE_HEADER } from './rdzen-bench.js';

const params = new URLSearchParams(location.search);
const shotMode = params.get('shot') === '1';
if (shotMode) document.body.classList.add('shot');
if (params.get('hud') === '1') document.body.classList.add('hud');
const $ = (id) => document.getElementById(id);
const errorsEl = $('errors');
function reportError(text) {
  errorsEl.style.display = 'block';
  errorsEl.textContent += `${text}\n`;
  console.error(text);
}
window.addEventListener('error', (e) => reportError(`JS: ${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => reportError(`Promise: ${e.reason?.stack || e.reason}`));

const PHYS_DT = 1 / 120;
// chargeTime profili reactorblow.js (niewyeksportowane): wizualny wybuch
// startujemy tyle przed końcem odliczania, żeby błysk wypadł na detonację.
const BLOW_CHARGE = { fighter: 0.05, escort: 0.3, cruiser: 0.55, capital: 0.8 };

const DEMO_WEAPONS = [
  'railgun_mk2', 'heavy_autocannon', 'vulcan_minigun', 'tempest_ion_l', 'helios_laser',
  'armata_mk1', 'special_valkyrie_railgun', 'special_yamato_cannon', 'beam_continuous',
  'beam_pulse', 'siege_torpedo', 'missile_rack', 'siege_railgun'
];

// ---------------------------------------------------------------------------
// Stan
const S = {
  sceneId: SCENES[params.get('scene')] ? params.get('scene') : 'battleship',
  ships: [],
  destructibles: [],
  cam: { x: 0, y: 0, zoom: 0.8 },
  targetIndex: 0,
  gun: { x: 0, y: 900, source: { shipFrame: 'atlas', __demoGun: true } },
  gunOffset: { x: 0, y: 900 },
  weaponId: MASTER_WEAPONS[params.get('weapon')] ? params.get('weapon') : 'railgun_mk2',
  bullets: [],
  rockets: [],
  simTime: 0,
  paused: false,
  timeScale: 1,
  acc: 0,
  integrityAcc: 0,
  integrityTick: 0,
  firing: false,
  nextTrigger: 0,
  pendingShots: [],
  mouse: { x: 0, y: 0, world: { x: 0, y: 0 }, inside: false },
  log: [],
  markers: {},
  stats: {},
  shake: 0,
  alarmBeep: 0,
  frame: 0,
  lastFrameMs: 0,
  frameMsAvg: 16,
  blowVisuals: new WeakSet(),
  // po detonacji: strumienie plazmy, kule plazmy, zaplanowane wybuchy wtórne
  jets: [],
  orbs: [],
  secondaries: [],
  galleryRun: 0,
  modelGallery: 0,   // numer biegu galerii modeli (0 = nie trwa)
  // kamera przyklejona do reaktora (Z, galeria modeli): { core, prev: { x, y, zoom } }
  focus: null,
  aimExitAt: null,
  editor: { active: false, selected: null, dragging: false }
};
for (const id of Object.keys(HULLS)) S.markers[id] = HULLS[id].cores.map((m) => ({ ...m }));
window.bullets = S.bullets;
// Jak index.html:816. Solver sprężyn GPU niszczy rozerwane heksy WYŁĄCZNIE przez
// ten global (destructorGpuSoftBody.js _applyResult) — bez niego heks dostaje
// hp = 0, ale zostaje aktywny („zombie”: blokuje sondy, nie liczy się jako dziura).
window.DestructorSystem = DestructorSystem;

const opts = () => ({
  grid: $('ov-grid').checked, bridges: $('ov-bridges').checked, chamber: $('ov-chamber').checked, probe: $('ov-probe').checked,
  state: $('ov-state').checked, hp: $('ov-hp').checked, cands: $('ov-cands').checked,
  bugs: $('ov-bugs').checked, blast: $('ov-blast').checked, lock: $('lock').checked,
  weaponName: MASTER_WEAPONS[S.weaponId]?.name || S.weaponId
});

function coreConfig() {
  return {
    maxChainDepth: Number($('chain').value) | 0,
    attritionDetonatesFrom: $('attr-det').checked ? SC.CORE_STATE.CRITICAL : null,
    detonationVariant: $('det-variant').value || null
  };
}

const _rngSec = { s: 0x51ed270b };
function demoRng() {
  let t = (_rngSec.s = (_rngSec.s + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function log(text, cls = '') {
  const t = S.simTime.toFixed(2).padStart(6);
  S.log.push({ text: `${t}s  ${text}`, cls });
  if (S.log.length > 14) S.log.shift();
  $('log').innerHTML = S.log.map((l) => `<div class="${l.cls}">${l.text.replace(/</g, '&lt;')}</div>`).join('');
}

// ---------------------------------------------------------------------------
// Render: Core3D + hexShips3D + overlay (reactorblow)
const root = $('root');
const canvas2d = $('c');
const ctx2d = canvas2d.getContext('2d');
let W = innerWidth, H = innerHeight;
canvas2d.width = W; canvas2d.height = H;
const glCanvas = $('webgl-layer');
glCanvas.width = W; glCanvas.height = H;
// Lakier kadłubów: ścieżka obłoków jest względna do index.html (katalog główny),
// demo leży w /dema/ — podajemy ją od góry, reszta strojenia jak w grze.
window.__hullLacquerTune = { ...HULL_LACQUER_DEFAULTS, skyUrl: '../assets/reflections/lacquer-sky.png' };
initHexShips3D({ canvas: glCanvas });
setHexShips3DActive(true);
window.Core3D = Core3D;
// Słońce daleko (jak w grze: kierunek światła kadłubów, shadow shafts).
window.SUN = { x: -52000, y: -30000, r: 823 };

const overlayView = { viewport: { w: W, h: H }, zoom: S.cam.zoom, center: { x: 0, y: 0 } };
const overlay3D = initOverlay({ host: root, getView: () => overlayView });
window.overlay3D = overlay3D;
window.makeReactorBlow = createReactorBlowFactory(overlay3D.scene);
// Iskry trafień i tarcia jak w grze (index.html: SparkSystem3D.init(ov.scene));
// aktualizuje je overlay3D.tick, a coreFx3D sypie z tej puli przy cięciu i topieniu.
SparkSystem3D.init(overlay3D.scene);
window.SparkSystem3D = SparkSystem3D;

// Wybuch reaktora jak triggerReactorBlow3D w grze. Fali z refrakcją już nie ma:
// profile reactorblow.js mają shockwave3D/heatHaze = null (tylko supernova).
function spawnReactorBlow(opts) {
  overlay3D.spawn(window.makeReactorBlow(opts));
}

// Modele reaktora (pod pancerzem, widoczne przez wyrwę) i żar/wyrzuty — oba na
// warstwie passa tarcz (po cieniach); demo nie ma tarcz 3D, więc flagę warstwy
// gasi co klatkę render(), a sync-i ją zapalają. Rdzeń z modelem nie dostaje
// żaru coreFx: światło daje plazma w torusie.
const MODEL_KIND_BY_HULL = { battleship: 'terran', pirate_battleship: 'pirate', atlas: 'atlas' };
function demoReactorKind(core) {
  const pick = $('model-kind')?.value || 'auto';
  if (pick !== 'auto') return pick;
  return MODEL_KIND_BY_HULL[core?.host?.__hullId] || 'terran';
}
const reactor3D = createReactor3D({
  scene: Core3D.scene,
  markLayerActive: () => Core3D.setShieldLayerActive(true),
  kindFor: demoReactorKind
});
// początek instancji modelu przy kamerze (precyzja float32 — jak w grze)
const reactorSyncOpts = { origin: S.cam };
const coreFx = createCoreFx3D({
  scene: Core3D.scene,
  markLayerActive: () => Core3D.setShieldLayerActive(true),
  glowFilter: (core) => !reactor3D.covers(core)
});

let cpuSoft = null;
let restoreProbeMode = null;
function softBodyMode() {
  if ($('cpu-soft').checked || params.get('cpuSoft') === '1') return 'cpu';
  return DestructorGpuSoftBody.active ? 'gpu' : 'cpu (brak WebGPU)';
}

// ---------------------------------------------------------------------------
// Scena
function target() {
  const list = S.ships.filter((s) => !s.dead);
  if (!list.length) return null;
  return list[Math.min(S.targetIndex, list.length - 1)];
}

function allCores() {
  const out = [];
  for (const e of S.destructibles) {
    if (!e || e.dead || !Array.isArray(e.shipCores)) continue;
    for (const c of e.shipCores) if (c.host === e) out.push(c);
  }
  return out;
}

function clearWorld() {
  for (const e of S.destructibles) { try { disposeHexBody(e); } catch { /* */ } }
  S.ships.length = 0;
  S.destructibles.length = 0;
  S.bullets.length = 0;
  S.rockets.length = 0;
  S.pendingShots.length = 0;
  S.jets.length = 0;
  S.orbs.length = 0;
  S.secondaries.length = 0;
  DestructorSystem.splitQueue = [];
  S.blowVisuals = new WeakSet();
  coreFx.reset();
  reactor3D.reset();
  if (Fx3D.ready) Fx3D.reset();
}

function buildScene(id = S.sceneId) {
  clearWorld();
  S.focus = null;
  S.sceneId = id;
  const scene = SCENES[id];
  const killMode = $('killmode').value;
  const shieldOn = $('shields').checked;
  for (const spec of scene.ships) {
    const ship = createShip(spec.hullId, {
      x: spec.x, y: spec.y, angle: spec.angle, label: spec.label,
      markers: S.markers[spec.hullId], killMode, coreConfig: coreConfig(), shieldOn
    });
    applyKillFrac(ship);
    ship.__hpImmune = $('hp-off').checked;
    S.ships.push(ship);
    S.destructibles.push(ship);
  }
  S.simTime = 0;
  S.targetIndex = Math.min(S.targetIndex, S.ships.length - 1);
  fitCamera();
  placeGun();
  refreshTargetSelect();
  refreshCandidateSelect();
  const hexes = S.ships.map((s) => `${s.__label} ${s.hexGrid.shards.length} heksów`).join(', ');
  log(`scena: ${scene.label} — ${hexes}`);
  for (const s of S.ships) {
    for (const c of s.shipCores) {
      if (c.invalid) log(`rdzeń ${c.id} NIEWAŻNY (${c.invalid})`, 'bad');
    }
  }
}

// Próg osłony z suwaka nadpisuje profil klasy (profile są zamrożone — kopia).
function applyKillFrac(ship) {
  const k = Number($('killfrac').value);
  const mul = Number($('meltmul').value);
  for (const c of ship.shipCores || []) {
    const base = SC.getCoreClassProfile(c.classId);
    c.profile = { ...c.profile, killFrac: k, criticalFrac: Math.max(k + 0.05, base.criticalFrac) };
    c.meltdownSec = (c.marker.meltdownSec || base.meltdownSec) * mul;
  }
}

function fitCamera() {
  const b = sceneBounds(S.ships);
  const zx = (W - (shotMode ? 60 : 420)) / Math.max(1, b.w);
  const zy = (H - 120) / Math.max(1, b.h);
  S.cam.zoom = Math.max(0.05, Math.min(1.6, Math.min(zx, zy) * 0.92));
  S.cam.x = b.cx + (shotMode ? 0 : 150 / S.cam.zoom);
  S.cam.y = b.cy;
}

// ---------------------------------------------------------------------------
// Oglądanie modelu reaktora: zbliżenie z kamerą przy rdzeniu, galeria modeli.
// Model leży pod pancerzem i przy zoomie ~1 komora ma ~50 px, a nakładka
// „komora” (kontury, okrąg, krzyżyk) przykrywała go — tak wyglądał jak zaślepka.
function coreWorldRadius(core) {
  const host = core.host;
  const l = {};
  const a = {};
  const b = {};
  SC.gridToLocal(host, core.gridX, core.gridY, l); SC.localToWorld(host, l.x, l.y, a);
  SC.gridToLocal(host, core.gridX + core.gridR, core.gridY, l); SC.localToWorld(host, l.x, l.y, b);
  return Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
}

function focusCore() {
  const t = target();
  const cores = t?.shipCores || [];
  return cores.find((c) => !c.invalid && c.state !== SC.CORE_STATE.DETONATED) || cores.find((c) => !c.invalid) || null;
}

// on: true / false / undefined (przełącz). Komora zajmuje ~30% wysokości ekranu.
function focusReactor(on) {
  const want = on === undefined ? !S.focus : !!on;
  if (!want) {
    if (S.focus?.prev) { S.cam.x = S.focus.prev.x; S.cam.y = S.focus.prev.y; S.cam.zoom = S.focus.prev.zoom; }
    S.focus = null;
    $('btn-model-focus').classList.remove('on');
    return false;
  }
  const core = focusCore();
  if (!core?.host?.hexGrid) return false;
  const prev = S.focus?.prev || { x: S.cam.x, y: S.cam.y, zoom: S.cam.zoom };
  S.focus = { core, prev };
  S.cam.zoom = Math.max(0.5, Math.min(12, 0.3 * H / coreWorldRadius(core)));
  followFocus();
  $('btn-model-focus').classList.add('on');
  return true;
}

// Kamera jedzie za rdzeniem (odrzut wyrzutu przesuwa i obraca kadłub).
function followFocus() {
  const core = S.focus?.core;
  if (!core?.host?.hexGrid) return;
  const w = SC.getCoreWorld(core, {});
  S.cam.x = w.x;
  S.cam.y = w.y;
}

// przesuw kamery ręką kończy zbliżenie bez powrotu
function dropFocus() {
  if (!S.focus) return;
  S.focus = null;
  $('btn-model-focus').classList.remove('on');
}

const MODEL_KIND_CYCLE = ['auto', 'terran', 'pirate', 'atlas'];
function cycleModelKind() {
  const sel = $('model-kind');
  sel.value = MODEL_KIND_CYCLE[(MODEL_KIND_CYCLE.indexOf(sel.value) + 1) % MODEL_KIND_CYCLE.length];
  sel.dispatchEvent(new Event('change'));
  log(`model reaktora: ${sel.options[sel.selectedIndex].text}`);
}

function setXray(on) {
  $('model-xray').checked = !!on;
  $('model-xray').dispatchEvent(new Event('change'));
}

// Komora otwierana od środka: `frac` żywych heksów komory, odłamki od rdzenia.
function openChamber(frac = 0.3, i = S.targetIndex) {
  const t = S.ships[i];
  const c = t?.shipCores?.[0];
  if (!c) return null;
  const cx = c.gridX, cy = c.gridY;
  const list = c.chamber.filter((s) => s.active).sort((a, b) => Math.hypot(a.origGridX - cx, a.origGridY - cy) - Math.hypot(b.origGridX - cx, b.origGridY - cy));
  const n = Math.round(list.length * frac);
  // Odłamki lecą od rdzenia jak po trafieniu — bez prędkości wisiałyby nad
  // wyrwą i zasłaniały żar (zaniżony pomiar HDR).
  const cw = SC.getCoreWorld(c, {});
  const l = {}, w = {};
  for (let k = 0; k < n; k++) {
    const s = list[k];
    SC.gridToLocal(t, s.gridX, s.gridY, l);
    SC.localToWorld(t, l.x, l.y, w);
    const dx = w.x - cw.x, dy = w.y - cw.y;
    const d = Math.hypot(dx, dy) || 1;
    const sp = 350 + Math.random() * 350;
    DestructorSystem.destroyShard(t, s, { x: (t.vx || 0) + dx / d * sp, y: (t.vy || 0) + dy / d * sp });
  }
  return n;
}

// Galeria modeli: każdy model na swoim kadłubie, przez wszystkie stany —
// to samo, co zrzuty `rdzen-shots.js --only reactorModels`, tylko na żywo.
const MODEL_GALLERY = [
  { hull: 'battleship', label: 'tokamak Terra Nova (Bellator)' },
  { hull: 'pirate_battleship', label: 'prowizorka piratów (Iron Skull)' },
  { hull: 'atlas', label: 'podwójny pierścień Atlasa (gracz)' }
];
// drugi klik w trakcie przerywa galerię
function toggleModelGallery() {
  if (S.modelGallery && S.modelGallery === S.galleryRun) {
    S.galleryRun++;
    S.modelGallery = 0;
    $('btn-model-gallery').classList.remove('on');
    log('galeria modeli przerwana');
    return;
  }
  runModelGallery();
}

async function runModelGallery() {
  const run = ++S.galleryRun;
  S.modelGallery = run;
  $('btn-model-gallery').classList.add('on');
  const prev = { variant: $('det-variant').value, secondary: $('det-secondary').value, kind: $('model-kind').value, xray: $('model-xray').checked };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const alive = () => run === S.galleryRun;
  $('model-kind').value = 'auto';
  $('det-variant').value = 'jet';        // wyrzut zostawia wrak reaktora
  $('det-secondary').value = 'never';
  if (!$('model-on').checked) { $('model-on').checked = true; $('model-on').dispatchEvent(new Event('change')); }
  try {
    for (const step of MODEL_GALLERY) {
      if (!alive()) return;
      $('scene').value = step.hull;
      S.targetIndex = 0;
      buildScene(step.hull);
      reactor3D.reset();
      const c = S.ships[0]?.shipCores?.[0];
      if (!c) continue;
      setXray(true);
      focusReactor(true);
      log(`GALERIA MODELI: ${step.label} — prześwietlenie`, 'warn');
      await wait(3000); if (!alive()) return;
      setXray(false);
      openChamber(0.25);
      log('  ODSŁONIĘTY — model przez wyrwę');
      await wait(3000); if (!alive()) return;
      openChamber(0.35);
      log('  KRYTYCZNY — pękają cewki');
      await wait(3000); if (!alive()) return;
      c.config = { ...c.config, ...coreConfig() };
      processEvents(SC.forceCoreMeltdown(c, S.simTime, 'galeria'));
      log('  STOPIENIE');
      const meltMs = Math.max(1500, (c.meltdownRemaining || 3) / Math.max(0.05, S.timeScale) * 1000);
      await wait(meltMs + 2500); if (!alive()) return;
      log('  wrak reaktora po wyrzucie');
      await wait(1500); if (!alive()) return;
      setXray(true);
      await wait(2000); if (!alive()) return;
      setXray(false);
    }
  } finally {
    // skończona, przerwana albo zastąpiona inną galerią — ustawienia wracają
    // (wariant detonacji zostaje galerii, która przejęła scenę)
    const superseded = S.galleryRun !== run && S.modelGallery === run;
    $('det-secondary').value = prev.secondary;
    if (!superseded) $('det-variant').value = prev.variant;
    if ($('model-kind').value !== prev.kind) { $('model-kind').value = prev.kind; $('model-kind').dispatchEvent(new Event('change')); }
    setXray(prev.xray);
    if (S.modelGallery === run) S.modelGallery = 0;
    $('btn-model-gallery').classList.toggle('on', !!S.modelGallery);
  }
}

function placeGun() {
  const t = target();
  if (!t) return;
  S.gunOffset = { x: 0, y: Math.max(260, t.radius * 0.9 + 140) };
  S.gun.x = t.x + S.gunOffset.x;
  S.gun.y = t.y + S.gunOffset.y;
}

function refreshTargetSelect() {
  const sel = $('target');
  sel.innerHTML = S.ships.map((s, i) => `<option value="${i}">${s.__label}${s.dead ? ' (zniszczony)' : ''}</option>`).join('');
  sel.value = String(S.targetIndex);
}

function refreshCandidateSelect() {
  const t = target();
  const sel = $('candidate');
  if (!t) { sel.innerHTML = ''; return; }
  const def = HULLS[t.__hullId];
  sel.innerHTML = def.candidates.map((c) => `<option value="${c.id}">${c.label}</option>`).join('');
  const current = S.markers[t.__hullId]?.[0]?.id || '';
  const match = def.candidates.find((c) => current.startsWith(c.id));
  if (match) sel.value = match.id;
  const m = S.markers[t.__hullId]?.[0];
  if (m) {
    $('ed-r').value = m.r; $('ed-r-out').textContent = String(Math.round(m.r));
    $('ed-armor').value = m.armorMul; $('ed-armor-out').textContent = Number(m.armorMul).toFixed(2).replace('.', ',');
  }
}

// ---------------------------------------------------------------------------
// Broń
const combatCtx = {
  bullets: S.bullets,
  rockets: S.rockets,
  targets: S.destructibles,
  rng: Math.random,
  stats: S.stats,
  primary: null,
  homingTarget: null,
  rocketTarget: null,
  legacyProbes: false,
  hooks: {
    onKilled(entity, cause) { handleAttritionDeath(entity, cause); },
    onShieldHit() { S.stats.shieldHitsFrame = (S.stats.shieldHitsFrame || 0) + 1; }
  }
};

function aimPoint(scatter = false) {
  const t = target();
  if ($('lock').checked && t) {
    const p = SC.getCoreLockPoint(t, {});
    if (p) {
      if (!scatter) return { x: p.x, y: p.y, lock: p };
      // lock na rdzeń = podsystem: losowy punkt komory (jak benchmark)
      const rr = p.core.gridR * Math.sqrt(Math.random());
      const aa = Math.random() * Math.PI * 2;
      return { x: p.x + Math.cos(aa) * rr, y: p.y + Math.sin(aa) * rr, lock: p };
    }
  }
  return { x: S.mouse.world.x, y: S.mouse.world.y, lock: null };
}

function gunTrigger() {
  const weapon = MASTER_WEAPONS[S.weaponId];
  if (!weapon) return;
  for (const delay of Combat.planTrigger(S.weaponId)) S.pendingShots.push(S.simTime + delay);
}

function fireOne() {
  const t = target();
  const aim = aimPoint(true);
  combatCtx.primary = t;
  combatCtx.homingTarget = aim.lock ? { x: aim.lock.x, y: aim.lock.y, dead: false } : (t || null);
  combatCtx.rocketTarget = t;
  const res = Combat.fireWeapon(combatCtx, S.gun, S.weaponId, aim.x, aim.y);
  if (res?.beam) {
    window.dispatchEvent(new CustomEvent('game_weapon_fired', {
      detail: {
        weaponId: S.weaponId, shooter: null, x: S.gun.x, y: S.gun.y, isBeam: true,
        beamMode: res.weapon.beamMode || null,
        beam: { startX: res.beam.startX, startY: res.beam.startY, endX: res.beam.endX, endY: res.beam.endY, width: res.beam.width, mode: res.beam.mode, emitterUid: 'rdzen-demo-gun' }
      }
    }));
  }
}

// ---------------------------------------------------------------------------
// Śmierć, detonacja, rozpad
function makeDerelict(entity, reason) {
  entity.isWreck = true;
  entity.__derelict = reason;
  entity.friction = 0.9986;
  const i = S.ships.indexOf(entity);
  if (i >= 0) {
    // zostaje w destructibles jako wrak (strzelalny, bez puli HP)
    entity.__label = `${entity.__label} (wrak)`;
  }
  refreshTargetSelect();
}

// Dzisiejsza gra: tryTriggerCriticalReactorBlow LOSUJE wybuch (26–78%) przy
// żywych ≥ 48% heksów — do porównania, gdy „wyniszczenie przy KRYT.” wyłączone.
function todayCritRoll(entity, overkill) {
  const maxHull = Math.max(1, entity.isPlayer ? entity.hull.max : entity.maxHp);
  let alive = 0;
  for (const s of entity.hexGrid.shards) if (s.active && !s.isDebris && s.hp > 0) alive++;
  const aliveRatio = alive / Math.max(1, entity.hexGrid.shards.length);
  const severity = Math.max(Math.max(0, overkill) / maxHull, aliveRatio);
  if (severity < 0.48) return { roll: false, chance: 0 };
  const norm = Math.min(1, (severity - 0.48) / 0.52);
  const chance = Math.min(0.26 + norm * 0.52, 0.78);
  return { roll: Math.random() <= chance, chance };
}

function handleAttritionDeath(entity, cause) {
  if (entity.dead || entity.isWreck) return;
  const events = SC.notifyCoreHostKilled(entity, S.simTime, 'attrition');
  if (events.some((ev) => ev.type === 'detonate')) {
    log(`${entity.__label}: pula HP = 0 przy rdzeniu KRYTYCZNYM → detonacja (bez losowania)`, 'warn');
    processEvents(events);
    return;
  }
  if (entity.isPlayer) {
    // gracz w grze wybucha zawsze (handlePlayerDestroyed → triggerReactorBlow3D)
    log(`${entity.__label}: kadłub = 0 (gracz) → wybuch reaktora jak dziś`, 'bad');
    blowAtCenter(entity, 'capital');
    return;
  }
  const r = todayCritRoll(entity, 0);
  if (r.roll) {
    log(`${entity.__label}: wyniszczenie (${cause}) → losowy wybuch jak dziś (szansa ${(r.chance * 100).toFixed(0)}%)`, 'warn');
    blowAtCenter(entity, SC.resolveCoreClassId(entity));
  } else {
    log(`${entity.__label}: wyniszczenie (${cause}) → wrak (losowanie${r.chance ? ` ${(r.chance * 100).toFixed(0)}%` : ''} nie wybuchło)`);
    for (const c of entity.shipCores || []) c.state = SC.CORE_STATE.DETONATED;
    makeDerelict(entity, 'wyniszczenie');
  }
}

// Wybuch „jak dziś”: środek kadłuba, profil po promieniu, AoE, rozpad.
function blowAtCenter(entity, classId) {
  const x = Combat.entityX(entity);
  const y = Combat.entityY(entity);
  const size = (entity.radius || 40) * 1.5 * 1.8;
  const profile = SC.getCoreClassProfile(classId).blastProfile;
  spawnReactorBlow({ x, y, size, profile });
  const fake = {
    host: entity, profile: SC.getCoreClassProfile(classId), config: SC.CORE_DEFAULTS, chainDepth: 0,
    classId, gridR: 30, gridX: entity.hexGrid.srcWidth / 2, gridY: entity.hexGrid.srcHeight / 2
  };
  // dzisiejsza gra: samo AoE puli HP, bez krateru i bez fali na komory
  const blast = { ...SC.computeCoreBlast(fake), hexDamage: 0, shockDamage: 0, chainDepth: 1 };
  Combat.applyCoreBlast(combatCtx, blast, x, y, entity, S.simTime);
  destroyHost(entity, fake);
}

// Dzisiejszy rozpad (rozprysk od środka kadłuba) dla wybuchu „jak dziś”.
function destroyHost(host, core) {
  const plan = SC.planCoreBreakup(core, { seed: (S.frame * 2654435761) >>> 0 });
  const wrecks = SC.applyCoreBreakup(core, plan, S.destructibles, { seed: S.frame + 17 });
  SC.consumeHostCores(host, S.simTime);
  removeHost(host);
  return wrecks;
}

function removeHost(host) {
  host.dead = true;
  const si = S.ships.indexOf(host);
  if (si >= 0) S.ships[si].__label = `${host.__label} (zniszczony)`;
  const di = S.destructibles.indexOf(host);
  if (di >= 0) S.destructibles.splice(di, 1);
  disposeHexBody(host);
  S.shake = Math.max(S.shake, 12);
  refreshTargetSelect();
}

function spawnBlowVisual(core, blast) {
  if (S.blowVisuals.has(core)) return;
  S.blowVisuals.add(core);
  if (!blast.reactorProfile) return;
  const w = SC.getCoreWorld(core, {});
  spawnReactorBlow({ x: w.x, y: w.y, size: blast.visualSize, profile: blast.reactorProfile });
}

// Iskry wybuchu w komorze na wariant. Przy wyrzucie i kuli główny obraz daje
// wystrzał (Hexlance / Tempest z coreFx3D), tu zostaje tylko resztka.
const BLAST_SPARKS = {
  shatter: { sparks: 260, chunks: 24, arcs: 12, vapor: 16 },
  halves: { sparks: 170, chunks: 16, arcs: 8, vapor: 10 },
  thirds: { sparks: 190, chunks: 18, arcs: 9, vapor: 12 },
  hole: { sparks: 220, chunks: 30, arcs: 10, vapor: 16 },
  jet: { sparks: 60, chunks: 8, arcs: 4, vapor: 6, flare: false, hitSparks: 20 },
  orb: { sparks: 50, chunks: 6, arcs: 6, vapor: 6, flare: false, hitSparks: 16 }
};

// Detonacja wg wariantu (shipCore.chooseCoreDetonationVariant w zdarzeniu):
// wybuch w komorze (reactorblow + AoE), rozpad z planu wariantu, a potem
// zagrożenia: strumień plazmy, kula plazmy, wybuchy wtórne.
function detonate(ev) {
  const { core, host, x, y, blast } = ev;
  const variant = ev.variant || 'shatter';
  const vdef = SC.CORE_DETONATION_VARIANTS[variant] || SC.CORE_DETONATION_VARIANTS.shatter;
  const color = core.color || [0.3, 0.7, 1.0];
  spawnBlowVisual(core, blast);
  coreFx.onEvent(ev);
  const affected = Combat.applyCoreBlast(combatCtx, blast, x, y, host, S.simTime);
  const seed = (Math.imul(S.frame + 1, 2654435761) + Math.round(S.simTime * 1000)) >>> 0;
  // Celowany wyrzut/kula (ujęcia dema): kierunek świata do wskazanego kadłuba → siatka.
  let exitDir = null;
  if (S.aimExitAt && (variant === 'jet' || variant === 'orb')) {
    const cw = SC.getCoreWorld(core, {});
    const d = Math.hypot(S.aimExitAt.x - cw.x, S.aimExitAt.y - cw.y) || 1;
    const a = SC.worldToLocal(host, cw.x, cw.y, {});
    const b = SC.worldToLocal(host, cw.x + (S.aimExitAt.x - cw.x) / d, cw.y + (S.aimExitAt.y - cw.y) / d, {});
    exitDir = { x: b.x - a.x, y: b.y - a.y };
  }
  S.aimExitAt = null;
  const plan = SC.planCoreBreakup(core, { mode: variant, seed, exitDir });
  // model reaktora: wyrzut i kula zostawiają wrak (łuk rozerwany w stronę wyrzutu),
  // pozostałe warianty wyparowują go razem z komorą
  reactor3D.detonated(core, { variant, dirGridX: plan.dirGridX, dirGridY: plan.dirGridY });
  // iskry z brzegów pęknięć i wyrwy liczone na jeszcze całym kadłubie
  if (variant === 'halves' || variant === 'thirds') coreFx.crackSparks(core, plan);
  else if (variant === 'hole') coreFx.rimSparks(core, plan);
  const res = SC.applyCoreDetonation(core, plan, S.destructibles, { seed: seed ^ 0x9e37 });
  SC.consumeHostCores(host, S.simTime);
  const owners = res.keptHost ? [host, ...res.wrecks] : res.wrecks;
  if (res.keptHost) {
    makeDerelict(host, vdef.label);
    S.shake = Math.max(S.shake, 10);
  } else {
    removeHost(host);
  }
  const nowSec = performance.now() * 0.001;
  // rozżarzone brzegi pęknięć/wyrwy jadą z heksami do wraków i stygną
  // pomarańcz (≤ 0,6): biel brzegu na całym obrysie kawałka czytałaby się jak tarcza
  coreFx.heatShards(plan.edgeShards, owners, variant === 'hole' ? 0.62 : 0.55, nowSec);
  // wybuch w komorze: iskry, odpryski, łuki i opar z puli gry (Fx3D + SparkSystem3D)
  coreFx.blastSparks(x, y, { classId: core.classId, color, vx: host.vx, vy: host.vy, ...BLAST_SPARKS[variant] });
  // własny obraz wariantu: rozbłysk plazmy i pierścień (reactorblow wg blowShift)
  if (blast.flashRadius > 0) coreFx.flash(x, y, blast.flashRadius, color, variant === 'hole' ? 0.7 : 0.5);
  if (blast.ringRadius > 0) coreFx.spawnRing(x, y, blast.ringRadius, color, variant === 'hole' ? 0.9 : 0.7);
  let extra = '';
  if (variant === 'jet' && res.keptHost) {
    const jet = SC.createCoreJet(core, plan, blast);
    S.jets.push(jet);
    coreFx.spawnJet(jet, color);
    extra = ` · strumień ${Math.round(jet.length)} j. × ${jet.duration.toFixed(1)} s, ${Math.round(jet.dps)} HP/s, odrzut ${Math.round(Math.hypot(res.recoil?.x || 0, res.recoil?.y || 0))} j/s`;
  } else if (variant === 'orb' && res.keptHost) {
    const orb = SC.createPlasmaOrb(core, plan, blast, { seed });
    S.orbs.push(orb);
    coreFx.spawnOrb(orb, color);
    extra = ` · kula plazmy ${Math.round(Math.hypot(orb.vx - (host.vx || 0), orb.vy - (host.vy || 0)))} j/s, zapalnik ${orb.fuse.toFixed(1)} s`;
  }
  // wybuchy wtórne (amunicja, paliwo) na tym, co zostało
  const secMode = $('det-secondary').value;
  let secCount = 0;
  if (secMode === 'always') secCount = Math.max(SC.CORE_SECONDARY_PROFILES[core.classId]?.countMin || 2, SC.rollSecondaryBlasts(variant, core.classId, () => 0));
  else if (secMode !== 'never') secCount = SC.rollSecondaryBlasts(variant, core.classId, demoRng);
  if (secCount > 0) {
    const pieces = res.keptHost ? [host, ...res.wrecks] : res.wrecks;
    for (const it of SC.planSecondaryBlasts(pieces, { count: secCount, classId: core.classId, seed: seed + 5, edgeShards: plan.edgeShards })) {
      S.secondaries.push({ ...it, at: S.simTime + it.delay, color, classId: core.classId });
    }
  }
  log(`DETONACJA ${host.__label}/${core.id} — ${vdef.label.toUpperCase()} [${blast.reactorProfile}] — AoE ${Math.round(blast.aoeRadius)} j. / ${Math.round(blast.aoeDamage)} HP, łańcuch ${blast.chainDepth}, dotkniętych ${affected.length}, fragmentów ${res.wrecks.length}${res.keptHost ? ' (kadłub zostaje)' : ''}${extra}${secCount ? `, wtórnych ${secCount}` : ''}`, 'bad');
}

// Kula plazmy wybucha (zetknięcie z kadłubem albo zapalnik).
function orbDetonate(ev) {
  const { orb, x, y, blast } = ev;
  const color = orb.color || [0.3, 0.7, 1.0];
  spawnReactorBlow({ x, y, size: blast.visualSize, profile: blast.reactorProfile });
  coreFx.flash(x, y, blast.aoeRadius * 0.2, color, 0.45);
  coreFx.spawnRing(x, y, blast.aoeRadius * 0.5, color, 0.6);
  coreFx.blastSparks(x, y, { classId: orb.classId, color, scale: 0.8, sparks: 170, chunks: 14, arcs: 10, vapor: 10, vx: orb.vx, vy: orb.vy });
  const affected = Combat.applyCoreBlast(combatCtx, blast, x, y, null, S.simTime);
  S.shake = Math.max(S.shake, 9);
  log(`KULA PLAZMY wybuchła ${ev.hit ? `na ${ev.hit.__label || 'wraku'}` : 'z zapalnika'} — AoE ${Math.round(blast.aoeRadius)} j. / ${Math.round(blast.aoeDamage)} HP, dotkniętych ${affected.length}`, 'bad');
}

// Wybuch wtórny: heks mógł przejść do innego wraku albo już nie istnieć.
function secondaryBlast(it) {
  const loc = SC.locateShard(it.shard, S.destructibles, {});
  if (!loc) return;
  const e = loc.entity;
  spawnReactorBlow({ x: loc.x, y: loc.y, size: it.size, profile: it.profile });
  coreFx.cookOff(loc.x, loc.y, { classId: it.classId, vx: e.vx || 0, vy: e.vy || 0 });
  const a = demoRng() * Math.PI * 2;
  DestructorSystem.applyImpact(e, loc.x, loc.y, it.hexDamage, { x: Math.cos(a) * 900, y: Math.sin(a) * 900 }, { radius: it.hexRadius, shard: it.shard });
  S.shake = Math.max(S.shake, 3);
}

const jetHooks = {
  hullDamage: (e, dmg, cause) => { Combat.applyHullDamage(e, dmg, cause, { bypassShield: false }, combatCtx.hooks); },
  blocksHexes: (e) => Combat.isShieldUp(e)
};

function stepHazards(dt) {
  for (let i = S.jets.length - 1; i >= 0; i--) {
    if (!SC.stepCoreJet(S.jets[i], dt, S.destructibles, { hooks: jetHooks, time: S.simTime })) {
      S.jets[i] = S.jets[S.jets.length - 1];
      S.jets.pop();
    }
  }
  if (S.orbs.length) {
    hazardEvents.length = 0;
    SC.stepPlasmaOrbs(S.orbs, dt, S.destructibles, { events: hazardEvents, time: S.simTime, hooks: jetHooks });
    for (const ev of hazardEvents) orbDetonate(ev);
    for (let i = S.orbs.length - 1; i >= 0; i--) {
      if (!S.orbs[i].detonated) continue;
      S.orbs[i] = S.orbs[S.orbs.length - 1];
      S.orbs.pop();
    }
  }
  for (let i = S.secondaries.length - 1; i >= 0; i--) {
    const it = S.secondaries[i];
    if (it.at > S.simTime) continue;
    S.secondaries[i] = S.secondaries[S.secondaries.length - 1];
    S.secondaries.pop();
    secondaryBlast(it);
  }
}
const hazardEvents = [];

function processEvents(events) {
  for (const ev of events) {
    if (ev.type === 'state') {
      const label = SC.CORE_STATE_LABEL[ev.to] || ev.to;
      const cls = ev.to === SC.CORE_STATE.MELTDOWN ? 'bad' : (ev.to === SC.CORE_STATE.CRITICAL ? 'warn' : '');
      if (ev.to !== SC.CORE_STATE.DETONATED) {
        log(`${ev.host.__label}/${ev.core.id}: ${label}${ev.cause ? ` (${ev.cause}${ev.chainDepth ? `, łańcuch ${ev.chainDepth}` : ''})` : ''}${ev.duration ? ` — odliczanie ${ev.duration.toFixed(1)} s` : ''}`, cls);
      }
      coreFx.onEvent(ev);
    } else if (ev.type === 'severed') {
      log(`${ev.from.__label}/${ev.core.id}: RDZEŃ ODCIĘTY z fragmentem (${ev.core.chamber.length} heksów komory)`, 'warn');
    } else if (ev.type === 'reactorLost') {
      log(`${ev.host.__label}: kadłub bez reaktora → dryfujący wrak`, 'warn');
      makeDerelict(ev.host, 'odcięty rdzeń');
    } else if (ev.type === 'detonate') {
      detonate(ev);
    }
  }
}

// Wrak bez ani jednego żywego heksa znika (gra: recycleWreck). Zostawiony
// w scenie trafiał w HullShadowSdf.acquire z pustą siatką (zgłoszone osobno).
// Wołane po kroku fizyki i przed renderem: solver GPU potrafi dobić ostatnie
// heksy wraku w updateVisuals, między krokami.
function cullEmptyWrecks() {
  for (let i = S.destructibles.length - 1; i >= 0; i--) {
    const e = S.destructibles[i];
    if (e.isWreck && e.hexGrid && (e.hexGrid.activeStructuralCount | 0) <= 0) {
      S.destructibles.splice(i, 1);
      disposeHexBody(e);
    }
  }
}

// ---------------------------------------------------------------------------
// Fizyka (krok 120 Hz jak PHYS_HZ gry)
function physicsStep(dt) {
  S.simTime += dt;
  const t = target();
  const rot = Number($('rot').value) * Math.PI / 180;
  const drift = Number($('drift').value);
  for (const e of S.destructibles) {
    if (e.dead) continue;
    if (e.isWreck) {
      e.x += (e.vx || 0) * dt;
      e.y += (e.vy || 0) * dt;
      e.angle = (e.angle || 0) + (e.angVel || 0) * dt;
      const k = stepDecay120(e.friction || 0.9986, dt);
      e.vx *= k; e.vy *= k;
      e.angVel *= k;
      continue;
    }
    if (e === t) {
      e.angVel = rot;
      e.vx = Math.cos(e.angle) * drift;
      e.vy = Math.sin(e.angle) * drift;
    }
    Combat.setEntityPos(e, Combat.entityX(e) + (e.vx || 0) * dt, Combat.entityY(e) + (e.vy || 0) * dt);
    if (e.vel) { e.vel.x = e.vx || 0; e.vel.y = e.vy || 0; }
    e.angle += (e.angVel || 0) * dt;
  }
  if ($('gun-follow').checked && t) {
    S.gun.x = Combat.entityX(t) + S.gunOffset.x;
    S.gun.y = Combat.entityY(t) + S.gunOffset.y;
  }
  const weapon = MASTER_WEAPONS[S.weaponId];
  if ((S.firing || $('autofire').checked) && weapon && S.simTime >= S.nextTrigger) {
    gunTrigger();
    S.nextTrigger = S.simTime + Math.max(0.02, weapon.cooldown || 1);
  }
  for (let i = S.pendingShots.length - 1; i >= 0; i--) {
    if (S.pendingShots[i] > S.simTime + 1e-9) continue;
    S.pendingShots.splice(i, 1);
    fireOne();
  }
  Combat.stepBullets(combatCtx, dt);
  Combat.stepRockets3D(combatCtx, dt);
  DestructorSystem.update(dt, S.destructibles);
  stepHazards(dt);

  cullEmptyWrecks();

  S.integrityAcc += dt;
  if (++S.integrityTick % 3 === 0) {
    const events = [];
    for (const e of S.destructibles.slice()) {
      if (e.dead || !Array.isArray(e.shipCores) || !e.shipCores.length) continue;
      SC.updateShipCores(e, S.integrityAcc, { time: S.simTime, entities: S.destructibles, events });
    }
    S.integrityAcc = 0;
    for (const e of S.ships) if (!e.dead) Combat.enforceHexCap(e, combatCtx.hooks);
    if (events.length) processEvents(events);
  }
}

// ---------------------------------------------------------------------------
// Klatka
const cullInfo = { x: 0, y: 0, halfW: 1e5, halfH: 1e5, drawHalfW: 1e5, drawHalfH: 1e5 };
let lastT = performance.now();
let audioCtx = null;

function frame(nowMs = performance.now()) {
  const realDt = Math.min(0.1, Math.max(0, (nowMs - lastT) / 1000));
  lastT = nowMs;
  S.frame++;
  const simFrameDt = S.paused ? 0 : realDt * S.timeScale;
  S.acc += simFrameDt;
  let steps = 0;
  while (S.acc >= PHYS_DT && steps < 12) {
    physicsStep(PHYS_DT);
    S.acc -= PHYS_DT;
    steps++;
  }
  if (steps >= 12) S.acc = 0;
  render(realDt, simFrameDt);
}

function render(realDt, simFrameDt) {
  const t0 = performance.now();
  const nowSec = t0 * 0.001;
  if (simFrameDt > 0) {
    DestructorSystem.updateVisuals(simFrameDt, S.destructibles);
    if (softBodyMode() !== 'gpu') {
      if (!cpuSoft) cpuSoft = createCpuSoftBody();
      cpuSoft.tick(S.destructibles, DESTRUCTOR_CONFIG, simFrameDt);
    }
  }
  // wizualny wybuch z wyprzedzeniem chargeTime (czas realny fabryki)
  const cores = allCores();
  for (const core of cores) {
    if (core.state !== SC.CORE_STATE.MELTDOWN || S.blowVisuals.has(core)) continue;
    // przepis obrazu z wariantu znanego od początku stopienia (pendingVariant)
    const blast = SC.applyVariantToBlast(SC.computeCoreBlast(core), core.pendingVariant || 'shatter');
    if (!blast.reactorProfile) { S.blowVisuals.add(core); continue; }
    const lead = BLOW_CHARGE[blast.reactorProfile] || 0.8;
    if (core.meltdownRemaining / Math.max(0.05, S.timeScale) <= lead) spawnBlowVisual(core, blast);
  }
  Core3D.beginPlanetLayerFrame();
  Core3D.setShieldLayerActive(false);
  if (S.focus) followFocus();
  reactorSyncOpts.origin = S.cam;
  reactor3D.sync(cores, nowSec, simFrameDt, reactorSyncOpts);
  coreFx.sync(cores, nowSec, simFrameDt);

  // wstrząs kamery po detonacji
  S.shake *= Math.exp(-4 * realDt);
  const shakeX = (Math.random() - 0.5) * S.shake;
  const shakeY = (Math.random() - 0.5) * S.shake;
  const cam = { x: S.cam.x + shakeX / S.cam.zoom, y: S.cam.y + shakeY / S.cam.zoom, zoom: S.cam.zoom };
  cullInfo.x = cam.x; cullInfo.y = cam.y;
  cullInfo.drawHalfW = W * 0.5 / cam.zoom + 400; cullInfo.drawHalfH = H * 0.5 / cam.zoom + 400;
  cullInfo.halfW = cullInfo.drawHalfW * 3; cullInfo.halfH = cullInfo.drawHalfH * 3;
  cullEmptyWrecks();
  const renderEntities = S.destructibles.filter((e) => !e.dead);
  // Wspólny bank cząstek (iskry, błyski wylotowe, Hexlance) — w grze przesuwa
  // go Weapon3DSystem.syncProjectiles, dokładnie raz na klatkę; demo nie ma
  // systemu broni 3D, więc robi to tutaj (czas symulacji: pauza zatrzymuje iskry).
  Fx3D.update(simFrameDt);
  MuzzleFX3D.beginFrame();
  const t1 = performance.now();
  updateHexShips3D(cam, renderEntities, cullInfo);
  drawHexShips3D(ctx2d, W, H);
  const t2 = performance.now();
  overlayView.viewport.w = W; overlayView.viewport.h = H;
  overlayView.zoom = cam.zoom; overlayView.center.x = cam.x; overlayView.center.y = cam.y;
  overlay3D.tick(realDt);
  const t3 = performance.now();

  const view = { camX: cam.x, camY: cam.y, zoom: cam.zoom, W, H };
  const aim = aimPoint();
  drawOverlays2D(ctx2d, view, {
    ships: S.ships.filter((s) => !s.dead), destructibles: renderEntities, cores,
    gun: S.gun, aim, rockets: S.rockets, editor: S.editor
  }, opts());
  const t4 = performance.now();
  S.lastFrameMs = t4 - t0;
  S.frameMsAvg = S.frameMsAvg * 0.9 + realDt * 1000 * 0.1;
  S.perf = { update3d: t2 - t1, overlay: t3 - t2, overlay2d: t4 - t3, total: t4 - t0 };
  updateHud(cores);
  updateAlarm(cores, realDt);
}

function renderInfo() {
  const r = Core3D.lastFrameRenderInfo?.total || Core3D.renderer?.info?.render || {};
  const o = overlay3D.renderer?.info?.render || {};
  return { calls: r.calls || 0, tris: r.triangles || 0, ovCalls: o.calls || 0 };
}

function updateHud(cores) {
  const bodyCls = document.body.classList;
  if (bodyCls.contains('shot') && !bodyCls.contains('hud')) return;
  const t = target();
  const ri = renderInfo();
  const ov = overlay3D.getStats();
  const lines = [];
  lines.push(`<b>RDZEŃ</b>  ${(1000 / Math.max(1, S.frameMsAvg)).toFixed(0)} FPS · klatka ${S.frameMsAvg.toFixed(1)} ms · Core3D ${(Core3D.lastFramePerf?.renderTotalMs || 0).toFixed(1)} ms`);
  lines.push(`draw calle ${ri.calls} (Core3D) + ${ri.ovCalls} (overlay ${ov.lastRenderMs.toFixed(1)} ms) · FX rdzeni ${coreFx.stats.drawCalls} · wyrzuty ${coreFx.stats.vents} · model ${reactor3D.stats.instances} (${reactor3D.stats.drawCalls} dc)`);
  lines.push(`solver: ${softBodyMode()} · krok 120 Hz · czas ×${S.timeScale.toFixed(2)}${S.paused ? ' · PAUZA' : ''} · sim ${S.simTime.toFixed(1)} s`);
  if (t) {
    const hp = t.isPlayer ? `${Math.round(t.hull.val)}/${t.hull.max}` : `${Math.round(Math.max(0, t.hp))}/${t.maxHp}`;
    const lost = t.hexGrid ? t.hexGrid.shards.length - (t.hexGrid.activeStructuralCount ?? 0) : 0;
    lines.push(`cel: <b>${t.__label}</b>${t.isWreck ? ' (wrak)' : ''} · HP ${hp} · tarcza ${Math.round(t.shield?.val || 0)} · heksy -${lost}/${t.hexGrid?.shards.length || 0}`);
    for (const c of t.shipCores || []) {
      const st = SC.CORE_STATE_LABEL[c.state];
      const cls = c.state === 'meltdown' ? 'bad' : (c.state === 'critical' ? 'warn' : '');
      const extra = c.state === 'meltdown' ? ` · <span class="bad">${Math.max(0, c.meltdownRemaining).toFixed(2)} s</span>` : '';
      lines.push(`  ${c.id}: <span class="${cls}">${st}</span> · osłona ${(c.integrity * 100).toFixed(0)}% · komora ${c.deadCount}/${c.chamber.length} · r ${c.gridR.toFixed(0)} px ×${c.armorMul}${extra}`);
    }
  }
  const w = MASTER_WEAPONS[S.weaponId];
  lines.push(`broń: ${w?.name || S.weaponId} · trafień ${S.stats.hullHits || 0} · obrażeń ${Math.round(S.stats.hullDamage || 0)} · pocisków ${S.bullets.length}`);
  if (S.jets.length || S.orbs.length || S.secondaries.length) {
    lines.push(`<span class="warn">po wybuchu: strumienie ${S.jets.length} · kule plazmy ${S.orbs.length} · wybuchy wtórne w kolejce ${S.secondaries.length}</span>`);
  }
  lines.push(`rdzenie w scenie: ${cores.length} · ${cores.map((c) => `${c.id}:${(SC.CORE_STATE_LABEL[c.state] || '').slice(0, 4)}`).join(' ')}`);
  const kindSel = $('model-kind');
  const kindLabel = kindSel.value === 'auto' ? 'wg kadłuba' : kindSel.options[kindSel.selectedIndex].text;
  lines.push(`model reaktora (M): <b>${reactor3D.debug.enabled ? kindLabel : 'wył. — dawny żar'}</b>${reactor3D.debug.xray ? ' · prześwietlenie' : ''}${S.focus ? ' · zbliżenie' : ''}${S.modelGallery ? ' · <span class="warn">GALERIA</span>' : ''}`);
  $('hud').innerHTML = lines.join('\n');
}

function beep(freq, dur) {
  try {
    if (!audioCtx) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    g.gain.value = 0.04;
    o.connect(g); g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + dur);
  } catch { /* brak audio */ }
}

function updateAlarm(cores, realDt) {
  const el = $('alarm');
  const melting = cores.filter((c) => c.state === SC.CORE_STATE.MELTDOWN && !c.host.dead);
  if (!melting.length) { el.style.display = 'none'; return; }
  melting.sort((a, b) => a.meltdownRemaining - b.meltdownRemaining);
  const c = melting[0];
  const player = c.host.isPlayer;
  const blink = (S.frame >> 3) & 1;
  el.style.display = 'block';
  el.classList.toggle('player', !!player);
  el.style.opacity = blink ? '1' : '0.75';
  el.innerHTML = player
    ? `⚠ TWÓJ REAKTOR — STOPIENIE ${Math.max(0, c.meltdownRemaining).toFixed(1)} s<div class="sub">wepchnij kadłub we wroga albo odleć od sojuszników · zasięg fali ${Math.round(SC.computeCoreBlast(c).aoeRadius)} j.</div>`
    : `REAKTOR ${c.host.__label} — STOPIENIE ${Math.max(0, c.meltdownRemaining).toFixed(1)} s${melting.length > 1 ? ` (+${melting.length - 1})` : ''}<div class="sub">odleć poza ${Math.round(SC.computeCoreBlast(c).aoeRadius)} j.</div>`;
  if (player) {
    S.alarmBeep -= realDt;
    const period = Math.max(0.12, 0.5 * c.meltdownRemaining / Math.max(0.1, c.meltdownDuration));
    if (S.alarmBeep <= 0) { beep(880 + (1 - c.meltdownRemaining / c.meltdownDuration) * 660, 0.07); S.alarmBeep = period; }
  }
}

// Zegar ręczny (runFrames): klatki o zadanym FPS zamiast rAF. Headless Chrome
// bez limitu klatek chodzi po ~700 FPS, a solver sprężyn GPU liczy dispatch na
// KLATKĘ — pomiar w czasie rzeczywistym byłby wtedy niereprezentatywny.
let manualClock = false;
function loop(nowMs) {
  if (!manualClock) {
    try { frame(nowMs); } catch (err) { reportError(err.stack || String(err)); }
  }
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Wejście
function updateMouse(ev) {
  const r = canvas2d.getBoundingClientRect();
  S.mouse.x = ev.clientX - r.left;
  S.mouse.y = ev.clientY - r.top;
  screenToWorld({ camX: S.cam.x, camY: S.cam.y, zoom: S.cam.zoom, W, H }, S.mouse.x, S.mouse.y, S.mouse.world);
}

let panDrag = null;
canvas2d.addEventListener('mousemove', (ev) => {
  updateMouse(ev);
  if (panDrag) {
    S.cam.x = panDrag.cx - (ev.clientX - panDrag.x) / S.cam.zoom;
    S.cam.y = panDrag.cy - (ev.clientY - panDrag.y) / S.cam.zoom;
  }
  if (S.editor.dragging && S.editor.selected) editorDrag();
});
canvas2d.addEventListener('mousedown', (ev) => {
  canvas2d.focus();
  if (!audioCtx) { try { audioCtx = new AudioContext(); } catch { /* */ } }
  updateMouse(ev);
  if (ev.button === 1 || (ev.button === 0 && ev.altKey)) {
    dropFocus();
    panDrag = { x: ev.clientX, y: ev.clientY, cx: S.cam.x, cy: S.cam.y };
    ev.preventDefault();
    return;
  }
  if (ev.button === 0) {
    if (S.editor.active) { editorPick(); return; }
    S.firing = true;
  }
});
addEventListener('mouseup', (ev) => {
  if (ev.button === 1 || panDrag) panDrag = null;
  if (ev.button === 0) { S.firing = false; S.editor.dragging = false; }
});
canvas2d.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  updateMouse(ev);
  const before = { ...S.mouse.world };
  // do ×12: przy ×4 komora reaktora ma ledwie ~100 px promienia
  S.cam.zoom = Math.max(0.03, Math.min(12, S.cam.zoom * Math.exp(-ev.deltaY * 0.0012)));
  // przy zbliżeniu na reaktor zoom zostaje w jego środku
  if (S.focus) return;
  const after = screenToWorld({ camX: S.cam.x, camY: S.cam.y, zoom: S.cam.zoom, W, H }, S.mouse.x, S.mouse.y, {});
  S.cam.x += before.x - after.x;
  S.cam.y += before.y - after.y;
}, { passive: false });
canvas2d.addEventListener('contextmenu', (ev) => ev.preventDefault());

const keys = new Set();
addEventListener('keydown', (ev) => {
  if (ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA' || ev.target.tagName === 'SELECT')) return;
  keys.add(ev.code);
  if (ev.code === 'Space') { ev.preventDefault(); togglePause(); }
  if (ev.code === 'KeyR') buildScene();
  if (ev.code === 'KeyL') $('lock').checked = !$('lock').checked;
  if (ev.code === 'KeyF') $('autofire').checked = !$('autofire').checked;
  if (ev.code === 'KeyE') { $('edit').checked = !$('edit').checked; S.editor.active = $('edit').checked; }
  if (ev.code === 'KeyT') { S.targetIndex = (S.targetIndex + 1) % Math.max(1, S.ships.length); refreshTargetSelect(); refreshCandidateSelect(); placeGun(); }
  if (ev.code === 'KeyG') {
    const t = target();
    S.gun.x = S.mouse.world.x; S.gun.y = S.mouse.world.y;
    if (t) S.gunOffset = { x: S.gun.x - Combat.entityX(t), y: S.gun.y - Combat.entityY(t) };
  }
  if (ev.code === 'KeyZ') focusReactor();
  if (ev.code === 'KeyX') setXray(!$('model-xray').checked);
  if (ev.code === 'KeyM') cycleModelKind();
  if (ev.code === 'Comma') setTimeScale(S.timeScale * 0.5);
  if (ev.code === 'Period') setTimeScale(S.timeScale * 2);
  if (/^Digit[1-9]$/.test(ev.code)) {
    const i = Number(ev.code.slice(5)) - 1;
    if (DEMO_WEAPONS[i]) { S.weaponId = DEMO_WEAPONS[i]; $('weapon').value = S.weaponId; }
  }
});
addEventListener('keyup', (ev) => keys.delete(ev.code));
setInterval(() => {
  const pan = 900 / S.cam.zoom * 0.016;
  if (keys.has('KeyW') || keys.has('KeyS') || keys.has('KeyA') || keys.has('KeyD')) dropFocus();
  if (keys.has('KeyW')) S.cam.y -= pan;
  if (keys.has('KeyS')) S.cam.y += pan;
  if (keys.has('KeyA')) S.cam.x -= pan;
  if (keys.has('KeyD')) S.cam.x += pan;
}, 16);

addEventListener('resize', () => {
  W = innerWidth; H = innerHeight;
  canvas2d.width = W; canvas2d.height = H;
  glCanvas.width = W; glCanvas.height = H;
  resizeHexShips3D(W, H);
  overlay3D.resize();
});

function togglePause() {
  S.paused = !S.paused;
  $('btn-pause').classList.toggle('on', S.paused);
}

function setTimeScale(v) {
  S.timeScale = Math.max(0.05, Math.min(1, v));
  $('timescale').value = S.timeScale;
  $('timescale-out').textContent = `${S.timeScale.toFixed(2).replace('.', ',')}×`;
}

// ---------------------------------------------------------------------------
// Edytor rdzenia (przestrzeń PNG, eksport do defaultów)
function coreMarkersOfTarget() {
  const t = target();
  return t ? S.markers[t.__hullId] : null;
}

function markerToWorld(t, m) {
  const layout = t.__coreLayout;
  const g = SC.coreMarkerToGrid(m, layout, t.hexGrid);
  const l = SC.gridToLocal(t, g.gridX, g.gridY, {});
  return SC.localToWorld(t, l.x, l.y, {});
}

function worldToMarker(t, x, y) {
  const layout = t.__coreLayout;
  const l = SC.worldToLocal(t, x, y, {});
  const gx = l.x + t.hexGrid.srcWidth * 0.5 + (t.hexGrid.pivot?.x || 0);
  const gy = l.y + t.hexGrid.srcHeight * 0.5 + (t.hexGrid.pivot?.y || 0);
  return SC.gridToCoreMarker(gx, gy, layout, t.hexGrid);
}

function editorPick() {
  const t = target();
  const list = coreMarkersOfTarget();
  if (!t || !list) return;
  let best = null, bestD = Infinity;
  for (const m of list) {
    const w = markerToWorld(t, m);
    const d = Math.hypot(w.x - S.mouse.world.x, w.y - S.mouse.world.y);
    if (d < bestD) { bestD = d; best = m; }
  }
  if (best && bestD < 80 / S.cam.zoom) {
    S.editor.marker = best;
    S.editor.dragging = true;
    $('ed-r').value = best.r; $('ed-r-out').textContent = String(Math.round(best.r));
    $('ed-armor').value = best.armorMul ?? 3; $('ed-armor-out').textContent = Number(best.armorMul ?? 3).toFixed(2).replace('.', ',');
    $('ed-profile').value = best.profile || '';
  }
  editorRefreshGhost();
}

function editorDrag() {
  const t = target();
  const m = S.editor.marker;
  if (!t || !m) return;
  const p = worldToMarker(t, S.mouse.world.x, S.mouse.world.y);
  m.x = Math.round(p.x * 10) / 10;
  m.y = Math.round(p.y * 10) / 10;
  editorRefreshGhost();
}

function editorRefreshGhost() {
  const t = target();
  const m = S.editor.marker;
  if (!t || !m) { S.editor.selected = null; return; }
  const w = markerToWorld(t, m);
  S.editor.selected = { x: w.x, y: w.y, r: m.r * t.__coreLayout.uniform };
}

function editorExport() {
  const t = target();
  if (!t) return;
  const key = HULLS[t.__hullId].editorKey;
  const json = JSON.stringify({ [key]: { cores: SC.exportCoreMarkers(S.markers[t.__hullId]) } }, null, 2);
  $('ed-json').value = json;
  try { navigator.clipboard?.writeText(json); } catch { /* */ }
  log(`eksport rdzeni ${key} (przestrzeń PNG) → schowek`);
}

// ---------------------------------------------------------------------------
// Panel
function bindRange(id, fmt, onInput) {
  const el = $(id);
  const out = $(`${id}-out`);
  const update = () => { if (out) out.textContent = fmt(Number(el.value)); onInput?.(Number(el.value)); };
  el.addEventListener('input', update);
  update();
}

function initPanel() {
  $('weapon').innerHTML = DEMO_WEAPONS.map((id, i) => `<option value="${id}">${i < 9 ? `${i + 1}. ` : ''}${MASTER_WEAPONS[id].name}</option>`).join('');
  $('weapon').value = S.weaponId;
  $('weapon').addEventListener('change', () => { S.weaponId = $('weapon').value; });
  $('scene').value = S.sceneId;
  $('scene').addEventListener('change', () => { S.targetIndex = 0; buildScene($('scene').value); });
  $('target').addEventListener('change', () => { S.targetIndex = Number($('target').value) | 0; refreshCandidateSelect(); placeGun(); });
  $('candidate').addEventListener('change', () => {
    const t = target();
    if (!t) return;
    const cand = HULLS[t.__hullId].candidates.find((c) => c.id === $('candidate').value);
    if (!cand) return;
    S.markers[t.__hullId] = expandCandidate(cand);
    buildScene();
  });
  $('btn-reset').addEventListener('click', () => buildScene());
  $('btn-pause').addEventListener('click', togglePause);
  $('btn-melt').addEventListener('click', () => {
    const t = target();
    const c = t?.shipCores?.find((x) => x.state !== SC.CORE_STATE.DETONATED && !x.invalid);
    if (c) processEvents(SC.forceCoreMeltdown(c, S.simTime, 'wymuszone'));
  });
  $('btn-blow').addEventListener('click', () => {
    const t = target();
    if (!t) return;
    const c = t.shipCores?.find((x) => x.state !== SC.CORE_STATE.DETONATED && !x.invalid);
    if (!c) return;
    const events = SC.forceCoreMeltdown(c, S.simTime, 'wymuszone');
    c.meltdownRemaining = 0.0001;
    processEvents(events);
  });
  bindRange('timescale', (v) => `${v.toFixed(2).replace('.', ',')}×`, (v) => { S.timeScale = v; });
  bindRange('rot', (v) => `${v}°/s`);
  bindRange('drift', (v) => `${v} j/s`);
  bindRange('killfrac', (v) => `${Math.round(v * 100)}%`, () => S.ships.forEach(applyKillFrac));
  bindRange('meltmul', (v) => `${v.toFixed(2).replace('.', ',')}×`, () => S.ships.forEach(applyKillFrac));
  bindRange('chain', (v) => String(v), () => { for (const c of allCores()) c.config = { ...c.config, ...coreConfig() }; });
  $('attr-det').addEventListener('change', () => { for (const c of allCores()) c.config = { ...c.config, ...coreConfig() }; });
  $('det-variant').addEventListener('change', () => {
    for (const c of allCores()) {
      c.config = { ...c.config, ...coreConfig() };
      if (c.state === SC.CORE_STATE.MELTDOWN) c.pendingVariant = SC.chooseCoreDetonationVariant(c, { time: S.simTime });
    }
  });
  $('btn-gallery').addEventListener('click', () => runGallery());
  $('btn-model-focus').addEventListener('click', () => focusReactor());
  $('btn-model-gallery').addEventListener('click', () => toggleModelGallery());
  $('model-on').addEventListener('change', () => { reactor3D.debug.enabled = $('model-on').checked; });
  $('model-xray').addEventListener('change', () => { reactor3D.debug.xray = $('model-xray').checked; });
  for (const ev of ['change', 'input']) $('model-kind').addEventListener(ev, () => reactor3D.reset());
  $('killmode').addEventListener('change', () => { for (const c of allCores()) c.killMode = $('killmode').value; });
  $('hp-off').addEventListener('change', () => { for (const s of S.ships) s.__hpImmune = $('hp-off').checked; });
  // A/B sprzed poprawki heksów-duchów: dawne okna sond i solver co klatkę na
  // cały czas zaznaczenia (render też, bo solver GPU tyka w updateVisuals).
  const legacyEl = $('legacy-probes');
  if (!Combat.GAME_HAS_DRIFT_PROBES) {
    legacyEl.disabled = true;
    legacyEl.parentElement.title = 'destruktor bez poprawki heksów-duchów — wszystko działa jak przed nią';
  }
  legacyEl.addEventListener('change', () => {
    restoreProbeMode?.();
    restoreProbeMode = legacyEl.checked ? Combat.applyProbeMode('legacy') : null;
    combatCtx.legacyProbes = legacyEl.checked;
  });
  $('shields').addEventListener('change', () => {
    for (const s of S.ships) if (s.shield) s.shield.val = $('shields').checked ? s.shield.max : 0;
  });
  bindRange('ed-r', (v) => String(Math.round(v)), (v) => { if (S.editor.marker) { S.editor.marker.r = v; editorRefreshGhost(); } });
  bindRange('ed-armor', (v) => v.toFixed(2).replace('.', ','), (v) => { if (S.editor.marker) S.editor.marker.armorMul = v; });
  $('ed-profile').addEventListener('change', () => {
    if (!S.editor.marker) return;
    const v = $('ed-profile').value;
    if (v) S.editor.marker.profile = v; else delete S.editor.marker.profile;
  });
  $('edit').addEventListener('change', () => { S.editor.active = $('edit').checked; });
  $('ed-apply').addEventListener('click', () => buildScene());
  $('ed-add').addEventListener('click', () => {
    const t = target();
    if (!t) return;
    const p = worldToMarker(t, S.cam.x, S.cam.y);
    const list = S.markers[t.__hullId];
    const m = { id: `${t.__hullId}_${list.length + 1}`, x: Math.round(p.x), y: Math.round(p.y), r: 44, armorMul: 3 };
    list.push(m);
    S.editor.marker = m;
    editorRefreshGhost();
  });
  $('ed-del').addEventListener('click', () => {
    const t = target();
    if (!t || !S.editor.marker) return;
    const list = S.markers[t.__hullId];
    const i = list.indexOf(S.editor.marker);
    if (i >= 0) list.splice(i, 1);
    S.editor.marker = null;
    editorRefreshGhost();
  });
  $('ed-export').addEventListener('click', editorExport);
  $('bench-run').addEventListener('click', runBrowserBench);
}

// ---------------------------------------------------------------------------
// Benchmark w przeglądarce (ta sama funkcja co node, lustro solvera CPU)
async function runBrowserBench() {
  const t = target();
  if (!t) return;
  const el = $('bench');
  const rows = [...BENCH_TABLE_HEADER];
  el.textContent = 'liczę…';
  for (const dir of Object.keys(BENCH_DIRECTIONS)) {
    await new Promise((r) => setTimeout(r, 10));
    const res = runCoreBenchmarkCase({
      buildHull: (id, o) => buildBrowserHull(id, o), hullId: t.__hullId, weaponId: S.weaponId, direction: dir,
      markers: S.markers[t.__hullId], killMode: $('killmode').value, maxTime: 240,
      legacyProbes: $('legacy-probes').checked
    });
    rows.push(formatBenchRow(res));
    el.textContent = rows.join('\n');
  }
}

// ---------------------------------------------------------------------------
// API dla zrzutów (CDP) i konsoli
function measureHDR({ x0 = 0, y0 = 0, w = W, h = H } = {}) {
  const renderer = Core3D.renderer;
  const rt = Core3D.postTarget;
  const bloomWas = Core3D.perfToggles.bloom;
  Core3D.setPerfToggles({ bloom: false });
  render(0, 0);
  const px = Math.max(1, Math.floor(w)), py = Math.max(1, Math.floor(h));
  const buf = new Uint16Array(px * py * 4);
  const yGl = rt.height - Math.floor(y0) - py;
  renderer.readRenderTargetPixels(rt, Math.floor(x0), Math.max(0, yGl), px, py, buf);
  Core3D.setPerfToggles({ bloom: bloomWas });
  const half = (v) => {
    const s = (v & 0x8000) ? -1 : 1;
    const e = (v >> 10) & 0x1f;
    const f = v & 0x3ff;
    if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
    if (e === 31) return f ? NaN : s * Infinity;
    return s * Math.pow(2, e - 15) * (1 + f / 1024);
  };
  const lums = [];
  let nan = 0, over09 = 0, band = 0, white = 0, max = 0;
  for (let i = 0; i < px * py; i++) {
    const r = half(buf[i * 4]), g = half(buf[i * 4 + 1]), b = half(buf[i * 4 + 2]);
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (!Number.isFinite(L)) { nan++; continue; }
    lums.push(L);
    if (L > max) max = L;
    if (L > 0.9) over09++;
    if (L >= 0.4 && L <= 1.3) band++;
    if (L >= 6) white++;
  }
  lums.sort((a, b) => a - b);
  const q = (p) => lums.length ? lums[Math.min(lums.length - 1, Math.floor(p * lums.length))] : 0;
  const hist = [0, 0.1, 0.4, 0.9, 1.3, 2, 4, 8, 12, 1e9].map((edge, i, arr) => i === 0 ? null : {
    from: arr[i - 1], to: edge === 1e9 ? '∞' : edge, count: lums.filter((L) => L >= arr[i - 1] && L < edge).length
  }).filter(Boolean);
  return { pixels: lums.length, nan, max, p50: q(0.5), p99: q(0.99), p999: q(0.999), over09, band, white, hist };
}

async function perfDetonations(count = 3, seconds = 4) {
  // n Bellatorów w rzędzie, wszystkie rdzenie detonują w tej samej klatce
  clearWorld();
  const n = Math.max(1, count | 0);
  for (let i = 0; i < n; i++) {
    const s = createShip('battleship', { x: (i - (n - 1) / 2) * 1400, y: 0, angle: 0, markers: S.markers.battleship, killMode: 'containment', coreConfig: coreConfig() });
    S.ships.push(s);
    S.destructibles.push(s);
  }
  fitCamera();
  for (let k = 0; k < 20; k++) frame(performance.now());
  const baseline = await sampleFrames(1.0);
  const events = [];
  for (const s of S.ships) {
    const c = s.shipCores[0];
    SC.forceCoreMeltdown(c, S.simTime, 'perf', events);
    c.meltdownRemaining = 0.0001;
  }
  processEvents(events);
  for (const s of S.ships) {
    const ev = SC.updateShipCores(s, 0.01, { time: S.simTime, entities: S.destructibles });
    processEvents(ev);
  }
  const during = await sampleFrames(seconds);
  return { count: n, baseline, during };
}

function sampleFrames(seconds) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const samples = [];
    let prev = t0;
    const tick = () => {
      const now = performance.now();
      const ri = renderInfo();
      samples.push({ dt: now - prev, core: Core3D.lastFramePerf?.renderTotalMs || 0, js: S.lastFrameMs, calls: ri.calls, ovCalls: ri.ovCalls, ovMs: overlay3D.getStats().lastRenderMs, tris: ri.tris });
      prev = now;
      if (now - t0 < seconds * 1000) requestAnimationFrame(tick);
      else {
        const pick = (k) => samples.map((s) => s[k]).sort((a, b) => a - b);
        const avg = (k) => samples.reduce((a, s) => a + s[k], 0) / Math.max(1, samples.length);
        const pct = (k, p) => { const a = pick(k); return a[Math.min(a.length - 1, Math.floor(p * a.length))] || 0; };
        resolve({
          frames: samples.length,
          frameMsAvg: +avg('dt').toFixed(2), frameMsP95: +pct('dt', 0.95).toFixed(2), frameMsMax: +pct('dt', 1).toFixed(2),
          jsMsAvg: +avg('js').toFixed(2), jsMsMax: +pct('js', 1).toFixed(2),
          core3dMsAvg: +avg('core').toFixed(2), overlayMsAvg: +avg('ovMs').toFixed(2), overlayMsMax: +pct('ovMs', 1).toFixed(2),
          callsAvg: Math.round(avg('calls')), callsMax: pct('calls', 1), overlayCallsMax: pct('ovCalls', 1), trisMax: pct('tris', 1)
        });
      }
    };
    requestAnimationFrame(tick);
  });
}

// Symulacja bez renderu (CDP): wynik GPU wraca asynchronicznie, więc tu solver
// sprężyn zawsze z lustra CPU (jak benchmark), co 2 kroki jak klatka 60 Hz.
function stepSim(seconds) {
  const n = Math.round(seconds / PHYS_DT);
  if (!cpuSoft) cpuSoft = createCpuSoftBody();
  for (let i = 0; i < n; i++) {
    physicsStep(PHYS_DT);
    if (i % 2 === 1) {
      DestructorSystem.updateVisuals(PHYS_DT * 2, S.destructibles);
      cpuSoft.tick(S.destructibles, DESTRUCTOR_CONFIG, PHYS_DT * 2);
    }
  }
}

// Galeria: po kolei każdy wariant na świeżym Bellatorze (krótkie stopienie).
async function runGallery() {
  const run = ++S.galleryRun;
  const prev = $('det-variant').value;
  for (const id of SC.CORE_VARIANT_IDS) {
    if (run !== S.galleryRun) return;
    $('scene').value = 'battleship';
    $('det-variant').value = id;
    buildScene('battleship');
    const t = S.ships[0];
    const c = t?.shipCores?.[0];
    if (!c) continue;
    S.cam.zoom = 0.42;
    log(`GALERIA: ${SC.CORE_DETONATION_VARIANTS[id].label}`, 'warn');
    processEvents(SC.forceCoreMeltdown(c, S.simTime, 'galeria'));
    c.meltdownRemaining = 0.6;
    await new Promise((r) => setTimeout(r, 4800));
  }
  if (run === S.galleryRun) $('det-variant').value = prev;
}

window.__rdzen = {
  ready: false,
  S, Core3D, coreFx, reactor3D, SC,
  setScene(id) { S.targetIndex = 0; $('scene').value = id; buildScene(id); return S.ships.map((s) => s.__label); },
  setCamera(x, y, zoom) { S.cam.x = x; S.cam.y = y; if (zoom) S.cam.zoom = zoom; },
  fit() { fitCamera(); },
  setWeapon(id) { S.weaponId = id; $('weapon').value = id; },
  setOpt(id, v) { const el = $(id); if (el.type === 'checkbox') el.checked = !!v; else el.value = v; el.dispatchEvent(new Event(el.type === 'checkbox' ? 'change' : 'input')); },
  setTarget(i) { S.targetIndex = i; refreshCandidateSelect(); placeGun(); },
  setGun(dx, dy) { const t = target(); if (t) { S.gunOffset = { x: dx, y: dy }; S.gun.x = t.x + dx; S.gun.y = t.y + dy; } },
  // strzelanie z lockiem przez `seconds` symulacji (bez renderu), potem kilka klatek
  lockFire(seconds) {
    $('lock').checked = true;
    const was = $('autofire').checked;
    $('autofire').checked = true;
    stepSim(seconds);
    $('autofire').checked = was;
    return this.summary();
  },
  stepSim,
  fireUntil(state, maxSeconds = 120) {
    $('lock').checked = true;
    $('autofire').checked = true;
    const t = target();
    const c = t?.shipCores?.[0];
    let s = 0;
    while (s < maxSeconds && c && SC.coreStateRank(c.state) < SC.coreStateRank(state)) { stepSim(0.1); s += 0.1; }
    $('autofire').checked = false;
    S.bullets.length = 0;
    return { seconds: +s.toFixed(1), state: c?.state, summary: this.summary() };
  },
  forceMeltdown(i = S.targetIndex, remaining = null) {
    const t = S.ships[i];
    const c = t?.shipCores?.find((x) => x.state !== SC.CORE_STATE.DETONATED);
    if (!c) return null;
    processEvents(SC.forceCoreMeltdown(c, S.simTime, 'wymuszone'));
    if (remaining != null) c.meltdownRemaining = remaining;
    return SC.summarizeCore(c);
  },
  // wyrwa w komorze bez strzelania: niszczy ułamek heksów komory (od środka)
  openChamber(frac = 0.3, i = S.targetIndex) { return openChamber(frac, i); },
  focusReactor,
  runModelGallery,
  toggleModelGallery,
  renderFrames(n = 1) { for (let i = 0; i < n; i++) frame(performance.now()); return renderInfo(); },
  // n klatek po 1/fps czasu gry, z oddaniem pętli zdarzeń między klatkami
  // (odczyt wyników WebGPU przychodzi asynchronicznie, jak w grze).
  // opts.waitGpu: po klatce czekaj (≤ 40 ms) na odczyty solvera GPU — w grze
  // przy 60 FPS klatka trwa 16,7 ms i odczyt zdąży; tu klatka trwa ~3 ms
  // zegara, więc bez czekania isComputing blokuje dispatch i solver GPU robi
  // mniej kroków na sekundę gry niż w grze.
  async runFrames(n = 60, fps = 60, opts = {}) {
    manualClock = true;
    const gpuBusy = () => {
      for (const st of DestructorGpuSoftBody.entityStates?.values?.() || []) if (st?.isComputing) return true;
      return false;
    };
    try {
      let t = lastT;
      // opts.realtime: klatka nie szybciej niż 1/fps czasu rzeczywistego —
      // reactorblow.js liczy fazy z performance.now(), więc bez tego na
      // zrzutach jego wybuch byłby „młodszy” niż czas symulacji.
      let wall = performance.now();
      for (let i = 0; i < n; i++) {
        t += 1000 / fps;
        frame(t);
        if (opts.realtime) {
          wall += 1000 / fps;
          const wait = wall - performance.now();
          await new Promise((r) => setTimeout(r, Math.max(0, wait)));
        } else {
          await new Promise((r) => setTimeout(r, 0));
        }
        if (opts.waitGpu) {
          for (let w = 0; w < 40 && gpuBusy(); w++) await new Promise((r) => setTimeout(r, 1));
        }
      }
    } finally {
      lastT = performance.now();
      manualClock = false;
    }
    return this.summary();
  },
  pause(v = true) { S.paused = v; },
  setTimeScale,
  measureHDR,
  perfDetonations,
  summary() {
    return {
      simTime: +S.simTime.toFixed(2),
      ships: S.ships.map((s) => ({ label: s.__label, dead: !!s.dead, wreck: !!s.isWreck, hp: s.isPlayer ? s.hull.val : s.hp, cores: (s.shipCores || []).map(SC.summarizeCore) })),
      destructibles: S.destructibles.length,
      hits: S.stats.hullHits || 0,
      softBody: softBodyMode(),
      log: S.log.map((l) => l.text)
    };
  },
  coreScreen(i = S.targetIndex) {
    const c = S.ships[i]?.shipCores?.[0];
    if (!c) return null;
    const w = SC.getCoreWorld(c, {});
    return { x: (w.x - S.cam.x) * S.cam.zoom + W / 2, y: (w.y - S.cam.y) * S.cam.zoom + H / 2, r: c.gridR * S.cam.zoom };
  },
  hexCounts() { return S.ships.map((s) => ({ label: s.__label, hexes: s.hexGrid?.shards.length })); },
  // wymuszony wariant detonacji celu (i = indeks statku), odliczanie `remaining` s
  // aimAt: indeks kadłuba, w który ma pójść wyrzut/kula (inaczej kierunek losowy)
  detonateAs(variant, i = S.targetIndex, remaining = 0.0001, aimAt = null) {
    const t = S.ships[i];
    const c = t?.shipCores?.find((x) => x.state !== SC.CORE_STATE.DETONATED && !x.invalid);
    if (!c) return null;
    const aim = aimAt !== null && aimAt !== undefined ? S.ships[aimAt] : null;
    S.aimExitAt = aim ? { x: Combat.entityX(aim), y: Combat.entityY(aim) } : null;
    $('det-variant').value = variant || '';
    c.config = { ...c.config, ...coreConfig() };
    processEvents(SC.forceCoreMeltdown(c, S.simTime, 'wymuszone'));
    c.meltdownRemaining = remaining;
    return SC.summarizeCore(c);
  },
  hazards() { return { jets: S.jets.length, orbs: S.orbs.length, secondaries: S.secondaries.length, fx: { ...coreFx.stats } }; },
  runGallery,
  // Liczniki kroków solvera sprężyn: wyniki GPU nałożone na siatkę / dispatche lustra.
  solverCounters() {
    return { gpuApplied: DestructorGpuSoftBody._debugAppliedCount || 0, cpuDispatches: cpuSoft?.stats.dispatches || 0, cpuSteps: cpuSoft?.stats.steps || 0 };
  }
};

// ---------------------------------------------------------------------------
(async () => {
  try {
    await loadHullAssets();
    initPanel();
    buildScene(S.sceneId);
    $('loading').style.display = 'none';
    window.__rdzen.ready = true;
    requestAnimationFrame(loop);
  } catch (err) {
    reportError(err.stack || String(err));
  }
})();
