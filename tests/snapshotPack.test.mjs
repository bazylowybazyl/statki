// RW-10 (docs/PLAN-render-worker.md § 3.2): układ migawki i pakowanie — bez zmian stanu gry, sloty, węzły tylko
// ciał zmienionych od ostatniej klatki odebranej, wzrost pojemności, odczyt strony z potrójnego bufora.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HEAD, HEAD_FLAG, LIST, ENT, ENT_FLAG, BODY, BODY_FLAG, NOZZLE, SHOT, TURRET, STATION, WORLD, HALL_WORDS,
  createSnapshotLayout, createSnapshotViews, bodyNodeF64Words
} from '../src/render/snapshotLayout.js';
import { SnapshotPacker, createSnapshotFrame, TIER_B_PERIOD } from '../src/render/snapshotPack.js';
import { TripleBufferReader } from '../src/render/tripleBuffer.js';

function deepFreeze(o, seen = new Set()) {
  if (!o || typeof o !== 'object' || seen.has(o) || ArrayBuffer.isView(o)) return o;
  seen.add(o);
  for (const k of Object.keys(o)) deepFreeze(o[k], seen);
  return Object.freeze(o);
}

function makeStore(n, base = 0) {
  const s = {
    count: n, shapeVersion: 3,
    x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n),
    ox: new Float64Array(n), oy: new Float64Array(n), oz: new Float64Array(n),
    heat: new Float64Array(n), heatStamp: new Float64Array(n), active: new Uint8Array(n), patch: new Uint8Array(n),
    skinDirty: new Uint8Array(n)
  };
  for (let i = 0; i < n; i++) {
    s.x[i] = base + i * 15.25; s.y[i] = -i * 7.5; s.z[i] = 0; s.heat[i] = i * 0.01; s.heatStamp[i] = 1000 + i;
    s.ox[i] = base + i * 15; s.oy[i] = -i * 7.5;
    s.active[i] = i % 7 ? 1 : 0; s.patch[i] = i % 11 ? 0 : 1;
  }
  return s;
}

function makeShip(id, x, y, { n = 40, dirty = false, nozzles = 2 } = {}) {
  const store = makeStore(n, id * 1000);
  const beams = { count: n * 2, rest: new Float64Array(n * 2).fill(15), broken: new Uint8Array(n * 2) };
  const region = { store, dirty: new Int32Array([3, 9, 0, 0]), dirtyCount: dirty ? 2 : 0, dirtyAll: false };
  if (dirty) { store.skinDirty[3] = 1; store.skinDirty[9] = 1; }
  const body = {
    nodeStore: store, beamStore: beams, activeNodes: n - 6, meshDirty: dirty, isSleeping: !dirty, planar: true,
    cellSize: 15, latticeMin: { x: -100, y: -50 }, _boundsMinMax: new Float64Array([-1, -2, -3, 4, 5, 6]), _maxDisp: 0.5,
    _region: region, dead: false
  };
  const hull = {
    body, anchorDX: 1.5, anchorDY: -2, scale: 1.2, srcWidth: 400, srcHeight: 200, pivot: { x: 200, y: 100 },
    anchorMode: 'sprite', isFragment: false, dmgKey: `ród-${id}`
  };
  const main = [];
  for (let i = 0; i < nozzles; i++) main.push({ __throttle: 0.5 + i * 0.1, vfxScale: 1, nozzleDeg: 180 + i, baseDeg: 180, gimbalMinDeg: -10, gimbalMaxDeg: 10 });
  const e = {
    id, x, y, pos: { x, y }, angle: 0.25 * id, vel: { x: 10 * id, y: -3 }, vx: 10 * id, vy: -3, angVel: 0.01,
    radius: 120, w: 400, h: 200, dead: false,
    visual: { mainThrusters: main, torqueThrusters: [{ __throttle: 0, nozzleDeg: 90, baseDeg: 90 }] },
    thrusterInput: { main: 1, leftSide: 0, rightSide: 0.25, torque: -0.5 }, input: { main: 1, thrustY: 0 },
    shield: { max: 500, val: 420.5, state: 'active', activationProgress: 1, hardness: 2.5, show: 0, impacts: [{ id: 7 }] },
    beamHull: hull
  };
  hull.entity = e;
  return e;
}

