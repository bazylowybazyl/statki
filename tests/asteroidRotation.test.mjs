// Obrót i pary skał pola (strumień D planu docs/PLAN-pas-realizm.md, etap D2, 2026-10-12):
// wolniejszy obrót z rozrzutem (bariera obrotu rumowisk), koziołkowanie skał tła (lustro shadera
// rockSpin.tsl.js), pary z księżycem (generacja w komórkach pola, orbita, przejęcie pary do
// wydobycia w fazie z zegara pasa).
// node --test tests/asteroidRotation.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SPIN_CONFIG, TUMBLE_CONFIG, MOON_CONFIG, minSpinPeriod, rockSpinRate, rockTumble, rockOrientationAt,
  rockMoonFor, moonStateAt, moonRockRecord, rockSystemReach
} from '../src/game/asteroidRotation.js';
import { AsteroidBeltField, BELT_BAND } from '../src/game/asteroidBeltField.js';
import { BELT_DEFINITIONS, getOutermostBeltEdgeAu } from '../src/data/asteroidTypes.js';
import { buildSystemMap } from '../src/data/systemMap.js';
import { AsteroidMining } from '../src/game/asteroidMining.js';
import { MiningRig } from '../src/game/asteroidMiningRig.js';
import { createMiningChargeStock } from '../src/data/miningCharges.js';
import { ROCK_TYPE_INDEX } from '../src/game/asteroidRockKinds.js';

const SUN = { x: 6_000_000, y: 6_000_000 };
function makeField() {
  const { planets, auInWorldUnits } = buildSystemMap(getOutermostBeltEdgeAu(BELT_DEFINITIONS), {
    planetScale: 3, sunRadius: 823, angleFor: (def) => ({ jupiter: 250 }[def.id] ?? 0) * Math.PI / 180
  });
  for (const p of planets) { p.x = SUN.x + Math.cos(p.angle) * p.orbitRadius; p.y = SUN.y + Math.sin(p.angle) * p.orbitRadius; }
  return { field: new AsteroidBeltField({ planets, sunX: SUN.x, sunY: SUN.y, auToWorld: auInWorldUnits }), au: auInWorldUnits };
}
function findFieldCore(field, au) {
  let best = null;
  for (let i = 0; i < 2000; i++) {
    const a = (i / 2000) * Math.PI * 2;
    for (const rAu of [38, 40, 41]) {
      const x = SUN.x + Math.cos(a) * rAu * au, y = SUN.y + Math.sin(a) * rAu * au;
      const d = field.densityAt(x, y);
      if (!best || d > best.d) best = { x, y, d };
    }
  }
  return best;
}

