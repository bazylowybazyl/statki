// Limit klatek (src/render/frameLimiter.js, Opcje → Grafika 2026-10-29): które wywołania rAF rysują klatkę. Symulacja
// pętli strony przy vsync: znaczniki rAF na siatce okresu ekranu, następne wywołanie na pierwszym vsyncu po końcu pracy
// (klatka narysowana kosztuje, pominięta prawie nic) — miarą równego taktu są odstępy narysowanych klatek w vsyncach.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameLimiter, FRAME_LIMIT_TUNE } from '../src/render/frameLimiter.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// hz — ekran; cost(r) — czas wywołania narysowanego [ms]; skipCost — pominiętego; zwraca odstępy (w vsyncach) po rozbiegu
function runVsync(lim, { hz, ticks = 4000, cost = () => 2, skipCost = 0.05, warm = 50, seed = 1 }) {
  const rnd = rng(seed);
  const V = 1000 / hz;
  let v = 1000;
  const drawn = [];
  for (let i = 0; i < ticks; i++) {
    const now = v * V;
    const d = lim.tick(now);
    if (d) drawn.push(v);
    const c = d ? cost(rnd) : skipCost;
    v = Math.max(v + 1, Math.ceil((now + c) / V - 1e-9));
  }
  const gaps = new Map();
  for (let i = warm + 1; i < drawn.length; i++) {
    const k = drawn[i] - drawn[i - 1];
    gaps.set(k, (gaps.get(k) || 0) + 1);
  }
  const fps = (drawn.length - warm - 1) / ((drawn[drawn.length - 1] - drawn[warm]) * V / 1000);
  return { gaps, fps, drawn };
}
const only = (gaps) => [...gaps.keys()];

test('240 Hz, limit 120 / 60: co 2. / co 4. klatka ekranu — każdy odstęp ten sam', () => {
  const a = new FrameLimiter({ fps: 120 });
  const r = runVsync(a, { hz: 240 });
  assert.equal(a.mode, 'nth');
  assert.equal(a.every, 2);
  assert.deepEqual(only(r.gaps), [2]);
  assert.ok(Math.abs(r.fps - 120) < 0.01, `kl/s ${r.fps}`);
  const h = a.stats.hist;
  assert.equal(h.reduce((s, x) => s + x, 0), h[2], 'hist: wszystkie odstępy (od znanego okresu) po 2 okresy');
  assert.ok(h[2] > 1900);
  const b = new FrameLimiter({ fps: 60 });
  assert.deepEqual(only(runVsync(b, { hz: 240 }).gaps), [4]);
  assert.equal(b.every, 4);
  assert.equal(b.describe(), '60 · co 4. klatka ekranu 240 Hz');
});

test('239,76 Hz, limit 60: co 4. klatka (59,94 kl/s) — sam akumulator czasu co ~2 s rysowałby po 3 vsyncach', () => {
  const lim = new FrameLimiter({ fps: 60 });
  const r = runVsync(lim, { hz: 239.76, ticks: 30000 });
  assert.equal(lim.mode, 'nth');
  assert.deepEqual(only(r.gaps), [4]);
  assert.ok(Math.abs(r.fps - 59.94) < 0.01, `kl/s ${r.fps}`);
  // ten sam przebieg bez progu wielokrotności (tolerancja 0 → akumulator): przycięcia
  const acc = new FrameLimiter({ fps: 60, tune: { ...FRAME_LIMIT_TUNE, tolerance: 0 } });
  const ra = runVsync(acc, { hz: 239.76, ticks: 30000 });
  assert.equal(acc.mode, 'acc');
  assert.ok((ra.gaps.get(3) || 0) >= 10, `odstępy po 3 vsynce: ${ra.gaps.get(3) || 0}`);
});

test('chybione vsynce: klatka narysowana dłuższa niż okres — takt zostaje równy (okres = mediana skupiska najkrótszych odstępów)', () => {
  // 4,5 ms > 4,17 ms — każda narysowana chybia następnego vsynca: rAF co 8,33 ms, każde wywołanie rysuje
  const heavy = new FrameLimiter({ fps: 120 });
  const r = runVsync(heavy, { hz: 240, cost: () => 4.5 });
  assert.deepEqual(only(r.gaps), [2]);
  // na granicy (3,9–4,5 ms): raz wywołanie pominięte na następnym vsyncu, raz chybione — dalej co 2 okresy
  const mixed = new FrameLimiter({ fps: 120 });
  const m = runVsync(mixed, { hz: 240, cost: (rnd) => 3.9 + 0.6 * rnd(), ticks: 6000 });
  assert.equal(mixed.mode, 'nth');
  assert.ok(Math.abs(mixed.hz - 240) < 0.01, 'okres ekranu mimo przewagi odstępów 2-okresowych');
  assert.deepEqual(only(m.gaps), [2]);
  // limit 60, klatka 12 ms (prawie 3 okresy) — dalej co 4
  const slow = new FrameLimiter({ fps: 60 });
  assert.deepEqual(only(runVsync(slow, { hz: 240, cost: () => 12 }).gaps), [4]);
});