function baseFrame(ents, opts = {}) {
  const f = createSnapshotFrame();
  Object.assign(f, {
    frameId: 1, frameDt: 1 / 60, alpha: 0.5, physDt: 1 / 60, sim: 10, simRender: 9.99, simRenderSim: 10,
    vfxTime: 3, bridgeTime: 2, wall: 12345.678, W: 1600, H: 900,
    cam: { x: 5_000_000.125, y: -7_000_000.5, zoom: 0.45 }, camNoShake: { x: 5_000_000, y: -7_000_000.5, zoom: 0.45 },
    cull: { x: 5_000_000, y: -7_000_000, halfW: 50000, halfH: 50000, drawHalfW: 2000, drawHalfH: 1200 },
    ship: ents[0], npcs: ents.slice(1), wrecks: [], coldWrecks: [], coldRenderList: [], stations: [], bullets: [],
    sun: { x: 0, y: 0, r: 9000 }, lastConsumed: -1
  }, opts);
  return f;
}

test('układ: obszary rozłączne, wyrównane, pola bez powtórzeń', () => {
  const L = createSnapshotLayout();
  const regs = Object.values(L.regions).sort((a, b) => a.offset - b.offset);
  for (let i = 0; i < regs.length; i++) {
    assert.equal(regs[i].offset % 8, 0);
    if (i) assert.ok(regs[i].offset >= regs[i - 1].offset + regs[i - 1].bytes);
  }
  assert.ok(L.pageBytes >= regs.at(-1).offset + regs.at(-1).bytes);
  assert.equal(HALL_WORDS > 100, true);
  for (const rec of [ENT, BODY, NOZZLE, SHOT, TURRET, STATION]) {
    for (const part of [rec.F64, rec.I32]) {
      const idx = Object.entries(part).filter(([k]) => k !== 'COUNT').map(([, v]) => v);
      assert.equal(new Set(idx).size, part.COUNT);
      assert.ok(idx.every((i) => i < part.COUNT));
    }
  }
  assert.equal(bodyNodeF64Words(10, true), 40);
  assert.equal(bodyNodeF64Words(10, false), 50);
});

test('pakowanie nie zapisuje do obiektów gry; strona odczytana z potrójnego bufora', () => {
  const ents = [makeShip(1, 5_000_000, -7_000_000, { dirty: true }), makeShip(2, 5_000_300, -7_000_100), makeShip(3, 5_000_600, -7_000_200)];
  const frame = baseFrame(ents);
  deepFreeze(ents);
  let reader = null;
  const packer = new SnapshotPacker({
    shared: false,
    onLayout: (buf, layout) => { reader = new TripleBufferReader(buf, { views: (b, off) => createSnapshotViews(b, off, layout) }); }
  });
  packer.begin(frame);
  packer.finish(frame);
  assert.ok(reader.acquire());
  const v = reader.page;
  const h = v.head;
  assert.equal(h[HEAD.K], 1);
  assert.equal(h[HEAD.CAM_X], 5_000_000.125, 'kamera w Float64 bez zaokrąglenia');
  // obrót kadru (hipercruise, 2026-10-23): brak pola = 0, wartość kamery klatki i kamery bez wstrząsu osobno
  assert.equal(h[HEAD.CAM_ROLL], 0);
  assert.equal(h[HEAD.CAMNS_ROLL], 0);
  frame.cam.roll = 1.25; frame.camNoShake.roll = -0.5;
  packer.begin(frame);
  packer.finish(frame);
  assert.ok(reader.acquire());
  assert.equal(reader.page.head[HEAD.CAM_ROLL], 1.25);
  assert.equal(reader.page.head[HEAD.CAMNS_ROLL], -0.5);
  delete frame.cam.roll; delete frame.camNoShake.roll;
  assert.equal(h[HEAD.FRAME_DT], 1 / 60);
  assert.ok(h[HEAD.FLAGS] & HEAD_FLAG.CULL_SET);
  assert.equal(v.listCount[LIST.RENDER], 3);
  const s0 = v.listData[LIST.RENDER * v.listStride];
  assert.equal(h[HEAD.PLAYER_SLOT], s0);
  const b = s0 * ENT.stride.f64, bi = s0 * ENT.stride.i32;
  assert.equal(v.entF64[b + ENT.F64.X], 5_000_000);
  assert.equal(v.entF64[b + ENT.F64.ANGLE], 0.25);
  assert.ok(Number.isNaN(v.entF64[b + ENT.F64.Z]), 'pole nieobecne = NaN');
  assert.equal(v.entF64[b + ENT.F64.SH_VAL], 420.5);
  assert.equal(v.entI32[bi + ENT.I32.SH_IMPACT_ID], 7);
  assert.ok(v.entI32[bi + ENT.I32.FLAGS] & ENT_FLAG.PLAYER);
  assert.ok(v.entI32[bi + ENT.I32.FLAGS] & ENT_FLAG.HAS_SHIELD);
  assert.equal(packer.dict.value(v.entI32[bi + ENT.I32.SH_STATE]), 'active');
  // dysze: 2 MAIN + 1 SIDE
  assert.equal(v.entI32[bi + ENT.I32.NOZ_N], 3);
  const n0 = v.entI32[bi + ENT.I32.NOZ_OFF];
  assert.equal(v.nozF64[(n0 + 1) * NOZZLE.stride.f64 + NOZZLE.F64.THROTTLE], 0.6);
  assert.equal(v.nozI32[(n0 + 2) * NOZZLE.stride.i32 + NOZZLE.I32.KIND], 1);
  // ciało: wszystkie trzy nowe (pierwsza klatka) — węzły skopiowane
  const bs = v.entI32[bi + ENT.I32.BODY_SLOT];
  const bb = bs * BODY.stride.i32;
  assert.equal(v.bodyI32[bb + BODY.I32.NODE_N], 40);
  const no = v.bodyI32[bb + BODY.I32.NODE_F64_OFF];
  assert.equal(v.nodeF64[no + 5], ents[0].beamHull.body.nodeStore.x[5]);
  assert.equal(v.nodeF64[no + 40 + 5], ents[0].beamHull.body.nodeStore.y[5]);
  assert.equal(v.nodeU8[v.bodyI32[bb + BODY.I32.NODE_U8_OFF] + 7], 0);
  assert.equal(v.bodyI32[bb + BODY.I32.BEAM_N], 80);
  const ro = v.bodyI32[bb + BODY.I32.REST_F64_OFF];
  assert.ok(ro >= 0, 'nowy magazyn — pozycje spoczynkowe na stronie');
  assert.equal(v.nodeF64[ro + 40 + 2], ents[0].beamHull.body.nodeStore.oy[2]);
  assert.equal(v.bodyI32[bb + BODY.I32.DIRTY_N], 2);
  const dOff = v.bodyI32[bb + BODY.I32.DIRTY_OFF];
  assert.deepEqual([v.nodeI32[dOff], v.nodeI32[dOff + 1]], [3, 9]);
  assert.equal(ents[0].beamHull.body.nodeStore.skinDirty[3], 1, 'tryb obserwacji (RW-10) — flagi gry nietknięte');
  assert.equal(v.bodyF64[bs * BODY.stride.f64 + BODY.F64.MAX_X], 4, '_boundsMinMax: [min xyz, max xyz]');
  assert.equal(packer.dict.value(v.bodyI32[bb + BODY.I32.DMG_KEY]), 'ród-1');
  assert.equal(packer.stats.bodiesPacked, 3);
});

