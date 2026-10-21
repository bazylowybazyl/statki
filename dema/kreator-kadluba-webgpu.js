// Demo KREATORA KADŁUBA na WebGPU: projekt z bloków (4 × 4 komórki belek), wielokątów, kół / wycięć, gotowych części,
// modułów, rowków i naklejek (src/game/hullDesign/) → kompozytor TSL (src/3d/hullDesign/hullComposer.js) liczy pakiet
// jak sprite: alfa, albedo, mapa powierzchni (format HullSurface: normalne, AO, relief z prawdziwej wysokości),
// emisja → kadłub z gry: HullBodies.createHull (alfa → belki) i skóra hexShips3D z oświetleniem kadłubów v2 na
// Core3D. Obok (A/B) dzisiejszy kadłub ze sprite'a — dla floty Terra Novy ten sam okręt (podkład U: sprite pod
// projektem do odrysowania). NIC nie jest wpięte do gry.
//
// Serwowanie: `npm run dev` → /dema/kreator-kadluba-webgpu.html
//   ?preset=citadella|custos|hasta|bellator|colossus|klocki|tnparts|tnparts2|orbis|atlas2|destroyer|pirate|empty
//   ?clean=1 (bez paneli)   ?test=1 (klatki z __kreator.runFrames — skrypt scripts/webgpu/kreator-kadluba-demo.mjs)
import { Core3D } from '../src/3d/core3d.js';
import { initHexShips3D, updateHexShips3D, drawHexShips3D, resizeHexShips3D, prewarmHexShips3D } from '../src/3d/hexShips3D.js';
import { HULL_LACQUER_DEFAULTS } from '../src/3d/hullLacquer.js';
import { HullSurface } from '../src/3d/hullSurface.js';
import { HullLighting } from '../src/3d/hullLighting.js';
import { HullComposer, hullComposerTexPerUnit } from '../src/3d/hullDesign/hullComposer.js';
import { buildHullDecalAtlas } from '../src/3d/hullDesign/hullDecalAtlas.js';
import { HullBodies } from '../src/game/hullBodies.js';
import { SimClock } from '../src/game/simClock.js';
import {
  HD_BLOCK, HD_DETAIL, HD_LEVELS, HD_LEVEL_NAMES, HD_MODULES, HD_MODULE_TYPES, HD_PALETTES, HD_PALETTE_KEYS, HD_STYLE_NAMES,
  normalizeHullDesign
} from '../src/game/hullDesign/hullDesignSchema.js';
import { HD_PRESETS, HD_PRESET_KEYS, hullDesignPreset } from '../src/game/hullDesign/hullDesignPresets.js';
import { HD_EMBLEMS, HD_EMBLEM_KEYS } from '../src/game/hullDesign/hullEmblems.js';
import { HD_PARTS, HD_PART_IDS } from '../src/game/hullDesign/hullDesignParts.js';
import { buildHullField, hullCells, hullFieldScale, polyShapeLoop, rasterHullAlpha, loopDistance, hullFrameIntegrity } from '../src/game/hullDesign/hullDesignGeometry.js';
import { hullDesignMounts, hullDesignRecipe } from '../src/game/hullDesign/hullDesignRecipe.js';
import { pipeNetworkCheck } from '../src/game/hullDesign/hullDesignPipes.js';
import { hullDesignSystems } from '../src/game/hullDesign/hullDesignSystems.js';
import { RESOURCES } from '../src/data/resources.js';
import { getHullRenderSize } from '../src/data/ships.js';
import {
  HD_BLOCK_PALETTE, HD_BLOCK_ROT_STEP, HD_BLOCK_TUNE, blockLocalLoops, blockRotStep, blockWorldLoops, hullBlockFromPalette,
  hullBlockPaletteId, hullBlockPaletteUnit, snapBlockRot
} from '../src/game/hullDesign/hullDesignBlocks.js';
import { isPlayerBuildable } from '../src/game/hullDesign/hullDesignBuildable.js';
import {
  hullDesignClass, applyHullDesignPower, hullDesignCheck, hullDesignLimitBreach, hullDesignMountAddIssue, hullDesignMountList
} from '../src/game/hullDesign/hullDesignClass.js';
import { HD_MOUNT_SLOTS, HD_MOUNT_MODULES, HD_MOUNT_RADIUS_DU, hullDesignMountOf } from '../src/game/hullDesign/hullDesignSchema.js';
import {
  SHIP_CLASSES, CORE_LEVELS, MOUNT_SIZES, MOUNT_SLOT_LABELS, POWER_CATEGORY_LABELS, POWER_PRIORITY_DEFAULT, coreLevelMax,
  mountPowerMW, shipClass, sizeRank, weaponsForMount, weaponPowerMW, isHeavySlot
} from '../src/data/shipClasses.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { createShip, loadHullAssets } from './mostki-webgpu/swiat.js';
import { BRIDGE_DEMO_HULLS } from './mostki-webgpu/kadluby.js';
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

// Kadłub dzisiejszej gry do porównania (A/B) — ten sam okręt (Terra Nova) albo podobna klasa.
const REF_FOR = {
  custos: 'frigate', klocki: 'frigate', hasta: 'destroyer', bellator: 'battleship', citadella: 'terran_carrier', colossus: 'terran_supercapital', tnparts: 'battleship', tnparts2: 'battleship',
  orbis: 'terran_carrier', atlas2: 'atlas', pirate: 'pirate_battleship', empty: 'battleship'
};
const REF_KEYS = ['frigate', 'destroyer', 'battleship', 'terran_carrier', 'terran_supercapital', 'atlas', 'pirate_battleship', 'pirate_destroyer'];

const S = {
  design: null, presetKey: params.get('preset') || 'citadella',
  tool: 'block', level: 1, moduleType: 'turret_m', partId: 'tn_bridge', emblem: 'wing', color: '#d06a22', text: 'HF-07',
  pipeN: 3, pipeMat: 'mix',
  view: 'game', grid: true, glowToAlbedo: true, ab: false, abFocus: 'design', refKey: null, underlay: false, poly: null,
  cam: { x: 0, y: 0, zoom: 0.5 },
  mouse: { x: 0, y: 0, wx: 0, wy: 0, pan: false, lastX: 0, lastY: 0, down: -1 },
  drag: null, frameMs: 16, cpuMs: 0,
  bake: null, field: null, recipe: null, mounts: null,
  busy: false, pending: null, rev: 0, builtRev: -1,
  syncPipes: 0, syncNames: [], frame: 0,
  // sieć systemów: graf (kto z kim), kontrola tras (wolne końce, poza obrysem, bez prądu / paliwa), nakładka grafu (I)
  systems: null, netCheck: null, netGraph: false, flash: null,
  // klasa okrętu (etap 2): wynik hullDesignClass, ostatni projekt w limitach mostka (straż akcji), nowe gniazdo
  cls: null, classValid: null, classCheckValid: null, mountSlot: 'main', mountSize: null, classMsg: null
};
window.camera = {
  get x() { return S.cam.x; }, get y() { return S.cam.y; }, get zoom() { return S.cam.zoom; },
  shakeMag: 0, shakeDur: 0, addShake() {}
};

// ---------------------------------------------------------------------------
// Render: Core3D + hexShips3D (skóra kadłubów belkowych, oświetlenie v2)
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
if (!Array.isArray(window.wrecks)) window.wrecks = [];

let composer = null;
let backdrop = null;
const cullInfo = { x: 0, y: 0, halfW: 1e5, halfH: 1e5, drawHalfW: 1e5, drawHalfH: 1e5 };
const renderList = [];
const ship = { entity: null, visual: null, physics: null, surfaceImg: null };
let refShip = null;

// ---------------------------------------------------------------------------
// Budowa: projekt → pole → kompozytor → kadłub gry
let _uid = 0;
function makeCanvas(w, h, data) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  if (data) c.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0);
  return c;
}

/** Mapa powierzchni z kompozytora wprost do HullSurface (gra liczyłaby ją ze sprite'a w workerze). */
function provideSurface(image, data, w, h) {
  HullSurface.acquireUniform(image);
  const entry = HullSurface._entries.get(image);
  const i = HullSurface._pending.indexOf(entry);
  if (i >= 0) HullSurface._pending.splice(i, 1);
  entry.state = 'baking';
  HullSurface._finish(entry, new Uint8Array(data.buffer, data.byteOffset, data.byteLength), w, h, 0);
}

function releaseShip() {
  if (!ship.entity) return;
  HullBodies.release(ship.entity);
  if (ship.surfaceImg) HullSurface.releaseUniform(ship.surfaceImg);
  ship.entity = null;
}

function buildShipEntity(field, bake, mounts) {
  const im = field.image;
  const physics = rasterHullAlpha(field, 1);
  const physicsCanvas = makeCanvas(physics.width, physics.height, physics.data);
  const visual = makeCanvas(bake.width, bake.height, bake.albedo);
  provideSurface(visual, bake.surface, bake.width, bake.height);
  const cells = hullCells(field, 0).count;
  const e = {
    id: `kreator_${++_uid}`,
    x: im.cx, y: im.cy, vx: 0, vy: 0, angle: 0, angVel: 0,
    mass: Math.max(5000, cells * 400), hp: 12000, maxHp: 12000,
    type: 'cruiser', isPirate: field.expanded.design.palette === 'pirate', shipFrame: 'kreator',
    isCapitalShip: true, faction: field.expanded.design.palette,
    __hardpointScaleX: 1, __hardpointScaleY: 1, __hardpointScale: 1,
    __label: field.expanded.design.name, displayName: field.expanded.design.name,
    visual: { spriteScale: 1 },
    // bez automatycznych reflektorów otoczenia: sprite w A/B nie ma lamp (setRef), a reflektory zalewały blachę plamami
    editorLights: { ...mounts.lights, autoFlood: false }
  };
  releaseShip();
  HullBodies.createHull(e, physicsCanvas, { visualImage: visual, hullProfileId: 'terran_battleship' });
  if (!e.beamHull) throw new Error('createHull bez kadłuba (projekt)');
  ship.entity = e;
  ship.visual = visual;
  ship.physics = physicsCanvas;
  ship.surfaceImg = visual;
  S.maps = null;
}

/** Przebudowa (zlewana): `fast` — 1 teksel/j. (przeciąganie), inaczej 2 teksele/j. */
function requestBuild(fast = false) {
  if (!fast && !S.drag) histCommit();
  S.rev++;
  S.pending = { fast };
  if (!S.busy) runBuild();
}

async function runBuild() {
  if (!composer || !S.pending) return;
  const job = S.pending;
  S.pending = null;
  S.busy = true;
  const rev = S.rev;
  try {
    const t0 = performance.now();
    // przeciąganie: pole i obraz w połowie rozdzielczości (szybko), po puszczeniu — pełny wypiek
    const sc = hullFieldScale(normalizeHullDesign(S.design));
    const field = buildHullField(S.design, job.fast ? { fieldRes: sc.res * 0.5 } : {});
    // klasa okrętu: akcja ponad twardy limit mostka się nie wykonuje (projekt wraca do ostatniego w limitach)
    const cls = hullDesignClass(field);
    if (classGuard(cls)) {
      S.busy = false;
      runBuild();
      return;
    }
    applyHullDesignPower(field, cls);
    S.cls = cls;
    const t1 = performance.now();
    const recipe = hullDesignRecipe(field);
    const mounts = hullDesignMounts(field);
    // kontrola sieci tylko przy pełnym wypieku (przeciąganie — połowa rozdzielczości, bez kontroli)
    if (!job.fast) { S.systems = hullDesignSystems(field.expanded.modules); S.netCheck = pipeNetworkCheck(field.pipeNet, field); }
    const atlas = buildHullDecalAtlas(field.expanded.decals);
    const tpu = hullComposerTexPerUnit(field.image.w, field.image.h);
    composer.setDesign(field, atlas, { texPerUnit: job.fast ? tpu * 0.5 : tpu, glowToAlbedo: S.glowToAlbedo });
    const bake = await composer.bake();
    const t2 = performance.now();
    buildShipEntity(field, bake, mounts);
    const t3 = performance.now();
    S.field = field; S.recipe = recipe; S.mounts = mounts; S.bake = bake;
    S.timing = { field: t1 - t0, bake: t2 - t1, gpu: bake.ms, hull: t3 - t2, total: t3 - t0, fast: job.fast };
    S.builtRev = rev;
    placeRef();
    updateRecipe();
    updateBlockStats();
    updateClassPanel();
  } catch (err) {
    reportError(err.stack || String(err));
    S.builtRev = rev;
  }
  S.busy = false;
  if (S.pending) queueMicrotask(runBuild);
  else if (S.timing?.fast && !S.drag) requestBuild(false);
  else wakeBuilt();
}

// ---------------------------------------------------------------------------
// A/B: kadłub dzisiejszej gry (sprite) obok projektu
async function setRef(key) {
  S.refKey = key;
  await loadHullAssets([key]);
  if (refShip) HullBodies.release(refShip);
  refShip = createShip(key, { x: 0, y: 0, angle: 0, throttle: 0 });
  // Lampy pozycyjne sprite'a z edytora gniazd świecą w demie nieproporcjonalnie (czerwona łuna na pół kadru przy małych
  // kadłubach) — A/B bez nich; reflektory otoczenia (automatyczne) zostają jak u projektu.
  refShip.editorLights = { position: [], road: [], flood: [] };
  placeRef();
  updateAbTag();
}

function placeRef() {
  if (!refShip || !S.field) return;
  const im = S.field.image;
  const rh = refShip.beamHull ? refShip.beamHull.srcHeight * refShip.beamHull.scale : 400;
  const rw = refShip.beamHull ? refShip.beamHull.srcWidth * refShip.beamHull.scale : 1000;
  refShip.x = 0;
  refShip.y = im.maxY + rh * 0.5 + Math.max(20, 0.18 * Math.max(rh, im.h));
}

function focusPoint() {
  if (S.ab && S.abFocus === 'ref' && refShip) return { x: refShip.x, y: refShip.y };
  const im = S.field?.image;
  return im ? { x: im.cx, y: im.cy } : { x: 0, y: 0 };
}

function updateAbTag() {
  const el = $('abtag');
  if (!S.ab) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  const ref = BRIDGE_DEMO_HULLS[S.refKey]?.label || S.refKey;
  el.textContent = S.abFocus === 'ref' ? `B · dzisiejszy sprite: ${ref}` : `A · kreator: ${S.design?.name || ''}`;
}

// ---------------------------------------------------------------------------
// Edycja
const snap = (v, s = 1) => Math.round(v / s) * s;
const design = () => S.design;
function mirrorOn(o) { return S.design.mirror && o?.mirror !== false; }

function blockAt(wx, wy) { return [Math.floor(wx / HD_BLOCK), Math.floor(wy / HD_BLOCK)]; }
function setBlock(bx, by, level) {
  const d = design();
  const keep = (b) => !(b[0] === bx && (b[1] === by || (d.mirror && b[1] === -1 - by)));
  d.blocks = d.blocks.filter(keep);
  if (level >= 0) d.blocks.push([bx, by, level]);
}

