import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { DestructorSystem as D, DESTRUCTOR_CONFIG as C, disposeHexBody, shardHeatNow } from '../src/game/destructor.js';
import { CollisionFX } from '../src/vfx/collisionFx.js';
import { SparkSystem3D } from '../src/3d/sparkSystem3D.js';
import { makeDestructorHull as hull } from './helpers/destructorHull.mjs';

// Ten sam bufor scratch wraca przy każdym zdarzeniu — kopiujemy w trakcie
// wywołania, dokładnie tak, jak muszą robić prawdziwi subskrybenci.
function recorder(type) {
  const seen = [];
  const fn = (ev) => {
    seen.push({
      approachSpeed: ev.approachSpeed,
      energy: ev.energy,
      simTime: ev.simTime,
      pointCount: ev.pointCount || 0,
      points: ev.points ? Array.from(ev.points.subarray(0, (ev.pointCount || 0) * 4)) : null,
      nx: ev.nx,
      ny: ev.ny,
      reducedMass: ev.reducedMass
    });
  };
  CollisionFX.on(type, fn);
  return { seen, stop: () => CollisionFX.off(type, fn) };
}

function ramPair() {
  return {
    a: hull({ width: 640, height: 180, mass: 800000, vx: 600, x: 4 }),
    b: hull({ width: 320, height: 100, mass: 50000 })
  };
}

test('uderzenie odpala raz na zetknięcie, nie co tick', () => {
  const { a, b } = ramPair();
  const rec = recorder('impact');
  const impactsBefore = CollisionFX.stats.impacts;
  try {
    for (let tick = 0; tick < 12; tick++) {
      a.x = 4; a.y = b.x = b.y = 0;
      a.vx = 600; b.vx = 0; a.vy = b.vy = a.angVel = b.angVel = 0;
      // Dwie iteracje kolizji na tick, jak w update(): tylko iteracja 0 niesie doDamage.
      D.collideEntities(a, b, 1 / 120, true);
      D.collideEntities(a, b, 1 / 120, false);
      D._simulationTime += 1 / 120;
    }
    assert.equal(rec.seen.length, 1, `12 ticków styku to JEDNO uderzenie, dostaliśmy ${rec.seen.length}`);
    assert.equal(CollisionFX.stats.impacts - impactsBefore, 1);
    assert.ok(rec.seen[0].approachSpeed >= C.impactMinSpeed);
    // E = 0.5 * masa zredukowana * v^2; masa zredukowana pary 800k/50k to ~47k.
    const reduced = (800000 * 50000) / 850000;
    assert.ok(Math.abs(rec.seen[0].reducedMass - reduced) < reduced * 0.35);
    assert.ok(rec.seen[0].energy > 0);
  } finally {
    rec.stop();
    disposeHexBody(a);
    disposeHexBody(b);
  }
});

test('po separacji i ponownym zetknięciu uderzenie czeka na cooldown', () => {
  const { a, b } = ramPair();
  const rec = recorder('impact');
  const touch = () => {
    a.x = 4; a.y = b.x = b.y = 0;
    a.vx = 600; b.vx = 0; a.vy = b.vy = a.angVel = b.angVel = 0;
    D.collideEntities(a, b, 1 / 120, true);
  };
  try {
    touch();
    assert.equal(rec.seen.length, 1);

    // Separacja (okno kontaktu to 0.1 s), ale wciąż wewnątrz impactCooldown.
    D._simulationTime += 0.3;
    touch();
    assert.equal(rec.seen.length, 1, 'odbicie i powrót w oknie cooldownu to nadal to samo zderzenie');

    D._simulationTime += Math.max(0.2, C.impactCooldown);
    touch();
    assert.equal(rec.seen.length, 2, 'po cooldownie nowe zetknięcie to nowe uderzenie');
  } finally {
    rec.stop();
    disposeHexBody(a);
    disposeHexBody(b);
  }
});

test('powolne dosunięcie się burtą nie jest uderzeniem', () => {
  const { a, b } = ramPair();
  const rec = recorder('impact');
  try {
    a.x = 4; a.y = b.x = b.y = 0;
    a.vx = Math.max(1, C.impactMinSpeed * 0.4);
    b.vx = 0; a.vy = b.vy = a.angVel = b.angVel = 0;
    D.collideEntities(a, b, 1 / 120, true);
    assert.equal(rec.seen.length, 0);
  } finally {
    rec.stop();
    disposeHexBody(a);
    disposeHexBody(b);
  }
});

