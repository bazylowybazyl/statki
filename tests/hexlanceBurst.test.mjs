import test from 'node:test';
import assert from 'node:assert/strict';

// Seria Hexlance'a (src/game/weaponCharge.js, zadanie 18-A; docs/webgpu/PROJEKT-BRONI.md §2.5,
// §5 p. 3): `burstCount` strzałów z każdego gniazda co `burstDelay`, gniazdo po gnieździe.
// Kolejka w postaci superweaponState.queue (opóźnienia względne), krok = pętla z updateSuperweapon.
const { MASTER_WEAPONS } = await import('../src/data/weapons.js');
const C = await import('../src/game/weaponCharge.js');

const HEX = MASTER_WEAPONS.hexlance_siege;
// Mechanizm serii (kolejka, rytm, gniazda) na broni testowej 4 × 0,25 s — Hexlance strzela dziś raz
// na gniazdo (decyzja 2026-09-29), ale seria z danych zostaje dla innych broni.
const SERIA = { ...HEX, burstCount: 4, burstDelay: 0.25 };

// Czasy strzałów przy kroku dt (pierwszy krok w t = dt, jak w grze: kolejka z naciśnięcia, krok w następnej klatce).
function fireTimes(queue, dt, steps = 1000) {
  const out = [];
  let t = 0;
  for (let k = 0; k < steps && queue.length; k++) {
    t += dt;
    C.stepBurstQueue(queue, dt, (cannon) => out.push({ t, cannon }));
  }
  return out;
}

test('dane: Hexlance 1 strzał na gniazdo (gniazda co 0,25 s)', () => {
  assert.equal(C.burstCountOf(HEX), 1);
  assert.equal(C.burstDelayOf(HEX), 0.25);
  assert.equal(C.burstCountOf(SERIA), 4);
  assert.equal(C.burstCountOf({}), 1);
  assert.equal(C.burstDelayOf({}, 0.12), 0.12, 'fallback jak getHexlanceStat');
  assert.equal(C.burstDelayOf({ burstDelay: 0 }, 0.12), 0.12);
});

test('kolejka: burstCount × gniazda, gniazdo po gnieździe, pierwszy od razu, potem co burstDelay', () => {
  const one = C.buildHexlanceBurst(SERIA, 1);
  assert.deepEqual(one.map((s) => s.cannonIndex), [0, 0, 0, 0]);
  assert.deepEqual(one.map((s) => s.delay), [0, 0.25, 0.25, 0.25]);
  const two = C.buildHexlanceBurst(SERIA, 2);
  assert.deepEqual(two.map((s) => s.cannonIndex), [0, 1, 0, 1, 0, 1, 0, 1]);
  assert.equal(C.buildHexlanceBurst(SERIA, 0).length, 0, 'bez gniazda nic');
  // Tablica i wpisy używane ponownie (bez nowych obiektów przy kolejnej serii).
  const reused = C.buildBurstQueue(2, 2, 0.1, two);
  assert.equal(reused, two);
  assert.equal(reused.length, 4);
});

test('krok kolejki: rytm co 0,25 s bez dryfu przy 60, 144 i 165 FPS', () => {
  for (const fps of [60, 144, 165]) {
    const dt = 1 / fps;
    const shots = fireTimes(C.buildHexlanceBurst(SERIA, 1), dt);
    assert.equal(shots.length, 4, `${fps} FPS: 4 strzały`);
    // Nadwyżka kroku przechodzi na następny wpis: strzał k w pierwszym kroku o t ≥ k · 0,25
    // (rytm liczony od naciśnięcia, bez sumowania zaokrągleń do klatek).
    shots.forEach((s, k) => {
      assert.ok(s.t >= k * 0.25 - 1e-9 && s.t < k * 0.25 + dt + 1e-9, `${fps} FPS strzał ${k} w ${s.t}`);
    });
  }
  const two = fireTimes(C.buildHexlanceBurst(SERIA, 2), 1 / 120);
  assert.equal(two.length, 8);
  assert.deepEqual(two.map((s) => s.cannon), [0, 1, 0, 1, 0, 1, 0, 1]);
  assert.ok(Math.abs(two.at(-1).t - 7 * 0.25) < 1 / 120 + 1e-9, 'ostatni po 7 odstępach');
});

test('kolejka pusta i długi krok: wszystkie zaległe strzały w jednym kroku, bez Math.random', () => {
  assert.equal(C.stepBurstQueue([], 0.1, () => { throw new Error('nic do strzału'); }), 0);
  const random = Math.random;
  Math.random = () => { throw new Error('Math.random w serii'); };
  try {
    const q = C.buildHexlanceBurst(SERIA, 1);
    const fired = [];
    assert.equal(C.stepBurstQueue(q, 1.0, (c, k) => fired.push(k)), 4, 'krok 1 s oddaje całą serię');
    assert.deepEqual(fired, [0, 1, 2, 3]);
    assert.equal(q.length, 0);
  } finally { Math.random = random; }
});

// Zadanie 18-B: seria w grze — superweapon.js buduje kolejkę buildHexlanceBurst z danych
// (dawniej jeden strzał na gniazdo), rytm 0,25 s, przeładowanie rusza po opróżnieniu kolejki.
test('superweapon.js: naciśnięcie po naładowaniu oddaje JEDEN strzał z gniazda Atlasa (2026-09-29)', async () => {
  const shots = [];
  const shakes = [];
  globalThis.window = Object.assign(globalThis.window || {}, {
    camera: { addShake: (m) => shakes.push(m) },
    dispatchEvent: (e) => { if (e?.type === 'game_weapon_fired') shots.push(t); return true; }
  });
  const SW = await import('../src/game/superweapon.js');
  const S = SW.superweaponState;
  S.cooldown = 0; S.queue.length = 0; S.charging = false; S.armed = false;
  const ship = {
    pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0,
    weapons: { builtin: [{ weapon: HEX, hp: { id: 'b0', pos: { x: 400, y: 0, rot: 90 } } }] }
  };
  let t = 0;
  const dt = 1 / 120;
  assert.equal(SW.tryFireSuperweapon(ship), true, 'pierwsze naciśnięcie — ładowanie');
  for (; t < 1.3; t += dt) SW.updateSuperweapon(dt, ship, null);
  assert.equal(S.armed, true, 'naładowane po 1,2 s');
  assert.equal(SW.tryFireSuperweapon(ship), true, 'drugie naciśnięcie — strzał');
  assert.equal(S.queue.length, 1, 'kolejka burstCount × gniazda = 1');
  const t0 = t;
  for (; t < t0 + 1.0; t += dt) SW.updateSuperweapon(dt, ship, null);
  assert.equal(shots.length, 1, 'jeden strzał na naciśnięcie');
  assert.ok(Math.abs(shots[0] - t0) <= dt + 1e-9, `strzał od razu (${shots[0] - t0} s)`);
  assert.deepEqual(shakes, [14], 'wstrząs z danych broni (shake 14)');
  assert.ok(S.cooldown > 0 && S.cooldown <= HEX.cooldown, 'przeładowanie rusza po serii');
  assert.equal(SW.tryFireSuperweapon(ship), false, 'w przeładowaniu naciśnięcie odbija');
});