/** Element pod kursorem: { kind: 'shape' | 'module' | 'decal', obj, mirrored } (lustro → kopia po drugiej burcie). */
function pick(wx, wy) {
  const d = design();
  const tol = 8 / S.cam.zoom;
  const tests = [];
  const cand = (kind, obj) => {
    tests.push({ kind, obj, mirrored: false });
    if (mirrorOn(obj)) tests.push({ kind, obj, mirrored: true });
  };
  for (const o of d.decals) cand('decal', o);
  for (const o of d.modules) cand('module', o);
  for (const o of d.parts || []) cand('part', o);
  for (const o of d.castles || []) cand('castle', o);
  for (const o of d.grooves || []) cand('groove', o);
  for (const o of d.pipes || []) cand('pipe', o);
  for (const o of d.shapes) cand('shape', o);
  let best = null, bestD = Infinity;
  for (const t of tests) {
    const o = t.obj;
    const yy = t.mirrored ? -wy : wy;
    let dist = Infinity;
    if (t.kind === 'groove' || t.kind === 'pipe') {
      const P = o.pts;
      for (let q = 0; q + 1 < P.length; q++) dist = Math.min(dist, segPointDist(wx, yy, P[q][0], P[q][1], P[q + 1][0], P[q + 1][1]));
    } else if (t.kind === 'part') {
      const b = partWorldBox(o, t.mirrored);
      dist = Math.max(0, rectDist(wx, wy, b.x, b.y, b.hw, b.hh, b.rot));
    } else if (t.kind === 'castle') {
      dist = Math.max(0, rectDist(wx, yy, o.x, o.y, o.w, o.h, o.rot || 0));
    } else if (t.kind === 'decal') {
      if (o.kind === 'stripe') dist = segPointDist(wx, yy, o.x0, o.y0, o.x1, o.y1) - o.w * 0.5;
      else if (o.kind === 'contour') continue;
      else dist = rectDist(wx, yy, o.x, o.y, o.w * 0.5, o.h * 0.5, o.rot);
    } else if (t.kind === 'module') {
      const def = HD_MODULES[o.type];
      dist = def.r ? Math.hypot(wx - o.x, yy - o.y) - (o.r || def.r) : rectDist(wx, yy, o.x, o.y, o.w, o.h, o.rot);
    } else if (o.kind === 'block') {
      dist = Math.max(0, loopDistance(blockWorldLoops(o, t.mirrored), wx, wy));
    } else if (o.kind === 'poly') {
      const loop = polyLoopOf(o, t.mirrored);
      dist = Math.abs(loopDistance(loop, wx, wy));
      if (loopDistance(loop, wx, wy) < 0) dist = Math.min(dist, tol * 0.5);
    } else {
      dist = o.kind === 'circle' ? Math.abs(Math.hypot(wx - o.x, yy - o.y) - o.r) : rectDist(wx, yy, o.x, o.y, o.w, o.h, o.rot || 0);
      if (o.kind === 'circle' && Math.hypot(wx - o.x, yy - o.y) < Math.min(14 / S.cam.zoom, o.r * 0.5)) dist = 0;
    }
    if (dist < tol && dist < bestD) { bestD = dist; best = t; }
  }
  return best;
}
/** Pudło części w jej układzie (z brył i modułów definicji) — wybór i podgląd w edytorze. */
const _partBox = new Map();
function partBox(id) {
  let b = _partBox.get(id);
  if (b) return b;
  const src = HD_PARTS[id].make();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
  for (const sh of src.shapes) {
    if (sh.kind === 'poly') for (const [x, y] of sh.pts) add(x, y);
    else { const r = sh.r || Math.hypot(sh.w || 0, sh.h || 0); add(sh.x - r, sh.y - r); add(sh.x + r, sh.y + r); }
  }
  for (const m of src.modules) { const r = m.r || Math.hypot(m.w || 0, m.h || 0); add(m.x - r, m.y - r); add(m.x + r, m.y + r); }
  b = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, hw: (x1 - x0) / 2, hh: (y1 - y0) / 2 };
  _partBox.set(id, b);
  return b;
}
/** Pudło części w świecie: środek, pół-wymiary, obrót (kopia lustra — odbita). */
function partWorldBox(o, mirrored = false) {
  const b = partBox(o.id);
  const fy = mirrored ? -1 : 1;
  const rot = (o.rot || 0) * fy;
  const lx = b.cx * o.s, ly = b.cy * o.s * fy;
  return { x: o.x + lx * Math.cos(rot) - ly * Math.sin(rot), y: o.y * fy + lx * Math.sin(rot) + ly * Math.cos(rot), hw: b.hw * o.s, hh: b.hh * o.s, rot };
}

/** Obrys bryły 'poly' w świecie (sym → pełny; kopia lustra → odbita). */
function polyLoopOf(o, mirrored = false) {
  const pts = o.sym ? [...o.pts, ...o.pts.slice(1, -1).reverse().map(([x, y]) => [x, -y])] : o.pts;
  return polyShapeLoop({ ...o, pts: mirrored ? pts.map(([x, y]) => [x, -y]) : pts });
}
function segPointDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L2)) : 0;
  return Math.hypot(px - ax - vx * t, py - ay - vy * t);
}
function rectDist(px, py, cx, cy, hw, hh, rot = 0) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const dx = px - cx, dy = py - cy;
  const lx = dx * c + dy * s, ly = -dx * s + dy * c;
  const qx = Math.abs(lx) - hw, qy = Math.abs(ly) - hh;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
}
/** System presetu na stałym miejscu klasy i kadłuba (hullDesignSystemSlots.js) — edytor go nie przesuwa ani nie usuwa. */
const isLocked = (p) => p?.kind === 'module' && p.obj.lock === true;
function lockFlash(p) {
  S.flash = { text: `${HD_MODULES[p.obj.type].label}: system na stałym miejscu klasy i kadłuba — zablokowany (projekt od zera: wolny)`, t: performance.now() };
}
function removePicked(p) {
  const d = design();
  const list = p.kind === 'decal' ? d.decals : (p.kind === 'module' ? d.modules : (p.kind === 'part' ? d.parts : (p.kind === 'castle' ? d.castles : (p.kind === 'groove' ? d.grooves : (p.kind === 'pipe' ? d.pipes : d.shapes)))));
  const i = list.indexOf(p.obj);
  if (i >= 0) list.splice(i, 1);
}
function moveObj(p, dx, dy) {
  const o = p.obj;
  const sy = p.mirrored ? -1 : 1;
  if (p.kind === 'decal' && o.kind === 'stripe') { o.x0 += dx; o.x1 += dx; o.y0 += dy * sy; o.y1 += dy * sy; return; }
  if (o.kind === 'poly' || p.kind === 'groove' || p.kind === 'pipe') { for (const pt of o.pts) { pt[0] += dx; if (!o.sym) pt[1] += dy * sy; } return; }
  o.x += dx; o.y += dy * sy;
}
function scaleObj(p, k) {
  const o = p.obj;
  if (o.kind === 'block') { o.w *= k; o.h *= k; snapBlock(o); return; }   // klocek: wymiary na siatce
  if (p.kind === 'part') { o.s = Math.max(0.02, Math.min(20, o.s * k)); return; }
  if (p.kind === 'castle') { o.w = Math.max(4, o.w * k); o.h = Math.max(4, o.h * k); return; }
  if (p.kind === 'groove') { o.w = Math.max(0.3, Math.min(8, o.w * k)); return; }
  if (p.kind === 'pipe') { o.r = Math.max(0.4, Math.min(3, (o.r || 1) * k)); return; }
  if (p.kind === 'shape') {
    if (o.kind === 'circle') o.r = Math.max(2, o.r * k);
    else if (o.kind === 'poly') {
      const cx = o.pts.reduce((a, q) => a + q[0], 0) / o.pts.length, cy = o.sym ? 0 : o.pts.reduce((a, q) => a + q[1], 0) / o.pts.length;
      for (const pt of o.pts) { pt[0] = cx + (pt[0] - cx) * k; pt[1] = cy + (pt[1] - cy) * k; }
    } else { o.w = Math.max(2, o.w * k); o.h = Math.max(2, o.h * k); }
  } else if (p.kind === 'module') {
    const def = HD_MODULES[o.type];
    if (def.r) o.r = Math.max(5, (o.r || def.r) * k);
    else { o.w = Math.max(8, o.w * k); o.h = Math.max(8, o.h * k); }
  } else if (o.kind === 'stripe') o.w = Math.max(1, o.w * k);
  else if (o.kind !== 'contour') { o.w = Math.max(4, o.w * k); o.h = Math.max(4, o.h * k); }
}
function rotateObj(p, a) {
  const o = p.obj;
  const s = p.mirrored ? -1 : 1;
  if (o.kind === 'block') { o.rot = snapBlockRot((o.rot || 0) + Math.sign(a) * s * HD_BLOCK_ROT_STEP); snapBlock(o); return; }   // klocek: co 45°
  if (p.kind === 'decal' && o.kind === 'stripe') {
    const cx = (o.x0 + o.x1) * 0.5, cy = (o.y0 + o.y1) * 0.5;
    const r = (x, y) => { const dx = x - cx, dy = y - cy; return [cx + dx * Math.cos(a * s) - dy * Math.sin(a * s), cy + dx * Math.sin(a * s) + dy * Math.cos(a * s)]; };
    [o.x0, o.y0] = r(o.x0, o.y0); [o.x1, o.y1] = r(o.x1, o.y1);
    return;
  }
  if (o.kind === 'poly') {
    if (o.sym) return;
    const cx = o.pts.reduce((a2, q) => a2 + q[0], 0) / o.pts.length, cy = o.pts.reduce((a2, q) => a2 + q[1], 0) / o.pts.length;
    const c = Math.cos(a * s), sn = Math.sin(a * s);
    for (const pt of o.pts) { const dx = pt[0] - cx, dy = pt[1] - cy; pt[0] = cx + dx * c - dy * sn; pt[1] = cy + dx * sn + dy * c; }
    return;
  }
  if ('rot' in o || p.kind !== 'shape') o.rot = (o.rot || 0) + a * s;
}

function worldOf(sx, sy) {
  return { x: S.cam.x + (sx - W * 0.5) / S.cam.zoom, y: S.cam.y + (sy - H * 0.5) / S.cam.zoom };
}

function onDown(e) {
  const m = S.mouse;
  m.lastX = e.clientX; m.lastY = e.clientY;
  const w = worldOf(e.clientX, e.clientY);
  if (e.button === 1 || (e.button === 0 && e.altKey)) { m.pan = true; e.preventDefault(); return; }
  if (e.button === 2 && (S.tool === 'poly' || S.tool === 'groove' || S.tool === 'pipe') && S.poly) { finishPoly(); return; }
  if (e.button === 2) {
    const p = pick(w.x, w.y);
    if (p && isLocked(p)) { lockFlash(p); return; }
    if (p) { removePicked(p); requestBuild(); return; }
    S.drag = { kind: 'erase' };
    const [bx, by] = blockAt(w.x, w.y);
    setBlock(bx, by, -1);
    requestBuild(true);
    return;
  }
  if (e.button !== 0) return;
  if (S.tool === 'klocek') { blockDown(e, w); return; }
  const d = design();
  const tool = S.tool;
  if (tool === 'poly' || tool === 'groove' || tool === 'pipe') { addPolyPoint(w.x, w.y, e.shiftKey); return; }
  if (tool === 'castle' && !pick(w.x, w.y)) {
    // kasztel: domyślne wymiary z detalu okrętu (≈ 60 × 45 jd), na osi przy kliknięciu blisko osi
    const D = d.detail || 0.6;
    const onAxis = Math.abs(w.y) < 20 / S.cam.zoom;
    const o = { x: snap(w.x), y: onAxis ? 0 : snap(w.y), w: Math.round(32 * D * 10) / 10, h: Math.round(24 * D * 10) / 10, rot: 0, tiers: 2, taper: 0.45, port: true, hatches: 2, vent: 'slats', clip: S.castleClip ? 1 : undefined };
    d.castles = d.castles || [];
    d.castles.push(o);
    S.drag = { kind: 'move', p: { kind: 'castle', obj: o, mirrored: false }, wx: w.x, wy: w.y };
    requestBuild(true);
    return;
  }
  if (tool === 'part' && !pick(w.x, w.y)) {
    const o = { id: S.partId, x: snap(w.x), y: Math.abs(w.y) < 12 / S.cam.zoom ? 0 : snap(w.y), s: Math.round(((d.detail || 0.6) / 0.6) * 1000) / 1000, rot: 0 };
    d.parts = d.parts || [];
    d.parts.push(o);
    S.drag = { kind: 'move', p: { kind: 'part', obj: o, mirrored: false }, wx: w.x, wy: w.y };
    requestBuild(true);
    return;
  }
  if (tool === 'move' || (tool !== 'block' && !e.shiftKey && pick(w.x, w.y) && tool !== 'circle')) {
    const p = pick(w.x, w.y);
    if (p && isLocked(p)) { lockFlash(p); return; }
    if (p) { S.drag = { kind: 'move', p, wx: w.x, wy: w.y }; S.selected = p; syncMountEdit(); return; }
  }
  if (tool === 'block') {
    const [bx, by] = blockAt(w.x, w.y);
    setBlock(bx, by, S.level);
    S.drag = { kind: 'paint' };
    requestBuild(true);
  } else if (tool === 'circle') {
    const st = gridStep();
    const s = { kind: 'circle', op: e.shiftKey ? 'cut' : 'add', x: snap(w.x, st), y: Math.abs(w.y) < 3 * st ? 0 : snap(w.y, st), r: 4 * st, level: S.level };
    d.shapes.push(s);
    S.drag = { kind: 'radius', obj: s };
  } else if (tool === 'stripe') {
    const s = { kind: 'stripe', x0: snap(w.x), y0: snap(w.y), x1: snap(w.x) + 1, y1: snap(w.y), w: 8, color: S.color, opacity: 0.9 };
    d.decals.push(s);
    S.drag = { kind: 'stripeEnd', obj: s };
  } else if (tool === 'emblem' || tool === 'text') {
    const o = tool === 'emblem'
      ? { kind: 'emblem', id: S.emblem, x: snap(w.x), y: snap(w.y), rot: 0, w: 50, h: 50, color: S.color, opacity: 0.92, flip: false }
      : { kind: 'text', text: S.text || 'HF', x: snap(w.x), y: snap(w.y), rot: 0, w: Math.max(30, (S.text || 'HF').length * 13), h: 16, color: S.color, opacity: 0.92, flip: false };
    d.decals.push(o);
    S.drag = { kind: 'move', p: { kind: 'decal', obj: o, mirrored: false }, wx: w.x, wy: w.y };
    requestBuild(true);
  } else if (tool === 'module') {
    const def = HD_MODULES[S.moduleType];
    // domyślne wymiary modułów są dla detail 0,6 — mniejszy okręt dostaje mniejsze moduły
    const k = (d.detail || 0.6) / 0.6;
    const o = { type: S.moduleType, x: snap(w.x), y: Math.abs(w.y) < 10 * k ? 0 : snap(w.y), rot: 0 };
    if (def.r) o.r = Math.round(def.r * k * 10) / 10;
    if (def.w) { o.w = Math.round(def.w * k * 10) / 10; o.h = Math.round(def.h * k * 10) / 10; }
    // dysza SIDE: wydech ku najbliższej burcie (lustro odbija obrót)
    if (S.moduleType === 'thruster_side') o.rot = w.y > 0 ? Math.PI / 2 : -Math.PI / 2;
    // gniazdo broni: typ i rozmiar z panelu, limity mostka (twarde) przed postawieniem
    if (!classMountPlace(o)) return;
    d.modules.push(o);
    S.drag = { kind: 'move', p: { kind: 'module', obj: o, mirrored: false }, wx: w.x, wy: w.y };
    requestBuild(true);
  }
}

/** Krok przyciągania punktów [j.]: 1 jd zaokrąglony (fregata ~0,1 j., lotniskowiec ~0,6 j.). */
function gridStep() {
  const D = S.design?.detail || 0.6;
  return D < 0.25 ? 0.5 : (D < 0.8 ? 1 : 2);
}

// Wielokąt: LPM — punkt (Shift — bez przyciągania do osi), PPM / Enter / klik w pierwszy punkt — zamknij,
// Backspace — cofnij punkt, Esc — porzuć. Pierwszy i ostatni punkt na osi (przy lustrze) → wielokąt symetryczny.
function addPolyPoint(wx, wy, free) {
  const st = gridStep();
  let x = snap(wx, st), y = snap(wy, st);
  const axisTol = 8 / S.cam.zoom;
  if (!free && S.design.mirror && Math.abs(wy) < axisTol) y = 0;
  if (!S.poly) S.poly = { pts: [] };
  const P = S.poly.pts;
  if (S.tool === 'poly' && P.length >= 3 && Math.hypot(wx - P[0][0], wy - P[0][1]) < 8 / S.cam.zoom) { finishPoly(); return; }
  P.push([x, y]);
}
// Rowek (linia podziału płyt) i rura (wiązka): łamana otwarta — LPM punkty, PPM / Enter kończy (≥ 2 punkty).
function finishPoly() {
  const P = S.poly?.pts || [];
  S.poly = null;
  const d = design();
  if (S.tool === 'pipe') {
    if (P.length < 2) return;
    d.pipes = d.pipes || [];
    d.pipes.push({ pts: P, n: S.pipeN, mat: S.pipeMat });
    requestBuild(false);
    return;
  }
  if (S.tool === 'groove') {
    if (P.length < 2) return;
    d.grooves = d.grooves || [];
    d.grooves.push({ pts: P, w: 1.6 });
    requestBuild(false);
    return;
  }
  if (P.length < 3) return;
  const onAxis = (q) => Math.abs(q[1]) < 1e-6;
  const sym = d.mirror && onAxis(P[0]) && onAxis(P[P.length - 1]);
  const ch = Math.round((d.detail || 0.6) * 2 * 10) / 10;
  d.shapes.push({ kind: 'poly', op: S.polyCut ? 'cut' : 'add', pts: P, sym, ch, level: S.level });
  requestBuild(false);
}

