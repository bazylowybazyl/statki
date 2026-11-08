// Kapsuły ratunkowe bez obrazu w świecie ruchu (E22 K3, reguła `kapsuly-ratunkowe`): wraki spoza bańki gracza →
// kapsuły w drodze do najbliższej stacji frakcji, dolot po czasie; wraki od gracza i pirackie — bez.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POD_TRANSIT_TUNE, createPodTransit, scanWrecksForPods, settlePodTransit
} from '../src/game/traffic/escapePodTransit.js';
import { buildTrafficWorld, stepTrafficWorld } from '../src/game/traffic/trafficWorld.js';

const stations = [
  { id: 'earth', x: 0, y: 0, factionId: 'terra_nova' },
  { id: 'ceres', x: 200_000, y: 0, factionId: 'belt_union' },
  { id: 'hideout', x: 90_000, y: 0, factionId: 'pirates' },
  { id: 'dead', x: 100_000, y: 1000, factionId: null, destroyed: true }
];

test('wraki spoza bańki: kapsuły do stacji frakcji, dolot po czasie z odległości; gracz i piraci — bez', () => {
  const t = createPodTransit();
  const wrecks = [
    { courseId: 'c1', x: 100_000, y: 0, reason: 'pirate', factionId: 'terra_nova' },
    { courseId: 'c2', x: 100_000, y: 0, reason: 'station-destroyed', factionId: 'belt_union' },
    { courseId: 'c3', x: 100_000, y: 0, reason: 'player', factionId: 'terra_nova' },
    { courseId: 'c4', x: 100_000, y: 0, reason: 'destroyed', factionId: 'pirates' },
    { courseId: 'c5', x: null, y: null, reason: 'pirate', factionId: 'terra_nova' },
    { courseId: 'c6', x: 150_000, y: 0, reason: 'pirate', factionId: 'consortium' }
  ];
  assert.equal(scanWrecksForPods(t, wrecks, stations, 1000), 3);
  assert.deepEqual(t.pending.map((e) => [e.courseId, e.stationId]), [['c1', 'earth'], ['c2', 'ceres'], ['c6', 'ceres']]);
  assert.equal(t.stats.game, 1);
  assert.equal(t.stats.pirates, 1);
  assert.equal(t.stats.noSpot, 1);
  const e1 = t.pending[0];
  const want = 1000 + POD_TRANSIT_TUNE.launch + 100_000 * POD_TRANSIT_TUNE.routeFactor / POD_TRANSIT_TUNE.cruise;
  assert.ok(Math.abs(e1.eta - want) < 1e-6, `dolot ${e1.eta}`);
  // Przegląd przyrostowy: drugi raz nic.
  assert.equal(scanWrecksForPods(t, wrecks, stations, 2000), 0);
  wrecks.push({ courseId: 'c7', x: 1000, y: 0, reason: 'pirate', factionId: 'terra_nova' });
  assert.equal(scanWrecksForPods(t, wrecks, stations, 2000), 1);
  // Dolot po czasie z odległości: c6 (50 tys. j. do Ceres) pierwsza, potem c1 i c2 (po 100 tys. j.), c7 na końcu.
  const L = POD_TRANSIT_TUNE.launch;
  const arrived = [];
  assert.equal(settlePodTransit(t, 1000 + L + 100, (e) => arrived.push(e.courseId)), 1);
  assert.deepEqual(arrived, ['c6']);
  assert.equal(settlePodTransit(t, 1000 + L + 130, (e) => arrived.push(e.courseId)), 2);
  assert.deepEqual(arrived.slice(1).sort(), ['c1', 'c2']);
  assert.equal(settlePodTransit(t, 1e9, (e) => arrived.push(e.courseId)), 1);
  assert.equal(arrived[3], 'c7');
  assert.equal(t.pending.length, 0);
  assert.equal(t.stats.arrived, 4);
});

test('świat ruchu: przechwyty piratów dają kapsuły bez obrazu, rekord wraku niesie frakcję', () => {
  const world = buildTrafficWorld({ economyScale: 4, capacityMultiplier: 4, seed: 7 });
  for (let k = 0; k < 720; k++) stepTrafficWorld(world);
  const wrecks = world.director.wrecks;
  assert.ok(wrecks.length > 0, 'są wraki po godzinie świata');
  assert.ok(wrecks.every((w) => 'factionId' in w), 'wrak niesie frakcję kursu');
  const t = world.podTransit;
  assert.ok(t, 'przegląd kapsuł w kroku świata');
  assert.equal(t.scanned, wrecks.length);
  const pirateWrecks = wrecks.filter((w) => w.factionId === 'pirates').length;
  assert.equal(t.stats.pirates, pirateWrecks);
  assert.ok(t.stats.ships > 0, `kapsuły ${JSON.stringify(t.stats)}`);
  assert.ok(t.stats.arrived > 0, 'część już doleciała');
});
