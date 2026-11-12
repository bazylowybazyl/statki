// Model 3D mostka (src/3d/bridge3D.js, bridge3DShapes.js): geometria modeli, rekord na komórkach siatki
// belek kadłuba (blok, mapowanie strefy, bufor obrażeń, baza instancji, odłam i wrak), oś czasu okien,
// szczeliny bridgeFx3D. Kadłuby belkowe z prawdziwych sprite'ów (tests/helpers/bridgeHulls.mjs) — dawna
// wersja na heksach destruktora usunięta 2026-10-19. Rekord na wraku i odłamie, wrak poza listą:
// tests/shipBridgeBeams.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from 'three';

// hullBodies.js czyta window.wrecks — przed importem.
globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];

const { HullBodies } = await import('../src/game/hullBodies.js');
const { makeBridgeShip } = await import('./helpers/bridgeHulls.mjs');
const { BRIDGE_DEMO_ORDER } = await import('../dema/mostki-webgpu/kadluby.js');
const RT = await import('../src/game/shipBridgeRuntime.js');
const BB = await import('../src/game/shipBridgeBeams.js');
const { BRIDGE_KILL_TIMELINE, BRIDGE_LAYOUT_PROPOSALS, bridgeGridToWorld, bridgePngToWorld } = await import('../src/game/shipBridge.js');
const {
  BRIDGE3D_EMIT,
  BRIDGE3D_KINDS,
  BRIDGE3D_KIND_ORDER,
  bridgeModelOnHull,
  buildBridgeModel,
  resolveBridgeModelKind,
  sampleHeightField
} = await import('../src/3d/bridge3DShapes.js');
const { BRIDGE_LEVELS } = await import('../src/data/bridgeLevels.js');
const {
  BRIDGE3D_DAMAGE_LIMITS,
  BRIDGE3D_KIND_STYLE,
  BRIDGE3D_SQUARE_NEIGHBORS,
  BRIDGE3D_TUNE,
  Bridge3D,
  beamBridgeInstanceBasis,
  bridgeEmitterLight,
  bridgeModelGridMap,
  bridgeModelToGrid,
  createBeamBridgeRecordCore,
  refreshBeamBridgeRecordDamage
} = await import('../src/3d/bridge3D.js');
const { BRIDGE3D_TSL_INTERNALS } = await import('../src/3d/bridge3D.tsl.js');
const { BridgeFx3D } = await import('../src/3d/bridgeFx3D.js');

const MODELS = Object.fromEntries(BRIDGE3D_KIND_ORDER.map((k) => [k, buildBridgeModel(k)]));

// Kolce piratów mogą wystawać poza strefę (jak na sprite'ach), ale nie dalej niż tyle.
const SPIKE_SLACK = { ironskull: 12, pirate_frigate: 5, pirate_destroyer: 9 };

// Okręty floty TN (nazwa modelu na kadłubie — bridgeModelOnHull) i ich klucze stref.
const TN_HULL_OF = { custos: 'frigate', hasta: 'destroyer', bellator: 'battleship', citadella: 'terran_carrier', colossus: 'terran_supercapital' };

