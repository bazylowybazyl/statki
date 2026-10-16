// RW-11c: blok migawki ruchu warpa (src/render/blocks/warpBlock.js) — lustro osi przylotów i odlotów rejestru gry
// (src/game/warpTraffic.js) dla renderu w workerze: pole w pole z osią gry przez cały przebieg (planowany przylot,
// warp-in piratów z hamowaniem, odlot, koniec i ponowne użycie slotu), nagłówek klatki „Nurtu”, pilnowanie listy pól.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SnapshotPacker, createSnapshotFrame } from '../src/render/snapshotPack.js';
import { WARP_BLOCK, applyWarpBlock, createWarpBlock, createWarpMirror } from '../src/render/blocks/warpBlock.js';
import { createWarpTraffic, planWarpArrivalAxis, planWarpDepartureAxis } from '../src/game/warpTraffic.js';

function assertFxEqual(m, g, msg) {
  const fields = WARP_BLOCK.FIELDS[g === null ? 'arrival' : m.kind];
  for (const k of fields) {
    assert.equal(k in m.fx, k in g.fx, `${msg}: obecność ${k}`);
    if (k in g.fx) assert.ok(Object.is(m.fx[k], g.fx[k]), `${msg}: ${k} ${m.fx[k]} ≠ ${g.fx[k]}`);
  }
}

test('blok warpa: lustro osi = oś rejestru gry pole w pole przez przyloty, warp-in, odloty i ponowne użycie slotów', () => {
  const traffic = createWarpTraffic();
  const packer = new SnapshotPacker({ shared: false });
  packer.addBlock(createWarpBlock());
  const frame = createSnapshotFrame();
  const mirror = createWarpMirror();
  const nurt = { dt: 0, camFollow: true, lensAllowed: false };
  const pirate = { x: 5000, y: -300, vx: 4000, vy: 0, angle: 0.2, state: 'warping_in', warpData: { speed: 4000 }, isCollidable: false };
  const step = (dt) => {
    traffic.step(dt);
    nurt.dt = dt; nurt.camFollow = !nurt.camFollow;
    frame.warpTraffic = traffic; frame.warpNurt = nurt;
    packer.begin(frame);
    const page = packer.view;
    applyWarpBlock(page.blocks.warp, packer.dict, mirror);
    packer.finish(frame);
    assert.ok(Object.is(mirror.frame.trafficTime, traffic.time));
    assert.equal(mirror.frame.dt, dt);
    assert.equal(mirror.frame.camFollow, nurt.camFollow);
    for (let s = 0; s < traffic.cap; s++) {
      const g = traffic.recordAt(s), m = mirror.recordAt(s);
      assert.equal(!!m, !!(g && g.fx), `slot ${s}: zajętość`);
      if (!g || !g.fx) continue;
      assert.equal(m.kind, g.kind, `slot ${s}: rodzaj`);
      assertFxEqual(m, g, `t ${traffic.time.toFixed(3)} slot ${s}`);
    }
  };
  const a1 = traffic.planArrival({ x: 1000, y: 200, angle: 0.4, hullLength: 900, hullWidth: 320, burstIn: 1.2, palette: 'pirate' });
  traffic.planArrival({ x: -4000, y: 900, angle: -1.1, hullLength: 400, hullWidth: 160, burstIn: 0.4 });
  traffic.depart({ x: 300, y: -700, angle: 2.2, beamHull: null }, { hullLength: 1200, hullWidth: 400 });
  traffic.noteWarpIn(pirate);
  step(1 / 60);
  const fxBefore = mirror.recordAt(a1.id).fx;
  for (let i = 0; i < 40; i++) step(1 / 60);
  assert.equal(mirror.recordAt(a1.id).fx, fxBefore, 'ten sam rekord — ta sama oś lustra (widok renderu trzyma referencję)');
  pirate.state = 'engage_formation';          // hamowanie warp-in od chwili wyjścia
  for (let i = 0; i < 600; i++) step(1 / 30);
  // nowe rekordy w zwolnionych slotach: świeża oś lustra
  const a2 = traffic.planArrival({ x: 0, y: 0, angle: 0, hullLength: 600, hullWidth: 200, burstIn: 0.3 });
  step(1 / 60);
  assert.ok(a2 && mirror.recordAt(a2.id));
  if (a2.id === a1.id) assert.notEqual(mirror.recordAt(a2.id).fx, fxBefore, 'nowy rekord w slocie — nowa oś lustra');
  traffic.clear();
  step(1 / 60);
  for (let s = 0; s < traffic.cap; s++) assert.equal(mirror.recordAt(s), null, `po clear slot ${s} pusty`);
});

test('blok warpa: lista pól = pola osi gry (nowe pole osi wymaga wpisu w bloku), zagnieżdżone poza blokiem', () => {
  const a = planWarpArrivalAxis({ x: 1, y: 2, angle: 0.5, hullLength: 900, hullWidth: 300, startTime: 3, rush: 9000, palette: 'pirate', id: 4 });
  const d = planWarpDepartureAxis({ x: 1, y: 2, angle: 0.5, hullLength: 900, hullWidth: 300, startTime: 3, palette: 'terran', id: 5 });
  for (const [kind, fx] of [['arrival', a], ['departure', d]]) {
    const known = new Set([...WARP_BLOCK.FIELDS[kind], ...WARP_BLOCK.NESTED_KEYS[kind]]);
    for (const k of Object.keys(fx)) assert.ok(known.has(k), `${kind}: pole osi ${k} bez wpisu w warpBlock.js`);
  }
});

test('blok warpa: wpięcie w grze (rejestracja przy migawce, rejestr i klatka „Nurtu” w fazie begin)', () => {
  const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /renderSnapshot\.addBlock\(createWarpBlock\(\)\)/);
  assert.match(src, /function packRenderSnapshotBegin\([^)]*\) \{[\s\S]{0,3000}f\.warpTraffic = warpTraffic;\n\s+f\.warpNurt = _warpNurtFrame\(/);
});