function onMove(e) {
  const m = S.mouse;
  const w = worldOf(e.clientX, e.clientY);
  if (m.pan) {
    S.cam.x -= (e.clientX - m.lastX) / S.cam.zoom;
    S.cam.y -= (e.clientY - m.lastY) / S.cam.zoom;
  }
  m.x = e.clientX; m.y = e.clientY; m.lastX = e.clientX; m.lastY = e.clientY;
  m.wx = w.x; m.wy = w.y;
  const dr = S.drag;
  if (!dr) return;
  if (dr.kind === 'blk') { blockDrag(dr, w, e); return; }
  if (dr.kind === 'paint' || dr.kind === 'erase') {
    const [bx, by] = blockAt(w.x, w.y);
    const key = `${bx},${by}`;
    if (dr.last === key) return;
    dr.last = key;
    setBlock(bx, by, dr.kind === 'paint' ? S.level : -1);
    requestBuild(true);
  } else if (dr.kind === 'move') {
    moveObj(dr.p, w.x - dr.wx, w.y - dr.wy);
    dr.wx = w.x; dr.wy = w.y;
    requestBuild(true);
  } else if (dr.kind === 'radius') {
    dr.obj.r = Math.max(8, snap(Math.hypot(w.x - dr.obj.x, w.y - dr.obj.y), 2));
    requestBuild(true);
  } else if (dr.kind === 'stripeEnd') {
    dr.obj.x1 = snap(w.x); dr.obj.y1 = snap(w.y);
    requestBuild(true);
  }
}

function onUp() {
  S.mouse.pan = false;
  if (S.drag) {
    const dr = S.drag;
    S.drag = null;
    if (dr.kind === 'blk') blockUp(dr);
    if (dr.kind === 'stripeEnd' && Math.hypot(dr.obj.x1 - dr.obj.x0, dr.obj.y1 - dr.obj.y0) < 4) design().decals.splice(design().decals.indexOf(dr.obj), 1);
    requestBuild(false);
  }
}

function onWheel(e) {
  e.preventDefault();
  const w = worldOf(e.clientX, e.clientY);
  if (S.tool === 'move') {
    const p = pick(w.x, w.y);
    if (p && isLocked(p)) { lockFlash(p); return; }
    if (p) {
      if (e.shiftKey) rotateObj(p, (e.deltaY > 0 ? 1 : -1) * Math.PI / 36);
      else scaleObj(p, Math.exp(-e.deltaY * 0.0012));
      requestBuild(true);
      clearTimeout(S._wheelT);
      S._wheelT = setTimeout(() => requestBuild(false), 250);
      return;
    }
  }
  S.cam.zoom = Math.min(6, Math.max(0.04, S.cam.zoom * Math.exp(-e.deltaY * 0.0012)));
  S.cam.x = w.x - (e.clientX - W * 0.5) / S.cam.zoom;
  S.cam.y = w.y - (e.clientY - H * 0.5) / S.cam.zoom;
}

// ---------------------------------------------------------------------------
// Klatka
const PHYS_DT = 1 / 60;
function frame(realDt) {
  const t0 = performance.now();
  S.frame++;
  const list = entities();
  SimClock.advance(PHYS_DT);
  HullBodies.step(PHYS_DT, list);
  render(realDt, list);
  S.cpuMs = S.cpuMs * 0.9 + (performance.now() - t0) * 0.1;
}

function entities() {
  renderList.length = 0;
  if (ship.entity) renderList.push(ship.entity);
  if (S.ab && refShip && HullBodies.hasHull(refShip)) renderList.push(refShip);
  return renderList;
}

function render(realDt, list) {
  Core3D.beginPlanetLayerFrame?.();
  SimClock.beginRender(1, PHYS_DT, true);
  const cam = { x: S.cam.x, y: S.cam.y, zoom: S.cam.zoom };
  cullInfo.x = cam.x; cullInfo.y = cam.y;
  cullInfo.drawHalfW = W * 0.5 / cam.zoom + 600; cullInfo.drawHalfH = H * 0.5 / cam.zoom + 600;
  cullInfo.halfW = cullInfo.drawHalfW * 3; cullInfo.halfH = cullInfo.drawHalfH * 3;
  backdrop.sync(cam, W, H);
  updateHexShips3D(cam, list, cullInfo);
  drawHexShips3D(ctx2d, W, H);
  if (S.underlay) drawUnderlay(cam);
  if (S.view !== 'game') drawMap(cam);
  if (!document.body.classList.contains('clean')) { drawEditor(cam); drawBlocks(cam); }
  updateHud();
}

