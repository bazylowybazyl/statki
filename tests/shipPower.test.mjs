// Stan zasilania okrętu (src/game/shipPower.js): automat, bramki rozgrywki, sygnatura, kanały świateł.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POWER_OFF, POWER_STARTUP, POWER_ON, POWER_SHUTDOWN, SHIP_POWER_TUNE as T,
  shipPowerOf, powerStateOf, shipPowerOn, shipPowerDown, powerAllowsEngines, powerSignatureMul, powerSensorMul,
  powerDownShip, powerUpShip, toggleShipPower, setShipPowerState, stepShipPower, shipPowerLook, powerWaveAt,
  floodFlicker, powerHudLabel, powerStartupLeft
} from '../src/game/shipPower.js';

function run(e, seconds, dt = 1 / 60) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) stepShipPower(e, dt);
}

test('encja bez stanu = PRACA (NPC, stare zapisy)', () => {
  const e = {};
  assert.equal(powerStateOf(e), POWER_ON);
  assert.equal(shipPowerOn(e), true);
  assert.equal(powerAllowsEngines(e), true);
  assert.equal(powerSignatureMul(e), 1);
  assert.equal(powerSensorMul(e), 1);
  assert.equal(powerHudLabel(e), null);
  assert.equal(e.shipPower, undefined, 'odczyt nie tworzy stanu');
});

test('wyłączenie: systemy od razu, sygnatura spada w czasie gaszenia, potem WYŁ.', () => {
  const e = {};
  assert.equal(powerDownShip(e), true);
  assert.equal(powerStateOf(e), POWER_SHUTDOWN);
  assert.equal(shipPowerOn(e), false, 'broń i tarcza gasną od razu');
  assert.equal(powerAllowsEngines(e), false);
  assert.equal(powerSignatureMul(e), 1, 'na starcie gaszenia pełna sygnatura');
  run(e, T.shutdownTime * 0.5);
  const mid = powerSignatureMul(e);
  assert.ok(mid < 1 && mid > T.offSignature, `w połowie gaszenia sygnatura pośrodku (${mid})`);
  run(e, T.shutdownTime * 0.5 + 0.05);
  assert.equal(powerStateOf(e), POWER_OFF);
  assert.equal(powerSignatureMul(e), T.offSignature);
  assert.equal(powerSensorMul(e), T.offSensors);
  assert.ok(T.shutdownTime <= 2.5, 'sygnatura spada tak szybko jak gaszenie (decyzja użytkownika: nie 15 s)');
});

test('rozruch: silniki od enginesAt, systemy dopiero w PRACY, sygnatura pełna od razu', () => {
  const e = {};
  setShipPowerState(e, POWER_OFF);
  assert.equal(powerUpShip(e), true);
  assert.equal(powerStateOf(e), POWER_STARTUP);
  assert.equal(powerSignatureMul(e), 1);
  assert.equal(powerAllowsEngines(e), false);
  run(e, T.enginesAt * T.startupTime + 0.05);
  assert.equal(powerAllowsEngines(e), true);
  assert.equal(shipPowerOn(e), false, 'broń jeszcze nie');
  assert.ok(powerStartupLeft(e) > 0);
  run(e, T.startupTime);
  assert.equal(powerStateOf(e), POWER_ON);
  assert.equal(shipPowerOn(e), true);
  assert.equal(shipPowerDown(e), false);
});

test('przełącznik i przejścia w trakcie faz', () => {
  const e = {};
  toggleShipPower(e);
  assert.equal(powerStateOf(e), POWER_SHUTDOWN);
  run(e, 0.5);
  toggleShipPower(e);
  assert.equal(powerStateOf(e), POWER_STARTUP, 'włączenie w trakcie gaszenia = ciepły rozruch');
  assert.ok(e.shipPower.t > 0, 'ciepły rozruch pomija fazę reaktora');
  const serial = e.shipPower.serial;
  toggleShipPower(e);
  assert.equal(powerStateOf(e), POWER_SHUTDOWN, 'wyłączenie w trakcie rozruchu');
  assert.equal(e.shipPower.serial, serial + 1);
  assert.equal(powerUpShip({ shipPower: { state: POWER_ON, t: 0, serial: 0 } }), false, 'PRACA — nic do włączenia');
});

