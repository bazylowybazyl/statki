import test from 'node:test';
import assert from 'node:assert/strict';

// Ładowanie dział przed strzałem (src/game/weaponCharge.js, zadanie 18-A; docs/webgpu/PROJEKT-BRONI.md
// §2.4, §5 p. 4, 7): Mjolnir 3,0 s z wymogiem postoju (|v| ≤ 30 j/s, |ω| ≤ 0,05 rad/s),
// Valkyrie 0,28 s; start przy błędzie celowania ≤ 0,08, strzał ≤ 0,03 (jak demo).
const { MASTER_WEAPONS } = await import('../src/data/weapons.js');
const C = await import('../src/game/weaponCharge.js');

const MJOLNIR = MASTER_WEAPONS.siege_railgun;
const VALKYRIE = MASTER_WEAPONS.special_valkyrie_railgun;
const DT = 1 / 120;

// Naciśnięcie w kroku 0, potem krok po kroku z tym samym wejściem aż do strzału / przerwania.
function run(def, input = {}, maxSteps = 2000, perStep = null) {
  const state = C.createChargeState();
  const us = [];
  for (let k = 0; k < maxSteps; k++) {
    const extra = perStep ? perStep(k) : null;
    const r = C.stepCharge(state, DT, { wantFire: k === 0, aimErr: 0, speed: 0, angVel: 0, ...input, ...extra }, def);
    us.push(state.u);
    if (r !== C.CHARGE_CHARGING) return { result: r, steps: k + 1, state, us };
  }
  return { result: 'timeout', steps: maxSteps, state, us };
}

test('dane: Mjolnir 3,0 s na postoju, Valkyrie 0,28 s (jak demo), Hexlance ma własny cykl', () => {
  assert.equal(C.chargeTimeOf(MJOLNIR), 3.0);
  assert.equal(MJOLNIR.requiresStationary, true);
  assert.equal(C.chargeTimeOf(VALKYRIE), 0.28);
  assert.notEqual(VALKYRIE.requiresStationary, true);
  assert.equal(C.chargeTimeOf(MASTER_WEAPONS.vulcan_minigun), 0);
});

test('Mjolnir strzela po 3 s ładowania, Valkyrie po 0,28 s; postęp rośnie do 1', () => {
  const mj = run(MJOLNIR);
  assert.equal(mj.result, C.CHARGE_FIRE);
  assert.ok(Math.abs(mj.steps - 360) <= 1, `Mjolnir: ${mj.steps} kroków 120 Hz`);
  for (let k = 1; k < mj.us.length; k++) assert.ok(mj.us[k] >= mj.us[k - 1], 'postęp nie maleje');
  assert.equal(mj.us.at(-1), 1);
  assert.equal(mj.state.charge, -1, 'po strzale bezczynne');
  const vk = run(VALKYRIE);
  assert.equal(vk.result, C.CHARGE_FIRE);
  assert.ok(Math.abs(vk.steps - Math.ceil(0.28 * 120)) <= 1, `Valkyrie: ${vk.steps} kroków`);
  // Naciśnięcie raz wystarcza (klawisz 2): ładowanie trwa bez trzymania spustu.
  assert.ok(mj.steps > 1 && vk.steps > 1);
});

test('broń bez chargeTime strzela od razu; bez naciśnięcia nic', () => {
  const state = C.createChargeState();
  assert.equal(C.stepCharge(state, DT, { wantFire: false }, MASTER_WEAPONS.vulcan_minigun), C.CHARGE_IDLE);
  assert.equal(C.stepCharge(state, DT, { wantFire: true }, MASTER_WEAPONS.vulcan_minigun), C.CHARGE_FIRE);
  assert.equal(C.stepCharge(state, DT, { wantFire: false }, MJOLNIR), C.CHARGE_IDLE);
  assert.equal(state.u, 0);
});

