import test from 'node:test';
import assert from 'node:assert/strict';

import { DestructorBeams3D as D, createBeamConfig } from '../src/game/destructorBeams3D.js';
import { buildSpriteBeamStructure } from '../src/game/beamSprite2D.js';
import { cloneBeamStructure } from '../src/game/beamCrashScene3D.js';
import { buildSpriteSkinTopology } from '../src/3d/beamSpriteSkin2D.js';
import { buildHullSkinTopology, writeHullSkin } from '../src/3d/beamHullSkin.js';
import { measureHullExtent, planHullSdfLayout, rasterizeHullMask } from '../src/3d/hullShadowSdf.js';

// Haki silnika belek dla gry (hullBodies.js): filtr par, zdarzenie kontaktu, wrak,
// odłamek jako indeks, żar zgniotu, krater, zapytania 2D. W demie wszystkie puste.

function plateStructure(w = 160, h = 80) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 150; data[i * 4 + 3] = 255; }
  return buildSpriteBeamStructure({ width: w, height: h, data }, { worldLength: w, cellsAlong: Math.round(w / 7.5) });
}

function gameConfig(cs, extra = {}) {
  const cfg = createBeamConfig(cs);
  Object.assign(cfg, { planar: true, localSolver: true, crushStrength: 300000, globalBreakMul: 0.6, maxContacts: 384 }, extra);
  return cfg;
}

function resetHooks() {
  D.pairFilter = null; D.onContact = null; D.onWreck = null; D.onNodeDebris = null; D.onDebris = null;
}

function ram(structure, cfg, speed = 900) {
  D.init(cfg);
  const a = D.createBody(cloneBeamStructure(structure), { massMultiplier: 50 });
  const b = D.createBody(cloneBeamStructure(structure), { massMultiplier: 50, position: { x: 165, y: 0, z: 0 } });
  a.vel.x = speed;
  return [a, b];
}

test('filtr par wyłącza zderzenie, onContact dostaje styk tylko przepuszczonych par', () => {
  const s = plateStructure();
  resetHooks();
  try {
    const bodies = ram(s, gameConfig(s.cellSize));
    let contacts = 0;
    D.pairFilter = () => false;
    D.onContact = () => { contacts++; };
    for (let k = 0; k < 30; k++) { D.integrate(1 / 120, bodies); D.update(1 / 120, bodies); }
    assert.equal(contacts, 0);
    assert.ok(bodies[0].pos.x > 165, 'bez zderzenia kadłub przeleciał przez drugi');

    const again = ram(s, gameConfig(s.cellSize));
    const infos = [];
    D.pairFilter = () => true;
    D.onContact = (A, B, info) => { if (info.doDamage) infos.push({ count: info.count, approach: info.approach, nx: info.nx }); };
    for (let k = 0; k < 30; k++) { D.integrate(1 / 120, again); D.update(1 / 120, again); }
    assert.ok(infos.length > 0 && infos[0].count > 0 && infos[0].approach > 100, 'styk z liczbą kontaktów i zbliżaniem');
    assert.ok(infos[0].nx < -0.5, 'normalna B → A (A wjeżdża od lewej)');
  } finally { resetHooks(); }
});

test('żar zgniotu tylko z heatGain; odłamek i wrak przez haki indeksowe', () => {
  const s = plateStructure();
  resetHooks();
  try {
    const cold = ram(s, gameConfig(s.cellSize));
    for (let k = 0; k < 30; k++) { D.integrate(1 / 120, cold); D.update(1 / 120, cold); }
    assert.ok(cold.every((b) => b.nodeStore.heat.every((h) => h === 0)), 'demo (heatGain 0) bez żaru');

    D.clock = () => 1234.5;
    const debris = [];
    const wrecks = [];
    D.onNodeDebris = (body, i, wx, wy, wz, vx, vy) => debris.push({ i, ok: Number.isInteger(i) && Number.isFinite(wx + wy + vx + vy) });
    D.onWreck = (parent, wreck) => wrecks.push({ parent, wreck });
    const hot = ram(s, gameConfig(s.cellSize, { heatGain: 1, heatSpeed: 150 }), 1500);
    for (let k = 0; k < 90; k++) { D.integrate(1 / 120, hot); D.update(1 / 120, hot); }
    const heated = hot.flatMap((b) => Array.from(b.nodeStore.heat)).filter((h) => h > 0);
    assert.ok(heated.length > 0 && heated.every((h) => h <= 1), 'zgniatane węzły rozżarzone (0–1)');
    assert.ok(hot.some((b) => b.nodeStore.heatStamp.some((t) => t === 1234.5)), 'znacznik z zegara systemu');
    assert.ok(debris.length > 0 && debris.every((d) => d.ok), 'odłamki jako indeksy z pozycją i prędkością świata');
    assert.ok(wrecks.length > 0 && wrecks.every((w) => w.wreck.isWreck && hot.includes(w.wreck)), 'wrak w liście ciał');
  } finally {
    resetHooks();
    D.clock = () => performance.now() * 0.001;
  }
});

test('krater: budżet HP od najbliższego węzła, bez promienia zerwań', () => {
  const s = plateStructure(240, 120);
  resetHooks();
  D.init(gameConfig(s.cellSize));
  const body = D.createBody(cloneBeamStructure(s), {});
  const before = body.activeNodes;
  const store = body.nodeStore;
  // Punkt przy węźle 0 w układzie świata (ciało w (0, 0) bez obrotu).
  const hit = D.applyImpact(body, store.x[500], store.y[500], 0, 400, { x: 1, y: 0, z: 0 }, { radius: 5 * s.cellSize, hpBudget: 400 });
  assert.equal(hit, true);
  const killed = before - body.activeNodes;
  assert.ok(killed >= 4 && killed <= 6, `400 HP budżetu przy 80 HP na węzeł: ${killed}`);
  assert.equal(store.active[500], 0, 'najbliższy węzeł ginie pierwszy');
});

