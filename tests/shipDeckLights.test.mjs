// Lampy pokładowe okrętów (src/data/shipDeckLights.js, generator scripts/lampy-pokladowe.mjs — prośba użytkownika
// 2026-11-11: „mini lampy oświetlające kadłub”): komplet kadłubów generatora, lampy na blasze sprite'a, 6–16 lamp
// (mniej tylko na bardzo małych kadłubach), `d` = odległość od rdzenia (fala rozruchu), rodzaje z listy, lampy z dala od
// lamp nawigacyjnych, dysz, wież, stref mostków i obudowy rdzenia.
import test from 'node:test';
import assert from 'node:assert/strict';

import { DECK_RULES, deckHullFeatures, deckHullList } from '../scripts/lampy-pokladowe.mjs';
import { DECK_LIGHT_KIND, SHIP_DECK_LIGHTS, shipDeckLightPoints } from '../src/data/shipDeckLights.js';

const HULLS = deckHullList();
const KINDS = new Set(Object.values(DECK_LIGHT_KIND));

// Dane kadłubów liczone raz (dekodowanie sprite'ów).
const FEATURES = new Map();
const featuresOf = (key) => {
  if (!FEATURES.has(key)) FEATURES.set(key, deckHullFeatures(key, HULLS.get(key)));
  return FEATURES.get(key);
};

// Progi strażnika (generator trzyma większe zapasy — opis w nagłówku scripts/lampy-pokladowe.mjs):
//   MIN_LAMPS / MAX_LAMPS — na kadłub; SMALL_MIN — kadłub krótszy niż DECK_RULES.smallHullWorld j. świata (≈ 120 j.:
//   wahadłowiec, prom rotacyjny, dron naprawczy — strefa mostka, obudowa rdzenia i dysze SIDE zajmują prawie cały pokład).
const MIN_LAMPS = 6;
const MAX_LAMPS = 16;
const SMALL_MIN = 4;
//   NAV_CLEAR — odstęp od lampy nawigacyjnej: 3 promienie lampy nawigacyjnej + promień lampy pokładowej.
const NAV_CLEAR = (f) => 3 * f.navR + f.r;
//   MAIN_CLEAR — od osi dyszy MAIN: pełna średnica wylotu (lampa nie leży w wylocie ani na jego wardze).
const MAIN_CLEAR = (f, e) => e.d;
//   SIDE_CLEAR — od osi dyszy SIDE: promień dzwonu przy skali klasy (bez zapasu generatora × 1,5) + r.
const SIDE_CLEAR = (f) => f.sideR / 1.5 + f.r;
//   TURRET_CLEAR — od środka gniazda (wieża, hangar): 75% obrysu wieży generatora, nie mniej niż sonda gniazda 14 px.
const TURRET_CLEAR = (f, type) => Math.max(14, 0.75 * f.turretPx(type));
//   SPACING — między lampami pokładowymi: max(5 r, 4% długości kadłuba w px PNG).
const SPACING = (f) => Math.max(5 * f.r, 0.04 * f.Lpx);

const dist = (ax, ay, bx, by) => Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);

test('każdy kadłub z listy generatora ma wpis (i nic poza nią), API zwraca lampy albo pustą tablicę', () => {
  assert.deepEqual(Object.keys(SHIP_DECK_LIGHTS).sort(), [...HULLS.keys()].sort());
  for (const key of HULLS.keys()) {
    const row = SHIP_DECK_LIGHTS[key];
    assert.ok(row.r >= 2 && Number.isFinite(row.r), `${key}: r ${row.r}`);
    assert.equal(shipDeckLightPoints(key), row.p, key);
  }
  assert.deepEqual(shipDeckLightPoints('nie_ma_takiego'), []);
  assert.ok(Object.isFrozen(SHIP_DECK_LIGHTS) && Object.isFrozen(DECK_LIGHT_KIND));
});

test('liczba lamp: 6–16 na kadłub, mniej tylko na bardzo małych kadłubach', () => {
  for (const key of HULLS.keys()) {
    const f = featuresOf(key);
    const n = SHIP_DECK_LIGHTS[key].p.length;
    const min = f.lengthWorld < DECK_RULES.smallHullWorld ? SMALL_MIN : MIN_LAMPS;
    assert.ok(n >= min && n <= MAX_LAMPS, `${key}: ${n} lamp (dopuszczalne ${min}–${MAX_LAMPS}, kadłub ${f.lengthWorld} j.)`);
  }
});

test('promień lampy pokładowej = 0,6–1,0 promienia lamp nawigacyjnych kadłuba', () => {
  for (const key of HULLS.keys()) {
    const f = featuresOf(key);
    const r = SHIP_DECK_LIGHTS[key].r;
    // Zaokrąglenie do 0,5 px — stąd 0,25 px luzu w dół.
    assert.ok(r >= 0.6 * f.navR - 0.25 && r <= f.navR, `${key}: r ${r}, r_nav ${f.navR}`);
  }
});

