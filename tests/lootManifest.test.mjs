// Kontenery-łup: manifest ładunku encji bańki (src/game/traffic/workerBubble.js — collectManifestChanges) na
// minimalnym stanie: przemytnik bez `payload.mass` (masa z towarów), sygnatura tylko przy zmianie, promy i puste
// przeloty bez manifestu, koniec — `unmanifested`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectManifestChanges } from '../src/game/traffic/workerBubble.js';
import { COURSE_STATUS } from '../src/game/traffic/courseRegistry.js';
import { RESOURCES } from '../src/data/resources.js';

function stateWith(courses) {
  const byId = new Map(courses.map((c) => [c.id, c]));
  return {
    world: { registry: { byId } },
    bubble: { list: courses.map((c) => ({ courseId: c.id, departed: false })) }
  };
}
const course = (id, payload) => ({ id, status: COURSE_STATUS.ACTIVE, payload });

test('manifest przemytnika: masa z towarów, gdy kurs jej nie ma (piracy.js)', () => {
  const st = stateWith([
    course('kurs-41', { resourceId: 'chips', units: 120, value: 9000, smuggler: true }),
    course('kurs-42', { passengers: true, mass: 50 }),
    course('kurs-43', { deadhead: true, mass: 0 }),
    course('kurs-44', { harvest: { iron_ore: 300 }, mass: 300, extract: { booked: false } })
  ]);
  const out = collectManifestChanges(st);
  assert.equal(out.manifests.length, 1, 'tylko przemytnik');
  const m = out.manifests[0];
  assert.equal(m.id, 41);
  assert.deepEqual(m.cargo, { chips: 120 });
  assert.equal(m.mass, 120 * RESOURCES.chips.mass);
  assert.equal(collectManifestChanges(st), null, 'bez zmian — nic');
  // Zmiana ładunku → nowy manifest; koniec kursu → unmanifested.
  st.world.registry.byId.get('kurs-41').payload.units = 60;
  assert.equal(collectManifestChanges(st).manifests[0].cargo.chips, 60);
  st.world.registry.byId.get('kurs-41').status = COURSE_STATUS.DONE;
  assert.deepEqual(collectManifestChanges(st).unmanifested, [41]);
});

test('wyprawa górnicza po urobku: worek towarów, masa z kursu', () => {
  const st = stateWith([course('kurs-7', { harvest: { iron_ore: 200, nickel_ore: 40 }, mass: 240, extract: { booked: true } })]);
  const m = collectManifestChanges(st).manifests[0];
  assert.deepEqual(m.cargo, { iron_ore: 200, nickel_ore: 40 });
  assert.equal(m.mass, 240);
});
