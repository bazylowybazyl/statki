// Bomby lotnicze (src/game/fighterBombs.js, 2026-10-14): bomba spada na punkt kadłuba POD bombowcem
// w chwili zrzutu, jedzie z celem w jego układzie (ruch i obrót) i po fallTime wybucha: tarcza / kadłub /
// chybienie / cel zniknął. Rysunek: src/vfx/fighterBombSprite.js.
// node --test tests/fighterBombs.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { createFighterBombs, FIGHTER_BOMB_CAP } from '../src/game/fighterBombs.js';
import { drawFighterBombs, bombScreenRadius, bombAlpha, BOMB_MIN_PX } from '../src/vfx/fighterBombSprite.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';

const DEF = MASTER_WEAPONS.fighter_bomb;
const close = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} != ${b} (±${tol})`);

/** Atrapa gry: kadłub = koło `hullR` wokół celu z „dziurą” w kole `hole` (układ celu), tarcza z flagą. */
function makeWorld(opts = {}) {
  const log = [];
  const hullR = opts.hullR ?? 100;
  const env = {
    shieldBlocks: (t, x, y) => !!t.shieldOn && !(t.breach && t.breach(x, y)),
    hullAt: (t, x, y) => {
      const dx = x - t.x, dy = y - t.y;
      if (dx * dx + dy * dy > hullR * hullR) return false;
      if (t.hole) {
        const c = Math.cos(t.angle), s = Math.sin(t.angle);
        const lx = dx * c + dy * s, ly = -dx * s + dy * c;
        const hx = lx - t.hole.x, hy = ly - t.hole.y;
        if (hx * hx + hy * hy < t.hole.r * t.hole.r) return false;
      }
      return true;
    },
    hitShield: (t, x, y, dmg, def, bomb) => log.push({ kind: 'shield', t, x, y, dmg, def, bomber: bomb.bomber, friendly: bomb.friendly }),
    hitHull: (t, x, y, dmg, def, bomb, rvx, rvy) => log.push({ kind: 'hull', t, x, y, dmg, def, bomber: bomb.bomber, friendly: bomb.friendly, rvx, rvy }),
    miss: (x, y, def, bomb) => log.push({ kind: 'miss', x, y, bomber: bomb.bomber }),
    ...(opts.env || {})
  };
  return { env, log };
}

const bomber = (x, y, angle = 0, extra = {}) => ({ x, y, angle, vx: 0, vy: 0, friendly: false, ...extra });
const ship = (x, y, angle = 0, extra = {}) => ({ x, y, angle, vx: 0, vy: 0, ...extra });

test('broń: pola bomby lotniczej', () => {
  assert.ok(DEF, 'fighter_bomb w MASTER_WEAPONS');
  assert.equal(DEF.category, 'bomb');
  assert.equal(DEF.mountType, 'fighter');
  close(DEF.fallTime, 0.5, 0.2, 'czas spadania');
});

test('czas spadania: wybuch dokładnie po fallTime, nie wcześniej', () => {
  const { env, log } = makeWorld();
  const B = createFighterBombs(env);
  const t = ship(1000, 2000);
  assert.equal(B.drop(bomber(1010, 1990), t, DEF), true);
  assert.equal(B.count, 1);
  const steps = Math.round(DEF.fallTime * 120);
  for (let k = 0; k < steps - 1; k++) B.step(1 / 120);
  assert.equal(log.length, 0, 'jeszcze spada');
  assert.equal(B.count, 1);
  assert.ok(B.list[0].t > 0.9 && B.list[0].t < 1, 'postęp spadania');
  B.step(1 / 120);
  assert.equal(log.length, 1);
  assert.equal(log[0].kind, 'hull');
  assert.equal(log[0].dmg, DEF.baseDamage);
  assert.equal(B.count, 0);
  assert.equal(B.stats.dropped, 1);
  assert.equal(B.stats.hull, 1);
});

test('jazda z celem: punkt upadku przesuwa się i obraca razem z celem', () => {
  const { env, log } = makeWorld();
  const B = createFighterBombs(env);
  const t = ship(0, 0, 0);
  B.drop(bomber(50, 0, 0.3), t, DEF);
  // Cel przesuwa się o (200, -100) i obraca o 90° w trakcie spadania.
  const n = 60;
  for (let k = 1; k <= n; k++) {
    t.x = 200 * k / n;
    t.y = -100 * k / n;
    t.angle = (Math.PI / 2) * k / n;
    B.step(DEF.fallTime / n * 0.999);
  }
  assert.equal(B.count, 1);
  const b = B.list[0];
  close(b.x, 200, 1e-6, 'x po obrocie: punkt (50, 0) w układzie celu → (0, 50) w świecie + przesunięcie');
  close(b.y, -100 + 50, 1e-6, 'y');
  close(b.heading, 0.3 + Math.PI / 2, 1e-9, 'kurs bomby obraca się z celem');
  B.step(0.01);
  assert.equal(log.length, 1);
  close(log[0].x, 200, 1e-6);
  close(log[0].y, -50, 1e-6);
});

test('pozycja z pos (gracz) ma pierwszeństwo przed x / y, jak getTargetX gry', () => {
  const { env, log } = makeWorld();
  const B = createFighterBombs(env);
  const player = { pos: { x: 5000, y: 0 }, vel: { x: 0, y: 0 }, x: 0, y: 0, angle: 0 };
  // hullAt atrapy czyta t.x — dla gracza podaj własny
  env.hullAt = (t, x, y) => Math.hypot(x - t.pos.x, y - t.pos.y) < 100;
  B.drop(bomber(5020, 10), player, DEF);
  player.pos.x += 300;
  for (let k = 0; k < 70; k++) B.step(1 / 120);
  assert.equal(log.length, 1);
  assert.equal(log[0].kind, 'hull');
  close(log[0].x, 5320, 1e-6);
});

test('tarcza: blokuje bez przebicia, przebicie przepuszcza na kadłub', () => {
  const { env, log } = makeWorld();
  const B = createFighterBombs(env);
  const t = ship(0, 0, 0, { shieldOn: true });
  B.drop(bomber(10, 0), t, DEF);
  const t2 = ship(1000, 0, 0, { shieldOn: true, breach: (x) => x > 1000 });
  B.drop(bomber(1020, 0), t2, DEF);
  for (let k = 0; k < 70; k++) B.step(1 / 120);
  assert.deepEqual(log.map((e) => e.kind).sort(), ['hull', 'shield']);
  assert.equal(log.find((e) => e.kind === 'shield').t, t);
  assert.equal(log.find((e) => e.kind === 'hull').t, t2);
  assert.equal(B.stats.shield, 1);
  assert.equal(B.stats.hull, 1);
});

test('dziura w poszyciu i chybienie: bez obrażeń (miss)', () => {
  const { env, log } = makeWorld();
  const B = createFighterBombs(env);
  const holed = ship(0, 0, 0, { hole: { x: 30, y: 0, r: 15 } });
  B.drop(bomber(30, 0), holed, DEF);       // w dziurę
  const far = ship(5000, 0);
  B.drop(bomber(5300, 0), far, DEF);       // obok kadłuba
  for (let k = 0; k < 70; k++) B.step(1 / 120);
  assert.equal(log.length, 2);
  assert.ok(log.every((e) => e.kind === 'miss'));
  assert.equal(B.stats.missed, 2);
  assert.equal(B.stats.hull, 0);
});

test('martwy cel: zrzut odmówiony; cel ginie w trakcie spadania — nic się nie dzieje', () => {
  const { env, log } = makeWorld();
  const B = createFighterBombs(env);
  assert.equal(B.drop(bomber(0, 0), ship(0, 0, 0, { dead: true }), DEF), false);
  assert.equal(B.drop(bomber(0, 0), null, DEF), false);
  const t = ship(0, 0);
  B.drop(bomber(10, 0), t, DEF);
  B.step(0.2);
  t.dead = true;
  const x = B.list[0].x;
  B.step(0.1);
  assert.equal(B.list[0].x, x, 'bomba stoi w ostatnim miejscu');
  B.step(0.3);
  assert.equal(log.length, 0);
  assert.equal(B.stats.lost, 1);
  assert.equal(B.count, 0);
  // env.alive: wrak to inny byt — gra może powiedzieć „cel zniknął”.
  const { env: env2, log: log2 } = makeWorld({ env: { alive: (e) => !e.isWreck } });
  const B2 = createFighterBombs(env2);
  const t2 = ship(0, 0);
  B2.drop(bomber(10, 0), t2, DEF);
  t2.isWreck = true;
  for (let k = 0; k < 70; k++) B2.step(1 / 120);
  assert.equal(log2.length, 0);
  assert.equal(B2.stats.lost, 1);
});

test('bomba niesie bombowiec i stronę; obrażenia z argumentu; kierunek wgniecenia z ruchu względnego', () => {
  const player = { pos: { x: 0, y: 0 }, angle: 0 };
  const { env, log } = makeWorld({ env: { player } });
  const B = createFighterBombs(env);
  const t = ship(0, 0, 0, { vx: 100, vy: 0 });
  const bf = bomber(5, 0, 0, { friendly: true, vx: 1900, vy: 0 });
  B.drop(bf, t, DEF, 500);
  for (let k = 0; k < 70; k++) B.step(1 / 120);
  assert.equal(log[0].bomber, bf);
  assert.equal(log[0].friendly, true);
  assert.equal(log[0].dmg, 500);
  assert.ok(log[0].rvx > 0 && log[0].rvy === 0, 'wgniecenie wzdłuż przelotu względem celu');
  const B2 = createFighterBombs({ ...env, player: bf });
  const b2 = bomber(5, 0, 0, { friendly: false });
  B2.drop(b2, t, DEF);
  assert.equal(B2.list[0].friendly, false);
});

test('rozrzut z generatora gry; bez generatora punkt dokładnie pod bombowcem', () => {
  const { env } = makeWorld();
  const B = createFighterBombs(env);
  B.drop(bomber(40, -20), ship(0, 0), DEF);
  assert.equal(B.list[0].x, 40);
  assert.equal(B.list[0].y, -20);
  let calls = 0;
  const seq = [0.25, 1];
  const B2 = createFighterBombs({ ...env, random: () => seq[calls++ % 2] });
  B2.drop(bomber(40, -20), ship(0, 0), DEF);
  close(Math.hypot(B2.list[0].x - 40, B2.list[0].y + 20), DEF.bombScatter, 1e-9, 'rozrzut ≤ bombScatter');
  assert.equal(calls, 2);
});

test('canDrop: tylko nad poszyciem celu', () => {
  const { env } = makeWorld();
  const B = createFighterBombs(env);
  const t = ship(0, 0);
  assert.equal(B.canDrop(bomber(50, 0), t), true);
  assert.equal(B.canDrop(bomber(500, 0), t), false);
  assert.equal(B.canDrop(bomber(50, 0), ship(0, 0, 0, { dead: true })), false);
});

test('pula: pojemność, przepełnienie, clear, forEach i stały zestaw obiektów', () => {
  const { env } = makeWorld();
  const B = createFighterBombs(env);
  const t = ship(0, 0);
  const objs = new Set(B.list);
  for (let i = 0; i < FIGHTER_BOMB_CAP; i++) assert.equal(B.drop(bomber(1, 0), t, DEF), true);
  assert.equal(B.drop(bomber(1, 0), t, DEF), false);
  assert.equal(B.stats.overflow, 1);
  let n = 0;
  B.forEach(() => n++);
  assert.equal(n, FIGHTER_BOMB_CAP);
  B.clear();
  assert.equal(B.count, 0);
  for (let k = 0; k < 3; k++) {
    B.drop(bomber(1, 0), t, DEF);
    B.step(DEF.fallTime + 0.01);
  }
  assert.equal(B.count, 0);
  assert.ok(B.list.every((b) => objs.has(b)), 'bez nowych obiektów bomb');
  assert.ok(B.list.every((b) => b.target === null || b.active), 'zwolnione wpisy nie trzymają celu');
});

test('bomby wybuchają w kolejności zrzutu niezależnie od zwalniania wpisów', () => {
  const { env, log } = makeWorld();
  const B = createFighterBombs(env);
  const t = ship(0, 0);
  for (let i = 0; i < 6; i++) {
    B.drop(bomber(i * 10, 0), t, DEF, i);
    B.step(DEF.cooldown);
  }
  for (let k = 0; k < 100; k++) B.step(1 / 60);
  assert.deepEqual(log.map((e) => e.dmg), [0, 1, 2, 3, 4, 5]);
});

test('rysunek: rozmiar na ekranie maleje ze spadaniem, minimum przy dalekim zoomie, blednięcie', () => {
  assert.ok(bombScreenRadius(5, 1, 0) > bombScreenRadius(5, 1, 1), 'maleje');
  close(bombScreenRadius(5, 1, 0), 5, 1e-9);
  assert.ok(bombScreenRadius(5, 0.2, 0) >= BOMB_MIN_PX, 'czytelna przy 0,2');
  assert.ok(bombScreenRadius(5, 0.2, 1) >= BOMB_MIN_PX * 0.75 - 1e-9);
  assert.equal(bombAlpha(0), 1);
  assert.ok(bombAlpha(1) > 0.3 && bombAlpha(1) < 0.6);
});

test('rysunek: drawFighterBombs na atrapie kanwy — bez NaN, rysuje każdą bombę, przywraca alfę', () => {
  const calls = [];
  const ctx = {
    globalAlpha: 0.77, fillStyle: '', strokeStyle: '', lineWidth: 1,
    beginPath() {}, closePath() {}, fill() { calls.push('fill'); }, stroke() {},
    moveTo(...a) { for (const v of a) assert.ok(Number.isFinite(v)); },
    lineTo(...a) { for (const v of a) assert.ok(Number.isFinite(v)); },
    arc(...a) { for (const v of a.slice(0, 5)) assert.ok(Number.isFinite(v)); },
    ellipse(...a) { for (const v of a.slice(0, 7)) assert.ok(Number.isFinite(v)); }
  };
  const { env } = makeWorld();
  const B = createFighterBombs(env);
  const t = ship(0, 0);
  B.drop(bomber(10, 0, 0.4), t, DEF);
  B.drop(bomber(-10, 5, 2.1, { friendly: true }), t, DEF);
  B.step(0.2);
  const zs = [];
  const toScreen = (x, y, out, z) => { zs.push(z); out.x = x * 0.5 + 800; out.y = y * 0.5 + 450; return out; };
  for (const zoom of [0.2, 0.5, 1.0]) assert.equal(drawFighterBombs(ctx, B, toScreen, zoom), 2);
  assert.equal(ctx.globalAlpha, 0.77);
  assert.ok(zs.every((z) => z > 0 && z < 60), 'wysokość bomby nad płaszczyzną (kamery 3D)');
  assert.equal(drawFighterBombs(ctx, [], toScreen, 1), 0);
  // poza renderu celu: bomba w tym samym miejscu kadłuba co obraz (cel przesunięty o 40 j. w renderze)
  const seen = [];
  drawFighterBombs(ctx, B, (x, y, out) => { seen.push([x, y]); out.x = x; out.y = y; return out; }, 1,
    (tg, out) => { out.x = tg.x + 40; out.y = tg.y; out.angle = tg.angle; return true; });
  close(seen[0][0], B.list[0].x + 40, 1e-9, 'x z pozy renderu');
  close(seen[0][1], B.list[0].y, 1e-9, 'y z pozy renderu');
  // punkt za kamerą 3D (x = −1e6) — pominięty
  assert.equal(drawFighterBombs(ctx, B, (x, y, out) => { out.x = -1e6; out.y = -1e6; return out; }, 1), 0);
});
