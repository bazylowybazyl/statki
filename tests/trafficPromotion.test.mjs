// Awans statku ruchu do pełnego NPC (E6, docs/E6-banka-w-grze.md § „Awans do pełnego NPC”): decyzje
// (`src/game/trafficPromotion.js`) — kolejka z limitem NPC naraz, kto może awansować, rozkaz świeżego NPC, werdykt
// (żyje / zginął / wraca do bańki) i punkt ucieczki. Klej w grze — blok „BAŃKA RUCHU v2 W GRZE” w index.html.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRAFFIC_PROMOTION_TUNE, createTrafficPromotion, requestTrafficPromotion, takeTrafficPromotion,
  trafficPromotionVerdict, trafficFleePoint, trafficActorPromotable, trafficPromotionOrder,
  TRAFFIC_COMBAT_HULLS, trafficCombatRole, trafficWeaponFaction, trafficGrudgeTarget
} from '../src/game/trafficPromotion.js';
import { TRAFFIC_HULLS, TRAFFIC_UNIT_HULLS, resolveTrafficHullId } from '../src/data/trafficHulls.js';
import { SUPPORT_SHIP_TEMPLATES, CAPITAL_SHIP_TEMPLATES } from '../src/data/ships.js';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';
import { SHIP_FLIGHT_SPECS } from '../src/data/shipFlightSpecs.js';
import { ACTOR_FLAG } from '../src/game/traffic/trafficProtocol.js';

test('kolejka awansów: bez powtórek, limit NPC z ruchu naraz, kolejność trafień', () => {
  const st = createTrafficPromotion({ maxAlive: 3 });
  assert.equal(requestTrafficPromotion(st, 5), true);
  assert.equal(requestTrafficPromotion(st, 5), false, 'ten sam kurs drugi raz — bez wpisu');
  assert.equal(requestTrafficPromotion(st, 7), true);
  st.alive.set(9, {});
  assert.equal(requestTrafficPromotion(st, 9), false, 'już NPC');
  assert.equal(requestTrafficPromotion(st, 11), false, 'limit: 2 w kolejce + 1 żywy = 3');
  assert.equal(st.stats.refused, 1);
  assert.equal(takeTrafficPromotion(st), 5);
  assert.equal(takeTrafficPromotion(st), 7);
  assert.equal(takeTrafficPromotion(st), null);
  assert.equal(requestTrafficPromotion(st, 5), true, 'po zdjęciu z kolejki znów można');
});

test('kto awansuje: kurs (nie zapas floty), bez warpa, poniżej prędkości hipercruise, kadłub z pełnym NPC', () => {
  const base = { alive: true, id: 4, flags: 0, vx: 100, vy: 0, hullId: 'container_ship' };
  assert.equal(trafficActorPromotable(base), true);
  assert.equal(trafficActorPromotable({ ...base, alive: false }), false);
  assert.equal(trafficActorPromotable({ ...base, id: -3, flags: ACTOR_FLAG.STOCK }), false, 'zapas floty jest nietykalny');
  assert.equal(trafficActorPromotable({ ...base, flags: ACTOR_FLAG.WARP }), false);
  assert.equal(trafficActorPromotable({ ...base, vx: TRAFFIC_PROMOTION_TUNE.maxSpeed + 1 }), false, 'hipercruise ucieka');
  assert.equal(trafficActorPromotable({ ...base, hullId: 'megafreighter' }), false, 'megafrachtowiec to pociąg modułów');
});

test('rozkaz świeżego NPC: przy stanowisku i w kolejce stoi, w locie ucieka', () => {
  for (const phase of ['capture', 'docked', 'undock', 'hold', 'station']) assert.equal(trafficPromotionOrder(phase), 'hold', phase);
  assert.equal(trafficPromotionOrder('fly'), 'flee');
});

test('werdykt: zginął / koniec walki i poza zasięgiem → powrót do bańki / walka trwa', () => {
  const st = createTrafficPromotion({ calmSeconds: 20, releaseRadius: 20000 });
  const npc = { x: 30000, y: 0, __trafficPromotedAt: 100, _lastPlayerHit: 105 };
  assert.equal(trafficPromotionVerdict(st, npc, 110, 0, 0), 'keep', 'trafiony 5 s temu');
  assert.equal(trafficPromotionVerdict(st, npc, 126, 0, 0), 'demote', '21 s spokoju, 30 tys. j. od gracza');
  assert.equal(trafficPromotionVerdict(st, { ...npc, x: 15000 }, 126, 0, 0), 'keep', 'gracz za blisko');
  assert.equal(trafficPromotionVerdict(st, { ...npc, dead: true }, 110, 0, 0), 'dead');
  assert.equal(trafficPromotionVerdict(st, { ...npc, removed: true }, 110, 0, 0), 'dead');
  assert.equal(trafficPromotionVerdict(st, null, 110, 0, 0), 'dead');
  // Bez trafienia gracza liczy się chwila awansu.
  assert.equal(trafficPromotionVerdict(st, { x: 30000, y: 0, __trafficPromotedAt: 100 }, 119, 0, 0), 'keep');
});

