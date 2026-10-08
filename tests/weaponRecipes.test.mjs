// Zadanie 17-C: receptury efektów broni z dema bronie-webgpu (src/3d/weapons/recipes.js) —
// każda z 27 broni ma recepturę, receptury idą bez Math.random gry (fxRandom) i bez alokacji na
// strzał / trafienie (paczki przez budowniczego puli), zdarzenia opóźnione bez domknięć.
// node --test tests/weaponRecipes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { GpuFx } from '../src/3d/weapons/gpuFx.js';
import { RECIPES, runAfter, burnStep, droneBlast, cheapMuzzle, cheapImpact, createChargeState, AFTER } from '../src/3d/weapons/recipes.js';
import { WEAPON_FX, WEAPON_FX_IDS } from '../src/3d/weapons/weaponFxTable.js';
import { FxPoolOrigin } from '../src/3d/fx/gpuPoolOrigin.js';
import { LightGrid } from '../src/3d/fx/lightGrid.js';
import { FxLights } from '../src/3d/fx/fxLights.js';
import { createTile2DTexture } from '../src/3d/fx/noise.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';

const fx = new GpuFx({ origin: new FxPoolOrigin({ name: 'tstRcp' }), noise: createTile2DTexture(32), grid: new LightGrid({ name: 'tstRcpGrid' }) });
const lights = new FxLights();
// Zdarzenia opóźnione do rekordów z puli (atrapa bez alokacji — test alokacji receptur).
const afterPool = Array.from({ length: 64 }, () => ({ kind: 0, a0: 0, a1: 0, a2: 0, a3: 0, a4: 0, a5: 0, ref: null }));
const after = [];
let shakes = 0;
const ctx = {
  fx, lights,
  time: 0,
  after(delay, kind, a0, a1, a2, a3, a4, a5, ref) {
    if (after.length >= 64) return;
    const e = afterPool[after.length];
    e.kind = kind; e.a0 = a0; e.a1 = a1; e.a2 = a2; e.a3 = a3; e.a4 = a4; e.a5 = a5; e.ref = ref;
    after.push(e);
  },
  shake() { shakes++; },
  stamp() {},
  burn() {},
  hullInside() { return true; },
  ricochet() {}
};
const bursts = () => fx.poolList.reduce((a, p) => a + p.burstCount, 0);
const resetPools = () => { for (const p of fx.poolList) { p.burstCount = 0; p.total = 0; p.head = 0; p.wrapped = false; } lights.clear(); after.length = 0; };
const m = { x: 6_000_100, y: -2_000_050, angle: 0.7, scale: 1.0, density: 1 };
const hit = { x: 6_000_400, y: -2_000_300, nx: -0.6, ny: 0.8 };
const p = { x: 6_000_400, y: -2_000_300, vx: 900, vy: -300, rvx: 900, rvy: -300, power: 1, flakR: 170, style: 0, r: 2, g: 1, b: 0.5, width: 6, len: 16, flyAcc: 1e4 };
const hull = { x: 6_000_300, y: -2_000_200, angle: 0.2 };
const wOf = (id) => ({ id, def: MASTER_WEAPONS[id], size: MASTER_WEAPONS[id].size, fx: WEAPON_FX[id].fx });

function runAll() {
  for (const id of WEAPON_FX_IDS) {
    const w = wOf(id);
    const R = RECIPES[w.fx];
    if (R.preFire) R.preFire(ctx, m, w);
    if (R.muzzle) R.muzzle(ctx, m, w);
    if (R.charge) R.charge(ctx, m, 0.6, 1 / 60, createChargeState());
    if (R.fly) R.fly(ctx, p, m.x, m.y, m.x + 400, m.y + 100);
    if (R.emit) { R.emit(ctx, m, hit, 1, 1 / 60, hull); R.emit(ctx, m, null, 0.5, 1 / 60, null); }
    if (R.impact) {
      if (R.beam) R.impact(ctx, hull, hit);
      else R.impact(ctx, p, hull, hit);
    }
    if (R.kerf) R.kerf(ctx, p, hull);
    if (R.exit) R.exit(ctx, p, hull);
    if (R.stuck) R.stuck(ctx, p, hull);
    if (R.burst) R.burst(ctx, hit.x, hit.y, 270);
  }
  for (let i = 0; i < after.length; i++) runAfter(ctx, after[i]);
  after.length = 0;
  burnStep(ctx, { x: hit.x, y: hit.y, nx: 0, ny: -1, age: 0.3, dur: 2.6, power: 0.9, pal: 'armata', seed: 3 }, 1 / 60);
  droneBlast(ctx, hit.x, hit.y, 42);
  cheapMuzzle(ctx, m, 2, 1, 0.5);
  cheapImpact(ctx, hit.x, hit.y, 2, 1, 0.5, 24);
}

