// Bańka ruchu v2 w grze (E6, docs/PLAN-ekonomia-rynki.md § 3.5): strona gry (src/game/trafficBubble.js) — bufor
// encji z workera, pozy w czasie gry, trafienia na obrysie kadłuba, taran, zniszczenie → worker, stanowiska;
// blok migawki `traffic` (pakowanie ↔ odczyt w workerze renderu).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTrafficBubble, syncTrafficBubble, setTrafficBubbleTime, trafficActorPoseAt, trafficBulletHit,
  segmentHitsActor, damageTrafficActor, trafficRamContact, trafficRamDamage, trafficBerthStates,
  createPortBerthIndex, playerBerthHolds, stepPlayerBerthHolds, markTrafficActorPromoted, releaseTrafficPromotion
} from '../src/game/trafficBubble.js';
import {
  ACTOR_STRIDE, ACTOR_FIELD, ACTOR_PHASES, ACTOR_FLAG
} from '../src/game/traffic/trafficProtocol.js';
import { ACTOR_PHASE } from '../src/game/traffic/materializedFlight.js';
import { packTrafficBlock, applyTrafficBlock, createTrafficBlock, TRAFFIC_HULL_IDS } from '../src/render/blocks/trafficBlock.js';

const F = ACTOR_FIELD;

/** Atrapa mostu: bufor encji jak z wiadomości `actors`, tabele z `ready`, zapis wysłanych wiadomości. */
function fakeBridge(actors, time = 10) {
  const data = new Float64Array(actors.length * ACTOR_STRIDE);
  actors.forEach((a, k) => {
    const o = k * ACTOR_STRIDE;
    data[o + F.ID] = a.id;
    data[o + F.X] = a.x;
    data[o + F.Y] = a.y;
    data[o + F.ANGLE] = a.angle || 0;
    data[o + F.VX] = a.vx || 0;
    data[o + F.VY] = a.vy || 0;
    data[o + F.ANG_VEL] = a.angVel || 0;
    data[o + F.HULL] = a.hull ?? 0;
    data[o + F.FACTION] = a.faction ?? -1;
    data[o + F.PHASE] = ACTOR_PHASES.indexOf(a.phase || 'fly');
    data[o + F.FLAGS] = a.flags || 0;
    data[o + F.THROTTLE] = 0;
    data[o + F.LENGTH] = a.length || 312;
    data[o + F.WIDTH] = a.width || 216;
    data[o + F.PORT] = a.port ?? -1;
    data[o + F.BERTH] = a.berth ?? -1;
    data[o + F.DOCK_TIME] = 0;
    data[o + F.SPEED] = Math.hypot(a.vx || 0, a.vy || 0);
    data[o + F.AX] = a.ax || 0;
    data[o + F.AY] = a.ay || 0;
  });
  const sent = { destroyed: [], holds: [] };
  return {
    actors: { data, count: actors.length, time, seq: 1, ms: 0 },
    hulls: ['container_ship', 'freighter-capital'],
    tables: {
      stations: [{ id: 'earth' }], berths: { earth: ['earth:Z-01:Z01-M01', 'earth:K7-1:C-02'] },
      factions: ['terra_nova', 'pirates']
    },
    destroyCourse(id, opts) { sent.destroyed.push({ id, ...opts }); },
    setBerthHolds(ids) { sent.holds.push(ids.slice()); },
    sent
  };
}

test('fazy encji w protokole = ACTOR_PHASE bańki', () => {
  assert.deepEqual([...ACTOR_PHASES].sort(), Object.values(ACTOR_PHASE).sort());
});

