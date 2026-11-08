// Zasięg radarów (2026-11-03, podwaliny): model wykrywania czujniki × sygnatura × osłona (src/game/sensorDetection.js).
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};

const D = await import('../src/game/sensorDetection.js');
const { getEntitySizeModifier } = await import('../src/game/sensorSystem.js');
const { resolveAwarenessSensorRange } = await import('../src/ai/fleetAwareness.js');
const { SHIP_SENSOR_PROFILES } = await import('../src/data/ships.js');

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

test('stan neutralny = dzisiejsze koło obrazu sytuacji AI (zasięg pasywny × wykrywalność klasy)', () => {
  const s = D.createSensorState();
  assert.equal(D.signatureMul(s), 1);
  const observers = [
    { type: 'frigate', sensors: { ...SHIP_SENSOR_PROFILES.frigate_combat } },
    { type: 'battleship', sensors: { ...SHIP_SENSOR_PROFILES.battleship_combat } },
    { type: 'atlas', isCapitalShip: true, sensors: { ...SHIP_SENSOR_PROFILES.atlas_combat } },
    { type: 'pirate_frigate', isPirate: true } // bez profilu — profil klasy
  ];
  const targets = [{ type: 'fighter' }, { type: 'frigate' }, { type: 'destroyer' }, { type: 'battleship' }, { isCapitalShip: true }];
  for (const o of observers) {
    const passive = resolveAwarenessSensorRange(o);
    const strength = D.sensorStrength(passive, passive * 2, s);
    assert.equal(strength, passive);
    for (const t of targets) {
      const sig = D.entitySignature(getEntitySizeModifier(t), s);
      assert.equal(D.detectionRange(strength, sig), passive * getEntitySizeModifier(t));
    }
  }
});

test('sygnatura: ciąg, napęd, ostrzał, impuls, cicha praca, wrak; podłoga', () => {
  const T = D.DETECTION_TUNE.signature;
  const s = D.createSensorState();
  s.thrust = 1;
  assert.ok(near(D.signatureMul(s), 1 + T.thrustAdd));
  s.thrust = 7; // ułamek ciągu z sufitem
  assert.ok(near(D.signatureMul(s), 1 + T.thrustAdd));
  D.resetSensorState(s);
  s.drive = D.SENSOR_DRIVE.warp;
  assert.equal(D.signatureMul(s), T.driveMul[D.SENSOR_DRIVE.warp]);
  D.resetSensorState(s);
  D.noteSensorFire(s);
  assert.ok(near(D.signatureMul(s), 1 + T.fireAdd));
  D.noteSensorFire(s, 0.3); // słabszy strzał nie zbija ciepła
  assert.equal(s.fireHeat, 1);
  D.resetSensorState(s);
  D.noteSensorPing(s);
  assert.ok(near(D.signatureMul(s), 1 + T.pingAdd));
  D.resetSensorState(s);
  s.silent = true;
  assert.equal(D.signatureMul(s), T.silentMul);
  s.wreck = true;
  assert.ok(near(D.entitySignature(0.5, s), Math.max(T.min, 0.5 * T.silentMul * T.wreckMul)));
  assert.equal(D.entitySignature(0, s), T.min);
});

test('czujniki: impuls X rośnie ku zasięgowi aktywnemu i gaśnie, cicha praca obcina', () => {
  const s = D.createSensorState();
  D.noteSensorPing(s);
  assert.equal(D.sensorStrength(80000, 90000, s), 90000);
  D.stepSensorState(s, D.DETECTION_TUNE.signature.pingSec / 2);
  assert.ok(near(D.sensorStrength(80000, 90000, s), 85000));
  assert.equal(D.sensorStrength(80000, 60000, s), 80000, 'aktywny poniżej pasywnego — bez zmiany');
  s.silent = true;
  assert.ok(near(D.sensorStrength(80000, 90000, s), 85000 * D.DETECTION_TUNE.strength.silentMul));
});

test('ciepło gaśnie liniowo w czasie — wynik nie zależy od kroku fizyki (60 / 120 / 240 Hz)', () => {
  const out = [];
  for (const hz of [60, 120, 240]) {
    const s = D.createSensorState();
    D.noteSensorFire(s);
    D.noteSensorPing(s);
    for (let i = 0; i < hz * 1.5; i++) D.stepSensorState(s, 1 / hz);
    out.push([s.fireHeat, s.pingHeat]);
  }
  for (const [f, p] of out) {
    assert.ok(near(f, 1 - 1.5 / D.DETECTION_TUNE.signature.fireSec, 1e-9));
    assert.ok(near(p, 1 - 1.5 / D.DETECTION_TUNE.signature.pingSec, 1e-9));
  }
  const s = D.createSensorState();
  D.noteSensorFire(s);
  D.stepSensorState(s, 100);
  assert.equal(s.fireHeat, 0);
});

