// DYM ZGNIOTU kadłuba w taranie (2026-10-15, prośba użytkownika: „mniejszy dym przy ciężkim zgniocie kadłuba (taran bez
// trafienia w zbiornik), żeby szarża prawie zawsze dymiła”; src/game/crushSmoke.js, klej w index.html, profil 'crush'
// w src/3d/explosions/explosionRecipes.js, opcja `power` wybuchu w explosionFx.js).
// node --test tests/crushSmoke.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];
const { HullBodies } = await import('../src/game/hullBodies.js');
const { CollisionFX } = await import('../src/vfx/collisionFx.js');
const { createReactorCoreGame } = await import('../src/game/reactorCoreGame.js');
const FT = await import('../src/game/fuelTank.js');
const CS = await import('../src/game/crushSmoke.js');
const R = await import('../src/3d/explosions/explosionRecipes.js');
const { makeBridgeShip, bridgeHullImage } = await import('./helpers/bridgeHulls.mjs');
const { readIndexHtml, sliceFunction } = await import('./helpers/indexSource.mjs');

const T = CS.CRUSH_SMOKE_TUNE;
const fake = (baseNodes) => ({ beamHull: { baseNodes } });

test('próg: część węzłów kadłuba w granicach (fregata ~40 węzłów → 12, duże → 24); rozmiar ∝ √węzłów z granicami', () => {
  assert.equal(CS.crushMinNodes(fake(40)), 12);
  assert.equal(CS.crushMinNodes(fake(843)), T.minNodes);
  assert.equal(CS.crushMinNodes(fake(10)), T.minFloor);
  assert.equal(CS.crushMinNodes({}), T.minNodes, 'bez kadłuba — próg bezwzględny');
  assert.equal(CS.crushSmokeSize(0), T.minSize);
  assert.equal(CS.crushSmokeSize(1e6), T.maxSize);
  const a = CS.crushSmokeSize(64), b = CS.crushSmokeSize(144);
  assert.ok(Math.abs(b / a - 1.5) < 1e-9 || a === T.minSize || b === T.maxSize, '√');
  assert.ok(T.maxSize < 228, 'mniejszy niż wybuch zbiornika pancernika');
});

test('licznik: okno, styk, odstęp; wolne straty i zgniot bez styku nie dymią', () => {
  const c = CS.createCrushSmoke({ ...T });
  const e = fake(843);
  const out = [];
  const emit = (en, x, y, n) => { out.push({ en, x, y, n }); return true; };
  // 24 straty w 0,1 s bez styku — nic.
  for (let i = 0; i < 24; i++) c.lost(e, 100 + i, 50, 1 + i * 0.004);
  c.step(1.1, emit);
  assert.equal(out.length, 0, 'bez styku kadłubów');
  // Z tym samym styku (styk po stratach — pierwszy krok zderzenia) — dym w środku strat.
  for (let i = 0; i < 24; i++) c.lost(e, 100 + i, 50, 2 + i * 0.004);
  c.contact(e, 2.1);
  c.step(2.1, emit);
  assert.equal(out.length, 1, 'ciężki zgniot w styku');
  assert.equal(out[0].n, 24);
  assert.ok(Math.abs(out[0].x - 111.5) < 1e-9 && out[0].y === 50, 'środek zgniecionych węzłów');
  // W odstępie — bez drugiego dymu.
  for (let i = 0; i < 30; i++) c.lost(e, 0, 0, 2.3 + i * 0.002);
  c.contact(e, 2.4);
  c.step(2.4, emit);
  assert.equal(out.length, 1, 'odstęp');
  // Po odstępie — znowu.
  for (let i = 0; i < 30; i++) c.lost(e, 0, 0, 3.2 + i * 0.002);
  c.contact(e, 3.3);
  c.step(3.3, emit);
  assert.equal(out.length, 2, 'po odstępie');
  // Wolne straty (otarcie): 10 na okno 0,25 s przez 2 s — nigdy próg w jednym oknie.
  for (let k = 0; k < 80; k++) { c.lost(e, 0, 0, 5 + k * 0.025); c.contact(e, 5 + k * 0.025); c.step(5 + k * 0.025, emit); }
  assert.equal(out.length, 2, 'otarcie nie dymi');
  // emit → false: odstęp nie liczy się od nieudanego dymu.
  const c2 = CS.createCrushSmoke({ ...T });
  let first = true;
  const out2 = [];
  const emit2 = (en, x, y, n) => { if (first) { first = false; return false; } out2.push(n); return true; };
  for (let i = 0; i < 24; i++) c2.lost(e, 0, 0, 1 + i * 0.001);
  c2.contact(e, 1.05); c2.step(1.05, emit2);
  for (let i = 0; i < 24; i++) c2.lost(e, 0, 0, 1.1 + i * 0.001);
  c2.contact(e, 1.15); c2.step(1.15, emit2);
  assert.equal(out2.length, 1, 'nieudany dym nie blokuje następnego');
  c.step(20, emit);
  assert.equal(c.live, 0, 'stany zwolnione po oknie');
  assert.equal(out.length, 2);
});