test('bufor z workera → encje gry: kadłub z rejestru, stanowisko z tabeli, pozy ekstrapolowane w czasie gry', () => {
  const br = fakeBridge([
    { id: 12, x: 1000, y: 2000, vx: 100, vy: -50, hull: 1, phase: 'fly', flags: ACTOR_FLAG.APPROACH, port: 0, berth: 1 },
    { id: 13, x: 5000, y: 5000, hull: 0, phase: 'docked', port: 0, berth: 0 }
  ], 10);
  const tb = createTrafficBubble(br);
  assert.equal(syncTrafficBubble(tb, 10), true);
  assert.equal(syncTrafficBubble(tb, 10), false, 'ten sam numer wiadomości — bez ponownego dekodowania');
  assert.equal(tb.list.length, 2);
  const a = tb.byId.get(12);
  assert.equal(a.hullId, 'heavy_freighter', 'klasa kursu przez rejestr kadłubów ruchu');
  assert.equal(a.berthId, 'earth:K7-1:C-02');
  assert.ok(a.maxHp >= 300 && a.hp === a.maxHp);
  setTrafficBubbleTime(tb, 10.5);
  assert.equal(a.cx, 1050);
  assert.equal(a.cy, 1975);
  const pose = trafficActorPoseAt(a, 10.4, {});
  assert.equal(pose.x, 1040);
  assert.equal(trafficActorPoseAt(a, 30, {}).x, 1050, 'ekstrapolacja najwyżej 0,5 s (bufor nie bywa starszy)');
  // Drugi rząd: przyspieszenie z workera — ½·a·τ² do 0,05 s, dalej prędkość stała.
  a.ax = 400;
  assert.ok(Math.abs(trafficActorPoseAt(a, 10.04, {}).x - (1000 + 100 * 0.04 + 0.5 * 400 * 0.04 * 0.04)) < 1e-9);
  assert.ok(Math.abs(trafficActorPoseAt(a, 10.2, {}).x - (1000 + 100 * 0.2 + 400 * 0.05 * (0.2 - 0.025))) < 1e-9);
  a.ax = 0;
  // Encja, której worker nie przysyła, znika.
  br.actors.count = 1;
  br.actors.seq++;
  syncTrafficBubble(tb, 11);
  assert.equal(tb.list.length, 1);
  assert.equal(tb.byId.has(13), false);
});

test('trafienie: odcinek w ruchu względnym kontra prostokąt kadłuba (wzdłuż dziobu), pudło obok', () => {
  const br = fakeBridge([{ id: 1, x: 0, y: 0, angle: 0, length: 400, width: 100 }]);
  const tb = createTrafficBubble(br);
  syncTrafficBubble(tb, 10);
  setTrafficBubbleTime(tb, 10);
  const a = tb.list[0];
  // Wzdłuż osi y: kadłub ma ±50 w poprzek — pocisk przy x = 150 trafia (±200 wzdłuż), przy y = 80 mija.
  assert.ok(segmentHitsActor(a, 150, -300, 150, 300) >= 0);
  assert.equal(segmentHitsActor(a, 250, -300, 250, 300), -1, 'poza długością kadłuba');
  assert.equal(segmentHitsActor(a, -500, 80, 500, 80), -1, 'poza szerokością kadłuba');
  const t = segmentHitsActor(a, 150, -300, 150, 300);
  assert.ok(Math.abs(t - (250 / 600)) < 1e-9, 'wejście na burcie y = −50');
  // Pocisk w kroku: 1200 j/s w górę ekranu, startuje 30 j. pod burtą.
  const hit = trafficBulletHit(tb, 0, 10, 0, 1200, 1 / 60, 0, 0, 0);
  assert.ok(hit && hit.actor === a);
  assert.equal(trafficBulletHit(tb, 0, 10, 0, 1200, 1 / 60, 0, 50000, 0), null, 'poza promieniem trafień od gracza');
});

test('zniszczenie: punkty życia w grze, kurs do workera (wrak z ładunkiem), encja znika z obrazu', () => {
  const br = fakeBridge([{ id: 7, x: 0, y: 0 }]);
  let boom = null;
  const tb = createTrafficBubble(br, { onDestroyed: (a, x, y) => { boom = { id: a.id, x, y }; } });
  syncTrafficBubble(tb, 10);
  setTrafficBubbleTime(tb, 10);
  const a = tb.list[0];
  assert.equal(damageTrafficActor(tb, a, a.maxHp * 0.5, 1, 2), false);
  assert.equal(damageTrafficActor(tb, a, a.maxHp, 3, 4), true);
  assert.deepEqual(br.sent.destroyed, [{ id: 7, x: 3, y: 4, reason: 'player', byPirates: false }]);
  assert.deepEqual(boom, { id: 7, x: 3, y: 4 });
  assert.equal(tb.list.length, 0);
  // Worker przysyła jeszcze ten kurs (krok później) — nie wraca na obraz.
  br.actors.seq++;
  syncTrafficBubble(tb, 10.1);
  assert.equal(tb.list.length, 0);
});

