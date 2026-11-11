// Łuki i iskry przy ranach zasilanej części kadłuba (src/3d/powerArcsFx3D.js, pomysł przyjęty 2026-11-11):
// brzegi ran z PRAWDZIWEGO kadłuba belkowego (sprite'y z gry, HullBodies.impact), łuki tylko w PRACY (wyłączony,
// gaszenie, rozruch — nic), wraki / hulki / maskowanie / poza kadrem — nic, budżet łuków i okrętów na klatkę,
// pierwszeństwo największych i najbliższych środka kadru, przegląd brzegów tylko po zmianie ciała, klatka bez alokacji.
// Pule WeaponFx zastępuje rejestrator budowniczego (ten sam łańcuch begin … emit co pula ARC / SPARK).
import test from 'node:test';
import assert from 'node:assert/strict';
import { allocatedBytes, untilSteady } from './helpers/alokacje.mjs';

// hullBodies.js czyta window.wrecks — przed importem.
globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];

const { HullBodies } = await import('../src/game/hullBodies.js');
const { makeBridgeShip } = await import('./helpers/bridgeHulls.mjs');
const { beamLatticeToWorld } = await import('../src/game/shipBridgeBeams.js');
const { POWER_OFF, POWER_ON, POWER_STARTUP, POWER_SHUTDOWN, setShipPowerState } = await import('../src/game/shipPower.js');
const { fxRandom } = await import('../src/3d/fx/fxRandom.js');
const { K } = await import('../src/3d/weapons/gpuFx.js');
const PA = await import('../src/3d/powerArcsFx3D.js');
const { PowerArcsFx3D, POWER_ARCS_TUNE, POWER_ARC_SPARK_KIND, createWoundRecord, scanWoundEdges } = PA;

const TUNE0 = { ...POWER_ARCS_TUNE };
const restoreTune = () => Object.assign(POWER_ARCS_TUNE, TUNE0);

/** Rejestrator budowniczego puli (begin … emit). `keep` — zapis paczek (testy położeń), inaczej same liczniki. */
function fakePool(keep) {
  const list = [];
  const cur = { kind: 0, n: 0, x: 0, y: 0, dx: 0, dy: 0, s0: 0, s1: 0, pre: 0, z: 0, r: 0, g: 0, b: 0 };
  const pool = {
    list, emitted: 0,
    begin(kind, n) { cur.kind = kind; cur.n = n; cur.pre = 0; return pool; },
    at(x, y) { cur.x = x; cur.y = y; return pool; },
    dir(x, y) { cur.dx = x; cur.dy = y; return pool; },
    speed(a, c) { cur.s0 = a; cur.s1 = c; return pool; },
    life() { return pool; },
    color(r, g, b) { cur.r = r; cur.g = g; cur.b = b; return pool; },
    colors(c) { cur.r = c[0]; cur.g = c[1]; cur.b = c[2]; return pool; },
    x01() { return pool; }, x23() { return pool; }, cone() { return pool; }, drag() { return pool; },
    z(z) { cur.z = z; return pool; },
    preAge(t) { cur.pre = t; return pool; },
    emit() { pool.emitted++; if (keep) list.push({ ...cur }); return pool; }
  };
  return pool;
}
function fakeWeaponFx(keep = true) {
  return { gpu: { arc: fakePool(keep), spark: fakePool(keep) } };
}

const hullOf = (e) => e.beamHull;

/** Węzeł wnętrza (8 żywych sąsiadów) najbliżej środka siatki — miejsce trafienia. */
function interiorNode(e, fx = 0.5, fy = 0.5) {
  const b = hullOf(e).body, s = b.nodeStore, d = b.dims;
  const at = new Map();
  for (let i = 0; i < s.count; i++) if (s.active[i]) at.set(s.ix[i] + s.iy[i] * d.x, i);
  let best = -1, bd = Infinity;
  const tx = d.x * fx, ty = d.y * fy;
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    let full = true;
    for (let oy = -1; oy <= 1 && full; oy++) for (let ox = -1; ox <= 1; ox++) if (!at.has(s.ix[i] + ox + (s.iy[i] + oy) * d.x)) { full = false; break; }
    if (!full) continue;
    const dd = (s.ix[i] - tx) ** 2 + (s.iy[i] - ty) ** 2;
    if (dd < bd) { bd = dd; best = i; }
  }
  return best;
}

