import test from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from 'three';
import { DestructorSystem } from '../src/game/destructor.js';
import {
  attachShipCores,
  updateShipCores,
  forceCoreMeltdown,
  getCoreWorld,
  CORE_STATE,
  CORE_PROBE_CONFIG
} from '../src/game/shipCore.js';
import { CORE_FX_BANDS, CORE_FX_LAYER } from '../src/3d/coreBands.js';
import { REACTOR3D_KINDS, REACTOR3D_MAT, buildReactorModel } from '../src/3d/reactor3DShapes.js';
import { REACTOR3D_TUNE, createReactor3D, resolveReactorKind } from '../src/3d/reactor3D.js';
import { makeDestructorHull } from './helpers/destructorHull.mjs';

const MODELS = Object.fromEntries(REACTOR3D_KINDS.map((k) => [k, buildReactorModel(k)]));
// uCoilAng/uCoilCode w shaderze plazmy (reactor3D.js MAX_COILS)
const SHADER_MAX_COILS = 32;

// Kadłub w skali renderu 0,5 (PNG 640×240 → siatka 320×120), rdzeń w środku.
function coredHull(hullOpts = {}) {
  const e = makeDestructorHull({ width: 320, height: 120, maxHp: 12000, hp: 12000, radius: 260, ...hullOpts });
  const cores = attachShipCores(e, [{ id: 'r', x: 0, y: 0, r: 40, armorMul: 3 }], { pngWidth: 640, pngHeight: 240, classId: 'capital' });
  return { e, core: cores[0] };
}

function run(entity, seconds, time0 = 0) {
  const step = CORE_PROBE_CONFIG.probeEverySec / 4;
  let t = time0;
  for (let acc = 0; acc < seconds; acc += step) {
    t += step;
    updateShipCores(entity, step, { time: t, entities: [entity], events: [] });
  }
}

// Pierwszy heks komory martwy → ODSŁONIĘTY (jak w shipCore.test).
function exposedHull(hullOpts) {
  const h = coredHull(hullOpts);
  DestructorSystem.destroyShard(h.e, h.core.chamber[0]);
  run(h.e, 0.2);
  assert.equal(h.core.state, CORE_STATE.EXPOSED);
  return h;
}

function makeRuntime(opts = {}) {
  const scene = new THREE.Scene();
  let marks = 0;
  const r3 = createReactor3D({ scene, markLayerActive: () => { marks++; }, ...opts });
  return { scene, r3, marks: () => marks };
}

function attr(r3, kind, name) {
  return r3.meshes[kind].structure.geometry.attributes[name].array;
}

test('kształty: każdy rodzaj w promieniu komory, dach z ≤ 0, podłoga ≥ −1, normalne jednostkowe', () => {
  for (const kind of REACTOR3D_KINDS) {
    const m = MODELS[kind];
    const pos = m.structure.attributes.position.array;
    const nor = m.structure.attributes.normal.array;
    const mat = m.structure.attributes.aMat.array;
    assert.equal(pos.length % 9, 0, `${kind}: konstrukcja to całe trójkąty`);
    assert.equal(m.structure.attributes.aCoil.count, pos.length / 3);
    assert.equal(m.structure.attributes.aAng.count, pos.length / 3);
    for (let i = 0; i < pos.length; i += 3) {
      const r = Math.hypot(pos[i], pos[i + 1]);
      // +1%: narożnik łaty na grodzi piratów wystaje o włos (prowizorka)
      assert.ok(r <= 1.01, `${kind}: wierzchołek poza komorą (r = ${r})`);
      assert.ok(pos[i + 2] <= 0 && pos[i + 2] >= -1.0001, `${kind}: z poza [−1, 0] (${pos[i + 2]})`);
      assert.ok(Math.abs(Math.hypot(nor[i], nor[i + 1], nor[i + 2]) - 1) < 1e-4, `${kind}: normalna nie jednostkowa`);
    }
    for (const v of mat) assert.ok(Number.isInteger(v) && v >= 0 && v <= REACTOR3D_MAT.accent, `${kind}: zły materiał ${v}`);
    // plazma: wierzchołek = środek rury + normalna × promień rury, cała pod dachem
    const P = m.plasma.attributes;
    assert.ok(m.plasma.index && m.plasma.index.count % 3 === 0, `${kind}: plazma z indeksami`);
    for (let i = 0; i < P.position.count; i++) {
      for (let k = 0; k < 3; k++) {
        const want = P.aCenter.array[i * 3 + k] + P.normal.array[i * 3 + k] * P.aTube.array[i];
        assert.ok(Math.abs(P.position.array[i * 3 + k] - want) < 1e-5, `${kind}: rura plazmy rozjechana`);
      }
      assert.ok(P.position.array[i * 3 + 2] < 0, `${kind}: plazma nad dachem`);
    }
  }
});

