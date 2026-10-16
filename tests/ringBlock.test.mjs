// RW-11c: blok migawki stanu ringów (src/render/blocks/ringBlock.js) — lustro po stronie renderu = to, co obraz ringów
// (haloRingGame.js: _portVisuals, _syncBerthLamps) czyta z prawdziwego świata ringów gry (HaloRingWorld): zegar hal,
// zajętość i wersja stanowisk, poziom lamp, pozy obsługi (z `settle` i właścicielem), obrys kadłuba gracza w hubie,
// nadpisanie dachu przez fabułę — przez rotację stron, zmianę póz i ich usunięcie.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SnapshotPacker, createSnapshotFrame } from '../src/render/snapshotPack.js';
import { RING_BLOCK, applyRingBlock, createRingBlock, createRingMirror } from '../src/render/blocks/ringBlock.js';
import { HaloRingWorld } from '../src/game/haloRingWorld.js';

const EARTH = { id: 'earth', x: 1060000, y: -250000, r: 2800 };
const MARS = { id: 'mars', x: 1700000, y: 400000, r: 2000 };

function assertMirror(m, w, ship, roof, msg) {
  assert.ok(Object.is(m.clock, w.clock), `${msg}: zegar`);
  if (roof) assert.deepEqual({ ...m.roof }, { key: roof.key, hall: roof.hall, cut: roof.cut, roofFade: roof.roofFade }, `${msg}: dach`);
  else assert.equal(m.roof, null, `${msg}: bez nadpisania dachu`);
  assert.deepEqual(Object.keys(m.entries).sort(), w.entries.map((e) => e.key).sort(), `${msg}: ringi`);
  for (const e of w.entries) {
    const me = m.entries[e.key];
    const hub = ship ? e.collider.hubOutline(ship) : null;
    if (hub) assert.deepEqual(me.hub.map((p) => [p.x, p.z]), hub.map((p) => [p.x, p.z]), `${msg} ${e.key}: obrys w hubie`);
    else assert.equal(me.hub, null);
    const halls = e.collider.registry.halls;
    assert.equal(me.halls.length, halls.length);
    halls.forEach((h, i) => {
      const mh = me.halls[i];
      assert.ok(Object.is(mh.berthVersion, h.berthVersion), `${msg} ${e.key} hala ${i}: wersja`);
      assert.ok(Object.is(mh.lampLevel, typeof h.lampLevel === 'number' ? h.lampLevel : NaN), `${msg} ${e.key} hala ${i}: lampy`);
      assert.deepEqual(mh.berths, h.layout.berths.map((b) => ({ id: b.id, occupied: b.occupied ?? null, reserved: b.reserved ?? null })));
      assert.deepEqual([...mh.poses.keys()], [...h.poses.keys()], `${msg} ${e.key} hala ${i}: stanowiska póz`);
      for (const [id, p] of h.poses) {
        const mp = mh.poses.get(id);
        for (const k of RING_BLOCK.POSE_KEYS) assert.ok(Object.is(mp[k], p[k]), `${msg} ${e.key} ${id}.${k}`);
        assert.equal('settle' in mp, p.settle !== undefined); if (p.settle !== undefined) assert.equal(mp.settle, !!p.settle);
        assert.equal('owner' in mp, p.owner !== undefined); if (p.owner !== undefined) assert.equal(mp.owner, p.owner);
      }
    });
  }
}

test('blok ringów: lustro = świat ringów gry (zegar, stanowiska, lampy, pozy, obrys w hubie, dach fabuły)', () => {
  const w = new HaloRingWorld({ planets: [EARTH, MARS] });
  const packer = new SnapshotPacker({ shared: false });
  packer.addBlock(createRingBlock());
  const frame = createSnapshotFrame();
  const mirror = createRingMirror();
  const earth = w.entry('earth');
  const hall0 = earth.collider.registry.halls[0];
  const hub = earth.collider.registry.halls[0].frame.origin;
  const ship = { pos: { x: EARTH.x, y: EARTH.y - 20000 }, angle: 0.3, w: 900, h: 300, dead: false };
  let roof = null;
  for (let i = 0; i < 12; i++) {
    w.frame({ nowMs: 1000 + i * 16.7, gameDt: 1 / 60, ship, sun: { x: 0, y: 0 } });
    const [id0, p0] = [...hall0.poses][0] || [];
    if (i === 3 && id0) { hall0.poses.set(id0, { ...p0, lock: 0.5, flow: 1, settle: true, owner: 'story' }); }
    if (i === 6 && id0) { hall0.layout.berths[0].occupied = 'player'; hall0.berthVersion++; }
    if (i === 8 && id0) hall0.poses.delete(id0);
    roof = i >= 5 && i < 9 ? { key: 'earth', hall: 0, cut: i === 6 ? undefined : 0.4, roofFade: 0.1 * i } : null;
    const ringShip = i === 10 ? null : ship;
    frame.ringWorld = w; frame.ringShip = ringShip; frame.ringRoof = roof;
    packer.begin(frame);
    applyRingBlock(packer.view.blocks.ring, packer.dict, mirror);
    packer.finish(frame);
    const r = roof ? { ...roof, cut: typeof roof.cut === 'number' ? roof.cut : NaN } : null;
    assertMirror(mirror, w, ringShip, r, `klatka ${i}`);
  }
  assert.ok(hub);
});

test('blok ringów: wpięcie w grze (świat ringów, statek i dach fabuły w fazie begin)', () => {
  const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /renderSnapshot\.addBlock\(createRingBlock\(\)\);/);
  assert.match(src, /f\.ringWorld = haloWorld;\n\s+f\.ringShip = ship;\n\s+f\.ringRoof = storyHallRoof;/);
  assert.match(src, /setHallRoof: \(o\) => \{ storyHallRoof = o \|\| null; if \(haloRings\) haloRings\.hallRoofOverride = o; \}/);
});