/** Punkt świata węzła (bieżąca pozycja, poza encji). */
function nodeWorld(e, i, out = { x: 0, y: 0 }) {
  const h = hullOf(e), b = h.body, s = b.nodeStore, lm = b.latticeMin;
  return beamLatticeToWorld(h, s.x[i] - lm.x, s.y[i] - lm.y, out);
}

/** Krater w środku węzła wnętrza (fx, fy — ułamki siatki). */
function crater(e, fx = 0.5, fy = 0.5, cells = 2.2) {
  const i = interiorNode(e, fx, fy);
  assert.ok(i >= 0, 'węzeł wnętrza do trafienia');
  const p = nodeWorld(e, i);
  const cs = hullOf(e).body.cellSize;
  assert.ok(HullBodies.impact(e, p.x, p.y, 1e6, null, { craterRadius: cells * cs }), 'trafienie objęło węzły');
  return p;
}

/** Brzegi liczone wprost (wzorzec): żywy węzeł iz = 0 z martwym węzłem w jednej z 8 sąsiednich komórek. */
function referenceEdges(e) {
  const b = hullOf(e).body, s = b.nodeStore, d = b.dims;
  const at = new Map();
  for (let i = 0; i < s.count; i++) if (s.iz[i] === 0) at.set(s.ix[i] + s.iy[i] * d.x, i);
  const out = new Set();
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i] || s.iz[i] !== 0) continue;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const j = at.get(s.ix[i] + ox + (s.iy[i] + oy) * d.x);
      if (j !== undefined && !s.active[j]) out.add(i);
    }
  }
  return out;
}

/** n klatek po 1/60 s (zegar wstrzyknięty). */
function frames(list, n, opts = {}, t0 = { ms: 1000 }) {
  const o = { dt: 1 / 60, zoom: 1, ...opts };
  for (let k = 0; k < n; k++) {
    t0.ms += 1000 / 60;
    o.nowMs = t0.ms;
    PowerArcsFx3D.update(list, o);
  }
  return t0;
}

test('rodzaj iskier łuków = K.SPARK puli broni', () => {
  assert.equal(POWER_ARC_SPARK_KIND, K.SPARK);
});

test('brzegi ran z prawdziwego kadłuba: nietknięty — zero (burta to nie rana), po kraterach — dokładnie żywe węzły przy martwych komórkach, kierunek ku dziurze', () => {
  for (const key of ['battleship', 'atlas', 'pirate_frigate']) {
    const e = makeBridgeShip(HullBodies, key, 5_000_000, 4_000_000, 0.4);
    const h = hullOf(e);
    const rec = createWoundRecord(h);
    assert.equal(scanWoundEdges(h, rec, 1), 0, `${key}: pierwszy przegląd — brzegi zastane nie są świeże`);
    assert.equal(rec.count, 0, `${key}: nietknięty kadłub nie ma brzegów ran`);
    crater(e, 0.5, 0.5);
    crater(e, 0.3, 0.6, 1.6);
    assert.ok(PA.woundRecordStale(rec, h.body), `${key}: zmiana ciała → przegląd`);
    const fresh = scanWoundEdges(h, rec, 2);
    const ref = referenceEdges(e);
    assert.ok(ref.size > 0, `${key}: kratery dały brzegi`);
    assert.equal(rec.count, ref.size, `${key}: liczba brzegów = wzorzec`);
    assert.equal(fresh, ref.size, `${key}: nowe brzegi są świeże`);
    const s = h.body.nodeStore, d = h.body.dims;
    const at = new Map();
    for (let i = 0; i < s.count; i++) at.set(s.ix[i] + s.iy[i] * d.x, i);
    for (let k = 0; k < rec.count; k++) {
      const i = rec.edges[k];
      assert.ok(ref.has(i), `${key}: brzeg ${i} we wzorcu`);
      assert.ok(Math.abs(Math.hypot(rec.dirX[k], rec.dirY[k]) - 1) < 1e-5, 'kierunek jednostkowy');
      // kierunek wskazuje martwą sąsiednią komórkę (iloczyn skalarny > 0 z przynajmniej jedną)
      let toward = false;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const j = at.get(s.ix[i] + ox + (s.iy[i] + oy) * d.x);
        if ((ox || oy) && j !== undefined && !s.active[j] && rec.dirX[k] * ox + rec.dirY[k] * oy > 0) toward = true;
      }
      assert.ok(toward, `${key}: kierunek brzegu ${i} ku dziurze`);
    }
    assert.equal(PA.woundRecordStale(rec, h.body), false, `${key}: bez zmian — bez przeglądu`);
    HullBodies.release(e);
  }
});

