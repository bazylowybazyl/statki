// Budzik limitu klatek bez VSync (src/render/frameWake.js, 2026-10-29): pętla gry strony bez rAF — FrameLimiter
// (tryb 'time') mówi, ile czekać, budzik woła klatkę. Symulacja zdarzeń bez czasu ściany: zegar, budziki strony
// (spóźnienia z modelu), kolejka MessageChannel i atrapa wątku budzika (start, gotowość, odpowiedzi) — dopięcia kolejką,
// takt, start i zamknięcie wątku, przejścia strategii.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FrameLimiter } from '../src/render/frameLimiter.js';
import { createFrameWake, frameWakeStrategyFromQuery, FRAME_WAKE_TUNE } from '../src/render/frameWake.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
// spóźnienia setTimeout: zwykle 0,1–0,4 ms; „noisy” — w 15% 5–7 ms (pomiar 2026-10-29 w grze, atrapa Electrona: p90 5–7)
const quiet = (rnd) => () => 0.1 + 0.3 * rnd();
const noisy = (rnd) => () => (rnd() < 0.15 ? 5 + 2 * rnd() : 0.1 + 0.3 * rnd());

// Atrapy: zadania { at, kind: 'timer' | 'message' } w kolejności czasu. Wątek budzika (każdy createWorker — nowy):
// sygnał gotowości (komunikat 0) po `workerStartMs`, sen do chwili należnej − spinMs (+ spóźnienie), pętla do chwili
// należnej, odpowiedź po przesyle — na KAŻDE zamówienie (stare też: strona je odrzuca); 'hang' — gotowy, ale nie
// odpowiada; 'mute' — nie zgłasza nawet gotowości. Zamknięty (terminate) albo bez handlera — nic nie dochodzi.
function env({ timerLate = () => 0.2, workerLate = () => 0.3, transit = 0.03, hopMs = 0.004, worker = 'ok', workerStartMs = 0.05 } = {}) {
  const e = { T: 1000, current: 'start', warnings: [], workers: [] };
  const tasks = [];
  let ids = 0, order = 0;
  const push = (at, kind, fn) => { const id = ++ids; tasks.push({ at, kind, fn, id, order: order++ }); return id; };
  const port1 = { onmessage: null };
  function makeWorker() {
    const wk = { onmessage: null, onerror: null, posted: 0, terminated: false,
      deliver(data) { if (!wk.terminated && wk.onmessage) wk.onmessage({ data }); },
      postMessage(m) {
        wk.posted++;
        if (worker !== 'ok' || !m || !(m[0] > 0)) return;
        const arrive = e.T + transit, due = arrive + m[1];
        const sleep = Math.floor(m[1] - m[2]);
        const woke = sleep >= 1 ? arrive + sleep + workerLate() : arrive;
        const end = Math.max(woke, due);
        push(end + transit, 'message', () => wk.deliver([m[0], end - woke]));
      },
      terminate() { wk.terminated = true; }
    };
    if (worker !== 'mute') push(e.T + workerStartMs, 'message', () => wk.deliver(0));
    e.workers.push(wk);
    return wk;
  }
  Object.defineProperty(e, 'wk', { get: () => e.workers[e.workers.length - 1] });
  e.deps = {
    now: () => e.T,
    setTimer: (fn, d) => push(e.T + d + timerLate(), 'timer', fn),
    clearTimer: (id) => { const i = tasks.findIndex((t) => t.id === id); if (i >= 0) tasks.splice(i, 1); },
    channel: { port1, port2: { postMessage: (v) => push(e.T + hopMs, 'message', () => port1.onmessage({ data: v })) } },
    createWorker: makeWorker,
    warn: (m) => e.warnings.push(m)
  };
  e.run = (until) => {
    for (;;) {
      let k = -1;
      for (let i = 0; i < tasks.length; i++) {
        if (k < 0 || tasks[i].at < tasks[k].at || (tasks[i].at === tasks[k].at && tasks[i].order < tasks[k].order)) k = i;
      }
      if (k < 0 || tasks[k].at > until) break;
      const task = tasks.splice(k, 1)[0];
      if (task.at > e.T) e.T = task.at;
      e.current = task.kind;
      task.fn();
      e.current = 'poza';
    }
  };
  return e;
}