// Taran w Node na prawdziwym silniku belek, z klejem jak w grze (onNodeLost + CollisionFX → licznik, krok po każdym kroku).
const RG = createReactorCoreGame({});
function shipWithTank(key, x, y, angle) {
  const { def } = bridgeHullImage(key);
  const e = makeBridgeShip(HullBodies, key, x, y, angle);
  RG.attach(e, def.profile);
  FT.attachFuelTank(e, def.profile);
  return e;
}
function extent(e) {
  const s = e.beamHull.body.nodeStore, q = {};
  let lo = Infinity, hi = -Infinity, w = 0;
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    HullBodies.nodeWorld(e.beamHull, i, q);
    const a = (q.x - e.x) * Math.cos(e.angle) + (q.y - e.y) * Math.sin(e.angle);
    const b = -(q.x - e.x) * Math.sin(e.angle) + (q.y - e.y) * Math.cos(e.angle);
    if (a < lo) lo = a; if (a > hi) hi = a; if (Math.abs(b) > w) w = Math.abs(b);
  }
  return { lo, hi, w };
}
function ram(v0, thrust, vmax, secs) {
  const c = CS.createCrushSmoke({ ...T });
  const V = shipWithTank('battleship', 0, 0, 0);
  const VE = extent(V);
  const probe = shipWithTank('atlas', 0, 0, Math.PI / 2);
  const AE = extent(probe);
  HullBodies.release(probe);
  const atlas = shipWithTank('atlas', 0, -(VE.w + AE.hi + 120), Math.PI / 2);
  atlas.vy = v0;
  let simT = 0;
  const prevLost = HullBodies.onNodeLost;
  HullBodies.onNodeLost = (e, hull, u, v, x, y) => { if (e?.fuelTank) c.lost(e, x, y, simT); };
  const onC = (ev) => { if (ev.A?.fuelTank) c.contact(ev.A, simT); if (ev.B?.fuelTank) c.contact(ev.B, simT); };
  CollisionFX.on('grind', onC); CollisionFX.on('impact', onC);
  const puffs = [];
  const dt = 1 / 60;
  try {
    for (let k = 0; k < Math.round(secs / dt); k++) {
      if (atlas.vy < vmax) atlas.vy += thrust * dt;
      for (const e of [atlas, V, ...window.wrecks]) { e.x += e.vx * dt; e.y += e.vy * dt; e.angle += (e.angVel || 0) * dt; }
      simT = (k + 1) * dt;
      HullBodies.step(dt, [atlas, V, ...window.wrecks]);
      c.step(simT, (e, x, y, n) => { puffs.push({ who: e === V ? 'ofiara' : e === atlas ? 'atlas' : 'inny', t: simT, n, x, y }); return true; });
    }
  } finally {
    HullBodies.onNodeLost = prevLost;
    CollisionFX.off('grind', onC); CollisionFX.off('impact', onC);
    for (const e of [atlas, V, ...window.wrecks]) HullBodies.release(e);
    window.wrecks.length = 0;
  }
  return { puffs, V };
}

test('taran w Node: szarża w burtę pancernika dymi zgniotem ofiary; lekkie zderzenie 300 j/s nie dymi', () => {
  const sz = ram(2200, 1100, 3000, 1.0);
  const ofiara = sz.puffs.filter((p) => p.who === 'ofiara');
  assert.ok(ofiara.length >= 1, `szarża — dym zgniotu ofiary (${JSON.stringify(sz.puffs.map((p) => [p.who, +p.t.toFixed(2), p.n]))})`);
  assert.ok(ofiara[0].t < 0.5 && ofiara[0].n >= CS.crushMinNodes(sz.V), 'szybko po styku, ponad próg');
  assert.ok(ofiara.every((p, i) => i === 0 || p.t - ofiara[i - 1].t >= T.cooldown - 1e-9), 'odstęp dymów');
  const lk = ram(300, 0, 300, 1.4);
  assert.equal(lk.puffs.filter((p) => p.who === 'ofiara').length, 0, 'lekkie zderzenie nie dymi');
});

