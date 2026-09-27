import test from 'node:test';
import assert from 'node:assert/strict';

import { AsteroidMining, createYield, yieldOreTotal } from '../src/game/asteroidMining.js';
import { MINING_CONFIG, rockMaterial, chargeReach, chargeForDepth, oreResourceOf } from '../src/game/asteroidMaterials.js';
import { ROCK_TYPE_INDEX } from '../src/game/asteroidRockKinds.js';

// Kształt bez GPU: lekko pofalowana kula (średnia ~1 jak w banku).
const lumpy = (shape, x, y, z) => 1 + 0.08 * Math.sin(3 * x + shape) * Math.cos(2 * y) + 0.05 * z * z;
const sphere = () => 1;

function rockRecord(type, r, id = 12345, extra = {}) {
  return {
    id, x: 1000, y: 2000, r, d: 2 * r, shape: 3, type: ROCK_TYPE_INDEX[type],
    qx: 0, qy: 0, qz: 0, qw: 1, ax: 0, ay: 0, az: 1, spin: 0, phase: 0,
    sx: 1, sy: 1, sz: 1, seed: 0.37, ...extra
  };
}

function totalMass(sys) {
  let m = 0;
  for (const b of sys.bodies) { if (b.massDirty) b.recomputeMass(); m += b.mass; }
  for (const p of sys.pebbles) m += p.mass;
  return m;
}

test('masa skały = objętość × gęstość × skala ton, środek masy w środku skały', () => {
  const sys = new AsteroidMining({ radiusAt: sphere });
  const b = sys.activate(rockRecord('iron', 300), { z: -435 });
  const expected = (4 / 3) * Math.PI * 300 ** 3 * rockMaterial('iron').density * MINING_CONFIG.tonnesPerVolume;
  assert.ok(Math.abs(b.mass - expected) / expected < 0.05, `masa ${b.mass.toFixed(1)} t vs ${expected.toFixed(1)} t`);
  assert.ok(Math.hypot(b.p[0] - 1000, b.p[1] + 2000, b.p[2] + 435) < b.cs, 'środek masy kuli = środek skały (Y = −y)');
  assert.ok(b.nx <= MINING_CONFIG.maxCellsPerAxis && b.solidCells > 5000);
});

test('rdzeń bogaty, skorupa uboga (miedź), skała neutralna bez rudy', () => {
  const sys = new AsteroidMining({ radiusAt: sphere });
  const b = sys.activate(rockRecord('copper', 400), { z: -600 });
  const c = b.core;
  assert.ok(b.sampleOre(c.x, c.y, c.z) > 0.8, 'rdzeń ≈ czysta miedź');
  // Tuż pod powierzchnią, po przeciwnej stronie niż przesunięcie rdzenia.
  const l = Math.hypot(c.x, c.y, c.z) || 1;
  const dx = c.x ? -c.x / l : 1, dy = c.y ? -c.y / l : 0, dz = c.z ? -c.z / l : 0;
  const shallow = b.sampleOre(dx * 380, dy * 380, dz * 380);
  assert.ok(shallow < 0.1, `skorupa: ${shallow.toFixed(3)}`);
  assert.equal(b.oreRes, oreResourceOf('copper'));
  // Ruda całości: kilka–kilkanaście procent masy, rdzeń to jej spora część.
  const share = b.oreMass / b.mass;
  assert.ok(share > 0.04 && share < 0.3, `udział rudy ${share.toFixed(3)}`);
  // Neutralna: bez ukrytego rdzenia (seed skały dobrany tak, że go nie ma) — zero rudy.
  let found = false;
  for (let id = 1; id < 60 && !found; id++) {
    const n = sys.activate(rockRecord('rock', 200, id), { z: -300 });
    if (n.oreTypeId === null) {
      assert.equal(n.oreMass, 0);
      assert.equal(n.oreRes, null);
      found = true;
    }
    sys.release(n);
  }
  assert.ok(found, 'większość skał neutralnych nie ma rdzenia');
});

