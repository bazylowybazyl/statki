import test from 'node:test';
import assert from 'node:assert/strict';

import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { CanvasVFX } from '../src/vfx/canvasParticleSystem.js';
import { readIndexHtml, sliceFunction, loadIndexFunction } from './helpers/indexSource.mjs';

const html = readIndexHtml();

// Ogon p95 bitwy to GC po setkach tysięcy krótkich obiektów na sekundę
// (docs/AUDYT-wydajnosc-bitwa-2026-09-24.md, 2.9). Te testy pilnują, że gorące
// ścieżki pracują na obiektach wielokrotnego użytku: kolejne wywołania dają
// TE SAME referencje, tylko z nowymi wartościami.

test('saveState nadpisuje jeden prevState zamiast budować 3 obiekty i tablicę na krok', () => {
  const ship = {
    pos: { x: 10, y: 20 }, angle: 0.5,
    turret: { angle: 1 }, turret2: { angle: 2 }, turret3: { angle: 3 }, turret4: { angle: 4 },
    ciws: [{ angle: 0.1 }, { angle: 0.2 }]
  };
  const scope = { ship, prevState: null, splitScreenMode: false, player2Ship: null, saveState2: () => {} };
  const saveState = loadIndexFunction(html, 'function saveState() {', 'saveState', scope);

  saveState();
  const first = scope.prevState;
  const { pos, ciwsAngles } = first;
  assert.deepEqual([pos.x, pos.y, first.angle, first.turretAngle4], [10, 20, 0.5, 4]);
  assert.deepEqual(ciwsAngles, [0.1, 0.2]);

  ship.pos.x = 11; ship.angle = 0.7; ship.turret.angle = 1.5; ship.ciws[1].angle = 0.9; ship.ciws.push({ angle: 1.1 });
  saveState();
  assert.equal(scope.prevState, first, 'ten sam obiekt stanu');
  assert.equal(first.pos, pos, 'ten sam obiekt pozycji');
  assert.equal(first.ciwsAngles, ciwsAngles, 'ta sama tablica kątów CIWS');
  assert.deepEqual([pos.x, first.angle, first.turretAngle], [11, 0.7, 1.5]);
  assert.deepEqual(ciwsAngles, [0.1, 0.9, 1.1]);
  ship.ciws.length = 1;
  saveState();
  assert.deepEqual(ciwsAngles, [0.1], 'tablica skraca się razem z listą CIWS');
});

test('saveState2 (split screen) też pracuje w miejscu', () => {
  const player2Ship = { pos: { x: 1, y: 2 }, angle: 3 };
  const scope = { player2Ship, prevState2: null };
  const saveState2 = loadIndexFunction(html, 'function saveState2() {', 'saveState2', scope);
  saveState2();
  const first = scope.prevState2;
  player2Ship.pos.x = 5;
  saveState2();
  assert.equal(scope.prevState2, first);
  assert.equal(first.pos.x, 5);
});

// spawnBulletAdapter + pomocniki, prosto z index.html.
function loadAdapter() {
  const start = html.indexOf('    // Wylot strzału NPC — obiekty wielokrotnego użytku');
  const end = html.indexOf('    // --- HELPER: Tłumacz typów dla AI', start);
  assert.ok(start > 0 && end > start, 'nie znaleziono bloku spawnBulletAdapter');
  const muzzles = [];
  const win = {
    fireWeaponCore: (owner, target, id, muzzle) => {
      muzzles.push({ ref: muzzle, pos: muzzle.pos, dir: muzzle.dir, baseVel: muzzle.baseVel, x: muzzle.pos.x, y: muzzle.pos.y, uid: muzzle.emitterUid, pdTarget: muzzle.pdTarget });
    }
  };
  const scope = {
    window: win,
    getEntityHardpointScaleX: loadIndexFunction(html, 'function getEntityHardpointScaleX(entity) {', 'getEntityHardpointScaleX'),
    getEntityHardpointScaleY: loadIndexFunction(html, 'function getEntityHardpointScaleY(entity) {', 'getEntityHardpointScaleY')
  };
  new Function('__scope', `with (__scope) {\n${html.slice(start, end)}\n}`)(scope);
  return { adapter: win.spawnBulletAdapter, muzzles };
}