test('NODES: tylko ciała zmienione po ostatniej klatce odebranej; pominięta strona nie gubi zmiany', () => {
  const ents = [makeShip(1, 0, 0, { dirty: true }), makeShip(2, 300, 0)];
  const packer = new SnapshotPacker({ shared: false });
  const frame = baseFrame(ents, { cam: { x: 0, y: 0, zoom: 1 }, cull: { x: 0, y: 0, halfW: 5000, halfH: 5000, drawHalfW: 800, drawHalfH: 450 } });
  // klatka 1: oba nowe
  frame.lastConsumed = 0;
  packer.begin(frame); packer.finish(frame);
  assert.equal(packer.stats.bodiesPacked, 2);
  // klatka 2: render odebrał 1; zmienione tylko ciało 1 (meshDirty)
  frame.lastConsumed = 1;
  packer.begin(frame); packer.finish(frame);
  assert.equal(packer.stats.bodiesPacked, 1);
  assert.equal(packer.stats.nodesPacked, 40);
  // ciało 1 się uspokaja; render nie odebrał stron 2 i 3 (lastConsumed = 1) — ciało 1 wciąż w NODES
  ents[0].beamHull.body.meshDirty = false;
  ents[0].beamHull.body._region.dirtyCount = 0;
  packer.begin(frame); packer.finish(frame);
  assert.equal(packer.stats.bodiesPacked, 1, 'zmiana z klatki 2 czeka, aż render odbierze stronę ≥ 2');
  frame.lastConsumed = 3;
  packer.begin(frame); packer.finish(frame);
  assert.equal(packer.stats.bodiesPacked, 0);
  // nowy magazyn (rozpad / odrost) = zmiana
  ents[1].beamHull.body.nodeStore = makeStore(30, 77);
  frame.lastConsumed = 4;
  packer.begin(frame); packer.finish(frame);
  assert.equal(packer.stats.bodiesPacked, 1);
  assert.equal(packer.stats.nodesPacked, 30);
  // poza pudłem rozgrzania — bez węzłów
  ents[1].beamHull.body.meshDirty = true;
  ents[1].pos.x = 900000; ents[1].x = 900000;
  frame.lastConsumed = 5;
  packer.begin(frame); packer.finish(frame);
  assert.equal(packer.stats.bodiesPacked, 0);
  // RW-11a: zmiana spoza pudła (i nowy magazyn — pozycje spoczynkowe) czeka na stronę z ciałem w pudle, choć ciało
  // już się nie zmienia (lustro bez zaległości: dawniej węzły i spoczynek z klatki poza pudłem przepadały)
  ents[1].beamHull.body.nodeStore = makeStore(30, 91);
  frame.lastConsumed = 6;
  packer.begin(frame); packer.finish(frame);
  assert.equal(packer.stats.bodiesPacked, 0);
  ents[1].beamHull.body.meshDirty = false;
  ents[1].pos.x = 0; ents[1].x = 0;
  frame.lastConsumed = 7;
  packer.begin(frame);
  const bsl = packer.ids.bodies.peek(ents[1].beamHull.body);
  const bi = bsl * BODY.stride.i32;
  assert.ok(packer.view.bodyI32[bi + BODY.I32.NODE_F64_OFF] >= 0, 'węzły z zaległej zmiany');
  assert.ok(packer.view.bodyI32[bi + BODY.I32.REST_F64_OFF] >= 0, 'pozycje spoczynkowe z zaległej zmiany');
  packer.finish(frame);
  assert.equal(packer.stats.bodiesPacked, 1);
  frame.lastConsumed = 8;
  packer.begin(frame); packer.finish(frame);
  assert.equal(packer.stats.bodiesPacked, 0, 'po wysłaniu — bez powtórek');
});

