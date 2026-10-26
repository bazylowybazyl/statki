// Bańka ruchu v2 w grze (E6, docs/PLAN-ekonomia-rynki.md § 3.5): strona gry (src/game/trafficBubble.js) — bufor
// encji z workera, pozy w czasie gry, trafienia na obrysie kadłuba, taran, zniszczenie → worker, stanowiska;
// blok migawki `traffic` (pakowanie ↔ odczyt w workerze renderu).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTrafficBubble, syncTrafficBubble, setTrafficBubbleTime, trafficActorPoseAt, trafficBulletHit,
  segmentHitsActor, damageTrafficActor, trafficRamContact, trafficRamDamage, trafficBerthStates,
  createPortBerthIndex, playerBerthHolds, stepPlayerBerthHolds, markTrafficActorPromoted, releaseTrafficPromotion,
  trafficContactTime, destroyTrafficActor, trafficRamFallbackDamage, trafficRectContact
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
  const sent = { destroyed: [], holds: [], lost: [] };
  return {
    actors: { data, count: actors.length, time, seq: 1, ms: 0 },
    hulls: ['container_ship', 'freighter-capital'],
    tables: {
      stations: [{ id: 'earth' }], berths: { earth: ['earth:Z-01:Z01-M01', 'earth:K7-1:C-02'] },
      factions: ['terra_nova', 'pirates']
    },
    destroyCourse(id, opts) { sent.destroyed.push({ id, ...opts }); },
    entityLost(id, opts) { sent.lost.push({ id, ...opts }); },
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

test('zapas floty (STOCK, id ujemny): dekodowany, zatrzymuje pocisk, bierze obrażenia, strata jako entityLost', () => {
  const br = fakeBridge([{ id: -3, x: 0, y: 0, phase: 'docked', flags: ACTOR_FLAG.STOCK, port: 0, berth: 1, length: 300, width: 150 }]);
  const tb = createTrafficBubble(br);
  syncTrafficBubble(tb, 10);
  setTrafficBubbleTime(tb, 10);
  assert.equal(tb.list.length, 1);
  const a = tb.list[0];
  assert.ok(trafficBulletHit(tb, 0, 10, 0, 1200, 1 / 60, 0, 0, 0)?.actor === a);
  assert.equal(trafficBerthStates(tb, new Map()).get('earth:K7-1:C-02'), 'occupied', 'lampka padu: zajęty');
  // Nietykalnych nie ma (2026-10-23): strzał zabójczy niszczy, worker dostaje stratę zapasu (nie `destroyed`).
  assert.equal(damageTrafficActor(tb, a, 1e9, 0, 0), true);
  assert.equal(a.alive, false);
  assert.equal(br.sent.destroyed.length, 0);
  assert.deepEqual(br.sent.lost.map((l) => l.id), [-3]);
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
    { id: -4, x: 9000, y: 0, phase: 'docked', flags: ACTOR_FLAG.STOCK },
    { id: 22, x: -9000, y: 0, phase: 'fly', flags: ACTOR_FLAG.DEPARTED }
  ], 10);
  const hits = [];
  const tb = createTrafficBubble(br, { onHit: (a, amount, cause) => hits.push([a.id, amount, cause]) });
  syncTrafficBubble(tb, 10);
  setTrafficBubbleTime(tb, 10);
  const a = tb.byId.get(21);
  assert.equal(a.factionId, 'pirates', 'frakcja z tabeli `ready.factions`');
  damageTrafficActor(tb, a, 10, 0, 0, 'player');
  assert.deepEqual(hits, [[21, 10, 'player']]);
  // Nietykalnych nie ma: zapas floty i odlot po końcu kursu biorą obrażenia i idą do awansu jak kursy.
  const stock = tb.byId.get(-4);
  const stockHp = stock.hp;
  damageTrafficActor(tb, stock, 10, 9000, 0, 'player');
  assert.equal(stock.hp, stockHp - 10, 'zapas floty (STOCK) bierze obrażenia');
  const gone = tb.byId.get(22);
  damageTrafficActor(tb, gone, 10, 0, 0, 'player');
  assert.deepEqual(hits.map((h) => h[0]), [21, -4, 22], 'STOCK i DEPARTED zgłaszają awans');
  // Zniszczenie na obrysie: kurs → `destroyCourse`, encja bez kursu → `entityLost` (strata po stronie świata).
  destroyTrafficActor(tb, stock, 9000, 0, 'player');
  destroyTrafficActor(tb, gone, -9000, 0, 'player');
  assert.deepEqual(br.sent.lost.map((l) => l.id), [-4, 22]);
  assert.equal(br.sent.destroyed.length, 0);
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

test('czas do kontaktu kadłuba gracza z obrysem encji (awans przed taranem)', () => {
  const a = { cx: 0, cy: 0, ca: 0, vx: 0, vy: 0, length: 1800, width: 660 };
  // Gracz 600 × 200, dziobem na statek (kąt π), 2000 j. przed dziobem, 500 j/s: kontakt przy 900 + 300 j.
  assert.ok(Math.abs(trafficContactTime(a, 2000, 0, -500, 0, Math.PI, 600, 200) - 1.6) < 1e-9);
  // Z boku, dziobem w burtę (kąt −π/2): burta 330 + pół długości gracza 300.
  assert.ok(Math.abs(trafficContactTime(a, 0, 1630, 0, -500, -Math.PI / 2, 600, 200) - 2) < 1e-9);
  // Gracz bokiem (kąt 0) z tej samej strony: burta 330 + pół szerokości gracza 100 — później.
  assert.ok(Math.abs(trafficContactTime(a, 0, 1630, 0, -500, 0, 600, 200) - 2.4) < 1e-9);
  // Obrócony statek (90°): długość w poprzek osi x.
  assert.ok(Math.abs(trafficContactTime({ ...a, ca: Math.PI / 2 }, 2000, 0, -500, 0, Math.PI, 600, 200) - (2000 - 630) / 500) < 1e-9);
  // Mija (równolegle obok, 1000 j. od burty), oddala się, już zachodzi.
  assert.equal(trafficContactTime(a, 2000, 1500, -500, 0, Math.PI, 600, 200), Infinity);
  assert.equal(trafficContactTime(a, 2000, 0, 500, 0, Math.PI, 600, 200), Infinity);
  assert.equal(trafficContactTime(a, 100, 0, 0, 0, 0, 600, 200), 0);
  // Ruch względny: statek leci na gracza, gracz stoi.
  assert.ok(Math.abs(trafficContactTime({ ...a, vx: 500 }, 2000, 0, 0, 0, Math.PI, 600, 200) - 1.6) < 1e-9);
});

// Taran w megafrachtowiec (2026-10-26, „wybuchł od razu, jak go dotknąłem”): ścieżka awaryjna nigdy nie zabija w
// pierwszej klatce, encja w warpie i w hipercruisie to duch, NPC bez kadłuba odpycha bez obrażeń.
test('taran awaryjny: duch (warp, hipercruise), obrażenia z sufitem na kontakt i odstępem, kontakt miękki NPC bez kadłuba', () => {
  const br = fakeBridge([
    { id: 3, x: 0, y: 0, angle: 0, length: 400, width: 100 },
    { id: 4, x: 5000, y: 0, angle: 0, length: 400, width: 100, flags: ACTOR_FLAG.WARP },
    { id: 5, x: 10000, y: 0, angle: 0, length: 400, width: 100, vx: 3000 }
  ]);
  const tb = createTrafficBubble(br);
  syncTrafficBubble(tb, 10);
  setTrafficBubbleTime(tb, 10);
  assert.equal(trafficRamContact(tb, 5000, -180, 0, 1000, 300, 0, 500), null, 'encja w warpie — duch');
  assert.equal(trafficRamContact(tb, tb.byId.get(5).cx, -180, 0, 1000, 300, 0, 500), null, 'hipercruise encji — duch');
  const a = tb.byId.get(3);
  // Dopalacz 1137 j/s: ramK · v² ≈ 25,9 tys. (dawniej zabijało od razu) — teraz najwyżej 15% maks. punktów.
  const d1 = trafficRamFallbackDamage(tb, a, 1137);
  assert.ok(Math.abs(d1 - a.maxHp * tb.tune.ramMaxFrac) < 1e-9, `sufit kontaktu: ${d1}`);
  assert.equal(trafficRamFallbackDamage(tb, a, 1137), 0, 'ten sam kontakt w kolejnej klatce — bez obrażeń');
  setTrafficBubbleTime(tb, 10 + tb.tune.ramCooldown);
  assert.ok(trafficRamFallbackDamage(tb, a, 1137) > 0, 'po odstępie — kolejna porcja');
  assert.ok(Math.abs(trafficRamFallbackDamage(tb, tb.byId.get(4), 60) - tb.tune.ramK * 60 * 60) < 1e-9, 'lekki taran (pod sufitem) — ramK · v²');
  assert.equal(trafficRamFallbackDamage(tb, a, 20), 0, 'poniżej progu');
  // Kontakt miękki: prostokąt NPC (obrys encji), normalna ku graczowi, prędkość zbliżenia.
  const c = trafficRectContact(0, -(50 + 150 - 20), 0, 1000, 300, 0, 1137, 0, 0, 0, 400, 100, 0, 0);
  assert.ok(c && Math.abs(c.depth - 20) < 1e-9 && Math.abs(c.ny + 1) < 1e-9 && c.speed === 1137);
  assert.equal(trafficRectContact(0, -400, 0, 1000, 300, 0, 500, 0, 0, 0, 400, 100, 0, 0), null);
});
