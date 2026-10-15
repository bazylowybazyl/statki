// Naprowadzanie torped rysowanych przez WeaponFx (2026-10-14): torpeda lotnicza (turnRate 22°/s) leciała prosto,
// bo blok naprowadzania w pętli pocisków siedział w warunku ścieżki kanwy (!threeVisual). Teraz wspólna funkcja
// steerHomingBullet i osobna, wąska gałąź dla pocisków z WeaponFx: tylko jawny turnRate > 0 i własny cel —
// niekierowane salwy trybu torped (turnRate 0, bez celu) zostają niekierowane.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readIndexHtml, loadIndexFunction, sliceFunction } from './helpers/indexSource.mjs';

const html = readIndexHtml();

test('steerHomingBullet: skręt ograniczony turnRate, prędkość własna zachowana', () => {
  const scope = {
    getTargetX: (t) => t.x,
    getTargetY: (t) => t.y,
    wrapAngle: (a) => Math.atan2(Math.sin(a), Math.cos(a))
  };
  const steer = loadIndexFunction(html, 'function steerHomingBullet(b, target, turnRate, dt) {', 'steerHomingBullet', scope);
  // Torpeda leci w +x, cel prostopadle w górę: w jednym kroku skręt najwyżej turnRate·dt.
  const b = { x: 0, y: 0, vx: 1250, vy: 0, ivx: 0, ivy: 0 };
  const turnRate = 22 * Math.PI / 180;
  steer(b, { x: 0, y: 3000 }, turnRate, 1 / 60);
  const ang = Math.atan2(b.vy, b.vx);
  assert.ok(ang > 0 && ang <= turnRate / 60 + 1e-12, `skręt ${ang} > ${turnRate / 60}`);
  assert.ok(Math.abs(Math.hypot(b.vx, b.vy) - 1250) < 1e-6, 'prędkość bez zmian');
  // Mały błąd kursu — dokładnie na cel, bez przekręcenia.
  const c = { x: 0, y: 0, vx: 1000, vy: 0, ivx: 0, ivy: 0 };
  steer(c, { x: 5000, y: 10 }, 10, 1 / 60);
  assert.ok(Math.abs(Math.atan2(c.vy, c.vx) - Math.atan2(10, 5000)) < 1e-9);
  // Pęd wyrzutni (ivx/ivy) zostaje: skręca się ruch własny.
  const d = { x: 0, y: 0, vx: 1250 + 2000, vy: 0, ivx: 2000, ivy: 0 };
  steer(d, { x: 0, y: 3000 }, turnRate, 1 / 60);
  assert.ok(Math.abs(Math.hypot(d.vx - 2000, d.vy) - 1250) < 1e-6, 'prędkość własna względem wyrzutni bez zmian');
});

test('pętla pocisków: naprowadzanie pocisku z WeaponFx — tylko jawny turnRate i własny cel', () => {
  const loop = sliceFunction(html, 'function bulletsAndCollisionsStep(dt, emitTrails = true, trailDt = dt) {');
  // Gałąź kanwy (dawna) dalej z zapasowym celem z namiaru gracza.
  assert.match(loop, /if \(isTargetAlive\(target\)\) steerHomingBullet\(b, target, b\.turnRate \|\| SIDE_ROCKET_TURN_RATE, dt\);/);
  // Gałąź WeaponFx: threeVisual, torpeda / rakieta, po homingDelay, turnRate > 0, własny cel.
  assert.match(loop, /if \(threeVisual && \(b\.type === 'torpedo' \|\| b\.type === 'rocket'\) && b\.homingDelay <= 0 && b\.turnRate > 0\s*&& isTargetAlive\(b\.target\)\) \{\s*steerHomingBullet\(b, b\.target, b\.turnRate, dt\);/);
});