function quatLen(q) { return Math.hypot(q[0], q[1], q[2], q[3]); }
function rotate(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
function conjRotate(q, v) { return rotate([-q[0], -q[1], -q[2], q[3]], v); }

test('okres obrotu: bariera rumowisk, małe monolity szybciej, rozrzut i wolne rotatory', () => {
  assert.ok(Math.abs(minSpinPeriod(80) - SPIN_CONFIG.periodSmall) < 1e-9);
  assert.ok(Math.abs(minSpinPeriod(SPIN_CONFIG.dLarge) - SPIN_CONFIG.periodLarge) < 1e-9);
  assert.ok(minSpinPeriod(2600) > SPIN_CONFIG.periodLarge, 'olbrzymy wolniej');
  let slow = 0, neg = 0;
  for (let i = 0; i < 4000; i++) {
    const u = (i + 0.5) / 4000;
    const w = rockSpinRate(900, u, ((i * 7919) % 4000) / 4000, ((i * 104729) % 4000) / 4000);
    const P = Math.abs(2 * Math.PI / w);
    assert.ok(P >= minSpinPeriod(900) - 1e-6, `okres ${P} poniżej bariery`);
    if (P > minSpinPeriod(900) * SPIN_CONFIG.spread) slow++;
    if (w < 0) neg++;
  }
  assert.ok(Math.abs(neg / 4000 - 0.5) < 0.02, 'obie strony obrotu');
  assert.ok(slow > 4000 * 0.05 && slow < 4000 * 0.2, `wolne rotatory: ${slow}`);
  // Wyraźnie wolniej niż dawne |ω| ≤ min(0,35, 9/√(d+40)) — dla dużej skały ~5× najmniej.
  const oldMax = Math.min(0.35, 9 / Math.sqrt(900 + 40));
  assert.ok(2 * Math.PI / minSpinPeriod(900) < oldMax / 5);
});

test('koziołkowanie: tylko tło, ~30%, lustro f32 shadera; stożek precesji stały', () => {
  let on = 0;
  for (let i = 0; i < 10000; i++) if (rockTumble((i + 0.5) / 10000, 0.05) > 0) on++;
  assert.ok(Math.abs(on / 10000 - TUMBLE_CONFIG.share) < 0.01, `udział ${on / 10000}`);
  // Ziarno wprost na progu fract(s·8) — klasyfikacja jak w f32 (fround).
  const s = Math.fround(0.0374);
  assert.equal(rockTumble(s, 0.1) > 0, (s * 8 - Math.floor(s * 8)) < TUMBLE_CONFIG.share);
  const k = rockTumble(0.01, 0.2) / 0.2;
  assert.ok(k >= TUMBLE_CONFIG.rate[0] && k <= TUMBLE_CONFIG.rate[1]);
  // Precesja wokół L = q0·ẑ: kąt między osią obrotu ciała a L stały w czasie (złożenie qL · qObrót · q0).
  const rock = { qx: 0.3, qy: -0.2, qz: 0.5, qw: 0.787, ax: 0.6, ay: 0.0, az: 0.8, spin: 0.3, phase: 0.7 };
  const ql = Math.hypot(rock.qx, rock.qy, rock.qz, rock.qw);
  rock.qx /= ql; rock.qy /= ql; rock.qz /= ql; rock.qw /= ql;
  const q0 = [rock.qx, rock.qy, rock.qz, rock.qw];
  const L = rotate(q0, [0, 0, 1]);
  const bodyAxis = conjRotate(rockOrientationAt(rock, 0, 0), [rock.ax, rock.ay, rock.az]);
  let cone = null;
  for (const t of [0, 3, 17, 55, 140]) {
    const q = rockOrientationAt(rock, t, 0.25);
    assert.ok(Math.abs(quatLen(q) - 1) < 1e-9);
    const a = rotate(q, bodyAxis);
    const c = a[0] * L[0] + a[1] * L[1] + a[2] * L[2];
    if (cone === null) cone = c; else assert.ok(Math.abs(c - cone) < 1e-9, `stożek precesji zmienia się: ${c} vs ${cone}`);
  }
  // Bez precesji — dawny obrót (wydobycie liczy go tak samo).
  const q = rockOrientationAt(rock, 12, 0);
  const ang = (rock.phase + rock.spin * 12) * 0.5;
  const qs = [rock.ax * Math.sin(ang), rock.ay * Math.sin(ang), rock.az * Math.sin(ang), Math.cos(ang)];
  const ref = [
    qs[3] * q0[0] + qs[0] * q0[3] + qs[1] * q0[2] - qs[2] * q0[1],
    qs[3] * q0[1] - qs[0] * q0[2] + qs[1] * q0[3] + qs[2] * q0[0],
    qs[3] * q0[2] + qs[0] * q0[1] - qs[1] * q0[0] + qs[2] * q0[3],
    qs[3] * q0[3] - qs[0] * q0[0] - qs[1] * q0[1] - qs[2] * q0[2]
  ];
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(q[i] - ref[i]) < 1e-12);
});