// Pętla strony jak index.html (frameLimitTick / nextLoopFrame): klatka narysowana trwa cost() ms. `prepared` — wątek
// budzika z góry i gotowy przed pętlą (jak gra: applyFrameLimit → prepare przy starcie).
function sim({ strategy, fps = 120, cost = () => 2, ms = 4000, tune = FRAME_WAKE_TUNE, prepared = true, ...envOpts }) {
  const e = env(envOpts);
  const lim = new FrameLimiter({ fps, vsync: false });
  const drawn = [];
  const wakeKinds = {};
  let wake = null;
  function loop(now) {
    wakeKinds[e.current] = (wakeKinds[e.current] || 0) + 1;
    if (!lim.tick(now)) { wake.schedule(lim.waitMs(now)); return; }
    drawn.push(now);
    e.T += cost();
    wake.schedule(lim.waitMs(e.T));
  }
  wake = createFrameWake({ onWake: () => loop(e.T), strategy, tune, ...e.deps });
  if (prepared) { wake.prepare(); e.run(e.T + 1); }
  loop(e.T);
  e.run(e.T + ms);
  const gaps = [];
  for (let i = 11; i < drawn.length; i++) gaps.push(drawn[i] - drawn[i - 1]);
  const rate = (drawn.length - 11) / ((drawn[drawn.length - 1] - drawn[10]) / 1000);
  return { e, wake, drawn, gaps, rate, wakeKinds };
}
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
const lates = (w) => [...w.late.subarray(0, Math.min(w.lateN, w.late.length))];

test("'sen': budzik strony do chwili należnej, bez dopinania kolejką — średnio dokładnie limit, jedno zadanie kolejki na klatkę", () => {
  for (const fps of [240, 144, 120, 60]) {
    const r = sim({ strategy: 'sen', fps, timerLate: quiet(rng(fps)) });
    assert.ok(Math.abs(r.rate - fps) / fps < 0.01, `${fps}: ${r.rate.toFixed(2)} kl/s`);
    // dopięcia kolejką tylko po czekaniu krótszym niż hopMs (do 0,1 ms)
    assert.ok(r.wake.spins < r.drawn.length, `${fps}: dopięć ${r.wake.spins} na ${r.drawn.length} klatek`);
    assert.equal(r.wake.hops, r.wake.wakes, `${fps}: klatka z zadania kolejki (budzik w klatce bez zagnieżdżenia)`);
    assert.equal(r.wakeKinds.timer, undefined, `${fps}: klatka nigdy z zadania budzika`);
    // odstępy: do 0,5 ms przed chwilą należną (próg limitera) i do ~1 ms po (pełne ms budzika + spóźnienie)
    const I = 1000 / fps;
    assert.ok(Math.min(...r.gaps) >= I - 2, `${fps}: najkrótszy ${Math.min(...r.gaps).toFixed(2)}`);
    assert.ok(pct(r.gaps, 0.99) <= I + 1.5, `${fps}: p99 ${pct(r.gaps, 0.99).toFixed(2)}`);
    assert.ok(r.wake.lateMax >= Math.max(...lates(r.wake)), `${fps}: lateMax ${r.wake.lateMax.toFixed(3)}`);
    assert.equal(r.wake.lateOver, 0, `${fps}: bez spóźnień ponad ${FRAME_WAKE_TUNE.lateOverMs} ms`);
  }
});

