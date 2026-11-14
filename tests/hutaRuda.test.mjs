// Fizyczna ruda huty (dema/ring-dzielnice/huta/ruda): ziarno w ruchu jest ciałem, ziarno w spoczynku ogniwem kolumny
// kraty. Testy rdzenia w Node, bez przeglądarki: BILANS (żadne ziarno nie ginie i nie powstaje poza załadunkiem),
// powtarzalność z ziarna losowości, czas rozładunku statku, KĄT USYPU każdej z pięciu rud (zmierzony na kopcu
// usypanym ciałami — dopasowanie nachylenia w 16 kierunkach, nie odczyt reguły), krater nad zasuwami, granice ciał,
// pula ciał, uspokojenie po ustaniu dopływu, dane dla obrazu, tor ziarna przy dzwonie ssawy (pod krawędź, nie przez
// ścianę), struga w świetle rury, martwy zapas zasieku, sufit zasieku. Testy nie mierzą czasu ściany (próg czasu
// kroku — osobny test z opcją WYDAJNOSC).
import test from 'node:test';
import assert from 'node:assert/strict';
import { LANES } from '../dema/ring-dzielnice/huta/uklad.js';
import { GRAIN, ORES, TRAIT, angleBand, grainHalfMax, tonsToGrains, traitFromHash } from '../dema/ring-dzielnice/huta/ruda/rudy.js';
import { PIPE_POINTS, PIPE_SEG, createStationGeometry } from '../dema/ring-dzielnice/huta/ruda/geometria.js';
import { REC_WORDS, createGrid, measureRepose } from '../dema/ring-dzielnice/huta/ruda/krata.js';
import { FLAG } from '../dema/ring-dzielnice/huta/ruda/ciala.js';
import { COUNTER, EVENT, EVENT_STRIDE, MOVING_STRIDE, STATE, TUNE, createOreStation } from '../dema/ring-dzielnice/huta/ruda/stanowisko.js';
import { WYDAJNOSC } from './helpers/wydajnosc.mjs';
import { allocatedBytes, untilSteady } from './helpers/alokacje.mjs';

const DT = 1 / 60;
const SHIP = tonsToGrains(TUNE.shipLoad);

/** Wysokość powierzchni stosu pod punktem (x, z): pole wysokości kraty wygładzone dwuliniowo — jak w styku ciał. */
function surfaceAt(g, x, z) {
  const fx = (x - g.x0) / g.cell - 0.5;
  const fz = (z - g.z0) / g.cell - 0.5;
  const i0 = Math.max(0, Math.min(g.nx - 2, Math.floor(fx)));
  const j0 = Math.max(0, Math.min(g.nz - 2, Math.floor(fz)));
  const tx = fx - i0;
  const tz = fz - j0;
  const c = j0 * g.nx + i0;
  const a = g.surf[c] + (g.surf[c + 1] - g.surf[c]) * tx;
  const b = g.surf[c + g.nx] + (g.surf[c + g.nx + 1] - g.surf[c + g.nx]) * tx;
  return a + (b - a) * tz;
}
const BURIED = 2 * GRAIN.layer;
/**
 * Każde ciało obu domen leży w murach swojej kraty, nad dnem i NIE W STOSIE (środek najwyżej dwie warstwy pod
 * powierzchnią — chwilowe wciśnięcie w styku ciał sięga ok. jednej warstwy, ziarno zakopane leżałoby głębiej);
 * zwraca opis pierwszego naruszenia albo ''.
 */
function bodiesOutside(st) {
  for (const dom of ['hold', 'bunker']) {
    const b = st.bodies[dom];
    const g = st.grids[dom];
    for (let p = 0; p < b.count; p++) {
      const x = b.px[p];
      const y = b.py[p];
      const z = b.pz[p];
      if (!(x >= g.x0 && x <= g.x1 && z >= g.z0 && z <= g.z1)) return `${dom}: ciało ${p} poza murami (${x}, ${z})`;
      if (!(y >= g.floorY[g.colAt(x, z)])) return `${dom}: ciało ${p} pod dnem (y = ${y})`;
      const depth = surfaceAt(g, x, z) - y;
      if (depth > BURIED) return `${dom}: ciało ${p} w stosie (${depth.toFixed(1)} j. pod powierzchnią)`;
    }
  }
  return '';
}
const scratch = new Float32Array(MOVING_STRIDE * 40000);
/** Księga niezależna od liczników: sumy kolumn obu krat i liczba rekordów rury i taśmy; opis niezgodności albo ''. */
function audit(st) {
  const c = st.counters();
  let sh = 0;
  let sb = 0;
  const gh = st.grids.hold;
  const gb = st.grids.bunker;
  for (let i = 0; i < gh.N; i++) sh += gh.n[i];
  for (let i = 0; i < gb.N; i++) sb += gb.n[i];
  const np = st.writePipe(scratch, 0, false);
  const nt = st.writeBelt(scratch, 0);
  const total = sh + sb + np + nt + st.bodies.hold.count + st.bodies.bunker.count + c.furnace + c.taken;
  if (sh !== c.hold || sb !== c.bunker || np !== c.pipe || nt !== c.belt || total !== c.loaded) return `ładownia ${sh}/${c.hold}, zasiek ${sb}/${c.bunker}, rura ${np}/${c.pipe}, taśma ${nt}/${c.belt}, suma ${total}/${c.loaded}`;
  return '';
}
/** Głębokość krateru: najwyższy wierzch kopca minus najniższy wierzch nad środkową zasuwą [j.]. */
function craterDepth(st) {
  const g = st.grids.bunker;
  let top = -1e9;
  for (let c = 0; c < g.N; c++) if (g.n[c] > 0 && g.lvl[c] > top) top = g.lvl[c];
  let low = 1e9;
  const G = st.geo.gates;
  for (let dj = 0; dj < G.cells; dj++) for (let di = 0; di < G.cells; di++) low = Math.min(low, g.lvl[(G.j0 + dj) * g.nx + G.i0[2] + di]);
  return (top - low) * g.layer;
}
const sumCounters = (c) => c.hold + c.suction + c.pipe + c.air + c.bunker + c.belt + c.furnace + c.taken;

