// Generator wieżowców miasta na grzbiecie okrętu (src/game/hullDesign/hullDesignTowers.js, docs/OPIS-miasto-3d.md):
// determinizm, bryły w rzucie budynku, lustro budynków na osi, światła tylko na ścianach (nigdy na dachu).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTower, mirrorTower, towerSizeClass, pointInBox, boxHalfAt, HD_TOWER_FAMILIES, HD_TOWER_TUNE, HD_TOWER_LIGHT
} from '../src/game/hullDesign/hullDesignTowers.js';

/** Odległość ze znakiem punktu od rzutu bryły na wysokości z (ośmiokąt z fazą). */
function sd2(b, x, y, z) {
  const q = boxHalfAt(b, z);
  const ax = Math.abs(x - b.x), ay = Math.abs(y - b.y);
  return Math.max(ax - q.hw, ay - q.hh, q.ch > 0 ? (ax + ay - (q.hw + q.hh - q.ch)) / Math.SQRT2 : -1e9);
}

/** Specyfikacje: wszystkie rodziny × rozmiary × ziarna (także budynki na osi). */
function specs() {
  const out = [];
  const sizes = [[8, 6, 14], [20, 12, 26], [36, 22, 48], [60, 30, 90], [90, 50, 150], [14, 14, 120], [120, 70, 60]];
  let seed = 11;
  for (const family of HD_TOWER_FAMILIES) {
    for (const [hw, hh, H] of sizes) {
      for (const sym of [false, true]) {
        for (const axis of ['x', 'y']) {
          seed = (seed * 1103515245 + 12345) >>> 0;
          out.push({ x: 100 + (seed % 50), y: sym ? 0 : -80 - (seed % 30), hw, hh, H, z0: (seed % 3) * 6, family, seed, axis, sym, face: [0, -1] });
        }
      }
    }
  }
  return out;
}

test('wieżowce: ten sam opis = ten sam budynek; każda rodzina daje bryły', () => {
  for (const s of specs()) {
    const a = buildTower(s), b = buildTower({ ...s });
    assert.deepEqual(a, b, `${s.family} ${s.hw}×${s.hh} ziarno ${s.seed}`);
    assert.ok(a.boxes.length >= 1, `${s.family} ${s.hw}×${s.hh}×${s.H}: bez brył`);
  }
});

test('wieżowce: bryły w rzucie budynku, podłoga ≥ z0, wierzch w wysokości (maszt ≤ +25%)', () => {
  for (const s of specs()) {
    const t = buildTower(s);
    const z0 = s.z0 ?? 0;
    for (const b of t.boxes) {
      assert.ok(Math.abs(b.x - s.x) + b.hw <= s.hw + 0.02, `${s.family}: bryła poza rzutem w x`);
      assert.ok(Math.abs(b.y - s.y) + b.hh <= s.hh + 0.02, `${s.family}: bryła poza rzutem w y`);
      assert.ok(b.z1 > b.z0 && b.z0 >= z0 - 1e-6, `${s.family}: zła wysokość bryły`);
      assert.ok(b.bat >= 0 && b.bat <= Math.min(b.hw, b.hh), `${s.family}: pochylenie większe niż rzut`);
      assert.ok(b.z1 <= z0 + s.H * 1.25 + 0.05, `${s.family} ${s.hw}×${s.hh}×${s.H}: wierzch ${b.z1} ponad ${z0 + s.H}`);
    }
    assert.ok(t.top >= z0 + s.H * 0.6, `${s.family} ${s.hw}×${s.hh}×${s.H}: budynek za niski (${t.top - z0})`);
  }
});

