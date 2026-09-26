import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STORM_CONFIG, stormIntensity, buildBoltChains, strikeEnvelope, sheetEnvelope, StormSimulator
} from '../src/game/asteroidStorms.js';
import { AsteroidBeltField, BELT_BAND } from '../src/game/asteroidBeltField.js';
import { ENERGY_TYPE } from '../src/game/asteroidRockKinds.js';

test('burza tylko w gęstych polach, deterministyczna, w [0, 1]', () => {
  for (let i = 0; i < 400; i++) {
    const x = i * 7919.3;
    const y = -i * 3301.7;
    assert.equal(stormIntensity(1, x, y, STORM_CONFIG.minCluster * 0.9), 0, 'rzadki pas bez burz');
    const s = stormIntensity(1, x, y, 1);
    assert.ok(s >= 0 && s <= 1);
    assert.equal(stormIntensity(1, x, y, 1), s);
  }
  // Komórki burz istnieją, ale nie wszędzie (szum z progiem).
  let on = 0;
  for (let i = 0; i < 4000; i++) if (stormIntensity(7, i * 23117.1, i * 9931.3, 1) > 0.5) on++;
  assert.ok(on > 40 && on < 3000, `udział pełnych burz w rdzeniach pól: ${on / 4000}`);
});

test('skały energetyczne powstają tylko w komórkach burz', () => {
  const field = new AsteroidBeltField({ sunX: 0, sunY: 0, auToWorld: 42253.52 });
  // Najsilniejsza burza w pasach-pierścieniach (próbkowanie po okręgach w ich szerokości).
  let best = null;
  for (const reg of field.regions) {
    if (reg.kind !== 'ring') continue;
    for (let i = 0; i < 4000; i++) {
      const a = (i / 4000) * Math.PI * 2;
      for (let k = 0; k < 5; k++) {
        const r = reg.rInner + (reg.rOuter - reg.rInner) * (k + 0.5) / 5;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        const s = field.stormAt(x, y);
        if (!best || s > best.s) best = { x, y, s };
      }
    }
  }
  assert.ok(best && best.s > 0.6, `jest burza w pasach: ${best?.s}`);
  let energy = 0;
  let total = 0;
  const half = 12000;
  field.forEachRockInRect(BELT_BAND.PLAY, best.x - half, best.y - half, best.x + half, best.y + half, 0, (r) => {
    total++;
    if (r.type === ENERGY_TYPE) {
      energy++;
      assert.ok(field.stormAt(r.x, r.y) > 0, 'energetyczna tylko w burzy');
      assert.ok(r.d >= STORM_CONFIG.energyMinDiameter);
    }
  });
  assert.ok(energy > 5, `w burzy są skały energetyczne: ${energy}/${total}`);
  assert.ok(energy / total < 0.5, 'reszta pola zostaje zwykła');
});

test('błyskawica: końce w A i B, t rośnie od 0 do 1, gałęzie z pnia', () => {
  const chains = buildBoltChains(0, 0, -100, 2000, 300, -300, 12345, { levels: 6, branches: 3 });
  const main = chains[0];
  assert.equal(main.count, 65);
  assert.deepEqual([...main.points.slice(0, 3)], [0, 0, -100]);
  assert.deepEqual([...main.points.slice(-3)], [2000, 300, -300]);
  for (let k = 1; k < main.count; k++) assert.ok(main.t[k] > main.t[k - 1]);
  assert.equal(main.t[main.count - 1], 1);
  assert.equal(chains.length, 4);
  for (const br of chains.slice(1)) {
    assert.ok(br.w < 1);
    assert.ok(br.t[0] > 0 && br.t[0] < 1, 'gałąź odsłania się, gdy lider dojdzie do korzenia');
  }
  // Ten sam seed → ta sama błyskawica.
  const again = buildBoltChains(0, 0, -100, 2000, 300, -300, 12345, { levels: 6, branches: 3 });
  assert.deepEqual([...again[0].points], [...main.points]);
});

test('przebieg pioruna: lider rośnie, potem udar ~1, poświata gaśnie', () => {
  const s = { leader: 0.05, strokes: [{ at: 0.05, amp: 1 }, { at: 0.2, amp: 0.7 }] };
  const e = strikeEnvelope(s, 0.025);
  assert.ok(Math.abs(e.reveal - 0.5) < 1e-9 && e.intensity < 0.4);
  const peak = strikeEnvelope(s, 0.058).intensity;
  assert.ok(peak > 0.8, `udar główny: ${peak}`);
  assert.ok(strikeEnvelope(s, 0.15).intensity < 0.3, 'między udarami przygasa');
  assert.ok(strikeEnvelope(s, 0.208).intensity > 0.5, 'udar powrotny');
  assert.ok(strikeEnvelope(s, 1.2).intensity < 0.02, 'zgasł');
  const sheet = { pulses: [{ at: 0, amp: 1 }, { at: 0.1, amp: 0.6 }] };
  assert.ok(sheetEnvelope(sheet, 0.012) > 0.8 && sheetEnvelope(sheet, 0.6) < 0.01);
});

test('symulacja: łuki między skałami w zasięgu, odpoczynek skał, brak burzy = brak piorunów', () => {
  const rocks = [];
  for (let i = 0; i < 12; i++) rocks.push({ id: i, x: (i % 4) * 1200, y: Math.floor(i / 4) * 1200, z: -400, r: 250 });
  const view = { x: 1800, y: 1200, halfW: 4000, halfH: 3000 };
  const sim = new StormSimulator({}, 99);
  let arcs = 0;
  let clouds = 0;
  const seen = new Set();
  for (let f = 0; f < 60 * 20; f++) {
    sim.update(1 / 60, rocks, 1, view);
    for (const s of sim.strikes) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      if (s.kind === 'arc') {
        arcs++;
        assert.notEqual(s.rockA, s.rockB);
        const a = rocks[s.rockA];
        const b = rocks[s.rockB];
        const reach = Math.min(STORM_CONFIG.arcMax, STORM_CONFIG.arcBase + STORM_CONFIG.arcPerRadius * (a.r + b.r));
        assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < reach, 'łuk tylko w zasięgu');
      } else {
        clouds++;
        assert.ok(s.bz < s.az - STORM_CONFIG.cloudDepth[0] * 0.99, 'wyładowanie w pył schodzi pod płaszczyznę');
      }
    }
    assert.ok(sim.strikes.length <= STORM_CONFIG.maxStrikes);
  }
  const rate = (arcs + clouds) / 20;
  assert.ok(rate > STORM_CONFIG.strikeRate * 0.5 && rate < STORM_CONFIG.strikeRate * 1.6, `częstość wyładowań ${rate}/s`);
  assert.ok(arcs > clouds, 'więcej łuków niż wyładowań w pył');
  assert.ok(sim.stats.sheets > 10, 'błyski w chmurach');
  // Bez burzy nic nowego nie uderza, stare gasną.
  for (let f = 0; f < 120; f++) sim.update(1 / 60, rocks, 0, view);
  assert.equal(sim.strikes.length, 0);
  assert.equal(sim.sheets.length, 0);
});