test('postój Mjolnira: ruch nie pozwala zacząć, ruch lub obrót przerywa; Valkyrie strzela w ruchu', () => {
  const state = C.createChargeState();
  assert.equal(C.stepCharge(state, DT, { wantFire: true, speed: 31 }, MJOLNIR), C.CHARGE_IDLE);
  assert.equal(state.reason, 'moving');
  assert.equal(C.stepCharge(state, DT, { wantFire: true, speed: 30, angVel: 0.05 }, MJOLNIR), C.CHARGE_CHARGING, 'na progu to jeszcze postój');
  const moved = run(MJOLNIR, {}, 2000, (k) => (k === 200 ? { speed: 45 } : null));
  assert.equal(moved.result, C.CHARGE_CANCEL);
  assert.equal(moved.steps, 201);
  assert.equal(moved.state.reason, 'moving');
  assert.equal(moved.state.u, 0);
  const turned = run(MJOLNIR, {}, 2000, (k) => (k === 100 ? { angVel: -0.07 } : null));
  assert.equal(turned.result, C.CHARGE_CANCEL);
  assert.equal(run(VALKYRIE, { speed: 400, angVel: 0.4 }).result, C.CHARGE_FIRE);
  assert.equal(C.isStationary(29.9, 0.049), true);
  assert.equal(C.isStationary(-30.1, 0), false);
});

test('celowanie: start przy błędzie ≤ 0,08; naładowane czeka na ≤ 0,03, bez celu gaśnie po holdMax', () => {
  const state = C.createChargeState();
  assert.equal(C.stepCharge(state, DT, { wantFire: true, aimErr: 0.09 }, VALKYRIE), C.CHARGE_IDLE);
  assert.equal(state.reason, 'aim');
  // Pełne ładowanie z błędem 0,05: trzyma, potem strzela, gdy wieżyczka dojdzie.
  const held = run(VALKYRIE, { aimErr: 0.05 }, 2000, (k) => (k >= 100 ? { aimErr: 0.02 } : null));
  assert.equal(held.result, C.CHARGE_FIRE);
  assert.equal(held.steps, 101, 'strzał w pierwszym kroku z dobrym celem');
  const lost = run(VALKYRIE, { aimErr: 0.06 });
  assert.equal(lost.result, C.CHARGE_CANCEL);
  const expected = Math.ceil(0.28 * 120) + Math.ceil(C.CHARGE_CONFIG.holdMax * 120);
  assert.ok(Math.abs(lost.steps - expected) <= 2, `gaśnie po holdMax: ${lost.steps} vs ~${expected}`);
  assert.equal(lost.state.reason, 'aim');
  // Przeładowanie blokuje start.
  const cd = C.createChargeState();
  assert.equal(C.stepCharge(cd, DT, { wantFire: true, ready: false }, MJOLNIR), C.CHARGE_IDLE);
  assert.equal(cd.reason, 'cooldown');
  // Przerwanie z zewnątrz (zmiana broni, skok).
  const ext = C.createChargeState();
  C.stepCharge(ext, DT, { wantFire: true }, MJOLNIR);
  C.cancelCharge(ext);
  assert.equal(C.stepCharge(ext, DT, { wantFire: false }, MJOLNIR), C.CHARGE_IDLE);
});

test('bilans dps z ładowaniem (liczby do POSTEP.md): Mjolnir 227 zamiast 312, Valkyrie 152 zamiast 167', () => {
  const dps = (def, charge) => def.baseDamage / (def.cooldown + charge);
  assert.ok(Math.abs(dps(MJOLNIR, 0) - 312.5) < 1e-9);
  assert.ok(Math.abs(dps(MJOLNIR, C.chargeTimeOf(MJOLNIR)) - 2500 / 11) < 1e-9);
  assert.ok(Math.abs(dps(VALKYRIE, 0) - 500 / 3) < 1e-9);
  assert.ok(Math.abs(dps(VALKYRIE, C.chargeTimeOf(VALKYRIE)) - 500 / 3.28) < 1e-9);
  // Stan ładowania bez Math.random.
  const random = Math.random;
  Math.random = () => { throw new Error('Math.random w ładowaniu'); };
  try { run(MJOLNIR); run(VALKYRIE, { aimErr: 0.05 }); } finally { Math.random = random; }
});