test('wieżowce: światła tylko na ścianach — przy płaszczyźnie ściany, w jej pasie wysokości, nigdy na dachu', () => {
  let n = 0;
  const kinds = new Set();
  for (const s of specs()) {
    const t = buildTower({ ...s, lights: 1.5 });
    for (const l of t.lights) {
      n++;
      kinds.add(l.k);
      for (const b of t.boxes) assert.ok(!pointInBox(b, l.x, l.y, l.z, -0.02), `${s.family}: światło wewnątrz bryły`);
      // przyczepione do ściany: jakaś bryła ma ścianę na tej wysokości (poniżej górnej krawędzi) tuż za światłem
      let wall = null;
      for (const b of t.boxes) {
        if (l.z < b.z0 - 0.1 || l.z > b.z1 - 0.25) continue;
        const d = sd2(b, l.x, l.y, l.z);
        if (d >= -0.02 && d <= HD_TOWER_TUNE.lightOff + 0.4) { wall = b; break; }
      }
      assert.ok(wall, `${s.family} ${s.hw}×${s.hh}×${s.H} ${s.sym ? 'sym' : ''}: światło (${l.x}, ${l.y}, ${l.z}) nie wisi na ścianie`);
      // normalna: bez składowej w dół; okno na ścianie nie świeci w górę mocniej niż pochylenie ściany
      assert.ok(l.nz >= -1e-6, 'światło świeci w dół');
      if (l.k === HD_TOWER_LIGHT.window) assert.ok(l.nz < 0.7, 'okno świeci w górę jak z dachu');
    }
  }
  assert.ok(n > 2000, `za mało świateł w próbie (${n})`);
  for (const k of [HD_TOWER_LIGHT.window, HD_TOWER_LIGHT.seam, HD_TOWER_LIGHT.base, HD_TOWER_LIGHT.beacon]) assert.ok(kinds.has(k), `brak rodzaju świateł ${k}`);
});

test('wieżowce: budynek na osi (sym) jest w lustrze y — bryły i światła', () => {
  const key = (b) => `${b.x.toFixed(2)}|${Math.abs(b.y).toFixed(2)}|${b.hw.toFixed(2)}|${b.hh.toFixed(2)}|${b.z0.toFixed(2)}|${b.z1.toFixed(2)}|${b.mat}`;
  for (const s of specs().filter((q) => q.sym)) {
    const t = buildTower(s);
    const count = new Map();
    for (const b of t.boxes) {
      const k = key(b);
      count.set(k, (count.get(k) || 0) + (Math.abs(b.y) < 0.01 ? 2 : 1));
    }
    for (const [k, c] of count) assert.equal(c % 2, 0, `${s.family} ${s.axis} ${s.hw}×${s.hh}: bryła bez pary w lustrze ${k}`);
    const lk = (l) => `${l.x.toFixed(2)}|${Math.abs(l.y).toFixed(2)}|${l.z.toFixed(2)}|${l.k}`;
    const lc = new Map();
    for (const l of t.lights) lc.set(lk(l), (lc.get(lk(l)) || 0) + (Math.abs(l.y) < 0.01 ? 2 : 1));
    for (const [k, c] of lc) assert.equal(c % 2, 0, `${s.family} ${s.axis}: światło bez pary w lustrze ${k}`);
  }
});

test('wieżowce: odbicie burty, klasy wielkości, gęstość świateł 0 — bez świateł', () => {
  const s = { x: 0, y: -120, hw: 40, hh: 25, H: 80, family: 'stepped', seed: 7 };
  const t = buildTower(s), m = mirrorTower(t);
  assert.equal(m.boxes.length, t.boxes.length);
  m.boxes.forEach((b, i) => assert.equal(b.y, -t.boxes[i].y));
  m.lights.forEach((l, i) => { assert.equal(l.y, -t.lights[i].y); assert.equal(l.ny, -t.lights[i].ny); });
  assert.equal(buildTower({ ...s, lights: 0 }).lights.length, 0);
  assert.equal(towerSizeClass(5, 5, 10), 0);
  assert.equal(towerSizeClass(20, 15, 30), 1);
  assert.equal(towerSizeClass(35, 30, 40), 2);
  assert.equal(towerSizeClass(70, 60, 50), 3);
  // pusty opis — pusty budynek
  assert.equal(buildTower({ x: 0, y: 0, hw: 0, hh: 5, H: 10 }).boxes.length, 0);
});
