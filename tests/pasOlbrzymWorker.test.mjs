// Olbrzymy pasa w workerze renderu (2026-10-30): worker dokładał do `giants.entries` samo { id, giant }, a obraz pasa
// liczy widoczność i soczewkę skoku z x, y, halfX, halfY wpisu — NaN, więc w trybie worker (domyślnym) olbrzymy nigdy
// się nie rysowały, a kolizje strony działały (niewidoczna skała). Wpis budują strona i worker jedną funkcją.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildGiantPlan, giantEntryFields, GIANT_PRESETS } from '../src/game/asteroidGiants.js';
import { BeltGiants } from '../src/game/asteroidBeltGiants.js';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('giantEntryFields: środek i półosie z planu, promień obrysu — te same pola co wpis strony (BeltGiants)', () => {
  const sites = Object.keys(GIANT_PRESETS).map((id, i) => ({ id, seed: 11 + i, x: 1.6e6 + i * 4e5, y: -2e5 + i * 1e5 }));
  const page = new BeltGiants({ field: null, sunX: 0, sunY: 0, au: 42253.52, sites });
  for (const e of page.entries) {
    const f = giantEntryFields(buildGiantPlan(e.id, e.seed), e.site.x, e.site.y);
    for (const k of ['x', 'y', 'halfX', 'halfY', 'radius']) {
      assert.ok(Number.isFinite(f[k]), `${e.id}: ${k} skończone`);
      assert.equal(f[k], e[k], `${e.id}: ${k} jak na stronie`);
    }
    assert.equal(f.halfX, f.plan.half[0]);
    assert.equal(f.halfY, f.plan.half[1]);
  }
});

test('obraz pasa czyta z wpisu olbrzyma tylko pola, które ma wpis workera (widoczność, soczewka skoku)', () => {
  const belt = src('src/3d/asteroids/asteroidBelt.js');
  const body = (name) => {
    const i = belt.indexOf(`\n  ${name}(`);
    assert.ok(i >= 0, name);
    const j = belt.indexOf('\n  }\n', i);
    return belt.slice(i, j);
  };
  const used = new Set();
  for (const name of ['_lensGiants', '_giantLensed', '_updateGiants']) {
    for (const m of body(name).matchAll(/\be\.([A-Za-z_]\w*)/g)) used.add(m[1]);
  }
  // wpis workera: { id, ...giantEntryFields(plan, x, y), giant, view }
  const plan = buildGiantPlan('warren', 3);
  const entry = { id: 'warren', ...giantEntryFields(plan, 1e6, 2e6), giant: {}, view: null };
  for (const k of used) assert.ok(k in entry, `pas czyta e.${k} — wpis workera go nie ma`);
  assert.ok(used.has('x') && used.has('halfX'), 'strażnik widzi odczyty widoczności');
  // widoczność z kadru przy olbrzymie: liczba, nie NaN
  const v = { x: entry.x + 1000, y: entry.y - 500 };
  const vis = Math.abs(entry.x - v.x) < 8000 * 1.5 + entry.halfX && Math.abs(entry.y - v.y) < 2000 * 1.5 + entry.halfY;
  assert.equal(vis, true);
});

test('worker renderu buduje wpis olbrzyma przez giantEntryFields (jak strona), nie samo { id, giant }', () => {
  const w = src('src/render/render.worker.js');
  assert.match(w, /\{ GiantRock, giantEntryFields \}/, 'setBelt bierze giantEntryFields z modułu olbrzymów');
  const i = w.indexOf('function addGiant(m)');
  assert.ok(i >= 0);
  const fn = w.slice(i, w.indexOf('\n  }\n', i));
  assert.match(fn, /\.\.\.st\.giantEntryFields\(m\.plan, m\.x, m\.y\)/);
  assert.doesNotMatch(fn, /push\(\{ id: m\.id, giant: /);
  assert.match(src('src/game/asteroidBeltGiants.js'), /\.\.\.giantEntryFields\(plan, s\.x, s\.y\)/, 'strona — ta sama funkcja');
});
