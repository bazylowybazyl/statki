import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  NEA_FLYBY_TUNE, NeaFlyby, neaFlybyBlockReason, planNeaFlyby, neaFlybyPoint, neaFlybyDistanceTo, neaFlybyMessage, formatNeaEta
} from '../src/game/neaFlyby.js';
import { AsteroidBeltField } from '../src/game/asteroidBeltField.js';
import { BELT_DEFINITIONS, getOutermostBeltEdgeAu } from '../src/data/asteroidTypes.js';
import { buildSystemMap } from '../src/data/systemMap.js';
import { k7HallCenter } from '../src/game/story/k7Dock.js';
import { FAMILY, SHAPE_VARIANTS, ROCK_TYPE_INDEX } from '../src/game/asteroidRockKinds.js';
import { createRadarFeed } from '../src/ui/radar/radarFeed.js';

const SUN = { x: 6_000_000, y: 6_000_000 };
const T = NEA_FLYBY_TUNE;

function makeSystem(angles = {}) {
  const { planets, auInWorldUnits } = buildSystemMap(getOutermostBeltEdgeAu(BELT_DEFINITIONS), {
    planetScale: 3, sunRadius: 823,
    angleFor: (def) => (angles[def.id] ?? 0) * Math.PI / 180
  });
  for (const p of planets) {
    p.x = SUN.x + Math.cos(p.angle) * p.orbitRadius;
    p.y = SUN.y + Math.sin(p.angle) * p.orbitRadius;
  }
  return { planets, au: auInWorldUnits, earth: planets.find((p) => p.id === 'earth') };
}

// Deterministyczny ciąg [0, 1).
function seq(seed = 7) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
}

// Najmniejsza odległość toru od punktu (próbkowanie co 0,25 s).
function minDistAlong(plan, x, y) {
  let m = Infinity;
  const p = { x: 0, y: 0 };
  for (let t = 0; t <= plan.duration; t += 0.25) {
    neaFlybyPoint(plan, t, p);
    m = Math.min(m, Math.hypot(p.x - x, p.y - y));
  }
  return m;
}

test('gates: only free game, once per session, after 20 min of game time, player near Earth; ?apophis after a few seconds', () => {
  const base = { done: false, campaign: false, blocksInput: false, simTime: 1300, dev: false, playerX: 1e6 + 50000, playerY: 0, earthX: 1e6, earthY: 0 };
  assert.equal(neaFlybyBlockReason(base), '');
  assert.equal(neaFlybyBlockReason({ ...base, done: true }), 'done');
  assert.equal(neaFlybyBlockReason({ ...base, campaign: true }), 'campaign');
  assert.equal(neaFlybyBlockReason({ ...base, blocksInput: true }), 'blocked');
  assert.equal(neaFlybyBlockReason({ ...base, simTime: T.minGameSec - 1 }), 'time');
  assert.equal(neaFlybyBlockReason({ ...base, playerX: 1e6 + T.nearEarth + 1000 }), 'far');
  // ?apophis: po devDelaySec od pierwszej klatki, dalej nigdy w kampanii
  assert.equal(neaFlybyBlockReason({ ...base, dev: true, devSince: 10, simTime: 11 }), 'time');
  assert.equal(neaFlybyBlockReason({ ...base, dev: true, devSince: 10, simTime: 10 + T.devDelaySec, playerX: 9e9 }), '');
  assert.equal(neaFlybyBlockReason({ ...base, dev: true, devSince: 0, simTime: 99, campaign: true }), 'campaign');
});

test('track: straight line, closest approach 90–110 k from Earth on the player side, beyond the well and K-7 halls', () => {
  const { planets, earth } = makeSystem({ earth: 330, mars: 120, jupiter: 250 });
  const others = planets.filter((p) => p !== earth).map((p) => ({ x: p.x, y: p.y, r: 200000 }));
  for (let k = 0; k < 24; k++) {
    const a = k * Math.PI / 12;
    const dist = 30000 + (k % 6) * 30000;
    const player = { x: earth.x + Math.cos(a) * dist, y: earth.y + Math.sin(a) * dist };
    const plan = planNeaFlyby({ earth, player, planets: others, rand: seq(k + 1) });
    assert.ok(plan.ok, `plan ${k}`);
    assert.ok(plan.dCA >= T.dMin && plan.dCA <= T.dMax, `dCA ${plan.dCA}`);
    // zbliżenie po stronie gracza (bez księżyca — pierwszy kąt)
    const phiP = Math.atan2(player.y - earth.y, player.x - earth.x);
    let dPhi = Math.abs(plan.phi - phiP) % (2 * Math.PI);
    if (dPhi > Math.PI) dPhi = 2 * Math.PI - dPhi;
    assert.ok(dPhi < 1e-9, `kąt zbliżenia od gracza ${dPhi}`);
    // odległość gracza od toru = |d gracza − dCA| (tor prostopadły do promienia)
    assert.ok(Math.abs(neaFlybyDistanceTo(plan, player.x, player.y) - Math.abs(Math.min(Math.max(dist, T.dMin), T.dMax) - dist)) < 1);
    const dEarth = minDistAlong(plan, earth.x, earth.y);
    assert.ok(Math.abs(dEarth - plan.dCA) < 600, `najbliżej Ziemi ${dEarth} vs ${plan.dCA}`);
    for (let c = 0; c < 4; c++) {
      const h = k7HallCenter(earth, c);
      assert.ok(minDistAlong(plan, h.x, h.y) > 30000, `hala K-7 ${c}`);
    }
    assert.equal(Math.round(plan.speed), T.speed);
    assert.equal(plan.duration, T.approachSec + T.departSec);
    assert.ok(Math.abs(Math.hypot(plan.dx, plan.dy) - 1) < 1e-12);
  }
});

