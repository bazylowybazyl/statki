import test from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from 'three';
import { DestructorSystem as D, disposeHexBody } from '../src/game/destructor.js';
import {
  BRIDGE_KILL_TIMELINE,
  BRIDGE_LAYOUT_PROPOSALS,
  attachShipBridges,
  bridgeGridToWorld,
  evaluateShipBridges,
  hexCellCenter
} from '../src/game/shipBridge.js';
import {
  BRIDGE3D_EMIT,
  BRIDGE3D_KINDS,
  BRIDGE3D_KIND_ORDER,
  HEX_NEIGHBOR_AXIAL,
  HEX_NEIGHBOR_DIRS,
  buildBridgeModel,
  hexCellCenterXY,
  hexCellOf,
  hexNeighborCell,
  resolveBridgeModelKind,
  sampleHeightField
} from '../src/3d/bridge3DShapes.js';
import {
  BRIDGE3D_DAMAGE_LIMITS,
  BRIDGE3D_KIND_STYLE,
  BRIDGE3D_TUNE,
  Bridge3D,
  bridgeCellBlock,
  bridgeEmitterLight,
  bridgeInstanceBasis,
  bridgeModelGridMap,
  bridgeModelToGrid,
  createBridgeRecordCore,
  refreshBridgeRecordDamage
} from '../src/3d/bridge3D.js';
import { BridgeFx3D } from '../src/3d/bridgeFx3D.js';
import { makeDestructorHull as hull } from './helpers/destructorHull.mjs';

const MODELS = Object.fromEntries(BRIDGE3D_KIND_ORDER.map((k) => [k, buildBridgeModel(k)]));

// Kolce piratów mogą wystawać poza strefę (jak na sprite'ach), ale nie dalej niż tyle.
const SPIKE_SLACK = { ironskull: 12, pirate_frigate: 5, pirate_destroyer: 9 };

// Strefa rodzaju z BRIDGE_LAYOUT_PROPOSALS (domyślny wariant kadłuba).
function kindZone(name) {
  const k = BRIDGE3D_KINDS[name];
  const entry = BRIDGE_LAYOUT_PROPOSALS[k.hull];
  return entry.variants[entry.defaultVariant].find((z) => z.id === k.zoneId);
}

// Zasób rodzaju jak w Bridge3D.attach (bez three): model + emitery zapalone.
function kindRes(name) {
  const model = MODELS[name];
  const list = model.emitters.filter((e) => e.lit);
  const n = list.length;
  const E = {
    count: n,
    type: Uint8Array.from(list.map((e) => e.type)),
    colorKey: list.map((e) => e.color),
    cx: Float32Array.from(list.map((e) => e.c[0])),
    cy: Float32Array.from(list.map((e) => e.c[1])),
    cz: Float32Array.from(list.map((e) => e.c[2])),
    level: Float32Array.from(list.map((e) => e.level ?? 1)),
    seed: Float32Array.from(list.map((e) => e.seed ?? 0)),
    period: Float32Array.from(list.map((e) => e.period ?? 1.5)),
    phase: Float32Array.from(list.map((e) => e.phase ?? 0))
  };
  return { name, index: BRIDGE3D_KINDS[name].index, model, emit: E };
}

// Kadłub-prostokąt 320×100 (alfa pełna), skala PNG → render = 1. Strefa
// w rufowej połowie; model Bellatora dopasowuje się do niej skalą XY.
const ZONE = { id: 'mostek', x: -80, y: 0, w: 110, h: 44, armorMul: 1.5, killFrac: 0.35 };

function hullWithBridge(state = {}) {
  const e = hull({ width: 320, height: 100, ...state });
  attachShipBridges(e, [ZONE], { scaleX: 1, scaleY: 1, hullKey: 'battleship' });
  return e;
}

