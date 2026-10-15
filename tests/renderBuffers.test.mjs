// RW-04 (docs/PLAN-render-worker.md § 3.2–3.4): potrójny bufor migawki, pierścień rozkazów i kanał zwrotny RET.
// Wątki: tests/helpers/renderBuffersWorker.mjs (worker_threads na SharedArrayBuffer).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Worker, MessageChannel } from 'node:worker_threads';
import {
  TRIPLE, createTripleBuffer, tripleByteLength, triplePageOffset, TripleBufferWriter, TripleBufferReader
} from '../src/render/tripleBuffer.js';
import { EVENT_RING, createEventRingBuffer, EventRingWriter, EventRingReader } from '../src/render/eventRing.js';
import {
  RET_I32, RET_F64, RET_FLAG, RET_BREACH, RET_LAYOUT_VERSION, RET_DEFAULT_LAYOUT, createReturnLayout, createReturnBuffer,
  createReturnViews, retNoteConsumed, retNoteRendered, retRecentConsumed, retSetFlag, retClearFlag, retHasFlag,
  retBeginStats, retEndStats, retReadStats, retWriteBreach, retReadBreach
} from '../src/render/returnLayout.js';

const WORKER = new URL('./helpers/renderBuffersWorker.mjs', import.meta.url);

function run(workerData, transferList) {
  return new Promise((resolve, reject) => {
    const w = new Worker(WORKER, { workerData, transferList });
    w.once('message', resolve);
    w.once('error', reject);
    w.once('exit', (code) => { if (code !== 0) reject(new Error(`worker ${workerData.role}: exit ${code}`)); });
  });
}

// ── Potrójny bufor ───────────────────────────────────────────────────────────────────────────────────────────

test('potrójny bufor: układ — nagłówek 64 B, strony wyrównane do 64 B', () => {
  assert.equal(TRIPLE.HEADER_BYTES, TRIPLE.HEADER_WORDS * 4);
  assert.equal(tripleByteLength(100), 64 + 3 * 128);
  for (let i = 0; i < 3; i++) assert.equal(triplePageOffset(100, i) % 64, 0);
  const buf = createTripleBuffer(4096, { shared: false });
  const H = new Int32Array(buf, 0, TRIPLE.HEADER_WORDS);
  assert.equal(H[TRIPLE.MID], 1);
  assert.equal(H[TRIPLE.PAGE_BYTES], 4096);
  assert.throws(() => new TripleBufferReader(buf, { pageBytes: 2048 }), /strona/);
});

test('potrójny bufor: pisarz nigdy nie dostaje strony czytelnika (wszystkie przeploty do 12 operacji)', () => {
  // Pełny przegląd przeplotów publish (P) / acquire (A): po każdej operacji trzy strony są różne,
  // a czytelnik po odbiorze ma stronę z NAJNOWSZĄ publikacją.
  let sequences = 0;
  const walk = (ops) => {
    if (ops.length === 12) return;
    for (const op of ['P', 'A']) {
      const next = ops + op;
      const buf = createTripleBuffer(64, { shared: false });
      const w = new TripleBufferWriter(buf);
      const r = new TripleBufferReader(buf);
      const H = new Int32Array(buf, 0, TRIPLE.HEADER_WORDS);
      let lastPublished = 0, k = 0;
      for (const o of next) {
        if (o === 'P') {
          k++;
          w.page[0] = k;
          w.publish();
          lastPublished = k;
        } else if (r.acquire()) {
          assert.equal(r.page[0], lastPublished, `przeplot ${next}`);
        }
        const mid = Atomics.load(H, TRIPLE.MID) & TRIPLE.INDEX_MASK;
        assert.equal(new Set([w.back, r.front, mid]).size, 3, `przeplot ${next}: strony ${w.back}/${r.front}/${mid}`);
      }
      sequences++;
      walk(next);
    }
  };
  walk('');
  assert.ok(sequences > 8000);
});