test('kanały świateł: PRACA pełne, WYŁ. tylko awaryjne, fala od reaktora w rozruchu i do reaktora w gaszeniu', () => {
  const o = {};
  shipPowerLook(POWER_ON, 0, o);
  assert.deepEqual([o.nav, o.bridge, o.flood, o.emergency], [1, 1, 1, 0]);
  assert.ok(powerWaveAt(o.front, 1) > 0.999);
  shipPowerLook(-1, 0, o);
  assert.equal(o.level, 1, 'stan nieznany = PRACA');
  shipPowerLook(POWER_OFF, 0, o);
  assert.deepEqual([o.nav, o.bridge, o.flood], [0, 0, 0]);
  assert.ok(o.emergency > 0, 'czerwone awaryjne przy wyłączonym');
  assert.ok(powerWaveAt(o.front, 0) < 0.001);

  // Rozruch: najpierw lampy przy reaktorze, potem krańce; lampy nawigacyjne na końcu.
  const u = (T.waveAt[0] + T.waveAt[1]) / 2;
  shipPowerLook(POWER_STARTUP, u * T.startupTime, o);
  assert.ok(powerWaveAt(o.front, 0.05) > powerWaveAt(o.front, 0.95), 'fala idzie od reaktora');
  assert.equal(o.nav, 0);
  shipPowerLook(POWER_STARTUP, T.startupTime * 0.99, o);
  assert.equal(o.nav, 1);

  // Gaszenie: krańce gasną pierwsze, okna mostka ostatnie.
  shipPowerLook(POWER_SHUTDOWN, T.shutdownTime * 0.4, o);
  assert.ok(powerWaveAt(o.front, 0.95) < powerWaveAt(o.front, 0.05), 'fala gaśnie do reaktora');
  assert.equal(o.bridge, 1, 'okna mostka jeszcze świecą');
  shipPowerLook(POWER_SHUTDOWN, T.shutdownTime * 0.999, o);
  assert.ok(o.bridge < 0.05);
});

test('kanały ciągłe na granicach faz (bez skoku obrazu)', () => {
  const a = {}, b = {};
  shipPowerLook(POWER_STARTUP, T.startupTime - 1e-6, a);
  shipPowerLook(POWER_ON, 0, b);
  for (const k of ['bridge', 'flood', 'reactor', 'nav']) assert.ok(Math.abs(a[k] - b[k]) < 1e-3, `rozruch → praca: ${k}`);
  shipPowerLook(POWER_SHUTDOWN, T.shutdownTime - 1e-6, a);
  shipPowerLook(POWER_OFF, 0, b);
  for (const k of ['bridge', 'flood', 'nav', 'emergency']) assert.ok(Math.abs(a[k] - b[k]) < 1e-3, `gaszenie → wył.: ${k}`);
});

test('migotanie deterministyczne i rzadsze ku końcowi', () => {
  let early = 0, late = 0;
  for (let i = 0; i < 400; i++) {
    const t = i / 60;
    assert.equal(floodFlicker(t, 3, 0.1), floodFlicker(t, 3, 0.1));
    if (floodFlicker(t, 3, 0.05) < 1) early++;
    if (floodFlicker(t, 3, 0.95) < 1) late++;
  }
  assert.ok(early > late * 3, `wcześnie ${early}, późno ${late}`);
});

test('moduł czysty: bez Math.random, DOM i three', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/game/shipPower.js', import.meta.url), 'utf8');
  assert.ok(!/Math\.random\s*\(/.test(src));
  assert.ok(!/from ['"]three/.test(src));
  assert.ok(!/document\./.test(src));
  assert.equal(shipPowerOf(null), null);
});