test('kształty: cewki — tokamak 16, piraci 11 (jednej brak, ósma podwójna), Atlas 20 + 12; mieszczą się w shaderze', () => {
  const count = (m) => m.coils.length;
  assert.equal(count(MODELS.terran), 16);
  assert.equal(count(MODELS.pirate), 11);
  assert.equal(count(MODELS.atlas), 32);
  for (const kind of REACTOR3D_KINDS) {
    const m = MODELS[kind];
    assert.ok(m.coilCount <= SHADER_MAX_COILS, `${kind}: więcej cewek niż uCoilAng`);
    assert.equal(m.coilRing.length, m.coils.length);
    const coil = m.structure.attributes.aCoil.array;
    const mat = m.structure.attributes.aMat.array;
    const byCoil = new Map();
    for (let i = 0; i < coil.length; i++) {
      if (mat[i] !== REACTOR3D_MAT.coil) continue;
      byCoil.set(coil[i], (byCoil.get(coil[i]) || 0) + 1);
    }
    for (let k = 0; k < m.coils.length; k++) {
      const missing = m.coilRing[k] >= 10;
      assert.equal(byCoil.has(k), !missing, `${kind}: cewka ${k} ${missing ? 'miała zniknąć' : 'bez geometrii'}`);
    }
  }
  assert.deepEqual(MODELS.pirate.coilRing.map((c, k) => (c >= 10 ? k : -1)).filter((k) => k >= 0), [5]);
  // ósma pirata: dwie połówki = dwa razy więcej wierzchołków niż zwykła
  const pc = MODELS.pirate.structure.attributes.aCoil.array;
  const pm = MODELS.pirate.structure.attributes.aMat.array;
  const verts = (k) => pc.filter((c, i) => c === k && pm[i] === REACTOR3D_MAT.coil).length;
  assert.equal(verts(8), verts(7) * 2);
  assert.deepEqual([...new Set(MODELS.atlas.coilRing)].sort(), [0, 1]);
  assert.deepEqual([...new Set(MODELS.atlas.plasma.attributes.aRing.array)].sort(), [0, 1, 2]);
});

test('kształty: dachy cewek nad szczytem rury plazmy (cewki ją przykrywają, między nimi ją widać)', () => {
  for (const kind of REACTOR3D_KINDS) {
    const m = MODELS[kind];
    const pos = m.structure.attributes.position.array;
    const nor = m.structure.attributes.normal.array;
    const mat = m.structure.attributes.aMat.array;
    const ring = m.plasma.attributes.aRing.array;
    const pz = m.plasma.attributes.position.array;
    let plasmaTop = -Infinity;
    for (let i = 0; i < ring.length; i++) if (ring[i] < 1.5) plasmaTop = Math.max(plasmaTop, pz[i * 3 + 2]);
    let lowestCoilRoof = Infinity;
    for (let i = 0; i < mat.length; i++) {
      if (mat[i] === REACTOR3D_MAT.coil && nor[i * 3 + 2] > 0.99) lowestCoilRoof = Math.min(lowestCoilRoof, pos[i * 3 + 2]);
    }
    assert.ok(lowestCoilRoof > plasmaTop + 0.05, `${kind}: dach cewki ${lowestCoilRoof} pod szczytem rury ${plasmaTop}`);
  }
});

test('kształty: deterministyczne (prowizorka piratów bez Math.random)', () => {
  for (const kind of REACTOR3D_KINDS) {
    const a = buildReactorModel(kind).structure.attributes.position.array;
    assert.deepEqual(Array.from(a), Array.from(MODELS[kind].structure.attributes.position.array), kind);
  }
});

test('rodzaj modelu: gracz → atlas, piraci po kadłubie albo frakcji → pirate, reszta → terran', () => {
  assert.equal(resolveReactorKind({ host: { isPlayer: true } }), 'atlas');
  assert.equal(resolveReactorKind({ host: { __hullId: 'atlas' } }), 'atlas');
  assert.equal(resolveReactorKind({ host: { __hullId: 'pirate_battleship' } }), 'pirate');
  assert.equal(resolveReactorKind({ host: { type: 'battleship', faction: 'pirates' } }), 'pirate');
  assert.equal(resolveReactorKind({ host: { __hullId: 'battleship' } }), 'terran');
  assert.equal(resolveReactorKind({}), 'terran');
});