test('ciało znów w migawce po przerwie (ten sam magazyn, nowa generacja slotu) — topologia, węzły i spoczynek od nowa', () => {
  // Okręt ginie, wrak z TYM SAMYM ciałem powstaje krok później (rdzeń reaktora: detonacja w następnym kroku; przy 240 Hz
  // i fizyce 60 Hz to kilka klatek) — w klatkach przerwy ciała nie ma w listach, slot wraca do puli i ciało dostaje go
  // z nową generacją. Lustro renderu jest wtedy NOWE: bez topologii nie ma węzłów (wrak niewidoczny), a mostki 3D
  // w workerze rzucały wyjątek co klatkę i obraz stawał (audyt 2026-10-17).
  const a = makeShip(1, 0, 0), b = makeShip(2, 300, 0);
  // pola topologii (describeBodyTopology) — opisy encji i ciał jak w trybie worker
  for (const e of [a, b]) {
    const s = e.beamHull.body.nodeStore, m = e.beamHull.body.beamStore, n = s.count;
    s.ix = new Int32Array(n); s.iy = new Int32Array(n); s.iz = new Int32Array(n); s.adjStart = new Int32Array(n + 1); s.adj = new Int32Array(0);
    m.a = new Int32Array(m.count); m.b = new Int32Array(m.count); m.restBase = new Float64Array(m.count); m.type = new Uint8Array(m.count);
  }
  const packer = new SnapshotPacker({ shared: false, describe: true });
  const frame = baseFrame([a, b], { cam: { x: 0, y: 0, zoom: 1 }, cull: { x: 0, y: 0, halfW: 5000, halfH: 5000, drawHalfW: 800, drawHalfH: 450 } });
  const body = b.beamHull.body;
  frame.lastConsumed = 0;
  packer.begin(frame); packer.finish(frame);
  const bs0 = packer.ids.bodies.peek(body);
  const gen0 = packer.ids.bodies.gen(bs0);
  assert.equal(packer.topologies[bs0].gen, gen0);
  // przerwa: ciała nie ma w żadnej liście — slot zwolniony
  frame.npcs = [];
  frame.lastConsumed = 1;
  packer.begin(frame); packer.finish(frame);
  assert.equal(packer.ids.bodies.peek(body), -1);
  // wrak z tym samym ciałem
  frame.npcs = [b];
  frame.lastConsumed = 2;
  packer.begin(frame);
  const bs1 = packer.ids.bodies.peek(body);
  const gen1 = packer.ids.bodies.gen(bs1);
  assert.notEqual(gen1, gen0, 'nowa generacja slotu');
  assert.ok(packer.topoQueue.includes(bs1), 'topologia dla nowej generacji w kolejce strony');
  assert.equal(packer.topologies[bs1].gen, gen1);
  const bi = bs1 * BODY.stride.i32;
  assert.equal(packer.view.bodyI32[bi + BODY.I32.STORE_VER], packer.topologies[bs1].storeVer, 'wersja magazynu strony = topologii');
  assert.ok(packer.view.bodyI32[bi + BODY.I32.NODE_F64_OFF] >= 0, 'węzły na stronie');
  assert.ok(packer.view.bodyI32[bi + BODY.I32.REST_F64_OFF] >= 0, 'pozycje spoczynkowe na stronie');
  packer.finish(frame);
});

