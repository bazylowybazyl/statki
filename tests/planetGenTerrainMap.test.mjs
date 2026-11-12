// Mapa terenu (src/3d/planetGen/planetGenTerrainMap.js) — trzeci poziom szczegółowości planety: powtarzalność
// z ziarna, rzeka z zakolami przez całą mapę, klasy pokrycia, warstwy bez wartości nieskończonych.
// node --test tests/planetGenTerrainMap.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  generateTerrainMap, simulateMeanders, TERRAIN_COVER, TERRAIN_MAP_BIOMES, TERRAIN_RIVERS, TERRAIN_VEGETATION
} from '../src/3d/planetGen/planetGenTerrainMap.js';
import { makeRng } from '../src/3d/planetGen/planetGenRng.js';

// mała mapa: 256 tekseli, 5 km (teksel ~20 m jak w demie), stały zegar (czasy w statystykach nie wchodzą do wyniku)
const small = (seed) => generateTerrainMap({ seed, size: 256, extentKm: 5, now: () => 0 });
const sum = (a) => { let h = 2166136261; for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 16777619); return h >>> 0; };

test('mapa terenu: ten sam wynik z tego samego ziarna, inny z innego', () => {
  const a = small(3);
  const b = small(3);
  const c = small(4);
  assert.equal(sum(a.albedo), sum(b.albedo));
  assert.equal(sum(a.cover), sum(b.cover));
  assert.notEqual(sum(a.albedo), sum(c.albedo));
  assert.equal(a.size, 256);
  assert.ok(Math.abs(a.cellM - 5000 / 256) < 1e-9);
  assert.deepEqual(TERRAIN_MAP_BIOMES, ['tajga']);
  assert.throws(() => generateTerrainMap({ biome: 'nie-ma', size: 64, extentKm: 2 }), /nieznany biom/);
});

test('mapa terenu: rzeka przecina mapę, ma zakola; las dominuje, są woda i otwarty teren', () => {
  let rivers = 0;
  for (const seed of [1, 2, 5]) {
    const m = small(seed);
    const n = m.size;
    const count = new Array(6).fill(0);
    for (let i = 0; i < m.cover.length; i++) count[m.cover[i]]++;
    const share = count.map((v) => v / m.cover.length);
    assert.ok(share[TERRAIN_COVER.FOREST] > 0.35, `ziarno ${seed}: udział lasu ${share[TERRAIN_COVER.FOREST].toFixed(2)}`);
    assert.ok(share[TERRAIN_COVER.WATER] > 0.004 && share[TERRAIN_COVER.WATER] < 0.2, `ziarno ${seed}: udział wody ${share[TERRAIN_COVER.WATER].toFixed(3)}`);
    // oś rzeki: punkty w mapie i poza nią po obu stronach (rzeka wchodzi i wychodzi), kręta
    const L = m.extentKm * 1000;
    let inside = 0;
    for (let i = 0; i < m.river.xs.length; i++) if (m.river.xs[i] > 0 && m.river.xs[i] < L && m.river.ys[i] > 0 && m.river.ys[i] < L) inside++;
    assert.ok(inside > 20, `ziarno ${seed}: rzeka w kadrze (${inside} punktów)`);
    assert.ok(m.stats.sinuosity > 1.25, `ziarno ${seed}: krętość ${m.stats.sinuosity.toFixed(2)}`);
    if (m.stats.cutoffs > 0) rivers++;
    // warstwy skończone
    for (let i = 0; i < m.height.length; i += 97) assert.ok(Number.isFinite(m.height[i]));
    for (let i = 3; i < n * n * 4; i += 4 * 211) assert.equal(m.albedo[i], 255);
    // paleta: las ciemny i chłodny (zielony ≥ czerwony, średnia jasność niska)
    let r = 0; let g = 0; let b = 0; let k = 0;
    for (let i = 0; i < m.cover.length; i += 7) if (m.cover[i] === TERRAIN_COVER.FOREST) { r += m.albedo[i * 4]; g += m.albedo[i * 4 + 1]; b += m.albedo[i * 4 + 2]; k++; }
    assert.ok(g / k > r / k && g / k < 110 && b / k > r / k * 0.9, `ziarno ${seed}: las (${(r / k) | 0}, ${(g / k) | 0}, ${(b / k) | 0})`);
  }
  assert.ok(rivers >= 1, 'przynajmniej jedna mapa ma odcięte zakole (starorzecze)');
});

