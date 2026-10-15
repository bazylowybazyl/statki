// RW-11a: lustra encji (src/render/renderMirror.js) z migawki i opisów (src/render/describeEntity.js) — pola, które czyta
// ścieżka kadłubów i dysz, równe polom obiektu gry; stała tożsamość lustra, dysz i obiektów zagnieżdżonych.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotPacker, createSnapshotFrame } from '../src/render/snapshotPack.js';
import { RenderMirror } from '../src/render/renderMirror.js';
import { LIST } from '../src/render/snapshotLayout.js';

function makeStore(n) {
  const f = () => new Float64Array(n), i = () => new Int32Array(n), u = () => new Uint8Array(n);
  const s = { count: n, shapeVersion: 1, x: f(), y: f(), z: f(), ox: f(), oy: f(), oz: f(), heat: f(), heatStamp: f(),
    ix: i(), iy: i(), iz: i(), active: u().fill(1), patch: u(), skinDirty: u(), adjStart: new Int32Array(n + 1), adj: new Int32Array(0) };
  for (let k = 0; k < n; k++) { s.ix[k] = k % 5; s.iy[k] = (k / 5) | 0; s.x[k] = s.ox[k] = k * 15; s.y[k] = s.oy[k] = k; }
  return s;
}

function makeShip(name, x) {
  const store = makeStore(20);
  const beams = { count: 10, a: new Int32Array(10), b: new Int32Array(10).fill(1), rest: new Float64Array(10).fill(15),
    restBase: new Float64Array(10).fill(15), broken: new Uint8Array(10), type: new Uint8Array(10) };
  const body = { nodeStore: store, beamStore: beams, _region: { store, dirty: new Int32Array(20), dirtyCount: 0, dirtyAll: false },
    activeNodes: 20, meshDirty: true, isSleeping: false, planar: true, cellSize: 15, latticeMin: { x: -1, y: -2, z: 0 },
    _boundsMinMax: new Float64Array([1, 2, 3, 4, 5, 6]), _maxDisp: 0.25, dead: false,
    spriteSkin: { width: 300, height: 150, pixelPitch: 15, nx: 20, ny: 10, cellSize: 15 }, dims: { x: 5, y: 4, z: 1 } };
  const img = { tag: 'obraz-' + name }, vimg = { tag: 'wizual-' + name };
  const hull = { body, image: img, visualImage: vimg, normalMapImage: null, srcWidth: 300, srcHeight: 150, scale: 1.25,
    pivot: { x: 150, y: 75 }, anchorMode: 'sprite', anchorDX: 2, anchorDY: -3, isFragment: false, dmgKey: 'ród-' + name,
    cellSize: 15, pixelPitch: 15, nx: 20, ny: 10, cellPx: 15 };
  const e = {
    name, x, y: -40, pos: { x, y: -40 }, angle: 0.3, vel: { x: 5, y: 6 }, vx: 5, vy: 6, angVel: 0.02, radius: 140, w: 300, h: 150,
    type: 'destroyer', isPirate: true, dead: false,
    visual: { spriteScale: 1.1, engineFx: { mainLength: 3, mainPalette: 'plazma' },
      mainThrusters: [{ offset: { x: -150, y: 0 }, forward: { x: -1, y: 0 }, mount: 'rear', baseDeg: 180, nozzleDeg: 182, gimbalMinDeg: -15, gimbalMaxDeg: 15, __throttle: 0.75, vfxScale: 1 }],
      torqueThrusters: [{ offset: { x: 10, y: 60 }, forward: { x: 0, y: 1 }, side: 'left', baseDeg: 90, nozzleDeg: 90, __throttle: 0 }] },
    capitalProfile: { lengthScale: 1, widthScale: 1, spriteRotation: 0, engineOffsets: [{ x: -1, y: 0 }] },
    editorLights: { position: [{ id: 'a', x: 1, y: 2, color: '#f00', power: 1, radius: 3 }], road: [], flood: [] },
    thrusterInput: { main: 1, leftSide: 0, rightSide: 0.5, torque: 0 }, input: { main: 1, thrustY: 0 },
    shield: { max: 100, val: 50, state: 'active', activationProgress: 1, show: 0, impacts: [] },
    cloak: { state: 'off', level: 0, energy: 1, lastBreak: null },
    beamHull: hull
  };
  hull.entity = e;
  body.entity = e;
  return e;
}