test('tarcie niesie próbki wzdłuż szwu, każda z własną normalną', () => {
  const { a, b } = ramPair();
  const rec = recorder('grind');
  try {
    a.x = 4; a.y = b.x = b.y = 0;
    a.vx = 600;
    D.collideEntities(a, b, 1 / 120, true);
    assert.ok(rec.seen.length >= 1);
    const ev = rec.seen[rec.seen.length - 1];
    assert.ok(ev.pointCount > 1, `szeroki styk musi dać więcej niż jeden punkt (${ev.pointCount})`);
    assert.ok(ev.pointCount <= C.seamSparkPoints);

    let spread = 0;
    for (let p = 0; p < ev.pointCount; p++) {
      const nx = ev.points[p * 4 + 2];
      const ny = ev.points[p * 4 + 3];
      assert.ok(Math.abs(Math.hypot(nx, ny) - 1) < 1e-4, 'normalne próbek są znormalizowane');
      spread = Math.max(spread, Math.hypot(ev.points[p * 4] - ev.points[0], ev.points[p * 4 + 1] - ev.points[1]));
    }
    assert.ok(spread > 0, 'punkty szwu nie mogą leżeć wszystkie w centroidzie');
  } finally {
    rec.stop();
    disposeHexBody(a);
    disposeHexBody(b);
  }
});

test('strefa zgniotu dostaje żar, który stygnie niezależnie od deformacji', () => {
  const { a, b } = ramPair();
  try {
    const now = 1000;
    a.x = 4; a.y = b.x = b.y = 0;
    a.vx = 600;
    D.collideEntities(a, b, 1 / 120, true);

    const hot = b.hexGrid.shards.filter((s) => (Number(s.heat) || 0) > 0);
    assert.ok(hot.length > 0, 'zgnieciona blacha musi się żarzyć');
    for (const shard of hot) {
      assert.ok(shard.heat <= 1, 'żar jest znormalizowany do 1');
      assert.ok(shard.heatStamp > 0, 'znacznik czasu w bazie performance.now');
    }

    // Zanik liczony z pary (heat, heatStamp) — bez chodzenia po shardach.
    const sample = hot[0];
    sample.heat = 1;
    sample.heatStamp = now;
    assert.equal(shardHeatNow(sample, now), 1);
    const after5s = shardHeatNow(sample, now + 5);
    const expected = Math.exp(-5 * C.heatDecay);
    assert.ok(Math.abs(after5s - expected) < 1e-9, `zanik wykładniczy z heatDecay: ${after5s} vs ${expected}`);
    assert.ok(after5s < 0.3, 'po 5 s blacha nie może być już pomarańczowa');
    assert.ok(shardHeatNow(sample, now + 20) < 0.001);
  } finally {
    disposeHexBody(a);
    disposeHexBody(b);
  }
});

test('heks niszczony w tym samym ticku odlatuje rozgrzany', () => {
  const a = hull({ width: 640, height: 180, mass: 800000, vx: 600, x: 4 });
  const b = hull({ width: 160, height: 80, mass: 50000 });
  try {
    for (const s of b.hexGrid.shards) s.hp = 0.001;
    D.collideEntities(a, b, 1 / 120, true);
    const torn = b.hexGrid.shards.filter((s) => s.isDebris);
    assert.ok(torn.length > 0);
    assert.ok(torn.some((s) => (Number(s.heat) || 0) > 0), 'żar musi wejść PRZED testem hp <= 0');
  } finally {
    disposeHexBody(a);
    disposeHexBody(b);
  }
});

// --- Żar ma zostać NA KADŁUBIE: brzeg wyrwy i powierzchnia tarcia ---

const nowSecNow = () => performance.now() * 0.001;
const isAlive = (s) => s && s.active && !s.isDebris;

