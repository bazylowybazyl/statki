import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  createBulletStepBounds,
  computeBulletStepBounds,
  filterCirclesTouchingBounds,
  stationCollisionRadius
} from '../src/game/bulletStepFilters.js';
import { AsteroidField } from '../src/3d/asteroidField3D.js';
import { CanvasVFX } from '../src/vfx/canvasParticleSystem.js';
import { DestructorSystem, disposeHexBody } from '../src/game/destructor.js';
import { makeDestructorHull } from './helpers/destructorHull.mjs';
import { readIndexHtml, sliceFunction, loadIndexFunction } from './helpers/indexSource.mjs';

const html = readIndexHtml();

// ---------------------------------------------------------------------------
// Stacje i platformy: raz na krok, tylko te w pudle chmury pocisków

test('stacja poza pudłem pocisków nie trafia na listę kroku, ta w pudle tak', () => {
  const bullets = [
    { x: 0, y: 0, vx: 1200, vy: 0, r: 2 },
    { x: 500, y: 300, vx: 0, vy: -600, r: 4 }
  ];
  const bounds = computeBulletStepBounds(bullets, 1 / 120, createBulletStepBounds());
  assert.equal(bounds.count, 2);
  assert.equal(bounds.minX, 10, 'pozycja PO kroku: x + vx·dt');
  assert.equal(bounds.maxX, 500);
  assert.equal(bounds.maxY, 300 - 5, 'pozycja PO kroku: y + vy·dt');
  assert.equal(bounds.maxR, 4);

  const near = { name: 'near', x: 700, y: 100, hitR: 250 };
  const far = { name: 'far', x: 40000, y: -9000, hitR: 900 };
  const corner = { name: 'corner', x: -300, y: -300, r: 430 };
  const out = [];
  const n = filterCirclesTouchingBounds([far, near, corner], bounds, stationCollisionRadius, out);
  assert.equal(n, 2);
  assert.deepEqual(out.map((s) => s.name), ['near', 'corner'], 'kolejność zachowana');
});

test('bez skończonego promienia (stacja albo pocisk) filtr niczego nie odrzuca — jak stara pętla', () => {
  const bounds = computeBulletStepBounds([{ x: 0, y: 0, vx: 0, vy: 0, r: 2 }], 1 / 120, createBulletStepBounds());
  const odd = { x: 99999, y: 99999 };
  assert.deepEqual(filterCirclesTouchingBounds([odd], bounds, stationCollisionRadius, []), 1);
  const noR = computeBulletStepBounds([{ x: 0, y: 0, vx: 0, vy: 0 }], 1 / 120, createBulletStepBounds());
  assert.equal(noR.maxR, Infinity);
  assert.equal(filterCirclesTouchingBounds([{ x: 1e6, y: 1e6, hitR: 10 }], noR, stationCollisionRadius, []), 1);
  const empty = computeBulletStepBounds([], 1 / 120, createBulletStepBounds());
  assert.equal(filterCirclesTouchingBounds([{ x: 0, y: 0, hitR: 10 }], empty, stationCollisionRadius, []), 0);
});

test('pętla pocisków czyta listy kroku zamiast wszystkich stacji i platform', () => {
  const step = sliceFunction(html, 'function bulletsAndCollisionsStep(dt, emitTrails = true, trailDt = dt) {');
  assert.match(step, /computeBulletStepBounds\(bullets, dt, _bulletStepBounds\);/);
  assert.match(step, /const st = _bulletStepStations\[si\];/);
  assert.match(step, /const p = _bulletStepPlatforms\[pi\];/);
  assert.doesNotMatch(step, /for \(const st of stations\)/);
  assert.doesNotMatch(step, /for \(const p of mercMission\.weaponPlatforms\)/);
});

// ---------------------------------------------------------------------------
// Raycast asteroid: early-out poza pasem, bez domknięcia i obiektu per kandydat

function fieldWithBelt(minR, maxR, asteroids) {
  const field = Object.create(AsteroidField.prototype);
  field.sunX = 0;
  field.sunY = 0;
  field._beltBandList = [{ minR, maxR }];
  field.calls = 0;
  field.spatial = {
    forEachInRadius(x, y, r, cb) {
      field.calls++;
      for (const a of asteroids) cb(a);
    }
  };
  return field;
}

