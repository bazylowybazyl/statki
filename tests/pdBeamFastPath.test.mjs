import test from 'node:test';
import assert from 'node:assert/strict';

import { createPdBeamHit, resolvePdBeamHit } from '../src/game/pdBeamFastPath.js';
import { createBeamHarness, makeHexTarget, makeCircleTarget, withSeededRandom } from './helpers/beamShotHarness.mjs';
import { readIndexHtml, sliceFunction } from './helpers/indexSource.mjs';

const html = readIndexHtml();

// ---------------------------------------------------------------------------
// Moduł: test samego celu

function deps(overrides = {}) {
  return {
    shieldBlockingRadiusTowards: () => 0,
    sweepImpact: null,
    hullRadius: (e) => e.radius,
    playerShip: null,
    ...overrides
  };
}

test('tarcza celu: wiązka kończy się na wejściu w bańkę', () => {
  const out = createPdBeamHit();
  const target = { x: 500, y: 0, radius: 30, hp: 10, maxHp: 10 };
  resolvePdBeamHit(out, 0, 0, 1, 0, 1000, target, deps({ shieldBlockingRadiusTowards: () => 100 }));
  assert.equal(out.entity, target);
  assert.equal(out.shield, true);
  assert.equal(out.kind, 'npc');
  assert.ok(Math.abs(out.dist - 400) < 1e-9, `dist ${out.dist}`);
});

test('kadłub heksowy: sweep dostaje odcinek przycięty do okręgu kadłuba', () => {
  const out = createPdBeamHit();
  const target = { x: 600, y: 0, radius: 50, hp: 10, maxHp: 10, hexGrid: {} };
  const shard = { c: 3, r: 4 };
  let seen = null;
  const sweepImpact = (e, x0, y0, x1, y1, r) => { seen = [x0, y0, x1, y1, r]; return { t: 0.25, hitShard: shard }; };
  resolvePdBeamHit(out, 0, 0, 1, 0, 1000, target, deps({ sweepImpact }));
  assert.deepEqual(seen, [550, 0, 650, 0, 0], 'sweep po odcinku nad kadłubem');
  assert.equal(out.entity, target);
  assert.equal(out.shard, shard);
  assert.equal(out.shield, false);
  assert.ok(Math.abs(out.dist - 575) < 1e-9);
});

test('kadłub heksowy bez trafionego heksa = pudło do pełnego zasięgu', () => {
  const out = createPdBeamHit();
  const target = { x: 600, y: 0, radius: 50, hexGrid: {} };
  resolvePdBeamHit(out, 0, 0, 1, 0, 1000, target, deps({ sweepImpact: () => null }));
  assert.equal(out.entity, null);
  assert.equal(out.dist, 1000);
});

test('myśliwiec bez siatki: okrąg kadłuba; gracz dostaje klasę player', () => {
  const out = createPdBeamHit();
  const fighter = { x: 300, y: 10, radius: 20, hp: 5, maxHp: 5, fighter: true };
  resolvePdBeamHit(out, 0, 0, 1, 0, 1000, fighter, deps());
  assert.equal(out.entity, fighter);
  assert.equal(out.kind, 'npc');
  assert.ok(out.dist > 280 && out.dist < 300);

  const player = { pos: { x: 200, y: 0 }, radius: 40 };
  resolvePdBeamHit(out, 0, 0, 1, 0, 1000, player, deps({ playerShip: player }));
  assert.equal(out.kind, 'player');
});

test('cel poza zasięgiem, za lufą, obok wiązki albo martwy = pudło', () => {
  const out = createPdBeamHit();
  const d = deps();
  for (const target of [
    { x: 2000, y: 0, radius: 20 },
    { x: -300, y: 0, radius: 20 },
    { x: 500, y: 200, radius: 20 },
    { x: 500, y: 0, radius: 20, dead: true }
  ]) {
    resolvePdBeamHit(out, 0, 0, 1, 0, 1000, target, d);
    assert.equal(out.entity, null, JSON.stringify(target));
    assert.equal(out.dist, 1000);
  }
});