// Podkład: sprite dzisiejszego kadłuba (A/B) pod projektem w tej samej skali — do odrysowania wielokątami. Środek
// pudła sprite'a w osi x, oś symetrii (najmniejsza różnica alfy z odbiciem) w y = 0 projektu.
const underlays = new Map();
function underlayFor(key) {
  const def = BRIDGE_DEMO_HULLS[key];
  if (!def) return null;
  let rec = underlays.get(key);
  if (!rec) {
    rec = {};
    underlays.set(key, rec);
    const img = new Image();
    img.onload = () => {
      const c = makeCanvas(img.width, img.height);
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const a = g.getImageData(0, 0, img.width, img.height).data;
      const w = img.width, h = img.height;
      let x0 = w, y0 = h, x1 = 0, y1 = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (a[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const al = (x, y) => (y < 0 || y >= h ? 0 : a[(y * w + x) * 4 + 3]);
      let axis = (y0 + y1) / 2, best = Infinity;
      for (let k = -120; k <= 120; k++) {
        const ay = (y0 + y1) / 2 + k * 0.5;
        let err = 0, n = 0;
        for (let y = y0; y <= y1; y += 3) { const my = Math.round(2 * ay - y); for (let x = x0; x <= x1; x += 6) { err += Math.abs(al(x, y) - al(x, my)); n++; } }
        if (err / n < best) { best = err / n; axis = ay; }
      }
      rec.scale = getHullRenderSize(def.profile, w, h).w / w;
      rec.ax = (x0 + x1) / 2; rec.ay = axis;
      rec.img = img;
    };
    img.src = `../${def.sprite}`;
  }
  return rec.img ? rec : null;
}
function drawUnderlay(cam) {
  const u = underlayFor(S.refKey);
  if (!u) return;
  const toSx = (x) => (x - cam.x) * cam.zoom + W * 0.5, toSy = (y) => (y - cam.y) * cam.zoom + H * 0.5;
  ctx2d.save();
  ctx2d.globalAlpha = 0.5;
  ctx2d.drawImage(u.img, toSx(-u.ax * u.scale), toSy(-u.ay * u.scale), u.img.width * u.scale * cam.zoom, u.img.height * u.scale * cam.zoom);
  ctx2d.restore();
}

// Widoki map pakietu (odczyt z kompozytora) — w miejscu kadłuba.
function mapCanvas(view) {
  const b = S.bake;
  if (!b) return null;
  S.maps = S.maps || {};
  if (S.maps[view]) return S.maps[view];
  const n = b.width * b.height;
  const px = new Uint8ClampedArray(n * 4);
  if (view === 'albedo') {
    // albedo na szachownicy (alfa widoczna)
    for (let i = 0; i < n; i++) {
      const x = i % b.width, y = (i / b.width) | 0;
      const bg = ((x >> 4) + (y >> 4)) & 1 ? 40 : 26;
      const a = b.albedo[i * 4 + 3] / 255;
      for (let k = 0; k < 3; k++) px[i * 4 + k] = b.albedo[i * 4 + k] * a + bg * (1 - a);
      px[i * 4 + 3] = 255;
    }
  } else if (view === 'normal') {
    for (let i = 0; i < n; i++) { px[i * 4] = b.surface[i * 4]; px[i * 4 + 1] = b.surface[i * 4 + 1]; px[i * 4 + 2] = 255; px[i * 4 + 3] = 255; }
  } else if (view === 'ao' || view === 'relief') {
    const k = view === 'ao' ? 2 : 3;
    for (let i = 0; i < n; i++) { const v = b.surface[i * 4 + k]; px[i * 4] = v; px[i * 4 + 1] = v; px[i * 4 + 2] = v; px[i * 4 + 3] = 255; }
  } else if (view === 'emis') {
    px.set(b.emission);
  } else if (view === 'cells') {
    for (let i = 0; i < n; i++) { const a = b.albedo[i * 4 + 3]; px[i * 4] = a * 0.25; px[i * 4 + 1] = a * 0.3; px[i * 4 + 2] = a * 0.35; px[i * 4 + 3] = 255; }
  }
  S.maps[view] = makeCanvas(b.width, b.height, px);
  return S.maps[view];
}

function drawMap(cam) {
  const c = mapCanvas(S.view);
  const im = S.field?.image;
  if (!c || !im) return;
  const toSx = (x) => (x - cam.x) * cam.zoom + W * 0.5, toSy = (y) => (y - cam.y) * cam.zoom + H * 0.5;
  ctx2d.save();
  ctx2d.fillStyle = '#05070a';
  ctx2d.fillRect(toSx(im.minX) - 2, toSy(im.minY) - 2, im.w * cam.zoom + 4, im.h * cam.zoom + 4);
  ctx2d.imageSmoothingEnabled = cam.zoom * (S.bake.width / im.w) < 1;
  ctx2d.drawImage(c, toSx(im.minX), toSy(im.minY), im.w * cam.zoom, im.h * cam.zoom);
  if (S.view === 'cells') {
    // komórki siatki belek (15 j.) z pokryciem ≥ 0,2 — to dostaje silnik belek
    const g = hullCells(S.field, 0);
    ctx2d.strokeStyle = '#7be0a0aa';
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    for (let y = 0; y < g.ny; y++) for (let x = 0; x < g.nx; x++) {
      if (!g.cells[y * g.nx + x]) continue;
      const sx = toSx(im.minX + x * 15), sy = toSy(im.minY + y * 15), s = 15 * cam.zoom;
      ctx2d.rect(sx + 0.5, sy + 0.5, s - 1, s - 1);
    }
    ctx2d.stroke();
  }
  ctx2d.restore();
}

const LEVEL_COLORS = ['#9a8f80', '#7fb3ff', '#ffd27a', '#ff8a7a'];
function drawEditor(cam) {
  const d = design();
  if (!d || !S.field) return;
  const toS = (x, y) => [(x - cam.x) * cam.zoom + W * 0.5, (y - cam.y) * cam.zoom + H * 0.5];
  ctx2d.save();
  if (S.grid) {
    // siatka bloków w kadrze i bloki projektu (obrys poziomu)
    const w0 = worldOf(0, 0), w1 = worldOf(W, H);
    const bx0 = Math.floor(w0.x / HD_BLOCK), bx1 = Math.ceil(w1.x / HD_BLOCK);
    const by0 = Math.floor(w0.y / HD_BLOCK), by1 = Math.ceil(w1.y / HD_BLOCK);
    if ((bx1 - bx0) * (by1 - by0) < 40000) {
      ctx2d.strokeStyle = '#9fc6d614';
      ctx2d.lineWidth = 1;
      ctx2d.beginPath();
      for (let bx = bx0; bx <= bx1; bx++) { const [sx] = toS(bx * HD_BLOCK, 0); ctx2d.moveTo(sx, 0); ctx2d.lineTo(sx, H); }
      for (let by = by0; by <= by1; by++) { const [, sy] = toS(0, by * HD_BLOCK); ctx2d.moveTo(0, sy); ctx2d.lineTo(W, sy); }
      ctx2d.stroke();
    }
    if (d.mirror) {
      ctx2d.strokeStyle = '#ffb54a40';
      ctx2d.setLineDash([6, 6]);
      ctx2d.beginPath();
      const [, sy] = toS(0, 0);
      ctx2d.moveTo(0, sy); ctx2d.lineTo(W, sy);
      ctx2d.stroke();
      ctx2d.setLineDash([]);
    }
    // kontury poziomów (styl projektu)
    for (let L = 0; L < HD_LEVELS; L++) {
      ctx2d.strokeStyle = LEVEL_COLORS[L] + '88';
      ctx2d.lineWidth = L === S.level ? 1.6 : 1;
      for (const loop of S.field.loops[L]) {
        ctx2d.beginPath();
        loop.forEach(([x, y], i) => { const [sx, sy] = toS(x, y); if (i) ctx2d.lineTo(sx, sy); else ctx2d.moveTo(sx, sy); });
        ctx2d.closePath();
        ctx2d.stroke();
      }
    }
    // bryły
    for (const s of S.field.expanded.shapes) {
      if (s.module || (s.blockSet && S.tool === 'klocek')) continue;
      ctx2d.strokeStyle = s.op === 'cut' ? '#ff5a52aa' : LEVEL_COLORS[s.level] + 'aa';
      ctx2d.setLineDash(s.op === 'cut' ? [4, 4] : []);
      ctx2d.beginPath();
      if (s.kind === 'circle') { const [sx, sy] = toS(s.x, s.y); ctx2d.arc(sx, sy, s.r * cam.zoom, 0, Math.PI * 2); }
      else if (s.kind === 'poly') s.pts.forEach(([x, y], i) => { const [sx, sy] = toS(x, y); if (i) ctx2d.lineTo(sx, sy); else ctx2d.moveTo(sx, sy); });
      else rectPath(toS, s.x, s.y, s.w, s.h, s.rot || 0);
      ctx2d.stroke();
      ctx2d.setLineDash([]);
    }
    // moduły (gniazda bez prądu — czerwone; podpis gniazda: typ, rozmiar, broń)
    ctx2d.font = '10px ui-monospace, Consolas, monospace';
    S.field.expanded.modules.forEach((m, mi) => {
      const def = HD_MODULES[m.type];
      const off = S.cls?.dead.has(mi);
      ctx2d.strokeStyle = off ? '#ff5a52dd' : '#7be0a0cc';
      ctx2d.beginPath();
      if (def.r) { const [sx, sy] = toS(m.x, m.y); ctx2d.arc(sx, sy, (m.r || def.r) * cam.zoom, 0, Math.PI * 2); }
      else rectPath(toS, m.x, m.y, m.w, m.h, m.rot || 0);
      ctx2d.stroke();
      if (cam.zoom > 0.3) { const [sx, sy] = toS(m.x, m.y); ctx2d.fillStyle = off ? '#ff8a82' : '#7be0a0'; ctx2d.fillText(m.lock ? `🔒 ${def.label}` : classModuleLabel(m, off), sx + 4, sy - 4); }
    });
    // rowki
    ctx2d.strokeStyle = '#ffffff70';
    ctx2d.setLineDash([2, 3]);
    for (const g of S.field.expanded.grooves || []) {
      ctx2d.beginPath();
      g.pts.forEach(([x, y], i) => { const [sx, sy] = toS(x, y); if (i) ctx2d.lineTo(sx, sy); else ctx2d.moveTo(sx, sy); });
      ctx2d.stroke();
    }
    ctx2d.setLineDash([]);
    // rury ręczne (łamane wiązek)
    ctx2d.strokeStyle = '#ffa060c0';
    ctx2d.setLineDash([6, 3]);
    for (const g of S.field.expanded.pipes || []) {
      ctx2d.beginPath();
      g.pts.forEach(([x, y], i) => { const [sx, sy] = toS(x, y); if (i) ctx2d.lineTo(sx, sy); else ctx2d.moveTo(sx, sy); });
      ctx2d.stroke();
    }
    ctx2d.setLineDash([]);
    // kasztele (obrys pudła, przerywany)
    ctx2d.setLineDash([6, 3]);
    for (const o of d.castles || []) {
      for (const mir of d.mirror && Math.abs(o.y) >= o.h * 0.35 && o.mirror !== false ? [false, true] : [false]) {
        ctx2d.strokeStyle = '#ffd27acc';
        ctx2d.beginPath();
        rectPath(toS, o.x, mir ? -o.y : o.y, o.w, o.h, mir ? -(o.rot || 0) : (o.rot || 0));
        ctx2d.stroke();
      }
    }
    ctx2d.setLineDash([]);
    // gotowe części (pudła)
    ctx2d.setLineDash([5, 4]);
    for (const o of d.parts || []) {
      for (const mir of d.mirror && Math.abs(o.y) > 0.5 && o.mirror !== false ? [false, true] : [false]) {
        const b = partWorldBox(o, mir);
        ctx2d.strokeStyle = '#c69bffcc';
        ctx2d.beginPath();
        rectPath(toS, b.x, b.y, b.hw, b.hh, b.rot);
        ctx2d.stroke();
        if (cam.zoom > 0.15 && !mir) { const [sx, sy] = toS(b.x - b.hw, b.y - b.hh); ctx2d.fillStyle = '#c69bff'; ctx2d.fillText(HD_PARTS[o.id].label, sx + 2, sy - 3); }
      }
    }
    ctx2d.setLineDash([]);
    // naklejki
    for (const o of S.field.expanded.decals) {
      if (o.kind === 'contour') continue;
      ctx2d.strokeStyle = '#ffb54a88';
      ctx2d.beginPath();
      if (o.kind === 'stripe') { const a = toS(o.x0, o.y0), b = toS(o.x1, o.y1); ctx2d.moveTo(a[0], a[1]); ctx2d.lineTo(b[0], b[1]); }
      else rectPath(toS, o.x, o.y, o.w * 0.5, o.h * 0.5, o.rot || 0);
      ctx2d.stroke();
    }
    // mocowania: dysze MAIN i lampy
    if (S.mounts) {
      const im = S.field.image;
      ctx2d.fillStyle = '#ff9a40';
      for (const t of S.mounts.mainThrusters) { const [sx, sy] = toS(im.cx + t.x, im.cy + t.y); ctx2d.fillRect(sx - 2, sy - 2, 4, 4); }
    }
  }
  if (S.netGraph) drawNetGraph(toS);
  if (S.flash && performance.now() - S.flash.t < 2500) {
    ctx2d.font = '12px "Segoe UI", system-ui, sans-serif';
    ctx2d.fillStyle = '#ffcf6a';
    ctx2d.fillText(S.flash.text, S.mouse.x + 14, S.mouse.y + 18);
  }
  // kursor narzędzia
  const m = S.mouse;
  if (S.tool === 'poly' || S.tool === 'groove' || S.tool === 'pipe') {
    const P = S.poly?.pts || [];
    const col = S.tool === 'groove' ? '#ffffff' : (S.tool === 'pipe' ? '#ffa060' : LEVEL_COLORS[S.level]);
    ctx2d.strokeStyle = col;
    ctx2d.fillStyle = col;
    ctx2d.lineWidth = 1.5;
    ctx2d.beginPath();
    P.forEach(([x, y], i) => { const [sx, sy] = toS(x, y); if (i) ctx2d.lineTo(sx, sy); else ctx2d.moveTo(sx, sy); });
    if (P.length) ctx2d.lineTo(m.x, m.y);
    ctx2d.stroke();
    for (const [x, y] of P) { const [sx, sy] = toS(x, y); ctx2d.fillRect(sx - 2.5, sy - 2.5, 5, 5); }
    if (d.mirror && P.length) {
      ctx2d.setLineDash([3, 4]);
      ctx2d.beginPath();
      P.forEach(([x, y], i) => { const [sx, sy] = toS(x, -y); if (i) ctx2d.lineTo(sx, sy); else ctx2d.moveTo(sx, sy); });
      ctx2d.stroke();
      ctx2d.setLineDash([]);
    }
    ctx2d.font = '11px "Segoe UI", system-ui, sans-serif';
    ctx2d.fillText(S.tool === 'groove' || S.tool === 'pipe'
      ? `${S.tool === 'pipe' ? `rura · ${S.pipeN} w wiązce · ${S.pipeMat}` : 'rowek (linia płyt)'} · ${P.length} pkt — PPM / Enter kończy, Backspace cofa, Esc porzuca`
      : `wielokąt · ${HD_LEVEL_NAMES[S.level]} · ${P.length} pkt — PPM / Enter zamyka, Backspace cofa, Esc porzuca${S.polyCut ? ' · WYCIĘCIE' : ''}`, m.x + 14, m.y - 10);
  } else if (S.tool === 'block') {
    const [bx, by] = blockAt(m.wx, m.wy);
    const [sx, sy] = toS(bx * HD_BLOCK, by * HD_BLOCK);
    ctx2d.strokeStyle = LEVEL_COLORS[S.level];
    ctx2d.lineWidth = 1.5;
    ctx2d.strokeRect(sx, sy, HD_BLOCK * cam.zoom, HD_BLOCK * cam.zoom);
    if (d.mirror) {
      const [, sy2] = toS(0, (-1 - by) * HD_BLOCK);
      ctx2d.setLineDash([3, 3]);
      ctx2d.strokeRect(sx, sy2, HD_BLOCK * cam.zoom, HD_BLOCK * cam.zoom);
      ctx2d.setLineDash([]);
    }
  } else {
    const p = pick(m.wx, m.wy);
    if (p) {
      ctx2d.fillStyle = '#ffffffcc';
      ctx2d.font = '11px "Segoe UI", system-ui, sans-serif';
      const shapeName = { circle: 'koło', rect: 'prostokąt', poly: 'wielokąt', block: 'klocek' };
      const name = p.kind === 'castle' ? `kasztel ${Math.round(p.obj.w * 2)} × ${Math.round(p.obj.h * 2)} j. · ${p.obj.tiers} piętra${p.obj.clip !== undefined ? ' · na płytach' : ''}` : p.kind === 'pipe' ? `rura (${p.obj.pts.length} pkt, ${p.obj.n} w wiązce, ×${(p.obj.r || 1).toFixed(2)})` : p.kind === 'groove' ? `rowek (${p.obj.pts.length} pkt, ${p.obj.w.toFixed(1)} jd)` : p.kind === 'module' ? HD_MODULES[p.obj.type].label : (p.kind === 'part' ? `część: ${HD_PARTS[p.obj.id].label} (×${p.obj.s.toFixed(2)})` : (p.kind === 'shape' ? `${shapeName[p.obj.kind]} ${p.obj.op === 'cut' ? '(wycięcie)' : ''} · ${HD_LEVEL_NAMES[p.obj.level]}` : `naklejka: ${p.obj.kind}`));
      ctx2d.fillText(isLocked(p) ? `🔒 ${name} — system na stałym miejscu (zablokowany)` : `${name}  — PPM usuwa`, m.x + 14, m.y - 10);
    }
  }
  ctx2d.restore();
}

/**
 * Nakładka GRAFU SIECI (I): linie źródło → odbiornik (hullDesignSystems), barwa wg sieci — kable (reaktor → urządzenie)
 * żółte, rury do silników (reaktor → MAIN / SIDE) pomarańczowe, dopływ (zbiornik → reaktor) zielony; odbiornik bez
 * trasy do reaktora (kontrola sieci) — czerwony krzyżyk.
 */
const NET_COLORS = { power: '#ffd23a', feed: '#ff7a2a', supply: '#5be08a' };
function drawNetGraph(toS) {
  const sys = S.systems;
  const mods = S.field?.expanded.modules;
  if (!sys || !mods) return;
  ctx2d.save();
  ctx2d.lineWidth = 1.4;
  for (const net of ['power', 'feed', 'supply']) {
    ctx2d.strokeStyle = NET_COLORS[net] + 'b0';
    ctx2d.setLineDash(net === 'power' ? [5, 4] : []);
    ctx2d.beginPath();
    for (const l of sys.links) {
      if (l.net !== net) continue;
      const a = mods[l.from], b = mods[l.to];
      const [ax, ay] = toS(a.x, a.y), [bx, by] = toS(b.x, b.y);
      ctx2d.moveTo(ax, ay); ctx2d.lineTo(bx, by);
    }
    ctx2d.stroke();
  }
  ctx2d.setLineDash([]);
  const bad = new Set([...(S.netCheck?.unpowered || []), ...(S.netCheck?.unfueled || [])]);
  for (const i of new Set(sys.links.flatMap((l) => [l.from, l.to]))) {
    const m = mods[i];
    const [sx, sy] = toS(m.x, m.y);
    const core = m.type === 'reactor';
    ctx2d.fillStyle = bad.has(i) ? '#ff4040' : (core ? '#ffffff' : '#ffd23a');
    ctx2d.beginPath();
    ctx2d.arc(sx, sy, core ? 5 : 3, 0, Math.PI * 2);
    ctx2d.fill();
    if (bad.has(i)) {
      ctx2d.strokeStyle = '#ff4040';
      ctx2d.beginPath();
      ctx2d.moveTo(sx - 7, sy - 7); ctx2d.lineTo(sx + 7, sy + 7); ctx2d.moveTo(sx + 7, sy - 7); ctx2d.lineTo(sx - 7, sy + 7);
      ctx2d.stroke();
    }
  }
  ctx2d.restore();
}

function rectPath(toS, x, y, hw, hh, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([lx, ly]) => toS(x + lx * c - ly * s, y + lx * s + ly * c));
  pts.forEach(([sx, sy], i) => (i ? ctx2d.lineTo(sx, sy) : ctx2d.moveTo(sx, sy)));
  ctx2d.closePath();
}

let hudAcc = 0;
function updateHud() {
  if (++hudAcc % 6) return;
  const info = Core3D.lastFrameRenderInfo?.total || Core3D.renderer?.info?.render || {};
  const t = S.timing || {};
  const b = S.bake;
  const im = S.field?.image;
  const lines = [];
  lines.push(`<b>${(1000 / Math.max(1, S.frameMs)).toFixed(0)} FPS</b> · CPU ${S.cpuMs.toFixed(1)} ms · GPU ${(Number(Core3D.gpuFrameMs) || 0).toFixed(1)} ms · draw ${info.drawCalls ?? info.calls ?? 0} · zoom ${S.cam.zoom.toFixed(2)}`);
  if (im && b) lines.push(`kadłub ${Math.round(S.field.bounds.maxX - S.field.bounds.minX)} × ${Math.round(S.field.bounds.maxY - S.field.bounds.minY)} j. · obraz ${b.width} × ${b.height} (${b.tpu.toFixed(2)} tek./j.) · belki ${ship.entity?.beamHull?.body?.activeNodes ?? 0} węzłów`);
  lines.push(`wypiek: pole ${(t.field || 0).toFixed(0)} ms · kompozytor ${(t.gpu || 0).toFixed(0)} ms · kadłub ${(t.hull || 0).toFixed(0)} ms${t.fast ? ' <span class="warn">(szybki, 1 tek./j.)</span>' : ''}${S.busy ? ' · <span class="warn">przebudowa…</span>' : ''}`);
  const pn = S.field?.pipeNet?.stats;
  const nc = S.netCheck;
  if (pn) lines.push(`sieć systemów: ${pn.runs} biegów · ${pn.fits} osprzętu · ${pn.routes || 0} tras · ${(pn.ms || 0).toFixed(0)} ms${nc ? ` · wolne końce: ${nc.freeEnds} · poza obrysem: ${nc.outside}` : ''}`);
  lines.push(`narzędzie: ${S.tool} · poziom: ${HD_LEVEL_NAMES[S.level]} · styl: ${HD_STYLE_NAMES[design()?.style] || ''} · lustro: ${design()?.mirror ? 'wł.' : 'wył.'} · pipeline'y synchr.: ${S.syncPipes}`);
  $('hud').innerHTML = lines.join('\n');
}

function updateRecipe() {
  const r = S.recipe;
  if (!r) return;
  const lines = [];
  for (const [k, n] of Object.entries(r.parts)) lines.push(`${(RESOURCES[k]?.label || k).padEnd(22)} ${String(n).padStart(4)}`);
  lines.push('');
  lines.push(`długość ${Math.round(r.length)} j. · szer. ${Math.round(r.width)} j.`);
  lines.push(`komórki: rama ${r.cells.hull} · pancerz ${r.cells.armor} · nadb. ${r.cells.upper} · mostek ${r.cells.bridge}`);
  lines.push(`masa ~${r.massT} t · wartość części ${r.value.toLocaleString('pl-PL')} CR`);
  if (r.warnings.length) {
    lines.push('');
    for (const w of r.warnings) lines.push(`<span class="${w.level}">⚠ ${w.text}</span>`);
  } else lines.push('<span class="good">✓ projekt kompletny</span>');
  $('recipe').innerHTML = lines.join('\n');
  updateNetInfo();
}

/** Panel sieci systemów: liczniki tras i kontrola (wolne końce, poza obrysem, odbiorniki bez prądu / paliwa). */
function updateNetInfo() {
  const el = $('netinfo');
  const net = S.field?.pipeNet, nc = S.netCheck, sys = S.systems;
  if (!net || !sys || (design()?.pipeNet?.density ?? 0) <= 0) { el.innerHTML = 'sieć wyłączona (suwak „sieć rur”)'; return; }
  const runs = { power: 0, feed: 0, supply: 0 };
  for (const r of net.runs) if (r.net in runs) runs[r.net]++;
  const ok = (v) => `<span class="${v ? 'bad' : 'good'}">${v}</span>`;
  const lines = [
    `reaktory ${sys.cores.length} · zbiorniki ${sys.tanks.length} · MAIN ${sys.mains.length} · SIDE ${sys.sides.length}`,
    `urządzenia na kablach: ${sys.consumers.length}`,
    `biegi: kable ${runs.power} · rury do silników ${runs.feed} · dopływ ${runs.supply}`,
    `wolne końce: ${ok(nc?.freeEnds ?? 0)} · poza obrysem: ${ok(nc?.outside ?? 0)}`,
    `bez prądu: ${ok(nc?.unpowered.length ?? 0)} · bez paliwa: ${ok(nc?.unfueled.length ?? 0)} · bez trasy: ${ok(net.stats.unrouted || 0)}`
  ];
  el.innerHTML = lines.join('\n');
}

// ---------------------------------------------------------------------------
// Panel
function syncPanel() {
  const d = design();
  for (const s of ['chamfer', 'rounded', 'sharp']) $(`btn-style-${s}`).classList.toggle('on', d.style === s);
  $('btn-mirror').classList.toggle('on', d.mirror);
  $('sel-palette').value = d.palette;
  for (const t of ['block', 'move', 'circle', 'poly', 'groove', 'pipe', 'part', 'castle', 'stripe', 'emblem', 'text', 'module']) $(`tool-${t}`).classList.toggle('on', S.tool === t);
  $('btn-castleclip').classList.toggle('on', !!S.castleClip);
  $('inp-pipenet').value = String(d.pipeNet?.density ?? 0);
  $('lbl-pipenet').textContent = `sieć rur ×${(d.pipeNet?.density ?? 0).toFixed(2)}`;
  $('sel-pipen').value = String(S.pipeN);
  $('sel-pipemat').value = S.pipeMat;
  $('inp-panels').value = String(d.panels ?? 1);
  $('sel-part').value = S.partId;
  for (let L = 0; L < HD_LEVELS; L++) $(`lvl-${L}`).classList.toggle('on', S.level === L);
  $('btn-polycut').classList.toggle('on', !!S.polyCut);
  $('btn-underlay').classList.toggle('on', S.underlay);
  $('btn-windows').classList.toggle('on', (d.windows ?? 1) > 0.5);
  $('inp-detail').value = String(d.detail);
  $('lbl-detail').textContent = `detal ${d.detail.toFixed(3)} j./jd`;
  $('inp-bevel').value = String(d.bevel ?? 1);
  $('lbl-bevel').textContent = `faza płyt ×${(d.bevel ?? 1).toFixed(2)}`;
  $('btn-round').classList.toggle('on', (d.round ?? 0) > 0.5);
  for (const v of ['game', 'albedo', 'normal', 'ao', 'relief', 'emis', 'cells']) $(`view-${v}`).classList.toggle('on', S.view === v);
  $('btn-grid').classList.toggle('on', S.grid);
  $('btn-glow').classList.toggle('on', S.glowToAlbedo);
  $('btn-ab').classList.toggle('on', S.ab);
  $('btn-netgraph').classList.toggle('on', S.netGraph);
  $('zoom-022').classList.toggle('on', Math.abs(S.cam.zoom - 0.22) < 1e-3);
  $('zoom-05').classList.toggle('on', Math.abs(S.cam.zoom - 0.5) < 1e-3);
  $('zoom-1').classList.toggle('on', Math.abs(S.cam.zoom - 1) < 1e-3);
  $('sel-ref').value = S.refKey || '';
  syncBlockPanel();
  syncClassPanel();
}

function fit() {
  const im = S.field?.image;
  if (!im) return;
  const free = W > 900 ? W - 330 : W;
  S.cam.zoom = Math.min(2, Math.max(0.06, Math.min(free * 0.8 / im.w, H * 0.7 / im.h)));
  S.cam.x = im.cx + (W > 900 ? 160 / S.cam.zoom : 0);
  S.cam.y = im.cy;
}

function setZoom(z) {
  const f = focusPoint();
  S.cam.zoom = z;
  S.cam.x = f.x; S.cam.y = f.y;
  syncPanel();
}

async function loadPreset(key) {
  S.presetKey = key;
  S.design = hullDesignPreset(key);
  S.classValid = null; S.selected = null;
  S.blkSel.clear();
  histReset();
  $('sel-preset').value = key;
  requestBuild(false);
  await waitBuilt();
  fit();
  if (REF_FOR[key]) await setRef(REF_FOR[key]);
  syncPanel();
}

const builtWaiters = [];
function waitBuilt() {
  if (!S.busy && !S.pending && S.builtRev === S.rev) return Promise.resolve(true);
  return new Promise((ok) => builtWaiters.push(ok));
}
function wakeBuilt() {
  if (S.busy || S.pending || S.builtRev !== S.rev) return;
  while (builtWaiters.length) builtWaiters.shift()(true);
}

const ACTIONS = {
  b: () => { S.tool = 'block'; },
  v: () => { S.tool = 'move'; },
  c: () => { S.tool = 'circle'; },
  s: () => { S.tool = 'stripe'; },
  e: () => { S.tool = 'emblem'; },
  t: () => { S.tool = 'text'; },
  m: () => { S.tool = 'module'; },
  p: () => { S.tool = 'poly'; },
  k: () => { S.tool = 'part'; },
  q: () => { S.tool = 'castle'; },
  r: () => { S.tool = 'groove'; },
  w: () => { S.tool = 'pipe'; },
  u: () => { S.underlay = !S.underlay; },
  1: () => { S.level = 0; },
  2: () => { S.level = 1; },
  3: () => { S.level = 2; },
  4: () => { S.level = 3; },
  l: () => { design().mirror = !design().mirror; requestBuild(); },
  g: () => { S.grid = !S.grid; },
  h: () => { document.body.classList.toggle('clean'); },
  a: () => toggleAb(),
  i: () => { S.netGraph = !S.netGraph; }
};
function toggleAb() {
  if (!S.ab) { S.ab = true; S.abFocus = 'design'; }
  else if (S.abFocus === 'design') S.abFocus = 'ref';
  else { S.ab = false; S.abFocus = 'design'; }
  const f = focusPoint();
  S.cam.x = f.x; S.cam.y = f.y;
  updateAbTag();
  syncPanel();
}

function bindPanel() {
  const selP = $('sel-preset');
  for (const k of HD_PRESET_KEYS) selP.add(new Option(HD_PRESETS[k].label, k));
  selP.addEventListener('change', () => loadPreset(selP.value));
  const selPal = $('sel-palette');
  for (const k of HD_PALETTE_KEYS) selPal.add(new Option(`barwy: ${HD_PALETTES[k].label}`, k));
  selPal.addEventListener('change', () => { design().palette = selPal.value; requestBuild(); });
  for (const s of ['chamfer', 'rounded', 'sharp']) $(`btn-style-${s}`).addEventListener('click', () => { design().style = s; requestBuild(); syncPanel(); });
  $('btn-mirror').addEventListener('click', () => { ACTIONS.l(); syncPanel(); });
  for (const t of ['block', 'move', 'circle', 'poly', 'groove', 'pipe', 'part', 'castle', 'stripe', 'emblem', 'text', 'module']) $(`tool-${t}`).addEventListener('click', () => { S.tool = t; syncPanel(); });
  $('btn-castleclip').addEventListener('click', () => { S.castleClip = !S.castleClip; S.tool = 'castle'; syncPanel(); });
  // sieć rur: gęstość (0 — brak) i nowe ziarno; narzędzie Rura: liczba rur w wiązce, materiał
  const pnet = $('inp-pipenet');
  pnet.addEventListener('input', () => { design().pipeNet = { ...(design().pipeNet || {}), density: Number(pnet.value) }; $('lbl-pipenet').textContent = `sieć rur ×${Number(pnet.value).toFixed(2)}`; requestBuild(true); });
  pnet.addEventListener('change', () => requestBuild(false));
  $('btn-pipeseed').addEventListener('click', () => { const pn = design().pipeNet || { density: 1 }; design().pipeNet = { ...pn, seed: ((pn.seed || 0) + 1) % 1000 }; requestBuild(); });
  const selN = $('sel-pipen');
  for (let k = 1; k <= 8; k++) selN.add(new Option(`rura: ${k} w wiązce`, String(k)));
  selN.addEventListener('change', () => { S.pipeN = Number(selN.value); S.tool = 'pipe'; syncPanel(); });
  const selMat = $('sel-pipemat');
  for (const [k, l] of [['mix', 'rura: mieszane'], ['steel', 'rura: stal'], ['copper', 'rura: miedź']]) selMat.add(new Option(l, k));
  selMat.addEventListener('change', () => { S.pipeMat = selMat.value; S.tool = 'pipe'; syncPanel(); });
  const pan = $('inp-panels');
  pan.addEventListener('input', () => { design().panels = Number(pan.value); requestBuild(true); });
  pan.addEventListener('change', () => requestBuild(false));
  const selPart = $('sel-part');
  for (const k of HD_PART_IDS) selPart.add(new Option(`część: ${HD_PARTS[k].label}`, k));
  selPart.addEventListener('change', () => { S.partId = selPart.value; S.tool = 'part'; syncPanel(); });
  for (let L = 0; L < HD_LEVELS; L++) $(`lvl-${L}`).addEventListener('click', () => { S.level = L; syncPanel(); });
  $('btn-polycut').addEventListener('click', () => { S.polyCut = !S.polyCut; S.tool = 'poly'; syncPanel(); });
  $('btn-underlay').addEventListener('click', () => { ACTIONS.u(); syncPanel(); });
  $('btn-windows').addEventListener('click', () => { design().windows = (design().windows ?? 1) > 0.5 ? 0 : 1; requestBuild(); syncPanel(); });
  const det = $('inp-detail');
  det.min = String(HD_DETAIL.min); det.max = String(HD_DETAIL.max); det.step = '0.005';
  det.addEventListener('input', () => { design().detail = Number(det.value); $('lbl-detail').textContent = `detal ${Number(det.value).toFixed(3)} j./jd`; requestBuild(true); });
  det.addEventListener('change', () => requestBuild(false));
  const bev = $('inp-bevel');
  bev.addEventListener('input', () => { design().bevel = Number(bev.value); $('lbl-bevel').textContent = `faza płyt ×${Number(bev.value).toFixed(2)}`; requestBuild(true); });
  bev.addEventListener('change', () => requestBuild(false));
  $('btn-round').addEventListener('click', () => { design().round = (design().round ?? 0) > 0.5 ? 0 : 1; requestBuild(); syncPanel(); });
  const selM = $('sel-module');
  for (const k of HD_MODULE_TYPES) selM.add(new Option(`moduł: ${HD_MODULES[k].label}`, k));
  selM.value = S.moduleType;
  selM.addEventListener('change', () => { S.moduleType = selM.value; S.tool = 'module'; syncPanel(); });
  const selE = $('sel-emblem');
  for (const k of HD_EMBLEM_KEYS) selE.add(new Option(`emblemat: ${HD_EMBLEMS[k].label}`, k));
  selE.addEventListener('change', () => { S.emblem = selE.value; S.tool = 'emblem'; syncPanel(); });
  $('inp-color').addEventListener('input', (e) => { S.color = e.target.value; });
  $('inp-text').addEventListener('input', (e) => { S.text = e.target.value; });
  for (const v of ['game', 'albedo', 'normal', 'ao', 'relief', 'emis', 'cells']) $(`view-${v}`).addEventListener('click', () => { S.view = v; syncPanel(); });
  $('btn-grid').addEventListener('click', () => { ACTIONS.g(); syncPanel(); });
  $('btn-glow').addEventListener('click', () => { S.glowToAlbedo = !S.glowToAlbedo; requestBuild(); syncPanel(); });
  $('zoom-022').addEventListener('click', () => setZoom(0.22));
  $('zoom-05').addEventListener('click', () => setZoom(0.5));
  $('zoom-1').addEventListener('click', () => setZoom(1));
  const selR = $('sel-ref');
  for (const k of REF_KEYS) selR.add(new Option(`A/B z: ${BRIDGE_DEMO_HULLS[k].label}`, k));
  selR.addEventListener('change', async () => { await setRef(selR.value); S.ab = true; syncPanel(); });
  $('btn-ab').addEventListener('click', () => toggleAb());
  $('btn-netgraph').addEventListener('click', () => { ACTIONS.i(); syncPanel(); });
  $('btn-clean').addEventListener('click', () => ACTIONS.h());
  $('btn-json').addEventListener('click', () => {
    const ta = $('json');
    if (ta.style.display !== 'block') { ta.style.display = 'block'; ta.value = JSON.stringify(design(), null, 1); return; }
    try { S.design = normalizeHullDesign(JSON.parse(ta.value)); S.classValid = null; requestBuild(); ta.style.display = 'none'; } catch (err) { reportError(`JSON: ${err.message}`); }
  });
}

function bindInput() {
  canvas2d.addEventListener('mousemove', onMove);
  canvas2d.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas2d.addEventListener('mousedown', onDown);
  window.addEventListener('mouseup', onUp);
  canvas2d.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
    if ((S.tool === 'poly' || S.tool === 'groove' || S.tool === 'pipe') && S.poly) {
      if (e.key === 'Enter') { finishPoly(); e.preventDefault(); return; }
      if (e.key === 'Escape') { S.poly = null; e.preventDefault(); return; }
      if (e.key === 'Backspace') { S.poly.pts.pop(); if (!S.poly.pts.length) S.poly = null; e.preventDefault(); return; }
    }
    const k = e.key.toLowerCase();
    if (ACTIONS[k]) { ACTIONS[k](); syncPanel(); e.preventDefault(); }
  });
  window.addEventListener('resize', () => {
    W = innerWidth; H = innerHeight;
    canvas2d.width = W; canvas2d.height = H;
    glCanvas.width = W; glCanvas.height = H;
    resizeHexShips3D(W, H);
  });
}