test('brzeg wyrwy zostaje na kadłubie rozżarzony, nie tylko odłamki', () => {
  const a = hull({ width: 640, height: 180, mass: 800000, vx: 600, x: 4 });
  const b = hull({ width: 160, height: 80, mass: 50000 });
  try {
    for (const s of b.hexGrid.shards) s.hp = 0.001;
    D.collideEntities(a, b, 1 / 120, true);
    const now = nowSecNow();
    const rim = b.hexGrid.shards.filter((s) => isAlive(s) && s.neighbors.some((n) => n.isDebris));
    assert.ok(rim.length > 0, 'taran musi zostawić ocalały brzeg');
    for (const s of rim) {
      assert.ok(shardHeatNow(s, now) >= 0.8, `brzeg wyrwy po taranie 600 u/s ma być biały, jest ${shardHeatNow(s, now)}`);
    }
    assert.equal(D._woundHeatContext, 0, 'kontekst rany gaśnie po zderzeniu');
  } finally {
    disposeHexBody(a);
    disposeHexBody(b);
  }
});

test('pocisk zabijający zimny heks nie rozżarza brzegu', () => {
  const b = hull({ width: 160, height: 80, mass: 50000 });
  try {
    const target = b.hexGrid.shards.find((s) => s.neighbors.filter(isAlive).length === 6);
    D.destroyShard(b, target);
    for (const n of target.neighbors) assert.equal(Number(n.heat) || 0, 0);
  } finally {
    disposeHexBody(b);
  }
});

test('gorący heks rozdarty poza zderzeniem oddaje żar brzegowi i drugiemu pierścieniowi', () => {
  const b = hull({ width: 160, height: 80, mass: 50000 });
  try {
    const target = b.hexGrid.shards.find((s) => s.neighbors.filter(isAlive).length === 6);
    target.heat = 1;
    target.heatStamp = nowSecNow();
    // Tak rozdarcie GPU (_applyResult) niszczy heks — bez kontekstu zderzenia.
    D.destroyShard(b, target);
    const now = nowSecNow();
    const ring1 = target.neighbors.filter(isAlive);
    const inherit = C.woundHeatInherit;
    for (const n of ring1) assert.ok(Math.abs(shardHeatNow(n, now) - inherit) < 0.02);
    const ring2 = new Set();
    for (const n of ring1) for (const m of n.neighbors) if (isAlive(m) && !ring1.includes(m)) ring2.add(m);
    assert.ok(ring2.size > 0);
    for (const m of ring2) {
      assert.ok(Math.abs(shardHeatNow(m, now) - inherit * C.woundHeatRing2) < 0.02, 'strefa wpływu ciepła jest chłodniejsza');
    }
  } finally {
    disposeHexBody(b);
  }
});

function slidePair(speed) {
  // Burta w burtę, zero zbliżania: poniżej crushMinSpeed nie ma zgniotu,
  // więc jedynym źródłem żaru jest tarcie.
  return {
    a: hull({ width: 640, height: 180, mass: 800000, y: -172, vx: speed }),
    b: hull({ width: 640, height: 180, mass: 60000 })
  };
}

test('czyste otarcie bez zgniotu grzeje powierzchnię obu kadłubów', () => {
  const { a, b } = slidePair(300);
  try {
    D._frameContacts = 0;
    D.collideEntities(a, b, 1 / 120, true);
    assert.ok(D._frameContacts > 0, 'burty muszą się stykać');
    assert.ok(a.hexGrid.shards.some((s) => (Number(s.heat) || 0) > 0), 'taranujący też się grzeje');
    assert.ok(b.hexGrid.shards.some((s) => (Number(s.heat) || 0) > 0));
    assert.ok(b.hexGrid.shards.every((s) => s.hp === s.maxHp), 'żar styku nie zadaje obrażeń');
  } finally {
    disposeHexBody(a);
    disposeHexBody(b);
  }
});

test('powolne dosunięcie się burtą nie żarzy blachy', () => {
  const { a, b } = slidePair(10);
  try {
    D._frameContacts = 0;
    D.collideEntities(a, b, 1 / 120, true);
    assert.ok(D._frameContacts > 0);
    assert.ok(a.hexGrid.shards.every((s) => !(Number(s.heat) > 0)));
    assert.ok(b.hexGrid.shards.every((s) => !(Number(s.heat) > 0)));
  } finally {
    disposeHexBody(a);
    disposeHexBody(b);
  }
});

