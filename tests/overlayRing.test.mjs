// Pierścień kanw nakładek B2cr (src/render/overlayRing.js) i wybór trybu szwu (src/render/renderBridge.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { OverlayRing } from '../src/render/overlayRing.js';
import { resolveRenderMode, renderWorkerBlocker } from '../src/render/renderBridge.js';

// Symulacja jak w RW-02 § 4: wątek główny publikuje co `mainMs`, worker bierze NAJNOWSZĄ stronę po skończeniu klatki
// (`workerMs`), bitmapa czeka w kolejce wiadomości do końca bieżącego zadania wątku głównego (`queueMs`).
function simulate({ count = 5, mainMs, workerMs, queueMs, backPressure = false, seconds = 20, seed = 1 }) {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const ring = new OverlayRing(count);
  const recent = new Int32Array(4);
  let recentN = 0;
  const pushRecent = (k) => { for (let i = 3; i > 0; i--) recent[i] = recent[i - 1]; recent[0] = k; recentN = Math.min(4, recentN + 1); };
  let k = 0;
  let published = -1;        // strona do wzięcia
  let lastConsumed = -1;
  let tMain = 0;
  let tWorker = 0;
  let workerFrame = -1;      // klatka w renderze
  const inbox = [];          // bitmapy w drodze: { k, at }
  let lost = 0;
  let pairs = 0;
  const end = seconds * 1000;
  while (tMain < end || tWorker < end) {
    if (tMain <= tWorker) {
      // zadanie wątku głównego: najpierw wiadomości, które przyszły przed jego początkiem
      for (let i = 0; i < inbox.length;) {
        if (inbox[i].at <= tMain) {
          const slot = ring.compose(inbox[i].k);
          if (slot < 0) lost++; else pairs++;
          inbox.splice(i, 1);
        } else i++;
      }
      if (!backPressure || ring.canPublish(lastConsumed)) {
        ring.acquire(k, recent, recentN);
        published = k++;
      }
      tMain += mainMs * (0.7 + 0.6 * rnd());
    } else {
      // postMessage jest FIFO: bitmapa nie wyprzedza poprzedniej
      if (workerFrame >= 0) {
        const at = Math.max(tWorker + queueMs * rnd(), inbox.length ? inbox[inbox.length - 1].at : 0);
        inbox.push({ k: workerFrame, at });
      }
      workerFrame = -1;
      if (published > lastConsumed) {
        lastConsumed = published;
        pushRecent(published);
        workerFrame = published;
      }
      tWorker += workerMs * (0.7 + 0.6 * rnd());
    }
  }
  return { lost, pairs, full: ring.full, guardMax: ring.guardMax };
}

test('B2cr: 5 kanw, wątek główny 3× szybszy od workera — 0 zgubionych par', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const r = simulate({ mainMs: 4, workerMs: 12, queueMs: 4, seed });
    assert.equal(r.lost, 0, `ziarno ${seed}: zgubione ${r.lost}`);
    assert.equal(r.full, 0);
    assert.ok(r.pairs > 1000);
    assert.ok(r.guardMax <= 4);
  }
});

test('B2cr: worker szybszy od wątku głównego i długie kolejki wiadomości — 0 zgubionych', () => {
  // kolejka wiadomości ≤ długość zadania wątku głównego (bitmapa czeka na koniec bieżącego zadania); dłuższa przy
  // szybkim workerze to > 4 klatki w drodze — więcej, niż mieści pierścień RET i 5 kanw (RW-02: najwyżej 4 chronione)
  for (const [mainMs, workerMs, queueMs] of [[12, 4, 10], [8, 8, 8], [4, 5, 4]]) {
    const r = simulate({ mainMs, workerMs, queueMs, seed: 3 });
    assert.equal(r.lost, 0, `${mainMs}/${workerMs}/${queueMs}`);
  }
});

test('B2cp: przeciwciśnienie — nakładka najwyżej raz na odebraną migawkę', () => {
  const r = simulate({ mainMs: 2, workerMs: 10, queueMs: 3, backPressure: true, seed: 5 });
  assert.equal(r.lost, 0);
  const ring = new OverlayRing(5);
  ring.acquire(0, new Int32Array(4), 0);
  assert.equal(ring.canPublish(-1), false);
  assert.equal(ring.canPublish(0), true);
});

test('pierścień „po kolei” bez reguły gubi pary — reguła ma znaczenie', () => {
  // kontrola symulacji: 3 kanwy przy tych samych proporcjach muszą coś zgubić
  const r = simulate({ count: 3, mainMs: 4, workerMs: 12, queueMs: 6, seed: 2 });
  assert.ok(r.lost > 0 || r.full > 0);
});

test('compose: ukrycie poprzedniej kanwy i brak nakładki', () => {
  const ring = new OverlayRing(5);
  const a = ring.acquire(0, new Int32Array(4), 0);
  const b = ring.acquire(1, new Int32Array(4), 0);
  assert.notEqual(a, b);
  assert.equal(ring.compose(0), a);
  assert.equal(ring.hidePrev, -1);
  assert.equal(ring.compose(1), b);
  assert.equal(ring.hidePrev, a);
  assert.equal(ring.compose(7), -1);
  assert.equal(ring.shown, b);
  assert.equal(ring.misses, 1);
});

test('tryb szwu z adresu i powody zapasu', () => {
  const ok = { isolated: true, shared: true, atomics: true, worker: true, offscreen: true, bitmapRenderer: true };
  assert.deepEqual(resolveRenderMode('', ok), { mode: 'off', requested: 'off', fallback: null });
  assert.equal(resolveRenderMode('?szew=inline', ok).mode, 'inline');
  assert.equal(resolveRenderMode('?szew=pakuj', ok).mode, 'pakuj');
  assert.equal(resolveRenderMode('?renderWorker=1', ok).mode, 'worker');
  const noIso = resolveRenderMode('?renderWorker=1', { ...ok, isolated: false });
  assert.equal(noIso.mode, 'inline');
  assert.match(noIso.fallback, /izolacji/);
  assert.equal(resolveRenderMode('?renderWorker=0&szew=inline', ok).mode, 'inline');
  assert.equal(resolveRenderMode('', ok, 'worker').mode, 'worker');
  assert.equal(renderWorkerBlocker({ ...ok, offscreen: false }), 'brak OffscreenCanvas.transferControlToOffscreen');
});