test('potrójny bufor: pisarz 1000 Hz, czytelnik wolny i nieregularny — żadnej rozdartej strony', async () => {
  const pageBytes = 64 * 1024;
  const buffer = createTripleBuffer(pageBytes);
  assert.ok(buffer instanceof SharedArrayBuffer);
  const durationMs = 900;
  const [wr, rd] = await Promise.all([
    run({ role: 'tripleWriter', buffer, pageBytes, durationMs, hz: 1000 }),
    run({ role: 'tripleReader', buffer, pageBytes, durationMs, seed: 7 })
  ]);
  assert.equal(rd.torn, 0, 'słowa z różnych publikacji na jednej stronie');
  assert.equal(rd.sumBad, 0, 'suma kontrolna strony');
  assert.equal(rd.backwards, 0, 'numer strony nie może się cofnąć');
  assert.ok(wr.published > 400, `pisarz opublikował ${wr.published}`);
  assert.ok(rd.acquired > 20, `czytelnik odebrał ${rd.acquired}`);
  assert.ok(rd.gaps > 0 && wr.overwritten > 0, 'czytelnik wolniejszy — pomija strony (bierze najnowszą)');
  assert.equal(rd.lastK, wr.published, 'ostatnia publikacja odebrana');
});

// ── Pierścień rozkazów ───────────────────────────────────────────────────────────────────────────────────────

test('pierścień: rekordy zmiennej długości, PAD przy końcu miejsca, klatka ≤ k', () => {
  const buf = createEventRingBuffer(64, { shared: false });
  const w = new EventRingWriter(buf);
  const r = new EventRingReader(buf);
  assert.equal(w.capacity, 64);
  let seq = 0, got = 0;
  for (let round = 0; round < 200; round++) {
    const n = 1 + (round % 5);
    for (let i = 0; i < n; i++) {
      const words = (seq * 7) % 13;
      const o = w.begin(3 + (seq % 5), round, words);
      for (let j = 0; j < words; j++) w.data[o + j] = seq * 100 + j;
      w.commit();
      seq++;
    }
    // klatki ≤ round − 1, potem reszta
    for (const k of [round - 1, round]) {
      for (let o; (o = r.next(k)) >= 0;) {
        assert.ok(r.frame <= k);
        assert.equal(r.type, 3 + (got % 5));
        assert.equal(r.words, (got * 7) % 13);
        for (let j = 0; j < r.words; j++) assert.equal(r.data[o + j], got * 100 + j);
        got++;
      }
    }
  }
  assert.equal(got, seq);
  assert.equal(w.grows, 0, 'czytelnik nadąża — pierścień 64 słów wystarcza');
  assert.throws(() => w.begin(0, 0, 0), /typ/);
  assert.throws(() => w.begin(1, 0, EVENT_RING.MAX_WORDS + 1), /słów/);
});

test('pierścień: przejście na większy — stary dopijany do końca, kolejność zachowana', () => {
  const buf = createEventRingBuffer(32, { shared: false });
  let reader = null;
  const w = new EventRingWriter(buf, { onGrow: (next) => reader.adopt(next) });
  reader = new EventRingReader(buf);
  for (let s = 0; s < 500; s++) w.push(1 + (s % 9), s >> 3, [s, s + 0.5, s * 2]);
  w.push(42, 99, new Array(1000).fill(7)); // rekord większy niż cały pierścień
  assert.ok(w.grows >= 3, `wzrosty: ${w.grows}`);
  assert.ok(w.capacity >= 1024, 'nowy pierścień startuje pusty — stare rekordy czekają w starym');
  let s = 0;
  for (let o; (o = reader.next()) >= 0;) {
    if (reader.type === 42) {
      assert.equal(reader.words, 1000);
      assert.equal(reader.data[o + 999], 7);
      continue;
    }
    assert.equal(reader.data[o], s);
    assert.equal(reader.frame, s >> 3);
    s++;
  }
  assert.equal(s, 500);
  assert.equal(reader.switches, w.grows);
  // Następny pierścień nie przyszedł jeszcze (worker: postMessage w drodze) — czytelnik czeka, nic nie gubi.
  const buf2 = createEventRingBuffer(16, { shared: false });
  const w2 = new EventRingWriter(buf2, { onGrow: () => {} });
  const r2 = new EventRingReader(buf2);
  const pending = [];
  w2.onGrow = (b) => { pending.push(b); };
  for (let i = 0; i < 20; i++) w2.push(5, i, [i]);
  let seen = 0;
  for (let o; (o = r2.next()) >= 0;) { assert.equal(r2.data[o], seen); seen++; }
  assert.ok(seen < 20 && pending.length >= 2);
  for (const b of pending.reverse()) r2.adopt(b); // kolejność wiadomości bez znaczenia — liczy się generacja
  for (let o; (o = r2.next()) >= 0;) { assert.equal(r2.data[o], seen); seen++; }
  assert.equal(seen, 20);
});