test('zapas floty (STOCK, id ujemny): dekodowany, zatrzymuje pocisk, bez obrażeń i bez zgłoszenia do workera', () => {
  const br = fakeBridge([{ id: -3, x: 0, y: 0, phase: 'docked', flags: ACTOR_FLAG.STOCK, port: 0, berth: 1, length: 300, width: 150 }]);
  const tb = createTrafficBubble(br);
  syncTrafficBubble(tb, 10);
  setTrafficBubbleTime(tb, 10);
  assert.equal(tb.list.length, 1);
  const a = tb.list[0];
  assert.ok(trafficBulletHit(tb, 0, 10, 0, 1200, 1 / 60, 0, 0, 0)?.actor === a);
  assert.equal(damageTrafficActor(tb, a, 1e9, 0, 0), false);
  assert.equal(a.alive, true);
  assert.equal(br.sent.destroyed.length, 0);
  assert.equal(trafficBerthStates(tb, new Map()).get('earth:K7-1:C-02'), 'occupied', 'lampka padu: zajęty');
});

test('taran: SAT dwóch prostokątów, normalna od statku ruchu do gracza, obrażenia ∝ v²', () => {
  const br = fakeBridge([{ id: 3, x: 0, y: 0, angle: 0, length: 400, width: 100 }]);
  const tb = createTrafficBubble(br);
  syncTrafficBubble(tb, 10);
  setTrafficBubbleTime(tb, 10);
  // Gracz 1000 × 300 nad statkiem (y < 0), leci w dół z 500 j/s, zachodzi na 20 j.
  const c = trafficRamContact(tb, 0, -(50 + 150 - 20), 0, 1000, 300, 0, 500);
  assert.ok(c);
  assert.ok(Math.abs(c.ny + 1) < 1e-9 && Math.abs(c.nx) < 1e-9, 'normalna ku graczowi (−y)');
  assert.ok(Math.abs(c.depth - 20) < 1e-9);
  assert.equal(c.speed, 500);
  assert.equal(trafficRamContact(tb, 0, -400, 0, 1000, 300, 0, 500), null);
  assert.equal(trafficRamDamage(tb, 20), 0, 'poniżej progu — tylko rozepchnięcie');
  assert.ok(trafficRamDamage(tb, 500) > trafficRamDamage(tb, 250) * 3.9);
});

test('stanowiska: ruch w rejestrze (zajęte / zarezerwowane), gracz na polu → berth-hold tylko przy zmianie', () => {
  const br = fakeBridge([
    { id: 1, x: 0, y: 0, phase: 'docked', port: 0, berth: 0 },
    { id: 2, x: 9000, y: 0, phase: 'fly', flags: ACTOR_FLAG.APPROACH, port: 0, berth: 1 }
  ]);
  const tb = createTrafficBubble(br);
  syncTrafficBubble(tb, 10);
  const states = trafficBerthStates(tb, new Map());
  assert.equal(states.get('earth:Z-01:Z01-M01'), 'occupied');
  assert.equal(states.get('earth:K7-1:C-02'), 'reserved');

  const index = createPortBerthIndex({ berths: [
    { id: 'earth:K7-1:C-01', x: 1000, y: 1000, angle: Math.PI / 2, maxLength: 1800, maxBeam: 700 },
    { id: 'earth:Z-01:Z01-S01', x: 5000, y: 1000, angle: 0, maxLength: 300, maxBeam: 180 }
  ] });
  const out = [];
  // Wzdłuż stanowiska C-01 (oś y) 850 j. od środka — na polu; w poprzek 500 — poza nim (350 + zapas 120).
  assert.equal(playerBerthHolds(tb, index, 1000, 1850, 0, out), 1);
  assert.deepEqual(out, ['earth:K7-1:C-01']);
  assert.equal(playerBerthHolds(tb, index, 1500, 1000, 0, out), 0);
  assert.equal(playerBerthHolds(tb, index, 1000, 1000, 400, out), 0, 'w przelocie — bez postoju');
  assert.equal(stepPlayerBerthHolds(tb, index, 1000, 1000, 0, 1), true);
  assert.equal(stepPlayerBerthHolds(tb, index, 1000, 1000, 0, 1), false, 'ten sam zbiór — bez wiadomości');
  assert.equal(stepPlayerBerthHolds(tb, index, 9e6, 0, 0, 1), true);
  assert.deepEqual(br.sent.holds, [['earth:K7-1:C-01'], []]);
});

