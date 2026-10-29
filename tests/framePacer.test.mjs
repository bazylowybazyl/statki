// Stały wiek obrazu 3D w kompozycji B2cr (src/render/framePacer.js, audyt renderu 2026-10-17): symulacja pętli strony
// (takt vsync), workera o zmiennym czasie klatki i składania — złożenie od razu po przyjściu (dawniej) ↔ kolejka z
// wiekiem docelowym (pacer). Miarą płynności są kroki treści: ile klatek strony przybyło między kolejnymi vsyncami.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FramePacer } from '../src/render/framePacer.js';
import { FrameLimiter } from '../src/render/frameLimiter.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// V — okres vsync [ms]; post — chwila wysyłki strony od vsynca (losowo [post0, post1], w klatce z krokiem fizyki
// [phys0, phys1] — jak w pomiarze w oknie 240 Hz); work — czas klatki workera (losowo [w0, w1]); worker bierze strony
// po kolei (kolejka wiadomości), bitmapa wraca od razu i jest składana przy najbliższym vsyncu.
function simulate({ frames = 4000, V = 1000 / 240, post0 = 0.8, post1 = 1.6, physEvery = 4, phys0 = 3.5, phys1 = 5.0, w0 = 2.4, w1 = 4.0, pacer = null, seed = 1 }) {
  const rnd = rng(seed);
  const arrivals = [];   // { k, at }
  let workerFree = 0;
  const pending = [];
  let shown = -1;
  const shownAt = [];    // k pokazane od klatki f
  let ai = 0;
  for (let f = 0; f < frames; f++) {
    const t = f * V;
    // bitmapy, które przyszły przed tym vsynciem (wątek główny wolny między klatkami)
    while (ai < arrivals.length && arrivals[ai].at <= t) {
      const a = arrivals[ai++];
      if (pacer) { pacer.arrived(a.k); pending.push(a.k); } else shown = a.k;
    }
    if (pacer) {
      pacer.beginFrame();
      let pick = -1, j = 0;
      for (; j < pending.length; j++) { if (pacer.eligible(pending[j])) pick = pending[j]; else break; }
      if (pick >= 0) { pending.splice(0, j); shown = pick; pacer.composed(pick); }
    }
    shownAt.push(shown);
    // strona k = f wysłana w tej klatce
    const k = f;
    if (pacer) pacer.posted(k);
    // klatka z krokiem fizyki (60 Hz przy 240 Hz — co czwarta) wysyła stronę później (fizyka przed renderem)
    const phys = physEvery > 0 && f % physEvery === 0;
    const tPost = t + (phys ? phys0 + (phys1 - phys0) * rnd() : post0 + (post1 - post0) * rnd());
    const start = Math.max(tPost, workerFree);
    const done = start + w0 + (w1 - w0) * rnd();
    workerFree = done;
    arrivals.push({ k, at: done });
  }
  // kroki treści po rozgrzaniu
  let steady = 0, judder = 0;
  for (let f = 200; f < frames; f++) {
    const d = shownAt[f] - shownAt[f - 1];
    if (d === 1) steady++; else judder++;
  }
  return { steady, judder, share: judder / (steady + judder), age: pacer ? pacer.age : null, shownAt };
}

test('bez kolejki (złożenie od razu): przy 240 Hz, fizyce 60 Hz i workerze ~3 ms treść skacze w wielu klatkach', () => {
  const r = simulate({});
  assert.ok(r.share > 0.1, `udział skoków ${r.share.toFixed(3)}`);
});

test('pacer: ten sam przebieg — kroki treści równe, wiek ustala się na 3–4', () => {
  const p = new FramePacer();
  const r = simulate({ pacer: p });
  assert.ok(r.share < 0.02, `udział skoków ${r.share.toFixed(3)}`);
  assert.ok(r.age === 3 || r.age === 4, `wiek ${r.age}`);
  assert.equal(p.stats.raised >= 1, true);
});

test('pacer: szybki worker (spokój) — wiek 2, bez dodatkowego opóźnienia', () => {
  const p = new FramePacer();
  const r = simulate({ pacer: p, post0: 0.2, post1: 0.5, physEvery: 0, w0: 0.8, w1: 1.3 });
  assert.equal(r.age, 2);
  assert.ok(r.share < 0.005);
});

