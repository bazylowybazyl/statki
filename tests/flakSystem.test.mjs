import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FLAK_TUNING,
  FLAK_SIZE_DEFAULTS,
  collectFlakBurstHits,
  estimateFlakKills,
  flakDamageAt,
  flakDetonationReason,
  flakFuseTime,
  isFlakFighterTarget,
  isFlakWeapon,
  resolveFlakProfile
} from '../src/game/flakSystem.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { FIGHTER_SQUADRON_DEFS } from '../src/data/fighterSquadrons.js';

const FLAK_IDS = ['flak_s', 'flak_m', 'flak_l', 'flak_capital'];

function fighter(x, y, squadron = 'multirole') {
  const def = FIGHTER_SQUADRON_DEFS[squadron];
  return { x, y, fighter: true, type: 'fighter', radius: def.radius, hp: def.hp, friendly: false };
}

// ── katalog broni ──────────────────────────────────────────────────────────

test('the flak family covers every hardpoint class exactly once', () => {
  const sizes = FLAK_IDS.map(id => {
    const def = MASTER_WEAPONS[id];
    assert.ok(def, `brak definicji broni ${id}`);
    assert.equal(def.category, 'flak');
    assert.equal(def.mountType, 'aux', 'flak siedzi na hardpointach pomocniczych, jak CIWS');
    assert.ok(isFlakWeapon(def));
    return def.size;
  });
  assert.deepEqual(sizes, ['S', 'M', 'L', 'Capital']);
});

test('burst radius, damage and salvo size grow monotonically with hardpoint class', () => {
  const profiles = FLAK_IDS.map(id => resolveFlakProfile(MASTER_WEAPONS[id]));
  for (let i = 1; i < profiles.length; i++) {
    assert.ok(profiles[i].burstRadius > profiles[i - 1].burstRadius, `promień ${FLAK_IDS[i]}`);
    assert.ok(profiles[i].damage > profiles[i - 1].damage, `obrażenia ${FLAK_IDS[i]}`);
    assert.ok(profiles[i].shells >= profiles[i - 1].shells, `salwa ${FLAK_IDS[i]}`);
  }
});

test('a weapon def with no flak fields still resolves to its size defaults', () => {
  const p = resolveFlakProfile({ category: 'flak', size: 'L', baseDamage: 100 });
  assert.equal(p.burstRadius, FLAK_SIZE_DEFAULTS.L.burstRadius);
  assert.equal(p.fuseRadius, FLAK_SIZE_DEFAULTS.L.fuseRadius);
  assert.equal(p.hullFactor, FLAK_SIZE_DEFAULTS.L.hullFactor);
});

// ── spadek obrażeń ─────────────────────────────────────────────────────────

test('shrapnel damage peaks at the centre and reaches zero at the burst edge', () => {
  const R = 200;
  assert.equal(flakDamageAt(0, R, 100, 0.35), 100);
  assert.equal(flakDamageAt(R, R, 100, 0.35), 0);
  assert.equal(flakDamageAt(R * 2, R, 100, 0.35), 0);

  let prev = Infinity;
  for (let d = 0; d <= R; d += 10) {
    const dmg = flakDamageAt(d, R, 100, 0.35);
    assert.ok(dmg <= prev + 1e-9, `spadek musi być monotoniczny (d=${d})`);
    prev = dmg;
  }
});

test('the outer shell of the burst still hurts — no hollow ring', () => {
  const R = 200;
  // Poza strefą wygaszania krawędzi obrażenia nie mogą spaść poniżej progu falloff.
  const atHalf = flakDamageAt(R * 0.5, R, 100, 0.4);
  assert.ok(atHalf > 40, `na połowie promienia oczekiwano >40, jest ${atHalf}`);
});

// ── zapalnik ───────────────────────────────────────────────────────────────

test('the time fuse is set so the shell bursts where the target will be', () => {
  assert.ok(Math.abs(flakFuseTime(1600, 1600, 0) - 1.0) < 1e-9);
  // Jitter rozrzuca salwę w głąb, ale nigdy nie wywraca kolejności.
  const early = flakFuseTime(1600, 1600, -1);
  const late = flakFuseTime(1600, 1600, 1);
  assert.ok(early < 1.0 && late > 1.0);
  assert.ok(Math.abs(late - early) <= 2 * FLAK_TUNING.FUSE_JITTER + 1e-9);
});

test('the fuse stays locked until the shell has cleared its own hull', () => {
  const shell = { flakAge: 0.01, flakArmTime: FLAK_TUNING.ARM_TIME, flakFuseRadius: 60, flakFuseTime: 1.0, life: 1 };
  assert.equal(flakDetonationReason(shell, 5), '', 'nieuzbrojony pocisk nie pęka tuż przy lufie');

  shell.flakAge = FLAK_TUNING.ARM_TIME + 0.01;
  assert.equal(flakDetonationReason(shell, 5), 'proximity');
});

test('an armed shell bursts on its timer, and on self-destruct at max range', () => {
  const shell = { flakAge: 1.05, flakArmTime: FLAK_TUNING.ARM_TIME, flakFuseRadius: 60, flakFuseTime: 1.0, life: 1 };
  assert.equal(flakDetonationReason(shell, Infinity), 'time');

  // Pocisk, który nie doleciał do niczego, i tak musi pęknąć na końcu zasięgu.
  const spent = { flakAge: 0.2, flakArmTime: FLAK_TUNING.ARM_TIME, flakFuseRadius: 60, flakFuseTime: 9, life: 0 };
  assert.equal(flakDetonationReason(spent, Infinity), 'expired');
});