test('pierścień: pisarz 1000 Hz, czytelnik wolny — 0 zgubionych i przestawionych rekordów, wzrost w locie', async () => {
  const buffer = createEventRingBuffer(256); // mały — pisarz musi go powiększać w trakcie
  const frameCell = new Int32Array(new SharedArrayBuffer(12)); // [klatka pisarza, koniec, rekordy razem]
  const { port1, port2 } = new MessageChannel();
  const [wr, rd] = await Promise.all([
    run({ role: 'ringWriter', buffer, durationMs: 900, hz: 1000, port: port1, seed: 11, frameCell }, [port1]),
    run({ role: 'ringReader', buffer, port: port2, seed: 13, frameCell }, [port2])
  ]);
  assert.ok(wr.records > 10000, `rekordy: ${wr.records}`);
  assert.ok(wr.grows >= 3, `wzrosty pierścienia: ${wr.grows}`);
  assert.equal(rd.records, wr.records, 'każdy rekord odebrany dokładnie raz');
  assert.equal(rd.bad, 0, 'typ, długość i ładunek zgodne z kolejnym numerem');
  assert.equal(rd.order, 0, 'klatki rekordów nie maleją');
  assert.equal(rd.overFrame, 0, 'czytelnik nie bierze rekordów klatek > k');
  assert.equal(rd.switches, wr.grows);
});

// ── Kanał zwrotny RET ────────────────────────────────────────────────────────────────────────────────────────

test('RET: układ bez nakładania części, domyślna pula tarcz = shieldPool', () => {
  const L = RET_DEFAULT_LAYOUT;
  assert.equal(L.f64Offset % 8, 0);
  assert.equal(L.breachOffset % 8, 0);
  assert.ok(L.f64Offset >= RET_I32.HEADER_WORDS * 4);
  assert.ok(L.breachOffset >= L.f64Offset + RET_F64.COUNT * 8);
  assert.equal(L.byteLength, L.breachOffset + L.breachSlots * (RET_BREACH.HEADER_WORDS + L.breachWords) * 4);
  const words = Object.entries(RET_I32).filter(([k]) => !['HEADER_WORDS', 'CONS_RING'].includes(k)).map(([, v]) => v);
  const used = new Set();
  for (const v of words) { assert.ok(v < RET_I32.HEADER_WORDS); assert.ok(!used.has(v)); used.add(v); }
  for (let i = 1; i < RET_I32.CONS_RING; i++) assert.ok(!used.has(RET_I32.CONS0 + i), 'pierścień odebranych bez kolizji');
  const f = Object.entries(RET_F64).filter(([k]) => k !== 'COUNT').map(([, v]) => v);
  assert.equal(new Set(f).size, f.length);
  assert.ok(Math.max(...f) < RET_F64.COUNT);
  const pool = readFileSync(new URL('../src/3d/shield/shieldPool.js', import.meta.url), 'utf8');
  const slots = Number(/export const SHIELD_SLOTS = (\d+)/.exec(pool)[1]);
  const cap = Number(/export const SHIELD_SLOT_CAP = (\d+)/.exec(pool)?.[1] ?? /SHIELD_SLOT_CAP = (\d+)/.exec(pool)[1]);
  assert.equal(L.breachSlots, slots);
  assert.equal(L.breachWords, cap / 32);
  assert.equal(createReturnLayout({ breachSlots: 4, breachWords: 8 }).byteLength,
    L.breachOffset + 4 * (RET_BREACH.HEADER_WORDS + 8) * 4);
});