test('sweepLocal2D i probeLocal2D widzą przemieszczony węzeł (okno z _maxDisp)', () => {
  const s = plateStructure();
  resetHooks();
  D.init(gameConfig(s.cellSize));
  const body = D.createBody(cloneBeamStructure(s), {});
  const st = body.nodeStore, cs = body.cellSize;
  const out = { t: 0, node: -1 };
  // Odcinek wzdłuż osi przez środek płyty: pierwszy węzeł przy lewej krawędzi.
  const hit = D.sweepLocal2D(body, -500, 0, 500, 0, 0.55 * cs, out);
  assert.ok(hit >= 0 && out.t > 0 && out.t < 0.5);
  // Wgnieciony węzeł (70 j. w dół, poza płytę) dalej widoczny dla sondy w nowym miejscu.
  const i = Math.floor(st.count / 2);
  st.y[i] -= 70;             // poza płytę: w pobliżu nie ma innych węzłów
  // Silnik rusza węzły tylko z poszerzeniem obrysu i _maxDisp (solver, zgniot, trafienie).
  D._updateRadius(body);
  body._maxDisp = 70;
  assert.equal(D.probeLocal2D(body, st.x[i], st.y[i], 0.5 * cs), i);
  st.active[i] = 0;
  assert.equal(D.probeLocal2D(body, st.x[i], st.y[i], 0.5 * cs), -1, 'martwy węzeł nie odpowiada');
});

test('skóra gry: UV w konwencji tekstur heksów (v = 0 u góry obrazu), martwy węzeł zwinięty', () => {
  const s = plateStructure();
  D.init(gameConfig(s.cellSize));
  const body = D.createBody(cloneBeamStructure(s), {});
  const demo = buildSpriteSkinTopology(body);
  const game = buildHullSkinTopology(body);
  // Nieparzyste = v (odwrócone), parzyste = u (bez zmian).
  for (let k = 1; k < demo.uvs.length; k += 98) assert.ok(Math.abs(game.uvs[k] - (1 - demo.uvs[k])) < 1e-6);
  for (let k = 0; k < demo.uvs.length; k += 98) assert.equal(game.uvs[k], demo.uvs[k]);
  // Węzeł z górnego wiersza siatki (najwyższe iy) ma v bliskie 0.
  const st = body.nodeStore;
  let top = 0;
  for (let i = 0; i < st.count; i++) if (st.iy[i] > st.iy[top]) top = i;
  const vTop = Math.min(game.uvs[top * 8 + 1], game.uvs[top * 8 + 3], game.uvs[top * 8 + 5], game.uvs[top * 8 + 7]);
  assert.ok(vTop < 1e-6, `górny wiersz obrazu: v = ${vTop}`);
  const n = game.count * 4;
  const pos = new Float32Array(n * 3), shade = new Float32Array(n), heat = new Float32Array(n * 2);
  st.heat[5] = 0.8; st.heatStamp[5] = 12;
  game.heatNow = 12; game.heatDecay = 0.35;
  D.destroyNode(body, 7);
  assert.equal(writeHullSkin(body, game, pos, shade, heat), body.activeNodes);
  assert.equal(shade[7 * 4], 0, 'martwy węzeł bez blachy');
  assert.equal(pos[7 * 12], pos[7 * 12 + 3], 'martwy węzeł zwinięty do punktu');
  assert.ok(Math.abs(heat[5 * 8] - 0.8) < 1e-6 && heat[5 * 8 + 1] === 12, 'żar węzła na wierzchołkach (znacznik = chwila zapisu)');
  // Sąsiad dzielący narożnik dostaje ten sam żar na wspólnym narożniku (bez kwadratów).
  const nb = game.links[5 * 9 + 5];
  if (nb >= 0) {
    const m = game.beamStore.a[nb] === 5 ? game.beamStore.b[nb] : game.beamStore.a[nb];
    assert.ok(Array.from({ length: 4 }, (_, k) => heat[m * 8 + k * 2]).some((h) => Math.abs(h - 0.8) < 1e-6), 'wspólny narożnik rozgrzany');
  }
});

test('cień: siatka komórkowa (tablice typowane) daje zasięg i maskę jak heksy', () => {
  const n = 4 * 3;
  const cellX = new Float32Array(n), cellY = new Float32Array(n), active = new Uint8Array(n).fill(1);
  for (let i = 0; i < n; i++) { cellX[i] = 10 + (i % 4) * 7.5; cellY[i] = 10 + Math.floor(i / 4) * 7.5; }
  active[0] = 0;
  const grid = { cellX, cellY, cellActive: active, cellCount: n, cellRadius: 5.4, srcWidth: 50, srcHeight: 40, pivot: { x: 0, y: 0 } };
  const ext = measureHullExtent(grid, {});
  assert.equal(ext.count, n - 1);
  assert.ok(Math.abs(ext.maxX - (32.5 - 25)) < 1e-6 && Math.abs(ext.minY - (10 - 20)) < 1e-6);
  const layout = planHullSdfLayout(ext, 5.4, {});
  const mask = new Uint8Array(layout.gw * layout.gh);
  rasterizeHullMask(grid, layout, null, mask);
  assert.ok(mask.some((v) => v === 1), 'maska sylwetki z kół komórek');
});