function withWindow(run) {
  const oldDocument = globalThis.document;
  const oldWindow = globalThis.window;
  const oldQueue = D.splitQueue;
  const oldPool = D._wreckPool;
  const entities = [];
  try {
    globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage() {} }) }) };
    globalThis.window = { wrecks: [] };
    D.splitQueue = [];
    D._wreckPool = [];
    run(entities);
  } finally {
    for (const e of new Set([...entities, ...globalThis.window.wrecks])) disposeHexBody(e);
    D.splitQueue = oldQueue;
    D._wreckPool = oldPool;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
  }
}

test('each bridge model builds finite, bounded, low-poly geometry with modules', () => {
  for (const name of BRIDGE3D_KIND_ORDER) {
    const m = MODELS[name];
    const spec = BRIDGE3D_KINDS[name];
    assert.ok(m.triangleCount > 200 && m.triangleCount < 3200, `${name}: ${m.triangleCount} trójkątów`);
    for (const v of m.positions) assert.ok(Number.isFinite(v));
    for (let i = 0; i < m.normals.length; i += 3) {
      assert.ok(Math.abs(Math.hypot(m.normals[i], m.normals[i + 1], m.normals[i + 2]) - 1) < 1e-3);
    }
    // Wysokość umiarkowana względem strefy: bryła wystaje, ale nie wieżowiec
    // (Bellator: 31 j. na 50 j. szerokości strefy, maszt najwyżej).
    const small = Math.min(spec.w, spec.h);
    assert.ok(m.bounds.zMax >= 0.15 * small && m.bounds.zMax <= small + 12, `${name}: zMax ${m.bounds.zMax} przy strefie ${spec.w.toFixed(1)}×${spec.h.toFixed(1)}`);
    // Obrys w strefie; kolce piratów mogą wystawać (SPIKE_SLACK).
    const slack = SPIKE_SLACK[name] ?? 0.01;
    assert.ok(m.bounds.x0 >= -spec.w / 2 - slack && m.bounds.x1 <= spec.w / 2 + slack, `${name}: X ${m.bounds.x0}..${m.bounds.x1}`);
    assert.ok(m.bounds.y0 >= -spec.h / 2 - slack && m.bounds.y1 <= spec.h / 2 + slack, `${name}: Y ${m.bounds.y0}..${m.bounds.y1}`);
    // Moduły pokrywają wszystkie wierzchołki, bez nakładek; numer modułu per wierzchołek.
    let covered = 0;
    for (const mod of m.modules) {
      for (let v = mod.vertexStart; v < mod.vertexStart + mod.vertexCount; v++) assert.equal(m.module[v], mod.id);
      covered += mod.vertexCount;
    }
    assert.equal(covered, m.vertexCount);
    assert.ok(m.modules.length >= 4 && m.modules.length <= 48, `${name}: ${m.modules.length} modułów (maska instancji ≤ 48)`);
  }
});

test('triangle winding agrees with the stored normals (front faces point outward)', () => {
  for (const name of BRIDGE3D_KIND_ORDER) {
    const { positions: P, normals: N, index: I } = MODELS[name];
    let bad = 0;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3; const b = I[t + 1] * 3; const c = I[t + 2] * 3;
      const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
      const e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
      const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const n = [N[a] + N[b] + N[c], N[a + 1] + N[b + 1] + N[c + 1], N[a + 2] + N[b + 2] + N[c + 2]];
      if (g[0] * n[0] + g[1] * n[1] + g[2] * n[2] < 0) bad++;
    }
    assert.equal(bad, 0, `${name}: ${bad} trójkątów odwróconych`);
  }
});