test('runtime: 2 meshe na rodzaj na warstwie 7, ukryte, dopóki rdzeń jest NOMINALNY', () => {
  const { scene, r3, marks } = makeRuntime();
  const { core } = coredHull();
  assert.deepEqual(r3.kinds, [...REACTOR3D_KINDS]);
  const meshes = scene.children.filter((o) => o.name.startsWith('reactor3D:'));
  assert.equal(meshes.length, REACTOR3D_KINDS.length * 2);
  for (const m of meshes) {
    assert.ok(m.layers.isEnabled(CORE_FX_LAYER) && !m.layers.isEnabled(0), `${m.name}: nie na warstwie ${CORE_FX_LAYER}`);
    assert.equal(m.visible, false);
  }
  assert.equal(r3.layer, CORE_FX_LAYER);
  assert.equal(r3.sync([core], 0, 1 / 60), 0);
  assert.equal(r3.stats.instances, 0);
  assert.equal(marks(), 0, 'pusta warstwa nie może być zgłaszana');
  for (const m of meshes) assert.equal(m.visible, false);
});

test('runtime: ODSŁONIĘTY → jedna instancja tokamaka, 2 wywołania, zgłoszona warstwa, pasma HDR jak żar', () => {
  const { r3, marks } = makeRuntime();
  const { core } = exposedHull();
  assert.equal(r3.sync([core], 0, 1 / 60), 2);
  assert.equal(r3.stats.instances, 1);
  assert.equal(marks(), 1);
  const t = r3.meshes.terran;
  assert.equal(t.structure.visible, true);
  assert.equal(t.plasma.visible, true);
  assert.equal(t.structure.geometry.instanceCount, 1);
  assert.equal(r3.meshes.atlas.structure.visible, false);
  const st = attr(r3, 'terran', 'iState');
  assert.equal(st[0], Math.fround(CORE_FX_BANDS.bodyL.exposed), 'ciało plazmy w paśmie barwy (pod progiem bloomu)');
  assert.ok(st[1] >= CORE_FX_BANDS.coreL.exposed * 0.919 && st[1] <= CORE_FX_BANDS.coreL.exposed * 1.0001, 'biel 8–12 z pulsem');
  assert.equal(attr(r3, 'terran', 'iBreak')[3], -1, 'żywy reaktor');
  assert.equal(attr(r3, 'terran', 'iPos')[2], Math.fround(REACTOR3D_TUNE.zTop), 'dach modelu pod kadłubem');
  assert.equal(attr(r3, 'terran', 'iState2')[3], 1, 'plazma obecna');
  assert.equal(r3.covers(core), true);
});

test('runtime: stopienie przyspiesza plazmę, rozlewa rurę i grzeje cewki', () => {
  const { r3 } = makeRuntime();
  const { core } = exposedHull();
  r3.sync([core], 0, 1 / 60);
  const exposedInst = attr(r3, 'terran', 'iState')[3];
  forceCoreMeltdown(core, 0.2);
  core.meltdownRemaining = core.meltdownDuration * 0.2; // 80% odliczania
  r3.sync([core], 0, 1 / 60);
  const st = attr(r3, 'terran', 'iState');
  const st2 = attr(r3, 'terran', 'iState2');
  assert.ok(st[3] > exposedInst + 0.4, 'niestabilność rury w stopieniu');
  assert.ok(st2[0] >= 0.25, 'cewki żarzą się');
  assert.ok(st[0] > CORE_FX_BANDS.bodyL.critical && st[0] <= CORE_FX_BANDS.bodyL.meltdown + 1e-6);
  assert.ok(st[0] < 0.9, 'ciało plazmy zostaje pod progiem bloomu');
});

test('runtime: kindFor gry wybiera model; prześwietlenie pokazuje NOMINALNY rdzeń nad kadłubem', () => {
  const { r3 } = makeRuntime({ kindFor: () => 'atlas' });
  const { core } = coredHull();
  r3.debug.xray = true;
  r3.sync([core], 0, 1 / 60);
  assert.equal(r3.meshes.atlas.structure.geometry.instanceCount, 1);
  assert.equal(r3.meshes.terran.structure.visible, false);
  assert.ok(attr(r3, 'atlas', 'iPos')[2] > 0, 'x-ray: model nad kadłubem (z > 0)');
  r3.debug.xray = false;
  r3.sync([core], 0, 1 / 60);
  assert.equal(r3.stats.instances, 0);
  r3.debug.enabled = false;
  assert.equal(r3.covers(core), false, 'wyłączony model nie zabiera żaru coreFx3D');
});