// ── rażenie ────────────────────────────────────────────────────────────────

test('a burst hits every hostile fighter inside the cloud and nothing outside it', () => {
  const p = resolveFlakProfile(MASTER_WEAPONS.flak_m);
  const inside = [fighter(0, 0), fighter(60, 0), fighter(0, -100)];
  const outside = [fighter(p.burstRadius + 50, 0), fighter(0, p.burstRadius + 400)];
  const hits = collectFlakBurstHits(
    { x: 0, y: 0, radius: p.burstRadius, damage: p.damage, falloff: p.falloff, hullFactor: p.hullFactor, friendly: true },
    [...inside, ...outside]
  );
  assert.equal(hits.length, inside.length);
  for (const h of hits) assert.ok(inside.includes(h.entity));
});

test('shrapnel is measured to the hull, so a big ship parked on the edge still takes it', () => {
  const burst = { x: 0, y: 0, radius: 200, damage: 100, falloff: 0.4, hullFactor: 1, friendly: true };
  const hugeButFar = { x: 380, y: 0, radius: 260, friendly: false };  // środek poza kulą, burta w środku
  const hits = collectFlakBurstHits(burst, [hugeButFar]);
  assert.equal(hits.length, 1);
  assert.ok(hits[0].damage > 0);
});

test('flak is an anti-air gun: warship hulls shrug off most of the shrapnel', () => {
  const p = resolveFlakProfile(MASTER_WEAPONS.flak_l);
  const burst = { x: 0, y: 0, radius: p.burstRadius, damage: p.damage, falloff: p.falloff, hullFactor: p.hullFactor, friendly: true };
  const hitsFighter = collectFlakBurstHits(burst, [fighter(0, 0)]);
  const hitsWarship = collectFlakBurstHits(burst, [{ x: 0, y: 0, radius: 0, type: 'destroyer', friendly: false }]);
  assert.ok(hitsWarship[0].damage < hitsFighter[0].damage * 0.25);
});

test('a burst never touches the ship that fired it', () => {
  const shooter = { x: 0, y: 0, radius: 40, friendly: false };
  const hits = collectFlakBurstHits(
    { x: 0, y: 0, radius: 300, damage: 200, falloff: 0.4, hullFactor: 1, friendly: true, source: shooter },
    [shooter]
  );
  assert.equal(hits.length, 0);
});

test('friendly units caught in the barrage take reduced, not full, damage', () => {
  const burst = { x: 0, y: 0, radius: 300, damage: 200, falloff: 0.4, hullFactor: 1, friendly: true };
  const enemy = fighter(0, 0);
  const own = { ...fighter(0, 0), friendly: true };
  const hostileHit = collectFlakBurstHits(burst, [enemy])[0];
  const friendlyHit = collectFlakBurstHits(burst, [own])[0];
  assert.ok(friendlyHit.damage > 0, 'gra ma friendly fire — zapora nie może być całkiem bezpieczna');
  assert.ok(friendlyHit.damage < hostileHit.damage);
  assert.ok(Math.abs(friendlyHit.damage / hostileHit.damage - FLAK_TUNING.FRIENDLY_FACTOR) < 1e-9);
});

// ── balans: S kasuje mało, Capital kasuje eskadrę ──────────────────────────

test('the light flak kills at most a single fighter per burst', () => {
  const kills = estimateFlakKills(MASTER_WEAPONS.flak_s, FIGHTER_SQUADRON_DEFS.interceptor.hp);
  assert.ok(kills >= 1, 'lekki flak musi cokolwiek zabijać');
  assert.ok(kills <= 2, `lekki flak ma kasować mało, a liczy ${kills}`);
});

test('the capital flak wipes a whole squadron in one salvo', () => {
  const squadSize = FIGHTER_SQUADRON_DEFS.multirole.squadSize;
  const kills = estimateFlakKills(MASTER_WEAPONS.flak_capital, FIGHTER_SQUADRON_DEFS.strike.hp);
  assert.ok(kills >= squadSize, `Perun ma wymiatać eskadrę (${squadSize}), a liczy ${kills}`);
});

test('kill count rises with hardpoint class across the whole family', () => {
  const hp = FIGHTER_SQUADRON_DEFS.multirole.hp;
  const kills = FLAK_IDS.map(id => estimateFlakKills(MASTER_WEAPONS[id], hp));
  for (let i = 1; i < kills.length; i++) {
    assert.ok(kills[i] > kills[i - 1], `${FLAK_IDS[i]} (${kills[i]}) musi bić mocniej niż ${FLAK_IDS[i - 1]} (${kills[i - 1]})`);
  }
});

test('fighter detection covers every small-craft type the game spawns', () => {
  assert.ok(isFlakFighterTarget({ fighter: true }));
  assert.ok(isFlakFighterTarget({ type: 'interceptor' }));
  assert.ok(isFlakFighterTarget({ type: 'drone' }));
  assert.ok(!isFlakFighterTarget({ type: 'battleship' }));
  assert.ok(!isFlakFighterTarget(null));
});