test('windows sit on slanted faces visible from the top camera, on the model surface', () => {
  for (const name of BRIDGE3D_KIND_ORDER) {
    const m = MODELS[name];
    const windows = m.emitters.filter((e) => e.type === BRIDGE3D_EMIT.WINDOW);
    assert.ok(windows.length >= 12, `${name}: ${windows.length} okien`);
    assert.ok(m.emitters.some((e) => e.type === BRIDGE3D_EMIT.BEACON), `${name}: brak lampy`);
    for (const e of m.emitters) {
      // Kamera patrzy z góry: szyba musi mieć normalną w górę (pionowe ściany są niewidoczne).
      if (e.type === BRIDGE3D_EMIT.WINDOW) assert.ok(e.n[2] > 0.5, `${name}: okno z n.z ${e.n[2].toFixed(2)}`);
      // t × b = n (kwad FG ma przód tam, gdzie ściana).
      const c = [e.t[1] * e.b[2] - e.t[2] * e.b[1], e.t[2] * e.b[0] - e.t[0] * e.b[2], e.t[0] * e.b[1] - e.t[1] * e.b[0]];
      assert.ok(c[0] * e.n[0] + c[1] * e.n[1] + c[2] * e.n[2] > 0.99);
      // Nic go nie zasłania z góry (emitery zasłonięte są odrzucane przy budowie).
      assert.ok(sampleHeightField(m.heightField, e.c[0], e.c[1]) <= e.c[2] + 0.45);
    }
  }
});

test('model kind follows the hull key and the Atlas zone shape', () => {
  assert.equal(resolveBridgeModelKind('battleship', { w: 236, h: 92 }), 'bellator');
  assert.equal(resolveBridgeModelKind('pirate_battleship', { w: 176, h: 104 }), 'ironskull');
  assert.equal(resolveBridgeModelKind('atlas', { role: 'primary', w: 520, h: 80 }), 'atlas_main');
  assert.equal(resolveBridgeModelKind('atlas', { role: 'backup', w: 244, h: 66 }), 'atlas_backup');
  assert.equal(resolveBridgeModelKind('atlas', { role: 'primary', w: 244, h: 66 }), 'atlas_backup'); // wariant „dziobowy”
  // Pozostała flota: jeden model na kadłub (strefa z edytora — dopasowanie skalą).
  const fleet = { frigate: 'custos', destroyer: 'hasta', terran_carrier: 'citadella', terran_supercapital: 'colossus', pirate_frigate: 'pirate_frigate', pirate_destroyer: 'pirate_destroyer', megafreighter: 'megafreighter' };
  for (const [hull, kind] of Object.entries(fleet)) assert.equal(resolveBridgeModelKind(hull, { w: 100, h: 40 }), kind, hull);
  assert.equal(resolveBridgeModelKind('long_haul_freighter', { w: 100, h: 40 }), null);
});

test('hex rounding matches the destructor lattice (nearest cell centre) and neighbour directions', () => {
  const R = 5;
  let seed = 1;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const cell = { c: 0, r: 0 };
  const p = { x: 0, y: 0 };
  for (let i = 0; i < 5000; i++) {
    const x = rnd() * 800 - 50;
    const y = rnd() * 400 - 50;
    hexCellOf(x, y, R, cell);
    let best = null;
    let bd = Infinity;
    for (let c = Math.round(x / (1.5 * R)) - 2; c <= Math.round(x / (1.5 * R)) + 2; c++) {
      for (let r = Math.round(y / (Math.sqrt(3) * R)) - 2; r <= Math.round(y / (Math.sqrt(3) * R)) + 2; r++) {
        const q = hexCellCenter(c, r, R);
        const d = Math.hypot(q.x - x, q.y - y);
        if (d < bd) { bd = d; best = [c, r]; }
      }
    }
    assert.deepEqual([cell.c, cell.r], best);
  }
  // Sąsiedzi: środek w odległości √3·R, w kierunku HEX_NEIGHBOR_DIRS.
  for (const [c, r] of [[4, 4], [5, 4], [0, 0], [7, 2]]) {
    const o = hexCellCenterXY(c, r, R, {});
    for (let d = 0; d < 6; d++) {
      const n = hexNeighborCell(c, r, d, {});
      hexCellCenterXY(n.c, n.r, R, p);
      const dx = p.x - o.x;
      const dy = p.y - o.y;
      assert.ok(Math.abs(Math.hypot(dx, dy) - Math.sqrt(3) * R) < 1e-9);
      assert.ok(Math.abs(dx / Math.hypot(dx, dy) - HEX_NEIGHBOR_DIRS[d][0]) < 1e-9);
      assert.ok(Math.abs(dy / Math.hypot(dx, dy) - HEX_NEIGHBOR_DIRS[d][1]) < 1e-9);
    }
  }
  assert.equal(HEX_NEIGHBOR_AXIAL.length, 6);
});

