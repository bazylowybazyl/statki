// RW-11b / RW-26: blok migawki z wyglądem maskowania (src/render/blocks/cloakBlock.js) i lustro wyglądu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotPacker, createSnapshotFrame } from '../src/render/snapshotPack.js';
import { LIST } from '../src/render/snapshotLayout.js';
import { createCloakBlock, applyCloakBlock, createCloakMirrorState, CLOAK_BLOCK } from '../src/render/blocks/cloakBlock.js';
import { createCloakLook, stepCloakLook } from '../src/game/cloakLook.js';
import { createCloak, engageCloak, disengageCloak, stepCloak } from '../src/game/cloak.js';

function makeShip(x) {
  const e = { x, y: 0, angle: 0.3, vx: 120, vy: -40, cloak: createCloak(), __cloakLook: undefined };
  return e;
}

// Krok wyglądu jak stepCloakLooks gry (poza z encji), ramka CLOAK_LOOK_FRAME.
function stepLooks(cf, ents, dt, t, player) {
  cf.dt = dt; cf.time = t; cf.list.length = 0; cf.playerLook = null; cf.player = player;
  for (const e of ents) {
    if (!e.cloak && !e.__cloakLook) continue;
    stepCloak(e.cloak, dt);
    if (!e.__cloakLook) e.__cloakLook = createCloakLook(e.cloak, (e.x * 13) & 0xffff);
    const pose = { x: e.x + 10, y: e.y - 5, angle: e.angle + Math.PI / 2, scale: 1.7, spriteW: 512, spriteH: 256, speed: 126.5, turn: 0.02 };
    if (stepCloakLook(e.__cloakLook, e.cloak, dt, t, pose)) cf.list.push(e);
    if (e === player) cf.playerLook = e.__cloakLook;
  }
}

function harness() {
  const packer = new SnapshotPacker({ shared: false });
  packer.addBlock(createCloakBlock());
  const frame = createSnapshotFrame();
  const mirrors = new Map();
  const entityAt = (slot, gen) => {
    if (!(slot >= 0)) return null;
    let m = mirrors.get(slot);
    if (!m || m.gen !== gen) { m = { slot, gen, __cloakLook: undefined }; mirrors.set(slot, m); }
    return m;
  };
  const state = createCloakMirrorState();
  const mirrorOf = (e) => { const s = packer.ids.entities.peek(e); return s >= 0 ? entityAt(s, packer.ids.entities.gen(s)) : null; };
  const step = () => {
    packer.begin(frame);
    const rl = packer._lists[LIST.RENDER].map(mirrorOf);
    applyCloakBlock(packer.view.blocks.cloak, entityAt, rl, packer.dict, state);
    packer.finish(frame);
  };
  return { packer, frame, state, step, mirrorOf };
}

function assertLookEqual(ml, gl, msg) {
  const K = CLOAK_BLOCK.KEYS;
  for (const k of K.num) assert.ok(Object.is(ml[k], gl[k]), `${msg}: ${k} ${ml[k]} ≠ ${gl[k]}`);
  for (const k of K.bool) assert.equal(ml[k], gl[k], `${msg}: ${k}`);
  for (const k of K.str) assert.equal(ml[k], gl[k], `${msg}: ${k}`);
  for (const k of K.vec) for (const c of 'xyzw') assert.ok(Object.is(ml[k][c], gl[k][c]), `${msg}: ${k}.${c}`);
  assert.equal(ml.tint, gl.tint, `${msg}: tint (stała z CLOAK_LOOK)`);
}