test('żar to czysta prezentacja: stan fizyczny identyczny z kanałem wyłączonym', () => {
  const keys = ['heatGain', 'woundHeat', 'contactHeatRate'];
  const saved = Object.fromEntries(keys.map((k) => [k, C[k]]));
  const snapshot = (heatOn) => {
    for (const k of keys) C[k] = heatOn ? saved[k] : 0;
    const { a, b } = ramPair();
    try {
      // Słaba blacha: część heksów ginie, więc ścieżka brzegu rany też się wykonuje.
      for (const s of b.hexGrid.shards) s.hp = 3;
      for (let tick = 0; tick < 8; tick++) {
        D.collideEntities(a, b, 1 / 120, true);
        D.collideEntities(a, b, 1 / 120, false);
      }
      assert.ok(b.hexGrid.shards.some((s) => s.isDebris), 'scenariusz musi coś zniszczyć');
      if (heatOn) assert.ok(b.hexGrid.shards.some((s) => isAlive(s) && s.neighbors.some((n) => n.isDebris) && s.heat > 0));
      return JSON.stringify([
        a.x, a.y, a.vx, a.vy, a.angVel, b.x, b.y, b.vx, b.vy, b.angVel,
        b.hexGrid.shards.map((s) => [s.hp, s.active, s.deformation.x, s.deformation.y])
      ]);
    } finally {
      disposeHexBody(a);
      disposeHexBody(b);
    }
  };
  try {
    assert.equal(snapshot(true), snapshot(false));
  } finally {
    Object.assign(C, saved);
  }
});

test('rekord pary z asteroidą nie podszywa się pod kontakt kadłubowy', () => {
  const a = hull({ width: 320, height: 100, mass: 50000, vx: 400, x: 4 });
  const rock = hull({ width: 320, height: 100, mass: 900000, destructionMaterial: 'brittle' });
  try {
    D.collideEntities(a, rock, 1 / 120, true);
    assert.equal(
      D.hasHullContact(a, rock),
      false,
      'AI ustępuje destructorowi tylko przy metalu o metal — rekord CollisionFX tego nie zmienia'
    );
  } finally {
    disposeHexBody(a);
    disposeHexBody(rock);
  }
});

// --- Iskry: szew nie może być jaśniejszy od dawnego snopu, tylko dłuższy ---

function countSparks(emitFn) {
  const scene = new THREE.Scene();
  SparkSystem3D.init(scene);
  const original = SparkSystem3D.emit;
  const hits = [];
  SparkSystem3D.emit = (x, y) => { hits.push([x, y]); };
  try {
    emitFn();
  } finally {
    SparkSystem3D.emit = original;
    SparkSystem3D.dispose();
  }
  return hits;
}

test('szew dzieli budżet iskier między punkty, nie mnoży go przez ich liczbę', () => {
  const bounceForce = 400;
  const slideSpeed = 60;
  const points = new Float32Array(6 * 4);
  for (let p = 0; p < 6; p++) {
    points[p * 4] = p * 50;      // szew długi na 250 jednostek
    points[p * 4 + 1] = 0;
    points[p * 4 + 2] = 0;
    points[p * 4 + 3] = 1;
  }

  const burst = countSparks(() => {
    SparkSystem3D.grindingBurst(0, 0, 0, -1, 1, 0, bounceForce, slideSpeed, 0, 0);
  });
  const seam = countSparks(() => {
    SparkSystem3D.grindingSeam(points, 6, 1, 0, bounceForce, slideSpeed, 0, 0);
  });

  assert.ok(burst.length > 0);
  assert.equal(seam.length, burst.length, 'ten sam budżet iskier, inny rozkład');

  // Snop z centroidu siedzi wokół jednego punktu; szew rozkłada się na całej długości.
  const seamSpanX = Math.max(...seam.map((p) => p[0])) - Math.min(...seam.map((p) => p[0]));
  const burstSpanX = Math.max(...burst.map((p) => p[0])) - Math.min(...burst.map((p) => p[0]));
  assert.ok(seamSpanX > 200, `iskry muszą pokryć szew (rozpiętość ${seamSpanX})`);
  assert.ok(seamSpanX > burstSpanX * 0.5);
});

test('jeden punkt szwu spada z powrotem na dawny snop', () => {
  const points = new Float32Array([120, -40, 0, 1]);
  const seam = countSparks(() => {
    SparkSystem3D.grindingSeam(points, 1, 1, 0, 400, 60, 0, 0);
  });
  assert.ok(seam.length > 0);
  const cx = seam.reduce((sum, p) => sum + p[0], 0) / seam.length;
  assert.ok(Math.abs(cx - 120) < 200, 'fallback iskrzy w podanym punkcie');
});