test('the neighbour mask directions agree with the destructor neighbour lists', () => {
  const e = hull({ width: 320, height: 100 });
  try {
    const grid = e.hexGrid;
    let checked = 0;
    for (const s of grid.shards) {
      if (!s.neighbors || s.neighbors.length < 6) continue;
      const mine = new Set();
      for (let d = 0; d < 6; d++) { const n = hexNeighborCell(s.c, s.r, d, {}); mine.add(`${n.c},${n.r}`); }
      for (const n of s.neighbors) assert.ok(mine.has(`${n.c},${n.r}`), `sąsiad (${n.c},${n.r}) heksa (${s.c},${s.r})`);
      if (++checked > 200) break;
    }
    assert.ok(checked > 50);
  } finally {
    disposeHexBody(e);
  }
});

test('record block covers every hex under the model and maps model space onto the zone', () => {
  const e = hullWithBridge();
  try {
    const st = e.bridgeState;
    const rec = createBridgeRecordCore(e, st, 0, kindRes('bellator'), 0);
    // Środek strefy w siatce = środek strefy w PNG (skala 1).
    const g = bridgeModelToGrid(rec.map, 0, 0);
    assert.ok(Math.abs(g.x - (160 + ZONE.x)) < 1e-9 && Math.abs(g.y - 50) < 1e-9);
    // Narożnik modelu (M: +x, +y↑) → prawy GÓRNY róg strefy w PNG (Y w dół).
    const k = MODELS.bellator.design;
    const c = bridgeModelToGrid(rec.map, k.w / 2, k.h / 2);
    assert.ok(Math.abs(c.x - (160 + ZONE.x + ZONE.w / 2)) < 1e-6 && Math.abs(c.y - (50 - ZONE.h / 2)) < 1e-6);
    // Każdy heks mostka ma komórkę w bloku; wszystkie istnieją.
    for (const s of st.bridges[0].shards) {
      const i = s.c - rec.c0;
      const j = s.r - rec.r0;
      assert.ok(i >= 0 && j >= 0 && i < rec.blockW && j < rec.blockH);
      assert.equal(rec.cellShard[i + j * rec.blockW], s);
      assert.equal(rec.existed[i + j * rec.blockW], 1);
    }
    // Emitery trafiają na heksy siatki.
    assert.ok(rec.emShard.filter(Boolean).length >= rec.emShard.length * 0.9);
  } finally {
    disposeHexBody(e);
  }
});

test('damage row: dead hexes open a hole, live neighbours get the edge mask and a fresh-cut glow', () => {
  const e = hullWithBridge();
  try {
    const st = e.bridgeState;
    const rec = createBridgeRecordCore(e, st, 0, kindRes('bellator'), 1);
    const W = 768;
    const data = new Uint8Array(W * 4 * 4);
    refreshBridgeRecordDamage(rec, e.hexGrid, data, 10, W);
    const base = 1 * W * 4;
    for (let k = 0; k < rec.cellCount; k++) {
      if (!rec.existed[k]) continue;
      assert.ok(data[base + k * 4] >= 64, 'żywa komórka ma R ≥ 64');
      assert.equal(data[base + k * 4 + 2], 0, 'bez martwych sąsiadów');
    }
    assert.equal(rec.anyDead, 0);
    // Zabijamy heks w środku strefy.
    const victim = st.bridges[0].shards[Math.floor(st.bridges[0].shards.length / 2)];
    D.destroyShard(e, victim);
    const changed = refreshBridgeRecordDamage(rec, e.hexGrid, data, 10.5, W);
    assert.ok(changed);
    assert.equal(rec.anyDead, 1);
    const vk = (victim.c - rec.c0) + (victim.r - rec.r0) * rec.blockW;
    assert.equal(data[base + vk * 4], 0, 'martwa komórka = wyrwa');
    // Sąsiad w kierunku d ma bit (d + 3) % 6 (martwy sąsiad po przeciwnej stronie) i żar cięcia.
    for (let d = 0; d < 6; d++) {
      const n = hexNeighborCell(victim.c, victim.r, d, {});
      const nk = (n.c - rec.c0) + (n.r - rec.r0) * rec.blockW;
      if (!rec.existed[nk]) continue;
      const mask = data[base + nk * 4 + 2];
      assert.ok(mask & (1 << ((d + 3) % 6)), `sąsiad w kierunku ${d}: maska ${mask.toString(2)}`);
      assert.ok(data[base + nk * 4 + 3] > 200, 'świeże cięcie świeci');
    }
    // Żar cięcia gaśnie z czasem jak żar heksa (heatDecay).
    refreshBridgeRecordDamage(rec, e.hexGrid, data, 30, W);
    const n0 = hexNeighborCell(victim.c, victim.r, 0, {});
    const k0 = (n0.c - rec.c0) + (n0.r - rec.r0) * rec.blockW;
    assert.ok(data[base + k0 * 4 + 3] < 10);
  } finally {
    disposeHexBody(e);
  }
});