test("'kolejka' (dawne, A/B): spóźnienia budzika 5–7 ms w 15% — margines rośnie, czekanie idzie kolejką (setki dopięć na klatkę); 'sen' — nie", () => {
  const old = sim({ strategy: 'kolejka', fps: 120, timerLate: noisy(rng(3)) });
  const sen = sim({ strategy: 'sen', fps: 120, timerLate: noisy(rng(3)) });
  const perFrame = old.wake.spins / old.drawn.length;
  assert.ok(perFrame > 100, `dopięć na klatkę: ${perFrame.toFixed(0)}`);
  assert.ok(sen.wake.spins < sen.drawn.length, `sen: dopięć ${sen.wake.spins}`);
  // dawne dopinanie trzyma takt mimo spóźnień; budzik strony — średnio prawie limit (spóźnienia odrabia akumulator)
  assert.ok(Math.abs(old.rate - 120) / 120 < 0.01, `kolejka: ${old.rate.toFixed(2)}`);
  assert.ok(sen.rate > 0.95 * 120 && sen.rate <= 120 * 1.01, `sen: ${sen.rate.toFixed(2)}`);
  assert.ok(pct(sen.gaps, 0.99) > pct(old.gaps, 0.99) + 2, 'budzik strony: rozrzut odstępów ze spóźnień');
  assert.ok(sen.wake.lateOver > 0.05 * sen.wake.wakes && sen.wake.lateMax >= 5, `sen: spóźnione ${sen.wake.lateOver}, maks. ${sen.wake.lateMax.toFixed(2)}`);
});

test("'worker': sen i pętla na wątku budzika — takt jak przy dopinaniu, strona bez snów i kolejki, jeden komunikat na klatkę", () => {
  for (const fps of [240, 144, 120, 60]) {
    const r = sim({ strategy: 'worker', fps, timerLate: noisy(rng(fps)), workerLate: quiet(rng(fps + 1)) });
    assert.ok(Math.abs(r.rate - fps) / fps < 0.01, `${fps}: ${r.rate.toFixed(2)} kl/s`);
    assert.equal(r.wake.spins + r.wake.hops + r.wake.sleeps, 0, `${fps}: strona nie śpi ani nie dopina`);
    assert.equal(r.wake.strategy, 'worker');
    assert.equal(r.wake.watchdogs, 0);
    assert.equal(r.wakeKinds.timer, undefined, `${fps}: klatka z odpowiedzi wątku, nie z budzika strony`);
    assert.equal(r.e.workers.length, 1);
    assert.equal(r.e.wk.posted, r.wake.wakes + 1, `${fps}: zamówienie na klatkę (+ ostatnie w toku)`);
    assert.ok(Math.max(...lates(r.wake)) < 0.1, `${fps}: spóźnienie budzeń ${Math.max(...lates(r.wake)).toFixed(3)} ms`);
    assert.ok(r.wake.lateMax < 0.1 && r.wake.lateOver === 0, `${fps}: lateMax ${r.wake.lateMax.toFixed(3)}`);
    assert.ok(Math.abs(r.wake.frameMax - 2) < 1e-6, `${fps}: najdłuższa klatka ${r.wake.frameMax} = koszt klatki`);
    // pętla wątku: końcówka spinMs + do 1 ms z pełnych ms snu
    const busyPerWake = r.wake.workerBusyMs / r.wake.wakes;
    assert.ok(busyPerWake <= FRAME_WAKE_TUNE.workerSpinMs + 1, `${fps}: pętla wątku ${busyPerWake.toFixed(2)} ms na klatkę`);
    const I = 1000 / fps;
    assert.ok(pct(r.gaps, 0.99) - pct(r.gaps, 0.01) < 0.6, `${fps}: rozrzut odstępów ${(pct(r.gaps, 0.99) - pct(r.gaps, 0.01)).toFixed(2)} ms`);
    assert.ok(Math.abs(pct(r.gaps, 0.5) - I) < 0.6, `${fps}: mediana ${pct(r.gaps, 0.5).toFixed(2)}`);
  }
});

