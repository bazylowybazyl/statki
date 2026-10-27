// Kontenery-łup K1 (docs/PROPOZYCJA-kontenery-lup.md): podział ładunku, zrzut, dryf, czas życia, pełna pula,
// wiązka i chwyt; sprzęt gniazda ZBIÓRKA (src/data/lootGear.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOOT_TUNE, LOOT_FLAG, createLootContainers, planLootSpill, spillLootCargo, stepLootContainers, nearestLootD2
} from '../src/game/lootContainers.js';
import {
  LOOT_GEAR, lootGearOptionsFor, lootGearFits, mountedLootGear, lootGearParams
} from '../src/data/lootGear.js';
import { RESOURCES } from '../src/data/resources.js';
import { cargoResourceKey } from '../src/data/cargoContainers.js';
import { PIRACY_MODEL } from '../src/game/traffic/piracy.js';

const DT = 1 / 60;

function spec(over = {}) {
  return { x: 1_000_000, y: -2_000_000, vx: 120, vy: 0, angle: 0, length: 540, width: 200, cargo: { steel: 380 }, mass: 380, seed: 77, ...over };
}

function sumUnits(st) {
  let n = 0;
  for (let i = 0; i < st.count; i++) n += st.units[i];
  return n;
}

test('przetrwa 55% (stała łupu piratów), paczki z klasy ładowni, ostatnia bierze resztę', () => {
  assert.equal(LOOT_TUNE.survive, PIRACY_MODEL.lootRecovery);
  const plan = planLootSpill({ steel: 380 }, 380);
  assert.equal(plan.length, LOOT_TUNE.piecesByClass.bulk);
  const total = plan.reduce((s, p) => s + p.units, 0);
  assert.equal(total, Math.floor(380 * LOOT_TUNE.survive));
  for (const p of plan) assert.ok(Number.isInteger(p.units) && p.units >= 1);
  // Mały ładunek: klasa van.
  assert.equal(planLootSpill({ ice: 40 }, 40).length, LOOT_TUNE.piecesByClass.van);
  // Puste i nieznane towary — nic.
  assert.deepEqual(planLootSpill({}, 0), []);
  assert.deepEqual(planLootSpill({ nie_ma_takiego: 50 }, 50), []);
});

test('urobek z kilku rud: każdy towar co najmniej jedna paczka, sumy całe', () => {
  const cargo = { iron_ore: 600, nickel_ore: 200, platinum_ore: 12 };
  const plan = planLootSpill(cargo, 812);
  const by = {};
  for (const p of plan) by[p.res] = (by[p.res] || 0) + p.units;
  for (const [id, n] of Object.entries(cargo)) assert.equal(by[id], Math.floor(n * LOOT_TUNE.survive), id);
  assert.ok(plan.filter((p) => p.res === 'platinum_ore').length >= 1);
});

test('zrzut deterministyczny z numeru kursu; pęd wraku dziedziczony, rozrzut od wybuchu', () => {
  const a = createLootContainers();
  const b = createLootContainers();
  spillLootCargo(a, spec());
  spillLootCargo(b, spec());
  assert.equal(a.count, b.count);
  for (let i = 0; i < a.count; i++) {
    assert.equal(a.x[i], b.x[i]);
    assert.equal(a.vy[i], b.vy[i]);
  }
  const c = createLootContainers();
  spillLootCargo(c, spec({ seed: 78 }));
  assert.notEqual(a.x[0], c.x[0], 'inny kurs — inny rozrzut');
  let meanVx = 0;
  for (let i = 0; i < a.count; i++) {
    meanVx += a.vx[i] / a.count;
    // W obrysie statku (± 0,3 długości, ± 0,25 szerokości).
    assert.ok(Math.abs(a.x[i] - 1_000_000) <= 0.3 * 540 + 1e-6);
    const rel = Math.hypot(a.vx[i] - 120, a.vy[i]);
    assert.ok(rel >= LOOT_TUNE.burstMin - 1e-3 && rel <= LOOT_TUNE.burstMax + 1e-3, `pęd ${rel}`);
  }
  assert.ok(Math.abs(meanVx - 120) < LOOT_TUNE.burstMax, 'średnio z prędkością wraku');
  assert.equal(sumUnits(a), Math.floor(380 * LOOT_TUNE.survive));
});