test('łuki tylko w PRACY: ranny okręt w pracy iskrzy przy brzegach ran, wyłączony / gaszenie / rozruch — nic', () => {
  restoreTune();
  PowerArcsFx3D.reset();
  fxRandom.seed(0x11c);
  const W = fakeWeaponFx(true);
  PowerArcsFx3D.attach({ weaponFx: W });
  const e = makeBridgeShip(HullBodies, 'battleship', 5_000_000, 4_000_000, 0.7);
  e.vx = 120; e.vy = -40;
  const cull = { x: e.x, y: e.y, drawHalfW: 2000, drawHalfH: 1200 };
  const opts = { cull, zoom: 0.6 };
  // nietknięty — nic
  let clock = frames([e], 120, opts);
  assert.equal(W.gpu.arc.emitted, 0, 'nietknięty kadłub nie iskrzy');
  crater(e, 0.5, 0.5);
  crater(e, 0.7, 0.4, 1.6);
  clock = frames([e], 600, opts, clock);   // 10 s
  const arcs = W.gpu.arc.list;
  assert.ok(arcs.length >= 8, `ranny okręt w pracy iskrzy (${arcs.length} łuków / 10 s)`);
  assert.ok(arcs.length <= 160, `łuki rzadkie (${arcs.length} / 10 s)`);
  // start łuku przy brzegu rany (≤ 1 komórka od żywego węzła brzegu), wysokość jak łuki agonii mostka
  const h = hullOf(e), cs = h.body.cellSize;
  const edges = [...referenceEdges(e)].map((i) => nodeWorld(e, i, { x: 0, y: 0 }));
  for (const a of arcs) {
    const wx = a.x, wy = -a.y;
    const dmin = Math.min(...edges.map((p) => Math.hypot(p.x - wx, p.y - wy)));
    assert.ok(dmin <= cs * 0.6, `łuk z brzegu rany (${dmin.toFixed(1)} j. od brzegu, komórka ${cs.toFixed(1)})`);
    assert.ok(a.s0 > 0 && a.s1 <= cs * (POWER_ARCS_TUNE.jumpCells + 1.5), 'długość łuku: ułamek komórki … przeskok przez dziurę');
    assert.equal(a.z, POWER_ARCS_TUNE.z);
  }
  assert.ok(W.gpu.spark.emitted > 0, 'iskry przy łukach');
  assert.ok(arcs.some((a) => a.pre < 0), 'powtórne uderzenia (łuk opóźniony)');
  // wyłączony, gaszenie, rozruch — zero łuków
  for (const state of [POWER_OFF, POWER_SHUTDOWN, POWER_STARTUP]) {
    setShipPowerState(e, state);
    const before = W.gpu.arc.emitted;
    clock = frames([e], 600, opts, clock);
    assert.equal(W.gpu.arc.emitted, before, `stan ${state}: wyłączony okręt nie iskrzy`);
  }
  setShipPowerState(e, POWER_ON);
  const before = W.gpu.arc.emitted;
  clock = frames([e], 600, opts, clock);
  assert.ok(W.gpu.arc.emitted > before, 'po włączeniu iskrzy znowu');
  // pauza (dt = 0) — nic
  const paused = W.gpu.arc.emitted;
  frames([e], 300, { ...opts, dt: 0 }, clock);
  assert.equal(W.gpu.arc.emitted, paused, 'pauza: bez łuków');
  HullBodies.release(e);
});