test('punkty: całkowite px, d ∈ [0, 1] wg odległości od reaktora, najdalsza ma 1, co najmniej jedna d ≤ 0,2, rodzaj z listy', () => {
  for (const key of HULLS.keys()) {
    const f = featuresOf(key);
    const p = SHIP_DECK_LIGHTS[key].p;
    // Odległość od krawędzi obudowy rdzenia (fala rozruchu wychodzi z obudowy).
    const ds = p.map(([x, y]) => Math.max(0, dist(x, y, f.core.x, f.core.y) - f.core.housing));
    const max = Math.max(...ds);
    p.forEach(([x, y, d, kind], i) => {
      assert.ok(Number.isInteger(x) && Number.isInteger(y), `${key}[${i}]: (${x}, ${y})`);
      assert.ok(d >= 0 && d <= 1, `${key}[${i}]: d ${d}`);
      assert.ok(Math.abs(d - ds[i] / max) <= 0.006, `${key}[${i}]: d ${d}, z rdzenia ${(ds[i] / max).toFixed(3)}`);
      assert.ok(KINDS.has(kind), `${key}[${i}]: rodzaj ${kind}`);
    });
    assert.ok(p.some(([, , d]) => d === 1), `${key}: brak lampy z d = 1`);
    assert.ok(p.some(([, , d]) => d <= 0.2), `${key}: brak lampy przy rdzeniu (d ≤ 0,2)`);
  }
});

test('lampy leżą na blasze: alfa > 127 pod lampą i w promieniu lampy (krzyż ±r)', () => {
  for (const key of HULLS.keys()) {
    const f = featuresOf(key);
    const { W, H, a } = f.m;
    const solid = (x, y) => {
      const xi = Math.floor(W / 2 + x);
      const yi = Math.floor(H / 2 + y);
      return xi >= 0 && yi >= 0 && xi < W && yi < H && a[yi * W + xi] === 1;
    };
    const R = Math.ceil(f.r);
    for (const [x, y] of SHIP_DECK_LIGHTS[key].p) {
      for (const [dx, dy] of [[0, 0], [R, 0], [-R, 0], [0, R], [0, -R]]) {
        assert.ok(solid(x + dx, y + dy), `${key}: (${x + dx}, ${y + dy}) poza kadłubem`);
      }
    }
  }
});

test('odstępy: od lamp nawigacyjnych, dysz MAIN i SIDE, wież i hangarów, między sobą', () => {
  for (const key of HULLS.keys()) {
    const f = featuresOf(key);
    const p = SHIP_DECK_LIGHTS[key].p;
    for (const [x, y] of p) {
      for (const n of f.nav) assert.ok(dist(x, y, n.x, n.y) >= NAV_CLEAR(f), `${key}: (${x}, ${y}) przy lampie nawigacyjnej (${n.x}, ${n.y})`);
      for (const e of f.mainNozzles) assert.ok(dist(x, y, e.x, e.y) >= MAIN_CLEAR(f, e), `${key}: (${x}, ${y}) przy dyszy MAIN (${e.x}, ${e.y})`);
      for (const e of f.sideNozzles) assert.ok(dist(x, y, e.x, e.y) >= SIDE_CLEAR(f), `${key}: (${x}, ${y}) przy dyszy SIDE (${e.x}, ${e.y})`);
      // Lampa nie na środku wieży (ani hangaru): poza obrysem gniazda.
      for (const h of f.hardpoints) assert.ok(dist(x, y, h.x, h.y) >= TURRET_CLEAR(f, h.type), `${key}: (${x}, ${y}) na gnieździe ${h.type} (${h.x}, ${h.y})`);
    }
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        assert.ok(dist(p[i][0], p[i][1], p[j][0], p[j][1]) >= SPACING(f), `${key}: lampy ${i} i ${j} za blisko`);
      }
    }
  }
});

test('poza strefami mostków i obudową rdzenia; kadłub z mostkiem ma lampy mostka', () => {
  for (const key of HULLS.keys()) {
    const f = featuresOf(key);
    const p = SHIP_DECK_LIGHTS[key].p;
    for (const [x, y] of p) {
      for (const z of f.bridges) {
        const dx = x - z.x;
        const dy = y - z.y;
        const u = dx * Math.cos(z.rot) + dy * Math.sin(z.rot);
        const v = -dx * Math.sin(z.rot) + dy * Math.cos(z.rot);
        assert.ok(Math.abs(u) > z.hw + f.r || Math.abs(v) > z.hh + f.r, `${key}: (${x}, ${y}) w strefie mostka`);
      }
      assert.ok(dist(x, y, f.core.x, f.core.y) >= f.core.housing + f.r, `${key}: (${x}, ${y}) na obudowie rdzenia`);
    }
    if (f.bridges.length) {
      assert.ok(p.filter((q) => q[3] === DECK_LIGHT_KIND.BRIDGE).length >= 2, `${key}: mniej niż 2 lampy mostka`);
    }
  }
});