test('27 broni + 3 warianty specjalne + Lanca M / L: rodzina ma recepturę — wylot albo wiązka, pocisk (poza wiązkami), trafienie', () => {
  assert.equal(WEAPON_FX_IDS.length, 32);
  for (const id of WEAPON_FX_IDS) {
    const R = RECIPES[WEAPON_FX[id].fx];
    assert.ok(R, `${id}: brak receptury ${WEAPON_FX[id].fx}`);
    const def = MASTER_WEAPONS[id];
    if (def.category === 'beam') {
      assert.ok(R.beam, `${id}: wiązka bez konfiguracji`);
      assert.ok(R.emit || R.impact, `${id}: wiązka bez efektu trafienia`);
    } else {
      assert.ok(R.muzzle, `${id}: brak wylotu`);
      const conf = R.projectile(def.size);
      assert.ok(Number.isFinite(conf.style) && conf.width > 0 && conf.len > 0 && conf.color.length === 3, `${id}: styl pocisku`);
      assert.ok(R.impact, `${id}: brak trafienia`);
    }
  }
  assert.ok(RECIPES.hexlance.charge && RECIPES.mjolnir.charge && RECIPES.valkyrie.charge, 'ładowanie railgunów');
  assert.ok(RECIPES.hexlance.kerf && RECIPES.hexlance.exit && RECIPES.mjolnir.exit && RECIPES.valkyrie.stuck, 'rzaz, wyjście, zakleszczenie (18)');
  assert.ok(RECIPES.flak.burst, 'pęknięcie flaku');
});

test('receptury wysyłają paczki i światła; zdarzenia opóźnione bez domknięć', () => {
  resetPools();
  runAll();
  assert.ok(bursts() > 500, `paczek ${bursts()}`);
  assert.ok(lights.flashes > 30, `błysków ${lights.flashes}`);
  assert.ok(shakes > 10);
  // zdarzenia opóźnione: liczby + encja (bez funkcji)
  resetPools();
  RECIPES.tempest.preFire(ctx, m);
  RECIPES.tempest.muzzle(ctx, m, wOf('railgun_mk1'));
  RECIPES.tempest.impact(ctx, p, hull, hit);
  RECIPES.yamato.impact(ctx, p, hull, hit);
  const kinds = new Set(after.map((e) => e.kind));
  for (const k of [AFTER.TEMPEST_COIL, AFTER.TEMPEST_TAIL, AFTER.HULL_ARCS, AFTER.YAMATO_SECONDARY]) assert.ok(kinds.has(k), `rodzaj ${k}`);
  for (const e of after) for (const v of Object.values(e)) assert.notEqual(typeof v, 'function');
  const src = readFileSync(new URL('../src/3d/weapons/recipes.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /ctx\.after\([^)]*=>/, 'zdarzenie opóźnione z domknięciem');
  resetPools();
});

test('bez Math.random w modułach broni (skan źródeł i szpieg w biegu)', () => {
  for (const f of ['recipes.js', 'gpuFx.js', 'projectiles.js', 'trails.js', 'beams.js', 'weaponFx.js', 'weaponFxTable.js']) {
    const src = readFileSync(new URL(`../src/3d/weapons/${f}`, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(src, /Math\.random/, f);
  }
  const saved = Math.random;
  let calls = 0;
  Math.random = () => { calls++; return saved(); };
  try {
    resetPools();
    for (let i = 0; i < 5; i++) runAll();
  } finally {
    Math.random = saved;
  }
  assert.equal(calls, 0, 'receptury nie mogą zużywać Math.random gry (sekwencja losowań rozgrywki)');
  resetPools();
});

const newSpaceUsed = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space').space_used_size;
// Łańcuch budowniczego paczki nie alokuje (metody < 27 B bajtkodu — V8 wkleja je zawsze). Zostaje
// pakowanie liczb double przez V8 w wywołaniach NIEwklejonych z dużej receptury (błyski FxLights,
// zdarzenia opóźnione, pomocniki punktów): ~0,1–0,3 KB na bogaty wylot / trafienie. Strażnik łapie
// powrót do opcji-obiektów dema (~1,5 KB na tę serię; dziś ~0,6 KB).
test('wylot i trafienie bez alokacji obiektów na strzał (po rozgrzewce JIT)', () => {
  const w = wOf('armata_mk1');
  const shot = () => {
    if (fx.add.burstCount > 1800 || fx.spark.burstCount > 1800 || fx.smoke.burstCount > 1800) resetPools();
    if (lights.flashes > 400) lights.clear();
    RECIPES.armata.muzzle(ctx, m, w);
    RECIPES.vulcan.impact(ctx, p, hull, hit);
    RECIPES.tempest.muzzle(ctx, m, wOf('railgun_mk1'));
    after.length = 0;
  };
  for (let i = 0; i < 20000; i++) shot();
  let best = Infinity;
  for (let attempt = 0; attempt < 5; attempt++) {
    const before = newSpaceUsed();
    for (let i = 0; i < 2000; i++) shot();
    const d = newSpaceUsed() - before;
    if (d >= 0 && d < best) best = d;
  }
  // 2000 × (armata + vulcan + tempest) ≈ 100 paczek na iterację
  assert.ok(best < 2000 * 800, `alokacja ${best} B na 2000 serii strzałów (${(best / 2000).toFixed(0)} B na serię)`);
  resetPools();
});