test('RET: numery migawek, pierścień 4 odebranych (B2cr), flagi, statystyki', () => {
  const v = createReturnViews(createReturnBuffer(RET_DEFAULT_LAYOUT, { shared: false }));
  assert.equal(v.i32[RET_I32.VERSION], RET_LAYOUT_VERSION);
  assert.equal(v.i32[RET_I32.LAST_CONSUMED], -1);
  const out = new Int32Array(4);
  assert.equal(retRecentConsumed(v, out), 0);
  retNoteConsumed(v, 10);
  retNoteConsumed(v, 12);
  assert.equal(retRecentConsumed(v, out), 2);
  assert.deepEqual([...out.subarray(0, 2)], [12, 10]);
  for (const k of [13, 15, 16, 19]) retNoteConsumed(v, k);
  assert.equal(retRecentConsumed(v, out), 4);
  assert.deepEqual([...out], [19, 16, 15, 13]);
  assert.equal(v.i32[RET_I32.LAST_CONSUMED], 19);
  retNoteRendered(v, 16);
  assert.equal(v.i32[RET_I32.LAST_RENDERED], 16);
  retSetFlag(v, RET_FLAG.GPU_READY);
  retSetFlag(v, RET_FLAG.WARM_FLUSHED);
  assert.ok(retHasFlag(v, RET_FLAG.GPU_READY) && retHasFlag(v, RET_FLAG.WARM_FLUSHED) && !retHasFlag(v, RET_FLAG.READY));
  retClearFlag(v, RET_FLAG.GPU_READY);
  assert.ok(!retHasFlag(v, RET_FLAG.GPU_READY) && retHasFlag(v, RET_FLAG.WARM_FLUSHED));
  const stats = new Float64Array(RET_F64.COUNT);
  retBeginStats(v);
  v.f64[RET_F64.GPU_FRAME_MS] = 3.25;
  assert.equal(retReadStats(v, stats), false, 'zapis w toku');
  retEndStats(v);
  assert.equal(retReadStats(v, stats), true);
  assert.equal(stats[RET_F64.GPU_FRAME_MS], 3.25);
});

test('RET: przebicia tarcz — slot wolny, zapis i odczyt rekordu, bez rozdartych odczytów między wątkami', async () => {
  const v = createReturnViews(createReturnBuffer(RET_DEFAULT_LAYOUT, { shared: false }));
  const head = new Int32Array(RET_BREACH.HEADER_WORDS);
  const bits = new Uint32Array(RET_DEFAULT_LAYOUT.breachWords);
  assert.equal(retReadBreach(v, 3, head, bits), true);
  assert.equal(head[RET_BREACH.ENT_SLOT], -1, 'slot puli wolny');
  const src = new Uint32Array(RET_DEFAULT_LAYOUT.breachWords);
  src[5] = 0x80000001;
  retWriteBreach(v, 3, 17, 2, 99, 5, src);
  assert.equal(retReadBreach(v, 3, head, bits), true);
  assert.deepEqual([head[RET_BREACH.ENT_SLOT], head[RET_BREACH.ENT_GEN], head[RET_BREACH.PROFILE], head[RET_BREACH.EPOCH], head[RET_BREACH.ANY]], [17, 2, 99, 5, 1]);
  assert.equal(bits[5], 0x80000001);
  retWriteBreach(v, 3, 17, 2, 99, 6, null);
  assert.equal(retReadBreach(v, 3, head, bits), true);
  assert.equal(head[RET_BREACH.ANY], 0);
  assert.equal(bits[5], 0);

  const layout = createReturnLayout({ breachSlots: 4, breachWords: 128 });
  const buffer = createReturnBuffer(layout);
  const [wr, rd] = await Promise.all([
    run({ role: 'breachWriter', buffer, layout, durationMs: 300 }),
    run({ role: 'breachReader', buffer, layout, durationMs: 300 })
  ]);
  assert.ok(wr.epochs > 100);
  assert.ok(rd.reads > 100);
  assert.equal(rd.torn, 0, 'seqlock: nagłówek i bity rekordu z jednego zapisu');
});