test('instance basis maps model points exactly where bridgeGridToWorld puts them (rotated, scaled, wreck pivot)', () => {
  const e = hullWithBridge({ x: 1200, y: -340, angle: 0.73 });
  try {
    e.visual = { spriteScale: 1.3, spriteScaleX: 1.3, spriteScaleY: 1.3 };
    const map = bridgeModelGridMap(ZONE, 1, 1, e.hexGrid.srcWidth, e.hexGrid.srcHeight, MODELS.bellator.design);
    for (const pose of [null, { x: 1190, y: -331, angle: 0.71 }]) {
      const B = bridgeInstanceBasis(map, e, pose, {});
      for (const [x, y] of [[0, 0], [30, -10], [-50, 20], [60, 24]]) {
        const g = bridgeModelToGrid(map, x, y);
        const w = bridgeGridToWorld(e, g.x, g.y, { x: 0, y: 0 }, pose);
        const sx = B.ox + B.ax * x + B.bx * y;
        const sy = B.oy + B.ay * x + B.by * y;
        assert.ok(Math.abs(sx - w.x) < 1e-6 && Math.abs(sy + w.y) < 1e-6, `(${x}, ${y})`);
      }
      // Bez odbicia: kolejność ścian zachowana (FrontSide działa).
      assert.ok(B.ax * B.by - B.ay * B.bx > 0);
      assert.ok(Math.abs(B.sz - 1.3) < 1e-9);
    }
  } finally {
    disposeHexBody(e);
  }
});

test('when the hulk becomes a wreck the record finds the wreck by its shards and keeps its holes', () => {
  withWindow((entities) => {
    const e = hullWithBridge();
    entities.push(e);
    const st = e.bridgeState;
    const rec = createBridgeRecordCore(e, st, 0, kindRes('bellator'), 0);
    // Wyrwa w mostku przed utratą dowodzenia.
    const victim = st.bridges[0].shards[3];
    D.destroyShard(e, victim);
    // finishBridgeKill: wrak z żywych heksów, potem ciało hulka oddane.
    const surviving = e.hexGrid.shards.filter((s) => s.active && !s.isDebris && s.hp > 0);
    const wreck = D.spawnWreckEntity(e, surviving, entities);
    assert.ok(wreck && wreck.isWreck);
    const found = Bridge3D._findHost(rec, [wreck], null);
    assert.equal(found, wreck);
    const data = new Uint8Array(768 * 4);
    refreshBridgeRecordDamage(rec, wreck.hexGrid, data, 1, 768);
    const vk = (victim.c - rec.c0) + (victim.r - rec.r0) * rec.blockW;
    assert.equal(data[vk * 4], 0, 'wyrwa zostaje na wraku');
    let alive = 0;
    for (let k = 0; k < rec.cellCount; k++) if (rec.existed[k] && data[k * 4] >= 64) alive++;
    assert.ok(alive > rec.cellCount * 0.5, `żywych komórek na wraku: ${alive}`);
    // Transformacja wraku (pivot) zgadza się z bridgeGridToWorld wraku.
    const B = bridgeInstanceBasis(rec.map, wreck, null, {});
    const w = bridgeGridToWorld(wreck, rec.map.zgx, rec.map.zgy, { x: 0, y: 0 });
    assert.ok(Math.abs(B.ox - w.x) < 1e-6 && Math.abs(B.oy + w.y) < 1e-6);
    const w0 = bridgeGridToWorld(e, rec.map.zgx, rec.map.zgy, { x: 0, y: 0 });
    assert.ok(Math.hypot(w.x - w0.x, w.y - w0.y) < 1e-6, 'wrak w tej samej pozie — bez „pyknięcia”');
  });
});