test('wrak, hulk mostka, maskowanie, poza kadrem i z daleka — bez łuków', () => {
  restoreTune();
  PowerArcsFx3D.reset();
  fxRandom.seed(0x22d);
  const W = fakeWeaponFx(false);
  PowerArcsFx3D.attach({ weaponFx: W });
  const e = makeBridgeShip(HullBodies, 'battleship', 5_000_000, 4_000_000, 0);
  crater(e, 0.5, 0.5);
  const cull = { x: e.x, y: e.y, drawHalfW: 2000, drawHalfH: 1200 };
  const run = (opts, list = [e]) => { const b = W.gpu.arc.emitted; frames(list, 600, { cull, zoom: 0.6, ...opts }); return W.gpu.arc.emitted - b; };
  assert.ok(run({}) > 0, 'kontrola: okręt w pracy iskrzy');
  e.isWreck = true; assert.equal(run({}), 0, 'wrak'); e.isWreck = false;
  e.isBridgeHulk = true; assert.equal(run({}), 0, 'hulk mostka'); e.isBridgeHulk = false;
  assert.equal(run({ visibility: () => 0 }), 0, 'maskowanie (widoczność 0)');
  assert.equal(run({ cull: { x: e.x + 50_000, y: e.y, drawHalfW: 2000, drawHalfH: 1200 } }), 0, 'poza kadrem');
  assert.equal(run({ zoom: 0.05 }), 0, `z daleka (komórka < ${POWER_ARCS_TUNE.minCellPx} px)`);
  e.hideHexVisual = true; assert.equal(run({}), 0, 'kadłub ukryty'); e.hideHexVisual = false;
  assert.ok(run({}) > 0, 'kontrola po wszystkim');
  HullBodies.release(e);
});

test('budżet: najwyżej maxArcsPerFrame łuków i maxHulls okrętów w klatce, pierwszeństwo największych i najbliższych środka kadru', () => {
  restoreTune();
  PowerArcsFx3D.reset();
  fxRandom.seed(0x33e);
  POWER_ARCS_TUNE.rateMin = 40; POWER_ARCS_TUNE.rateMax = 60;   // nacisk na budżet
  const W = fakeWeaponFx(true);
  PowerArcsFx3D.attach({ weaponFx: W });
  const X = 5_000_000, Y = 4_000_000;
  const big = makeBridgeShip(HullBodies, 'battleship', X, Y, 0);
  crater(big, 0.5, 0.5);
  const small = [];
  for (let k = 0; k < 10; k++) {
    const f = makeBridgeShip(HullBodies, 'frigate', X - 1700 + (k % 5) * 850, Y + (k < 5 ? -1000 : 1000), 0.3 * k);
    crater(f, 0.5, 0.5, 1.5);
    small.push(f);
  }
  const list = [...small, big];
  const cull = { x: X, y: Y, drawHalfW: 2200, drawHalfH: 1300 };
  const T = POWER_ARCS_TUNE;
  const clock = { ms: 1000 };
  const owner = (a) => {
    let best = null, bd = Infinity;
    for (const e of list) { const dd = Math.hypot(e.x - a.x, e.y + a.y); if (dd < bd) { bd = dd; best = e; } }
    return best;
  };
  let maxFrame = 0, maxHulls = 0;
  for (let f = 0; f < 600; f++) {
    const n0 = W.gpu.arc.list.length;
    frames(list, 1, { cull, zoom: 0.6 }, clock);
    const fresh = W.gpu.arc.list.slice(n0).filter((a) => a.pre === 0);
    maxFrame = Math.max(maxFrame, fresh.length);
    maxHulls = Math.max(maxHulls, new Set(fresh.map(owner)).size);
    assert.ok(PowerArcsFx3D.stats.hulls <= T.maxHulls, 'okręty z łukami w klatce ≤ maxHulls');
  }
  assert.equal(maxFrame, T.maxArcsPerFrame, `łuków w klatce najwyżej ${T.maxArcsPerFrame} (i budżet zużyty)`);
  assert.ok(maxHulls <= T.maxHulls, `okrętów z łukami w klatce ${maxHulls} ≤ ${T.maxHulls}`);
  const all = W.gpu.arc.list.filter((a) => a.pre === 0);
  const per = new Map();
  for (const a of all) { const o = owner(a); per.set(o, (per.get(o) || 0) + 1); }
  const fromBig = per.get(big) || 0;
  assert.ok(fromBig === Math.max(...per.values()), `największy w środku kadru pierwszy w kolejce (${fromBig} z ${all.length})`);
  assert.ok(per.size <= T.maxHulls, `łuki tylko na ${T.maxHulls} okrętach z kolejki (${per.size})`);
  // jedno miejsce w kolejce — tylko największy w środku kadru
  T.maxHulls = 1;
  const n1 = W.gpu.arc.list.length;
  frames(list, 300, { cull, zoom: 0.6 }, clock);
  const only = W.gpu.arc.list.slice(n1);
  assert.ok(only.length > 0 && only.every((a) => owner(a) === big), 'maxHulls 1: łuki tylko na największym w środku kadru');
  for (const e of list) HullBodies.release(e);
  restoreTune();
});