test('laser: twardość decyduje o tempie, w głąb ruda coraz bogatsza', () => {
  const removedIn = (type) => {
    const sys = new AsteroidMining({ radiusAt: sphere });
    const b = sys.activate(rockRecord(type, 300), { z: -435 });
    let vol = 0;
    for (let i = 0; i < 30; i++) {
      const hit = sys.raycast(b.p[0], b.p[1], 5000, 0, 0, -1);
      assert.ok(hit, 'wiązka trafia skałę z góry');
      vol += sys.laser(b, hit.x, hit.y, hit.z, 0, 0, -1, 1, 1 / 30);
    }
    return vol;
  };
  const ice = removedIn('ice'), iron = removedIn('iron'), titan = removedIn('titan');
  assert.ok(ice > iron && iron > titan, `lód ${ice.toFixed(0)} > żelazo ${iron.toFixed(0)} > tytan ${titan.toFixed(0)}`);
  assert.ok(Math.abs(ice / titan - (0.2 + 0.95) / (0.2 + 0.1)) < 0.5, 'stosunek tempa ≈ stosunek (0,2 + twardość)');

  // Kopanie do rdzenia miedzi: urobek z głębi ma więcej rudy na tonę.
  const sys = new AsteroidMining({ radiusAt: sphere });
  const b = sys.activate(rockRecord('copper', 350), { z: -510 });
  const coreW = b.localToWorld(b.core.x, b.core.y, b.core.z, [0, 0, 0]);
  const early = createYield();
  const late = createYield();
  let reached = false;
  for (let i = 0; i < 4000 && !reached; i++) {
    const hit = sys.raycast(coreW[0], coreW[1], 5000, 0, 0, -1, 1e6, b);
    if (!hit) break;
    // Nad rdzeniem (z większe niż wierzch rdzenia) = skorupa i płaszcz.
    const out = hit.z > coreW[2] + b.core.r ? early : late;
    sys.laser(b, hit.x, hit.y, hit.z, 0, 0, -1, 4, 1 / 20, out);
    if (hit.z < coreW[2]) reached = true;
  }
  assert.ok(reached, 'otwór dochodzi do rdzenia');
  const perT = (y) => yieldOreTotal(y) / Math.max(1e-9, yieldOreTotal(y) + y.waste);
  assert.ok(perT(late) > perT(early) * 3, `ruda/t: skorupa ${perT(early).toFixed(3)}, rdzeń ${perT(late).toFixed(3)}`);
});

test('ładunek: lód pęka od małego, tytan trzyma mały i pęka od dużego', () => {
  const blast = (type, E, r = 300) => {
    const sys = new AsteroidMining({ radiusAt: lumpy, seed: 7 });
    const b = sys.activate(rockRecord(type, r), { z: -r * 1.5 });
    const before = b.mass;
    const out = createYield();
    const res = sys.detonate(b, b.p[0], b.p[1], b.p[2], E, out);
    const after = totalMass(sys);
    return { res, sys, before, after, out };
  };
  const ice = blast('ice', 1);
  assert.equal(ice.res.outcome, 'breach', 'mały ładunek rozbija lód');
  const all = (r) => [...r.bodies, ...r.pebbles, ...r.gravel];
  const icePieces = all(ice.res).length;
  assert.ok(icePieces >= 6, `lód: ${icePieces} odłamów`);

  const titanSmall = blast('titan', 1);
  assert.equal(titanSmall.res.outcome, 'contained', 'mały ładunek w tytanie — pęka tylko w środku');
  assert.equal(titanSmall.res.bodies.length + titanSmall.res.pebbles.length + titanSmall.res.gravel.length, 0);
  assert.equal(titanSmall.res.crushed, 0, 'za słaby ładunek nie niszczy rudy');
  assert.ok(titanSmall.sys.bodies[0].damage > 0, 'skała osłabiona');

  const titanBig = blast('titan', 16);
  assert.equal(titanBig.res.outcome, 'breach');
  const titanPieces = all(titanBig.res).length;
  assert.ok(titanPieces >= 1, `tytan: ${titanPieces} brył`);
  // Kruchy lód sypie się drobniej niż tytan (średnia masa odłamu względem skały).
  const meanShare = (t) => {
    const p = all(t.res);
    return p.reduce((a, x) => a + x.mass, 0) / Math.max(1, p.length) / t.before;
  };
  assert.ok(meanShare(ice) < meanShare(titanBig), `średni odłam: lód ${(meanShare(ice) * 100).toFixed(1)}%, tytan ${(meanShare(titanBig) * 100).toFixed(1)}%`);

  // Masa: przed = po + zmiażdżone + pył (utrata tylko przez pył).
  for (const t of [ice, titanSmall, titanBig]) {
    const lost = t.res.lostCrush + t.res.dust;
    assert.ok(Math.abs(t.before - (t.after + lost)) / t.before < 0.01,
      `bilans masy ${t.before.toFixed(1)} = ${t.after.toFixed(1)} + ${lost.toFixed(1)}`);
  }
  // Kolejny ładunek po osłabieniu sięga dalej.
  const m = rockMaterial('titan');
  assert.ok(chargeReach(m, 1).fracture * Math.cbrt(1 + titanSmall.sys.bodies[0].damage) > chargeReach(m, 1).fracture);
});