test('pole: obrót wolniejszy, koziołkuje tylko tło, pary z księżycem nie wchodzą na większe skały', () => {
  const { field, au } = makeField();
  const core = findFieldCore(field, au);
  const play = [];
  field.forEachRockInRect(BELT_BAND.PLAY, core.x - 30000, core.y - 30000, core.x + 30000, core.y + 30000, 0, (r) => play.push(r));
  assert.ok(play.length > 200);
  let big = 0, moons = 0;
  for (const r of play) {
    assert.equal(r.tumble, 0, 'skały gry nie koziołkują');
    assert.ok(Math.abs(2 * Math.PI / r.spin) >= minSpinPeriod(r.d) - 1e-6, 'okres ≥ bariery');
    if (r.d >= MOON_CONFIG.playD[0] && r.d <= MOON_CONFIG.playD[1]) big++;
    if (!r.moon) continue;
    moons++;
    const m = r.moon;
    assert.equal(m.nz, 1, 'orbita w paśmie gry pozioma');
    assert.ok(m.r <= r.r * MOON_CONFIG.sizeRatio[1] + 1e-9 && m.dist >= r.r * MOON_CONFIG.distRatio[0] - 1e-9);
    // Księżyc pod płaszczyzną gry: środek na głębokości środka skały (−1,45 r · s), mniejszy.
    const zc = -r.r * 1.62 * Math.max(r.sx, r.sy, r.sz);
    const st = moonStateAt(r, 37.5);
    assert.ok(Math.abs(st.oz) < 1e-9);
    assert.ok(zc + st.oz + m.r * 1.45 * Math.max(m.sx, m.sy, m.sz) < 0, 'księżyc nie wystaje nad z = 0');
    assert.ok(Math.abs(Math.hypot(st.x - r.x, st.y - r.y) - m.dist) < 1e-6);
  }
  const share = moons / Math.max(1, big);
  assert.ok(share > 0.015 && share < 0.12, `udział par wśród skał ${MOON_CONFIG.playD.join('–')} j.: ${(share * 100).toFixed(1)}%`);
  // Mniejsze skały nie wchodzą w tor księżyca większej (układ = orbita).
  const allow = field.config.playOverlap;
  for (const a of play) {
    if (!a.moon) continue;
    const reach = rockSystemReach(a);
    for (const b of play) {
      if (b === a || b.oct >= a.oct) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      assert.ok(d >= (reach + b.r) * allow - 1e-6, `skała ${b.id} na torze księżyca ${a.id}`);
    }
  }
  // Tło koziołkuje (część), pary są też w tle.
  let back = 0, tumbling = 0, backMoons = 0;
  for (const band of [BELT_BAND.MID, BELT_BAND.DEEP]) {
    field.forEachRockInRect(band, core.x - 30000, core.y - 30000, core.x + 30000, core.y + 30000, 0, (r) => {
      back++;
      if (r.tumble > 0) tumbling++;
      if (r.moon) backMoons++;
    });
  }
  assert.ok(Math.abs(tumbling / back - TUMBLE_CONFIG.share) < 0.05, `koziołkuje ${(tumbling / back * 100).toFixed(1)}%`);
  assert.ok(backMoons > 0);
});

test('księżyc: orbita z Keplera, obrót synchroniczny, przejęcie w fazie orbity (wydobycie = shader)', () => {
  const primary = { id: 4242, x: 1000, y: 2000, r: 400, d: 800, type: ROCK_TYPE_INDEX.carbon ?? 7, shape: 3,
    qx: 0, qy: 0, qz: 0, qw: 1, ax: 0, ay: 0, az: 1, spin: 0.01, phase: 0, sx: 1, sy: 1, sz: 1, seed: 0.3 };
  const h = new Float64Array([0.01, 0.5, 0.5, 0.7, 0.4, 0.6]);
  const m = rockMoonFor(primary, true, h);
  assert.ok(m, 'księżyc dla losowania poniżej udziału');
  primary.moon = m;
  const ratio = m.dist / primary.r;
  assert.ok(Math.abs(Math.abs(2 * Math.PI / m.w) - MOON_CONFIG.periodK * Math.pow(ratio, 1.5)) < 1e-9, 'okres z Keplera');
  assert.equal(rockMoonFor(primary, true, new Float64Array([0.99, 0, 0, 0, 0, 0])), null);
  // Obrót synchroniczny: kąt obrotu księżyca minus kąt orbity stały.
  for (const t of [0, 10, 50]) {
    const rec = moonRockRecord(primary, t);
    const st = moonStateAt(primary, t);
    const ang = rec.phase + rec.spin * t;
    assert.ok(Math.abs((ang - st.theta)) < 1e-9);
  }
  // Wydobycie: orientacja ciała księżyca = orientacja shadera w chwili przejęcia.
  const mining = new AsteroidMining({ radiusAt: () => 1, config: { rubble: false } });
  const t = 23.25;
  const rec = moonRockRecord(primary, t);
  const body = mining.activate(rec, { z: -600, time: t });
  const q = rockOrientationAt(rec, t, 0);
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(body.q[i] - q[i]) < 1e-9, 'kwaternion ciała = shader');
  assert.ok(Math.abs(body.p[0] - rec.x) < body.cs && Math.abs(-body.p[1] - rec.y) < body.cs, 'ciało w miejscu księżyca');
});