test('profil wybuchu „crush”: dużo dymu, słaby błysk, bez fali i wtórnych; mniejszy niż wybuch zbiornika pancernika', () => {
  const p = R.EXPLOSION_PROFILES[T.profile];
  assert.ok(p && p.gas === true, 'kula z gazu');
  assert.equal(p.shock, 0);
  assert.deepEqual([...p.secondaries], [0, 0]);
  assert.ok(p.smoke >= R.EXPLOSION_PROFILES.capital.smoke, 'dymu co najmniej jak wybuch okrętu');
  assert.ok(p.flash < R.EXPLOSION_PROFILES.escort.flash, 'słabszy błysk niż fregata');
  // kula: crush ≤ maxSize × fire < zbiornik pancernika (size ~228, profil capital)
  assert.ok(R.fireRadius(T.maxSize, p) < R.fireRadius(228, R.EXPLOSION_PROFILES.capital));
});

test('środek dymu: przesunięty od zgniotu ku środkowi okrętu, najwyżej do środka', () => {
  const o = CS.crushSmokeCenter({ x: 1000, y: 0 }, 0, 0, 100, {});
  assert.ok(Math.abs(o.x - T.inward * 100) < 1e-9 && o.y === 0, 'o inward × size');
  const near = CS.crushSmokeCenter({ x: 20, y: 0 }, 0, 0, 100, {});
  assert.equal(near.x, 20, 'najwyżej do środka okrętu');
  const pos = CS.crushSmokeCenter({ pos: { x: 0, y: -1000 } }, 0, 0, 100, {});
  assert.ok(Math.abs(pos.y + T.inward * 100) < 1e-9, 'encja z pos (gracz)');
  const none = CS.crushSmokeCenter({}, 5, 6, 100, {});
  assert.equal(none.x, 5); assert.equal(none.y, 6);
});

test('index.html: hak strat węzłów, styk z CollisionFX, ocena po sufitach punktów, filtr okrętów i wybuch „crush”', () => {
  const src = readIndexHtml();
  assert.match(src, /import \{ createCrushSmoke, crushSmokeSize, crushSmokeCenter, CRUSH_SMOKE_TUNE \} from "\.\/src\/game\/crushSmoke\.js"/);
  assert.match(src, /HullBodies\.onNodeLost = noteHullNodeLost;/);
  const lost = sliceFunction(src, 'function noteHullNodeLost(');
  assert.match(lost, /HullDamageEvents\.nodeLost\(entity, hull, u, v, x, y\)/, 'rozdarcia mapy ran zostają (rekord DMG_TEAR, RW-22)');
  assert.match(lost, /if \(entity\?\.fuelTank\) crushSmoke\.lost\(entity, x, y, HullBodies\.simTime\)/);
  assert.match(src, /CollisionFX\.on\('grind', _crushContact\);/);
  assert.match(src, /CollisionFX\.on\('impact', _crushContact\);/);
  const iCap = src.indexOf('enforceNpcHexIntegrityBalance();\n        // Dym zgniotu');
  const iStep = src.indexOf('stepCrushSmoke();', iCap);
  assert.ok(iCap > 0 && iStep > iCap && iStep - iCap < 200, 'dym zgniotu po sufitach punktów w kroku integralności');
  const emit = sliceFunction(src, 'function emitCrushSmoke(');
  assert.match(emit, /!SHIP_BLAST_TUNE\.crush \|\| !e \|\| e\.dead \|\| e\.destroyed \|\| e\.isWreck \|\| !e\.fuelTank/);
  assert.match(emit, /e\.fuelTank\.ruptured && t - e\.fuelTank\.rupturedAt < CRUSH_SMOKE_TUNE\.afterRupture/);
  assert.match(emit, /o\.size = crushSmokeSize\(nodes\)/);
  assert.match(emit, /crushSmokeCenter\(e, x, y, o\.size, o\)/);
  assert.match(emit, /o\.profile = CRUSH_SMOKE_TUNE\.profile/);
  assert.match(emit, /if \(!GameBlasts\.ready\) return false;/);
  assert.match(emit, /GameBlasts\.blast\(o\)/, 'wybuch okrętu bez zmiatania dronów (rekord EXPLOSION, RW-22)');
  assert.match(src, /const SHIP_BLAST_TUNE = \{[^}]*crush: true/);
});
