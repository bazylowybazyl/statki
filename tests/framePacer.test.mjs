// Stały wiek obrazu 3D w kompozycji B2cr (src/render/framePacer.js, audyt renderu 2026-10-17): symulacja pętli strony
// (takt vsync), workera o zmiennym czasie klatki i składania — złożenie od razu po przyjściu (dawniej) ↔ kolejka z
// wiekiem docelowym (pacer). Miarą płynności są kroki treści: ile klatek strony przybyło między kolejnymi vsyncami.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FramePacer } from '../src/render/framePacer.js';

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