test('wędrówka koryta: zakola rosną z prawie prostej osi, odcięcia skracają rzekę', () => {
  const n = 120;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) { xs[i] = i * 120; ys[i] = 3000; }
  const stamps = [];
  const cuts = [];
  const r = simulateMeanders({
    axis: { xs, ys }, W: 100, ds: 50, iterations: 1500, erod: () => 1, rng: makeRng(5), stampEvery: 50,
    onStamp: (it) => stamps.push(it), onCutoff: (it, cx) => cuts.push([it, cx.length])
  });
  const straight = Math.sqrt((r.xs[r.xs.length - 1] - r.xs[0]) ** 2 + (r.ys[r.ys.length - 1] - r.ys[0]) ** 2);
  assert.ok(r.length / straight > 1.4, `krętość ${(r.length / straight).toFixed(2)}`);
  assert.equal(r.cutoffs, cuts.length);
  assert.ok(stamps.length >= 30 && stamps[stamps.length - 1] === 1499);
  // końce osi stoją (rzeka wchodzi i wychodzi w tych samych miejscach)
  assert.ok(Math.abs(r.xs[0] - xs[0]) < 1e-6 && Math.abs(r.ys[0] - ys[0]) < 1e-6);
  for (let i = 0; i < r.xs.length; i++) assert.ok(Number.isFinite(r.xs[i]) && Number.isFinite(r.ys[i]));
  // odstęp węzłów równy (przepróbkowanie po każdym kroku)
  let lo = 1e9; let hi = 0;
  for (let i = 1; i < r.xs.length; i++) { const d = Math.sqrt((r.xs[i] - r.xs[i - 1]) ** 2 + (r.ys[i] - r.ys[i - 1]) ** 2); lo = Math.min(lo, d); hi = Math.max(hi, d); }
  assert.ok(lo > 35 && hi < 65, `odstęp węzłów ${lo.toFixed(1)}…${hi.toFixed(1)}`);
});

test('style rzek: każdy daje mapę z wodą; delta ma morze, roztoki — żwirowe łożysko, wielka rzeka — szerokie koryto', () => {
  assert.deepEqual([...TERRAIN_RIVERS], ['meandry', 'wielka', 'roztoki', 'delta']);
  const share = (m, cls) => { let n = 0; for (let i = 0; i < m.cover.length; i++) if (m.cover[i] === cls) n++; return n / m.cover.length; };
  const maps = {};
  for (const river of TERRAIN_RIVERS) {
    // (bok mapy w skali stylu: wielka rzeka i delta potrzebują kilkudziesięciu kilometrów)
    const km = river === 'roztoki' ? 8 : (river === 'meandry' ? 5 : 30);
    const m = generateTerrainMap({ seed: 4, size: 256, extentKm: km, river, now: () => 0 });
    maps[river] = m;
    assert.equal(m.riverStyle, river);
    assert.ok(share(m, TERRAIN_COVER.WATER) > 0.004, `${river}: woda ${share(m, TERRAIN_COVER.WATER).toFixed(3)}`);
    for (let i = 0; i < m.height.length; i += 53) assert.ok(Number.isFinite(m.height[i]), `${river}: wysokość`);
    for (let i = 0; i < m.albedo.length; i += 4 * 97) assert.ok(m.albedo[i] + m.albedo[i + 1] + m.albedo[i + 2] > 0, `${river}: barwa`);
  }
  // delta: morze po jednej stronie mapy (kilkanaście–kilkadziesiąt procent), ramiona delty, dno morza poniżej zera
  const d = maps.delta;
  assert.equal(d.sea, true);
  assert.ok(d.stats.seaShare > 0.12 && d.stats.seaShare < 0.7, `delta: udział morza ${d.stats.seaShare.toFixed(2)}`);
  assert.ok(d.stats.arms >= 3, `delta: ramion ${d.stats.arms}`);
  let below = 0;
  for (let i = 0; i < d.height.length; i++) if (d.height[i] < -1) below++;
  assert.ok(below / d.height.length > 0.1);
  assert.equal(maps.meandry.sea, false);
  assert.equal(maps.meandry.stats.seaShare, 0);
  // roztoki: jasne żwirowe łożysko (klasa piasek) wyraźnie większe niż woda nurtu w rzece nizinnej
  assert.ok(share(maps.roztoki, TERRAIN_COVER.SAND) > 0.02, `roztoki: żwir ${share(maps.roztoki, TERRAIN_COVER.SAND).toFixed(3)}`);
  assert.ok(maps.roztoki.stats.sinuosity < 1.2 && maps.wielka.stats.sinuosity < 1.3, 'roztoki i wielka rzeka: łagodny bieg');
  // wielka rzeka: koryto szersze niż rzeki nizinnej
  assert.ok(maps.wielka.river.widthM > maps.meandry.river.widthM * 3);
  assert.throws(() => generateTerrainMap({ river: 'kanał', size: 64, extentKm: 2 }), /nieznany styl rzeki/);
});

