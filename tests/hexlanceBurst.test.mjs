import test from 'node:test';
import assert from 'node:assert/strict';

// Seria Hexlance'a (src/game/weaponCharge.js, zadanie 18-A; docs/webgpu/PROJEKT-BRONI.md §2.5,
// §5 p. 3): `burstCount` strzałów z każdego gniazda co `burstDelay`, gniazdo po gnieździe.
// Kolejka w postaci superweaponState.queue (opóźnienia względne), krok = pętla z updateSuperweapon.
const { MASTER_WEAPONS } = await import('../src/data/weapons.js');
const C = await import('../src/game/weaponCharge.js');

const HEX = MASTER_WEAPONS.hexlance_siege;

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

test('dane: Hexlance 4 strzały co 0,25 s na gniazdo', () => {
  assert.equal(C.burstCountOf(HEX), 4);
  assert.equal(C.burstDelayOf(HEX), 0.25);
  assert.equal(C.burstCountOf({}), 1);
  assert.equal(C.burstDelayOf({}, 0.12), 0.12, 'fallback jak getHexlanceStat');
  assert.equal(C.burstDelayOf({ burstDelay: 0 }, 0.12), 0.12);
});

test('kolejka: burstCount × gniazda, gniazdo po gnieździe, pierwszy od razu, potem co burstDelay', () => {
  const one = C.buildHexlanceBurst(HEX, 1);
  assert.deepEqual(one.map((s) => s.cannonIndex), [0, 0, 0, 0]);
  assert.deepEqual(one.map((s) => s.delay), [0, 0.25, 0.25, 0.25]);
  const two = C.buildHexlanceBurst(HEX, 2);
  assert.deepEqual(two.map((s) => s.cannonIndex), [0, 1, 0, 1, 0, 1, 0, 1]);
  assert.equal(C.buildHexlanceBurst(HEX, 0).length, 0, 'bez gniazda nic');
  // Tablica i wpisy używane ponownie (bez nowych obiektów przy kolejnej serii).
  const reused = C.buildBurstQueue(2, 2, 0.1, two);
  assert.equal(reused, two);
  assert.equal(reused.length, 4);
});

test('krok kolejki: rytm co 0,25 s bez dryfu przy 60, 144 i 165 FPS', () => {
  for (const fps of [60, 144, 165]) {
    const dt = 1 / fps;
    const shots = fireTimes(C.buildHexlanceBurst(HEX, 1), dt);
    assert.equal(shots.length, 4, `${fps} FPS: 4 strzały`);
    // Nadwyżka kroku przechodzi na następny wpis: strzał k w pierwszym kroku o t ≥ k · 0,25
    // (rytm liczony od naciśnięcia, bez sumowania zaokrągleń do klatek).
    shots.forEach((s, k) => {
      assert.ok(s.t >= k * 0.25 - 1e-9 && s.t < k * 0.25 + dt + 1e-9, `${fps} FPS strzał ${k} w ${s.t}`);
    });
  }
  const two = fireTimes(C.buildHexlanceBurst(HEX, 2), 1 / 120);
  assert.equal(two.length, 8);
  assert.deepEqual(two.map((s) => s.cannon), [0, 1, 0, 1, 0, 1, 0, 1]);
  assert.ok(Math.abs(two.at(-1).t - 7 * 0.25) < 1 / 120 + 1e-9, 'ostatni po 7 odstępach');
});

test('kolejka pusta i długi krok: wszystkie zaległe strzały w jednym kroku, bez Math.random', () => {
  assert.equal(C.stepBurstQueue([], 0.1, () => { throw new Error('nic do strzału'); }), 0);
  const random = Math.random;
  Math.random = () => { throw new Error('Math.random w serii'); };
  try {
    const q = C.buildHexlanceBurst(HEX, 1);
    const fired = [];
    assert.equal(C.stepBurstQueue(q, 1.0, (c, k) => fired.push(k)), 4, 'krok 1 s oddaje całą serię');
    assert.deepEqual(fired, [0, 1, 2, 3]);
    assert.equal(q.length, 0);
  } finally { Math.random = random; }
});
