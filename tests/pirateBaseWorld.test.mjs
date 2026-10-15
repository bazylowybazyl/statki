// Baza piratów po stronie gry (RW-24, src/game/story/pirateBaseWorld.js): stan kawałków i `_dockGone` bez obrazu,
// decyzje break / ram jak w dawnej bryle (kawałek pęknięty albo schowany nie pęka drugi raz), zdarzenia dla obrazu,
// ciała świata na danych bazy, środek planetoidy z układu skały i ramki bazy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  attachPirateBaseWorld, breakPirateBaseChunk, collapsePirateRock, hidePirateBaseChunk, onPirateBaseEvent,
  pirateBaseBrokenChunks, pirateBaseChunkGone, pirateBaseData, pirateRockAt, ramPirateBaseChunk, syncPirateBaseGone
} from '../src/game/story/pirateBaseWorld.js';
import { placePirateBase } from '../src/game/story/pirateBaseSite.js';
import { createPirateBaseSites } from '../src/game/story/pirateBaseBodies.js';
import { createPirateRockLayout } from '../src/3d/portBuildings/pirateRockLayout.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('stan kawałków: break / ram / hide bez obrazu, _dockGone budowli, zdarzenia dla obrazu', () => {
  const events = [];
  const off = onPirateBaseEvent((type, a, b, c) => events.push([type, a, b, c]));
  const place = placePirateBase({ x: 5_000_000, y: 3_000_000 }, 0.7);
  const owners = { habitat: { id: 'H' }, fuel: { id: 'F' }, warehouse: { id: 'W' }, piers: { id: 'P' } };
  assert.equal(breakPirateBaseChunk('X', {}), false, 'bez bazy — nic');
  assert.equal(pirateRockAt(), null);
  const model = attachPirateBaseWorld(owners, place);
  assert.ok(model && model.layout === pirateBaseData().layout);
  const gone = owners.habitat._dockGone;
  assert.ok(gone instanceof Set && owners.piers._dockGone === gone, 'wspólny zbiór budowli');
  assert.equal(events[0][0], 'attach');
  const [c1, c2, c3] = pirateBaseData().layout.chunks;
  assert.equal(breakPirateBaseChunk(c1.id, { speed: 70 }), true);
  assert.equal(breakPirateBaseChunk(c1.id, { speed: 70 }), false, 'drugi raz — nie');
  assert.ok(gone.has(c1.id) && pirateBaseChunkGone(c1.id));
  assert.deepEqual(events.at(-1), ['break', c1.id, { speed: 70 }, undefined]);
  assert.equal(ramPirateBaseChunk(c2.id, 1, 0, 900), true);
  const ram = events.at(-1);
  assert.equal(ram[0], 'ram');
  const want = place.dirToHub(1, 0, { x: 0, z: 0 });
  assert.deepEqual([ram[2].x, ram[2].z], [want.x, want.z], 'kierunek w układzie bazy');
  assert.equal(hidePirateBaseChunk(c3.id), true);
  assert.equal(breakPirateBaseChunk(c3.id, {}), false, 'schowany nie pęka');
  assert.deepEqual(pirateBaseBrokenChunks().sort(), [c1.id, c2.id, c3.id].sort());
  // przebudowa zbioru po kroku ciał świata: pęknięte i schowane zostają
  gone.add('obcy');
  syncPirateBaseGone();
  assert.deepEqual([...gone].sort(), [c1.id, c2.id, c3.id].sort());
  // planetoida: środek z układu skały i ramki bazy (jak dawny obiekt 3D)
  const c = createPirateRockLayout().center;
  assert.deepEqual(pirateRockAt(), place.toGame(c[0], c[2], {}));
  assert.equal(collapsePirateRock(), true);
  assert.equal(events.at(-1)[0], 'rockCollapse');
  // nowa misja: stan od zera
  attachPirateBaseWorld(owners, place);
  assert.equal(pirateBaseBrokenChunks().length, 0);
  assert.equal(gone.size, 0);
  off();
});

test('ciała świata na danych bazy gry: dostępność kawałka ze stanu gry', () => {
  const place = placePirateBase({ x: 0, y: 0 }, 0);
  const owners = { habitat: { id: 'H' }, fuel: { id: 'F' }, warehouse: { id: 'W' }, piers: { id: 'P' } };
  const model = attachPirateBaseWorld(owners, place);
  const sites = createPirateBaseSites(owners, model, place, {});
  const piece = sites.piers.pieces[0];
  assert.equal(piece.available(), true);
  breakPirateBaseChunk(piece.id, {});
  assert.equal(piece.available(), false);
});

test('obraz bazy bez rozgrywki: zdarzenia zamiast stanu, mgła i habitat ze stanu klatki gry', () => {
  const src = read('src/3d/pirateBaseGame.js');
  for (const bad of ['._dockGone =', 'worldBodies.addSite', 'createPirateBaseSites', 'prebuildPirateBaseBodies', 'hiddenTest', 'structures.habitat', '_base3d', 'syncGone']) {
    assert.ok(!src.includes(bad), `pirateBaseGame.js: ${bad}`);
  }
  assert.ok(!/from '\.\.\/game\//.test(src), 'obraz nie importuje stanu gry');
  assert.match(src, /export function pirateBase3DEvent\(type, a, b, c\)/);
  const html = read('index.html');
  assert.match(html, /onPirateBaseEvent\(pirateBase3DEvent\);/);
  assert.match(html, /worldBodies\.step\(dt, _worldFocus\);\n\s+\/\/[^\n]*\n\s+syncPirateBaseGone\(\);/);
  assert.match(html, /const at = pirateRockAt\(\);/);
  assert.ok(!html.includes('setPirateBaseHiddenTest'));
});