test('roślinność: palety zmieniają barwę lasu (czerwona — czerwień, purpura — fiolet, tajga — chłodna zieleń)', () => {
  assert.deepEqual([...TERRAIN_VEGETATION], ['tajga', 'tropik', 'czerwona', 'purpura', 'zlota']);
  const forest = (veg) => {
    const m = generateTerrainMap({ seed: 3, size: 192, extentKm: 4, veg, now: () => 0 });
    assert.equal(m.veg, veg);
    let r = 0; let g = 0; let b = 0; let k = 0;
    for (let i = 0; i < m.cover.length; i++) if (m.cover[i] === TERRAIN_COVER.FOREST) { r += m.albedo[i * 4]; g += m.albedo[i * 4 + 1]; b += m.albedo[i * 4 + 2]; k++; }
    assert.ok(k > m.cover.length * 0.3, `${veg}: lasu ${(k / m.cover.length).toFixed(2)}`);
    return [r / k, g / k, b / k];
  };
  const tajga = forest('tajga');
  const red = forest('czerwona');
  const purple = forest('purpura');
  const gold = forest('zlota');
  const tropic = forest('tropik');
  assert.ok(tajga[1] > tajga[0] && tajga[2] > tajga[0] * 0.9, 'tajga: zieleń z błękitem');
  assert.ok(tropic[1] > tropic[0] * 1.4 && tropic[1] > tropic[2] * 1.3, 'tropik: nasycona zieleń');
  assert.ok(red[0] > red[1] * 1.6 && red[0] > red[2] * 1.6, `czerwona: ${red.map((v) => v | 0)}`);
  assert.ok(purple[2] > purple[1] * 1.3 && purple[0] > purple[1], `purpura: ${purple.map((v) => v | 0)}`);
  assert.ok(gold[0] > gold[2] * 2 && gold[1] > gold[2] * 1.5, `złota: ${gold.map((v) => v | 0)}`);
  assert.throws(() => generateTerrainMap({ veg: 'tęczowa', size: 64, extentKm: 2 }), /nieznana roślinność/);
});

test('mapa terenu: moduł czysty (bez three, DOM i Math.random)', () => {
  const src = readFileSync(new URL('../src/3d/planetGen/planetGenTerrainMap.js', import.meta.url), 'utf8').replace(/\/\/[^\n]*/g, ' ');
  assert.doesNotMatch(src, /Math\.random/);
  assert.doesNotMatch(src, /from 'three|document\.|window\./);
});