test('pacer: po fazie wolnego workera wiek wraca w dół', () => {
  const p = new FramePacer({ lowerWindow: 240 });
  simulate({ pacer: p, frames: 2000 });
  assert.ok(p.age >= 3);
  // ten sam pacer, szybki worker — symulacja od nowa (nowa oś stron)
  const q = new FramePacer({ lowerWindow: 240 });
  q.age = 3;
  simulate({ pacer: q, post0: 0.2, post1: 0.5, physEvery: 0, w0: 0.8, w1: 1.3, frames: 2000 });
  assert.equal(q.age, 2);
  assert.ok(q.stats.lowered >= 1);
});

test('eligible / posted: strona nieznana (stara) wolno złożyć; wiek w statystykach', () => {
  const p = new FramePacer();
  p.beginFrame();
  p.posted(10);
  assert.equal(p.eligible(10), false, 'w tej samej klatce — jeszcze nie');
  p.beginFrame();
  assert.equal(p.eligible(10), true, 'następna klatka — wiek 2');
  p.composed(10);
  assert.equal(p.stats.ageHist[2], 1);
  assert.equal(p.eligible(999), true);
});

test('pacer: przy niskim tempie obrazu wiek schodzi po czasie (lowerWindowMs), nie po 1200 przyjściach (2026-10-28)', () => {
  // 12 kl/s strony (spadek przy upadku bazy): wiek 5 = ~415 ms opóźnienia obrazu; 1200 przyjść to ~100 s
  const run = (timed) => {
    const p = new FramePacer();
    p.age = 5;
    let t = 0, f = 0;
    for (let k = 0; k < 120; k++) {
      p.beginFrame(); f++;
      p.posted(k);
      t += 1000 / 12;
      p.arrived(k, timed ? t : undefined);   // bitmapa w tej samej klatce — potrzebny wiek 2
    }
    return p;
  };
  const timed = run(true);
  assert.ok(timed.age < 5, `po 10 s przy 12 kl/s wiek ${timed.age}`);
  assert.ok(timed.stats.lowered >= 1);
  const old = run(false);
  assert.equal(old.age, 5, 'bez czasu przyjść — dawne okno 1200 przyjść');
});

test('pacer: obniżenie po czasie bez natychmiastowego powrotu — seria spóźnień siedzi jeszcze w oknie podnoszenia', () => {
  // przegląd 2026-10-28: przy ~10 przyjściach/s okno podnoszenia (64 przyjścia) sięga przed ostatnią zmianę wieku
  const p = new FramePacer();
  p.age = 4;
  let t = 0, k = 0;
  const arrive = (need) => {
    p.beginFrame(); p.posted(k);
    for (let i = 0; i < need - 2; i++) p.beginFrame();
    t += 100;
    p.arrived(k, t);
    k++;
  };
  for (let i = 0; i < 20; i++) arrive(2);
  for (let i = 0; i < 4; i++) arrive(5);   // seria spóźnień przy wieku 4 → 5
  assert.equal(p.age, 5);
  assert.equal(p.stats.raised, 1);
  for (let i = 0; i < 150; i++) arrive(2);   // 15 s czystych przyjść
  assert.ok(p.age < 5, `wiek ${p.age}`);
  assert.equal(p.stats.raised, 1, 'bez powrotu w górę po obniżeniu');
});