test('precyzja: przy 8 mln j. instancja jest względem początku przy kamerze, początek w mesh.position', () => {
  const X = 8e6;
  const Y = 6e6;
  const { r3 } = makeRuntime();
  const { core } = exposedHull({ x: X, y: Y });
  const w = getCoreWorld(core, {});
  const cam = { x: X + 350, y: Y - 120 };
  r3.sync([core], 0, 1 / 60, { origin: cam });
  const pos = attr(r3, 'terran', 'iPos');
  const mesh = r3.meshes.terran.structure;
  assert.ok(Math.abs(pos[0]) < 1000 && Math.abs(pos[1]) < 1000, 'w atrybucie małe liczby');
  assert.equal(mesh.position.x, cam.x);
  assert.equal(mesh.position.y, -cam.y, 'scena ma odwrócone y');
  assert.equal(mesh.matrixWorld.elements[12], cam.x, 'macierz świata odświeżona od razu');
  assert.equal(r3.meshes.terran.plasma.position.x, cam.x);
  // odtworzenie w double: początek + atrybut = środek rdzenia w scenie
  assert.ok(Math.abs(mesh.position.x + pos[0] - w.x) < 1e-3);
  assert.ok(Math.abs(mesh.position.y + pos[1] + w.y) < 1e-3);
  // sceneOrigin (układ sceny, jak sceneOriginNearCamera) = ten sam początek
  r3.sync([core], 0, 1 / 60, { sceneOrigin: { x: cam.x, y: -cam.y } });
  assert.equal(mesh.position.x, cam.x);
  assert.equal(mesh.position.y, -cam.y);
  assert.ok(Math.abs(mesh.position.y + attr(r3, 'terran', 'iPos')[1] + w.y) < 1e-3);
  // bez początku z gry — pierwszy widoczny rdzeń
  r3.sync([core], 0, 1 / 60);
  assert.equal(attr(r3, 'terran', 'iPos')[0], 0);
  assert.ok(Math.abs(mesh.position.x - w.x) < 1e-6);
});

test('detonacja: wyrzut zostawia wrak reaktora (łuk w kierunku strzału), plazma gaśnie, żar stygnie', () => {
  const { r3 } = makeRuntime();
  const { core } = exposedHull();
  r3.sync([core], 0, 1 / 60);
  core.state = CORE_STATE.DETONATED;
  r3.detonated(core, { variant: 'jet', dirGridX: 0.6, dirGridY: -0.8 });
  r3.sync([core], 0, 0.1);
  assert.equal(r3.stats.instances, 1);
  assert.equal(r3.stats.burnt, 1);
  const br = attr(r3, 'terran', 'iBreak');
  assert.ok(Math.abs(br[0] - 0.6) < 1e-6 && Math.abs(br[1] + 0.8) < 1e-6);
  assert.ok(Math.abs(br[2] - 0.42) < 1e-6, 'wyrwany łuk');
  assert.ok(br[3] > 0.9 && br[3] <= 1, 'świeży wrak gorący');
  assert.ok(attr(r3, 'terran', 'iState2')[3] > 0, 'plazma jeszcze gaśnie');
  r3.sync([core], 0, 0.3);
  assert.equal(attr(r3, 'terran', 'iState2')[3], 0, `plazma zgasła po ${REACTOR3D_TUNE.plasmaOut} s`);
  r3.sync([core], 0, 10);
  assert.ok(attr(r3, 'terran', 'iBreak')[3] < 0.02, 'żar wystygł');
  assert.equal(r3.stats.instances, 1, 'wrak reaktora zostaje, dopóki jest kadłub');
});