test("'worker' z barierą (workerFence, A/B): pierwszy stopień strażnika w chwili należnej — odpowiedź wątku go kasuje, takt jak bez bariery", () => {
  const tune = { ...FRAME_WAKE_TUNE, workerFence: true };
  for (const fps of [240, 120, 60]) {
    const r = sim({ strategy: 'worker', fps, tune, timerLate: quiet(rng(fps)), workerLate: quiet(rng(fps + 1)) });
    assert.ok(Math.abs(r.rate - fps) / fps < 0.01, `${fps}: ${r.rate.toFixed(2)} kl/s`);
    assert.equal(r.wake.watchdogs, 0);
    assert.equal(r.wakeKinds.timer, undefined, `${fps}: klatka z odpowiedzi wątku`);
    assert.ok(r.wake.lateMax < 0.1, `${fps}: lateMax ${r.wake.lateMax.toFixed(3)}`);
  }
});

test("'worker' — start wątku 400 ms: do sygnału gotowości klatki budzi strona (bez strażników i dziury), potem wątek", () => {
  const fps = 120, I = 1000 / fps;
  const r = sim({ strategy: 'worker', fps, prepared: false, workerStartMs: 400, ms: 3000, timerLate: quiet(rng(7)) });
  assert.equal(r.wake.strategy, 'worker');
  assert.equal(r.wake.watchdogs, 0);
  assert.equal(r.e.warnings.length, 0);
  assert.equal(r.e.workers.length, 1);
  assert.ok(r.wake.workerReady);
  // bez dziury na start modułu (dawniej pierwsza klatka czekała na start: odstęp ~start + interwał, a start > ~330 ms
  // dawał trzy strażniki z rzędu i 'sen' do końca sesji)
  const gaps = r.drawn.slice(1).map((t, i) => t - r.drawn[i]);
  assert.ok(Math.max(...gaps) < I + 1.5, `najdłuższy odstęp ${Math.max(...gaps).toFixed(2)} ms`);
  const before = r.drawn.filter((t) => t < 1000 + 400).length;
  assert.ok(Math.abs(r.wake.sleeps - before) <= 2, `sny strony ${r.wake.sleeps}, klatek przed gotowością ${before}`);
  assert.ok(r.e.wk.posted >= r.drawn.length - before - 2, `zamówienia u wątku ${r.e.wk.posted} z ${r.drawn.length - before}`);
});

test("'worker' — wątek bez sygnału gotowości: klatki z budzika strony, po workerStartWakes zamówieniach 'sen' z ostrzeżeniem", () => {
  const r = sim({ strategy: 'worker', fps: 120, worker: 'mute', ms: 4000, timerLate: quiet(rng(11)) });
  assert.equal(r.wake.strategy, 'sen');
  assert.equal(r.wake.watchdogs, 0, 'bez strażników — zamówienia nie szły do wątku');
  assert.equal(r.e.wk.posted, 0);
  assert.ok(r.e.wk.terminated);
  assert.equal(r.e.warnings.length, 1);
  assert.match(r.e.warnings[0], /gotowości/);
  assert.ok(Math.abs(r.rate - 120) / 120 < 0.01, `${r.rate.toFixed(2)} kl/s`);
});

test("'worker' bez odpowiedzi (gotowy, potem cisza): strażnik woła klatkę po chwili należnej + watchdogMs, trzy z rzędu — budzik strony do końca sesji", () => {
  for (const workerFence of [false, true]) {
    const r = sim({ strategy: 'worker', fps: 120, worker: 'hang', ms: 3000, tune: { ...FRAME_WAKE_TUNE, workerFence } });
    assert.equal(r.wake.strategy, 'sen');
    assert.equal(r.wake.watchdogs, FRAME_WAKE_TUNE.watchdogFail);
    assert.ok(r.e.wk.terminated);
    assert.equal(r.e.warnings.length, 1);
    assert.match(r.e.warnings[0], /budzik w workerze/);
    assert.ok(r.drawn[1] - r.drawn[0] >= FRAME_WAKE_TUNE.watchdogMs, `bariera ${workerFence}: pierwsza klatka ze strażnika`);
    // po przejściu — takt limitu z budzika strony
    const tail = r.drawn.filter((t) => t > r.drawn[0] + 1000);
    const rate = (tail.length - 1) / ((tail[tail.length - 1] - tail[0]) / 1000);
    assert.ok(Math.abs(rate - 120) / 120 < 0.01, `${rate.toFixed(2)} kl/s`);
  }
});