// LIMIT KLATEK (src/render/frameLimiter.js, 2026-10-29): strona rysuje i wysyła stronę migawki tylko w klatkach
// wybranych przez limit, a złożenie (`rwHost.present()` — pierwsza linia loop(), PRZED limitem) idzie w KAŻDYM
// wywołaniu rAF — wiek w klatkach ekranu jak bez limitu. Fizyka 60 Hz: krok w klatce, w której minęła granica 1/60 s.
// `presentEveryTick: false` — złożenie tylko w klatkach narysowanych (wariant odrzucony: ten sam takt, większe opóźnienie).
function simulateLimited({ vsyncs = 12000, hz = 240, fps = 120, post0 = 0.8, post1 = 1.6, phys0 = 3.5, phys1 = 5.0, w0 = 2.4, w1 = 4.0, seed = 1, presentEveryTick = true }) {
  const rnd = rng(seed);
  const V = 1000 / hz;
  const lim = new FrameLimiter({ fps });
  const pacer = new FramePacer();
  const arrivals = [], pending = [], shownAt = [], postV = [];
  let ai = 0, workerFree = 0, shown = -1, k = 0, physTick = -1;
  for (let i = 0; i < vsyncs; i++) {
    const t = 1000 + i * V;
    while (ai < arrivals.length && arrivals[ai].at <= t) { const a = arrivals[ai++]; pacer.arrived(a.k, a.at); pending.push(a.k); }
    const draw = lim.tick(t);
    if (draw || presentEveryTick) {
      pacer.beginFrame();
      let pick = -1, j = 0;
      for (; j < pending.length; j++) { if (pacer.eligible(pending[j])) pick = pending[j]; else break; }
      if (pick >= 0) { pending.splice(0, j); shown = pick; pacer.composed(pick); }
    }
    shownAt.push(shown);
    if (!draw) continue;
    const pt = Math.floor(t / (1000 / 60));
    const phys = pt !== physTick;
    physTick = pt;
    pacer.posted(k);
    postV[k] = i;
    const tPost = t + (phys ? phys0 + (phys1 - phys0) * rnd() : post0 + (post1 - post0) * rnd());
    const start = Math.max(tPost, workerFree);
    workerFree = start + w0 + (w1 - w0) * rnd();
    arrivals.push({ k, at: workerFree });
    k++;
  }
  // po rozbiegu: ile vsynców wisi każda strona, kroki treści (1 = strony po kolei), opóźnienie wysyłka → ekran [vsynce]
  const holds = new Map(), lat = [];
  let steps = 0, skips = 0, runStart = -1;
  for (let i = 401; i < shownAt.length; i++) {
    if (shownAt[i] === shownAt[i - 1]) continue;
    if (runStart > 0) holds.set(i - runStart, (holds.get(i - runStart) || 0) + 1);
    if (shownAt[i] - shownAt[i - 1] === 1) steps++; else skips++;
    lat.push(i - postV[shownAt[i]]);
    runStart = i;
  }
  lat.sort((a, b) => a - b);
  return { holds, steps, skips, lat50: lat[lat.length >> 1], lat95: lat[Math.floor(lat.length * 0.95)], age: pacer.age, lim };
}

test('limit klatek 120 / 60 przy 240 Hz: każda strona na ekranie dokładnie 2 / 4 vsynce, strony po kolei (bitwa i spokój)', () => {
  for (const fps of [120, 60]) {
    const N = 240 / fps;
    for (const [nazwa, o] of [['bitwa', {}], ['spokój', { post0: 0.2, post1: 0.5, phys0: 0.2, phys1: 0.5, w0: 0.8, w1: 1.3 }]]) {
      const r = simulateLimited({ fps, ...o });
      assert.equal(r.lim.mode, 'nth', `${fps} ${nazwa}`);
      assert.deepEqual([...r.holds.keys()], [N], `${fps} ${nazwa}: strona wisi ${[...r.holds.keys()]} vsynców`);
      assert.equal(r.skips, 0, `${fps} ${nazwa}: przeskoczone strony`);
      assert.ok(r.age >= 2 && r.age <= 5, `${fps} ${nazwa}: wiek ${r.age}`);
    }
  }
});

test('limit klatek: złożenie w każdym wywołaniu rAF — opóźnienie obrazu nie rośnie z limitem (wariant „tylko w narysowanych” — większe)', () => {
  for (const fps of [120, 60]) {
    const every = simulateLimited({ fps });
    const drawnOnly = simulateLimited({ fps, presentEveryTick: false });
    assert.deepEqual([...drawnOnly.holds.keys()], [240 / fps], 'ten sam równy takt');
    assert.ok(every.lat95 <= 3, `${fps}: opóźnienie p95 ${every.lat95} vsynców`);
    assert.ok(drawnOnly.lat50 > every.lat50, `${fps}: ${drawnOnly.lat50} ↔ ${every.lat50} vsynców`);
  }
  // 144 Hz, limit 60 (akumulator): strony po kolei, odstępy 2 / 3 vsynce jak klatki strony
  const acc = simulateLimited({ hz: 144, fps: 60 });
  assert.equal(acc.lim.mode, 'acc');
  assert.deepEqual([...acc.holds.keys()].sort(), [2, 3]);
  assert.equal(acc.skips, 0);
});