test('dryf zwalnia po 20 s, paczka żyje ~5 min, dalej niż 50 km przepada', () => {
  const st = createLootContainers();
  spillLootCargo(st, spec({ vx: 600 }));
  const env = { px: 1_000_000, py: -2_000_000, gear: null };
  for (let t = 0; t < 60; t += DT) stepLootContainers(st, DT, env);
  for (let i = 0; i < st.count; i++) assert.ok(Math.hypot(st.vx[i], st.vy[i]) < 600, 'zwolniła');
  const n = st.count;
  assert.ok(n > 0);
  // Gracz jedzie za paczkami — despawn odległości nie zadziała, tylko czas.
  for (let t = 60; t < LOOT_TUNE.ttl * 1.2; t += 0.5) {
    if (st.count) { env.px = st.x[0]; env.py = st.y[0]; }
    stepLootContainers(st, 0.5, env);
  }
  assert.equal(st.count, 0, 'po czasie życia');
  assert.equal(st.stats.expired, n);
  const far = createLootContainers();
  spillLootCargo(far, spec());
  stepLootContainers(far, DT, { px: 0, py: 0, gear: null });
  assert.equal(far.count, 0, 'za daleko od gracza');
});

test('pełna pula: dokleja do najbliższej paczki tego samego towaru, inaczej zastępuje najkrótsze życie', () => {
  const st = createLootContainers(4);
  spillLootCargo(st, spec({ cargo: { steel: 60 }, mass: 60, seed: 1 }));
  spillLootCargo(st, spec({ cargo: { steel: 60 }, mass: 60, seed: 2 }));
  assert.equal(st.count, 4);
  const before = sumUnits(st);
  spillLootCargo(st, spec({ cargo: { steel: 60 }, mass: 60, seed: 3 }));
  assert.equal(st.count, 4);
  assert.equal(sumUnits(st), before + Math.floor(60 * LOOT_TUNE.survive));
  assert.ok(st.stats.merged >= 1);
  spillLootCargo(st, spec({ cargo: { chips: 40 }, mass: 16, seed: 4 }));
  assert.equal(st.count, 4);
  assert.ok(st.stats.evicted >= 1);
});

function tractorEnv(st, over = {}) {
  const hold = { cargo: {}, free: 1e9, ...over.hold };
  const env = {
    px: st.x[0] + 1500, py: st.y[0], pvx: 0, pvy: 0, shipSpeed: 0, cx: 0, cy: 0,
    gear: lootGearParams('atlas', 'loot_tractor'),
    visible: null,
    free: () => hold.free,
    take: (key, units) => {
      const fit = Math.min(units, Math.floor(hold.free / RESOURCES[key].mass));
      hold.cargo[key] = (hold.cargo[key] || 0) + fit;
      hold.free -= fit * RESOURCES[key].mass;
      return fit;
    },
    collected: 0,
    onCollect: () => { env.collected++; },
    ...over.env
  };
  env.cx = env.px; env.cy = env.py;
  return { env, hold };
}

test('wiązka: ściąga paczki w zasięgu do luku i wkłada je do ładowni; bez sprzętu nic', () => {
  const bare = createLootContainers();
  spillLootCargo(bare, spec({ vx: 0 }));
  const none = tractorEnv(bare, { env: { gear: null } });
  for (let t = 0; t < 30; t += DT) stepLootContainers(bare, DT, none.env);
  assert.equal(none.env.collected, 0, 'D15: bez sprzętu nie da się zbierać');
  assert.equal(bare.count, LOOT_TUNE.piecesByClass.bulk);
  const st = createLootContainers();
  spillLootCargo(st, spec({ vx: 0 }));
  const total = sumUnits(st);
  const { env, hold } = tractorEnv(st);
  let tractored = 0;
  for (let t = 0; t < 120 && st.count; t += DT) {
    stepLootContainers(st, DT, env);
    for (let i = 0; i < st.count; i++) if (st.flags[i] & LOOT_FLAG.TRACTOR) tractored++;
  }
  assert.equal(st.count, 0, 'wszystkie zebrane');
  assert.equal(hold.cargo.steel, total);
  assert.ok(tractored > 0, 'flaga wiązki do obrazu');
  assert.ok(env.collected > 0);
});

