// Demo KREATORA KADŁUBA na WebGPU: projekt z bloków (4 × 4 komórki belek), wielokątów, kół / wycięć, gotowych części,
// modułów, rowków i naklejek (src/game/hullDesign/) → kompozytor TSL (src/3d/hullDesign/hullComposer.js) liczy pakiet
// jak sprite: alfa, albedo, mapa powierzchni (format HullSurface: normalne, AO, relief z prawdziwej wysokości),
// emisja → kadłub z gry: HullBodies.createHull (alfa → belki) i skóra hexShips3D z oświetleniem kadłubów v2 na
// Core3D. Obok (A/B) dzisiejszy kadłub ze sprite'a — dla floty Terra Novy ten sam okręt (podkład U: sprite pod
// projektem do odrysowania). NIC nie jest wpięte do gry.
//
// Serwowanie: `npm run dev` → /dema/kreator-kadluba-webgpu.html
//   ?preset=citadella|custos|hasta|bellator|colossus|tnparts|tnparts2|orbis|atlas2|destroyer|pirate|empty
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
import { buildHullField, hullCells, hullFieldScale, polyShapeLoop, rasterHullAlpha, loopDistance } from '../src/game/hullDesign/hullDesignGeometry.js';
import { hullDesignMounts, hullDesignRecipe } from '../src/game/hullDesign/hullDesignRecipe.js';
import { RESOURCES } from '../src/data/resources.js';
import { getHullRenderSize } from '../src/data/ships.js';
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
  custos: 'frigate', hasta: 'destroyer', bellator: 'battleship', citadella: 'terran_carrier', colossus: 'terran_supercapital', tnparts: 'battleship', tnparts2: 'battleship',
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
  syncPipes: 0, syncNames: [], frame: 0
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
    const t1 = performance.now();
    const recipe = hullDesignRecipe(field);
    const mounts = hullDesignMounts(field);
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
    if (p) { removePicked(p); requestBuild(); return; }
    S.drag = { kind: 'erase' };
    const [bx, by] = blockAt(w.x, w.y);
    setBlock(bx, by, -1);
    requestBuild(true);
    return;
  }
  if (e.button !== 0) return;
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
    if (p) { S.drag = { kind: 'move', p, wx: w.x, wy: w.y }; S.selected = p; return; }
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
    if (dr.kind === 'stripeEnd' && Math.hypot(dr.obj.x1 - dr.obj.x0, dr.obj.y1 - dr.obj.y0) < 4) design().decals.splice(design().decals.indexOf(dr.obj), 1);
    requestBuild(false);
  }
}

function onWheel(e) {
  e.preventDefault();
  const w = worldOf(e.clientX, e.clientY);
  if (S.tool === 'move') {
    const p = pick(w.x, w.y);
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
  if (!document.body.classList.contains('clean')) drawEditor(cam);
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
      if (s.module) continue;
      ctx2d.strokeStyle = s.op === 'cut' ? '#ff5a52aa' : LEVEL_COLORS[s.level] + 'aa';
      ctx2d.setLineDash(s.op === 'cut' ? [4, 4] : []);
      ctx2d.beginPath();
      if (s.kind === 'circle') { const [sx, sy] = toS(s.x, s.y); ctx2d.arc(sx, sy, s.r * cam.zoom, 0, Math.PI * 2); }
      else if (s.kind === 'poly') s.pts.forEach(([x, y], i) => { const [sx, sy] = toS(x, y); if (i) ctx2d.lineTo(sx, sy); else ctx2d.moveTo(sx, sy); });
      else rectPath(toS, s.x, s.y, s.w, s.h, s.rot || 0);
      ctx2d.stroke();
      ctx2d.setLineDash([]);
    }
    // moduły
    ctx2d.font = '10px ui-monospace, Consolas, monospace';
    for (const m of S.field.expanded.modules) {
      const def = HD_MODULES[m.type];
      ctx2d.strokeStyle = '#7be0a0cc';
      ctx2d.beginPath();
      if (def.r) { const [sx, sy] = toS(m.x, m.y); ctx2d.arc(sx, sy, (m.r || def.r) * cam.zoom, 0, Math.PI * 2); }
      else rectPath(toS, m.x, m.y, m.w, m.h, m.rot || 0);
      ctx2d.stroke();
      if (cam.zoom > 0.3) { const [sx, sy] = toS(m.x, m.y); ctx2d.fillStyle = '#7be0a0'; ctx2d.fillText(def.label, sx + 4, sy - 4); }
    }
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
      const shapeName = { circle: 'koło', rect: 'prostokąt', poly: 'wielokąt' };
      const name = p.kind === 'castle' ? `kasztel ${Math.round(p.obj.w * 2)} × ${Math.round(p.obj.h * 2)} j. · ${p.obj.tiers} piętra${p.obj.clip !== undefined ? ' · na płytach' : ''}` : p.kind === 'pipe' ? `rura (${p.obj.pts.length} pkt, ${p.obj.n} w wiązce, ×${(p.obj.r || 1).toFixed(2)})` : p.kind === 'groove' ? `rowek (${p.obj.pts.length} pkt, ${p.obj.w.toFixed(1)} jd)` : p.kind === 'module' ? HD_MODULES[p.obj.type].label : (p.kind === 'part' ? `część: ${HD_PARTS[p.obj.id].label} (×${p.obj.s.toFixed(2)})` : (p.kind === 'shape' ? `${shapeName[p.obj.kind]} ${p.obj.op === 'cut' ? '(wycięcie)' : ''} · ${HD_LEVEL_NAMES[p.obj.level]}` : `naklejka: ${p.obj.kind}`));
      ctx2d.fillText(`${name}  — PPM usuwa`, m.x + 14, m.y - 10);
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
  if (pn) lines.push(`sieć rur: ${pn.runs} biegów · ${pn.fits} osprzętu · ${pn.routes || 0} tras · ${(pn.ms || 0).toFixed(0)} ms`);
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
  $('zoom-022').classList.toggle('on', Math.abs(S.cam.zoom - 0.22) < 1e-3);
  $('zoom-05').classList.toggle('on', Math.abs(S.cam.zoom - 0.5) < 1e-3);
  $('zoom-1').classList.toggle('on', Math.abs(S.cam.zoom - 1) < 1e-3);
  $('sel-ref').value = S.refKey || '';
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
  a: () => toggleAb()
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
  $('btn-clean').addEventListener('click', () => ACTIONS.h());
  $('btn-json').addEventListener('click', () => {
    const ta = $('json');
    if (ta.style.display !== 'block') { ta.style.display = 'block'; ta.value = JSON.stringify(design(), null, 1); return; }
    try { S.design = normalizeHullDesign(JSON.parse(ta.value)); requestBuild(); ta.style.display = 'none'; } catch (err) { reportError(`JSON: ${err.message}`); }
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

// API konsoli / harnessu.
window.__kreator = {
  ready: false, S,
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
      syncPipes: S.syncPipes, syncNames: S.syncNames.slice()
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