test('chargeForDepth: najmniejszy ładunek, którego spękania sięgają danej głębokości', () => {
  for (const type of ['ice', 'rock', 'copper', 'titan']) {
    const m = rockMaterial(type);
    for (const depth of [150, 400, 900]) {
      const E = chargeForDepth(m, depth);
      assert.ok(Math.abs(chargeReach(m, E).fracture - depth) < 1e-6 * depth + 1e-6, `${type} ${depth}`);
    }
  }
  const m = (t) => chargeForDepth(rockMaterial(t), 500);
  assert.ok(m('ice') < m('rock') && m('rock') < m('copper') && m('copper') < m('titan'), 'lód najmniej, tytan najwięcej');
});

test('odłamy lecą od ładunku, zostają pod płaszczyzną gry, wiązka je zbiera', () => {
  const sys = new AsteroidMining({ radiusAt: lumpy, seed: 3 });
  const b = sys.activate(rockRecord('silicon', 350), { z: -520 });
  const total = b.mass;
  const out0 = createYield();
  const res = sys.detonate(b, b.p[0], b.p[1], b.p[2], 4, out0);
  assert.equal(res.outcome, 'breach');
  const pieces = [...res.bodies, ...res.pebbles];
  assert.ok(pieces.length > 2);
  const cx = res.x, cy = res.y, cz = res.z;
  let away = 0;
  for (const p of pieces) {
    const d = [p.p[0] - cx, p.p[1] - cy, p.p[2] - cz];
    if (d[0] * p.v[0] + d[1] * p.v[1] + d[2] * p.v[2] > 0) away++;
  }
  assert.ok(away >= pieces.length * 0.7, `${away}/${pieces.length} odłamów leci od ładunku`);
  for (let i = 0; i < 180; i++) sys.step(1 / 60);
  for (const p of sys.pebbles) assert.ok(p.p[2] + p.r <= MINING_CONFIG.layerTop + 1e-6, 'okruch pod płaszczyzną');
  for (const q of sys.bodies) assert.ok(q.p[2] + q.boundR * 0.7 <= MINING_CONFIG.layerTop + 1e-6, 'odłam pod płaszczyzną');
  // Wiązka: wszystko lżejsze niż udźwig w zasięgu ląduje w ładowni.
  const out = createYield();
  const tx = cx, ty = cy, tz = -100;
  let got = 0;
  for (let i = 0; i < 1200; i++) {
    got += sys.tractor(tx, ty, tz, 6000, total, 120, 1 / 60, out).length;
    sys.step(1 / 60);
  }
  assert.ok(got >= pieces.length * 0.8, `złapane ${got}/${pieces.length}`);
  assert.ok(out.waste > 0);
  const ore = yieldOreTotal(out);
  if (b.oreRes) assert.ok(ore >= 0);
});

test('piła przecina skałę na dwie części, szczelina to pył', () => {
  const sys = new AsteroidMining({ radiusAt: sphere });
  const b = sys.activate(rockRecord('rock', 300), { z: -435 });
  const before = b.mass;
  const res = sys.slice(b, b.p[0], b.p[1], b.p[2], 1, 0, 0, 40);
  assert.equal(res.bodies.length, 1, 'odcięta połówka jako nowe ciało');
  const after = totalMass(sys);
  assert.ok(Math.abs(before - after - res.lost) / before < 0.01, 'masa = reszta + szczelina');
  const [a, c] = sys.bodies;
  assert.ok(Math.sign(a.p[0] - 1000) !== Math.sign(c.p[0] - 1000), 'połówki po obu stronach cięcia');
});