test('blok migawki `traffic`: pakowanie ↔ odczyt (kadłub przez tabelę, warp, poza klatki)', () => {
  const block = createTrafficBlock();
  const blk = { f64: new Float64Array(block.f64) };
  const list = [
    { courseId: 5, hullId: 'heavy_freighter', x: 7e6, y: -3.5e6, angle: 1.25, vx: 30, vy: -4, speed: 30.3, throttle: 0.5, mode: null },
    { courseId: 6, hullId: 'nie_ma_takiego', x: 0, y: 0, angle: 0, vx: 0, vy: 0, speed: 0, throttle: 0, mode: null },
    { courseId: 8, hullId: TRAFFIC_HULL_IDS[0], x: 1, y: 2, angle: -3, vx: 2e5, vy: 0, speed: 2e5, throttle: 0, mode: 'warp' }
  ];
  block.pack(blk, { traffic: { list, count: 3 } });
  const out = applyTrafficBlock(blk, []);
  assert.equal(out.length, 2, 'kadłub spoza rejestru pominięty');
  assert.equal(out[0].hullId, 'heavy_freighter');
  assert.equal(out[0].x, 7e6);
  assert.equal(out[0].y, -3.5e6);
  assert.equal(out[1].courseId, 8);
  assert.equal(out[1].mode, 'warp');
  block.pack(blk, { traffic: null });
  assert.equal(applyTrafficBlock(blk, out).length, 0);
  assert.equal(packTrafficBlock(blk.f64, list, 0), 0);
});

test('awans do NPC: trafienie gracza zgłasza encję (hak onHit), awansowana nie wraca z workera, zgon blokuje powrót', () => {
  const br = fakeBridge([
    { id: 21, x: 0, y: 0, phase: 'fly', faction: 1 },
    { id: -4, x: 9000, y: 0, phase: 'docked', flags: ACTOR_FLAG.STOCK }
  ], 10);
  const hits = [];
  const tb = createTrafficBubble(br, { onHit: (a, amount, cause) => hits.push([a.id, amount, cause]) });
  syncTrafficBubble(tb, 10);
  setTrafficBubbleTime(tb, 10);
  const a = tb.byId.get(21);
  assert.equal(a.factionId, 'pirates', 'frakcja z tabeli `ready.factions`');
  damageTrafficActor(tb, a, 10, 0, 0, 'player');
  assert.deepEqual(hits, [[21, 10, 'player']]);
  damageTrafficActor(tb, tb.byId.get(-4), 10, 9000, 0, 'player');
  assert.equal(hits.length, 1, 'zapas floty nietykalny — bez awansu');
  markTrafficActorPromoted(tb, a);
  assert.equal(tb.byId.has(21), false);
  assert.ok(!tb.list.includes(a));
  br.actors.seq++;
  syncTrafficBubble(tb, 10.1);
  assert.ok(!tb.byId.has(21), 'worker przysłał encję przed `attach` — gra jej nie bierze');
  releaseTrafficPromotion(tb, 21, true);
  br.actors.seq++;
  syncTrafficBubble(tb, 10.2);
  assert.ok(!tb.byId.has(21), 'NPC zginął — `deadHold`');
  releaseTrafficPromotion(tb, 21, false);
  tb.dead.clear();
  br.actors.seq++;
  syncTrafficBubble(tb, 10.3);
  assert.ok(tb.byId.has(21), 'po powrocie do bańki encja znów jest');
});