test('144 Hz, limit 60 / 240 Hz, limit 144: akumulator — średnio dokładnie limit, odstępy dwóch sąsiednich długości', () => {
  const a = new FrameLimiter({ fps: 60 });
  const r = runVsync(a, { hz: 144, ticks: 8000 });
  assert.equal(a.mode, 'acc');
  assert.ok(Math.abs(r.fps - 60) < 0.05, `kl/s ${r.fps}`);
  assert.deepEqual(only(r.gaps).sort(), [2, 3]);
  assert.match(a.describe(), /takt nierówny/);
  const b = new FrameLimiter({ fps: 144 });
  const rb = runVsync(b, { hz: 240, ticks: 8000 });
  assert.equal(b.mode, 'acc');
  assert.ok(Math.abs(rb.fps - 144) < 0.1, `kl/s ${rb.fps}`);
  assert.deepEqual(only(rb.gaps).sort(), [1, 2]);
});

test('ekran nie szybszy niż limit: każda klatka (60 Hz przy limicie 120, 144 Hz przy 144, 240 Hz przy 240)', () => {
  for (const [hz, fps] of [[60, 120], [144, 144], [240, 240], [143.9, 144]]) {
    const lim = new FrameLimiter({ fps });
    const r = runVsync(lim, { hz });
    assert.equal(lim.mode, 'every', `${hz} Hz / ${fps}`);
    assert.deepEqual(only(r.gaps), [1], `${hz} Hz / ${fps}`);
  }
});

test('bez limitu: każda klatka, okres ekranu znany (PerfHUD); zmiana limitu w biegu bez rozbiegu', () => {
  const lim = new FrameLimiter();
  assert.equal(lim.mode, 'off');
  runVsync(lim, { hz: 240, ticks: 200 });
  assert.equal(lim.stats.drawn, 200);
  assert.ok(Math.abs(lim.hz - 240) < 0.01);
  assert.equal(lim.describe(), 'bez limitu · ekran 240 Hz');
  lim.setFps(120);
  assert.equal(lim.mode, 'nth', 'okres znany — od razu co N-ta');
  lim.setFps('x');
  assert.equal(lim.fps, 0);
  assert.equal(lim.mode, 'off');
});