test('ruda: masa ziarna 1/128 t, pięć rud jak tory huty, geometria toru', () => {
  assert.equal(GRAIN.perTon, 128);
  assert.equal(SHIP, 46080);
  assert.equal(tonsToGrains(1.5), 192);
  assert.equal(tonsToGrains(TUNE.bunkerCap), 115200);
  assert.equal(ORES.length, 5);
  ORES.forEach((o, i) => {
    assert.equal(o.index, i);
    assert.equal(o.lane, LANES[i].id, `ruda ${o.id}: tor huty`);
    assert.equal(o.res, LANES[i].ore, `ruda ${o.id}: towar ekonomii`);
    assert.ok(o.angle >= 30 && o.angle <= 40, `ruda ${o.id}: kąt usypu w paśmie 30–40°`);
    assert.ok(o.ruleAngle > o.angle, `ruda ${o.id}: reguła kraty (statyczna) stromsza niż kopiec z wylotu`);
    assert.equal(Number.isInteger(o.initialStock * GRAIN.perTon), true);
    // barwy pod progiem bloomu (luminancja liniowa < 0,9), jaśniejsze niż `oreColor` huty
    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    for (const c of [...o.shades, o.vein, o.dustColor]) assert.ok(lum(c) < 0.9, `ruda ${o.id}: barwa pod progiem bloomu`);
    assert.ok(lum(o.shades[1]) > lum(LANES[i].oreColor), `ruda ${o.id}: barwa rozjaśniona względem huty`);
  });
  assert.equal(new Set(ORES.map((o) => o.angle)).size, 5, 'pięć różnych kątów usypu');
  // żyłki: ok. 3 % ziaren; odcień w 0…7
  let veins = 0;
  for (let k = 0; k < 100000; k++) {
    const t = traitFromHash(Math.imul(k + 1, 0x9E3779B1) >>> 0, (k % 5) - 2);
    if (t & TRAIT.vein) veins++;
    assert.ok((t & TRAIT.hueMask) <= 7);
  }
  assert.ok(veins > 2000 && veins < 4200, `udział żyłek ${veins / 1000} %`);

  const geo = createStationGeometry();
  assert.equal(geo.hold.fields.length, 8);
  // ładunek 14 warstw (lej pod dzwonem ma zbocza): średnia grubość ≥ 13 ziaren
  assert.ok(SHIP / (geo.hold.nx * geo.hold.nz) >= 13, 'ładownia głęboka: średnio co najmniej 13 warstw');
  for (const F of geo.hold.fields) {
    assert.ok(F.x > geo.hold.x0 && F.x < geo.hold.x1 && F.z > geo.hold.z0 && F.z < geo.hold.z1, 'pole ładowni w kracie');
    assert.ok(Math.abs(F.x - geo.ship.x) < geo.ship.width / 2 && Math.abs(F.z - geo.ship.z) < geo.ship.length / 2, 'pole ładowni w obrysie statku');
  }
  assert.ok(geo.hold.floorY < geo.ship.deck && geo.hold.coamingY > geo.ship.deck, 'dno ładowni pod pokładem, zrębnica nad nim');
  // światło rury na każdym odcinku mieści największą bryłkę każdej rudy
  assert.equal(geo.pipe.light.length, PIPE_POINTS - 1);
  for (const o of ORES) for (const s of [PIPE_SEG.chute, PIPE_SEG.pier, PIPE_SEG.boom]) assert.ok(geo.pipe.light[s] - grainHalfMax(o) > 8, `ruda ${o.id}: bryłka mieści się w rurze odcinka ${s}`);
  // zasiek: dno-lej pod y = −120, zasuwy i wylot w murach, taśma kończy się w galerii pieca nad murem
  const B = geo.bunker;
  assert.equal(B.floor(geo.gates.xs[2], geo.gates.z), B.floorGate);
  assert.equal(B.floor(B.x0 + 10, B.z0 + 10), B.floorEdge);
  for (let x = B.x0; x <= B.x1; x += 37) for (let z = B.z0; z <= B.z1; z += 31) assert.ok(B.floor(x, z) <= B.floorEdge && B.floor(x, z) >= B.floorGate);
  for (const x of geo.gates.xs) assert.ok(x - geo.gates.half > B.x0 && x + geo.gates.half < B.x1);
  assert.ok(geo.spout.x > B.x0 && geo.spout.x < B.x1 && geo.spout.z > B.z0 && geo.spout.z < B.z1, 'wylot nad zasiekiem');
  assert.ok(geo.spout.y > B.wallTop);
  assert.ok(geo.belt.pts[2][1] > B.wallTop && geo.belt.pts[2][2] < B.z0, 'galeria pieca nad murem, po stronie części gorącej');
  assert.ok(geo.belt.incline < 40 * Math.PI / 180, 'taśma pochyła nie stromsza niż 40°');
  for (let k = 1; k < geo.belt.gateS.length; k++) assert.ok(geo.belt.gateS[k] > geo.belt.gateS[k - 1], 'zasuwy po kolei wzdłuż taśmy');
  // rura: droga rośnie od wylotu do gardzieli
  const pts = new Float64Array(PIPE_POINTS * 3);
  const cum = new Float64Array(PIPE_POINTS);
  geo.pipePath(Float64Array.of(0, 170, geo.hold.fields[5].z), pts, cum);
  const len = cum[PIPE_POINTS - 1];
  for (let k = 1; k < PIPE_POINTS; k++) assert.ok(cum[k] > cum[k - 1]);
  assert.ok(len > 1500 && len < 4000, `długość rury ${len}`);
  assert.equal(pts[0], geo.spout.x);
  assert.equal(pts[PIPE_POINTS * 3 - 2], 170 + geo.bell.throatH);
});

test('ruda: krata — pojedyncze ziarno leży, komin się osypuje do reguły, stos pamięta ziarna (góra / dół)', () => {
  const g = createGrid({ nx: 60, nz: 60, x0: 0, z0: 0, floor: 0, wallY: 100, maxLayers: 64, salt: 3, tan: Math.tan(35 * Math.PI / 180) });
  const mid = 30 * 60 + 30;
  g.pushHashed(mid, 5);
  assert.equal(g.unstableDir(mid, 0), -1, 'jedno ziarno na płaskim dnie jest stateczne');
  assert.ok(g.unstableDir(mid, 1) >= 0, 'drugie ziarno na pierwszym, pośrodku płaskiego dna, nie ustoi (słupek 2 nad sąsiadami 0)');
  // komin 40 ziaren: cechy 1…40 od dołu
  for (let k = 1; k <= 40; k++) g.pushHashed(mid + 5, k);
  assert.ok(g.unstableDir(mid + 5, 0) >= 0, 'komin jest niestateczny');
  // dół i góra stosu: FIFO od dołu, LIFO od góry
  assert.equal(g.popBottom(mid + 5), 1);
  assert.equal(g.popTop(mid + 5), 40);
  assert.equal(g.popBottom(mid + 5), 2);
  assert.equal(g.n[mid + 5], 37);
  assert.equal(g.surf[mid + 5], Math.fround(37 * g.layer));
  g.markDirty(mid + 5);
  const moves = g.relax(1e9);
  assert.ok(moves > 20, `osypań ${moves}`);
  assert.equal(g.queued, 0);
  assert.equal(g.unstableCount(), 0, 'po rozluźnieniu żadna kolumna nie łamie reguły');
  assert.equal(g.count, 38, 'ziarna zostały w kracie');
  let sum = 0;
  for (let c = 0; c < g.N; c++) sum += g.n[c];
  assert.equal(sum, 38);
  // rekord obrazu: 8 słów na kolumnę, liczba ziaren w bajcie 0, wysokość wierzchniego ziarna w słowie 7
  assert.equal(g.flushRender(), -1, 'pierwsze odświeżenie pakuje całą kratę');
  assert.equal(g.rec.length, g.N * REC_WORDS);
  for (let c = 0; c < g.N; c++) {
    assert.equal(g.rec[c * REC_WORDS] & 255, g.n[c]);
    assert.ok(Math.abs(g.recF[c * REC_WORDS + 7] - (g.n[c] > 0 ? (g.lvl[c] - 0.5) * g.layer : 0)) < 1e-4);
  }
  g.pushHashed(mid, 9);
  const k = g.flushRender();
  assert.ok(k >= 9 && k < 60, `po jednej zmianie przepakowane ${k} kolumn (ona, sąsiedzi, kolumny w cieniu)`);
  const out = new Int32Array(64);
  assert.ok(g.packRanges(k, 2, out) >= 1);
  assert.equal(g.rec[mid * REC_WORDS + 1] & 255, 9, 'cechy wierzchniego ziarna w rekordzie');
});

test('ruda: tryb szybki, 9 minut — bilans 0 po każdym kroku, pętla statków i pieca, rozładunek 50–70 s', () => {
  const st = createOreStation({ ore: 0, seed: 7, fast: true });
  const c0 = st.counters();
  assert.equal(c0.hold, SHIP, 'statek startowy pełny');
  assert.equal(c0.bunker, tonsToGrains(ORES[0].initialStock), 'zapas startowy w zasieku');
  assert.equal(st.balance(), 0);
  const unload = [];
  let last = 0;
  let stockMin = 1e9;
  let stockMax = 0;
  for (let s = 0; s < 9 * 60 * 60; s++) {
    st.step(DT);
    if (st.balance() !== 0) assert.fail(`bilans ${st.balance()} w kroku ${s}`);
    if (st.moving() !== 0) assert.fail('tryb szybki nie ma ciał');
    if (st.unloadTime !== last) { last = st.unloadTime; unload.push(last); }
    const t = st.stock();
    if (t < stockMin) stockMin = t;
    if (t > stockMax) stockMax = t;
  }
  const c = st.counters();
  assert.equal(c.loaded, sumCounters(c), 'suma liczników = weszło');
  const S = st.state();
  assert.ok(S.ship.trips >= 6, `statków ${S.ship.trips}`);
  assert.ok(S.furnace.calls >= 20, `wsadów ${S.furnace.calls}`);
  assert.ok(unload.length >= 5);
  for (const u of unload) assert.ok(u >= 50 && u <= 70, `rozładunek ${u.toFixed(1)} s`);
  assert.ok(c.furnace >= 20 * tonsToGrains(TUNE.charge) - tonsToGrains(TUNE.charge), 'wsad dojeżdża taśmą do pieca');
  assert.ok(stockMin >= 250 && stockMax <= TUNE.bunkerCap, `zapas ${stockMin.toFixed(0)}…${stockMax.toFixed(0)} t`);
  assert.equal(st.grids.bunker.unstableCount() + st.grids.hold.unstableCount(), 0, 'kraty spełniają regułę');
  // wydanie z galerii pieca: całe ziarna, bilans dalej zero
  const before = st.counters().furnace;
  assert.equal(st.take(45), 45);
  assert.equal(st.counters().furnace, before - 45 * 128);
  assert.equal(st.balance(), 0);
});