// Pipeline'y tworzone SYNCHRONICZNIE w zwykłym renderze (nic ich nie rozgrzało) — po rozgrzewce ma być 0.
function hookPipelines() {
  const pu = Core3D.renderer?.backend?.pipelineUtils;
  if (!pu || pu.__kreatorHook) return;
  pu.__kreatorHook = true;
  const orig = pu.createRenderPipeline;
  pu.createRenderPipeline = function (ro, promises) {
    if (!promises) {
      S.syncPipes++;
      if (S.syncNames.length < 16) S.syncNames.push(`${ro?.material?.name || ro?.material?.type} @ ${ro?.object?.name || ro?.object?.type}`);
    }
    return orig.call(this, ro, promises);
  };
}

let lastT = performance.now();
function loop(nowMs) {
  const realDt = Math.min(0.1, Math.max(0, (nowMs - lastT) / 1000));
  lastT = nowMs;
  S.frameMs = S.frameMs * 0.9 + realDt * 1000 * 0.1;
  if (!TEST) frame(realDt);
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// KLOCKI (narzędzie N): paleta prostych kształtów na siatce projektu (src/game/hullDesign/hullDesignBlocks.js).
// LPM na pustym — postaw klocek z palety (klik: rozmiar domyślny, przeciąganie: pudło), LPM na klocku — zaznacz
// i przesuń (z przyciąganiem do siatki), Shift+klik — dodaj / zdejmij z zaznaczenia, Ctrl+przeciąganie — zaznacz
// ramką, uchwyty — rozmiar; R / Shift+R — obrót o 90° / 45°, F — odbicie, X — wycięcie, 1–4 — poziom, Del — usuń,
// Ctrl+D — duplikat obok, strzałki — krok siatki, Esc — bez zaznaczenia; Ctrl+Z / Ctrl+Y — cofnij / ponów (każda
// zmiana projektu, nie tylko klocki).
S.blkPal = 'rect';
S.blkSel = new Set();
S.blkCut = false;

const blkGrid = () => S.design?.grid || 1;
const isBlock = (o) => o?.kind === 'block';
const designBlocks = () => (S.design?.shapes || []).filter(isBlock);
const snapG = (v, g = blkGrid()) => Math.round(v / g) * g;
const blkSelected = () => designBlocks().filter((b) => S.blkSel.has(b));

// Historia projektu: zrzut JSON po każdej zakończonej zmianie (requestBuild bez przeciągania), cofanie / ponawianie.
const HIST = { stack: [], idx: -1, max: 160 };
function histReset() {
  HIST.stack = S.design ? [JSON.stringify(S.design)] : [];
  HIST.idx = HIST.stack.length - 1;
}
function histCommit() {
  if (!S.design) return;
  const j = JSON.stringify(S.design);
  if (HIST.stack[HIST.idx] === j) return;
  HIST.stack.length = HIST.idx + 1;
  HIST.stack.push(j);
  if (HIST.stack.length > HIST.max) HIST.stack.shift();
  HIST.idx = HIST.stack.length - 1;
}
function histGo(step) {
  const i = HIST.idx + step;
  if (i < 0 || i >= HIST.stack.length) return false;
  HIST.idx = i;
  S.design = normalizeHullDesign(JSON.parse(HIST.stack[i]));
  S.classValid = null; S.selected = null;
  S.blkSel.clear();
  S.rev++;
  S.pending = { fast: false };
  if (!S.busy) runBuild();
  syncPanel();
  return true;
}

/** Klocek pod punktem (najwyżej leżący — ostatni na liście): { b, mirrored } albo null. */
function blockHit(wx, wy) {
  const list = designBlocks();
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i];
    for (const m of mirrorOn(b) ? [false, true] : [false]) if (loopDistance(blockWorldLoops(b, m), wx, wy) <= 0) return { b, mirrored: m };
  }
  return null;
}

/** Przekształcenie układu klocka → świat (kopia lustra: y → −y). */
function blockXf(b, mirrored = false) {
  const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0), fx = b.flip ? -1 : 1, fy = mirrored ? -1 : 1;
  return {
    toW: (lx, ly) => [b.x + lx * fx * c - ly * s, (b.y + lx * fx * s + ly * c) * fy],
    toL: (wx, wy) => { const dx = wx - b.x, dy = wy * fy - b.y; return [(dx * c + dy * s) * fx, -dx * s + dy * c]; }
  };
}

/** Klocek na siatce: wymiary i parametry co krok, krawędzie pudła na siatce (obrót co 90°) albo środek co pół kroku. */
function snapBlock(b) {
  const g = blkGrid(), k = blockRotStep(b.rot);
  b.rot = snapBlockRot(b.rot);
  b.w = Math.max(g, snapG(b.w)); b.h = Math.max(g, snapG(b.h));
  if (k % 2 === 0) {
    const Wb = k % 4 === 0 ? b.w : b.h, Hb = k % 4 === 0 ? b.h : b.w;
    b.x = snapG(b.x - Wb / 2) + Wb / 2; b.y = snapG(b.y - Hb / 2) + Hb / 2;
  } else { b.x = snapG(b.x, g / 2); b.y = snapG(b.y, g / 2); }
  if (b.shape === 'trap') {
    b.a = snapG(b.a || 0); b.b = snapG(b.b || 0);
    if (b.a + b.b > b.w) b.b = b.w - b.a;
  } else if (b.shape === 'tri') b.a = Math.max(0, Math.min(b.w, snapG(b.a || 0, g / 2)));
  if (b.c) {
    const lim = Math.floor(Math.min(b.w, b.h) / 2 / g) * g;
    b.c = b.c.map((v) => Math.max(0, Math.min(lim, snapG(v))));
  }
  return b;
}

/** Nowy klocek z palety w pudle [x0, x1] × [y0, y1] (świat, obrót 0); parametry palety przeskalowane do pudła. */
function paletteBlock(id, x0, y0, x1, y1) {
  const g = blkGrid();
  const p = HD_BLOCK_PALETTE.find((q) => q.id === id) || HD_BLOCK_PALETTE[0];
  const Wb = Math.max(g, Math.abs(x1 - x0)), Hb = Math.max(g, Math.abs(y1 - y0));
  const b = { kind: 'block', shape: p.shape, x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: Wb, h: Hb, rot: 0, level: S.level, op: S.blkCut ? 'cut' : 'add' };
  if (p.shape === 'trap') {
    // skosy trapezu względem wysokości (paleta: 45°)
    let a = (p.a / p.h) * Hb, bb = (p.b / p.h) * Hb;
    if (a + bb > Wb - g) { const k = (Wb - g) / Math.max(1e-6, a + bb); a *= k; bb *= k; }
    b.a = a; b.b = bb;
  } else if (p.shape === 'tri') b.a = (p.a / p.w) * Wb;
  else if (p.c) b.c = p.c.map((v) => (v / p.h) * Math.min(Wb, Hb));
  if (p.arc) b.arc = p.arc;
  if (p.ri) b.ri = p.ri;
  return snapBlock(b);
}