test('wiązka puszcza przy szybkim locie, nie widzi paczek w mgle, łapie najwyżej `targets` naraz', () => {
  const st = createLootContainers();
  spillLootCargo(st, spec({ vx: 0 }));
  const fast = tractorEnv(st, { env: { shipSpeed: 450 } });
  for (let t = 0; t < 20; t += DT) stepLootContainers(st, DT, fast.env);
  assert.equal(fast.env.collected, 0);
  const fog = tractorEnv(st, { env: { visible: () => false } });
  for (let t = 0; t < 20; t += DT) stepLootContainers(st, DT, fog.env);
  assert.equal(fog.env.collected, 0);
  // Świeży zrzut (poprzednie fazy rozniosły paczki poza zasięg).
  const fresh = createLootContainers();
  spillLootCargo(fresh, spec({ vx: 0 }));
  const { env } = tractorEnv(fresh);
  stepLootContainers(fresh, DT, env);
  let flagged = 0;
  for (let i = 0; i < fresh.count; i++) if (fresh.flags[i] & LOOT_FLAG.TRACTOR) flagged++;
  assert.equal(flagged, env.gear.targets);
});

test('pełna ładownia: chwyt częściowy, reszta wisi przy luku; paczki, z której nic nie wejdzie, wiązka nie bierze', () => {
  const st = createLootContainers();
  spillLootCargo(st, spec({ vx: 0, cargo: { steel: 100 }, mass: 100 }));
  const { env, hold } = tractorEnv(st, { hold: { free: 20 } });
  for (let t = 0; t < 60; t += DT) stepLootContainers(st, DT, env);
  assert.equal(hold.cargo.steel, 20, 'weszło tyle, ile ładowni (cargoCap 20 t)');
  assert.ok(st.count > 0, 'reszta dryfuje');
  assert.equal(sumUnits(st), Math.floor(100 * LOOT_TUNE.survive) - 20);
  let tractored = 0;
  stepLootContainers(st, DT, env);
  for (let i = 0; i < st.count; i++) if (st.flags[i] & LOOT_FLAG.TRACTOR) tractored++;
  assert.equal(tractored, 0, 'pełna ładownia — wiązka nie trzyma nowych');
});

test('krok bez alokacji: 10 tys. kroków z pełną pulą i wiązką nie rośnie sterta', () => {
  const st = createLootContainers();
  for (let s = 0; s < 40; s++) spillLootCargo(st, spec({ seed: s, vx: 0, cargo: { steel: 900 }, mass: 900 }));
  const { env } = tractorEnv(st, { hold: { free: 0.5 } });
  env.take = () => 0;
  for (let i = 0; i < 200; i++) stepLootContainers(st, DT, env);
  global.gc?.();
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 10_000; i++) stepLootContainers(st, DT, env);
  const h1 = process.memoryUsage().heapUsed;
  assert.ok(h1 - h0 < 2_000_000, `sterta +${h1 - h0} B`);
  assert.ok(Number.isFinite(nearestLootD2(st, env.px, env.py)));
});

test('gniazdo ZBIÓRKA: opcje kadłuba, domyślna wiązka Atlasa, drony czekają na K3', () => {
  assert.deepEqual(lootGearOptionsFor('atlas'), ['loot_tractor', 'loot_drones']);
  assert.deepEqual(lootGearOptionsFor('frigate'), ['loot_tractor']);
  assert.deepEqual(lootGearOptionsFor('nieznany'), ['loot_tractor']);
  assert.equal(mountedLootGear('atlas', undefined), 'loot_tractor', 'D16: Atlas fabrycznie z wiązką');
  assert.equal(mountedLootGear('atlas', null), null, 'puste gniazdo');
  assert.equal(mountedLootGear('frigate', undefined), null, 'fregata bez sprzętu');
  assert.equal(mountedLootGear('frigate', 'loot_tractor'), 'loot_tractor');
  assert.equal(mountedLootGear('frigate', 'loot_drones'), null, 'drony tylko z zatoką');
  assert.equal(LOOT_GEAR.loot_drones.ready, false);
  assert.equal(lootGearFits('atlas', 'loot_drones'), false, 'drony — K3');
  const p = lootGearParams('atlas', 'loot_tractor');
  assert.equal(p.kind, 'tractor');
  assert.equal(p.range, 3600);
  assert.ok(lootGearParams('frigate', 'loot_tractor').range < p.range);
  assert.equal(lootGearParams('atlas', 'loot_drones'), null);
  assert.equal(cargoResourceKey(-1), null);
});