test('raycast daleko od pasów zwraca null bez wejścia w hash', () => {
  const rock = { alive: true, worldX: 150000, worldY: 0, scale: 50 };
  const field = fieldWithBelt(140000, 160000, [rock]);
  assert.equal(field.raycast(0, 0, 100, 0, 2), null);
  assert.equal(field.calls, 0, 'forEachInRadius nie może być wołane poza pasem');

  const hit = field.raycast(149000, 0, 151000, 0, 2);
  assert.equal(field.calls, 1);
  assert.equal(hit?.asteroid, rock);
  const again = field.raycast(149000, 0, 151000, 0, 2);
  assert.equal(again, hit, 'wynik to wspólny obiekt (bez alokacji per trafienie)');
});

test('raycast przekazuje do hasha funkcję modułową, nie nowe domknięcie', () => {
  const seen = [];
  const field = fieldWithBelt(0, 1e9, []);
  field.spatial.forEachInRadius = (x, y, r, cb) => { seen.push(cb); };
  field.raycast(0, 0, 100, 0);
  field.raycast(0, 0, 200, 0);
  assert.equal(seen.length, 2);
  assert.equal(seen[0], seen[1]);
});

// ---------------------------------------------------------------------------
// Smugi: raz na klatkę, gęstość niezależna od ?physHz, bez obiektów {x,y}

const bulletTrailCount = loadIndexFunction(html, 'function bulletTrailCount(frameDt) {', 'bulletTrailCount', {
  BULLET_TRAIL_HZ: 120,
  BULLET_TRAIL_MAX_PER_FRAME: 4
});

test('liczba porcji smugi zależy od czasu klatki, nie od liczby kroków fizyki', () => {
  // 60 fps: dwa kroki 120 Hz albo jeden krok 60 Hz — ta sama gęstość.
  assert.equal(bulletTrailCount(2 / 120), 2);
  assert.equal(bulletTrailCount(1 / 60), 2);
  assert.equal(bulletTrailCount(1 / 120), 1);
  assert.equal(bulletTrailCount(0.033), 4, 'długa klatka — sufit');
  assert.equal(bulletTrailCount(0), 1);
  const step = sliceFunction(html, 'function bulletsAndCollisionsStep(dt, emitTrails = true, trailDt = dt) {');
  assert.match(step, /const trailCount = emitTrails \? bulletTrailCount\(trailDt\) : 0;/);
  assert.match(html, /bulletsAndCollisionsStep\(dt, runFrameLogic, frameLogicDt\);/);
});

test('porcje smugi leżą wzdłuż drogi pocisku w tej klatce, bez obiektów pozycji', () => {
  const spawns = [];
  const spawnBulletTrail = loadIndexFunction(html, 'function spawnBulletTrail(b, count, frameDt) {', 'spawnBulletTrail', {
    CanvasVFX: { spawnParticleXY: (...args) => spawns.push(args) }
  });
  spawnBulletTrail({ type: 'autocannon', x: 100, y: 50, vx: 1200, vy: 0 }, 2, 2 / 120);
  assert.equal(spawns.length, 2);
  assert.deepEqual(spawns.map((a) => [a[0], a[1]]), [[100, 50], [110, 50]]);
  spawns.length = 0;
  spawnBulletTrail({ type: 'torpedo', x: 0, y: 0, vx: 0, vy: 600, forceCanvas: true, color: '#7ef0ff' }, 3, 3 / 120);
  assert.equal(spawns.length, 9, 'smuga + żar torpedy + łeb canvas × 3 porcje');
  assert.ok(spawns.every((a) => typeof a[0] === 'number' && typeof a[1] === 'number'));
});