/** Domyślne pudło klocka palety przy punkcie (przyciągnięte, przy osi — na osi). */
function paletteBox(id, wx, wy) {
  const p = HD_BLOCK_PALETTE.find((q) => q.id === id) || HD_BLOCK_PALETTE[0];
  const u = hullBlockPaletteUnit(blkGrid(), S.design?.detail || 0.6);
  const Wb = p.w * u, Hb = p.h * u;
  const x0 = snapG(wx - Wb / 2);
  const y0 = S.design?.mirror && Math.abs(wy) < 10 / S.cam.zoom ? -Hb / 2 : snapG(wy - Hb / 2);
  return [x0, y0, x0 + Wb, y0 + Hb];
}

/** Uchwyty rozmiaru zaznaczonego klocka: [{ hx, hy, x, y }] (świat). */
function blockHandles(b, mirrored = false) {
  const X = blockXf(b, mirrored);
  const out = [];
  for (const hy of [-1, 0, 1]) for (const hx of [-1, 0, 1]) {
    if (!hx && !hy) continue;
    const [x, y] = X.toW(hx * b.w / 2, hy * b.h / 2);
    out.push({ hx, hy, x, y });
  }
  return out;
}

function blockDown(e, w) {
  const d = design();
  const ctrl = e.ctrlKey || e.metaKey;
  // uchwyt zaznaczonego klocka
  const sel = blkSelected();
  if (sel.length === 1) {
    const b = sel[0];
    for (const m of mirrorOn(b) ? [false, true] : [false]) {
      for (const h of blockHandles(b, m)) {
        const [sx, sy] = [(h.x - S.cam.x) * S.cam.zoom + W * 0.5, (h.y - S.cam.y) * S.cam.zoom + H * 0.5];
        if (Math.hypot(sx - e.clientX, sy - e.clientY) <= 7) {
          S.drag = { kind: 'blk', mode: 'resize', b, h, mirrored: m, orig: { ...b, c: b.c ? b.c.slice() : undefined } };
          return;
        }
      }
    }
  }
  const hit = blockHit(w.x, w.y);
  if (hit && !ctrl) {
    if (e.shiftKey) { if (S.blkSel.has(hit.b)) S.blkSel.delete(hit.b); else S.blkSel.add(hit.b); }
    else if (!S.blkSel.has(hit.b)) { S.blkSel.clear(); S.blkSel.add(hit.b); }
    const orig = new Map();
    for (const b of blkSelected()) orig.set(b, { x: b.x, y: b.y });
    S.drag = { kind: 'blk', mode: 'move', wx: w.x, wy: w.y, orig, mirrored: hit.mirrored };
    syncBlockPanel();
    return;
  }
  if (ctrl) { S.drag = { kind: 'blk', mode: 'marquee', a: [w.x, w.y], b: [w.x, w.y], add: e.shiftKey }; return; }
  S.drag = { kind: 'blk', mode: 'place', a: [w.x, w.y], b: [w.x, w.y], sx: e.clientX, sy: e.clientY, rubber: false };
  void d;
}

function blockDrag(dr, w, e) {
  if (dr.mode === 'move') {
    const dx = snapG(w.x - dr.wx), dy = snapG((w.y - dr.wy) * (dr.mirrored ? -1 : 1));
    let changed = false;
    for (const [b, o] of dr.orig) {
      if (b.x !== o.x + dx || b.y !== o.y + dy) changed = true;
      b.x = o.x + dx; b.y = o.y + dy;
    }
    if (changed) requestBuild(true);
  } else if (dr.mode === 'resize') {
    const b = dr.b, o = dr.orig, g = blkGrid();
    const X = blockXf(o, dr.mirrored);
    const [lx, ly] = X.toL(w.x, w.y);
    let x0 = -o.w / 2, x1 = o.w / 2, y0 = -o.h / 2, y1 = o.h / 2;
    if (dr.h.hx > 0) x1 = x0 + Math.max(g, snapG(lx - x0)); else if (dr.h.hx < 0) x0 = x1 - Math.max(g, snapG(x1 - lx));
    if (dr.h.hy > 0) y1 = y0 + Math.max(g, snapG(ly - y0)); else if (dr.h.hy < 0) y0 = y1 - Math.max(g, snapG(y1 - ly));
    const [cx, cy] = blockXf(o, false).toW((x0 + x1) / 2, (y0 + y1) / 2);
    b.x = cx; b.y = cy; b.w = x1 - x0; b.h = y1 - y0;
    // parametry kształtu: skosy 45° trapezu zostają 45°, wierzchołek trójkąta proporcjonalnie, fazy w granicach
    if (b.shape === 'trap') {
      b.a = Math.abs(Math.abs(o.a || 0) - o.h) < 1e-6 ? Math.sign(o.a) * b.h : (o.a || 0);
      b.b = Math.abs(Math.abs(o.b || 0) - o.h) < 1e-6 ? Math.sign(o.b) * b.h : (o.b || 0);
    } else if (b.shape === 'tri') b.a = (o.a || 0) / o.w * b.w;
    snapBlock(b);
    requestBuild(true);
  } else {
    dr.b = [w.x, w.y];
    if (dr.mode === 'place' && Math.hypot(e.clientX - dr.sx, e.clientY - dr.sy) > 6) dr.rubber = true;
  }
}

function blockUp(dr) {
  const d = design();
  if (dr.mode === 'place') {
    const box = dr.rubber
      ? [snapG(Math.min(dr.a[0], dr.b[0])), snapG(Math.min(dr.a[1], dr.b[1])), snapG(Math.max(dr.a[0], dr.b[0])), snapG(Math.max(dr.a[1], dr.b[1]))]
      : paletteBox(S.blkPal, dr.a[0], dr.a[1]);
    const b = paletteBlock(S.blkPal, ...box);
    d.shapes.push(b);
    S.blkSel.clear();
    S.blkSel.add(b);
  } else if (dr.mode === 'marquee') {
    const x0 = Math.min(dr.a[0], dr.b[0]), x1 = Math.max(dr.a[0], dr.b[0]), y0 = Math.min(dr.a[1], dr.b[1]), y1 = Math.max(dr.a[1], dr.b[1]);
    if (!dr.add) S.blkSel.clear();
    for (const b of designBlocks()) {
      for (const m of mirrorOn(b) ? [false, true] : [false]) {
        const y = m ? -b.y : b.y;
        if (b.x >= x0 && b.x <= x1 && y >= y0 && y <= y1) S.blkSel.add(b);
      }
    }
  }
  syncBlockPanel();
}

/** Środek pudła zaznaczenia (przyciągnięty do pół kroku siatki). */
function selCenter(list) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of list) { x0 = Math.min(x0, b.x); x1 = Math.max(x1, b.x); y0 = Math.min(y0, b.y); y1 = Math.max(y1, b.y); }
  const g = blkGrid() / 2;
  return [snapG((x0 + x1) / 2, g), snapG((y0 + y1) / 2, g)];
}

/** Obrót zaznaczenia o `steps` × 45° (jeden klocek — w miejscu, grupa — wokół środka). */
function blkRotate(steps) {
  const sel = blkSelected();
  if (!sel.length) return;
  const a = steps * HD_BLOCK_ROT_STEP;
  const [cx, cy] = selCenter(sel);
  for (const b of sel) {
    if (sel.length > 1) {
      const dx = b.x - cx, dy = b.y - cy;
      b.x = cx + dx * Math.cos(a) - dy * Math.sin(a);
      b.y = cy + dx * Math.sin(a) + dy * Math.cos(a);
    }
    b.rot = snapBlockRot((b.rot || 0) + a);
    snapBlock(b);
  }
  requestBuild();
}

/** Odbicie zaznaczenia lewo-prawo na ekranie (klocek: flip + obrót przeciwny; grupa — względem środka). */
function blkFlip() {
  const sel = blkSelected();
  if (!sel.length) return;
  const [cx] = selCenter(sel);
  for (const b of sel) {
    b.flip = !b.flip;
    b.rot = snapBlockRot(-(b.rot || 0));
    if (sel.length > 1) b.x = 2 * cx - b.x;
    snapBlock(b);
  }
  requestBuild();
}

function blkDelete() {
  const d = design();
  if (!S.blkSel.size) return;
  d.shapes = d.shapes.filter((s) => !S.blkSel.has(s));
  S.blkSel.clear();
  requestBuild();
  syncBlockPanel();
}