test('ruda: tryb z ciałami, 90 s — bilans 0 po każdym kroku, ciała w murach i nad dnem, pula, rozładunek 50–70 s', () => {
  const st = createOreStation({ ore: 0, seed: 7 });
  const hold = st.bodies.hold;
  const bunker = st.bodies.bunker;
  let emptiedAt = -1;
  let sawPipe = 0;
  let sawAir = 0;
  let sawSuction = 0;
  for (let s = 0; s < 90 * 60; s++) {
    st.step(DT);
    if (st.balance() !== 0) assert.fail(`bilans ${st.balance()} w kroku ${s}`);
    const bad = bodiesOutside(st);
    if (bad) assert.fail(`krok ${s}: ${bad}`);
    if (s % 20 === 0) { const off = audit(st); if (off) assert.fail(`krok ${s}: księga niezależna — ${off}`); }
    const c = st.counters();
    if (c.pipe > sawPipe) sawPipe = c.pipe;
    if (c.air > sawAir) sawAir = c.air;
    if (c.suction > sawSuction) sawSuction = c.suction;
    if (emptiedAt < 0 && c.hold + c.suction === 0) emptiedAt = st.time;
  }
  assert.ok(emptiedAt >= 50 && emptiedAt <= 70, `ładownia pusta do zera po ${emptiedAt.toFixed(1)} s`);
  assert.ok(Math.abs(st.unloadTime - emptiedAt) < 0.05);
  assert.ok(sawSuction > 100 && sawPipe > 800 && sawAir > 1500, `ziarna w ssaniu (${sawSuction}), w rurze (${sawPipe}) i w locie (${sawAir})`);
  assert.ok(hold.peak < hold.cap && bunker.peak < bunker.cap, `pula nieprzepełniona: ${hold.peak}/${hold.cap}, ${bunker.peak}/${bunker.cap}`);
  assert.equal(hold.stats.refused + bunker.stats.refused, 0, 'żadne ciało nie zostało odrzucone przez pełną pulę');
  assert.equal(hold.stats.forced + bunker.stats.forced, 0, 'żadne ziarno nie osiadło z bezpiecznika wieku');
  assert.ok(bunker.stats.toppled > 1000 && bunker.stats.knocked > 100 && bunker.stats.settled > SHIP, 'osypania, wybicia i osiadanie w zasieku');
  assert.ok(hold.stats.toppled > 1000 && hold.stats.captured === st.counters().delivered, 'lej w ładowni: osypania, wszystko przechwycone w gardzieli');
  const c = st.counters();
  assert.equal(c.delivered, SHIP, 'cały ładunek przeszedł przez rurę');
  assert.equal(c.loaded, sumCounters(c));
});

test('ruda: mała pula ciał — ziarna czekają (rura, strome ściany), nic nie ginie, potem wszystko osiada', () => {
  const st = createOreStation({ ore: 3, seed: 11, initialStock: 200, tune: { bodiesBunker: 1024, jetReserve: 256, bodiesHold: 512, minStock: 1e9, shipGap: 1e9 } });
  for (let s = 0; s < 45 * 60; s++) {
    st.step(DT);
    if (st.balance() !== 0) assert.fail(`bilans ${st.balance()} w kroku ${s}`);
  }
  assert.ok(st.stats.pipeWait > 0, 'przy pełnej puli ziarna czekały u wylotu');
  assert.ok(st.bodies.bunker.peak <= 1024 && st.bodies.hold.peak <= 512);
  assert.equal(st.bodies.bunker.stats.refused + st.bodies.hold.stats.refused, 0);
  // do końca: statek opróżniony, ruch ustaje, kraty stateczne
  let s = 0;
  for (; s < 400 * 60; s++) {
    st.step(DT);
    const c = st.counters();
    if (c.hold + c.suction + c.pipe + c.air === 0) break;
  }
  const c = st.counters();
  assert.equal(c.hold + c.suction + c.pipe + c.air, 0, `po ${st.time.toFixed(0)} s wszystko w zasieku`);
  assert.equal(st.balance(), 0);
  assert.equal(c.bunker, tonsToGrains(200) + SHIP, 'zasiek = zapas + cały statek (krater z rozbiegu wliczony w wydane)');
  assert.equal(st.grids.bunker.queued, 0);
  assert.equal(st.grids.bunker.unstableCount(), 0);
});

test('ruda: dwa przebiegi z jednego ziarna losowości są identyczne (skrót stanu), inne ziarno — inny przebieg', () => {
  const mk = (seed) => createOreStation({ ore: 1, seed, initialStock: 150 });
  const a = mk(21);
  const b = mk(21);
  const d = mk(22);
  assert.equal(a.hash(), b.hash(), 'stan po rozbiegu');
  let differs = false;
  for (let s = 0; s < 14 * 60; s++) {
    a.step(DT);
    b.step(DT);
    d.step(DT);
    if (s % 60 === 59) {
      assert.equal(a.hash(), b.hash(), `skrót po ${(s + 1) / 60} s`);
      if (a.hash() !== d.hash()) differs = true;
    }
  }
  assert.ok(a.moving() > 500, 'porównanie obejmuje ciała w ruchu');
  assert.deepEqual({ ...a.counters() }, { ...b.counters() });
  assert.ok(differs, 'inne ziarno losowości daje inny przebieg');
  // tryb szybki też
  const fa = createOreStation({ ore: 4, seed: 5, fast: true, initialStock: 100 });
  const fb = createOreStation({ ore: 4, seed: 5, fast: true, initialStock: 100 });
  for (let s = 0; s < 40 * 60; s++) { fa.step(DT); fb.step(DT); }
  assert.equal(fa.hash(), fb.hash());
});

const pileAngle = new Map();          // zmierzony kąt kopca usypanego ciałami (test kolejności rud niżej)
for (const ore of ORES) {
  test(`ruda: kąt usypu — ${ore.id} ${ore.angle}° ± 3° (kopiec z jednego statku, usypany ciałami, 16 kierunków)`, () => {
    // pusty zasiek, piec stoi, drugi statek nie przylatuje: jeden pełny rozładunek i czekanie, aż ruch ustanie
    const st = createOreStation({ ore: ore.index, seed: 7, prewarm: false, tune: { minStock: 1e9, shipGap: 1e9 } });
    let s = 0;
    for (; s < 150 * 60; s++) {
      st.step(DT);
      if (st.shipState !== 'dock' && st.moving() === 0 && st.pipe.count === 0) break;
    }
    assert.ok(st.unloadTime >= 50 && st.unloadTime <= 70, `rozładunek ${st.unloadTime.toFixed(1)} s`);
    // po ustaniu dopływu liczba ruchomych spada do 0
    assert.equal(st.moving(), 0, 'ruch ustał');
    assert.ok(st.time < st.unloadTime + 25, `ruch ustał ${(st.time - st.unloadTime).toFixed(1)} s po opróżnieniu statku`);
    const g = st.grids.bunker;
    assert.equal(g.count, SHIP, 'cały statek leży w zasieku');
    assert.equal(st.balance(), 0);
    assert.equal(g.queued, 0);
    assert.equal(g.unstableCount(), 0, 'żadna kolumna nie łamie reguły stateczności');
    // kąt: prosta najmniejszych kwadratów przez powierzchnię między 25 a 75 % wysokości, w 16 kierunkach od wierzchołka
    const m = measureRepose(g);
    pileAngle.set(ore.id, m.mean);
    const [lo, hi] = angleBand(ore);
    assert.ok(m.angles.length >= 12, `zmierzono ${m.angles.length} kierunków`);
    assert.ok(m.mean >= lo && m.mean <= hi, `kąt średni ${m.mean.toFixed(1)}° poza pasmem ${lo}–${hi}° (min ${m.min.toFixed(1)}, max ${m.max.toFixed(1)})`);
    // kierunki nie rozjeżdżają się: większość w paśmie poszerzonym o 2,5° (strona za strugą bywa płytsza)
    const inBand = m.angles.filter((v) => v >= lo - 2.5 && v <= hi + 2.5).length;
    assert.ok(inBand >= m.angles.length - 3, `kierunków w paśmie ${inBand}/${m.angles.length}: ${m.angles.map((v) => v.toFixed(0)).join(' ')}`);
    // kopiec leży pod y = 116 (nad tą wysokością obraz ściska wysokości) i wierzchołek jest przy celu strugi
    assert.ok(m.apexY < 116, `wierzchołek y = ${m.apexY.toFixed(0)}`);
    assert.ok(Math.hypot(m.apexX - st.geo.spout.target.x, m.apexZ - st.geo.spout.target.z) < 90, 'wierzchołek kopca nad linią zasuw');
  });
}