test('spawnParticleXY bierze cząstkę z puli bez nowych obiektów', () => {
  const saved = { pool: CanvasVFX.particlePool, active: CanvasVFX.activeParticles, next: CanvasVFX.nextParticleIndex, max: CanvasVFX.MAX_PARTICLES };
  try {
    CanvasVFX.MAX_PARTICLES = 4;
    CanvasVFX.particlePool = [];
    CanvasVFX.activeParticles = [];
    CanvasVFX.nextParticleIndex = 0;
    for (let i = 0; i < 4; i++) {
      CanvasVFX.particlePool.push({ pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, active: false, _activeIdx: -1 });
    }
    const posRefs = CanvasVFX.particlePool.map((p) => p.pos);
    for (let i = 0; i < 10; i++) CanvasVFX.spawnParticleXY(i, -i, 1, 2, 0.2, '#fff', 1, false);
    assert.equal(CanvasVFX.activeParticles.length, 4, 'pierścień nadpisuje najstarsze');
    assert.deepEqual(CanvasVFX.particlePool.map((p) => p.pos), posRefs, 'te same obiekty pozycji');
    assert.deepEqual([CanvasVFX.particlePool[1].pos.x, CanvasVFX.particlePool[1].pos.y], [9, -9]);
    CanvasVFX.spawnParticle({ x: 5, y: 6 }, { x: 0, y: 0 }, 0.1, '#fff', 1, false);
    assert.equal(CanvasVFX.particlePool[2].pos.x, 5, 'spawnParticle idzie tą samą ścieżką');
  } finally {
    CanvasVFX.particlePool = saved.pool;
    CanvasVFX.activeParticles = saved.active;
    CanvasVFX.nextParticleIndex = saved.next;
    CanvasVFX.MAX_PARTICLES = saved.max;
  }
});

// ---------------------------------------------------------------------------
// Tarcza bez alokacji; sweep heksów tylko do wejścia w tarczę / najlepszego t

test('kąt tarczy liczony z dwóch liczb, bez obiektu pozycji', () => {
  const src = readFileSync(new URL('../shieldSystem.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /getEntityPos\(/);
  const angle = src.slice(src.indexOf('export function shieldGridAngleTowards'), src.indexOf('export function getEntityShieldRadiusTowards'));
  assert.match(angle, /getEntityPosX\(entity\)/);
  assert.doesNotMatch(angle, /\{ x:|\{x:/);
});

test('sweep po odcinku [0, limit] znajduje ten sam heks co pełny, gdy leży przed limitem', () => {
  const e = makeDestructorHull({ width: 160, height: 60, x: 0, y: 0, angle: 0.3 });
  try {
    let checked = 0;
    for (let k = 0; k < 40; k++) {
      const y = -40 + k * 2;
      const x0 = -200, y0 = y, x1 = 200, y1 = y + 15;
      const full = DestructorSystem.sweepImpact(e, x0, y0, x1, y1, 2);
      const fullT = full ? full.t : -1;
      const fullShard = full ? full.hitShard : null;
      for (const limit of [0.2, 0.45, 0.7]) {
        const part = DestructorSystem.sweepImpact(e, x0, y0, x0 + (x1 - x0) * limit, y0 + (y1 - y0) * limit, 2);
        if (fullT >= 0 && fullT < limit) {
          assert.ok(part, `k=${k} limit=${limit}: skrócony sweep zgubił heks`);
          assert.ok(Math.abs(part.t * limit - fullT) < 1e-9, `k=${k}: t ${part.t * limit} ≠ ${fullT}`);
          assert.equal(part.hitShard, fullShard);
          checked++;
        } else if (part) {
          assert.ok(part.t * limit >= fullT - 1e-9 || fullT < 0, `k=${k}: skrócony sweep trafił wcześniej niż pełny`);
        }
      }
    }
    assert.ok(checked > 10, `za mało przypadków porównania: ${checked}`);
  } finally {
    disposeHexBody(e);
  }
  const step = sliceFunction(html, 'function bulletsAndCollisionsStep(dt, emitTrails = true, trailDt = dt) {');
  const shieldAt = step.indexOf('getEntityShieldRadiusTowards(npc._realEntity || npc, b.x, b.y)');
  const sweepAt = step.indexOf('DestructorSystem.sweepImpact(realNpc');
  assert.ok(shieldAt > 0 && sweepAt > shieldAt, 'tarcza liczona przed sweepem heksów');
  assert.match(step, /if \(shieldT >= 0 && shieldT < sweepLimit\) sweepLimit = shieldT;/);
});