test('track avoids the Earth moon of the render (predicted orbit) — moves the approach away from it', () => {
  const { earth } = makeSystem({ earth: 10 });
  const T2 = { ...T };
  const w = 2 * Math.PI / T.moonPeriodSec;
  let moved = 0;
  for (let k = 0; k < 36; k++) {
    const player = { x: earth.x + 60000, y: earth.y };
    // księżyc tam, gdzie domyślny tor (zbliżenie przy graczu, 90 tys.) przecina orbitę księżyca, w chwili przecięcia
    const ma = k * Math.PI / 18;
    const moon = { x: earth.x + Math.cos(ma) * 113400, y: earth.y + Math.sin(ma) * 113400, r: 9750 };
    const plan = planNeaFlyby({ earth, player, moon, planets: [], tune: T2, rand: seq(100 + k) });
    assert.ok(plan.ok, `plan ${k}`);
    // sprawdzenie niezależne od planisty: księżyc z przewidzianym ruchem
    const rockR = T.radius * Math.max(...T.stretch);
    const p = { x: 0, y: 0 };
    let minSep = Infinity;
    for (let t = 0; t <= plan.duration; t += 0.25) {
      neaFlybyPoint(plan, t, p);
      const a = ma + w * t;
      const sep = Math.hypot(p.x - (earth.x + Math.cos(a) * 113400), p.y - (earth.y + Math.sin(a) * 113400)) - 9750 - rockR;
      minSep = Math.min(minSep, sep);
    }
    assert.ok(minSep >= T.moonClear - 2000, `odstęp od księżyca ${minSep}`);
    if (Math.abs(plan.phi) > 1e-9) moved++;
  }
  assert.ok(moved > 0, 'przynajmniej część torów musiała ominąć księżyc zmianą kąta');
});

test('track keeps clear of other planets (shrinks nothing — picks another angle)', () => {
  const { earth } = makeSystem({ earth: 0 });
  // „planeta” tuż za zbliżeniem po stronie gracza — tor musi iść gdzie indziej
  const player = { x: earth.x + 100000, y: earth.y };
  const blocker = { x: earth.x + 100000, y: earth.y + 150000, r: 120000 };
  const plan = planNeaFlyby({ earth, player, planets: [blocker], rand: seq(3) });
  assert.ok(plan.ok);
  assert.ok(minDistAlong(plan, blocker.x, blocker.y) >= blocker.r - 1);
});

test('NeaFlyby: start → closest → end once per session; campaign session never; rock is an S-type binary from the bank', () => {
  const { earth } = makeSystem({ earth: 200 });
  const f = new NeaFlyby({ rand: seq(11) });
  const ctx = { simTime: 0, renderTime: 0, campaign: false, blocksInput: false, playerX: earth.x + 50000, playerY: earth.y, earth, moon: null, planets: [] };
  const events = [];
  let t = 0;
  for (; t < T.minGameSec + T.approachSec + T.departSec + 20; t += 0.5) {
    ctx.simTime = ctx.renderTime = t;
    const ev = f.update(ctx);
    if (ev) events.push([ev, t]);
    if (f.active) {
      const p = neaFlybyPoint(f.plan, f.t);
      assert.ok(Math.abs(f.rock.x - p.x) < 1e-6 && Math.abs(f.rock.y - p.y) < 1e-6);
      assert.ok(Math.abs(Math.hypot(f.rock.qx, f.rock.qy, f.rock.qz, f.rock.qw) - 1) < 1e-9);
      assert.equal(f.wake.x, f.rock.x);
      assert.ok(f.wake.active && f.rock.alive && !f.rock.dead);
    }
  }
  assert.deepEqual(events.map((e) => e[0]), ['start', 'closest', 'end']);
  assert.ok(events[0][1] >= T.minGameSec && events[0][1] < T.minGameSec + 1);
  assert.ok(Math.abs(events[1][1] - events[0][1] - T.approachSec) <= 0.5);
  assert.equal(f.state, 'done');
  assert.ok(!f.rock.alive && f.rock.dead && !f.wake.active);
  // drugi raz w tej sesji — nie
  for (let k = 0; k < 400; k++) { ctx.simTime = ctx.renderTime = t + k; assert.equal(f.update(ctx), null); }
  assert.equal(f.rock.type, ROCK_TYPE_INDEX.silicon);
  assert.equal(Math.floor(f.rock.shape / SHAPE_VARIANTS), FAMILY.binary);
  assert.ok(f.rock.r * 2 >= 1400 && f.rock.r * 2 <= 1600);
  assert.match(neaFlybyMessage('start', f), /APOPHIS/);
  assert.equal(formatNeaEta(125), '2:05');
  // kampania: nigdy, nawet po godzinie
  const c = new NeaFlyby({ rand: seq(5) });
  for (let k = 0; k < 4000; k += 2) assert.equal(c.update({ ...ctx, simTime: k, renderTime: k, campaign: true }), null);
  assert.equal(c.state, 'waiting');
  // fabuła blokująca wejście — czeka
  const b = new NeaFlyby({ rand: seq(6) });
  assert.equal(b.update({ ...ctx, simTime: 5000, renderTime: 5000, blocksInput: true }), null);
  assert.equal(b.update({ ...ctx, simTime: 5001, renderTime: 5001 }), 'start');
});