test('hexes moved to a split fragment count as moved, not alive, for the parent', () => {
  withWindow((entities) => {
    const e = hullWithBridge();
    entities.push(e);
    const st = e.bridgeState;
    const rec = createBridgeRecordCore(e, st, 0, kindRes('bellator'), 0);
    // Odcinamy część strefy do fragmentu (jak processSplits).
    const part = st.bridges[0].shards.slice(0, 20);
    const frag = D.spawnWreckEntity(e, part, entities);
    const remain = e.hexGrid.shards.filter((s) => !part.includes(s));
    D.rebuildEntityGrid(e, remain);
    const data = new Uint8Array(768 * 4);
    refreshBridgeRecordDamage(rec, e.hexGrid, data, 1, 768);
    assert.ok(rec.moved >= 20, `przeniesionych: ${rec.moved}`);
    const k = (part[0].c - rec.c0) + (part[0].r - rec.r0) * rec.blockW;
    assert.equal(data[k * 4], 0, 'na kadłubie-matce ta część modelu znika');
    // Fragment ma te heksy — rekord-siostra pokaże tam model.
    const data2 = new Uint8Array(768 * 4);
    refreshBridgeRecordDamage(rec, frag.hexGrid, data2, 1, 768);
    assert.ok(data2[k * 4] >= 64);
  });
});

test('window lights follow the kill timeline: steady, flicker, wave out; backup dies on its own', () => {
  const e = hullWithBridge();
  try {
    const st = e.bridgeState;
    const rec = createBridgeRecordCore(e, st, 0, kindRes('bellator'), 0);
    const E = rec.kind.emit;
    const win = [];
    for (let i = 0; i < E.count; i++) if (E.type[i] === BRIDGE3D_EMIT.WINDOW) win.push(i);
    assert.ok(win.length > 5);
    // Przed utratą: spokojne światło w paśmie 0,64–1 × poziom pomieszczenia.
    for (const i of win) {
      const I = bridgeEmitterLight(rec, i, 12.3, 1);
      assert.ok(I > 0.2 && I <= 1.0001, `okno ${i}: ${I}`);
    }
    // Utrata dowodzenia w t = 20: po końcu fali wszystko zgaszone.
    st.commandLost = true;
    st.commandLostAt = 20;
    st.vent = { x: ZONE.x, y: 0, dirX: 0, dirY: -1 };
    const end = BRIDGE_KILL_TIMELINE.windowFlickerEnd + 400 / BRIDGE_KILL_TIMELINE.windowWaveSpeed + BRIDGE_KILL_TIMELINE.windowFade + 0.1;
    for (let i = 0; i < E.count; i++) {
      rec.emDelayCmd[i] = 0.2;
      assert.equal(bridgeEmitterLight(rec, i, 20 + end + 1, 1), 0);
    }
    // Pierwsze 60 ms: rozbłysk przeciążenia.
    for (const i of win) assert.ok(bridgeEmitterLight(rec, i, 20.03, 1) > 0.3);
    // Wrak bez utraty dowodzenia (np. zabity pulą): gaśnie od zasilania.
    st.commandLost = false;
    rec.powerLostAt = 50;
    for (const i of win) assert.equal(bridgeEmitterLight(rec, i, 55, 1), 0);
  } finally {
    disposeHexBody(e);
  }
});

