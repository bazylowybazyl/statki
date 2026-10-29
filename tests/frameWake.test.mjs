// Budzik limitu klatek bez VSync (src/render/frameWake.js, 2026-10-30): pętla gry strony bez rAF — FrameLimiter
// (tryb 'time') mówi, ile czekać, budzik woła klatkę. Symulacja zdarzeń bez czasu ściany: zegar, budziki strony
// (spóźnienia z modelu), kolejka MessageChannel i atrapa wątku budzika — dopięcia kolejką, takt, przejścia strategii.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameLimiter } from '../src/render/frameLimiter.js';
import { createFrameWake, frameWakeStrategyFromQuery, FRAME_WAKE_TUNE } from '../src/render/frameWake.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
// spóźnienia setTimeout: zwykle 0,1–0,4 ms; „noisy” — w 15% 5–7 ms (pomiar 2026-10-29 w grze, atrapa Electrona: p90 5–7)
const quiet = (rnd) => () => 0.1 + 0.3 * rnd();
const noisy = (rnd) => () => (rnd() < 0.15 ? 5 + 2 * rnd() : 0.1 + 0.3 * rnd());

// Atrapy: zadania { at, kind: 'timer' | 'message' } w kolejności czasu; wątek budzika: sen do chwili należnej − spinMs
// (+ spóźnienie), pętla do chwili należnej, odpowiedź po przesyle — na KAŻDE zamówienie (stare też: strona je odrzuca);
// 'mute' — nie odpowiada nigdy.
function env({ timerLate = () => 0.2, workerLate = () => 0.3, transit = 0.03, hopMs = 0.004, worker = 'ok' } = {}) {
  const e = { T: 1000, current: 'start', warnings: [] };
  const tasks = [];
  let ids = 0, order = 0;
  const push = (at, kind, fn) => { const id = ++ids; tasks.push({ at, kind, fn, id, order: order++ }); return id; };
  const port1 = { onmessage: null };
  const wk = { onmessage: null, onerror: null, posted: 0, terminated: false,
    postMessage(m) {
      wk.posted++;
      if (worker === 'mute' || !m || !(m[0] > 0)) return;
      const arrive = e.T + transit, due = arrive + m[1];
      const sleep = Math.floor(m[1] - m[2]);
      const woke = sleep >= 1 ? arrive + sleep + workerLate() : arrive;
      const end = Math.max(woke, due);
      push(end + transit, 'message', () => { if (!wk.terminated) wk.onmessage({ data: [m[0], end - woke] }); });
    },
    terminate() { wk.terminated = true; }
  };
  e.wk = wk;
  e.deps = {
    now: () => e.T,
    setTimer: (fn, d) => push(e.T + d + timerLate(), 'timer', fn),
    clearTimer: (id) => { const i = tasks.findIndex((t) => t.id === id); if (i >= 0) tasks.splice(i, 1); },
    channel: { port1, port2: { postMessage: (v) => push(e.T + hopMs, 'message', () => port1.onmessage({ data: v })) } },
    createWorker: () => wk,
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

// Pętla strony jak index.html (frameLimitTick / nextLoopFrame): klatka narysowana trwa cost() ms.
function sim({ strategy, fps = 120, cost = () => 2, ms = 4000, tune = FRAME_WAKE_TUNE, ...envOpts }) {
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
  loop(e.T);
  e.run(e.T + ms);
  const gaps = [];
  for (let i = 11; i < drawn.length; i++) gaps.push(drawn[i] - drawn[i - 1]);
  const rate = (drawn.length - 11) / ((drawn[drawn.length - 1] - drawn[10]) / 1000);
  return { e, wake, drawn, gaps, rate, wakeKinds };
}
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };

test("'sen': budzik strony do chwili należnej, bez dopinania kolejką — średnio dokładnie limit, jedno zadanie kolejki na klatkę", () => {
  for (const fps of [240, 144, 120, 60]) {
    const r = sim({ strategy: 'sen', fps, timerLate: quiet(rng(fps)) });
    assert.ok(Math.abs(r.rate - fps) / fps < 0.01, `${fps}: ${r.rate.toFixed(2)} kl/s`);
    assert.equal(r.wake.spins, 0, `${fps}: bez dopinania`);
    assert.equal(r.wake.hops, r.wake.wakes, `${fps}: klatka z zadania kolejki (budzik w klatce bez zagnieżdżenia)`);
    assert.equal(r.wakeKinds.timer, undefined, `${fps}: klatka nigdy z zadania budzika`);
    // odstępy: do 0,5 ms przed chwilą należną (próg limitera) i do ~1 ms po (pełne ms budzika + spóźnienie)
    const I = 1000 / fps;
    assert.ok(Math.min(...r.gaps) >= I - 2, `${fps}: najkrótszy ${Math.min(...r.gaps).toFixed(2)}`);
    assert.ok(pct(r.gaps, 0.99) <= I + 1.5, `${fps}: p99 ${pct(r.gaps, 0.99).toFixed(2)}`);
  }
});

test("'kolejka' (dawne, A/B): spóźnienia budzika 5–7 ms w 15% — margines rośnie, czekanie idzie kolejką (setki dopięć na klatkę); 'sen' — zero", () => {
  const old = sim({ strategy: 'kolejka', fps: 120, timerLate: noisy(rng(3)) });
  const sen = sim({ strategy: 'sen', fps: 120, timerLate: noisy(rng(3)) });
  const perFrame = old.wake.spins / old.drawn.length;
  assert.ok(perFrame > 100, `dopięć na klatkę: ${perFrame.toFixed(0)}`);
  assert.equal(sen.wake.spins, 0);
  // dawne dopinanie trzyma takt mimo spóźnień; budzik strony — średnio prawie limit (spóźnienia odrabia akumulator)
  assert.ok(Math.abs(old.rate - 120) / 120 < 0.01, `kolejka: ${old.rate.toFixed(2)}`);
  assert.ok(sen.rate > 0.95 * 120 && sen.rate <= 120 * 1.01, `sen: ${sen.rate.toFixed(2)}`);
  assert.ok(pct(sen.gaps, 0.99) > pct(old.gaps, 0.99) + 2, 'budzik strony: rozrzut odstępów ze spóźnień');
});

test("'worker': sen i pętla na wątku budzika — takt jak przy dopinaniu, strona bez snów i kolejki, jeden komunikat na klatkę", () => {
  for (const fps of [240, 144, 120, 60]) {
    const r = sim({ strategy: 'worker', fps, timerLate: noisy(rng(fps)), workerLate: quiet(rng(fps + 1)) });
    assert.ok(Math.abs(r.rate - fps) / fps < 0.01, `${fps}: ${r.rate.toFixed(2)} kl/s`);
    assert.equal(r.wake.spins + r.wake.hops + r.wake.sleeps, 0, `${fps}: strona nie śpi ani nie dopina`);
    assert.equal(r.wake.strategy, 'worker');
    assert.equal(r.wake.watchdogs, 0);
    assert.equal(r.wakeKinds.timer, undefined, `${fps}: klatka z odpowiedzi wątku, nie z budzika strony`);
    assert.equal(r.e.wk.posted, r.wake.wakes + 1, `${fps}: zamówienie na klatkę (+ ostatnie w toku)`);
    const late = [...r.wake.late.subarray(0, Math.min(r.wake.lateN, r.wake.late.length))];
    assert.ok(Math.max(...late) < 0.1, `${fps}: spóźnienie budzeń ${Math.max(...late).toFixed(3)} ms`);
    // pętla wątku: końcówka spinMs + do 1 ms z pełnych ms snu
    const busyPerWake = r.wake.workerBusyMs / r.wake.wakes;
    assert.ok(busyPerWake <= FRAME_WAKE_TUNE.workerSpinMs + 1, `${fps}: pętla wątku ${busyPerWake.toFixed(2)} ms na klatkę`);
    const I = 1000 / fps;
    assert.ok(pct(r.gaps, 0.99) - pct(r.gaps, 0.01) < 0.6, `${fps}: rozrzut odstępów ${(pct(r.gaps, 0.99) - pct(r.gaps, 0.01)).toFixed(2)} ms`);
    assert.ok(Math.abs(pct(r.gaps, 0.5) - I) < 0.6, `${fps}: mediana ${pct(r.gaps, 0.5).toFixed(2)}`);
  }
});

test("'worker' bez odpowiedzi: strażnik woła klatkę po chwili należnej + watchdogMs, trzy z rzędu — budzik strony do końca sesji", () => {
  const r = sim({ strategy: 'worker', fps: 120, worker: 'mute', ms: 3000 });
  assert.equal(r.wake.strategy, 'sen');
  assert.equal(r.wake.watchdogs, FRAME_WAKE_TUNE.watchdogFail);
  assert.ok(r.e.wk.terminated);
  assert.equal(r.e.warnings.length, 1);
  assert.match(r.e.warnings[0], /budzik w workerze/);
  assert.ok(r.drawn[1] - r.drawn[0] >= FRAME_WAKE_TUNE.watchdogMs, 'pierwsza klatka ze strażnika');
  // po przejściu — takt limitu z budzika strony
  const tail = r.drawn.filter((t) => t > r.drawn[0] + 1000);
  const rate = (tail.length - 1) / ((tail[tail.length - 1] - tail[0]) / 1000);
  assert.ok(Math.abs(rate - 120) / 120 < 0.01, `${rate.toFixed(2)} kl/s`);
});

test("'worker' — błąd wątku (zdarzenie error): zamówienie w toku przechodzi na budzik strony, klatka raz", () => {
  const e = env({ worker: 'mute', timerLate: () => 0 });
  let wakes = 0;
  const w = createFrameWake({ onWake: () => wakes++, strategy: 'worker', ...e.deps });
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
  assert.ok(Math.abs(e.T - 1005) < 0.01, `w chwili należnej zamówienia: ${e.T}`);
  assert.equal(w.setStrategy('worker'), 'sen', 'po błędzie wątku zostaje budzik strony');
});

test('zamówienia: nowe zastępuje poprzednie, cancel unieważnia spóźnione budzenia, zmiana strategii w toku — klatka raz', () => {
  for (const strategy of ['sen', 'kolejka', 'worker']) {
    const e = env();
    const at = [];
    const w = createFrameWake({ onWake: () => at.push(e.T), strategy, ...e.deps });
    w.schedule(5);
    w.schedule(3);
    e.run(e.T + 50);
    assert.equal(at.length, 1, `${strategy}: jedno budzenie z dwóch zamówień`);
    assert.ok(at[0] - 1000 >= 3 && at[0] - 1000 < 4.5, `${strategy}: po ${(at[0] - 1000).toFixed(2)} ms`);
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

test('?budzik= — strategia A/B na sesję', () => {
  assert.equal(frameWakeStrategyFromQuery('?budzik=sen'), 'sen');
  assert.equal(frameWakeStrategyFromQuery('?dev=1&budzik=kolejka'), 'kolejka');
  assert.equal(frameWakeStrategyFromQuery('?budzik=worker'), 'worker');
  assert.equal(frameWakeStrategyFromQuery('?budzik=xyz'), null);
  assert.equal(frameWakeStrategyFromQuery(''), null);
});