test('detonacja: kula zostawia wrak bez łuku; pozostałe warianty wyparowują model', () => {
  const { r3 } = makeRuntime();
  const a = exposedHull();
  const b = exposedHull();
  r3.sync([a.core, b.core], 0, 1 / 60);
  assert.equal(r3.stats.instances, 2);
  a.core.state = CORE_STATE.DETONATED;
  b.core.state = CORE_STATE.DETONATED;
  r3.detonated(a.core, { variant: 'orb' });
  r3.detonated(b.core, { variant: 'shatter' });
  r3.sync([a.core, b.core], 0, 1 / 60);
  assert.equal(r3.stats.instances, 1);
  assert.equal(attr(r3, 'terran', 'iBreak')[2], 0, 'kula nie wyrywa łuku');
  assert.equal(r3.records.has(b.core), false);
  // kadłub zniknął (nie wrak) → wrak reaktora też
  a.e.dead = true;
  r3.sync([a.core], 0, 1 / 60);
  assert.equal(r3.stats.instances, 0);
  assert.equal(r3.records.size, 0);
});

// spawnWreckEntity rysuje cache i sięga po pulę wraków — minimalne stuby jak
// w bridge3D.test (tylko raster; siatka i heksy są produkcyjne).
function withWreckStubs(run) {
  const oldDocument = globalThis.document;
  const oldWindow = globalThis.window;
  const oldQueue = DestructorSystem.splitQueue;
  const oldPool = DestructorSystem._wreckPool;
  try {
    globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage() {} }) }) };
    globalThis.window = { wrecks: [] };
    DestructorSystem.splitQueue = [];
    DestructorSystem._wreckPool = [];
    run();
  } finally {
    DestructorSystem.splitQueue = oldQueue;
    DestructorSystem._wreckPool = oldPool;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
  }
}

test('wrak reaktora przechodzi na obiekt wraku ze spawnWreckEntity (gra: zabity NPC oddaje heksy)', () => {
  withWreckStubs(() => {
    const { r3 } = makeRuntime();
    const { e, core } = exposedHull({ x: 1200, y: -800, angle: 0.7 });
    r3.sync([core], 0, 1 / 60);
    const before = getCoreWorld(core, {});
    core.state = CORE_STATE.DETONATED;
    const live = e.hexGrid.shards.filter((s) => s.active && !s.isDebris);
    const wreck = DestructorSystem.spawnWreckEntity(e, live, null);
    assert.ok(wreck?.hexGrid, 'wrak z siatką');
    e.dead = true; // NPC po zabiciu — bez przejścia wrak reaktora by zniknął
    r3.detonated(core, { variant: 'jet', dirGridX: 1, dirGridY: 0, host: wreck });
    r3.sync([core], 0, 1 / 60, { origin: { x: 0, y: 0 } });
    assert.equal(r3.stats.burnt, 1);
    const pos = attr(r3, 'terran', 'iPos');
    // ta sama siatka rodzica, inny pivot — model stoi tam, gdzie stał reaktor
    assert.ok(Math.abs(pos[0] - before.x) < 1e-3 && Math.abs(pos[1] + before.y) < 1e-3, `model przesunięty: ${pos[0]}, ${pos[1]} vs ${before.x}, ${-before.y}`);
    // rehost na kolejny obiekt; nieznany rdzeń → false
    assert.equal(r3.rehost(core, wreck), true);
    assert.equal(r3.rehost({}, wreck), false);
    // zimny wrak (siatka w _coldSnapshot): nie rysuje, rekord czeka na odmrożenie
    const grid = wreck.hexGrid;
    wreck.hexGrid = null;
    r3.sync([core], 0, 1 / 60);
    assert.equal(r3.stats.instances, 0);
    assert.equal(r3.records.has(core), true, 'zimny wrak nie kasuje wraku reaktora');
    wreck.hexGrid = grid;
    r3.sync([core], 0, 1 / 60);
    assert.equal(r3.stats.burnt, 1, 'po odmrożeniu wrak reaktora wraca');
    // recycleWreck: obiekt idzie do puli i wróci jako INNY wrak — rekord znika
    wreck._inPool = true;
    r3.sync([core], 0, 1 / 60);
    assert.equal(r3.stats.instances, 0);
    assert.equal(r3.records.has(core), false, 'wrak z puli nie może nieść cudzego reaktora');
  });
});

test('reset czyści wraki reaktorów, dispose zdejmuje meshe ze sceny', () => {
  const { scene, r3 } = makeRuntime();
  const { core } = exposedHull();
  r3.sync([core], 0, 1 / 60);
  core.state = CORE_STATE.DETONATED;
  r3.detonated(core, { variant: 'jet', dirGridX: 1, dirGridY: 0 });
  r3.reset();
  r3.sync([core], 0, 1 / 60);
  assert.equal(r3.stats.instances, 0);
  r3.dispose();
  assert.equal(scene.children.filter((o) => o.name.startsWith('reactor3D:')).length, 0);
});