test('platforma: trafienie w księżyc przejmuje parę (księżyc teraz, skała klatkę później)', () => {
  const primary = { id: 777, x: 3000, y: 0, r: 420, d: 840, type: ROCK_TYPE_INDEX.copper, shape: 3,
    qx: 0, qy: 0, qz: 0, qw: 1, ax: 0, ay: 0, az: 1, spin: 0.02, phase: 0.4, sx: 1, sy: 1, sz: 1, seed: 0.3, oct: 0 };
  primary.moon = rockMoonFor(primary, true, new Float64Array([0.01, 0.6, 0.3, 0.2, 0.5, 0.4]));
  const field = {
    forEachRockInRect(band, x0, y0, x1, y1, minD, cb) {
      if (primary.d >= minD && primary.x + primary.r >= x0 && primary.x - primary.r <= x1 && primary.y + primary.r >= y0 && primary.y - primary.r <= y1) cb(primary);
    }
  };
  const mining = new AsteroidMining({ radiusAt: () => 1, config: { rubble: false } });
  const playZ = (rock) => -rock.r * 1.45 * Math.max(rock.sx, rock.sy, rock.sz);
  let time = 41.5;
  const rig = new MiningRig({ mining, field, playZ, stock: createMiningChargeStock({ S: 1 }), timeSource: () => time });
  const st = moonStateAt(primary, time);
  rig.beginFrame();
  rig._takeHeavy();
  const body = rig._activateAt(st.x, -st.y);
  assert.ok(body, 'trafiony księżyc');
  assert.equal(body.userData.fieldId, primary.moon.id);
  assert.ok(rig.taken.has(primary.moon.id) && !rig.taken.has(primary.id), 'skała pierwotna jeszcze na orbicie');
  // Następna klatka: skała pierwotna przejęta (jedna ciężka operacja na klatkę).
  time += 1 / 60;
  rig.beginFrame();
  rig.step(1 / 120, { x: 0, y: 0, angle: 0, len: 1800 });
  assert.ok(rig.taken.has(primary.id), 'para przejęta');
  assert.equal(mining.bodies.length, 2);
});

test('platforma: skała pierwotna najpierw; księżyc wraca do pola tylko ze skałą; skała testowa chowa księżyce', () => {
  const primary = { id: 778, x: 3000, y: 0, r: 420, d: 840, type: ROCK_TYPE_INDEX.copper, shape: 3,
    qx: 0, qy: 0, qz: 0, qw: 1, ax: 0, ay: 0, az: 1, spin: 0.02, phase: 0.4, sx: 1, sy: 1, sz: 1, seed: 0.3, oct: 0 };
  primary.moon = rockMoonFor(primary, true, new Float64Array([0.01, 0.6, 0.3, 0.2, 0.5, 0.4]));
  const field = {
    forEachRockInRect(band, x0, y0, x1, y1, minD, cb) {
      if (primary.d >= minD && primary.x + primary.r >= x0 && primary.x - primary.r <= x1 && primary.y + primary.r >= y0 && primary.y - primary.r <= y1) cb(primary);
    }
  };
  const mining = new AsteroidMining({ radiusAt: () => 1, config: { rubble: false } });
  const playZ = (rock) => -rock.r * 1.45 * Math.max(rock.sx, rock.sy, rock.sz);
  let time = 12.25;
  const rig = new MiningRig({ mining, field, playZ, stock: createMiningChargeStock({ S: 1 }), timeSource: () => time });
  const ship = { x: 0, y: 0, angle: 0, len: 1800 };
  const take = () => {
    rig.beginFrame();
    rig._takeHeavy();
    const body = rig._activateAt(primary.x, -primary.y);
    // Księżyc nieprzejęty — warstwa rysuje go dalej na orbicie (chowa go tylko jego id).
    assert.ok(rig.taken.has(primary.id) && !rig.taken.has(primary.moon.id), 'księżyc jeszcze na orbicie');
    time += 1 / 60;
    rig.beginFrame();
    rig.step(1 / 120, ship);
    assert.ok(rig.taken.has(primary.moon.id), 'księżyc przejęty klatkę później');
    return body;
  };
  take();
  // Oddanie polu (statek daleko): obie nietknięte — wracają razem.
  rig._releaseFar({ x: 1e7, y: 1e7 });
  assert.ok(!rig.taken.has(primary.id) && !rig.taken.has(primary.moon.id), 'para wraca do pola');
  // Skała rozebrana, księżyc nietknięty — księżyc nie wraca (nie krąży wokół niczego).
  const rockBody = take();
  rockBody.damage = 1;
  rig._releaseFar({ x: 1e7, y: 1e7 });
  assert.ok(rig.taken.has(primary.id) && rig.taken.has(primary.moon.id), 'księżyc zostaje schowany ze skałą');
  // Skała testowa przy orbicie (poza obrysem skały pierwotnej) chowa sam księżyc.
  rig.reset();
  const d = 1500;
  assert.ok(d > 300 * 1.35 + primary.r && d < 300 * 1.35 + primary.moon.dist + primary.moon.r);
  rig.spawnTestRock('copper', { x: primary.x + d - 1700, y: 0, angle: 0 }, 300, 1700);
  assert.ok(rig.taken.has(primary.moon.id) && !rig.taken.has(primary.id), 'orbita wchodzi na skałę testową');
});