test('wersje konfiguracji rosną przy zmianie tożsamości źródła; poziom B odświeżany rotacyjnie', () => {
  const ents = [makeShip(1, 0, 0)];
  const packer = new SnapshotPacker({ shared: false });
  const frame = baseFrame(ents);
  packer.begin(frame); packer.finish(frame);
  const s = packer.ids.entities.peek(ents[0]);
  const ver = (k) => packer._ver[s * 6 + k];
  const v0 = [0, 1, 2, 3, 4, 5].map(ver);
  ents[0].visual = { ...ents[0].visual, mainThrusters: [...ents[0].visual.mainThrusters] };
  packer.begin(frame); packer.finish(frame);
  assert.equal(ver(0), v0[0] + 1, 'visual');
  assert.equal(ver(2), v0[2] + 1, 'układ dysz (podmiana tablicy)');
  assert.equal(ver(1), v0[1], 'kadłub bez zmian');
  ents[0].w = 999;
  let refreshed = false;
  for (let i = 0; i < TIER_B_PERIOD; i++) {
    packer.begin(frame); packer.finish(frame);
    if (packer._tierB[s * 5] === 999) { refreshed = true; break; }
  }
  assert.ok(refreshed, 'pole poziomu B odświeżone w ciągu okresu');
});

test('wzrost pojemności: nowy układ stron (generacja), dane zachowane; listy, pociski, wieże, pył hal', () => {
  const ents = [];
  for (let i = 0; i < 700; i++) ents.push(makeShip(i + 1, i * 10, 0, { n: 4, nozzles: 1 }));
  const bullets = [];
  for (let i = 0; i < 30; i++) bullets.push({ x: i, y: -i, vx: 1, vy: 2, life: 1, age: 0.5, vfxKey: 'yamato', type: 'rail', source: ents[3] });
  const hall = new Float64Array(HALL_WORDS + 4).fill(0.5);
  let layouts = 0, reader = null;
  const packer = new SnapshotPacker({
    shared: false,
    onLayout: (buf, layout) => { layouts++; reader = new TripleBufferReader(buf, { views: (b, off) => createSnapshotViews(b, off, layout) }); }
  });
  const frame = baseFrame(ents, { bullets, hall, cull: null });
  frame.turretsOf = (e) => (e === ents[2] ? [{ key: 'k1', uid: 'u1', weaponId: 'yamato', fxKey: 'Y', wx: 1, wy: 2, ang: 0.5, scale: 1, recoil: 0.1, shake: 0, spec: { r: 30 }, state: { housing: 0, barrel: 0.2, flash: 0 } }] : null);
  packer.begin(frame); packer.finish(frame);
  assert.ok(layouts >= 2, 'pojemność encji 512 przekroczona — nowy układ');
  assert.ok(reader.acquire());
  const v = reader.page;
  assert.equal(v.head[HEAD.LAYOUT_GEN], packer.layout.gen);
  assert.equal(v.listCount[LIST.RENDER], 700);
  assert.equal(v.head[HEAD.N_SHOTS], 30);
  assert.equal(packer.dict.value(v.shotI32[3 * SHOT.stride.i32 + SHOT.I32.VFX_KEY]), 'yamato');
  assert.equal(v.shotI32[3 * SHOT.stride.i32 + SHOT.I32.SOURCE_SLOT], packer.ids.entities.peek(ents[3]));
  assert.equal(v.head[HEAD.N_TURRETS], 1);
  assert.equal(v.turF64[TURRET.F64.BARREL], 0.2);
  assert.equal(v.turI32[TURRET.I32.ENT_SLOT], packer.ids.entities.peek(ents[2]));
  assert.equal(v.hall[HALL_WORDS - 1], 0.5);
  assert.equal(v.world[WORLD.DICT_N], packer.dict.values.length);
  const rep = packer.pageReport();
  assert.ok(rep.ent > 0 && rep.nodes > 0 && rep.total <= rep.pageBytes);
});