function setup(ents) {
  const packer = new SnapshotPacker({ shared: false, describe: true });
  const frame = createSnapshotFrame();
  Object.assign(frame, { ship: ents[0], npcs: ents.slice(1), wrecks: [], cam: { x: 0, y: 0, zoom: 1 }, consumeDirty: true });
  const rm = new RenderMirror({
    dict: packer.dict,
    describe: (s, gen) => { const d = packer.descriptors[s]; return d && d.gen === gen ? d.desc : null; },
    topologyOf: (bs, gen, storeVer) => { const t = packer.topologies[bs]; return t && t.gen === gen && t.storeVer === storeVer ? t.topo : null; },
    resourceOf: (slot) => packer.ids.resources.objectAt(slot)
  });
  const step = () => { frame.lastConsumed = packer.k; packer.begin(frame); rm.apply(packer.view); packer.finish(frame); };
  return { packer, frame, rm, step };
}

const FIELDS = ['x', 'y', 'angle', 'vx', 'vy', 'angVel', 'radius', 'w', 'h', 'dead', 'isPirate', 'type', 'name'];

test('lustro: pola encji, dysze, kadłub i ciało jak w obiekcie gry; tożsamość stała między klatkami', () => {
  const ents = [makeShip('A', 100), makeShip('B', 900)];
  const { rm, step, packer, frame } = setup(ents);
  step();
  assert.equal(rm.lists[LIST.RENDER].length, 2);
  const mA = rm.lists[LIST.RENDER][0];
  assert.equal(rm.player, mA);
  for (const f of FIELDS) assert.deepEqual(mA[f], ents[0][f], f);
  assert.deepEqual(mA.pos, ents[0].pos);
  assert.deepEqual(mA.vel, ents[0].vel);
  assert.deepEqual(mA.thrusterInput, ents[0].thrusterInput);
  assert.equal(mA.shield.state, 'active');
  assert.equal(mA.shield.val, 50);
  assert.equal(mA.cloak.lastBreak, null);
  // konfiguracja z opisu: kopie, nie te same obiekty
  assert.deepEqual(mA.capitalProfile, ents[0].capitalProfile);
  assert.notEqual(mA.capitalProfile, ents[0].capitalProfile);
  assert.deepEqual(mA.editorLights, ents[0].editorLights);
  assert.equal(mA.visual.spriteScale, 1.1);
  assert.deepEqual(mA.visual.engineFx, ents[0].visual.engineFx);
  const noz = mA.visual.mainThrusters[0];
  assert.equal(noz.__throttle, 0.75);
  assert.equal(noz.nozzleDeg, 182);
  assert.deepEqual(noz.offset, { x: -150, y: 0 });
  // kadłub i ciało
  const h = mA.beamHull;
  assert.equal(h.entity, mA);
  assert.equal(h.image, ents[0].beamHull.image, 'obraz — ten sam obiekt zasobu (klucz tekstury)');
  assert.equal(h.visualImage, ents[0].beamHull.visualImage);
  assert.equal(h.scale, 1.25);
  assert.deepEqual(h.pivot, { x: 150, y: 75 });
  assert.equal(h.dmgKey, 'ród-A');
  const b = h.body;
  assert.equal(b.entity, mA);
  assert.equal(b.activeNodes, 20);
  assert.deepEqual(Array.from(b._boundsMinMax), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(Array.from(b.nodeStore.x), Array.from(ents[0].beamHull.body.nodeStore.x));
  assert.equal(b._region.store, b.nodeStore);
  assert.equal(b.meshDirty, true);
  assert.deepEqual(b.spriteSkin, ents[0].beamHull.body.spriteSkin);
  // klatka 2: ruch i ciąg — te same obiekty lustra
  const descBefore = packer.stats.descriptors;
  ents[0].x = ents[0].pos.x = 130; ents[0].angle = 0.4;
  ents[0].visual.mainThrusters[0].__throttle = 0.2;
  step();
  assert.equal(rm.lists[LIST.RENDER][0], mA);
  assert.equal(mA.x, 130);
  assert.equal(mA.pos.x, 130);
  assert.equal(mA.visual.mainThrusters[0], noz, 'dysza — ten sam obiekt (slot.source w EngineVfxSystem)');
  assert.equal(noz.__throttle, 0.2);
  assert.equal(mA.beamHull, h);
  assert.equal(mA.beamHull.body, b);
  assert.equal(packer.stats.descriptors, descBefore, 'bez zmian wersji — bez nowych opisów');
  // podmiana tablicy dysz (edytor) → nowy opis, nowe obiekty dysz
  ents[0].visual.mainThrusters = [{ ...ents[0].visual.mainThrusters[0], __throttle: 0.9 }];
  step();
  assert.notEqual(mA.visual.mainThrusters[0], noz);
  assert.equal(mA.visual.mainThrusters[0].__throttle, 0.9);
  // zmiana skali sprite'a w miejscu → nowy opis
  ents[0].visual.spriteScale = 1.3;
  step();
  assert.equal(mA.visual.spriteScale, 1.3);
  // śmierć encji → wypada z listy RENDER i z luster
  ents[1].dead = true;
  frame.npcs = [];
  step();
  assert.equal(rm.lists[LIST.RENDER].length, 1);
  assert.ok(rm.stats.dropped >= 1);
});

test('lustro: zerwanie maskowania — obiekt lastBreak o stałej tożsamości dla tego samego zerwania', () => {
  const ents = [makeShip('A', 0)];
  const { rm, step } = setup(ents);
  ents[0].cloak.lastBreak = { forced: true };
  step();
  const m = rm.player;
  const o1 = m.cloak.lastBreak;
  assert.ok(o1 && o1.forced);
  step();
  assert.equal(m.cloak.lastBreak, o1);
  ents[0].cloak.lastBreak = { forced: false };
  step();
  assert.notEqual(m.cloak.lastBreak, o1);
});

test('lustro: trafienia tarczy (najnowsze pierwsze), wyłączenie wymuszone, zimny wrak ze smugą, kody encji', () => {
  const ents = [makeShip('A', 0)];
  const e = ents[0];
  e.shield.impacts = [{ id: 9, gridAngle: 0.5, damage: 120, intensity: 0.7, fxClass: 'special' }, { id: 8, gridAngle: -1, intensity: 0.3, fxClass: 'main' }];
  e.shield.forceOff = true;
  e.model3DProfileId = 'bellator'; e.faction = 'terra_nova'; e.weaponTier = 'L'; e.fighter = false;
  const cold = makeShip('W', 500);
  cold.isCold = true;
  cold._coldSnapshot = { kind: 'beam', hull: { dmgKey: 'ród-W' }, impostor: { x: 1, y: 2, rot: 0.1, halfW: 50, halfH: 20, r: 0.2, g: 0.3, b: 0.4, wx: 501, wy: -39, reach: 60, opacity: 0.9 } };
  const { rm, step, frame } = setup(ents);
  frame.coldWrecks = [cold];
  step();
  const m = rm.player;
  assert.equal(m.shield.impacts.length, 2);
  assert.deepEqual({ ...m.shield.impacts[0] }, { id: 9, gridAngle: 0.5, damage: 120, intensity: 0.7, fxClass: 'special' });
  assert.equal(m.shield.impacts[1].damage, undefined, 'brak damage → undefined (shield3D bierze intensity)');
  assert.equal(m.shield.forceOff, true);
  assert.equal(m.model3DProfileId, 'bellator');
  assert.equal(m.faction, 'terra_nova');
  assert.equal(m.weaponTier, 'L');
  const mc = rm.lists[LIST.COLD][0];
  assert.equal(mc.isCold, true);
  assert.equal(mc._coldSnapshot.kind, 'beam');
  assert.equal(mc._coldSnapshot.hull.dmgKey, 'ród-W');
  assert.deepEqual({ ...mc._coldSnapshot.impostor }, cold._coldSnapshot.impostor);
  // nowe trafienie: lista z puli, te same obiekty
  const t0 = m.shield.impacts[0];
  e.shield.impacts.unshift({ id: 10, gridAngle: 1, damage: 5, intensity: 0.3, fxClass: 'main' });
  step();
  assert.equal(m.shield.impacts.length, 3);
  assert.equal(m.shield.impacts[0], t0, 'obiekt z puli lustra');
  assert.equal(m.shield.impacts[0].id, 10);
});

test('lustro: bridgeState — część statyczna z opisu, stan z bloku mostków, tożsamość stała, HP ciała z mostkiem', () => {
  const BACKEND = { kind: 'beam', owns: () => true };
  const ents = [makeShip('A', 0)];
  const e = ents[0];
  const store = e.beamHull.body.nodeStore;
  store.hp = new Float64Array(store.count).fill(100);
  store.maxHp = new Float64Array(store.count).fill(120);
  e.bridgeState = {
    version: 1, backend: BACKEND, grid: null, lineage: 'ród-A', srcW: 300, srcH: 150, spriteScale: 1.25, anchorDX: 2, anchorDY: -3,
    cellSize: 15, dimsX: 5, dimsY: 4, scaleX: 1, scaleY: 1, rule: 'all', hullKey: 'bellator', hexRadius: 6,
    windowColorSrgb: [0.9, 0.95, 1], commandLost: false, commandLostAt: -1, vent: null,
    bridges: [{ def: { id: 'main', x: 10, y: 20, w: 30, h: 40 }, id: 'main', index: 0, total: 12, cellX: new Int32Array([1, 2]), cellY: new Int32Array([3, 3]), dead: false, deadAt: -1, missing: false, vent: null }],
    windows: { count: 2, px: new Float32Array([1, 2]), py: new Float32Array([3, 4]), cellX: new Int16Array(2), cellY: new Int16Array(2), offX: new Float32Array(2), offY: new Float32Array(2), angle: new Float32Array(2), seed: new Float32Array(2), level: new Float32Array(2), bridge: new Uint8Array(2), delay: new Float32Array(2), colorsLinear: [[1, 1, 1]], length: 8, width: 2 }
  };
  const packer = new SnapshotPacker({ shared: false, describe: true });
  const frame = createSnapshotFrame();
  Object.assign(frame, { ship: e, npcs: [], wrecks: [], cam: { x: 0, y: 0, zoom: 1 }, consumeDirty: true });
  const rm = new RenderMirror({
    dict: packer.dict, bridgeBackends: { beam: BACKEND },
    describe: (s, gen) => { const d = packer.descriptors[s]; return d && d.gen === gen ? d.desc : null; },
    topologyOf: (bs, gen, sv) => { const t = packer.topologies[bs]; return t && t.gen === gen && t.storeVer === sv ? t.topo : null; },
    resourceOf: (slot) => packer.ids.resources.objectAt(slot)
  });
  const step = () => { frame.lastConsumed = packer.k; packer.begin(frame); rm.apply(packer.view); packer.finish(frame); };
  step();
  const m = rm.player;
  const st = m.bridgeState;
  assert.ok(st);
  assert.equal(st.backend, BACKEND);
  assert.equal(st.hullKey, 'bellator');
  assert.deepEqual(Array.from(st.bridges[0].cellX), [1, 2]);
  assert.deepEqual(st.bridges[0].def, e.bridgeState.bridges[0].def);
  assert.equal(st.windows.length, 8);
  assert.equal(st.commandLost, false);
  assert.equal(m.beamHull.body.nodeStore.hp[3], 100, 'HP ciała okrętu z mostkiem');
  st.bridges[0].fxBurst = 5;      // pole pisane przez render
  st.model3D = true;
  // inna zmiana wersji (podmiana tablicy dysz) — bridgeState i mostki to te same obiekty, pola renderu zostają
  e.visual.mainThrusters = [...e.visual.mainThrusters];
  const b0 = st.bridges[0];
  step();
  assert.equal(m.bridgeState, st);
  assert.equal(st.bridges[0], b0);
  assert.equal(b0.fxBurst, 5);
  assert.equal(st.model3D, true);
  // zgon mostka: wyrzut atmosfery (nowy obiekt w grze) — w lustrze jeden obiekt na wyrzut
  const vent = { x: 5, y: 6, dirX: 0, dirY: -1, bridgeId: 'main', exitX: 5, exitY: -30 };
  e.bridgeState.bridges[0].dead = true;
  e.bridgeState.bridges[0].deadAt = 12.5;
  e.bridgeState.bridges[0].vent = vent;
  e.bridgeState.commandLost = true;
  e.bridgeState.commandLostAt = 12.5;
  e.bridgeState.vent = vent;
  store.hp[3] = 40;
  step();
  assert.equal(b0.dead, true);
  assert.equal(b0.deadAt, 12.5);
  assert.equal(st.commandLost, true);
  assert.ok(st.vent && st.vent === b0.vent, 'ten sam obiekt wyrzutu w obu miejscach (jak w grze)');
  assert.equal(st.vent.exitY, -30);
  const v1 = st.vent;
  step();
  assert.equal(st.vent, v1, 'tożsamość wyrzutu stała między klatkami');
  assert.equal(m.beamHull.body.nodeStore.hp[3], 40, 'zmiana HP bez brudu skóry — z sumy kontrolnej');
});