test('poziomy: identyfikacja (wzrok) wygrywa, potem kontakt, potem nic', () => {
  const L = D.SENSOR_LEVEL;
  assert.equal(D.detectionLevel(10 ** 2, 50, 18), L.IDENTIFIED);
  assert.equal(D.detectionLevel(30 ** 2, 50, 18), L.CONTACT);
  assert.equal(D.detectionLevel(60 ** 2, 50, 18), L.NONE);
  // cichy cel bliżej niż wzrok, choć poza zasięgiem wykrycia — wzrok i tak go widzi
  assert.equal(D.detectionLevel(10 ** 2, 5, 18), L.IDENTIFIED);
  assert.equal(D.detectionLevel(10 ** 2, 50, 0), L.CONTACT);
});

test('rozmiar kontaktu z sygnatury', () => {
  assert.equal(D.contactSizeClass(0.5), 0);
  assert.equal(D.contactSizeClass(0.7), 1);
  assert.equal(D.contactSizeClass(1.0), 2);
  assert.equal(D.contactSizeClass(1.3), 3);
  assert.equal(D.SENSOR_SIZE_LABELS[D.contactSizeClass(1.3)], 'OGROMNY');
});

test('niepewność kontaktu: 0 w zasięgu wzroku, rośnie ku granicy wykrycia, deterministyczna i płynna', () => {
  const o = {};
  D.contactOffset(7, 3, 15000, 60000, 18000, o);
  assert.equal(o.err, 0);
  assert.equal(o.x, 0);
  D.contactOffset(7, 3, 60000, 60000, 18000, o);
  assert.ok(near(o.err, D.DETECTION_TUNE.contactErrFrac * 60000));
  assert.ok(Math.hypot(o.x, o.y) <= o.err + 1e-9);
  const a = { ...D.contactOffset(7, 3.3, 50000, 60000, 18000, {}) };
  const b = { ...D.contactOffset(7, 3.3, 50000, 60000, 18000, {}) };
  assert.deepEqual(a, b);
  // inne id — inne przesunięcie
  const c = D.contactOffset(8, 3.3, 50000, 60000, 18000, {});
  assert.ok(c.x !== a.x || c.y !== a.y);
  // płynnie: 1/60 s dalej przesunięcie zmienia się o ułamek błędu (także przez granicę losowań)
  const J = D.DETECTION_TUNE.contactJitterSec;
  for (const t of [1.1, J - 1 / 120, 2 * J - 1 / 120]) {
    const p = { ...D.contactOffset(7, t, 50000, 60000, 18000, {}) };
    const q = D.contactOffset(7, t + 1 / 60, 50000, 60000, 18000, {});
    assert.ok(Math.hypot(q.x - p.x, q.y - p.y) < 0.05 * p.err, `skok przy t=${t}`);
  }
});

test('obraz wykrycia: strony, liczba źródeł, głębia, osłona terenu', () => {
  const sources = [
    { x: 0, y: 0, strength: 80000, ident: 18000, side: 'friendly' },
    { x: 100000, y: 0, strength: 45000, ident: 11000, side: 'pirate' },
    { x: 100000, y: 30000, strength: 18000, ident: 5000, side: 'pirate' }
  ];
  const targets = [
    { x: 10000, y: 0, signature: 0.7, cover: 1, side: 'pirate' },    // w wzroku Atlasa
    { x: 50000, y: 0, signature: 0.7, cover: 1, side: 'pirate' },    // 56 km wykrycia — kontakt
    { x: 50000, y: 0, signature: 0.7, cover: 0.6, side: 'pirate' },  // w pasie: 33,6 km — nic
    { x: 60000, y: 0, signature: 1.3, cover: 1, side: 'friendly' },  // Atlas: pancernik piratów 58,5 km
    { x: 100000, y: 15000, signature: 0.7, side: 'pirate' }          // swoja strona — tylko Atlas, za daleko
  ];
  const p = D.createDetectionPicture(2);
  D.computeDetectionPicture(p, sources, sources.length, targets, targets.length);
  assert.equal(p.n, 5);
  assert.deepEqual([...p.level.subarray(0, 5)], [2, 1, 0, 1, 0]);
  assert.equal(p.seenBy[3], 1);
  assert.equal(p.by[3], 1);
  assert.ok(near(p.detectR[3], 45000 * 1.3));
  assert.ok(near(p.depth[3], 45000 * 1.3 - 40000));
  assert.ok(p.depth[2] < 0, 'poza zasięgiem — ujemna głębia = odległość do krawędzi');
  assert.ok(near(p.depth[2], 80000 * 0.7 * 0.6 - 50000));
  assert.equal(p.by[4], 0);
});