test('okres nieznany (mniej niż 8 odstępów) — każda klatka; przerwa > 100 ms (karta w tle) — rysuj od razu, bez serii', () => {
  const lim = new FrameLimiter({ fps: 60 });
  const V = 1000 / 240;
  // 8 wywołań = 7 odstępów: okres jeszcze nieznany
  for (let i = 0; i < 8; i++) assert.equal(lim.tick(1000 + i * V), true, `wywołanie ${i}`);
  assert.equal(lim.mode, 'every');
  let t = 1000 + 8 * V, drawn = 0;
  for (let i = 0; i < 40; i++, t += V) drawn += lim.tick(t) ? 1 : 0;
  assert.equal(lim.mode, 'nth');
  assert.equal(drawn, 10);
  // karta w tle 2 s: pierwsze wywołanie po powrocie rysuje, następne znowu co 4
  t += 2000;
  const after = [];
  for (let i = 0; i < 12; i++, t += V) after.push(lim.tick(t) ? 1 : 0);
  assert.deepEqual(after, [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
});

test('ten sam znacznik dwa razy (wywołania szybciej niż rozdzielczość zegara — budzik bez VSync): czas nie płynie, bez drugiej klatki', () => {
  for (const [fps, vsync] of [[60, true], [120, false], [60, false]]) {
    const lim = new FrameLimiter({ fps, vsync });
    const V = 1000 / 240;
    for (let i = 0; i < 20; i++) lim.tick(1000 + i * V);
    const t = 1000 + 20 * V;
    let drawn = 0;
    for (let i = 0; i < 10; i++) drawn += lim.tick(t) ? 1 : 0;
    assert.ok(drawn <= 1, `${fps} ${vsync ? 'z VSync' : 'bez VSync'}: ${drawn} klatek w tej samej chwili`);
  }
  // bez VSync: wywołania co 0–5 µs przez czekanie (kolejka MessageChannel) — średnio dokładnie limit
  const lim = new FrameLimiter({ fps: 120, vsync: false });
  let t = 1000, drawn = 0;
  const rnd = rng(7);
  for (let i = 0; i < 400000; i++) { if (lim.tick(t)) drawn++; t += rnd() < 0.5 ? 0 : 0.005; }
  const rate = drawn / ((t - 1000) / 1000);
  assert.ok(Math.abs(rate - 120) / 120 < 0.01, `${rate.toFixed(2)} kl/s`);
});

test('bez VSync (rAF bez taktu ekranu): limit czasem — średnio dokładnie limit, waitMs do następnej klatki', () => {
  for (const fps of [240, 144, 120, 60]) {
    const lim = new FrameLimiter({ fps, vsync: false });
    assert.equal(lim.mode, 'time');
    const rnd = rng(fps);
    const I = 1000 / fps;
    let t = 1000;
    const drawn = [];
    for (let i = 0; i < 60000; i++) {
      if (lim.tick(t)) drawn.push(t);
      else {
        const w = lim.waitMs();
        assert.ok(w >= 0 && w <= I, `waitMs ${w}`);
      }
      t += 0.2 + 1.3 * rnd();   // wywołania rAF co 0,2–1,5 ms (pusta klatka, bez vsync)
    }
    const span = drawn[drawn.length - 1] - drawn[10];
    const rate = (drawn.length - 11) / (span / 1000);
    assert.ok(Math.abs(rate - fps) / fps < 0.01, `${fps}: ${rate.toFixed(2)} kl/s`);
    let minGap = Infinity;
    for (let i = 11; i < drawn.length; i++) minGap = Math.min(minGap, drawn[i] - drawn[i - 1]);
    assert.ok(minGap >= I - 0.5 - 1.5 - 1e-9, `${fps}: najkrótszy odstęp ${minGap.toFixed(2)} ms`);
  }
  // pętla gry śpi: wywołanie rAF tuż przed czasem (setTimeout krótszy o 2 ms) — klatka w progu 0,5 ms
  const lim = new FrameLimiter({ fps: 120, vsync: false });
  assert.equal(lim.tick(1000), true);
  assert.equal(lim.tick(1001), false);
  const w = lim.waitMs();
  assert.ok(Math.abs(w - (1000 / 120 - 0.5 - 1)) < 1e-9, `waitMs ${w}`);
  assert.equal(lim.tick(1001 + w), true, 'w chwili z waitMs — rysuje');
  assert.equal(lim.describe(), '120 · bez VSync — zegar');
  assert.equal(new FrameLimiter({ fps: 120 }).waitMs(), 0, 'z VSync — czeka takt ekranu');
});

test('VSync przełączony w biegu: tryb od nowa (setVsync)', () => {
  const lim = new FrameLimiter({ fps: 120 });
  runVsync(lim, { hz: 240, ticks: 100 });
  assert.equal(lim.mode, 'nth');
  lim.setVsync(false);
  assert.equal(lim.mode, 'time');
  lim.setVsync(true);
  assert.equal(lim.mode, 'nth');
});

test('drgania znaczników rAF (±0,15 ms — headless z taktem): okres bez zaniżenia, co N-ta klatka zamiast akumulatora', () => {
  // minimum odstępów dawało ~247 Hz przy 241 Hz (pomiar 2026-10-29) — limit 120 wypadał na granicy tolerancji (2,06)
  for (const hz of [240, 241]) {
    const lim = new FrameLimiter({ fps: 120 });
    const rnd = rng(hz);
    const V = 1000 / hz;
    const drawn = [];
    for (let i = 0; i < 6000; i++) {
      const now = 1000 + i * V + (rnd() - 0.5) * 0.3;
      if (lim.tick(now)) drawn.push(i);
    }
    assert.ok(Math.abs(lim.hz - hz) / hz < 0.01, `${hz} Hz: oszacowanie ${lim.hz.toFixed(1)}`);
    assert.equal(lim.mode, 'nth', `${hz} Hz`);
    let other = 0;
    for (let i = 21; i < drawn.length; i++) if (drawn[i] - drawn[i - 1] !== 2) other++;
    assert.equal(other, 0, `${hz} Hz: odstępy inne niż 2`);
  }
});

test('pojedynczy fałszywie krótki odstęp nie wyznacza okresu', () => {
  const lim = new FrameLimiter({ fps: 120 });
  const V = 1000 / 240;
  let t = 1000;
  for (let i = 0; i < 40; i++, t += V) lim.tick(t);
  lim.tick(t - V + 0.6);   // znacznik 0,6 ms po poprzednim
  for (let i = 0; i < 40; i++, t += V) lim.tick(t);
  assert.ok(Math.abs(lim.hz - 240) < 1, `oszacowanie ${lim.hz.toFixed(1)} Hz`);
  assert.equal(lim.mode, 'nth');
});

test('bypass: zegar wirtualny harnessu (znaczniki stoją albo skaczą o krok) — każde wywołanie rysuje, stan limitu bez zmian', () => {
  let virtual = false;
  const lim = new FrameLimiter({ fps: 120 });
  lim.bypass = () => virtual;
  const V = 1000 / 240;
  let t = 1000;
  for (let i = 0; i < 100; i++, t += V) lim.tick(t);
  assert.equal(lim.mode, 'nth');
  const st = { ticks: lim.stats.ticks, drawn: lim.stats.drawn };
  // zegar 'frozen': ten sam znacznik — bez ominięcia limit po klatce narysowanej nie rysowałby już nic (since = 0)
  virtual = true;
  let drawn = 0;
  for (let i = 0; i < 20; i++) drawn += lim.tick(t) ? 1 : 0;
  // zegar 'step': krok 16,67 ms na klatkę
  for (let i = 0; i < 20; i++) drawn += lim.tick(t += 1000 / 60) ? 1 : 0;
  assert.equal(drawn, 40);
  assert.deepEqual({ ticks: lim.stats.ticks, drawn: lim.stats.drawn }, st, 'statystyki bez wywołań harnessu');
  assert.ok(Math.abs(lim.hz - 240) < 0.5, 'okres ekranu z prawdziwych odstępów');
  // zegar wraca do 'real': przerwa > 100 ms — klatka od razu, potem co 2. klatka ekranu
  virtual = false;
  const after = [];
  for (let i = 0; i < 8; i++) after.push(lim.tick(t += V) ? 1 : 0);
  assert.deepEqual(after, [1, 0, 1, 0, 1, 0, 1, 0]);
  // bez ominięcia (stan sprzed poprawki): ten sam znacznik po klatce narysowanej — tło stoi
  const raw = new FrameLimiter({ fps: 120 });
  let r = 1000;
  for (let i = 0; i < 100; i++, r += V) raw.tick(r);
  while (!raw.tick(r)) r += V;
  let frozen = 0;
  for (let i = 0; i < 20; i++) frozen += raw.tick(r) ? 1 : 0;
  assert.equal(frozen, 0);
});

test('forceNext: najbliższe wywołanie rysuje (zmiana rozmiaru okna wyczyściła kanwę), takt liczy się od niego', () => {
  const V = 1000 / 240;
  for (const [fps, vsync] of [[120, true], [60, true], [144, true], [120, false]]) {
    const name = `${fps} ${vsync ? 'z VSync' : 'bez VSync'}`;
    const a = new FrameLimiter({ fps, vsync }), b = new FrameLimiter({ fps, vsync });
    let t = 1000;
    for (let i = 0; i < 200; i++, t += V) { a.tick(t); b.tick(t); }
    while (!(a.tick(t) & b.tick(t))) t += V;   // klatka narysowana w obu
    t += V;
    b.forceNext();
    assert.equal(a.tick(t), false, `${name}: bez wymuszenia wywołanie po klatce narysowanej pominięte`);
    assert.equal(b.tick(t), true, `${name}: po forceNext — klatka`);
    // następna narysowana po wymuszonej — po pełnym interwale limitu (w okresach ekranu: N albo najbliższy vsync)
    let k = 0;
    do { t += V; k++; } while (!b.tick(t));
    if (b.mode === 'nth') assert.equal(k, b.every, `${name}: co ${b.every}. od wymuszonej`);
    else assert.ok(k * V >= 1000 / fps - Math.max(0.5 * b.periodMs, 0.5) - 1e-9, `${name}: ${(k * V).toFixed(2)} ms po wymuszonej`);
  }
  // wymuszenie zużywa się raz; bez limitu — bez zmian
  const lim = new FrameLimiter({ fps: 120 });
  let t = 1000;
  for (let i = 0; i < 100; i++, t += V) lim.tick(t);
  while (!lim.tick(t)) t += V;
  lim.forceNext();
  assert.deepEqual([lim.tick(t + V), lim.tick(t + 2 * V)], [true, false]);
  const off = new FrameLimiter();
  off.forceNext();
  assert.equal(off.tick(1000), true);
});