test('ruda: rudy różnią się kopcem — kolejność kątów jak w tabeli (tytan < węglista < żelazo < miedź < glin)', () => {
  const order = [3, 4, 0, 1, 2];
  // (1) kopce USYPANE CIAŁAMI (to widzi użytkownik): kąty zmierzone w testach wyżej rosną w kolejności tabeli
  if (pileAngle.size === ORES.length) {
    for (let k = 1; k < order.length; k++) {
      const a = pileAngle.get(ORES[order[k]].id);
      const b = pileAngle.get(ORES[order[k - 1]].id);
      assert.ok(a > b + 0.5, `kopiec ${ORES[order[k]].id} (${a.toFixed(1)}°) stromszy niż ${ORES[order[k - 1]].id} (${b.toFixed(1)}°)`);
    }
  }
  // (2) reguła stateczności (ściany krateru i leja, tryb szybki): kąty graniczne w tabeli rosną w tej samej kolejności,
  // a kopiec z samej reguły jest okrągły i wyraźnie różny dla rud skrajnych (rudy sąsiednie różni mniej niż krok kraty)
  for (let k = 1; k < order.length; k++) assert.ok(ORES[order[k]].ruleAngle > ORES[order[k - 1]].ruleAngle, 'kąt reguły rośnie w kolejności tabeli');
  const ang = ORES.map((ore) => {
    const g = createGrid({ nx: 200, nz: 200, x0: -600, z0: -600, floor: 0, wallY: 1e4, maxLayers: 64, salt: 9, tan: Math.tan(ore.ruleAngle * Math.PI / 180) });
    const mid = 100 * 200 + 100;
    for (let k = 0; k < 14000; k++) { const c = mid + ((k * 7) % 5 - 2) + (((k * 3) % 5) - 2) * 200; g.pushHashed(c, 0); g.markNear(c); if ((k & 31) === 31) g.relax(1e9); }
    g.relax(1e9);
    assert.equal(g.unstableCount(), 0);
    const m = measureRepose(g);
    assert.ok(m.max - m.min < 6, `ruda ${ore.id}: kopiec okrągły (rozrzut kierunków ${(m.max - m.min).toFixed(1)}°)`);
    return m.mean;
  });
  assert.ok(ang[2] > ang[3] + 3 && ang[1] > ang[0] + 1.5 && ang[0] > ang[3], `reguła: tytan ${ang[3].toFixed(1)}°, żelazo ${ang[0].toFixed(1)}°, miedź ${ang[1].toFixed(1)}°, glin ${ang[2].toFixed(1)}°`);
});

test('ruda: odbiór — krater nad zasuwami, zbocza sypią się ciałami, taśma wiezie wsad do pieca, po uspokojeniu reguła', () => {
  const st = createOreStation({ ore: 0, seed: 7, auto: false, start: 'away' });
  const stock0 = st.counters().bunker;
  assert.equal(stock0, tonsToGrains(ORES[0].initialStock));
  const before = craterDepth(st);
  assert.equal(st.order(90), 11520);
  let beltMax = 0;
  let airMax = 0;
  let s = 0;
  for (; s < 120 * 60; s++) {
    st.step(DT);
    if (st.balance() !== 0) assert.fail(`bilans ${st.balance()} w kroku ${s}`);
    const bad = bodiesOutside(st);
    if (bad) assert.fail(`krok ${s}: ${bad}`);
    const c = st.counters();
    if (c.belt > beltMax) beltMax = c.belt;
    if (c.air > airMax) airMax = c.air;
    if (st.state().furnace.want === 0 && c.belt === 0 && c.air === 0 && st.grids.bunker.queued === 0) break;
  }
  const c = st.counters();
  assert.equal(c.furnace, 11520, '90 t dojechało do galerii pieca');
  assert.equal(c.bunker, stock0 - 11520);
  assert.ok(st.time > 10 && st.time < 40, `odbiór 9 t/s i przejazd taśmą: ${st.time.toFixed(1)} s`);
  assert.ok(beltMax > 3000, `ziarna na taśmie (do ${beltMax})`);
  assert.ok(airMax > 300, `zbocza krateru sypią się ciałami (do ${airMax} naraz)`);
  assert.ok(st.bodies.bunker.stats.toppled > 5000);
  const depth = craterDepth(st);
  assert.ok(depth > 60 && depth > before + 10, `krater nad zasuwami ${depth.toFixed(0)} j. (przed wsadem ${before.toFixed(0)} — kopiec z rozbiegu ma już krater po jednym wsadzie)`);
  assert.equal(st.moving(), 0, 'ruch ustał');
  assert.equal(st.grids.bunker.unstableCount(), 0, 'po uspokojeniu żadna kolumna nie łamie reguły');
  // zasuwy zamknięte, piec zabiera wsad
  for (const o of st.state().gates) assert.ok(o < 0.05);
  assert.equal(st.take(90), 90);
  assert.equal(st.take(1), 0);
  assert.equal(st.balance(), 0);
});

test('ruda: sterowanie z zewnątrz (auto: false) — wezwanie statku, podejście z ładunkiem w kracie, zamówienie i wydanie wsadu', () => {
  const st = createOreStation({ ore: 1, seed: 2, auto: false, start: 'away', prewarm: false });
  assert.equal(st.shipState, 'away');
  assert.equal(st.counters().loaded, 0);
  for (let s = 0; s < 120; s++) st.step(DT);
  assert.equal(st.shipState, 'away', 'bez wezwania statek nie przylatuje');
  assert.equal(st.callShip(), true);
  assert.equal(st.callShip(), false, 'drugi statek nie wyrusza, póki pierwszy jest w drodze');
  assert.equal(st.loadShip(), false, 'pełnej ładowni nie da się załadować drugi raz');
  let c = st.counters();
  assert.equal(c.hold, SHIP, 'ładunek leży w kracie ładowni już w czasie dojazdu');
  assert.equal(c.loaded, SHIP);
  assert.equal(st.grids.hold.unstableCount(), 0, 'ładunek spełnia regułę stateczności');
  const off0 = st.state().ship.off;
  assert.ok(off0 > 4000, 'statek zaczyna podejście z daleka');
  for (let s = 0; s < 6 * 60; s++) st.step(DT);
  assert.equal(st.shipState, 'approach');
  assert.ok(st.state().ship.off < off0 * 0.3 && st.state().ship.off > 0, 'statek hamuje przy pirsie');
  assert.equal(st.counters().hold, SHIP, 'w czasie dojazdu nic się nie sypie');
  assert.equal(st.state().vac.gz, st.geo.hold.fields[0].z, 'suwnica czeka nad pierwszym polem');
  for (let s = 0; s < 12 * 60; s++) st.step(DT);
  assert.equal(st.shipState, 'dock');
  assert.equal(st.state().ship.off, 0);
  c = st.counters();
  assert.ok(c.hold < SHIP && c.delivered > 1000, 'po zacumowaniu ssawa ciągnie');
  assert.equal(st.balance(), 0);
  // zamówienie wsadu z pustego zasieku: zasuwy czekają, aż coś nad nimi spadnie; potem wydanie z galerii
  assert.equal(st.order(10), 1280);
  for (let s = 0; s < 40 * 60; s++) st.step(DT);
  c = st.counters();
  assert.equal(c.furnace, 1280, '10 t dojechało do galerii');
  assert.equal(st.take(4), 4);
  assert.equal(st.counters().furnace, 1280 - 512);
  assert.equal(st.counters().taken, 512);
  assert.equal(st.balance(), 0);
});