test("'worker' — błąd wątku (zdarzenie error): zamówienie u wątku przechodzi na budzik strony, klatka raz", () => {
  const e = env({ worker: 'hang', timerLate: () => 0 });
  let wakes = 0;
  const w = createFrameWake({ onWake: () => wakes++, strategy: 'worker', ...e.deps });
  assert.ok(w.prepare());
  e.run(e.T + 1);
  assert.ok(w.workerReady);
  const t0 = e.T;
  w.schedule(5);
  assert.equal(e.wk.posted, 1);
  e.T += 1;
  e.wk.onerror({ message: 'nie ma pliku' });
  assert.equal(w.strategy, 'sen');
  assert.ok(e.wk.terminated);
  assert.equal(w.workerError, 'nie ma pliku');
  assert.equal(e.warnings.length, 1);
  e.run(e.T + 500);
  assert.equal(wakes, 1, 'klatka raz (strażnik wątku skasowany)');
  assert.equal(w.sleeps, 1);
  assert.ok(Math.abs(e.T - (t0 + 5)) < 0.01, `w chwili należnej zamówienia: ${e.T - t0}`);
  assert.equal(w.setStrategy('worker'), 'sen', 'po błędzie wątku zostaje budzik strony');
  assert.equal(w.prepare(), false);
});

test('prepare / release: wątek z góry (limit bez VSync), zamknięty bez limitu — zamówienie u wątku przechodzi na budzik strony, potem nowy wątek', () => {
  const e = env({ timerLate: () => 0 });
  const at = [];
  const w = createFrameWake({ onWake: () => at.push(e.T), strategy: 'worker', ...e.deps });
  assert.equal(w.release(), false, 'bez wątku — nic');
  assert.ok(w.prepare());
  assert.equal(e.workers.length, 1, 'wątek przed pierwszym zamówieniem');
  assert.ok(w.prepare());
  assert.equal(e.workers.length, 1, 'drugi prepare — ten sam wątek');
  e.run(e.T + 1);
  assert.ok(w.workerReady);
  const t0 = e.T;
  w.schedule(6);
  assert.equal(e.wk.posted, 1);
  e.T += 2;
  assert.equal(w.release(), true);
  const old = e.workers[0];
  assert.ok(old.terminated);
  assert.equal(old.onmessage, null, 'komunikaty starego wątku nie dochodzą');
  assert.equal(w.worker, null);
  assert.equal(w.workerReady, false);
  e.run(e.T + 50);
  assert.equal(at.length, 1, 'zamówienie w toku — klatka raz, z budzika strony');
  assert.ok(Math.abs(at[0] - (t0 + 6)) < 0.01, `w chwili należnej: ${(at[0] - t0).toFixed(3)}`);
  assert.equal(w.watchdogs, 0);
  // limit znowu: nowy wątek, do gotowości budzik strony
  w.schedule(5);
  assert.equal(e.workers.length, 2);
  assert.equal(e.workers[1].posted, 0, 'nowy wątek jeszcze niegotowy — budzik strony');
  e.run(e.T + 50);
  assert.equal(at.length, 2);
  w.schedule(5);
  assert.equal(e.workers[1].posted, 1, 'po gotowości — wątek');
  e.run(e.T + 50);
  assert.equal(at.length, 3);
  assert.equal(w.strategy, 'worker');
  assert.equal(e.warnings.length, 0);
});