test('bridgeFx3D skips its window slits for hulls that carry the 3D model (vent stays)', () => {
  const scene = new THREE.Scene();
  const e = hullWithBridge();
  try {
    BridgeFx3D.attach(scene);
    BridgeFx3D.update([e], { nowSec: 1, dt: 0, zoom: 4 });
    const slits = BridgeFx3D.count;
    assert.ok(slits > 0, 'bez modelu: szczeliny okien');
    e.bridgeState.model3D = true;
    BridgeFx3D.update([e], { nowSec: 1, dt: 0, zoom: 4 });
    assert.equal(BridgeFx3D.count, 0, 'z modelem: brak podwójnych okien');
  } finally {
    BridgeFx3D.dispose();
    disposeHexBody(e);
  }
});

test('every model stands on its zone and its cell block fits the damage texture', () => {
  const { width, maxRows } = BRIDGE3D_DAMAGE_LIMITS;
  for (const name of BRIDGE3D_KIND_ORDER) {
    const k = BRIDGE3D_KINDS[name];
    const def = kindZone(name);
    assert.ok(def, `${name}: strefa ${k.hull}/${k.zoneId}`);
    const kx = k.render[0] / k.png[0];
    const ky = k.render[1] / k.png[1];
    const map = bridgeModelGridMap({ ...def, rot: 0 }, kx, ky, k.render[0], k.render[1], MODELS[name].design);
    assert.ok(Math.abs(map.sxZ - 1) < 0.01 && Math.abs(map.syZ - 1) < 0.01, `${name}: model zaprojektowany na strefę`);
    const b = bridgeCellBlock(map, MODELS[name].heightField, 5);
    assert.ok(b.w * b.h <= width * maxRows, `${name}: blok ${b.w}×${b.h} > ${maxRows} wierszy`);
    assert.equal(resolveBridgeModelKind(k.hull, def), name, `${name}: rodzaj po strefie`);
  }
  assert.equal(BRIDGE3D_TUNE.enabled, true);
});

test('every kind has a full palette and style', () => {
  for (const name of BRIDGE3D_KIND_ORDER) {
    const st = BRIDGE3D_KIND_STYLE[name];
    assert.ok(st, `${name}: brak stylu w BRIDGE3D_KIND_STYLE`);
    assert.equal(st.palette.length, 8, `${name}: paleta 8 materiałów`);
    for (const hex of st.palette) assert.match(hex, /^#[0-9a-f]{6}$/i);
    assert.ok(BRIDGE_LAYOUT_PROPOSALS[BRIDGE3D_KINDS[name].hull].windowColor, `${name}: kolor okien`);
  }
});

test('damage rows: big bridges get consecutive rows, uploads split per row, rows are reused', () => {
  const scene = new THREE.Scene();
  assert.ok(Bridge3D.attach(scene));
  try {
    const W = BRIDGE3D_DAMAGE_LIMITS.width;
    const a = Bridge3D._allocRows(1);
    const b = Bridge3D._allocRows(3);
    const c = Bridge3D._allocRows(1);
    assert.deepEqual([a, b, c], [0, 1, 4]);
    // Zwolniony blok 3 wierszy mieści najpierw 2 wiersze, potem 1.
    Bridge3D._freeRows({ row: b, rowCount: 3 });
    assert.equal(Bridge3D._allocRows(2), 1);
    assert.equal(Bridge3D._allocRows(2), 5);
    assert.equal(Bridge3D._allocRows(1), 3);
    assert.equal(Bridge3D.damage.rowsUsed, 7);
    // Rekord 2000 komórek w 3 wierszach: trzy zakresy, każdy w swoim wierszu.
    const tex = Bridge3D.damage.tex;
    tex.clearUpdateRanges();
    Bridge3D.damage.used = 0;
    Bridge3D._fullUpload = false;
    Bridge3D._markRows({ row: 10, rowCount: 3, cellCount: 2000 });
    const ranges = tex.updateRanges.map((r) => [r.start / 4, r.count / 4]);
    assert.deepEqual(ranges, [[10 * W, W], [11 * W, W], [12 * W, 2000 - 2 * W]]);
  } finally {
    Bridge3D.dispose();
  }
});