test('ruda: dane dla obrazu (ciała, rura, taśma, krata, zdarzenia pyłu, stan maszyn) i przełączenie trybu w biegu', () => {
  const st = createOreStation({ ore: 2, seed: 3, initialStock: 200, tune: { furnaceFirst: 4 } });
  st.setSun(-0.4, 0.7, -0.55);
  assert.equal(st.grids.bunker.flushRender(), -1);
  assert.equal(st.grids.hold.flushRender(), -1);
  const ev = new Float32Array(EVENT_STRIDE * 256);
  const kinds = new Set();
  for (let s = 0; s < 16 * 60; s++) {
    st.step(DT);
    const k = st.drainEvents(ev);
    for (let i = 0; i < k; i++) {
      kinds.add(ev[i * EVENT_STRIDE + 4]);
      assert.ok(ev[i * EVENT_STRIDE + 3] > 0 && ev[i * EVENT_STRIDE + 3] <= 1, 'siła zdarzenia 0…1');
      assert.ok(Number.isFinite(ev[i * EVENT_STRIDE]) && Number.isFinite(ev[i * EVENT_STRIDE + 1]) && Number.isFinite(ev[i * EVENT_STRIDE + 2]));
    }
  }
  for (const k of [EVENT.IMPACT, EVENT.SPOUT, EVENT.BELL, EVENT.GATE]) assert.ok(kinds.has(k), `zdarzenie pyłu rodzaju ${k}`);
  const c = st.counters();
  const out = new Float32Array(MOVING_STRIDE * 16384);
  const nh = st.bodies.hold.write(out, 0);
  const nb = st.bodies.bunker.write(out, nh);
  const np = st.writePipe(out, nh + nb, false);
  const nt = st.writeBelt(out, nh + nb + np);
  assert.equal(nh, c.suction);
  assert.equal(nb, c.air);
  assert.equal(np, c.pipe);
  assert.equal(nt, c.belt);
  assert.ok(nh > 20 && nb > 500 && np > 500 && nt > 500, `ruchome: ssanie ${nh}, lot ${nb}, rura ${np}, taśma ${nt}`);
  const total = nh + nb + np + nt;
  const B = st.geo.bunker;
  for (let i = 0; i < total; i++) {
    const o = i * MOVING_STRIDE;
    for (let q = 0; q < MOVING_STRIDE; q++) assert.ok(Number.isFinite(out[o + q]), `rekord ${i}, pole ${q}`);
    const ql = Math.hypot(out[o + 6], out[o + 7], out[o + 8], out[o + 9]);
    assert.ok(Math.abs(ql - 1) < 1e-3, 'kwaternion jednostkowy');
    assert.ok(out[o + 10] >= 0 && out[o + 10] <= 255 && Number.isInteger(out[o + 10]), 'bajt cech');
    // rodzaj + 16 × prześwit pod ciałem (0…255 j., całkowity); rura i taśma bez prześwitu
    const gap = Math.floor(out[o + 11] / 16);
    const kind = out[o + 11] - 16 * gap;
    assert.ok(Number.isInteger(out[o + 11]) && gap >= 0 && gap <= 255);
    assert.ok(i < nh + nb ? kind >= 0 && kind <= 2 : kind === (i < nh + nb + np ? 3 : 4) && gap === 0);
    // pozycja z początku kroku leży blisko bieżącej (krok 1/60 s przy suficie prędkości i prędkości rury)
    assert.ok(Math.hypot(out[o] - out[o + 3], out[o + 1] - out[o + 4], out[o + 2] - out[o + 5]) < 30);
  }
  // ziarna na taśmie: na łamanej taśmy (pod dnem zasieku albo na pochylni do galerii)
  for (let i = nh + nb + np; i < total; i++) {
    const o = i * MOVING_STRIDE;
    assert.ok(out[o + 1] > st.geo.belt.pts[0][1] - 1 && out[o + 1] < st.geo.belt.pts[2][1] + 40);
    assert.ok(out[o] > -600 && out[o] < 260 && out[o + 2] > B.z0 - 160 && out[o + 2] < B.z1);
  }
  // okna rury: podzbiór ziaren w rurze
  const nw = st.writePipe(out, 0, true);
  assert.ok(nw > 0 && nw < np, `w oknach rury ${nw} z ${np} ziaren`);
  // krata: po kroku zmienione kolumny, nie cała krata
  const kb = st.grids.bunker.flushRender();
  assert.ok(kb > 0 && kb < st.grids.bunker.N / 2, `przepakowane kolumny zasieku: ${kb}`);
  const S = st.state();
  assert.equal(S.ship.state, 'dock');
  assert.equal(S.ship.off, 0);
  assert.ok(S.vac.on && S.vac.bellY < st.geo.bell.parkY && S.vac.bellY > st.geo.hold.floorY, 'dzwon nad ładunkiem');
  assert.ok(S.vac.tx > st.geo.hold.x0 && S.vac.tx < st.geo.hold.x1 && S.vac.gz > st.geo.hold.z0 && S.vac.gz < st.geo.hold.z1);
  assert.ok(S.spout.flow > 200 && st.stats.emitted > 8000, `wylot sypie ${S.spout.flow.toFixed(0)} ziaren/s (dotąd ${st.stats.emitted})`);
  assert.equal(S.gates.length, st.geo.gates.count);

  // migawka: wszystko naraz w buforach wielokrotnego użycia — liczby zgodne z licznikami, zmiany krat jako lista kolumn
  const snap = st.createSnapshot();
  st.step(DT);
  st.snapshot(snap);
  const c2 = st.counters();
  assert.equal(snap.nHold, c2.suction);
  assert.equal(snap.nBunker, c2.air);
  assert.equal(snap.nBelt, c2.belt);
  assert.ok(snap.nPipe > 0 && snap.nPipe < c2.pipe, 'z rury tylko ziarna w oknach');
  assert.equal(snap.counters[COUNTER.bunker], c2.bunker);
  assert.equal(snap.counters[COUNTER.loaded], c2.loaded);
  assert.equal(snap.state[STATE.ship], 2);
  assert.equal(snap.state[STATE.bellY], st.state().vac.bellY);
  assert.ok(Math.abs(Math.hypot(snap.state[STATE.jetX], snap.state[STATE.jetY], snap.state[STATE.jetZ]) - 1) < 1e-9, 'oś strugi jednostkowa');
  assert.ok(!snap.bunker.all && snap.bunker.count > 0 && snap.bunker.count < 6000, `zmienione kolumny zasieku: ${snap.bunker.count}`);
  const gB = st.grids.bunker;
  for (let q = 0; q < snap.bunker.count; q++) {
    const col = snap.bunker.cols[q];
    assert.equal(snap.bunker.rec[q * 8] & 255, gB.n[col], 'rekord zmienionej kolumny: liczba ziaren');
    assert.equal(snap.bunker.rec[q * 8 + 3], gB.rec[col * 8 + 3]);
  }
  const moved = (snap.nHold + snap.nBunker + snap.nPipe + snap.nBelt) * MOVING_STRIDE;
  for (let i = 0; i < moved; i++) if (!Number.isFinite(snap.moving[i])) assert.fail(`migawka: pole ${i} nie jest liczbą`);
  st.step(DT);
  st.snapshot(snap);
  assert.ok(snap.nEvents >= 0 && snap.nEvents <= 256);

  // tryb szybki w biegu: ciała osiadają od razu, bilans bez zmian; i z powrotem
  st.setFast(true);
  assert.equal(st.moving(), 0);
  assert.equal(st.balance(), 0);
  assert.equal(st.grids.bunker.queued + st.grids.hold.queued, 0);
  for (let s = 0; s < 5 * 60; s++) { st.step(DT); if (st.balance() !== 0) assert.fail('bilans w trybie szybkim'); }
  st.setFast(false);
  for (let s = 0; s < 5 * 60; s++) { st.step(DT); if (st.balance() !== 0) assert.fail('bilans po powrocie do ciał'); }
  assert.ok(st.moving() > 300, 'po powrocie znów lecą ciała');
  // długi krok jest dzielony na podkroki (tempo × 4), bilans dalej zero
  assert.equal(st.step(4 * DT), 8);
  assert.equal(st.balance(), 0);
});