test('punkt ucieczki: od napastnika wzdłuż linii, napastnik w środku — dziobem', () => {
  const p = trafficFleePoint({ x: 100, y: 0, angle: 0 }, 0, 0, 1000);
  assert.deepEqual([Math.round(p.x), Math.round(p.y)], [1100, 0]);
  const q = trafficFleePoint({ x: 5, y: 5, angle: Math.PI / 2 }, 5, 5, 1000);
  assert.ok(Math.abs(q.x - 5) < 1e-9 && Math.abs(q.y - 1005) < 1e-9);
});

// E13 (2026-10-22): okręty ruchu po awansie walczą — broń z gniazd kadłuba, mózg i liczby klasy (szablon wezwania).
test('okręty ruchu: rola bojowa ze szablonem i gniazdami, model lotu; cywile i role cywilne bez roli', () => {
  for (const [hull, role] of Object.entries(TRAFFIC_COMBAT_HULLS)) {
    assert.ok(TRAFFIC_HULLS[hull], `${hull}: kadłub ruchu`);
    const tpl = role.capital ? CAPITAL_SHIP_TEMPLATES[role.template] : SUPPORT_SHIP_TEMPLATES[role.template];
    assert.ok(tpl, `${hull}: szablon ${role.template}`);
    assert.ok(['frigate', 'destroyer', 'battleship', 'carrier'].includes(role.type), `${hull}: typ ${role.type}`);
    const editor = SHIP_EDITOR_DEFAULTS.ships[TRAFFIC_HULLS[hull].editorKey || hull];
    assert.ok(editor?.hardpoints?.length > 0, `${hull}: gniazda broni`);
    assert.ok(SHIP_FLIGHT_SPECS[hull], `${hull}: model lotu okrętu`);
  }
  // Role okrętowe kursów: garnizon / wojna (terran_*), łowca, policja, rajd, przemyt — walczą.
  for (const unit of ['hunter', 'police', 'raider', 'smuggler', 'warfleet']) assert.ok(trafficCombatRole(resolveTrafficHullId(unit)), unit);
  // Cywile: przewozy, górnictwo, złomiarze, ratownik — bez roli (uciekają albo stoją).
  for (const unit of ['freighter-small', 'freighter-capital', 'tug', 'rescue', 'heavy_harvester', 'tanker', 'repair_drone']) {
    assert.equal(trafficCombatRole(resolveTrafficHullId(unit)), null, unit);
  }
  assert.equal(TRAFFIC_UNIT_HULLS.rescue, 'rescue_ship');
  assert.equal(trafficWeaponFaction('pirates'), 'pirate');
  assert.equal(trafficWeaponFaction('terra_nova'), 'terran');
  assert.equal(trafficWeaponFaction('belt_union', true), 'pirate');
  assert.equal(trafficWeaponFaction('mars_yards'), 'terran');
});

test('okręt z urazą bije gracza tylko widocznego (maskowanie) i w zasięgu; hulk mostka nie wraca do bańki', () => {
  const npc = { x: 0, y: 0 };
  const player = { pos: { x: 5000, y: 0 } };
  assert.equal(trafficGrudgeTarget(npc, player, () => false), player);
  assert.equal(trafficGrudgeTarget(npc, player, () => true), null, 'zamaskowany');
  assert.equal(trafficGrudgeTarget(npc, { pos: { x: 25000, y: 0 } }, () => false), null, 'poza zasięgiem');
  assert.equal(trafficGrudgeTarget(npc, { ...player, dead: true }, () => false), null);
  const st = createTrafficPromotion();
  const hulk = { x: 1e6, y: 0, isBridgeHulk: true, _lastPlayerHit: 0, __trafficPromotedAt: 0 };
  assert.equal(trafficPromotionVerdict(st, hulk, 1000, 0, 0), 'keep', 'hulk dryfuje do wraku');
  assert.equal(trafficPromotionVerdict(st, { ...hulk, isBridgeHulk: false }, 1000, 0, 0), 'demote');
});