test('wieże z rekordów klatki (RW-26): te same rekordy co turretsOf, kolejność klatki, encje spoza list pominięte', () => {
  const ents = [makeShip(1, 0, 0), makeShip(2, 10, 0), makeShip(3, 20, 0)];
  const stranger = { x: 5, y: 5 };
  const mk = (e, k, b) => ({ entity: e, key: k, uid: 'u' + k, weaponId: 'tempest', fxKey: 'T', wx: b, wy: -b, ang: b * 0.1, scale: 1, recoil: 0, shake: 0.5, spec: { r: 12 }, state: { housing: 0.1, barrel: b, flash: 0 } });
  const recs = [mk(ents[2], 'a', 1), mk(ents[2], 'b', 2), mk(stranger, 'x', 9), mk(ents[0], 'c', 3)];
  const tf = { frameCount: recs.length, recordAt: (i) => recs[i] };
  const packA = new SnapshotPacker({ shared: false });
  const fA = baseFrame(ents, {});
  fA.turretFrame = tf;
  fA.turretsOf = () => { throw new Error('turretsOf nie może być wołane, gdy jest turretFrame'); };
  packA.begin(fA);
  const vA = packA.view;
  packA.finish(fA);
  assert.equal(vA.head[HEAD.N_TURRETS], 3);
  const packB = new SnapshotPacker({ shared: false });
  const fB = baseFrame(ents, {});
  fB.turretsOf = (e) => recs.filter((r) => r.entity === e);
  packB.begin(fB);
  const vB = packB.view;
  packB.finish(fB);
  const keyA = [], keyB = [];
  for (let i = 0; i < 3; i++) {
    keyA.push(packA.dict.value(vA.turI32[i * TURRET.stride.i32 + TURRET.I32.KEY]));
    keyB.push(packB.dict.value(vB.turI32[i * TURRET.stride.i32 + TURRET.I32.KEY]));
  }
  assert.deepEqual(keyA, ['a', 'b', 'c'], 'kolejność rekordów klatki');
  assert.deepEqual(keyA.slice().sort(), keyB.slice().sort(), 'ten sam zbiór co ścieżka turretsOf');
  for (let i = 0; i < 3; i++) {
    const j = keyB.indexOf(keyA[i]);
    for (let w = 0; w < TURRET.stride.f64; w++) assert.ok(Object.is(vA.turF64[i * TURRET.stride.f64 + w], vB.turF64[j * TURRET.stride.f64 + w]));
    assert.equal(vA.turI32[i * TURRET.stride.i32 + TURRET.I32.ENT_SLOT], packA.ids.entities.peek(recs.find((r) => r.key === keyA[i]).entity));
  }
});

test('mgła wojny: SEEN bez ukrytych; zimne wraki z ciałem w SEEN_COLD; stacje', () => {
  const ents = [makeShip(1, 0, 0), makeShip(2, 10, 0), makeShip(3, 20, 0)];
  const cold = deepFreeze({ isCold: true, dead: false, beamHull: ents[2].beamHull, x: 0, y: 0 });
  const st = deepFreeze({ x: 1, y: 2, angle: 0, r: 500, baseR: 400, ringPort: true });
  const packer = new SnapshotPacker({ shared: false });
  const frame = baseFrame(ents, { fog: true, hides: (e) => e === ents[1], coldRenderList: [cold], stations: [st] });
  packer.begin(frame); packer.finish(frame);
  assert.equal(packer._lists[LIST.RENDER].length, 3);
  assert.equal(packer._lists[LIST.SEEN].length, 2);
  assert.equal(packer._lists[LIST.SEEN_COLD].length, 3);
  assert.equal(packer._lists[LIST.STATIONS].length, 1);
  assert.equal(packer.stats.stations, 1);
});

test('soczewka skoku (E2, W3): zimny wrak zastąpiony smugą soczewki — bez dodatków (COLD_NEAR), pozostałe zostają', () => {
  const ents = [makeShip(1, 0, 0), makeShip(2, 10, 0), makeShip(3, 20, 0)];
  const coldDot = { isCold: true, dead: false, beamHull: ents[1].beamHull, x: 0, y: 0, __lensDot: true };
  const coldNear = { isCold: true, dead: false, beamHull: ents[2].beamHull, x: 0, y: 0, __lensDot: false };
  const packer = new SnapshotPacker({ shared: false });
  const frame = baseFrame([ents[0]], { lensDots: true, hides: () => false, coldRenderList: [coldDot, coldNear] });
  packer.begin(frame); packer.finish(frame);
  assert.deepEqual(packer._lists[LIST.COLD_NEAR], [coldNear], 'w skoku tylko wrak bez kropki');
  // poza skokiem flaga nie liczy się (strona zdejmuje ją i tak — withColdNearWrecks)
  const frame2 = baseFrame([ents[0]], { lensDots: false, coldRenderList: [coldDot, coldNear] });
  packer.begin(frame2); packer.finish(frame2);
  assert.equal(packer._lists[LIST.COLD_NEAR].length, 2);
});