test('czekanie krótsze niż hopMs (klatka dłuższa niż interwał): skok kolejką strony bez rundy przez wątek budzika', () => {
  const r = sim({ strategy: 'worker', fps: 240, cost: () => 5, ms: 2000 });
  assert.ok(Math.abs(r.rate - 1000 / 5) / 200 < 0.01, `${r.rate.toFixed(2)} kl/s — tyle, ile pozwala klatka`);
  assert.equal(r.e.wk.posted, 0, 'żadnego zamówienia u wątku');
  assert.equal(r.wake.hops, r.wake.wakes + 1, 'skok na klatkę (+ ostatni w toku)');
  assert.equal(r.wake.spins, 0, 'czekanie 0 — bez dopinania');
  assert.ok(r.wake.lateMax < 0.01, `spóźnienie ${r.wake.lateMax.toFixed(4)} ms`);
  // krótsze niż hopMs — skok dopięty do chwili należnej; dłuższe — wątek budzika (dopina wątek, nie strona)
  const e = env({ timerLate: () => 0 });
  const at = [];
  const w = createFrameWake({ onWake: () => at.push(e.T), strategy: 'worker', ...e.deps });
  w.prepare();
  e.run(e.T + 1);
  const t0 = e.T;
  w.schedule(0.06);
  e.run(e.T + 5);
  assert.equal(at.length, 1);
  assert.ok(at[0] >= t0 + 0.06 && at[0] < t0 + 0.07, `po ${(at[0] - t0).toFixed(4)} ms`);
  assert.equal(e.wk.posted, 0);
  w.schedule(FRAME_WAKE_TUNE.hopMs + 0.2);
  assert.equal(e.wk.posted, 1, 'dłuższe czekanie — wątek budzika');
  e.run(e.T + 5);
  assert.equal(at.length, 2);
});

test('zamówienia: nowe zastępuje poprzednie, cancel unieważnia spóźnione budzenia, zmiana strategii w toku — klatka raz', () => {
  for (const strategy of ['sen', 'kolejka', 'worker']) {
    const e = env();
    const at = [];
    const w = createFrameWake({ onWake: () => at.push(e.T), strategy, ...e.deps });
    w.prepare();
    e.run(e.T + 1);
    const t0 = e.T;
    w.schedule(5);
    w.schedule(3);
    e.run(e.T + 50);
    assert.equal(at.length, 1, `${strategy}: jedno budzenie z dwóch zamówień`);
    assert.ok(at[0] - t0 >= 3 && at[0] - t0 < 4.5, `${strategy}: po ${(at[0] - t0).toFixed(2)} ms`);
    w.schedule(5);
    assert.equal(w.cancel(), true);
    assert.equal(w.cancel(), false);
    e.run(e.T + 50);
    assert.equal(at.length, 1, `${strategy}: po cancel bez klatki`);
    w.schedule(4);
    const other = strategy === 'worker' ? 'sen' : 'worker';
    assert.equal(w.setStrategy(other), other);
    e.run(e.T + 50);
    assert.equal(at.length, 2, `${strategy} → ${other}: jedno budzenie`);
  }
});

test('wątek budzika: sygnał gotowości (0) na końcu modułu, zamówienia [seq, waitMs, spinMs], 0 — anulowanie', () => {
  const src = readFileSync(new URL('../src/render/frameWake.worker.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /\nself\.postMessage\(0\);\n$/, 'gotowość po ustawieniu onmessage');
  assert.ok(src.indexOf('self.onmessage = ') < src.lastIndexOf('self.postMessage(0);'));
  assert.match(src, /if \(!m \|\| !\(m\[0\] > 0\)\) return;/);
});

test('?budzik= — strategia A/B na sesję', () => {
  assert.equal(frameWakeStrategyFromQuery('?budzik=sen'), 'sen');
  assert.equal(frameWakeStrategyFromQuery('?dev=1&budzik=kolejka'), 'kolejka');
  assert.equal(frameWakeStrategyFromQuery('?budzik=worker'), 'worker');
  assert.equal(frameWakeStrategyFromQuery('?budzik=xyz'), null);
  assert.equal(frameWakeStrategyFromQuery(''), null);
});