test('blok maskowania: układ z szablonu wyglądu, lustro bit w bit z wyglądem gry przez całe włączenie i wyłączenie', () => {
  assert.ok(CLOAK_BLOCK.KEYS.vec.length === 5 && CLOAK_BLOCK.KEYS.bool.includes('active') && CLOAK_BLOCK.KEYS.str.includes('phase'));
  const { packer, frame, state, step, mirrorOf } = harness();
  const ship = makeShip(0), npc = makeShip(4000), plain = { x: 900, y: 0, angle: 0 };
  const cf = { dt: 0, time: 0, list: [], playerLook: null, player: null };
  Object.assign(frame, { ship, npcs: [npc, plain], wrecks: [], cam: { x: 0, y: 0, zoom: 1 }, cloak: cf });
  let t = 100;
  let sawEngage = false, sawActive = false;
  for (let f = 0; f < 400; f++) {
    if (f === 5) engageCloak(ship.cloak);
    if (f === 40) engageCloak(npc.cloak);
    if (f === 220) disengageCloak(ship.cloak);
    t += 1 / 60;
    stepLooks(cf, [ship, npc], 1 / 60, t, ship);
    frame.lastConsumed = packer.k;   // inline: każda strona odebrana (k − 1)
    step();
    for (const e of [ship, npc]) {
      const m = mirrorOf(e);
      assertLookEqual(m.__cloakLook, e.__cloakLook, `klatka ${f}`);
      assert.equal(m.__cloakLook.events, e.__cloakLook.events | 0, `zdarzenia klatki ${f} (każda strona odebrana)`);
      if (e.__cloakLook.events) sawEngage = true;
      if (e.__cloakLook.active) sawActive = true;
    }
    assert.equal(mirrorOf(plain).__cloakLook, undefined, 'encja bez maskowania — bez wyglądu');
    assert.equal(state.frame.list.length, cf.list.length);
    for (let i = 0; i < cf.list.length; i++) assert.equal(state.frame.list[i], mirrorOf(cf.list[i]));
    assert.equal(state.frame.player, mirrorOf(ship));
    assert.equal(state.frame.playerLook, mirrorOf(ship).__cloakLook);
    assert.equal(state.frame.time, t);
  }
  assert.ok(sawEngage && sawActive, 'przebieg ma zdarzenia i aktywny wygląd');
  // tożsamość lustra wyglądu stała (render porównuje i mutuje)
  const l0 = mirrorOf(ship).__cloakLook;
  step();
  assert.equal(mirrorOf(ship).__cloakLook, l0);
});

test('blok maskowania: zdarzenia z pominiętych stron dochodzą (suma od ostatnio odebranej), odebrane nie wracają', () => {
  const { packer, frame, step, mirrorOf } = harness();
  const ship = makeShip(0);
  const cf = { dt: 0, time: 0, list: [], playerLook: null, player: ship };
  Object.assign(frame, { ship, npcs: [], wrecks: [], cam: { x: 0, y: 0, zoom: 1 }, cloak: cf });
  // kilka stron odebranych na bieżąco
  for (let f = 0; f < 3; f++) { stepLooks(cf, [ship], 1 / 60, f / 60, ship); frame.lastConsumed = packer.k; step(); }
  const consumedBefore = packer.k;
  // strona ze zdarzeniem — czytelnik jej NIE odbiera
  engageCloak(ship.cloak);
  stepLooks(cf, [ship], 1 / 60, 3 / 60, ship);
  const bits = ship.__cloakLook.events | 0;
  assert.ok(bits !== 0, 'włączenie daje zdarzenie');
  frame.lastConsumed = consumedBefore; step();
  // następne strony też nieodebrane (worker nie nadąża) — zdarzenie dalej w każdej
  for (let f = 4; f < 7; f++) {
    stepLooks(cf, [ship], 1 / 60, f / 60, ship);
    frame.lastConsumed = consumedBefore; step();
    assert.equal(mirrorOf(ship).__cloakLook.events & bits, bits, `strona ${f}: zdarzenie z pominiętej strony`);
  }
  // czytelnik odebrał stronę ze zdarzeniem — kolejne go już nie niosą
  frame.lastConsumed = packer.k;
  stepLooks(cf, [ship], 1 / 60, 8 / 60, ship);
  step();
  assert.equal(mirrorOf(ship).__cloakLook.events & bits, ship.__cloakLook.events & bits, 'po odebraniu — tylko zdarzenia tej klatki');
});

test('blok maskowania: rekord gracza bez wyglądu, nowa generacja slotu = nowy wygląd lustra, blok rośnie', () => {
  const { frame, state, step, mirrorOf } = harness();
  const ships = [];
  for (let i = 0; i < 40; i++) ships.push(makeShip(i * 1000));
  const cf = { dt: 0, time: 0, list: [], playerLook: null, player: null };
  const plainPlayer = { x: -5000, y: 0, angle: 0 };
  Object.assign(frame, { ship: plainPlayer, npcs: ships, wrecks: [], cam: { x: 0, y: 0, zoom: 1 }, cloak: cf });
  for (const e of ships) engageCloak(e.cloak);
  stepLooks(cf, ships, 1 / 60, 1, plainPlayer);
  step();
  const first = ships.filter((e) => mirrorOf(e).__cloakLook).length;
  assert.ok(first < ships.length, '40 rekordów nie mieści się w bloku startowym');
  stepLooks(cf, ships, 1 / 60, 1 + 1 / 60, plainPlayer);
  step();
  for (const e of ships) assertLookEqual(mirrorOf(e).__cloakLook, e.__cloakLook, 'po wzroście bloku');
  assert.equal(state.frame.player, mirrorOf(plainPlayer));
  assert.equal(state.frame.playerLook, null);
});