test('worker (consumeDirty: odbior): brud skóry zdejmowany dopiero po odbiorze strony — pominięta strona nie gubi węzłów', () => {
  // Worker bierze NAJNOWSZĄ stronę: strona k z listą brudnych węzłów bywa pominięta. Dawniej lista wychodziła raz (flagi
  // gry zerowane przy pakowaniu) — przy pominięciu worker dostawał węzły bez ich numerów na liście i nie przepisywał
  // tych czworokątów skóry (stare kawałki kadłuba, dziury bez zmian). Teraz lista narasta do potwierdzenia odbioru.
  const ents = [makeShip(1, 0, 0, { dirty: true })];
  const packer = new SnapshotPacker({ shared: false });
  const frame = baseFrame(ents, { cam: { x: 0, y: 0, zoom: 1 }, cull: { x: 0, y: 0, halfW: 5000, halfH: 5000, drawHalfW: 800, drawHalfH: 450 } });
  const body = ents[0].beamHull.body, st = body.nodeStore, reg = body._region;
  const dirtyOf = () => {
    const bs = packer.ids.bodies.peek(body), bi = bs * BODY.stride.i32, v = packer.view;
    const n = v.bodyI32[bi + BODY.I32.DIRTY_N], o = v.bodyI32[bi + BODY.I32.DIRTY_OFF];
    return { list: n > 0 ? Array.from(v.nodeI32.subarray(o, o + n)) : [], flags: v.bodyI32[bi + BODY.I32.FLAGS] };
  };
  frame.consumeDirty = 'odbior';
  // strona 1: brud {3, 9}
  frame.lastConsumed = 0;
  packer.begin(frame);
  assert.deepEqual(dirtyOf().list, [3, 9]);
  assert.ok(dirtyOf().flags & BODY_FLAG.MESH_DIRTY);
  packer.finish(frame);
  assert.equal(st.skinDirty[3], 1, 'flagi gry czekają na odbiór');
  // strona 2: worker pominął stronę 1 (lastConsumed = 0); nowy brud {12}
  st.skinDirty[12] = 1; reg.dirty[reg.dirtyCount++] = 12; body.meshDirty = true;
  packer.begin(frame);
  assert.deepEqual(dirtyOf().list, [3, 9, 12], 'strona 2 niesie też brud pominiętej strony 1');
  assert.ok(dirtyOf().flags & BODY_FLAG.MESH_DIRTY);
  packer.finish(frame);
  // worker odebrał stronę 2 — brud zdjęty, flagi gry wolne, następna strona bez węzłów
  frame.lastConsumed = 2;
  packer.begin(frame);
  assert.equal(reg.dirtyCount, 0);
  assert.equal(st.skinDirty[3] + st.skinDirty[9] + st.skinDirty[12], 0);
  assert.equal(packer.stats.bodiesPacked, 0);
  packer.finish(frame);
  // dirtyAll: flaga na każdej stronie do odbioru, potem znaczniki od nowa (węzły z listy po potwierdzeniu zostają)
  reg.dirtyAll = true; st.skinDirty[5] = 1; reg.dirty[reg.dirtyCount++] = 5;
  frame.lastConsumed = 3;
  packer.begin(frame);
  assert.ok(dirtyOf().flags & BODY_FLAG.DIRTY_ALL);
  packer.finish(frame);
  packer.begin(frame);
  assert.ok(dirtyOf().flags & BODY_FLAG.DIRTY_ALL, 'strona 4 nieodebrana — flaga dalej');
  packer.finish(frame);
  st.skinDirty[7] = 1; reg.dirty[reg.dirtyCount++] = 7;   // zmiana po stronie 5 (nieodebranej)
  frame.lastConsumed = 5;
  packer.begin(frame);
  assert.equal(dirtyOf().flags & BODY_FLAG.DIRTY_ALL, 0, 'odebrano stronę z pełnym przepisaniem');
  assert.equal(st.skinDirty[5], 0);
  assert.equal(st.skinDirty[7], 1, 'węzeł zmieniony po odebranej stronie zostaje na liście');
  assert.deepEqual(dirtyOf().list, [7]);
  packer.finish(frame);
});