test('ruda: ssawa — ziarno wchodzi POD krawędź dzwonu (nie przez ścianę) i jedzie po powierzchni; śluza cyklonu daje równą strugę', () => {
  const st = createOreStation({ ore: 0, seed: 7 });
  const hb = st.bodies.hold;
  const B = st.geo.bell;
  const R = 3;
  const floor = st.geo.hold.floorY;
  let through = 0;
  let outOfCone = 0;
  let sweepMax = 0;
  let sweepSeen = 0;
  let lastEmitted = 0;
  let inBellMax = 0;
  const gaps = [];
  const flows = [];
  const fieldsSeen = new Set();
  for (let s = 0; s < 80 * 60 && st.shipState === 'dock'; s++) {
    st.step(DT);
    const S = st.state();
    fieldsSeen.add(S.vac.field);
    if (S.vac.on) {
      const rim = S.vac.bellY;
      let inBell = 0;
      for (let p = 0; p < hb.count; p++) {
        const dx = hb.px[p] - S.vac.tx;
        const dz = hb.pz[p] - S.vac.gz;
        const hh = Math.sqrt(dx * dx + dz * dz);
        const y = hb.py[p];
        const t = Math.max(0, Math.min(1, (y - rim) / B.throatH));
        if ((hb.flags[p] & FLAG.BELL) !== 0) {
          // w dzwonie: od krawędzi w górę ziarno zostaje w stożku klatki (promień środka ziarna 26 → 11 j.)
          inBell++;
          if (y > rim && hh > (B.r - 4) - ((B.r - 4) - (B.throatR - 3)) * t + 0.5) outOfCone++;
        } else {
          // poza dzwonem: nad krawędzią nie bliżej osi niż ściana dzwonu (ziarno nie przenika do gardzieli bokiem)
          if (y > rim + 1 && y < rim + B.throatH + 30 && hh < (B.r + 1 + R) - ((B.r + 1) - (B.throatR + 5)) * t - 1) through++;
          if ((hb.flags[p] & FLAG.LIFT) !== 0 && hh > B.r + 6) {
            gaps.push(y - R - surfaceAt(st.grids.hold, hb.px[p], hb.pz[p]));
            if (S.vac.sweep) { sweepSeen++; if (y - floor > sweepMax) sweepMax = y - floor; }
          }
        }
      }
      if (inBell > inBellMax) inBellMax = inBell;
    }
    if (s % 30 === 29) {
      const out = st.stats.emitted - lastEmitted;
      lastEmitted = st.stats.emitted;
      if (st.time > 4 && !S.vac.sweep && st.counters().hold > 0) flows.push(out);
    }
  }
  assert.equal(through, 0, 'żadne ziarno nie weszło do dzwonu przez ścianę');
  assert.equal(outOfCone, 0, 'ziarno w dzwonie nie wychodzi poza stożek klatki');
  assert.ok(inBellMax > 20, `w dzwonie widać strumień ziaren (do ${inBellMax} naraz)`);
  gaps.sort((a, b) => a - b);
  const q = (p) => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))];
  assert.ok(gaps.length > 20000, 'ziarna ssane poza dzwonem były mierzone');
  assert.ok(q(0.5) < 4 && q(0.9) < 12, `ziarno ssane jedzie po powierzchni: prześwit mediana ${q(0.5).toFixed(1)} j., 90 % poniżej ${q(0.9).toFixed(1)} j.`);
  // resztki: ziarna jadą po dnie do dzwonu (nie lecą w powietrzu)
  assert.ok(sweepSeen > 2000 && sweepMax < 24, `resztki: ${sweepSeen} próbek, ziarno najwyżej ${sweepMax.toFixed(1)} j. nad dnem`);
  // osiem zagłębień i resztki; śluza cyklonu: w każdym oknie 0,5 s dokładnie wydatek śluzy, żadnego pustego
  assert.equal(fieldsSeen.size, st.geo.hold.fields.length + 1);
  const half = TUNE.spoutRate / 2;
  assert.ok(flows.length > 80);
  for (const fl of flows) assert.ok(fl <= half + 1 && fl >= half - 1, `struga w oknie 0,5 s: ${fl} ziaren (śluza ${half})`);
  assert.equal(st.stats.liftBlocked, 0);
  assert.equal(st.stats.pipeWait, 0);
  assert.ok(st.unloadTime >= 50 && st.unloadTime <= 70, `rozładunek ${st.unloadTime.toFixed(1)} s`);
});

test('ruda: ziarno w oknie rury mieści się w świetle rury (z bryłką), a pozycja z początku kroku leży na tej samej spirali', () => {
  for (const ore of [1, 3]) {
    const st = createOreStation({ ore, seed: 5 });
    const geo = st.geo;
    const g = grainHalfMax(ORES[ore]);
    const out = new Float32Array(MOVING_STRIDE * 9000);
    let seen = 0;
    const perSeg = new Map();
    for (let s = 0; s < 14 * 60; s++) {
      st.step(DT);
      if (s < 6 * 60 || s % 6 !== 0) continue;
      const n = st.writePipe(out, 0, true);
      const pts = st.pipe.pts;
      for (let i = 0; i < n; i++) {
        const o = i * MOVING_STRIDE;
        // odcinek rury: ten, do którego osi ziarno ma najbliżej
        let best = 1e9;
        let seg = -1;
        let vertB = 0;
        for (const k of [PIPE_SEG.chute, PIPE_SEG.pier, PIPE_SEG.boom]) {      // okna są tylko na tych odcinkach
          const ax = pts[k * 3];
          const ay = pts[k * 3 + 1];
          const az = pts[k * 3 + 2];
          const bx = pts[k * 3 + 3] - ax;
          const by = pts[k * 3 + 4] - ay;
          const bz = pts[k * 3 + 5] - az;
          let t = ((out[o] - ax) * bx + (out[o + 1] - ay) * by + (out[o + 2] - az) * bz) / (bx * bx + by * by + bz * bz);
          t = Math.max(0, Math.min(1, t));
          const dx = out[o] - (ax + bx * t);
          const dy = out[o + 1] - (ay + by * t);
          const dz = out[o + 2] - (az + bz * t);
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d < best) { best = d; seg = k; vertB = Math.abs(dy); }
        }
        const light = geo.pipe.light[seg];
        assert.ok(best + g <= light - 0.5, `ruda ${ore}, odcinek ${seg}: ziarno ${best.toFixed(1)} j. od osi + bryłka ${g.toFixed(1)} j. w świetle ${light} j.`);
        // odcinki nad pokładem (rysunek ściska je w pionie × 0,42 razem ze środkiem ziarna, bryłki nie): pionowo też w świetle
        if (seg === PIPE_SEG.pier || seg === PIPE_SEG.boom) assert.ok(0.42 * vertB + g <= 0.42 * light - 1.5, `odcinek ${seg}: pionowo ${vertB.toFixed(1)} j. (ścisk) + bryłka w świetle`);
        // pozycja z początku kroku: na tej samej spirali, cofnięta o drogę kroku (bez skoku w poprzek)
        const step = Math.hypot(out[o] - out[o + 3], out[o + 1] - out[o + 4], out[o + 2] - out[o + 5]);
        assert.ok(step > 12 && step < 30, `droga kroku ziarna w rurze ${step.toFixed(1)} j.`);
        perSeg.set(seg, (perSeg.get(seg) || 0) + 1);
        seen++;
      }
    }
    assert.ok(seen > 2000, `ruda ${ore}: ziarna w oknach rury (${seen})`);
    for (const s of [PIPE_SEG.chute, PIPE_SEG.pier, PIPE_SEG.boom]) assert.ok((perSeg.get(s) || 0) > 100, `ruda ${ore}: okno odcinka ${s} pokazuje ziarna`);
  }
});

test('ruda: martwy zapas — zasuwy na jednej linii nie opróżnią zasieku; reachable() przewiduje, ile wypłynie; piec nie woła nad pustym kraterem', () => {
  for (const ore of [0, 2]) {
    const st = createOreStation({ ore, seed: 7, auto: false, start: 'away', initialStock: 300 });
    const total = st.counters().bunker;
    const live = st.reachable();
    assert.ok(live > total * 0.2 && live < total * 0.6, `ruda ${ore}: dostępne ${(live / 128).toFixed(0)} t z ${(total / 128).toFixed(0)} t`);
    assert.equal(st.liveStock(), live / 128);
    st.order(1000);
    let beltRanDry = 0;
    for (let s = 0; s < 240 * 60; s++) {
      st.step(DT);
      const S = st.state();
      if (S.furnace.dry > 2 && st.counters().belt === 0 && S.belt.run) beltRanDry++;
      if (S.furnace.dry > 6 && st.moving() === 0 && st.counters().belt === 0) break;
    }
    const c = st.counters();
    const flowed = total - c.bunker;
    assert.equal(st.balance(), 0);
    assert.equal(st.grids.bunker.unstableCount(), 0);
    // przewidywanie ostrożne: wypływa co najmniej tyle, ile obiecało, i najwyżej o 15 % więcej
    assert.ok(flowed >= live && flowed <= live * 1.15, `ruda ${ore}: wypłynęło ${(flowed / 128).toFixed(1)} t, przewidywane ${(live / 128).toFixed(1)} t`);
    assert.ok(st.reachable() < tonsToGrains(8), `ruda ${ore}: po wyschnięciu zasuw dostępne ${(st.reachable() / 128).toFixed(1)} t`);
    assert.ok(c.bunker > total * 0.4, `ruda ${ore}: martwy zapas ${(c.bunker / 128).toFixed(0)} t zostaje w zasieku`);
    assert.equal(beltRanDry, 0, 'taśma staje, gdy zasuwy są suche, a nic nie wiezie');
    assert.ok(st.state().furnace.want > 0, 'zamówienie z zewnątrz czeka na rudę');
    assert.equal(st.counters().live, st.reachable(), 'licznik „dostępne” = zapas nad martwym');
  }
  // sterownik pieca: przy zapasie dostępnym poniżej progu piec nie woła o wsad (taśma nie jedzie pusta)
  const st = createOreStation({ ore: 0, seed: 7, start: 'away', shipDelay: 1e9, initialStock: 300, tune: { furnaceFirst: 1, furnacePeriod: 5 } });
  let calls = 0;
  for (let s = 0; s < 60 * 60; s++) {
    st.step(DT);
    const S = st.state();
    if (S.furnace.calls > calls) calls = S.furnace.calls;
    if (S.furnace.dry > 1.5) assert.fail(`zasuwy suche przy zamówieniu pieca (t = ${st.time.toFixed(1)} s)`);
  }
  assert.ok(st.liveStock() < TUNE.minStock, `zapas dostępny ${st.liveStock().toFixed(0)} t poniżej progu`);
  assert.ok(st.stock() > 150, 'reszta zasieku to martwy zapas');
  assert.equal(calls, 1, 'piec wziął jeden wsad (dostępne ok. 110 t), potem czeka');
  assert.equal(st.counters().furnace, tonsToGrains(TUNE.charge), 'wsad dojechał cały');
  assert.equal(st.state().furnace.want, 0);
});