/** Duplikat zaznaczenia tuż obok (przesunięty o szerokość zaznaczenia wzdłuż x). */
function blkDuplicate() {
  const d = design();
  const sel = blkSelected();
  if (!sel.length) return;
  let x0 = Infinity, x1 = -Infinity;
  for (const b of sel) for (const [x] of blockWorldLoops(b)[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
  const dx = snapG(x1 - x0);
  S.blkSel.clear();
  for (const b of sel) {
    const c = { ...b, x: b.x + dx, c: b.c ? b.c.slice() : undefined };
    if (!c.c) delete c.c;
    d.shapes.push(c);
    S.blkSel.add(c);
  }
  requestBuild();
}

function blkNudge(dx, dy) {
  for (const b of blkSelected()) { b.x += dx; b.y += dy; }
  requestBuild();
}

function blkToggleCut() {
  const sel = blkSelected();
  if (!sel.length) { S.blkCut = !S.blkCut; syncBlockPanel(); return; }
  const cut = sel.some((b) => b.op !== 'cut');
  for (const b of sel) { b.op = cut ? 'cut' : 'add'; if (cut) delete b.gap; }
  requestBuild();
  syncBlockPanel();
}

function onBlockKey(e) {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
  const k = e.key.toLowerCase();
  const ctrl = e.ctrlKey || e.metaKey;
  const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
  if (ctrl && (k === 'z' || k === 'y')) { histGo(k === 'y' || e.shiftKey ? 1 : -1); stop(); return; }
  if (S.tool !== 'klocek') return;
  const g = blkGrid();
  if (ctrl && k === 'd') { blkDuplicate(); stop(); return; }
  if (ctrl) return;
  if (k === 'r') { blkRotate(e.shiftKey ? 1 : 2); stop(); return; }
  if (k === 'f') { blkFlip(); stop(); return; }
  if (k === 'x') { blkToggleCut(); stop(); return; }
  if (k === 'delete' || k === 'backspace') { blkDelete(); stop(); return; }
  if (k === 'escape') { S.blkSel.clear(); syncBlockPanel(); stop(); return; }
  const arrows = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
  if (arrows[k]) { const s = (e.shiftKey ? 4 : 1) * g; blkNudge(arrows[k][0] * s, arrows[k][1] * s); stop(); return; }
  if (k >= '1' && k <= '4' && S.blkSel.size) {
    for (const b of blkSelected()) b.level = Number(k) - 1;
    requestBuild();               // S.level ustawia zwykły skrót (ACTIONS)
  }
}

const LEVEL_FILL = ['#9a8f8033', '#7fb3ff22', '#ffd27a22', '#ff8a7a22'];
function blockPath(loops, toS) {
  ctx2d.beginPath();
  for (const l of loops) {
    l.forEach(([x, y], i) => { const [sx, sy] = toS(x, y); if (i) ctx2d.lineTo(sx, sy); else ctx2d.moveTo(sx, sy); });
    ctx2d.closePath();
  }
}

/** Nakładka klocków: siatka, oś lustra, obrysy klocków (kopia lustra przerywana), zaznaczenie, uchwyty, podgląd. */
function drawBlocks(cam) {
  const d = design();
  if (!d || !S.field) return;
  const tool = S.tool === 'klocek';
  const toS = (x, y) => [(x - cam.x) * cam.zoom + W * 0.5, (y - cam.y) * cam.zoom + H * 0.5];
  const g = blkGrid();
  ctx2d.save();
  if (tool && S.grid && g * cam.zoom >= 5) {
    const w0 = worldOf(0, 0), w1 = worldOf(W, H);
    ctx2d.lineWidth = 1;
    for (const major of [false, true]) {
      const st = major ? g * 4 : g;
      if ((w1.x - w0.x) / st > 600) continue;
      ctx2d.strokeStyle = major ? '#9fc6d628' : '#9fc6d610';
      ctx2d.beginPath();
      for (let x = Math.floor(w0.x / st) * st; x <= w1.x; x += st) { const [sx] = toS(x, 0); ctx2d.moveTo(Math.round(sx) + 0.5, 0); ctx2d.lineTo(Math.round(sx) + 0.5, H); }
      for (let y = Math.floor(w0.y / st) * st; y <= w1.y; y += st) { const [, sy] = toS(0, y); ctx2d.moveTo(0, Math.round(sy) + 0.5); ctx2d.lineTo(W, Math.round(sy) + 0.5); }
      ctx2d.stroke();
    }
  }
  // oś lustra (zawsze w narzędziu Klocki)
  if (d.mirror && (tool || S.grid)) {
    const [, sy] = toS(0, 0);
    ctx2d.strokeStyle = tool ? '#ffb54acc' : '#ffb54a40';
    ctx2d.lineWidth = tool ? 1.4 : 1;
    ctx2d.setLineDash([10, 6]);
    ctx2d.beginPath(); ctx2d.moveTo(0, sy); ctx2d.lineTo(W, sy); ctx2d.stroke();
    ctx2d.setLineDash([]);
    if (tool) { ctx2d.fillStyle = '#ffb54a'; ctx2d.font = '11px "Segoe UI", system-ui, sans-serif'; ctx2d.fillText('oś lustra', 12, sy - 5); }
  }
  if (tool || S.blkSel.size) {
    for (const b of designBlocks()) {
      const sel = S.blkSel.has(b);
      for (const m of mirrorOn(b) ? [false, true] : [false]) {
        blockPath(blockWorldLoops(b, m), toS);
        if (sel && !m) { ctx2d.fillStyle = '#ffffff18'; ctx2d.fill('evenodd'); }
        else if (tool && !m) { ctx2d.fillStyle = b.op === 'cut' ? '#ff5a5222' : LEVEL_FILL[b.level]; ctx2d.fill('evenodd'); }
        ctx2d.strokeStyle = b.op === 'cut' ? '#ff5a52dd' : (sel ? '#ffffff' : LEVEL_COLORS[b.level] + (m ? '66' : 'cc'));
        ctx2d.lineWidth = sel ? 1.8 : 1;
        ctx2d.setLineDash(m || b.op === 'cut' ? [4, 4] : []);
        ctx2d.stroke();
        ctx2d.setLineDash([]);
      }
    }
    const sel = blkSelected();
    if (sel.length === 1 && tool) {
      ctx2d.fillStyle = '#ffffff';
      ctx2d.strokeStyle = '#0b1218';
      for (const h of blockHandles(sel[0])) {
        const [sx, sy] = toS(h.x, h.y);
        ctx2d.fillRect(sx - 4, sy - 4, 8, 8);
        ctx2d.strokeRect(sx - 4.5, sy - 4.5, 9, 9);
      }
      const b = sel[0];
      const [sx, sy] = toS(b.x, b.y);
      ctx2d.font = '11px ui-monospace, Consolas, monospace';
      ctx2d.fillStyle = '#ffffffdd';
      ctx2d.fillText(`${blockLabel(b)} ${fmtJ(b.w)} × ${fmtJ(b.h)} j. · ${Math.round(blockRotStep(b.rot) * 45)}°${b.flip ? ' · odbity' : ''}`, sx + 10, sy - 10);
    }
  }
  const dr = S.drag;
  if (tool && dr?.kind === 'blk' && (dr.mode === 'marquee' || (dr.mode === 'place' && dr.rubber))) {
    const [ax, ay] = toS(dr.a[0], dr.a[1]), [bx, by] = toS(dr.b[0], dr.b[1]);
    ctx2d.strokeStyle = dr.mode === 'marquee' ? '#ffffffaa' : LEVEL_COLORS[S.level];
    ctx2d.setLineDash([5, 4]);
    ctx2d.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
    ctx2d.setLineDash([]);
    if (dr.mode === 'place') {
      const box = [snapG(Math.min(dr.a[0], dr.b[0])), snapG(Math.min(dr.a[1], dr.b[1])), snapG(Math.max(dr.a[0], dr.b[0])), snapG(Math.max(dr.a[1], dr.b[1]))];
      blockPath(blockWorldLoops(paletteBlock(S.blkPal, ...box)), toS);
      ctx2d.strokeStyle = S.blkCut ? '#ff5a52' : '#ffffff';
      ctx2d.stroke();
    }
  } else if (tool && !dr && !blockHit(S.mouse.wx, S.mouse.wy)) {
    // podgląd klocka palety pod kursorem (+ kopia lustra)
    const b = paletteBlock(S.blkPal, ...paletteBox(S.blkPal, S.mouse.wx, S.mouse.wy));
    for (const m of d.mirror ? [false, true] : [false]) {
      blockPath(blockWorldLoops(b, m), toS);
      ctx2d.strokeStyle = (S.blkCut ? '#ff5a52' : LEVEL_COLORS[S.level]) + (m ? '66' : 'ee');
      ctx2d.setLineDash(m ? [3, 4] : [6, 3]);
      ctx2d.stroke();
      ctx2d.setLineDash([]);
    }
  }
  ctx2d.restore();
}

const fmtJ = (v) => (Math.round(v * 100) / 100).toLocaleString('pl-PL');
function blockLabel(b) {
  const p = HD_BLOCK_PALETTE.find((q) => q.id === hullBlockPaletteId(b));
  return `${p ? p.label.toLowerCase() : b.shape}${b.op === 'cut' ? ' (wycięcie)' : ''} · ${HD_LEVEL_NAMES[b.level]}`;
}

/** Ikona wpisu palety (SVG z wielokąta klocka). */
function paletteIcon(id) {
  const loops = blockLocalLoops(hullBlockFromPalette(id, 1));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of loops) for (const [x, y] of l) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const k = Math.min(34 / (x1 - x0), 18 / (y1 - y0));
  const ox = 20 - (x0 + x1) / 2 * k, oy = 12 - (y0 + y1) / 2 * k;
  const dpath = loops.map((l) => `M${l.map(([x, y]) => `${(x * k + ox).toFixed(1)},${(y * k + oy).toFixed(1)}`).join('L')}Z`).join('');
  return `<svg viewBox="0 0 40 24" aria-hidden="true"><path d="${dpath}" fill="#c9c4b9" fill-rule="evenodd" stroke="#f2efe8" stroke-width="0.8"/></svg>`;
}

function syncBlockPanel() {
  const el = $('blk-palette');
  if (!el) return;
  for (const btn of el.querySelectorAll('button')) btn.classList.toggle('on', btn.dataset.id === S.blkPal);
  $('tool-klocek').classList.toggle('on', S.tool === 'klocek');
  const sel = blkSelected();
  $('blk-cut').classList.toggle('on', sel.length ? sel.every((b) => b.op === 'cut') : S.blkCut);
  const gap = sel.length ? (sel[0].gap ?? HD_BLOCK_TUNE.gapDu) : HD_BLOCK_TUNE.gapDu;
  $('inp-gap').value = String(gap);
  $('lbl-gap').textContent = `szczelina ${gap} jd${sel.length ? '' : ' (domyślna)'}`;
  $('blk-undo').disabled = HIST.idx <= 0;
  $('blk-redo').disabled = HIST.idx >= HIST.stack.length - 1;
  updateBlockStats();
}

/** Panel: powierzchnia kadłuba, liczba klocków (i z lustrem), gniazda uzbrojenia, strażnik „bez czitowania”. */
const BLK_INTEGRITY = new WeakMap();   // pole → hullFrameIntegrity (liczona raz na zbudowane pole)
function updateBlockStats() {
  const el = $('blk-stats');
  if (!el || !S.field || !S.design) return;
  const blocks = designBlocks();
  const copies = blocks.reduce((n, b) => n + (mirrorOn(b) && Math.abs(b.y) > 1e-6 ? 2 : 1), 0);
  const gn = hullDesignMountList(S.field.expanded.modules);
  const bySize = (s) => gn.filter((g) => g.size === s).length;
  const b = S.field.bounds;
  const bp = isPlayerBuildable(S.design);
  const sel = blkSelected();
  // spójność ramy (osobno od strażnika edytora): kawałki i szpary na wylot, raz na zbudowane pole
  let it = BLK_INTEGRITY.get(S.field);
  if (!it) BLK_INTEGRITY.set(S.field, it = hullFrameIntegrity(S.field));
  const at = (p) => `${Math.round((p.box[0] + p.box[2]) / 2)}, ${Math.round((p.box[1] + p.box[3]) / 2)}`;
  const j2 = (p) => p.area.toLocaleString('pl-PL', { maximumFractionDigits: 1 });
  const frame = [];
  if (it.pieces.length > 1) frame.push(`kadłub w ${it.pieces.length} kawałkach (najmniejszy ${j2(it.pieces[it.pieces.length - 1])} j.² przy ${at(it.pieces[it.pieces.length - 1])})`);
  if (it.holes.length) frame.push(`${it.holes.length} ${it.holes.length === 1 ? 'szpara' : it.holes.length < 5 ? 'szpary' : 'szpar'} na wylot (największa ${j2(it.holes[0])} j.² przy ${at(it.holes[0])})`);
  el.innerHTML = [
    `kadłub ${Math.round(b.maxX - b.minX)} × ${Math.round(b.maxY - b.minY)} j. · powierzchnia <b>${Math.round(S.field.area).toLocaleString('pl-PL')} j.²</b>`,
    `klocki <b>${blocks.length}</b>${copies !== blocks.length ? ` (z lustrem ${copies})` : ''} · gniazda <b>${gn.length}</b> (S ${bySize('S')} · M ${bySize('M')} · L ${bySize('L')} · C ${bySize('Capital')})`,
    `siatka ${fmtJ(blkGrid())} j. · zaznaczone ${sel.length}${sel.length === 1 ? ` — ${blockLabel(sel[0])}` : ''}`,
    bp.ok ? '<span style="color:var(--good)">✓ do zbudowania w edytorze gracza</span>'
      : `<span style="color:var(--warn)">⚠ poza edytorem gracza: ${bp.violations.length} (${bp.violations[0].text})</span>`,
    frame.length ? `<span style="color:var(--warn)">⚠ ${frame.join(' · ')}</span>`
      : '<span style="color:var(--good)">✓ rama w jednym kawałku, bez szpar</span>'
  ].join('<br>');
}

function bindBlockPanel() {
  const el = $('blk-palette');
  el.innerHTML = HD_BLOCK_PALETTE.map((p) => `<button data-id="${p.id}" title="${p.label}">${paletteIcon(p.id)}</button>`).join('');
  for (const btn of el.querySelectorAll('button')) {
    btn.addEventListener('click', () => { S.blkPal = btn.dataset.id; S.tool = 'klocek'; syncPanel(); });
  }
  $('tool-klocek').addEventListener('click', () => { S.tool = 'klocek'; syncPanel(); });
  $('blk-cut').addEventListener('click', () => { S.tool = 'klocek'; blkToggleCut(); syncPanel(); });
  $('blk-del').addEventListener('click', () => blkDelete());
  $('blk-rot').addEventListener('click', () => blkRotate(2));
  $('blk-rot45').addEventListener('click', () => blkRotate(1));
  $('blk-flip').addEventListener('click', () => blkFlip());
  $('blk-dup').addEventListener('click', () => blkDuplicate());
  $('blk-undo').addEventListener('click', () => histGo(-1));
  $('blk-redo').addEventListener('click', () => histGo(1));
  const gap = $('inp-gap');
  gap.min = '0'; gap.max = String(HD_BLOCK_TUNE.gapDu * 3); gap.step = '1';
  gap.addEventListener('input', () => {
    for (const b of blkSelected()) if (b.op !== 'cut') b.gap = Number(gap.value);
    $('lbl-gap').textContent = `szczelina ${gap.value} jd`;
    requestBuild(true);
  });
  gap.addEventListener('change', () => requestBuild(false));
  window.addEventListener('keydown', onBlockKey, true);
  ACTIONS.n = () => { S.tool = 'klocek'; };
  window.__kreator.blk = {
    tool() { S.tool = 'klocek'; syncPanel(); return true; },
    palette(id) { S.blkPal = id; syncPanel(); return true; },
    select(idx) { S.blkSel.clear(); const list = designBlocks(); for (const i of idx) if (list[i]) S.blkSel.add(list[i]); syncPanel(); return S.blkSel.size; },
    rotate(steps) { blkRotate(steps); return true; },
    flip() { blkFlip(); return true; },
    undo() { return histGo(-1); },
    redo() { return histGo(1); },
    hist() { return { idx: HIST.idx, n: HIST.stack.length }; },
    buildable() { return isPlayerBuildable(S.design); },
    area() { return S.field?.area || 0; },
    count() { return designBlocks().length; },
    sheet() { S.design = normalizeHullDesign(blockSheet()); S.blkSel.clear(); histReset(); requestBuild(false); return true; }
  };
}

/**
 * ARKUSZ PALETY (zrzuty): każdy kształt w trzech ustawieniach (0°, 45°, 90° z odbiciem) na płycie ramy, pod nimi
 * szczelina: trzy płyty stykające się (rowy), trzy z gap 0 (jedna płyta), dwie nachodzące, wycięcie płyty, nadbudówka.
 */
function blockSheet() {
  const g = 0.5, D = 0.09, u = hullBlockPaletteUnit(g, D);
  const shapes = [{ kind: 'block', shape: 'rect', x: -6, y: 7, w: 156, h: 62, level: 0 }];
  HD_BLOCK_PALETTE.forEach((p, i) => {
    const x = -72 + i * 13;
    shapes.push({ ...hullBlockFromPalette(p.id, u, x, -14) });
    shapes.push({ ...hullBlockFromPalette(p.id, u, x, 0), rot: HD_BLOCK_ROT_STEP });
    shapes.push({ ...hullBlockFromPalette(p.id, u, x, 14), rot: 2 * HD_BLOCK_ROT_STEP, flip: true });
  });
  const r = (x0, x1, o = {}) => ({ kind: 'block', shape: 'rect', x: (x0 + x1) / 2, y: 28, w: x1 - x0, h: 8, level: 1, ...o });
  shapes.push(r(-76, -66), r(-66, -56), r(-56, -46));
  shapes.push(r(-40, -30, { gap: 0 }), r(-30, -20, { gap: 0 }), r(-20, -10, { gap: 0 }));
  shapes.push(r(-4, 10), r(6, 20));
  shapes.push(r(26, 46), { kind: 'block', shape: 'rect', x: 36, y: 28, w: 8, h: 3, level: 1, op: 'cut' });
  shapes.push(r(52, 70), { kind: 'block', shape: 'trap', x: 61, y: 28, w: 12, h: 4, a: 2, b: 2, level: 2 });
  return {
    v: 2, name: 'Arkusz palety klocków', style: 'chamfer', mirror: false, palette: 'terra', seed: 3, detail: D, grid: g,
    windows: 0, bevel: 1.9, round: 1, panels: 0.55, blocks: [], shapes, modules: [], decals: []
  };
}

// API konsoli / harnessu.
// ---------------------------------------------------------------------------
// KLASA OKRĘTU (etap 2 — src/game/hullDesign/hullDesignClass.js, dane src/data/shipClasses.js): mostek I–VI (twarde
// limity: powierzchnia, gniazda, gniazda ciężkie, rozmiar broni — akcja ponad limit wraca do ostatniego projektu w
// limitach: classGuard w runBuild), rdzeń R1–R6 (moc — limit miękki: urządzenia ponad moc gasną wg priorytetu, ich kable
// szare), gniazda broni (typ, rozmiar, broń), kolejka priorytetów zasilania.
const fmtMW = (v) => (Math.round(v * 10) / 10).toLocaleString('pl-PL');
const fmtInt = (v) => Math.round(v).toLocaleString('pl-PL');

function classFlash(text) {
  S.flash = { text, t: performance.now() };
  S.classMsg = text;
  const el = $('classmsg');
  if (el) el.textContent = text;
}

/** Podpis modułu w nakładce: gniazdo — typ, rozmiar, broń (bez prądu — dopisek). */
function classModuleLabel(m, off) {
  const g = hullDesignMountOf(m);
  if (!g) return HD_MODULES[m.type].label;
  const w = g.weapon === '' ? 'puste' : (g.weapon ? MASTER_WEAPONS[g.weapon]?.name || g.weapon : 'typowa');
  return `${MOUNT_SLOT_LABELS[g.slot]} ${g.size} · ${w}${off ? ' · BEZ PRĄDU' : ''}`;
}

/**
 * Straż twardych limitów mostka po budowie pola: akcja, po której limit jest bardziej przekroczony niż w ostatnim projekcie
 * w limitach, się nie wykonuje — projekt wraca, wpis historii znika, komunikat. Zwraca true, gdy cofnięto.
 */
function classGuard(cls) {
  const json = JSON.stringify(S.design);
  if (S.classValid && S.classCheckValid && json !== S.classValid) {
    const why = hullDesignLimitBreach(S.classCheckValid, cls.check);
    if (why) {
      if (HIST.stack[HIST.idx] === json) { HIST.stack.splice(HIST.idx, 1); HIST.idx = Math.max(0, HIST.idx - 1); }
      S.design = normalizeHullDesign(JSON.parse(S.classValid));
      S.drag = null; S.selected = null;
      S.blkSel.clear();
      classFlash(`Limit mostka: ${why}`);
      S.rev++;
      S.pending = { fast: false };
      return true;
    }
  }
  S.classValid = json;
  S.classCheckValid = cls.check;
  return false;
}

/** Nowe gniazdo (narzędzie Moduł): typ i rozmiar z panelu, limity mostka przed postawieniem. */
function classMountPlace(o) {
  if (!HD_MOUNT_MODULES[o.type]) return true;
  const d = design();
  const lv = S.cls?.levels.bridge || 1;
  if (o.type === 'mount') {
    o.slot = S.mountSlot;
    o.size = S.mountSize || shipClass(lv).weaponSize;
    o.r = Math.round(HD_MOUNT_RADIUS_DU[o.slot] * (d.detail || 0.6) * 100) / 100;
  }
  const copies = d.mirror && Math.abs(o.y) > 0.5 ? 2 : 1;
  const why = hullDesignMountAddIssue(lv, S.cls?.mounts || [], hullDesignMountOf(o), copies);
  if (why) { classFlash(why); return false; }
  return true;
}

function setBridgeLevel(lv) {
  const d = design();
  if (lv > 0 && S.cls && S.field) {
    const c = hullDesignCheck({ ...d, bridgeLevel: lv, coreLevel: Math.min(d.coreLevel || lv, coreLevelMax(lv)) }, S.cls.area, S.field.expanded.modules);
    const hard = c.issues.filter((i) => i.code !== 'core');
    if (hard.length) { classFlash(`Mostek ${shipClass(lv).roman} (${shipClass(lv).label}): ${hard[0].text}`); syncClassPanel(); return false; }
  }
  d.bridgeLevel = lv;
  if (lv > 0 && d.coreLevel > coreLevelMax(lv)) d.coreLevel = coreLevelMax(lv);
  S.classValid = null;
  classFlash('');
  requestBuild();
  return true;
}

function setCoreLevel(lv) {
  const d = design();
  const br = S.cls?.levels.bridge || d.bridgeLevel || 1;
  if (lv > coreLevelMax(br)) {
    classFlash(`Rdzeń R${lv} nie mieści się w kadłubie z mostkiem ${shipClass(br).roman} (najwyżej R${coreLevelMax(br)} — komora rdzenia).`);
    syncClassPanel();
    return false;
  }
  d.coreLevel = lv;
  classFlash('');
  requestBuild();
  return true;
}

function setPowerPriority(list) {
  design().powerPriority = [...list];
  requestBuild();
}

/** Gniazdo zaznaczone w edytorze (moduł projektu — kopia lustra edytuje oryginał). */
function selectedMount() {
  const p = S.selected;
  if (!p || p.kind !== 'module' || !HD_MOUNT_MODULES[p.obj.type] || !design()?.modules.includes(p.obj)) return null;
  return p.obj;
}

function syncMountEdit() {
  const o = selectedMount();
  const row = $('mountedit-row'), row2 = $('mountedit-row2'), info = $('mountedit');
  if (!row) return;
  row.style.display = row2.style.display = o ? '' : 'none';
  if (!o) { info.textContent = 'Kliknij gniazdo (narzędzie Przesuń / Moduł), by zmienić typ, rozmiar i broń.'; return; }
  const g = hullDesignMountOf(o);
  const cls = shipClass(S.cls?.levels.bridge || 1);
  const mw = mountPowerMW(g.slot, g.size, g.weapon);
  info.textContent = `Gniazdo ${MOUNT_SLOT_LABELS[g.slot]} ${g.size}${o.mirror === false || Math.abs(o.y) <= 0.5 || !design().mirror ? '' : ' (z kopią lustra)'} · pobór ${fmtMW(mw)} MW`;
  const sl = $('sel-medit-slot'), sz = $('sel-medit-size'), wp = $('sel-medit-weapon');
  sl.innerHTML = '';
  for (const s of o.type === 'mount' ? HD_MOUNT_SLOTS : [g.slot]) sl.add(new Option(`typ: ${MOUNT_SLOT_LABELS[s]}`, s));
  sl.value = g.slot;
  sl.disabled = o.type !== 'mount';
  sz.innerHTML = '';
  for (const s of MOUNT_SIZES) {
    const opt = new Option(`rozmiar: ${s}`, s);
    if (sizeRank(s) > sizeRank(cls.weaponSize)) { opt.disabled = true; opt.text += ` (mostek ${cls.roman}: do ${cls.weaponSize})`; }
    sz.add(opt);
  }
  sz.value = g.size;
  wp.innerHTML = '';
  wp.add(new Option(`broń: typowa (mediana ${MOUNT_SLOT_LABELS[g.slot]} ${g.size}: ${fmtMW(mountPowerMW(g.slot, g.size, undefined))} MW)`, '__typ'));
  wp.add(new Option('broń: brak (gniazdo puste, 0 MW)', ''));
  for (const id of weaponsForMount(g.slot, g.size, { npc: true })) {
    const w = MASTER_WEAPONS[id];
    wp.add(new Option(`${w.name} · ${w.size} · ${fmtMW(weaponPowerMW(id))} MW${w.npcOnly ? ' (tylko NPC)' : ''}`, id));
  }
  wp.value = g.weapon === undefined ? '__typ' : g.weapon;
}

function bindClassPanel() {
  const sb = $('sel-bridge'), sc = $('sel-core');
  sb.add(new Option('mostek: z powierzchni (auto)', '0'));
  for (const c of SHIP_CLASSES) sb.add(new Option(`mostek ${c.roman} · ${c.label}${c.example ? ` (${c.example})` : ''}`, String(c.level)));
  for (const c of CORE_LEVELS) sc.add(new Option(`rdzeń R${c.level} · ${fmtInt(c.mw)} MW`, String(c.level)));
  sb.addEventListener('change', () => setBridgeLevel(Number(sb.value)));
  sc.addEventListener('change', () => setCoreLevel(Number(sc.value)));
  const ms = $('sel-mslot'), mz = $('sel-msize');
  for (const s of HD_MOUNT_SLOTS) ms.add(new Option(`nowe gniazdo: ${MOUNT_SLOT_LABELS[s]}`, s));
  mz.add(new Option('rozmiar: jak klasa', ''));
  for (const s of MOUNT_SIZES) mz.add(new Option(`rozmiar: ${s}`, s));
  const toMountTool = () => { S.tool = 'module'; S.moduleType = 'mount'; $('sel-module').value = 'mount'; syncPanel(); };
  ms.addEventListener('change', () => { S.mountSlot = ms.value; toMountTool(); });
  mz.addEventListener('change', () => { S.mountSize = mz.value || null; toMountTool(); });
  $('sel-medit-slot').addEventListener('change', (e) => {
    const o = selectedMount();
    if (!o || o.type !== 'mount') return;
    o.slot = e.target.value;
    o.r = Math.round(HD_MOUNT_RADIUS_DU[o.slot] * (design().detail || 0.6) * 100) / 100;
    if (o.weapon && MASTER_WEAPONS[o.weapon] && MASTER_WEAPONS[o.weapon].mountType !== o.slot) delete o.weapon;
    requestBuild(); syncMountEdit();
  });
  $('sel-medit-size').addEventListener('change', (e) => {
    const o = selectedMount();
    if (!o) return;
    const w = MASTER_WEAPONS[o.weapon];
    if (w && sizeRank(w.size) > sizeRank(e.target.value)) { classFlash(`Broń ${w.name} (${w.size}) za duża na gniazdo ${e.target.value} — najpierw zmień broń.`); syncMountEdit(); return; }
    o.size = e.target.value;
    requestBuild(); syncMountEdit();
  });
  $('sel-medit-weapon').addEventListener('change', (e) => {
    const o = selectedMount();
    if (!o) return;
    if (e.target.value === '__typ') delete o.weapon;
    else o.weapon = e.target.value;
    requestBuild(); syncMountEdit();
  });
  $('prio').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]');
    if (!b) return;
    // zamiana z sąsiadem na liście widocznej (kategorie bez urządzeń zostają na swoich miejscach w pełnej kolejności)
    const list = [...(design().powerPriority || POWER_PRIORITY_DEFAULT)];
    const vis = classPriorityVisible();
    const vi = vis.indexOf(b.dataset.k), vj = vi + Number(b.dataset.d);
    if (vi < 0 || vj < 0 || vj >= vis.length) return;
    const i = list.indexOf(vis[vi]), j = list.indexOf(vis[vj]);
    [list[i], list[j]] = [list[j], list[i]];
    setPowerPriority(list);
  });
}