test('lustra (consumeDirty): flagi brudu gry zerowane po spakowaniu; pozycje spoczynkowe po zmianie kształtu', () => {
  const ents = [makeShip(1, 0, 0, { dirty: true })];
  const packer = new SnapshotPacker({ shared: false });
  const frame = baseFrame(ents, { cam: { x: 0, y: 0, zoom: 1 }, cull: { x: 0, y: 0, halfW: 5000, halfH: 5000, drawHalfW: 800, drawHalfH: 450 } });
  const body = ents[0].beamHull.body, st = body.nodeStore;
  frame.consumeDirty = true;
  frame.lastConsumed = 0;
  packer.begin(frame); packer.finish(frame);
  assert.equal(packer.stats.bodiesPacked, 1);
  assert.equal(st.skinDirty[3], 0);
  assert.equal(st.skinDirty[9], 0);
  assert.equal(body._region.dirtyCount, 0);
  assert.equal(body.meshDirty, false);
  // nic nowego — bez węzłów
  frame.lastConsumed = 1;
  packer.begin(frame); packer.finish(frame);
  assert.equal(packer.stats.bodiesPacked, 0);
  // przesunięcie początku ciała: shapeVersion + dirtyAll → węzły, spoczynek i bez listy (dirtyAll)
  st.shapeVersion++;
  body._region.dirtyAll = true;
  frame.lastConsumed = 2;
  packer.begin(frame);
  const v = packer.view;
  const bs = packer.ids.bodies.peek(body);
  const bi = bs * BODY.stride.i32;
  assert.ok(v.bodyI32[bi + BODY.I32.REST_F64_OFF] >= 0);
  assert.equal(v.bodyI32[bi + BODY.I32.DIRTY_N], 0);
  assert.ok(v.bodyI32[bi + BODY.I32.FLAGS] & BODY_FLAG.DIRTY_ALL);
  packer.finish(frame);
  assert.equal(body._region.dirtyAll, false);
});

test('bloki modułów (RW-11c): rejestracja, pakowanie w fazie, widoki strony u czytelnika, zmiana rozmiaru', () => {
  let reader = null;
  const packer = new SnapshotPacker({
    shared: false,
    onLayout: (buf, layout) => { reader = new TripleBufferReader(buf, { views: (b, off) => createSnapshotViews(b, off, layout) }); }
  });
  packer.addBlock({ name: 'ring', f64: 8, i32: 4, phase: 'begin', pack: (blk, f) => { blk.f64[0] = f.sim; blk.i32[1] = 7; } });
  packer.addBlock({ name: 'pas', u8: 16, phase: 'finish', pack: (blk) => { blk.u8[15] = 9; } });
  assert.throws(() => packer.addBlock({ name: 'ring', pack() {} }), /dwa razy/);
  const frame = baseFrame([makeShip(1, 0, 0)], { sim: 12.5 });
  packer.begin(frame); packer.finish(frame);
  assert.ok(reader.acquire());
  assert.equal(reader.page.blocks.ring.f64[0], 12.5);
  assert.equal(reader.page.blocks.ring.i32[1], 7);
  assert.equal(reader.page.blocks.pas.u8[15], 9);
  packer.resizeBlock('ring', { f64: 64 });
  packer.begin(frame); packer.finish(frame);
  assert.ok(reader.acquire());
  assert.equal(reader.page.blocks.ring.f64.length, 64);
  assert.equal(reader.page.blocks.ring.f64[0], 12.5);
});

test('poza renderu z frame.poseOf (RW-31: holownik pod graczem) — w ENT, encja nietknięta', () => {
  const ents = [makeShip(1, 5_000_000, -7_000_000), makeShip(2, 5_000_300, -7_000_100)];
  const tug = ents[1];
  const frame = baseFrame(ents, { poseOf: (e, out) => { if (e !== tug) return false; out.x = 5_000_123.5; out.y = -7_000_456.25; out.a = 1.25; return true; } });
  deepFreeze(ents);
  let reader = null;
  const packer = new SnapshotPacker({ shared: false, onLayout: (buf, layout) => { reader = new TripleBufferReader(buf, { views: (b, off) => createSnapshotViews(b, off, layout) }); } });
  packer.begin(frame);
  packer.finish(frame);
  assert.ok(reader.acquire());
  const v = reader.page;
  const slotOf = (e) => packer.ids.entities.peek(e);
  const t = slotOf(tug) * ENT.stride.f64, p = slotOf(ents[0]) * ENT.stride.f64;
  assert.equal(v.entF64[t + ENT.F64.X], 5_000_123.5);
  assert.equal(v.entF64[t + ENT.F64.POS_Y], -7_000_456.25);
  assert.equal(v.entF64[t + ENT.F64.ANGLE], 1.25);
  assert.equal(v.entF64[t + ENT.F64.VX], 20, 'prędkość z fizyki');
  assert.equal(v.entF64[p + ENT.F64.X], 5_000_000, 'reszta encji — pola encji');
  assert.equal(tug.x, 5_000_300);
});