test('rakieta jako cel: wiązka NPC jej nie niszczy (jak dotąd) — pudło', () => {
  const out = createPdBeamHit();
  resolvePdBeamHit(out, 0, 0, 1, 0, 1000, { type: 'rocket', x: 300, y: 0, r: 2 }, deps());
  assert.equal(out.entity, null);
});

// ---------------------------------------------------------------------------
// fireWeaponCore z index.html: strzał PD z celem nie dotyka świata

function pdScene() {
  const h = createBeamHarness({ html });
  const shooter = { __name: 'pd', id: 'pd1', x: 0, y: 0, angle: 0, friendly: true, vx: 0, vy: 0 };
  const shielded = makeHexTarget('shielded', { x: 600, y: 0, width: 160, height: 60, shield: 400 });
  const bare = makeHexTarget('bare', { x: 0, y: 650, width: 160, height: 60, angle: 0.4 });
  const fighter = makeCircleTarget('fighter', { x: -500, y: 0, radius: 14, fighter: true, type: 'fighter' });
  const far = makeCircleTarget('far', { x: 0, y: -5000, radius: 14, fighter: true, type: 'fighter' });
  // Coś na linii strzału, czego szybka ścieżka nie ma prawa widzieć.
  const blocker = makeCircleTarget('blocker', { x: 300, y: 0, radius: 60 });
  h.world.npcs.push(shielded, bare, fighter, far, blocker);
  h.world.stations.push(makeCircleTarget('station', { x: 5000, y: 5000, radius: 300 }));
  return { h, shooter, shielded, bare, fighter, far, blocker };
}

function pdMuzzle(target, pdTarget = target) {
  const d = Math.hypot(target.x, target.y) || 1;
  return { pos: { x: 0, y: 0 }, dir: { x: target.x / d, y: target.y / d }, baseVel: { x: 0, y: 0 }, emitterUid: 'npc:pd1:aux0', pdTarget };
}

const kinds = (log, kind) => log.filter((e) => e[0] === kind);

test('PD z celem: tarcza celu, zero dostępów do npcs/stations/wrecks, jedna wiązka 2D, bez pulsu 3D', () => {
  withSeededRandom(1, () => {
    const { h, shooter, shielded } = pdScene();
    const log = h.fire(shooter, shielded, 'laser_pd_mk1', pdMuzzle(shielded));
    assert.deepEqual(h.counters, { npcs: 0, stations: 0, wrecks: 0 }, 'strzał PD przeszukał świat');
    assert.equal(kinds(log, 'shieldFx').length, 1, 'efekt tarczy');
    assert.deepEqual(kinds(log, 'dmgNpc').map((e) => e[1]), ['shielded'], 'obrażenia w cel, nie w blocker po drodze');
    assert.equal(kinds(log, 'beam2d').length, 1, 'jedna wiązka 2D');
    const ev = kinds(log, 'event')[0];
    assert.equal(ev[5], null, 'PD nie wysyła wizualu pulse 3D');
  });
});

test('PD z celem: kadłub bez tarczy dostaje heks z sweepu', () => {
  withSeededRandom(2, () => {
    const { h, shooter, bare } = pdScene();
    const log = h.fire(shooter, bare, 'laser_pd_mk1', pdMuzzle(bare));
    assert.deepEqual(h.counters, { npcs: 0, stations: 0, wrecks: 0 });
    const hex = kinds(log, 'hex');
    assert.equal(hex.length, 1);
    assert.equal(hex[0][1], 'bare');
    assert.ok(hex[0][5], 'trafiony heks idzie do applyImpact');
    assert.deepEqual(kinds(log, 'dmgNpc').map((e) => e[1]), ['bare']);
  });
});