test('przegląd brzegów tylko po zmianie ciała; świeża rana podbija tempo; klatka bez alokacji', async () => {
  restoreTune();
  PowerArcsFx3D.reset();
  fxRandom.seed(0x44f);
  const W = fakeWeaponFx(false);
  PowerArcsFx3D.attach({ weaponFx: W });
  const e = makeBridgeShip(HullBodies, 'atlas', 5_000_000, 4_000_000, -0.2);
  crater(e, 0.4, 0.5);
  const cull = { x: e.x, y: e.y, drawHalfW: 3000, drawHalfH: 1800 };
  const opts = { cull, zoom: 0.5, dt: 1 / 60, nowMs: 1000 };
  const list = [e];
  const clk = new Float64Array(1); clk[0] = 1000;   // zegar testu bez pakowania liczb
  const step = () => { clk[0] += 1000 / 60; opts.nowMs = clk[0]; PowerArcsFx3D.update(list, opts); };
  for (let k = 0; k < 5; k++) step();
  const scans0 = PowerArcsFx3D.stats.scans;
  const rec = PowerArcsFx3D.recordOf(e.beamHull);
  assert.ok(rec && rec.count > 0, 'rekord z brzegami');
  assert.equal(rec.fresh, 0, 'rany zastane przy pierwszym widzeniu nie są świeże');
  for (let k = 0; k < 300; k++) step();
  assert.equal(PowerArcsFx3D.stats.scans, scans0, 'bez zmian ciała — bez przeglądu');
  const steady = W.gpu.arc.emitted;
  for (let k = 0; k < 120; k++) step();
  const steady2s = W.gpu.arc.emitted - steady;
  crater(e, 0.65, 0.45);
  step();
  assert.equal(PowerArcsFx3D.stats.scans, scans0 + 1, 'nowa rana — jeden przegląd');
  assert.ok(rec.fresh > 0.5, `świeżość po nowej ranie (${rec.fresh.toFixed(2)})`);
  const b = W.gpu.arc.emitted;
  for (let k = 0; k < 119; k++) step();
  const fresh2s = W.gpu.arc.emitted - b;
  assert.ok(fresh2s > steady2s, `po świeżej ranie częściej (${fresh2s} > ${steady2s} łuków / 2 s)`);
  for (let k = 0; k < 600; k++) step();
  assert.ok(rec.fresh < 0.01, 'świeżość gaśnie');
  // klatka bez łuku (zdecydowana większość klatek: łuki są rzadkie) — kandydaci, tempo, budżet — bez alokacji
  POWER_ARCS_TUNE.rateMin = 0; POWER_ARCS_TUNE.rateMax = 0; POWER_ARCS_TUNE.freshRate = 0;
  const best = await untilSteady(() => allocatedBytes(step, 2000), (v) => v < 4096, { warm: () => { for (let k = 0; k < 200; k++) step(); } });
  assert.ok(best < 4096, `klatka alokuje ${best} B / 2000 klatek`);
  restoreTune();
  HullBodies.release(e);
});