test('ruda: sufit zasieku — kopiec 900 t stromej rudy pod y = 116; głód pieca nad martwym zapasem sprowadza statek', () => {
  const apex = (st) => { const g = st.grids.bunker; let top = -1e9; for (let c = 0; c < g.N; c++) if (g.n[c] > 0 && g.lvl[c] > top) top = g.lvl[c]; return top * g.layer; };
  // 540 t + statek, piec stoi: glin (najstromszy) i miedź
  for (const ore of [2, 1]) {
    const st = createOreStation({ ore, seed: 4, initialStock: 540, tune: { minStock: 1e9 } });
    let top = -1e9;
    for (let s = 0; s < 200 * 60; s++) {
      st.step(DT);
      if (s % 30 === 0) top = Math.max(top, apex(st));
      if (st.shipState !== 'dock' && st.moving() === 0 && st.pipe.count === 0) break;
    }
    assert.equal(st.counters().bunker, tonsToGrains(900));
    assert.equal(st.state().ship.trips, 1, 'przy 900 t następny statek nie przylatuje');
    assert.ok(Math.max(top, apex(st)) < 116, `ruda ${ore}: wierzchołek kopca 900 t na y = ${Math.max(top, apex(st)).toFixed(0)}`);
  }
  // glin, zapas 900 t od początku (kopiec z rozbiegu): martwy zapas ponad 540 t — piec bierze do sucha, potem statek z głodu
  const st = createOreStation({ ore: 2, seed: 4, start: 'away', initialStock: 900, tune: { furnaceFirst: 1, furnacePeriod: 6 } });
  let top = -1e9;
  let stockAtCall = 0;
  let dryMax = 0;
  for (let s = 0; s < 300 * 60 && st.state().ship.trips < 2; s++) {
    st.step(DT);
    if (st.balance() !== 0) assert.fail(`bilans ${st.balance()}`);
    const S = st.state();
    if (S.furnace.dry > dryMax) dryMax = S.furnace.dry;
    if (S.ship.trips === 1 && stockAtCall === 0) stockAtCall = st.stock();
    if (s % 30 === 0) top = Math.max(top, apex(st));
  }
  assert.ok(st.state().ship.trips >= 1, 'statek przyleciał mimo zapasu ponad 540 t (piec dobrał dostępny zapas, został martwy)');
  assert.ok(stockAtCall > 540 && stockAtCall + TUNE.shipLoad <= TUNE.hardCap, `statek wezwany przy ${stockAtCall.toFixed(0)} t w zasieku`);
  // wsad niepełny z końcówki dostępnego zapasu może nie wypłynąć cały (przewidywanie ma kilka ton błędu) — zamówienie
  // czeka wtedy na statek: zasuwy suche najwyżej przez czas jego dojazdu i pierwszej rudy z wylotu
  assert.ok(dryMax < 40, `zasuwy suche najdłużej ${dryMax.toFixed(1)} s`);
  for (let s = 0; s < 90 * 60; s++) { st.step(DT); if (s % 30 === 0) top = Math.max(top, apex(st)); }
  assert.ok(top < 116, `wierzchołek w całym cyklu na y = ${top.toFixed(0)}`);
});

test('ruda: pułapki sterowania z zewnątrz — załadunek przed wezwaniem statku, liczby niepoprawne w order / take, krata pełna po sufit', () => {
  // loadShip() przy statku w drodze, potem pętla statków idzie dalej (ładunek jest przyjmowany, nie blokuje wezwania)
  const st = createOreStation({ ore: 0, seed: 7, start: 'away', shipDelay: 5, initialStock: 200, tune: { minStock: 1e9 } });
  const loaded0 = st.counters().loaded;
  assert.equal(st.loadShip(), true);
  assert.equal(st.counters().hold, SHIP);
  assert.equal(st.loadShip(), false);
  for (let s = 0; s < 30 * 60; s++) st.step(DT);
  assert.equal(st.shipState, 'dock', 'statek z ładunkiem załadowanym z zewnątrz podszedł do pirsu');
  assert.equal(st.state().ship.trips, 1);
  assert.equal(st.counters().loaded, loaded0 + SHIP, 'ładunek policzony raz');
  assert.equal(st.balance(), 0);
  // order / take: NaN, liczby ujemne i zero nic nie zmieniają
  const q = createOreStation({ ore: 0, seed: 7, auto: false, start: 'away', initialStock: 300 });
  q.order(20);
  for (let s = 0; s < 30 * 60; s++) q.step(DT);
  const before = q.counters().furnace;
  assert.equal(before, 2560);
  for (const bad of [NaN, -5, 0, undefined, -Infinity]) { assert.equal(q.take(bad), 0); assert.equal(q.order(bad), 0); }
  assert.equal(q.counters().furnace, before);
  assert.equal(q.state().furnace.want, 0);
  assert.equal(q.balance(), 0);
  assert.equal(q.take(0.004), 0, 'mniej niż jedno ziarno');
  assert.equal(q.take(Infinity), 20, 'nie więcej niż leży w galerii');
  assert.equal(q.balance(), 0);
  // krata pełna po sufit: tryb szybki i settleAll szukają kolumny z miejscem (ziarno nie ląduje ponad pojemnością stosu)
  const g = createGrid({ nx: 9, nz: 9, x0: 0, z0: 0, floor: 0, wallY: 1e4, maxLayers: 8, salt: 1, tan: 5 });
  for (let c = 0; c < g.N; c++) if (Math.abs((c % 9) - 4) <= 2 && Math.abs(Math.floor(c / 9) - 4) <= 2) for (let k = 0; k < 6; k++) g.pushHashed(c, 1);
  const room = g.findRoom(4 * 9 + 4);
  assert.ok(room >= 0 && g.n[room] < 6, 'blok 5 × 5 pełnych kolumn: miejsce w pierścieniu dalej');
  assert.equal(g.findRoom(0), 0);
});

test('ruda: krok KOLEJNEGO stanowiska w tym samym izolacie alokuje najwyżej ok. 100 B (tablice typowane, pule) — rozładunek z odbiorem', async () => {
  // W tym procesie testów powstało już wiele stanowisk: domknięcia stanowiska nie są wtedy „jedyne” dla V8 i krok
  // alokuje ok. 70 B (liczby zmiennoprzecinkowe w kontekście domknięcia). Pierwsze stanowisko w izolacie nie alokuje
  // wcale — sprawdza to następny test (tak pracuje demo: jeden worker = jedno stanowisko).
  const st = createOreStation({ ore: 0, seed: 7, initialStock: 250, tune: { furnaceFirst: 3 } });
  const warm = () => { for (let s = 0; s < 30; s++) st.step(DT); };
  for (let s = 0; s < 600; s++) st.step(DT);
  // pomiar liczy się tylko w oknie, w którym leci ponad 500 ciał (rozładunek); okno w spoczynku nie alokuje z definicji.
  // Sam pomiar (dwa odczyty statystyk sterty) kosztuje ok. 2,5 kB — próg 8 kB na 60 kroków to mniej niż 100 B na krok.
  let windows = 0;
  const measure = () => {
    const before = st.moving();
    const bytes = allocatedBytes(() => st.step(DT), 60);
    if (before < 500 || st.moving() < 500) return Infinity;
    windows++;
    return bytes;
  };
  const per60 = await untilSteady(measure, (b) => b < 8192, { warm, rounds: 60, pauseMs: 50 });
  assert.ok(windows > 0, 'pomiar trafił w czas rozładunku');
  assert.ok(per60 < 8192, `alokacje ${per60} B na 60 kroków`);
});