test('piła pasami: skała rozpada się dopiero po przejściu na wylot', () => {
  const sys = new AsteroidMining({ radiusAt: sphere });
  const b = sys.activate(rockRecord('iron', 300), { z: -435 });
  // Linia cięcia wzdłuż X przez środek (płaszczyzna Y = środek), przesuw od −400 do +400.
  const x0 = b.p[0] - 400, y0 = b.p[1];
  let pieces = 1;
  let splitAt = null;
  for (let t = 0; t < 800; t += 40) {
    const res = sys.slice(b, x0, y0, b.p[2], 0, 1, 0, 30, { x: 1, y: 0, z: 0, from: t - 20, to: t + 40 });
    pieces += res.bodies.length;
    if (res.bodies.length && splitAt === null) splitAt = t;
  }
  assert.equal(pieces, 2, 'dwie połówki');
  assert.ok(splitAt !== null && splitAt >= 500, `rozpad dopiero przy końcu cięcia (t = ${splitAt})`);
});

test('za słaby ładunek nie niszczy rudy; drobinki z lasera trafiają do urobku', () => {
  const sys = new AsteroidMining({ radiusAt: sphere });
  const b = sys.activate(rockRecord('titan', 400), { z: -580 });
  const ore0 = b.oreMass;
  const res = sys.detonate(b, b.p[0], b.p[1], b.p[2], 0.5, createYield());
  assert.equal(res.outcome, 'contained');
  b.recomputeMass();
  assert.ok(Math.abs(b.oreMass - ore0) < 1e-9, 'ruda bez zmian');
  // Drobinka odcięta laserem: łupina wycięta dookoła małej kulki → kulka to osobna,
  // mała składowa — znika w urobku kopiącego, nie zostaje okruchem w otworze.
  const out = createYield();
  const cs = b.cs;
  const c = [b.gx + (b.nx - 1) * cs * 0.5 + 60, 0, 0];
  const n = 120;
  for (let i = 0; i < n; i++) {
    const z = 1 - (2 * (i + 0.5)) / n;
    const rr = Math.sqrt(1 - z * z);
    const a2 = i * Math.PI * (3 - Math.sqrt(5));
    for (const R of [2.2, 2.9]) {
      sys.dig(b, c[0] + Math.cos(a2) * rr * cs * R, c[1] + Math.sin(a2) * rr * cs * R, c[2] + z * cs * R, cs * 0.8, cs * cs * cs * 3, out);
    }
  }
  b.recomputeMass();
  const m0 = b.mass;
  const w0 = out.waste + yieldOreTotal(out);
  b.splitDirty = true;
  const pebbles0 = sys.pebbles.length;
  sys.step(1 / 60);
  b.recomputeMass();
  assert.equal(sys.pebbles.length, pebbles0, 'bez okruchów z drobinek lasera');
  assert.ok(m0 - b.mass > 0.01, `drobinka odpadła od skały (${(m0 - b.mass).toFixed(3)} t)`);
  assert.ok(Math.abs((out.waste + yieldOreTotal(out) - w0) - (m0 - b.mass)) < 1e-6, 'masa drobinki w urobku');
});

test('determinizm: te same operacje = te same odłamy', () => {
  const run = () => {
    const sys = new AsteroidMining({ radiusAt: lumpy, seed: 11 });
    const b = sys.activate(rockRecord('crystal', 320), { z: -470 });
    const res = sys.detonate(b, b.p[0] + 40, b.p[1], b.p[2], 2);
    for (let i = 0; i < 30; i++) sys.step(1 / 60);
    return [res.bodies.length, res.pebbles.length, totalMass(sys).toFixed(6), sys.bodies.map((x) => x.p[0].toFixed(4)).join(',')];
  };
  assert.deepEqual(run(), run());
});

test('koszt: budowa dużej skały i wybuch mieszczą się w klatce-dwóch', () => {
  const sys = new AsteroidMining({ radiusAt: lumpy, seed: 5 });
  const t0 = performance.now();
  const b = sys.activate(rockRecord('copper', 1000), { z: -1450 });
  const build = performance.now() - t0;
  const t1 = performance.now();
  sys.detonate(b, b.p[0], b.p[1], b.p[2], 16);
  const blast = performance.now() - t1;
  assert.ok(build < 400, `budowa ${build.toFixed(0)} ms`);
  assert.ok(blast < 400, `wybuch ${blast.toFixed(0)} ms`);
});
