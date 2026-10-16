// RW-11b: blok migawki roju dronów naprawczych (src/render/blocks/repairBlock.js) i lustro roju.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotPacker, createSnapshotFrame } from '../src/render/snapshotPack.js';
import { createRepairBlock, applyRepairBlock, createRepairMirrorState, REPAIR_BLOCK } from '../src/render/blocks/repairBlock.js';

function makeRig(carrier, target, nDrones) {
  const fx = [];
  for (let i = 0; i < REPAIR_BLOCK.FX_CAP; i++) fx.push({ kind: 0, x: 0, y: 0, z: 0, a: 0, drone: -1, t: 0 });
  const drones = [];
  for (let i = 0; i < nDrones; i++) drones.push({ index: i, state: 1, frame: 0, lx: i, ly: -i, lz: 3, yaw: 0.1, hitT: -1e9, arm: 0.5, plate: 1, weld: 0, thrust: 0.2, job: 2, jobTimer: 0.4 });
  return { carrier, target, out: nDrones, time: 12.5, fxWrite: 0, drones, fx, tune: { droneLength: 18, weldTime: 0.9, plateForward: 6 } };
}

function pushFx(rig, kind, x) {
  const f = rig.fx[rig.fxWrite % REPAIR_BLOCK.FX_CAP];
  f.kind = kind; f.x = x; f.y = 0; f.z = 0; f.a = 0; f.drone = 1; f.t = rig.time;
  rig.fxWrite++;
}

test('blok roju: rigi, drony, nowe wpisy pierścienia zdarzeń pod tymi samymi indeksami; lustro rigu o stałej tożsamości', () => {
  const ship = { x: 0, y: 0, angle: 0 }, tug = { x: 100, y: 0, angle: 0 };
  const rig = makeRig(ship, ship, 3);
  const swarm = { rigs: [rig], out: 3 };
  const packer = new SnapshotPacker({ shared: false });
  packer.addBlock(createRepairBlock());
  const frame = createSnapshotFrame();
  Object.assign(frame, { ship, npcs: [tug], wrecks: [], cam: { x: 0, y: 0, zoom: 1 }, repair: swarm });
  const state = createRepairMirrorState();
  const mirrors = new Map();
  const entityAt = (slot, gen) => (slot >= 0 ? (mirrors.get(slot) || mirrors.set(slot, { slot, gen }).get(slot)) : null);
  const step = () => { packer.begin(frame); applyRepairBlock(packer.view.blocks.repair, entityAt, state); packer.finish(frame); };
  pushFx(rig, 3, 10);
  step();
  assert.equal(state.rigs.length, 1);
  const mr = state.rigs[0];
  assert.equal(mr.carrier, mirrors.get(packer.ids.entities.peek(ship)));
  assert.equal(mr.drones.length, 3);
  assert.equal(mr.drones[2].lx, 2);
  assert.equal(mr.tune.weldTime, 0.9);
  assert.equal(mr.fxWrite, 1);
  assert.equal(mr.fx[0].kind, 3);
  assert.equal(mr.fx[0].x, 10);
  // kolejne zdarzenia (także przez koniec pierścienia), cel → holownik
  for (let i = 0; i < 70; i++) pushFx(rig, 1, 100 + i);
  rig.target = tug;
  rig.drones[0].state = 4;
  step();
  assert.equal(state.rigs[0], mr, 'lustro rigu — ten sam obiekt (render pamięta odczyt pierścienia per rig)');
  assert.equal(mr.fxWrite, 71);
  for (let k = 71 - 64; k < 71; k++) assert.equal(mr.fx[k % 64].x, 100 + (k - 1), `wpis ${k}`);
  assert.equal(mr.target, mirrors.get(packer.ids.entities.peek(tug)));
  assert.equal(mr.drones[0].state, 4);
  // rig znika
  swarm.rigs = [];
  step();
  assert.equal(state.rigs.length, 0);
  assert.equal(state._rigs.size, 0);
});

test('blok roju: za mały blok rośnie (nowy układ stron) bez gubienia zdarzeń', () => {
  const ship = { x: 0, y: 0 };
  const rigs = [];
  for (let i = 0; i < 12; i++) rigs.push(makeRig(ship, ship, 16));
  const packer = new SnapshotPacker({ shared: false });
  packer.addBlock(createRepairBlock());
  const frame = createSnapshotFrame();
  Object.assign(frame, { ship, npcs: [], wrecks: [], cam: { x: 0, y: 0, zoom: 1 }, repair: { rigs, out: 0 } });
  const state = createRepairMirrorState();
  const entityAt = () => null;
  for (const r of rigs) pushFx(r, 6, 5);
  packer.begin(frame); applyRepairBlock(packer.view.blocks.repair, entityAt, state); packer.finish(frame);
  assert.ok(state.rigs.length < 12, 'pierwsza strona — tyle rigów, ile się zmieściło');
  packer.begin(frame); applyRepairBlock(packer.view.blocks.repair, entityAt, state); packer.finish(frame);
  assert.equal(state.rigs.length, 12);
  for (const mr of state.rigs) assert.equal(mr.fx[0].kind, 6, 'zdarzenie rigu z pominiętej części — dostarczone');
});