test('ruda: PIERWSZE stanowisko w izolacie V8 nie alokuje w kroku ani w migawce (demo: jeden worker = jedno stanowisko)', async () => {
  const { Worker } = await import('node:worker_threads');
  const stUrl = new URL('../dema/ring-dzielnice/huta/ruda/stanowisko.js', import.meta.url).href;
  const alUrl = new URL('./helpers/alokacje.mjs', import.meta.url).href;
  // świeży izolat (wątek roboczy Node): jedno stanowisko, okna po 600 kroków w czasie rozładunku (ponad 300 ciał w ruchu)
  const code = `
    import { parentPort } from 'node:worker_threads';
    import { createOreStation } from ${JSON.stringify(stUrl)};
    import { allocatedBytes, untilSteady } from ${JSON.stringify(alUrl)};
    const s = createOreStation({ ore: 0, seed: 7, initialStock: 250, tune: { furnaceFirst: 3 } });
    const snap = s.createSnapshot();
    for (let k = 0; k < 900; k++) { s.step(1 / 60); s.snapshot(snap); }
    let windows = 0;
    const measure = (withSnap) => () => {
      const before = s.moving();
      const b = allocatedBytes(withSnap ? () => { s.step(1 / 60); s.snapshot(snap); } : () => s.step(1 / 60), 600);
      if (before < 300 || s.moving() < 300) return Infinity;
      windows++;
      return b;
    };
    const warm = () => { for (let k = 0; k < 30; k++) { s.step(1 / 60); s.snapshot(snap); } };
    const step = await untilSteady(measure(false), (b) => b < 8192, { warm, rounds: 30, pauseMs: 50 });
    const both = await untilSteady(measure(true), (b) => b < 8192, { warm, rounds: 30, pauseMs: 50 });
    parentPort.postMessage({ step, both, windows, balance: s.balance() });
  `;
  const res = await new Promise((ok, bad) => {
    const w = new Worker(new URL(`data:text/javascript,${encodeURIComponent(code)}`));
    w.once('message', ok);
    w.once('error', bad);
  });
  assert.ok(res.windows >= 2, 'pomiar trafił w czas rozładunku');
  assert.equal(res.balance, 0);
  // sam pomiar kosztuje ok. 2,5 kB; drugie stanowisko w izolacie dawało ok. 41 kB na 600 kroków (krok) i 190–930 kB (z migawką)
  assert.ok(res.step < 8192, `krok: ${res.step} B na 600 kroków`);
  assert.ok(res.both < 8192, `krok z migawką: ${res.both} B na 600 kroków`);
});

test('ruda: obraz — WGSL wszystkich materiałów buduje się w Node; sceny brył bez NaN, ładownia od dna pod pokładem po zrębnicę', async () => {
  const THREE = await import('three/webgpu');
  const { snapLayout } = await import('../dema/ring-dzielnice/huta/ruda/ruda.worker.js');
  const { RudaObraz } = await import('../dema/ring-dzielnice/huta/ruda/obraz.js');
  const { RudaPyl } = await import('../dema/ring-dzielnice/huta/ruda/pyl.js');
  const { buildOreYardScene, buildOrePierScene, buildOreVacScene } = await import('../dema/ring-dzielnice/huta/ruda/scena.js');
  const { resolvePortBuildingStyle } = await import('../src/3d/portBuildings/portBuildingStyle.js');
  const { PB_MAX_GROUPS } = await import('../dema/ring-dzielnice/kit/sceny.js');
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const build = (mesh) => {
    const b = renderer.backend.createNodeBuilder(mesh, renderer);
    b.material = mesh.material;
    b.scene = new THREE.Scene();
    b.camera = new THREE.PerspectiveCamera();
    b.context.material = mesh.material;
    b.build();
    return { vertex: b.vertexShader, fragment: b.fragmentShader };
  };
  const geo = createStationGeometry();
  const st = createOreStation({ ore: 0, prewarm: false, start: 'away' });
  const layout = snapLayout(st.createSnapshot());
  const obraz = new RudaObraz({ root: new THREE.Group(), geo, tune: TUNE, sunDir: new THREE.Vector3(0.3, 0.3, 0.9).normalize(), layout });
  obraz.setSun(-0.6, 0.75, 0.25);
  const pyl = new RudaPyl({ bgGroup: obraz.bgGroup, fgGroup: obraz.fgGroup });
  const seen = new Map();
  for (const m of [...obraz.warmupMeshes(), ...pyl.warmupMeshes()]) {
    if (seen.has(m.material)) continue;
    const w = build(m);
    seen.set(m.material, w);
    assert.ok(w.vertex.length > 500 && w.fragment.length > 200, `${m.material.name}: kod WGSL`);
    assert.ok(m.name && m.material.name, 'siatka i materiał mają nazwy (lista pipeline’ów w demie)');
  }
  const names = [...seen.keys()].map((m) => m.name).sort();
  assert.deepEqual(names, ['RudaCienDzwonu', 'RudaCienZiarna', 'RudaLukGlebia', 'RudaPodkladLadownia', 'RudaPodkladZasiek', 'RudaPokladGlebia', 'RudaPyl', 'RudaTasma', 'RudaWykladzinaLadowni', 'RudaZiarnoRuch', 'RudaZiarnoStos']);
  // „gumka głębi” luku pisze głębię dalekiej płaszczyzny, znaczek pokładu — zwykłą; obie bez koloru
  assert.ok(seen.get(obraz.eraser.material).fragment.includes('frag_depth'), 'gumka głębi luku pisze głębię fragmentu');
  assert.ok(!seen.get(obraz.deckStamp.material).fragment.includes('frag_depth'));
  assert.equal(obraz.eraser.material.colorWrite, false);
  assert.equal(obraz.deckStamp.material.colorWrite, false);
  assert.ok(obraz.eraser.renderOrder < obraz.deckStamp.renderOrder && obraz.deckStamp.renderOrder < 0, 'głębia luku i pokładu rysują się przed ładownią');
  // cień ziarna pada od słońca
  assert.ok(obraz.U.shadow.value.x > 0 && obraz.U.shadow.value.y < 0);

  // sceny brył stałych: bez NaN, grupy w limicie zestawu, ściany ładowni od dna (50 j. pod pokładem) po zrębnicę (50 j. nad)
  const style = resolvePortBuildingStyle('earth');
  const scenes = { zasiek: buildOreYardScene(geo, style), pirs: buildOrePierScene(geo), odkurzacz: buildOreVacScene(geo) };
  for (const [name, sc] of Object.entries(scenes)) {
    let bad = 0;
    for (const set of Object.values(sc.sets)) for (const arr of Object.values(set)) for (const v of arr) if (!Number.isFinite(v)) bad++;
    assert.equal(bad, 0, `scena ${name}: bez NaN`);
    assert.ok(sc.instances > 100, `scena ${name}: ${sc.instances} instancji`);
  }
  const vac = scenes.odkurzacz;
  assert.ok(Math.max(...Object.values(vac.rig).filter((v) => typeof v === 'number')) < PB_MAX_GROUPS);
  const boxes = vac.sets.fg.box;
  let wallLo = 1e9;
  let wallHi = -1e9;
  for (let i = 0; i < boxes.length; i += 20) {
    if (boxes[i + 12] !== vac.rig.ship) continue;
    wallLo = Math.min(wallLo, boxes[i + 1] - boxes[i + 5] / 2);
    wallHi = Math.max(wallHi, boxes[i + 1] + boxes[i + 5] / 2);
  }
  assert.ok(wallLo < geo.hold.floorY - geo.ship.deck + 1 && wallHi > geo.hold.coamingY - geo.ship.deck, `ściany ładowni ${wallLo.toFixed(0)}…${wallHi.toFixed(0)} j. względem pokładu`);
  // okno wysięgnika: klatka szersza niż światło strugi, rury w promieniach z geometrii
  assert.ok(geo.pipe.slideR + 1 > geo.pipe.light[PIPE_SEG.boom] && geo.pipe.boomR > geo.pipe.slideR);
});

test('ruda: czas kroku 1/60 s — rozładunek z odbiorem < 4 ms, tryb szybki < 1 ms (średnio)', WYDAJNOSC, () => {
  const st = createOreStation({ ore: 0, seed: 7 });
  for (let s = 0; s < 600; s++) st.step(DT);
  let t0 = performance.now();
  let n = 0;
  let peak = 0;
  for (let s = 0; s < 40 * 60; s++) { st.step(DT); n++; if (st.moving() > peak) peak = st.moving(); }
  const body = (performance.now() - t0) / n;
  const f = createOreStation({ ore: 0, seed: 7, fast: true });
  for (let s = 0; s < 600; s++) f.step(DT);
  t0 = performance.now();
  for (let s = 0; s < 60 * 60; s++) f.step(DT);
  const fast = (performance.now() - t0) / 3600;
  assert.ok(body < 4, `tryb z ciałami ${body.toFixed(2)} ms na krok (do ${peak} ciał)`);
  assert.ok(fast < 1, `tryb szybki ${fast.toFixed(3)} ms na krok`);
});