// Strefa rodzaju z BRIDGE_LAYOUT_PROPOSALS (domyślny wariant kadłuba) z kadłubem i skalą render/PNG; model poziomu
// — strefa okrętu TN tego poziomu (null — poziom bez kadłuba TN: III).
function kindZone(name) {
  const k = BRIDGE3D_KINDS[name];
  if (k.level) {
    for (const [tn, hull] of Object.entries(TN_HULL_OF)) {
      const entry = BRIDGE_LAYOUT_PROPOSALS[hull];
      const z = entry.variants[entry.defaultVariant].find((q) => q.level === k.level);
      if (z) { const on = bridgeModelOnHull(tn); return { def: z, hull, kx: on.kx, ky: on.ky }; }
    }
    return null;
  }
  const entry = BRIDGE_LAYOUT_PROPOSALS[k.hull];
  return { def: entry.variants[entry.defaultVariant].find((z) => z.id === k.zoneId), hull: k.hull, kx: k.render[0] / k.png[0], ky: k.render[1] / k.png[1] };
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

// Okręt NPC na kadłubie belkowym z mostkami z BRIDGE_LAYOUT_PROPOSALS.
function ship(key = 'battleship', x = 0, y = 0, angle = 0) {
  const e = makeBridgeShip(HullBodies, key, x, y, angle);
  RT.attachEntityBridges(e);
  return e;
}

// Krater na miarę komórki w środku komórki k mostka (zabija jej węzeł). false — już martwa.
function killCell(e, k, b = 0) {
  const hull = e.beamHull;
  const bridge = e.bridgeState.bridges[b];
  const cs = hull.body.cellSize;
  if (BB.bridgeCellNode(hull, bridge.cellX[k], bridge.cellY[k]) < 0) return false;
  const p = BB.beamLatticeToWorld(hull, (bridge.cellX[k] + 0.5) * cs, (bridge.cellY[k] + 0.5) * cs, {});
  HullBodies.impact(e, p.x, p.y, 1, null, { craterRadius: cs * 0.45 });
  return true;
}

// Indeks komórki (ix, iy) w bloku rekordu (−1 poza blokiem).
function blockIndex(rec, ix, iy) {
  const i = ix - rec.c0;
  const j = iy - rec.r0;
  return i >= 0 && j >= 0 && i < rec.blockW && j < rec.blockH ? i + j * rec.blockW : -1;
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

test('model kind follows the zone level, the hull key and the Atlas zone shape', () => {
  // Terra Nova i projekty kreatora: model poziomu z pola `level` strefy (kadłub bez znaczenia).
  for (const lv of BRIDGE_LEVELS) {
    assert.equal(resolveBridgeModelKind('battleship', { w: 10, h: 10, level: lv.level }), lv.model);
    assert.equal(resolveBridgeModelKind(null, { level: lv.level }), lv.model);
  }
  const tnLevels = { frigate: 1, destroyer: 2, battleship: 4, terran_carrier: 5, terran_supercapital: 6 };
  for (const [hull, lv] of Object.entries(tnLevels)) {
    const entry = BRIDGE_LAYOUT_PROPOSALS[hull];
    assert.equal(resolveBridgeModelKind(hull, entry.variants[entry.defaultVariant][0]), `tn_${lv}`, `${hull}: model poziomu ${lv}`);
  }
  assert.equal(resolveBridgeModelKind('battleship', { w: 236, h: 92 }), null, 'kadłub TN bez poziomu strefy — bez modelu');
  assert.equal(resolveBridgeModelKind('pirate_battleship', { w: 176, h: 104 }), 'ironskull');
  assert.equal(resolveBridgeModelKind('atlas', { role: 'primary', w: 520, h: 80 }), 'atlas_main');
  assert.equal(resolveBridgeModelKind('atlas', { role: 'backup', w: 244, h: 66 }), 'atlas_backup');
  assert.equal(resolveBridgeModelKind('atlas', { role: 'primary', w: 244, h: 66 }), 'atlas_backup'); // wariant „dziobowy”
  // Piraci i lokomotywa: jeden model na kadłub (strefa z edytora — dopasowanie skalą).
  const fleet = { pirate_frigate: 'pirate_frigate', pirate_destroyer: 'pirate_destroyer', pirate_supercapital: 'pirate_supercapital', megafreighter: 'megafreighter' };
  for (const [hull, kind] of Object.entries(fleet)) assert.equal(resolveBridgeModelKind(hull, { w: 100, h: 40 }), kind, hull);
  assert.equal(resolveBridgeModelKind('long_haul_freighter', { w: 100, h: 40 }), null);
});

test('square neighbour directions: the CPU table mirrors the shader (sides, then corners)', () => {
  const dirs = BRIDGE3D_SQUARE_NEIGHBORS.map((d) => [...d]);
  assert.deepEqual(dirs, BRIDGE3D_TSL_INTERNALS.B3_SQUARE_DIRS.map((d) => [...d]), 'maska 8 bitów: te same kierunki w buforze i w shaderze');
  assert.equal(dirs.length, 8);
  for (let d = 0; d < 4; d++) assert.equal(Math.abs(dirs[d][0]) + Math.abs(dirs[d][1]), 1, `bok ${d}`);
  for (let d = 4; d < 8; d++) assert.ok(Math.abs(dirs[d][0]) === 1 && Math.abs(dirs[d][1]) === 1, `narożnik ${d}`);
  assert.equal(new Set(dirs.map((d) => d.join(','))).size, 8);
});

test('record block maps model space onto the zone and holds every live bridge cell under the model', () => {
  const e = ship('battleship');
  const st = e.bridgeState;
  const def = st.bridges[0].def;
  const rec = createBeamBridgeRecordCore(e, st, 0, kindRes('tn_4'), 0);
  // Środek modelu = środek strefy w obrazie kadłuba (px od lewego górnego rogu).
  const g = bridgeModelToGrid(rec.map, 0, 0);
  assert.ok(Math.abs(g.x - (st.srcW * 0.5 + def.x * st.scaleX)) < 1e-9 && Math.abs(g.y - (st.srcH * 0.5 + def.y * st.scaleY)) < 1e-9);
  // Narożnik modelu (M: +x, +y↑) → prawy GÓRNY róg strefy (Y obrazu w dół).
  const k = MODELS.tn_4.design;
  const c = bridgeModelToGrid(rec.map, k.w / 2, k.h / 2);
  assert.ok(Math.abs(c.x - (st.srcW * 0.5 + (def.x + def.w / 2) * st.scaleX)) < 1e-6);
  assert.ok(Math.abs(c.y - (st.srcH * 0.5 + (def.y - def.h / 2) * st.scaleY)) < 1e-6);
  // Komórki mostka w bloku istniały przy budowie i żyją u gospodarza.
  const b = st.bridges[0];
  let inBlock = 0;
  for (let q = 0; q < b.total; q++) {
    const kk = blockIndex(rec, b.cellX[q], b.cellY[q]);
    if (kk < 0) continue;
    inBlock++;
    assert.equal(rec.existed[kk], 1);
  }
  assert.ok(inBlock / b.total > 0.95, `komórki strefy w bloku (${inBlock}/${b.total})`);
  // Emitery trafiają na komórki kadłuba.
  let onCells = 0;
  for (let i = 0; i < rec.emCellX.length; i++) if (rec.emCellX[i] !== -32768) onCells++;
  assert.ok(onCells >= rec.emCellX.length * 0.9, `emitery na komórkach: ${onCells}/${rec.emCellX.length}`);
  assert.ok(Math.abs(rec.cellPx - st.cellSize / st.spriteScale) < 1e-9, 'bok komórki w px obrazu (aB3State.w)');
});

test('damage row: a dead cell opens a hole, live neighbours get the edge mask and a fresh-cut glow that fades', () => {
  const e = ship('battleship');
  const st = e.bridgeState;
  const rec = createBeamBridgeRecordCore(e, st, 0, kindRes('tn_4'), 1);
  const W = BRIDGE3D_DAMAGE_LIMITS.width;
  const data = new Uint8Array(W * 4 * 4);
  refreshBeamBridgeRecordDamage(rec, e.beamHull, data, 10, W);
  const base = 1 * W * 4;
  for (let k = 0; k < rec.cellCount; k++) {
    if (!rec.existed[k]) continue;
    assert.ok(data[base + k * 4] >= 64, 'żywa komórka ma R ≥ 64');
    assert.equal(data[base + k * 4 + 2], 0, 'bez martwych sąsiadów');
  }
  assert.equal(rec.anyDead, 0);
  // Zabijamy komórkę w środku strefy.
  const b = st.bridges[0];
  const q = Math.floor(b.total / 2);
  assert.ok(killCell(e, q));
  const changed = refreshBeamBridgeRecordDamage(rec, e.beamHull, data, 10.5, W);
  assert.ok(changed);
  assert.equal(rec.anyDead, 1);
  const vk = blockIndex(rec, b.cellX[q], b.cellY[q]);
  assert.ok(vk >= 0);
  assert.equal(data[base + vk * 4], 0, 'martwa komórka = wyrwa');
  // Sąsiad w kierunku d widzi martwą komórkę w kierunku przeciwnym (bit) i świeci świeżym cięciem.
  const opposite = (d) => (d < 4 ? (d + 2) % 4 : 4 + ((d - 4 + 2) % 4));
  let seen = 0;
  for (let d = 0; d < 8; d++) {
    const [dx, dy] = BRIDGE3D_SQUARE_NEIGHBORS[d];
    const nk = blockIndex(rec, b.cellX[q] + dx, b.cellY[q] + dy);
    if (nk < 0 || !rec.existed[nk] || data[base + nk * 4] < 64) continue;
    const mask = data[base + nk * 4 + 2];
    assert.ok(mask & (1 << opposite(d)), `sąsiad w kierunku ${d}: maska ${mask.toString(2)}`);
    assert.ok(data[base + nk * 4 + 3] > 200, 'świeże cięcie świeci');
    seen++;
  }
  assert.ok(seen >= 4, `żywi sąsiedzi wyrwy: ${seen}`);
  // Żar cięcia gaśnie z czasem (zanik żaru węzła, HULL_BODY_CONFIG.heatDecay).
  refreshBeamBridgeRecordDamage(rec, e.beamHull, data, 30, W);
  for (let d = 0; d < 8; d++) {
    const [dx, dy] = BRIDGE3D_SQUARE_NEIGHBORS[d];
    const nk = blockIndex(rec, b.cellX[q] + dx, b.cellY[q] + dy);
    if (nk >= 0 && rec.existed[nk] && data[base + nk * 4] >= 64) assert.ok(data[base + nk * 4 + 3] < 10);
  }
});

test('instance basis maps model points exactly where bridgeGridToWorld puts them (rotated, posed, on the wreck)', () => {
  window.wrecks.length = 0;
  const e = ship('battleship', 1200, -340, 0.73);
  const st = e.bridgeState;
  const rec = createBeamBridgeRecordCore(e, st, 0, kindRes('tn_4'), 0);
  for (const pose of [null, { x: 1190, y: -331, angle: 0.71 }]) {
    const B = beamBridgeInstanceBasis(rec, e, pose, {});
    for (const [x, y] of [[0, 0], [30, -10], [-50, 20], [60, 24]]) {
      const g = bridgeModelToGrid(rec.map, x, y);
      const w = bridgeGridToWorld(e, g.x, g.y, { x: 0, y: 0 }, pose);
      const sx = B.ox + B.ax * x + B.bx * y;
      const sy = B.oy + B.ay * x + B.by * y;
      assert.ok(Math.abs(sx - w.x) < 1e-6 && Math.abs(sy + w.y) < 1e-6, `(${x}, ${y})`);
    }
    // Bez odbicia: kolejność ścian zachowana (FrontSide działa).
    assert.ok(B.ax * B.by - B.ay * B.bx > 0);
    assert.ok(Math.abs(B.sz - st.spriteScale) < 1e-9);
  }
  // Wrak (kotwica = środek masy, to samo ciało): ta sama baza — bez „pyknięcia” modelu.
  const B0 = beamBridgeInstanceBasis(rec, e, null, {});
  const wreck = HullBodies.convertToWreck(e);
  assert.ok(wreck && wreck.beamHull);
  const B1 = beamBridgeInstanceBasis(rec, wreck, null, {});
  assert.ok(Math.hypot(B1.ox - B0.ox, B1.oy - B0.oy) < 1e-3, 'początek modelu w tym samym miejscu');
  for (const k of ['ax', 'ay', 'bx', 'by', 'sz']) assert.ok(Math.abs(B1[k] - B0[k]) < 1e-9, k);
  window.wrecks.length = 0;
});

test('cells cut off with a fragment vanish from the parent row and live in the fragment row', () => {
  window.wrecks.length = 0;
  const e = ship('battleship');
  const st = e.bridgeState;
  const def = st.bridges[0].def;
  const rec = createBeamBridgeRecordCore(e, st, 0, kindRes('tn_4'), 0);
  // Rzaz w poprzek strefy mostka: rufowa część nadbudówki odpada z odłamem.
  const a = bridgePngToWorld(e, def.x, -500, {});
  const c = bridgePngToWorld(e, def.x, 500, {});
  HullBodies.cutSegment(e, a.x, a.y, c.x, c.y, e.beamHull.cellSize * 1.2, { push: true });
  for (let i = 0; i < 30; i++) HullBodies.step(1 / 120, [e, ...window.wrecks]);
  const frag = window.wrecks.find((w) => w.beamHull && w.beamHull.dmgKey === st.lineage
    && rec.existed.some((v, k) => v && BB.bridgeCellNode(w.beamHull, rec.c0 + (k % rec.blockW), rec.r0 + ((k / rec.blockW) | 0)) >= 0));
  assert.ok(frag, 'odłam rodu z częścią mostka');
  const W = BRIDGE3D_DAMAGE_LIMITS.width;
  const data = new Uint8Array(W * 4);
  refreshBeamBridgeRecordDamage(rec, e.beamHull, data, 1, W);
  assert.ok(rec.moved > 0, `komórki poza gospodarzem: ${rec.moved}`);
  // Komórka na odłamie: na kadłubie-matce ta część modelu znika, rekord-siostra pokaże ją na odłamie.
  let k0 = -1;
  for (let k = 0; k < rec.cellCount && k0 < 0; k++) {
    if (rec.existed[k] && BB.bridgeCellNode(frag.beamHull, rec.c0 + (k % rec.blockW), rec.r0 + ((k / rec.blockW) | 0)) >= 0) k0 = k;
  }
  assert.ok(k0 >= 0);
  assert.equal(data[k0 * 4], 0, 'na kadłubie-matce wyrwa');
  const data2 = new Uint8Array(W * 4);
  refreshBeamBridgeRecordDamage(rec, frag.beamHull, data2, 1, W);
  assert.ok(data2[k0 * 4] >= 64, 'na odłamie żywa');
  window.wrecks.length = 0;
});

test('window lights follow the kill timeline: steady, flicker, wave out; a wreck dies with its power', () => {
  const e = ship('battleship');
  const st = e.bridgeState;
  const rec = createBeamBridgeRecordCore(e, st, 0, kindRes('tn_4'), 0);
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
  st.vent = { x: st.bridges[0].def.x, y: 0, dirX: 0, dirY: -1 };
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
});

test('bridgeFx3D skips its window slits for hulls that carry the 3D model (vent stays)', () => {
  const scene = new THREE.Scene();
  const e = ship('battleship');
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
  }
});

test('every model stands on its zone and its cell block fits the damage rows', () => {
  const { maxRows } = BRIDGE3D_DAMAGE_LIMITS;
  for (const name of BRIDGE3D_KIND_ORDER) {
    const k = BRIDGE3D_KINDS[name];
    const z = kindZone(name);
    if (!z) { assert.equal(k.level, 3, `${name}: tylko poziom III (krążownik) bez kadłuba TN`); continue; }
    const { def, hull, kx, ky } = z;
    assert.ok(def, `${name}: strefa ${hull}/${k.zoneId}`);
    const map = bridgeModelGridMap({ ...def, rot: 0 }, kx, ky, 1000, 1000, MODELS[name].design);
    assert.ok(Math.abs(map.sxZ - 1) < 0.01 && Math.abs(map.syZ - 1) < 0.01, `${name}: model zaprojektowany na strefę (${map.sxZ.toFixed(3)} × ${map.syZ.toFixed(3)})`);
    assert.equal(resolveBridgeModelKind(hull, def), name, `${name}: rodzaj po strefie`);
  }
  // Blok komórek pod każdym modelem na prawdziwym kadłubie mieści się w maxRows wierszach bufora obrażeń.
  const covered = new Set();
  for (const key of BRIDGE_DEMO_ORDER) {
    const e = ship(key);
    const st = e.bridgeState;
    for (let b = 0; b < st.bridges.length; b++) {
      const name = resolveBridgeModelKind(st.hullKey, st.bridges[b].def);
      assert.ok(name, `${key}/${st.bridges[b].id}: rodzaj modelu`);
      const rec = createBeamBridgeRecordCore(e, st, b, kindRes(name), 0);
      assert.ok(rec.cellCount > 0 && rec.rowCount <= maxRows, `${key}/${name}: blok ${rec.blockW}×${rec.blockH} > ${maxRows} wierszy`);
      covered.add(name);
    }
  }
  // Poziom III (krążownik) nie ma kadłuba TN, ale od E13 stoi na kadłubach ruchu (frachtowiec DZ, rafineria…).
  assert.deepEqual([...covered].sort(), [...BRIDGE3D_KIND_ORDER].sort(), 'każdy rodzaj modelu na kadłubie dema');
  assert.equal(BRIDGE3D_TUNE.enabled, true);
});

test('every kind has a full palette and style', () => {
  for (const name of BRIDGE3D_KIND_ORDER) {
    const st = BRIDGE3D_KIND_STYLE[name];
    assert.ok(st, `${name}: brak stylu w BRIDGE3D_KIND_STYLE`);
    assert.equal(st.palette.length, 8, `${name}: paleta 8 materiałów`);
    for (const hex of st.palette) assert.match(hex, /^#[0-9a-f]{6}$/i);
    if (!BRIDGE3D_KINDS[name].level) assert.ok(BRIDGE_LAYOUT_PROPOSALS[BRIDGE3D_KINDS[name].hull].windowColor, `${name}: kolor okien`);
  }
});

test('damage rows: big bridges get consecutive rows, uploads cover only the changed blocks, rows are reused', () => {
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
    // Port WebGPU (zadanie 15): obrażenia w buforze storage u32 (RGBA8 w słowie) —
    // backend WebGPU ignoruje zakresy TEKSTUR (każda zmiana = całe 1,5 MB), zakresy
    // bufora wysyła writeBuffer. Blok rekordu leży liniowo od jego wiersza, więc
    // rekord 2000 komórek w 3 wierszach to JEDEN zakres dokładnie jego komórek.
    const attr = Bridge3D.damage.attr;
    assert.ok(attr.isStorageBufferAttribute, 'obrażenia w buforze storage');
    assert.equal(attr.array.length, W * BRIDGE3D_DAMAGE_LIMITS.rows);
    assert.equal(Bridge3D.damage.data.buffer, attr.array.buffer, 'bajty RGBA pisane w ten sam bufor');
    attr.clearUpdateRanges();
    const v0 = attr.version;
    Bridge3D._markRows({ row: 10, rowCount: 3, cellCount: 2000 });
    Bridge3D._markRows({ row: 4, rowCount: 1, cellCount: 300 });
    assert.deepEqual(attr.updateRanges.map((r) => [r.start, r.count]), [[10 * W, 2000], [4 * W, 300]]);
    assert.ok(attr.version > v0, 'needsUpdate — wysyłka w następnym renderze');
    // Wysyłka (three czyści listę po writeBuffer) — pula zakresów od nowa, bez alokacji.
    const first = attr.updateRanges[0];
    attr.clearUpdateRanges();
    Bridge3D._markRows({ row: 1, rowCount: 2, cellCount: 900 });
    assert.deepEqual(attr.updateRanges.map((r) => [r.start, r.count]), [[W, 900]]);
    assert.equal(attr.updateRanges[0], first, 'obiekt zakresu z puli');
    // Za dużo zakresów przed wysyłką: jeden obejmujący wszystkie (nic nie ginie).
    for (let i = 0; i < 80; i++) Bridge3D._markRows({ row: 20 + i, rowCount: 1, cellCount: 10 });
    const covered = attr.updateRanges.map((r) => [r.start, r.start + r.count]);
    const inside = (s, e) => covered.some(([cs, ce]) => cs <= s && e <= ce);
    assert.ok(attr.updateRanges.length <= 64, `zakresów ${attr.updateRanges.length}`);
    assert.ok(inside(W, W + 900) && inside(20 * W, 20 * W + 10) && inside(99 * W, 99 * W + 10), 'zakres obejmujący zmiany sprzed przepełnienia');
    const lo = Math.min(...covered.map((c) => c[0]));
    const hi = Math.max(...covered.map((c) => c[1]));
    assert.ok(hi - lo < W * BRIDGE3D_DAMAGE_LIMITS.rows, 'bez pełnego uploadu bufora');
  } finally {
    Bridge3D.dispose();
  }
});

test('refreshBeamBridgeRecordDamage writes RGBA bytes the shader unpacks from one u32 per cell', () => {
  const e = ship('battleship');
  const st = e.bridgeState;
  const rec = createBeamBridgeRecordCore(e, st, 0, kindRes('tn_4'), 2);
  const W = BRIDGE3D_DAMAGE_LIMITS.width;
  const words = new Uint32Array(W * 4);
  const bytes = new Uint8Array(words.buffer);
  refreshBeamBridgeRecordDamage(rec, e.beamHull, bytes, 1, W);
  assert.ok(killCell(e, Math.floor(st.bridges[0].total / 2)));
  refreshBeamBridgeRecordDamage(rec, e.beamHull, bytes, 1.2, W);
  // Słowo komórki k rekordu z wiersza 2 = R | G << 8 | B << 16 | A << 24 (bridge3D.tsl.js: cell()).
  let checked = 0;
  for (let k = 0; k < rec.cellCount; k++) {
    const o = (2 * W + k) * 4;
    const w = words[2 * W + k];
    assert.equal(w & 255, bytes[o]);
    assert.equal((w >>> 8) & 255, bytes[o + 1]);
    assert.equal((w >>> 16) & 255, bytes[o + 2]);
    assert.equal(w >>> 24, bytes[o + 3]);
    if (bytes[o + 2]) checked++;
  }
  assert.ok(checked > 0, 'komórki z maską martwych sąsiadów');
});