test('spawnBulletAdapter używa tych samych obiektów wylotu przy każdym strzale', () => {
  const { adapter, muzzles } = loadAdapter();
  const owner = { id: 9, x: 100, y: 50, angle: Math.PI / 2, vx: 3, vy: 4, __hardpointScale: 2 };
  const hp = { id: 'aux1', x: 10, y: 0 };
  const target = { x: 0, y: 0 };
  adapter(owner, target, MASTER_WEAPONS.laser_pd_mk1, { hp, pdTarget: target });
  adapter(owner, target, MASTER_WEAPONS.laser_pd_mk1, { hp });
  assert.equal(muzzles.length, 2);
  assert.equal(muzzles[0].ref, muzzles[1].ref, 'jeden obiekt muzzle');
  assert.equal(muzzles[0].pos, muzzles[1].pos);
  assert.equal(muzzles[0].dir, muzzles[1].dir);
  assert.equal(muzzles[0].baseVel, muzzles[1].baseVel);
  // Hardpoint (10, 0) × skala 2, obrót o 90°: +20 w osi y.
  assert.ok(Math.abs(muzzles[0].x - 100) < 1e-9 && Math.abs(muzzles[0].y - 70) < 1e-9, `${muzzles[0].x},${muzzles[0].y}`);
  assert.equal(muzzles[0].uid, 'npc:9:aux1');
  assert.equal(muzzles[0].pdTarget, target);
  assert.equal(muzzles[1].pdTarget, null, 'cel PD nie przecieka do następnego strzału');
  assert.equal(muzzles[0].ref.pdTarget, null, 'po strzale muzzle nie trzyma celu');
});

test('opcje strzału AI i punkt celowania fireWeaponCore to obiekty wielokrotnego użytku', async () => {
  const shots = [];
  globalThis.window = {
    npcs: [{ type: 'fighter', fighter: true, x: 300, y: 0, isPirate: true, friendly: false }],
    bullets: [], __npcRocketThreats: [], __playerRocketThreats: [],
    wrapAngle: (a) => Math.atan2(Math.sin(a), Math.cos(a)),
    getUnitKind: (n) => (n.fighter ? 'fighter' : 'frigate'),
    hasShipChip: () => false,
    isLineOfFireBlocked: () => false,
    spawnBulletAdapter: (owner, target, def, opts) => shots.push({ opts, hp: opts.hp, pdTarget: opts.pdTarget })
  };
  const { processAutonomousWeapons } = await import('../src/ai/capitalAI.js');
  const npc = {
    id: 'a', x: 0, y: 0, angle: 0, friendly: true,
    weapons: {
      main: [],
      aux: [
        { hp: { id: 'a0', type: 'aux', x: 0, y: 0, mount: 'ciws_mk1' }, weapon: MASTER_WEAPONS.ciws_mk1 },
        { hp: { id: 'a1', type: 'aux', x: 0, y: 5, mount: 'ciws_mk1' }, weapon: MASTER_WEAPONS.ciws_mk1 }
      ],
      missile: []
    }
  };
  for (let t = 0; t < 3; t += 0.05) processAutonomousWeapons(npc, 0.05);
  assert.ok(shots.length >= 2, `za mało strzałów: ${shots.length}`);
  assert.ok(shots.every((s) => s.opts === shots[0].opts), 'jeden obiekt opcji dla wszystkich strzałów');
  assert.ok(shots.every((s) => s.pdTarget && s.hp), 'wartości wpisane przed wywołaniem');
  assert.equal(shots[0].opts.pdTarget, null, 'po strzale opcje nie trzymają celu');

  const fire = sliceFunction(html, 'window.fireWeaponCore = function (shooter, target, weaponId, muzzleData) {');
  assert.match(fire, /let aimPoint = _fireAimPoint;/);
  assert.doesNotMatch(fire, /aimPoint = \{/);
  assert.doesNotMatch(fire, /\.\.\.\(flakProfile \?/, 'flak bez spreadu obiektu tymczasowego per pocisk');
  assert.match(fire, /if \(flakProfile\) \{\s*bullet\.flakAge = 0;/);
});

test('spawnParticleXY nie tworzy obiektów: te same cząstki z puli', () => {
  const saved = { pool: CanvasVFX.particlePool, active: CanvasVFX.activeParticles, next: CanvasVFX.nextParticleIndex, max: CanvasVFX.MAX_PARTICLES };
  try {
    CanvasVFX.MAX_PARTICLES = 3;
    CanvasVFX.particlePool = [0, 1, 2].map(() => ({ pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, active: false, _activeIdx: -1 }));
    CanvasVFX.activeParticles = [];
    CanvasVFX.nextParticleIndex = 0;
    const particles = CanvasVFX.particlePool.slice();
    const vels = particles.map((p) => p.vel);
    for (let i = 0; i < 7; i++) CanvasVFX.spawnParticleXY(i, i, i, i, 0.1, '#fff', 1, true);
    assert.deepEqual(CanvasVFX.particlePool, particles);
    assert.deepEqual(CanvasVFX.particlePool.map((p) => p.vel), vels);
    assert.ok(CanvasVFX.activeParticles.every((p) => particles.includes(p)));
  } finally {
    CanvasVFX.particlePool = saved.pool;
    CanvasVFX.activeParticles = saved.active;
    CanvasVFX.nextParticleIndex = saved.next;
    CanvasVFX.MAX_PARTICLES = saved.max;
  }
});