test('NeaFlyby dev (?apophis): starts a few seconds after the first frame, also far from Earth', () => {
  const { earth } = makeSystem({ earth: 90 });
  const f = new NeaFlyby({ dev: true, rand: seq(2) });
  const ctx = { simTime: 30, renderTime: 30, campaign: false, blocksInput: false, playerX: earth.x + 5e6, playerY: earth.y, earth, moon: null, planets: [] };
  assert.equal(f.update(ctx), null);
  ctx.simTime = ctx.renderTime = 30 + T.devDelaySec;
  assert.equal(f.update(ctx), 'start');
  assert.ok(f.plan.dCA >= T.dMin && f.plan.dCA <= T.dMax);
  f.seek(f.plan.tCA - 1, ctx.simTime);
  ctx.simTime = ctx.renderTime = ctx.simTime + 1.5;
  assert.equal(f.update(ctx), 'closest');
});

test('field wake spot: the flyby rock wakes the belt renderer near Earth only while it is in view', () => {
  const { planets, au, earth } = makeSystem({ earth: 330, mars: 120, jupiter: 250 });
  const field = new AsteroidBeltField({ planets, sunX: SUN.x, sunY: SUN.y, auToWorld: au });
  const spot = { x: earth.x + 100000, y: earth.y, r: 5000, active: true };
  field.wakeSpots.push(spot);
  const box = (x, y, h) => field.rectTouchesBelt(x - h, y - h, x + h, y + h);
  assert.equal(box(spot.x, spot.y, 20000), true, 'kadr na skale');
  assert.equal(box(earth.x - 100000, earth.y, 20000), false, 'kadr po drugiej stronie Ziemi');
  spot.active = false;
  assert.equal(box(spot.x, spot.y, 20000), false, 'po przelocie');
});

test('radar: bodies list → neutral body tracks with name and class, dead ones skipped', () => {
  const { feed, collect } = (() => { const r = createRadarFeed(); return { feed: r.feed, collect: r.collect.bind(r) }; })();
  const rock = { x: 1000, y: 2000, vx: 2000, vy: 0, radius: 990, radarName: 'APOPHIS', radarCls: 'NEA', dead: false };
  collect({ ship: { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, angle: 0 }, range: 20000, bodies: [rock] });
  assert.equal(feed.count, 1);
  const r = feed.targets[0];
  assert.equal(r.kind, 'body');
  assert.equal(r.aff, 'neutral');
  assert.equal(r.name, 'APOPHIS');
  assert.equal(r.cls, 'NEA');
  assert.equal(r.key, rock);
  assert.equal(feed.counts.hostile + feed.counts.neutral + feed.counts.friendly, 0);
  rock.dead = true;
  collect({ ship: { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, angle: 0 }, range: 20000, bodies: [rock] });
  assert.equal(feed.count, 0);
});

test('index.html: flyby wired before the belt frame step, campaign session latched, radar bodies, warmup before flush', () => {
  const src = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const step = src.indexOf('stepNeaFlyby();');
  const belt = src.indexOf('asteroidBelt.prepareFrame(frameDt');
  assert.ok(step > 0 && belt > step, 'krok przelotu przed krokiem pasa');
  assert.match(src, /if \(StoryGame\.active\) neaCampaignSession = true;/);
  assert.match(src, /env\.bodies = neaFlybyRadarBodies\(_neaRadarBodies\);/);
  const setup = src.indexOf('setupNeaFlyby3D();   // przelot NEA');
  const flush = src.indexOf('Core3D.warmup?.flush(', setup);
  assert.ok(setup > 0 && flush > setup, 'obraz przelotu tworzony przed flush rozgrzewki');
});