/** Kategorie kolejki mocy obecne na okręcie (tarcza zawsze) w kolejności priorytetu projektu. */
function classPriorityVisible() {
  const order = design()?.powerPriority || POWER_PRIORITY_DEFAULT;
  const devs = S.cls?.power.devices || [];
  return order.filter((k) => k === 'shield' || devs.some((x) => x.cat === k));
}

function syncClassPanel() {
  const d = design();
  const sb = $('sel-bridge'), sc = $('sel-core');
  if (!d || !sb || !sb.options.length) return;
  sb.value = String(d.bridgeLevel || 0);
  const br = S.cls?.levels.bridge || d.bridgeLevel || 1;
  for (const o of sc.options) o.disabled = Number(o.value) > coreLevelMax(br);
  sc.value = String(S.cls?.levels.core || d.coreLevel || br);
  $('sel-mslot').value = S.mountSlot;
  $('sel-msize').value = S.mountSize || '';
  const el = $('classmsg');
  if (el) el.textContent = S.classMsg || '';
  syncMountEdit();
}

/** Panel klasy po budowie: powierzchnia i gniazda wobec limitu, bilans mocy, kolejka priorytetów. */
function updateClassPanel() {
  const c = S.cls;
  const el = $('classinfo');
  if (!el || !c) return;
  const cls = c.check.cls, p = c.power;
  const bar = (v, max) => {
    const k = max > 0 ? v / max : 0;
    return `<span class="bar"><i class="${k > 1 ? 'bad' : (k > 0.9 ? 'warn' : '')}" style="width:${Math.min(100, k * 100).toFixed(0)}%"></i></span>`;
  };
  const by = c.check.counts.bySlot;
  const lines = [
    `<b>Mostek ${cls.roman} · ${cls.label}</b>${c.levels.auto ? ' (z powierzchni)' : ''}${cls.example ? ` — wzór: ${cls.example}` : ''}`,
    `pow.    ${bar(c.area, cls.areaMax)} ${fmtInt(c.area)} / ${fmtInt(cls.areaMax)} j²`,
    `gniazda ${bar(c.check.counts.mounts, cls.mountsMax)} ${c.check.counts.mounts} / ${cls.mountsMax}`,
    `ciężkie ${bar(c.check.counts.heavy, cls.heavyMax)} ${c.check.counts.heavy} / ${cls.heavyMax}`,
    `broń do ${cls.weaponSize} · ${Object.entries(by).map(([k, n]) => `${MOUNT_SLOT_LABELS[k]} ${n}`).join(' · ') || 'bez gniazd'}`,
    `<b>Rdzeń R${c.levels.core} · ${fmtInt(p.capacity)} MW</b>${c.levels.autoCore ? ' (jak mostek)' : ''}`,
    `utrzymanie ${fmtMW(p.upkeep)} + tarcza ${fmtMW(p.shield)} + broń ${fmtMW(p.demand - p.shield)}`,
    `pobór   ${bar(p.upkeep + p.demand, p.capacity)} ${fmtMW(p.upkeep + p.demand)} / ${fmtInt(p.capacity)} MW`,
    p.upkeepOver
      ? '<span class="bad">utrzymanie kadłuba ponad moc rdzenia — okręt bez zasilania</span>'
      : `zapas ${fmtMW(p.spare)} MW (${(p.spareFrac * 100).toFixed(0)}%) → napęd <span class="${p.drive < 0.85 ? 'warn' : 'good'}">×${p.drive.toFixed(2)}</span>`,
    c.deadMounts || p.deficit > 0
      ? `<span class="bad">niedobór ${fmtMW(p.deficit)} MW: bez prądu ${c.deadMounts} gniazd${p.devices.some((x) => x.cat === 'shield' && !x.on) ? ' i tarcza' : ''}</span>`
      : '<span class="good">✓ wszystkie urządzenia z prądem</span>'
  ];
  for (const i of c.check.issues) lines.push(`<span class="bad">⚠ ${i.text}</span>`);
  el.innerHTML = lines.join('\n');
  // kolejka priorytetów: kategorie obecne na okręcie (tarcza zawsze), pobór, ile zgaszonych, ▲ ▼ (między widocznymi)
  const vis = classPriorityVisible();
  $('prio').innerHTML = vis.map((k, i) => {
    const ds = p.devices.filter((x) => x.cat === k);
    const off = ds.filter((x) => !x.on && x.mw > 0).length;
    const mw = ds.reduce((a, x) => a + x.mw, 0);
    return `<span>${i + 1}. ${POWER_CATEGORY_LABELS[k]}${k === 'shield' ? '' : ` ×${ds.length}`} · ${fmtMW(mw)} MW${off ? ` <span class="off">· ${off} bez prądu</span>` : ''}</span>`
      + `<button data-k="${k}" data-d="-1" ${i ? '' : 'disabled'}>▲</button><button data-k="${k}" data-d="1" ${i < vis.length - 1 ? '' : 'disabled'}>▼</button>`;
  }).join('');
  syncClassPanel();
}

window.__kreator = {
  ready: false, S,
  /** Klasa okrętu (etap 2) — haki zrzutów: poziomy, priorytet, gniazdo testowe, stan panelu. */
  klasa: {
    setBridge: (lv) => setBridgeLevel(lv),
    setCore: (lv) => setCoreLevel(lv),
    setPriority: (list) => { setPowerPriority(list); return true; },
    /** Gniazdo w (x, y) narzędziem Moduł (z limitami): true — postawione. */
    addMount(x, y, slot = 'main', size = null) {
      const d = design();
      const o = { type: 'mount', x, y, rot: 0 };
      S.mountSlot = slot; S.mountSize = size;
      if (!classMountPlace(o)) return false;
      d.modules.push(o);
      requestBuild();
      return true;
    },
    select(i) { const o = design().modules[i]; S.selected = o ? { kind: 'module', obj: o, mirrored: false } : null; syncMountEdit(); return !!o; },
    state() {
      const c = S.cls;
      if (!c) return null;
      return {
        levels: c.levels, area: Math.round(c.area), mounts: c.check.counts.mounts, heavy: c.check.counts.heavy, issues: c.check.issues.map((i) => i.code),
        capacity: c.power.capacity, used: Math.round((c.power.upkeep + c.power.demand) * 10) / 10, spare: Math.round(c.power.spareFrac * 1000) / 10,
        drive: Math.round(c.power.drive * 100) / 100, deadMounts: c.deadMounts, deadRuns: (S.field?.pipeNet?.runs || []).filter((r) => r.dead).length,
        msg: S.classMsg
      };
    }
  },
  get design() { return S.design; },
  get ship() { return ship.entity; },
  get ref() { return refShip; },
  act(k) { ACTIONS[k]?.(); syncPanel(); return true; },
  async preset(k) { await loadPreset(k); return true; },
  setView(v) { S.view = v; syncPanel(); return true; },
  setZoom(z) { setZoom(z); return true; },
  setAb(on, focus = 'design') { S.ab = !!on; S.abFocus = focus; const f = focusPoint(); S.cam.x = f.x; S.cam.y = f.y; updateAbTag(); syncPanel(); return true; },
  setCamera(x, y, zoom) { S.cam.x = x; S.cam.y = y; S.cam.zoom = zoom; return true; },
  setStyle(s) { S.design.style = s; requestBuild(); return true; },
  edit(fn) { fn(S.design); requestBuild(); return true; },
  fit() { fit(); return true; },
  /** Kamera na projekt i sprite (A/B) jednocześnie — jeden nad drugim. */
  fitAb() {
    const im = S.field?.image;
    if (!im || !refShip) return false;
    const rh = refShip.beamHull ? refShip.beamHull.srcHeight * refShip.beamHull.scale : 400;
    const rw = refShip.beamHull ? refShip.beamHull.srcWidth * refShip.beamHull.scale : 1000;
    const top = im.minY, bottom = refShip.y + rh * 0.5;
    S.cam.zoom = Math.min(W * 0.86 / Math.max(im.w, rw), H * 0.9 / (bottom - top));
    S.cam.x = Math.min(im.minX, refShip.x - rw * 0.5) * 0.5 + Math.max(im.maxX, refShip.x + rw * 0.5) * 0.5;
    S.cam.y = (top + bottom) * 0.5;
    S.ab = true; S.abFocus = 'design';
    updateAbTag();
    return true;
  },
  setUnderlay(on) { S.underlay = !!on; syncPanel(); return true; },
  setNetGraph(on) { S.netGraph = !!on; syncPanel(); return true; },
  toScreen(x, y) { return { x: (x - S.cam.x) * S.cam.zoom + W * 0.5, y: (y - S.cam.y) * S.cam.zoom + H * 0.5 }; },
  async built() { await waitBuilt(); return true; },
  async runFrames(n = 1, fps = 60) {
    for (let i = 0; i < n; i++) {
      frame(1 / fps);
      if ((i % 4) === 3) await new Promise((ok) => requestAnimationFrame(() => ok()));
    }
    return true;
  },
  stats() {
    return {
      preset: S.presetKey, style: S.design?.style, view: S.view, zoom: S.cam.zoom, ab: S.ab ? S.abFocus : null, ref: S.refKey,
      image: S.bake ? [S.bake.width, S.bake.height] : null, nodes: ship.entity?.beamHull?.body?.activeNodes ?? 0,
      timing: S.timing, parts: S.recipe?.parts, warnings: S.recipe?.warnings?.map((w) => w.text),
      surfaceReady: ship.surfaceImg ? HullSurface.isReady(ship.surfaceImg) : false,
      net: S.netCheck ? { freeEnds: S.netCheck.freeEnds, outside: S.netCheck.outside, unpowered: S.netCheck.unpowered.length, unfueled: S.netCheck.unfueled.length, ms: Math.round(S.field?.pipeNet?.stats?.ms || 0) } : null,
      syncPipes: S.syncPipes, syncNames: S.syncNames.slice(), klasa: this.klasa.state()
    };
  }
};

(async () => {
  try {
    if (!(await Core3D.ready)) {
      $('nogpu').style.display = 'flex';
      $('nogpu-detail').textContent = Core3D.gpuError || 'brak adaptera WebGPU';
      $('loading').style.display = 'none';
      window.__kreator.error = 'webgpu';
      return;
    }
    const T0 = performance.now(), startup = window.__kreator.startup = { gpu: Math.round(T0) };
    const mark = (k) => { startup[k] = Math.round(performance.now() - T0); };
    resizeHexShips3D(W, H);
    HullLighting.setModel?.('pbr');
    await Core3D.warmup.run('kadłuby, mapa ran, broń (hexShips3D)', () => prewarmHexShips3D({ canvas: glCanvas }));
    mark('kadluby');
    backdrop = createBackdrop(Core3D);
    composer = new HullComposer(Core3D.renderer);
    window.__composer = composer;
    await composer.prewarm();
    mark('kompozytor');
    bindPanel();
    bindInput();
    bindBlockPanel();
    bindClassPanel();
    await loadPreset(HD_PRESETS[S.presetKey] ? S.presetKey : 'citadella');
    mark('projekt');
    await Core3D.warmup.flush?.({ timeoutMs: 6000 });
    mark('flush');
    // kilka klatek, by mapa powierzchni i lakier weszły; potem licznik pipeline'ów w klatkach
    for (let k = 0; k < 6; k++) frame(1 / 60);
    await HullSurface.whenIdle(4000);
    hookPipelines();
    mark('gotowe');
    $('loading').style.display = 'none';
    syncPanel();
    window.__kreator.ready = true;
    requestAnimationFrame(loop);
  } catch (err) {
    reportError(err.stack || String(err));
    window.__kreator.error = String(err);
  }
})();
