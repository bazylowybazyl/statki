import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pushColdWreckImpostors } from '../src/3d/coldWreckImpostors.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function fakeBatch(capacity, used = 0) {
  const pushed = [];
  return {
    MAX_IMPOSTORS: capacity,
    pushed,
    getCount: () => used + pushed.length,
    pushRaw(...args) {
      if (used + pushed.length >= capacity) return false;
      pushed.push(args);
      return true;
    }
  };
}

// Smuga zimnego wraku = rekord `snapshot.impostor` liczony raz przy zamrożeniu (gra: src/game/coldWreckView.js
// captureBeamColdImpostor — test w coldWreckView.test.mjs): współrzędne sceny (y = −y gry), środek do cullingu
// w świecie gry (wx, wy), zasięg pudła.
function coldAt(x, y, halfW = 40, halfH = 20, extra = {}) {
  const impostor = { x, y: -y, rot: 0, halfW, halfH, r: 0.2, g: 0.3, b: 0.4, wx: x, wy: y, reach: Math.hypot(halfW, halfH), ...extra };
  return { x, y, _coldSnapshot: { kind: 'beam', impostor } };
}

test('tylko zimne w kadrze trafiają do batcha, z kryciem „tła”', () => {
  const list = [coldAt(0, 0), coldAt(900, 0), coldAt(5000, 0), coldAt(0, -3000), { x: 1, y: 1, _coldSnapshot: null }];
  const batch = fakeBatch(100);
  const cull = { x: 0, y: 0, drawHalfW: 1000, drawHalfH: 800, halfW: 3000, halfH: 2400 };
  const pushed = pushColdWreckImpostors(batch, list, cull, 0.7);
  assert.equal(pushed, 2);
  assert.deepEqual(batch.pushed.map(args => args[0]), [0, 900]);
  assert.ok(batch.pushed.every(args => args.length === 9 && args[8] === 0.7));
});

test('własne krycie smugi bierze górę; wrak rysowany w tej klatce skórą smugi nie dostaje', () => {
  const own = coldAt(0, 0, 40, 20, { opacity: 0.35 });
  const skinned = coldAt(100, 0);
  skinned._coldSkinFrame = 12;
  const plain = coldAt(200, 0);
  const batch = fakeBatch(100);
  assert.equal(pushColdWreckImpostors(batch, [own, skinned, plain], null, 0.7, 12), 2);
  assert.deepEqual(batch.pushed.map(args => [args[0], args[8]]), [[0, 0.35], [200, 0.7]]);
});

test('pełny batch: culling po odległości od środka kadru, nie wyjątek', () => {
  const list = [];
  for (let i = 0; i < 12; i++) list.push(coldAt((i % 2 ? 1 : -1) * i * 50, 0));
  const cull = { x: 0, y: 0, drawHalfW: 5000, drawHalfH: 5000 };
  const batch = fakeBatch(20, 15); // 15 zajmują gorące wraki — zostaje 5
  const pushed = pushColdWreckImpostors(batch, list, cull, 0.7);
  assert.equal(pushed, 5);
  const xs = batch.pushed.map(args => Math.abs(args[0])).sort((a, b) => a - b);
  assert.deepEqual(xs, [0, 50, 100, 150, 200], 'najbliższe środkowi');
  assert.equal(pushColdWreckImpostors(fakeBatch(20, 20), list, cull, 0.7), 0, 'brak miejsca = nic');
  // Drugi raz (bufor odległości już jest) — ten sam wynik.
  const again = fakeBatch(20, 15);
  pushColdWreckImpostors(again, list, cull, 0.7);
  assert.deepEqual(again.pushed.map(args => Math.abs(args[0])).sort((a, b) => a - b), xs);
});

test('hexShips3D: przebieg zimnych przed flush batcha, bez listy encji; smuga z migawki liczy gra', () => {
  const hex = read('src/3d/hexShips3D.js');
  assert.match(hex, /export function updateHexShips3D\(viewCamera, entities = \[\], cullInfo = null, coldWrecks = null(, cloakFrame = null)?\)/);
  // Wraki na belkach rysowane w tej klatce skórą (znacznik `_coldSkinFrame === frameId`) smugi nie dostają.
  assert.match(hex, /pushColdWreckImpostors\(HexBodyImpostorBatch, coldWrecks, cullInfo, COLD_WRECK_CONFIG\.impostorOpacity, frameId\);[\s\S]*?HexBodyImpostorBatch\.flush\(\);/);
  assert.match(hex, /export function isColdFreezeVisuallySafe\(entity, config = null\)/);
  // Jedna ścieżka smugi: gra (RW-31) — dawny zapas renderu (captureColdWreckImpostor, też dla zrzutów heksów)
  // usunięty razem z silnikiem heksów (2026-10-19).
  assert.doesNotMatch(hex, /captureColdWreckImpostor/);
  assert.match(read('src/game/coldWreckView.js'), /export function captureBeamColdImpostor\(entity, snapshot, config = null\)/);
  const batch = read('src/3d/hexBodyImpostorBatch.js');
  assert.match(batch, /pushRaw\(x, y, rot, halfW, halfH, r, g, b, opacity\) \{/);
  assert.match(batch, /push\(p\) \{\s*return this\.pushRaw\(/);
});