test('PD z celem: myśliwiec trafiony, cel poza zasięgiem = pudło do pełnego zasięgu', () => {
  withSeededRandom(3, () => {
    const { h, shooter, fighter, far } = pdScene();
    let log = h.fire(shooter, fighter, 'laser_pd_mk1', pdMuzzle(fighter));
    assert.deepEqual(kinds(log, 'dmgNpc').map((e) => e[1]), ['fighter']);

    log = h.fire(shooter, far, 'laser_pd_mk1', pdMuzzle(far));
    assert.equal(kinds(log, 'dmgNpc').length, 0);
    assert.equal(kinds(log, 'hex').length, 0);
    const beam = kinds(log, 'beam2d')[0];
    assert.deepEqual(beam.slice(1, 5), [0, 0, 0, -1000], 'wiązka do pełnego zasięgu (1000 u)');
    assert.deepEqual(h.counters, { npcs: 0, stations: 0, wrecks: 0 });
  });
});

test('PD bez celu od AI idzie ścieżką ogólną (trafia blocker), ale nadal bez pulsu 3D', () => {
  withSeededRandom(4, () => {
    const { h, shooter, shielded } = pdScene();
    const log = h.fire(shooter, shielded, 'laser_pd_mk1', pdMuzzle(shielded, null));
    assert.ok(h.counters.npcs > 0, 'ścieżka ogólna skanuje świat');
    assert.deepEqual(kinds(log, 'dmgNpc').map((e) => e[1]), ['blocker']);
    assert.equal(kinds(log, 'event')[0][5], null);
  });
});

test('broń główna: ścieżka ogólna i wizual 3D bez zmian', () => {
  withSeededRandom(5, () => {
    const { h, shooter, shielded } = pdScene();
    const log = h.fire(shooter, shielded, 'beam_pulse', pdMuzzle(shielded, null));
    assert.ok(h.counters.npcs > 0);
    assert.deepEqual(kinds(log, 'dmgNpc').map((e) => e[1]), ['blocker'], 'pierwszy obiekt na linii');
    assert.equal(kinds(log, 'beam2d').length, 0, 'render3dOnly: bez smugi 2D');
    const ev = kinds(log, 'event')[0];
    assert.ok(ev[5], 'wizual 3D wiązki głównej zostaje');
    assert.equal(ev[5][6], 'npc:pd1:aux0');
  });
});

// ---------------------------------------------------------------------------
// Okablowanie: AI → spawnBulletAdapter → fireWeaponCore

test('AI podaje cel PD, adapter przekazuje go do fireWeaponCore', async () => {
  const { readFileSync } = await import('node:fs');
  const ai = readFileSync(new URL('../src/ai/capitalAI.js', import.meta.url), 'utf8');
  assert.match(ai, /pdTarget: weapon\.pd \? bestTarget : null/);
  const adapter = html.slice(html.indexOf('window.spawnBulletAdapter = function'), html.indexOf('function getNpcEmitterUid('));
  assert.match(adapter, /pdTarget: opts\.pdTarget \|\| null/);
  assert.match(adapter, /emitterUid: opts\.hp\?\.id != null \? getNpcEmitterUid\(owner, opts\.hp\) : null/);
  const fire = sliceFunction(html, 'window.fireWeaponCore = function (shooter, target, weaponId, muzzleData) {');
  assert.match(fire, /\(pdBeam && muzzleData\.pdTarget\)\s*\?\s*resolvePdBeamHit\(/);
});

test('uid emitera NPC liczony raz na gniazdo, nie przy każdym strzale', () => {
  const src = sliceFunction(html, 'function getNpcEmitterUid(owner, hp) {');
  const getNpcEmitterUid = new Function(`${src}\nreturn getNpcEmitterUid;`)();
  const hp = { id: 'aux3' };
  const owner = { id: 77 };
  const a = getNpcEmitterUid(owner, hp);
  assert.equal(a, 'npc:77:aux3');
  assert.equal(getNpcEmitterUid(owner, hp), a);
  assert.equal(getNpcEmitterUid({ id: 78 }, hp), 'npc:78:aux3', 'inny właściciel — nowy uid');
  assert.equal(typeof hp.__emitterUidOwner, 'number', 'na hp tylko wartości proste');
});
